// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { canChangeNexusChatRolePair, setNexusChatRoleOverride } from './nexusChatRoleOverrides.js';
import { rememberNexusChatWorlds, scopeNexusWorldInfo } from './nexusWorldInfoScope.js';

test('only the current AU pair is scanned even when managed books are global, chat or persona lore', () => {
    const ref = { type: 'character', avatarUrl: 'A.png', fileName: 'au' };
    const avatar = ref.avatarUrl;
    const chatKey = 'character:A.png:au';
    const settings = {
        nexusCharacterRoles: { [avatar]: { nexus: 'A Nexus', memory: 'A Memory' }, 'B.png': { nexus: 'B Nexus' } },
        nexusChatRoleOverrides: {},
        nexusChatScopedWorlds: {},
    };
    const au = { nexus: 'AU Nexus', memory: 'AU Memory' };
    setNexusChatRoleOverride(settings.nexusChatRoleOverrides, ref, chatKey, au);
    const outlet = { world: au.nexus, uid: 8, position: 7, outletName: 'PanelAssets' };
    const other = { world: 'Shared extras', uid: 0, vectorized: true };
    const lists = {
        globalLore: [{ world: 'B Nexus' }, other],
        characterLore: [outlet, { world: 'A Nexus' }],
        chatLore: [{ world: 'A Memory' }],
        personaLore: [{ world: au.memory }],
    };
    scopeNexusWorldInfo(lists, { settings, ref, avatar, chatKey });
    assert.deepEqual(lists, { globalLore: [other], characterLore: [outlet], chatLore: [], personaLore: [{ world: au.memory }] });
    assert.equal(lists.characterLore[0], outlet);

    const inherited = { characterLore: [outlet, { world: 'A Nexus' }, other] };
    scopeNexusWorldInfo(inherited, { settings, ref: { ...ref, fileName: 'new' }, avatar, chatKey: 'character:A.png:new' });
    assert.deepEqual(inherited.characterLore, [{ world: 'A Nexus' }, other]);

    // Disabling or changing the last override must not expose its linked books.
    rememberNexusChatWorlds(settings.nexusChatScopedWorlds, avatar, au);
    settings.nexusChatRoleOverrides = {};
    const disabled = { characterLore: [outlet, other] };
    scopeNexusWorldInfo(disabled, { settings, ref, avatar, chatKey });
    assert.deepEqual(disabled.characterLore, [other]);
});

test('an old checkpoint can adopt its first pair only if the known original book is kept', () => {
    const original = { highestMemoryProcessed: 30 };
    const chat = 'character:A.png:old';
    assert.equal(canChangeNexusChatRolePair(original, chat, {}, { nexus: 'New' }, 'Original'), true);
    assert.equal(canChangeNexusChatRolePair(original, chat, { nexus: 'New' }, { nexus: 'New', memory: 'Original' }, 'Original'), true);
    assert.equal(canChangeNexusChatRolePair(original, chat, { nexus: 'New' }, { nexus: 'New', memory: 'Wrong' }, 'Original'), false);
    assert.equal(canChangeNexusChatRolePair(original, chat, {}, { nexus: 'New' }), false);
    assert.equal(canChangeNexusChatRolePair({ slothCollection: { chatKey: chat, savedRanges: [[0, 1]] } },
        chat, { nexus: 'New' }, { nexus: 'New', memory: 'Original' }, 'Original'), false);
});

test('an enabled Sloth Side Prompt follows its exact character chat even in a shared Nexus', () => {
    const avatar='A.png';
    const ref={type:'character',avatarUrl:avatar,fileName:'AU one'};
    const settings={nexusCharacterRoles:{[avatar]:{nexus:'Nexus',memory:'Memory'}}};
    const note=(name,uid)=>({world:'Nexus',uid,vectorized:true,STMB_slothSideNote:true,
        STMB_sidePromptHistory:{chatKey:JSON.stringify(['character',avatar,name])}});
    const current=note('AU one',1);
    const shared={world:'Nexus',uid:4};
    const scope=(fileName,type='character')=>{
        const lists={characterLore:[current,note('AU two',2),shared]};
        scopeNexusWorldInfo(lists,{settings,ref:{...ref,type,fileName},avatar});
        return lists.characterLore;
    };
    assert.deepEqual(scope('AU one'),[current,shared]);
    assert.deepEqual(scope('unrelated'),[shared]);
    assert.deepEqual(scope('AU one','group'),[shared]);
});
