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

test('a second-book edit during the first save is preserved',async()=>{
    const h=make(),save=h.deps.save;
    h.deps.save=async(name,book)=>{
        await save(name,book);
        if(name==='Memory'&&book.entries[1].content==='NEW-M'){
            h.db.get('Nexus').entries[1].content='OTHER-N';
        }
    };
    await assert.rejects(commitSlothBooks(h.states,h.deps),/conflict in Nexus/);
    assert.deepEqual(h.writes,['Memory','Memory']);
    assert.equal(h.db.get('Memory').entries[1].content,'OLD-M');
    assert.equal(h.db.get('Nexus').entries[1].content,'OTHER-N');
});

test('a first-book edit during the second save prevents a success receipt',async()=>{
    const h=make(),save=h.deps.save;
    h.deps.save=async(name,book)=>{
        await save(name,book);
        if(name==='Nexus'&&book.entries[1].content==='NEW-N'){
            h.db.get('Memory').entries[1].content='OTHER-M';
        }
    };
    await assert.rejects(commitSlothBooks(h.states,h.deps),{partialRecovery:true});
    assert.deepEqual(h.writes,['Memory','Nexus','Nexus']);
    assert.equal(h.db.get('Nexus').entries[1].content,'OLD-N');
    assert.equal(h.db.get('Memory').entries[1].content,'OTHER-M');
});

test('switching chats during the final server read rolls back without advancing collection',async()=>{
    const h=make(),loadFresh=h.deps.loadFresh;
    let active=true;
    h.deps.loadFresh=async name=>{
        const book=await loadFresh(name);
        if(name==='Nexus'&&book.entries[1].content==='NEW-N') active=false;
        return book;
    };
    h.deps.verifyOrigin=()=>{if(!active)throw new Error('Chat changed');};
    await assert.rejects(commitSlothBooks(h.states,h.deps),/rolled back.*Chat changed/);
    assert.deepEqual(h.writes,['Memory','Nexus','Nexus','Memory']);
    for(const state of h.states)assert.deepEqual(h.db.get(state.name),state.original);
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
