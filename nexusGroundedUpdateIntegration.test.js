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
test('Nexus-only collection stages the changed book and leaves Memory and Hide alone',()=>{
    const code=readFileSync(new URL('./nexusCollectorRuntime.js',import.meta.url),'utf8');
    const collector=code.slice(code.indexOf('export async function runNexusCollector'),code.indexOf('function isVisibleSceneMessage'));
    assert.match(collector,/if\(scenes.length\|\|initial\) \{[\s\S]*stageMemoryScenes/);
    assert.match(collector,/if\(edits.length\|\|initial\) \{[\s\S]*stageNexusEdits/);
    assert.match(collector,/if\(scenes.length\)\{\s*try \{\s*await updateCollectedLedger/);
    assert.match(collector,/states.length===1\?await commitSlothNexusMigration/);
    assert.match(collector,/operation:scenes.length\?'Memory Scene save':'Nexus current-state update'/);
    assert.match(code,/const checkbox = popup\.dlg\.querySelector\('#stmb-sloth-plan-hide'\)/);
    assert.match(code,/if \(checkbox\)[\s\S]*checkbox\.checked \? getSlothHideRanges/);
    const prompt=readFileSync(new URL('./nexusCollectionAI.js',import.meta.url),'utf8');
    assert.match(prompt,/canonicalizeNewNexusTitles\(response.edits\)[\s\S]*validateGroundedNexusEdits\(candidates.filter\(/);
    assert.match(prompt,/Deferred source is still visible/);
});
test('unverified Nexus changes stop the approved collection before saving books',()=>{
    const runtime=readFileSync(new URL('./nexusCollectorRuntime.js',import.meta.url),'utf8');
    assert.match(runtime,/await composeApprovedSlothCollection[\s\S]*if\(!\(error instanceof InvalidSlothNexusProposal\)\)throw error;\s*throw new Error\(t\([^\n]*\n\s*'STMemoryBooks_SlothCollectionInvalidNexus'/);
    assert.match(runtime,/commitSlothBooks/);
});
