import test from 'node:test';
import assert from 'node:assert/strict';
import { autoLinkCharacterBooks, getCharacterAuxBooks, assignedNexusBooks, planNexusAuxBooks, withSlothRoleSync, isSlothRoleSyncPending } from './nexusAuxLinks.js';

test('automatic linking is opt-out', () => {
    assert.equal(autoLinkCharacterBooks({}), true);
    assert.equal(autoLinkCharacterBooks({moduleSettings:{slothAutoLinkCharacterBooks:false}}), false);
});
test('replacing a role preserves unrelated extras and the other role', () => {
    assert.deepEqual(planNexusAuxBooks({current:['World','N','M'],previous:['N','M'],next:['N','M2'],ensure:['M2']}), ['World','N','M2']);
});
test('an AU still using a role prevents native unlink', () => {
    const settings={nexusCharacterRoles:{'A.png':{nexus:'N',memory:'M2'}},nexusChatRoleOverrides:{
        'character:A.png:AU':{version:1,avatar:'A.png',nexus:'N2',memory:'M'},
        'character:B.png:AU':{version:1,avatar:'B.png',nexus:'B',memory:'B2'}
    }};
    const next=assignedNexusBooks(settings,'A.png');
    assert.deepEqual(next,['N','M2','N2','M']);
    assert.deepEqual(planNexusAuxBooks({current:['N','M','N2'],previous:['N','M','N2'],next,ensure:['M2']}),['N','M','N2','M2']);
});
test('unlink removes only the dropped role; does not touch primary or other characters', () => {
    const world={charLore:[{name:'A',extraBooks:['Other','N','M']},{name:'B',extraBooks:['N']}]};
    const current=getCharacterAuxBooks(world,'A');
    assert.deepEqual(planNexusAuxBooks({current,previous:['N','M'],next:['N']}),['Other','N']);
    assert.deepEqual(world.charLore[1].extraBooks,['N']);
    assert.deepEqual(getCharacterAuxBooks(world,'A'),['Other','N','M']);
});
test('a native detach is not silently reversed while changing another role', () => {
    assert.deepEqual(planNexusAuxBooks({current:['N'],previous:['N','M'],next:['N2','M'],ensure:['N2']}),['N2']);
    assert.deepEqual(planNexusAuxBooks({current:['N'],previous:['N','M'],next:['N','M'],ensure:['M']}),['N','M']);
});
test('role change lock releases on failure and prevents concurrent changes', async () => {
    let release;
    const pending=withSlothRoleSync(()=>new Promise(resolve=>{release=resolve;}));
    assert.equal(isSlothRoleSyncPending(),true);
    await assert.rejects(withSlothRoleSync(async()=>{}),/in progress/);
    release(); await pending;
    await assert.rejects(withSlothRoleSync(async()=>{throw new Error('failed');}),/failed/);
    assert.equal(isSlothRoleSyncPending(),false);
});
