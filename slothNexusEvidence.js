// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
// Selective literal evidence checks. A matching quote is not proof of semantic truth.
import {touchesContinuityKnowledge} from './nexusContinuitySections.js';

export function requiresSlothNexusEvidence(edit,nexus){
    const kind=String(edit?.kind||'').trim().toLowerCase();
    if(edit?.risk==='sensitive'||kind==='core')return true;
    if(kind!=='continuity')return false;
    if(edit.action==='replace_exact'&&edit.text==='')return true;
    const entry=edit.action==='replace_exact'?Object.values(nexus?.entries||{}).find(row=>String(row?.uid)===String(edit.uid)):null;
    return touchesContinuityKnowledge(edit,entry?.content);
}
export function assertSlothNexusEvidence(edit,nexus,source){
    if(!requiresSlothNexusEvidence(edit,nexus))return;
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
