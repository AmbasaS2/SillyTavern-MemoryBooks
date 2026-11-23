// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNexusSceneMergeCatalog, validateNexusSceneMergeCandidates } from './nexusSceneMergeProposals.js';

const scene = (uid,n,range,chatId='chat-A') => ({
    uid, comment: String(n).padStart(3,'0') + ' - Scene ' + n,
    content: '**Timeline**\nDay ' + n + '\n\n**Scene**\nEvent ' + n +
        ' with a cause and consequence.\n\n**Result**\nThis event ended.',
    disable:false,constant:true,vectorized:false,key:['entry-'+uid],STMB_chatId:chatId,
    STMB_sourceRanges:[range],position:0,
});
const book = () => ({entries:{
    1:scene(1,1,[0,4]),
    2:scene(2,2,[5,9]),
    3:scene(3,3,[10,14]),
    4:scene(4,4,[0,4],'another-AU'),
}});
const answer = {candidates:[{
    uids:[3,1],reason:'The initial conflict in Scene 1 is conclusively resolved in Scene 3.',
    evidence:['Scene 1 describes the original cause','Scene 3 describes the actual ending'],
}]};
test('catalog reads only current-chat completed Scenes without modifying original',()=>{
    const original=book(),snapshot=structuredClone(original);
    const c=buildNexusSceneMergeCatalog(original,['chat-A']);
    assert.deepEqual(c.map(e=>e.uid),[1,2,3]);
    assert.equal(c[0].content,original.entries[1].content);
    assert.deepEqual(original,snapshot);
});
test('AI candidates remain proposals, with noncontiguous source and intervening Scene preserved',()=>{
    const original=book(),c=buildNexusSceneMergeCatalog(original,['chat-A']);
    const accepted=validateNexusSceneMergeCandidates(original,c,answer);
    assert.deepEqual(accepted[0].sourceUids,[1,3]);
    assert.deepEqual(accepted[0].plan.sourceRanges,[[0,4],[10,14]]);
    assert.ok(accepted[0].plan.independentUids.includes(2));
    assert.ok(accepted[0].plan.independentUids.includes(4));
});
test('foreign AU, invented UID, duplicate pair, no causal evidence fail closed',()=>{
    const original=book(),c=buildNexusSceneMergeCatalog(original,['chat-A']);
    for(const candidates of [
        [{...answer.candidates[0],uids:[1,4]}],
        [{...answer.candidates[0],uids:[1,999]}],
        [answer.candidates[0],{...answer.candidates[0],uids:[1,3]}],
        [{...answer.candidates[0],evidence:[]}],
        [{...answer.candidates[0],reason:'unsupported'}],
    ]) assert.throws(()=>validateNexusSceneMergeCandidates(original,c,{candidates}));
    assert.deepEqual(validateNexusSceneMergeCandidates(original,c,{candidates:[]}),[]);
});
test('missing chat identity, malformed original, oversized payload and invalid archive block scan',()=>{
    assert.throws(()=>buildNexusSceneMergeCatalog(book(),[]),/stable source/);
    const missing=book();missing.entries[2].content='unfinished';
    assert.throws(()=>buildNexusSceneMergeCatalog(missing,['chat-A']),/incomplete/);
    const oversized=book();oversized.entries[1].content+='x'.repeat(61000);
    assert.throws(()=>buildNexusSceneMergeCatalog(oversized,['chat-A']),/too large/);
    const corrupt=book();corrupt.entries[1].STMB_slothSceneMergedInto={version:1,targetUid:3};
    assert.throws(()=>buildNexusSceneMergeCatalog(corrupt,['chat-A']),/archive/);
});
test('unsupported source references refuse candidate validation rather than selecting a different pair',()=>{
    const original=book(),c=buildNexusSceneMergeCatalog(original,['chat-A']);
    original.entries[2].STMB_canonicalEntryUid=1;
    assert.throws(()=>validateNexusSceneMergeCandidates(original,c,answer),/references/);
});
