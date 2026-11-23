// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
// Read-only AI proposal boundary: model output is NEVER authority to merge.

import { inspectNexusSceneMerge } from './nexusSceneMerge.js';
import { isCompletedSceneEntry, planNexusSceneRotation,
    sceneNumberFromTitle } from './nexusSceneRotation.js';
import { SPLIT_ARCHIVE, SPLIT_FROM } from './nexusSceneSplitArchives.js';

const assert = (value, message) => { if (!value) throw new Error(message); };

export function buildNexusSceneMergeCatalog(memory, chatIds) {
    assert(Array.isArray(chatIds) && chatIds.some(id => typeof id === 'string' && id.trim()),
        'A stable source chat identity is required.');
    // Fail on invalid/incomplete history before exposing anything to an AI.
    planNexusSceneRotation(memory);
    const allowed = new Set(chatIds.filter(Boolean).map(String));
    const entries = Object.values(memory.entries).filter(entry =>
        allowed.has(String(entry.STMB_chatId || '')) &&
        !entry.disable && !entry.STMB_slothSceneMergedInto && !entry.STMB_slothSceneMerge &&
        !entry[SPLIT_ARCHIVE] && !entry[SPLIT_FROM] &&
        isCompletedSceneEntry(entry));
    const catalog = entries.map(entry => ({
        uid: entry.uid,
        title: entry.comment,
        number: sceneNumberFromTitle(entry.comment),
        content: entry.content,
        chatId: entry.STMB_chatId,
        ranges: Array.isArray(entry.STMB_sourceRanges) ? entry.STMB_sourceRanges :
            Number.isSafeInteger(entry.STMB_start) && Number.isSafeInteger(entry.STMB_end)
                ? [[entry.STMB_start, entry.STMB_end]] : [],
    })).sort((a, b) => a.number - b.number);
    if (JSON.stringify(catalog).length > 60000) {
        throw new Error('Existing Scene texts are too large for a safe single AI merge scan. Nothing changed.');
    }
    return catalog;
}

export function validateNexusSceneMergeCandidates(memory, catalog, response) {
    assert(response && !Array.isArray(response) && Array.isArray(response.candidates),
        'Scene merge AI must return a candidates array.');
    assert(response.candidates.length <= 4,
        'Scene merge AI proposed too many pairs for review.');
    const allowed = new Map(catalog.map(entry => [entry.uid, entry]));
    const seen = new Set();
    return response.candidates.map(candidate => {
        assert(candidate && Array.isArray(candidate.uids) && candidate.uids.length === 2 &&
            candidate.uids.every(Number.isSafeInteger) && candidate.uids[0] !== candidate.uids[1] &&
            candidate.uids.every(uid => allowed.has(uid)),
        'Scene merge proposal contains an unknown or invalid pair.');
        assert(typeof candidate.reason === 'string' && candidate.reason.trim().length >= 12 &&
            candidate.reason.length <= 1200 && Array.isArray(candidate.evidence) &&
            candidate.evidence.length >= 1 && candidate.evidence.length <= 6 &&
            candidate.evidence.every(line => typeof line === 'string' &&
                !!line.trim() && line.length <= 400),
        'Scene merge proposal is missing a specific causal reason and evidence.');
        const plan = inspectNexusSceneMerge(memory, candidate.uids);
        assert(allowed.get(plan.sourceUids[0]).chatId === plan.chatId &&
            allowed.get(plan.sourceUids[1]).chatId === plan.chatId,
        'Scene merge proposal crosses a source chat or AU.');
        const pair = plan.sourceUids.join(':');
        assert(!seen.has(pair), 'Scene merge AI proposed the same pair twice.');
        seen.add(pair);
        return {
            sourceUids: plan.sourceUids,
            titles: plan.sourceUids.map(uid => allowed.get(uid).title),
            reason: candidate.reason.trim(),
            evidence: candidate.evidence.map(line => line.trim()),
            plan,
        };
    });
}
