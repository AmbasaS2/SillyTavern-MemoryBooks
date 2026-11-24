import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { SIDE_PROMPT_HISTORY_KEY, buildSidePromptHistoryRequest, formatSidePromptVersionTitle, getSidePromptHistoryStreamKey,
    resolveSidePromptHistory, validateSidePromptHistoryRequest } from './sidePromptHistory.js';
import { getSlothSidePresets, buildSlothSideReference } from './slothSidePrompts.js';

const template = { key: 'assess', name: 'Assess State', settings: { saveAllVersions: true } };
const sceneContext = { chatId: 'chat-1', chatRef: { type: 'character', avatarUrl: 'ava', fileName: 'chat-1' } };

test('sideprompt history enables append only when both gates are enabled', () => {
    const history = buildSidePromptHistoryRequest(template, { moduleSettings: { sidePromptVersioningEnabled: true } }, sceneContext, 'Assess State', ['Assess State (STMB SidePrompt)']);
    assert.equal(history.append, true);
    assert.equal(history.group, 'AssessState-chat-1');
    assert.equal(formatSidePromptVersionTitle('Assess State', 1000), 'Assess State-1000 (STMB SidePrompt)');
});

test('sideprompt history rejects duplicate stream sequences and ambiguous legacy titles', () => {
    const history = buildSidePromptHistoryRequest(template, { moduleSettings: { sidePromptVersioningEnabled: true } }, sceneContext, 'Assess State', ['Assess State (STMB SidePrompt)']);
    const metadata = { version: 1, templateKey: 'assess', chatKey: history.chatKey, chatId: 'chat-1', titleBase: 'Assess State', titleSource: 'name', sequence: 1 };
    assert.throws(() => resolveSidePromptHistory({ entries: { 1: { STMB_sidePromptHistory: metadata }, 2: { STMB_sidePromptHistory: metadata } } }, history));
    assert.throws(() => resolveSidePromptHistory({ entries: { 1: { comment: history.legacyTitles[0] }, 2: { comment: history.legacyTitles[0] } } }, history));
});

test('sideprompt history adopts the first matching legacy title by priority', () => {
    const history = buildSidePromptHistoryRequest(template, {}, sceneContext, 'Assess State', [
        'Assess State (STMB SidePrompt)', 'Assess State (STMB Scoreboard)',
    ]);
    const preferred = { comment: history.legacyTitles[0] };
    const fallback = { comment: history.legacyTitles[1] };
    const book = { entries: { 1: fallback, 2: preferred } };
    assert.equal(resolveSidePromptHistory(book, history).legacy, preferred);
    assert.equal(resolveSidePromptHistory({ entries: { 1: fallback } }, history).legacy, fallback);
    assert.throws(() => resolveSidePromptHistory({ entries: { ...book.entries, 3: { ...preferred } } }, history));
});

test('renames keep name-based history while explicit resolved titles stay separate', () => {
    const original = buildSidePromptHistoryRequest(template, { moduleSettings: { sidePromptVersioningEnabled: true } }, sceneContext, 'Assess State', ['Assess State (STMB SidePrompt)']);
    const renamed = buildSidePromptHistoryRequest({ ...template, name: 'Renamed' }, {}, sceneContext, 'Renamed', ['Renamed (STMB SidePrompt)']);
    const book = { entries: { 1: { comment: 'Assess State (STMB SidePrompt)', STMB_sidePromptHistory: { ...original, version: 1, sequence: 1 } } } };
    assert.equal(resolveSidePromptHistory(book, renamed).latest, book.entries[1]);

    const override = { ...template, settings: { saveAllVersions: true, lorebook: { entryTitleOverride: '{{person}}' } } };
    const alice = buildSidePromptHistoryRequest(override, {}, sceneContext, 'Alice', []);
    const bob = buildSidePromptHistoryRequest(override, {}, sceneContext, 'Bob', []);
    assert.notEqual(getSidePromptHistoryStreamKey({ ...alice, version: 1 }), getSidePromptHistoryStreamKey({ ...bob, version: 1 }));
});

