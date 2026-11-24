// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
// Sloth collector LLM calls; no data writes.
import { requestCompletion } from './stmemory.js';
import { getCurrentApiInfo, getUIModelSettings, normalizeCompletionSource,
    resolveEffectiveConnectionFromProfile } from './utils.js';
import { oai_settings } from '../../../openai.js';
import { getMaxContextSize } from '../../../../script.js';
import { getTokenCountAsync } from '../../../tokenizers.js';
import { groupSlothSourceWindows, slothSourceRanges, validateNexusEventPlan, stageNexusEdits } from './nexusCollectionPolicy.js';
import { validateGroundedNexusEdits, validateSlothEventWindowEvidence, validateSlothNexusWindowEvidence } from './nexusEditEvidence.js';
import { buildNexusSceneMergeCatalog, validateNexusSceneMergeCandidates } from './nexusSceneMergeProposals.js';
import { validateSlothLegacyContinuityProposal } from './nexusLegacySemantic.js';
import { classifyNexusLegacyTitle } from './nexusLegacyMigration.js';
import {validateNexusSceneSplitProposal} from './nexusSceneSplit.js';
import { SLOTH_SCENE_OUTPUT_CONTRACT, validateSlothSceneResponse } from './nexusSlothScenePrompt.js';
import { getActiveSlothSummaryPreset } from './slothSummaryPrompts.js';
import { getCompressibleScene, getSlothCompressionInstructions, stageSlothSceneCompression } from './nexusSceneCompression.js';

export class InvalidSlothNexusProposal extends Error {
    constructor(cause) {
        super(cause.message, {cause});
    }
}

function canonicalizeNewNexusTitles(edits) {
    return edits.map(edit=>{
        if (edit?.action !== 'create' || typeof edit.title !== 'string') return edit;
        const title = edit.kind === 'continuity' && /^Current Continuity\s*[:–—-]/iu.test(edit.title) ? 'Current Continuity' :
            edit.kind === 'core' && /^Core Memory\s*[:–—-]/iu.test(edit.title) ? 'Core Memory' : '';
        return title ? {...edit,title} : edit;
    });
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
        if(full?.error)throw new Error(phase+': the selected provider returned an error instead of a draft.',{cause:full.error});
        return parseStrictJSON(text,phase);
    };
}
const compact=messages=>JSON.stringify(messages.map(m=>({id:m.id,name:m.name,
    mes:m.mes,is_user:!!m.is_user,send_date:m.send_date})));
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
        'Treat related conversational and physical beats as parts of the shared objective or exchange. A single movement, gesture, or bill settled on the way is seldom its own resolved thread if it only advances the same situation.',
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
        'One causal incident = one complete Scene even across discontiguous source messages.',
        'Do not split at arbitrary date, token boundary, place or window. Independent incidents stay separate.',
        'Before choosing boundaries, identify the independently recallable changes in what people did, learned, agreed to, or actually resolved. A boundary must leave one complete cause → response → consequence on each side. If one side is just a setup, response, interruption, gesture, joke or follow-through whose meaning depends on the other side, keep both together.',
        'Keep one continuous disagreement and its attempts at repair, explanation, and final answer together. A pause, location change, apology, new speaker, or later reveal that answers that same exchange does not create a separate memory. Preserve the separate facts within that memory. Do not mark hurt forgiven unless the affected person explicitly shows it.',
        'Separate a genuinely independent new obligation, revelation or outcome when it can be recalled on its own. Check each interval from first to last: every assigned turn must belong to the cause, response or consequence named in that event. If a new encounter has a different immediate goal and its own payoff, start a new event, even during the same outing or after the same earlier disagreement. An interval must not conceal a completed second incident. A single-turn scene must have its own independent cause and consequence, not merely the last reply.',
        'Window records are partial evidence, not candidate Scenes to copy. If an early problem and a later action resolve the same goal, join the setup, attempts and resolution into one event. Trust an exact quote over a conflicting paraphrase in a window record.',
        'When a window contains originalMessages, those are complete original turns. Use them directly alongside the compact evidence from other windows.',
        'Never mark a future, uncertain, or ongoing outcome as completed.',
        'Put open or uncertain material in deferred only. Every item in events has complete: true and a distinct, observed ending.',
        'Plan at whole-message granularity. Give each message exactly one owner. When a turn closes one event and mentions another, give the turn to the event whose observable action it primarily carries. Describe the unfinished mention as pending, never as another owner of the same ID. Separate events only if each has its own supported closure.',
        'Every visible original message must appear exactly once across events and deferred. Assign ordinary dialogue and IDs absent from the condensed evidence to a related event when supported, or defer them as context. Check for gaps and duplicate IDs.',
    ].join('\n\n'),
    nexus:[
        'Propose minimal EXACT SPAN updates to an existing SillyTavern Nexus World Info.',
        'An empty edits array is allowed. Preserve every untouched fact.',
        'Every edit must include a specific factual reason in "reason" and an "evidence" array. Each evidence item contains the original integer "messageId" and an exact 8–400 character substring in "quote".',
        'Cite current original message IDs, NOT generated Scene titles or fabricated references.',
        'A quote proves that text was said, not that an interpretation is correct.',
        'A continuity replace_exact also requires "supersession" with exactly ONE of these values:',
        '"observed_resolution", "observed_correction", "explicit_retraction", "new_confirmed_information". Never combine the values.',
        'Never remove an old state just because a date passed or no one mentioned it.',
        'For a reported state, clearly attribute who reported it; do not present it as observed fact.',
        'Skip a fact already recorded correctly, even if the chat reconfirms it. Each changed clause must be supported by its own citation.',
        'Keep one live line per fact. Correct a matching line in place when more precise evidence changes the same condition; use append_section only for a distinct current fact. If a report is corrected in the same exchange, store the corrected live condition with its source. Retain the prior report separately only if a named person still believes it or later actions depend on it.',
        'A newly stated practical constraint can refine an otherwise unchanged line. Keep evidence-backed changes to ongoing treatment, allowed activity, or discharge in that same line when they affect the next turn. Do not append a duplicate condition or recopy the report that was disproven.',
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
        'When creating Current Continuity, place each supported section on its own Markdown heading line, for example "## Present Handoff". Omit unsupported sections. Each active obligation appears only until it is explicitly resolved, corrected, or retracted.',
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
        'LT and NPC existing matching topics should be patched; create only when truly new and durable.'
    ].join('\n\n'),
});

