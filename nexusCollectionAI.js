// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
// Sloth collector LLM calls; no data writes.
import { requestCompletion } from './stmemory.js';
import { getCurrentApiInfo, getUIModelSettings, normalizeCompletionSource,
    resolveEffectiveConnectionFromProfile } from './utils.js';
import { oai_settings } from '../../../openai.js';
import { groupSlothSourceWindows, validateNexusEventPlan } from './nexusCollectionPolicy.js';

function parseStrictJSON(raw,phase) {
    const text=String(raw||'').replace(/<think>[\s\S]*?<\/think>/gi,'').trim();
    const fenced=text.match(/^\x60{3,}(?:json)?\s*\n([\s\S]*?)\n\x60{3,}\s*$/i);
    let parsed;
    try {parsed=JSON.parse(fenced?fenced[1]:text);}
    catch {throw new Error(phase+': AI returned malformed or incomplete JSON. No data saved.');}
    if(!parsed || typeof parsed!=='object' || Array.isArray(parsed))throw new Error(phase+': JSON object required.');
    return parsed;
}
function resolveConnection(profile) {
    if(!profile || profile?.connection?.api==='current_st'||profile.useDynamicSTSettings){
        const apiInfo=getCurrentApiInfo(), modelInfo=getUIModelSettings();
        const api=normalizeCompletionSource(apiInfo.completionSource||apiInfo.api||'openai');
        return {api,model:modelInfo.model||'',temperature:0.25,
            useChatCompletionService:!!profile?.useChatCompletionService && api!=='full-manual',
            chatCompletionPreset:String(profile?.chatCompletionPreset||'').trim()};
    }
    const conn=resolveEffectiveConnectionFromProfile(profile);
    return {...conn,temperature:Math.min(.5,conn.temperature??.3),
        useChatCompletionService:!!profile?.useChatCompletionService && conn.api!=='full-manual',
        chatCompletionPreset:String(profile?.chatCompletionPreset||'').trim()};
}
function requester(profile,settings,signal) {
    const connection=resolveConnection(profile);
    const extra={},max=Number.parseInt(settings?.moduleSettings?.maxTokens,10);
    if(Number.isFinite(max)&&max>0)extra.max_tokens=max;
    else if(oai_settings?.openai_max_tokens)extra.max_tokens=oai_settings.openai_max_tokens;
    return async (prompt,phase)=>{
        if(signal?.aborted)throw new Error('Collection cancelled.');
        const {text}=await requestCompletion({...connection,prompt,extra,signal});
        if(signal?.aborted)throw new Error('Collection cancelled.');
        return parseStrictJSON(text,phase);
    };
}
const compact=messages=>JSON.stringify(messages.map(m=>({id:m.id,name:m.name,
    mes:m.mes,is_user:!!m.is_user,send_date:m.send_date})));
