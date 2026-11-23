import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectNexusSceneMerge,stageNexusSceneMerge} from './nexusSceneMerge.js';
import {planNexusSceneRotation} from './nexusSceneRotation.js';
import {stageMemoryScenes} from './nexusCollectionPolicy.js';

const text = label => '**Timeline**\nDay ' + label +
    '\n\n**Scene**\nA cause, a choice and a consequence for ' + label +
    '.\n\n**Result**\nA completed resolution.';
const make=(uid,n,ranges,chat='chat-a')=>({
    uid,comment:String(n).padStart(3,'0')+' - '+uid,
    content:text(uid),disable:false,constant:true,vectorized:false,
    selective:true,key:['actor-'+uid],stmemorybooks:true,position:0,
    STMB_chatId:chat,STMB_sourceRanges:ranges,
    STMB_sourceHistory:{original:true,uid},sidePromptMetadata:{label:'untouched'},
});
const example=()=>({entries:{
    10:make(10,1,[[0,3]]),
    12:make(12,2,[[4,8]]), // independent event between the two sources
    25:make(25,3,[[9,10],[15,16]]),
    40:make(40,4,[[17,21]]),
    50:make(50,5,[[22,23]]),
}});
const review={sourceUids:[25,10],title:'An old conflict finally resolves',
    content:'**Timeline**\nDay 1 to 3\n\n**Scene**\nThe original confrontation, their separate actions, and the observed reconciliation.\n\n**Result**\nThe conflict was resolved.',
    keywords:['old fight','apology'],sameCausalIncident:true};
const newScene={title:'Afterward',content:text('new'),segments:[[24,25]],
    messageIds:[24,25],keywords:['aftermath']};
const entryMaker=book=>{
    const uid=Math.max(...Object.values(book.entries).map(e=>e.uid))+1;
    const entry={uid,comment:'',disable:false};book.entries[uid]=entry;return entry;
};

test('two nonadjacent causal scenes can be proposed without swallowing independent event',()=>{
    const source=example(),snapshot=structuredClone(source);
    const plan=inspectNexusSceneMerge(source,[25,10]);
    assert.deepEqual(plan.sourceUids,[10,25]);
    assert.deepEqual(plan.sourceRanges,[[0,3],[9,10],[15,16]]);
    assert.deepEqual(plan.independentUids,[12,40,50]);
    assert.equal(plan.survivorUid,25);
    assert.equal(plan.retiredUid,10);
    assert.deepEqual(source,snapshot);
});
test('reviewed clone-only merge keeps exact original records, UIDs, source spans and distinct events',()=>{
    const source=example(),original=structuredClone(source);
    const result=stageNexusSceneMerge(source,review);
    const out=result.proposedMemory.entries;
    assert.deepEqual(source,original);
    assert.equal(out[12].content,original.entries[12].content,
        'independent Scene prose must remain untouched');
    assert.deepEqual(out[12].STMB_sourceRanges,original.entries[12].STMB_sourceRanges);
    assert.deepEqual(out[12].STMB_sourceHistory,original.entries[12].STMB_sourceHistory);
    assert.equal(out[10].disable,true);
    assert.equal(out[10].constant,false);
    assert.equal(out[10].vectorized,false);
    assert.equal(out[10].STMB_slothSceneMergedInto.targetUid,25);
    assert.equal(out[10].content,original.entries[10].content);
    assert.equal(out[25].uid,25);
    assert.equal(out[25].STMB_chatId,'chat-a');
    assert.deepEqual(out[25].STMB_sourceRanges,[[0,3],[9,10],[15,16]]);
    assert.equal(out[25].STMB_start,undefined);
    assert.equal(out[25].STMB_end,undefined);
    assert.equal(out[25].STMB_discontiguous,true);
    assert.deepEqual(out[25].STMB_slothSceneMerge.sources,
        [original.entries[10],original.entries[25]]);
    assert.deepEqual(out[25].key,
        ['actor-10','actor-25','old fight','apology']);
    assert.deepEqual(result.rotation.map(x=>x.uid),[12]);
    assert.deepEqual(planNexusSceneRotation(result.proposedMemory).recentUids,[25,40,50]);
});
test('new scene can be appended after a reviewed merge without reactivating archived source',()=>{
    const merged=stageNexusSceneMerge(example(),review).proposedMemory;
    const after=stageMemoryScenes(merged,[newScene],entryMaker,{chatId:'chat-a'});
    assert.equal(after.staged.entries[10].disable,true);
    assert.equal(after.staged.entries[10].constant,false);
    assert.equal(after.staged.entries[10].vectorized,false);
    assert.equal(after.writes[0].title,'006 - Afterward');
    assert.equal(after.staged.entries[12].content,merged.entries[12].content);
    assert.deepEqual(after.staged.entries[25].STMB_sourceRanges,[[0,3],[9,10],[15,16]]);
});
test('source overlaps, different chats and missing provenance block merge',()=>{
    const unrelated=example();
    unrelated.entries[25].STMB_chatId='other-AU';
    assert.throws(()=>inspectNexusSceneMerge(unrelated,[10,25]),/different chat/);
    const overlap=example();overlap.entries[25].STMB_sourceRanges=[[3,5]];
    assert.throws(()=>inspectNexusSceneMerge(overlap,[10,25]),/share source/);
    const overlapOther=example();overlapOther.entries[12].STMB_sourceRanges=[[3,8]];
    assert.throws(()=>inspectNexusSceneMerge(overlapOther,[10,25]),/Other Scene UID 12/);
    const absent=example();delete absent.entries[25].STMB_sourceRanges;
    assert.throws(()=>inspectNexusSceneMerge(absent,[10,25]),/no verifiable source/);
    const ambiguous=example();ambiguous.entries[25].STMB_sourceRanges=[[10,11],[11,12]];
    assert.throws(()=>inspectNexusSceneMerge(ambiguous,[10,25]),/overlapping/);
});
test('reference, special outlet, STLO roots and disabled sources fail before writes',()=>{
    for(const field of ['STMB_canonicalEntryUid','disabledBySummaryId',
        'stmbSourceEntryUids','STMB_sidePromptHistory']){
        const item=example();item.entries[12][field]=[10];
        assert.throws(()=>inspectNexusSceneMerge(item,[10,25]),/references/);
    }
    const outlet=example();outlet.entries[10].outletName='Special';
    assert.throws(()=>inspectNexusSceneMerge(outlet,[10,25]),/Outlet/);
    const stlo=example();stlo.stlo={manualOrder:[10,25]};
    assert.throws(()=>inspectNexusSceneMerge(stlo,[10,25]),/STLO/);
    const disabled=example();disabled.entries[10].disable=true;
    assert.throws(()=>inspectNexusSceneMerge(disabled,[10,25]),/Disabled/);
    const unnumbered=example();unnumbered.entries[10].comment='Unnumbered Scene';
    assert.throws(()=>inspectNexusSceneMerge(unnumbered,[10,25]),/unnumbered/);
});
test('missing causal review, incomplete result and malformed selection do not stage',()=>{
    assert.throws(()=>stageNexusSceneMerge(example(),{...review,sameCausalIncident:false}),/causal reason/);
    assert.throws(()=>stageNexusSceneMerge(example(),{...review,content:'**Scene**\nUnfinished'}),/completed Result/);
    assert.throws(()=>stageNexusSceneMerge(example(),{...review,sourceUids:[10,10]}),/different/);
    assert.throws(()=>stageNexusSceneMerge(example(),{...review,title:'001 - duplicate'}),/unnumbered event/);
});
test('tampered merged history or reenabled archived source fails closed',()=>{
    const pristine=stageNexusSceneMerge(example(),review).proposedMemory;
    const changed=structuredClone(pristine);
    changed.entries[10].content='Fake old dialogue.';
    assert.throws(()=>planNexusSceneRotation(changed),/archive/);
    const enabled=structuredClone(pristine);
    enabled.entries[10].disable=false;
    assert.throws(()=>planNexusSceneRotation(enabled),/archive/);
    const orphans=structuredClone(pristine);
    delete orphans.entries[25].STMB_slothSceneMerge;
    assert.throws(()=>planNexusSceneRotation(orphans),/archive/);
    assert.throws(()=>inspectNexusSceneMerge(pristine,[25,40]),/Nested or previously repaired/);
});

