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
    // Cache only the byte measurements, never approximate tokenizer counts.
    // Bounded by both entry count and maximum cacheable message length.
    const cache = new Map();
    function measure(text) {
        const cached = cache.get(text);
        if (cached) return cached;
        const measured = [encoder.encode(text).length, encoder.encode(JSON.stringify(text)).length];
        if (text.length <= 8192) {
            if (cache.size >= 256) cache.delete(cache.keys().next().value);
            cache.set(text, measured);
        }
        return measured;
    }
    // A byte-level tiktoken encoding cannot exceed the UTF-8 byte length plus
    // the host's fixed single-system-message overhead. Its error fallback
    // estimates the JSON body; count that too (including escaped characters).
    return messages => {
        let bytes = 0, jsonBytes = 0;
        for (const message of messages) {
            const text = String(message.mes ?? '');
            const [length, escapedLength] = measure(text);
            bytes += length;
            jsonBytes += escapedLength;
        }
        const separators = Math.max(0,messages.length-1);
        return Math.max(bytes+separators+32,Math.ceil((jsonBytes+2*separators+64)/3.35));
    };
}

export function getAutomaticCheckpointThrough(previous, books) {
    const sameBooks = !!previous?.books && previous.books.nexus === books.nexus && previous.books.memory === books.memory;
    return sameBooks && Number.isSafeInteger(previous.through) ? previous.through : -1;
}

export async function automaticCollectionDue({source,previous,books,mode,threshold,countTokens,upperBound,onReading}) {
    const through = getAutomaticCheckpointThrough(previous, books);
    const pending = source.filter(message => message.id > through);
    const report = (count, exact) => {
        onReading?.({count,exact});
        return count >= threshold;
    };
    if (!pending.length) return report(0,true);
    if (mode === 'messages') return report(pending.length,true);
    if (upperBound) {
        const bound = upperBound(pending);
        if (bound < threshold) return report(bound,false);
    }
    return report(await countTokens(pending.map(message => message.mes).join('\n')),true);
}
