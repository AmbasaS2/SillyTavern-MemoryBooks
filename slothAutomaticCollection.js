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

export function createAutomaticTokenCounter(countTokens) {
    let lastText, lastResult;
    return async text => {
        if (text !== lastText || !lastResult) {
            lastText = text;
            const pending = Promise.resolve().then(() => countTokens(text));
            lastResult = pending;
            pending.catch(() => { if (lastResult === pending) lastResult = null; });
        }
        return await lastResult;
    };
}

export function createAutomaticTokenUpperBound() {
    const encoder = new TextEncoder();
    // A byte-level tiktoken encoding cannot exceed the UTF-8 byte length plus
    // the host's fixed single-system-message overhead. Its error fallback
    // estimates the JSON body; count that too (including escaped characters).
    return messages => {
        let bytes = 0, jsonBytes = 0;
        for (const message of messages) {
            const text = String(message.mes ?? '');
            bytes += encoder.encode(text).length;
            jsonBytes += encoder.encode(JSON.stringify(text)).length;
        }
        const separators = Math.max(0,messages.length-1);
        return Math.max(bytes+separators+32,Math.ceil((jsonBytes+2*separators+64)/3.35));
    };
}

export async function automaticCollectionDue({source,previous,books,mode,threshold,countTokens,upperBound}) {
    const sameBooks = !!previous?.books && previous.books.nexus === books.nexus && previous.books.memory === books.memory;
    const through = sameBooks && Number.isSafeInteger(previous.through) ? previous.through : -1;
    const pending = source.filter(message => message.id > through);
    if (!pending.length) return false;
    if (mode === 'messages') return pending.length >= threshold;
    if (upperBound && upperBound(pending) < threshold) return false;
    return await countTokens(pending.map(message => message.mes).join('\n')) >= threshold;
}
