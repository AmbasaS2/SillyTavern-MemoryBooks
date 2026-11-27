// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getActiveSlothSummaryPreset} from './slothSummaryPrompts.js';

const source=readFileSync(new URL('./nexusCollectionAI.js',import.meta.url),'utf8');
const single=source.slice(source.indexOf('export async function composeSingleSlothCollection('),source.indexOf('export async function retryApprovedSlothScenes('));
const benchmark=JSON.parse(readFileSync(new URL('./fixtures/sloth-quality-v3.json',import.meta.url),'utf8'));
test('single collection changes the merge pressure without changing the legacy planner or custom presets',()=>{
    assert.match(single,/Identify every distinct consequential outcome/);
    assert.match(single,/Preserve a separate incident when it has a distinct initiating situation and its own completed consequence/);
    assert.match(single,/Keep exact quantities, units and frequency/);
    assert.match(single,/source-supported sensory detail, silence, hesitation or gesture/);
    assert.match(source,/Outline the fewest complete memories that preserve the consequential outcomes/);
    const custom={id:'mine',name:'Custom',text:'Keep my writing style exactly.\nA second line.'};
    const settings={moduleSettings:{slothSummaryPresets:[custom],slothSummaryPresetId:custom.id}};
    const before=JSON.stringify(settings);
    assert.equal(getActiveSlothSummaryPreset(settings).text,custom.text);
    assert.equal(JSON.stringify(settings),before);
});
test('fixed synthetic reference facts and closure citations have exact source evidence',()=>{
    for(const item of benchmark.cases){
        const byId=new Map(item.messages.map(message=>[message.id,message.mes]));
        assert.equal(byId.size,item.messages.length);
        for(const event of item.expectedEvents){
            assert.ok(event.requiredIds.every(id=>byId.has(id)));
            if(event.complete){
                assert.ok(event.requiredIds.includes(event.closure.messageId));
                assert.ok(byId.get(event.closure.messageId).includes(event.closure.quote));
            }else assert.equal(event.closure,undefined);
        }
        for(const fact of item.facts){
            assert.ok(fact.mustPreserve&&fact.evidenceIds.length);
            assert.ok(fact.evidenceIds.every(id=>byId.has(id)));
        }
    }
});
