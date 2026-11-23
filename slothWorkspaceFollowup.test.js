// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getSlothHideRanges, normalizeSlothVisibleTail } from './nexusCollectionPolicy.js';
import { getCompressibleScene, getSlothCompressionInstructions, stageSlothSceneCompression } from './nexusSceneCompression.js';
import { getActiveSlothSummaryPreset } from './slothSummaryPrompts.js';

const source=file=>readFileSync(new URL(file,import.meta.url),'utf8');

test('approved Hide excludes visible recent turns, deferred turns and previously hidden messages',()=>{
    const chat = Array.from({length:11},(_,id)=>({mes:`Turn ${id}`,is_system:id===2||id===9}));
    chat[5].mes='';
    const events=[{messageIds:[0,1,2,4,5,6,7,8,9,10]}];
    assert.deepEqual(getSlothHideRanges(events,chat,2),[[0,1],[4,4],[6,7]]);
    assert.deepEqual(getSlothHideRanges(events,chat,0),[[0,1],[4,4],[6,8],[10,10]]);
    assert.deepEqual(getSlothHideRanges(events,chat,20),[]);
    assert.equal(normalizeSlothVisibleTail(''),6);
});

test('summary presets keep the built-in summary and preserve old instructions only as a summary preset',()=>{
    const builtin=getActiveSlothSummaryPreset();
    assert.equal(builtin.id,'builtin');
    assert.ok(builtin.text.includes('What to preserve'));
    assert.doesNotMatch(builtin.text,/event planner|Update Nexus|Output contract|STRICT JSON/);
    const settings={moduleSettings:{slothCollectionPrompt:'Keep concise humor.'}};
    const old=getActiveSlothSummaryPreset(settings);
    assert.equal(old.id,'previous');
    assert.match(old.text,/Keep concise humor\.$/);
    settings.moduleSettings.slothSummaryPresets=[{id:'a',name:'Direct',text:'Write short prose.'}];
    settings.moduleSettings.slothSummaryPresetId='a';
    assert.equal(getActiveSlothSummaryPreset(settings).text,'Write short prose.');
    const ai=source('./nexusCollectionAI.js');
    assert.equal(ai.match(/getActiveSlothSummaryPreset\(settings\)/g)?.length,1);
    assert.match(ai,/async function composeSlothScene[\s\S]+?getActiveSlothSummaryPreset\(settings\)/);
});

test('compression changes only text within Scene, keeps the original once and varies length and focus',()=>{
    const scene=('Mira told Avi alone where she had stored the letter. The lantern was kept in the alcove.\n\n' +
        'The note was read aloud. Mira asked that nobody assume the sealing wax had been sent.').trim();
    const entry={uid:14,comment:'017 - Letter',constant:true,key:['wax'],STMB_sourceRanges:[[1,3]],
        content:`**Timeline**: Unknown\n\n**Scene**\n${scene}\n\n**Result**\nAvi received the letter.`};
    const parts=getCompressibleScene(entry);
    assert.equal(parts.scene,scene);
    const long=getSlothCompressionInstructions(scene,75,['voice']);
    const short=getSlothCompressionInstructions(scene,55,['relationships']);
    assert.ok(long.target>short.target);
    assert.match(long.instructions,/humor/);
    assert.match(short.instructions,/emotions|emotional/);
    const draft='Mira told Avi privately where the letter was stored. The note was read aloud. No wax delivery was confirmed.';
    const next=stageSlothSceneCompression(entry,{scene:draft},short.target);
    assert.equal(next.content,entry.content.replace(scene,draft));
    assert.deepEqual({...next,content:entry.content,STMB_slothCompression:undefined},{...entry,STMB_slothCompression:undefined});
    assert.equal(next.STMB_slothCompression.originalContent,entry.content);
    assert.equal(getCompressibleScene({...entry,disable:true}),null);
    assert.throws(()=>stageSlothSceneCompression(entry,{scene:'Wrong'},short.target),/length or format/);
});
