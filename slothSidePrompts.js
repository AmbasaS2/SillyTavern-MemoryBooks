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
export const SLOTH_CREATE_SIDE_BOOK = ':little-things:';

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

// Optional reader-facing records; never participate in the Nexus collector.
export const SLOTH_NPC_DIRECTORY_ID = 'sloth-npc-directory';
export const SLOTH_QUOTES_ID = 'sloth-memorable-quotes';

const NPC_DIRECTORY = Object.freeze({
    id: SLOTH_NPC_DIRECTORY_ID,
    name: 'NPC Directory',
    text: `Maintain a reader-facing NPC DIRECTORY for the selected story, independent of the operative Nexus NPC records.

Return the complete updated directory using only the selected source as new evidence and the existing directory as its baseline. The supplied Scene and Nexus are reference context, not a reason to duplicate their analyses. Include named or uniquely identifiable supporting characters encountered or explicitly established in the selected source, including minor or one-off characters worth recognizing later. Exclude {{char}} and {{user}}. Merge aliases only when identity is established; preserve distinct people and established names. Keep unaffected entries and their order, append new people in first-encounter order, and correct only the details that new evidence changes.

For each person, record their name or established identifier, role or connection, a concise distinguishing detail (appearance, manner, speech, occupation, or a memorable action), and where or in what situation they were encountered if established. Distinguish firsthand facts from reports and uncertainties. Preserve specific details without inventing profiles, motives, future relevance, relationships, or knowledge. Omit unsupported fields. Do not copy the ongoing obligations, tactical knowledge boundaries, or relationship analysis maintained by Nexus. If no qualifying information changes the directory, return the existing directory unchanged (or [[NO_NEW_DETAILS]] when empty).

Return only the complete directory.`,
    responseFormat: `=== NPC DIRECTORY ===

## [Name or established identifier]
- Role / connection: [grounded description]
- Distinguishing details: [brief supported details]
- Encounter: [grounded situation or time marker, if established]

[Repeat for each distinct person. Omit unsupported fields.]

=== END NPC DIRECTORY ===`,
    builtin: true,
});

const MEMORABLE_QUOTES = Object.freeze({
    id: SLOTH_QUOTES_ID,
    name: 'Memorable Quotes',
    text: `Maintain a reader-facing collection of memorable actual dialogue from the selected story.

Return the complete updated collection. Preserve every existing quote exactly, in its existing order, and append only distinct lines from the selected source that are worth rereading: characteristic humor, banter, nicknames in context, unusually revealing statements, emotional admissions, promises, or other distinctive lines. Keep the speaker, addressee if established, original language, punctuation, and wording verbatim. Use the actual spoken or written line, not paraphrased dialogue or invented reconstruction from a Scene or Nexus summary. Add one brief factual context line only when supported. Select for distinctiveness, not a fixed quota; ordinary filler does not qualify. Do not merge different lines or repeat a previously recorded quote. Preserve differences in character voice and emotional intensity. When there is no qualifying new quote, return the existing collection unchanged (or [[NO_NEW_DETAILS]] when empty).

Return only the complete updated collection.`,
    responseFormat: `=== MEMORABLE QUOTES ===

## [Speaker]
"[Exact dialogue from the source]"
Context: [brief factual situation; addressee if known]

[Repeat for each distinct quotation, preserving previous entries.]

=== END MEMORABLE QUOTES ===`,
    builtin: true,
});

export function getSlothSidePresets(settings) {
    const entries = settings?.moduleSettings?.slothSidePresets;
    const custom = Array.isArray(entries) ? entries.filter(preset => preset &&
        typeof preset.id === 'string' && /^sloth-[a-f0-9-]+$/u.test(preset.id) &&
        typeof preset.name === 'string' && preset.name.trim() &&
        typeof preset.text === 'string' && preset.text.trim()).map(({id,name,text,responseFormat}) =>
            ({id,name,text,responseFormat:typeof responseFormat === 'string' ? responseFormat : ''})) : [];
    return [DIARY, NPC_DIRECTORY, MEMORABLE_QUOTES, ...custom];
}

