// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = file => readFileSync(new URL(file,import.meta.url),'utf8');

test('Scene merge is an explicit button, not an automatic collector or migration',()=>{
    const index=source('./index.js');
    assert.match(index,/runNexusSceneMerge\(\{\s*profileIndex/);
    assert.match(source('./templates.js'),/data-stmb-sloth-action="merge"><i[^>]*><\/i><span data-i18n="STMemoryBooks_SlothMergeButton"/);
    const runtime=source('./nexusCollectorRuntime.js');
    assert.match(runtime,/export async function runNexusSceneMerge/);
    assert.match(runtime,/if\(collectorBusy\)/);
    assert.match(runtime,/getNexusRoleResolutionForChatRef\('memory',ref,settings\)/);
    const mergeStart=runtime.indexOf('export async function runNexusSceneMerge');
    const nextExport=runtime.indexOf('\nexport async function ',mergeStart+1);
    const block=runtime.slice(mergeStart,nextExport<0?undefined:nextExport);
    assert.match(block,/suggestSlothSceneMerges/);
    assert.match(block,/chooseSlothMergeCandidate/);
    assert.match(block,/composeSlothMergedScene/);
    assert.match(block,/reviewSlothMergeDraft/);
    assert.match(block,/stageNexusSceneMerge/);
    assert.match(block,/approveSlothSceneMerge/);
    assert.match(block,/commitSlothNexusMigration/);
    assert.match(block,/operation:'Memory Scene merge'/);
    assert.doesNotMatch(block,/hideChat|hideMessages|updateCollectedLedger/);
});

test('Scene merge requires full Memory JSON backup and preserves unrelated Nexus World Info',()=>{
    const runtime=source('./nexusCollectorRuntime.js');
    const block=runtime.slice(runtime.indexOf('/** Select a suggested causal pair'));
    assert.match(block,/downloadSlothMergeBackup/);
    assert.match(block,/original:memory/);
    assert.match(block,/POPUP_RESULT\.CUSTOM1 && downloaded/);
    assert.match(block,/resetCache:\(name,book\)=>worldInfoCache\.set/);
    assert.match(block,/verifyOrigin:\(\)=>assertSlothBookRoles/);
    const mergeStart=block.indexOf('export async function runNexusSceneMerge');
    const nextExport=block.indexOf('\nexport async function ',mergeStart+1);
    const save=block.slice(mergeStart,nextExport<0?undefined:nextExport);
    assert.match(save,/await loadServerWorld\(names\.memory\)/);
    assert.doesNotMatch(save,/await loadServerWorld\(names\.nexus\)/);
    assert.match(save,/name:names\.memory,original,staged:staged\.proposedMemory/);
});

test('Merge new UI keys are localized in all supported non-English locales',()=>{
    const js=source('./nexusCollectorRuntime.js')+source('./index.js')+source('./templates.js');
    const keys=[...new Set([...js.matchAll(/STMemoryBooks_(SlothMerge\w+)/g)].map(m=>m[1]))];
    assert.equal(keys.length,19);
    for(const language of ['de-de','es-es','fr-fr','id-id','ja-jp','ko-kr','ms-my',
        'pt-br','ru-ru','zh-cn','zh-tw']){
        const translated=JSON.parse(source('./locales/'+language+'.json'));
        for(const key of keys){
            assert.equal(typeof translated['STMemoryBooks_'+key],'string',
                language+':'+key);
            assert.ok(translated['STMemoryBooks_'+key].trim(),language+':'+key);
        }
    }
});
