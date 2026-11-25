// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSlothNexusWindowEvidence,isAllowedContinuityRetirement} from './nexusEditEvidence.js';

const source=[
    {id:10,name:'A',mes:'I sent the letter to B and received a reply.',is_user:false},
    {id:14,name:'B',mes:'I told A about the secret in person.',is_user:false},
    {id:18,name:'A',mes:'My injured wrist still hurts today.',is_user:false},
];
test('explicit whole-line retirement classification does not require an AI quote',()=>{
    const op={kind:'continuity',action:'replace_exact',text:'',supersession:'observed_resolution'};
    assert.equal(isAllowedContinuityRetirement(op),true);
    assert.equal(isAllowedContinuityRetirement({...op,supersession:'mere_absence'}),false);
    assert.equal(isAllowedContinuityRetirement({...op,text:undefined}),false);
    assert.equal(isAllowedContinuityRetirement({...op,kind:'core'}),false);
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
test('duplicate or malformed source IDs still fail in legacy evidence extraction',()=>{
    const raw={evidence:[]};
    assert.throws(()=>validateSlothNexusWindowEvidence(raw,[...source,source[0]]),/repeated/);
    assert.throws(()=>validateSlothNexusWindowEvidence(raw,[]),/original chat/);
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
