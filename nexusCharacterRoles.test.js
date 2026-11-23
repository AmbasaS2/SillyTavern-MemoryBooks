// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeNexusCharacterRoles, getCharacterNexusRoles,
    setCharacterNexusRole, moveCharacterNexusRoles, removeCharacterNexusRoles,
    getLinkedCharacterWorlds, resolveCharacterNexusRole,
} from './nexusCharacterRoles.js';

const character = { avatar:'Remus.png', data: { extensions: { world:'Nexus - Remus' }}};
const wi = { charLore:[
    { name:'Remus', extraBooks:['Memory - Remus','Nexus - Remus','Other'] },
    { name:'Sirius', extraBooks:['Memory - Sirius'] },
] };
const worlds = ['Nexus - Remus','Memory - Remus','Other','Memory - Sirius'];

test('reads primary/additional ST character lorebooks once; does not include chat-only or other characters', () => {
    assert.deepEqual(getLinkedCharacterWorlds({ character, worldInfo:wi, worldNames:worlds }),
        ['Nexus - Remus','Memory - Remus','Other']);
});

test('empty and missing character has no inferred assignments', () => {
    assert.deepEqual(getLinkedCharacterWorlds({ character:null, worldInfo:wi, worldNames:worlds }), []);
    assert.deepEqual(getLinkedCharacterWorlds({ character, worldInfo:wi, worldNames:[] }), []);
    assert.deepEqual(getCharacterNexusRoles({}, 'Remus.png'), { nexus:'', memory:'' });
});

test('roles are character-scoped, filenames arbitrary, persist in settings independent of chat', () => {
    const store = {};
    setCharacterNexusRole(store,'Remus.png','nexus','Nexus - Remus');
    setCharacterNexusRole(store,'Remus.png','memory','Memory - Remus');
    setCharacterNexusRole(store,'Sirius.png','memory','Memory - Sirius');
    assert.deepEqual(getCharacterNexusRoles(store,'Remus.png'),
        {nexus:'Nexus - Remus',memory:'Memory - Remus'});
    assert.deepEqual(getCharacterNexusRoles(store,'Sirius.png'),
        {nexus:'',memory:'Memory - Sirius'});
    assert.deepEqual(resolveCharacterNexusRole({
        roles:store,avatar:'Remus.png',role:'memory',linkedBooks:getLinkedCharacterWorlds({character,worldInfo:wi,worldNames:worlds}),worldNames:worlds
    }), {state:'ready',name:'Memory - Remus',role:'memory'});
});

test('missing/detached role names fail closed instead of falling back to chat-book', () => {
    const roles={'Remus.png':{memory:'Memory - Remus',nexus:'Nexus - Remus'}};
    assert.equal(resolveCharacterNexusRole({roles,avatar:'Remus.png',role:'memory',linkedBooks:[],worldNames:worlds}).state,'detached');
    assert.equal(resolveCharacterNexusRole({roles,avatar:'Remus.png',role:'memory',linkedBooks:[],worldNames:[]}).state,'missing');
    assert.equal(resolveCharacterNexusRole({roles,avatar:'Remus.png',role:'nexus',linkedBooks:[],worldNames:worlds}).state,'detached');
});

test('cannot assign the same book to both roles', () => {
    const store = {};
    setCharacterNexusRole(store,'Remus.png','nexus','Shared');
    assert.throws(()=>setCharacterNexusRole(store,'Remus.png','memory','Shared'),/different/);
    assert.deepEqual(getCharacterNexusRoles(store,'Remus.png'),{nexus:'Shared',memory:''});
});

test('changing avatar safely moves record but never overwrites another character', () => {
    const roles={'Old.png':{nexus:'N',memory:'M'},'Taken.png':{nexus:'T',memory:''}};
    assert.equal(moveCharacterNexusRoles(roles,'Old.png','Taken.png'),false);
    assert.equal(moveCharacterNexusRoles(roles,'Old.png','New.png'),true);
    assert.equal(roles['Old.png'],undefined);
    assert.deepEqual(roles['New.png'],{nexus:'N',memory:'M'});
    assert.equal(removeCharacterNexusRoles(roles,'New.png'),true);
    assert.equal(roles['New.png'],undefined);
});

test('normalization removes invalid mappings without mutating user values', () => {
    const raw={ 'Remus.png':{nexus:' N ',memory:' M ',extra:'nope'}, 'Empty':{nexus:'',memory:''}, 'Duplicate':{nexus:'A',memory:'A'} };
    const original=structuredClone(raw);
    const {roles,changed}=normalizeNexusCharacterRoles(raw);
    assert.equal(changed,true);
    assert.deepEqual(roles['Remus.png'],{nexus:'N',memory:'M'});
    assert.equal(Object.keys(roles).length,1);
    assert.deepEqual(raw,original);
});

test('prototype-like keys never mutate object prototype', () => {
    const store={};
    assert.equal(setCharacterNexusRole(store,'__proto__','memory','Memory'),true);
    assert.equal(Object.prototype.memory,undefined);
    assert.equal(store.__proto__.memory,'Memory');
    assert.equal(Object.getPrototypeOf(store),Object.prototype);
});
