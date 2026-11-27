// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
// Selective literal evidence checks. A matching quote is not proof of semantic truth.
import {touchesContinuityKnowledge} from './nexusContinuitySections.js';

// v1/v2: replay their historical contracts. v3: experiment with independent,
// conservative signals for LT changes. This is not semantic entailment.
// All LT replacements affect an existing fact. For additions/creates, look
// only at the title and changed claim, not the whole book or source chat.
const IMPORTANT_LT_EN=/\b(?:promis(?:e|es|ed|ing)|vow(?:s|ed)?|pledge(?:s|d)?|agreements?|agree(?:d|s)?\s+to|commitments?|boundar(?:y|ies)|consent|permission|forbid(?:den|s)?|refusal|secrets?|confidential|swore|oath|marriage|married|engagement|fianc[eé]e?|spouse|divorc(?:e|ed)|relationship status|only\s+[^.!?\n]{1,48}\s+knows?|(?:did not|must not|never)\s+(?:tell|disclose|reveal))\b/iu;
const IMPORTANT_LT_CJK=/(?:약속|합의|서약|맹세|동의|허락|금지|거절|비밀|결혼|약혼|배우자|이혼|권한|경계|約束|合意|誓約|同意|許可|秘密|婚約|結婚|离婚|承诺|约定|同意|许可|秘密|婚姻|订婚)/u;
function importantLtClaim(text){
    return IMPORTANT_LT_EN.test(String(text??''))||IMPORTANT_LT_CJK.test(String(text??''));
}
export function requiresSlothLtEvidence(edit,nexus){
    if(String(edit?.kind??'').trim().toLowerCase()!=='lt')return false;
    const action=String(edit.action??'').trim().toLowerCase();
    if(action==='replace_exact')return true;
    if(action==='create')return importantLtClaim(edit.title)||importantLtClaim(edit.content);
    if(action!=='append')return false;
    const entry=Object.values(nexus?.entries||{}).find(row=>String(row?.uid)===String(edit.uid));
    return importantLtClaim(entry?.comment)||importantLtClaim(edit.text);
}

export function requiresSlothNexusEvidence(edit,nexus,policyVersion=1){
    const kind=String(edit?.kind||'').trim().toLowerCase();
    if(kind==='core'||(policyVersion===1&&edit?.risk==='sensitive'))return true;
    if(policyVersion===3&&requiresSlothLtEvidence(edit,nexus))return true;
    if(kind!=='continuity')return false;
    if(edit.action==='replace_exact'&&edit.text==='')return true;
    const entry=edit.action==='replace_exact'?Object.values(nexus?.entries||{}).find(row=>String(row?.uid)===String(edit.uid)):null;
    return touchesContinuityKnowledge(edit,entry?.content);
}
export function assertSlothNexusEvidence(edit,nexus,source,policyVersion=1){
    if(!requiresSlothNexusEvidence(edit,nexus,policyVersion))return;
    const quotes=edit.evidence;
    if(!Array.isArray(quotes)||quotes.length<1||quotes.length>3)
        throw new Error('Sensitive Nexus change needs one to three exact original source quotes.');
    for(const item of quotes){
        const rawId=item?.messageId;
        const id=typeof rawId==='number'||typeof rawId==='string'&&/^\d+$/u.test(rawId)?Number(rawId):NaN;
        const quote=typeof item?.quote==='string'?item.quote.trim():'';
        if(!Number.isSafeInteger(id)||id<0||!quote||quote.length>240||!source.get(id)?.includes(quote))
            throw new Error('Sensitive Nexus evidence does not match its cited original message.');
    }
}
