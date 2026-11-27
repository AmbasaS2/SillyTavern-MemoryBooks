// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
// Pure, loss-averse event validation and World Info staging.

import { isCompletedSceneEntry, planNexusSceneRotation, sceneNumberFromTitle } from './nexusSceneRotation.js';
import { appendContinuitySection, guardContinuityChange, legacyContinuitySectionStart,
    guardNewContinuityContent } from './nexusContinuitySections.js';
import { isAllowedContinuityRetirement } from './nexusEditEvidence.js';
import { classifyNexusLegacyTitle } from './nexusLegacyMigration.js';
import { stableHashString } from './clipReviewPolicy.js';

const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const str = v => typeof v === 'string' ? v.trim() : '';
const requireThat = (ok, msg) => { if (!ok) throw new Error(msg); };
const intUid = x => (typeof x === 'number' || (typeof x === 'string' && /^\d+$/u.test(x)))
    && Number.isSafeInteger(Number(x)) && Number(x) >= 0 ? Number(x) : null;

export function slothSourceRanges(ids) {
    const ranges = [];
    for (const id of ids) {
        const last = ranges.at(-1);
        if (last && last[1] + 1 === id) last[1] = id;
        else ranges.push([id, id]);
    }
    return ranges;
}

export const DEFAULT_SLOTH_VISIBLE_TAIL = 0;

export function normalizeSlothVisibleTail(value) {
    const count = String(value ?? '').trim();
    if (!/^\d+$/.test(count)) return DEFAULT_SLOTH_VISIBLE_TAIL;
    return Math.min(9999, Number(count));
}

export function getSlothHideRanges(events, messages, keepRecent) {
    const collected = new Set(events.flatMap(event => event.messageIds));
    const visible = messages.flatMap((message, id) =>
        collected.has(id) && message && !message.is_system && typeof message.mes === 'string' && message.mes.trim() ? [id] : []);
    const hideCount = Math.max(0, visible.length - normalizeSlothVisibleTail(keepRecent));
    return slothSourceRanges(visible.slice(0, hideCount));
}

export function includeDeepSeekTailEvent(draft, sourceIds, messages = []) {
    if (!Array.isArray(draft?.events)) return draft;
    // The events array declares completed candidates. Keep the normal
    // outcome and source checks when an otherwise complete row omits the flag.
    draft={...draft,events:draft.events.map(row=>row?.complete===undefined && plain(row?.closure) ?
        {...row,complete:true} : row)};
    const tail=draft?.tail;
    if (!plain(tail) || typeof tail.complete!=='boolean' || !Array.isArray(tail.segments) ||
        Object.hasOwn(draft,'owners') || Object.hasOwn(draft,'assignments')) return draft;

    const allowed=new Set(sourceIds);
    const tailIds=new Set();
    for (const range of tail.segments) {
        if (!Array.isArray(range) || range.length!==2 || !range.every(Number.isSafeInteger)) return draft;
        const [start,end]=range;
        if (start<0 || end<start || end-start>=sourceIds.length) return draft;
        for (let id=start;id<=end;id++) {
            if (!allowed.has(id) || tailIds.has(id)) return draft;
            tailIds.add(id);
        }
    }
    if (!tailIds.size) return draft;
    const origin=tail.origin;
    const original=messages.find(message=>message.id===origin?.messageId);
    const originQuote=str(origin?.quote);
    const first=sourceIds.find(id=>tailIds.has(id));
    let scopedTail=tail;
    // If the model finds a grounded earlier trigger but omits it from the
    // chosen spans, keep the original conflict and its later reply together.
    if (original && allowed.has(original.id) && original.id<first && originQuote.length>=8 &&
        original.mes.includes(originQuote)) {
        const last=sourceIds.findLast(id=>tailIds.has(id));
        const ids=sourceIds.filter(id=>id>=original.id&&id<=last);
        for (const id of ids) tailIds.add(id);
        scopedTail={...tail,segments:slothSourceRanges(ids)};
    }
    const events=[];
    const deferred=[];
    for (const [rows,preserved] of [[draft.events,events],[draft.deferred??[],deferred]]) {
        if (!Array.isArray(rows)) return draft;
        for (const row of rows) {
            const segments=row?.segments;
            if (!Array.isArray(segments) || !segments.every(range=>Array.isArray(range) && range.length===2 &&
                range.every(Number.isSafeInteger) && range[0]>=0 && range[1]>=range[0] &&
                range[1]-range[0]<sourceIds.length)) return draft;
            const ids=sourceIds.filter(id=>segments.some(([start,end])=>start<=id&&id<=end));
            if (!ids.some(id=>tailIds.has(id))) {
                preserved.push(row);
                continue;
            }
            // A row whose source belonged to the tail may no longer have
            // support for its old result. Keep any remaining turns available.
            const remainder=ids.filter(id=>!tailIds.has(id));
            if (remainder.length) deferred.push({reason:'This range overlaps the final incident.',
                segments:slothSourceRanges(remainder)});
        }
    }
    if (scopedTail.complete) events.push({...scopedTail,closingExchange:true});
    else deferred.push(scopedTail);
    return {events,deferred};
}

