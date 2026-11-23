// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {stageNexusLegacyMigration} from './nexusLegacyMigration.js';
import {inspectSlothLegacyContinuity,validateSlothLegacyContinuityProposal,
    stageSlothLegacyContinuity} from './nexusLegacySemantic.js';
import {stageNexusEdits} from './nexusCollectionPolicy.js';

const entry=(uid,comment,content,extra={})=>({
    uid,comment,content,position:0,constant:true,vectorized:false,
    selective:true,disable:false,key:[],...extra,
});
const base=()=>({entries:{
    8:entry(8,'Long-Term Memory','The relationship is complicated.'),
    9:entry(9,'Scene Continuity','A still awaits a response to the letter.'),
    10:entry(10,'Status','A has an injured left arm.'),
    11:entry(11,'NPC: Mara','Mara enjoys sharp jokes.',{constant:false,vectorized:true}),
    12:entry(12,'Kinks','Do not change Outlet.',{position:7,outletName:'special'}),
},stlo:{userOrder:[8,9,10,11,12]}});
const maker=book=>{const uid=Math.max(...Object.values(book.entries).map(e=>e.uid))+1;
    return book.entries[uid]={uid,comment:'',content:'',disable:false};};
const messages=[
    {id:0,name:'A',mes:'I got the reply to the letter today. We have settled the issue.'},
    {id:1,name:'A',mes:'My injured left arm still hurts and limits what I can do.'},
];
const suggestion={current:[{
    section:'Active Conditions',text:'A still has pain that limits the injured left arm.',
    reason:'The more recent direct statement confirms the injury remains limiting.',
    archive:{uid:10,quote:'A has an injured left arm.'},
    chat:{messageId:1,quote:'My injured left arm still hurts and limits what I can do.'},
}],notCurrent:[{
    status:'resolved',reason:'A explicitly reports the expected reply was received.',
    archive:{uid:9,quote:'A still awaits a response to the letter.'},
    chat:{messageId:0,quote:'I got the reply to the letter today. We have settled the issue.'},
}]};
const migrated=()=>stageNexusLegacyMigration(base(),maker).staged;

test('inspects exact untouched legacy archives and links to disabled source entries',()=>{
    const source=migrated(),before=structuredClone(source);
    const plan=inspectSlothLegacyContinuity(source);
    assert.equal(plan.required,true);
    assert.deepEqual(plan.sourceUids,[9,10]);
    assert.match(plan.originalContent,/=== BEGIN ORIGINAL Status/);
    assert.deepEqual(source,before);
});
test('proposal replaces only active Continuity with currently corroborated facts',()=>{
    const book=migrated(),before=structuredClone(book);
    const plan=inspectSlothLegacyContinuity(book);
    const accepted=validateSlothLegacyContinuityProposal(plan,suggestion,messages);
    const {staged,next}=stageSlothLegacyContinuity(book,accepted,{chatKey:'A.png:chat-1',messages});
    const current=Object.values(staged.entries).find(e=>e.comment==='Current Continuity');
    assert.equal(current.content,next);
    assert.equal(current.content,'## Active Conditions\nA still has pain that limits the injured left arm.');
    assert.equal(current.STMB_slothContinuityReconciliation.originalContent,plan.originalContent);
    assert.deepEqual(current.STMB_slothContinuityReconciliation.sourceUids,[9,10]);
    for(const uid of [8,9,10,11,12])assert.deepEqual(staged.entries[uid],book.entries[uid]);
    assert.deepEqual(staged.stlo,before.stlo);
    assert.deepEqual(book,before);
    assert.equal(inspectSlothLegacyContinuity(staged).required,false);
    assert.doesNotThrow(()=>stageNexusEdits(staged,[{
        kind:'continuity',action:'append_section',uid:current.uid,
        section:'Active Threads',text:'Another issue is still unresolved.',
    }],maker));
});
test('missing, invented or abbreviated quotes block semantic migration',()=>{
    const plan=inspectSlothLegacyContinuity(migrated());
    for(const mutation of [
        s=>{s.current[0].chat.quote='not spoken by A';},
        s=>{s.current[0].archive.quote='A was never hurt';},
        s=>{s.current[0].chat.messageId=99;},
        s=>{s.notCurrent[0].archive.uid=100;},
        s=>{s.notCurrent[0].status='current';},
        s=>{s.current[0].text='False\n## New Section';},
        s=>{s.current[0].text='Nothing';},
    ]){const bad=structuredClone(suggestion);mutation(bad);
        assert.throws(()=>validateSlothLegacyContinuityProposal(plan,bad,messages));
    }
});
test('uncertain historic status cannot become active without CURRENT message evidence',()=>{
    const plan=inspectSlothLegacyContinuity(migrated());
    const bad=structuredClone(suggestion);
    bad.current[0].chat=null;
    assert.throws(()=>validateSlothLegacyContinuityProposal(plan,bad,messages),/current-chat/);
    bad.current=[];bad.notCurrent.push({status:'unverified',
        reason:'Nothing in this chat proves the old injury continues.',
        archive:{uid:10,quote:'A has an injured left arm.'}});
    const undecided=validateSlothLegacyContinuityProposal(plan,bad,messages);
    assert.deepEqual(undecided.current,[]);
    assert.throws(()=>stageSlothLegacyContinuity(migrated(),undecided,{
        chatKey:'A.png:chat-1',messages,
    }),/Verified proposal/);
});
test('any existing manual edits, broken archives and prior review block destructive rewrite',()=>{
    const book=migrated();
    book.entries[14].content+='\n## Active Threads\nAnother issue.';
    assert.throws(()=>inspectSlothLegacyContinuity(book),/independent edits/);
    const lost=migrated();delete lost.entries[9];
    assert.throws(()=>inspectSlothLegacyContinuity(lost),/archive|missing/);
    const broken=migrated();broken.entries[10].content='wrong original';
    assert.throws(()=>inspectSlothLegacyContinuity(broken),/modified|non-verbatim|independent/);
    const done=migrated();
    const accepted=validateSlothLegacyContinuityProposal(inspectSlothLegacyContinuity(done),suggestion,messages);
    const staged=stageSlothLegacyContinuity(done,accepted,{chatKey:'A.png:chat-1',messages}).staged;
    assert.equal(inspectSlothLegacyContinuity(staged).required,false);
    assert.throws(()=>stageSlothLegacyContinuity(staged,accepted,{chatKey:'A.png:chat-1',messages}),/Verified proposal/);
    const badReceipt=structuredClone(staged);
    badReceipt.entries[14].STMB_slothContinuityReconciliation.version=99;
    assert.throws(()=>inspectSlothLegacyContinuity(badReceipt),/modified/);
    const badHistory=structuredClone(staged);
    badHistory.entries[10].content='Tampered history.';
    assert.throws(()=>inspectSlothLegacyContinuity(badHistory),/modified/);
});
test('pre-migration and independent non-legacy Continuity are not silently converted',()=>{
    assert.deepEqual(inspectSlothLegacyContinuity(base()),{required:false,reason:'needs-migration'});
    const empty={entries:{1:entry(1,'Current Continuity','## Active Threads\nManual state.')}};
    assert.equal(inspectSlothLegacyContinuity(empty).required,false);
});
