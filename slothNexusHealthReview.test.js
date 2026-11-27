import {slothDisplayAnchorTitle} from './nexusCollectionPolicy.js';
// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {buildSlothHealthCatalog,buildSlothHealthReviewPrompt,validateSlothHealthReview,stageSlothHealthReviewChange,stageSlothHealthReviewBatch} from './slothNexusHealthReview.js';

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
    book.entries[2].content='## First\n\n'+lt+'\n\n'+lt;
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

test('one approval can combine independent exact moves without losing other Core paragraphs',()=>{
    const book=mk(),second='Mara bought a ceramic bowl at the market.';
    book.entries[1].content+='\n\n'+second;
    const first=move(),other={kind:'core_to_lt',reason:'Historical purchase.',refs:[{uid:1,quote:second}],
        change:{type:'move',sourceUid:1,paragraph:second,newTitle:'LT - Market purchase',keywords:['ceramic bowl']}};
    const result=stageSlothHealthReviewBatch(book,[first,other]);
    assert.equal(result.staged.entries[1].content,rule);
    assert.equal(result.staged.entries[2].content,lt+'\n\n'+para);
    assert.equal(Object.values(result.staged.entries).find(e=>e.comment==='LT - Market purchase').content,second);
    assert.equal(result.changes.filter(c=>c.uid===1).length,1);
    assert.equal(result.changes.find(c=>c.uid===1).before,book.entries[1].content);
    assert.throws(()=>stageSlothHealthReviewBatch(book,[first,first]),/Repeated selected/);
    const conflicting={...other,refs:[{uid:1,quote:para}],change:{...other.change,paragraph:para}};
    const before=JSON.stringify(book);
    assert.throws(()=>stageSlothHealthReviewBatch(book,[first,conflicting]),/citation/);
    assert.equal(JSON.stringify(book),before);
});

