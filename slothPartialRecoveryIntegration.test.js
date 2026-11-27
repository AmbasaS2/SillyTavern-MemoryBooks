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
import {createHash} from 'node:crypto';
import {createSlothRecoveryStore,selectSlothRecoveryRecord,slothRecoveryFileName} from './slothRecoveryStore.js';
import * as recovery from './slothSingleRecovery.js';
import {assertSlothNexusEvidence} from './slothNexusEvidence.js';
import {createSlothCollectionRun,addSlothRequestMetric,makeSlothRequestMetric} from './slothCollectionStats.js';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const runtime=read('./nexusCollectorRuntime.js'),ai=read('./nexusCollectionAI.js');
const section=(src,start,end)=>{const a=src.indexOf(start),b=src.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);return src.slice(a,b);};
const clone=structuredClone,plain=value=>JSON.parse(JSON.stringify(value));
const sha256=text=>createHash('sha256').update(text).digest('hex');
const create=book=>{let uid=0;while(Object.hasOwn(book.entries,uid))uid++;return book.entries[uid]={uid};};
const row=(segments,title='The letter')=>({title,complete:true,reason:'Distinct completed incident',segments,
    timeline:'Unknown',scene:'The letter was delivered.',result:'The letter arrived.',keywords:['letter']});

function harness({openTail=false,brokenScene=false,editOnRecovery=false,editOnResponse=false,editAfterBookCommit=false,extraHidden=false,
    failUpload=false,failRead=false,legacyDraft=false,importantLt=false}={}) {
    const ref={type:'character',avatarUrl:'A.png',fileName:'chat-a'};
    const key='chat-a-key';
    const chat=Array.from({length:openTail||brokenScene?4:2},(_,id)=>({name:'A',mes:'Original '+id,is_system:false}));
    if(extraHidden)chat.push({name:'A',mes:'Previously hidden message',is_system:true});
    let diskChat=clone(chat),diskMarkers={},metadataWrites=0,bookWrites=0,fileWrites=0;
    const files=new Map(),fileName=slothRecoveryFileName(key,sha256);
    const recoveryRecord=()=>files.has(fileName)?JSON.parse(files.get(fileName)).record:null;
    const books={N:{entries:{1:{uid:1,comment:'LT 01 | The gate',content:'The gate was open.'},
        2:{uid:2,comment:'LT 02 | The letter',content:'The letter was expected.'}}},M:{entries:{}}};
    let markers={},calls=0,dialogs=0;
    const logs=[],stats=[];
    const good={kind:'lt',action:'append',uid:1,text:'The gate was closed.'};
    const bad=importantLt?{kind:'lt',action:'replace_exact',uid:2,find:'The letter was expected.',text:'The letter was promised.',risk:'ordinary'}:{kind:'lt',action:'append',uid:99,text:'The letter arrived.'};
    const response={events:[row([0,1]),...(brokenScene?[row([2,99],'The second letter')]:openTail?[{complete:false,segments:[2,3],reason:'Unfinished'}]:[])],edits:[good,bad]};
    if(legacyDraft){
        const digest=value=>{const json=typeof value==='string'?value:JSON.stringify(value);return [json.length,stableHashString(json)];};
        const ids=chat.map((_m,id)=>id).filter(id=>!chat[id].is_system);
        markers.slothCollectionDraft={version:1,binding:{chatKey:key,roles:{memory:'M',nexus:'N'},source:ids,
            fingerprint:digest(fingerprintSlothChat(chat,ids)),books:[digest(books.N),digest(books.M)]},
            raw:JSON.stringify({...response,edits:[good]}),receivedAt:1};
        diskMarkers=clone(markers);
    }
    const compose=vm.runInNewContext([
        section(ai,'function canonicalizeNewNexusTitles(','function parseStrictJSON('),
        section(ai,'function readSlothBatchScenes(','\n/**'),
        section(ai,'function readSlothNexusEdits(','async function reviewSlothSceneDrafts('),
        section(ai,'export async function composeSingleSlothCollection(','export async function retryApprovedSlothScenes(').replace('export async','async'),
        'composeSingleSlothCollection',
    ].join('\n'),{
        ...recovery,stageNexusEdits,assertSlothNexusEvidence,validateSlothSceneResponse,isCompletedSceneEntry,sceneNumberFromTitle,
        DEFAULT_SLOTH_COLLECTION_PROMPTS:{plan:'Plan'},getActiveSlothSummaryPreset:()=>({text:'Summary'}),
        SCENE_KEYWORD_GUIDANCE:'Keywords',compact:JSON.stringify,slothNexusGuidance:({nexus})=>JSON.stringify(nexus),
        requester:(_p,_s,_sig,_single,_usage,_verify,onRequestMetric)=>async(_prompt,phase,parse)=>{
            onRequestMetric?.(makeSlothRequestMetric({phase:'collection',model:'mock-model',full:{usage:{prompt_tokens:123,completion_tokens:20}},durationMs:50}));
            calls++;if(editOnResponse)diskChat.at(-1).mes='External edit during model request.';
            return parse(JSON.stringify(response),phase);
        },
        getTokenCountAsync:async()=>123,console:{warn(){}},
    });
    const makeRun=()=>vm.runInNewContext([
        section(runtime,'const slothPaidDrafts=new Map();','async function choosePaidSlothDraft(').replace(/export (async )?function/g,(_,a='')=>a+'function'),
        section(runtime,'function assertOrigin(','const legacyPairKey'),
        section(runtime,'const legacyPairKey','function readableSegments('),
        section(runtime,'async function readStoredSlothChat(','function assertSlothBookRoles('),
        section(runtime,'export async function runNexusCollector(','function isVisibleSceneMessage(').replace('export async','async'),
        'runNexusCollector',
    ].join('\n'),{
        ...recovery,createSlothRecoveryStore,selectSlothRecoveryRecord,sha256,structuredClone:clone,chat,stableHashString,stringify:JSON.stringify,collectorBusy:false,
        createSlothCollectionRun,addSlothRequestMetric,recordSlothCollectionRun:run=>stats.push(clone(run)),
        getSceneMarkers:()=>markers,getStmbChatKey:()=>key,getCurrentStmbChatRef:()=>ref,
        extension_settings:{STMemoryBooks:{moduleSettings:{slothHideAfter:true,slothHideRecent:0}}},
        getNexusRoleResolutionForChatRef:role=>({state:'ready',name:role==='nexus'?'N':'M'}),
        canStartNexusSetup:()=>false,getMemoryBooksMode:()=> 'sloth',getActiveNexusRoleContext:()=>({character:{}}),
        hasPendingSlothSideRename:()=>false,assertSideRenameReady:()=>{},
        initialCharacterContext:()=>'',collectionProfile:()=>({}),getAutomaticCheckpointThrough:()=>-1,
        createAutomaticTokenCounter:()=>()=>0,getTokenCountAsync:async()=>0,automaticReadingRevision:0,
        loadServerWorld:async name=>clone(books[name]),splitSlothCollectionSource:async source=>[source],
        getRequestHeaders:()=>({}),fetch:async(url,options)=>{
            if(url.startsWith('/user/files/')){
                if(failRead)return {ok:false,status:503};
                const name=url.slice('/user/files/'.length);
                return files.has(name)?{ok:true,status:200,text:async()=>files.get(name)}:{ok:false,status:404};
            }
            if(url==='/api/files/upload'){
                if(failUpload)return {ok:false,status:503};
                const {name,data}=JSON.parse(options.body);
                files.set(name,Buffer.from(data,'base64').toString('utf8'));fileWrites++;
                return {ok:true,status:200};
            }
            assert.equal(url,'/api/chats/get');
            return {ok:true,json:async()=>clone([{chat_metadata:{STMemoryBooks:diskMarkers}},...diskChat])};
        },
        patchStmbMetadataForChatRef:async(_ref,patch)=>{
            const next=await patch(markers);
            markers=clone(next);diskMarkers=clone(next);diskChat=clone(chat);metadataWrites++;
        },
        choosePaidSlothDraft:async(record,_binding,_signal,options)=>{
            dialogs++;
            if(legacyDraft&&!options?.partialReplay){
                return {raw:record.raw};
            }
            if(editOnRecovery)diskChat.at(-1).mes='External edit while recovery was open.';
            assert.equal(options?.partialReplay,true,'must be editable even after all source messages are hidden');
            const pending=JSON.parse(record.raw);
            assert.deepEqual(pending.edits,[bad]);
            assert.ok(!pending.events.some(e=>e.title==='The letter'));
            pending.edits=importantLt?[{...bad,text:'The letter was received.',evidence:[{messageId:1,quote:'Original 1'}]}]:[{...bad,uid:2}];
            if(brokenScene)pending.events[0].segments=[2,3];
            return {raw:JSON.stringify(pending)};
        },
        composeSingleSlothCollection:compose,stageMemoryScenes,stageNexusEdits,isCompletedSceneEntry,
        fingerprintSlothChat,fingerprintSlothReviewedRanges,getSlothHideRanges,normalizeSlothVisibleTail,
        getRunnableSlothSidePresets:()=>[],createWorldInfoEntry:(_name,book)=>create(book),
        saveWorldInfo:async(name,book)=>{
            books[name]=clone(book);bookWrites++;
            if(editAfterBookCommit&&bookWrites===2)diskChat.at(-1).mes='External edit after book commit.';
        },
        commitSlothBooks,commitSlothNexusMigration,withStmbWriteLane:async(_key,task)=>task(),withBothWriteLanes:async(_names,task)=>task(),
        assertReviewedCache:()=>{},worldInfoCache:new Map(),hideChatMessageRange:async(a,b)=>{
            for(let i=a;i<=b;i++)chat[i].is_system=true;
            diskChat=clone(chat);
        },
        reloadEditor:()=>{},invalidateSlothAutomaticProgress:()=>{},settleSlothAutoAttempt:async()=>{},
        setSlothCollectionProgress:()=>{},t:s=>s,toastr:{info:s=>logs.push(s),warning:s=>logs.push(s),success:s=>logs.push(s)},console:{warn(){}},
    });
    const session=makeRun();
    return {chat,books,logs,stats,run:()=>makeRun()({}),runSameSession:()=>session({}),allowUpload:()=>{failUpload=false;},
        get diskChat(){return diskChat;},get metadataWrites(){return metadataWrites;},get recoveryRecord(){return recoveryRecord();},
        get fileWrites(){return fileWrites;},get bookWrites(){return bookWrites;},get markers(){return markers;},get calls(){return calls;},get dialogs(){return dialogs;}};
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
    assert.ok(h.recoveryRecord.partial);
    assert.equal(h.metadataWrites,1,'only the collected ledger writes chat metadata');
    assert.equal(h.markers.slothCollectionDraft,undefined);
    assert.equal(h.fileWrites,2,'initial raw response and verified partial receipt');
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
    assert.equal(h.recoveryRecord,null);
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
    assert.equal(h.recoveryRecord,null);
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

test('server edit while the partial recovery dialog is open is never overwritten by draft metadata save',async()=>{
    const h=harness({editOnRecovery:true});
    await h.run();
    const books=clone(h.books),writes=h.metadataWrites,bookWrites=h.bookWrites;
    await assert.rejects(h.run(),/saved chat changed outside this tab/);
    assert.equal(h.metadataWrites,writes);
    assert.equal(h.bookWrites,bookWrites);
    assert.deepEqual(h.books,books);
    assert.equal(h.diskChat.at(-1).mes,'External edit while recovery was open.');
    assert.equal(h.calls,1);
    assert.ok(h.recoveryRecord.partial);
});
test('already hidden source outside the recovery scope is included in the whole-chat guard',async()=>{
    const h=harness({editOnRecovery:true,extraHidden:true});
    await h.run();
    const writes=h.metadataWrites,books=clone(h.books);
    await assert.rejects(h.run(),/saved chat changed outside this tab/);
    assert.equal(h.metadataWrites,writes);
    assert.deepEqual(h.books,books);
    assert.equal(h.diskChat.at(-1).mes,'External edit while recovery was open.');
});
test('a paid response arriving after an external edit never saves stale chat or books',async()=>{
    const h=harness({editOnResponse:true});
    await assert.rejects(h.run(),/saved chat changed outside this tab/);
    assert.equal(h.calls,1);
    assert.equal(h.metadataWrites,0);
    assert.equal(h.bookWrites,0);
    assert.equal(h.diskChat.at(-1).mes,'External edit during model request.');
    assert.ok(h.recoveryRecord.raw,'paid response is durable despite stale chat');
    assert.equal(h.fileWrites,1);
});
test('external edit after books commit blocks receipt, draft cleanup and Hide writes',async()=>{
    const h=harness({editAfterBookCommit:true});
    const first=await h.run();
    assert.equal(first.saved,true);
    assert.equal(first.receiptVerified,false);
    assert.equal(first.hiddenMessages,null);
    assert.equal(h.metadataWrites,0,'paid response and partial receipt must not write chat metadata');
    assert.ok(h.recoveryRecord.partial);
    assert.ok(h.diskChat.every(m=>!m.is_system));
    assert.equal(h.diskChat.at(-1).mes,'External edit after book commit.');
});

test('legacy metadata draft can be recovered without a paid request or a draft-only chat save',async()=>{
    const h=harness({legacyDraft:true});
    const result=await h.run();
    assert.equal(result.saved,true);
    assert.equal(h.calls,0);
    assert.equal(h.dialogs,1);
    assert.equal(h.metadataWrites,1);
    assert.equal(h.recoveryRecord,null);
    assert.ok(h.markers.slothCollectionDraft,'do not rewrite chat merely to remove the legacy copy');
    const again=await h.run();
    assert.equal(again.saved,false);
    assert.equal(again.reason,'no-source');
    assert.equal(h.dialogs,1,'the cleared independent marker suppresses the old legacy copy');
    assert.equal(h.calls,0);
});
test('an unavailable recovery file blocks a new paid request',async()=>{
    const h=harness({failRead:true});
    await assert.rejects(h.run(),/Could not verify the recovery file/);
    assert.equal(h.calls,0);
    assert.equal(h.metadataWrites,0);
    assert.equal(h.bookWrites,0);
});
test('an upload failure stops before books are written and retains the paid response in the current tab',async()=>{
    const h=harness({failUpload:true});
    await assert.rejects(h.runSameSession(),/recovery file is not verified/);
    assert.equal(h.calls,1);
    assert.equal(h.metadataWrites,0);
    assert.equal(h.bookWrites,0);
    assert.equal(h.fileWrites,0);
    assert.ok(h.logs.some(line=>line.includes('retained in this tab only')));
});

test('collection statistics distinguish verified writes, held rows and replay without counting the original call twice',async()=>{
    const h=harness();
    await h.run();
    assert.equal(h.stats.length,1);
    const first=h.stats[0];
    assert.equal(first.status,'partial');assert.equal(first.groups.collection.requests,1);
    assert.equal(first.groups.collection.values.input.reported,123);
    assert.equal(first.counts.sceneCreated,1);assert.equal(first.counts.nexusUpdated,1);
    assert.equal(first.counts.nexusHeld,1);assert.equal(first.source.messageCount,2);
    await h.run();
    const replay=h.stats[1];
    assert.equal(replay.trigger,'recovery');assert.equal(replay.groups.collection.requests,0);
    assert.equal(replay.counts.sceneCreated,0);assert.equal(replay.counts.sceneReused,1);
    assert.equal(replay.counts.nexusUpdated,1);assert.equal(replay.status,'recovered');assert.equal(h.calls,1);
});

test('v4 partial LT hold retains original, policy version and previously saved Scene across a new session',async()=>{
    const h=harness({importantLt:true});
    const first=await h.run();
    assert.equal(first.saved,true);assert.equal(first.skippedNexusEdits,1);
    assert.equal(h.recoveryRecord.evidencePolicyVersion,4);
    assert.equal(h.books.N.entries[2].content,'The letter was expected.');
    assert.match(h.recoveryRecord.originalRaw,/The letter was promised/);
    assert.match(JSON.stringify(h.recoveryRecord.raw),/needs one to three/);
    assert.equal(h.stats[0].evidencePolicyVersion,4);
    const memory=clone(h.books.M);
    const second=await h.run();
    assert.equal(second.saved,true);assert.equal(second.skippedNexusEdits,0);
    assert.equal(h.calls,1);
    assert.deepEqual(h.books.M,memory);
    assert.equal(h.books.N.entries[2].content,'The letter was received.');
    assert.equal(h.recoveryRecord,null);
    assert.equal(h.stats[1].evidencePolicyVersion,4);
    assert.equal(h.stats[1].groups.collection.requests,0);
});
