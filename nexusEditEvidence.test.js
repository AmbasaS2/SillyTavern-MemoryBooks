// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSlothNexusWindowEvidence,validateGroundedNexusEdits} from './nexusEditEvidence.js';

const source=[
    {id:10,name:'A',mes:'I sent the letter to B and received a reply.',is_user:false},
    {id:14,name:'B',mes:'I told A about the secret in person.',is_user:false},
    {id:18,name:'A',mes:'My injured wrist still hurts today.',is_user:false},
];
const quote=(messageId,quote)=>[{messageId,quote}];
const change={
    kind:'continuity',action:'replace_exact',uid:2,find:'The letter is unanswered.',
    text:'A received B’s reply.',supersession:'observed_resolution',
    reason:'A explicitly confirmed receiving a response to the letter.',
    evidence:quote(10,'I sent the letter to B and received a reply.'),
};
test('exact source receipts allow scoped updates without changing user inputs',()=>{
    const original=structuredClone(change);
    const edits=validateGroundedNexusEdits([change],source);
    assert.deepEqual(edits,[change]);assert.deepEqual(change,original);
    assert.equal(edits[0].evidence[0].messageId,10);
});
test('the model cannot cite invented quotes, other chat IDs or uncertain fragments',()=>{
    for(const evidence of [
        quote(11,'I sent the letter to B and received a reply.'),
        quote(10,'The letter was delivered to B.'),
        quote(10,'letter'),
        [],
        [{messageId:'10',quote:'I sent the letter to B and received a reply.'}],
    ])assert.throws(()=>validateGroundedNexusEdits([{...change,evidence}],source),/evidence|quote|source/);
});
test('a transposed in-range ID can be recovered only from one exact original message',()=>{
    const literal='I sent the letter to B and received a reply.';
    const swapped={...change,evidence:quote(14,literal)};
    assert.deepEqual(validateGroundedNexusEdits([swapped],source)[0].evidence,quote(10,literal));
    assert.throws(()=>validateGroundedNexusEdits([swapped],[...source,{id:21,mes:literal}]),/missing from original/);
    assert.throws(()=>validateGroundedNexusEdits([{...swapped,evidence:quote(11,literal)}],source),/missing from original/);
    assert.throws(()=>validateSlothNexusWindowEvidence({evidence:[{...swapped.evidence[0],meaning:'Someone received a reply.'}]},source),/missing from original/);
});
test('current state replacement needs an explicit confirmed supersession and a reason',()=>{
    for(const supersession of [undefined,'mere_absence','assumed_resolution']){
        assert.throws(()=>validateGroundedNexusEdits([{...change,supersession}],source),/superseded/);
    }
    assert.throws(()=>validateGroundedNexusEdits([{...change,reason:'it changed'}],source),/specific reason/);
    // A completed or disproven current-state line can be retired only with
    // a directly cited source quote; its meaning still needs human review.
    const retirement={...change,text:''};
    assert.deepEqual(validateGroundedNexusEdits([retirement],source),[retirement]);
    for(const supersession of [undefined,'mere_absence','new_confirmed_information']){
        assert.throws(()=>validateGroundedNexusEdits([{...retirement,supersession}],source),
            /superseded|cannot erase/);
    }
    assert.throws(()=>validateGroundedNexusEdits([{...retirement,evidence:[]}],source),/source quotes/);
});
test('additions cite exact deferred messages, including unresolved current conditions',()=>{
    const op={kind:'continuity',action:'append_section',uid:2,section:'Active Conditions',
        text:'A is still injured.',reason:'A reports the injury is ongoing in their latest message.',
        evidence:quote(18,'My injured wrist still hurts today.')};
    assert.deepEqual(validateGroundedNexusEdits([op],source),[op]);
    assert.deepEqual(validateGroundedNexusEdits([],source),[]);
});
test('window evidence summaries cannot forge source text',()=>{
    const input={evidence:[{messageId:14,
        quote:'I told A about the secret in person.',
        meaning:'B explicitly informed A; the prior secrecy is now resolved.'}]};
    assert.deepEqual(validateSlothNexusWindowEvidence(input,source),input.evidence);
    assert.throws(()=>validateSlothNexusWindowEvidence({
        evidence:[{...input.evidence[0],quote:'A independently guessed the secret.'}]},source),/quote/);
    assert.throws(()=>validateSlothNexusWindowEvidence({
        evidence:[{...input.evidence[0],meaning:''}]},source),/meaning/);
});
test('added terminal punctuation is removed only when the exact remaining quote exists',()=>{
    const messages=[{id:9,mes:'She left the unopened letter on the table, then returned.'}];
    const raw={evidence:[{messageId:9,quote:'She left the unopened letter on the table.',meaning:'The letter remained unopened.'}]};
    assert.deepEqual(validateSlothNexusWindowEvidence(raw,messages),[
        {...raw.evidence[0],quote:'She left the unopened letter on the table'},
    ]);
    assert.throws(()=>validateSlothNexusWindowEvidence({
        evidence:[{...raw.evidence[0],quote:'She left the opened letter on the table.'}],
    },messages),/missing from original/);
});

test('quote presentation can be recovered only as a unique literal source span',()=>{
    const meaning='The question was said in this scene.';
    const original='그는 말했다. “그 열쇠를\r\n돌려줄래?” 그녀가 고개를 끄덕였다.';
    const raw={evidence:[{messageId:11,quote:'"그 열쇠를 돌려줄래?"',meaning}]};
    const validate=mes=>validateSlothNexusWindowEvidence(raw,[{id:11,mes}]);
    assert.equal(validate(original)[0].quote,'“그 열쇠를\r\n돌려줄래?”');
    assert.throws(()=>validate(original+' '+original),/missing from original/);
    assert.throws(()=>validate(original.replace('돌려줄래','버려줄래')),/missing from original/);
});
test('duplicate or malformed input IDs fail before any edits',()=>{
    assert.throws(()=>validateGroundedNexusEdits([change],[...source,source[0]]),/repeated/);
    assert.throws(()=>validateGroundedNexusEdits([change],[]),/original chat/);
    assert.throws(()=>validateGroundedNexusEdits([null],source),/invalid/);
});
import { validateSlothEventWindowEvidence } from './nexusEditEvidence.js';
test('event windows retain exact citations without claiming messages between disjoint sources', () => {
    const source = [{ id: 3, mes: 'The bell finally rang after the repair.' }, { id: 5, mes: 'Jun called it our rusty soprano.' }];
    const event = { topic: 'Bell', cause: 'Broken bolt', development: 'Fixed the bolt', result: 'The bell rang', closure: 'complete',
        sourceRanges: [[3, 3], [5, 5]], evidence: [{ messageId: 5, quote: 'our rusty soprano' }] };
    assert.deepEqual(validateSlothEventWindowEvidence({ events: [event] }, source), [event]);
    assert.throws(() => validateSlothEventWindowEvidence({ events: [{ ...event, sourceRanges: [[3, 5]] }] }, source), /range|window/);
    assert.deepEqual(validateSlothEventWindowEvidence({ events: [{ ...event, sourceRanges: [[3, 3]] }] }, source), [event]);
    assert.throws(() => validateSlothEventWindowEvidence({ events: [{ ...event,
        evidence: [{messageId:5,quote:'our invented soprano'}] }] }, source), /missing from original/);
});
