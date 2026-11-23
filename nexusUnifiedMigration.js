// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
//
// Read-only classifier and clone-only staged split of an old combined Memory
// (Scenes + Side Prompts + non-Scene Outlets) into character Nexus and Memory.
// Two-book commit, backup and user approval are implemented by the runtime.

import {isCompletedSceneEntry, sceneNumberFromTitle, planNexusSceneRotation} from './nexusSceneRotation.js';
import {stageNexusLegacyMigration} from './nexusLegacyMigration.js';
import { hasNeutralNexusStloSettings } from './nexusStloSettings.js';

const record=v=>!!v && typeof v==='object' && !Array.isArray(v);
const title=e=>String(e?.comment||'').trim();
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const SOURCE_METADATA='STMB_slothImportedOriginal';
const CROSS_REFERENCE_FIELDS=[
    'stmbSourceEntryUids','disabledBySummaryId','STMB_canonicalEntryUid',
    'STMB_canonicalLorebook','STMB_inclusionGroup','STMB_canonical',
    'stmbSummary','stmbArc','stmbSummaryTier',
];
function safeUnique(book,label) {
    assert(record(book?.entries),label+' is not a World Info object.');
    const uids=new Set(),comments=new Set();
    for(const e of Object.values(book.entries)){
        assert(Number.isSafeInteger(e?.uid)&&e.uid>=0&&!uids.has(e.uid),
            label+' contains missing or duplicate UIDs.');
        uids.add(e.uid);
        if(title(e))comments.add(title(e).toLowerCase());
    }
    return comments;
}
function crossReference(e) {
    return CROSS_REFERENCE_FIELDS.find(field=>e?.[field]!==undefined &&
        e[field]!==null && e[field]!==false && e[field]!=='' &&
        (!Array.isArray(e[field])||e[field].length)) || '';
}

export function inspectUnifiedMemorySplit(memory,nexus) {
    const existing=safeUnique(nexus,'Nexus');
    safeUnique(memory,'Memory');
    const scenes=[],other=[],errors=[];
    for(const [key,e] of Object.entries(memory.entries)){
        const number=sceneNumberFromTitle(e.comment);
        const isScene=e.stmemorybooks===true || isCompletedSceneEntry(e);
        if(isScene || number!==null) {
            if(!isCompletedSceneEntry(e))errors.push('Scene UID '+e.uid+' lacks a complete Scene/Result.');
            else scenes.push({key,entry:e});
        }else {
            other.push({key,entry:e});
            const reference=crossReference(e);
            if(reference)errors.push('Non-Scene UID '+e.uid+' has cross-entry reference '+reference+'.');
            if(!title(e))errors.push('Non-Scene UID '+e.uid+' has no title.');
            if(typeof e.group==='string' && e.group.trim()) {
                errors.push('Non-Scene UID '+e.uid+' uses a World Info group; cross-book grouping needs manual review.');
            }
            if(existing.has(title(e).toLowerCase()))errors.push('Nexus already contains "'+title(e)+'".');
            if(e[SOURCE_METADATA])errors.push('Non-Scene UID '+e.uid+' appears already transferred.');
        }
    }
    if(other.length) {
        if(!hasNeutralNexusStloSettings(memory.stlo)||!hasNeutralNexusStloSettings(nexus.stlo)) {
            errors.push('STLO root settings may change recall for moved entries; review both books before migrating.');
        }
        for(const item of scenes){
            const reference=crossReference(item.entry);
            if(reference)errors.push('Scene UID '+item.entry.uid+' has '+reference+' references; split cannot prove safe.');
        }
    }
    return {
        required:other.length>0,
        sceneCount:scenes.length,
        nonSceneCount:other.length,
        nonScene:other.map(({entry})=>({uid:entry.uid,title:title(entry),
            position:entry.position,outletName:entry.outletName||'',contentLength:String(entry.content||'').length})),
        errors,
        sceneKeys:scenes.map(item=>item.key),
        nonSceneKeys:other.map(item=>item.key),
    };
}

export function stageUnifiedMemorySplit({memory,nexus,createNexusEntry,olderMode='vector'}) {
    const plan=inspectUnifiedMemorySplit(memory,nexus);
    assert(plan.required,'Memory is already Scene-only. No split needed.');
    assert(!plan.errors.length,'Combined-book migration blocked: '+plan.errors.join(' '));
    assert(typeof createNexusEntry==='function','Nexus World Info entry creator required.');
    const destination=structuredClone(nexus);
    const source=structuredClone(memory);
    const mapping=[],movements=[];
    for(const key of plan.nonSceneKeys) {
        const original=source.entries[key],exact=structuredClone(original);
        const inserted=createNexusEntry(destination);
        assert(inserted && Number.isSafeInteger(inserted.uid)&&inserted.uid>=0,
            'Nexus entry constructor returned invalid UID.');
        const newUid=inserted.uid,allocatedDisplayIndex=inserted.displayIndex;
        assert(!Object.values(destination.entries).some(e=>e!==inserted&&e.uid===newUid),
            'Nexus entry creator produced duplicate UID.');
        Object.assign(inserted,structuredClone(original));
        inserted.uid=newUid;
        if(allocatedDisplayIndex!==undefined)inserted.displayIndex=allocatedDisplayIndex;
        else delete inserted.displayIndex;
        // Store the exact former entry (including its original UID and display
        // order), so every metadata change is reversible after an approved backup.
        inserted[SOURCE_METADATA]={version:1,lorebook:'Memory',original:exact};
        mapping.push({originalUid:exact.uid,newUid,title:title(original),originalKey:key});
        movements.push({action:'transfer',title:title(original),uid:newUid,fromUid:exact.uid,
            content:String(original.content||''),outletName:original.outletName||''});
        delete source.entries[key];
    }
    // Reuse the independently tested, non-destructive legacy -> Core/Continuity
    // conversion on the just-transferred originals.
    const converted=stageNexusLegacyMigration(destination,createNexusEntry);
    const rotated=planNexusSceneRotation(source,{olderMode});
    // Structural proof of fidelity for every moved entry.
    for(const move of mapping) {
        const next=Object.values(converted.staged.entries).find(e=>e.uid===move.newUid);
        assert(next && next[SOURCE_METADATA]?.original?.uid===move.originalUid,
            'Transferred source UID mapping was lost.');
        const archived=next.STMB_slothLegacyArchive?.version===1;
        const expected=next[SOURCE_METADATA].original;
        assert(next.comment===expected.comment && next.content===expected.content,
            'A transferred entry lost its original title/content.');
        if(!archived) {
            for(const [field,value] of Object.entries(expected)){
                if(field==='uid'||field==='displayIndex')continue;
                assert(JSON.stringify(next[field])===JSON.stringify(value),
                    'Transferred entry metadata changed unexpectedly: '+field);
            }
        }else{
            assert(next.disable===true,'Migrated source was not archived.');
        }
    }
    assert(Object.keys(rotated.proposedMemory.entries).length===plan.sceneCount,
        'Scene count changed during split.');
    for(const key of plan.sceneKeys) {
        const before=memory.entries[key],after=rotated.proposedMemory.entries[key];
        assert(after && after.uid===before.uid &&
            after.comment===before.comment && after.content===before.content,
            'Existing Memory Scene content or source UID changed.');
    }
    return {
        nexus:converted.staged,
        memory:rotated.proposedMemory,
        plan,
        mapping,
        changes:[...movements,...converted.changes],
        sceneRotation:rotated.changes,
    };
}
