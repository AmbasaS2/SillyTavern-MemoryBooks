// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
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

test('actual single collection request changes causal merge pressure and keeps source, custom preset and output contract',async()=>{
    const start=source.indexOf('const DEFAULT_SLOTH_COLLECTION_PROMPTS=Object.freeze(');
    const end=source.indexOf('const DEEPSEEK_FLASH_TAIL_GUIDANCE',start);
    assert.ok(start>=0&&end>start);
    const captured=[];
    const stop=new Error('stop before external generation');
    const compose=vm.runInNewContext(source.slice(start,end)+'\n'+
        single.replace('export async','async')+'\ncomposeSingleSlothCollection',{
        getActiveSlothSummaryPreset,SCENE_KEYWORD_GUIDANCE:'Keywords',
        compact:JSON.stringify,slothNexusGuidance:()=> 'Nexus reference',
        requester:()=>async prompt=>{captured.push(prompt);throw stop;},
    });
    const preset={id:'custom',name:'Custom',text:'My exact style instruction.\nKeep the voice.'};
    const settings={moduleSettings:{slothSummaryPresets:[preset],slothSummaryPresetId:'custom'}};
    const item=benchmark.cases[0];
    await assert.rejects(compose({nexus:{entries:{}},memory:{entries:{}},messages:item.messages,
        settings,characterContext:'Unique reference card.'}),e=>e===stop);
    assert.equal(captured.length,1);
    const prompt=captured[0];
    assert.match(prompt,/Identify every distinct consequential outcome/);
    assert.match(prompt,/Keep the setup, reaction, correction, answer and repair of ONE driving issue together/);
    assert.doesNotMatch(prompt,/Outline the fewest complete memories|If either explanation starts with/);
    assert.ok(prompt.includes(preset.text));
    assert.ok(prompt.includes(JSON.stringify(item.messages)));
    assert.equal(prompt.split('Unique reference card.').length,2);
    assert.match(prompt,/Return only one complete JSON object/);
    assert.match(prompt,/Also cite evidence for every LT replace_exact/);
    for(const fact of item.facts)assert.ok(!prompt.includes(fact.mustPreserve),'evaluation answer must not be included in request');
});
