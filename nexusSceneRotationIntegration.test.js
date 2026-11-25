// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
//
// Execute the actual addMemoryToLorebook function body with SillyTavern I/O
// replaced by spies. Does not mutate an installed lorebook or chat.

import { legacyRotationEnabled, explicitMemoryBooksMode } from './memoryBooksMode.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { isNexusMemoryBookName, planNexusSceneRotation } from './nexusSceneRotation.js';

const source = readFileSync(new URL('./addlore.js', import.meta.url), 'utf8');
const start = source.indexOf('export async function addMemoryToLorebook(');
const end = source.indexOf('\nfunction populateLorebookEntry(', start);
assert.ok(start !== -1 && end > start, 'expected existing Memory Books save entry point');
const implementation = source.slice(start, end).replace('export async function', 'async function');

const body = '**Timeline**: demo\n\n**Scene**\nCause, development and closure.\n\n**Result**\nThe event ended.';
const entry = uid => ({
    uid, comment: `${String(uid).padStart(3,'0')} - Event`, content: body, key: [],
    constant: uid >= 1, vectorized: false, selective: true, disable: false,
    position: 1, outletName: '', STMB_start: 2, STMB_end: 7,
});
const baseBook = () => ({ entries: Object.fromEntries([1,2,3].map(uid => [uid, entry(uid)])),
    stlo: { budget: 5000, priority: 4 } });

function harness({ failSave = false, bookName = 'Memory-Remus_Catherine', keyword = false, assignedRole = '' } = {}) {
    const saves = [], hides = [], notifications = [], errors = [];
    const moduleSettings = {
        nexusSceneRotationEnabled: true, nexusOlderSceneMode: keyword ? 'keyword' : 'vector',
        showNotifications: false, autoHideMode: 'all',
    };
    const scope = {
        structuredClone, legacyRotationEnabled, explicitMemoryBooksMode, getCurrentStmbChatRef: () => ({type:'character',avatarUrl:'A.png'}),
        MODULE_NAME: 'STMemoryBooks',
        extension_settings: { STMemoryBooks: { moduleSettings } },
        i18n: (_key, fallback) => fallback,
        isNexusMemoryBookName, planNexusSceneRotation,
        getCurrentNexusRoleResolution: () => assignedRole
            ? { state: 'ready', name: assignedRole }
            : { state: 'unassigned', name: '' },
        getNexusRoleResolutionForChatRef: () => assignedRole
            ? { state: 'ready', name: assignedRole }
            : { state: 'unassigned', name: '' },
        createWorldInfoEntry(_name, data) {
            const uid = Math.max(-1, ...Object.values(data.entries).map(x => x.uid)) + 1;
            return data.entries[uid] = { uid, disable: false, position: 1, outletName: '' };
        },
        generateEntryTitle(_format, _result, data) {
            const uid = Math.max(...Object.values(data.entries).map(x => x.uid));
            return `${String(uid).padStart(3, '0')} - Event`;
        },
        populateLorebookEntry(target, result, title) {
            target.comment = title;
            target.content = result.content;
            target.key = result.suggestedKeys || [];
            target.constant = false;
            target.vectorized = true;
            target.selective = true;
        },
        sanitizeTitle: x => x,
        isCharacterAwarenessDisabled: () => false,
        saveWorldInfo: async (_name, data) => {
            saves.push(structuredClone(data));
            if (failSave) throw new Error('mock disk failure');
        },
        reloadEditor: async () => {},
        getAutoHideRanges: () => ({ mode: 'all', invalidRange: false,
            ranges: [{start: 0, end: 10, contextKey: 'test', contextFallback: 'test'}] }),
        safeExecuteHideCommand: async cmd => { hides.push(cmd); },
        updateHighestMemoryProcessed: () => {},
        toastr: { success: x => notifications.push(x), error: x => errors.push(x), warning: x => errors.push(x) },
        console: { log() {}, warn() {}, error() {} },
    };
    const fn = vm.runInNewContext(`${implementation}\naddMemoryToLorebook`, scope);
    return { fn, saves, hides, notifications, errors, bookName };
}

test('approved Memory save rotates recent 3 in a single save and suppresses auto-hide', async () => {
    const h = harness(), book = baseBook();
    const out = await h.fn({ content: body, suggestedKeys: [], metadata: { sceneRange: '8-15' } },
        { valid: true, name: h.bookName, data: book }, { refreshEditor: false });
    assert.equal(out.success, true);
    assert.equal(h.saves.length, 1);
    assert.equal(h.hides.length, 0);
    assert.deepEqual(h.saves[0].stlo, {budget: 5000, priority: 4});
    assert.equal(book.entries[1].constant, false);
    assert.equal(book.entries[1].vectorized, true);
    for (const uid of [2,3,4]) {
        assert.equal(book.entries[uid].constant, true);
        assert.equal(book.entries[uid].vectorized, false);
    }
});

