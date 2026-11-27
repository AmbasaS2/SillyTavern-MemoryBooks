// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
//
// Scene prompt from the original Sloth MemoryBooks v1.3 setup. Keep the
// source wording here. Collection-specific routing lives in the caller.

export const SLOTH_SCENE_PROMPT_V13 = [
    "Create one retrievable scene memory from the selected roleplay range. One collection action creates one lorebook entry. Use the selected range as the complete evidence boundary. A good memory lets a future scene recover what happened, who knew and did what, what changed between people, and the exact state at which the range ended.",
    "",
    "# Output contract",
    "",
    "Write all output in English. Return one standards-compliant JSON object with exactly these fields and layout:",
    "",
    "{",
    "  \"title\": \"[date, date range, or Unknown] | [concise event-focused title]\",",
    "  \"content\": \"**Timeline**: [same date, date range, or Unknown]\\n\\n**Scene**\\n[connected event-memory paragraph]\\n\\n[another paragraph only for another distinct local arc]\\n\\n**Result**\\n[one concise sentence naming the single defining completed consequence]\",",
    "  \"keywords\": [\"string\", \"string\", \"string\", \"string\", \"string\"]",
    "}",
    "",
    "For supported numeric dates use `YYYY/MM/DD`; for a span use `YYYY/MM/DD–YYYY/MM/DD` with an en dash. Use the labels exactly. Encode line breaks once as `\\n` so one JSON parse produces real line breaks. The JSON object is the complete response.",
    "",
    "# What to preserve",
    "",
    "Prioritize, in order: the evidence boundary; meaning, agency, and relationship change; the exact endpoint and its continuity state; connected readable prose; completed historical consequences; useful retrieval hooks; and brevity.",
    "",
    "Keep a detail when changing or losing it would alter an actor or recipient, consequential order, motive, knowledge access, commitment or boundary, care stage, contact meaning, relationship change, durable character pattern, or endpoint. Compress routine logistics, decoration, repeated symptoms, repeated restatements, and interchangeable micro-detail. Aim for 350–600 English words in Scene, with 650 as the maximum; a simple range may be shorter.",
    "",
    "# Silent continuity pass",
    "",
    "Read the whole selection before drafting. Silently arrange continuity-bearing occurrences on one story-time spine. For each consequential occurrence, identify its actor, recipient or object, exact action or proposition, story time, completion state, provenance and certainty, immediate response, and resulting change. Use this work only to build the final memory.",
    "",
    "Set Timeline to the span of every directly narrated story date inside the selection, including an earlier date narrated in the first selected message even when most of the range occurs the next day. An older date mentioned only through memory or report stays part of that occurrence's content rather than extending Timeline. Use `Unknown` when direct narration does not support a date.",
    "",
    "Place an information event when the speaking, showing, asking, answering, or learning occurred. Distinguish direct experience, private thought, report, inference, and uncertainty. For a material nested report, write the shortest complete attribution chain, such as `A told B that C had witnessed X`. The named intermediary and named witness or source are continuity-bearing when the later inference depends on that chain. When direct narration and a later report overlap, keep the direct sequence in its narrated position and place any reported time, cause, or modifier with the later speaker rather than merging their certainty. Preserve a relay as entrusted, delivered, or unverified according to the last stage shown. Attach an object's owner, finder, chooser, modifier, movement, or custody only to the person or object established by the source; when an attachment is unclear, retain the supported object fact without assigning the unclear role.",
    "",
    "For each consequential action, preserve proposer, accepter, planner, and executor as separate roles. Describe each person only for the role they performed. For example, if one person proposes leaving and another agrees, chooses the route, and leads, retain that division of agency.",
    "",
    "For each promise, demand, condition, boundary, refusal, finite offer or task, and chooser-owned option, keep its independent clause, maker or owner, addressee, response actor, and shown status. Count separate clauses within one speech separately, including an exception that preserves another person's freedom. A chooser-owned option remains that person's freedom rather than another person's promise. Carry a consequential offer or task as proposed, accepted, performed, or still incomplete according to the range. Treat a concrete object undertaking made during an apology, repair, bargain, or relationship turn as continuity-bearing even when its acceptance or completion is not shown.",
    "",
    "Classify the answer to each proposal or term at its observed stage: unanswered → heard or acknowledged → tolerated or permitted → explicitly accepted or rejected → committed → enacted or completed. A counterterm becomes its own proposal with its own answer stage. Use the observed stage in prose; a noncommittal sound or continued presence can remain acknowledgement or tolerance without becoming explicit acceptance.",
    "",
    "Use this response-strength ladder: reaction or softening → conditional continuation or accountability → explicit acceptance → explicit forgiveness or full resolution. Choose the highest stage directly supported by words or actions. When a character softens and asks someone to keep a promise, a precise memory can say that they softened and held the speaker to the promise; stronger acceptance or forgiveness language belongs to an explicit source statement.",
    "",
    "Track care by stage: prediction → proposal or offer → supply → application or consumption → prescribed or remaining course → completion or discharge. State the last stage actually shown for each consequential item. If one supplied item is consumed and another is only placed nearby, preserve the first as consumed and the second as supplied with consumption unverified. Keep endpoint-relevant remaining treatment, symptoms, and release or discharge state when they affect what can happen next.",
    "",
    "Track meaningful contact by actor, recipient, action or surface, awareness, concealment, and latest state. Close each distinct contact at its own latest shown state before moving to a later contact; a later no-contact endpoint supplements rather than replaces an earlier release. When someone senses a touch while concealing awareness, preserve both that perception and the point at which the touch ends. At the endpoint, use the latest supported state: continuing contact, released contact, or no active contact.",
    "",
    "Identify the final completed story beat in the last selected message. Preserve its transition, positions or formation, contact state, concealed response when consequential, and the last utterance with its stated reason. When no reply follows inside the range, use that utterance as the natural final sentence of Scene so the stopping point carries the pending question or choice by itself.",
    "",
    "# Scene",
    "",
    "Write Scene as connected past-tense prose moving forward along the story-time spine. Keep an action or statement with its immediate response and resulting change. Start a new paragraph for a distinct time, point of view, immediate purpose, or relationship phase rather than for every speaker or small movement.",
    "",
    "Preserve the shortest useful exact quotation when English dialogue establishes a correction, intention, consent, refusal, promise, boundary, secret, relationship turn, or final beat. Weave quotations into prose. Render non-English dialogue as attributed English prose.",
    "",
    "Connect outward action to its source-supported emotional meaning. Match the source's degree of certainty and relationship change: observation, tolerance, assessment, acceptance, trust, alliance, and forgiveness remain distinct stages. A private one-person act stays private unless another character gains access to it.",
    "",
    "# Result",
    "",
    "Choose the single completed consequence that best defines the episode and express it in one concise past-tense sentence. Reuse the actor names and actor-action wording already established in Scene, keeping the recipient or object and the source-supported response stage explicit. When one defining consequence spans proposal and execution, name each role only when both are needed to understand that consequence. Let Scene carry secondary completed arcs, care details, and open endpoint states; Result acts as one stable retrieval takeaway from Scene.",
    "",
    "# Keywords",
    "",
    "Choose exactly five distinct retrieval families and one literal English trigger of one to six words from each. Balance different continuity functions when available: a correction or commitment, object, bodily cue or treatment, hidden act, place, consequential action, or memorable line. Each trigger should be directly supported, independently meaningful, specific enough to retrieve this memory, and natural enough to recur verbatim in future roleplay. Use at most two dialogue fragments.",
    "",
    "# Final review",
    "",
    "Before returning the JSON, confirm that:",
    "",
    "1. The Scene follows the supported chronology and knowledge paths.",
    "2. Consequential proposer, accepter, planner, executor, response actor, and chooser remain correctly assigned; each causal inference based on a nested report retains its named intermediary and named witness or source.",
    "3. Every material independent commitment, boundary, chooser-owned exception, finite offer, concrete object undertaking, and task has been counted separately and appears with its shown status; every counterterm keeps its own response stage.",
    "4. Care and contact end at their last supported stages, including endpoint-relevant remaining or unverified states.",
    "5. Relationship language stops at the supported rung of the response-strength ladder.",
    "6. The final configuration and full final utterance are preserved without continuing past the selected range.",
    "7. Scene stays within 650 words. Result contains exactly one concise sentence, selects one defining completed consequence, reuses Scene's established actor-action relation, and ends at its supported completion stage. Scene carries secondary and open states. The five keyword families are distinct, and the JSON parses with exactly three fields.",
].join('\n');

