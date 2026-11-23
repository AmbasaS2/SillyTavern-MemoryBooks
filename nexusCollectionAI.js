// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
// Sloth collector LLM calls; no data writes.
import { requestCompletion } from './stmemory.js';
import { getCurrentApiInfo, getUIModelSettings, normalizeCompletionSource,
    resolveEffectiveConnectionFromProfile } from './utils.js';
import { oai_settings } from '../../../openai.js';
import { getMaxContextSize } from '../../../../script.js';
import { getTokenCountAsync } from '../../../tokenizers.js';
import { groupSlothSourceWindows, slothSourceRanges, validateNexusEventPlan } from './nexusCollectionPolicy.js';
import { validateGroundedNexusEdits, validateSlothEventWindowEvidence, validateSlothNexusWindowEvidence } from './nexusEditEvidence.js';
import { buildNexusSceneMergeCatalog, validateNexusSceneMergeCandidates } from './nexusSceneMergeProposals.js';
import { validateSlothLegacyContinuityProposal } from './nexusLegacySemantic.js';
import { classifyNexusLegacyTitle } from './nexusLegacyMigration.js';
import {validateNexusSceneSplitProposal} from './nexusSceneSplit.js';
import { SLOTH_SCENE_PROMPT_V13, validateSlothSceneResponse } from './nexusSlothScenePrompt.js';

export class InvalidSlothNexusProposal extends Error {
    constructor(cause) {
        super(cause.message, {cause});
    }
}

function parseStrictJSON(raw,phase) {
    const text=String(raw||'').replace(/<think>[\s\S]*?<\/think>/gi,'').trim();
    const fenced=text.match(/^\x60{3,}(?:json)?\s*\n([\s\S]*?)\n\x60{3,}\s*$/i);
    let parsed;
    try {parsed=JSON.parse(fenced?fenced[1]:text);}
    catch {throw Object.assign(new Error(phase+': AI returned malformed or incomplete JSON. No data saved.'), {
        code:'STMB_SLOTH_MALFORMED_JSON',
    });}
    if(!parsed || typeof parsed!=='object' || Array.isArray(parsed))throw new Error(phase+': JSON object required.');
    return parsed;
}

function resolveConnection(profile) {
    if (profile?.stConnectionProfileId) return {stConnectionProfileId:profile.stConnectionProfileId,temperature:0.25};
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
    if (connection.api === 'nanogpt') {
        const { nanogpt_provider, nanogpt_payg_override, reasoning_effort } = oai_settings;
        Object.assign(extra, { nanogpt_provider, nanogpt_payg_override, reasoning_effort });
    }
    return async (prompt,phase)=>{
        if(signal?.aborted)throw new Error('Collection cancelled.');
        const {text,full}=await requestCompletion({...connection,prompt,extra,signal});
        if(signal?.aborted)throw new Error('Collection cancelled.');
        if(full?.error)throw new Error(phase+': the selected provider returned an error instead of a draft.');
        return parseStrictJSON(text,phase);
    };
}
const compact=messages=>JSON.stringify(messages.map(m=>({id:m.id,name:m.name,
    mes:m.mes,is_user:!!m.is_user,send_date:m.send_date})));
