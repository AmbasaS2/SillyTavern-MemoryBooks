import {describeNexusCollectionEntry} from './nexusCollectionPolicy.js';

// Experimental input policy only. Approximate UTF-8 bytes/3, not provider token counts.
export const SLOTH_NEXUS_INPUT_STRATEGY = 'hybrid';
export const SELECTIVE_DETAIL_BUDGET = 6000;
export const HYBRID_FULL_LIMIT = 12000;
const encoder = new TextEncoder();
export const estimateNexusTokens = value => Math.ceil(encoder.encode(String(value??'')).length/3);

const stop=new Set('the a an and or of in on to with for is was were are be been being as at from by it its this that they them their he she his her him you your i me my we our us had has have do did does not but so if then when will would could should can may said say just now there here what which who how'.split(' '));
function words(value){
    const normalized=String(value??'').normalize('NFKC').toLowerCase();
    const result=new Set();
    for(const word of normalized.match(/[\p{L}\p{N}]+/gu)||[]){
        if(word.length>=2&&!stop.has(word))result.add(word);
        if(/[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(word)){
            const chars=Array.from(word);
            for(let i=0;i+1<chars.length;i++)result.add(chars[i]+chars[i+1]);
        }
    }
    return result;
}
function overlap(set,query,frequencies,total){
    let score=0;
    for(const term of set)if(query.has(term))
        score+=1+Math.log((total+1)/((frequencies.get(term)||0)+1));
    return score;
}

// null means no omission. Every omitted entry remains in the prompt catalog.
export function selectNexusPromptEntries(nexus,messages,strategy=SLOTH_NEXUS_INPUT_STRATEGY){
    if(!['full','selective','hybrid'].includes(strategy))throw new Error('Unknown Nexus input strategy');
    if(strategy==='full')return null;
    const entries=Object.values(nexus?.entries||{}).filter(e=>e&&!describeNexusCollectionEntry(e).protected);
    if(strategy==='hybrid'&&entries.reduce((sum,e)=>sum+estimateNexusTokens(e.content),0)<=HYBRID_FULL_LIMIT)return null;
    const selected=new Set(), details=[];
    const query=words(messages.map(m=>m.mes).join('\n'));
    for(const entry of entries){
        const roles=describeNexusCollectionEntry(entry).roles;
        if(entry.constant||!roles.length||roles.some(role=>!['lt','npc'].includes(role))){
            selected.add(entry.uid);continue;
        }
        const titleWords=words([String(entry.comment||'').replace(/^(LT|NPC)\s*[-:]\s*/i,''),...(entry.key||[]),...(entry.keysecondary||[])].join(' '));
        const bodyWords=words(entry.content);
        details.push({entry,titleWords,bodyWords,all:new Set([...titleWords,...bodyWords])});
    }
    const frequencies=new Map();
    for(const row of details)for(const term of row.all)frequencies.set(term,(frequencies.get(term)||0)+1);
    const ranked=details.map(row=>({...row,score:4*overlap(row.titleWords,query,frequencies,details.length)+overlap(row.bodyWords,query,frequencies,details.length)}))
        .sort((a,b)=>b.score-a.score||String(a.entry.uid).localeCompare(String(b.entry.uid),'en',{numeric:true}));
    let remaining=SELECTIVE_DETAIL_BUDGET;
    for(const {entry,score} of ranked){
        if(score<=0)continue;
        const cost=estimateNexusTokens(entry.content);
        if(cost>remaining)continue;
        selected.add(entry.uid);remaining-=cost;
    }
    return entries.every(e=>selected.has(e.uid))?null:selected;
}

export function validateSelectedNexusResponse(raw,selected,nexus){
    if(selected===null)return;
    if(!Array.isArray(raw.needsNexusUids))throw new Error('Selective Nexus response missing needsNexusUids; no changes saved.');
    const omitted=new Set(Object.values(nexus.entries||{}).filter(e=>!describeNexusCollectionEntry(e).protected&&!selected.has(e.uid)).map(e=>Number(e.uid)));
    if(raw.needsNexusUids.some(uid=>omitted.has(Number(uid)))||
        (Array.isArray(raw.edits)&&raw.edits.some(op=>op?.action!=='create'&&omitted.has(Number(op?.uid))))){
        throw new Error('Nexus collection needs omitted entry bodies; no memories saved. Use the full-input branch for this source.');
    }
    if(raw.needsNexusUids.length)throw new Error('Invalid needsNexusUids response; no changes saved.');
}
