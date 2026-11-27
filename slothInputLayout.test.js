// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {describeNexusCollectionEntry} from './nexusCollectionPolicy.js';
const src=readFileSync(new URL('./nexusCollectionAI.js',import.meta.url),'utf8');
const segment=(a,b)=>src.slice(src.indexOf(a),src.indexOf(b,src.indexOf(a)));
test('first collection sends character context once; old two-step callers retain their own card reference',()=>{
    const guidance=vm.runInNewContext(segment('function slothNexusGuidance(','function readSlothNexusEdits(')+'\nslothNexusGuidance',{
        DEFAULT_SLOTH_COLLECTION_PROMPTS:{nexus:'Nexus rules'},describeNexusCollectionEntry});
    const context='Unique card text.';
    const args={nexus:{entries:{}},settings:{},initial:true,characterContext:context};
    assert.ok(guidance(args).includes(context));
    assert.ok(!guidance({...args,characterContextIncluded:true}).includes(context));
    const compose=segment('export async function composeSingleSlothCollection(','export async function retryApprovedSlothScenes(');
    assert.match(compose,/characterContextIncluded:true/);
    assert.doesNotMatch(compose,/'Original source IDs: '/);
    assert.match(compose,/Original source messages \(use each record’s id as its original message number\):/);
    const compact=vm.runInNewContext(segment('const originalMessages=','const SCENE_KEYWORD_GUIDANCE')+'\ncompact');
    const messages=[{id:0,name:'A',mes:'A line\nwith "quotes".',is_user:true,send_date:'date'},
        {id:7,name:'B',mes:'다음 문장',is_user:false,send_date:null}];
    assert.deepEqual(JSON.parse(compact(messages)),messages);
});