test('legacy output is adopted once and latest history can be updated without appending', () => {
    const initial = buildSidePromptHistoryRequest(template, { moduleSettings: { sidePromptVersioningEnabled: true } }, sceneContext, 'Assess State', ['Assess State (STMB SidePrompt)']);
    const legacy = { comment: initial.legacyTitles[0], content: 'Previous output' };
    assert.equal(resolveSidePromptHistory({ entries: { 1: legacy } }, initial).legacy, legacy);
    const request = { ...initial, append: false };
    const latest = { ...legacy, STMB_sidePromptHistory: { ...request, version: 1, sequence: 2 } };
    assert.equal(resolveSidePromptHistory({ entries: { 1: latest } }, request).latest, latest);
    assert.equal(request.append, false);
});

test('Sloth publishes a disabled note per chat and updates only its own latest entry', () => {
    const source = readFileSync(new URL('./addlore.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const historyPart = source.slice(source.indexOf('function applySidePromptHistory('), source.indexOf('/**\n * Parse scene range'));
    const stagePart = source.slice(source.indexOf('export function stageLorebookEntriesBatch('), source.indexOf('export async function upsertLorebookEntriesBatch('))
        .replace('export function','function');
    const stage = vm.runInNewContext(historyPart+'\n'+stagePart+'\nstageLorebookEntriesBatch', {
        structuredClone, SIDE_PROMPT_HISTORY_KEY, formatSidePromptVersionTitle, resolveSidePromptHistory, validateSidePromptHistoryRequest,
        guardArchivedNexusSidePromptWrite: () => {},
        createWorldInfoEntry: (_, book) => {
            const uid = Object.keys(book.entries).length;
            return book.entries[uid] = {uid, disable:false, constant:true, vectorized:true, key:['prior'], keysecondary:['recipient']};
        },
    });
    const template = {key:'sloth-little-things',name:'Little Things'};
    const input = {entries:{0:{uid:0,comment:'Little Things (STMB SidePrompt)',content:'Legacy output'}}};
    const write = (book, context, content) => stage('Nexus',book,[{title:'Little Things (STMB SidePrompt)',content,
        sidePromptHistory:buildSidePromptHistoryRequest(template,{},context,'Little Things',[]), archiveOnly:true}]).lorebookData;
    const a = write(input, sceneContext, 'First note');
    const b = write(a, sceneContext, 'Updated note');
    const secondChat = {chatId:'chat-2',chatRef:{...sceneContext.chatRef,fileName:'chat-2'}};
    const two = write(b, secondChat, 'Separate note');
    assert.equal(Object.keys(two.entries).length, 3);
    assert.deepEqual(two.entries[0], input.entries[0]);
    for (const [uid, content] of [[1, 'Updated note'],[2, 'Separate note']]) {
        const entry = two.entries[uid];
        assert.equal(entry.content, content);
        assert.equal(entry.disable, true);
        assert.equal(entry.vectorized, false);
        assert.equal(entry.constant, false);
        assert.equal(entry.key.length, 0);
        assert.equal(entry.keysecondary.length, 0);
    }
});

test('Sloth side defaults and duplicate references exclude shared presets and protected entries', () => {
    const [little] = getSlothSidePresets({moduleSettings:{slothSidePresets:[{id:'plotpoints',name:'Plotpoints',text:'legacy'}]}});
    assert.equal(little.name, 'Little Things');
    assert.deepEqual(JSON.parse(buildSlothSideReference({content:'Scene copy'}, {entries:{
        0:{comment:'Extra',content:'extra'}, 1:{comment:'Core Memory',content:'core'},
        2:{comment:'Private Outlet',content:'outlet',position:7}, 3:{comment:'Archived',content:'archive',disable:true},
    }})), {savedScene:'Scene copy',nexus:[{title:'Core Memory',content:'core'},{title:'Extra',content:'extra'}]});
});
