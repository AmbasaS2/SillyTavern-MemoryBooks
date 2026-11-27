import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {mergeNarratorLorebookEntries} from './narratorMode.js';
const src=readFileSync(new URL('./index.js',import.meta.url),'utf8');
const start=src.indexOf('  eventSource.makeFirst(event_types.WORLDINFO_ENTRIES_LOADED, async lists => {');
const end=src.indexOf('\n  window.addEventListener("resize", () => {',start);
assert.ok(start>=0 && end>start);
function harness(load) {
    let listener, current='chat-a';
    const events=[];
    const scope={eventSource:{makeFirst:(_event,fn)=>{listener=fn;}},event_types:{WORLDINFO_ENTRIES_LOADED:'load'},
        getCurrentStmbChatRef:()=>({avatarUrl:'A.png'}),extension_settings:{STMemoryBooks:{}},
        getStmbChatKey:()=>current,scopeNexusWorldInfo:lists=>events.push(lists.characterLore.length),
        narratorGenerationSnapshot:['member'],manualGroupGenerationSnapshot:null,
        getCurrentMemoryBooksContext:()=>({isNarratorMode:true}),getCurrentNarratorConfig:()=>({members:[{id:'member',lorebookName:'book'}]}),
        characters:[{avatar:'A.png'}],this_chid:0,loadWorldInfo:load,mergeNarratorLorebookEntries};
    vm.runInNewContext(src.slice(start,end),scope);
    return {listener,events,change:()=>{current='chat-b';}};
}
test('merged narrator entries are ready before the next World Info listener',async()=>{
    const h=harness(async()=>({entries:{1:{uid:1,content:'Lore'}}}));
    const lists={globalLore:[],characterLore:[],chatLore:[],personaLore:[]};
    await h.listener(lists);
    assert.equal(lists.characterLore.length,1);
    assert.equal(lists.characterLore[0].world,'book');
    assert.deepEqual(h.events,[0,1]);
});
test('late load cannot append the old chat’s entries',async()=>{
    let resolve;
    const h=harness(()=>new Promise(r=>{resolve=r;}));
    const lists={characterLore:[]};
    const pending=h.listener(lists);h.change();resolve({entries:{1:{uid:1}}});await pending;
    assert.equal(lists.characterLore.length,0);
});
