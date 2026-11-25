// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
// Source checks for event windows and explicit legacy reconciliation. Pure; never writes World Info.

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value);

function indexSource(messages) {
    assert(Array.isArray(messages) && messages.length, 'Nexus evidence requires original chat messages.');
    const byId=new Map();
    for(const message of messages){
        assert(Number.isSafeInteger(message?.id) && message.id>=0 &&
            typeof message.mes==='string' && message.mes.trim() &&
            !byId.has(message.id), 'Nexus evidence source has missing or repeated message IDs.');
        byId.set(message.id,message);
    }
    return byId;
}

const normalizeQuotePunctuation = text => text.replace(/[‘’]/g,"'").replace(/[“”]/g,'"');

function recoverLiteralQuote(source, quote) {
    const candidates = [quote, quote.replace(/[.,!?;:…，。！？；：]+$/u,'').trimEnd()];
    for (const candidate of candidates) {
        if (candidate.length >= 8 && source.includes(candidate)) return candidate;
    }
    // Some providers regularize curly quotes or the whitespace of prose.
    // Accept this only when it identifies one unique contiguous original span.
    let normalized = '';
    const starts = [], ends = [];
    for (const {0:part,index} of source.matchAll(/\s+|./g)) {
        normalized += /^\s/u.test(part) ? ' ' : normalizeQuotePunctuation(part);
        starts.push(index);
        ends.push(index+part.length);
    }
    for (const candidate of candidates) {
        const comparable = normalizeQuotePunctuation(candidate).replace(/\s+/gu,' ');
        if (comparable.length < 8) continue;
        const offset = normalized.indexOf(comparable);
        if (offset >= 0 && normalized.indexOf(comparable,offset+1) === -1) {
            return source.slice(starts[offset],ends[offset+comparable.length-1]);
        }
    }
    return '';
}
function verifyEvidence(items,source,label) {
    assert(Array.isArray(items) && items.length>=1 && items.length<=8,
        label+' requires one to eight direct source quotes.');
    return items.map((entry,index)=>{
        assert(isRecord(entry) && Number.isSafeInteger(entry.messageId) &&
            typeof entry.quote==='string' && entry.quote===entry.quote.trim() &&
            entry.quote.length>=8 && entry.quote.length<=400,
            label+' evidence '+(index+1)+' needs an exact, short source quote and message ID.');
        const messageId = entry.messageId;
        const literal = recoverLiteralQuote(source.get(messageId)?.mes ?? '',entry.quote);
        assert(literal.length>=8 && literal.length<=400,
            label+' cites a quote missing from original message #'+entry.messageId+'.');
        return {messageId,quote:literal};
    });
}

export function isAllowedContinuityRetirement(edit) {
    return edit?.kind==='continuity' && edit.action==='replace_exact' && edit.text==='' &&
        ['observed_resolution','observed_correction','explicit_retraction'].includes(edit.supersession);
}

/**
 * Validate raw model evidence summaries against the exact text of each window.
 * Even a window summarizer is not trusted to manufacture a quote or message ID.
 */
export function validateSlothNexusWindowEvidence(raw, messages) {
    const source=indexSource(messages);
    assert(isRecord(raw) && Array.isArray(raw.evidence) && raw.evidence.length<=40,
        'Nexus evidence window must return an evidence list of at most 40 items.');
    return raw.evidence.map((item,index)=>{
        assert(isRecord(item) && typeof item.meaning==='string' &&
            item.meaning.trim().length>=8 && item.meaning.length<=600,
            'Nexus window evidence '+index+' needs a specific factual meaning.');
        const [citation]=verifyEvidence([item],source,'Nexus window');
        return {...citation,meaning:item.meaning.trim()};
    });
}

/** Keep event maps grounded without forcing one event per extraction window. */
export function validateSlothEventWindowEvidence(raw, messages) {
    const source = indexSource(messages);
    assert(isRecord(raw) && Array.isArray(raw.events) && raw.events.length <= 40,
        'Event evidence window requires at most 40 event records.');
    return raw.events.map(event => {
        assert(isRecord(event) && ['complete', 'open', 'uncertain'].includes(event.closure) &&
            [event.topic, event.cause, event.development, event.result].every(text => typeof text === 'string' && text.trim() && text.length <= 1400),
        'Event evidence needs a topic, cause, development, result and closure state.');
        const sourceSpans = Array.isArray(event.sourceRanges) && event.sourceRanges.length === 2 &&
            event.sourceRanges.every(Number.isSafeInteger) ? [event.sourceRanges] : event.sourceRanges;
        assert(Array.isArray(sourceSpans) && sourceSpans.length && sourceSpans.length <= source.size,
            'Event evidence must name its original window ranges.');
        const eventIds = new Set();
        for (const pair of sourceSpans) {
            assert(Array.isArray(pair) && pair.length === 2 && pair.every(Number.isSafeInteger) &&
                pair[0] >= 0 && pair[1] >= pair[0] && pair[1] - pair[0] < source.size,
            'Event evidence has an invalid source range.');
            for (let id = pair[0]; id <= pair[1]; id++) {
                assert(source.has(id) && !eventIds.has(id), 'Event evidence repeats or exceeds its original window.');
                eventIds.add(id);
            }
        }
        const evidence = verifyEvidence(event.evidence, source, 'Event window');
        // A literal quote attached to this event is direct evidence of its
        // source ID. Keep that point without claiming any intervening IDs.
        // These are intermediate evidence ranges, never saved Scene ranges.
        const citedOutsideRanges = new Set(evidence.map(item => item.messageId).filter(id => !eventIds.has(id)));
        const sourceRanges = citedOutsideRanges.size
            ? [...sourceSpans, ...Array.from(citedOutsideRanges, id => [id, id])].sort((a, b) => a[0] - b[0])
            : sourceSpans;
        return { topic: event.topic, cause: event.cause, development: event.development,
            result: event.result, closure: event.closure, sourceRanges, evidence };
    });
}
