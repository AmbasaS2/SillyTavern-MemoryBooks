// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
// Sloth collector LLM calls; no data writes.
import { requestCompletion } from './stmemory.js';
import { getCurrentApiInfo, getUIModelSettings, normalizeCompletionSource,
    resolveEffectiveConnectionFromProfile } from './utils.js';
import { oai_settings } from '../../../openai.js';
import { getMaxContextSize } from '../../../../script.js';
import { getTokenCountAsync } from '../../../tokenizers.js';
import { getContext } from '../../../extensions.js';
import { getSelectedConnectionProfile } from './connectionProfileRequest.js';
import { normalizeSlothCollectionDraft, recoverSlothCollectionDraft } from './nexusCollectionDraft.js';
import { parseSingleSlothCollectionDraft, normalizeSingleSlothPlan, finalizeSingleSlothScenes,
    joinSlothRecoveryScenes, buildSlothPendingDraft, slothEditSignature } from './slothSingleRecovery.js';
import { groupSlothSourceWindows, slothSourceRanges, validateNexusEventPlan, includeDeepSeekTailEvent, fitDeepSeekSceneBatch, stageNexusEdits,
    describeNexusCollectionEntry } from './nexusCollectionPolicy.js';
import { validateSlothEventWindowEvidence, validateSlothNexusWindowEvidence } from './nexusEditEvidence.js';
import { buildNexusSceneMergeCatalog, validateNexusSceneMergeCandidates } from './nexusSceneMergeProposals.js';
import { validateSlothLegacyContinuityProposal } from './nexusLegacySemantic.js';
import {validateNexusSceneSplitProposal} from './nexusSceneSplit.js';
import { SLOTH_SCENE_OUTPUT_CONTRACT, validateSlothSceneResponse } from './nexusSlothScenePrompt.js';
import { getActiveSlothSummaryPreset } from './slothSummaryPrompts.js';
import { getCompressibleScene, getSlothCompressionInstructions, stageSlothSceneCompression } from './nexusSceneCompression.js';
import { isCompletedSceneEntry, sceneNumberFromTitle } from './nexusSceneRotation.js';

function canonicalizeNewNexusTitles(edits) {
    return edits.map(edit=>{
        if (edit?.action !== 'create' || typeof edit.title !== 'string') return edit;
        const title = edit.kind === 'continuity' && /^Current Continuity\s*[:–—-]/iu.test(edit.title) ? 'Current Continuity' :
            edit.kind === 'core' && /^Core Memory\s*[:–—-]/iu.test(edit.title) ? 'Core Memory' : '';
        return title ? {...edit,title} : edit;
    });
}

