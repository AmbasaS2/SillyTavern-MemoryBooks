// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const file=x=>readFileSync(new URL(x,import.meta.url),'utf8');

test('legacy migration is an explicitly approved UI command, independent of AI collector',()=>{
    const index=file('./index.js'),runtime=file('./nexusCollectorRuntime.js');
    assert.match(index,/runNexusLegacyMigration\(\)/);
    assert.match(file('./templates.js'),/data-stmb-sloth-action="migrate" data-i18n="STMemoryBooks_SlothLegacyMigrationButton"/);
    assert.match(runtime,/export async function runNexusLegacyMigration\(\)/);
    assert.match(runtime,/approveNexusLegacyMigration/);
    assert.match(runtime,/POPUP_RESULT\.CUSTOM1 && downloaded/);
    assert.match(runtime,/downloadNexusMigrationBackup/);
    assert.match(runtime,/commitSlothNexusMigration/);
    assert.match(runtime,/inspectNexusLegacyMigration\(originalBooks\.nexus\)/);
});

test('old Side Prompt upserts are checked for migrated titles before in-memory mutation or save',()=>{
    const source=file('./addlore.js');
    const begin=source.indexOf('export function stageLorebookEntriesBatch(');
    const middle=source.indexOf('export async function upsertLorebookEntryByTitle(',begin);
    assert.ok(begin>0&&middle>begin);
    const batch=source.slice(begin,middle);
    const single=source.slice(middle);
    assert.ok(batch.indexOf('guardArchivedNexusSidePromptWrite(')>=0);
    assert.ok(batch.indexOf('guardArchivedNexusSidePromptWrite(') <
        batch.indexOf('const results = []'));
    assert.match(batch, /const \{ lorebookData: staged, results \} = stageLorebookEntriesBatch/);
    assert.match(batch, /saveSidePromptLorebookChecked\(lorebookName, staged\)/);
    assert.ok(single.indexOf('guardArchivedNexusSidePromptWrite(') <
        single.indexOf('let entry ='));
});

test('new migration UI labels exist in each supported non-English locale without editing upstream en*.json',()=>{
    const needed=['SlothLegacyMigrationButton','SlothLegacyMigrationHelp','SlothLegacyReview',
        'SlothLegacyGuide','SlothLegacyNew','SlothLegacyOld','SlothLegacyHistory',
        'SlothLegacyApprove','SlothLegacyNone','SlothLegacySaved'];
    for(const locale of ['de-de','es-es','fr-fr','id-id','ja-jp','ko-kr',
        'ms-my','pt-br','ru-ru','zh-cn','zh-tw']) {
        const data=JSON.parse(file('./locales/'+locale+'.json'));
        for(const key of needed) assert.ok(data['STMemoryBooks_'+key],locale+':'+key);
    }
});