export function getSlothSideDestination(settings, id, ref) {
    const module = settings?.moduleSettings;
    const choice = module?.slothSideBooks?.[JSON.stringify([ref?.avatarUrl, id])];
    const create = choice === SLOTH_CREATE_SIDE_BOOK;
    const book = !create && typeof choice === 'string' ? choice : '';
    const entry = module?.slothSideEntries?.[JSON.stringify([ref?.avatarUrl, ref?.fileName, id])];
    return { book, create, entry: book && entry?.book === book ? entry : null };
}

export function isSlothSideLinked(settings, id, ref) {
    return ref?.type === 'character' && !!ref.avatarUrl &&
        settings?.moduleSettings?.slothSideCharacterLinks?.[JSON.stringify([ref.avatarUrl, id])] === true;
}

export function getRunnableSlothSidePresets(settings, ref) {
    return getSlothSidePresets(settings).filter(preset => isSlothSideLinked(settings, preset.id, ref))
        .map(preset => ({ ...preset, recall: getSlothSideRecall(settings, preset.id),
            destination: getSlothSideDestination(settings, preset.id, ref) }))
        .filter(({ destination }) => destination.book || destination.create);
}

export function pickSlothSidePresets(settings, ids, ref) {
    const selected = new Set(ids);
    return getRunnableSlothSidePresets(settings, ref).filter(preset => selected.has(preset.id));
}

export function slothSideStoryKey(ref, roles) {
    return ref?.avatarUrl && roles?.nexus && roles?.memory && roles.nexus!==roles.memory
        ? JSON.stringify([ref.avatarUrl,roles.nexus,roles.memory]) : '';
}
export function sameSlothSideOwner(history, ref) {
    try {
        const key=JSON.parse(history?.chatKey);
        return Array.isArray(key)&&key[0]==='character'&&key[1]===ref.avatarUrl;
    }catch{return false;}
}
export function canContinueSlothSideEntry(entry, presetId, ref, {storyKey='',allowLegacyInheritance=false}={}) {
    if (!entry || !Number.isSafeInteger(entry.uid) || typeof entry.content !== 'string' ||
        !entry.content.trim() || entry.outletName || Number(entry.position) === 7 ||
        entry.STMB_slothLegacyArchive || entry.STMB_sourceRanges?.length || isCompletedSceneEntry(entry) ||
        /^(?:Core Memory|Current Continuity)(?:$|\s*[-—–:])/iu.test(entry.comment || '') ||
        classifyNexusLegacyTitle(entry.comment)) return false;
    const history = entry.STMB_sidePromptHistory;
    const chatKey = JSON.stringify(['character', ref.avatarUrl, ref.fileName]);
    if (history?.storyKey) return history.storyKey===storyKey && history.templateKey===presetId && history.titleSource==='name';
    if (history && history.chatKey !== chatKey && !(allowLegacyInheritance && sameSlothSideOwner(history,ref) && history.templateKey===presetId && history.titleSource==='name')) return false;
    if (entry.STMB_slothSideNote) return history?.templateKey === presetId && history.titleSource === 'name';
    const chatId = entry.STMB_chatId || entry.STMB_sidePromptRegeneration?.chatId;
    return !chatId || String(chatId).replace(/\.jsonl$/iu, '') === ref.fileName ||
        !!(allowLegacyInheritance && history && sameSlothSideOwner(history,ref) && history.templateKey===presetId);
}

export function slothSideBookName(character, names = [], suffix = '', bookSuffix = 'MemoryBook Side Prompt') {
    const label = String(character?.name || 'Character').normalize('NFC')
        .replace(/[<>:"/\\|?*\u0000-\u001F]/gu, ' ').replace(/\s+/gu, ' ').trim();
    const base = (Array.from(label).slice(0, 36).join('') || 'Character') + '-' + bookSuffix;
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
