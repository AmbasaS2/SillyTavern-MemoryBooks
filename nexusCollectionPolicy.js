// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
// Pure, loss-averse event validation and World Info staging.

import { planNexusSceneRotation, sceneNumberFromTitle } from './nexusSceneRotation.js';
import { appendContinuitySection, guardContinuityChange, legacyContinuitySectionStart,
    guardNewContinuityContent } from './nexusContinuitySections.js';
import { isGroundedContinuityRetirement } from './nexusEditEvidence.js';
import { classifyNexusLegacyTitle } from './nexusLegacyMigration.js';

const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const str = v => typeof v === 'string' ? v.trim() : '';
const requireThat = (ok, msg) => { if (!ok) throw new Error(msg); };
const intUid = x => Number.isSafeInteger(Number(x)) && Number(x) >= 0 ? Number(x) : null;

export function slothSourceRanges(ids) {
    const ranges = [];
    for (const id of ids) {
        const last = ranges.at(-1);
        if (last && last[1] + 1 === id) last[1] = id;
        else ranges.push([id, id]);
    }
    return ranges;
}

export const DEFAULT_SLOTH_VISIBLE_TAIL = 6;

export function normalizeSlothVisibleTail(value) {
    const count = String(value ?? '').trim();
    if (!/^\d+$/.test(count)) return DEFAULT_SLOTH_VISIBLE_TAIL;
    return Math.min(9999, Number(count));
}

export function getSlothHideRanges(events, messages, keepRecent) {
    const visible = messages.flatMap((message,id) =>
        message && !message.is_system && typeof message.mes === 'string' && message.mes.trim() ? [id] : []);
    const count = normalizeSlothVisibleTail(keepRecent);
    const cutoff = count > 0 ? (visible.at(-count) ?? 0) : messages.length;
    const collected = new Set(events.flatMap(event => event.messageIds));
    return slothSourceRanges(visible.filter(id => id < cutoff && collected.has(id)));
}

