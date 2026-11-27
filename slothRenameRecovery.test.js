// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const src=readFileSync(new URL('./nexusCollectorRuntime.js',import.meta.url),'utf8');
const index=readFileSync(new URL('./index.js',import.meta.url),'utf8');
const key=JSON.stringify(['character','A.png','chat']);
const ref={type:'character',avatarUrl:'A.png',fileName:'chat'};
const clone=v=>JSON.parse(JSON.stringify(v));
const replaced=()=>Object.assign(new Error('Chat metadata changed during the update.'),{code:'STMB_METADATA_REPLACED'});
const external=()=>Object.assign(new Error('External change'),{code:'STMB_SLOTH_EXTERNAL_CHAT_CONFLICT'});
const nexus={type:'lorebook',oldBook:'Nexus',newBook:'Nexus2'};
const memory={type:'lorebook',oldBook:'Memory',newBook:'Memory2'};
function harness(){
    const before={sceneStart:null,slothCollection:{chatKey:key,books:{nexus:'Nexus',memory:'Memory'},savedRanges:[[0,2]]},
        slothAutomatic:{chatKey:key,books:{nexus:'Nexus',memory:'Memory'},through:2},
        slothLegacyCoverage:{'["Nexus","Memory"]':{chatKey:key,ranges:[[0,1]],fingerprint:'keep'}}};
    const state={key,markers:clone(before),stored:clone(before),calls:0,writes:0,fail:null};
    const a=src.indexOf('function getSlothRenameReceiptChatKey('),b=src.indexOf('\nexport function hasPendingSlothSideRename',a);
    const api=vm.runInNewContext(src.slice(a,b)+'\n({getSlothRenameReceiptChatKey,retargetActiveSlothReceipts})',{
        getCurrentStmbChatRef:()=>ref,getStmbChatKey:()=>state.key,getSceneMarkers:()=>state.markers,
        legacyPairKey:roles=>JSON.stringify([roles.nexus,roles.memory]),stringify:JSON.stringify,t:s=>s,
        patchVerifiedSlothMetadata:async(_ref,patch)=>{
            state.calls++;
            if(state.fail)await state.fail();
            state.markers=clone(patch(state.markers));state.stored=clone(state.markers);state.writes++;
            return state.markers;
        },
        readCurrentSlothChatForWrite:async()=>[{chat_metadata:{STMemoryBooks:state.stored}}],
        canonicalSlothWriteSnapshot:JSON.stringify,normalizeSlothWriteMarkers:v=>v,slothWriteConflict:external,
    });
    return {api,state};
}
test('sequential Nexus and Memory renames retain both references after transient metadata replacement',async()=>{
    const {api,state}=harness();
    assert.equal(api.getSlothRenameReceiptChatKey(nexus),key);
    await api.retargetActiveSlothReceipts(nexus,key);
    state.fail=()=>{state.fail=null;state.markers=clone(state.stored);throw replaced();};
    await api.retargetActiveSlothReceipts(memory,key);
    assert.equal(state.calls,3);assert.equal(state.writes,2);
    assert.deepEqual(state.stored.slothCollection.books,{nexus:'Nexus2',memory:'Memory2'});
    assert.deepEqual(state.stored.slothCollection.savedRanges,[[0,2]]);
    assert.deepEqual(state.stored.slothAutomatic.books,{nexus:'Nexus2',memory:'Memory2'});
    assert.deepEqual(state.stored.slothLegacyCoverage['["Nexus2","Memory2"]'].ranges,[[0,1]]);
});
test('external edit is never retried; persistent identity replacement stops after three checks',async()=>{
    const {api,state}=harness();
    state.fail=()=>{throw external();};
    await assert.rejects(api.retargetActiveSlothReceipts(memory,key),{code:'STMB_SLOTH_EXTERNAL_CHAT_CONFLICT'});
    assert.equal(state.calls,1);
    state.fail=()=>{throw replaced();};
    await assert.rejects(api.retargetActiveSlothReceipts(memory,key),{code:'STMB_METADATA_REPLACED'});
    assert.equal(state.calls,4);assert.equal(state.writes,0);
});
test('retry requires original chat and a persisted receipt, not just renamed local metadata',async()=>{
    const {api,state}=harness();
    state.key='another chat';
    await assert.rejects(api.retargetActiveSlothReceipts(memory,key),/original chat/);
    assert.equal(state.calls,0);state.key=key;
    state.markers.slothCollection.books.memory='Memory2';
    state.markers.slothAutomatic.books.memory='Memory2';
    state.markers.slothLegacyCoverage={'["Nexus","Memory2"]':state.markers.slothLegacyCoverage['["Nexus","Memory"]']};
    await assert.rejects(api.retargetActiveSlothReceipts(memory,key),{code:'STMB_SLOTH_EXTERNAL_CHAT_CONFLICT'});
    assert.equal(state.writes,0);
});
test('pending rename can resume from its notification without starting collection',async()=>{
    const settings={moduleSettings:{slothSidePendingRenames:[memory]}};
    const state={warning:null,emits:0,attempts:0,fail:true};
    const a=src.indexOf('function clearSideRenameFailureNotice()'),b=src.indexOf('\nconst possibleLorebookRenames',a);
    const api=vm.runInNewContext("let sideRenameTail=Promise.resolve(),sideRenameRunning=0,sideRenameFailureNotice=null;const SLOTH_RENAME_RETRIED_EVENT='rename';\n"+
        src.slice(a,b).replace(/export function/g,'function')+'\n({retrySlothSideRenames,reportSideRenameFailure})',{
        extension_settings:{STMemoryBooks:settings},pendingSideRenames:s=>s.moduleSettings.slothSidePendingRenames,
        persistSideRenameQueue:async()=>{},
        processSlothSideRenames:async()=>{state.attempts++;if(state.fail)throw replaced();settings.moduleSettings.slothSidePendingRenames=[];},
        eventSource:{emit:async()=>{state.emits++;}},t:s=>s,console:{warn:()=>{}},
        toastr:{info:()=>({}),clear:()=>{},warning:(_s,_title,options)=>{state.warning=options;return {};}},
    });
    assert.equal(await api.retrySlothSideRenames(),false);
    assert.equal(settings.moduleSettings.slothSidePendingRenames.length,1);
    assert.equal(state.warning.timeOut,0);
    state.fail=false;state.warning.onclick();
    assert.equal(await api.retrySlothSideRenames(),true);
    assert.equal(state.attempts,2);assert.equal(state.emits,1);
    assert.equal(settings.moduleSettings.slothSidePendingRenames.length,0);
    const entry=index.slice(index.indexOf('async function runSlothCollectionEntryPoint('),index.indexOf('let activeSlothCollectionButton'));
    assert.match(entry,/if \(hasPendingSlothSideRename\(ref\)\) \{\s*await retrySlothSideRenames\(\);\s*return '';/);
    assert.ok(entry.indexOf('await retrySlothSideRenames()')<entry.indexOf('runNexusCollector('));
});
