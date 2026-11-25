import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSlothSideRename, planSlothSideSettingsRename, stageSlothSideIdentityRename } from './slothSideIdentity.js';
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
