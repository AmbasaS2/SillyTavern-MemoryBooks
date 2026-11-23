// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
// Pure, loss-averse event validation and World Info staging.

import { planNexusSceneRotation, sceneNumberFromTitle } from './nexusSceneRotation.js';
import { appendContinuitySection, guardContinuityChange,
    guardNewContinuityContent } from './nexusContinuitySections.js';

const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const str = v => typeof v === 'string' ? v.trim() : '';
const requireThat = (ok, msg) => { if (!ok) throw new Error(msg); };
const intUid = x => Number.isSafeInteger(Number(x)) && Number(x) >= 0 ? Number(x) : null;

export function validateNexusEventPlan(raw, sourceIds) {
    requireThat(plain(raw) && Array.isArray(sourceIds) && sourceIds.length, 'Missing analysis or source.');
    requireThat(Array.isArray(raw.events), 'Analysis events must be an array.');
    const allowed = new Set(sourceIds), assigned = new Map(), events = [], deferred = [];
    requireThat(allowed.size === sourceIds.length && sourceIds.every(Number.isSafeInteger), 'Invalid source IDs.');
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
    for (const [i,item] of raw.events.entries()) {
        const title = str(item?.title), reason = str(item?.reason), result=str(item?.result);
        requireThat(title && title.length<=180 && reason && result && item.complete === true,
            'Event '+(i+1)+' must have title, causal boundary reason and completed result.');
        const data = ranges(item.segments, 'event '+(i+1));
        events.push({ id:'event-'+(i+1), title, reason, result,...data,
            start:data.messageIds[0],end:data.messageIds.at(-1) });
    }
    for (const [i,item] of (raw.deferred || []).entries()) {
        requireThat(str(item?.reason), 'Deferred '+(i+1)+' needs a reason.');
        deferred.push({reason:str(item.reason),...ranges(item.segments,'deferred '+(i+1))});
    }
    const lost = sourceIds.filter(id => !assigned.has(id));
    requireThat(!lost.length, 'AI left '+lost.length+' messages unclassified, first #' + lost[0] + '. No writes.');
    events.sort((a,b)=>a.start-b.start);
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

export function fingerprintSlothChat(chat,ids) {
    requireThat(Array.isArray(chat) && Array.isArray(ids),'Invalid chat snapshot.');
    return JSON.stringify(ids.map(id=>{
        const item=chat[id];
        requireThat(item && !item.is_system,'Source #'+id+' is missing or hidden.');
        return [id,item.name,item.mes,item.is_user,item.send_date,item.swipe_id??null];
    }));
}

const protectedEntry = entry => entry?.disable || Number(entry?.position)===7 ||
    str(entry?.outletName) || /^(?:Kinks|PanelAssets)(?:\b|$)/i.test(str(entry?.comment)) ||
    !!entry?.STMB_sidePromptHistory;
function getUidEntry(book,uid){
    const matches=Object.values(book.entries||{}).filter(e=>intUid(e?.uid)===uid);
    requireThat(matches.length===1,'Nexus UID '+uid+' is ambiguous/missing.');
    requireThat(!protectedEntry(matches[0]),'Special/disabled Nexus entry cannot be edited.');
    return matches[0];
}
export function stageNexusEdits(original, edits, createEntry) {
    requireThat(plain(original?.entries) && Array.isArray(edits) && typeof createEntry==='function',
        'Invalid Nexus staging input.');
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
            if(kind==='core')requireThat(title==='Core Memory','Core Memory title mismatch.');
            if(kind==='continuity')requireThat(title==='Current Continuity','Continuity title mismatch.');
            if(title==='Core Memory')requireThat(kind==='core','Core Memory must use core kind.');
            if(title==='Current Continuity')requireThat(kind==='continuity','Continuity must use continuity kind.');
            if(kind==='continuity')guardNewContinuityContent(content);
            const entry=createEntry(staged);
            requireThat(entry && intUid(entry.uid)!==null,'World Info entry constructor failed.');
            entry.comment=title;entry.content=content;entry.disable=false;entry.position=0;
            entry.constant=['core','continuity','npc-index'].includes(kind);
            entry.vectorized=['lt','npc'].includes(kind);
            entry.selective=['lt','npc'].includes(kind);
            entry.key=Array.isArray(op.keywords)?[...new Set(op.keywords.map(str).filter(Boolean))].slice(0,16):[];
            titles.add(title.toLowerCase());
            changes.push({action,kind,title,uid:entry.uid,before:'',after:content});
            continue;
        }
        const uid=intUid(op?.uid);
        requireThat(uid!==null,'Nexus edit needs existing numeric UID.');
        const entry=getUidEntry(staged,uid), title=str(entry.comment), before=String(entry.content||'');
        if(kind==='core')requireThat(title==='Core Memory','Core Memory UID mismatch.');
        if(kind==='continuity')requireThat(title==='Current Continuity','Continuity UID mismatch.');
        if(title==='Core Memory')requireThat(kind==='core','Core Memory kind mismatch.');
        if(title==='Current Continuity')requireThat(kind==='continuity','Continuity kind mismatch.');
        const text=str(op.text);
        requireThat(text,'Nexus edit has empty text.');
        if(action!=='replace_exact')requireThat(!before.includes(text),
            'Nexus addition already exists; refusing a repeated append.');
        if(action==='replace_exact'){
            const find=str(op.find);
            requireThat(find && before.split(find).length===2,'Nexus exact text does not match uniquely: '+title);
            entry.content=before.replace(find,text);
        }else if(action==='append_section'){
            entry.content=appendContinuitySection(before,op.section,text);
        }else{
            requireThat(kind!=='continuity',
                'Current Continuity append must specify a section using append_section.');
            entry.content=before+(before.endsWith('\n')?'\n':'\n\n')+text;
        }
        if(kind==='continuity')guardContinuityChange(before,entry.content,
            {action,section:op.section});
        requireThat(entry.content!==before,'Nexus edit made no change; refusing a no-op save.');
        changes.push({action,kind,title,uid,before,after:entry.content});
    }
    return {staged,changes};
}

export function stageMemoryScenes(original,scenes,createEntry,{chatId='',olderMode='vector'}={}) {
    requireThat(plain(original?.entries) && Array.isArray(scenes) && scenes.length &&
        typeof createEntry==='function','Invalid Memory staging input.');
    const staged=structuredClone(original);
    const numbers=Object.values(staged.entries).map(e=>sceneNumberFromTitle(e.comment));
    requireThat(numbers.every(x=>x!==null) && new Set(numbers).size===numbers.length,
        'Existing Memory scene numbering is ambiguous.');
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
    const rotated=planNexusSceneRotation(staged,{olderMode});
    return {staged:rotated.proposedMemory,writes,rotation:rotated.changes};
}
