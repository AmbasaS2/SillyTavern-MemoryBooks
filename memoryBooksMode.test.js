import test from 'node:test';
import assert from 'node:assert/strict';
import { getMemoryBooksMode, setMemoryBooksMode, explicitMemoryBooksMode, legacyRotationEnabled, moveMemoryBooksMode, removeMemoryBooksMode } from './memoryBooksMode.js';

const ref = (avatarUrl,fileName='one')=>({type:'character',avatarUrl,fileName});
test('all solo characters default to Sloth; group and no character stay original', () => {
    for (const settings of [{},{moduleSettings:{autoSummaryEnabled:true}},{nexusCharacterRoles:{'A.png':{memory:'Old'}}}]) {
        assert.equal(getMemoryBooksMode(settings,ref('A.png')),'sloth');
        assert.equal(getMemoryBooksMode(settings,{type:'group',groupId:'g'}),'original');
        assert.equal(getMemoryBooksMode(settings,ref('')),'original');
    }
});
test('persisted choice follows character, including other chats, and preserves previous assignments', () => {
    const settings={nexusCharacterRoles:{'A.png':{nexus:'N',memory:'M'}},moduleSettings:{slothAutoEnabled:true,autoSummaryEnabled:true,nexusSceneRotationEnabled:true}};
    const before=structuredClone(settings);
    assert.equal(setMemoryBooksMode(settings,ref('A.png'),'original'),true);
    assert.equal(getMemoryBooksMode(settings,ref('A.png','AU')),'original');
    assert.equal(getMemoryBooksMode(settings,ref('B.png')),'sloth');
    assert.equal(legacyRotationEnabled(settings,ref('A.png')),false);
    assert.equal(getMemoryBooksMode(JSON.parse(JSON.stringify(settings)),ref('A.png')),'original');
    assert.equal(setMemoryBooksMode(settings,ref('A.png'),'sloth'),true);
    assert.equal(legacyRotationEnabled(settings,ref('A.png')),true);
    assert.deepEqual(settings.nexusCharacterRoles,before.nexusCharacterRoles);
    assert.deepEqual(settings.moduleSettings,before.moduleSettings);
});
test('invalid choice and groups are rejected; character rename and delete are scoped',()=>{
    const settings={};
    assert.equal(setMemoryBooksMode(settings,{type:'group'},'sloth'),false);
    assert.equal(setMemoryBooksMode(settings,ref('A.png'),'bad'),false);
    assert.equal(explicitMemoryBooksMode(settings,ref('A.png')),null);
    setMemoryBooksMode(settings,ref('A.png'),'original');
    assert.equal(moveMemoryBooksMode(settings,'A.png','New.png'),true);
    assert.equal(getMemoryBooksMode(settings,ref('New.png')),'original');
    assert.equal(getMemoryBooksMode(settings,ref('A.png')),'sloth');
    assert.equal(removeMemoryBooksMode(settings,'New.png'),true);
    assert.equal(getMemoryBooksMode(settings,ref('New.png')),'sloth');
});