test('failed disk save never mutates original Memory', async () => {
    const h = harness({failSave: true}), book = baseBook();
    const original = structuredClone(book);
    const out = await h.fn({ content: body, suggestedKeys: [] },
        { valid: true, name: h.bookName, data: book }, { refreshEditor: false });
    assert.equal(out.success, false);
    assert.equal(h.hides.length, 0);
    assert.deepEqual(book, original);
});

test('mixed old Memory book is rejected before save with all entries unchanged', async () => {
    const h = harness(), book = baseBook();
    book.entries[90] = {uid:90,comment:'Status (STMB SidePrompt)',content:'still hurt',constant:true};
    const original = structuredClone(book);
    const out = await h.fn({ content: body, suggestedKeys: [] },
        { valid: true, name: h.bookName, data: book }, { refreshEditor: false });
    assert.equal(out.success, false);
    assert.equal(h.saves.length, 0);
    assert.deepEqual(book, original);
});

test('Nexus target does not rotate or restrict other lorebook entries', async () => {
    const h = harness({bookName:'Nexus-Remus_Catherine'}), book = baseBook();
    const out = await h.fn({ content: body, suggestedKeys: [] },
        { valid: true, name: h.bookName, data: book }, { refreshEditor: false, autoHide: false });
    assert.equal(out.success, true);
    assert.equal(book.entries[1].constant, true);
    assert.equal(book.entries[4].constant, false);
});
test('Nexus mode forces a memory preview in both direct and queued generation', () => {
    const index = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
    assert.match(index, /settings\.moduleSettings\.showMemoryPreviews \|\| legacyRotationEnabled\(settings, memoryOriginSnapshot\.chatRef\)/);
    assert.match(index, /settings\.moduleSettings\?\.showMemoryPreviews \|\| legacyRotationEnabled\(settings, job\.chatRef\)/);
});

test('arbitrarily named character Memory role still rotates latest three', async () => {
    const h = harness({ bookName:'My Events Chronicle', assignedRole:'My Events Chronicle' });
    const source = baseBook();
    const out = await h.fn({ content:body, suggestedKeys:[] },
        { valid:true, name:h.bookName, data:source }, {refreshEditor:false});
    assert.equal(out.success, true);
    assert.equal(h.saves.length, 1);
    assert.equal(source.entries[1].constant, false);
    assert.deepEqual(h.hides, []);
});

test('wrong chat-bound target cannot override assigned character Memory role', async () => {
    const h = harness({bookName:'Other Chat Lorebook',assignedRole:'Actual Memory'});
    const source = baseBook(), before=structuredClone(source);
    const out = await h.fn({ content:body, suggestedKeys:[] },
        { valid:true, name:h.bookName, data:source }, {refreshEditor:false});
    assert.equal(out.success, false);
    assert.deepEqual(source,before);
    assert.equal(h.saves.length,0);
});

test('approved save remains bound to original character role after chat switches', async () => {
    const h = harness({ bookName:'A Personal Chronicle', assignedRole:'A Personal Chronicle' });
    const book = baseBook();
    const result = await h.fn({content:body,suggestedKeys:[]},
        {valid:true,name:h.bookName,data:book},
        {refreshEditor:false,originChatRef:{type:'character',avatarUrl:'A.png',fileName:'chat-a'},
            requiredCharacterMemoryName:'A Personal Chronicle'});
    assert.equal(result.success,true);
    assert.equal(h.saves.length,1);
    assert.equal(book.entries[1].constant,false);
});

test('changed character role after preview blocks save instead of quietly switching books', async () => {
    const h = harness({ bookName:'New Memory', assignedRole:'New Memory' });
    const book = baseBook(), before = structuredClone(book);
    const result = await h.fn({content:body,suggestedKeys:[]},
        {valid:true,name:h.bookName,data:book},
        {refreshEditor:false,originChatRef:{type:'character',avatarUrl:'A.png',fileName:'chat-a'},
            requiredCharacterMemoryName:'Old Memory'});
    assert.equal(result.success,false);
    assert.equal(h.saves.length,0);
    assert.deepEqual(book,before);
});
