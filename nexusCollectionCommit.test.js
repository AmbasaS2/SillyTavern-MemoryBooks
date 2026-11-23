import test from 'node:test';
import assert from 'node:assert/strict';
import {commitSlothBooks} from './nexusCollectionCommit.js';
const pairs=()=>[{name:'Nexus',original:{entries:{1:{content:'OLD-N'}}},staged:{entries:{1:{content:'NEW-N'}}}},
    {name:'Memory',original:{entries:{1:{content:'OLD-M'}}},staged:{entries:{1:{content:'NEW-M'}}}}];
const make=(failure='')=>{
    const states=pairs(),db=new Map(states.map(s=>[s.name,structuredClone(s.original)])),writes=[];
    const deps={
        loadFresh:async name=>structuredClone(db.get(name)),
        save:async (name,book)=>{
            if(failure===name)throw new Error('simulated save failure');
            db.set(name,structuredClone(book));writes.push(name);
        },
        verifyOrigin:()=>{},
        withLocks:async (names,task)=>{assert.deepEqual(names,['Memory','Nexus']);return await task();}
    };
    return {states,db,writes,deps};
};
test('both books committed only after fresh preflight',async()=>{
    const h=make(),result=await commitSlothBooks(h.states,h.deps);
    assert.equal(result.success,true);
    assert.equal(h.db.get('Nexus').entries[1].content,'NEW-N');
    assert.equal(h.db.get('Memory').entries[1].content,'NEW-M');
});
test('concurrent Nexus modification blocks both writes',async()=>{
    const h=make();h.db.get('Nexus').entries[1].content='CHANGED';
    await assert.rejects(commitSlothBooks(h.states,h.deps),/conflict/);
    assert.deepEqual(h.writes,[]);
});
test('second write failure restores first book and preserves both original contents',async()=>{
    const h=make('Nexus');
    await assert.rejects(commitSlothBooks(h.states,h.deps),/rolled back/);
    assert.equal(h.db.get('Memory').entries[1].content,'OLD-M');
    assert.equal(h.db.get('Nexus').entries[1].content,'OLD-N');
});
test('read-back mismatch after successful first write triggers recovery',async()=>{
    const h=make(),base=h.deps.save;
    h.deps.save=async(name,book)=>{await base(name,book);if(name==='Memory'&&book.entries[1].content==='NEW-M')h.db.set(name,{entries:{1:{content:'OTHER'}}});};
    await assert.rejects(commitSlothBooks(h.states,h.deps),/Partial data may remain/);
    assert.equal(h.db.get('Nexus').entries[1].content,'OLD-N');
});


test('failed request before HTTP persistence repairs a contaminated UI cache',async()=>{
    const h=make('Memory'),cache=new Map();
    h.deps.resetCache=async(name,original)=>cache.set(name,structuredClone(original));
    await assert.rejects(commitSlothBooks(h.states,h.deps),/rolled back/);
    assert.equal(cache.get('Memory').entries[1].content,'OLD-M');
});
