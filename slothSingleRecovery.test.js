import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSingleSlothCollectionDraft,normalizeSingleSlothPlan,finalizeSingleSlothScenes,sameSlothDraftBinding,canReplaySlothPartial,joinSlothRecoveryScenes,buildSlothPendingDraft} from './slothSingleRecovery.js';

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

test('singletons and nested explicit message IDs remain exact, without bridging gaps',()=>{
    const p=plan({events:[event([[0],[2,4,5]],'Sparse'),{...event(null,'Nested'),segments:undefined,messageIds:[[1],[3]]}]});
    assert.deepEqual(p.events.find(e=>e.title==='Sparse').messageIds,[0,2,4,5]);
    assert.deepEqual(p.events.find(e=>e.title==='Nested').messageIds,[1,3]);
    assert.equal(p.invalidScenes,0);
});
test('unique verbatim closure inside an event repairs its wrong message ID',()=>{
    const p=normalizeSingleSlothPlan({events:[{...event([0,2]),closure:{messageId:2,quote:'The exact answer.'}}]},
        [0,1,2],{originalMessages:[{id:0,mes:'Question'},{id:1,mes:'The exact answer.'},{id:2,mes:'Reaction'}]});
    assert.equal(p.events[0].closure.messageId,1);
});
test('partial replay requires the postcommit books and original source, not the reduced pending scope',()=>{
    const record={version:1,raw:'{"events":[],"edits":[]}',binding:{chatKey:'A',roles:{nexus:'N',memory:'M'},fingerprint:[30,'src']},
        partial:{version:1,sourceIds:[0,1,2,3],chunkIds:[0,1,2],books:[[10,'n'],[20,'m']],lockedScenes:[],committedEdits:[]}};
    const binding={chatKey:'A',roles:{memory:'M',nexus:'N'},fingerprint:[30,'src'],books:[[10,'n'],[20,'m']]};
    assert.equal(canReplaySlothPartial(record,binding),true);
    assert.equal(canReplaySlothPartial(record,{...binding,books:[[10,'changed'],[20,'m']]}),false);
    assert.equal(canReplaySlothPartial(record,{...binding,fingerprint:[30,'edited']}),false);
    assert.equal(canReplaySlothPartial(record,{...binding,chatKey:'AU'}),false);
});
test('pending editor excludes committed Scene rows and reconstructs source accounting with frozen rows',()=>{
    const raw={events:[event([0,1]),event([2,3],'Broken'),open([4,5])],edits:[{uid:1},{uid:99}]};
    const first=plan(raw);
    const saved={...first.events[0],content:'**Timeline**: Unknown\n\n**Scene**\nSaved.\n\n**Result**\nDone.'};
    const pending=buildSlothPendingDraft(raw,[saved],0,[raw.edits[1]]);
    assert.deepEqual(pending.events,raw.events.slice(1));
    assert.deepEqual(pending.edits,[{uid:99}]);
    const rejoined=joinSlothRecoveryScenes(pending,[saved]);
    assert.equal(plan(rejoined).events.length,2);
    assert.deepEqual(plan(rejoined).events[0].messageIds,[0,1]);
});

test('a contradictory explicit closure holds just that Scene and keeps the original paid text for review',()=>{
    const good={...event([0,1],'Independent'),closure:{messageId:1,quote:'The door was closed.'}};
    const bad={...event([2,3],'Missing ending'),closure:{messageId:3,quote:'They accepted the terms.'}};
    const raw={events:[good,bad,open([5,5])],edits:[]};
    const ids=[0,1,2,3,4,5];
    const messages=['She took the key.','The door was closed.','A proposal.','They discussed it.','They accepted the terms.','A new unanswered question.'].map((mes,id)=>({id,mes}));
    const p=normalizeSingleSlothPlan(raw,ids,{originalMessages:messages});
    const out=finalize(p);
    assert.equal(out.scenes.length,1);
    assert.equal(out.skippedScenes,1);
    assert.deepEqual(out.scenes[0].collectedRanges,[[0,1]]);
    assert.deepEqual(out.pendingRanges,[[2,5]]);
    const pending=buildSlothPendingDraft(raw,out.scenes,0,[],p.issues);
    assert.deepEqual(pending.events,[bad,raw.events[2]]);
    assert.match(pending.recoveryIssues[0].reason,/Closure quote/);
    pending.events[0].segments=[2,4];
    pending.events[0].closure.messageId=4;
    const corrected=normalizeSingleSlothPlan(joinSlothRecoveryScenes(pending,out.scenes),ids,{originalMessages:messages});
    assert.equal(corrected.events.length,2);
    assert.equal(corrected.invalidScenes,0);
    assert.deepEqual(finalize(corrected).pendingRanges,[[5,5]]);
    assert.equal(raw.events[1].closure.messageId,3,'original response remains unchanged');
});
test('a missing closure remains compatible with previously received prose; a false explicit one does not',()=>{
    const originals=[{id:0,mes:'The gate was closed.'}];
    const raw={events:[event([0,0])],edits:[]};
    assert.equal(normalizeSingleSlothPlan(raw,[0],{originalMessages:originals}).events.length,1);
    raw.events[0].closure={messageId:0,quote:'Invented words'};
    assert.equal(normalizeSingleSlothPlan(raw,[0],{originalMessages:originals}).events.length,0);
});
