import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {validateNexusEventPlan,stageNexusEdits,describeNexusCollectionEntry,getNexusRecallModes,stageNexusRecallSettings} from './nexusCollectionPolicy.js';
import {isCompletedSceneEntry,sceneNumberFromTitle} from './nexusSceneRotation.js';
import {validateSlothSceneResponse} from './nexusSlothScenePrompt.js';
import {parseSingleSlothCollectionDraft,normalizeSingleSlothPlan,finalizeSingleSlothScenes} from './slothSingleRecovery.js';
import {buildSidePromptHistoryRequest,resolveSidePromptHistory} from './sidePromptHistory.js';
import {slothSideStoryKey,canContinueSlothSideEntry} from './slothSidePrompts.js';
import {scopeNexusWorldInfo} from './nexusWorldInfoScope.js';
const src=readFileSync(new URL('./nexusCollectionAI.js',import.meta.url),'utf8');
const extract=(a,b)=>src.slice(src.indexOf(a),src.indexOf(b,src.indexOf(a)));
const make=book=>{let uid=0;while(book.entries[uid])uid++;return book.entries[uid]={uid};};
test('single collection sends the source once, reads active Nexus and only recent Scene outcomes, validates event ranges',async()=>{
    const messages=[{id:1,mes:'She opened the letter.'},{id:2,mes:'He read it aloud.'},{id:3,mes:'She asked another question.'}];
    const draft={events:[{title:'Letter',complete:true,reason:'One letter read',segments:[[1,2]],timeline:'Unknown',
        scene:'She opened the letter and he read it aloud.',result:'They read the letter.',keywords:['letter']}],
        deferred:[{reason:'Question unanswered',segments:[[3,3]]}],edits:[]};
    const calls=[];
    const run=vm.runInNewContext(extract('function readSlothBatchScenes(', '\n/**')+'\n'+
        extract('export async function composeSingleSlothCollection(', '\nexport async function retryApprovedSlothScenes(')
            .replace('export async','async')+'\ncomposeSingleSlothCollection',{
        DEFAULT_SLOTH_COLLECTION_PROMPTS:{plan:'Plan'},getActiveSlothSummaryPreset:()=>({text:'Summary'}),
        SCENE_KEYWORD_GUIDANCE:'Recall',compact:JSON.stringify,slothNexusGuidance:({nexus})=>JSON.stringify(nexus),
        isCompletedSceneEntry,sceneNumberFromTitle,validateNexusEventPlan,validateSlothSceneResponse,
        parseSingleSlothCollectionDraft,normalizeSingleSlothPlan,finalizeSingleSlothScenes,
        readSlothNexusEdits:raw=>({edits:raw.edits,skippedNexusEdits:0}),
        requester:(_p,_s,_sig,one)=>async (prompt,phase,parse)=>{assert.equal(one,true);calls.push(prompt);return parse(JSON.stringify(draft),phase);},
    });
    const memory={entries:Object.fromEntries([1,2,3,4].map(i=>[i,{uid:i,comment:i+' - Event',
        content:'**Timeline**: Unknown\n\n**Scene**\nPrivateScene'+i+'\n\n**Result**\nOutcome'+i}]))};
    const opt={memory,nexus:{entries:{1:{content:'Core reference'}}},messages,settings:{}};
    const result=await run(opt);
    assert.equal(calls.length,1);
    assert.equal(calls[0].split(messages[0].mes).length,2);
    assert.match(calls[0],/Core reference/);assert.match(calls[0],/Outcome4/);
    assert.doesNotMatch(calls[0],/Outcome1|PrivateScene/);
    assert.equal(result.scenes.length,1);assert.equal(result.plan.deferred.length,1);
    draft.events[0].segments=[[1,3]];
    let captured;
    const recovered=await run({...opt,onDraft:raw=>{captured=raw;}});
    assert.equal(calls.length,2);
    assert.equal(recovered.scenes.length,1);
    assert.deepEqual(Array.from(recovered.scenes[0].collectedRanges.flat()),[1,2]);
    assert.deepEqual(Array.from(recovered.pendingRanges.flat()),[3,3]);
    assert.match(captured,/Question unanswered/);
    const replay=await run({...opt,rawDraft:captured});
    assert.equal(calls.length,2,'recovery must not call AI');
    assert.equal(replay.replayed,true);
    assert.equal(replay.scenes.length,1);
});
test('Nexus recall settings are independent; uninjected entries remain updateable and legacy NPC off resumes collection',()=>{
    const entries={entries:{}};
    const modes={core:'disabled',continuity:'keyword',lt:'constant',npc:'vector'};
    const options={recallModes:modes};
    assert.deepEqual(getNexusRecallModes({nexusRecallModes:modes}),modes);
    const ops=[{kind:'core',action:'create',title:'Core Memory',content:'They trust each other.'},
        {kind:'continuity',action:'create',title:'Current Continuity',content:'## Active Conditions\nInjured wrist.',keywords:['wrist']},
        {kind:'lt',action:'create',title:'LT - Piano',content:'She plays piano.'}];
    const {staged}=stageNexusEdits(entries,ops,make,options);
    assert.equal(staged.entries[0].disable,true);
    assert.equal(describeNexusCollectionEntry(staged.entries[0]).protected,false);
    assert.equal(staged.entries[1].constant,false);assert.deepEqual(staged.entries[1].key,['wrist']);
    assert.equal(staged.entries[2].constant,true);
    const revised=stageNexusEdits(staged,[{kind:'core',action:'append',uid:0,text:'She keeps her word.'}],make,options).staged;
    assert.match(revised.entries[0].content,/keeps her word/);assert.equal(revised.entries[0].disable,true);
    assert.throws(()=>stageNexusEdits(staged,[ops[0]],make,options),/Duplicate/);
    assert.equal(getNexusRecallModes({nexusRecallModes:{npc:'off'}}).npc,'vector');
    const npc=stageNexusEdits(staged,[{kind:'npc',action:'create',title:'NPC - Jane',content:'Friend.'}],make,{recallModes:{npc:'off'}}).staged;
    const entry=Object.values(npc.entries).find(e=>e.comment==='NPC - Jane');
    assert.equal(entry.vectorized,true);
    const updated=stageNexusEdits(npc,[{kind:'npc',action:'append',uid:entry.uid,text:'They met again.'}],make,{recallModes:{npc:'off'}}).staged;
    assert.match(updated.entries[entry.uid].content,/met again/);
});
test('story-scoped side output follows chapters but never a distinct AU',()=>{
    const avatar='A.png',ref={type:'character',avatarUrl:avatar,fileName:'chapter-1'};
    const roles={nexus:'N',memory:'M'},storyKey=slothSideStoryKey(ref,roles);
    const makeHistory=chat=>({...buildSidePromptHistoryRequest({key:'sloth-diary',name:'Diary'}, {},
        {chatId:chat,chatRef:{...ref,fileName:chat}},'Diary',[]),storyKey});
    const first=makeHistory('chapter-1'),next=makeHistory('chapter-2');
    const entry={uid:7,world:'Notes',comment:'Diary',content:'Prior text',STMB_slothSideNote:true,
        STMB_sidePromptHistory:{...first,version:1,sequence:1}};
    const book={entries:{7:entry}};
    assert.equal(resolveSidePromptHistory(book,next).latest,entry);
    assert.equal(canContinueSlothSideEntry(entry,'sloth-diary',{...ref,fileName:'chapter-2'},{storyKey}),true);
    assert.equal(resolveSidePromptHistory(book,{...next,storyKey:JSON.stringify([avatar,'AU N','AU M'])}).latest,null);
    const settings={nexusCharacterRoles:{[avatar]:roles}};
    const lists={characterLore:[entry]};
    scopeNexusWorldInfo(lists,{settings,ref:{...ref,fileName:'chapter-2'},avatar});
    assert.deepEqual(lists.characterLore,[entry]);
    const au={characterLore:[entry]};
    scopeNexusWorldInfo(au,{settings:{nexusCharacterRoles:{[avatar]:{nexus:'AU N',memory:'AU M'}}},ref,avatar});
    assert.deepEqual(au.characterLore,[]);
});

