import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {fingerprintSlothChat,fingerprintSlothReviewedRanges} from './nexusCollectionPolicy.js';
import {isCompletedSceneEntry} from './nexusSceneRotation.js';

const source=readFileSync(new URL('./nexusCollectorRuntime.js',import.meta.url),'utf8');
const start=source.indexOf('const legacyPairKey');
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
    const scope={chat,getSceneMarkers:()=>metadata,t:message=>message,fingerprintSlothReviewedRanges,isCompletedSceneEntry,
        getStmbChatKey:ref=> 'character:A.png:'+(ref?.fileName||'chat-a')};
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

test('reviewed legacy ranges exclude only the confirmed messages of the same chat and book pair',()=>{
    const h=harness();
    const pair={nexus:'N',memory:'M'};
    const ranges=[[0,2],[4,4]];
    h.metadata.slothLegacyCoverage={
        '["N","M"]':{version:1,chatKey:'character:A.png:chat-a',ranges,
            fingerprint:fingerprintSlothReviewedRanges(h.chat,ranges)},
    };
    assert.deepEqual(Array.from(h.fn(h.current,{entries:{}},pair).source,m=>m.id),[3,5,6,7,8,9]);
    assert.deepEqual(Array.from(h.fn({...h.current,fileName:'alternate'},{entries:{}},pair).source,m=>m.id),[0,1,2,3,4,5,6,7,8,9]);
    assert.deepEqual(Array.from(h.fn(h.current,{entries:{}},{...pair,memory:'Other'}).source,m=>m.id),[0,1,2,3,4,5,6,7,8,9]);
    h.chat[2].is_system=true;
    h.chat.push({name:'B',mes:'New turn'});
    assert.deepEqual(Array.from(h.fn(h.current,{entries:{}},pair).source,m=>m.id),[3,5,6,7,8,9,10]);
    h.chat[2].mes='Edited old source';
    assert.throws(()=>h.fn(h.current,{entries:{}},pair),/Previously reviewed messages changed/);
    delete h.metadata.slothLegacyCoverage['["N","M"]'];
    assert.ok(h.fn(h.current,{entries:{}},pair).source.some(m=>m.id===0));
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
        chat:turns,t:s=>s,
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
            stored = await patch(stored);
        },
    };
    const first = source.indexOf('async function readStoredSlothChat(');
    const last = source.indexOf('\nfunction assertSlothBookRoles(', first);
    const write = vm.runInNewContext(source.slice(first, last) + '\nupdateCollectedLedger', checks);
    const pair = { nexus: 'N', memory: 'M' };
    const fingerprint = fingerprintSlothChat(turns, [0]);
    await write({}, [{ segments: [[0, 0]] }], origin, pair, [0], fingerprint);
    assert.equal(metadataWrites, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(stored.slothCollection)).savedRanges, [[0, 0]]);
    checks.patchStmbMetadataForChatRef = async () => {};
    // A replay of identical coverage is intentionally idempotent.
    await write(stored.slothCollection, [{ segments: [[0, 0]] }], origin, pair, [0], fingerprint);
    // A genuinely new receipt must still be verified after persistence.
    turns.push({mes:'The door opened.',name:'Tali',is_user:false});
    const expanded=fingerprintSlothChat(turns,[0,1]);
    await assert.rejects(write(stored.slothCollection, [{ segments: [[1, 1]] }], origin, pair, [0,1], expanded), /did not persist/);
    turns[0].mes = 'A different event happened.';
    await assert.rejects(write({}, [{ segments: [[0, 0]] }], origin, pair, [0,1], expanded), /saved chat differs/);
    assert.equal(metadataWrites, 1);
});


test('automatic preflight skips checkpoint history but retains every eligible later message',()=>{
    const h=harness();
    h.metadata.slothCollection.savedRanges=[[1,1],[3,5]];
    h.chat[8].is_system=true;
    const pair={nexus:'N',memory:'M'};
    const memory={entries:{14:{STMB_chatId:'chat-a',STMB_sourceRanges:[[6,6]]}}};
    const all=h.fn(h.current,memory,pair).source;
    for (const checkpoint of [-1,0,4,5,7,9]) {
        const result=h.fn(h.current,memory,pair,checkpoint).source;
        assert.deepEqual(Array.from(result,m=>m.id),Array.from(all.filter(m=>m.id>checkpoint),m=>m.id));
    }
});

test('reference-only overlaps stay in future collection even when a Scene is stored',()=>{
    const h=harness();
    const pair={nexus:'N',memory:'M'};
    const memory={entries:{14:{STMB_chatId:'chat-a',STMB_sourceRanges:[[2,5]],STMB_collectedRanges:[[2,3]]},
        15:{STMB_chatId:'chat-a',STMB_sourceRanges:[[6,7]],STMB_collectedRanges:[]}}};
    const ids=Array.from(h.fn(h.current,memory,pair).source,m=>m.id);
    assert.deepEqual(ids,[0,4,5,6,7,8,9]);
});

test('legacy same-chat completed Memory receipts are inherited, unproven manual Scenes are not',()=>{
    const h=harness();h.metadata.slothCollection.savedRanges=[];
    const content='**Timeline**: Unknown\n\n**Scene**\nAn old event.\n\n**Result**\nFinished.';
    const memory={entries:{1:{uid:1,comment:'001 - Old',content,STMB_chatId:'chat-a',stmemorybooks:true,STMB_start:2,STMB_end:3},
        2:{uid:2,comment:'002 - Unknown origin',content,STMB_start:4,STMB_end:5},
        3:{uid:3,comment:'003 - Other chat',content,STMB_chatId:'other-chat',stmemorybooks:true,STMB_start:6,STMB_end:7}}};
    assert.deepEqual(Array.from(h.fn(h.current,memory,{nexus:'N',memory:'M'}).source,m=>m.id),[0,1,4,5,6,7,8,9]);
});
