import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('./nexusCollectorRuntime.js',import.meta.url),'utf8');
const start=source.indexOf('function activeSource(ref, memoryBook) {');
const end=source.indexOf('\nfunction readableSegments(',start);
assert.ok(start>=0&&end>start);
const body=source.slice(start,end);
function harness() {
    const chat=Array.from({length:10},(_,id)=>({name:'A',mes:'Text '+id,is_system:false}));
    const metadata={
        highestMemoryProcessed:0,
        slothCollection:{chatKey:'character:A.png:chat-a',savedRanges:[[1,1]]},
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
    const out=h.fn(h.current,memory);
    assert.deepEqual(Array.from(out.source,m=>m.id),[4,5,6,8]);
    assert.equal(out.prior.chatKey,'character:A.png:chat-a');
});
test('branch copy of collection ledger is ignored when chat key differs',()=>{
    const h=harness();
    h.metadata.slothCollection.chatKey='character:A.png:another-branch';
    const out=h.fn(h.current,{entries:{}});
    assert.deepEqual(Array.from(out.source,m=>m.id),[1,2,3,4,5,6,7,8,9]);
});
test('hidden messages remain outside source and are never marked collected automatically',()=>{
    const h=harness();h.chat[8].is_system=true;
    const out=h.fn(h.current,{entries:{}});
    assert.ok(!out.source.some(m=>m.id===8));
});
