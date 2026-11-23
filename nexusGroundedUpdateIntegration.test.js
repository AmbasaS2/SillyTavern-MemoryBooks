// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {validateGroundedNexusEdits} from './nexusEditEvidence.js';
import {stageNexusEdits} from './nexusCollectionPolicy.js';
import {commitSlothNexusMigration} from './nexusLegacyMigrationCommit.js';

const source=[
    {id:5,name:'A',mes:'I still cannot use my injured left arm.',is_user:false},
    {id:8,name:'B',mes:'I told A that the old promise is cancelled.',is_user:false},
];
const nexus=()=>({entries:{
    1:{uid:1,comment:'Core Memory',content:'A and B share a house.',constant:true,disable:false,position:0},
    2:{uid:2,comment:'Current Continuity',content:[
        '## Active Threads','The old promise remains unresolved.','','## Active Conditions',
        'A has an injured left arm.',
    ].join('\n'),constant:true,disable:false,position:0},
    3:{uid:3,comment:'NPC: C',content:'C remembers the old meeting.',disable:false,vectorized:true},
},stlo:{'doNotAlter':'preserved'}});
const mk=book=>{const uid=Object.values(book.entries).length+1;
    return book.entries[uid]={uid,comment:'',content:'',disable:false};};
const edits=[
    {kind:'continuity',action:'replace_exact',uid:2,
        find:'The old promise remains unresolved.',text:'B reported the promise was cancelled.',
        reason:'B explicitly reports that the old promise was cancelled.',
        supersession:'new_confirmed_information',
        evidence:[{messageId:8,quote:'I told A that the old promise is cancelled.'}]},
    {kind:'continuity',action:'append_section',uid:2,section:'Active Conditions',
        text:'A still cannot use the left arm.',
        reason:'A explicitly confirms a continuing physical limitation.',
        evidence:[{messageId:5,quote:'I still cannot use my injured left arm.'}]},
];

test('source-grounded unfinished incidents update Nexus alone, preserving legacy structures',async()=>{
    const original=nexus(),originalMemory={entries:{10:{uid:10,content:'untouched Scene'}}};
    const rawCopy=structuredClone(original);
    const accepted=validateGroundedNexusEdits(edits,source);
    const staged=stageNexusEdits(original,accepted,mk);
    assert.deepEqual(original,rawCopy);
    assert.match(staged.staged.entries[2].content,/B reported the promise/);
    assert.match(staged.staged.entries[2].content,/A still cannot use the left arm/);
    assert.deepEqual(staged.staged.entries[3],rawCopy.entries[3]);
    assert.deepEqual(staged.staged.stlo,rawCopy.stlo);
    let disk=structuredClone(original),writes=0;
    const result=await commitSlothNexusMigration({
        name:'Nexus',original,staged:staged.staged,
    },{
        operation:'Nexus current-state update',
        loadFresh:async()=>structuredClone(disk),
        save:async(_name,book)=>{writes++;disk=structuredClone(book);},
        withLock:async(_name,cb)=>cb(),verifyOrigin:()=>{},
    });
    assert.equal(result.success,true);assert.equal(writes,1);
    assert.deepEqual(disk,staged.staged);
    assert.deepEqual(originalMemory,{entries:{10:{uid:10,content:'untouched Scene'}}});
});
test('no-op and repeated append are blocked before any World Info write',()=>{
    const original=nexus();
    assert.throws(()=>stageNexusEdits(original,[{
        kind:'continuity',action:'append_section',uid:2,section:'Active Conditions',
        text:'A has an injured left arm.',
    }],mk),/already exists/);
    assert.throws(()=>stageNexusEdits(original,[{
        kind:'continuity',action:'replace_exact',uid:2,find:'A has an injured left arm.',
        text:'A has an injured left arm.',
    }],mk),/no change/);
    assert.deepEqual(original,nexus());
});
test('collector explicitly reviews Nexus-only updates without shifting Hide or Memory receipts',()=>{
    const code=readFileSync(new URL('./nexusCollectorRuntime.js',import.meta.url),'utf8');
    const start=code.indexOf('if(!initial&&!plan.events.length){');
    const end=code.indexOf('const approved=await planApproval(plan)',start);
    assert.ok(start>0 && end>start);
    const branch=code.slice(start,end);
    assert.match(branch,/planApproval\(plan\)[\s\S]*proposeSlothNexusEdits/);
    assert.match(branch,/scenes:\[\]/);
    assert.match(branch,/states:\[state\]/);
    assert.match(branch,/commitSlothNexusMigration\(state/);
    assert.match(branch,/operation:'Nexus current-state update'/);
    assert.doesNotMatch(branch,/stageMemoryScenes|commitSlothBooks|updateCollectedLedger|hideChat/);
    const prompt=readFileSync(new URL('./nexusCollectionAI.js',import.meta.url),'utf8');
    assert.match(prompt,/messages,plan,profile/);
    assert.match(prompt,/validateGroundedNexusEdits\(response.edits,messages\)/);
    assert.match(prompt,/Deferred source is still visible/);
});
test('review and backup include evidence, and supported UI translations have every new key',()=>{
    const runtime=readFileSync(new URL('./nexusCollectorRuntime.js',import.meta.url),'utf8');
    assert.match(runtime,/nexusEvidence:reviewedChanges\.map/);
    assert.match(runtime,/change\.evidence\|\|\[\]/);
    assert.match(runtime,/changes:nexus\.changes\.map/);
    for (const lang of ['de-de','es-es','fr-fr','id-id','ja-jp','ko-kr','ms-my',
        'pt-br','ru-ru','zh-cn','zh-tw']) {
        const data=JSON.parse(readFileSync(new URL('./locales/'+lang+'.json',import.meta.url),'utf8'));
        for(const key of ['SlothEvidenceWhy','SlothEvidenceSource',
            'SlothNexusOnlyReview','SlothNexusOnlyGuide','SlothNexusOnlySaved']) {
            assert.ok(data['STMemoryBooks_'+key]?.length,lang+':'+key);
        }
    }
});