function sourceRanges(ids) {
    const ranges=[];let start=null,end=null;
    for(const id of ids){if(start===null){start=end=id;}else if(id===end+1){end=id;}
        else{ranges.push([start,end]);start=end=id;}}
    if(start!==null)ranges.push([start,end]);return ranges;
}
async function windowEvidence(window,ask) {
    const a=window[0].id,b=window.at(-1).id;
    const prompt=[
        'Extract grounded roleplay evidence from ONE window; events can span earlier or later windows.',
        'Preserve exact actors, causal turns, quotes, habits, knowledge access, rumors vs observations,',
        'unresolved promises and what was actually completed. Never invent closure at window boundary.',
        'Output JSON {"window":[start,end],"events":[{"topic":"...","sourceRanges":[[a,b]],',
        '"cause":"...","development":"...","result":"... or unresolved",',
        '"closure":"complete|open|uncertain","quotes":["..."]}],"otherFacts":["..."]}.',
        'Window '+a+'-'+b,compact(window)
    ].join('\n\n');
    return await ask(prompt,'Window evidence '+a+'-'+b);
}
async function evidenceFor(messages,ask) {
    const windows=groupSlothSourceWindows(messages,18000);
    if(windows.length===1)return compact(messages);
    const evidence=[];
    for(const window of windows)evidence.push(await windowEvidence(window,ask));
    return JSON.stringify(evidence);
}
export async function analyzeSlothEvents({messages,profile,settings,characterContext='',signal=null}) {
    const ask=requester(profile,settings,signal),source=await evidenceFor(messages,ask);
    const ids=messages.map(m=>m.id);
    const prompt=[
        'Roleplay Memory Books event planner. STRICT JSON only.',
        'One causal incident = one complete Scene even across discontiguous source messages.',
        'Do not split at arbitrary date, token boundary, place or window. Independent incidents stay separate.',
        'Never mark a future, uncertain, or ongoing outcome as completed.',
        'Every visible original message must belong to exactly one Scene or a deferred range.',
        'Do not drop ordinary dialog: place it with its event or explicitly defer it.',
        'Return JSON {"events":[{"title":"...","complete":true,"reason":"cause and verified closure",',
        '"result":"actual completed result","segments":[[start,end],...]}],',
        '"deferred":[{"reason":"unfinished or context only","segments":[[start,end],...]}]}.',
        'No quota for event count. All indices must be original message IDs and inclusive.',
        'Exact source index spans: '+JSON.stringify(sourceRanges(ids)),
        'Character context (do not treat as source event): '+characterContext,
        'Original source or detailed window evidence:',source
    ].join('\n\n');
    return validateNexusEventPlan(await ask(prompt,'Event plan'),ids);
}
export async function composeSlothScene({event,messages,profile,settings,signal=null,characterContext=''}) {
    const ask=requester(profile,settings,signal);
    const idSet=new Set(event.messageIds),source=messages.filter(m=>idSet.has(m.id));
    const evidence=await evidenceFor(source,ask);
    const prompt=[
        'Write ONE independently recallable, completed causal memory with no invented facts.',
        'Preserve actor-specific voice, humor, exact unique dialogue, relationship strength, secrecy,',
        'knowledge boundaries, uncertainty and chronological cause -> action -> result.',
        'STRICT JSON {"title":"...","content":"**Timeline**\\n...\\n\\n**Scene**\\n...\\n\\n**Result**\\n...","keywords":["..."]}.',
        'Timeline gives source-backed time anchors; Scene is flowing paragraphs with causes, choices and conclusion;',
        'Result gives one grounded completed outcome sentence, not a plan.',
        'Keep evidence of important in-between events and source certainty.',
        'Approved title: '+event.title,
        'Closure: '+event.result,'Source spans: '+JSON.stringify(event.segments),
        'Character context: '+characterContext,'Evidence:',evidence
    ].join('\n\n');
    const response=await ask(prompt,'Scene '+event.id);
    if(typeof response.content!=='string'||!Array.isArray(response.keywords))
        throw new Error('Scene '+event.id+' returned invalid content or keywords.');
    return {...event,title:event.title,content:response.content,keywords:response.keywords};
}
export async function proposeSlothNexusEdits({scenes,nexus,profile,settings,signal=null}) {
    const ask=requester(profile,settings,signal);
    const entries=Object.values(nexus.entries||{}).map(e=>{
        const protectedEntry=!!e.disable || Number(e.position)===7 ||
            !!String(e.outletName||'').trim() ||
            /^(Kinks|PanelAssets)(?:\b|$)/i.test(String(e.comment||'')) ||
            !!e.STMB_sidePromptHistory;
        return {uid:e.uid,title:e.comment,body:protectedEntry?'[protected; not included]':e.content,
            protected:protectedEntry,constant:e.constant,disabled:e.disable,
            position:e.position,outletName:e.outletName};
    });
    const source=JSON.stringify(entries);
    if(source.length>60000)throw new Error('Nexus baseline too large for safe exact-span editing. Nothing saved.');
    const prompt=[
        'Propose minimal EXACT SPAN updates to an existing SillyTavern Nexus World Info.',
        'STRICT JSON {"edits":[...]} only. Empty edits is allowed. Preserve every untouched fact.',
        'Supported edits: {"kind":"core|continuity|lt|npc|npc-index","action":"replace_exact",',
        '"uid":NUMBER,"find":"exact existing substring","text":"minimal replacement"};',
        '{"kind":"core|lt|npc|npc-index","action":"append","uid":NUMBER,"text":"one grounded addition"};',
        '{"kind":"continuity","action":"append_section","uid":NUMBER,',
        '"section":"Present Handoff|Active Threads|Knowledge Boundaries|Active Conditions",',
        '"text":"a grounded addition to that section only"};',
        '{"kind":"...","action":"create","title":"unique title","content":"content","keywords":["..."]}.',
        'Core Memory and Current Continuity are separate always-on entries.',
        'For existing ones patch only verified changes; keep unrelated paragraphs and sections.',
        'Current Continuity sections: Present Handoff, Active Threads, Knowledge Boundaries, Active Conditions.',
        'For Current Continuity, use append_section for additions, NOT generic append.',
        'Only replace_exact wholly within ONE Current Continuity section; do not change headings.',
        'Never edit original === BEGIN ORIGINAL / END ORIGINAL === legacy source blocks.',
        'If the old Continuity has only legacy source blocks, add a grounded named section',
        'instead of rewriting or interpreting the original archive without an explicit review.',
        'LT and NPC existing matching topics should be patched; create only when truly new and durable.',
        'Do not modify Kinks, PanelAssets, special Outlets, historical Side Prompt templates, disabled items.',
        'Do not invent facts, remove unresolved matters by mere absence, or confuse reports with observations.',
        'Legacy Long-Term Memory / Status / Scene Continuity conversion is out of scope: preserve them.',
        'Newly composed completed Scenes:',JSON.stringify(scenes.map(s=>({
            title:s.title,result:s.result,content:s.content,segments:s.segments}))),
        'Current Nexus entries (exact UIDs):',source
    ].join('\n\n');
    const response=await ask(prompt,'Nexus delta');
    if(!Array.isArray(response.edits))throw new Error('Nexus delta must contain edits list.');
    return response.edits;
}

