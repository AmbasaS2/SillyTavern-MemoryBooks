// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    inspectNexusLegacyMigration, stageNexusLegacyMigration,
    classifyNexusLegacyTitle, guardArchivedNexusSidePromptWrite,
} from './nexusLegacyMigration.js';

const makeEntry=(uid,comment,content,extra={})=>({
    uid,comment,content,disable:false,constant:true,vectorized:false,
    selective:true,position:1,order:6500,depth:4,outletName:'',
    key:[],displayIndex:uid,extension:{keep:'original'},...extra,
});
const book=()=>({stlo:{mode:'custom',priority:19},entries:{
    40:makeEntry(40,'kinks','Never touch Outlet',{position:7,outletName:'kinks'}),
    41:makeEntry(41,'PanelAssets','Never touch media',{position:7,outletName:'PanelAssets'}),
    115:makeEntry(115,'Long-Term Memory (Always-On Story Memory)',
        '=== LONG-TERM MEMORY — Remus ===\nOne irrevocable bond.\n*Exact quote*',
        {STMB_sidePromptRegeneration:{version:1,templateKey:'long-term-memory',priorContent:'historical'}}),
    116:makeEntry(116,'Scene Continuity (Story State)',
        '### Incomplete promise\n- Person A knows; Person B does not.',
        {STMB_sidePromptRegeneration:{version:1,templateKey:'scene-continuity'}}),
    117:makeEntry(117,'Status','Recent injury is not yet confirmed healed.',
        {STMB_sidePromptHistory:{version:1,templateKey:'status'}}),
    118:makeEntry(118,'LT 01 | Origins','Unchanged vector recall',
        {constant:false,vectorized:true,order:30}),
    119:makeEntry(119,'NPC 01 | Sirius','Unchanged NPC',
        {constant:false,vectorized:true,order:25}),
}});
function createEntry(data) {
    const uid=Math.max(-1,...Object.keys(data.entries).map(Number))+1;
    const entry={uid,position:0,disable:false,order:100};
    data.entries[uid]=entry;return entry;
}

test('recognizes actual legacy Core title with a parenthesized suffix, not unrelated LT or NPC titles',()=>{
    assert.equal(classifyNexusLegacyTitle('Long-Term Memory (Always-On Story Memory)'),'core');
    assert.equal(classifyNexusLegacyTitle('Scene Continuity'),'continuity');
    assert.equal(classifyNexusLegacyTitle('Status'),'status');
    assert.equal(classifyNexusLegacyTitle('LT 01 | Origins'),'');
    assert.equal(classifyNexusLegacyTitle('NPC 01 | Sirius'),'');
    assert.equal(classifyNexusLegacyTitle('Status tracker for NPC'),'');
});

test('lossless staging preserves original entry bodies, historic Side Prompt metadata and STLO while deactivating legacy injection',()=>{
    const original=book(),before=structuredClone(original);
    const {staged,plan,changes}=stageNexusLegacyMigration(original,createEntry);
    assert.equal(plan.required,true);
    assert.equal(plan.sourceUids.length,3);
    assert.equal(changes.filter(x=>x.action==='create').length,2);
    assert.equal(changes.filter(x=>x.action==='archive').length,3);
    assert.deepEqual(original,before);
    assert.deepEqual(staged.stlo,before.stlo);
    for (const uid of [40,41,118,119]) assert.deepEqual(staged.entries[uid],before.entries[uid]);
    const core=Object.values(staged.entries).find(e=>e.comment==='Core Memory');
    const current=Object.values(staged.entries).find(e=>e.comment==='Current Continuity');
    assert.equal(core.content,before.entries[115].content);
    assert.equal(core.position,1);
    assert.equal(core.order,6500);
    assert.equal(core.disable,false);
    assert.equal(core.constant,true);
    assert.equal(core.vectorized,false);
    assert.deepEqual(core.STMB_slothLegacySources,[115]);
    for(const uid of [115,116,117]){
        const previous=before.entries[uid],after=staged.entries[uid];
        const clean=structuredClone(after);
        delete clean.STMB_slothLegacyArchive;
        clean.disable=previous.disable;
        assert.deepEqual(clean,previous,'all previous entry metadata must survive, UID '+uid);
        assert.equal(after.disable,true);
        assert.equal(after.STMB_slothLegacyArchive.targetUid,
            uid===115?core.uid:current.uid);
    }
    assert.ok(current.content.includes(before.entries[116].content));
    assert.ok(current.content.includes(before.entries[117].content));
    assert.ok(current.content.indexOf(before.entries[116].content) <
        current.content.indexOf(before.entries[117].content));
    assert.deepEqual(current.STMB_slothLegacySources,[116,117]);
});

