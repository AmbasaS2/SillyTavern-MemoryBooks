// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
// Grounding receipts for AI-proposed Nexus changes. Pure; never writes World Info.

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
function verifyEvidence(items,source,label) {
    assert(Array.isArray(items) && items.length>=1 && items.length<=8,
        label+' requires one to eight direct source quotes.');
    return items.map((entry,index)=>{
        assert(isRecord(entry) && Number.isSafeInteger(entry.messageId) &&
            typeof entry.quote==='string' && entry.quote===entry.quote.trim() &&
            entry.quote.length>=8 && entry.quote.length<=400,
            label+' evidence '+(index+1)+' needs an exact, short source quote and message ID.');
        const message=source.get(entry.messageId);
        assert(message && message.mes.includes(entry.quote),
            label+' cites a quote missing from original message #'+entry.messageId+'.');
        return {messageId:entry.messageId,quote:entry.quote};
    });
}

export function isGroundedContinuityRetirement(edit) {
    return edit?.kind==='continuity' && edit.action==='replace_exact' && edit.text==='' &&
        ['observed_resolution','observed_correction','explicit_retraction'].includes(edit.supersession) &&
        Array.isArray(edit.evidence) && edit.evidence.length>0;
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

/**
 * Require each proposed delta (including new entries and appends) to cite
 * source text actually present in the CURRENT uncollected chat.
 * Replacing a current-state fact also requires a stated resolution/correction.
 * The code cannot prove a causal interpretation, so evidence and reason are
 * shown in the final human review; a quote is not automatic permission to save.
 */
export function validateGroundedNexusEdits(edits, messages) {
    const source=indexSource(messages);
    assert(Array.isArray(edits) && edits.length<=80,
        'Nexus AI returned invalid or excessive edits.');
    return edits.map((op,index)=>{
        assert(isRecord(op), 'Nexus edit '+index+' is invalid.');
        const label='Nexus edit '+(index+1);
        const evidence=verifyEvidence(op.evidence,source,label);
        assert(typeof op.reason==='string' && op.reason.trim().length>=12 &&
            op.reason.length<=600, label+' needs a specific reason backed by chat evidence.');
        if(op.action==='replace_exact' && op.kind==='continuity'){
            assert(['observed_resolution','observed_correction','explicit_retraction',
                'new_confirmed_information'].includes(op.supersession),
                label+' must identify how the original current state was explicitly superseded.');
        }
        if(op.action==='replace_exact'){
            assert(typeof op.find==='string' && op.find.trim() &&
                typeof op.text==='string' && (op.text.trim()||isGroundedContinuityRetirement(op)),
                label+' cannot erase a fact without an explicit grounded replacement.');
        }
        return {...op,reason:op.reason.trim(),evidence};
    });
}