export function validateNexusEventPlan(raw, sourceIds, { deferUnclassified = false } = {}) {
    requireThat(plain(raw) && Array.isArray(sourceIds) && sourceIds.length, 'Missing analysis or source.');
    requireThat(Array.isArray(raw.events), 'Analysis events must be an array.');
    const allowed = new Set(sourceIds), assigned = new Map(), events = [], deferred = [];
    requireThat(allowed.size === sourceIds.length && sourceIds.every(Number.isSafeInteger), 'Invalid source IDs.');
    let eventRows=raw.events, deferredRows=raw.deferred||[];
    const hasOwners = Object.hasOwn(raw,'owners');
    const hasAssignments = Object.hasOwn(raw,'assignments');
    if (hasOwners || hasAssignments) {
        requireThat(Array.isArray(deferredRows) && !(hasAssignments && hasOwners),'Invalid owner assignment format.');
        if (hasOwners) requireThat(Array.isArray(raw.owners) && raw.owners.length===sourceIds.length,
            'Return exactly one owner for every original message in order.');
        const byOwner=new Map([
            ...eventRows.map((_,index)=>['e'+(index+1),[]]),
            ...deferredRows.map((_,index)=>['d'+(index+1),[]]),
        ]);
        const rows = hasAssignments ? raw.assignments : raw.owners.map((owner,index)=>[sourceIds[index],owner]);
        requireThat(Array.isArray(rows),'Return each original ID with exactly one owner.');
        const handled = new Set();
        for (const row of rows) {
            requireThat(Array.isArray(row) && row.length===2 && allowed.has(row[0]),'Owner assignment contains an unknown source ID.');
            const [id,owner] = row;
            requireThat(!handled.has(id),'Original message #'+id+' has more than one owner.');
            requireThat(byOwner.has(owner),'Unknown scene owner at original message #'+id+'.');
            handled.add(id);
            byOwner.get(owner).push(id);
        }
        const missing = sourceIds.find(id=>!handled.has(id));
        requireThat(missing===undefined,'Missing an owner for original message #'+missing+'.');
        const withRanges=(rows,prefix)=>rows.flatMap((row,index)=>{
            const ids=byOwner.get(prefix+(index+1));
            return ids.length ? [{...row,segments:slothSourceRanges(ids.sort((a,b)=>a-b))}] : [];
        });
        eventRows=withRanges(eventRows,'e');
        deferredRows=withRanges(deferredRows,'d');
    }
    function ranges(segments, owner) {
        requireThat(Array.isArray(segments) && segments.length, owner + ': source ranges required.');
        const ids = [];
        for (const pair of segments) {
            requireThat(Array.isArray(pair) && pair.length === 2 &&
                pair.every(Number.isSafeInteger) && pair[0] >= 0 && pair[1] >= pair[0],
                owner + ': invalid range.');
            for (let id=pair[0];id<=pair[1];id++) {
                requireThat(allowed.has(id), owner + ': message #' + id + ' not in visible source.');
                requireThat(!assigned.has(id), owner + ': message #' + id + ' already assigned to ' + assigned.get(id));
                assigned.set(id, owner); ids.push(id);
            }
        }
        ids.sort((a,b)=>a-b);
        requireThat(ids.length <= sourceIds.length, owner + ': source overflow.');
        return { segments:segments.map(pair=>[...pair]), messageIds:ids };
    }
    for (const [i,item] of eventRows.entries()) {
        const title = str(item?.title), reason = str(item?.reason), result=str(item?.result);
        requireThat(title && title.length<=180 && reason && result && item.complete === true,
            'Event '+(i+1)+' must have title, causal boundary reason and completed result.');
        const data = ranges(item.segments, 'event '+(i+1));
        events.push({ id:'event-'+(i+1), title, reason, result,...data,
            start:data.messageIds[0],end:data.messageIds.at(-1) });
    }
    for (const [i,item] of deferredRows.entries()) {
        requireThat(str(item?.reason), 'Deferred '+(i+1)+' needs a reason.');
        deferred.push({reason:str(item.reason),...ranges(item.segments,'deferred '+(i+1))});
    }
    const lost = sourceIds.filter(id => !assigned.has(id)).sort((a,b)=>a-b);
    requireThat(!lost.length || deferUnclassified,
        'AI left '+lost.length+' messages unclassified, first #' + lost[0] + '. No writes.');
    if (lost.length) {
        deferred.push({
            reason:'The analysis did not classify these original messages.',
            unclassified:true,
            ...ranges(slothSourceRanges(lost),'unclassified'),
        });
    }
    // Interleaved incidents belong in the order their final source beats close.
    events.sort((a,b)=>a.end-b.end);
    return {events,deferred,sourceIds:[...sourceIds],start:sourceIds[0],
        end:sourceIds.at(-1), fullyCollected:deferred.length===0};
}

export function parseReviewedSegments(value, allowedIds) {
    const pieces=String(value||'').split(',').map(part=>{
        const match=part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
        requireThat(match,'Use message ranges like 12-16, 23-24.');
        return [Number(match[1]),Number(match[2]??match[1])];
    });
    const allowed=new Set(allowedIds);
    for(const [a,b] of pieces){
        requireThat(b>=a,'Reversed message range.');
        for(let i=a;i<=b;i++)requireThat(allowed.has(i),'Message #'+i+' is not in source.');
    }
    return pieces;
}

export function groupSlothSourceWindows(messages,maxChars=18000) {
    requireThat(Array.isArray(messages)&&messages.length&&maxChars>=2000,'No source messages.');
    const windows=[];let current=[],total=0;
    for(const message of messages){
        requireThat(Number.isSafeInteger(message?.id) && str(message?.mes),'Empty or invalid source message.');
        const size=JSON.stringify(message).length;
        requireThat(size<maxChars,'Message #'+message.id+' exceeds limit; source was not truncated.');
        if(current.length&&total+size>maxChars){windows.push(current);current=[];total=0;}
        current.push(message);total+=size;
    }
    if(current.length)windows.push(current);
    return windows;
}

export function fingerprintSlothChat(chat,ids,{allowHidden=false}={}) {
    requireThat(Array.isArray(chat) && Array.isArray(ids),'Invalid chat snapshot.');
    // A new turn during AI analysis can resolve an allegedly unfinished state.
    // Include the full chat length so no approval writes a stale current state.
    return JSON.stringify({chatLength:chat.length,messages:ids.map(id=>{
        const item=chat[id];
        requireThat(item && (allowHidden || !item.is_system),'Source #'+id+' is missing or hidden.');
        return [id,item.name,item.mes,item.is_user,item.send_date,item.swipe_id??null];
    })});
}