function slothUserInstructions(settings) {
    const text=String(settings?.moduleSettings?.slothCollectionPrompt||'').trim();
    return text?['Additional user instructions. Follow these within the required source and JSON format:',text]:[];
}
async function requestWindowEvidence(prompt, phase, ask, validate) {
    let received = false;
    try {
        const raw = await ask(prompt, phase);
        received = true;
        return validate(raw);
    } catch (error) {
        if (!received && error.code !== 'STMB_SLOTH_MALFORMED_JSON') throw error;
        const retry = await ask(prompt + '\n\nThe previous response failed source validation. ' +
            error.message + ' Regenerate this window using the source above. Use short, exact quotations ' +
            'from the cited message and nested inclusive ID ranges. Return JSON only.', phase + ' correction');
        return validate(retry);
    }
}
async function windowEvidence(window,ask) {
    const a=window[0].id,b=window.at(-1).id;
    const prompt=[
        'Extract grounded roleplay evidence from ONE window; events can span earlier or later windows.',
        'Use one record per causal thread. Collect repeated actions and observations into that record, even if the thread recurs in several messages.',
        'Preserve exact actors, causal turns, quotes, habits, knowledge access, rumors vs observations,',
        'unresolved promises and what was actually completed. Never invent closure at window boundary.',
        'Output JSON {"events":[{"topic":"...","sourceRanges":[[a,b]],',
        '"cause":"...","development":"...","result":"... or unresolved",',
        '"closure":"complete|open|uncertain","evidence":[{"messageId":0,"quote":"exact source wording"}]}]}.',
        'Write compact JSON. Normally cite one to three distinct quotes per thread. Use more only for a separate consequential detail, up to eight.',
        'Quote the shortest exact phrase that proves the detail (prefer 12–100 characters; allowed 8–400). Copy a continuous substring without adding punctuation or ellipses. Include the words that carry the joke, promise or correction.',
        'Use inclusive source ranges that cover the beginning, development and ending in this window. Every evidence.messageId must be inside its own event’s sourceRanges. Check the bounds against the evidence IDs before responding.',
        'Only cite IDs present in this window. Use separate ranges when IDs skip a message.',
        'Window '+a+'-'+b,compact(window)
    ].join('\n\n');
    const events=await requestWindowEvidence(prompt,'Window evidence '+a+'-'+b,ask,
        raw=>validateSlothEventWindowEvidence(raw,window));
    return {window:[a,b],events};
}
async function canUseOriginalSource(prompt, settings, profile) {
    const contextSize = getMaxContextSize();
    if (!Number.isFinite(contextSize) || contextSize <= 0) return false;
    const selected = resolveConnection(profile);
    const active = getCurrentApiInfo();
    const activeApi = normalizeCompletionSource(active.completionSource || active.api || 'openai');
    const activeModel = activeApi === 'nanogpt' ? oai_settings.nanogpt_model : getUIModelSettings().model;
    if (!activeModel || selected.api !== activeApi || selected.model !== activeModel) return false;
    const completion = Number(settings?.moduleSettings?.maxTokens) || Number(oai_settings?.openai_max_tokens) || 0;
    try {
        const input = await getTokenCountAsync(prompt);
        return Number.isFinite(input) && input > 0 && input + completion + 2048 < Math.floor(contextSize * 0.9);
    } catch {
        return false;
    }
}
async function evidenceFor(messages,ask,prefix,settings,profile) {
    const original=compact(messages);
    if (original.length <= 18000 || await canUseOriginalSource(prefix + original, settings, profile)) return original;
    const windows=groupSlothSourceWindows(messages,18000);
    if(windows.length===1)return original;
    const evidence=[];
    for(const window of windows)evidence.push(await windowEvidence(window,ask));
    const payload=JSON.stringify(evidence);
    if(payload.length>85000) throw new Error('Event evidence is too large for a safe review. Nothing saved.');
    return payload;
}
export async function analyzeSlothEvents({messages,profile,settings,characterContext='',signal=null}) {
    const ask=requester(profile,settings,signal);
    const ids=messages.map(m=>m.id);
    const prompt=[
        'Roleplay Memory Books event planner. STRICT JSON only.',
        'One causal incident = one complete Scene even across discontiguous source messages.',
        'Do not split at arbitrary date, token boundary, place or window. Independent incidents stay separate.',
        'Window records are partial evidence, not candidate Scenes to copy. If an early problem and a later action resolve the same goal, join the setup, attempts and resolution into one event. Trust an exact quote over a conflicting paraphrase in a window record.',
        'Never mark a future, uncertain, or ongoing outcome as completed.',
        'Put open or uncertain material in deferred only. Every item in events has complete: true and a distinct, observed ending.',
        'Every visible original message must appear exactly once across events and deferred. Assign ordinary dialogue and IDs absent from the condensed evidence to a related event when supported, or defer them as context. Check for gaps and duplicate IDs.',
        'Return JSON with two arrays: events and deferred. Each event needs title, complete, reason, result, segments. Each deferred item needs reason and segments.',
        'Example only: {"events":[{"title":"Recovered key","complete":true,"reason":"The search ended when the owner got the lost key back.","result":"The owner recovered the key.","segments":[[0,6]]}],"deferred":[{"reason":"A separate search was discussed but has not started.","segments":[[7,8]]}]}',
        'No quota for event count. All indices must be original message IDs and inclusive.',
        ...slothUserInstructions(settings),
        'Exact source index spans: '+JSON.stringify(slothSourceRanges(ids)),
        'Character context (do not treat as source event): '+characterContext,
        'Original source or detailed window evidence:',
    ].join('\n\n')+'\n\n';
    const source=await evidenceFor(messages,ask,prompt,settings,profile);
    return validateNexusEventPlan(await ask(prompt+source,'Event plan'),ids,{deferUnclassified:true});
}
export async function composeSlothScene({event,messages,profile,settings,signal=null,characterContext=''}) {
    const ask=requester(profile,settings,signal);
    const idSet=new Set(event.messageIds),source=messages.filter(m=>idSet.has(m.id));
    const prompt=[
        SLOTH_SCENE_PROMPT_V13,
        ...slothUserInstructions(settings),
        'Fork workflow: the user-approved source spans form ONE independently recallable causal event, even when noncontiguous. Do not use intervening messages outside the approved spans.',
        'Keep person-specific voice, humor and distinctive phrasing along with all of the original preservation rules.',
        'The approved title and closure guide the output; evidence controls factual details. The character card is reference only, never evidence of an event.',
        'Approved title: '+event.title,
        'Closure: '+event.result,'Source spans: '+JSON.stringify(event.segments),
        'Character context: '+characterContext,'Evidence:',
    ].join('\n\n')+'\n\n';
    const evidence=await evidenceFor(source,ask,prompt,settings,profile);
    const response=await ask(prompt+evidence,'Scene '+event.id);
    return {...event,...validateSlothSceneResponse(response),title:event.title};
}

