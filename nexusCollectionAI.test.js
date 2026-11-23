import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('./nexusCollectionAI.js',import.meta.url),'utf8');
const from=source.indexOf('function parseStrictJSON('),to=source.indexOf('\nfunction resolveConnection(',from);
assert.ok(from>=0&&to>from);
const parse=vm.runInNewContext(source.slice(from,to)+'\nparseStrictJSON');
test('strict JSON parser accepts exact JSON and a JSON fence without rewriting malformed values',()=>{
    assert.equal(parse('{"events":[]}', 'plan').events.length,0);
    const fenced=String.fromCharCode(96).repeat(3)+'json\n{"edits":[]}\n'+String.fromCharCode(96).repeat(3);
    assert.equal(parse(fenced,'Nexus').edits.length,0);
    assert.throws(()=>parse('Here is my answer: {"events":[]}', 'plan'),/malformed/);
    assert.throws(()=>parse('{"events": [', 'plan'),/malformed/);
    assert.throws(()=>parse('[]','plan'),/object/);
});
test('collector limits Nexus source and hides protected Outlet content from the AI prompt',()=>{
    assert.match(source,/protectedEntry/);
    assert.match(source,/\[protected; not included\]/);
    assert.match(source,/source\.length>60000/);
    assert.match(source,/auditSlothDraft/);
    assert.match(source,/source\.length\+draft\.length>68000/);
});
