// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only

export const SLOTH_AUTOMATIC_DEFAULTS = Object.freeze({
    slothAutoEnabled: false,
    slothAutoMode: 'tokens',
    slothAutoTokens: 50000,
    slothAutoMessages: 50,
});

export function getSlothAutomaticSettings(settings) {
    const params = settings?.moduleSettings ?? {};
    const mode = params.slothAutoMode === 'messages' ? 'messages' : 'tokens';
    const max = mode === 'tokens' ? 1000000 : 9999;
    const field = mode === 'tokens' ? 'slothAutoTokens' : 'slothAutoMessages';
    const raw = Number(params[field]);
    const threshold = Number.isSafeInteger(raw) && raw >= 1 ? Math.min(raw,max) : SLOTH_AUTOMATIC_DEFAULTS[field];
    return {enabled:params.slothAutoEnabled === true,mode,field,threshold,max};
}

export async function automaticCollectionDue({source,previous,books,mode,threshold,countTokens}) {
    const sameBooks = previous?.books?.nexus === books.nexus && previous?.books?.memory === books.memory;
    const through = sameBooks && Number.isSafeInteger(previous.through) ? previous.through : -1;
    const pending = source.filter(message => message.id > through);
    if (!pending.length) return false;
    if (mode === 'messages') return pending.length >= threshold;
    return await countTokens(pending.map(message => message.mes).join('\n')) >= threshold;
}
