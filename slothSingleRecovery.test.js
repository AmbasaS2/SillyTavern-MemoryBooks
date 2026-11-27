import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSingleSlothCollectionDraft,normalizeSingleSlothPlan,finalizeSingleSlothScenes,sameSlothDraftBinding} from './slothSingleRecovery.js';

const event=(segments,title='Letter')=>({title,complete:true,segments,scene:'She read the letter.',result:'The letter was read.',timeline:'Unknown'});
const open=segments=>({complete:false,segments,reason:'Awaiting an answer.'});
const plan=(raw,ids=[0,1,2,3,4,5])=>normalizeSingleSlothPlan(raw,ids);
const finalize=p=>finalizeSingleSlothScenes(p,new Map(p.events.map(e=>[e.id,{...e,content:'body '+e.title}])));

test('completed and unfinished overlap preserves all completed scenes and keeps shared source pending',()=>{
    const p=plan({events:[event([[0,1]]),event([[2,4]],'Visit'),open([[4,5]])]});
    const out=finalize(p);
    assert.equal(out.scenes.length,2);
    assert.deepEqual(out.scenes[1].segments,[[2,4]]);
    assert.deepEqual(out.scenes[1].collectedRanges,[[2,3]]);
    assert.deepEqual(out.pendingRanges,[[4,5]]);
});
test('legacy deferred overlap, repeated segments and sparse source ranges are normalized without inventing IDs',()=>{
    const p=plan({events:[event([[0,4],[2,4]])],deferred:[{segments:[4,5]}]},[0,2,4,5]);
    const out=finalize(p);
    assert.deepEqual(out.scenes[0].segments,[[0,0],[2,2],[4,4]]);
    assert.deepEqual(out.scenes[0].collectedRanges,[[0,0],[2,2]]);
    assert.deepEqual(out.pendingRanges,[[4,5]]);
});
test('malformed event cannot invalidate independent valid scenes; its known source remains pending',()=>{
    const p=plan({events:[event([[0,1]]),event([[2,99]],'Bad'),event([[4,5]],'Independent')]});
    const out=finalize(p);
    assert.equal(out.scenes.length,2);
    assert.equal(out.skippedScenes,1);
    assert.deepEqual(out.pendingRanges,[[2,5]]);
    assert.deepEqual(out.scenes[1].collectedRanges,[]);
});
test('unknown deferred range prevents progress and Hide without discarding complete prose',()=>{
    const p=plan({events:[event([0,2]),open('unknown')]});
    const out=finalize(p);
    assert.equal(out.scenes.length,1);
    assert.deepEqual(out.scenes[0].collectedRanges,[]);
    assert.deepEqual(out.pendingRanges,[[0,5]]);
});
test('failed Scene drafting protects its shared source; independent memory still saves',()=>{
    const p=plan({events:[event([0,2]),event([2,4],'Incomplete prose')],deferred:[{segments:[5,5]}]});
    const out=finalizeSingleSlothScenes(p,new Map([['event-1',{...p.events[0],content:'Saved body'}]]));
    assert.equal(out.skippedScenes,1);
    assert.deepEqual(out.scenes[0].collectedRanges,[[0,1]]);
    assert.deepEqual(out.pendingRanges,[[2,5]]);
});
test('complete object extraction and trailing comma repair never change quoted prose',()=>{
    const raw='Here is the JSON: {"events":[{"title":"comma,} stays","complete":true,"segments":[[0,1]],"result":"Done",},], "edits":[],} end.';
    const parsed=parseSingleSlothCollectionDraft(raw);
    assert.equal(parsed.events[0].title,'comma,} stays');
    assert.equal(parsed.events.length,1);
});
test('truncated events keep complete rows but never consume uncertain input',()=>{
    const raw='{"events":['+JSON.stringify(event([0,1]))+',{"title":"not finished';
    const recovered=parseSingleSlothCollectionDraft(raw);
    assert.equal(recovered.events.length,1);
    assert.equal(recovered.recoveryUncertain,true);
    const out=finalize(plan(recovered));
    assert.equal(out.scenes.length,1);
    assert.deepEqual(out.scenes[0].collectedRanges,[]);
    assert.throws(()=>parseSingleSlothCollectionDraft('{"events":[{"title":"unfinished'),/no complete/);
});
test('closed events and deferred arrays survive a truncated Nexus tail',()=>{
    const raw='{"events":['+JSON.stringify(event([0,2]))+'],"deferred":[{"segments":[3,5]}],"edits":[{"kind":"npc","action":"create"';
    const parsed=parseSingleSlothCollectionDraft(raw);
    assert.equal(parsed.recoveredIncompleteEdits,true);
    assert.equal(parsed.recoveryUncertain,false);
    assert.deepEqual(finalize(plan(parsed)).scenes[0].collectedRanges,[[0,2]]);
});
test('duplicate complete rows are written once without blocking unrelated events',()=>{
    const e=event([0,2]);const p=plan({events:[e,e,event([3,5],'Another')]});
    const out=finalize(p);
    assert.equal(out.scenes.length,2);
    assert.deepEqual(out.pendingRanges,[]);
});

test('an incident explicitly classified both complete and open is not fabricated as finished',()=>{
    const p=plan({events:[event([0,1]),event([2,5],'Conflict'),open([2,5])]});
    const out=finalize(p);
    assert.equal(out.scenes.length,1);
    assert.deepEqual(out.scenes[0].collectedRanges,[[0,1]]);
    assert.deepEqual(out.pendingRanges,[[2,5]]);
    assert.equal(out.skippedScenes,1);
});
test('a saved raw response can only be replayed for identical source and books',()=>{
    const binding={chatKey:'chat-a',roles:{nexus:'N',memory:'M'},source:[1,2],fingerprint:'original',books:['a','b']};
    const record={version:1,binding,raw:'{"events":[]}'};
    assert.equal(sameSlothDraftBinding(record,structuredClone(binding)),true);
    assert.equal(sameSlothDraftBinding(record,{...binding,chatKey:'chat-b'}),false);
    assert.equal(sameSlothDraftBinding(record,{...binding,books:['a','changed']}),false);
    assert.equal(sameSlothDraftBinding(record,{...binding,fingerprint:'changed'}),false);
});

test('a balanced but invalid row does not discard subsequent complete event prose',()=>{
    const raw='{"events":['+JSON.stringify(event([0,1]))+',{"title":bad},'+JSON.stringify(event([4,5],'Later'))+'],"edits":[]}';
    const recovered=parseSingleSlothCollectionDraft(raw);
    assert.equal(recovered.events.length,2);
    assert.equal(recovered.recoveryUncertain,true);
    assert.equal(finalize(plan(recovered)).scenes.length,2);
    assert.deepEqual(finalize(plan(recovered)).pendingRanges,[[0,5]]);
});