function stripRepeatedContinuityHeading(edit) {
    if (edit?.kind !== 'continuity' || edit.action !== 'append_section' ||
        typeof edit.section !== 'string' || typeof edit.text !== 'string') return edit;
    const text=edit.text.trimStart();
    const heading=text.match(/^#{1,6}[ \t]+([^\r\n]+)\r?\n/u);
    return heading?.[1].trim() === edit.section.trim() ? {...edit,text:text.slice(heading[0].length)} : edit;
}

function parseStrictJSON(raw,phase) {
    const text=String(raw||'').replace(/<think>[\s\S]*?<\/think>/gi,'').trim();
    const fenced=text.match(/^\x60{3,}(?:json)?\s*\n([\s\S]*?)\n\x60{3,}\s*$/i);
    let parsed;
    try {parsed=JSON.parse(fenced?fenced[1]:text);}
    catch {throw Object.assign(new Error(phase+': AI returned malformed or incomplete JSON. No data saved.'), {
        code:'STMB_SLOTH_MALFORMED_JSON',
    });}
    if(!parsed || typeof parsed!=='object' || Array.isArray(parsed)) {
        throw Object.assign(new Error(phase+': JSON object required.'), {code:'STMB_SLOTH_MALFORMED_JSON'});
    }
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
function requester(profile,settings,signal,singleAttempt=false,onUsage=()=>{}) {
    const connection=resolveConnection(profile);
    const extra={},max=Number.parseInt(settings?.moduleSettings?.maxTokens,10);
    if(Number.isFinite(max)&&max>0)extra.max_tokens=max;
    else if(oai_settings?.openai_max_tokens)extra.max_tokens=oai_settings.openai_max_tokens;
    if (connection.api === 'nanogpt') {
        const { nanogpt_provider, nanogpt_payg_override, reasoning_effort } = oai_settings;
        Object.assign(extra, { nanogpt_provider, nanogpt_payg_override, reasoning_effort });
    }
    return async (prompt,phase,parse=parseStrictJSON)=>{
        if(signal?.aborted)throw new Error('Collection cancelled.');
        const {text,full}=await requestCompletion({...connection,prompt,extra,signal,singleAttempt});
        if(signal?.aborted)throw new Error('Collection cancelled.');
        if(full?.error)throw new Error(phase+': the selected provider returned an error instead of a draft.',{cause:full.error});
        onUsage(full?.usage,phase);
        return parse(text,phase);
    };
}
const originalMessages=messages=>messages.map(m=>({id:m.id,name:m.name,
    mes:m.mes,is_user:!!m.is_user,send_date:m.send_date}));
const compact=messages=>JSON.stringify(originalMessages(messages));
const SCENE_KEYWORD_GUIDANCE = 'Include up to five distinct, short recall keywords. Prefer specific names, objects, actions or quoted phrases that might recur in dialogue. Avoid full sentences.';
async function requestValidatedDraft(prompt, phase, ask, validate, correction, fallback) {
    let received = false;
    let draft;
    try {
        draft = await ask(prompt, phase);
        received = true;
        return validate(draft);
    } catch (error) {
        if (!received && error.code !== 'STMB_SLOTH_MALFORMED_JSON') throw error;
        let retried = false;
        try {
            const repairPrompt=typeof correction==='function' ? correction(error,draft) : prompt +
                '\n\nThe previous response failed validation: ' + error.message + '\n' + correction + '\nReturn JSON only.';
            const retry = await ask(repairPrompt,phase+' correction');
            retried = true;
            return validate(retry);
        } catch (retryError) {
            if (fallback && (retried || retryError.code === 'STMB_SLOTH_MALFORMED_JSON')) return fallback();
            throw retryError;
        }
    }
}
async function windowEvidence(window,ask) {
    const a=window[0].id,b=window.at(-1).id;
    const prompt=[
        'Extract grounded roleplay evidence from ONE window; events can span earlier or later windows.',
        'Use one record per causal thread. Collect repeated actions and observations into that record, even if the thread recurs in several messages.',
        'Group preparation, travel, arrivals, introductions, repeated actions and later reactions with the larger incident they serve. Retain what happened as details inside that incident; only a durable, independently completed consequence warrants its own thread.',
        'Preserve exact actors, causal turns, quotes, habits, knowledge access, rumors vs observations,',
        'unresolved promises and what was actually completed. Never invent closure at window boundary.',
        'Output JSON {"events":[{"topic":"...","sourceRanges":[[a,b]],',
        '"cause":"...","development":"...","result":"... or unresolved",',
        '"closure":"complete|open|uncertain","evidence":[{"messageId":0,"quote":"exact source wording"}]}]}.',
        'Write compact JSON. Normally cite one to three distinct quotes per thread. Use more only for a separate consequential detail, up to eight.',
        'Quote the shortest exact phrase that proves the detail (prefer 12–100 characters; allowed 8–400). Copy an uninterrupted substring in the original language and typography. For Korean or other non-English sources, translate only the descriptive fields. Include the exact words that carry the joke, promise or correction.',
        'Use inclusive source ranges that cover the beginning, development and ending in this window. Every evidence.messageId must be inside its own event’s sourceRanges. Check the bounds against the evidence IDs before responding.',
        'Only cite IDs present in this window. Use separate ranges when IDs skip a message.',
        'Window '+a+'-'+b,compact(window)
    ].join('\n\n');
    return await requestValidatedDraft(prompt,'Window evidence '+a+'-'+b,ask,
        raw=>({window:[a,b],events:validateSlothEventWindowEvidence(raw,window)}),
        'Rebuild the window records. Verify each quote directly against its cited message. Choose a shorter literal excerpt in the original language and include its ID in the nested inclusive ranges.',
        () => ({window:[a,b],originalMessages:JSON.parse(compact(window))}));
}
async function canUseOriginalSource(prompt, settings, profile, allowNativeProbe = false, nativeCeiling = 48000) {
    const contextSize = getMaxContextSize();
    if (!Number.isFinite(contextSize) || contextSize <= 0) return false;
    const selected = resolveConnection(profile);
    const active = getCurrentApiInfo();
    const activeApi = normalizeCompletionSource(active.completionSource || active.api || 'openai');
    const activeModel = activeApi === 'nanogpt' ? oai_settings.nanogpt_model : getUIModelSettings().model;
    const sameModel = activeModel && selected.api === activeApi && selected.model === activeModel;
    if (!sameModel && !(allowNativeProbe && selected.stConnectionProfileId)) return false;
    const completion = Number(settings?.moduleSettings?.maxTokens) || Number(oai_settings?.openai_max_tokens) || 0;
    try {
        const input = await getTokenCountAsync(prompt);
        const ceiling = Math.floor(contextSize * 0.9);
        return Number.isFinite(input) && input > 0 && input + completion + 2048 < (sameModel ? ceiling : Math.min(nativeCeiling,ceiling));
    } catch {
        return false;
    }
}
function sourceCapacityExceeded(error) {
    for (let part = error, depth = 0; part && depth < 6; part = part.cause, depth++) {
        const detail = typeof part === 'string' ? part : [part.code,part.message,part.providerBody].join(' ');
        if (/context[_ -]length[_ -]exceeded|maximum context length|context window (?:limit|exceeded)|prompt (?:is )?too long|input (?:token count |length )?exceeds[^.]*limit|too many input tokens/iu.test(detail)) return true;
    }
    return false;
}

async function withFullSlothSource(messages, prefix, settings, profile, run, fallback) {
    const original = compact(messages);
    if (original.length <= 18000) return run(original);
    if (await canUseOriginalSource(prefix + original,settings,profile,true)) {
        try { return await run(original); }
        catch(error) { if (!sourceCapacityExceeded(error)) throw error; }
    }
    return run(await fallback());
}

async function evidenceFor(messages,ask,prefix,settings,profile,forceWindows=false) {
    const original=compact(messages);
    if (original.length <= 18000 || (!forceWindows && await canUseOriginalSource(prefix + original, settings, profile))) return original;
    const windows=groupSlothSourceWindows(messages,18000);
    if(windows.length===1)return original;
    const evidence=[];
    for(const window of windows)evidence.push(await windowEvidence(window,ask));
    const payload=JSON.stringify(evidence);
    if(payload.length>85000) throw new Error('Event evidence is too large for a safe review. Nothing saved.');
    return payload;
}
const DEFAULT_SLOTH_COLLECTION_PROMPTS=Object.freeze({
    plan:[
        'Roleplay Memory Books event planner. STRICT JSON only.',
        'Read the whole source before assigning messages. Silently describe each major incident in a single causal sentence: what set it in motion, and what changed by the end? Outline the fewest complete memories that preserve the consequential outcomes. Use whole incidents rather than a timeline of individual beats. One incident can cross locations, activities, or separated source ranges.',
        'Merge candidate memories if one supplies the cause, reaction, escalation, correction, answer, or repair of the other. Ask whether a future reader could understand the significance of each outcome without the other memory. If either explanation starts with "this answered what happened in the previous memory," keep them together. Split only if BOTH sides have a distinct initiating situation and an independently useful, completed outcome. Time, message count, activity, and tokens do not define a cut.',
        'Look forward from each proposed cut. If later dialogue returns to the same incident and supplies its missing explanation, decision, or answer, keep that later beat with the original incident. Moving somewhere quieter or resuming another activity does not finish the unresolved question.',
        'Example: a difficult disclosure, an initial reaction, an accident during the reaction, a clarification, and negotiation of the terms it raised form one incident when they answer the same issue. Resuming an outing or moving indoors can pause the conversation while its cause and answer still belong together. A separate agreement with a host can be its own incident if it changes a different obligation. Use these examples for boundaries only.',
        'A memorable joke, private reaction, apology, or offer belongs inside its parent incident when that incident supplies its significance. Keep the exact actions, distinctive lines, independent terms of an agreement, and who learned what in that incident’s assigned messages. Merging an incident must retain its setup, turning points, and outcome.',
        'Before returning events, inspect the final turns for an open causal incident. Trace any action, question, proposal, or repair attempt awaiting its outcome back to the start of that incident and defer its turns. A new activity, temporary calm, request to talk, or willingness to listen does not resolve the same issue. A direct answer can complete the disclosure without implying that the listener accepted the answer or forgave anyone.',
        'For each complete event, select the original message that shows the decisive outcome. Before writing result, copy a continuous phrase directly from that message into closure.quote, preserving its wording and punctuation. Both narration and dialogue can be evidence. Verify the quote occurs verbatim in the cited message. Then describe only the outcome supported by the quote and its context. A prediction, an unaccepted offer, or an intermediate step inside the same open incident is not closure. If the original driving question still has no outcome, defer the incident from its beginning.',
        'Use whole messages and assign each original ID exactly once. When one message closes an incident and briefly opens another, assign it to the action it primarily carries and do not list it twice. Important lines, humor, commitments, and changes in knowledge belong in their causal incident. Defer uncertain or unassigned context. Use English for the title, reason and result; keep the evidence quote in its original language.',
    ].join('\n\n'),
    nexus:[
        'Propose minimal EXACT SPAN updates to an existing SillyTavern Nexus World Info.',
        'Record confirmed changes with lasting consequences and keep still-active state in Current Continuity. Match a fact to the existing role and subject first, then patch only the part that changed. Create an entry only for durable information that has no suitable active entry. Keep an undertaking distinct from its observed fulfillment.',
        'An empty edits array is allowed. Preserve every untouched fact.',
        'Only when retiring a whole Current Continuity line (empty replacement), give "supersession" with exactly ONE of these values:',
        '"observed_resolution", "observed_correction", "explicit_retraction". Never combine the values.',
        'Never remove an old state just because a date passed or no one mentioned it.',
        'For a reported state, clearly attribute who reported it; do not present it as observed fact.',
        'Skip a fact already recorded correctly, even if the chat reconfirms it. Keep each change consistent with the actual current chat.',
        'Keep one live line per fact. Correct a matching line in place when more precise evidence changes the same condition; use append_section only for a distinct current fact. If a report is corrected in the same exchange, store the corrected live condition with its source. Retain the prior report separately only if a named person still believes it or later actions depend on it.',
        'A newly stated practical constraint can refine an otherwise unchanged line. Keep evidence-backed changes to ongoing treatment, allowed activity, or discharge in that same line when they affect the next turn. Do not append a duplicate condition or recopy the report that was disproven.',
        'For each edit choose one kind: core, continuity, lt, npc, npc-index.',
        'Choose exactly one action and include its fields:',
        '- replace_exact: uid (integer), find (the exact existing substring), text (minimal replacement). For an empty continuity replacement include supersession.',
        '- append: uid and text (one grounded addition). For core, lt, npc and npc-index.',
        '- append_section: uid, section (one named Current Continuity section), text (one grounded addition). For continuity.',
        '- create: unique title, content, and optional keywords array.',
        'Match the existing entry by role or subject before choosing an action. Reuse its UID for the update. An existing entry can hold both core and continuity: update only the relevant part. Only create Core Memory, Current Continuity or NPC Index if that role has no existing active entry.',
        'Core Memory stores durable operative rules, habits, wounds, boundaries, promises, secrets, lasting changes and concrete Recall Cues only when they need to remain available across unrelated scenes. Classify by the need for continuous recall, not emotional importance alone: keep situation-specific durable facts and recall cues in LT, person-specific facts in NPC, live or unfinished states in Current Continuity, and actual past incidents in Scene. Compare proposed facts with existing text across roles; retain a reconfirmed fact in its existing home without appending it again. Update existing matching entries in place; this collection is not a reclassification or deletion of earlier memories.',
        'Do not promote one continuous incident to a recurring habit. Preserve conditions, beneficiaries and chooser-owned exceptions individually.',
        'A promise to change behavior does not prove the habit changed. An unaffected or still uncertain mechanism keeps its wording.',
        'For a recall cue keep its perceivable trigger, grounded meaning and distinctly supported future function.',
        'For existing ones patch only verified changes; keep unrelated paragraphs and sections.',
        'Current Continuity sections: Present Handoff, Active Threads, Knowledge Boundaries, Active Conditions.',
        'When creating Current Continuity, place each supported section on its own Markdown heading line, for example "## Present Handoff". Omit unsupported sections. Each active obligation appears only until it is explicitly resolved, corrected, or retracted.',
        'Present Handoff preserves the actual next-response position, contact or release, hidden reactions, final utterance and remaining choice. Read the last supplied turn and ground the handoff in its actual answer or action, never in the preceding question alone.',
        'Active Threads need a responsible actor, unfinished condition and concrete completion check. A question alone belongs in Handoff.',
        'Keep direct observation, named relay, suspicion, false belief, inability to know and deliberate concealment distinct for each person.',
        'Example only: if the book says "Only the scout knows the trail." and message #5 says "I showed the trail to the guide.", a valid edit is:',
        '{"kind":"continuity","action":"replace_exact","uid":2,"find":"Only the scout knows the trail.","text":"The scout and the guide know the trail."}',
        'The disclosure by itself says nothing about unrelated habits or conditions. Never use the example’s data in a real edit.',
        'Keep accountability, explicit acceptance and forgiveness distinct. Track offers, supply, application, recovery and discharge independently.',
        'For Current Continuity, use append_section for additions, NOT generic append.',
        'In append_section, put the heading name only in section and put only the new body text in text. Do not repeat the heading inside text. Use Markdown section headings in the content of a new Current Continuity entry only.',
        'Only replace_exact wholly within ONE Current Continuity section; do not change headings.',
        'To retire a fully ended or disproven Current Continuity line, use replace_exact with its one whole exact line and text="" only with observed resolution, correction or explicit retraction.',
        'Never edit original === BEGIN ORIGINAL / END ORIGINAL === legacy source blocks.',
        'If the old Continuity has only legacy source blocks, add a grounded named section',
        'instead of rewriting or interpreting the original archive without an explicit review.',
        'Match LT to the most specific existing subject after reading its body. Match NPC to the same explicitly named person, even if title numbers or honorifics differ. Use the surrounding chat context to identify the same person, including unambiguous pronouns or aliases. Never map one named person onto another merely because they share an occupation or courtesy title. If the source merely confirms an existing fact, omit it. A new LT needs a distinct lasting subject with no existing home.',
        'Create a new NPC entry for a durable relationship or a separate future encounter supported by the chat. One visit or expected follow-up during the same visit is insufficient. Record relevant immediate follow-up or knowledge boundaries in continuity.',
    ].join('\n\n'),
});

const DEEPSEEK_FLASH_TAIL_GUIDANCE = [
    'Resolve the final conversation first. Place its single causal incident in a top-level "tail" object, then list only OTHER incidents in events and deferred. Use real inclusive segments in tail. Return null for tail only when no independent final incident can be identified. Do not repeat tail messages in other rows.',
    'For tail, first trace the latest direct question or attempted repair back to the earlier action, behavior, or conflict it addresses. The question itself may be phrased much later. When the final explanation revisits that older trigger, keep the trigger, intermediate reactions, and the reply together as ONE incident, even if the discussion moves or pauses. Exclude any independently completed incident that does not contribute to that conversation.',
    'If the text ends with a request to talk and gives no answer to the issue, output tail with complete:false, reason and segments, covering the whole still-open incident from the original trigger. If someone gives an actual answer, admission, or explanation, output tail with complete:true, title, reason, result, closure and segments. Quote the actual answer from its message and include that message in segments. A later reaction, forgiveness, or decision can still be pending. The disclosure itself ended when the answer was spoken.',
    'For tail, include origin:{"messageId":0,"quote":"exact short phrase from the initiating turn"}. When the final conversation refers back to behavior during an earlier quarrel, choose the first original turn showing that quarrel for origin. The later apology or newly phrased question is not its origin.',
    'Example: someone takes offense at their partner speaking differently around a guest. A request to discuss it leaves the incident open. If they later talk alone, revisit that guest exchange, and the partner explains why they acted that way or how they really feel, end the same incident with that actual explanation. Do not begin a separate incident at the quieter conversation.',
].join('\n\n');

function slothPlanPrompt(messages,characterContext,deepSeekFlash) {
    const ids=messages.map(m=>m.id);
    return [
        DEFAULT_SLOTH_COLLECTION_PROMPTS.plan,
        ...(deepSeekFlash ? [DEEPSEEK_FLASH_TAIL_GUIDANCE] : []),
        'Return JSON with events and deferred arrays. Each event needs title, complete:true, reason (why it is distinct), result (the observed outcome), closure:{"messageId":42,"quote":"the shortest exact phrase showing the ending, or the whole message if very short"}, and segments. Each deferred item needs reason and segments. Segments are nested inclusive ranges. Use [[10,10],[12,12]] for two nonadjacent IDs. Return each original ID exactly once across both arrays.',
        'Ordered original IDs: '+JSON.stringify(ids),
        'Exact source index spans: '+JSON.stringify(slothSourceRanges(ids)),
        'Character context (do not treat as source event): '+characterContext,
        'Original source messages:',compact(messages),
        ...(deepSeekFlash && messages.length ? [
            'Ending check (copies of the final original messages with the same IDs):',
            compact(messages.slice(-3)),
            'Decide what the final answer actually settled before emitting any event. An in-story request to talk, or silently continuing an activity, is still open. A direct reply to the previous question is the outcome even if the other character has not reacted to the reply yet.',
            'Return one JSON object now. Start with tail. Fill origin with the original earlier trigger and an exact quote from it, then assign the whole final incident through the actual answer if there is one. Use complete:false and no closure for an open incident. Copy one continuous phrase from the actual answer without joining separate quotations. Then list only independent remaining incidents in events and put other open material in deferred.',
        ] : []),
    ].join('\n\n');
}

export async function analyzeSlothEvents({messages,profile,settings,characterContext='',signal=null}) {
    const ask=requester(profile,settings,signal,true);
    const deepSeekFlash=isDeepSeekFlashModel(slothCollectionModel(profile));
    const draft=await ask(slothPlanPrompt(messages,characterContext,deepSeekFlash),'Event plan');
    const ids=messages.map(m=>m.id);
    const plan=deepSeekFlash ? includeDeepSeekTailEvent(draft,ids,messages) : draft;
    const validated=validateNexusEventPlan(plan,ids,{deferUnclassified:true,originalMessages:messages});
    return deepSeekFlash ? fitDeepSeekSceneBatch(validated,slothCollectionOutputLimit(settings)) : validated;
}
export async function composeSlothScene({event,messages,profile,settings,signal=null,characterContext=''}) {
    const ask=requester(profile,settings,signal);
    const idSet=new Set(event.messageIds),source=messages.filter(m=>idSet.has(m.id));
    const limit = Number(settings?.moduleSettings?.maxTokens) || Number(oai_settings?.openai_max_tokens) || 4000;
    const maxProse = Math.min(650,Math.max(32,Math.floor(limit*0.75)-80));
    const minProse = Math.floor(maxProse/2);
    const prompt=[
        'Create one retrievable scene memory from the selected roleplay range, using only that range as evidence.',
        SLOTH_SCENE_OUTPUT_CONTRACT,
        getActiveSlothSummaryPreset(settings).text,
        SCENE_KEYWORD_GUIDANCE,
        'Fork workflow: the user-approved source spans form ONE independently recallable causal event, even when noncontiguous. Do not use intervening messages outside the approved spans.',
        'Keep person-specific voice, humor and distinctive phrasing along with all of the original preservation rules.',
        'The approved title and closure guide the output; evidence controls factual details. The character card is reference only, never evidence of an event.',
        `Length budget for this memory: ${minProse}–${maxProse} output tokens for Scene prose (up to about ${Math.floor(maxProse*0.62)} English words); use less for a simple event. Condense repetitions, scenery and long exchanges first. Keep causal changes, distinctive voice, unresolved promises and the final physical state.`,
        'If an evidence window includes originalMessages, use those original turns directly. Keep approved gaps intact.',
        'Approved title: '+event.title,
        'Closure: '+event.result,'Source spans: '+JSON.stringify(event.segments),
        'Character context: '+characterContext,'Evidence:',
    ].join('\n\n')+'\n\n';
    const run = evidence => requestValidatedDraft(prompt+evidence,'Scene '+event.id,ask,
        raw => validateSlothSceneResponse({title:event.title, content:raw.content, keywords:raw.keywords}, event.title),
        error => {
            const format='Return only JSON with title, content and keywords. Inside content use "**Timeline**: …", then a separate line "**Scene**" and its prose, then a separate line "**Result**" and a single plain result line.';
            const revision=error.code==='STMB_SLOTH_SCENE_TOO_LONG'
                ? 'The Scene exceeded 650 words. Rewrite it from the original source in about 400 words. Condense long exchanges and repeated reactions before cutting any causal action, promise, change in knowledge or final physical state. Keep the final meaningful utterance and its actual answer or lack of one.'
                : 'The previous response failed validation: '+error.message+' Rewrite the same supported event in the required format.';
            return [prompt+evidence,revision,format].join('\n\n');
        });
    const draft=await withFullSlothSource(source,prompt,settings,profile,run,
        () => evidenceFor(source,ask,prompt,settings,profile,true));
    return {...event,...draft};
}

const SCENE_LIST_SCHEMA = '{"scenes":[{"id":"given ID","timeline":"YYYY/MM/DD or Unknown","scene":"prose without headings","result":"one sentence","keywords":["cue"]}]}';

function sceneEndingExcerpt(event) {
    return event.closingExchange && event.closure?.quote
        ? event.closure.quote.trim().split(/\s+/u).slice(0,12).join(' ') : '';
}

function slothSceneBatchGuidance(events, settings, characterContext) {
    return [
        getActiveSlothSummaryPreset(settings).text,
        'Return one complete Scene for every approved ID, using each exact ID once. Never add a placeholder. Give its Timeline in YYYY/MM/DD, YYYY/MM/DD–YYYY/MM/DD, or Unknown. Use English.',
        'Fit the complete JSON within the overall response limit. Write concise prose for simple events and give complex outcomes enough space. Condense repeated dialogue and routine movements first; preserve each event’s actual ending.',
        'Use only the assigned messages for that Scene, even when other approved events or deferred messages share this request. Stop at the last assigned action or utterance. Treat thoughts and suspicions as attributed; do not infer forgiveness, an answer or a new physical action.',
        ...(events.some(sceneEndingExcerpt) ? [
            'When an approved event includes closingExcerpt, weave that actual reply into the Scene prose verbatim. Explain how the original conflict led to this reply within the same Scene. The Result field alone is insufficient.',
        ] : []),
        SCENE_KEYWORD_GUIDANCE,
        'Character context: '+characterContext,
        'Approved events: '+JSON.stringify(events.map(event=>{
            const {id,title,result,messageIds,closure}=event;
            const closingExcerpt=sceneEndingExcerpt(event);
            return {id,title,result,messageIds,closure,...(closingExcerpt ? {closingExcerpt} : {})};
        })),
    ].join('\n\n');
}

function readSlothBatchScenes(response, events) {
    const scenes = new Map();
    const rows = Array.isArray(response.scenes) ? response.scenes : [];
    for (const event of events) {
        const matches = rows.filter(row => row?.id === event.id);
        if (matches.length !== 1) continue;
        const {timeline,scene,result,keywords} = matches[0];
        if (![timeline,scene,result].every(value => typeof value === 'string' && value.trim())) continue;
        const content = `**Timeline**: ${timeline.trim()}\n\n**Scene**\n${scene.trim()}\n\n**Result**\n${result.trim()}`;
        try {
            const draft = validateSlothSceneResponse({title:event.title,content,keywords}, event.title,{enforceWordLimit:false});
            scenes.set(event.id,{...event,...draft});
        } catch { /* Save only complete, correctly formatted scene rows. */ }
    }
    return scenes;
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
        evidence.push(await requestValidatedDraft(prompt,'Nexus state evidence '+a+'-'+b,ask,
            raw=>({window:[a,b],evidence:validateSlothNexusWindowEvidence(raw,window)}),
            'Use shorter uninterrupted quotes in their original language. Verify every phrase against the text of its cited message.',
            () => ({window:[a,b],originalMessages:JSON.parse(compact(window))})));
    }
    const payload=JSON.stringify(evidence);
    if(payload.length>85000) {
        throw new Error('Grounded Nexus evidence is too large for a safe single update. Nothing saved.');
    }
    return payload;
}

function slothNexusGuidance({nexus,plan,settings,initial,characterContext,partialSource}) {
    const entries=Object.values(nexus.entries||{}).map(e=>{
        const {roles,legacyLayout,protected:protectedEntry}=describeNexusCollectionEntry(e);
        return {uid:e.uid,title:e.comment,body:protectedEntry?'[protected; not included]':e.content,
            roles,legacyLayout,protected:protectedEntry,constant:e.constant,disabled:e.disable,
            position:e.position,outletName:e.outletName};
    });
    const source=JSON.stringify(entries);
    return [
        DEFAULT_SLOTH_COLLECTION_PROMPTS.nexus,
        ...(settings?.moduleSettings?.nexusDetailRecallMode==='keyword' || Object.values(settings?.moduleSettings?.nexusRecallModes||{}).includes('keyword')?
            ['Supply specific literal recall keywords for each new Nexus entry. Never overwrite existing entry activation settings.']:[]),
        'For an existing NPC Index use the latest consequential role-relevant change, not the latest mention. Keep continuing role, tie, personality cue, current anchor and attributed knowledge separate.',
        'An existing NPC may be updated if its lasting role or knowledge changed. Keep one-off people and near-term business within the Scene or continuity.',
        'Before creating LT or NPC, match the subject with existing titles, aliases, former names, and body context. If the same relationship, topic, or person already has a UID, update that UID even if the new wording or name differs. A different surname spelling or honorific alone is not evidence of a new person.',
        ...(initial?[
            'This is a first collection from an empty Nexus. Propose only create edits; use distinct Core Memory and Current Continuity entries when evidence supports each.',
            'Do not create an NPC Index as a default. Do not seed entries with placeholders or infer events or personal states from the character card.',
            'The following character card is reference for disambiguation only. New memories must reflect the actual chat:',
            characterContext,
        ]:[]),
        'Do not modify Kinks, PanelAssets, special Outlets, historical Side Prompt templates, disabled items.',
        'Do not invent facts, remove unresolved matters by mere absence, or confuse reports with observations.',
        'Reuse any active in-place legacy slot listed with the requested role. Never migrate, rename or disable it. On a combined legacy entry, Core edits stay in the durable preamble. Continuity edits stay in the current sections; use "Active Threads" for [Active threads — still unconfirmed] and "Active Conditions" for [Physical carryover]. Add or edit Present Handoff on the same UID.',
        ...(plan ? ['Approved event classifications:',JSON.stringify({
            events:(plan.events||[]).map(x=>({title:x.title,segments:x.segments})),
            deferred:(plan.deferred||[]).map(x=>({reason:x.reason,segments:x.segments})),
        })] : ['Use your event/deferred classifications to ground the Nexus changes.']),
        'Deferred source is still visible; use it to assess ongoing state without',
        'claiming a deferred or uncertain incident is complete.',
        ...(partialSource ? [
            'Newer chat messages are outside this input. Only propose grounded durable edits. Do not create or modify Current Continuity or Present Handoff from this historical slice.',
        ] : []),
        'Current Nexus entries (exact UIDs):',source,
        'New core and continuity titles are exactly "Core Memory" and "Current Continuity" without any subtitle. Use append_section only for continuity; additional LT or NPC text uses append.',
        'Keep the complete JSON within the output budget. Patch existing entries with minimal spans. Keep the handoff and durable changes; omit redundant recaps and routine dialogue.',
    ].join('\n\n');
}

function readSlothNexusEdits(response, {messages,nexus,settings,initial,partialSource,committedEdits=[]}) {
    const edits = [], acceptedRawEdits=[], pendingEdits=[];
    if (!Array.isArray(response.edits) || response.edits.length > 80) {
        return { edits, acceptedRawEdits, pendingEdits:response.edits??[],
            skippedNexusEdits: Array.isArray(response.edits) ? response.edits.length : 1 };
    }
    const candidates = canonicalizeNewNexusTitles(response.edits).map(stripRepeatedContinuityHeading);
    const already=new Set(committedEdits.map(slothEditSignature));
    const detailRecallMode = settings?.moduleSettings?.nexusDetailRecallMode === 'keyword' ? 'keyword' : 'vector';
    const createPreviewEntry = book => {
        const used = new Set(Object.values(book.entries).map(entry => Number(entry.uid)));
        let uid = 0;
        while (used.has(uid) || Object.hasOwn(book.entries, uid)) uid++;
        return (book.entries[uid] = { uid });
    };
    let staged = nexus;
    for (const [index, candidate] of candidates.entries()) {
        if(committedEdits.length&&already.has(slothEditSignature(candidate))) continue;
        try {
            // Structural staging, not mandatory model-generated quotation receipts,
            // determines whether an edit can safely be applied.
            const edit = candidate;
            if (partialSource && String(edit.kind).trim().toLowerCase() === 'continuity') {
                pendingEdits.push(response.edits[index]);continue;
            }
            if (initial && (edit.action !== 'create' || edit.kind === 'npc-index')) {
                throw new Error('First collection cannot replace prior entries or create a default NPC Index.');
            }
            // Each accepted edit becomes the baseline for the next, with the regular World Info guards.
            staged = stageNexusEdits(staged, [edit], createPreviewEntry, { detailRecallMode, recallModes:settings?.moduleSettings?.nexusRecallModes }).staged;
            edits.push(edit);acceptedRawEdits.push(edit);
        } catch (error) {
            pendingEdits.push(response.edits[index]);
            console.warn('Skipping collection Nexus edit ' + (index + 1), error);
        }
    }
    return { edits, acceptedRawEdits, pendingEdits,
        skippedNexusEdits: pendingEdits.length + Number(response.recoveredIncompleteEdits === true) };
}

async function reviewSlothSceneDrafts({events,messages,scenes,settings,ask}) {
    const approvedIds = new Map(events.map(event=>[event.id,new Set(event.messageIds)]));
    const approvedMessages = new Set(events.flatMap(event=>event.messageIds));
    const source = messages.filter(message=>approvedMessages.has(message.id));
    const originals = new Map(source.map(message=>[message.id,message.mes]));
    const prompt = [
        'Review these Memory Scene drafts against their assigned original messages.',
        'Return {"repairs":[]} if no serious correction is needed. Repair only missing Scenes, major omissions, or significant factual distortions. Keep stylistic preferences and complete drafts unchanged.',
        'A major issue changes a cause or ending, who did or knew something, a meaningful promise or boundary, or the last significant answer or action. Verify that the last relevant action or answer is actually present. Never invent what happens next.',
        'For each repair return an object with id, issue ("missing", "omission" or "distortion"), evidence ({messageId, quote}), timeline, scene, result and keywords. The evidence quote must be an exact substring of a message assigned to that scene. Keep complete JSON within the output limit.',
        getActiveSlothSummaryPreset(settings).text,
        SCENE_KEYWORD_GUIDANCE,
        'Return only the IDs requiring repair.',
        'Approved events and assigned messages: '+JSON.stringify(events.map(({id,title,messageIds})=>({id,title,messageIds}))),
        'Current drafts:',JSON.stringify([...scenes.values()].map(({id,content,keywords})=>({id,content,keywords}))),
        'Approved original messages:',compact(source),
    ].join('\n\n');
    const response = await ask(prompt,'Summary review');
    if (!Array.isArray(response.repairs)) throw new Error('Summary review did not return a repairs array.');
    const repairs = response.repairs.filter(repair=>{
        const {messageId,quote} = repair?.evidence ?? {};
        const missing = !scenes.has(repair?.id);
        return (missing ? repair?.issue === 'missing' : ['omission','distortion'].includes(repair?.issue)) &&
            approvedIds.get(repair?.id)?.has(messageId) && typeof quote === 'string' && quote.trim().length >= 8 &&
            originals.get(messageId)?.includes(quote);
    });
    return readSlothBatchScenes({scenes:repairs},events);
}

function slothCollectionOutputLimit(settings) {
    return Number(settings?.moduleSettings?.maxTokens) || Number(oai_settings?.openai_max_tokens) || 10000;
}

function deepSeekFlashWriteGuidance(settings) {
    const output=slothCollectionOutputLimit(settings);
    const jsonBudget=Math.floor(output*0.76);
    const proseBudget=Math.floor(jsonBudget*0.39);
    return [
        'Keep the ENTIRE JSON under '+jsonBudget+' output tokens, including Scenes, Nexus edits, citations, and JSON syntax. Share roughly '+proseBudget+' English words across all Scene bodies. Allocate that space before writing, and finish every approved ID and both arrays.',
        'Write dense archival prose. Use one short paragraph for a simple event and a second only when important turns need it. Paraphrase dialogue and include at most two short, distinctive quotes per Scene. Remove scenery, repeated gestures, and repeated versions of the same exchange first. Keep the original cause, what each person learned or agreed to, each disputed term, the real reply, and the final consequential action.',
        'Use a single short Result sentence and a few brief retrieval cues per Scene. Keep Nexus edits to changed facts, with the shortest exact citation sufficient to ground each change. If space runs short, condense early summaries instead of omitting later IDs or leaving JSON incomplete.',
    ].join('\n\n');
}

function deepSeekFlashSceneSources(messages,events) {
    const batches=events.map(({id})=>({id,messages:[]}));
    const owners=new Map(events.flatMap((event,index)=>event.messageIds.map(id=>[id,batches[index]])));
    const nexusOnly=[];
    for (const message of originalMessages(messages)) {
        const owner=owners.get(message.id);
        (owner?.messages ?? nexusOnly).push(message);
    }
    return JSON.stringify({MemorySources:batches,nexusOnly});
}

function approvedSlothCollectionPrompt({nexus,messages,plan,settings,initial,characterContext,partialSource,deepSeekFlash}) {
    const events = plan?.events ?? [];
    const schema = SCENE_LIST_SCHEMA.slice(0, -1) + ',"edits":[...]}';
    return [
        'Complete approved Memory Scenes and Nexus edits in one response. Return just one JSON object with scenes and edits arrays.',
        'Response structure: '+schema,
        slothSceneBatchGuidance(events,settings,characterContext),
        ...(deepSeekFlash ? [deepSeekFlashWriteGuidance(settings),
            'The source is grouped by approved Scene ID below. For a Scene, use only the messages array in its matching MemorySources object. All arrays are available for grounded Nexus edits. nexusOnly is context for Nexus, never source for a Scene.'] : []),
        ...(events.length ? [] : ['No Memory Scenes were approved. Return an empty scenes array.']),
        slothNexusGuidance({nexus,plan,settings,initial,characterContext,partialSource}),
        'Keep Nexus changes to the minimal grounded updates. Use the original chat; an already drafted Scene is a summary, not a substitute for it.',
        'Original source messages (all current IDs, including deferred):',
        deepSeekFlash ? deepSeekFlashSceneSources(messages,events) : compact(messages),
    ].join('\n\n');
}

function slothCollectionModel(profile) {
    const conn=resolveConnection(profile);
    const id=conn.stConnectionProfileId ||
        (conn.useChatCompletionService ? getContext().extensionSettings?.connectionManager?.selectedProfile : '');
    const selected=id ? getSelectedConnectionProfile(getContext(),undefined,id) : null;
    return conn.model || selected?.profile['custom-connection']?.settings?.custom_model || selected?.profile.model;
}

function isDeepSeekFlashModel(model) {
    return /(?:^|[/:])deepseek(?:[-_.]v\d+(?:\.\d+)?)?[-_.]flash(?:$|[-_.:/])/i.test(model || '');
}

export async function composeApprovedSlothCollection(options) {
    const {nexus,messages,plan,profile,settings,signal=null,initial=false,partialSource=false,
        reviewSummaries=false,verifyOrigin=()=>{}} = options;
    const events = plan.events;
    const deepSeekFlash=isDeepSeekFlashModel(slothCollectionModel(profile));
    const prompt = approvedSlothCollectionPrompt({...options,deepSeekFlash});
    const ask = requester(profile,settings,signal,true);
    const parseDraft=(raw,phase)=>{
        try { return normalizeSlothCollectionDraft(parseStrictJSON(raw,phase)); }
        catch (error) {
            const recovered=recoverSlothCollectionDraft(raw);
            if (recovered) return recovered;
            throw error;
        }
    };
    let response, repeated = false;
    try {
        response = await ask(prompt,'Approved collection',parseDraft);
    } catch (error) {
        if (!reviewSummaries || error.code !== 'STMB_SLOTH_MALFORMED_JSON') throw error;
        verifyOrigin();
        repeated = true;
        response = await ask(prompt+'\n\nThe previous response was unreadable. Keep every summary and Nexus edit concise enough to finish the JSON within the response limit.','Approved collection retry',parseDraft);
    }
    verifyOrigin();
    const drafts = readSlothBatchScenes(response,events);
    let reviewFailed = false;
    if (reviewSummaries && !repeated && events.length) {
        try {
            const repairs = await reviewSlothSceneDrafts({events,messages,scenes:drafts,settings,ask});
            for (const [id,repair] of repairs) drafts.set(id,repair);
        } catch (error) {
            reviewFailed = true;
            console.warn('Collection summary review failed; keeping the original drafts.',error);
        }
        verifyOrigin();
    }
    const scenes = events.map(event=>drafts.get(event.id)).filter(Boolean);
    return { scenes, ...readSlothNexusEdits(response,{messages,nexus,settings,initial,partialSource}),
        skippedScenes: events.length - scenes.length, reviewFailed };
}

/** One generation per source chunk; existing memories are reference only. */
export async function composeSingleSlothCollection(options) {
    const {nexus,memory,messages,profile,settings,characterContext='',initial=false,
        partialSource=false,signal=null,verifyOrigin=()=>{},reviewSummaries=false,
        rawDraft=null,onDraft=()=>{},lockedScenes=[],committedEdits=[]}=options;
    const ids=messages.map(m=>m.id);
    const recent=Object.values(memory?.entries||{}).filter(e=>!e.disable&&isCompletedSceneEntry(e))
        .sort((a,b)=>sceneNumberFromTitle(a.comment)-sceneNumberFromTitle(b.comment))
        .slice(-3).map(e=>({title:e.comment,result:String(e.content).split(/^\s*(?:\*\*Result\*\*|#{1,6}\s+Result)\s*$/im).at(-1).trim()}));
    const prompt=[
        DEFAULT_SLOTH_COLLECTION_PROMPTS.plan.replace(
            'Use whole messages and assign each original ID exactly once. When one message closes an incident and briefly opens another, assign it to the action it primarily carries and do not list it twice.',
            'Use actual original message IDs as evidence. A message that closes one incident and opens another may belong to both. Keep both causal boundaries; distinguish completed outcomes from unfinished incidents.'),
        getActiveSlothSummaryPreset(settings).text,
        'Perform causal event classification, complete Scene writing, and minimal Nexus patches in this ONE response. Return only one complete JSON object.',
        'Schema: {"events":[{"title":"title","complete":true,"reason":"causal boundary","segments":[[1,2]],"closure":{"messageId":2,"quote":"exact ending phrase"},"timeline":"YYYY/MM/DD or Unknown","scene":"full connected prose","result":"observed outcome","keywords":["recall cue"]},{"title":"open incident","complete":false,"reason":"why still open","segments":[[2,3]]}],"edits":[]}.',
        'Return one row per causal incident in events. Complete events contain their own Scene and Result. Open incidents have complete:false; leave their outcome pending. Use inclusive source ranges with real original IDs. Shared boundary messages are allowed when they support distinct incidents. Do not duplicate the same incident. Keep all essential details and return complete JSON within the output budget.',
        'Use only the assigned original messages as evidence for each Scene. Existing memories and the character card are disambiguation and continuity context, not source material. Preserve the actual last answer, actions, attribution, distinctive dialogue, promises and consequences. Before finalizing each completed row, check that its ranges include the actual ending and every consequential decision, distinct condition, boundary, action and response described in its prose. Copy the closure quote from its actual original ID inside those ranges. Keep separate completed incidents separate even if they share a topic. Leave genuinely unfinished incidents open.',
        SCENE_KEYWORD_GUIDANCE,
        'Character context (reference only): '+characterContext,
        'Recent saved Scene titles and outcomes (reference only; do not collect them again): '+JSON.stringify(recent),
        slothNexusGuidance({nexus,settings,initial,characterContext,partialSource}),
        'Original source IDs: '+JSON.stringify(ids),
        'Original source messages:',compact(messages),
    ].join('\n\n');
    let inputTokens=null,inputTokensExact=false;
    const ask=requester(profile,settings,signal,true,(usage,phase)=>{
        if(phase!=='Single collection')return;
        const count=usage?.prompt_tokens??usage?.input_tokens;
        if(Number.isFinite(count)&&count>=0){inputTokens=count;inputTokensExact=true;}
    });
    const replayed=typeof rawDraft==='string';
    const raw=replayed ? parseSingleSlothCollectionDraft(rawDraft) :
        await ask(prompt,'Single collection',async (response,phase)=>{
            await onDraft(response);
            return parseSingleSlothCollectionDraft(response,phase);
        });
    if(!replayed&&inputTokens===null){
        try{const count=await getTokenCountAsync(prompt);if(Number.isFinite(count)&&count>=0)inputTokens=count;}catch{}
    }
    verifyOrigin();
    const joined=lockedScenes.length?joinSlothRecoveryScenes(raw,lockedScenes):raw;
    const plan=normalizeSingleSlothPlan(joined,ids,{originalMessages:messages});
    const oneLine=value=>typeof value==='string'?value.replace(/\s*\r?\n\s*/gu,' ').trim():'';
    const rows=(Array.isArray(joined.events)?joined.events:[]).map((event,i)=>({...event,id:'event-'+(i+1),
        timeline:oneLine(event?.timeline)||'Unknown',result:oneLine(event?.result)}));
    const drafts=readSlothBatchScenes({scenes:rows},plan.events);
    for(const [i,saved] of lockedScenes.entries()) {
        const event=plan.events.find(item=>item.id==='event-'+(i+1));
        if(!event||JSON.stringify(event.segments)!==JSON.stringify(saved.segments))
            throw new Error('A pending correction conflicts with an already saved Scene. Keep the completed Scene unchanged.');
        drafts.set(event.id,{...event,content:saved.content,keywords:saved.keywords});
    }
    let reviewFailed=false;
    if(reviewSummaries&&!replayed&&plan.events.length){
        try {
            const repairs=await reviewSlothSceneDrafts({events:plan.events,messages,scenes:drafts,settings,ask});
            for(const [id,repair] of repairs)drafts.set(id,repair);
        }catch(error){reviewFailed=true;console.warn('Collection summary review failed; keeping original drafts.',error);}
        verifyOrigin();
    }
    const accepted=finalizeSingleSlothScenes(plan,drafts);
    const nexusResult=readSlothNexusEdits(raw,{messages,nexus,settings,initial,partialSource,committedEdits});
    const pendingDraft=buildSlothPendingDraft(raw,accepted.scenes,lockedScenes.length,nexusResult.pendingEdits,plan.issues);
    return {plan,...accepted,...nexusResult,pendingDraft,
        committedEdits:[...committedEdits,...(nexusResult.acceptedRawEdits??[])],
        reviewFailed,inputTokens,inputTokensExact,replayed,recoveryUncertain:plan.uncertain};
}

export async function retryApprovedSlothScenes({events,messages,profile,settings,characterContext='',signal=null}) {
    const selectedIds = new Set(events.flatMap(event=>event.messageIds));
    const source = messages.filter(message=>selectedIds.has(message.id));
    const prompt = [
        'Write only the approved Memory Scenes listed below. Supply a complete Scene for every given ID using that exact ID. Return only JSON '+SCENE_LIST_SCHEMA+'.',
        slothSceneBatchGuidance(events,settings,characterContext),
        'Original messages for these Scenes:',compact(source),
    ].join('\n\n');
    const response = await requester(profile,settings,signal,true)(prompt,'Retry requested Memory Scenes');
    return [...readSlothBatchScenes(response,events).values()];
}

export async function compressSlothScene({entry,amount,focus,profile,settings,verifyOrigin,signal=null}) {
    const {scene}=getCompressibleScene(entry);
    const {target,instructions,voiceCues}=getSlothCompressionInstructions(scene,amount,focus);
    const ask=requester(profile,settings,signal);
    const prompt=instructions+'\n\nSaved Scene:\n'+scene;
    let previousDraft='';
    const draft = async suffix => {
        verifyOrigin();
        const response=await ask(prompt+suffix+'\n\nRebuild the body in short, information-dense sentences. Target '+target+' characters. Return {"scene":"..."}.','Shorten saved Scene');
        verifyOrigin();
        if (typeof response.scene==='string'&&response.scene.length<=scene.length) previousDraft=response.scene;
        return stageSlothSceneCompression(entry,response,target,voiceCues);
    };
    try { return await draft(''); }
    catch (error) {
        if (!['STMB_SLOTH_COMPRESSION_FORMAT','STMB_SLOTH_COMPRESSION_VOICE','STMB_SLOTH_MALFORMED_JSON'].includes(error.code)) throw error;
        const details=error.actualLength ? `The previous response was ${error.actualLength} characters. ` : error.message+' ';
        const revision=previousDraft ? '\n\nPrevious draft to revise (verify against the source above):\n'+previousDraft : '';
        return await draft(revision+`\n\n${details}Retry with one JSON object. Aim for ${target} characters. ` +
            'Combine related clauses and remove repeated or routine details. If an exact selected quote was lost, replace a less useful clause with it. Retain named knowledge limits, exact meaningful release, unused options, final physical state, and the last utterance and its speaker.');
    }
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
