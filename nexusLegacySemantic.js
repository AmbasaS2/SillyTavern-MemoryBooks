// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
// One-time, reviewed semantic replacement of a verbatim legacy Continuity
// wrapper. This module never edits source World Info or performs network I/O.

import { archivedNexusLegacyKind, inspectNexusLegacyMigration }
    from './nexusLegacyMigration.js';
import { CONTINUITY_SECTIONS, guardNewContinuityContent }
    from './nexusContinuitySections.js';

const ARCHIVE = 'STMB_slothLegacyArchive';
const REVIEW = 'STMB_slothContinuityReconciliation';
const record = x => !!x && typeof x === 'object' && !Array.isArray(x);
const requireSafe = (ok, why) => { if (!ok) throw new Error(why); };
const safeUid = x => Number.isSafeInteger(x) && x >= 0;

function archiveBlock(source,kind) {
    const title = kind==='continuity' ? 'Scene Continuity' : 'Status';
    return '=== BEGIN ORIGINAL '+title+' (UID '+source.uid+') ===\n'+source.content+
        '\n=== END ORIGINAL '+title+' (UID '+source.uid+') ===';
}

/**
 * Accept ONLY the untouched, verbatim output of the previous reviewed migration.
 * If someone already edited the target, decline rather than destroying their work.
 */
export function inspectSlothLegacyContinuity(book) {
    const migration=inspectNexusLegacyMigration(book);
    if (migration.required) return {required:false,reason:'needs-migration'};
    const all=Object.values(book.entries);
    const current=all.filter(e=>e?.comment==='Current Continuity');
    requireSafe(current.length<=1,'Ambiguous Current Continuity targets.');
    if(!current.length)return {required:false,reason:'No Current Continuity entry.'};
    const target=current[0];
    const priorReview=target[REVIEW];
    const sourceUids=target.STMB_slothLegacySources;
    if(!Array.isArray(sourceUids) || !sourceUids.length) {
        return {required:false,reason:'Current Continuity has no reviewed legacy source archives.'};
    }
    requireSafe(sourceUids.length<=2 && sourceUids.every(safeUid) &&
        new Set(sourceUids).size===sourceUids.length,
        'Ambiguous legacy Continuity source UID references.');
    requireSafe(target.disable!==true && target.constant===true &&
        target.vectorized===false && Number(target.position)!==7 &&
        !String(target.outletName||'').trim(),
        'Current Continuity has unsupported injection/Outlet settings.');
    const sources=sourceUids.map(uid=>{
        const source=all.find(e=>e?.uid===uid);
        const kind=archivedNexusLegacyKind(source);
        requireSafe(source && (kind==='continuity'||kind==='status') &&
            source.disable===true && source[ARCHIVE]?.version===1 &&
            source[ARCHIVE].kind===kind &&
            source[ARCHIVE].targetUid===target.uid &&
            source[ARCHIVE].targetTitle==='Current Continuity' &&
            typeof source.content==='string' && source.content.trim(),
            'A legacy source archive is missing, modified or incorrectly linked: UID '+uid);
        return {uid,kind,entry:source,
            raw:archiveBlock(source,kind)};
    });
    const originalContent=sources.map(source=>source.raw).join('\n\n');
    if(priorReview){
        requireSafe(record(priorReview) && priorReview.version===1 &&
            priorReview.originalContent===originalContent &&
            JSON.stringify(priorReview.sourceUids)===JSON.stringify(sourceUids) &&
            Array.isArray(priorReview.sourceSnapshots) &&
            priorReview.sourceSnapshots.length===sources.length &&
            priorReview.sourceSnapshots.every((snap,i)=>snap.uid===sources[i].uid &&
                snap.kind===sources[i].kind &&
                snap.content===sources[i].entry.content) &&
            typeof target.content==='string' &&
            target.content!==originalContent,
            'Existing semantic review metadata or legacy source archives have been modified.');
        guardNewContinuityContent(target.content);
        return {required:false,reason:'Already reconciled; do not repeat.'};
    }
    requireSafe(target.content===originalContent,
        'Current Continuity contains independent edits or non-verbatim legacy material. Manual review required.');
    requireSafe(originalContent.length<=85000,
        'Legacy Continuity exceeds safe single-pass reconciliation length.');
    return {required:true,targetUid:target.uid,targetTitle:target.comment,
        originalContent,sourceUids:[...sourceUids],
        sources:sources.map(({uid,kind,entry})=>({
            uid,kind,title:entry.comment,content:entry.content,
        }))};
}

function exactQuote(text, quote, label) {
    requireSafe(typeof quote==='string' && quote===quote.trim() &&
        quote.length>=8 && quote.length<=400 && text.includes(quote),
        label+' must be an exact 8–400 character source quote.');
}
function originalCitation(ref,plan,label) {
    requireSafe(record(ref) && safeUid(ref.uid),
        label+' needs the archived source UID.');
    const old=plan.sources.find(s=>s.uid===ref.uid);
    requireSafe(!!old,'Unknown archived source UID '+ref.uid+'.');
    exactQuote(old.content,ref.quote,label);
    return {uid:ref.uid,quote:ref.quote};
}
function chatCitation(ref,byId,label) {
    requireSafe(record(ref) && Number.isSafeInteger(ref.messageId) &&
        byId.has(ref.messageId),label+' needs a current-chat message ID.');
    exactQuote(byId.get(ref.messageId),ref.quote,label);
    return {messageId:ref.messageId,quote:ref.quote};
}

