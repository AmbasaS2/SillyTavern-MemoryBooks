// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only

import { classifyNexusLegacyTitle } from './nexusLegacyMigration.js';

export const SLOTH_NO_SIDE_DETAILS = '[[NO_NEW_DETAILS]]';

export function normalizeSlothSideRecall(mode) {
    return mode === 'vector' || mode === 'keyword' ? mode : 'disabled';
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

const LITTLE_THINGS = Object.freeze({
    id: 'sloth-little-things',
    name: 'Little Things',
    text: [
        'Keep small details about the scene’s main characters: a stated taste, recurring habit, private nickname or joke, or the personal meaning of an ordinary object. Add at most three new details total and skip passing scenery, incidental reactions and side-character backstory.',
        'Before using a detail, check the saved Scene, Nexus reference and prior notes for the same fact in any wording. If present there, omit it even if a different quote could illustrate it. Skip plot, core facts, relationship changes, promises and current conditions. New details must come from the selected scene.',
        'Keep prior notes and add one brief English bullet per qualifying detail. Name the character and describe the concrete observation. Say “in this scene” for a one-off action; call it a habit only if the source explicitly makes it recurring. Use names from narration or dialogue, ignoring names found only in private-note labels. Preserve an exact short phrase only when it is the detail.',
        'If the source adds nothing worth recording, return exactly '+SLOTH_NO_SIDE_DETAILS+'.',
    ].join('\n\n'),
    builtin: true,
});

export function getSlothSidePresets(settings) {
    const entries = settings?.moduleSettings?.slothSidePresets;
    const custom = Array.isArray(entries) ? entries.filter(preset => preset &&
        typeof preset.id === 'string' && /^sloth-[a-f0-9-]+$/u.test(preset.id) &&
        typeof preset.name === 'string' && preset.name.trim() &&
        typeof preset.text === 'string' && preset.text.trim()).map(({id,name,text,responseFormat}) =>
            ({id,name,text,responseFormat:typeof responseFormat === 'string' ? responseFormat : ''})) : [];
    return [LITTLE_THINGS, ...custom];
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