/**
 * For a long chat, use separate evidence-only windows rather than silently
 * dropping old or deferred messages from the current-state reconciliation.
 * Exact quotes remain verifiable against each original window on return.
 */
async function nexusStateEvidenceFor(messages, ask) {
    const windows=groupSlothSourceWindows(messages,18000);
    if(windows.length===1) return compact(messages);
    const evidence=[];
    for(const window of windows) {
        const a=window[0].id,b=window.at(-1).id;
        const prompt=[
            'Extract ONLY durable character/world changes and currently live or completed conditions.',
            'Use direct text evidence, not narrative extrapolation. Include explicitly resolved',
            'injuries, promises, secrecy, knowledge changes, relationship changes, NPC details,',
            'and still-active threads. Silence and a date passing are NOT proof of resolution.',
            'Return STRICT JSON {"evidence":[{"messageId":NUMBER,"quote":"exact substring of',
            'the original message, 8-400 chars","meaning":"grounded observation or report"}]}.',
            'Each quote MUST occur VERBATIM in the message with that exact ID.',
            'Quote only the shortest useful continuous substring (ideally 12–100 characters) with its original punctuation. Cite each observation once.',
            'Maximum 40 items. If none are material, return {"evidence":[]}.',
            'Do not infer a merged event ending from a window boundary.',
            'Original messages in window '+a+'-'+b+':',compact(window),
        ].join('\n\n');
        const citations=await requestWindowEvidence(prompt,'Nexus state evidence '+a+'-'+b,ask,
            raw=>validateSlothNexusWindowEvidence(raw,window));
        evidence.push({window:[a,b],evidence:citations});
    }
    const payload=JSON.stringify(evidence);
    if(payload.length>85000) {
        throw new Error('Grounded Nexus evidence is too large for a safe single update. Nothing saved.');
    }
    return payload;
}