// Only the writing guidance appears in the preset editor. The machine format
// and the selected source boundaries are supplied by the collection pipeline.
const outputContractStart = SLOTH_SCENE_PROMPT_V13.indexOf('# Output contract');
const writingRulesStart = SLOTH_SCENE_PROMPT_V13.indexOf('# What to preserve');
export const SLOTH_SCENE_OUTPUT_CONTRACT = SLOTH_SCENE_PROMPT_V13.slice(outputContractStart, writingRulesStart).trim();
export const SLOTH_DEFAULT_SUMMARY_PROMPT = [
    "# What to preserve",
    "Write one self-contained scene memory in connected past-tense prose. Follow the cause, actions, turning point and observed outcome in order. Give the event the space its consequences need. Keep distinctive voice and concrete recall cues. Preserve the lived texture of the scene: distinctive sensory details, atmosphere, meaningful silences, hesitation, gestures and shifts in emotional or interpersonal distance when they make this moment memorable. Convey emotions through source-supported actions, dialogue, perceptions and attributed thoughts; keep what is uncertain uncertain. Condense incidental scenery, routine logistics, redundant reactions and long exchanges before cutting consequential facts or meaningful atmosphere.",
    "Timeline. Use directly narrated story dates, including an earlier date in the first selected message; dates merely remembered or reported do not extend it. Use Unknown when unsupported. Use names established by narration or dialogue. Use a role such as “the hostess” if only a private note, <Inner_Info> or status box gives the name. Apply this in Scene, Result and keywords. Keep private thoughts separate from what other characters learned.",
    "Agency and knowledge. Keep proposer, accepter, chooser and executor distinct. Name the chosen route, method, owner or object when it explains the outcome. Keep direct experience, private thought, hearsay and inference separate. Preserve each named link in a consequential report: “A told B that C had heard the news from D.” Retain original names or a consistent transliteration.",
    "Commitments and relationship. Retain each material promise, request, refusal, boundary, precondition, counterterm, limited offer or chooser-owned exception with its actor, addressee and actual response. Keep proposed, permitted, accepted, committed and enacted distinct. Keep independent agreement conditions separate; when consent or a crossed boundary changes the relationship, retain who did what, the actual response and any specific apology, prioritizing a short exact line of dialogue that carries the condition or repair. A promise remains open until the source shows it done. Attribute an onlooker's opinion to the onlooker. Keep characteristic voice with one to three short, exact English quotes, focusing on a joke, decision or final words. Paraphrase longer exchanges and attribute translated dialogue accurately.",
    "Care and contact. Distinguish what was offered, supplied, applied or consumed, still prescribed and finished. Preserve consequential touch in order, including initiator, body part or object, and release if shown. End Scene with the last visible arrangement and meaningful utterance or action. If touch matters, write one concrete clause naming who held or touched what, exactly where, and whether it continued or ended. Keep meaningful positions, held objects or doors, and the supported answer or unanswered choice. Keep the prose in the story: “Her palm stayed on his cheek as he answered.”",
    "Result. One past-tense sentence stating who did, said, decided or disclosed the defining completed thing. For a difficult exchange, “A apologized and B took A's hand” records the outcome; “they resolved the hurt” requires explicit evidence from both. Use the concrete steps when a character's response was unspoken, indirect or absent. Leave open concerns in Scene.",
].join("\n\n");