/**
 * The LLM's classifications are a REVIEW PROPOSAL, not proof of validity.
 * Every active sentence needs BOTH an archived quote and a current-chat quote.
 * Uncertain, superseded and historical-only facts can be excluded only after
 * explicitly telling the user; their complete original entries remain archived.
 */
export function validateSlothLegacyContinuityProposal(plan,raw,messages) {
    requireSafe(plan?.required && Array.isArray(plan.sources),
        'A verified legacy Continuity plan is required.');
    requireSafe(record(raw) && Array.isArray(raw.current) &&
        Array.isArray(raw.notCurrent) && raw.current.length<=40 &&
        raw.notCurrent.length<=80,
        'AI Continuity classification is incomplete or too large.');
    requireSafe(Array.isArray(messages),'Original current chat messages are required.');
    const byId=new Map();
    for(const m of messages) {
        requireSafe(Number.isSafeInteger(m?.id) && typeof m.mes==='string' &&
            m.mes.trim() && !byId.has(m.id),
            'Current chat evidence has missing, empty or duplicate messages.');
        byId.set(m.id,m.mes);
    }
    const cited=new Set(), used=new Set();
    const current=raw.current.map((item,i)=>{
        const label='Current fact '+(i+1);
        requireSafe(record(item) && CONTINUITY_SECTIONS.includes(item.section) &&
            typeof item.text==='string' && item.text===item.text.trim() &&
            item.text.length>=8 && item.text.length<=800 &&
            !/\r|\n|(?:=== (?:BEGIN|END) ORIGINAL)/.test(item.text) &&
            typeof item.reason==='string' &&
            item.reason.trim().length>=12 && item.reason.length<=600,
            label+' needs a concise grounded statement, section and reason.');
        const archive=originalCitation(item.archive,plan,label);
        const fresh=chatCitation(item.chat,byId,label);
        const key=item.section+'\0'+item.text.toLowerCase();
        requireSafe(!used.has(key),'Repeated Current Continuity assertion.');
        used.add(key);cited.add(archive.uid);
        return {section:item.section,text:item.text,reason:item.reason.trim(),
            archive,chat:fresh};
    });
    const notCurrent=raw.notCurrent.map((item,i)=>{
        const label='Non-current legacy fact '+(i+1);
        requireSafe(record(item) &&
            ['resolved','superseded','historical','unverified'].includes(item.status) &&
            typeof item.reason==='string' && item.reason.trim().length>=12 &&
            item.reason.length<=600,
            label+' requires explicit historical/uncertain classification and reason.');
        const archive=originalCitation(item.archive,plan,label);
        cited.add(archive.uid);
        if(item.status==='resolved'||item.status==='superseded') {
            requireSafe(!!item.chat,
                label+' cannot claim completion or supersession without a current-chat quote.');
        }
        if(item.chat)chatCitation(item.chat,byId,label);
        return {status:item.status,reason:item.reason.trim(),archive,
            ...(item.chat?{chat:chatCitation(item.chat,byId,label)}:{})};
    });
    requireSafe(plan.sourceUids.every(uid=>cited.has(uid)),
        'Every legacy source entry must be reviewed as current or not-current.');
    // An entirely uncorroborated result is a valid NO-OP proposal. The runtime
    // reports it to the user; staging still requires at least one current fact.
    return {current,notCurrent};
}

export function stageSlothLegacyContinuity(book,proposal,{chatKey,messages}={}) {
    const plan=inspectSlothLegacyContinuity(book);
    requireSafe(plan.required && record(proposal) && Array.isArray(proposal.current) &&
        proposal.current.length>0 && Array.isArray(proposal.notCurrent) &&
        typeof chatKey==='string' && chatKey.trim(),
        'Verified proposal and original chat identity required for semantic migration.');
    const verified=validateSlothLegacyContinuityProposal(plan,proposal,messages);
    const bySection=new Map(CONTINUITY_SECTIONS.map(section=>[section,[]]));
    for(const item of verified.current){
        requireSafe(record(item) && CONTINUITY_SECTIONS.includes(item.section) &&
            typeof item.text==='string' && item.text.length>=8 &&
            record(item.archive) && record(item.chat),
            'A source-backed current-state proposal is required.');
        bySection.get(item.section).push(item.text);
    }
    const newText=CONTINUITY_SECTIONS.filter(section=>bySection.get(section).length)
        .map(section=>'## '+section+'\n'+bySection.get(section).join('\n'))
        .join('\n\n');
    guardNewContinuityContent(newText);
    const staged=structuredClone(book);
    const target=Object.values(staged.entries).find(e=>e.uid===plan.targetUid);
    requireSafe(target && target.content===plan.originalContent,
        'Legacy Continuity changed before staging.');
    target.content=newText;
    target[REVIEW]={version:1,chatKey,sourceUids:[...plan.sourceUids],
        originalContent:plan.originalContent,
        sourceSnapshots:plan.sources.map(s=>({
            uid:s.uid,kind:s.kind,title:s.title,content:s.content,
        })),
        review:structuredClone(verified)};
    // The historical source entries and all unrelated lore are byte-for-byte
    // untouched; only the already-migrated active Current entry is rewritten.
    for(const [key,entry] of Object.entries(book.entries)) {
        if(entry.uid===target.uid)continue;
        requireSafe(JSON.stringify(staged.entries[key])===JSON.stringify(entry),
            'Semantic migration changed an unrelated entry.');
    }
    return {staged,plan,previous:plan.originalContent,
        next:newText,review:structuredClone(verified)};
}
