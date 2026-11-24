// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only

function readObjectArrayPrefix(text, offset) {
    const entries=[];
    let cursor=offset;
    while (cursor<text.length) {
        while (/\s/u.test(text[cursor]??'')) cursor++;
        if (text[cursor]===']') return {entries,end:cursor+1};
        if (text[cursor]!=='{') break;
        const start=cursor;
        let depth=0, quoted=false, escaped=false;
        for (;cursor<text.length;cursor++) {
            const char=text[cursor];
            if (quoted) {
                if (escaped) escaped=false;
                else if (char==='\\') escaped=true;
                else if (char==='"') quoted=false;
            } else if (char==='"') quoted=true;
            else if (char==='{') depth++;
            else if (char==='}' && --depth===0) break;
        }
        if (depth!==0 || cursor>=text.length) break;
        try { entries.push(JSON.parse(text.slice(start,cursor+1))); }
        catch { break; }
        cursor++;
        while (/\s/u.test(text[cursor]??'')) cursor++;
        if (text[cursor]===']') return {entries,end:cursor+1};
        if (text[cursor]!==',') break;
        cursor++;
    }
    return {entries,end:null};
}

export function normalizeSlothCollectionDraft(draft) {
    if (!Array.isArray(draft.scenes) || (Array.isArray(draft.edits) && draft.edits.length) ||
        (Array.isArray(draft.edits) && !draft.recoveredIncompleteEdits)) return draft;
    const tail=draft.scenes.at(-1);
    if (!tail || !Array.isArray(tail.edits) || Object.keys(tail).length!==1) return draft;
    // A complete edits wrapper can arrive as the last item of the Scene array.
    return {scenes:draft.scenes.slice(0,-1),edits:tail.edits,recoveredIncompleteEdits:false};
}

/**
 * When the outer response cannot be parsed, keep only original JSON objects
 * whose full text arrived in the expected arrays. The normal validators still
 * check every object against the plan or source before any write.
 */
export function recoverSlothCollectionDraft(raw) {
    const text=String(raw??'').replace(/<think>[\s\S]*?<\/think>/gi,'').trimStart()
        .replace(/^\x60{3,}(?:json)?\s*\r?\n/i,'');
    const prefix=text.match(/^\s*\{\s*"scenes"\s*:\s*\[/u);
    if (!prefix) return null;
    const scenes=readObjectArrayPrefix(text,prefix[0].length);
    const nexusPrefix=scenes.end!==null && text.slice(scenes.end).match(/^\s*,\s*"edits"\s*:\s*\[/u);
    const edits=nexusPrefix ? readObjectArrayPrefix(text,scenes.end+nexusPrefix[0].length) : {entries:[],end:null};
    if (!scenes.entries.length && !edits.entries.length) return null;
    return normalizeSlothCollectionDraft({
        scenes:scenes.entries,edits:edits.entries,recoveredIncompleteEdits:edits.end===null,
    });
}
