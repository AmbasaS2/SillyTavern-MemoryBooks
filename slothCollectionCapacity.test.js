import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {resolveSlothCapacity,assessSlothCapacity,isSlothGemma31} from './slothCollectionCapacity.js';

test('provider ceilings use only matching catalog records and documented exact model IDs',()=>{
    const catalog=[{id:'google/gemma-4-31b-it',context_length:128000},{id:'other',context_length:4000}];
    assert.equal(resolveSlothCapacity({model:'google/gemma-4-31b-it',catalog,catalogMatches:true}).limit,128000);
    assert.equal(resolveSlothCapacity({model:'google/gemma-4-31b-it',catalog,catalogMatches:false}).limit,256000);
    assert.equal(resolveSlothCapacity({model:'other',catalog,catalogMatches:false,configuredLimit:32000}).limit,32000);
    assert.equal(resolveSlothCapacity({model:'other',catalog,catalogMatches:false}).limit,null);
    assert.equal(isSlothGemma31('other/gemma-4-31b-it'),false);
});
test('whole request reserves output and overhead; the long Nexus repro is blocked',()=>{
    assert.equal(assessSlothCapacity({inputTokens:78244,outputTokens:10000,limit:256000}).blocked,false);
    assert.equal(assessSlothCapacity({inputTokens:678914,outputTokens:10000,limit:256000}).blocked,true);
    assert.equal(assessSlothCapacity({inputTokens:100000,outputTokens:20000,limit:128000}).blocked,true);
    assert.equal(assessSlothCapacity({inputTokens:1000,outputTokens:1000}).blocked,false);
    assert.equal(assessSlothCapacity({inputTokens:78244,outputTokens:10000}).blocked,true);
    assert.equal(assessSlothCapacity({prompt:'가나',inputTokens:0,outputTokens:1000,limit:10000}).input,6);
});
test('preflight uses selected model count, not the RP context, and stops before dispatch',async()=>{
    const src=readFileSync(new URL('./nexusCollectionAI.js',import.meta.url),'utf8');
    const a=src.indexOf('async function preflightSingleSlothCollection('),b=src.indexOf('\nfunction requester(',a);
    const state={count:78244,fetches:0,activeReads:0,presetLimit:256000};
    const sandbox={
        getCurrentApiInfo:()=>({completionSource:'openai'}),normalizeCompletionSource:x=>x,
        getUIModelSettings:()=>({model:'unrelated-rp'}),oai_settings:{},model_list:[{id:'google/gemma-4-31b-it',context_length:4000}],
        getContext:()=>({getPresetManager:()=>({getCompletionPresetByName:()=>({openai_max_context:state.presetLimit})})}),
        getMaxContextSize:()=>{state.activeReads++;return 4000;},
        resolveSlothCapacity,assessSlothCapacity,isSlothGemma31,
        getRequestHeaders:()=>({}),
        fetch:async(url,options)=>{state.fetches++;assert.equal(url,'/api/tokenizers/openai/count?model=gemma');assert.equal(JSON.parse(options.body)[0].content,'full prompt');return {ok:true,json:async()=>({token_count:state.count})};},
        getTokenCountAsync:async()=>{throw Error('wrong tokenizer');},translate:s=>s,console:{warn(){}},
    };
    const run=vm.runInNewContext(src.slice(a,b)+'\npreflightSingleSlothCollection',sandbox);
    const request={api:'custom',model:'google/gemma-4-31b-it',body:{messages:[{role:'user',content:'full prompt'}],max_tokens:10000},connection:{profile:{preset:'collection'}}};
    const pass=await run(request);
    assert.equal(pass.input,78244);assert.equal(pass.limit,256000);assert.equal(state.activeReads,0);
    state.count=678914;
    await assert.rejects(run(request),e=>e.code==='STMB_SLOTH_INPUT_BUDGET'&&e.budget.input===678914);
    assert.equal(state.fetches,2);
    const transport=readFileSync(new URL('./stmemory.js',import.meta.url),'utf8');
    assert.ok(transport.indexOf('await beforeRequest({api,model:effectiveModel')<transport.indexOf('const serviceAttempt = await sendViaChatCompletionService'));
    assert.ok(transport.indexOf('await beforeRequest({api,model:effectiveModel')<transport.indexOf('res = await fetch(url,'));
    const collection=src.slice(src.indexOf('export async function composeSingleSlothCollection('));
    assert.match(collection,/const raw=replayed \? parseSingleSlothCollectionDraft\(rawDraft\) :\s*await ask\(/);
});
