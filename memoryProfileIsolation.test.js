import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {prepareConnectionProfileRequest} from './connectionProfileRequest.js';

test('Memory Books does not register a global request-rewriting hook',()=>{
    const src=readFileSync(new URL('./index.js',import.meta.url),'utf8');
    assert.doesNotMatch(src,/eventSource\.(?:on|makeFirst|makeLast)\(event_types\.GENERATE_AFTER_DATA/);
});
test('own memory request retains explicit profile fields and reasoning choice',async()=>{
    const src=readFileSync(new URL('./stmemory.js',import.meta.url),'utf8');
    const a=src.indexOf('async function generateMemoryWithAI('),b=src.indexOf('let aiResponse;',a);
    assert.ok(a>=0&&b>a);
    const section=src.slice(a,b);
    assert.match(section,/const extra = apiType === 'full-manual' \? \{\} : \{ include_reasoning: false \}/);
    assert.match(section,/model: conn\.model/);
    assert.match(section,/temperature: conn\.temperature/);
    assert.match(section,/api: apiType/);
    let request;
    const connection={profileId:'test',service:{sendRequest(...args){request=args;}}};
    await prepareConnectionProfileRequest(connection,{model:'memory-model',temperature:0.2,messages:[],max_tokens:123,stream:false,include_reasoning:false},null)();
    assert.equal(request[4].model,'memory-model');
    assert.equal(request[4].temperature,0.2);
    assert.equal(request[4].include_reasoning,false);
    await prepareConnectionProfileRequest(connection,{model:'other',messages:[],max_tokens:123,stream:false},null)();
    assert.equal(Object.hasOwn(request[4],'include_reasoning'),false);
});
