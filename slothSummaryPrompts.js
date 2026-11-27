// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only

import { SLOTH_DEFAULT_SUMMARY_PROMPT } from './nexusSlothScenePrompt.js';
import { SLOTH_R07_DISPLAY_TEXT, SLOTH_R07_LEGACY_DISPLAY_TEXT } from './slothR07Prompt.js';

export const SLOTH_BUILTIN_PROMPT_ID = 'builtin';

export function isR07SummaryPreset(preset) {
    if (preset?.id === SLOTH_BUILTIN_PROMPT_ID || preset?.writingMode === 'r07') return true;
    const text = typeof preset?.text === 'string' ? preset.text.trim() : '';
    return [SLOTH_R07_DISPLAY_TEXT, SLOTH_R07_LEGACY_DISPLAY_TEXT]
        .some(original => text === original || text.startsWith(original + '\n\n'));
}

export function getSlothSummaryPresets(settings) {
    const presets = settings?.moduleSettings?.slothSummaryPresets;
    return Array.isArray(presets) ? presets.filter(preset => preset &&
        typeof preset.id === 'string' && preset.id !== SLOTH_BUILTIN_PROMPT_ID &&
        typeof preset.name === 'string' && preset.name.trim() &&
        typeof preset.text === 'string' && preset.text.trim())
        .map(preset => isR07SummaryPreset(preset) ? {...preset, writingMode:'r07'} : preset) : [];
}

export function getActiveSlothSummaryPreset(settings) {
    const params = settings?.moduleSettings;
    const selected = getSlothSummaryPresets(settings).find(preset => preset.id === params.slothSummaryPresetId);
    // The source layout and collection contract belong to the preset's origin,
    // not to a fragile exact-text comparison after every edit.
    if (selected) {
        if (!isR07SummaryPreset(selected)) return selected;
        const writing = selected.text.trim();
        const original = writing === SLOTH_R07_DISPLAY_TEXT || writing === SLOTH_R07_LEGACY_DISPLAY_TEXT;
        return {...selected, text:original ? SLOTH_DEFAULT_SUMMARY_PROMPT : selected.text,
            usesR07Writing:true, r07WritingText:writing === SLOTH_R07_DISPLAY_TEXT ? null : writing};
    }
    const oldText = typeof params?.slothCollectionPrompt === 'string' ? params.slothCollectionPrompt.trim() : '';
    if (oldText) return {id:'previous', text:SLOTH_DEFAULT_SUMMARY_PROMPT + '\n\n' + oldText};
    return {id:SLOTH_BUILTIN_PROMPT_ID,text:SLOTH_DEFAULT_SUMMARY_PROMPT};
}