export function fitDeepSeekSceneBatch(plan, outputTokens) {
    // Reserve space for Nexus, JSON framing, and variation in Scene lengths.
    const capacity=Math.max(1,Math.floor((outputTokens*0.76-1000)/450));
    if (plan.events.length<=capacity) return plan;
    const final=plan.events.find(event=>event.closingExchange);
    const keep=new Set(plan.events.filter(event=>event!==final).slice(0,capacity-(final ? 1 : 0)));
    if (final) keep.add(final);
    const postponed=plan.events.filter(event=>!keep.has(event)).map(({segments,messageIds})=>({
        reason:'A completed event waiting for room in the next response.',segments,messageIds,
    }));
    return {...plan,events:plan.events.filter(event=>keep.has(event)),
        deferred:[...plan.deferred,...postponed],fullyCollected:false};
}

export function validateNexusEventPlan(raw, sourceIds, {
    deferUnclassified = false, originalMessages,
} = {}) {
    requireThat(plain(raw) && Array.isArray(sourceIds) && sourceIds.length, 'Missing analysis or source.');
    requireThat(Array.isArray(raw.events), 'Analysis events must be an array.');
    const allowed = new Set(sourceIds), assigned = new Map(), events = [], deferred = [];
    const originals = originalMessages && new Map(originalMessages.map(({id,mes})=>[id,mes]));
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
        if (deferUnclassified && item?.complete === false && (reason || result)) {
            deferred.push({reason:reason || result,...ranges(item.segments,'unfinished event '+(i+1))});
            continue;
        }
        requireThat(title && title.length<=180 && reason && result && item.complete === true,
            'Event '+(i+1)+' must have title, causal boundary reason and completed result.');
        const data = ranges(item.segments, 'event '+(i+1));
        const closure = item.closure;
        const ending = originals?.get(closure?.messageId);
        // Use verified quotes as writing context without making them a save condition.
        const groundedClosure = typeof ending === 'string' && data.messageIds.includes(closure?.messageId) &&
            typeof closure.quote === 'string' && closure.quote.trim() &&
            ending.includes(closure.quote) && (closure.quote.trim().length >= 8 || closure.quote.trim() === ending.trim());
        events.push({ id:'event-'+(i+1), title, reason, result,
            ...(groundedClosure ? {closure:{messageId:closure.messageId,quote:closure.quote}} : {}),...data,
            ...(item.closingExchange===true ? {closingExchange:true} : {}),
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

export function fingerprintSlothReviewedRanges(chat, ranges) {
    return stableHashString(JSON.stringify(ranges.map(([start, end]) => {
        requireThat(Number.isSafeInteger(start) && Number.isSafeInteger(end) &&
            start >= 0 && start <= end && end < chat.length, 'Invalid reviewed chat range.');
        return [start, end, chat.slice(start, end + 1).map(message => {
            requireThat(message && typeof message.mes === 'string', 'A reviewed message is missing.');
            // Hiding a message or appending a new turn does not change its source text.
            return stableHashString(JSON.stringify([message.name, message.mes, message.is_user,
                message.send_date, message.swipe_id ?? null]));
        })];
    })));
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
function detailIdentities(title, kind, content = '') {
    const subject = normalizedTitle(title).replace(DETAIL_TITLE, '$2');
    const names = [subject];
    if (kind === 'npc') {
        // Explicitly labelled aliases are evidence of identity. A surname or
        // a mention in prose can also refer to another person.
        const qualified = subject.match(/^(.+?)\s*\(([^()]+)\)\s*$/u);
        if (qualified) names.push(qualified[1]);
        const aliases = String(content || '').matchAll(/^(?:[-*]\s*)?(?:\*\*)?(?:aliases?|aka|also known as):(?:\*\*)?[ \t]+([^\r\n]+)$/gimu);
        for (const [, aliasLine] of aliases) names.push(...aliasLine.split(/[,;|]/u));
    }
    return new Set(names.map(detailIdentity).filter(Boolean));
}
export function getNexusRecallModes(moduleSettings={}) {
    const modes=moduleSettings.nexusRecallModes||{};
    const detail=moduleSettings.nexusDetailRecallMode==='keyword'?'keyword':'vector';
    const defaults={core:'constant',continuity:'constant',lt:detail,npc:detail};
    return Object.fromEntries(Object.entries(defaults).map(([kind,fallback])=>[kind,
        ['constant','vector','keyword','disabled'].includes(modes[kind])?modes[kind]:fallback]));
}
function isUninjectedManagedEntry(entry) {
    return entry?.disable===true && entry.STMB_slothRecallMode==='disabled';
}
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
    else if (legacy || (recognizedCore && (entry?.constant === true || entry?.STMB_slothManagedLegacyRole === true))) {
        if (legacy === 'core' || recognizedCore) roles.push('core');
        if (legacy === 'continuity' || legacy === 'status' || recognizedState) roles.push('continuity');
    }
    if (!roles.length && !legacy) {
        const kind = title.match(DETAIL_TITLE)?.[1].toLowerCase() || entry?.STMB_slothNexusKind;
        if (kind === 'lt' || kind === 'npc') roles.push(kind);
    }
    const legacyLayout = !singleton && roles.some(role => role === 'core' || role === 'continuity');
    const protectedEntry = !!((entry?.disable && !isUninjectedManagedEntry(entry)) || Number(entry?.position) === 7 || str(entry?.outletName) ||
        /^(?:Kinks|PanelAssets)(?:\b|$)/iu.test(title) || entry?.STMB_sidePromptHistory ||
        entry?.STMB_slothLegacyArchive || (legacy && !roles.length) ||
        entry?.stmemorybooks || entry?.stmbSummary || entry?.stmbArc);
    return {roles, legacyLayout, protected: protectedEntry};
}

function getUidEntry(book,uid){
    const matches=Object.values(book.entries||{}).filter(e=>intUid(e?.uid)===uid);
    requireThat(matches.length===1,'Nexus UID '+uid+' is ambiguous/missing.');
    return matches[0];
}
export function stageNexusEdits(original, edits, createEntry, {detailRecallMode='vector',recallModes}={}) {
    requireThat(plain(original?.entries) && Array.isArray(edits) && typeof createEntry==='function',
        'Invalid Nexus staging input.');
    requireThat(['vector','keyword'].includes(detailRecallMode),'Unsupported Nexus detail recall mode.');
    const modes=getNexusRecallModes({nexusDetailRecallMode:detailRecallMode,nexusRecallModes:recallModes});
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
            const identities = detailIdentities(title,kind,content);
            const target = Object.values(staged.entries).find(entry => {
                if (!entry || (entry.disable && !isUninjectedManagedEntry(entry)) || entry.STMB_slothLegacyArchive) return false;
                const {roles} = describeNexusCollectionEntry(entry);
                if (kind === 'core' || kind === 'continuity' || kind === 'npc-index') return roles.includes(kind);
                return (roles.includes(kind) || !roles.length) &&
                    [...detailIdentities(entry.comment,kind,entry.content)].some(identity=>identities.has(identity));
            });
            requireThat(!target, `Duplicate Nexus role or detail. Use existing UID ${target?.uid ?? ''}.`);
            const newRoles = describeNexusCollectionEntry({comment:title}).roles;
            requireThat(!newRoles.length || newRoles.includes(kind), 'New Nexus title does not match its role.');
            if(kind==='continuity')guardNewContinuityContent(content);
            const entry=createEntry(staged);
            requireThat(entry && intUid(entry.uid)!==null,'World Info entry constructor failed.');
            const mode=kind==='npc-index'?'constant':modes[kind];
            entry.comment=title;entry.content=content;entry.disable=mode==='disabled';entry.position=0;
            entry.constant=mode==='constant';
            const detail=['lt','npc'].includes(kind);
            if (detail) entry.STMB_slothNexusKind=kind;
            if (mode==='disabled') entry.STMB_slothRecallMode='disabled';
            entry.vectorized=mode==='vector';
            entry.selective=mode==='vector'||mode==='keyword'||detail;
            entry.key=Array.isArray(op.keywords)?[...new Set(op.keywords.map(str).filter(Boolean))].slice(0,16):[];
            requireThat(mode!=='keyword'||entry.key.length,
                'A new keyword-triggered Nexus entry requires a recall keyword.');
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
        const retirement=isAllowedContinuityRetirement(op);
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

/** Apply the current type settings to existing recognized entries only. */
export function stageNexusRecallSettings(original,moduleSettings) {
    requireThat(plain(original?.entries),'Invalid Nexus recall settings input.');
    const modes=getNexusRecallModes(moduleSettings),staged=structuredClone(original);
    const changed=[],skipped=[];
    for(const entry of Object.values(staged.entries)){
        const {roles,legacyLayout,protected:isProtected}=describeNexusCollectionEntry(entry);
        if(isProtected||!roles.length||roles.includes('npc-index'))continue;
        const options=new Set(roles.map(role=>modes[role]));
        if(options.size!==1||options.has(undefined)){skipped.push(entry.uid);continue;}
        const mode=[...options][0];
        if(mode==='keyword'&&!(entry.key||[]).some(key=>typeof key==='string'&&key.trim())){
            skipped.push(entry.uid);continue;
        }
        const before=JSON.stringify(entry);
        if(legacyLayout)entry.STMB_slothManagedLegacyRole=true;
        entry.disable=mode==='disabled';
        entry.constant=mode==='constant';
        entry.vectorized=mode==='vector';
        if(mode==='keyword'||mode==='vector')entry.selective=true;
        if(mode==='disabled')entry.STMB_slothRecallMode='disabled';
        else delete entry.STMB_slothRecallMode;
        if(JSON.stringify(entry)!==before)changed.push(entry.uid);
    }
    return {staged,changed,skipped};
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
        (!entry.disable && !entry.outletName && Number(entry.position)!==7 &&
            !entry.STMB_slothSideNote && !entry.STMB_sidePromptHistory &&
            ((entry.stmemorybooks===true && Array.isArray(entry.STMB_sourceRanges)) || isCompletedSceneEntry(entry))) ||
        entry.STMB_slothSceneMergedInto || entry.STMB_slothSceneMerge ||
        entry.STMB_slothSceneSplitArchive || entry.STMB_slothSceneSplitFrom));
    const rotated=planNexusSceneRotation({entries},{olderMode});
    Object.assign(staged.entries,rotated.proposedMemory.entries);
    return {staged,writes,rotation:rotated.changes};
}
