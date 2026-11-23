// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {commitSlothNexusMigration} from './nexusLegacyMigrationCommit.js';

function harness(){
    const original={entries:{1:{uid:1,comment:'Long-Term Memory',content:'old',constant:true}}};
    const staged={entries:{1:{...original.entries[1],disable:true},
        2:{uid:2,comment:'Core Memory',content:'old',constant:true}}};
    const state={name:'Nexus',original,staged};
    let onDisk=structuredClone(original),writes=0,locks=0,cache=null;
    const fns={
        loadFresh:async()=>structuredClone(onDisk),
        save:async(_name,data)=>{writes++;onDisk=structuredClone(data);},
        withLock:async(_name,fn)=>{locks++;return fn();},
        verifyOrigin:()=>{},
        resetCache:async(_name,data)=>{cache=structuredClone(data);},
    };
    return {state,fns,get disk(){return onDisk;},set disk(value){onDisk=structuredClone(value);},
        get writes(){return writes;},get locks(){return locks;},get cache(){return cache;}};
}
test('migration reads and verifies Nexus before and after exactly one save',async()=>{
    const h=harness();
    assert.equal((await commitSlothNexusMigration(h.state,h.fns)).success,true);
    assert.equal(h.writes,1);assert.equal(h.locks,1);
    assert.deepEqual(h.disk,h.state.staged);
});

test('concurrent mutation blocks migration before any write',async()=>{
    const h=harness();
    h.fns.loadFresh=async()=>({entries:{0:{content:'changed'}}});
    await assert.rejects(()=>commitSlothNexusMigration(h.state,h.fns),/changed/);
    assert.equal(h.writes,0);
});

test('failed save that persisted is safely compensated and cache repaired',async()=>{
    const h=harness();
    let count=0;
    h.fns.save=async(_name,data)=>{
        count++;h.disk=data;
        if(count===1) throw new Error('connection dropped after persistence');
    };
    await assert.rejects(()=>commitSlothNexusMigration(h.state,h.fns),/original was restored/);
    assert.equal(count,2);
    assert.deepEqual(h.cache,h.state.original);
});

test('a third-party write is never overwritten; partial recovery is reported',async()=>{
    const h=harness(),external={entries:{8:{uid:8,content:'new data from someone else'}}};
    let calls=0;
    h.fns.save=async()=>{calls++;throw new Error('server uncertain');};
    h.fns.loadFresh=async()=>calls?external:h.state.original;
    await assert.rejects(()=>commitSlothNexusMigration(h.state,h.fns),error=>{
        assert.equal(error.partialRecovery,true);
        assert.match(error.message,/unsafe/);
        return true;
    });
    assert.equal(calls,1);
});

test('originating chat/roles must still match before commit',async()=>{
    const h=harness();
    h.fns.verifyOrigin=()=>{throw new Error('Switched character');};
    await assert.rejects(()=>commitSlothNexusMigration(h.state,h.fns),/Switched character/);
    assert.equal(h.writes,0);
});
