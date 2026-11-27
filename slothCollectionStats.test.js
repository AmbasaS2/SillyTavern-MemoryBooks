import test from 'node:test';
import assert from 'node:assert/strict';
import {createSlothCollectionRun,addSlothRequestMetric,makeSlothRequestMetric,recordSlothCollectionRun,readSlothCollectionHistory,totalSlothRequestMetrics,emitSlothRequestMetric,clearSlothCollectionHistory,slothMetricParts} from './slothCollectionStats.js';
const metric=(overrides={})=>makeSlothRequestMetric({phase:'collection',model:'gemma-4-31b-it',durationMs:50,...overrides});
const storage=()=>{let value=null;return {getItem:()=>value,setItem:(_key,next)=>{value=next;},removeItem:()=>{value=null;},get value(){return value;}};};
test('provider usage, estimated input, byte fallback, missing cache and blocked calls remain distinct',()=>{
    const run=createSlothCollectionRun({ids:[0,1,4,5],startedAt:100});
    addSlothRequestMetric(run,metric({full:{usage:{prompt_tokens:100,completion_tokens:12,prompt_tokens_details:{cached_tokens:0},cost_usd:0}}}));
    addSlothRequestMetric(run,metric({phase:'review',estimate:{input:200,estimated:'tokenizer'},status:'failed'}));
    addSlothRequestMetric(run,metric({phase:'side',estimate:{input:400,estimated:'bytes'},full:{usage:{output_tokens:8,cache_creation_input_tokens:3}}}));
    addSlothRequestMetric(run,metric({estimate:{input:900000,estimated:'bytes'},status:'blocked'}));
    const g=totalSlothRequestMetrics(run.groups);
    assert.equal(g.requests,3);assert.equal(g.blocked,1);assert.equal(g.responded,2);assert.equal(g.failed,1);
    assert.equal(g.durationMs,150);assert.deepEqual(run.source.ranges,[[0,1],[4,5]]);assert.equal(run.source.messageCount,4);
    assert.equal(g.values.input.reported,100);assert.equal(g.values.input.estimated,200);assert.equal(g.values.input.bytes,400);
    assert.equal(g.values.output.reported,20);assert.equal(g.values.output.unknownN,1);
    assert.equal(g.values.cacheRead.reportedN,1);assert.equal(g.values.cacheRead.unknownN,2);
    assert.equal(g.values.cacheWrite.reported,3);assert.equal(g.values.usd.reportedN,1);assert.equal(g.values.usd.unknownN,2);
});
test('native cache is separate; unlabeled cost and missing fields are not reported as zero',()=>{
    const m=metric({full:{usage:{input_tokens:7,output_tokens:3,cache_read_input_tokens:200,cache_creation_input_tokens:4,cost:3}}});
    assert.equal(m.reported.input,7);assert.equal(m.reported.cacheRead,200);assert.equal(m.reported.cacheWrite,4);assert.equal(m.reported.usd,null);
    assert.equal(metric({full:{usage:{prompt_tokens:null,completion_tokens:'12'}}}).reported.output,null);
});
test('history is bounded and rejects arbitrary content, URLs and credential fields',()=>{
    const store=storage();
    for(let i=0;i<35;i++){
        const r=createSlothCollectionRun({ids:[0,1],startedAt:100+i});
        r.chatId='SECRET_CHAT';r.error='PRIVATE_ERROR';r.counts.sceneProposed=2;
        addSlothRequestMetric(r,metric({model:'https://private.example/key',full:{usage:{prompt_tokens:9},text:'PRIVATE_TEXT',apiKey:'SECRET_KEY'}}));
        recordSlothCollectionRun(r,store,200+i);
    }
    const rows=readSlothCollectionHistory(store);
    assert.equal(rows.length,30);assert.equal(rows[0].finishedAt,234);
    assert.doesNotMatch(store.value,/SECRET|PRIVATE|private\.example/);
    assert.equal(rows[0].groups.collection.models.length,0);
    assert.equal(rows[0].counts.sceneProposed,2);
    assert.equal(clearSlothCollectionHistory(store),true);assert.deepEqual(readSlothCollectionHistory(store),[]);
});
test('replay creates no extra request; observer and storage failures do not escape',()=>{
    const run=createSlothCollectionRun({replayed:true,ids:[9]});
    assert.equal(run.trigger,'recovery');assert.equal(totalSlothRequestMetrics(run.groups).requests,0);
    assert.doesNotThrow(()=>emitSlothRequestMetric(()=>{throw Error('optional');},{full:{usage:{prompt_tokens:0}}}));
    const store=storage();store.setItem=()=>{throw Error('full');};
    assert.doesNotThrow(()=>recordSlothCollectionRun(run,store));
    assert.equal(readSlothCollectionHistory(store).length,1);
    clearSlothCollectionHistory(store);
});

