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
    assert.doesNotMatch(source, /stmb-linked-books/);
    assert.match(source, /STMemoryBooks_SlothRolesDescription/);
});

test('Korean role setup labels are explicit and hidden-range guidance is formal', () => {
    const ko=JSON.parse(file('./locales/ko-kr.json'));
    assert.equal(ko.STMemoryBooks_SlothRolesTitle, '로어북 준비');
    assert.ok(ko.STMemoryBooks_SlothRoleSaved.startsWith('🦥 게으름뱅이'));
    assert.ok(ko.STMemoryBooks_NexusRotationEnabled.startsWith('🦥 게으름뱅이'));
    assert.match(ko.STMemoryBooks_NoVisibleMessages, /있습니다.*선택하세요/);
    assert.match(ko.STMemoryBooks_SlothPromptHelp, /기본 지침을 사용합니다/);
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


test('Sloth exposes setup and settings without opening the original tab',()=>{
    const source=file('./index.js');
    assert.match(source,/runNexusCollector\(\{/);
    assert.match(source,/const slothFirstSetup = canStartNexusSetup\(/);
    assert.match(source,/slothRoleMemory\.state === 'ready' && slothRoleNexus\.state === 'ready'/);
    const html=file('./templates.js');
    const sloth=html.slice(0,html.indexOf('id="stmb-original-panel" class='));
    assert.match(sloth,/STMemoryBooks_SlothNoBooksYet/);
    for(const action of ['companion','followup','merge','split']) {
        assert.ok(sloth.includes('data-stmb-sloth-action="'+action+'"'),action);
    }
    for(const slot of ['summary','side']) assert.ok(sloth.includes('data-stmb-prompt-library-slot="'+slot+'"'));
    const advanced=sloth.slice(sloth.indexOf('id="stmb-sloth-advanced"'));
    assert.doesNotMatch(advanced,/\/sloth-collect|new-profile|edit-profile|side-prompt-advanced/);
    assert.match(advanced,/stmb-sloth-composer-enabled[\s\S]+stmb-sloth-icon-popover[\s\S]+stmb-sloth-composer-size[\s\S]+stmb-sloth-settings-rule[\s\S]+stmb-sloth-hide-recent/);
    assert.match(sloth,/data-stmb-sloth-action="collect"[\s\S]+id="stmb-sloth-auto"/);
    assert.match(sloth,/option value="jev"/);
    assert.match(sloth,/id="stmb-sloth-linked-books-only"/);
    assert.match(source,/slothLinkedBooksOnly \? \[\] : sloth\.worldNames\.filter/);
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
