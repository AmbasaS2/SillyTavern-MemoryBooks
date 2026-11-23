// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectNexusSceneSplit,validateNexusSceneSplitProposal,
    stageNexusSceneSplit} from './nexusSceneSplit.js';
import {planNexusSceneRotation} from './nexusSceneRotation.js';
import {stageMemoryScenes} from './nexusCollectionPolicy.js';

const body=n=>'**Timeline**\nDay '+n+'\n\n**Scene**\nA specific cause, action and response for '+n+
    ' in the original narrative.\n\n**Result**\nThis event was completed.';
const make=(uid,n,ranges,chatId='chat-1')=>({
    uid,comment:String(n).padStart(3,'0')+' - Original '+n,content:body(n),
    constant:true,vectorized:false,selective:true,disable:false,
    key:['old-'+n],position:0,stmemorybooks:true,
    STMB_chatId:chatId,STMB_sourceRanges:ranges,
    STMB_history:{retainOriginal:'yes',id:uid},
});
const book=()=>({entries:{
    4:make(4,1,[[1,3]]),
    7:make(7,2,[[4,7]]),
    9:make(9,3,[[30,32],[35,38]]),
}});
const messages=[
    {id:30,name:'A',mes:'We first decided to visit the mountain together.'},
    {id:31,name:'B',mes:'The hiking trail was steep but we finished it.'},
    {id:32,name:'A',mes:'Our mountain hike ended at the station.'},
    {id:35,name:'B',mes:'Afterward, a separate plan to meet a friend began.'},
    {id:36,name:'A',mes:'We met the friend at a cafe after lunch.'},
    {id:37,name:'B',mes:'We ate cake and talked about their new home.'},
    {id:38,name:'A',mes:'The cafe meeting finished and we went home.'},
];
const raw={parts:[
    {title:'Hike through the mountains',reason:'The mountain hike has a distinct confirmed finish.',
        result:'The two hikers finished the mountain trail.',
        complete:true,segments:[[30,32]],
        evidence:[{messageId:32,quote:'Our mountain hike ended at the station.'}]},
    {title:'Cafe reunion with a friend',reason:'The meeting begins separately and has its own clear outcome.',
        result:'The separate cafe reunion ended and everyone returned home.',
        complete:true,segments:[[35,38]],
        evidence:[{messageId:36,quote:'We met the friend at a cafe after lunch.'}]},
]};
const drafts=()=>raw.parts.map(item=>({...item,content:body(item.title),keywords:['memory',item.title]}));
const maker=b=>{const uid=Math.max(...Object.values(b.entries).map(e=>e.uid))+1;
    return b.entries[uid]={uid,comment:'',content:'',disable:false};};

