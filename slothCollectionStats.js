// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
// Optional, bounded browser-local collection metrics. Never a recovery receipt.
export const SLOTH_COLLECTION_HISTORY_LIMIT=30;
export const SLOTH_STATS_PHASES=['collection','review','side'];
export const SLOTH_STATS_FIELDS=['input','output','cacheRead','cacheWrite','usd'];
const HISTORY_KEY='STMemoryBooks.sloth.collectionStats.v1';
const COUNTS=['sceneProposed','nexusProposed','sceneAccepted','nexusAccepted','sceneCreated','sceneReused','nexusCreated','nexusUpdated','nexusEditsSaved','sceneHeld','nexusHeld','pendingMessages','sideSaved'];
const STATES=['failed','cancelled','blocked','empty','held','partial','saved','recovered','uncertain'];
const count=v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null;
const decimal=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
const modelId=v=>typeof v==='string'&&/^[a-z0-9][a-z0-9._:/+-]{0,119}$/i.test(v)&&!v.includes('://')&&!/^(?:sk[-_]|key[-_]|bearer|token[-_])/i.test(v)?v:null;
const valueGroup=()=>({reported:0,reportedN:0,estimated:0,estimatedN:0,bytes:0,bytesN:0,unknownN:0});
const group=()=>({requests:0,responded:0,failed:0,cancelled:0,blocked:0,blockedEstimate:null,durationMs:0,models:[],values:Object.fromEntries(SLOTH_STATS_FIELDS.map(k=>[k,valueGroup()]))});
const first=(...v)=>v.map(count).find(n=>n!==null)??null;
const phaseKey=v=>SLOTH_STATS_PHASES.includes(v)?v:'collection';
function field(usage,k){
    if(k==='input')return first(usage?.prompt_tokens,usage?.input_tokens);
    if(k==='output')return first(usage?.completion_tokens,usage?.output_tokens);
    if(k==='cacheRead')return first(usage?.prompt_tokens_details?.cached_tokens,usage?.input_tokens_details?.cached_tokens,usage?.cache_read_input_tokens);
    if(k==='cacheWrite')return first(usage?.cache_creation_input_tokens,usage?.prompt_tokens_details?.cache_write_tokens,usage?.input_tokens_details?.cache_write_tokens);
    // Do not infer currency from an unlabeled cost field.
    return decimal(usage?.cost_usd)??decimal(usage?.total_cost_usd);
}
export function makeSlothRequestMetric({phase,model,estimate,full,status='response',durationMs=0}={}){
    const usage=full?.usage??full?.stmb_streaming?.last_chunk?.usage;
    const reported=Object.fromEntries(SLOTH_STATS_FIELDS.map(k=>[k,field(usage,k)]));
    if(reported.usd===null)reported.usd=decimal(full?.cost_usd)??decimal(full?.total_cost_usd);
    return {phase:phaseKey(phase),model:modelId(model),status:['response','failed','cancelled','blocked'].includes(status)?status:'failed',
        durationMs:count(Math.max(0,Math.round(durationMs)))??0,reported,
        estimate:count(estimate?.input),estimateKind:estimate?.estimated==='bytes'?'bytes':'tokens'};
}
export function emitSlothRequestMetric(observer,details){
    if(typeof observer!=='function')return;
    try{observer(makeSlothRequestMetric(details));}catch{/* Telemetry must not affect collection. */}
}
export function createSlothCollectionRun({ids=[],startedAt=Date.now(),automatic=false,replayed=false,initial=false,partialSource=false,reviewSummaries=false,evidencePolicyVersion=2}={}){
    const ranges=[];let last=-2,rangeCount=0,firstId=null,end=null,messageCount=0;
    for(const id of ids){
        if(count(id)===null||id<=last)continue;
        if(firstId===null)firstId=id;
        if(id!==last+1){rangeCount++;if(ranges.length<12)ranges.push([id,id]);}
        else if(rangeCount<=12&&ranges.length)ranges.at(-1)[1]=id;
        last=id;end=id;messageCount++;
    }
    return {version:1,method:'single',startedAt,finishedAt:null,elapsedMs:null,trigger:replayed?'recovery':automatic?'automatic':'manual',
        initial:!!initial,partialSource:!!partialSource,reviewSummaries:!!reviewSummaries,evidencePolicyVersion:count(evidencePolicyVersion),
        source:{first:firstId,end,messageCount,ranges,rangeCount},status:'failed',counts:Object.fromEntries(COUNTS.map(k=>[k,null])),
        receiptVerified:null,recoveryVerified:null,groups:Object.fromEntries(SLOTH_STATS_PHASES.map(k=>[k,group()]))};
}
export function addSlothRequestMetric(run,m){
    if(!run||!m)return;
    const g=run.groups[phaseKey(m.phase)];
    if(m.model&&!g.models.includes(m.model)&&g.models.length<4)g.models.push(m.model);
    if(m.status==='blocked'){
        g.blocked++;g.blockedEstimate=m.estimate===null?null:{value:m.estimate,kind:m.estimateKind};return;
    }
    g.requests++;g.durationMs+=m.durationMs;
    if(m.status==='response')g.responded++;else if(m.status==='cancelled')g.cancelled++;else g.failed++;
    for(const k of SLOTH_STATS_FIELDS){
        const v=g.values[k],actual=m.reported[k];
        if(actual!==null){v.reported+=actual;v.reportedN++;}
        else if(k==='input'&&m.estimate!==null){
            if(m.estimateKind==='bytes'){v.bytes+=m.estimate;v.bytesN++;}
            else{v.estimated+=m.estimate;v.estimatedN++;}
        }else v.unknownN++;
    }
}
export function totalSlothRequestMetrics(groups){
    const total=group();
    for(const phase of SLOTH_STATS_PHASES){
        const g=groups?.[phase];if(!g)continue;
        for(const k of ['requests','responded','failed','cancelled','blocked','durationMs'])total[k]+=g[k];
        for(const m of g.models)if(!total.models.includes(m)&&total.models.length<4)total.models.push(m);
        for(const k of SLOTH_STATS_FIELDS)for(const v of Object.keys(valueGroup()))total.values[k][v]+=g.values[k][v];
    }
    return total;
}
// Rebuild a strict whitelist on both load and save. No arbitrary error text,
// chat names/IDs, lorebook or preset content, URLs, credentials or raw replies.
function cleanRun(run){
    if(run?.version!==1||count(run.startedAt)===null||count(run.finishedAt)===null)return null;
    const c=createSlothCollectionRun({startedAt:run.startedAt});
    c.finishedAt=run.finishedAt;c.elapsedMs=count(run.elapsedMs);
    c.trigger=['manual','automatic','recovery'].includes(run.trigger)?run.trigger:'manual';
    c.status=STATES.includes(run.status)?run.status:'failed';
    for(const k of ['initial','partialSource','reviewSummaries'])c[k]=run[k]===true;
    for(const k of ['receiptVerified','recoveryVerified'])c[k]=typeof run[k]==='boolean'?run[k]:null;
    c.evidencePolicyVersion=count(run.evidencePolicyVersion);
    const s=run.source;
    c.source={first:count(s?.first),end:count(s?.end),messageCount:count(s?.messageCount),rangeCount:count(s?.rangeCount),
        ranges:Array.isArray(s?.ranges)?s.ranges.slice(0,12).filter(r=>Array.isArray(r)&&count(r[0])!==null&&count(r[1])!==null&&r[0]<=r[1]).map(r=>[r[0],r[1]]):[]};
    for(const k of COUNTS)c.counts[k]=count(run.counts?.[k]);
    for(const phase of SLOTH_STATS_PHASES){
        const old=run.groups?.[phase],g=c.groups[phase];
        for(const k of ['requests','responded','failed','cancelled','blocked','durationMs'])g[k]=count(old?.[k])??0;
        g.models=Array.isArray(old?.models)?old.models.slice(0,4).map(modelId).filter(Boolean):[];
        const b=old?.blockedEstimate;g.blockedEstimate=count(b?.value)!==null?{value:b.value,kind:b.kind==='bytes'?'bytes':'tokens'}:null;
        for(const k of SLOTH_STATS_FIELDS)for(const v of Object.keys(valueGroup()))g.values[k][v]=(k==='usd'&&v==='reported'?decimal(old?.values?.[k]?.[v]):count(old?.values?.[k]?.[v]))??0;
    }
    return c;
}
let fallbackHistory=null;
function browserStorage(){try{return globalThis.localStorage;}catch{return null;}}
export function readSlothCollectionHistory(storage=browserStorage()){
    if(fallbackHistory)return fallbackHistory.map(cleanRun).filter(Boolean);
    try{
        const raw=storage?.getItem(HISTORY_KEY);
        if(!raw||raw.length>400000)return [];
        const rows=JSON.parse(raw);
        return Array.isArray(rows)?rows.slice(0,SLOTH_COLLECTION_HISTORY_LIMIT).map(cleanRun).filter(Boolean):[];
    }catch{return [];}
}
export function recordSlothCollectionRun(run,storage=browserStorage(),finishedAt=Date.now()){
    try{
        run.finishedAt=finishedAt;run.elapsedMs=Math.max(0,finishedAt-run.startedAt);
        const row=cleanRun(run);if(!row)return;
        const history=[row,...readSlothCollectionHistory(storage)].slice(0,SLOTH_COLLECTION_HISTORY_LIMIT);
        try{if(!storage)throw Error();storage.setItem(HISTORY_KEY,JSON.stringify(history));fallbackHistory=null;}
        catch{fallbackHistory=history;}
    }catch{/* An unavailable or full browser store cannot block recovery or saving. */}
}
export function clearSlothCollectionHistory(storage=browserStorage()){
    fallbackHistory=null;
    try{storage?.removeItem(HISTORY_KEY);return true;}catch{return false;}
}
