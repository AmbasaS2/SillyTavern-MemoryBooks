import test from 'node:test';
import {slothEditSignature} from './slothSingleRecovery.js';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import { stageNexusEdits } from './nexusCollectionPolicy.js';
import { validateSlothEventWindowEvidence } from './nexusEditEvidence.js';
import { validateSlothSceneResponse } from './nexusSlothScenePrompt.js';
import { splitSlothCollectionSource } from './nexusCollectionBudget.js';
import { normalizeSlothCollectionDraft, recoverSlothCollectionDraft } from './nexusCollectionDraft.js';

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
        parseStrictJSON:parse,
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
test('a broken batch wrapper does not discard ready scenes or accept a half-written object', () => {
    const ready={id:'first',scene:'She literally said "pick {this}" and left.'};
    const draft={id:'second',scene:'Writing in progress'};
    const cutScene='{"scenes":['+JSON.stringify(ready)+','+JSON.stringify(draft).slice(0,-5);
    assert.deepEqual(recoverSlothCollectionDraft(cutScene),
        {scenes:[ready],edits:[],recoveredIncompleteEdits:true});
    const edit={uid:3,evidence:[{messageId:1,quote:'exact words'}]};
    const cutNexus='{"scenes":['+JSON.stringify(ready)+'],"edits":['+JSON.stringify(edit)+',{"uid":5';
    assert.deepEqual(recoverSlothCollectionDraft(cutNexus),
        {scenes:[ready],edits:[edit],recoveredIncompleteEdits:true});
    const missingOuterBrace='{"scenes":['+JSON.stringify(ready)+'],"edits":['+JSON.stringify(edit)+']';
    assert.deepEqual(recoverSlothCollectionDraft(missingOuterBrace),
        {scenes:[ready],edits:[edit],recoveredIncompleteEdits:false});
    const nestedNexus={scenes:[ready,{edits:[edit]}]};
    assert.deepEqual(normalizeSlothCollectionDraft(nestedNexus),
        {scenes:[ready],edits:[edit],recoveredIncompleteEdits:false});
    assert.deepEqual(recoverSlothCollectionDraft(JSON.stringify(nestedNexus).slice(0,-2)),
        {scenes:[ready],edits:[edit],recoveredIncompleteEdits:false});
    const ownsEdits={...nestedNexus,edits:[]};
    assert.equal(normalizeSlothCollectionDraft(ownsEdits),ownsEdits);
    assert.equal(recoverSlothCollectionDraft('Report: '+cutScene),null);
    assert.equal(recoverSlothCollectionDraft('{"scenes":[{"id":"unfinished'),null);
});
test('collector limits Nexus source and hides protected Outlet content from the AI prompt',()=>{
    assert.match(source,/protectedEntry/);
    assert.match(source,/\[protected; not included\]/);
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

test('collection balances whole messages at 62,000 raw chat tokens per group', async () => {
    const messages=Array.from({length:120},(_,index)=>({id:index*2,mes:'Same-sized chat message.',name:'Not part of token count'}));
    const cases=[[62000,[120]],[62001,[60,60]],[90000,[60,60]],[124000,[60,60]],
        [124001,[40,40,40]],[150000,[40,40,40]],[186001,[30,30,30,30]]];
    for (const [tokens,sizes] of cases) {
        const groups=await splitSlothCollectionSource(messages,async text=>{
            assert.equal(text,messages.map(message=>message.mes).join('\n'));
            return tokens;
        });
        assert.deepEqual(groups.map(group=>group.length),sizes);
        assert.deepEqual(groups.flat(),messages);
    }
});

test('collection chooses the closest whole-message boundary and has a local tokenizer fallback', async () => {
    const messages=[120,30,120,60].map((size,id)=>({id,mes:'x'.repeat(size)}));
    const groups=await splitSlothCollectionSource(messages,async()=>90000);
    assert.deepEqual(groups.map(group=>group.map(message=>message.id)),[[0,1],[2,3]]);
    const large=[{id:0,mes:'x'.repeat(120000)},{id:1,mes:'x'.repeat(120000)}];
    const estimated=await splitSlothCollectionSource(large,async()=>{throw Error('unavailable');});
    assert.deepEqual(estimated,[[large[0]],[large[1]]]);
    assert.deepEqual(await splitSlothCollectionSource([large[0]],async()=>200000),[[large[0]]]);
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

test('approved collection uses one request and retains the valid scenes even over the old word limit', async () => {
    const helpersStart=source.indexOf('const SCENE_LIST_SCHEMA');
    const helpersEnd=source.indexOf('\n/**',helpersStart);
    const begin=source.indexOf('async function reviewSlothSceneDrafts(');
    const end=source.indexOf('\nexport async function retryApprovedSlothScenes(',begin);
    const events=[{id:'first',title:'Read the letter',messageIds:[1]},
        {id:'second',title:'Closed the door',messageIds:[2]}];
    const first={id:'first',timeline:'Unknown',scene:'She read the letter.',result:'She read it.'};
    const second={id:'second',timeline:'Unknown',scene:'He closed the door.',result:'He closed it.'};
    const edits=[{uid:1}];
    const calls=[];
    let draft={scenes:[first,second],edits};
    let repairResponse={repairs:[]};
    const run=vm.runInNewContext(source.slice(helpersStart,helpersEnd)+'\n'+source.slice(begin,end).replaceAll('export async','async')+'\ncomposeApprovedSlothCollection',{
        SCENE_KEYWORD_GUIDANCE:'Recall guidance',getActiveSlothSummaryPreset:()=>({text:'Summary guidance'}),
        parseStrictJSON:parse,normalizeSlothCollectionDraft,recoverSlothCollectionDraft,
        oai_settings:{},compact:JSON.stringify,originalMessages:messages=>messages,validateSlothSceneResponse,
        resolveConnection:profile=>profile || {model:'z-ai/glm-5.3'},
        getContext:()=>({}),
        getSelectedConnectionProfile:(_context,_translate,id)=>({source:'custom',profile:{model:'placeholder',
            'custom-connection':{settings:{custom_model:id}}}}),
        slothNexusGuidance:()=> 'Protected Nexus entries omitted',
        readSlothNexusEdits:raw=>({edits:raw.edits,skippedNexusEdits:0}),
        requester:(_profile,_settings,_signal,singleAttempt)=>async (prompt,phase,parseDraft)=>{
            assert.equal(singleAttempt,true);
            calls.push({prompt,phase});
            if(phase==='Summary review') {
                if(repairResponse instanceof Error) throw repairResponse;
                return repairResponse;
            }
            return typeof draft==='string' ? parseDraft(draft,phase) : draft;
        },
        console:{warn:()=>{}},
    });
    const options={plan:{events},messages:[{id:1,mes:'She read and burned the letter.'},{id:2,mes:'He closed the door.'}],
        nexus:{entries:{}},settings:{moduleSettings:{maxTokens:10000}}};
    const result=await run(options);
    const originalPrompt=calls[0].prompt;
    assert.equal(calls.length,1);
    assert.match(originalPrompt,/scenes and edits arrays/);
    assert.match(originalPrompt,/overall response limit/);
    assert.doesNotMatch(originalPrompt,/per.memory|prose tokens|English words/iu);
    assert.equal(result.scenes.length,2);
    assert.deepEqual(result.edits,edits);

    calls.length=0;
    await run({...options,profile:{stConnectionProfileId:'deepseek/deepseek-v4.1-flash-1017'}});
    assert.equal(calls.length,1);
    assert.match(calls[0].prompt,/ENTIRE JSON under 7600 output tokens/);
    assert.match(calls[0].prompt,/2964 English words across all Scene bodies/);
    assert.doesNotMatch(originalPrompt,/ENTIRE JSON under/);
    const grouped=JSON.parse(calls[0].prompt.split('Original source messages (all current IDs, including deferred):\n\n').at(-1));
    assert.deepEqual(grouped.MemorySources.map(batch=>[batch.id,batch.messages.map(m=>m.id)]),[['first',[1]],['second',[2]]]);
    assert.deepEqual(grouped.nexusOnly,[]);

    calls.length=0;
    const closing=[events[0],{...events[1],closingExchange:true,closure:{messageId:2,quote:'He closed the door.'}}];
    const deepOptions={...options,profile:{model:'deepseek/deepseek-v4.1-flash-1017'},plan:{events:closing}};
    draft={scenes:[first,{...second,scene:'He shut the door.',result:'He closed the door.'}],edits};
    const paraphrased=await run(deepOptions);
    assert.deepEqual(Array.from(paraphrased.scenes,scene=>scene.id),['first','second']);
    assert.match(calls[0].prompt,/closingExcerpt":"He closed the door\./);
    calls.length=0;
    const noQuote=await run({...deepOptions,plan:{events:[events[0],{...closing[1],closure:undefined}]}});
    assert.equal(calls.length,1);
    assert.deepEqual(Array.from(noQuote.scenes,scene=>scene.id),['first','second']);
    assert.doesNotMatch(calls[0].prompt,/closingExcerpt/);
    draft={scenes:[first,second],edits};
    const grounded=await run(deepOptions);
    assert.deepEqual(Array.from(grounded.scenes,scene=>scene.id),['first','second']);

    calls.length=0;
    draft={scenes:[{...first,scene:'Letter '.repeat(651)},{id:'second',scene:'Missing the other fields.'}],edits};
    const partial=await run({...options,settings:{moduleSettings:{maxTokens:4000}}});
    assert.equal(calls.length,1);
    assert.equal(partial.scenes.length,1);
    assert.equal(partial.scenes[0].id,'first');
    assert.equal(partial.skippedScenes,1);

    calls.length=0;
    draft='{"scenes":['+JSON.stringify(first)+',{"id":"second","scene":"Interrupted';
    const recovered=await run(options);
    assert.equal(calls.length,1);
    assert.equal(recovered.scenes[0].id,'first');
    assert.equal(recovered.skippedScenes,1);

    calls.length=0;
    draft={scenes:[first,second],edits};
    repairResponse={repairs:[
        {...first,scene:'She read and burned the letter.',issue:'omission',evidence:{messageId:1,quote:'burned the letter'}},
        {...second,scene:'He opened the door.',issue:'distortion',evidence:{messageId:1,quote:'burned the letter'}},
    ]};
    const reviewed=await run({...options,reviewSummaries:true});
    assert.equal(calls.length,2);
    assert.equal(calls[0].prompt,originalPrompt);
    assert.equal(calls[1].phase,'Summary review');
    assert.match(reviewed.scenes[0].content,/burned the letter/);
    assert.match(reviewed.scenes[1].content,/closed the door/);

    calls.length=0;
    repairResponse=new Error('Provider unavailable');
    const withoutReview=await run({...options,reviewSummaries:true});
    assert.equal(calls.length,2);
    assert.equal(withoutReview.reviewFailed,true);
    assert.equal(withoutReview.scenes[0].content,result.scenes[0].content);
});

test('Nexus edits without citations are accepted; structural conflicts are skipped independently', () => {
    const normalizerStart=source.indexOf('function canonicalizeNewNexusTitles(');
    const normalizerEnd=source.indexOf('function parseStrictJSON(',normalizerStart);
    const start=source.indexOf('function readSlothNexusEdits(');
    const end=source.indexOf('async function reviewSlothSceneDrafts(',start);
    const filter=vm.runInNewContext(source.slice(normalizerStart,normalizerEnd)+'\n'+source.slice(start,end)+'\nreadSlothNexusEdits',{
        stageNexusEdits, slothEditSignature, console:{warn:()=>{}},
    });
    const nexus={entries:{1:{uid:1,comment:'LT 01 | The letter',content:'The letter arrived.'},
        2:{uid:2,comment:'LT 02 | The gate',content:'The gate had been open.'}}};
    const messages=[{id:1,mes:'She answered the letter.'},{id:2,mes:'He closed the gate.'}];
    const good={uid:1,kind:'lt',action:'append',text:'She answered the letter.',
        reason:'The original conversation shows that she replied.',
        evidence:[{messageId:1,quote:'She answered the letter.'}]};
    const next={...good,uid:2,text:'He closed the gate.',evidence:[{messageId:2,quote:'He closed the gate.'}]};
    const bad={...good,uid:null,text:'Cannot edit an invalid UID.'};
    delete good.evidence; delete good.reason;
    const saved=filter({edits:[good,bad,good,next]},{messages,nexus});
    assert.equal(saved.skippedNexusEdits,2);
    assert.deepEqual(JSON.parse(JSON.stringify(saved.edits)),[good,next]);
    assert.deepEqual(JSON.parse(JSON.stringify(saved.pendingEdits)),[bad,good]);
    const replay=filter({edits:[good,bad,next]},{messages,nexus,committedEdits:[good,next]});
    assert.equal(replay.edits.length,0);
    assert.equal(replay.skippedNexusEdits,1);
    assert.equal(nexus.entries[1].content,'The letter arrived.');
    const withContinuity={entries:{...nexus.entries,3:{uid:3,comment:'Current Continuity',
        content:'## Present Handoff\nThe gate was open.',constant:true}}};
    const continuity={uid:3,kind:'continuity',action:'append_section',section:'Present Handoff',
        text:'He closed the gate.',reason:next.reason,evidence:next.evidence};
    const partial=filter({edits:[continuity,good]},{messages,nexus:withContinuity,partialSource:true});
    assert.deepEqual(JSON.parse(JSON.stringify(partial.edits)),[good]);
    assert.equal(partial.skippedNexusEdits,1);
    assert.equal(filter({edits:[continuity]},{messages,nexus:withContinuity}).edits.length,1);
    const heading={...continuity,text:'## Present Handoff\n'+continuity.text};
    assert.equal(filter({edits:[heading]},{messages,nexus:withContinuity}).edits[0].text,continuity.text);
    const wrongHeading={...continuity,text:'## Active Threads\n'+continuity.text};
    assert.equal(filter({edits:[wrongHeading]},{messages,nexus:withContinuity}).edits.length,0);
    const secondHeading={...heading,text:heading.text+'\n## Active Conditions\nAnother section.'};
    assert.equal(filter({edits:[secondHeading]},{messages,nexus:withContinuity}).edits.length,0);
});

test('a requested retry uses one request with only the missing scenes’ source spans', async () => {
    const helpersStart = source.indexOf('const SCENE_LIST_SCHEMA');
    const helpersEnd = source.indexOf('\n/**',helpersStart);
    const begin = source.indexOf('async function retryApprovedSlothScenes(');
    const end = source.indexOf('\nexport async function compressSlothScene(',begin);
    const calls = [];
    const run = vm.runInNewContext(source.slice(helpersStart,helpersEnd)+'\n'+source.slice(begin,end)+'\nretryApprovedSlothScenes',{
        SCENE_KEYWORD_GUIDANCE:'Recall guidance', getActiveSlothSummaryPreset:()=>({text:'Summary guidance'}),
        compact:JSON.stringify,validateSlothSceneResponse,
        requester:(_profile,_settings,_signal,singleAttempt)=>async (prompt,phase)=>{
            assert.equal(singleAttempt,true);
            calls.push({prompt,phase});
            return {scenes:[{id:'event-3',timeline:'Unknown',scene:'They bought a gift.',result:'They chose a gift.'}]};
        },
    });
    const messages = [{id:24,mes:'Already completed.'},{id:26,mes:'They looked at gifts.'},
        {id:27,mes:'Other event.'},{id:29,mes:'They paid.'},{id:30,mes:'Still pending.'}];
    const events = [{id:'event-3',title:'Gift shop',messageIds:[26,29]}];
    const scenes = await run({events,messages});
    assert.equal(calls.length,1);
    const supplied = JSON.parse(calls[0].prompt.split('Original messages for these Scenes:\n\n').at(-1));
    assert.deepEqual(supplied.map(message=>message.id),[26,29]);
    assert.equal(scenes.length,1);
    assert.equal(scenes[0].title,'Gift shop');
    assert.deepEqual(scenes[0].messageIds,[26,29]);
});