export async function analyzeSlothEvents({messages,profile,settings,characterContext='',signal=null}) {
    const ask=requester(profile,settings,signal);
    const ids=messages.map(m=>m.id);
    const evidenceHeader=[
        'Ordered original IDs: '+JSON.stringify(ids),
        'Exact source index spans: '+JSON.stringify(slothSourceRanges(ids)),
        'Character context (do not treat as source event): '+characterContext,
        'Original source or detailed window evidence:',
    ].join('\n\n')+'\n\n';
    const prompt=[
        DEFAULT_SLOTH_COLLECTION_PROMPTS.plan,
        'Return JSON with events and deferred arrays. Each event needs title, complete:true, reason, result, and segments. Each deferred item needs reason and segments. Segments are nested inclusive ranges. Use [[10,10],[12,12]] for two nonadjacent IDs. Return each original ID exactly once across both arrays.',
        evidenceHeader,
    ].join('\n\n');
    const run = source => requestValidatedDraft(prompt+source,'Event plan',ask,
        raw=>validateNexusEventPlan(raw,ids,{deferUnclassified:true}),
        error=>[DEFAULT_SLOTH_COLLECTION_PROMPTS.plan,
            'The first event plan was rejected: '+error.message,
            'Return three arrays: events, deferred, assignments. An event has title, complete:true, reason and result. A deferred record only has reason. Do not use ranges in this response.',
            'In assignments, include one pair [originalMessageId, ownerLabel] for each exact ID below. e1 means first event, e2 means second event, d1 means first deferred record. Each original ID appears once; the same label can recur for separated source turns. Never assign new IDs to individual actions inside one message.',
            'Exact original IDs: '+JSON.stringify(ids),
            'Example for original IDs [10,12,13]: {"events":[{"title":"Recovered key","complete":true,"reason":"The owner got the key back.","result":"The owner recovered the key."}],"deferred":[{"reason":"A separate search has not started."}],"assignments":[[10,"e1"],[12,"d1"],[13,"e1"]]}.',
            evidenceHeader+source,
        ].join('\n\n'));
    return withFullSlothSource(messages,prompt,settings,profile,run,
        () => evidenceFor(messages,ask,prompt,settings,profile,true));
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

function slothSceneBatchGuidance(events, settings, characterContext, maxProse = 650) {
    return [
        getActiveSlothSummaryPreset(settings).text,
        `Output length per memory: ${Math.floor(maxProse / 2)}–${maxProse} tokens of Scene prose, roughly ${Math.floor(maxProse * 0.32)}–${Math.floor(maxProse * 0.62)} English words, or shorter for a simple event. Use indirect speech for long exchanges and keep only short distinctive or consequential quotations. Give the full ending of every event within its own budget.`,
        'Return one Scene for each approved ID. Give its Timeline in YYYY/MM/DD, YYYY/MM/DD–YYYY/MM/DD, or Unknown. Use English.',
        'Use only the assigned messages for that Scene, even when other approved events or deferred messages share this request. Stop at the last assigned action or utterance. Treat thoughts and suspicions as attributed; do not infer forgiveness, an answer or a new physical action.',
        SCENE_KEYWORD_GUIDANCE,
        'Character context: '+characterContext,
        'Approved events: '+JSON.stringify(events.map(({id,title,result,messageIds})=>({id,title,result,messageIds}))),
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
            const draft = validateSlothSceneResponse({title:event.title,content,keywords}, event.title);
            scenes.set(event.id,{...event,...draft});
        } catch { /* The caller may recover only this scene. */ }
    }
    return scenes;
}

