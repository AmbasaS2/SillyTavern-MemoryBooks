// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only

export const SLOTH_COMPRESSION_AMOUNTS = [75, 55, 35];
export const SLOTH_COMPRESSION_FOCUS = Object.freeze({
    voice: 'Preserve at least one genuinely distinctive short quote verbatim when present, such as a joke or character-specific humor, besides the final exchange. Keep its speaker attached and cut ordinary dialogue and setup before cutting the selected voice cue.',
    relationships: 'Prioritize relationship changes, meaningful gestures, emotional turning points, and attempts at repair.',
    recall: 'Prioritize places, objects, sensory cues, and distinctive actions that may be needed to recall this event.',
});

export function getCompressibleScene(entry) {
    if (!entry?.content || entry.disable || entry.STMB_slothSceneSplitArchive || entry.STMB_slothSceneMergedInto) return null;
    const parts = entry.content.match(/^([\s\S]*?^(?:\*\*Scene\*\*|#{1,6}[ \t]+Scene)[ \t]*\r?\n(?:[ \t]*\r?\n)*)([\s\S]+?)(\r?\n(?:[ \t]*\r?\n)*(?:\*\*Result\*\*|#{1,6}[ \t]+Result)[ \t]*\r?\n[\s\S]+)$/im);
    if (!parts || !/^(?:\*\*Timeline\*\*|#{1,6}[ \t]+Timeline)/im.test(parts[1]) || parts[2].trim().length < 160) return null;
    return { before:parts[1], scene:parts[2].trim(), after:parts[3] };
}

export function getSlothCompressionInstructions(scene, amount, focus) {
    if (!SLOTH_COMPRESSION_AMOUNTS.includes(amount) || focus.some(key => !Object.hasOwn(SLOTH_COMPRESSION_FOCUS, key))) {
        throw new Error('Invalid Sloth compression choices.');
    }
    const target = Math.floor(scene.length * amount / 100);
    const spoken = [...scene.matchAll(/“([^”\r\n]+)”|"([^"\r\n]+)"|「([^」\r\n]+)」|『([^』\r\n]+)』/gu)]
        .map(match=>(match[1]||match[2]||match[3]||match[4]).trim());
    const voiceCues = focus.includes('voice') ? [...new Set(spoken.slice(0,-1))]
        .filter(cue=>cue.length>=12 && cue.length<=Math.min(72,Math.floor(target*0.25)) && /[\p{L}\p{N}]/u.test(cue) && cue!==spoken.at(-1)) : [];
    const words = Math.floor(scene.trim().split(/\s+/u).length * amount / 100);
    const length = `Length target: ${target} characters. Your revised scene must be under ${Math.floor(target * 1.15)} characters` +
        (words >= 35 ? ` (about ${words} words for this source)` : '') + '.';
    const instructions = [
        'Condense this one saved Sloth scene memory into the specified length. Use only the source as evidence and write in its language.',
        'Return exactly one JSON object with string field "scene" for the revised body. Do not emit headings, title, Timeline, Result or keywords.',
        length,
        'Use 1–2 compact paragraphs. Do not paraphrase source sentences in order. First pick the few causal beats, then rewrite them together. Cut dates and waiting or preparation, decoration, repeated statements, and objects or actions that do not change an outcome. Open with the first consequential action.',
        'Keep the cause, the actions that changed the outcome, who learned what, commitments and boundaries, and the final meaningful line and its response. Fold continuity into short clauses: identify the actor and surface of any consequential release (e.g. let go of the cuff); keep the final open/closed, held/released or inside/outside state if one is stated. A report, permission or offer must not become fact, consent or completion.',
        'If the source distinguishes an unused permission, a chooser-owned decision, and a promise, preserve all three in one short sentence. Name who still lacks important knowledge when that matters, and explicitly name the speaker of the final utterance. For care distinguish supplied from applied and pending from complete. Cut decoration before losing such contrasts, even in the shortest draft.',
        'When space is tight, name the kind of secondary detail in a short clause instead of narrating it in full. Use connected past-tense prose. Do not copy the source, combine independent choices, or introduce facts.',
        ...focus.map(key => SLOTH_COMPRESSION_FOCUS[key]),
        ...(voiceCues.length ? ['Keep at least one of these short, verbatim non-final cues in the compressed Scene: '+JSON.stringify(voiceCues)] : []),
        'Fit selected details into the length rather than adding more paragraphs. Write a memory, not a retelling.',
        'Compression example (different story): "Vera alone told Bo the seal was missing. He agreed to search by dawn and could use the ferry, but kept his choice and had boarded nothing. Vera let go of his cuff before he stopped at the locked gate. She asked whom he would tell. He did not answer."',
    ].join('\n');
    return { target, instructions, voiceCues };
}

export function stageSlothSceneCompression(entry, response, target, voiceCues=[]) {
    const original = getCompressibleScene(entry);
    const body = typeof response?.scene === 'string' ? response.scene.trim() : '';
    if (!original || Object.keys(response ?? {}).length !== 1 ||
        body.length < Math.floor(target * 0.52) || body.length > Math.ceil(target * 1.35) ||
        body.length >= Math.ceil(original.scene.length * 0.9) || /^(?:\*\*(?:Timeline|Scene|Result)\*\*|#{1,6}\s+(?:Timeline|Scene|Result)\b)/im.test(body)) {
        throw Object.assign(new Error('The shortened scene did not match the requested length or format.'), {
            code:'STMB_SLOTH_COMPRESSION_FORMAT', actualLength:body.length,
        });
    }
    const normalizeVoice = value => value.replace(/[‘’]/g,"'").replace(/\s+/gu,' ');
    const normalizedBody=normalizeVoice(body);
    if (voiceCues.length && !voiceCues.some(cue=>normalizedBody.includes(normalizeVoice(cue).replace(/[.,!?…]+$/u,'')))) {
        throw Object.assign(new Error('The draft dropped every selected short voice cue.'),{code:'STMB_SLOTH_COMPRESSION_VOICE'});
    }
    return {
        ...entry,
        content: original.before + body + original.after,
        STMB_slothCompression: {
            version:1,
            originalContent:entry.STMB_slothCompression?.originalContent ?? entry.content,
        },
    };
}
