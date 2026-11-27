// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {getActiveSlothSummaryPreset} from './slothSummaryPrompts.js';

const source=readFileSync(new URL('./nexusCollectionAI.js',import.meta.url),'utf8');
const single=source.slice(source.indexOf('export async function composeSingleSlothCollection('),source.indexOf('export async function retryApprovedSlothScenes('));
const benchmark=JSON.parse(readFileSync(new URL('./fixtures/sloth-writing-coverage.json',import.meta.url),'utf8'));
test('single collection inventories outcomes and clauses without changing legacy planner or custom presets',()=>{
    assert.match(single,/silently enumerate every independent change/i);
    assert.match(single,/An exchange with its own goal and outcome remains independent/);
    assert.match(single,/number together with its counted object, frequency, unit and scope/);
    assert.match(single,/meaningful sensory details, gestures, pauses or hesitations/);
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
    assert.match(prompt,/silently enumerate every independent change/i);
    assert.match(prompt,/Preserve every consequential clause in the Scene, not merely in Nexus/);
    assert.match(prompt,/final relevant turn/);
    assert.match(prompt,/Copy punctuation and wording literally/);
    assert.doesNotMatch(prompt,/Outline the fewest complete memories|If either explanation starts with/);
    assert.ok(prompt.includes(preset.text));
    assert.ok(prompt.includes(JSON.stringify(item.messages)));
    assert.equal(prompt.split('Unique reference card.').length,2);
    assert.match(prompt,/Return only one complete JSON object/);
    assert.match(prompt,/For Core changes, Current Continuity retirement/);
    assert.doesNotMatch(prompt,/Also cite evidence for every LT replace_exact/);
    assert.match(single,/evidencePolicyVersion=2/);
    for(const fact of item.facts)assert.ok(!prompt.includes(fact.mustPreserve),'evaluation answer must not be included in request');
});
