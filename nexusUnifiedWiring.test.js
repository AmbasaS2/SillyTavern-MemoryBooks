// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const file=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('saved event splitting does not invoke the retired combined-book migration',()=>{
    const code=file('./nexusCollectorRuntime.js');
    assert.doesNotMatch(code,/inspectUnifiedMemorySplit|stageUnifiedMemorySplit|approveUnifiedMemorySplit/);
    const split=code.slice(code.indexOf('export async function runNexusSceneSplit'));
    assert.match(split,/await loadServerWorld\(names.memory\)/);
    assert.match(split,/commitSlothNexusMigration/);
});

test('translation keys for the separate two-book approval are present in each supported locale',()=>{
    for(const lang of ['de-de','es-es','fr-fr','id-id','ja-jp','ko-kr',
        'ms-my','pt-br','ru-ru','zh-cn','zh-tw']){
        const data=JSON.parse(file('./locales/'+lang+'.json'));
        for(const key of ['Review','Guide','Targets','Scenes','Rotation','Approve','Saved']){
            assert.ok(data['STMemoryBooks_SlothUnified'+key],lang+key);
        }
    }
});
