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

// v4 evaluates additions by the changed claim, not an existing title.
// Limited lexical signals are review triggers, not proof of a fact.
const INDIRECT_LT_EN=/\b(?:(?:from now on|henceforth)|(?:gave|gives)\s+(?:\w+\s+){0,3}(?:his|her|their)\s+word|(?:will|would|shall|must|has to|had to)\s+(?:\w+\s+){0,7}(?:first|before|until|unless|only if|each time|every time|always|never)\b|(?:will|would|must)\s+(?:always|never)\b|(?:left|leaves|leave)\s+(?:the |her |his |their )?(?:choice|decision)\s+to\b|(?:it is|it was|it's|(?:the|her|his|their)\s+(?:decision|choice)\s+(?:is|was))\s+up to\b|(?:knows|knew|learned|heard)\s+(?:that\b|about\b|(?:the |a )?(?:code|password|secret|truth)\b)|(?:does not|doesn't|did not|didn't|never)\s+(?:know|hear|learn|disclose|tell)\b)/iu;
const INDIRECT_LT_CJK=/(?:하기로 했|하기로 한|하기 전[에엔]?\s*(?:먼저|반드시)|앞으로는|할 때마다|(?:에게|한테)\s*(?:결정권|선택권)|(?:알지|듣지)\s*못했|(?:알지|듣지)\s*않았|することにした|今後は|する前に|するたびに|知らなかった|聞いていなかった|从今以后|每次都|之前必须|由.{1,16}决定|并不知道|没有听到)/u;
function importantLtDelta(text){
    const value=String(text??'');
    return importantLtClaim(value)||INDIRECT_LT_EN.test(value)||INDIRECT_LT_CJK.test(value);
}
export function requiresSlothLtEvidenceV4(edit){
    if(String(edit?.kind??'').trim().toLowerCase()!=='lt')return false;
    const action=String(edit.action??'').trim().toLowerCase();
    if(action==='replace_exact')return true;
    if(action==='create')return importantLtDelta(edit.title)||importantLtDelta(edit.content);
    return action==='append'&&importantLtDelta(edit.text);
}

// Conservative direct-contradiction check. Only plain, single-sentence,
// named-subject statements with the SAME predicate, object and tense.
// Full source text is checked to avoid stripping negation or qualifiers from
// a quote. No pronoun resolution, cross-predicate inference, or general NLI.
function literalKnowledgeStatement(value){
    const text=String(value??'').trim();
    const m=text.match(/^([A-Z][\p{L}'’-]*(?: [A-Z][\p{L}'’-]*){0,2}) (knows|does not know|doesn't know|knew|did not know|didn't know|heard|did not hear|didn't hear|learned|did not learn|didn't learn) ([^.!?;:"“”\r\n]{1,120})[.!?]?$/u);
    if(!m||/^(?:I|He|She|They|We|You|It|Someone|Nobody|Everyone|Only|No One)$/i.test(m[1]))return null;
    if(/\b(?:if|when|unless|until|before|after|now|then|yet|already|would|could|may|might|perhaps|apparently|probably|not|never|nothing|except|whether|because|but|and|or|according|said|says|thought|thinks)\b/iu.test(m[3]))return null;
    const predicate=m[2],negative=/\b(?:not|n't)\b|n't/u.test(predicate);
    const relation=predicate.includes('know')||predicate==='knew'?'know':predicate.includes('hear')||predicate==='heard'?'hear':'learn';
    const tense=/^(?:knows|does)/u.test(predicate)?'present':'past';
    return {subject:m[1],relation,tense,negative,object:m[3].trim().replace(/\s+/gu,' ').toLowerCase()};
}
function hasDirectKnowledgeContradiction(edit,citations){
    const claim=literalKnowledgeStatement(edit.action==='create'?edit.content:edit.text);
    if(!claim||!citations.length)return false;
    // If citations contain a correction, other context, or an ambiguous
    // statement, leave semantic judgment to review rather than infer conflict.
    return citations.every(text=>{
        const fact=literalKnowledgeStatement(text);
        return fact&&fact.subject===claim.subject&&fact.relation===claim.relation&&fact.tense===claim.tense&&
            fact.object===claim.object&&fact.negative!==claim.negative;
    });
}

export function requiresSlothNexusEvidence(edit,nexus,policyVersion=1){
    const kind=String(edit?.kind||'').trim().toLowerCase();
    if(kind==='core'||(policyVersion===1&&edit?.risk==='sensitive'))return true;
    if(policyVersion===3&&requiresSlothLtEvidence(edit,nexus))return true;
    if(policyVersion===4&&requiresSlothLtEvidenceV4(edit))return true;
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
    const citations=[];
    for(const item of quotes){
        const rawId=item?.messageId;
        const id=typeof rawId==='number'||typeof rawId==='string'&&/^\d+$/u.test(rawId)?Number(rawId):NaN;
        const quote=typeof item?.quote==='string'?item.quote.trim():'';
        if(!Number.isSafeInteger(id)||id<0||!quote||quote.length>240||!source.get(id)?.includes(quote))
            throw new Error('Sensitive Nexus evidence does not match its cited original message.');
        if(policyVersion===4)citations.push(source.get(id));
    }
    if(policyVersion===4&&String(edit?.kind??'').trim().toLowerCase()==='lt'&&hasDirectKnowledgeContradiction(edit,citations))
        throw new Error('The cited source directly contradicts this LT knowledge claim. Correct the claim or evidence.');
}
