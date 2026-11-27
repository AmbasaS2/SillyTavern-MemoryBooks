import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import { normalizeSlothSideRename, planSlothSideSettingsRename, stageSlothSideIdentityRename, retargetSlothLorebookRoles } from './slothSideIdentity.js';
import { createMessageDeletionTracker } from './memoryRollback.js';
import { automaticCollectionDue, createAutomaticTokenCounter, createAutomaticTokenUpperBound } from './slothAutomaticCollection.js';

const key = (...parts) => JSON.stringify(parts);
const note = (avatar,chat,uid=1) => ({uid,content:'Keep exactly this.',STMB_slothSideNote:true,
    group:'Diary-'+chat.replace(/\s/g,''),
    STMB_sidePromptHistory:{version:1,templateKey:'sloth-diary',chatKey:key('character',avatar,chat),
        chatId:chat,titleSource:'name',titleBase:'Diary',group:'Diary-'+chat.replace(/\s/g,''),sequence:1}});

test('avatar rename moves only matching settings and dedicated book owner; preserves other characters',()=>{
    const change=normalizeSlothSideRename({type:'avatar',avatar:'A.png',newAvatar:'B.png'});
    const params={slothSideBooks:{[key('A.png','sloth-diary')]:'Notes',[key('C.png','sloth-diary')]:'Other'},
        slothSideCharacterLinks:{[key('A.png','sloth-diary')]:true},slothSideSlots:{'A.png':['sloth-diary']},
        slothSideEntries:{[key('A.png','chat','sloth-diary')]:{book:'Notes',uid:1}}};
    const patch=planSlothSideSettingsRename(params,change);
    assert.equal(patch.slothSideBooks[key('B.png','sloth-diary')],'Notes');
    assert.equal(patch.slothSideBooks[key('C.png','sloth-diary')],'Other');
    assert.equal(patch.slothSideEntries[key('B.png','chat','sloth-diary')].uid,1);
    assert.deepEqual(patch.slothSideSlots,{'B.png':['sloth-diary']});
    const original={extensions:{stmbSlothSideBook:{version:1,avatar:'A.png'}},entries:{1:note('A.png','chat'),2:note('C.png','chat',2)}};
    const staged=stageSlothSideIdentityRename(original,change);
    assert.equal(staged.extensions.stmbSlothSideBook.avatar,'B.png');
    assert.equal(staged.entries[1].STMB_sidePromptHistory.chatKey,key('character','B.png','chat'));
    assert.deepEqual(staged.entries[2],original.entries[2]);
    assert.equal(staged.entries[1].content,original.entries[1].content);
    assert.equal(original.extensions.stmbSlothSideBook.avatar,'A.png');
    assert.equal(stageSlothSideIdentityRename(staged,change),null);
});

test('chat rename strips jsonl, remaps exact history and entry choice, leaves other same-named chats unchanged',()=>{
    const change=normalizeSlothSideRename({type:'chat',avatar:'A.png',oldFile:'Old chat.jsonl',newFile:'New chat.jsonl'});
    assert.equal(change.oldFile,'Old chat');
    const params={slothSideEntries:{[key('A.png','Old chat','sloth-diary')]:{book:'Notes',uid:1},
        [key('C.png','Old chat','sloth-diary')]:{book:'Other',uid:2}}};
    const patch=planSlothSideSettingsRename(params,change);
    assert.equal(patch.slothSideEntries[key('A.png','New chat','sloth-diary')].uid,1);
    const original={entries:{1:note('A.png','Old chat'),2:note('C.png','Old chat',2),3:note('A.png','other',3)}};
    const staged=stageSlothSideIdentityRename(original,change);
    assert.equal(staged.entries[1].STMB_sidePromptHistory.chatId,'New chat');
    assert.equal(staged.entries[1].group,'Diary-Newchat');
    assert.deepEqual(staged.entries[2],original.entries[2]);
    assert.deepEqual(staged.entries[3],original.entries[3]);
});

test('conflicting destination settings or history fail closed',()=>{
    const change=normalizeSlothSideRename({type:'avatar',avatar:'A.png',newAvatar:'B.png'});
    assert.throws(()=>planSlothSideSettingsRename({slothSideSlots:{'A.png':['one'],'B.png':['two']}},change),/conflict/);
    assert.throws(()=>stageSlothSideIdentityRename({entries:{1:note('A.png','chat'),2:note('B.png','chat',2)}},change),/conflict/);
});

