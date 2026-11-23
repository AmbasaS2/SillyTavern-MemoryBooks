// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    getNexusChatRoleOverride, setNexusChatRoleOverride, clearNexusChatRoleOverride,
    moveNexusChatRoleOverrides, removeNexusChatRoleOverrides,
    canChangeNexusChatRolePair,
} from './nexusChatRoleOverrides.js';

const original = {type:'character',avatarUrl:'Remus.png',fileName:'Paris-AU'};
const key = 'character:Remus.png:Paris-AU';
const other = {...original,fileName:'Paris-AU-copy'};
const defaults = {nexus:'Remus Nexus',memory:'Remus Memory'};

test('chat override is explicitly opt-in, does not mutate defaults or apply to a fork', () => {
    const store={};
    const baseline=structuredClone(defaults);
    assert.equal(getNexusChatRoleOverride(store,original,key),null);
    assert.equal(setNexusChatRoleOverride(store,original,key,defaults),true);
    assert.deepEqual(getNexusChatRoleOverride(store,original,key),{...defaults,invalid:false});
    assert.equal(setNexusChatRoleOverride(store,original,key,defaults),false);
    assert.deepEqual(defaults,baseline);
    assert.equal(getNexusChatRoleOverride(store,other,'character:Remus.png:Paris-AU-copy'),null);
    assert.equal(getNexusChatRoleOverride(store,{...original,avatarUrl:'Sirius.png'},key),null);
    assert.equal(clearNexusChatRoleOverride(store,original,key),true);
    assert.equal(getNexusChatRoleOverride(store,original,key),null);
    assert.equal(clearNexusChatRoleOverride(store,original,key),false);
});

test('AU override requires a real, stable individual chat key',()=>{
    for(const ref of [null,{type:'group',groupId:'1'}, {...original,fileName:''}]){
        assert.throws(()=>setNexusChatRoleOverride({},ref,key,defaults),/individual-character chat/);
        assert.equal(getNexusChatRoleOverride({},ref,key),null);
    }
    assert.throws(()=>setNexusChatRoleOverride({},original,'other-chat',defaults),/individual-character chat/);
});

test('never let two roles point at the same World Info book',()=>{
    const store={};
    assert.throws(()=>setNexusChatRoleOverride(store,original,key,{nexus:'same',memory:'same'}),/different/);
    assert.equal(getNexusChatRoleOverride(store,original,key),null);
    setNexusChatRoleOverride(store,original,key,{nexus:'Nexus',memory:''});
    assert.equal(getNexusChatRoleOverride(store,original,key).memory,'');
});

test('corrupt, mismatched or colliding overrides report invalid and cannot poison object prototype',()=>{
    const store={};
    store[key]={version:1,avatar:'Other.png',...defaults};
    assert.equal(getNexusChatRoleOverride(store,original,key).invalid,true);
    store[key]={version:1,avatar:'Remus.png',nexus:'shared',memory:'shared'};
    assert.equal(getNexusChatRoleOverride(store,original,key).invalid,true);
    setNexusChatRoleOverride(store,original,key,defaults);
    assert.equal(getNexusChatRoleOverride(store,original,key).invalid,false);
    assert.equal(Object.getPrototypeOf(store),Object.prototype);
});

test('avatar rename migrates separate AU mappings without overwriting another character',()=>{
    const store={};
    setNexusChatRoleOverride(store,original,key,defaults);
    const another = {...original,fileName:'Hogwarts-AU'};
    const anotherKey='character:Remus.png:Hogwarts-AU';
    setNexusChatRoleOverride(store,another,anotherKey,{nexus:'H Nexus',memory:'H Memory'});
    assert.equal(moveNexusChatRoleOverrides(store,'Remus.png','Remus-renamed.png'),2);
    assert.equal(getNexusChatRoleOverride(store,original,key),null);
    assert.equal(getNexusChatRoleOverride(store,{...original,avatarUrl:'Remus-renamed.png'},
        'character:Remus-renamed.png:Paris-AU').memory,'Remus Memory');
    assert.equal(removeNexusChatRoleOverrides(store,'Remus-renamed.png'),2);
    assert.equal(Object.keys(store).length,0);
});

test('never reroute a chat after any collected Sloth ranges or legacy checkpoint',()=>{
    const pair={nexus:'N',memory:'M'}, alt={nexus:'N2',memory:'M2'};
    assert.equal(canChangeNexusChatRolePair({},key,pair,alt),true);
    assert.equal(canChangeNexusChatRolePair({highestMemoryProcessed:20},key,pair,alt),false);
    assert.equal(canChangeNexusChatRolePair({slothCollection:{chatKey:key,savedRanges:[[5,18]]}},
        key,pair,alt),false);
    assert.equal(canChangeNexusChatRolePair({slothCollection:{chatKey:'old-branch',savedRanges:[[5,18]]}},
        key,pair,alt),true);
    assert.equal(canChangeNexusChatRolePair({highestMemoryProcessed:20},key,pair,{...pair}),true);
});
