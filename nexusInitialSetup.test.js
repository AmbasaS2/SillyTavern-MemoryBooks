// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only

import test from 'node:test';
import assert from 'node:assert/strict';
import { canInitializeNexusBooks, initialNexusBookNames, commitInitialNexusBooks } from './nexusInitialSetup.js';
import { validateSlothSceneResponse, validateSlothSceneKeywords } from './nexusSlothScenePrompt.js';

const avatar='Mira.png';
const ref={type:'character',avatarUrl:avatar,fileName:'first'};
const key='character:Mira.png:first';
const character={name:'Mira / Vue',avatar};
const eligible={ref,key,character,settings:{},worldInfo:{}};

test('bootstrap only accepts a pristine individual chat without a previous binding',()=>{
    assert.equal(canInitializeNexusBooks(eligible),true);
    for(const change of [
        {ref:{...ref,type:'group'}}, {ref:{...ref,avatarUrl:'Other.png'}},
        {chatBook:'Old chat book'}, {markers:{highestMemoryProcessed:0}},
        {markers:{manualLorebook:'Old manual book'}}, {markers:{slothCollection:{}}},
        {worldInfo:{charLore:[{name:'Mira',extraBooks:['Missing auxiliary book']}]}},
        {character:{...character,data:{extensions:{world:'Missing primary book'}}}},
        {character:{...character,data:{character_book:{entries:[]}}}},
        {settings:{nexusCharacterRoles:{[avatar]:{nexus:'Missing Nexus'}}}},
        {settings:{characterMemoryBookLocks:{[avatar]:{characterName:'Mira',lorebookName:'Missing book'}}}},
        {settings:{nexusChatRoleOverrides:{[key]:{version:1,avatar,nexus:'Alternate'}}}},
    ])assert.equal(canInitializeNexusBooks({...eligible,...change}),false,JSON.stringify(change));
});

function harness(){
    const names=initialNexusBookNames(character,'0123456789ab');
    const drafts=[{name:names.nexus,staged:{entries:{1:{content:'An established promise'}}}},
        {name:names.memory,staged:{entries:{}}}];
    const books=new Map([['Unrelated',{entries:{1:{content:'Preserve exactly'}}}]]);
    const writes=[], links=[];
    const deps={
        list:async()=>Array.from(books.keys()),
        load:async name=>structuredClone(books.get(name)),
        save:async(name,data)=>{writes.push(name);books.set(name,structuredClone(data));},
        verifyOrigin:()=>{},
        verifyUnbound:async()=>{},
        withLocks:async(_keys,run)=>run(),
        link:async()=>{
            assert.ok(drafts.every(state=>books.has(state.name)));
            links.push(names);
        },
    };
    return {names,drafts,books,writes,links,deps};
}

test('first collection verifies both approved drafts before linking, including an empty Memory',async()=>{
    const h=harness();
    const result=await commitInitialNexusBooks(h.drafts,h.deps);
    assert.deepEqual(result.saved,[h.names.nexus,h.names.memory]);
    assert.equal(h.links.length,1);
    assert.equal(h.books.get('Unrelated').entries[1].content,'Preserve exactly');
    assert.deepEqual(h.books.get(h.names.memory).entries,{});
    assert.doesNotMatch(h.names.nexus,/[\\/]/);
});

test('a late same-name book is preserved and partial creation never links',async()=>{
    const h=harness(), save=h.deps.save;
    h.deps.save=async(name,data)=>{
        await save(name,data);
        h.books.set(h.names.memory.toUpperCase(),{entries:{2:{content:'Other edit'}}});
    };
    await assert.rejects(commitInitialNexusBooks(h.drafts,h.deps),{partialRecovery:true});
    assert.deepEqual(h.writes,[h.names.nexus]);
    assert.equal(h.links.length,0);
    assert.equal(h.books.get(h.names.memory.toUpperCase()).entries[2].content,'Other edit');
});

test('a persistence error after one new book is recorded leaves it recoverable',async()=>{
    const h=harness(), save=h.deps.save;
    h.deps.save=async(name,data)=>{
        await save(name,data);
        if(name===h.names.nexus)throw new Error('Response lost');
    };
    await assert.rejects(commitInitialNexusBooks(h.drafts,h.deps),/Response lost.*Nexus/);
    assert.equal(h.books.has(h.names.nexus),true);
    assert.equal(h.books.has(h.names.memory),false);
    assert.equal(h.links.length,0);
});

test('the second book and bindings stay untouched if chat changes after the first write',async()=>{
    const h=harness();
    h.deps.verifyOrigin=()=>{if(h.writes.length)throw new Error('Chat changed');};
    await assert.rejects(commitInitialNexusBooks(h.drafts,h.deps),/Chat changed/);
    assert.deepEqual(h.writes,[h.names.nexus]);
    assert.equal(h.links.length,0);
});

test('a lorebook changed while writing character links is never reported as verified',async()=>{
    const h=harness();
    h.deps.link=async()=>h.books.get(h.names.nexus).entries[1].content='Other writer';
    await assert.rejects(commitInitialNexusBooks(h.drafts,h.deps),/changed during linking/);
    assert.equal(h.books.get(h.names.nexus).entries[1].content,'Other writer');
});

test('the original Scene schema and five editable retrieval keywords are enforced',()=>{
    const response={
        title:'Unknown | The pledge',
        content:'**Timeline**: Unknown\n\n**Scene**\nShe folded the note and accepted the task.\n\n**Result**\nShe accepted the task.',
        keywords:['sealed note','bent pin','midnight promise','coal shed','blue thread'],
    };
    assert.deepEqual(validateSlothSceneResponse(response).keywords,response.keywords);
    assert.throws(()=>validateSlothSceneResponse({...response,extra:''}),/format/);
    assert.throws(()=>validateSlothSceneResponse({...response,content:response.content.replace('**Timeline**:','**Timeline**')}),/format/);
    assert.throws(()=>validateSlothSceneKeywords([...response.keywords.slice(0,4),'SEALED NOTE']),/five distinct/);
    assert.throws(()=>validateSlothSceneKeywords(response.keywords.slice(1)),/five distinct/);
});