const source=readFileSync(new URL('./nexusCollectorRuntime.js',import.meta.url),'utf8');
const ai=readFileSync(new URL('./nexusCollectionAI.js',import.meta.url),'utf8');
const readSlice=(src,a,b)=>{const start=src.indexOf(a),end=src.indexOf(b,start+1);assert.ok(start>=0&&end>start);return src.slice(start,end);};
function host({consent=true,approve=true,pending=false,latePending=false,stale=false,changeRole=false}={}){
    let book=mk(),busy=false,requests=0,reads=0,recoveryReads=0,writes=0,previews=0;
    const original=JSON.stringify(book),ref={type:'character',avatarUrl:'a.png',fileName:'chat-a'};
    const run=vm.runInNewContext(readSlice(source,'export async function runSlothNexusHealthReview(','async function settleSlothAutoAttempt(').replace('export async','async')+'\nrunSlothNexusHealthReview',{
        collectorBusy:busy,structuredClone,stringify:JSON.stringify,html:String,t:s=>s,healthReviewLabel:(_k,s)=>s,
        extension_settings:{STMemoryBooks:{moduleSettings:{},profiles:[{}]}},getCurrentStmbChatRef:()=>ref,
        getNexusRoleResolutionForChatRef:kind=>({name:kind}),getMemoryBooksMode:()=> 'sloth',getStmbChatKey:()=> 'a',
        assertSlothBookRoles:()=>{if(changeRole&&requests)throw Error('roles changed');},assertSideRenameReady:()=>{},
        collectionProfile:()=>({}),getNexusRecallModes:()=>({lt:'vector'}),Popup:function(){},markStmbPopup:p=>p,
        POPUP_TYPE:{CONFIRM:1},POPUP_RESULT:{AFFIRMATIVE:1},showCollectionPopup:async()=>consent?1:0,
        refreshSlothPaidDraft:async()=>{recoveryReads++;return pending||latePending&&recoveryReads>1?{}:null;},
        loadServerWorld:async()=>{reads++;return structuredClone(book);},assertReviewedCache:()=>{},
        buildSlothHealthCatalog,stageSlothHealthReviewBatch,
        suggestSlothNexusHealthReview:async({catalog})=>{
            requests++;
            if(stale)book.entries[1].content+=' External edit.';
            return validateSlothHealthReview(catalog,{findings:[move()]});
        },
        showSlothHealthReviewFindings:async({review,original,moduleSettings})=>{
            previews++;if(!approve)return null;
            const findings=review.findings;
            return {findings,changes:stageSlothHealthReviewBatch(original,findings,{moduleSettings}).changes};
        },
        createWorldInfoEntry:(_name,b)=>{let n=0;while(Object.hasOwn(b.entries,n))n++;return b.entries[n]={uid:n};},
        commitSlothNexusMigration:async(state,opts)=>{
            opts.verifyOrigin();assert.deepEqual(state.original,book);book=structuredClone(state.staged);writes++;
        },
        saveWorldInfo:()=>{},worldInfoCache:new Map(),withStmbWriteLane:async(_key,task)=>task(),reloadEditor:()=>{},
        toastr:{success(){},info(){}},console,
    });
    return {run,stats:()=>({requests,reads,recoveryReads,writes,previews}),book:()=>book,original};
}
test('health runtime never generates before consent and never writes before explicit review approval',async()=>{
    let h=host({consent:false});assert.equal((await h.run()).saved,false);assert.equal(h.stats().requests,0);assert.equal(h.stats().reads,0);
    h=host({approve:false});assert.equal((await h.run()).saved,false);assert.equal(h.stats().requests,1);assert.equal(h.stats().writes,0);
    assert.equal(JSON.stringify(h.book()),h.original);
});
test('health runtime preserves pending recovery, refuses stale roles or snapshot and applies one approved transaction',async()=>{
    let h=host({pending:true});await assert.rejects(h.run(),/pending collection recovery/);assert.equal(h.stats().requests,0);
    h=host({latePending:true});await assert.rejects(h.run(),/pending collection recovery/);assert.equal(h.stats().writes,0);
    h=host({stale:true});await assert.rejects(h.run(),/Nexus changed/);assert.equal(h.stats().previews,0);assert.equal(h.stats().writes,0);
    h=host({changeRole:true});await assert.rejects(h.run(),/roles changed/);assert.equal(h.stats().writes,0);
    h=host();assert.equal((await h.run()).saved,true);assert.equal(h.stats().requests,1);assert.equal(h.stats().writes,1);
    assert.equal(h.book().entries[1].content,rule);
});
test('health analysis uses exactly one guarded request; opening the original health panel is still read-only',async()=>{
    const start=ai.indexOf('export async function suggestSlothNexusHealthReview(');assert.ok(start>=0);
    const segment=ai.slice(start).replace('export async','async');
    let calls=0;
    const analyze=vm.runInNewContext(segment+'\nsuggestSlothNexusHealthReview',{
        buildSlothHealthReviewPrompt,validateSlothHealthReview,
        requester:(_p,_s,_sig,singleAttempt,_usage,verifyOrigin)=>{
            assert.equal(singleAttempt,true);
            return async(prompt,phase)=>{calls++;verifyOrigin();assert.equal(phase,'Nexus health review');assert.doesNotMatch(prompt,/PROTECTED_SECRET/);return {findings:[move()]};};
        }
    });
    const result=await analyze({catalog:buildSlothHealthCatalog(mk()),verifyOrigin:()=>{}});
    assert.equal(calls,1);assert.equal(result.findings.length,1);
    assert.match(ai,/\['Single collection','Summary review','Nexus health review'\]\.includes\(phase\)/);
    const ordinary=readSlice(source,'export async function showSlothNexusHealth(','export async function applySlothNexusRecallSettings(');
    assert.doesNotMatch(ordinary,/suggestSlothNexusHealthReview|commitSlothNexusMigration|requestCompletion/);
    const dialog=readFileSync(new URL('./slothNexusHealthReviewDialog.js',import.meta.url),'utf8');
    assert.match(dialog,/onClosing:.*Boolean\(approved\)/);assert.match(dialog,/stageSlothHealthReviewBatch/);
    assert.doesNotMatch(dialog,/requestCompletion|saveWorldInfo|MutationObserver|setInterval|requestAnimationFrame/);
});