test('the UI formatter preserves reported zero and separates estimates from unknown',()=>{
    assert.deepEqual(slothMetricParts({reported:0,reportedN:1,estimated:30,estimatedN:1,bytes:50,bytesN:1,unknownN:2}),
        [{kind:'reported',value:0},{kind:'estimated',value:30},{kind:'bytes',value:50},{kind:'unknown',value:2}]);
    assert.deepEqual(slothMetricParts({reported:0,reportedN:0,unknownN:1}),[{kind:'unknown',value:1}]);
    assert.deepEqual(slothMetricParts({}),[]);
});

test('NanoGPT archived usage maps explicit USD zero and created cache despite a zero compatibility count',()=>{
    const usage={prompt_tokens:78397,completion_tokens:1777,cost:0,currency:'USD',
        prompt_tokens_details:{created_cache_tokens:78352},cache_creation_input_tokens:0};
    const m=metric({full:{usage}});
    assert.equal(m.reported.input,78397);assert.equal(m.reported.output,1777);
    assert.equal(m.reported.cacheWrite,78352);assert.equal(m.reported.usd,0);
    const run=createSlothCollectionRun({ids:[0,1]});
    addSlothRequestMetric(run,m);
    const store=storage();recordSlothCollectionRun(run,store);
    const values=readSlothCollectionHistory(store)[0].groups.collection.values;
    assert.deepEqual(slothMetricParts(values.usd),[{kind:'reported',value:0}]);
    assert.deepEqual(slothMetricParts(values.cacheWrite),[{kind:'reported',value:78352}]);
});
test('USD cost alias requires a numeric value and matching currency; explicit USD fields win',()=>{
    for(const value of [0,0.04]){
        assert.equal(metric({full:{usage:{cost:value,currency:'USD'}}}).reported.usd,value);
        assert.equal(metric({full:{cost:value,currency:'USD'}}).reported.usd,value);
        assert.equal(metric({full:{stmb_streaming:{last_chunk:{usage:{cost:value,currency:'USD'}}}}}).reported.usd,value);
    }
    for(const usage of [{cost:0},{cost:0.04,currency:'EUR'},{cost:'0',currency:'USD'},{cost:-1,currency:'USD'},{cost:null,currency:'USD'}]){
        assert.equal(metric({full:{usage}}).reported.usd,null);
    }
    assert.equal(metric({full:{usage:{cost_usd:0,cost:0.04,currency:'USD'}}}).reported.usd,0);
    assert.equal(metric({full:{cost_usd:0.02,usage:{cost:0.04,currency:'USD'}}}).reported.usd,0.02);
    assert.equal(metric({full:{currency:'USD',usage:{cost:0.04}}}).reported.usd,null);
});
test('cache write aliases are not summed and missing or invalid counts remain unmeasured',()=>{
    const writes=usage=>metric({full:{usage}}).reported.cacheWrite;
    assert.equal(writes({prompt_tokens_details:{created_cache_tokens:78352}}),78352);
    assert.equal(writes({cache_creation_input_tokens:3,prompt_tokens_details:{created_cache_tokens:3}}),3);
    assert.equal(writes({cache_creation_input_tokens:3,prompt_tokens_details:{created_cache_tokens:7}}),3);
    assert.equal(writes({cache_creation_input_tokens:3,prompt_tokens_details:{created_cache_tokens:0}}),3);
    assert.equal(writes({prompt_tokens_details:{created_cache_tokens:0}}),0);
    assert.equal(writes({cache_creation_input_tokens:0}),0);
    assert.equal(writes({prompt_tokens_details:{created_cache_tokens:'78352'}}),null);
    assert.equal(writes({}),null);
});
