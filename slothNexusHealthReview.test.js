// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSlothHealthCatalog,buildSlothHealthReviewPrompt,validateSlothHealthReview,stageSlothHealthReviewChange} from './slothNexusHealthReview.js';

const para='Mara attended the autumn lantern festival.';
const rule='Mara retains the right to decide where to stay.';
const lt='The harbor festival was held near the old quay.';
const mk=()=>({entries:{
    1:{uid:1,comment:'Core Memory',constant:true,content:rule+'\n\n'+para},
    2:{uid:2,comment:'LT - Festivals',constant:false,vectorized:true,selective:true,key:['festival'],content:lt},
    3:{uid:3,comment:'Current Continuity',constant:true,content:'## Knowledge Boundaries\nOnly Mara knows the code.'},
    4:{uid:4,comment:'PanelAssets',position:7,content:'PROTECTED_SECRET'},
    5:{uid:5,comment:'LT - Archived',disable:true,content:'DISABLED_SECRET'},
    6:{uid:6,comment:'LT - Wrapper',content:'=== BEGIN ORIGINAL History ===\nARCHIVE_SECRET\n=== END ORIGINAL History ==='},
}});
const move=()=>({kind:'core_to_lt',reason:'The festival is durable episodic information, not a live rule.',refs:[{uid:1,quote:para},{uid:2,quote:lt}],change:{type:'move',sourceUid:1,paragraph:para,targetUid:2}});
test('on-demand catalog includes only eligible Nexus data and leaves input untouched',()=>{
    const book=mk(),before=JSON.stringify(book),c=buildSlothHealthCatalog(book);
    assert.deepEqual(c.entries.map(e=>e.uid),[1,2,3]);assert.equal(c.excluded,3);
    const p=buildSlothHealthReviewPrompt(c,'Korean');
    assert.match(p,/Write reasons in Korean/);assert.match(p,/Only Mara knows the code/);
    assert.doesNotMatch(p,/PROTECTED_SECRET|DISABLED_SECRET|ARCHIVE_SECRET/);
    assert.equal(JSON.stringify(book),before);
    assert.throws(()=>buildSlothHealthCatalog({entries:{...book.entries,other:{...book.entries[1]}}}),/duplicate UIDs/);
});
test('grounded suggestions survive independently; fabricated citations and unsupported operations do not',()=>{
    const catalog=buildSlothHealthCatalog(mk());
    const good=move(),bad={kind:'validity',reason:'Verify current status.',refs:[{uid:1,quote:'invented'}]};
    const advice={kind:'conflict',reason:'Check the claims; do not infer which is true.',refs:[{uid:1,quote:rule},{uid:3,quote:'Only Mara knows the code.'}],change:{type:'delete',uid:1}};
    const report=validateSlothHealthReview(catalog,{findings:[good,bad,advice,good]});
    assert.equal(report.findings.length,2);assert.equal(report.rejected,2);
    assert.equal(report.findings[1].change,null);assert.equal(report.findings[1].changeUnavailable,true);
    assert.throws(()=>stageSlothHealthReviewChange(mk(),report.findings[1]),/advice only/);
});
test('verbatim Core transfer preserves all unrelated bytes, target UID and recall configuration',()=>{
    const book=mk(),before=JSON.stringify(book);
    const {staged,changes}=stageSlothHealthReviewChange(book,move());
    assert.equal(JSON.stringify(book),before);
    assert.equal(staged.entries[1].content,rule);
    assert.equal(staged.entries[2].content,lt+'\n\n'+para);
    assert.deepEqual({...staged.entries[2],content:lt},book.entries[2]);
    assert.deepEqual(staged.entries[3],book.entries[3]);
    assert.deepEqual(changes.map(c=>c.uid),[2,1]);
    assert.equal(changes[1].before,rule+'\n\n'+para);
});
test('new LT transfer uses configured recall mode; no forced activation or empty Core',()=>{
    const book=mk(),finding=move();
    finding.refs=[finding.refs[0]];
    finding.change={type:'move',sourceUid:1,paragraph:para,newTitle:'LT - Lantern memories',keywords:['lantern festival']};
    const {staged,changes}=stageSlothHealthReviewChange(book,finding,{moduleSettings:{nexusRecallModes:{lt:'keyword'}}});
    const created=Object.values(staged.entries).find(e=>e.comment==='LT - Lantern memories');
    assert.equal(created.content,para);assert.equal(created.constant,false);
    assert.equal(created.vectorized,false);assert.deepEqual(created.key,['lantern festival']);
    assert.equal(changes[0].before,null);assert.equal(staged.entries[1].content,rule);
    assert.throws(()=>stageSlothHealthReviewChange(book,finding,{moduleSettings:{nexusRecallModes:{lt:'constant'}}}),/recall mode/);
    book.entries[1].content=para;
    assert.throws(()=>stageSlothHealthReviewChange(book,finding),/advice only/);
});
test('exact same-entry duplicate removes one copy, while semantic or cross-entry duplicate is advice',()=>{
    const book=mk();book.entries[2].content=lt+'\n\n'+lt+'\n\nOther detail.';
    const dup={kind:'duplicate',reason:'Literal repeated paragraph.',refs:[{uid:2,quote:lt}],change:{type:'dedupe',uid:2,paragraph:lt}};
    assert.equal(stageSlothHealthReviewChange(book,dup).staged.entries[2].content,lt+'\n\nOther detail.');
    book.entries[1].content=rule+'\n\n'+lt;
    const cross={...dup,refs:[{uid:1,quote:lt},{uid:2,quote:lt}],change:{type:'dedupe',uid:1,paragraph:lt}};
    const report=validateSlothHealthReview(buildSlothHealthCatalog(book),{findings:[cross]});
    assert.equal(report.findings[0].change,null);
    book.entries[2].content='## First\n'+lt+'\n\n'+lt;
    assert.throws(()=>stageSlothHealthReviewChange(book,dup),/advice only/);
});
test('protected, stale, ambiguous, constant or unquoted LT targets cannot be staged',()=>{
    const book=mk(),finding=move();
    book.entries[2].constant=true;
    assert.throws(()=>stageSlothHealthReviewChange(book,finding),/advice only/);
    book.entries[2].constant=false;book.entries[1].content=rule+'\n\n'+para+'\n\n'+para;
    assert.throws(()=>stageSlothHealthReviewChange(book,finding),/advice only/);
    book.entries[1].content=rule+'\n\nChanged paragraph.';
    assert.throws(()=>stageSlothHealthReviewChange(book,finding),/citation/);
    assert.throws(()=>validateSlothHealthReview(buildSlothHealthCatalog(book),{findings:Array(25).fill(finding)}),/oversized/);
});
