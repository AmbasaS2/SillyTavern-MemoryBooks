// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
// Reviewed, clone-only repair of TWO existing completed causal Scenes.
// This module NEVER writes a World Info file or calls a model.

import { isCompletedSceneEntry, sceneNumberFromTitle,
    planNexusSceneRotation } from './nexusSceneRotation.js';
import { SPLIT_ARCHIVE, SPLIT_FROM } from './nexusSceneSplitArchives.js';
import { hasRecognizedNexusStloSettings } from './nexusStloSettings.js';

const mergeField = 'STMB_slothSceneMerge';
const archiveField = 'STMB_slothSceneMergedInto';
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const assert = (ok, reason) => { if (!ok) throw new Error(reason); };
const references = [
    'STMB_canonicalEntryUid', 'STMB_canonicalLorebook', 'STMB_canonical',
    'disabledBySummaryId', 'stmbSourceEntryUids', 'STMB_inclusionGroup',
    'stmbSummary', 'stmbArc', 'stmbSummaryTier', 'STMB_sidePromptHistory',
];
const present = value => value !== null && value !== undefined &&
    value !== false && value !== '' && (!Array.isArray(value) || value.length > 0);
const safeUid = uid => Number.isSafeInteger(uid) && uid >= 0;

function entryRanges(entry) {
    const raw = Array.isArray(entry.STMB_sourceRanges) && entry.STMB_sourceRanges.length
        ? entry.STMB_sourceRanges : Number.isSafeInteger(entry.STMB_start) &&
            Number.isSafeInteger(entry.STMB_end) ? [[entry.STMB_start, entry.STMB_end]] : null;
    assert(Array.isArray(raw) && raw.length,
        'Scene UID ' + entry.uid + ' has no verifiable source ranges. Merge blocked.');
    if (Array.isArray(entry.STMB_sourceRanges) && entry.STMB_sourceRanges.length &&
        (entry.STMB_start !== undefined || entry.STMB_end !== undefined)) {
        assert(raw.length === 1 && entry.STMB_start === raw[0]?.[0] &&
            entry.STMB_end === raw[0]?.[1],
            'Scene UID ' + entry.uid + ' has conflicting legacy source boundaries.');
    }
    const output = raw.map(pair => {
        assert(Array.isArray(pair) && pair.length === 2 &&
            pair.every(Number.isSafeInteger) && pair[0] >= 0 && pair[1] >= pair[0],
            'Scene UID ' + entry.uid + ' has invalid source ranges.');
        return [...pair];
    }).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < output.length; i++) {
        assert(output[i][0] > output[i - 1][1],
            'Scene UID ' + entry.uid + ' contains overlapping source ranges.');
    }
    return output;
}

function flattenRanges(items) {
    const result = items.flat().sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const pair of result) {
        const prev = merged.at(-1);
        assert(!prev || pair[0] > prev[1], 'Selected Scenes share source messages. Merge blocked.');
        if (prev && pair[0] === prev[1] + 1) prev[1] = pair[1];
        else merged.push([...pair]);
    }
    return merged;
}

function validateBook(memory) {
    assert(record(memory?.entries), 'Memory World Info entries are missing.');
    assert(hasRecognizedNexusStloSettings(memory.stlo),
        'Memory has STLO root metadata; UID/ordering references need manual review.');
    const uidSet = new Set(), numberSet = new Set();
    for (const entry of Object.values(memory.entries)) {
        const uid = entry?.uid, number = sceneNumberFromTitle(entry?.comment);
        assert(safeUid(uid) && !uidSet.has(uid), 'Memory has missing or duplicate UIDs.');
        assert(number !== null && !numberSet.has(number) && isCompletedSceneEntry(entry),
            'Memory has an unnumbered, duplicate or incomplete Scene.');
        assert(!references.some(field => present(entry[field])) &&
            !present(entry.outletName) && Number(entry.position) !== 7 &&
            !present(entry.group),
            'Memory contains a Scene with unresolved canonical, STLO, group or Outlet references.');
        uidSet.add(uid);
        numberSet.add(number);
    }
    planNexusSceneRotation(memory);
    return [...Object.values(memory.entries)];
}

