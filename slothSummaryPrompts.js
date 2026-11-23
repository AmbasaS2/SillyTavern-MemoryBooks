// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only

import { SLOTH_DEFAULT_SUMMARY_PROMPT } from './nexusSlothScenePrompt.js';

export const SLOTH_BUILTIN_PROMPT_ID = 'builtin';

export function getSlothSummaryPresets(settings) {
    const presets = settings?.moduleSettings?.slothSummaryPresets;
    return Array.isArray(presets) ? presets.filter(preset => preset &&
        typeof preset.id === 'string' && preset.id !== SLOTH_BUILTIN_PROMPT_ID &&
        typeof preset.name === 'string' && preset.name.trim() &&
        typeof preset.text === 'string' && preset.text.trim()) : [];
}

export function getActiveSlothSummaryPreset(settings) {
    const params = settings?.moduleSettings;
    const selected = getSlothSummaryPresets(settings).find(preset => preset.id === params.slothSummaryPresetId);
    if (selected) return selected;
    const oldText = typeof params?.slothCollectionPrompt === 'string' ? params.slothCollectionPrompt.trim() : '';
    if (oldText) return {id:'previous', text:SLOTH_DEFAULT_SUMMARY_PROMPT + '\n\n' + oldText};
    return {id:SLOTH_BUILTIN_PROMPT_ID,text:SLOTH_DEFAULT_SUMMARY_PROMPT};
}
