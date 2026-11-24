// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only

const SLOTH_COLLECTION_CHUNK_TOKENS = 62000;

function estimateSlothInputTokens(text) {
    let ascii=0, other=0;
    for (const char of text) {
        if (char.codePointAt(0)<128) ascii++;
        else other++;
    }
    return Math.ceil(ascii/3 + other*2);
}

/** Split the raw chat into similarly sized groups without breaking a message. */
export async function splitSlothCollectionSource(messages, countTokens) {
    if (!messages.length) return [];
    const source = messages.map(message=>message.mes).join('\n');
    let totalTokens;
    try { totalTokens=await countTokens(source); } catch { /* Use the local estimate below. */ }

    const weights=[0];
    for (const message of messages) {
        weights.push(weights.at(-1)+Math.max(1,estimateSlothInputTokens(message.mes)));
    }
    const totalWeight=weights.at(-1);
    if (!Number.isFinite(totalTokens) || totalTokens<=0) totalTokens=totalWeight;
    const count=Math.min(messages.length, Math.ceil(totalTokens/SLOTH_COLLECTION_CHUNK_TOKENS));
    if (count===1) return [messages];

    const groups=[];
    let start=0;
    for (let part=1;part<count;part++) {
        const target=totalWeight*part/count;
        const latest=messages.length-(count-part);
        let end=start+1;
        while (end<latest && Math.abs(weights[end+1]-target)<Math.abs(weights[end]-target)) end++;
        groups.push(messages.slice(start,end));
        start=end;
    }
    groups.push(messages.slice(start));
    return groups;
}