function validateSlothSceneBody(response, enforceWordLimit) {
    const keys = Object.keys(response);
    const parts = typeof response.content === 'string' && response.content.trim().match(
        /^\*\*Timeline\*\*:\s*([^\n]+)\r?\n\s*\*\*Scene\*\*\s*\r?\n([\s\S]+?)\r?\n\s*\*\*Result\*\*\s*\r?\n([^\n]+)$/,
    );
    if (keys.length !== 3 || typeof response.title !== 'string' || !response.title.trim() ||
        !parts || !parts[2].trim() || !parts[3].trim()) {
        throw new Error('Scene must include title, Timeline, Scene and Result in the reviewed output format.');
    }
    if (enforceWordLimit && parts[2].trim().split(/\s+/u).length > 650) {
        const error = new Error('Scene exceeds the original 650-word limit. Nothing saved.');
        error.code = 'STMB_SLOTH_SCENE_TOO_LONG';
        throw error;
    }
    return response.content.trim();
}

export function validateSlothSceneResponse(response, fallbackKeyword = '', { enforceWordLimit = true } = {}) {
    const content = validateSlothSceneBody(response, enforceWordLimit);
    const keywords = new Map();
    for (const candidate of Array.isArray(response.keywords) ? response.keywords : []) {
        if (typeof candidate !== 'string') continue;
        const phrase = candidate.trim();
        if (!phrase || /[\r\n]/u.test(phrase)) continue;
        const key = phrase.toLowerCase();
        if (!keywords.has(key)) keywords.set(key, phrase);
        if (keywords.size === 16) break;
    }
    return {content, keywords: !keywords.size && fallbackKeyword ? [fallbackKeyword] : [...keywords.values()]};
}
