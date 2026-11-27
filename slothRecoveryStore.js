// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
// Paid response recovery uses the host's per-user file API, not chat saves.
// The host atomically replaces each uploaded file. The revision checks below
// are optimistic checks, NOT an atomic compare-and-swap across devices.

const FORMAT='stmb-sloth-recovery';
export function isSlothRecoveryRecord(record,chatKey) {
    return record?.version===1&&record.binding?.chatKey===chatKey&&
        typeof record.raw==='string'&&Number.isFinite(record.receivedAt);
}
export function slothRecoveryFileName(chatKey,hash) {
    if(typeof chatKey!=='string'||!chatKey.trim())throw new Error('Missing Sloth recovery chat identity.');
    const digest=hash(chatKey);
    if(typeof digest!=='string'||!/^[a-f0-9]{64}$/u.test(digest))throw new Error('Invalid Sloth recovery file identity.');
    return 'stmb-sloth-recovery-'+digest+'.json';
}

export function encodeSlothRecoveryFile(text) {
    const bytes=new TextEncoder().encode(text);
    let binary='';
    for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
    return btoa(binary);
}

function conflict() {
    return Object.assign(new Error('The Sloth recovery file changed in another session.'),{code:'STMB_SLOTH_RECOVERY_CONFLICT'});
}

export function createSlothRecoveryStore({request,headers,hash,encode=encodeSlothRecoveryFile}) {
    const file=chatKey=>slothRecoveryFileName(chatKey,hash);
    const serialize=(chatKey,record)=>JSON.stringify({format:FORMAT,version:1,chatKey,record});
    const revisionFor=(chatKey,record)=>hash(serialize(chatKey,record));
    async function read(chatKey) {
        const response=await request('/user/files/'+file(chatKey),{method:'GET',cache:'no-store',credentials:'same-origin'});
        if(response.status===404)return {chatKey,revision:null,record:null};
        if(!response.ok)throw new Error('Sloth recovery file read failed: '+response.status);
        const raw=await response.text();
        let envelope;
        try{envelope=JSON.parse(raw);}catch{throw new Error('Sloth recovery file is not valid JSON.');}
        if(envelope?.format!==FORMAT||envelope.version!==1||envelope.chatKey!==chatKey||
            !Object.hasOwn(envelope,'record')||(envelope.record!==null&&!isSlothRecoveryRecord(envelope.record,chatKey)))
            throw new Error('Sloth recovery file has an unknown format or a different chat identity.');
        return {chatKey,revision:hash(raw),record:envelope.record};
    }
    async function replace(chatKey,record,expectedRevision) {
        if(record!==null&&!isSlothRecoveryRecord(record,chatKey))throw new Error('Invalid Sloth recovery record.');
        if(expectedRevision!==null&&!(typeof expectedRevision==='string'&&/^[a-f0-9]{64}$/u.test(expectedRevision)))
            throw new Error('A verified Sloth recovery baseline is required.');
        const raw=serialize(chatKey,record);
        const revision=hash(raw);
        const current=await read(chatKey);
        if(current.revision===revision)return current; // verified idempotent retry
        if(current.revision!==expectedRevision)throw conflict();
        const response=await request('/api/files/upload',{
            method:'POST',cache:'no-store',credentials:'same-origin',headers:headers(),
            body:JSON.stringify({name:file(chatKey),data:encode(raw)}),
        });
        if(!response.ok)throw new Error('Sloth recovery file upload failed: '+response.status);
        const saved=await read(chatKey);
        if(saved.revision!==revision)throw conflict();
        return saved;
    }
    return {read,replace,revisionFor};
}

// A present file (including a cleared tombstone) takes precedence over a
// legacy draft left in chat metadata. Never rewrite the chat to migrate it.
export function selectSlothRecoveryRecord(chatKey,snapshot,legacy,fallback) {
    if(isSlothRecoveryRecord(fallback?.record,chatKey))return fallback.record;
    if(snapshot?.revision!==undefined&&snapshot.revision!==null)return snapshot.record;
    return isSlothRecoveryRecord(legacy,chatKey)?legacy:null;
}
