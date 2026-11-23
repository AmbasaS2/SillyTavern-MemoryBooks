// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    isNexusMemoryBookName,
    isCompletedSceneEntry,
    planNexusSceneRotation,
    sceneNumberFromTitle,
} from './nexusSceneRotation.js';

function scene(uid, number = uid) {
    return {
        uid, comment: `${String(number).padStart(3, '0')} - Complete event`,
        content: '**Timeline**: now\n\n**Scene**\nBeginning, cause and resolution.\n\n**Result**\nResolved.',
        key: [], keysecondary: [], constant: false, vectorized: true, selective: true,
        disable: false, order: number, position: 1, outletName: '',
        stmemorybooks: true, STMB_start: 1, STMB_end: 14,
    };
}
function book(...numbers) {
    return { entries: Object.fromEntries(numbers.map(n => [n, scene(n)])), stlo: { priority: 1, budget: 5000 } };
}

test('only dedicated Memory books qualify, not Nexus or upstream LTM books', () => {
    assert.equal(isNexusMemoryBookName('Memory-Remus_Catherine'), true);
    assert.equal(isNexusMemoryBookName('Memory'), true);
    assert.equal(isNexusMemoryBookName('Nexus-Remus_Catherine'), false);
    assert.equal(isNexusMemoryBookName('LTM - Remus'), false);
});

test('supports numbered existing Scene titles but rejects unlabeled/incomplete items', () => {
    assert.equal(sceneNumberFromTitle('001 - The scene'), 1);
    assert.equal(sceneNumberFromTitle('[001] - The scene'), 1);
    assert.equal(sceneNumberFromTitle('Scene 059 - The scene'), 59);
    assert.equal(sceneNumberFromTitle('NPC 01 | Sirius'), null);
    assert.equal(isCompletedSceneEntry(scene(1)), true);
    assert.equal(isCompletedSceneEntry({ ...scene(1), content: '**Scene**\nNo result' }), false);
});

test('recent three always-on, older vector; keeps original lorebook pristine', () => {
    const source = book(55, 56, 57, 58);
    for (const uid of [55, 56, 57]) {
        source.entries[uid].constant = true;
        source.entries[uid].vectorized = false;
    }
    const baseline = structuredClone(source);
    const result = planNexusSceneRotation(source);
    assert.deepEqual(result.recentUids, [56, 57, 58]);
    assert.deepEqual(result.changes.map(change => change.uid), [55, 58]);
    assert.equal(result.proposedMemory.entries[55].constant, false);
    assert.equal(result.proposedMemory.entries[55].vectorized, true);
    for (const uid of [56, 57, 58]) {
        assert.equal(result.proposedMemory.entries[uid].constant, true);
        assert.equal(result.proposedMemory.entries[uid].vectorized, false);
    }
    assert.deepEqual(source, baseline);
    assert.deepEqual(result.proposedMemory.stlo, baseline.stlo);
    for (const entry of Object.values(result.proposedMemory.entries)) {
        assert.equal(entry.content, baseline.entries[entry.uid].content);
        assert.equal(entry.position, 1);
        assert.equal(entry.STMB_end, 14);
        assert.equal(entry.outletName, '');
    }
});

test('fewer than three Scenes remain always-on, no fake memories', () => {
    const result = planNexusSceneRotation(book(1, 2));
    assert.deepEqual(result.recentUids, [1, 2]);
    assert.deepEqual(result.olderUids, []);
});

test('keyword mode requires real keywords and never changes original keys', () => {
    const m = book(1, 2, 3, 4);
    assert.throws(() => planNexusSceneRotation(m, { olderMode: 'keyword' }), /no keywords/);
    m.entries[1].key = ['broken watch', 'Lyra'];
    const result = planNexusSceneRotation(m, { olderMode: 'keyword' });
    assert.equal(result.proposedMemory.entries[1].constant, false);
    assert.equal(result.proposedMemory.entries[1].vectorized, false);
    assert.equal(result.proposedMemory.entries[1].selective, true);
    assert.deepEqual(result.proposedMemory.entries[1].key, ['broken watch', 'Lyra']);
});

test('cannot silently convert Side Prompts or custom Outlet entries in a mixed Memory', () => {
    const m = book(1, 2);
    m.entries[90] = { uid: 90, comment: 'Status (STMB SidePrompt)', content: 'Health', constant: true };
    assert.throws(() => planNexusSceneRotation(m), /non-Scene/);
});

test('ambiguous numbering and disabled recent entries fail closed', () => {
    const m = book(1, 2, 3, 4);
    m.entries[4].comment = '003 - Duplicate';
    assert.throws(() => planNexusSceneRotation(m), /Ambiguous/);
    m.entries[4].comment = '004 - Correct';
    m.entries[4].disable = true;
    assert.throws(() => planNexusSceneRotation(m), /disabled/);
});

test('numbered Scene labels, not UIDs or field order, determine recent completion', () => {
    const m = {
        entries: {
            998: scene(998, 10),
            3: scene(3, 12),
            99: scene(99, 11),
            0: scene(0, 9),
        },
    };
    const result = planNexusSceneRotation(m);
    assert.deepEqual(result.recentUids, [998, 99, 3]);
    assert.equal(result.proposedMemory.entries[0].constant, false);
});

test('no edits for already-correct books', () => {
    const m = book(1, 2, 3, 4);
    for (const uid of [2, 3, 4]) {
        m.entries[uid].constant = true;
        m.entries[uid].vectorized = false;
    }
    assert.deepEqual(planNexusSceneRotation(m).changes, []);
});
