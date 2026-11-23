// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only

// The current STLO fork stores these book-level options at the World Info root.
// Unknown data may encode entry references and requires a separate review.
const scalarOptions = new Set([
    'priority', 'budget', 'budgetMode', 'orderAdjustment', 'orderAdjustmentGroupOnly',
    'onlyWhenSpeaking', 'randomTrim', 'vectorThreshold', 'vectorThresholdEnabled',
]);

export function hasRecognizedNexusStloSettings(settings) {
    if (settings == null) return true;
    if (typeof settings !== 'object' || Array.isArray(settings)) return false;
    return Object.entries(settings).every(([key, value]) => {
        if (key === 'characterOverrides') {
            return value && typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length;
        }
        return scalarOptions.has(key) && (value === null || ['string', 'boolean', 'number'].includes(typeof value));
    });
}

export function hasNeutralNexusStloSettings(settings) {
    return hasRecognizedNexusStloSettings(settings) && (!settings || (
        (settings.priority == null || settings.priority === 3) &&
        (settings.budget == null || settings.budget === 0) &&
        (settings.budgetMode == null || settings.budgetMode === 'default') &&
        (settings.orderAdjustment == null || settings.orderAdjustment === 0) &&
        !settings.onlyWhenSpeaking && !settings.randomTrim && !settings.vectorThresholdEnabled
    ));
}
