// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
// Read-only inventory. Counts stored text, not actual RP injection or semantic truth.
import {describeNexusCollectionEntry} from './nexusCollectionPolicy.js';

export const SLOTH_HEALTH_ROLES=['core','continuity','lt','npc','mixed','other','protected'];

export async function inspectSlothNexusHealth(book,countTokens){
    if(!book?.entries || typeof book.entries!=='object' || typeof countTokens!=='function')
        throw new Error('Invalid Nexus health input.');
    const groups=Object.fromEntries(SLOTH_HEALTH_ROLES.map(role=>[role,{entries:0,tokens:0,alwaysOnTokens:0,uncounted:0,alwaysOnUncounted:0}]));
    const rows=[],paragraphs=new Map(),counts=new Map();
    for(const entry of Object.values(book.entries)){
        if(!entry || typeof entry!=='object')continue;
        const {roles,protected:protectedEntry}=describeNexusCollectionEntry(entry);
        const role=protectedEntry?'protected':roles.length>1?'mixed':
            SLOTH_HEALTH_ROLES.includes(roles[0])?roles[0]:'other';
        const body=typeof entry.content==='string'?entry.content:'';
        const alwaysOn=entry.constant===true && !entry.disable;
        let tokens=body.trim()?null:0;
        if(tokens===null){
            // A single snapshot need not count identical bodies twice.
            // Keep the cache local to this explicit operation and tokenizer.
            if(counts.has(body))tokens=counts.get(body);
            else{
                try{
                    const n=await countTokens(body);
                    if(Number.isFinite(n)&&n>0)tokens=Math.max(1,Math.round(n));
                }catch{/* Unknown is not zero. */}
                counts.set(body,tokens);
            }
        }
        const group=groups[role];
        group.entries++;
        if(tokens===null){group.uncounted++;if(alwaysOn)group.alwaysOnUncounted++;}
        else {group.tokens+=tokens;if(alwaysOn)group.alwaysOnTokens+=tokens;}
        rows.push({uid:entry.uid,title:String(entry.comment||''),role,tokens,alwaysOn,
            disabled:Boolean(entry.disable),body});
        // Only literal repeated nontrivial paragraphs in editable active items.
        // Never infer semantic equivalence or a resolved condition.
        if(protectedEntry||entry.disable)continue;
        for(const paragraph of new Set(body.split(/\r?\n\s*\r?\n/u).map(p=>p.trim()).filter(p=>p.length>=24))){
            if(!paragraphs.has(paragraph))paragraphs.set(paragraph,[]);
            paragraphs.get(paragraph).push({uid:entry.uid,title:String(entry.comment||'')});
        }
    }
    const duplicates=[...paragraphs].filter(([,entries])=>entries.length>1)
        .map(([text,entries])=>({text,entries}));
    const total=Object.values(groups).reduce((sum,g)=>sum+g.tokens,0);
    const alwaysOn=Object.values(groups).reduce((sum,g)=>sum+g.alwaysOnTokens,0);
    return {groups,total,alwaysOn,uncounted:rows.filter(row=>row.tokens===null).length,
        alwaysOnUncounted:rows.filter(row=>row.alwaysOn&&row.tokens===null).length,duplicates,
        rows:rows.sort((a,b)=>(b.tokens??-1)-(a.tokens??-1))};
}