const SINGLETON_ROLES = new Map([
    ['core memory', 'core'], ['current continuity', 'continuity'], ['npc index', 'npc-index'],
]);
const DETAIL_TITLE = /^(lt|npc)\s*\d*\s*[|:–—-]\s*(.+)$/iu;
const LEGACY_FOOTER = /(?:\r?\n)+=== END (?:LONG-TERM MEMORY|SCENE CONTINUITY|STATUS)\b[^\r\n]*===\s*$/iu;
const normalizedTitle = title => str(title).normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ');
const detailIdentity = title => normalizedTitle(title).replace(DETAIL_TITLE, '$2')
    .normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    .replace(/^mme\s/u, 'madame ');
const npcName = title => detailIdentity(title).replace(/^(?:madame|madam|mrs|miss|ms|mr|monsieur|dr|professor)\s+/u, '');
const quoteNames = (quote, names) => names.some(name =>
    name && (' ' + detailIdentity(quote) + ' ').includes(' ' + name + ' '));

export function describeNexusCollectionEntry(entry) {
    const title = str(entry?.comment);
    const content = str(entry?.content);
    const singleton = SINGLETON_ROLES.get(normalizedTitle(title));
    const legacy = classifyNexusLegacyTitle(title);
    const recognizedState = /^\[(?:Active threads [–—-] still unconfirmed|Physical carryover)\][ \t]*\r?$/imu.test(content);
    const recognizedCore = /^\[Essential facts \/ ongoing world state\][ \t]*\r?$/imu.test(content) &&
        /^\[Enduring relationship \/ shared priorities\][ \t]*\r?$/imu.test(content);
    const roles = [];
    if (singleton) roles.push(singleton);
    else if (entry?.constant === true && (legacy || recognizedCore)) {
        if (legacy === 'core' || recognizedCore) roles.push('core');
        if (legacy === 'continuity' || recognizedState) roles.push('continuity');
    }
    if (!roles.length && !legacy) {
        const kind = title.match(DETAIL_TITLE)?.[1].toLowerCase() || entry?.STMB_slothNexusKind;
        if (kind === 'lt' || kind === 'npc') roles.push(kind);
    }
    const legacyLayout = !singleton && roles.some(role => role === 'core' || role === 'continuity');
    const protectedEntry = !!(entry?.disable || Number(entry?.position) === 7 || str(entry?.outletName) ||
        /^(?:Kinks|PanelAssets)(?:\b|$)/iu.test(title) || entry?.STMB_sidePromptHistory ||
        entry?.STMB_slothLegacyArchive || (legacy && !roles.length) ||
        entry?.stmemorybooks || entry?.stmbSummary || entry?.stmbArc);
    return {roles, legacyLayout, protected: protectedEntry};
}

export function npcNexusSubjectIsGrounded(op, book) {
    if (str(op.action).toLowerCase() === 'create') {
        const name = npcName(op.title);
        return quoteNames(op.continuingRole?.evidence?.quote, [name]);
    }
    const entries = Object.values(book.entries || {});
    const target = entries.find(entry => intUid(entry?.uid) === intUid(op.uid));
    const name = npcName(target?.comment);
    if (!name) return false;
    const otherNames = entries.filter(entry => entry !== target &&
        describeNexusCollectionEntry(entry).roles.includes('npc')).map(entry => npcName(entry.comment));
    const shortNames = name.split(' ').filter(word => word.length >= 3 &&
        !otherNames.some(other => other.split(' ').includes(word)));
    return op.evidence.some(({quote}) => quoteNames(quote, [name, ...shortNames]));
}

