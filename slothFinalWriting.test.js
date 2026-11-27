import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./nexusCollectionAI.js',import.meta.url),'utf8');
test('final candidate keeps the baseline single-collection causal planner and adds only fact-priority guidance',()=>{
    const single=source.slice(source.indexOf('export async function composeSingleSlothCollection('),source.indexOf('export async function retryApprovedSlothScenes('));
    assert.match(single,/DEFAULT_SLOTH_COLLECTION_PROMPTS\.plan\.replace\(/);
    assert.match(single,/getActiveSlothSummaryPreset\(settings\)\.text/);
    assert.match(single,/Keep both causal boundaries; distinguish completed outcomes from unfinished incidents/);
    assert.match(single,/each person’s decision and responsibility, and the specific act acknowledged in an apology/);
    assert.match(single,/original unit, counted action or object and speaker/);
    assert.match(single,/same source-supported wording in Scene, Result and Nexus/);
    assert.match(single,/evidencePolicyVersion=4/);
    assert.doesNotMatch(single,/silently enumerate every independent change/i);
});