export async function proposeSlothNexusEdits({scenes,nexus,messages,plan,profile,settings,signal=null,
    initial=false,characterContext=''}) {
    const ask=requester(profile,settings,signal);
    const entries=Object.values(nexus.entries||{}).map(e=>{
        const protectedEntry=!!e.disable || Number(e.position)===7 ||
            !!String(e.outletName||'').trim() ||
            /^(Kinks|PanelAssets)(?:\b|$)/i.test(String(e.comment||'')) ||
            !!classifyNexusLegacyTitle(e.comment) ||
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
        'Every edit must include a specific factual reason in "reason" and an "evidence" array. Each evidence item contains the original integer "messageId" and an exact 8–400 character substring in "quote".',
        'Cite current original message IDs, NOT generated Scene titles or fabricated references.',
        'A quote proves that text was said, not that an interpretation is correct.',
        'A continuity replace_exact also requires "supersession" with exactly ONE of these values:',
        '"observed_resolution", "observed_correction", "explicit_retraction", "new_confirmed_information". Never combine the values.',
        'Never remove an old state just because a date passed or no one mentioned it.',
        'For a reported state, clearly attribute who reported it; do not present it as observed fact.',
        'Skip a fact already recorded correctly, even if the chat reconfirms it. Each changed clause must be supported by its own citation.',
        'For each edit choose one kind: core, continuity, lt, npc, npc-index.',
        'Choose exactly one action and include its fields along with reason and evidence:',
        '- replace_exact: uid (integer), find (the exact existing substring), text (minimal replacement). For continuity include supersession.',
        '- append: uid and text (one grounded addition). For core, lt, npc and npc-index.',
        '- append_section: uid, section (one named Current Continuity section), text (one grounded addition). For continuity.',
        '- create: unique title, content, and optional keywords array.',
        'Core Memory and Current Continuity are separate always-on entries.',
        'Core Memory stores durable operative rules, habits, wounds, boundaries, promises, secrets, lasting changes and concrete Recall Cues.',
        'Do not promote one continuous incident to a recurring habit. Preserve conditions, beneficiaries and chooser-owned exceptions individually.',
        'A promise to change behavior does not prove the habit changed. An unaffected or still uncertain mechanism keeps its wording.',
        'For a recall cue keep its perceivable trigger, grounded meaning and distinctly supported future function.',
        'For existing ones patch only verified changes; keep unrelated paragraphs and sections.',
        'Current Continuity sections: Present Handoff, Active Threads, Knowledge Boundaries, Active Conditions.',
        'Present Handoff preserves the actual next-response position, contact or release, hidden reactions, final utterance and remaining choice.',
        'Active Threads need a responsible actor, unfinished condition and concrete completion check. A question alone belongs in Handoff.',
        'Keep direct observation, named relay, suspicion, false belief, inability to know and deliberate concealment distinct for each person.',
        'Example only: if the book says "Only the scout knows the trail." and message #5 says "I showed the trail to the guide.", a valid edit is:',
        '{"kind":"continuity","action":"replace_exact","uid":2,"find":"Only the scout knows the trail.","text":"The scout and the guide know the trail.","supersession":"new_confirmed_information","reason":"The scout explicitly told the guide about the trail.","evidence":[{"messageId":5,"quote":"I showed the trail to the guide."}]}',
        'The disclosure by itself says nothing about unrelated habits or conditions. Never use the example’s data in a real edit.',
        'Keep accountability, explicit acceptance and forgiveness distinct. Track offers, supply, application, recovery and discharge independently.',
        'For Current Continuity, use append_section for additions, NOT generic append.',
        'Only replace_exact wholly within ONE Current Continuity section; do not change headings.',
        'To retire a fully ended or disproven Current Continuity line, use replace_exact with its one whole exact line and text="" only with observed resolution, correction or explicit retraction. Quote the evidence that ends that state.',
        'Never edit original === BEGIN ORIGINAL / END ORIGINAL === legacy source blocks.',
        'If the old Continuity has only legacy source blocks, add a grounded named section',
        'instead of rewriting or interpreting the original archive without an explicit review.',
        'LT and NPC existing matching topics should be patched; create only when truly new and durable.',
        ...(settings?.moduleSettings?.nexusDetailRecallMode==='keyword'?
            ['Supply specific literal recall keywords for every new LT or NPC detail. Never overwrite existing entry activation settings.']:[]),
        'For an existing NPC Index use the latest consequential role-relevant change, not the latest mention. Keep continuing role, tie, personality cue, current anchor and attributed knowledge separate.',
        'Do not add a one-scene NPC without a continuing tie, repeated function or explicit unfinished duty. A temporary duty can close without erasing an independent enduring role.',
        ...(initial?[
            'This is a first collection from an empty Nexus. Propose only create edits; use distinct Core Memory and Current Continuity entries when evidence supports each.',
            'Do not create an NPC Index as a default. Do not seed entries with placeholders or infer events or personal states from the character card.',
            'The following character card is reference for disambiguation only. Every new memory still needs an exact source quote from the chat:',
            characterContext,
        ]:[]),
        'Do not modify Kinks, PanelAssets, special Outlets, historical Side Prompt templates, disabled items.',
        'Do not invent facts, remove unresolved matters by mere absence, or confuse reports with observations.',
        ...slothUserInstructions(settings),
        'Legacy Long-Term Memory / Status / Scene Continuity conversion is out of scope: preserve them.',
        'Newly composed completed Scenes:',JSON.stringify(scenes.map(s=>({
            title:s.title,result:s.result,content:s.content,segments:s.segments}))),
        'Approved event classifications:',JSON.stringify({
            events:(plan?.events||[]).map(x=>({title:x.title,segments:x.segments})),
            deferred:(plan?.deferred||[]).map(x=>({reason:x.reason,segments:x.segments})),
        }),
        'Deferred source is still visible; use it to assess ongoing state without',
        'claiming a deferred or uncertain incident is complete.',
        'Current Nexus entries (exact UIDs):',source,
        'Current-chat original grounded evidence (exact message IDs):',
    ].join('\n\n')+'\n\n';
    const original = compact(messages);
    const groundedSource = original.length <= 18000 || await canUseOriginalSource(prompt + original, settings, profile)
        ? original : await nexusStateEvidenceFor(messages,ask);
    let response;
    try {
        response=await ask(prompt + groundedSource,'Nexus delta');
    } catch (error) {
        if (error.code==='STMB_SLOTH_MALFORMED_JSON') throw new InvalidSlothNexusProposal(error);
        throw error;
    }
    try {
        if(!Array.isArray(response.edits))throw new Error('Nexus delta must contain edits list.');
        const edits=validateGroundedNexusEdits(response.edits,messages);
        if(initial&&edits.some(edit=>edit.action!=='create'||edit.kind==='npc-index')) {
            throw new Error('First collection cannot replace prior entries or create a default NPC Index.');
        }
        return edits;
    } catch (error) {
        throw new InvalidSlothNexusProposal(error);
    }
}

/**
 * Optional additional AI call: flags omissions without silently rewriting drafts.
 * Source must fit in a single review context or this phase fails closed.
 */
export async function auditSlothDraft({messages,scenes,edits,plan,profile,settings,signal=null}) {
    const ask=requester(profile,settings,signal);
    const source=compact(messages);
    const draft=JSON.stringify({scenes:scenes.map(x=>({
        title:x.title,segments:x.segments,content:x.content})),edits,
        deferred:plan?.deferred?.map(({reason,segments})=>({reason,segments})) || []});
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


/**
 * Optional, explicitly invoked repair of ALREADY SAVED completed Scenes.
 * No model output can save data or authorize a causal merge on its own.
 */
export async function suggestSlothSceneMerges({memory,chatIds,profile,settings,signal=null}) {
    const catalog=buildNexusSceneMergeCatalog(memory,chatIds);
    if(catalog.length<2)return [];
    const ask=requester(profile,settings,signal);
    const prompt=[
        'Inspect ALREADY SAVED SillyTavern Scene memories. This is a read-only causal merge suggestion.',
        'Find at most four PAIRS where the same causal incident was split: its original cause',
        'is in one completed Scene and its actual resolution in another. Source messages can be',
        'discontiguous; unrelated Scenes in between must remain separate and unchanged.',
        'Require specific evidence in BOTH saved Scene bodies. Shared characters, location, dates,',
        'similar emotions or vague themes alone are not evidence of one causal incident.',
        'Do not invent missing original messages or assert that uncertain outcomes were completed.',
        'If evidence is insufficient or sources are independent, return an empty candidates list.',
        'STRICT JSON {"candidates":[{"uids":[EARLIER_UID,LATER_UID],',
        '"reason":"specific shared cause and confirmed resolution",',
        '"evidence":["fact directly supported by first saved Scene","fact directly supported by second saved Scene"]}]}.',
        'Only use exact UID numbers and text in these source records. Do not propose edits or perform saves.',
        'Current chat Scene catalog:',JSON.stringify(catalog),
    ].join('\n\n');
    return validateNexusSceneMergeCandidates(memory,catalog,await ask(prompt,'Existing Scene merge candidates'));
}

export async function composeSlothMergedScene({candidate,profile,settings,signal=null}) {
    if(!candidate?.plan?.sourceEntries || candidate.plan.sourceEntries.length!==2 ||
        !candidate?.reason || !Array.isArray(candidate.evidence)) {
        throw new Error('A verified Scene pair and causal evidence are required before drafting.');
    }
    const originals=candidate.plan.sourceEntries.map(entry=>({
        uid:entry.uid,title:entry.comment,content:entry.content,chatId:entry.STMB_chatId,
        sourceRanges:entry.STMB_sourceRanges || (
            Number.isSafeInteger(entry.STMB_start) && Number.isSafeInteger(entry.STMB_end)
                ? [[entry.STMB_start,entry.STMB_end]] : []),
        keywords:entry.key,
    }));
    if(JSON.stringify(originals).length>60000) {
        throw new Error('Selected Scene texts exceed the safe merge draft context. No data saved.');
    }
    const ask=requester(profile,settings,signal);
    const prompt=[
        'Draft ONE coherent, independently recallable completed causal Scene based ONLY on the',
        'two already-saved Scene texts. Their original full JSON snapshots will be archived separately.',
        'Preserve the actual sequence, characters, voice, specific dialogue, emotional intensity,',
        'secrets, who knew what, misunderstandings and confirmed final state without inventing facts.',
        'The two source ranges may be noncontiguous: do not imply intervening independent events',
        'were part of this incident or manufacture exact time transitions.',
        'If the text is insufficient to establish the proposed merge, return {"possible":false}.',
        'Otherwise return STRICT JSON {"possible":true,"title":"short unnumbered causal event title",',
        '"content":"**Timeline**\\n...\\n\\n**Scene**\\n...\\n\\n**Result**\\n...",' +
        '"keywords":["..."]}. Result must state an observed completed outcome, not a plan.',
        'Verified source ranges:',JSON.stringify(candidate.plan.sourceRanges),
        'Proposed causal reason:',candidate.reason,
        'Evidence citations (saved Scene text, not raw chat):',JSON.stringify(candidate.evidence),
        'Complete original Scene texts:',JSON.stringify(originals),
    ].join('\n\n');
    const result=await ask(prompt,'Combined Scene draft');
    if(result.possible!==true || typeof result.title!=='string' ||
        typeof result.content!=='string' || !Array.isArray(result.keywords) ||
        !result.keywords.every(word=>typeof word==='string')) {
        throw new Error('AI could not establish a safe, completed causal Scene. No data saved.');
    }
    return {title:result.title,content:result.content,keywords:result.keywords};
}


/**
 * Explicit one-time AI review of already-migrated, verbatim legacy state.
 * Only facts also corroborated by original currently visible chat messages
 * can enter the new always-on Current Continuity sections.
 */
export async function proposeSlothLegacyContinuity({
    plan,messages,profile,settings,signal=null,
}) {
    if(!plan?.required || !Array.isArray(plan.sources) ||
        !Array.isArray(messages) || !messages.length) {
        throw new Error('A migrated legacy Continuity and visible source chat are required.');
    }
    const ask=requester(profile,settings,signal);
    const chatEvidence=await nexusStateEvidenceFor(messages,ask);
    const raw=await ask([
        'Classify an OLD migrated Current Continuity archive into CURRENT live state,',
        'and explicitly label obsolete/uncertain historical fragments.',
        'The original source entries will remain as DISABLED full-history archives.',
        'Only currently verified facts should remain in the always-on Current Continuity.',
        'An old document claiming that something once was true is NOT evidence it',
        'remains true. A later date or silence is NEVER proof of recovery/resolution.',
        'Use specific, quoted evidence from BOTH the older source AND the current',
        'visible chat to classify a fact as CURRENT. If no current corroboration is',
        'available, put it in notCurrent with status "unverified" or "historical".',
        'Never turn a reported belief into an observation or reveal private knowledge.',
        'Preserve original names, tone, emotional intensity, exact meaningful details.',
        'If a promise was actually fulfilled or an injury healed, quote the confirmed',
        'event; otherwise do not invent closure or continuity.',
        'Return ONLY STRICT JSON {"current":[{"section":"Present Handoff|Active Threads|',
        'Knowledge Boundaries|Active Conditions","text":"one concise current fact",',
        '"reason":"why it is still true","archive":{"uid":NUMBER,',
        '"quote":"exact 8-400 character substring of archived content"},',
        '"chat":{"messageId":NUMBER,"quote":"exact 8-400 character substring of',
        'one original current chat message"}}],',
        '"notCurrent":[{"status":"resolved|superseded|historical|unverified",',
        '"reason":"explicit reason for withholding this old fact",',
        '"archive":{"uid":NUMBER,"quote":"exact substring of old content"},',
        '"chat":{"messageId":NUMBER,"quote":"optional exact current chat quote"}}]}.',
        'Every archived UID must occur in at least one classification.',
        'An empty current list means NO REWRITE. Do not fill headings artificially.',
        'Use exact evidence text; paraphrases cannot be represented as quotes.',
        'This operation does not create Scenes, alter Core Memory, or hide messages.',
        'Old source records:',JSON.stringify(plan.sources),
        'Actual source chat/evidence (message IDs):',chatEvidence,
    ].join('\n\n'),'Reviewed legacy Current Continuity reconciliation');
    return validateSlothLegacyContinuityProposal(plan,raw,messages);
}


/**
 * Explicit Scene split proposal. Only original, still-visible source
 * messages may support an independent event and its completed Result.
 * This function NEVER changes a World Info or chat.
 */
export async function suggestSlothSceneSplit({
    plan,messages,profile,settings,signal=null,
}) {
    if(!Number.isSafeInteger(plan?.sourceUid) || plan.sourceUid < 0 || !Array.isArray(plan.sourceIds) ||
        !Array.isArray(messages) || !messages.length) {
        throw new Error('A verified Scene and visible source messages are required.');
    }
    const originalText=compact(messages);
    if(originalText.length>66000 || plan.sourceContent.length>45000) {
        throw new Error('Source chat/Scene is too large for one safe split analysis. No data saved.');
    }
    const ask=requester(profile,settings,signal);
    const answer=await ask([
        'Review ONE already completed Scene that may contain INDEPENDENT causal incidents.',
        'Do not split merely because the characters move, change dates, exchange jokes,',
        'or have several conversations inside ONE continuous incident.',
        'If there are not at least TWO genuinely independent completed incidents,',
        'return exactly {"parts":[]}. Never split ongoing or uncertain incidents.',
        'Otherwise propose TWO TO FOUR separate completed Scene memories.',
        'Every original source message MUST belong to exactly one proposed event;',
        'no skipped, invented or overlapping message numbers, including casual dialogue.',
        'Separate causal arcs even if their source spans are noncontiguous.',
        'Preserve chronological facts, character voice, unique humor, precise dialogue,',
        'knowledge limits, secrets, relationships and completion outcomes.',
        'Return STRICT JSON {"parts":[{"title":"short unnumbered event title",',
        '"complete":true,"reason":"why this incident is independently complete",',
        '"result":"one observed completed outcome","segments":[[first,last],...],',
        '"evidence":[{"messageId":NUMBER,"quote":"exact 8-400 char quote from',
        'one original message of THIS incident"}]}]}.',
        'Each incident needs a concrete direct quote; not a paraphrase or an invented ending.',
        'All ranges must use only these exact source message IDs: '+JSON.stringify(plan.sourceIds),
        'Existing Scene title:',plan.sourceTitle,
        'Full previous Scene body (context, not independent proof):',plan.sourceContent,
        'Verifiable original chat messages:',originalText,
    ].join('\n\n'),'Scene causal split plan');
    if(!Array.isArray(answer.parts))throw new Error('Split plan response has no parts array.');
    if(!answer.parts.length)return null;
    return validateNexusSceneSplitProposal(plan,answer,messages);
}
