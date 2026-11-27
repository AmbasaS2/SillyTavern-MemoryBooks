// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
// Single-request collection only: preserve complete original rows; never invent
// source IDs, missing narrative, or completed outcomes to satisfy a validator.

const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value.trim() : '';
const int = value => (typeof value === 'number' || (typeof value === 'string' && /^\d+$/u.test(value.trim()))) &&
    Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;

export function collectionRanges(ids) {
    const ranges=[];
    for (const id of [...new Set(ids)].sort((a,b)=>a-b)) {
        const last=ranges.at(-1);
        if (last && id===last[1]+1) last[1]=id;
        else ranges.push([id,id]);
    }
    return ranges;
}

// Do not repair characters inside a narrative string. A missing closing
// string/object is NOT manufactured; recover only wholly received JSON rows.
function stripTrailingCommas(input) {
    let result='',quoted=false,escaped=false;
    for (let i=0;i<input.length;i++) {
        const c=input[i];
        if (quoted) {
            result+=c;
            if (escaped) escaped=false;
            else if (c==='\\') escaped=true;
            else if (c==='"') quoted=false;
        } else if (c==='"') { quoted=true; result+=c; }
        else if (c!==',' || !/^\s*[\]}]/u.test(input.slice(i+1))) result+=c;
    }
    return result;
}
function objectEnd(input,start) {
    const stack=[];
    let quoted=false,escaped=false;
    for (let i=start;i<input.length;i++) {
        const c=input[i];
        if (quoted) {
            if (escaped) escaped=false;
            else if (c==='\\') escaped=true;
            else if (c==='"') quoted=false;
            continue;
        }
        if (c==='"') quoted=true;
        else if (c==='{' || c==='[') stack.push(c);
        else if (c==='}' || c===']') {
            if (stack.pop()!==(c==='}'?'{':'[')) return -1;
            if (!stack.length) return i+1;
        }
    }
    return -1;
}
function readRows(input,start) {
    const rows=[];
    let i=start;
    for (;;) {
        while (/\s/u.test(input[i]??'')) i++;
        if (input[i]===']') return {rows,end:i+1};
        if (input[i]!=='{') return {rows,end:-1};
        const end=objectEnd(input,i);
        if (end<0) return {rows,end:-1};
        try { rows.push(JSON.parse(stripTrailingCommas(input.slice(i,end)))); }
        catch { return {rows,end:-1}; }
        i=end;
        while (/\s/u.test(input[i]??'')) i++;
        if (input[i]===']') return {rows,end:i+1};
        if (input[i]!==',') return {rows,end:-1};
        i++;
    }
}
export function parseSingleSlothCollectionDraft(raw,phase='Single collection') {
    const input=String(raw??'').replace(/<think>[\s\S]*?<\/think>/gi,'').trim();
    // The first recognized top-level object, including fenced/prose wrappers.
    const match=/\{\s*"(?:events|deferred|edits)"\s*:/u.exec(input);
    const start=match?.index??input.indexOf('{');
    if (start>=0) {
        const end=objectEnd(input,start);
        if (end>start) {
            try {
                const parsed=JSON.parse(stripTrailingCommas(input.slice(start,end)));
                if (record(parsed) && (Array.isArray(parsed.events)||Array.isArray(parsed.edits))) return parsed;
            } catch { /* keep complete original rows below */ }
        }
        const recovered={events:[],deferred:[],edits:[]};
        const seen=new Set(),closed=new Set();
        let i=start+1;
        for (;;) {
            while (/\s/u.test(input[i]??'')) i++;
            const key=/^"(events|deferred|edits)"\s*:\s*\[/u.exec(input.slice(i));
            if (!key || seen.has(key[1])) break;
            const name=key[1];seen.add(name);
            const part=readRows(input,i+key[0].length);
            recovered[name]=part.rows;
            if (part.end<0) break;
            closed.add(name);
            i=part.end;
            while (/\s/u.test(input[i]??'')) i++;
            if (input[i]!==',') break;
            i++;
        }
        if (recovered.events.length||recovered.deferred.length||recovered.edits.length) {
            // An unreceived event or deferred tail might own any of the input.
            // Save usable prose but do not consume/hide uncertain source IDs.
            recovered.recoveryUncertain=!closed.has('events') || (seen.has('deferred')&&!closed.has('deferred')) ||
                (!closed.has('deferred')&&!seen.has('edits'));
            recovered.recoveredIncompleteEdits=!closed.has('edits');
            return recovered;
        }
    }
    throw Object.assign(new Error(phase+': no complete collection rows could be recovered. The response is available for review.'),{
        code:'STMB_SLOTH_MALFORMED_JSON',rawResponse:String(raw??''),
    });
}

function readRange(value) {
    if (typeof value==='string') {
        const match=/^\s*#?(\d+)(?:\s*[-–—:]\s*#?(\d+))?\s*$/u.exec(value);
        if (match) return [int(match[1]),int(match[2]??match[1])];
    }
    if (Array.isArray(value)&&value.length===2) return value.map(int);
    if (record(value)) return [int(value.start),int(value.end)];
    const id=int(value);
    return id===null?null:[id,id];
}
function sourceFor(row,sourceIds) {
    const allowed=new Set(sourceIds),known=new Set();
    let invalid=false,unknown=false;
    const explicit=row?.messageIds;
    if (Array.isArray(explicit)&&row?.segments===undefined&&row?.ranges===undefined) {
        for (const item of explicit) {
            const id=int(item);
            if (id===null) { invalid=true;unknown=true; }
            else if (!allowed.has(id)) invalid=true;
            else known.add(id);
        }
    } else {
        const raw=row?.segments??row?.ranges??(row?.start!==undefined&&row?.end!==undefined?{start:row.start,end:row.end}:null);
        const pairs=Array.isArray(raw) && !(raw.length===2&&raw.every(v=>int(v)!==null))?raw:[raw];
        for (const value of pairs) {
            const pair=readRange(value);
            if (!pair||pair[0]===null||pair[1]===null||pair[0]>pair[1]) { invalid=true;unknown=true;continue; }
            const [a,b]=pair;
            if (a<sourceIds[0]||b>sourceIds.at(-1)) invalid=true;
            // Actual input IDs only: gaps from earlier saved memories are not
            // fictitious new messages, even for a single broad range.
            const ids=sourceIds.filter(id=>id>=a&&id<=b);
            if (!ids.length) invalid=true;
            for (const id of ids) known.add(id);
        }
    }
    const ids=[...known].sort((a,b)=>a-b);
    return {ids,invalid:invalid||!ids.length,unknown:unknown||!ids.length};
}
export function normalizeSingleSlothPlan(raw,sourceIds,{originalMessages=[]}={}) {
    if (!record(raw)||!Array.isArray(sourceIds)||!sourceIds.length||
        sourceIds.some((id,i)=>!Number.isSafeInteger(id)||id<0||(i&&id<=sourceIds[i-1]))) {
        throw new Error('Invalid original collection source.');
    }
    const originals=new Map(originalMessages.map(m=>[m.id,m.mes]));
    const events=[],deferred=[];
    let uncertain=raw.recoveryUncertain===true || !Array.isArray(raw.events) ||
        (Object.hasOwn(raw,'deferred')&&!Array.isArray(raw.deferred));
    let invalidScenes=0;
    const postpone=(row,range,reason)=>{
        uncertain ||= range.unknown;
        if (range.ids.length) deferred.push({title:text(row?.title),reason,segments:collectionRanges(range.ids),messageIds:range.ids});
    };
    for (const [i,row] of (Array.isArray(raw.events)?raw.events:[]).entries()) {
        const range=sourceFor(row,sourceIds);
        const complete=row?.complete===true||row?.complete==='true';
        const result=text(row?.result);
        if (!complete||range.invalid||!result) {
            if (complete) invalidScenes++;
            postpone(row,range,text(row?.reason)||'Unfinished or unverified incident.');
            continue;
        }
        const title=(text(row.title)||result).slice(0,180);
        const closure=row.closure,id=int(closure?.messageId),quote=text(closure?.quote);
        const verified=range.ids.includes(id)&&quote&&typeof originals.get(id)==='string'&&originals.get(id).includes(quote);
        events.push({id:'event-'+(i+1),title,reason:text(row.reason),result,segments:collectionRanges(range.ids),
            messageIds:range.ids,start:range.ids[0],end:range.ids.at(-1),
            ...(verified?{closure:{messageId:id,quote}}:{}),
            ...(row.closingExchange===true?{closingExchange:true}:{})});
    }
    for (const row of Array.isArray(raw.deferred)?raw.deferred:[]) {
        const range=sourceFor(row,sourceIds);
        // Even a malformed range may contain real pending IDs; retain them.
        postpone(row,range,text(row?.reason)||'Unfinished or unclassified incident.');
    }
    const assigned=new Set([...events,...deferred].flatMap(event=>event.messageIds));
    const missing=sourceIds.filter(id=>!assigned.has(id));
    if (missing.length) deferred.push({reason:'Unclassified source.',unclassified:true,segments:collectionRanges(missing),messageIds:missing});
    events.sort((a,b)=>a.end-b.end);
    return {events,deferred,sourceIds:[...sourceIds],start:sourceIds[0],end:sourceIds.at(-1),
        fullyCollected:!uncertain&&!deferred.length,uncertain,invalidScenes};
}

// Reference ranges describe the evidence a Scene actually read. Collected
// ranges are the subset safe to remove from future collection and Hide.
// Any deferred or failed row wins ONLY for collection progress, not for prose.
export function finalizeSingleSlothScenes(plan,drafts) {
    const pending=new Set(plan.deferred.flatMap(event=>event.messageIds));
    const skipped=plan.events.filter(event=>!drafts.has(event.id));
    for (const event of skipped) for (const id of event.messageIds) pending.add(id);
    if (plan.uncertain) for (const id of plan.sourceIds) pending.add(id);
    const scenes=[],seen=new Set();
    for (const event of plan.events) {
        const draft=drafts.get(event.id);
        if (!draft) continue;
        const key=JSON.stringify([event.title,event.segments,draft.content]);
        if (seen.has(key)) continue;
        seen.add(key);
        scenes.push({...draft,collectedRanges:collectionRanges(event.messageIds.filter(id=>!pending.has(id)))});
    }
    return {scenes,skippedScenes:plan.invalidScenes+skipped.length,pendingRanges:collectionRanges([...pending])};
}