test('bulk injection updates preserve content, mixed legacy role safety, and skip missing keys',()=>{
    const original={entries:{0:{uid:0,comment:'Long-Term Memory',constant:true,content:'[Essential facts / ongoing world state]\nThey trust.\n[Enduring relationship / shared priorities]\nThey agree.'},1:{uid:1,comment:'LT - Piano',content:'She plays.'},2:{uid:2,comment:'PanelAssets',outletName:'PanelAssets',content:'Never change'}}};
    const {staged,changed,skipped}=stageNexusRecallSettings(original,{nexusRecallModes:{core:'disabled',lt:'keyword'}});
    assert.deepEqual(changed,[0]);assert.deepEqual(skipped,[1]);assert.equal(staged.entries[0].disable,true);
    assert.deepEqual(describeNexusCollectionEntry(staged.entries[0]).roles,['core']);
    assert.equal(describeNexusCollectionEntry(staged.entries[0]).protected,false);
    assert.equal(staged.entries[0].content,original.entries[0].content);
    assert.deepEqual(staged.entries[2],original.entries[2]);
    const updated=stageNexusEdits(staged,[{kind:'core',action:'replace_exact',uid:0,find:'They trust.',text:'They trust fully.'}],make).staged;
    assert.match(updated.entries[0].content,/trust fully/);
});
