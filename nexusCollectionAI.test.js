import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import { validateSlothEventWindowEvidence } from './nexusEditEvidence.js';
import { validateSlothSceneResponse } from './nexusSlothScenePrompt.js';

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
    assert.doesNotMatch(source,/auditSlothDraft|keywords correction/);
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
    state.tokens=24000;
    assert.equal(await canUse('original',{}, {stConnectionProfileId:'alternate'},true),true);
    assert.equal(await canUse('original',{}, {stConnectionProfileId:'alternate'}),false);
    state.tokens=45000;
    assert.equal(await canUse('original',{}, {stConnectionProfileId:'alternate'},true),false);
    state.tokens=0;
    assert.equal(await canUse('original',{},profile),false);
    state.tokens=100000;
    assert.equal(await canUse('original',{},profile),false);
    state.context=8192;
    state.tokens=1200;
    assert.equal(await canUse('original',{},profile),false);
});

test('window extraction keeps a verified quote from a source ID omitted from the proposed range', async () => {
    const start = source.indexOf('async function requestValidatedDraft(');
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
    const fallback = await collectEvidence(messages, async () => {
        attempts++;
        return { events: [{ ...event, evidence: [{ messageId: 0, quote: 'An invented bell quote' }] }] };
    });
    assert.equal(attempts, 2);
    assert.equal(JSON.stringify(fallback.originalMessages),JSON.stringify(messages));
    assert.equal(fallback.events,undefined);
});

