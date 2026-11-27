// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {stageMemoryScenes,stageNexusEdits,getSlothHideRanges,normalizeSlothVisibleTail,
    fingerprintSlothChat,fingerprintSlothReviewedRanges} from './nexusCollectionPolicy.js';
import {isCompletedSceneEntry,sceneNumberFromTitle} from './nexusSceneRotation.js';
import {validateSlothSceneResponse} from './nexusSlothScenePrompt.js';
import {commitSlothBooks} from './nexusCollectionCommit.js';
import {commitSlothNexusMigration} from './nexusLegacyMigrationCommit.js';
import {stableHashString} from './clipReviewPolicy.js';
import * as recovery from './slothSingleRecovery.js';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const runtime=read('./nexusCollectorRuntime.js'),ai=read('./nexusCollectionAI.js');
const section=(src,start,end)=>{const a=src.indexOf(start),b=src.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);return src.slice(a,b);};
const clone=structuredClone,plain=value=>JSON.parse(JSON.stringify(value));
const create=book=>{let uid=0;while(Object.hasOwn(book.entries,uid))uid++;return book.entries[uid]={uid};};
const row=(segments,title='The letter')=>({title,complete:true,reason:'Distinct completed incident',segments,
    timeline:'Unknown',scene:'The letter was delivered.',result:'The letter arrived.',keywords:['letter']});

function harness({openTail=false,brokenScene=false}={}) {
    const ref={type:'character',avatarUrl:'A.png',fileName:'chat-a'};
    const key='chat-a-key';
    const chat=Array.from({length:openTail||brokenScene?4:2},(_,id)=>({name:'A',mes:'Original '+id,is_system:false}));
    const books={N:{entries:{1:{uid:1,comment:'LT 01 | The gate',content:'The gate was open.'},
        2:{uid:2,comment:'LT 02 | The letter',content:'The letter was expected.'}}},M:{entries:{}}};
    let markers={},calls=0,dialogs=0;
    const logs=[];
    const good={kind:'lt',action:'append',uid:1,text:'The gate was closed.'};
    const bad={kind:'lt',action:'append',uid:99,text:'The letter arrived.'};
    const response={events:[row([0,1]),...(brokenScene?[row([2,99],'The second letter')]:openTail?[{complete:false,segments:[2,3],reason:'Unfinished'}]:[])],edits:[good,bad]};
    const compose=vm.runInNewContext([
        section(ai,'function canonicalizeNewNexusTitles(','function parseStrictJSON('),
        section(ai,'function readSlothBatchScenes(','\n/**'),
        section(ai,'function readSlothNexusEdits(','async function reviewSlothSceneDrafts('),
        section(ai,'export async function composeSingleSlothCollection(','export async function retryApprovedSlothScenes(').replace('export async','async'),
        'composeSingleSlothCollection',
    ].join('\n'),{
        ...recovery,stageNexusEdits,validateSlothSceneResponse,isCompletedSceneEntry,sceneNumberFromTitle,
        DEFAULT_SLOTH_COLLECTION_PROMPTS:{plan:'Plan'},getActiveSlothSummaryPreset:()=>({text:'Summary'}),
        SCENE_KEYWORD_GUIDANCE:'Keywords',compact:JSON.stringify,slothNexusGuidance:({nexus})=>JSON.stringify(nexus),
        requester:()=>async(_prompt,phase,parse)=>{calls++;return parse(JSON.stringify(response),phase);},
        getTokenCountAsync:async()=>123,console:{warn(){}},
    });
    const makeRun=()=>vm.runInNewContext([
        section(runtime,'const slothPaidDrafts=new Map();','async function choosePaidSlothDraft('),
        section(runtime,'function assertOrigin(','const legacyPairKey'),
        section(runtime,'const legacyPairKey','function readableSegments('),
        section(runtime,'async function readStoredSlothChat(','function assertSlothBookRoles('),
        section(runtime,'export async function runNexusCollector(','function isVisibleSceneMessage(').replace('export async','async'),
        'runNexusCollector',
    ].join('\n'),{
        ...recovery,structuredClone:clone,chat,stableHashString,stringify:JSON.stringify,collectorBusy:false,
        getSceneMarkers:()=>markers,getStmbChatKey:()=>key,getCurrentStmbChatRef:()=>ref,
        extension_settings:{STMemoryBooks:{moduleSettings:{slothHideAfter:true,slothHideRecent:0}}},
        getNexusRoleResolutionForChatRef:role=>({state:'ready',name:role==='nexus'?'N':'M'}),
        canStartNexusSetup:()=>false,getMemoryBooksMode:()=> 'sloth',getActiveNexusRoleContext:()=>({character:{}}),
        initialCharacterContext:()=>'',collectionProfile:()=>({}),getAutomaticCheckpointThrough:()=>-1,
        createAutomaticTokenCounter:()=>()=>0,getTokenCountAsync:async()=>0,automaticReadingRevision:0,
        loadServerWorld:async name=>clone(books[name]),splitSlothCollectionSource:async source=>[source],
        getRequestHeaders:()=>({}),fetch:async()=>({ok:true,json:async()=>clone([{chat_metadata:{STMemoryBooks:markers}},...chat])}),
        patchStmbMetadataForChatRef:async(_ref,patch)=>{markers=clone(patch(markers));},
        choosePaidSlothDraft:async(record,_binding,_signal,options)=>{
            dialogs++;
            assert.equal(options?.partialReplay,true,'must be editable even after all source messages are hidden');
            const pending=JSON.parse(record.raw);
            assert.deepEqual(pending.edits,[bad]);
            assert.ok(!pending.events.some(e=>e.title==='The letter'));
            pending.edits=[{...bad,uid:2}];
            if(brokenScene)pending.events[0].segments=[2,3];
            return {raw:JSON.stringify(pending)};
        },
        composeSingleSlothCollection:compose,stageMemoryScenes,stageNexusEdits,isCompletedSceneEntry,
        fingerprintSlothChat,fingerprintSlothReviewedRanges,getSlothHideRanges,normalizeSlothVisibleTail,
        getRunnableSlothSidePresets:()=>[],createWorldInfoEntry:(_name,book)=>create(book),
        saveWorldInfo:async(name,book)=>{books[name]=clone(book);},
        commitSlothBooks,commitSlothNexusMigration,withStmbWriteLane:async(_key,task)=>task(),withBothWriteLanes:async(_names,task)=>task(),
        assertReviewedCache:()=>{},worldInfoCache:new Map(),hideChatMessageRange:async(a,b)=>{for(let i=a;i<=b;i++)chat[i].is_system=true;},
        reloadEditor:()=>{},invalidateSlothAutomaticProgress:()=>{},settleSlothAutoAttempt:async()=>{},
        setSlothCollectionProgress:()=>{},t:s=>s,toastr:{info:s=>logs.push(s),warning:s=>logs.push(s),success:s=>logs.push(s)},console:{warn(){}},
    });
    return {chat,books,logs,run:()=>makeRun()({}),get markers(){return markers;},get calls(){return calls;},get dialogs(){return dialogs;}};
}