/**
 * Optional additional AI call: flags omissions without silently rewriting drafts.
 * Source must fit in a single review context or this phase fails closed.
 */
export async function auditSlothDraft({messages,scenes,edits,profile,settings,signal=null}) {
    const ask=requester(profile,settings,signal);
    const source=compact(messages);
    const draft=JSON.stringify({scenes:scenes.map(x=>({
        title:x.title,segments:x.segments,content:x.content})),edits});
    if(source.length+draft.length>68000) {
        throw new Error('Optional omission audit requires a smaller source range; nothing saved.');
    }
    const prompt=[
        'Independent evidence audit for roleplay Memory Books. DO NOT rewrite the approved draft.',
        'Check whether EVERY meaningful fact in source messages is represented in a complete Scene',
        'or intentionally deferred. Check causes, consequences, quotes, who knew what, uncertainty,',
        'and whether proposed Nexus edits contradict pre-existing roleplay states.',
        'Return STRICT JSON {"passed":true|false,"issues":[{"messageIds":[1,2],',
        '"kind":"omission|misattribution|false_closure|Nexus_conflict","detail":"..."}]}.',
        'Report only material source-backed problems; no speculative issues.',
        'Original messages:',source,'Approved drafts:',draft
    ].join('\n\n');
    const review=await ask(prompt,'Optional omission audit');
    if(typeof review.passed!=='boolean'||!Array.isArray(review.issues)){
        throw new Error('Omission audit returned an invalid verdict. No changes saved.');
    }
    if(!review.passed||review.issues.length){
        const report=review.issues.slice(0,5).map(x=>String(x?.kind||'issue')+
            ': '+String(x?.detail||'').slice(0,240)).join('; ');
        throw new Error('Omission audit found issues; nothing saved. '+report);
    }
    return review;
}
