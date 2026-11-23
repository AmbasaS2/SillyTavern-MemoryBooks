// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectUnifiedMemorySplit,stageUnifiedMemorySplit} from './nexusUnifiedMigration.js';

const story='**Scene**\nGrounded event and resolution.\n\n**Result**\nActually completed.';
function entry(uid,comment,content,rest={}) {
    return {uid,comment,content,key:[],constant:true,vectorized:false,
        selective:true,position:1,order:100,disable:false,outletName:'',
        displayIndex:uid,extensions:{original:true},...rest};
}
function fixture() {
    const memory={entries:{
        0:entry(0,'001 - Beginning',story,{stmemorybooks:true,STMB_start:0,STMB_end:9,constant:false}),
        1:entry(1,'002 - Turning point',story,{stmemorybooks:true,STMB_start:10,STMB_end:19}),
        2:entry(2,'003 - Answer',story,{stmemorybooks:true,STMB_start:20,STMB_end:29}),
        3:entry(3,'004 - Resolution',story,{stmemorybooks:true,STMB_start:30,STMB_end:39}),
        56:entry(56,'Scene Continuity (STMB SidePrompt)',
            'A promise was not yet completed.',{STMB_sidePromptRegeneration:{version:2,templateKey:'scene-continuity'}}),
        57:entry(57,'Status (STMB SidePrompt)',
            'The injury has not healed.',{STMB_sidePromptRegeneration:{version:2,templateKey:'status'}}),
        58:entry(58,'Long-Term Memory (STMB SidePrompt)',
            'Unique nickname and exact quote.',{STMB_sidePromptRegeneration:{version:2,templateKey:'long-term-memory'},order:6500}),
        59:entry(59,'NPC Index (STMB SidePrompt)',
            'Sirius knows only the first secret.',{STMB_sidePromptRegeneration:{version:2,templateKey:'npc-index'},position:0}),
        60:entry(60,'kinks','Outlet content intact',{outletName:'kinks',position:7}),
        61:entry(61,'PanelAssets','Panel content intact',{outletName:'PanelAssets',position:7}),
    }};
    const nexus={entries:{100:entry(100,'LT 01 | Existing topic','Original elsewhere',{constant:false,vectorized:true})},
        stlo:{priority:26}};
    return {memory,nexus};
}
function creator(book){
    const id=Math.max(-1,...Object.keys(book.entries).map(Number))+1;
    const item={uid:id,displayIndex:id,position:0,disable:false};
    book.entries[id]=item;return item;
}

test('split moves non-Scenes into Nexus while preserving all Scenes in Memory',()=>{
    const {memory,nexus}=fixture();
    const beforeMemory=structuredClone(memory),beforeNexus=structuredClone(nexus);
    const plan=inspectUnifiedMemorySplit(memory,nexus);
    assert.equal(plan.required,true);
    assert.equal(plan.sceneCount,4);
    assert.equal(plan.nonSceneCount,6);
    assert.deepEqual(plan.errors,[]);
    const got=stageUnifiedMemorySplit({memory,nexus,createNexusEntry:creator});
    assert.deepEqual(memory,beforeMemory);assert.deepEqual(nexus,beforeNexus);
    assert.equal(Object.keys(got.memory.entries).length,4);
    assert.equal(Object.keys(got.nexus.entries).length,9,
        'old Nexus 1 + imported 6 + new Core 1 + Current 1');
    assert.equal(got.mapping.length,6);
    assert.deepEqual(got.nexus.stlo,nexus.stlo);
    assert.deepEqual(Object.values(got.memory.entries).filter(e=>e.constant).map(e=>e.uid).sort((a,b)=>a-b),[1,2,3]);
    assert.equal(got.memory.entries[0].vectorized,true);
    for(const old of Object.values(beforeMemory.entries).filter(e=>e.stmemorybooks===true)) {
        const next=Object.values(got.memory.entries).find(e=>e.uid===old.uid);
        assert.equal(next.content,old.content);
        assert.equal(next.comment,old.comment);
        assert.equal(next.STMB_start,old.STMB_start);
        assert.equal(next.STMB_end,old.STMB_end);
    }
    for(const uid of [56,57,58,59,60,61]) {
        const mapped=got.mapping.find(x=>x.originalUid===uid);
        assert.ok(mapped);
        const moved=Object.values(got.nexus.entries).find(e=>e.uid===mapped.newUid);
        assert.deepEqual(moved.STMB_slothImportedOriginal.original,beforeMemory.entries[uid],
            'exact source JSON must be recoverable including old UID and history');
        assert.equal(moved.comment,beforeMemory.entries[uid].comment);
        assert.equal(moved.content,beforeMemory.entries[uid].content);
        if([56,57,58].includes(uid)) assert.equal(moved.disable,true);
        else assert.equal(moved.disable,false);
    }
    const core=Object.values(got.nexus.entries).find(e=>e.comment==='Core Memory');
    const current=Object.values(got.nexus.entries).find(e=>e.comment==='Current Continuity');
    assert.equal(core.content,beforeMemory.entries[58].content);
    assert.ok(current.content.includes(beforeMemory.entries[56].content));
    assert.ok(current.content.includes(beforeMemory.entries[57].content));
    assert.equal(Object.values(got.nexus.entries).find(e=>e.comment==='kinks').outletName,'kinks');
    assert.equal(Object.values(got.nexus.entries).find(e=>e.comment==='NPC Index (STMB SidePrompt)').position,0);
});

test('already dedicated Memory with Scenes only has no split operation',()=>{
    const {memory,nexus}=fixture();
    for(const k of ['56','57','58','59','60','61'])delete memory.entries[k];
    assert.equal(inspectUnifiedMemorySplit(memory,nexus).required,false);
    assert.throws(()=>stageUnifiedMemorySplit({memory,nexus,createNexusEntry:creator}),/already Scene-only/);
});

test('duplicate destination titles, STLO references and memory cross-references block without changes',()=>{
    const cases=[
        ({nexus})=>{nexus.entries[400]=entry(400,'kinks','conflicting Outlet');},
        ({memory})=>{memory.stlo={ordering:{59:'depends'}};},
        ({memory})=>{memory.entries[59].stmbSourceEntryUids=[1];},
        ({memory})=>{memory.entries[59].group='shared-across-book';},
        ({memory})=>{memory.entries[0].disabledBySummaryId=3;},
        ({memory})=>{memory.entries[2].content='**Scene**\nUnfinished';},
        ({memory})=>{memory.entries[61].uid=60;},
    ];
    for(const mutate of cases){
        const data=fixture();mutate(data);
        const prev=structuredClone(data);
        assert.throws(()=>stageUnifiedMemorySplit({...data,createNexusEntry:creator}));
        assert.deepEqual(data,prev);
    }
});

test('keyword fallback blocks when old Scenes have no keywords, preserving all source bytes',()=>{
    const data=fixture(),before=structuredClone(data);
    assert.throws(()=>stageUnifiedMemorySplit({...data,createNexusEntry:creator,olderMode:'keyword'}),/keywords/);
    assert.deepEqual(data,before);
});

test('existing new Core Memory target cannot be overwritten by an old mixed book',()=>{
    const data=fixture(),prev=structuredClone(data);
    data.nexus.entries[99]=entry(99,'Core Memory','Current distinct truth');
    assert.throws(()=>stageUnifiedMemorySplit({...data,createNexusEntry:creator}),/manual reconciliation/);
    assert.deepEqual(data.memory,prev.memory);
});
