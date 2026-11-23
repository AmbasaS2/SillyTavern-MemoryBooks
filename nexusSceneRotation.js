// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
//
// Nexus / Memory mode: the pure, pre-save Scene activation planner.
// It does not read chats, write World Info, trigger AI, or hide messages.
import {SPLIT_ARCHIVE, validateSplitArchives} from './nexusSceneSplitArchives.js';

const NUMBERED_SCENE = /^\s*(?:\[(\d+)\]|(\d+))\s*[-–—]/;
const NAMED_SCENE = /^\s*Scene\s*#?(\d+)(?:\b|\s*[-–—:])/i;
const SCENE_HEADER = /^\s*(?:\*\*Scene\*\*|#{1,6}\s+Scene)\s*$/im;
const RESULT_HEADER = /^\s*(?:\*\*Result\*\*|#{1,6}\s+Result)\s*$/im;

export function isNexusMemoryBookName(name) {
    return /^Memory(?:$|[\s_-])/i.test(String(name || '').trim());
}

export function sceneNumberFromTitle(title) {
    const text = String(title || '');
    const match = text.match(NUMBERED_SCENE) || text.match(NAMED_SCENE);
    const number = match ? Number(match[1] || match[2]) : NaN;
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function isCompletedSceneEntry(entry) {
    if (!entry || typeof entry !== 'object') return false;
    const body = String(entry.content || '');
    if (!sceneNumberFromTitle(entry.comment) || !SCENE_HEADER.test(body)) return false;
    const resultMarker = RESULT_HEADER.exec(body);
    return !!resultMarker && !!body.slice(resultMarker.index + resultMarker[0].length).trim();
}

function requireValidUid(entry) {
    const uid = Number(entry?.uid);
    if (!Number.isSafeInteger(uid) || uid < 0) {
        throw new Error('Memory has a Scene without a valid non-negative UID.');
    }
    return uid;
}

const MERGED_INTO = 'STMB_slothSceneMergedInto';
const MERGE_HISTORY = 'STMB_slothSceneMerge';

function validateMergedArchives(entries) {
    for (const entry of entries) {
        const hasArchive = Object.prototype.hasOwnProperty.call(entry, MERGED_INTO);
        const hasHistory = Object.prototype.hasOwnProperty.call(entry, MERGE_HISTORY);
        if (!hasArchive && !hasHistory) continue;
        if (hasArchive) {
            const archive = entry[MERGED_INTO];
            const target = entries.find(item => item?.uid === archive?.targetUid);
            const history = target?.[MERGE_HISTORY];
            const previous = Array.isArray(history?.sources)
                ? history.sources.find(item => item?.uid === entry.uid) : null;
            if (archive?.version !== 1 || !target || !previous ||
                history.version !== 1 || history.sources.length !== 2 ||
                entry.disable !== true || entry.constant !== false ||
                entry.vectorized !== false || entry.selective !== false ||
                entry.comment !== previous.comment || entry.content !== previous.content) {
                throw new Error('Broken merged Scene archive (UID ' + entry.uid + ').');
            }
            for (const [field, oldValue] of Object.entries(previous)) {
                if (['disable', 'constant', 'vectorized', 'selective'].includes(field)) continue;
                if (JSON.stringify(entry[field]) !== JSON.stringify(oldValue)) {
                    throw new Error('Merged Scene archive metadata mismatch: ' + field);
                }
            }
        } else {
            const history = entry[MERGE_HISTORY];
            if (history?.version !== 1 || !Array.isArray(history.sources) ||
                history.sources.length !== 2 || !history.sources.some(item => item.uid === entry.uid) ||
                history.sources.filter(item => item.uid !== entry.uid).length !== 1 ||
                !entries.some(item => item?.uid !== entry.uid &&
                    item?.[MERGED_INTO]?.targetUid === entry.uid)) {
                throw new Error('Merged Scene history has missing source/archived UID ' + entry.uid + '.');
            }
        }
    }
}

function requireKeywords(entry, uid) {
    if (!Array.isArray(entry.key) || !entry.key.some(value => String(value || '').trim())) {
        throw new Error(`Scene ${uid} has no keywords. Keyword recall would make this past Scene unreachable.`);
    }
}

/**
 * Plan the smallest World Info edit for a dedicated Memory book.
 *
 * Scene labels (001, 002, ...) are an explicit collector-maintained completion
 * sequence, NOT World Info UIDs, array order or in-world calendar dates.
 * Ambiguous/un-numbered entries fail closed until the user fixes their titles.
 *
 * Important: this is a pure staging operation. A caller must review/save
 * the proposed book using the current World Info revision, not stale data.
 */
export function planNexusSceneRotation(memory, { olderMode = 'vector', keepRecent = 3 } = {}) {
    if (!memory || typeof memory !== 'object' || !memory.entries || Array.isArray(memory.entries)) {
        throw new Error('Memory must be a World Info object with entries.');
    }
    if (olderMode !== 'vector' && olderMode !== 'keyword') {
        throw new Error('Unsupported older Scene recall mode.');
    }
    if (!Number.isSafeInteger(keepRecent) || keepRecent < 1) {
        throw new Error('keepRecent must be a positive integer.');
    }

    const entries = Object.values(memory.entries);
    validateMergedArchives(entries);
    validateSplitArchives(entries);
    const numbered = [];
    const usedUids = new Set();
    const usedNumbers = new Set();
    for (const entry of entries) {
        const uid = requireValidUid(entry);
        const sequence = sceneNumberFromTitle(entry.comment);
        if (!isCompletedSceneEntry(entry)) {
            throw new Error(`Memory contains an incomplete or non-Scene entry (UID ${uid}).`);
        }
        if (usedUids.has(uid) || usedNumbers.has(sequence)) {
            throw new Error(`Ambiguous Memory Scene UID or sequence (UID ${uid}, Scene ${sequence}).`);
        }
        usedUids.add(uid);
        usedNumbers.add(sequence);
        if (!Object.prototype.hasOwnProperty.call(entry, MERGED_INTO) &&
            !Object.prototype.hasOwnProperty.call(entry, SPLIT_ARCHIVE)) numbered.push({ uid, sequence });
    }

    numbered.sort((a, b) => a.sequence - b.sequence);
    const recentUids = numbered.slice(-keepRecent).map(x => x.uid);
    const recent = new Set(recentUids);
    const staged = structuredClone(memory);
    const changes = [];
    for (const entry of Object.values(staged.entries)) {
        if (Object.prototype.hasOwnProperty.call(entry, MERGED_INTO) ||
            Object.prototype.hasOwnProperty.call(entry, SPLIT_ARCHIVE)) continue; // archived original retained only for lossless recovery
        const uid = requireValidUid(entry);
        const old = Object.values(memory.entries).find(item => Number(item?.uid) === uid);
        const alwaysOn = recent.has(uid);
        if (alwaysOn && entry.disable === true) {
            throw new Error(`Scene ${uid} is disabled; it cannot be silently enabled.`);
        }
        if (!alwaysOn && olderMode === 'keyword') requireKeywords(entry, uid);
        entry.constant = alwaysOn;
        entry.vectorized = !alwaysOn && olderMode === 'vector';
        if (!alwaysOn && olderMode === 'keyword') entry.selective = true;
        if (entry.constant !== old.constant || entry.vectorized !== old.vectorized ||
            entry.selective !== old.selective) {
            changes.push({
                uid,
                title: String(entry.comment),
                from: { constant: old.constant, vectorized: old.vectorized, selective: old.selective },
                to: { constant: entry.constant, vectorized: entry.vectorized, selective: entry.selective },
            });
        }
    }
    return {
        proposedMemory: staged,
        recentUids,
        olderUids: numbered.slice(0, -keepRecent).map(x => x.uid),
        changes,
    };
}