test('migration is idempotent and never creates duplicate Core or Current entries',()=>{
    const {staged}=stageNexusLegacyMigration(book(),createEntry);
    const result=stageNexusLegacyMigration(staged,createEntry);
    assert.equal(result.alreadyCurrent,true);
    assert.equal(result.changes.length,0);
    assert.deepEqual(result.staged,staged);
});

test('only old Long-Term Memory produces a Core, no invented current state or invented NPC',()=>{
    const data=book();
    delete data.entries[116];delete data.entries[117];
    const {staged,changes}=stageNexusLegacyMigration(data,createEntry);
    assert.deepEqual(changes.filter(x=>x.action==='create').map(x=>x.title),['Core Memory']);
    assert.equal(Object.values(staged.entries).some(e=>e.comment==='Current Continuity'),false);
    assert.equal(Object.values(staged.entries).filter(e=>e.comment.startsWith('NPC ')).length,1);
});

test('explicit selection can migrate custom titles and protects the previous Side Prompt destination',()=>{
    const data=book();
    data.entries[115].comment='My character notes';
    data.entries[116].comment='Previously on this story';
    delete data.entries[117];
    const {staged,changes}=stageNexusLegacyMigration(data,createEntry,{core:115,continuity:116});
    assert.deepEqual(changes.filter(x=>x.action==='create').map(x=>x.title),['Core Memory','Current Continuity']);
    assert.equal(data.entries[115].disable,false);
    assert.equal(staged.entries[115].disable,true);
    assert.equal(staged.entries[115].STMB_slothLegacyArchive.explicitRole,true);
    assert.equal(inspectNexusLegacyMigration(staged).required,false);
    assert.throws(()=>guardArchivedNexusSidePromptWrite(staged,'My character notes'),/archived/);
    assert.throws(()=>stageNexusLegacyMigration(data,createEntry,{core:115,continuity:115}),/different/);
    assert.throws(()=>stageNexusLegacyMigration(data,createEntry,{core:40}),/eligible/);
});

test('ambiguous, conflicting, disabled, Outlet and invalid sources fail before mutation',()=>{
    const cases=[
        data=>{data.entries[190]=makeEntry(190,'Long-Term Memory','duplicate');},
        data=>{data.entries[190]=makeEntry(190,'Core Memory','already exists');},
        data=>{data.entries[190]=makeEntry(190,'Current Continuity','already exists');},
        data=>{data.entries[115].disable=true;},
        data=>{data.entries[115].outletName='special';},
        data=>{data.entries[117].content=' ';},
        data=>{data.entries[117].uid=115;},
    ];
    for(const bad of cases) {
        const data=book();bad(data);
        const unchanged=structuredClone(data);
        assert.throws(()=>stageNexusLegacyMigration(data,createEntry));
        assert.deepEqual(data,unchanged,'conflicting input must not mutate');
    }
});

test('archived legacy template cannot recreate source or overwrite historical version',()=>{
    const {staged}=stageNexusLegacyMigration(book(),createEntry);
    assert.throws(()=>guardArchivedNexusSidePromptWrite(staged,
        'Long-Term Memory (Always-On Story Memory)'),/archived/);
    assert.throws(()=>guardArchivedNexusSidePromptWrite(staged,
        'random title','Status'),/archived/);
    assert.throws(()=>guardArchivedNexusSidePromptWrite(staged,
        'random title','Scene Continuity'),/archived/);
    assert.doesNotThrow(()=>guardArchivedNexusSidePromptWrite(staged,'NPC 01 | Sirius'));
    assert.doesNotThrow(()=>guardArchivedNexusSidePromptWrite(book(),'Status'));
});

test('failed createEntry or tampering cannot modify actual World Info source',()=>{
    const original=book(),before=structuredClone(original);
    assert.throws(()=>stageNexusLegacyMigration(original,()=>null),/invalid UID/);
    assert.deepEqual(original,before);
});

test('archived legacy with missing destination cannot be mistaken for fully migrated',()=>{
    const {staged}=stageNexusLegacyMigration(book(),createEntry);
    const key=Object.keys(staged.entries).find(k=>staged.entries[k].comment==='Core Memory');
    delete staged.entries[key];
    assert.throws(()=>inspectNexusLegacyMigration(staged),/inconsistent migration target/);
});
