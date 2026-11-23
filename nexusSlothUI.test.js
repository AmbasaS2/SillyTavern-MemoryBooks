// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const file = name => readFileSync(new URL(name, import.meta.url),'utf8');

test('Sloth role selectors are character-only and offer Nexus plus Memory', () => {
    const source=file('./templates.js');
    const start=source.indexOf('id="stmb-sloth-roles-title"');
    assert.ok(start>0);
    const end=source.indexOf('id="stmb-sloth-role-memory"',start);
    assert.ok(end>start);
    assert.match(source.slice(start-60,end+400), /stmb-sloth-role-nexus/);
    assert.match(source.slice(start-60,end+400), /stmb-sloth-role-memory/);
    assert.ok(source.lastIndexOf('{{#unless isGroupChat}}',start)>0);
    assert.match(source, /STMemoryBooks_SlothIncompletePair/);
});

test('new UI names follow the full, short and icon-only naming convention', () => {
    const ko=JSON.parse(file('./locales/ko-kr.json'));
    assert.ok(ko.STMemoryBooks_SlothRolesTitle.startsWith('🦥 게으름뱅이 시스템'));
    assert.ok(ko.STMemoryBooks_SlothRoleSaved.startsWith('🦥 게으름뱅이'));
    assert.ok(ko.STMemoryBooks_NexusRotationEnabled.startsWith('🦥 게으름뱅이'));
    assert.ok(ko.STMemoryBooks_SlothIncompletePair.includes('Nexus'));
});

test('Sloth visual rules use scoped theme variables, not forced fonts', () => {
    const css=file('./style.css');
    const block=css.slice(css.indexOf('/* 🦥 Sloth System'));
    assert.ok(block.includes('.popup.stmb-popup .stmb-sloth-roles'));
    assert.match(block,/SmartThemeBorderColor/);
    assert.doesNotMatch(block,/font-family\s*:/i);
    assert.doesNotMatch(block,/@font-face|https?:\/\//i);
    assert.match(block,/@media \(max-width: 620px\)/);
});


test('manual collector entry point offers first setup separately from an existing pair',()=>{
    const source=file('./index.js');
    assert.match(source,/runNexusCollector\(\{/);
    assert.match(source,/const slothFirstSetup = canStartNexusSetup/);
    assert.match(source,/\bslothFirstSetup,\s*slothMissingCompanion,\s*slothWorkspaceActive,/);
    assert.match(source,/slothRoleMemory\.state === 'ready' && slothRoleNexus\.state === 'ready'/);
    const html=file('./templates.js');
    assert.match(html,/STMemoryBooks_SlothFirstBooksButton/);
    assert.match(html,/data-stmb-sloth-action="collect" data-i18n="STMemoryBooks_SlothCollectButton"/);
    assert.match(html,/STMemoryBooks_SlothManualHelp/);
    const css=file('./style.css');
    assert.match(css,/\.popup\.stmb-popup \.stmb-sloth-review/);
});

test('AU chat-only lorebook switch is opt-in and routed separately from character defaults', () => {
    const template = file('./templates.js');
    assert.match(template, /id="stmb-sloth-chat-override"/);
    assert.match(template, /\{\{#if slothChatOverrideAvailable\}\}/);
    assert.match(template, /STMemoryBooks_SlothChatOverrideHelp/);
    const runtime = file('./nexusCharacterRolesRuntime.js');
    assert.match(runtime, /getNexusChatRoleOverride\(/);
    assert.match(runtime, /getStmbChatKey\(chatRef\)/);
    const source = file('./index.js');
    assert.match(source, /setNexusChatRoleOverride\(settings\.nexusChatRoleOverrides/);
    assert.match(source, /clearNexusChatRoleOverride\(settings\.nexusChatRoleOverrides/);
    assert.match(source, /setCharacterNexusRole\(settings\.nexusCharacterRoles/);
    assert.match(source, /moveNexusChatRoleOverrides/);
    assert.match(source, /removeNexusChatRoleOverrides/);
    assert.match(file('./style.css'), /\.popup\.stmb-popup \.stmb-sloth-chat-override/);
    for (const locale of ['de-de','es-es','fr-fr','id-id','ja-jp','ko-kr',
        'ms-my','pt-br','ru-ru','zh-cn','zh-tw']) {
        const data=JSON.parse(file('./locales/'+locale+'.json'));
        for (const key of ['SlothChatOverride','SlothChatOverrideHelp',
            'SlothChatOverrideInvalid','SlothChatOverrideUnavailable']) {
            assert.ok(data['STMemoryBooks_'+key],locale+':'+key);
        }
    }
});
