import test from 'node:test';
import assert from 'node:assert/strict';
import { pickSlothSidePresets, slothSideBookName, slothSideBookOwner } from './slothSidePrompts.js';
import { scopeNexusWorldInfo } from './nexusWorldInfoScope.js';

test('one run can select independent Side Prompts, including an always-on custom prompt', () => {
    const npc = { id: 'sloth-abc', name: 'NPC', text: 'Record recurring characters.', responseFormat: 'Name and role' };
    const diary = { id: 'sloth-def', name: 'Diary', text: 'Write a diary.' };
    const settings = { moduleSettings: { slothSidePresets: [npc, diary],
        slothSideRecallModes: { [npc.id]: 'constant' } } };
    assert.deepEqual(pickSlothSidePresets(settings, []), []);
    const selected = pickSlothSidePresets(settings, [npc.id, npc.id, diary.id, 'unknown']);
    assert.deepEqual(selected, [{ ...npc, recall: 'constant' }, { ...diary, responseFormat: '', recall: 'disabled' }]);
});

test('Little Things has a character-readable name and does not take an unrelated existing name', () => {
    const character = { name: '캐서린 / Mira' };
    assert.equal(slothSideBookName(character, [], 'ababcd'), 'Little Things - 캐서린 Mira');
    assert.equal(slothSideBookName(character, ['little things - 캐서린 mira'], 'ababcd'),
        'Little Things - 캐서린 Mira - ababcd');
    assert.equal(slothSideBookOwner({ extensions: { stmbSlothSideBook: { version: 1, avatar: 'mira.png' } } }), 'mira.png');
    assert.equal(slothSideBookOwner({ extensions: { stmbSlothSideBook: { version: 2, avatar: 'mira.png' } } }), '');
});

test('Little Things stays in its source chat and replaces only the same previous Nexus prompt in recall', () => {
    const avatar = 'mira.png';
    const ref = { type: 'character', avatarUrl: avatar, fileName: 'chapter-a' };
    const history = { version: 1, templateKey: 'sloth-abc', titleSource: 'name',
        chatKey: JSON.stringify(['character', avatar, ref.fileName]) };
    const note = { world: 'Nexus', STMB_slothSideNote: true, STMB_sidePromptHistory: history };
    const dedicated = { ...note, world: 'Little Things', STMB_slothSideBook: true, disable: true };
    const other = { ...note, STMB_sidePromptHistory: { ...history, templateKey: 'sloth-def' } };
    const core = { world: 'Nexus', constant: true };
    const settings = { nexusCharacterRoles: { [avatar]: { nexus: 'Nexus', memory: 'Memory' } } };
    const lists = { globalLore: [note, other, core], characterLore: [dedicated] };
    scopeNexusWorldInfo(lists, { settings, ref, avatar });
    assert.deepEqual(lists.globalLore, [other, core]);
    assert.deepEqual(lists.characterLore, [dedicated]);
    scopeNexusWorldInfo(lists, { settings, ref: { ...ref, fileName: 'chapter-b' }, avatar });
    assert.deepEqual(lists.globalLore, [core]);
    assert.deepEqual(lists.characterLore, []);
});