test('independent repairs remain possible after a merge and retain known STLO book options', () => {
    const book = example();
    book.stlo = { priority: 5, budgetMode: 'fixed', budget: 350, characterOverrides: {} };
    const first = stageNexusSceneMerge(book, review).proposedMemory;
    const second = stageNexusSceneMerge(first, { ...review, sourceUids: [40, 50] }).proposedMemory;
    assert.deepEqual(second.stlo, book.stlo);
    assert.deepEqual(second.entries[10], first.entries[10]);
    assert.deepEqual(planNexusSceneRotation(second).recentUids, [12, 25, 50]);
});

test('conflicting old source boundaries cannot be rewritten into a false merged range',()=>{
    const old=example();old.entries[10].STMB_start=0;old.entries[10].STMB_end=99;
    assert.throws(()=>inspectNexusSceneMerge(old,[10,25]),/conflicting legacy source/);
});
test('keyword recall never makes archived retired Scene injectable',()=>{
    const original=example();
    const result=stageNexusSceneMerge(original,{...review,olderMode:'keyword'});
    const archived=result.proposedMemory.entries[10];
    assert.equal(archived.disable,true);
    assert.equal(archived.constant,false);
    assert.equal(archived.vectorized,false);
    assert.equal(archived.selective,false);
    assert.equal(result.proposedMemory.entries[12].vectorized,false);
    assert.equal(result.proposedMemory.entries[12].selective,true);
});
test('tampering with archive markers or source snapshots blocks rotation',()=>{
    const source=stageNexusSceneMerge(example(),review).proposedMemory;
    for(const mutation of [
        b=>{b.entries[10].STMB_slothSceneMergedInto=null;},
        b=>{b.entries[25].STMB_slothSceneMerge.sources='corrupt';},
        b=>{b.entries[10].sidePromptMetadata={label:'tampered'};},
    ]){
        const changed=structuredClone(source);mutation(changed);
        assert.throws(()=>planNexusSceneRotation(changed),/archive|history/i);
    }
});
