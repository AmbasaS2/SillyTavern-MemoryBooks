// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
// Verify full-history archives of an explicitly reviewed latest-Scene split.
// Pure validation. This module intentionally imports no collection/runtime code.
export const SPLIT_ARCHIVE='STMB_slothSceneSplitArchive';
export const SPLIT_FROM='STMB_slothSceneSplitFrom';
const has=(e,k)=>Object.prototype.hasOwnProperty.call(e,k);
const assert=(ok,why)=>{if(!ok)throw new Error(why);};
const record=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const integer=v=>Number.isSafeInteger(v)&&v>=0;

export function sourceRangesForSplit(entry) {
    const modern=entry?.STMB_sourceRanges;
    const legacy=integer(entry?.STMB_start)&&integer(entry?.STMB_end)
        ?[[entry.STMB_start,entry.STMB_end]]:null;
    const raw=Array.isArray(modern)&&modern.length?modern:legacy;
    assert(Array.isArray(raw)&&raw.length,
        'Scene UID '+entry?.uid+' is missing verifiable original chat ranges.');
    if(Array.isArray(modern)&&modern.length &&
        (entry.STMB_start!==undefined || entry.STMB_end!==undefined)){
        assert(modern.length===1&&legacy&&
            modern[0]?.[0]===legacy[0][0]&&modern[0]?.[1]===legacy[0][1],
            'Scene UID '+entry.uid+' has conflicting legacy source bounds.');
    }
    const sorted=raw.map(pair=>{
        assert(Array.isArray(pair)&&pair.length===2&&pair.every(integer) &&
            pair[1]>=pair[0],'Scene UID '+entry.uid+' has malformed source ranges.');
        return [...pair];
    }).sort((a,b)=>a[0]-b[0]);
    for(let i=1;i<sorted.length;i++){
        assert(sorted[i][0]>sorted[i-1][1],
            'Scene UID '+entry.uid+' has overlapping source spans.');
    }
    return sorted;
}

export function expandSplitRanges(ranges) {
    const result=[];
    for(const [a,b] of ranges){
        assert(b-a<5000,'Scene source span is too large for safe explicit validation.');
        for(let n=a;n<=b;n++)result.push(n);
        assert(result.length<=5000,'Scene has too many messages for one safe split.');
    }
    return result;
}

/** Called by rotation BEFORE it considers any active/archived Scene flags. */
export function validateSplitArchives(entries) {
    const byUid=new Map(entries.map(entry=>[entry?.uid,entry]));
    for(const entry of entries){
        const archived=has(entry,SPLIT_ARCHIVE),child=has(entry,SPLIT_FROM);
        if(!archived&&!child)continue;
        assert(!(archived&&child),'Nested Scene splits are unsupported.');
        if(archived){
            const m=entry[SPLIT_ARCHIVE],original=m?.source;
            assert(m?.version===1&&record(original)&&original.uid===entry.uid&&
                Array.isArray(m.children)&&m.children.length>=2&&m.children.length<=4 &&
                new Set(m.children).size===m.children.length&&
                entry.disable===true&&entry.constant===false&&
                entry.vectorized===false&&entry.selective===false,
                'Broken Scene split archive UID '+entry.uid+'.');
            const copy=structuredClone(entry);
            delete copy[SPLIT_ARCHIVE];
            for(const key of ['disable','constant','vectorized','selective']){
                if(has(original,key))copy[key]=structuredClone(original[key]);
                else delete copy[key];
            }
            assert(JSON.stringify(copy)===JSON.stringify(original),
                'Scene split archive original body or metadata was altered UID '+entry.uid+'.');
            const sourceIds=expandSplitRanges(sourceRangesForSplit(original));
            const union=[];
            for(const [index,uid] of m.children.entries()){
                const part=byUid.get(uid),marker=part?.[SPLIT_FROM];
                assert(record(marker)&&marker.version===1 &&
                    marker.sourceUid===entry.uid && marker.partIndex===index &&
                    marker.partsTotal===m.children.length &&
                    marker.sourceNumber===m.sourceNumber &&
                    part.STMB_chatId===original.STMB_chatId &&
                    part.disable!==true && typeof part.content==='string' &&
                    part.content.trim(),
                    'Scene split child or provenance is missing/corrupt UID '+uid+'.');
                union.push(...expandSplitRanges(sourceRangesForSplit(part)));
            }
            const unique=[...new Set(union)].sort((a,b)=>a-b);
            assert(unique.length===union.length&&
                JSON.stringify(unique)===JSON.stringify(sourceIds),
                'Scene split children overlap or omit source messages (UID '+entry.uid+').');
        }else{
            const m=entry[SPLIT_FROM],archive=byUid.get(m?.sourceUid);
            assert(m?.version===1&&archive?.[SPLIT_ARCHIVE]?.children?.includes(entry.uid),
                'Orphaned Scene split child UID '+entry.uid+'.');
        }
    }
}