/** Read-only preflight. No AI decision is made about whether the plots match. */
export function inspectNexusSceneMerge(memory, sourceUids) {
    assert(Array.isArray(sourceUids) && sourceUids.length === 2 &&
        sourceUids.every(safeUid) && sourceUids[0] !== sourceUids[1],
        'Select exactly two different Scene UIDs.');
    const entries = validateBook(memory);
    const byUid = new Map(entries.map(entry => [entry.uid, entry]));
    const chosen = sourceUids.map(uid => {
        const entry = byUid.get(uid);
        assert(entry, 'Selected Scene UID ' + uid + ' does not exist.');
        assert(!entry[archiveField] && !entry[mergeField] && !entry[SPLIT_ARCHIVE] && !entry[SPLIT_FROM],
            'Nested or previously repaired Scenes need separate review.');
        assert(entry.disable !== true, 'Disabled Scene cannot be merged silently.');
        assert(typeof entry.STMB_chatId === 'string' && !!entry.STMB_chatId.trim(),
            'Scene UID ' + uid + ' has no stable source chat identity.');
        return entry;
    }).sort((a, b) => sceneNumberFromTitle(a.comment) -
        sceneNumberFromTitle(b.comment));
    assert(chosen[0].STMB_chatId === chosen[1].STMB_chatId,
        'Scenes belong to different chat/AU sources.');
    const allRanges = chosen.map(entry => entryRanges(entry));
    const ranges = flattenRanges(allRanges);
    for (const entry of entries) {
        if (sourceUids.includes(entry.uid) || entry.STMB_chatId !== chosen[0].STMB_chatId || entry[archiveField] || entry[SPLIT_ARCHIVE]) continue;
        const otherRanges = entryRanges(entry);
        for (const [a, b] of otherRanges) for (const [c, d] of ranges) {
            assert(b < c || d < a,
                'Other Scene UID ' + entry.uid + ' shares source messages with merged Scenes.');
        }
    }
    const survivor = chosen[1], retired = chosen[0];
    return {
        sourceUids: chosen.map(entry => entry.uid),
        survivorUid: survivor.uid,
        retiredUid: retired.uid,
        chatId: survivor.STMB_chatId,
        sourceRanges: ranges,
        sourceEntries: chosen.map(entry => structuredClone(entry)),
        independentUids: entries.filter(entry => !sourceUids.includes(entry.uid))
            .map(entry => entry.uid),
    };
}

/**
 * Stage one survivor + one disabled, fully preserved source archive.
 * A caller MUST separately obtain AI causal proof, final user review, a full
 * JSON download, current-server conflict check and verified save.
 */
export function stageNexusSceneMerge(memory, {
    sourceUids, title, content, keywords = [], sameCausalIncident = false,
    olderMode = 'vector',
} = {}) {
    assert(sameCausalIncident === true,
        'A reviewed causal reason is required before staging a Scene merge.');
    assert(typeof title === 'string' && title.trim() && title.length <= 180 &&
        !sceneNumberFromTitle(title), 'Merged Scene title must be an unnumbered event name.');
    assert(typeof content === 'string' && isCompletedSceneEntry({
        comment: '001 - Reviewed', content,
    }) && /(?:\*\*Timeline\*\*|#{1,6}\s+Timeline)/i.test(content),
    'Merged Scene requires Timeline / Scene / completed Result.');
    assert(Array.isArray(keywords) && keywords.every(x => typeof x === 'string'),
        'Merge keywords must be a string list.');
    const plan = inspectNexusSceneMerge(memory, sourceUids);
    const staged = structuredClone(memory);
    const surviving = Object.values(staged.entries).find(entry =>
        entry.uid === plan.survivorUid);
    const archived = Object.values(staged.entries).find(entry =>
        entry.uid === plan.retiredUid);
    const sequence = sceneNumberFromTitle(surviving.comment);
    // Retain the exact two input records on the resulting Scene (including
    // original UID, title, all custom fields, source segments and old bodies).
    surviving[mergeField] = {
        version: 1, sources: plan.sourceEntries.map(entry => structuredClone(entry)),
    };
    surviving.comment = String(sequence).padStart(3, '0') + ' - ' + title.trim();
    surviving.content = content;
    surviving.key = [...new Set([...plan.sourceEntries.flatMap(entry =>
        Array.isArray(entry.key) ? entry.key : []), ...keywords]
        .map(x => String(x || '').trim()).filter(Boolean))].slice(0, 64);
    surviving.STMB_sourceRanges = structuredClone(plan.sourceRanges);
    if (plan.sourceRanges.length !== 1) {
        delete surviving.STMB_start;
        delete surviving.STMB_end;
        surviving.STMB_discontiguous = true;
    } else {
        surviving.STMB_start = plan.sourceRanges[0][0];
        surviving.STMB_end = plan.sourceRanges[0][1];
        delete surviving.STMB_discontiguous;
    }
    archived.disable = true;
    archived.constant = false;
    archived.vectorized = false;
    archived.selective = false;
    archived[archiveField] = { version: 1, targetUid: surviving.uid };
    const rotated = planNexusSceneRotation(staged, { olderMode });
    return {
        proposedMemory: rotated.proposedMemory, plan,
        rotation: rotated.changes, originalSnapshots: structuredClone(plan.sourceEntries),
        changes: [
            { action: 'merge', uid: surviving.uid, fromUids: plan.sourceUids,
                before: plan.sourceEntries[1].content, after: surviving.content },
            { action: 'archive', uid: archived.uid, targetUid: surviving.uid,
                before: archived.content, after: archived.content },
        ],
    };
}