export async function composeSlothScenes({events,messages,profile,settings,signal=null,characterContext='',verifyOrigin=()=>{}}) {
    const ask = requester(profile,settings,signal);
    const configured = Number(settings?.moduleSettings?.maxTokens) || Number(oai_settings?.openai_max_tokens) || 0;
    // Reserve 650 prose tokens and room for every result, cue list and JSON object.
    const batchSize = Math.max(1,Math.min(4,Math.floor((configured * 0.88 - 240) / 950)));
    const scenes = [];
    for (let index=0;index<events.length;index+=batchSize) {
        const batch = events.slice(index,index+batchSize);
        let accepted = new Map();
        if (batch.length>1) {
            const wanted = new Set(batch.flatMap(event=>event.messageIds));
            const source = compact(messages.filter(message=>wanted.has(message.id)));
            const prompt = [
                'Write the separate approved memories in one response. Return only JSON '+SCENE_LIST_SCHEMA+'.',
                slothSceneBatchGuidance(batch,settings,characterContext),
                'Original source messages: ',
            ].join('\n\n');
            if (source.length<=18000 || await canUseOriginalSource(prompt+source,settings,profile,true)) {
                try {
                    accepted = readSlothBatchScenes(await ask(prompt+source,'Scene batch'),batch);
                } catch(error) {
                    if(error.code!=='STMB_SLOTH_MALFORMED_JSON' && !sourceCapacityExceeded(error)) throw error;
                }
                verifyOrigin();
            }
        }
        for(const event of batch) {
            const scene = accepted.get(event.id) || await composeSlothScene({event,messages,profile,settings,signal,characterContext});
            verifyOrigin();
            scenes.push(scene);
        }
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

function slothNexusGuidance({scenes,nexus,plan,settings,initial,characterContext}) {
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
    return [
        DEFAULT_SLOTH_COLLECTION_PROMPTS.nexus,
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
        'Legacy Long-Term Memory / Status / Scene Continuity conversion is out of scope: preserve them.',
        ...(scenes ? ['Newly composed completed Scenes:',JSON.stringify(scenes.map(s=>({
            title:s.title,result:s.result,content:s.content,segments:s.segments})))] : []),
        'Approved event classifications:',JSON.stringify({
            events:(plan?.events||[]).map(x=>({title:x.title,segments:x.segments})),
            deferred:(plan?.deferred||[]).map(x=>({reason:x.reason,segments:x.segments})),
        }),
        'Deferred source is still visible; use it to assess ongoing state without',
        'claiming a deferred or uncertain incident is complete.',
        'Current Nexus entries (exact UIDs):',source,
        'If a window contains originalMessages instead of extracted citations, cite those original turns directly, retaining their IDs and language in quote fields.',
        'EACH edit object must contain its own reason and evidence:[{"messageId":integer,"quote":"short exact original substring"}]. This also applies to create. New core and continuity titles are exactly "Core Memory" and "Current Continuity" without any subtitle. Use append_section only for continuity; additional LT or NPC text uses append. Do not submit an uncited edit.',
        'Keep the complete JSON within the output budget. Make reasons single short sentences and use the shortest sufficient literal quote for each change. Patch existing entries with minimal spans. Keep the handoff and durable changes; omit redundant recaps and routine dialogue.',
    ].join('\n\n');
}

function readSlothNexusEdits(response, {messages,nexus,settings,initial}) {
    try {
        if(!Array.isArray(response.edits))throw new Error('Nexus delta must contain edits list.');
        const edits=validateGroundedNexusEdits(canonicalizeNewNexusTitles(response.edits),messages);
        if(initial&&edits.some(edit=>edit.action!=='create'||edit.kind==='npc-index')) {
            throw new Error('First collection cannot replace prior entries or create a default NPC Index.');
        }
        // Dry-run the same World Info guards used for the actual save.
        stageNexusEdits(nexus,edits,book=>{
            const used=new Set(Object.values(book.entries).map(entry=>Number(entry.uid)));
            let uid=0;
            while(used.has(uid)||Object.hasOwn(book.entries,uid))uid++;
            return (book.entries[uid]={uid});
        },{detailRecallMode:settings?.moduleSettings?.nexusDetailRecallMode==='keyword'?'keyword':'vector'});
        return edits;
    } catch (error) {
        throw new InvalidSlothNexusProposal(error);
    }
}

export async function proposeSlothNexusEdits({scenes,nexus,messages,plan,profile,settings,signal=null,
    initial=false,characterContext=''}) {
    const ask=requester(profile,settings,signal);
    const prompt=[
        slothNexusGuidance({scenes,nexus,plan,settings,initial,characterContext}),
        'Return strict JSON {"edits":[...]} only.',
        'Current-chat original grounded evidence (exact message IDs):',
    ].join('\n\n')+'\n\n';
    const validate = response => readSlothNexusEdits(response, {messages,nexus,settings,initial});
    try {
        return await withFullSlothSource(messages,prompt,settings,profile,
            groundedSource => requestValidatedDraft(prompt+groundedSource,'Nexus delta',ask,validate,
                (error, rejected) => [prompt+groundedSource,
                    'The first draft was rejected: '+error.message,
                    ...(rejected ? ['Rejected draft for repair only; verify everything with the original messages:',JSON.stringify(rejected)] : []),
                    'Return compact JSON {"edits":[...]}. Keep independent edits that can be verified, and correct or drop the invalid edit. Every retained edit needs its own short reason and evidence array of one to eight {"messageId":integer,"quote":"verbatim excerpt"} objects. A create needs these fields too. For LT and NPC additions use append; only Current Continuity uses append_section. Omit protected UIDs. Return {"edits":[]} if no edits are supported.',
                ].join('\n\n')),
            () => nexusStateEvidenceFor(messages,ask));
    } catch (error) {
        if (error.code==='STMB_SLOTH_MALFORMED_JSON') throw new InvalidSlothNexusProposal(error);
        throw error;
    }
}

export async function composeApprovedSlothCollection(options) {
    const {nexus,messages,plan,profile,settings,signal=null,initial=false,characterContext='',verifyOrigin=()=>{}} = options;
    const events = plan.events;
    const limit = Number(settings?.moduleSettings?.maxTokens) || Number(oai_settings?.openai_max_tokens) || 0;
    // Allow 2,000 tokens for Nexus edits, 1,200 for reserve and 100 per scene for its wrapping fields.
    const maxProse = events.length ? Math.min(650, Math.floor((limit - 3200) / events.length) - 100) : 0;
    let composed = new Map();
    let edits;
    if (maxProse >= 480) {
        const original = compact(messages);
        const schema = SCENE_LIST_SCHEMA.slice(0, -1) + ',"edits":[...]}';
        const prompt = [
            'Complete approved Memory Scenes and Nexus edits in one response. Return just one JSON object with scenes and edits arrays.',
            'Response structure: '+schema,
            slothSceneBatchGuidance(events,settings,characterContext,maxProse),
            slothNexusGuidance({nexus,plan,settings,initial,characterContext}),
            'Keep Nexus edits compact (approximately 2,000 tokens or fewer) and only cite the original chat. Treat any already drafted Scene as a summary, never as source evidence.',
            'Original source messages (all current IDs, including deferred):',original,
        ].join('\n\n');
        if (original.length <= 18000 || await canUseOriginalSource(prompt,settings,profile,true,64000)) {
            try {
                const ask = requester(profile,settings,signal);
                const result = await ask(prompt,'Approved collection');
                composed = readSlothBatchScenes(result,events);
                edits = readSlothNexusEdits(result,{messages,nexus,settings,initial});
            } catch (error) {
                if (!(error instanceof InvalidSlothNexusProposal)
                    && error.code !== 'STMB_SLOTH_MALFORMED_JSON' && !sourceCapacityExceeded(error)) throw error;
            }
            verifyOrigin();
        }
    }
    const missing = events.filter(event => !composed.has(event.id));
    if (missing.length) {
        for (const scene of await composeSlothScenes({...options,events:missing})) {
            composed.set(scene.id,scene);
        }
    }
    const scenes = events.map(event => composed.get(event.id));
    edits ??= await proposeSlothNexusEdits({...options,scenes});
    return {scenes,edits};
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