function getUidEntry(book,uid){
    const matches=Object.values(book.entries||{}).filter(e=>intUid(e?.uid)===uid);
    requireThat(matches.length===1,'Nexus UID '+uid+' is ambiguous/missing.');
    return matches[0];
}
export function stageNexusEdits(original, edits, createEntry, {detailRecallMode='vector'}={}) {
    requireThat(plain(original?.entries) && Array.isArray(edits) && typeof createEntry==='function',
        'Invalid Nexus staging input.');
    requireThat(['vector','keyword'].includes(detailRecallMode),'Unsupported Nexus detail recall mode.');
    const staged=structuredClone(original),changes=[];
    const titles=new Set(Object.values(staged.entries).map(e=>str(e?.comment).toLowerCase()));
    for(const [i,op] of edits.entries()){
        const kind=str(op?.kind).toLowerCase(), action=str(op?.action).toLowerCase();
        requireThat(['core','continuity','lt','npc','npc-index'].includes(kind),'Invalid Nexus entry kind '+i);
        requireThat(['replace_exact','append','append_section','create'].includes(action),'Invalid Nexus edit action '+i);
        requireThat(action!=='append_section' || kind==='continuity',
            'Only Current Continuity supports append_section.');
        if(action==='create'){
            const title=str(op.title), content=str(op.content);
            requireThat(title && title.length<=180 && content && !titles.has(title.toLowerCase()),
                'Duplicate, missing or empty new Nexus entry.');
            requireThat(!/^(Kinks|PanelAssets)(?:\b|$)/i.test(title),'Cannot create special Outlet.');
            requireThat(!classifyNexusLegacyTitle(title), 'A new Nexus entry cannot reuse a legacy role title.');
            if(kind==='core')requireThat(title==='Core Memory','Core Memory title mismatch.');
            if(kind==='continuity')requireThat(title==='Current Continuity','Continuity title mismatch.');
            if(title==='Core Memory')requireThat(kind==='core','Core Memory must use core kind.');
            if(title==='Current Continuity')requireThat(kind==='continuity','Continuity must use continuity kind.');
            const identity = detailIdentity(title);
            const target = Object.values(staged.entries).find(entry => {
                if (!entry || entry.disable || entry.STMB_slothLegacyArchive) return false;
                const {roles} = describeNexusCollectionEntry(entry);
                if (kind === 'core' || kind === 'continuity' || kind === 'npc-index') return roles.includes(kind);
                return identity && detailIdentity(entry.comment) === identity &&
                    (roles.includes(kind) || !roles.length);
            });
            requireThat(!target, `Duplicate Nexus role or detail. Use existing UID ${target?.uid ?? ''}.`);
            const newRoles = describeNexusCollectionEntry({comment:title}).roles;
            requireThat(!newRoles.length || newRoles.includes(kind), 'New Nexus title does not match its role.');
            if(kind==='continuity')guardNewContinuityContent(content);
            const entry=createEntry(staged);
            requireThat(entry && intUid(entry.uid)!==null,'World Info entry constructor failed.');
            entry.comment=title;entry.content=content;entry.disable=false;entry.position=0;
            entry.constant=['core','continuity','npc-index'].includes(kind);
            const detail=['lt','npc'].includes(kind);
            if (detail) entry.STMB_slothNexusKind=kind;
            entry.vectorized=detail && detailRecallMode==='vector';
            entry.selective=detail;
            entry.key=Array.isArray(op.keywords)?[...new Set(op.keywords.map(str).filter(Boolean))].slice(0,16):[];
            requireThat(!detail||detailRecallMode!=='keyword'||entry.key.length,
                'A new keyword-triggered Nexus detail requires a recall keyword.');
            titles.add(title.toLowerCase());
            changes.push({action,kind,title,uid:entry.uid,before:'',after:content,
                ...(detail?{keywords:[...entry.key]}:{})});
            continue;
        }
        const uid=intUid(op?.uid);
        requireThat(uid!==null,'Nexus edit needs existing numeric UID.');
        const entry=getUidEntry(staged,uid), title=str(entry.comment);
        const {roles,legacyLayout,protected:isProtected} = describeNexusCollectionEntry(entry);
        requireThat(!isProtected,'Special/disabled Nexus entry cannot be edited.');
        requireThat(roles.includes(kind) || (!roles.length && (kind === 'lt' || kind === 'npc')),
            'Nexus UID does not match the requested role: '+title);
        const originalText = String(entry.content || '');
        const footer = (legacyLayout && originalText.match(LEGACY_FOOTER)?.[0]) || '';
        const body = footer ? originalText.slice(0, -footer.length) : originalText;
        const coreBoundary = legacyLayout && kind === 'core' && roles.includes('continuity') ?
            legacyContinuitySectionStart(body) : -1;
        const before = coreBoundary < 0 ? body : body.slice(0, coreBoundary);
        const remainder = coreBoundary < 0 ? '' : body.slice(coreBoundary);
        const text=str(op.text);
        const retirement=isGroundedContinuityRetirement(op);
        requireThat(text||retirement,'Nexus edit has empty text.');
        if(action!=='replace_exact')requireThat(!originalText.includes(text),
            'Nexus addition already exists; refusing a repeated append.');
        let after;
        if(action==='replace_exact'){
            const find=str(op.find);
            requireThat(find && before.split(find).length===2,'Nexus exact text does not match uniquely: '+title);
            if(retirement){
                const start=before.indexOf(find), end=start+find.length;
                requireThat(!/[\r\n]/.test(find) && (start===0||before[start-1]==='\n') &&
                    (end===before.length||/^[\r\n]/.test(before.slice(end))),
                    'Clean up only one whole, explicitly ended Continuity line at a time.');
            }
            after=before.replace(find,()=>text);
        }else if(action==='append_section'){
            after=appendContinuitySection(before,op.section,text,{legacyHeadings:legacyLayout});
        }else{
            requireThat(kind!=='continuity',
                'Current Continuity append must specify a section using append_section.');
            after=before+(before.endsWith('\n')?'\n':'\n\n')+text+(remainder?'\n\n':'');
        }
        if(kind==='continuity')guardContinuityChange(before,after,
            {action,section:op.section,legacyHeadings:legacyLayout});
        if (coreBoundary >= 0) requireThat(legacyContinuitySectionStart(after) < 0,
            'A Core update cannot introduce a current-state section.');
        entry.content=after+remainder+footer;
        requireThat(entry.content!==originalText,'Nexus edit made no change; refusing a no-op save.');
        changes.push({action,kind,title,uid,before:originalText,after:entry.content});
    }
    return {staged,changes};
}

