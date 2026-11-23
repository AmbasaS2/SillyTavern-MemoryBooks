import test from 'node:test';
import assert from 'node:assert/strict';
import {validateNexusEventPlan,parseReviewedSegments,groupSlothSourceWindows,
  fingerprintSlothChat,stageNexusEdits,stageMemoryScenes} from './nexusCollectionPolicy.js';

const messages=Array.from({length:10},(_,id)=>({id,name:'A',mes:'message '+id}));
const plan={
  events:[{title:'Argument and repair',complete:true,reason:'same cause and reconciliation',
    result:'The two apologized',segments:[[0,2],[5,7]]},
    {title:'Independent message',complete:true,reason:'separate errand',result:'The errand ended',
    segments:[[3,4]]}],
  deferred:[{reason:'Still unresolved',segments:[[8,9]]}],
};
function maker(book) {
  const id=Math.max(-1,...Object.keys(book.entries).map(Number))+1;
  const entry={uid:id,position:0,order:100,disable:false};
  book.entries[id]=entry;return entry;
}
const story='**Timeline**\nDay 1.\n\n**Scene**\nCause, choices, repair.\n\n**Result**\nThe conflict ended.';
test('AI may unify non-adjacent causal segments, while preserving separate intervening event',()=>{
  const got=validateNexusEventPlan(plan,messages.map(m=>m.id));
  assert.deepEqual(got.events.map(event=>event.segments),[[[3,4]],[[0,2],[5,7]]]);
  assert.equal(got.fullyCollected,false);
  assert.deepEqual(got.deferred[0].messageIds,[8,9]);
});
test('reject omitted messages, overlapping events, out-of-bound and unfinished events',()=>{
  assert.throws(()=>validateNexusEventPlan({...plan,deferred:[]},messages.map(m=>m.id)),/unclassified/);
  assert.throws(()=>validateNexusEventPlan({...plan,events:[plan.events[0],plan.events[0]]},messages.map(m=>m.id)),/already assigned/);
  assert.throws(()=>validateNexusEventPlan({...plan,events:[{...plan.events[0],complete:false},plan.events[1]]},messages.map(m=>m.id)),/must have/);
  assert.throws(()=>parseReviewedSegments('11-15',messages.map(m=>m.id)),/not in source/);
});
test('source windows preserve all messages, never silently truncate or invent IDs',()=>{
  const source=Array.from({length:12},(_,i)=>({id:i,mes:'story '.repeat(170),name:'Actor'}));
  const windows=groupSlothSourceWindows(source,2100);
  assert.deepEqual(windows.flat().map(x=>x.id),source.map(x=>x.id));
  assert.ok(windows.length>1);
  assert.throws(()=>groupSlothSourceWindows([{id:1,mes:'X'.repeat(3000)}],2100),/not truncated/);
});
test('chat fingerprint fails on source edits/hiding and newly appended turns',()=>{
  const old=messages.map(x=>({...x,is_system:false}));
  const a=fingerprintSlothChat(old,[0,1]);
  old.push({id:10,name:'B',mes:'A new message changes the latest state',is_system:false});
  assert.notEqual(a,fingerprintSlothChat(old,[0,1]),
    'a newly appended turn must invalidate a pending current-state update');
  old.pop();
  old[1].mes='changed';
  assert.notEqual(a,fingerprintSlothChat(old,[0,1]));
  old[1].is_system=true;
  assert.throws(()=>fingerprintSlothChat(old,[0,1]),/hidden/);
});
test('Nexus exact-span replacement preserves unrelated NPC, other sections and Outlet fields',()=>{
  const book={entries:{
    1:{uid:1,comment:'Core Memory',content:'Name: A\nTrust: low\nFavorite: bread',constant:true},
    2:{uid:2,comment:'NPC: B',content:'B likes silence',vectorized:true,outletName:''},
    3:{uid:3,comment:'Kinks',content:'Do not modify',outletName:'Kinks',position:7}
  },stlo:{priority:40}};
  const original=structuredClone(book);
  const staged=stageNexusEdits(book,[{kind:'core',action:'replace_exact',uid:1,find:'Trust: low',text:'Trust: growing'},
    {kind:'npc',action:'append',uid:2,text:'B sent a letter'}],maker);
  assert.equal(staged.staged.entries[1].content,'Name: A\nTrust: growing\nFavorite: bread');
  assert.equal(staged.staged.entries[3].content,original.entries[3].content);
  assert.deepEqual(book,original);
  assert.deepEqual(staged.staged.stlo,original.stlo);
  assert.throws(()=>stageNexusEdits(book,[{kind:'npc',action:'append',uid:3,text:'bad'}],maker),/Special/);
  assert.throws(()=>stageNexusEdits(book,[{kind:'core',action:'replace_exact',uid:1,find:'NOT FOUND',text:'X'}],maker),/does not match/);
});
test('Nexus new Core / Continuity are configured always-on; duplicate titles are rejected',()=>{
  const book={entries:{0:{uid:0,comment:'Original',content:'keep'}}};
  const result=stageNexusEdits(book,[{kind:'core',action:'create',title:'Core Memory',content:'A remains A'},
    {kind:'continuity',action:'create',title:'Current Continuity',content:'[Present Handoff]\nStill waiting'}],maker);
  assert.equal(result.staged.entries[1].constant,true);
  assert.equal(result.staged.entries[2].constant,true);
  assert.equal(book.entries[1],undefined);
  assert.throws(()=>stageNexusEdits(book,[{kind:'lt',action:'create',title:'Original',content:'duplicate'}],maker),/Duplicate/);
});
test('Memory stage keeps three latest complete scenes active, original book unchanged',()=>{
  const book={entries:{0:{uid:0,comment:'001 - Old',content:story,key:[],constant:true,vectorized:false},
    1:{uid:1,comment:'002 - Next',content:story,key:[],constant:true,vectorized:false},
    2:{uid:2,comment:'003 - Recent',content:story,key:[],constant:true,vectorized:false}},stlo:{mode:'manual'}};
  const before=structuredClone(book);
  const out=stageMemoryScenes(book,[{title:'Finished',content:story,segments:[[0,2],[5,7]],
    messageIds:[0,1,2,5,6,7],keywords:['promise','apology']}],maker,{chatId:'A-chat'});
  assert.equal(out.writes.length,1);
  assert.equal(out.staged.entries[0].constant,false);
  for(const id of [1,2,3])assert.equal(out.staged.entries[id].constant,true);
  assert.deepEqual(out.staged.entries[3].STMB_sourceRanges,[[0,2],[5,7]]);
  assert.equal(out.staged.entries[3].STMB_chatId,'A-chat');
  assert.equal(out.staged.entries[3].STMB_start,undefined,
      'discontiguous sources must not be disguised as one continuous STMB range');
  assert.equal(out.staged.entries[3].STMB_discontiguous,true);
  assert.deepEqual(book,before);
  assert.throws(()=>stageMemoryScenes(book,[{title:'Incomplete',content:'No result',messageIds:[1],segments:[[1,1]]}],maker),/missing Timeline/);
});


test('all-unfinished content stays uncollected without creating a fake complete scene',()=>{
  const raw={events:[],deferred:[{reason:'Still developing',segments:[[0,9]]}]};
  const plan=validateNexusEventPlan(raw,messages.map(m=>m.id));
  assert.equal(plan.events.length,0);
  assert.equal(plan.fullyCollected,false);
});
