// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { getCharacterNexusRoles, getLinkedCharacterWorlds, resolveCharacterNexusRole } from './nexusCharacterRoles.js';
import { getNexusChatRoleOverride, setNexusChatRoleOverride } from './nexusChatRoleOverrides.js';
import { isAssignedToAnotherNexusCharacter } from './nexusWorldInfoScope.js';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const runtime = read('./nexusCharacterRolesRuntime.js');
const originStart = runtime.indexOf('export function getNexusRoleResolutionForChatRef(');
const originEnd = runtime.indexOf('\nexport function getCurrentNexusRoleResolution(', originStart);
assert.ok(originStart >= 0 && originEnd > originStart);
const originSource = runtime.slice(originStart, originEnd).replace('export function', 'function');

function originHarness() {
    const characters = [
        { avatar: 'A.png', data: { extensions: { world: 'A Nexus' } } },
        { avatar: 'B.png', data: { extensions: { world: 'B Nexus' } } },
    ];
    const world_info = { charLore: [
        { name: 'A', extraBooks: ['A Memory'] },
        { name: 'B', extraBooks: ['B Memory'] },
    ] };
    const world_names = ['A Nexus', 'A Memory', 'B Nexus', 'B Memory'];
    const settings = { nexusCharacterRoles: {
        'A.png': { nexus: 'A Nexus', memory: 'A Memory' },
        'B.png': { nexus: 'B Nexus', memory: 'B Memory' },
    }};
    const scope = { characters, world_info, world_names, getCharacterNexusRoles,
        getLinkedCharacterWorlds, resolveCharacterNexusRole, getNexusChatRoleOverride,
        isAssignedToAnotherNexusCharacter,
        getStmbChatKey: ref => 'character:' + ref.avatarUrl + ':' + ref.fileName,
        getCurrentNexusRoleResolution: () => ({ state:'ready', name:'B Memory' }) };
    const resolve = vm.runInNewContext(originSource + '\ngetNexusRoleResolutionForChatRef', scope);
    return { resolve, settings, characters, world_info, world_names };
}

test('queued generation resolves original A despite B currently open', () => {
    const h = originHarness();
    const ref = {type:'character', avatarUrl:'A.png', characterId:1, fileName:'chat-a'};
    const memory = h.resolve('memory', ref, h.settings);
    assert.equal(memory.state, 'ready');
    assert.equal(memory.name, 'A Memory');
    assert.equal(h.resolve('nexus', ref, h.settings).name, 'A Nexus');
    assert.notEqual(memory.name, 'B Memory');
});

test('AU override resolves by originating chat, not the currently opened B chat', () => {
    const h = originHarness();
    h.settings.nexusChatRoleOverrides = {};
    h.world_info.charLore[0].extraBooks.push('A Alternate Nexus', 'A Alternate Memory');
    h.world_names.push('A Alternate Nexus', 'A Alternate Memory');
    const refA = {type:'character', avatarUrl:'A.png', fileName:'chat-a'};
    setNexusChatRoleOverride(h.settings.nexusChatRoleOverrides, refA,
        'character:A.png:chat-a', {nexus:'A Alternate Nexus', memory:'A Alternate Memory'});
    assert.equal(h.resolve('nexus',refA,h.settings).name,'A Alternate Nexus');
    assert.equal(h.resolve('memory',refA,h.settings).name,'A Alternate Memory');
    assert.equal(h.resolve('memory',{...refA,fileName:'chat-a-copy'},h.settings).name,'A Memory',
        'forked chat uses the original character default');
    assert.equal(h.resolve('memory',{type:'character',avatarUrl:'B.png',fileName:'chat-a'},h.settings).name,'B Memory',
        'another character cannot inherit A even with the same filename');
    h.world_info.charLore[0].extraBooks = ['A Memory'];
    assert.equal(h.resolve('memory',refA,h.settings).state,'detached',
        'unlinked AU book must not silently fall back to default');
});

test('corrupt AU override fails closed instead of writing into the character default', () => {
    const h=originHarness();
    const ref={type:'character',avatarUrl:'A.png',fileName:'chat-a'};
    h.settings.nexusChatRoleOverrides={'character:A.png:chat-a':{
        version:1,avatar:'B.png',nexus:'A Nexus',memory:'A Memory'}};
    assert.equal(h.resolve('memory',ref,h.settings).state,'invalid-override');
});

test('origin role cannot fall back to a chat-only book after unlink or deletion', () => {
    const h = originHarness();
    const ref = {type:'character', avatarUrl:'A.png', fileName:'chat-a'};
    h.world_info.charLore[0].extraBooks = [];
    assert.equal(h.resolve('memory',ref,h.settings).state,'detached');
    h.characters.splice(0,1);
    assert.equal(h.resolve('memory',ref,h.settings).state,'missing-character');
    assert.equal(h.resolve('memory',{type:'group',groupId:'group'},h.settings).state,'no-character');
});

const index = read('./index.js');
function extractFunction(begin, end, replace = '') {
    const start = index.indexOf(begin);
    const finish = index.indexOf(end, start + begin.length);
    assert.ok(start >= 0 && finish > start);
    return index.slice(start, finish).replace(replace, '');
}

test('queued Sloth memory suppresses a separate auto-hide path even if global toggle is OFF', async () => {
    const script = extractFunction('async function applyQueuedMemoryAutoHide(', '\nasync function completeQueuedMemoryPostSave(');
    const hidden = [];
    const scope = {
        getNexusRoleResolutionForChatRef: role => role === 'memory'
            ? {state:'ready', name:'A Memory'} : {state:'ready', name:'A Nexus'},
        getAutoHideRanges: () => ({mode:'all', ranges:[{start:0,end:25}]}),
        applyQueuedAutoHideRanges: async(_ref,ranges) => hidden.push(...ranges),
        console, toastr:{warning(){}}, translate:x=>x,
    };
    const fn = vm.runInNewContext(script + '\napplyQueuedMemoryAutoHide',scope);
    await fn({chatRef:{avatarUrl:'A.png'}},{content:'memory'},{moduleSettings:{nexusSceneRotationEnabled:false, autoHideMode:'all'}});
    assert.equal(hidden.length,0);
    scope.getNexusRoleResolutionForChatRef = () => ({state:'unassigned',name:''});
    await fn({chatRef:{}},{content:'memory'},{moduleSettings:{nexusSceneRotationEnabled:false,autoHideMode:'all'}});
    assert.equal(hidden.length,1,'legacy mode keeps its existing auto-hide behavior');
});

test('pending Sloth-mode deferred hide is discarded instead of firing on a later chat open', async () => {
    const script = extractFunction('async function flushDeferredQueuedAutoHideRanges(', '\nasync function applyQueuedMemoryAutoHide(');
    const pending = new Map([['character:A.png:chat-a',[{start:0,end:5}]]]);
    const calls=[];
    const scope = {
        getStmbChatKeySafe: () => 'character:A.png:chat-a',
        deferredQueuedAutoHideRanges:pending,
        extension_settings:{STMemoryBooks:{moduleSettings:{nexusSceneRotationEnabled:false}}},
        getCurrentNexusRoleResolution: role => ({state:role==='memory'?'ready':'ready',name:role}),
        runAutoHideRangesForCurrentChat: async ranges => calls.push(...ranges),
        console,
    };
    const fn=vm.runInNewContext(script + '\nflushDeferredQueuedAutoHideRanges',scope);
    await fn();
    assert.equal(calls.length,0);
    assert.equal(pending.size,0);
});
