import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { commitVerifiedWorldInfoBooks } from './nexusCollectionCommit.js';
import { withSlothLorebookWriteLane } from './slothWriteLane.js';
import { fingerprintRollbackEntry } from './memoryRollback.js';

const book = content => ({entries:{1:{uid:1,content}}});
const pairs = () => ['A','B','C'].map(name => ({name,original:book('old '+name),staged:book('new '+name)}));
const withLocks = (names, task) => {
    const visit = i => i === names.length ? task() : withSlothLorebookWriteLane(names[i], () => visit(i+1));
    return visit(0);
};
const equals = (a,b) => fingerprintRollbackEntry(a) === fingerprintRollbackEntry(b);

function setup() {
    const states = pairs(), disk = new Map(states.map(s => [s.name,structuredClone(s.original)]));
    const deps = {withLocks,verifyOrigin:()=>{},loadFresh:async name=>structuredClone(disk.get(name)),
        save:async(name,data)=>disk.set(name,structuredClone(data))};
    return {states,disk,deps};
}
test('all rollback books stay locked through compensation; a Manager edit waits and survives', async () => {
    const {states,disk,deps}=setup();
    const save=deps.save;
    let manager, managerStarted=false;
    deps.save=async(name,data)=>{
        if(name==='B'&&equals(data,states[1].staged)){
            manager=withSlothLorebookWriteLane('A',async()=>{
                managerStarted=true;
                assert.deepEqual(disk.get('A'),states[0].original);
                disk.set('A',book('Manager edit'));
            });
            await Promise.resolve();
            assert.equal(managerStarted,false);
            throw Error('B failed');
        }
        await save(name,data);
    };
    await assert.rejects(commitVerifiedWorldInfoBooks(states,deps,{equals}),/rolled back.*B failed/);
    await manager;
    assert.equal(managerStarted,true);
    assert.deepEqual(disk.get('A'),book('Manager edit'));
    assert.deepEqual(disk.get('B'),states[1].original);
});
test('external modification during compensation is not overwritten',async()=>{
    const {states,disk,deps}=setup();
    const save=deps.save;
    deps.save=async(name,data)=>{
        if(name==='B'&&equals(data,states[1].staged)){
            disk.set('A',book('external edit'));
            throw Error('B failed');
        }
        await save(name,data);
    };
    await assert.rejects(commitVerifiedWorldInfoBooks(states,deps,{equals}),{partialRecovery:true});
    assert.deepEqual(disk.get('A'),book('external edit'));
});
test('failed request that persisted is compensated and all earlier books restored',async()=>{
    const {states,disk,deps}=setup();
    const save=deps.save;
    deps.save=async(name,data)=>{
        await save(name,data);
        if(name==='C'&&equals(data,states[2].staged))throw Error('response lost');
    };
    await assert.rejects(commitVerifiedWorldInfoBooks(states,deps,{equals}),/rolled back.*response lost/);
    for(const state of states)assert.deepEqual(disk.get(state.name),state.original);
});

const source=readFileSync(new URL('./index.js',import.meta.url),'utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
function originalHarness(){
    const disk=new Map([['A',book('old A')]]),cache=new Map([['A',book('old A')]]);
    let saves=0,reads=0,dropSave=false;
    const context=vm.createContext({
        getLorebookDataFingerprint:fingerprintRollbackEntry,deepClone:structuredClone,
        worldInfoHost:{worldInfoCache:cache},commitVerifiedWorldInfoBooks,withLorebookWriteLanes:withLocks,
        getStmbChatKey:()=> 'chat',getMemoryRollbackChatId:()=> 'chat',
        getCurrentChatLorebookNames:()=>new Set(['A']),getRequestHeaders:()=>({}),
        fetch:async(url,options)=>{
            const {name}=JSON.parse(options.body);
            reads++;
            return {ok:true,json:async()=>url.endsWith('/list')?[...disk.keys()].map(file_id=>({file_id})):
                structuredClone(disk.get(name)??{entries:{}})};
        },
        saveWorldInfo:async(name,data)=>{
            saves++;cache.set(name,data);
            if(!dropSave)disk.set(name,structuredClone(data));
        },tr:(_key,fallback,vars)=>fallback.replace('{{name}}',vars?.name??'').replace('{{books}}',vars?.books??''),
        console,
    });
    vm.runInContext(section('async function loadRollbackWorldInfo(', '\nfunction describeRollbackMemory(')+
        section('async function saveMemoryRollbackLorebooks(', '\nasync function waitForMemoryRollbackIdle('),context);
    return {context,disk,cache,stats:()=>({saves,reads}),failSave:()=>{dropSave=true;}};
}
test('Original drafts are detached from cache and verified from disk before/after save',async()=>{
    const h=originalHarness(),states=await h.context.loadMemoryRollbackLorebooks({});
    states[0].data.entries[1].content='draft';
    assert.equal(h.cache.get('A').entries[1].content,'old A');
    await h.context.revalidateMemoryRollbackLorebooks(states);
    await h.context.saveMemoryRollbackLorebooks(states);
    assert.deepEqual(h.disk.get('A'),book('draft'));
    assert.equal(h.stats().saves,1);
    assert.ok(h.stats().reads>=4);
});
test('Original rejects pending native edits or newer server versions without writing',async()=>{
    for(const target of ['cache','disk']){
        const h=originalHarness(),states=await h.context.loadMemoryRollbackLorebooks({});
        states[0].data.entries[1].content='draft';
        h[target].set('A',book('other editor'));
        await assert.rejects(h.context.saveMemoryRollbackLorebooks(states),/changed|conflict/);
        assert.equal(h.stats().saves,0);
        assert.deepEqual(h[target].get('A'),book('other editor'));
    }
});
test('Original detects a silent HTTP failure and restores the optimistic cache',async()=>{
    const h=originalHarness(),states=await h.context.loadMemoryRollbackLorebooks({});
    states[0].data.entries[1].content='draft';h.failSave();
    await assert.rejects(h.context.saveMemoryRollbackLorebooks(states),/Read-back mismatch/);
    assert.deepEqual(h.disk.get('A'),book('old A'));
    assert.deepEqual(h.cache.get('A'),book('old A'));
});
test('a missing World Info file is not mistaken for an empty book',async()=>{
    const h=originalHarness();
    h.disk.delete('A');
    await assert.rejects(h.context.loadMemoryRollbackLorebooks({}),/no longer exists/);
    assert.equal(h.stats().saves,0);
});
