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
    let i=start,invalid=0;
    for (;;) {
        while (/\s/u.test(input[i]??'')) i++;
        if (input[i]===']') return {rows,end:i+1,invalid};
        if (input[i]!=='{') return {rows,end:-1,invalid};
        const end=objectEnd(input,i);
        if (end<0) return {rows,end:-1,invalid};
        try { rows.push(JSON.parse(stripTrailingCommas(input.slice(i,end)))); }
        catch { invalid++; }
        i=end;
        while (/\s/u.test(input[i]??'')) i++;
        if (input[i]===']') return {rows,end:i+1,invalid};
        if (input[i]!==',') return {rows,end:-1,invalid};
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
        const seen=new Set(),closed=new Set(),invalid=new Set();
        let i=start+1;
        for (;;) {
            while (/\s/u.test(input[i]??'')) i++;
            const key=/^"(events|deferred|edits)"\s*:\s*\[/u.exec(input.slice(i));
            if (!key || seen.has(key[1])) break;
            const name=key[1];seen.add(name);
            const part=readRows(input,i+key[0].length);
            recovered[name]=part.rows;
            if (part.invalid) invalid.add(name);
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
                (!closed.has('deferred')&&!seen.has('edits')) || invalid.has('events') || invalid.has('deferred');
            recovered.recoveredIncompleteEdits=!closed.has('edits')||invalid.has('edits');
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
    if (Array.isArray(value)&&value.length===1&&int(value[0])!==null) return [int(value[0]),int(value[0])];
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
        for (const item of explicit.flat(Infinity)) {
            const id=int(item);
            if (id===null) { invalid=true;unknown=true; }
            else if (!allowed.has(id)) invalid=true;
            else known.add(id);
        }
    } else {
        const raw=row?.segments??row?.ranges??(row?.start!==undefined&&row?.end!==undefined?{start:row.start,end:row.end}:null);
        const pairs=typeof raw==='string'&&raw.includes(',') ? raw.split(',') :
            Array.isArray(raw) && !(raw.length===2&&raw.every(v=>int(v)!==null))?raw:[raw];
        const visit=value=>{
            const pair=readRange(value);
            // Explicit nested lists longer than a pair contain individual IDs,
            // not an invented inclusive range from their first to last ID.
            if (Array.isArray(value)&&(!pair||pair.includes(null))&&value.length) {
                if(value.length===2&&!value.some(Array.isArray)&&!value.some(record)&&
                    !value.some(v=>typeof v==='string'&&/[-–—:]/u.test(v))) {
                    invalid=true;unknown=true;
                }
                for(const part of value) visit(part);
                return;
            }
            if (!pair||pair[0]===null||pair[1]===null||pair[0]>pair[1]) { invalid=true;unknown=true;return; }
            const [a,b]=pair;
            if (a<sourceIds[0]||b>sourceIds.at(-1)) invalid=true;
            // Actual input IDs only: gaps from earlier saved memories are not
            // fictitious new messages, even for a single broad range.
            const ids=sourceIds.filter(id=>id>=a&&id<=b);
            if (!ids.length) invalid=true;
            for (const id of ids) known.add(id);
        };
        for(const value of pairs) visit(value);
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
    const issues=[];
    const postpone=(row,range,reason,explicitOpen=false)=>{
        uncertain ||= range.unknown;
        if (range.ids.length) deferred.push({title:text(row?.title),reason,explicitOpen,
            segments:collectionRanges(range.ids),messageIds:range.ids});
    };
    for (const [i,row] of (Array.isArray(raw.events)?raw.events:[]).entries()) {
        const range=sourceFor(row,sourceIds);
        const complete=row?.complete===true||text(row?.complete).toLowerCase()==='true';
        const explicitlyOpen=row?.complete===false||text(row?.complete).toLowerCase()==='false';
        const result=text(row?.result);
        if (!complete||range.invalid||!result) {
            if (complete) invalidScenes++;
            postpone(row,range,text(row?.reason)||'Unfinished or unverified incident.',explicitlyOpen);
            continue;
        }
        const title=(text(row.title)||result).slice(0,180);
        const closure=row.closure,quote=text(closure?.quote);
        let id=int(closure?.messageId);
        const matches=quote?range.ids.filter(sourceId=>typeof originals.get(sourceId)==='string'&&
            originals.get(sourceId).includes(quote)):[];
        // Correct only a uniquely identifiable verbatim quote within the event.
        if(!matches.includes(id)&&matches.length===1&&
            (quote.length>=8||quote===originals.get(matches[0]).trim())) id=matches[0];
        const verified=matches.includes(id);
        // A supplied but contradictory closure is a local evidence failure,
        // not a reason to discard other scenes or consume this source range.
        // Old drafts with no closure remain compatible; the prompt encourages
        // exact closures but a missing field alone does not erase paid prose.
        if(closure!=null&&originals.size&&!verified){
            const reason='Closure quote does not match an original message inside this Scene range.';
            issues.push({row:i+1,reason,segments:collectionRanges(range.ids)});
            invalidScenes++;
            postpone(row,range,reason);
            continue;
        }
        events.push({id:'event-'+(i+1),title,reason:text(row.reason),result,segments:collectionRanges(range.ids),
            messageIds:range.ids,start:range.ids[0],end:range.ids.at(-1),
            ...(verified?{closure:{messageId:id,quote}}:{}),
            ...(row.closingExchange===true?{closingExchange:true}:{})});
    }
    for (const row of Array.isArray(raw.deferred)?raw.deferred:[]) {
        const range=sourceFor(row,sourceIds);
        // Even a malformed range may contain real pending IDs; retain them.
        postpone(row,range,text(row?.reason)||'Unfinished or unclassified incident.',true);
    }
    // A duplicate classification of the SAME incident as both finished and
    // open is not a completed memory. Do not infer closure from its prose.
    // Distinct scenes may legitimately share only a boundary message.
    const completed=events.filter(event=>{
        const conflicting=deferred.some(open=>open.explicitOpen&&(
            JSON.stringify(open.messageIds)===JSON.stringify(event.messageIds) ||
            (open.title&&open.title.toLowerCase()===event.title.toLowerCase()&&
                event.messageIds.some(id=>open.messageIds.includes(id)))));
        if (!conflicting) return true;
        invalidScenes++;
        deferred.push({...event,reason:'Conflicting completed and unfinished classification.'});
        return false;
    });
    const assigned=new Set([...completed,...deferred].flatMap(event=>event.messageIds));
    const missing=sourceIds.filter(id=>!assigned.has(id));
    if (missing.length) deferred.push({reason:'Unclassified source.',unclassified:true,segments:collectionRanges(missing),messageIds:missing});
    completed.sort((a,b)=>a.end-b.end);
    return {events:completed,deferred,sourceIds:[...sourceIds],start:sourceIds[0],end:sourceIds.at(-1),
        fullyCollected:!uncertain&&!deferred.length,uncertain,invalidScenes,issues};
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

// Draft reuse is deliberately bound to the original chat, source, and both
// lorebook snapshots. Never apply a paid draft to a different branch or book.
export function sameSlothDraftBinding(record,binding) {
    return record?.version===1 && typeof record.raw==='string' &&
        JSON.stringify(record.binding)===JSON.stringify(binding);
}


// The recovery editor contains only unapplied rows. Previously saved Scenes
// are retained as immutable inputs for range accounting, not regenerated.
export function joinSlothRecoveryScenes(raw,lockedScenes=[]) {
    if (!lockedScenes.length) return raw;
    const rows=lockedScenes.map(scene=>({title:scene.title,complete:true,reason:scene.reason,
        result:scene.result,segments:scene.segments,closure:scene.closure}));
    return {...raw,events:[...rows,...(Array.isArray(raw.events)?raw.events:[])],
        recoveryUncertain:raw.recoveryUncertain===true||!Array.isArray(raw.events)};
}

export function buildSlothPendingDraft(raw,scenes,lockedCount,pendingEdits,issues=[]) {
    const saved=new Set(scenes.map(scene=>Number(scene.id.slice(6))-1));
    return {
        events:(Array.isArray(raw.events)?raw.events:[]).filter((_,i)=>!saved.has(i+lockedCount)),
        deferred:raw.deferred??[],
        edits:pendingEdits??[],
        ...(issues.length?{recoveryIssues:issues.map(({row,reason,segments})=>({row,reason,segments}))}:{}),
        ...(raw.recoveryUncertain===true?{recoveryUncertain:true}:{}),
        ...(raw.recoveredIncompleteEdits===true?{recoveredIncompleteEdits:true}:{}),
    };
}

// This receipt is produced only after verified World Info commits. It is
// distinct from an uncommitted draft and cannot authorize a different chat,
// edited original source, or independently modified lorebooks.
export function canReplaySlothPartial(record,{chatKey,roles,books,fingerprint}={}) {
    const saved=record?.partial;
    const original=record?.binding;
    const ids=saved?.sourceIds,chunk=saved?.chunkIds;
    return record?.version===1&&saved?.version===1&&typeof record.raw==='string'&&
        original?.chatKey===chatKey&&original.roles?.nexus===roles?.nexus&&original.roles?.memory===roles?.memory&&
        Array.isArray(ids)&&ids.length>0&&ids.every((id,i)=>Number.isSafeInteger(id)&&id>=0&&(!i||id>ids[i-1]))&&
        Array.isArray(chunk)&&chunk.length>0&&chunk.every((id,i)=>ids.includes(id)&&(!i||id>chunk[i-1]))&&
        Array.isArray(saved.lockedScenes)&&Array.isArray(saved.committedEdits)&&
        JSON.stringify(saved.books)===JSON.stringify(books)&&
        JSON.stringify(original.fingerprint)===JSON.stringify(fingerprint);
}

export function slothEditSignature(edit) {
    return JSON.stringify(['kind','action','uid','find','text','section','title','content','supersession','keywords']
        .map(key=>key==='uid'&&edit?.[key]!=null?String(edit[key]):edit?.[key]??null));
}