test('partial commit then reload recovers only pending Nexus edit even with zero visible source and no new request',async()=>{
    const h=harness();
    const first=await h.run();
    assert.equal(first.saved,true);
    assert.equal(first.hiddenMessages,2);
    assert.equal(first.skippedNexusEdits,1);
    assert.equal(h.calls,1);
    assert.equal(Object.keys(h.books.M.entries).length,1);
    assert.ok(h.chat.every(m=>m.is_system));
    assert.ok(h.markers.slothCollectionDraft.partial);
    assert.match(h.logs.find(s=>s.includes('Hidden:')),/Hidden: 2 messages/);
    const memory=clone(h.books.M);
    const second=await h.run();
    assert.equal(second.saved,true);
    assert.equal(second.skippedNexusEdits,0);
    assert.equal(h.calls,1);
    assert.equal(h.dialogs,1);
    assert.deepEqual(h.books.M,memory);
    assert.equal(h.books.N.entries[1].content,'The gate was open.\n\nThe gate was closed.');
    assert.equal(h.books.N.entries[2].content,'The letter was expected.\n\nThe letter arrived.');
    assert.deepEqual(h.markers.slothCollection.savedRanges,[[0,1]]);
    assert.equal(h.markers.slothCollectionDraft,undefined);
});
test('repairing a malformed Scene after partial save restores only its original pending coverage',async()=>{
    const h=harness({brokenScene:true});
    const first=await h.run();
    assert.equal(first.saved,true);assert.equal(first.skippedScenes,1);
    assert.equal(Object.keys(h.books.M.entries).length,1);
    const previous=Object.values(h.books.M.entries)[0];
    const second=await h.run();
    assert.equal(second.saved,true);assert.equal(second.skippedScenes,0);
    assert.equal(h.calls,1);
    assert.equal(Object.keys(h.books.M.entries).length,2);
    assert.equal(h.books.M.entries[previous.uid].content,previous.content);
    assert.deepEqual(h.markers.slothCollection.savedRanges,[[0,3]]);
    assert.equal(h.markers.slothCollectionDraft,undefined);
});
test('independent lorebook change invalidates the partial receipt instead of silently replaying',async()=>{
    const h=harness({openTail:true});
    await h.run();
    h.books.N.entries[1].content+=' Independent edit.';
    await assert.rejects(h.run(),/must be editable even after all source messages are hidden/);
    assert.equal(h.calls,1);
    assert.equal(h.books.N.entries[2].content,'The letter was expected.');
});
