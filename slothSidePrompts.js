// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only

import { classifyNexusLegacyTitle } from './nexusLegacyMigration.js';
import { isCompletedSceneEntry } from './nexusSceneRotation.js';

export const SLOTH_NO_SIDE_DETAILS = '[[NO_NEW_DETAILS]]';

export function normalizeSlothSideRecall(mode) {
    return ['constant', 'vector', 'keyword'].includes(mode) ? mode : 'disabled';
}

export function getSlothSideRecall(settings, id) {
    return normalizeSlothSideRecall(settings?.moduleSettings?.slothSideRecallModes?.[id]);
}

export function normalizeSlothSideKeywords(value) {
    const unique = new Map();
    const items = Array.isArray(value) ? value : String(value ?? '').split(/[,\n]/u);
    for (const item of items) {
        if (typeof item !== 'string') continue;
        const text = item.trim();
        if (!text || text.length > 100 || /[\r\n]/u.test(text)) continue;
        if (!unique.has(text.toLocaleLowerCase())) unique.set(text.toLocaleLowerCase(), text);
        if (unique.size === 8) break;
    }
    return [...unique.values()];
}

export const SLOTH_DIARY_ID = 'sloth-diary';

const DIARY = Object.freeze({
    id: SLOTH_DIARY_ID,
    name: "Diary (Don't read it)",
    text: `Maintain {{char}}'s PRIVATE DIARY as a first-person record written from inside the lived moment.

THIS CALL RETURNS THE COMPLETE REPLACEMENT BODY FOR THE SAME EXISTING SIDE ENTRY. Use the selected source, supplied context, and complete existing diary as the evidence boundary.

ENTRY SELECTION
For a normal update, add one dated entry when {{char}} has enough first-hand material to plausibly write it. For a rebuild with no existing diary, select up to four clearly established dates and include ordinary life alongside major turns when the source supports both. When the source supplies no qualifying first-hand material, return the existing diary unchanged.

VOICE AND TIME-LOCAL KNOWLEDGE
Write with {{char}}'s vocabulary, humor, restraint, bias, avoidance, blind spots, self-correction, and self-deception at that date. Keep knowledge and self-awareness at the level available then. Let meaning emerge through chosen details, omissions, evasions, and unfinished questions. Bring an existing entry that reads like a scene summary, relationship analysis, therapy note, or polished character arc back into immediate diary voice while preserving its grounded facts.

CONTENT BALANCE
Use the texture {{char}} would actually notice: school or work, weather, meals, errands, gossip, embarrassment, tiredness, minor irritation, odd observations, private jokes, unanswered questions, and important events. A sequence of entries should vary in subject, intensity, and length. Romantic, dramatic, erotic, tragic, or lyrical material appears in the proportion established by the source.

GROUNDING AND SHAPE
Ground every date, event, weather detail, meal, line of dialogue, thought, and motive in the supplied evidence. Keep background implicit unless {{char}} would naturally write it. Let entries stop where the thought naturally stops; titles and polished lessons appear only when they authentically belong to {{char}}'s diary practice.

Most entries run 40–140 words; a major entry may reach 200. Preserve the newest eight entries plus up to four older entries of exceptional continuing importance.

Return only the complete updated diary.`,
    responseFormat: `=== DIARY (DON'T READ IT) — {{char}} ===

## [Date or descriptive time marker]

[First-person diary entry in {{char}}'s private voice.]

[Repeat only for additional clearly established dates when rebuilding from a range.]

=== END DIARY (DON'T READ IT) — {{char}} ===`,
    builtin: true,
});

export function getSlothSidePresets(settings) {
    const entries = settings?.moduleSettings?.slothSidePresets;
    const custom = Array.isArray(entries) ? entries.filter(preset => preset &&
        typeof preset.id === 'string' && /^sloth-[a-f0-9-]+$/u.test(preset.id) &&
        typeof preset.name === 'string' && preset.name.trim() &&
        typeof preset.text === 'string' && preset.text.trim()).map(({id,name,text,responseFormat}) =>
            ({id,name,text,responseFormat:typeof responseFormat === 'string' ? responseFormat : ''})) : [];
    return [DIARY, ...custom];
}

export function getSlothSideDestination(settings, id, ref) {
    const module = settings?.moduleSettings;
    const book = module?.slothSideBooks?.[JSON.stringify([ref?.avatarUrl, id])] || '';
    const entry = module?.slothSideEntries?.[JSON.stringify([ref?.avatarUrl, ref?.fileName, id])];
    return { book, entry: book && entry?.book === book ? entry : null };
}

export function pickSlothSidePresets(settings, ids, ref) {
    const selected = new Set(ids);
    return getSlothSidePresets(settings).filter(preset => selected.has(preset.id))
        .map(preset => ({ ...preset, recall: getSlothSideRecall(settings, preset.id),
            destination: getSlothSideDestination(settings, preset.id, ref) }));
}

export function canContinueSlothSideEntry(entry, presetId, ref) {
    if (!entry || !Number.isSafeInteger(entry.uid) || typeof entry.content !== 'string' ||
        !entry.content.trim() || entry.outletName || Number(entry.position) === 7 ||
        entry.STMB_slothLegacyArchive || entry.STMB_sourceRanges?.length || isCompletedSceneEntry(entry) ||
        /^(?:Core Memory|Current Continuity)(?:$|\s*[-—–:])/iu.test(entry.comment || '') ||
        classifyNexusLegacyTitle(entry.comment)) return false;
    const history = entry.STMB_sidePromptHistory;
    const chatKey = JSON.stringify(['character', ref.avatarUrl, ref.fileName]);
    if (history && history.chatKey !== chatKey) return false;
    if (entry.STMB_slothSideNote) return history?.templateKey === presetId && history.titleSource === 'name';
    const chatId = entry.STMB_chatId || entry.STMB_sidePromptRegeneration?.chatId;
    return !chatId || String(chatId).replace(/\.jsonl$/iu, '') === ref.fileName;
}

export function slothSideBookName(character, names, suffix) {
    const label = String(character?.name || 'Character').normalize('NFC')
        .replace(/[<>:"/\\|?*\u0000-\u001F]/gu, ' ').replace(/\s+/gu, ' ').trim();
    const base = 'Little Things - ' + (Array.from(label).slice(0, 36).join('') || 'Character');
    const folded = value => String(value).normalize('NFKC').toLowerCase();
    return names.some(name => folded(name) === folded(base)) ? base + ' - ' + suffix : base;
}

export function slothSideBookOwner(book) {
    const marker = book?.extensions?.stmbSlothSideBook;
    return marker?.version === 1 && typeof marker.avatar === 'string' ? marker.avatar : '';
}

export function buildSlothSideReference(scene, nexus) {
    let remaining = 24000;
    const references = [];
    const primary = title => /^(?:Core Memory|Current Continuity)(?:$|\s*[-—–:])/i.test(title) || !!classifyNexusLegacyTitle(title);
    const active = Object.values(nexus?.entries || {}).filter(entry => entry && !entry.disable &&
        Number(entry.position) !== 7 && !entry.outletName && !entry.STMB_sidePromptHistory &&
        typeof entry.content === 'string' && entry.content.trim());
    active.sort((a,b) => Number(primary(b.comment)) - Number(primary(a.comment)));
    for (const entry of active) {
        if (!remaining) break;
        const content = entry.content.slice(0, remaining);
        remaining -= content.length;
        references.push({title: String(entry.comment ?? '').slice(0, 160), content});
    }
    return JSON.stringify({savedScene: String(scene?.content ?? ''), nexus: references});
}
