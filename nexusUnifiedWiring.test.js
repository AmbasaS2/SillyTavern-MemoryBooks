// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const file=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('unified split uses two-book reviewed and backed-up commit, not the Nexus-only commit',()=>{
    const code=file('./nexusCollectorRuntime.js');
    assert.match(code,/inspectUnifiedMemorySplit\(memory,nexus\)/);
    assert.match(code,/stageUnifiedMemorySplit\(\{/);
    assert.match(code,/approveUnifiedMemorySplit\(\{states,staged,ref\}\)/);
    const begin=code.indexOf('async function approveUnifiedMemorySplit(');
    const end=code.indexOf('export async function runNexusLegacyMigration()',begin);
    const review=code.slice(begin,end);
    assert.match(review,/downloadSafetyBackup\(states,ref,/);
    assert.match(review,/POPUP_RESULT\.CUSTOM1 && downloaded/);
    const split=code.slice(code.indexOf('const unified=inspectUnifiedMemorySplit('),
        code.indexOf('const plan=inspectNexusLegacyMigration(nexus);'));
    assert.match(split,/commitSlothBooks\(states,/);
    assert.match(split,/verifyOrigin:\(\)=>assertLegacyMigrationOrigin\(ref,roleNames\)/);
    assert.match(split,/withLocks:withBothWriteLanes/);
    assert.match(split,/STMemoryBooks_SlothUnifiedSaved/);
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
