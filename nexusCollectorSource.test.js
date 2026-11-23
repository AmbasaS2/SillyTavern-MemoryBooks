import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {fingerprintSlothChat} from './nexusCollectionPolicy.js';

const source=readFileSync(new URL('./nexusCollectorRuntime.js',import.meta.url),'utf8');
const start=source.indexOf('function activeSource(ref, memoryBook, roleNames) {');
const end=source.indexOf('\nfunction readableSegments(',start);
assert.ok(start>=0&&end>start);
const body=source.slice(start,end);
function harness() {
    const chat=Array.from({length:10},(_,id)=>({name:'A',mes:'Text '+id,is_system:false}));
    const metadata={
        highestMemoryProcessed:0,
        slothCollection:{chatKey:'character:A.png:chat-a',books:{nexus:'N',memory:'M'},savedRanges:[[1,1]]},
    };
    const current={type:'character',avatarUrl:'A.png',fileName:'chat-a'};
    const scope={chat,getSceneMarkers:()=>metadata,
        getStmbChatKey:()=> 'character:A.png:chat-a'};
    const fn=vm.runInNewContext(body+'\nactiveSource',scope);
    return {fn,metadata,chat,current};
}
test('collector resumes only uncollected source spans for the exact chat',()=>{
    const h=harness();
    const memory={entries:{
        12:{uid:12,STMB_chatId:'chat-a',STMB_start:2,STMB_end:3},
        13:{uid:13,STMB_chatId:'other-chat',STMB_start:4,STMB_end:6},
        14:{uid:14,STMB_chatId:'chat-a',STMB_sourceRanges:[[7,7],[9,9]]},
    }};
    const out=h.fn(h.current,memory,{nexus:'N',memory:'M'});
    assert.deepEqual(Array.from(out.source,m=>m.id),[0,2,3,4,5,6,8]);
    assert.equal(out.prior.chatKey,'character:A.png:chat-a');
});
test('branch copy of collection ledger is ignored when chat key differs',()=>{
    const h=harness();
    h.metadata.slothCollection.chatKey='character:A.png:another-branch';
    const out=h.fn(h.current,{entries:{}},{nexus:'N',memory:'M'});
    assert.deepEqual(Array.from(out.source,m=>m.id),[0,1,2,3,4,5,6,7,8,9]);
});
test('hidden messages remain outside source and are never marked collected automatically',()=>{
    const h=harness();h.chat[8].is_system=true;
    const out=h.fn(h.current,{entries:{}},{nexus:'N',memory:'M'});
    assert.ok(!out.source.some(m=>m.id===8));
});

test('only collection receipts for the selected pair affect the source',()=>{
    const h=harness();
    const oldPair={nexus:'N',memory:'M'};
    const ids=pair=>Array.from(h.fn(h.current,{entries:{}},pair).source,m=>m.id);
    assert.deepEqual(ids(oldPair),[0,2,3,4,5,6,7,8,9]);
    assert.deepEqual(ids({nexus:'Other',memory:'New'}),[0,1,2,3,4,5,6,7,8,9]);
    delete h.metadata.slothCollection.books;
    assert.deepEqual(ids(oldPair),[0,1,2,3,4,5,6,7,8,9]);
});

test('the collection receipt is tied to persisted source and is reread after metadata save', async () => {
    const origin = { avatarUrl: 'A.png', fileName: 'chat-a' };
    const turns = [{ mes: 'The bell rang.', name: 'Tali', is_user: false }];
    let stored = {};
    let metadataWrites = 0;
    const checks = {
        stringify: JSON.stringify,
        fingerprintSlothChat,
        getRequestHeaders: () => ({}),
        getStmbChatKey: () => 'character:A.png:chat-a',
        assertOrigin() {},
        fetch: async (_url, { body }) => {
            assert.deepEqual(JSON.parse(body), { avatar_url: origin.avatarUrl, file_name: origin.fileName });
            return { ok: true, json: async () => [{ chat_metadata: { STMemoryBooks: stored } }, ...turns] };
        },
        patchStmbMetadataForChatRef: async (_origin, patch) => {
            metadataWrites++;
            stored = patch(stored);
        },
    };
    const first = source.indexOf('async function readReviewedChat(');
    const last = source.indexOf('\nfunction assertSlothBookRoles(', first);
    const write = vm.runInNewContext(source.slice(first, last) + '\nupdateCollectedLedger', checks);
    const pair = { nexus: 'N', memory: 'M' };
    const fingerprint = fingerprintSlothChat(turns, [0]);
    await write({}, [{ segments: [[0, 0]] }], origin, pair, [0], fingerprint);
    assert.equal(metadataWrites, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(stored.slothCollection)).savedRanges, [[0, 0]]);
    checks.patchStmbMetadataForChatRef = async () => {};
    await assert.rejects(write(stored.slothCollection, [{ segments: [[0, 0]] }], origin, pair, [0], fingerprint), /did not persist/);
    turns[0].mes = 'A different event happened.';
    await assert.rejects(write({}, [{ segments: [[0, 0]] }], origin, pair, [0], fingerprint), /saved chat differs/);
    assert.equal(metadataWrites, 1);
});
