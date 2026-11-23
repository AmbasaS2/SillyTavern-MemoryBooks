import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import { validateSlothEventWindowEvidence } from './nexusEditEvidence.js';

const source=readFileSync(new URL('./nexusCollectionAI.js',import.meta.url),'utf8');
const from=source.indexOf('function parseStrictJSON('),to=source.indexOf('\nfunction resolveConnection(',from);
assert.ok(from>=0&&to>from);
const parse=vm.runInNewContext(source.slice(from,to)+'\nparseStrictJSON');
test('a provider error inside an HTTP success response is not treated as AI JSON',async()=>{
    const start=source.indexOf('function requester(');
    const end=source.indexOf('\nconst compact=',start);
    const makeRequest=vm.runInNewContext(source.slice(start,end)+'\nrequester',{
        resolveConnection:()=>({api:'nanogpt',model:'active-model'}),
        oai_settings:{},
        requestCompletion:async()=>({text:'',full:{error:{message:'Bad Request'}}}),
    });
    await assert.rejects(makeRequest({},{})('original','Scene'),/selected provider returned an error/);
});
test('strict JSON parser accepts exact JSON and a JSON fence without rewriting malformed values',()=>{
    assert.equal(parse('{"events":[]}', 'plan').events.length,0);
    const fenced=String.fromCharCode(96).repeat(3)+'json\n{"edits":[]}\n'+String.fromCharCode(96).repeat(3);
    assert.equal(parse(fenced,'Nexus').edits.length,0);
    assert.throws(()=>parse('Here is my answer: {"events":[]}', 'plan'),/malformed/);
    assert.throws(()=>parse('{"events": [', 'plan'),/malformed/);
    assert.throws(()=>parse('[]','plan'),/object/);
});
test('collector limits Nexus source and hides protected Outlet content from the AI prompt',()=>{
    assert.match(source,/protectedEntry/);
    assert.match(source,/\[protected; not included\]/);
    assert.match(source,/source\.length>60000/);
    assert.match(source,/auditSlothDraft/);
    assert.match(source,/source\.length\+draft\.length>68000/);
});

test('long original source requires the active model context and a successful token count', async () => {
    const start=source.indexOf('async function canUseOriginalSource(');
    const end=source.indexOf('async function evidenceFor(',start);
    const state={context:120000,tokens:48000};
    const canUse=vm.runInNewContext(source.slice(start,end)+'\ncanUseOriginalSource',{
        getMaxContextSize:()=>state.context,
        getTokenCountAsync:async ()=>state.tokens,
        resolveConnection:profile=>profile,
        getCurrentApiInfo:()=>({completionSource:'nanogpt'}),
        normalizeCompletionSource:value=>value,
        oai_settings:{nanogpt_model:'active-model',openai_max_tokens:12000},
    });
    const profile={api:'nanogpt',model:'active-model'};
    assert.equal(await canUse('original',{},profile),true);
    assert.equal(await canUse('original',{}, {...profile,model:'other-model'}),false);
    state.tokens=0;
    assert.equal(await canUse('original',{},profile),false);
    state.tokens=100000;
    assert.equal(await canUse('original',{},profile),false);
    state.context=8192;
    state.tokens=1200;
    assert.equal(await canUse('original',{},profile),false);
});

test('window extraction keeps a verified quote from a source ID omitted from the proposed range', async () => {
    const start = source.indexOf('async function requestWindowEvidence(');
    const end = source.indexOf('async function evidenceFor(', start);
    const collectEvidence = vm.runInNewContext(source.slice(start, end) + '\nwindowEvidence', {
        compact: JSON.stringify, validateSlothEventWindowEvidence,
    });
    const messages = [
        { id: 0, mes: 'The lighthouse bell cracked in the fog.' },
        { id: 1, mes: 'Jun and Tali are still diagnosing the fault.' },
    ];
    const event = { topic: 'Bell fault', cause: 'Crack in the bell', development: 'Diagnosis began',
        result: 'Unresolved', closure: 'open', sourceRanges: [[1,1]],
        evidence: [{ messageId: 0, quote: 'The lighthouse bell cracked' }] };
    const checked = await collectEvidence(messages, async () => ({ events: [event] }));
    assert.deepEqual(checked.events[0].evidence, event.evidence);
    assert.deepEqual(checked.events[0].sourceRanges, [[0,0],[1,1]]);
    let attempts = 0;
    await assert.rejects(collectEvidence(messages, async () => {
        attempts++;
        return { events: [{ ...event, evidence: [{ messageId: 0, quote: 'An invented bell quote' }] }] };
    }), /missing from original/);
    assert.equal(attempts, 2);
});
