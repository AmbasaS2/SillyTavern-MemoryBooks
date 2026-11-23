// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const validation = readFileSync(new URL('./lorebookValidation.js', import.meta.url), 'utf8');
const vStart=validation.indexOf('export async function validateLorebookRequirement(');
assert.ok(vStart >= 0);
const validationFn=validation.slice(vStart).replace('export async function','async function');

const side=readFileSync(new URL('./sidePrompts.js', import.meta.url), 'utf8');
const sStart=side.indexOf('async function resolveSidePromptLorebook(');
const sEnd=side.indexOf('\n/**',sStart);
assert.ok(sStart>=0 && sEnd>sStart);
const sideFn=side.slice(sStart,sEnd);

function validateHarness({
    role={state:'unassigned',name:''}, nexusRole=null, chatName='Chat-only',
    manual=false, names=['Nexus','Memory','Chat-only'], override,
}={}) {
    const loaded=[], popups=[];
    const scope={
        extension_settings:{STMemoryBooks:{moduleSettings:{manualModeEnabled:manual,autoCreateLorebook:false}}},
        getCurrentNexusRoleResolution:type=>type==='memory' ? role :
            (nexusRole || (role.state==='unassigned' ? {state:'unassigned',name:''} : {state:'ready',name:'Nexus'})),
        getSceneMarkers:()=>({manualLorebook:'Manual-only'}),
        getCurrentManualLorebookResolution:()=>({lorebookName:'Manual-only',source:'chat-manual'}),
        chat_metadata:{world_info:chatName},
        METADATA_KEY:'world_info',
        world_names:names,
        tr:(_key,fallback,args)=>fallback.replace('{{name}}',args?.name||''),
        getDefaultRetryText:()=> 'Retry.',
        escapeHtml:x=>x,
        showLorebookRecoveryPopup:async(args)=>{popups.push(args);return {type:'handled',error:'Missing'};},
        loadWorldInfo:async(name)=>{loaded.push(name);return {entries:{},identity:name};},
        translate:x=>x,
    };
    const fn=vm.runInNewContext(validationFn+'\nvalidateLorebookRequirement',scope);
    return {fn,loaded,popups,override};
}

test('new chat uses selected character Memory, not chat-only binding', async()=>{
    const h=validateHarness({role:{state:'ready',name:'Memory'}});
    const result=await h.fn();
    assert.equal(result.valid,true);
    assert.equal(result.name,'Memory');
    assert.equal(result.source,'character-role');
    assert.deepEqual(h.loaded,['Memory']);
    assert.equal(h.popups.length,0);
});
test('manual mode also resolves character Memory over a stale manual book', async()=>{
    const h=validateHarness({role:{state:'ready',name:'Memory'},manual:true});
    assert.equal((await h.fn()).name,'Memory');
});
test('an assigned role that is missing or unlinked never silently falls back to another book', async()=>{
    for (const state of ['missing','detached']){
        const h=validateHarness({role:{state,name:'Memory'}});
        const result=await h.fn();
        assert.equal(result.valid,false);
        assert.equal(h.loaded.length,0);
        assert.equal(h.popups.length,0);
    }
});
test('without character roles upstream chat-bound selection is preserved',async()=>{
    const h=validateHarness();
    const result=await h.fn();
    assert.equal(result.name,'Chat-only');
    assert.equal(result.source,undefined);
});
test('an explicit operation-specific target still applies to its own validation call',async()=>{
    const h=validateHarness({role:{state:'ready',name:'Memory'}});
    assert.equal((await h.fn({lorebookName:'Nexus'})).name,'Nexus');
});

function sideHarness({memory={state:'ready',name:'Memory'},nexus={state:'ready',name:'Nexus'},
    chatOverride='',templateOverride=''}={}) {
    const loaded=[];
    const scope={
        getCurrentNexusRoleResolution:role=>role==='nexus'?nexus:memory,
        getNexusRoleResolutionForChatRef:role=>role==='nexus'?nexus:memory,
        getStmbChatKey:ref=>ref?'character:origin':'character:current',
        getSidePromptChatLorebookOverrides:()=>chatOverride?{t1:chatOverride}:{},
        tryLoadOverrideLorebook:async(name,source)=>{if (!name) return null; loaded.push({name,source});return {name,source,data:{entries:{}}};},
        resolveMemoryDefaultLorebook:async()=>({name:'Memory',source:'memoryDefault',data:{entries:{}}}),
    };
    const fn=vm.runInNewContext(sideFn+'\nresolveSidePromptLorebook',scope);
    return {fn,tpl:{key:'t1',settings:{lorebook:{targetLorebookName:templateOverride}}},loaded};
}
test('ordinary Side Prompts automatically use Nexus after a character role is chosen',async()=>{
    const h=sideHarness();
    const r=await h.fn(h.tpl);
    assert.equal(r.name,'Nexus');
    assert.equal(r.source,'characterNexusRole');
});
test('an explicit custom Side Prompt target is preserved if not the Memory Scene book',async()=>{
    const h=sideHarness({templateOverride:'Custom Outlet'});
    assert.equal((await h.fn(h.tpl)).name,'Custom Outlet');
});
test('a Side Prompt may never write non-Scene data to assigned Memory, even via override',async()=>{
    for(const override of ['Memory','__memory__']){
        const h=sideHarness({chatOverride:override});
        await assert.rejects(h.fn(h.tpl),/cannot be stored/);
    }
});
test('a missing Nexus assignment with active Memory blocks side prompts instead of mixing them',async()=>{
    const h=sideHarness({nexus:{state:'unassigned',name:''}});
    await assert.rejects(h.fn(h.tpl),/Set both Nexus and Memory/);
});
test('unconfigured legacy mode retains the original Side Prompt destination',async()=>{
    const h=sideHarness({memory:{state:'unassigned',name:''},nexus:{state:'unassigned',name:''}});
    assert.equal((await h.fn(h.tpl)).name,'Memory');
});

test('partially configured character roles block collection rather than using a chat book', async () => {
    const oneSide=validateHarness({
        role:{state:'ready',name:'Memory'},
        nexusRole:{state:'unassigned',name:''},
    });
    const result=await oneSide.fn();
    assert.equal(result.valid,false);
    assert.equal(oneSide.loaded.length,0);
    assert.equal(oneSide.popups.length,0);
});
test('Nexus-only configuration also blocks legacy chat-bound collection', async () => {
    const h=validateHarness({nexusRole:{state:'ready',name:'Nexus'}});
    assert.equal((await h.fn()).valid,false);
    assert.equal(h.loaded.length,0);
});

test('queued after-memory Nexus updates refuse another chat’s live override', async () => {
    const h=sideHarness({chatOverride:'Some other chat destination'});
    await assert.rejects(h.fn(h.tpl,{chatRef:{type:'character',avatarUrl:'A.png',fileName:'old'}}),
        /Return to the original chat/);
    assert.equal(h.loaded.length,0);
});