test('numbered paragraph references resolve original labels without model copying',()=>{
    const book=mk(),labeled='[Past visit] '+para;
    book.entries[1].content=rule+'\n\n'+labeled;
    const finding={kind:'core_to_lt',reason:'The past visit is historical.',refs:[{uid:1,paragraphId:2},{uid:2,paragraphId:1}],
        change:{type:'move',sourceUid:1,paragraphId:2,targetUid:2}};
    const catalog=buildSlothHealthCatalog(book);
    const prompt=buildSlothHealthReviewPrompt(catalog);
    assert.match(prompt,/"paragraphId":2/);
    assert.equal(prompt.split(labeled).length,2);
    const review=validateSlothHealthReview(catalog,{findings:[finding]});
    assert.equal(review.findings.length,1);
    assert.equal(review.findings[0].change.paragraph,labeled);
    assert.equal(review.findings[0].refs[0].quote,labeled);
    const {staged}=stageSlothHealthReviewBatch(book,review.findings);
    assert.equal(staged.entries[1].content,rule);
    assert.equal(staged.entries[2].content,lt+'\n\n'+labeled);
    assert.equal(validateSlothHealthReview(catalog,{findings:[{...finding,refs:[{uid:1,paragraphId:999}]}]}).rejected,1);
    assert.equal(validateSlothHealthReview(catalog,{findings:[{...finding,change:{...finding.change,paragraphId:999}}]}).findings[0].change,null);
    assert.equal(validateSlothHealthReview(catalog,{findings:[{...finding,refs:[{uid:1,paragraphId:2,quote:para}]}]}).rejected,1);
});
test('numbered exact duplicates remain eligible; Core operational rules stay advice only',()=>{
    const book=mk(),secret='Only Mara knows the hidden code.';
    book.entries[1].content=rule+'\n\n'+secret+'\n\n'+para;
    book.entries[2].content=lt+'\n\n'+lt+'\n\nOther detail.';
    const findings=[
        {kind:'core_to_lt',reason:'Unsafe suggestion to move a secret.',refs:[{uid:1,paragraphId:2},{uid:2,paragraphId:1}],
            change:{type:'move',sourceUid:1,paragraphId:2,targetUid:2}},
        {kind:'duplicate',reason:'An exact duplicate.',refs:[{uid:2,paragraphId:1},{uid:2,paragraphId:2}],
            change:{type:'dedupe',uid:2,paragraphId:2}},
    ];
    const report=validateSlothHealthReview(buildSlothHealthCatalog(book),{findings});
    assert.equal(report.findings.length,2);
    assert.equal(report.findings[0].change,null);
    assert.equal(report.findings[0].changeUnavailable,true);
    assert.throws(()=>stageSlothHealthReviewChange(book,report.findings[0]),/advice only/);
    assert.equal(stageSlothHealthReviewChange(book,report.findings[1]).staged.entries[2].content,lt+'\n\nOther detail.');
});
test('health preview displays complete change text only in combined approval and requires Core acknowledgement',()=>{
    const dialog=readFileSync(new URL('./slothNexusHealthReviewDialog.js',import.meta.url),'utf8');
    assert.equal((dialog.match(/changes\.map\(renderChange\)/g)||[]).length,1);
    assert.match(dialog,/data-health-core-ack/);
    assert.match(dialog,/tr\('CoreAck','I understand moved memories may not be recalled on every turn\.'\)/);
    const ko=JSON.parse(readFileSync(new URL('./locales/ko-kr.json',import.meta.url),'utf8'));
    assert.equal(ko.STMemoryBooks_SlothHealthReviewCoreAck,'앵커로 옮긴 기억이 일부 대화에서 주입되지 않을 수 있음을 확인했습니다.');
    assert.match(dialog,/if\(!moves\)approved=prepared/);
    assert.match(dialog,/approved=confirmed\?prepared:null/);
    assert.match(dialog,/class="stmb-workshop-preview"><summary>/);
    assert.doesNotMatch(dialog,/<pre>/);
    assert.match(dialog,/confirmed=false/);
    assert.match(dialog,/change\.paragraph/);
});

 test('workshop displays both historical and new Anchor names without changing persisted titles',()=>{
    const dialog=readFileSync(new URL('./slothNexusHealthReviewDialog.js',import.meta.url),'utf8');
    const start=dialog.indexOf('function displayTitle('),end=dialog.indexOf('function renderChange(',start);
    const display=vm.runInNewContext(dialog.slice(start,end)+'\ndisplayTitle',{tr:(_key,fallback)=>fallback,slothDisplayAnchorTitle});
    assert.equal(display('LT - Lamp repairs'),'Anchor - Lamp repairs');
    assert.equal(display('LT 02 | Lamp repairs'),'Anchor 02 | Lamp repairs');
    assert.equal(display('Anchor - Lamp repairs'),'Anchor - Lamp repairs');
    assert.equal(display('Core Memory'),'Core Memory');
    assert.equal(display('SALT - Food'),'SALT - Food');
    assert.equal(display('LT notes'),'LT notes');
    assert.match(dialog,/displayTitle\(change\.title\)/);
 });

test('Memory Workshop supports new Anchor titles without rewriting legacy names',()=>{
    const book=mk();
    const finding=move();
    finding.refs=[finding.refs[0]];
    finding.change={type:'move',sourceUid:1,paragraph:para,newTitle:'Anchor - Lantern memories',keywords:['lantern']};
    const result=stageSlothHealthReviewChange(book,finding,{moduleSettings:{nexusRecallModes:{lt:'keyword'}}});
    const created=Object.values(result.staged.entries).find(e=>e.comment==='Anchor - Lantern memories');
    assert.equal(created.content,para);
    assert.equal(created.STMB_slothNexusKind,'lt');
    assert.equal(result.staged.entries[2].comment,'LT - Festivals');
    const prompt=buildSlothHealthReviewPrompt(buildSlothHealthCatalog(book));
    assert.match(prompt,/"newTitle":"Anchor - distinct topic"/);
});
