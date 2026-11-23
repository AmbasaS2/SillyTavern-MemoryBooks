// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectNexusSceneSplit,stageNexusSceneSplit}
    from './nexusSceneSplit.js';
import {commitSlothNexusMigration} from './nexusLegacyMigrationCommit.js';

const file=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const text=label=>'**Timeline**\n'+label+'\n\n**Scene**\nActual cause, action and outcome.\n\n**Result**\nThe event ended.';
const book=()=>({entries:{
    1:{uid:1,comment:'001 - The older event',content:text('older'),
        constant:false,vectorized:true,selective:true,disable:false,
        position:0,key:['past'],STMB_chatId:'chat-X',STMB_sourceRanges:[[0,4]]},
    5:{uid:5,comment:'002 - Two unrelated outings',content:text('combined'),
        constant:true,vectorized:false,selective:true,disable:false,
        position:0,key:['outings'],STMB_chatId:'chat-X',STMB_sourceRanges:[[5,8]]},
}});
const messages=[5,6,7,8].map(id=>({id,name:'Narrator',
    mes:'We completed a separate event at source message '+id+'.'}));
const parts=[
    {title:'First independent outing',reason:'The first outing ended before the second one began.',
        result:'The first outing ended.',complete:true,segments:[[5,6]],
        evidence:[{messageId:6,quote:'We completed a separate event at source message 6.'}],
        content:text('first'),keywords:['first']},
    {title:'Second independent outing',reason:'The second activity had a separate completed objective.',
        result:'The second outing ended.',complete:true,segments:[[7,8]],
        evidence:[{messageId:8,quote:'We completed a separate event at source message 8.'}],
        content:text('second'),keywords:['second']},
];
const make=b=>{const uid=Math.max(...Object.values(b.entries).map(x=>x.uid))+1;
    return b.entries[uid]={uid};};
function harness(){
    const original=book(),plan=inspectNexusSceneSplit(original,['chat-X']);
    const staged=stageNexusSceneSplit(original,{sourceUid:plan.sourceUid,
        parts,messages,createEntry:make});
    let persisted=structuredClone(original),writes=0,locks=0,checks=0;
    const args={
        loadFresh:async()=>structuredClone(persisted),
        save:async(name,value)=>{writes++;assert.equal(name,'Memory');
            persisted=structuredClone(value);},
        withLock:async(name,fn)=>{locks++;assert.equal(name,'Memory');return fn();},
        verifyOrigin:()=>{checks++;},operation:'Memory Scene split',
    };
    return {original,staged,args,get persisted(){return persisted;},
        set persisted(value){persisted=structuredClone(value);},
        get writes(){return writes;},get locks(){return locks;},get checks(){return checks;}};
}

test('single approved Memory save preserves previous Scenes and archived complete source',async()=>{
    const h=harness(),before=structuredClone(h.original);
    const committed=await commitSlothNexusMigration({name:'Memory',
        original:h.original,staged:h.staged.proposedMemory},h.args);
    assert.equal(committed.success,true);assert.equal(h.writes,1);
    assert.equal(h.locks,1);assert.ok(h.checks>=1);
    assert.deepEqual(h.original,before);
    assert.deepEqual(h.persisted.entries[5].STMB_slothSceneSplitArchive.source,before.entries[5]);
    assert.equal(h.persisted.entries[5].disable,true);
    assert.equal(h.persisted.entries[6].STMB_chatId,'chat-X');
    assert.equal(h.persisted.entries[7].STMB_chatId,'chat-X');
});
test('concurrent edits block a split before any write',async()=>{
    const h=harness();h.persisted.entries[1].content='Edited by another writer.';
    await assert.rejects(commitSlothNexusMigration({name:'Memory',
        original:h.original,staged:h.staged.proposedMemory},h.args),
        /Memory changed while split was being reviewed/);
    assert.equal(h.writes,0);
});
test('post-persistence network failure is compensated without losing original',async()=>{
    const h=harness();let saves=0;
    h.args.save=async(_name,value)=>{saves++;h.persisted=value;
        if(saves===1)throw new Error('Network failed after persistence');};
    await assert.rejects(commitSlothNexusMigration({name:'Memory',
        original:h.original,staged:h.staged.proposedMemory},h.args),/original was restored/);
    assert.equal(saves,2);assert.deepEqual(h.persisted,h.original);
});
test('runtime is manual and requires all three reviews plus original JSON backup',()=>{
    const index=file('./index.js'),runtime=file('./nexusCollectorRuntime.js');
    assert.match(index,/runNexusSceneSplit\(\{\s*profileIndex/);
    assert.match(file('./templates.js'),/data-stmb-sloth-action="split" data-i18n="STMemoryBooks_SlothSplitButton"/);
    const start=runtime.indexOf('export async function runNexusSceneSplit');
    assert.ok(start>0);
    const part=runtime.slice(start);
    for(const name of [
        'collectorBusy','inspectNexusSceneSplit','listNexusSceneSplitSources','suggestSlothSceneSplit',
        'validateNexusSceneSplitProposal','composeSlothScene','stageNexusSceneSplit',
        'sourceUid:sourcePlan.sourceUid','originalMemory:original',
        'POPUP_RESULT.CUSTOM1 && downloaded','commitSlothNexusMigration',
        "operation:'Memory Scene split'",'assertLegacyMigrationOrigin',
        'fingerprintSlothChat','reloadEditor(names.memory)',
    ])assert.ok(part.includes(name),name);
    assert.match(part,/name:names\.memory,original,staged:staged\.proposedMemory/);
    assert.match(part,/slothPreciseReviewEnabled===true/);
    assert.match(part,/auditSlothDraft\(\{messages,scenes:drafts,edits:\[\],profile,settings\}\)/);
    assert.doesNotMatch(part,/updateCollectedLedger|saveWorldInfo\(names\.nexus|hideChat/);
});
test('model prompt is read-only, independent events are not split by date or token',()=>{
    const source=file('./nexusCollectionAI.js');
    const last=source.slice(source.indexOf('export async function suggestSlothSceneSplit'));
    assert.match(last,/return exactly \{"parts":\[\]\}/);
    assert.match(last,/do not split merely because/i);
    assert.match(last,/validateNexusSceneSplitProposal/);
    assert.doesNotMatch(last,/saveWorldInfo|commitSlothBooks/);
});
test('all non-English locales carry the new translated split controls',()=>{
    const codes=file('./nexusCollectorRuntime.js')+file('./templates.js')+file('./index.js');
    const names=[...new Set([...codes.matchAll(/STMemoryBooks_(SlothSplit\w+)/g)].map(m=>m[1]))];
    assert.equal(names.length,19);
    for(const lang of ['de-de','es-es','fr-fr','id-id','ja-jp','ko-kr',
        'ms-my','pt-br','ru-ru','zh-cn','zh-tw']){
        const data=JSON.parse(file('./locales/'+lang+'.json'));
        for(const key of names)assert.ok(
            data['STMemoryBooks_'+key]?.trim(),lang+':'+key);
    }
});