test('lorebook rename retargets matching story links without replacing side prompt UIDs or touching another AU',()=>{
    const change=normalizeSlothSideRename({type:'lorebook',oldBook:'Old Nexus',newBook:'New Nexus'});
    const diary=note('A.png','chat');
    diary.STMB_sidePromptHistory.storyKey=key('A.png','Old Nexus','Memory');
    const other=note('A.png','alternate',2);
    other.STMB_sidePromptHistory.storyKey=key('A.png','Separate Nexus','Separate Memory');
    const original={entries:{1:diary,2:other},extensions:{stmbNexusSetup:{version:1,pairedBook:'Old Nexus'}}};
    const staged=stageSlothSideIdentityRename(original,change);
    assert.equal(staged.entries[1].STMB_sidePromptHistory.storyKey,key('A.png','New Nexus','Memory'));
    assert.equal(staged.entries[1].uid,diary.uid);
    assert.equal(staged.entries[1].content,diary.content);
    assert.deepEqual(staged.entries[2],other);
    assert.equal(staged.extensions.stmbNexusSetup.pairedBook,'New Nexus');
    const settings={nexusCharacterRoles:{'A.png':{nexus:'Old Nexus',memory:'Memory'}},
        nexusChatScopedWorlds:{'A.png':['Old Nexus','Separate Nexus']}};
    retargetSlothLorebookRoles(settings,change);
    assert.equal(settings.nexusCharacterRoles['A.png'].nexus,'New Nexus');
    assert.deepEqual(settings.nexusChatScopedWorlds['A.png'],['New Nexus','Separate Nexus']);
    const target=key('A.png','chat','sloth-diary');
    assert.deepEqual(planSlothSideSettingsRename({slothSideEntries:{[target]:{book:'Old Nexus',uid:1}}},change)
        .slothSideEntries[target],{book:'New Nexus',uid:1});
});

test('deletion snapshot only reads the changed text for append/edit and drops inactive snapshots',()=>{
    const tracker=createMessageDeletionTracker();
    let reads=0;
    const message=n=>({get mes(){reads++;return 'message '+n;}});
    const messages=Array.from({length:1000},(_,i)=>message(i));
    tracker.snapshot('A',messages);
    assert.equal(reads,1000);
    messages.push(message(1000)); tracker.snapshot('A',messages,1000);
    assert.equal(reads,1001);
    messages[100]=message(10001); tracker.snapshot('A',messages,100);
    assert.equal(reads,1002);
    messages.splice(400,1);
    assert.equal(tracker.detect('A',messages).start,400);
    tracker.snapshot('B',[message(0)]);
    assert.equal(tracker.detect('A',messages),null);
});

test('token upper bound skips only certainly below-threshold checks; exact tokenizer confirms near threshold',async()=>{
    let calls=0;
    const count=createAutomaticTokenCounter(async text=>{calls++;return text.length;});
    const scope={source:[{id:0,mes:'hello'},{id:1,mes:'world'}],books:{},mode:'tokens',countTokens:count,
        upperBound:createAutomaticTokenUpperBound()};
    assert.equal(await automaticCollectionDue({...scope,threshold:50000}),false);
    assert.equal(calls,0);
    assert.equal(await automaticCollectionDue({...scope,threshold:11}),true);
    assert.equal(await automaticCollectionDue({...scope,threshold:12}),false);
    assert.equal(calls,1);
});

test('native World Info rename migrates exact old and new editor names even with an empty old cache',async()=>{
    const source=readFileSync(new URL('./nexusCollectorRuntime.js',import.meta.url),'utf8');
    const start=source.indexOf('const possibleLorebookRenames');
    const end=source.indexOf('\nasync function resolveSlothSideBook',start);
    const changes=[],data={entries:{1:{uid:1,content:'Same memory'}}};
    const api=vm.runInNewContext(source.slice(start,end).replace(/export (async )?function/g,(_,a='')=>a+'function')+
        '\n({beginSlothLorebookRename,observeSlothLorebookSave,finishSlothLorebookRename})',{
        extension_settings:{STMemoryBooks:{}},slothSideRenameBooks:(_s,{newBook})=>['Nexus','Memory',newBook].filter(Boolean),
        worldInfoCache:new Map(),stringify:JSON.stringify,loadServerWorld:async()=>data,
        queueSlothSideRename:async change=>changes.push(change),
    });
    api.beginSlothLorebookRename('Nexus',['Nexus','Memory']);
    api.observeSlothLorebookSave('New Nexus',data,['Nexus','Memory','New Nexus'],'Nexus');
    assert.equal(await api.finishSlothLorebookRename('New Nexus',['Nexus','Memory','New Nexus']),false);
    assert.equal(await api.finishSlothLorebookRename('New Nexus',['Memory','New Nexus']),true);
    assert.deepEqual(JSON.parse(JSON.stringify(changes)),[{type:'lorebook',oldBook:'Nexus',newBook:'New Nexus'}]);
    api.beginSlothLorebookRename('Memory',['Memory','New Nexus']);
    api.observeSlothLorebookSave('New Nexus',data,['Memory','New Nexus'],'Memory');
    assert.equal(await api.finishSlothLorebookRename('New Nexus',['New Nexus']),false,'existing destinations are not rename candidates');
    api.beginSlothLorebookRename('Unrelated',['Unrelated','Memory']);
    api.observeSlothLorebookSave('Other',data,['Unrelated','Memory'],'Unrelated');
    assert.equal(await api.finishSlothLorebookRename('Other',['Memory','Other']),false);
});
