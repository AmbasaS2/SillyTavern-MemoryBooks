// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
// Reviewed split of ONLY the latest completed Scene with directly visible
// original-chat messages. Preserves its original UID/body/metadata as archive.

import {isCompletedSceneEntry,planNexusSceneRotation,sceneNumberFromTitle}
    from './nexusSceneRotation.js';
import {validateNexusEventPlan} from './nexusCollectionPolicy.js';
import {SPLIT_ARCHIVE,SPLIT_FROM,sourceRangesForSplit,
    expandSplitRanges} from './nexusSceneSplitArchives.js';

const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
const record=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const present=v=>v!==null&&v!==undefined&&v!==false&&v!==''&&
    (!Array.isArray(v)||v.length>0);
const references=[
    'STMB_canonicalEntryUid','STMB_canonicalLorebook','STMB_canonical',
    'disabledBySummaryId','stmbSourceEntryUids','STMB_inclusionGroup',
    'stmbSummary','stmbArc','stmbSummaryTier','STMB_sidePromptHistory',
];

export function inspectNexusSceneSplit(memory,chatIds) {
    assert(record(memory?.entries),'Memory World Info must have entries.');
    assert(!record(memory.stlo)||!Object.keys(memory.stlo).length,
        'Advanced STLO root references need separate split review.');
    assert(Array.isArray(chatIds)&&chatIds.some(id=>typeof id==='string'&&id.trim()),
        'A stable original chat identity is required.');
    const entries=Object.values(memory.entries);
    assert(entries.length>0,'Memory contains no completed Scene to split.');
    // All histories, UID/sequence collisions and disabled recent Scenes must
    // pass the existing rotation validation before even reading a candidate.
    const rotation=planNexusSceneRotation(memory);
    const numbers=new Set(),uids=new Set();
    for(const e of entries){
        const n=sceneNumberFromTitle(e?.comment);
        assert(integer(e?.uid)&&!uids.has(e.uid) && n!==null&&!numbers.has(n) &&
            isCompletedSceneEntry(e),
            'Memory contains invalid UID, numbering or an incomplete Scene.');
        uids.add(e.uid);numbers.add(n);
        assert(!e[SPLIT_ARCHIVE]&&!e[SPLIT_FROM]&&
            !e.STMB_slothSceneMerge&&!e.STMB_slothSceneMergedInto,
            'Nested or previously repaired Scene histories need manual review.');
        assert(!references.some(key=>present(e[key]))&&
            !present(e.outletName)&&Number(e.position)!==7&&!present(e.group),
            'Memory contains custom Outlet or unresolved canonical/group references.');
        assert(e.disable!==true,'Disabled Scene needs independent review before splitting.');
    }
    const latest=entries.reduce((best,e)=>!best||
        sceneNumberFromTitle(e.comment)>sceneNumberFromTitle(best.comment)?e:best,null);
    assert(rotation.recentUids.includes(latest.uid),'Latest Scene is not active.');
    assert(chatIds.includes(latest.STMB_chatId),
        'Latest completed Scene belongs to another chat/AU. Split blocked.');
    const ranges=sourceRangesForSplit(latest),ids=expandSplitRanges(ranges);
    assert(ids.length>=2 && ids.length<=5000,'Scene needs a limited, verifiable source range.');
    const seen=new Set(ids);
    for(const e of entries){
        if(e.uid===latest.uid||e.STMB_chatId!==latest.STMB_chatId)continue;
        for(const id of expandSplitRanges(sourceRangesForSplit(e))) {
            assert(!seen.has(id),'Another Scene overlaps the selected Scene source range.');
        }
    }
    return {sourceUid:latest.uid,sourceNumber:sceneNumberFromTitle(latest.comment),
        sourceTitle:latest.comment,sourceContent:latest.content,
        sourceChatId:latest.STMB_chatId,sourceRanges:ranges,sourceIds:ids,
        sourceSnapshot:structuredClone(latest)};
}

function sourceMap(messages) {
    assert(Array.isArray(messages)&&messages.length,'Visible original chat is required.');
    const mapped=new Map();
    for(const m of messages){
        assert(integer(m?.id)&&typeof m.mes==='string'&&m.mes.trim()&&
            !mapped.has(m.id),'Invalid, hidden, blank or duplicated source message.');
        mapped.set(m.id,m.mes);
    }
    return mapped;
}
function evidenceForSplit(item,mapped,messageIds,i) {
    assert(Array.isArray(item.evidence)&&item.evidence.length>=1&&
        item.evidence.length<=6,'Split part '+i+' needs original-chat evidence.');
    const allowed=new Set(messageIds);
    return item.evidence.map(x=>{
        assert(record(x)&&allowed.has(x.messageId)&&
            typeof x.quote==='string'&&x.quote===x.quote.trim()&&
            x.quote.length>=8&&x.quote.length<=400&&
            mapped.get(x.messageId)?.includes(x.quote),
            'Split part '+i+' cites a missing or out-of-part chat quote.');
        return {messageId:x.messageId,quote:x.quote};
    });
}

/**
 * No quota-derived splitting: model must prove each independent event and
 * exhaustively partition every original message, with no gaps/duplicates.
 * Completion order (last source ID), not the first mention, sets new order.
 */
