// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

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
    assert.match(sloth,/id="stmb-sloth-advanced"[\s\S]+id="stmb-sloth-collection-footer"[\s\S]+data-stmb-sloth-action="collect"/);
    assert.match(advanced,/stmb-sloth-composer-enabled[\s\S]+stmb-sloth-icon-trigger[\s\S]+stmb-sloth-composer-position[\s\S]+stmb-sloth-composer-size/);
    assert.match(sloth,/<details id="stmb-sloth-lorebooks" open /);
    assert.match(sloth,/<details id="stmb-sloth-collection-settings" open /);
    for (const id of ['stmb-sloth-auto','stmb-sloth-side-prompts','stmb-manage-memories','stmb-sloth-advanced']) {
        assert.match(sloth,new RegExp('<details id="'+id+'" class='));
    }
    assert.match(source,/function mountSlothCollectionFooter[\s\S]+?controls\.prepend\(footer\)/);
    assert.match(source,/footer\.hidden = name !== 'sloth'/);
    assert.match(source,/\.popup-controls > #stmb-sloth-collection-footer'\)\?\.remove\(\)/);
    assert.doesNotMatch(sloth,/option value="jev"/);
    assert.match(sloth,/id="stmb-sloth-linked-books-only"/);
    assert.match(source,/slothLinkedBooksOnly \? \[\] : sloth\.worldNames\.filter/);
    assert.match(html,/data-stmb-sloth-action="collect" data-i18n="STMemoryBooks_SlothCollectButton"/);
    assert.match(html,/STMemoryBooks_SlothManualHelp/);
    const css=file('./style.css');
    assert.match(css,/\.popup\.stmb-popup \.stmb-sloth-review/);
    assert.match(css,/\.stmb-memorybooks-workspace:has\(#stmb-sloth-panel:not\(\[hidden\]\)\)\s*\{\s*height: fit-content !important/);
    assert.match(css,/\.popup-controls:has\(> \.stmb-collection-footer:not\(\[hidden\]\)\)\s*\{\s*align-self: stretch;/);
    assert.match(css,/\.stmb-sloth-advanced-fields > \.stmb-sloth-select-row\.stmb-sloth-compact-field\s*\{\s*grid-template-columns: min\(42%, 10em\)/);
});

test('Side Prompt has one always-visible preset selector and independent disclosure',()=>{
    const dialogs=file('./slothSettingsDialogs.js');
    assert.match(dialogs,/heading\.prepend\(card\.checkbox,selection\.querySelector\('select'\)\)/);
    assert.match(dialogs,/body\.prepend\(tools\);\s*tools\.append\(\.\.\.selection\.children\);\s*selection\.remove\(\)/);
    assert.match(dialogs,/body\.hidden=!expanded;\s*toggle\.setAttribute\('aria-expanded',String\(expanded\)\)/);
    assert.doesNotMatch(dialogs,/stmb-side-card-toggle span/);
    assert.match(dialogs,/stmb-side-card-toggle'\)\.setAttribute\('aria-label'/);
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

test('injection settings use a closed drawer, compact wrapping columns and icon choices',()=>{
    const html=file('./templates.js'),css=file('./style.css'),js=file('./index.js');
    assert.match(html,/<details id="stmb-sloth-injection-settings" class=/);
    assert.doesNotMatch(html,/<details id="stmb-sloth-injection-settings"[^>]*\bopen\b/);
    assert.match(html,/stmb-sloth-recall-columns[\s\S]*#each slothRecallSections[\s\S]*#each fields/);
    assert.match(html,/class="stmb-sloth-recall-value" hidden/);
    assert.match(html,/data-stmb-recall-trigger/);
    assert.match(html,/data-stmb-recall-choice/);
    assert.match(css,/repeat\(auto-fit, minmax\(min\(100%, 11\.5em\), 1fr\)\)/);
    assert.match(js,/syncSlothRecallPicker\(e.target\)/);
    assert.doesNotMatch(js,/SlothNPCOff/);
});

test('recall popover opens as a narrow vertical list immediately below its trigger',()=>{
    const js=file('./index.js'),css=file('./style.css');
    const choices=js.slice(js.indexOf('function buildSlothRecallSections('),js.indexOf('const field = (kind,title',js.indexOf('function buildSlothRecallSections(')));
    assert.deepEqual([...choices.matchAll(/\['(constant|keyword|vector|disabled)'/g)].map(m=>m[1]),['constant','keyword','vector','disabled']);
    const position=js.slice(js.indexOf('function positionSlothRecallPicker('),js.indexOf('function showSlothIconPicker('));
    assert.match(position,/const width=anchor\.width/);
    assert.match(position,/menu\.style\.width=width\+'px'/);
    assert.match(position,/menu\.style\.top=anchor\.bottom\+gap\+'px'/);
    assert.match(css,/\.stmb-sloth-icon-popover\.stmb-sloth-recall-popover\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);[\s\S]*?width: 100%; max-width: 100%; padding: 0/);
});

test('recall menu geometry follows each desktop and mobile trigger exactly',()=>{
    const js=file('./index.js');
    const body=js.slice(js.indexOf('function positionSlothRecallPicker('),js.indexOf('function showSlothIconPicker('));
    for(const viewport of [{width:1280,height:800,left:720,bottom:240},{width:390,height:700,left:332,bottom:440}]) {
        const document={documentElement:{clientWidth:viewport.width,clientHeight:viewport.height}};
        const position=vm.runInNewContext(body+'\npositionSlothRecallPicker',{document});
        const menu={style:{}};
        const trigger={getBoundingClientRect:()=>({width:29,left:viewport.left,bottom:viewport.bottom})};
        position(menu,trigger);
        assert.equal(menu.style.width,'29px');
        assert.equal(menu.style.maxWidth,'29px');
        assert.equal(menu.style.left,viewport.left+'px');
        assert.equal(menu.style.top,(viewport.bottom+3)+'px');
    }
});
