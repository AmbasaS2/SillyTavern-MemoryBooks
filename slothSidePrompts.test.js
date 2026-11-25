import test from 'node:test';
import assert from 'node:assert/strict';
import { canContinueSlothSideEntry, getSlothSideDestination, getSlothSidePresets, pickSlothSidePresets,
    SLOTH_CREATE_SIDE_BOOK, SLOTH_DIARY_ID, slothSideBookName, slothSideBookOwner } from './slothSidePrompts.js';
import { scopeNexusWorldInfo } from './nexusWorldInfoScope.js';

test('one run can select independent Side Prompts, including an always-on custom prompt', () => {
    const npc = { id: 'sloth-abc', name: 'NPC', text: 'Record recurring characters.', responseFormat: 'Name and role' };
    const diary = { id: 'sloth-def', name: 'Diary', text: 'Write a diary.' };
    const ref = { type: 'character', avatarUrl: 'mira.png', fileName: 'chat' };
    const npcLink = JSON.stringify([ref.avatarUrl, npc.id]);
    const diaryLink = JSON.stringify([ref.avatarUrl, diary.id]);
    const settings = { moduleSettings: { slothSidePresets: [npc, diary],
        slothSideRecallModes: { [npc.id]: 'constant' },
        slothSideCharacterLinks: { [npcLink]: true, [diaryLink]: true },
        slothSideBooks: { [npcLink]: 'Nexus', [diaryLink]: SLOTH_CREATE_SIDE_BOOK } } };
    assert.deepEqual(pickSlothSidePresets(settings, [], ref), []);
    const selected = pickSlothSidePresets(settings, [npc.id, npc.id, diary.id, 'unknown'], ref);
    assert.deepEqual(selected, [
        { ...npc, recall: 'constant', destination: { book: 'Nexus', create: false, entry: null } },
        { ...diary, responseFormat: '', recall: 'disabled', destination: { book: '', create: true, entry: null } },
    ]);
    delete settings.moduleSettings.slothSideBooks[npcLink];
    delete settings.moduleSettings.slothSideCharacterLinks[diaryLink];
    assert.deepEqual(pickSlothSidePresets(settings, [npc.id, diary.id], ref), []);
    assert.deepEqual(getSlothSideDestination(settings, npc.id, ref), { book: '', create: false, entry: null });
    assert.deepEqual(pickSlothSidePresets(settings, [npc.id, diary.id], { ...ref, avatarUrl: 'other.png' }), []);
});

test('the canonical Diary uses character-specific books and chat-specific continuation targets', () => {
    const avatar = 'mira.png';
    const fileName = 'chapter-a';
    const ref = { type: 'character', avatarUrl: avatar, fileName };
    const entry = { book: 'Archive', uid: 5, title: 'My diary' };
    const settings = { moduleSettings: {
        slothSideBooks: { [JSON.stringify([avatar, SLOTH_DIARY_ID])]: 'Archive' },
        slothSideCharacterLinks: { [JSON.stringify([avatar, SLOTH_DIARY_ID])]: true },
        slothSideEntries: { [JSON.stringify([avatar, fileName, SLOTH_DIARY_ID])]: entry },
    } };
    const [diary] = pickSlothSidePresets(settings, [SLOTH_DIARY_ID], ref);
    assert.match(diary.text, /PRIVATE DIARY as a first-person record/);
    assert.match(diary.responseFormat, /DIARY \(DON'T READ IT\) — \{\{char\}\}/u);
    assert.equal(diary.recall, 'disabled');
    assert.deepEqual(diary.destination, { book: 'Archive', create: false, entry });
    assert.deepEqual(pickSlothSidePresets(settings, [SLOTH_DIARY_ID], { ...ref, fileName: 'chapter-b' })[0].destination,
        { book: 'Archive', create: false, entry: null });
    assert.deepEqual(pickSlothSidePresets(settings, [SLOTH_DIARY_ID], { ...ref, avatarUrl: 'other.png' }), []);
    assert.ok(!getSlothSidePresets(settings).some(preset => preset.id === 'sloth-little-things'));
    const record = { uid: 5, comment: 'Private journal', content: 'Earlier diary.' };
    assert.ok(canContinueSlothSideEntry(record, SLOTH_DIARY_ID, ref));
    assert.ok(!canContinueSlothSideEntry({ ...record, STMB_chatId: 'chapter-b' }, SLOTH_DIARY_ID, ref));
    assert.ok(!canContinueSlothSideEntry({ ...record, position: 7 }, SLOTH_DIARY_ID, ref));
    assert.ok(!canContinueSlothSideEntry({ ...record, comment: 'Core Memory' }, SLOTH_DIARY_ID, ref));
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