test('the newest completed Scene alone is eligible, with exact original source IDs',()=>{
    const b=book(),snap=structuredClone(b);
    const plan=inspectNexusSceneSplit(b,['chat-1']);
    assert.equal(plan.sourceUid,9);assert.equal(plan.sourceNumber,3);
    assert.deepEqual(plan.sourceRanges,[[30,32],[35,38]]);
    assert.deepEqual(plan.sourceIds,[30,31,32,35,36,37,38]);
    assert.deepEqual(b,snap);
});
test('approved split covers every original message exactly once without touching source',()=>{
    const b=book(),original=structuredClone(b);
    const plan=inspectNexusSceneSplit(b,['chat-1']);
    const validated=validateNexusSceneSplitProposal(plan,raw,messages);
    assert.deepEqual(validated.parts.map(p=>p.title),
        ['Hike through the mountains','Cafe reunion with a friend']);
    const result=stageNexusSceneSplit(b,{sourceUid:9,
        parts:drafts(),messages,createEntry:maker});
    assert.deepEqual(b,original);
    assert.deepEqual(result.plan.sourceSnapshot,original.entries[9]);
    const after=result.proposedMemory.entries;
    assert.deepEqual(after[4],{...original.entries[4],constant:false,vectorized:true});
    assert.equal(after[9].content,original.entries[9].content);
    assert.equal(after[9].disable,true);
    assert.equal(after[9].constant,false);
    assert.equal(after[9].vectorized,false);
    assert.equal(after[9].selective,false);
    assert.deepEqual(after[9].STMB_slothSceneSplitArchive.source,original.entries[9]);
    assert.deepEqual(after[9].STMB_slothSceneSplitArchive.children,[10,11]);
    assert.equal(after[10].comment,'004 - Hike through the mountains');
    assert.equal(after[11].comment,'005 - Cafe reunion with a friend');
    assert.deepEqual(after[10].STMB_sourceRanges,[[30,32]]);
    assert.deepEqual(after[11].STMB_sourceRanges,[[35,38]]);
    assert.equal(after[10].STMB_chatId,'chat-1');
    assert.equal(after[11].STMB_chatId,'chat-1');
    assert.deepEqual(planNexusSceneRotation(result.proposedMemory).recentUids,[7,10,11]);
});
test('new future completed Scene preserves archived origin and rotates only active scenes',()=>{
    const split=stageNexusSceneSplit(book(),{sourceUid:9,parts:drafts(),
        messages,createEntry:maker}).proposedMemory;
    const scene={title:'A later event',content:body('later'),segments:[[50,51]],
        messageIds:[50,51],keywords:['later']};
    const after=stageMemoryScenes(split,[scene],maker,{chatId:'chat-1'}).staged;
    assert.equal(after.entries[9].disable,true);
    assert.equal(after.entries[9].content,book().entries[9].content);
    assert.equal(after.entries[12].comment,'006 - A later event');
    assert.deepEqual(planNexusSceneRotation(after).recentUids,[10,11,12]);
});
test('reversed model order uses actual completion IDs, not output order',()=>{
    const plan=inspectNexusSceneSplit(book(),['chat-1']);
    const v=validateNexusSceneSplitProposal(plan,{parts:[raw.parts[1],raw.parts[0]]},messages);
    assert.deepEqual(v.parts.map(p=>p.title),
        ['Hike through the mountains','Cafe reunion with a friend']);
});
test('missing, repeated, stolen, cross-AU or invented sources cannot be split',()=>{
    const plan=inspectNexusSceneSplit(book(),['chat-1']);
    for(const bad of [
        {parts:[raw.parts[0]]},
        {parts:[raw.parts[0],{...raw.parts[1],segments:[[36,38]]}]},
        {parts:[raw.parts[0],{...raw.parts[1],segments:[[31,38]]}]},
        {parts:[raw.parts[0],{...raw.parts[1],segments:[[35,39]]}]},
        {parts:[{...raw.parts[0],evidence:[{messageId:36,quote:'We met the friend at a cafe after lunch.'}]},raw.parts[1]]},
        {parts:[{...raw.parts[0],evidence:[{messageId:30,quote:'This never happened in chat.'}]},raw.parts[1]]},
    ])assert.throws(()=>validateNexusSceneSplitProposal(plan,bad,messages));
    assert.throws(()=>inspectNexusSceneSplit(book(),['wrong-AU']),/another chat/);
    const hidden=messages.filter(m=>m.id!==37);
    assert.throws(()=>validateNexusSceneSplitProposal(plan,raw,hidden),/hidden or absent/);
});
test('earlier Scene, incomplete or custom reference structures are refused',()=>{
    assert.throws(()=>stageNexusSceneSplit(book(),{sourceUid:7,parts:drafts(),
        messages,createEntry:maker}),/latest completed/);
    const stlo=book();stlo.stlo={entries:[9]};
    assert.throws(()=>inspectNexusSceneSplit(stlo,['chat-1']),/STLO root/);
    const outlet=book();outlet.entries[9].position=7;
    assert.throws(()=>inspectNexusSceneSplit(outlet,['chat-1']),/Outlet/);
    const broken=book();broken.entries[9].content='Unfinished';
    assert.throws(()=>inspectNexusSceneSplit(broken,['chat-1']),/incomplete/);
    const reference=book();reference.entries[7].STMB_canonicalEntryUid=9;
    assert.throws(()=>inspectNexusSceneSplit(reference,['chat-1']),/canonical/);
    const overlap=book();overlap.entries[7].STMB_sourceRanges=[[35,36]];
    assert.throws(()=>inspectNexusSceneSplit(overlap,['chat-1']),/overlaps/);
});
test('tampering or re-enabling archived originals and orphaning children fails during rotation',()=>{
    const valid=stageNexusSceneSplit(book(),{sourceUid:9,
        parts:drafts(),messages,createEntry:maker}).proposedMemory;
    for(const change of [
        b=>{b.entries[9].disable=false;},
        b=>{b.entries[9].content='Different original Scene';},
        b=>{b.entries[9].STMB_history={id:0};},
        b=>{b.entries[9].STMB_slothSceneSplitArchive.children=[10,99];},
        b=>{b.entries[10].STMB_sourceRanges=[[30,30]];},
        b=>{b.entries[11].STMB_slothSceneSplitFrom.sourceUid=100;},
    ]){
        const mutated=structuredClone(valid);change(mutated);
        assert.throws(()=>planNexusSceneRotation(mutated),/split|source bounds/);
    }
    assert.throws(()=>inspectNexusSceneSplit(valid,['chat-1']),/previously repaired/);
});
test('keyword recall never resurrects an archived original',()=>{
    const out=stageNexusSceneSplit(book(),{sourceUid:9,parts:drafts(),
        messages,createEntry:maker,olderMode:'keyword'}).proposedMemory;
    assert.equal(out.entries[9].disable,true);
    assert.equal(out.entries[9].vectorized,false);
    assert.equal(out.entries[9].selective,false);
    assert.equal(out.entries[4].selective,true);
    assert.equal(out.entries[4].vectorized,false);
});