test('a draft with overlapping message ownership gets one corrective request, provider failures do not',async()=>{
    const start=source.indexOf('async function requestValidatedDraft(');
    const end=source.indexOf('\nasync function windowEvidence(',start);
    const checked=vm.runInNewContext(source.slice(start,end)+'\nrequestValidatedDraft');
    const requests=[];
    const validate=raw=>{
        if (raw.duplicate) throw new Error('Message #72 is already assigned.');
        return raw;
    };
    const result=await checked('Original source','Event plan',async prompt=>{
        requests.push(prompt);
        return {duplicate:requests.length===1};
    },validate,'Give every message one owner.');
    assert.deepEqual(result,{duplicate:false});
    assert.equal(requests.length,2);
    assert.match(requests[1],/Message #72 is already assigned\.[\s\S]*Give every message one owner/);
    let attempts=0;
    await assert.rejects(checked('Original source','Scene',async()=>{
        attempts++;
        throw new Error('Provider unavailable');
    },validate,'Use the required headings.'),/Provider unavailable/);
    assert.equal(attempts,1);
});

test('a usable single Scene keeps its keywords locally after recovering from an overlong draft', async () => {
    const draftStart = source.indexOf('async function requestValidatedDraft(');
    const draftEnd = source.indexOf('\nasync function windowEvidence(', draftStart);
    const sceneStart = source.indexOf('async function composeSlothScene(');
    const sceneEnd = source.indexOf('\nconst SCENE_LIST_SCHEMA', sceneStart);
    const makeDraft = prose => ({title: 'The letter', keywords: ['bell', 'gate', 'letter', 'palm', 'answer'],
        content: `**Timeline**: Unknown\n\n**Scene**\n${prose}\n\n**Result**\nShe gave him the letter.`});
    const corrected = {...makeDraft('She handed him the letter and kept her palm against his shoulder.'),
        keywords:[' bell ', 'Bell', 'the letter tucked underneath the faded green ribbon']};
    const requests = [];
    const compose = vm.runInNewContext(source.slice(draftStart, draftEnd) + '\n' + source.slice(sceneStart, sceneEnd) + '\ncomposeSlothScene', {
        SLOTH_SCENE_OUTPUT_CONTRACT: 'Required shape', getActiveSlothSummaryPreset: () => ({text: 'Writing guidance'}),
        oai_settings:{},
        withFullSlothSource: async (messages,_prompt,_settings,_profile,run) => run(messages.map(message => message.mes).join('\n')),
        validateSlothSceneResponse, SCENE_KEYWORD_GUIDANCE: 'Writing guidance for keywords',
        requester: () => async prompt => {
            requests.push(prompt);
            return requests.length === 1 ? makeDraft('word '.repeat(651)) : corrected;
        },
    });
    const event = {id: 'test', messageIds: [2], segments: [[2, 2]], title: 'The letter', result: 'She handed it over.'};
    const messages = [{id: 1, mes: 'Outside the approved range'}, {id: 2, mes: 'Her palm stayed on his shoulder.'}];
    const result = await compose({event, messages});
    assert.equal(result.content, corrected.content);
    assert.deepEqual(result.keywords, ['bell', 'the letter tucked underneath the faded green ribbon']);
    assert.equal(requests.length, 2);
    assert.match(requests[1], /Her palm stayed on his shoulder\.[\s\S]*about 400 words[\s\S]*final physical state/);
    assert.doesNotMatch(requests[1], /Outside the approved range/);
});

test('long source falls back only for a provider input-capacity error', async () => {
    const begin=source.indexOf('function sourceCapacityExceeded(');
    const end=source.indexOf('async function evidenceFor(',begin);
    const withSource=vm.runInNewContext(source.slice(begin,end)+'\nwithFullSlothSource',{
        compact:JSON.stringify,canUseOriginalSource:async()=>true,
    });
    const observed=[];
    const messages=[{id:1,mes:'oracle '.repeat(4000)}];
    const fallback=async()=>{observed.push('windows');return 'window evidence';};
    const response=await withSource(messages,'guide',{}, {},async text=>{
        observed.push(text==='window evidence'?'grounded':'original');
        if(observed.length===1)throw new Error('Request failed',{cause:new Error('maximum context length exceeded')});
        return 'result';
    },fallback);
    assert.equal(response,'result');
    assert.deepEqual(observed,['original','windows','grounded']);
    await assert.rejects(withSource(messages,'guide',{}, {},async()=>{throw Error('Rate limit');},
        async()=>assert.fail('Unrelated provider errors must propagate')),/Rate limit/);
});

test('scene batch reuses valid prose even with missing keywords and only recovers incomplete scenes', async () => {
    const begin=source.indexOf('const SCENE_LIST_SCHEMA');
    const end=source.indexOf('\n/**',begin);
    const valid={id:'event-1',timeline:'Unknown',scene:'She opened the door.',result:'The door opened.'};
    const calls=[];
    const compose=vm.runInNewContext(source.slice(begin,end).replace('export async','async')+'\ncomposeSlothScenes',{
        requester:()=>async prompt=>{calls.push({prompt});return {scenes:[valid,{id:'event-2',title:'Invalid'}]};},
        SLOTH_SCENE_OUTPUT_CONTRACT:'single entry contract',getActiveSlothSummaryPreset:()=>({text:'Writing guidance'}),
        compact:JSON.stringify,oai_settings:{},validateSlothSceneResponse,
        SCENE_KEYWORD_GUIDANCE:'Writing guidance for keywords',
        composeSlothScene:async ({event})=>{calls.push({recovered:event.id});return event;},
    });
    const events=[{id:'event-1',title:'Approved first memory',result:'Opened',messageIds:[1]},
        {id:'event-2',title:'Approved second memory',result:'Closed',messageIds:[5]}];
    const messages=[{id:1,mes:'She opened the door.'},{id:2,mes:'An excluded remark.'},{id:5,mes:'He shut the gate.'}];
    const result=await compose({events,messages,settings:{moduleSettings:{maxTokens:4000}}});
    assert.equal(calls.length,2);
    assert.match(calls[0].prompt,/325–650 tokens of Scene prose/);
    assert.doesNotMatch(calls[0].prompt,/An excluded remark/);
    assert.equal(calls[1].recovered,'event-2');
    assert.equal(result[0].content,'**Timeline**: Unknown\n\n**Scene**\nShe opened the door.\n\n**Result**\nThe door opened.');
    assert.equal(result[0].title,events[0].title);
    assert.deepEqual(result[0].keywords,[events[0].title]);
});

test('only a newly created reserved Nexus entry can lose a decorative title suffix', () => {
    const begin=source.indexOf('function canonicalizeNewNexusTitles(');
    const end=source.indexOf('function parseStrictJSON(',begin);
    const normalize=vm.runInNewContext(source.slice(begin,end)+'\ncanonicalizeNewNexusTitles');
    const append={action:'append',kind:'core',title:'Core Memory — title should be ignored'};
    const wrong={action:'create',kind:'continuity',title:'Unrelated entry'};
    const correct={action:'create',kind:'continuity',title:'Current Continuity — vineyard, 10/23'};
    const [assigned,unchangedAppend,unchangedWrong]=normalize([correct,append,wrong]);
    assert.equal(assigned.title,'Current Continuity');
    assert.equal(unchangedAppend,append);
    assert.equal(unchangedWrong,wrong);
    assert.match(correct.title,/vineyard/);
});

test('approved collection combines Memory and Nexus within the budget and recovers only missing work', async () => {
    const helpersStart=source.indexOf('const SCENE_LIST_SCHEMA');
    const helpersEnd=source.indexOf('\nexport async function composeSlothScenes(',helpersStart);
    const start=source.indexOf('async function composeApprovedSlothCollection(');
    const end=source.indexOf('\nexport async function compressSlothScene(',start);
    const events=[{id:'first',title:'Read the letter',messageIds:[1]},
        {id:'second',title:'Closed the door',messageIds:[2]}];
    const first={id:'first',timeline:'Unknown',scene:'She read the letter.',result:'She read it.'};
    const second={id:'second',timeline:'Unknown',scene:'He closed the door.',result:'He closed it.'};
    const edits=[{uid:1}];
    const calls=[];
    let draft={scenes:[first,second],edits};
    const run=vm.runInNewContext(source.slice(helpersStart,helpersEnd)+'\n'+source.slice(start,end)+'\ncomposeApprovedSlothCollection',{
        SCENE_KEYWORD_GUIDANCE:'Recall guidance', getActiveSlothSummaryPreset:()=>({text:'Summary guidance'}),
        oai_settings:{}, compact:JSON.stringify, validateSlothSceneResponse,
        slothNexusGuidance:()=> 'Protected Nexus entries omitted',
        readSlothNexusEdits:raw=>raw.edits,
        requester:()=>async prompt=>{calls.push(prompt);return draft;},
        composeSlothScenes:async ({events:missing})=>{calls.push(missing.map(x=>x.id));return missing;},
        proposeSlothNexusEdits:async()=>{calls.push('Nexus');return edits;},
    });
    const options={plan:{events},messages:[{id:1,mes:'Read'},{id:2,mes:'Closed'}],nexus:{entries:{}},
        settings:{moduleSettings:{maxTokens:10000}}};
    const combined=await run(options);
    assert.equal(calls.length,1);
    assert.match(calls[0],/scenes and edits arrays/);
    assert.match(calls[0],/325–650 tokens of Scene prose/);
    assert.match(combined.scenes[0].content,/read the letter/);
    assert.deepEqual(combined.edits,edits);

    calls.length=0;
    draft={scenes:[first],edits};
    const recovered=await run(options);
    assert.equal(calls.length,2);
    assert.deepEqual(calls[1],['second']);
    assert.match(recovered.scenes[0].content,/read the letter/);
    assert.equal(recovered.scenes[1],events[1]);
    assert.deepEqual(recovered.edits,edits);

    calls.length=0;
    await run({...options,settings:{moduleSettings:{maxTokens:4000}}});
    assert.deepEqual(calls,[['first','second'],'Nexus']);
});