export function stageMemoryScenes(original,scenes,createEntry,{chatId='',olderMode='vector'}={}) {
    requireThat(plain(original?.entries) && Array.isArray(scenes) && scenes.length &&
        typeof createEntry==='function','Invalid Memory staging input.');
    const staged=structuredClone(original);
    const numbers=Object.values(staged.entries).map(e=>sceneNumberFromTitle(e.comment)).filter(number=>number!==null);
    let next=Math.max(0,...numbers)+1;const writes=[];
    for(const item of scenes){
        const content=str(item?.content),title=str(item?.title);
        requireThat(content && title && /(?:\*\*Timeline\*\*|#{1,6}\s+Timeline)/i.test(content) &&
            /(?:\*\*Scene\*\*|#{1,6}\s+Scene)/i.test(content) &&
            /(?:\*\*Result\*\*|#{1,6}\s+Result)/i.test(content) &&
            Array.isArray(item.messageIds) && item.messageIds.length,
            'Scene is missing Timeline / Scene / Result or source IDs.');
        const entry=createEntry(staged);
        requireThat(entry && intUid(entry.uid)!==null,'Memory entry constructor failed.');
        entry.comment=String(next++).padStart(3,'0')+' - '+title;
        entry.content=content;entry.stmemorybooks=true;
        // Discontiguous incidents are not represented as a fictitious
        // single continuous source range in legacy STMB metadata.
        if(item.segments.length===1){
            entry.STMB_start=item.segments[0][0];
            entry.STMB_end=item.segments[0][1];
        }else{
            delete entry.STMB_start;
            delete entry.STMB_end;
            entry.STMB_discontiguous=true;
        }
        entry.STMB_sourceRanges=structuredClone(item.segments);
        if(chatId)entry.STMB_chatId=chatId;
        entry.key=Array.isArray(item.keywords)?[...new Set(item.keywords.map(str).filter(Boolean))].slice(0,16):[];
        entry.disable=false;entry.position=0;entry.outletName='';
        entry.constant=false;entry.vectorized=true;entry.selective=true;
        writes.push({uid:entry.uid,title:entry.comment,segments:item.segments});
    }
    const entries=Object.fromEntries(Object.entries(staged.entries).filter(([,entry])=>
        (entry.stmemorybooks===true && Array.isArray(entry.STMB_sourceRanges) && !entry.disable) ||
        entry.STMB_slothSceneMergedInto || entry.STMB_slothSceneMerge ||
        entry.STMB_slothSceneSplitArchive || entry.STMB_slothSceneSplitFrom));
    const rotated=planNexusSceneRotation({entries},{olderMode});
    Object.assign(staged.entries,rotated.proposedMemory.entries);
    return {staged,writes,rotation:rotated.changes};
}
