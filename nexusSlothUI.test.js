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


test('manual collector entry point is wired and gated on both ready roles',()=>{
    const source=file('./index.js');
    assert.match(source,/runNexusCollector\(\{/);
    assert.match(source,/getCurrentNexusRoleResolution\(role, settings\)\.state === 'ready'/);
    assert.match(source,/STMemoryBooks_SlothCollectButton/);
    const html=file('./templates.js');
    assert.match(html,/STMemoryBooks_SlothManualHelp/);
    const css=file('./style.css');
    assert.match(css,/\.popup\.stmb-popup \.stmb-sloth-review/);
});
