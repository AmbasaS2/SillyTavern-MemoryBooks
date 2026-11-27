// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { SLOTH_DEFAULT_SUMMARY_PROMPT, SLOTH_SCENE_PROMPT_V13 } from './nexusSlothScenePrompt.js';
import { getActiveSlothSummaryPreset } from './slothSummaryPrompts.js';

test('the built-in scene guidance retains source-grounded atmosphere, factual sequence and independent terms',()=>{
    for(const phrase of ['lived texture','distinctive sensory details','meaningful silences','Attribute perceptions and private thoughts','meaningful atmosphere',
        'Follow the cause, actions, turning point and observed outcome in order.',
        'Keep independent agreement conditions separate','private thoughts','concrete recall cues','supported answer or unanswered choice'])
        assert.ok(SLOTH_DEFAULT_SUMMARY_PROMPT.toLowerCase().includes(phrase.toLowerCase()),phrase);
    assert.doesNotMatch(SLOTH_SCENE_PROMPT_V13,/Preserve the lived texture of the scene/);
});
test('new built-in guidance does not overwrite selected custom summaries',()=>{
    const custom={id:'mine',name:'Custom',text:'My own atmosphere instructions.\nKeep every word.'};
    const settings={moduleSettings:{slothSummaryPresets:[custom],slothSummaryPresetId:custom.id}};
    const before=JSON.stringify(settings);
    assert.equal(getActiveSlothSummaryPreset(settings).text,custom.text);
    assert.equal(JSON.stringify(settings),before);
    assert.equal(getActiveSlothSummaryPreset({}).text,SLOTH_DEFAULT_SUMMARY_PROMPT);
});
test('Nexus instructions classify by continuous recall rather than importance and preserve existing entries',()=>{
    const src=readFileSync(new URL('./nexusCollectionAI.js',import.meta.url),'utf8');
    assert.match(src,/available across unrelated scenes/);
    assert.match(src,/need for continuous recall, not emotional importance alone/);
    assert.match(src,/situation-specific durable facts and recall cues in LT, person-specific facts in NPC/);
    assert.match(src,/not a reclassification or deletion of earlier memories/);
    assert.match(src,/Never remove an old state just because a date passed/);
});