export function validateNexusSceneSplitProposal(plan,raw,messages) {
    assert(record(plan)&&integer(plan.sourceUid)&&
        Array.isArray(plan.sourceIds)&&plan.sourceIds.length>=2&&
        record(raw)&&Array.isArray(raw.parts)&&raw.parts.length>=2&&
        raw.parts.length<=4,'Split requires two to four distinct completed events.');
    const mapped=sourceMap(messages);
    assert(plan.sourceIds.every(id=>mapped.has(id)),
        'Some archived source messages are hidden or absent from the current chat.');
    const analysis=validateNexusEventPlan({
        events:raw.parts.map(item=>({
            title:item?.title,reason:item?.reason,
            result:item?.result,complete:item?.complete,segments:item?.segments,
        })),deferred:[],
    },plan.sourceIds);
    const seenTitles=new Set();
    const parts=analysis.events.map((part,index)=>{
        const original=raw.parts[Number(part.id.slice('event-'.length))-1],
            title=part.title.trim();
        assert(!sceneNumberFromTitle(title) && !seenTitles.has(title.toLowerCase()),
            'Split parts need distinct, unnumbered event titles.');
        seenTitles.add(title.toLowerCase());
        return {...part,evidence:evidenceForSplit(original,mapped,part.messageIds,index+1)};
    });
    // The final response of each incident determines its narrative completion
    // order; source ranges can interleave but must never overlap.
    parts.sort((a,b)=>a.end-b.end);
    return {parts,sourceIds:[...plan.sourceIds],sourceUid:plan.sourceUid,
        sourceRanges:structuredClone(plan.sourceRanges)};
}

export function stageNexusSceneSplit(memory,{
    sourceUid,parts,messages,createEntry,olderMode='vector',
}={}) {
    assert(typeof createEntry==='function','Scene split entry creator is missing.');
    const source=Object.values(memory?.entries||{}).find(e=>e.uid===sourceUid);
    assert(source,'Split source Scene missing.');
    const plan=inspectNexusSceneSplit(memory,[source.STMB_chatId]);
    assert(plan.sourceUid===sourceUid,'Only the latest completed Scene can be split.');
    const verified=validateNexusSceneSplitProposal(plan,{
        parts:parts?.map(item=>({
            title:item.title,reason:item.reason,result:item.result,
            complete:true,segments:item.segments,evidence:item.evidence,
        })),
    },messages);
    assert(verified.parts.length===parts.length,
        'Split proposal changed while its draft was prepared.');
    const original=structuredClone(memory),staged=structuredClone(memory);
    const archived=Object.values(staged.entries).find(e=>e.uid===sourceUid);
    archived.disable=true;archived.constant=false;
    archived.vectorized=false;archived.selective=false;
    const snapshots=structuredClone(plan.sourceSnapshot);
    archived[SPLIT_ARCHIVE]={version:1,sourceNumber:plan.sourceNumber,
        source:snapshots,children:[]};
    const seen=new Set(Object.values(staged.entries).map(e=>e.uid));
    const writes=[];
    for(const [index,event] of verified.parts.entries()){
        const draft=parts.find(item=>JSON.stringify(item.segments)===
            JSON.stringify(event.segments)&&item.title===event.title);
        assert(draft&&typeof draft.content==='string'&&
            isCompletedSceneEntry({comment:'001 - Checked',content:draft.content}) &&
            /(?:\*\*Timeline\*\*|#{1,6}\s+Timeline)/i.test(draft.content),
            'Split Scene draft needs a completed Timeline / Scene / Result.');
        assert(Array.isArray(draft.keywords)&&
            draft.keywords.every(x=>typeof x==='string'),
            'Split keywords must be a string list.');
        const newEntry=createEntry(staged);
        assert(record(newEntry)&&integer(newEntry.uid)&&!seen.has(newEntry.uid),
            'Split entry constructor produced duplicate or invalid UID.');
        seen.add(newEntry.uid);
        newEntry.comment=String(plan.sourceNumber+index+1).padStart(3,'0')+
            ' - '+event.title;
        newEntry.content=draft.content;newEntry.stmemorybooks=true;
        newEntry.key=[...new Set(draft.keywords.map(x=>x.trim()).filter(Boolean))].slice(0,16);
        newEntry.disable=false;newEntry.position=0;newEntry.outletName='';
        newEntry.constant=false;newEntry.vectorized=true;newEntry.selective=true;
        newEntry.STMB_chatId=plan.sourceChatId;
        newEntry.STMB_sourceRanges=structuredClone(event.segments);
        if(event.segments.length===1){
            newEntry.STMB_start=event.segments[0][0];
            newEntry.STMB_end=event.segments[0][1];
            delete newEntry.STMB_discontiguous;
        }else{
            delete newEntry.STMB_start;delete newEntry.STMB_end;
            newEntry.STMB_discontiguous=true;
        }
        newEntry[SPLIT_FROM]={version:1,sourceUid,
            sourceNumber:plan.sourceNumber,partIndex:index,
            partsTotal:verified.parts.length};
        archived[SPLIT_ARCHIVE].children.push(newEntry.uid);
        writes.push({uid:newEntry.uid,title:newEntry.comment,
            segments:structuredClone(event.segments),before:'',after:newEntry.content});
    }
    const rotated=planNexusSceneRotation(staged,{olderMode});
    assert(JSON.stringify(original)===JSON.stringify(memory),
        'Source Memory changed during split staging.');
    return {plan,writes,originalSnapshot:snapshots,
        proposedMemory:rotated.proposedMemory,rotation:rotated.changes,
        retiredUid:sourceUid};
}
