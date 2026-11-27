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
    assert.doesNotMatch(sloth,/<details id="stmb-sloth-collection-settings"[^>]*\bopen\b/);
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

test('recall popover uses an intrinsic horizontal row under its trigger',()=>{
    const js=file('./index.js'),css=file('./style.css');
    const choices=js.slice(js.indexOf('function buildSlothRecallSections('),js.indexOf('const field = (kind,title',js.indexOf('function buildSlothRecallSections(')));
    assert.deepEqual([...choices.matchAll(/\['(constant|keyword|vector|disabled)'/g)].map(m=>m[1]),['constant','keyword','vector','disabled']);
    const position=js.slice(js.indexOf('function positionSlothRecallPicker('),js.indexOf('function showSlothIconPicker('));
    assert.match(position,/const width=menu\.getBoundingClientRect\(\)\.width/);
    assert.match(position,/anchor\.left\+\(anchor\.width-width\)\/2/);
    assert.match(position,/anchor\.bottom\+gap-origin\.top/);
    assert.doesNotMatch(position,/menu\.style\.width/);
    assert.match(css,/\.stmb-sloth-icon-popover\.stmb-sloth-recall-popover\s*\{[\s\S]*?flex-flow: row nowrap;[\s\S]*?width: max-content; max-width: calc\(100vw - 16px\); padding: 3px/);
    assert.match(css,/\.stmb-sloth-recall-popover \.stmb-sloth-recall-icon\s*\{[\s\S]*?flex: 0 0 29px; width: 29px/);
});
test('recall row fits two or four options, stays centered when possible, and clamps at screen edges',()=>{
    const js=file('./index.js');
    const body=js.slice(js.indexOf('function positionSlothRecallPicker('),js.indexOf('function showSlothIconPicker('));
    const cases=[
        {width:1280,left:720,bottom:240,options:4,expected:668},
        {width:1280,left:720,bottom:240,options:2,expected:700},
        {width:390,left:332,bottom:440,options:4,expected:249},
        {width:390,left:332,bottom:440,options:2,expected:312},
        {width:390,left:9,bottom:440,options:4,expected:8},
    ];
    for(const c of cases) {
        const document={documentElement:{clientWidth:c.width}};
        const position=vm.runInNewContext(body+'\npositionSlothRecallPicker',{document});
        const intrinsic=c.options*29+(c.options-1)*3+8;
        const menu={style:{},getBoundingClientRect:()=>({width:intrinsic})};
        const trigger={getBoundingClientRect:()=>({width:29,left:c.left,bottom:c.bottom})};
        position(menu,trigger);
        assert.equal(menu.style.width,undefined,'do not stretch or shrink the intrinsic row');
        assert.equal(parseFloat(menu.style.left),c.expected);
        assert.equal(menu.style.top,(c.bottom+4)+'px');
        assert.ok(parseFloat(menu.style.left)+intrinsic<=c.width-8);
    }
    const document={documentElement:{clientWidth:390}};
    const position=vm.runInNewContext(body+'\npositionSlothRecallPicker',{document});
    const menu={style:{},getBoundingClientRect:()=>({width:69}),offsetParent:{getBoundingClientRect:()=>({left:160,top:90})}};
    const trigger={getBoundingClientRect:()=>({width:29,left:160,bottom:119})};
    position(menu,trigger,false);
    assert.equal(menu.style.left,'-20px');
    assert.equal(menu.style.top,'33px');
});

test('Memory Workshop groups existing actions without extra rendering and only Lorebook setup starts open',()=>{
    const source=file('./templates.js');
    const panel=source.slice(source.indexOf('id="stmb-sloth-panel"'),source.indexOf('id="stmb-original-panel" class='));
    assert.deepEqual([...panel.matchAll(/<details id="([^"]+)"[^>]*\sopen(?:\s|>)/g)].map(m=>m[1]),['stmb-sloth-lorebooks']);
    const start=panel.indexOf('<details id="stmb-manage-memories"');
    const block=panel.slice(start,panel.indexOf('</details>',start));
    assert.match(block,/<summary><i class="fa-solid fa-wrench"[^>]*><\/i><span data-i18n="STMemoryBooks_SlothManageBooks">Memory Workshop<\/span><\/summary>/);
    assert.ok(start>panel.indexOf('<details id="stmb-sloth-advanced"'));
    assert.equal((block.match(/class="stmb-workshop-action"/g)||[]).length,6);
    assert.equal((block.match(/class="stmb-workshop-overview"/g)||[]).length,1);
    assert.doesNotMatch(block,/class="menu_button"/);
    assert.match(file('./index.js'),/replace\(oldMaintenance,newMaintenance,content\.querySelector\('#stmb-sloth-panel'\)\);/);
    assert.deepEqual([...block.matchAll(/data-stmb-sloth-action="([^"]+)"/g)].map(m=>m[1]),[
        'nexus-health','nexus-health-review','merge','split','compress','recall-apply','legacy-coverage']);
    assert.equal((block.match(/class="stmb-workshop-tools"/g)||[]).length,3);
    assert.doesNotMatch(block,/\bon(?:click|toggle)=|MutationObserver|ResizeObserver|setInterval|requestAnimationFrame/);
    const js=file('./index.js');
    const dispatcher=js.slice(js.indexOf('async function runSlothSettingsAction('),js.indexOf('function mountSlothCollectionFooter('));
    assert.match(dispatcher,/'nexus-health': \(\) => showSlothNexusHealth\(\)/);
    assert.match(dispatcher,/'nexus-health-review': \(\) => runCancellableSlothButton/);
    assert.match(dispatcher,/'legacy-coverage': \(\) => reviewSlothLegacyCoverage\(\)/);
    assert.doesNotMatch(dispatcher,/MutationObserver|ResizeObserver|setInterval|requestAnimationFrame/);
    const css=file('./style.css');
    assert.match(css,/#stmb-sloth-panel \.stmb-workspace-drawer > summary \{[\s\S]*?display: flex;[\s\S]*?min-block-size: 24px/);
    assert.match(css,/\.stmb-workshop-action \{[\s\S]*?width: fit-content;[\s\S]*?background: transparent/);
    assert.match(css,/\.stmb-workshop-overview \{[\s\S]*?width: 100%/);
    for(const code of ['de-de','es-es','fr-fr','id-id','ja-jp','ko-kr','ms-my','pt-br','ru-ru','zh-cn','zh-tw']){
        const data=JSON.parse(file('./locales/'+code+'.json'));
        for(const key of ['SlothManageBooks','SlothHealthReviewTitle','SlothWorkshopAI','SlothWorkshopManual','SlothWorkshopExisting','SlothLegacyCoverage'])
            assert.ok(data['STMemoryBooks_'+key],code+': '+key);
        assert.notEqual(data.STMemoryBooks_SlothManageBooks,data.STMemoryBooks_SlothHealthReviewTitle);
    }
    const ko=JSON.parse(file('./locales/ko-kr.json'));
    assert.equal(ko.STMemoryBooks_SlothManageBooks,'기억 정비소');
    assert.equal(ko.STMemoryBooks_SlothHealthReviewTitle,'AI 기억 분석 및 정리');
    assert.equal(ko.STMemoryBooks_SlothLegacyCoverage,'기존 요약 범위 등록');
});
