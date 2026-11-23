// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stageNexusLegacyMigration} from './nexusLegacyMigration.js';
import {inspectSlothLegacyContinuity,validateSlothLegacyContinuityProposal,
    stageSlothLegacyContinuity} from './nexusLegacySemantic.js';
import {commitSlothNexusMigration} from './nexusLegacyMigrationCommit.js';
const file = name => readFileSync(new URL(name,import.meta.url),'utf8');
const make=(uid,comment,content)=>({uid,comment,content,disable:false,
    position:0,constant:true,vectorized:false});
const original=()=>({entries:{
    1:make(1,'Scene Continuity','B has not told A the secret yet.'),
    2:make(2,'Status','A still suffers from a sore ankle.'),
    3:make(3,'NPC: B','B makes biting jokes.'),
},stlo:{rootMarker:'keep'}});
const maker=book=>{const uid=Math.max(...Object.values(book.entries).map(e=>e.uid))+1;
    return book.entries[uid]={uid,content:'',comment:'',disable:false};};
const chat=[{id:12,name:'B',mes:'I finally told A the secret directly.'},
    {id:20,name:'A',mes:'My ankle still hurts when I walk.'}];
const raw={current:[{section:'Active Conditions',
    text:'A reports ankle pain while walking.',
    reason:'A directly confirms that the old injury remains painful.',
    archive:{uid:2,quote:'A still suffers from a sore ankle.'},
    chat:{messageId:20,quote:'My ankle still hurts when I walk.'}}],
    notCurrent:[{status:'superseded',
    reason:'B explicitly informed A, so the old secrecy no longer applies.',
    archive:{uid:1,quote:'B has not told A the secret yet.'},
    chat:{messageId:12,quote:'I finally told A the secret directly.'}}]};
function harness(){
    const before=stageNexusLegacyMigration(original(),maker).staged;
    const verified=validateSlothLegacyContinuityProposal(
        inspectSlothLegacyContinuity(before),raw,chat);
    const after=stageSlothLegacyContinuity(before,verified,{
        chatKey:'char-b:chat-1',messages:chat}).staged;
    const state={name:'Nexus',original:before,staged:after};
    let disk=structuredClone(before),wrote=0,check=0;
    const deps={
        loadFresh:async()=>structuredClone(disk),
        save:async(_name,value)=>{wrote++;disk=structuredClone(value);},
        withLock:async(_name,fn)=>fn(),verifyOrigin:()=>{check++;},
        resetCache:async()=>{},operation:'Nexus continuity semantic reconciliation',
    };
    return {state,deps,get disk(){return disk;},set disk(v){disk=structuredClone(v);},
        get wrote(){return wrote;},get checks(){return check;}};
}
test('reviewed semantic update persists exactly one Nexus book, not other lore',async()=>{
    const h=harness();
    const result=await commitSlothNexusMigration(h.state,h.deps);
    assert.equal(result.success,true);assert.equal(h.wrote,1);
    assert.ok(h.checks>0);
    assert.equal(h.disk.entries[1].content,'B has not told A the secret yet.');
    assert.equal(h.disk.entries[1].disable,true);
    assert.equal(h.disk.entries[2].content,'A still suffers from a sore ankle.');
    assert.deepEqual(h.disk.entries[3],h.state.original.entries[3]);
    assert.deepEqual(h.disk.stlo,h.state.original.stlo);
    const current=Object.values(h.disk.entries).find(e=>e.comment==='Current Continuity');
    assert.ok(current.content.startsWith('## Active Conditions'));
    assert.ok(!current.content.includes('=== BEGIN ORIGINAL'));
    assert.ok(current.STMB_slothContinuityReconciliation.originalContent.includes('=== BEGIN ORIGINAL'));
});
test('concurrent World Info editing blocks replacement before any save',async()=>{
    const h=harness();h.disk.entries[3].content='Externally edited.';
    await assert.rejects(commitSlothNexusMigration(h.state,h.deps),/changed/);
    assert.equal(h.wrote,0);
});
test('failed post-write response rolls original state back with verifiable readback',async()=>{
    const h=harness();let calls=0;
    h.deps.save=async(_name,data)=>{calls++;h.disk=data;
        if(calls===1)throw new Error('Connection dropped after write.');
    };
    await assert.rejects(commitSlothNexusMigration(h.state,h.deps),/original was restored/);
    assert.equal(calls,2);
    assert.deepEqual(h.disk,h.state.original);
});
test('legacy state reconciliation is absent from the Sloth interface',()=>{
    assert.doesNotMatch(file('./index.js'),/runNexusLegacyContinuityReview/);
    assert.doesNotMatch(file('./templates.js'),/data-stmb-sloth-action="continuity"/);
    assert.doesNotMatch(file('./nexusCollectorRuntime.js'),/runNexusLegacyContinuityReview/);
});
test('all supported non-English locales include user-visible review translations',()=>{
    const languages=['de-de','es-es','fr-fr','id-id','ja-jp','ko-kr',
        'ms-my','pt-br','ru-ru','zh-cn','zh-tw'];
    const keys=['SlothLegacySemanticButton','SlothLegacySemanticHelp',
        'SlothLegacySemanticNone','SlothLegacySemanticAnalyzing',
        'SlothLegacySemanticUnverified','SlothLegacySemanticReview',
        'SlothLegacySemanticWarning','SlothLegacySemanticBefore',
        'SlothLegacySemanticExpand','SlothLegacySemanticEvidence',
        'SlothLegacySemanticExcluded','SlothLegacySemanticAfter',
        'SlothLegacySemanticApprove','SlothLegacySemanticSaved'];
    for(const lang of languages){
        const data=JSON.parse(file('./locales/'+lang+'.json'));
        for(const key of keys)assert.ok(data['STMemoryBooks_'+key],lang+':'+key);
    }
});
test('AI prompts never infer healing or disclosure merely from old archived text',()=>{
    const text=file('./nexusCollectionAI.js');
    assert.match(text,/proposeSlothLegacyContinuity/);
    assert.match(text,/old document claiming that something once was true/i);
    assert.match(text,/corroboration/i);
    assert.match(text,/validateSlothLegacyContinuityProposal\(plan,raw,messages\)/);
});
