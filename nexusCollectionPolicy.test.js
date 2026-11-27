import test from 'node:test';
import assert from 'node:assert/strict';
import {validateNexusEventPlan,includeDeepSeekTailEvent,fitDeepSeekSceneBatch,parseReviewedSegments,groupSlothSourceWindows,
  fingerprintSlothChat,describeNexusCollectionEntry,slothDisplayAnchorTitle,
  stageNexusEdits,stageMemoryScenes,getSlothHideRanges} from './nexusCollectionPolicy.js';

test('a collection keeps proposed events while forwarding only verified ending quotes', () => {
  const originalMessages=[
    {id:4,mes:'They opened the parcel.'},
    {id:5,mes:'They could finally read the letter.'},
    {id:7,mes:'He began apologizing.'},
    {id:8,mes:'He asked if they could speak.'},
    {id:9,mes:'She asked if he agreed.'},
    {id:10,mes:'Yes.'},
  ];
  const complete={title:'Event',reason:'Recorded result',result:'Observed outcome',complete:true};
  const events=[
    {...complete,segments:[[4,5]],closure:{messageId:5,quote:'finally read the letter'}},
    {...complete,segments:[[7,8]],closure:{messageId:5,quote:'finally read the letter'}},
    {...complete,segments:[[9,10]],closure:{messageId:10,quote:'Yes.'}},
  ];
  const validate=rows=>validateNexusEventPlan({events:rows},originalMessages.map(m=>m.id),
    {deferUnclassified:true,originalMessages});
  const plan=validate(events);
  assert.deepEqual(plan.events.map(event=>event.closure?.messageId),[5,undefined,10]);
  assert.deepEqual(plan.events.map(event=>event.messageIds),[[4,5],[7,8],[9,10]]);
  assert.deepEqual(plan.deferred,[]);
  const invented=validate([{...events[0],closure:{messageId:5,quote:'The parcel was empty.'}},...events.slice(1)]);
  assert.deepEqual(invented.events.map(event=>event.closure?.messageId),[undefined,undefined,10]);
  assert.deepEqual(invented.deferred,[]);
  const optional=validate([{...events[0],closure:{messageId:5,quote:'Finally read the letter'}},
    {...events[1],closure:undefined},events[2]]);
  assert.deepEqual(optional.events.map(event=>event.closure?.messageId),[undefined,undefined,10]);
  assert.deepEqual(optional.deferred,[]);
  originalMessages[1].mes += ' The letter listed their travel plans.'.repeat(16);
  const longQuote=validate([{...events[0],closure:{messageId:5,quote:originalMessages[1].mes}},...events.slice(1)]);
  assert.deepEqual(longQuote.events.map(event=>event.closure?.messageId),[5,undefined,10]);
});

test('the collection respects events the model explicitly classifies as incomplete', () => {
  const originalMessages=[
    {id:4,mes:'She withdrew from the conversation.'},
    {id:5,mes:'He asked her to talk when she was ready.'},
    {id:6,mes:'The host locked the gates before the storm.'},
  ];
  const complete={title:'Event',reason:'Observed action',complete:true};
  const events=[
    {...complete,complete:false,result:'He asks her to talk, but she has not responded.',segments:[[4,5]],
      closure:{messageId:5,quote:'He asked her to talk'}},
    {...complete,result:'The host resolved the previously unanswered security question by locking the gates.',
      segments:[[6,6]],closure:{messageId:6,quote:'The host locked the gates'}},
  ];
  const plan=validateNexusEventPlan({events},[4,5,6],{deferUnclassified:true,originalMessages});
  assert.deepEqual(plan.events.map(event=>event.messageIds),[[6]]);
  assert.deepEqual(plan.deferred.map(item=>item.messageIds),[[4,5]]);
});

test('DeepSeek reserves one final incident and leaves conflicting original ranges for later', () => {
  const originalMessages=[
    {id:2,mes:'The host locked the door.'},
    {id:3,mes:'She stood by the window.'},
    {id:4,mes:'She wanted to know why he left.'},
    {id:5,mes:'He asked if they could talk.'},
    {id:6,mes:'He said he left to give her time.'},
  ];
  const ids=originalMessages.map(m=>m.id);
  const closed={title:'The door',reason:'Independent incident',result:'The host locked the door.',
    segments:[[2,2]],closure:{messageId:2,quote:'The host locked the door.'}};
  const tail={title:'Why he left',reason:'The question and actual answer',result:'He explained why he left.',
    complete:true,segments:[[5,6]],origin:{messageId:4,quote:'She wanted to know why he left.'},
    closure:{messageId:6,quote:'He said he left to give her time.'}};
  const duplicate={...tail,segments:[[3,5]]};
  const validate=(draft,range)=>validateNexusEventPlan(includeDeepSeekTailEvent(draft,range,originalMessages),range,
    {deferUnclassified:true,originalMessages});
  const finished=validate({events:[closed,duplicate],tail},ids);
  assert.deepEqual(finished.events.map(event=>event.messageIds),[[2],[4,5,6]]);
  assert.deepEqual(finished.deferred.map(event=>event.messageIds),[[3]]);
  const open=validate({events:[closed],tail:{complete:false,reason:'Still waiting',segments:[[4,5]]}},ids.slice(0,-1));
  assert.deepEqual(open.events.map(event=>event.messageIds),[[2]]);
  assert.deepEqual(open.deferred.map(event=>event.messageIds),[[4,5],[3]]);
});

test('DeepSeek carries forward complete events beyond the writing budget and retains the final exchange', () => {
  const events=Array.from({length:20},(_,id)=>({id,segments:[[id,id]],messageIds:[id]}));
  events[19].closingExchange=true;
  const plan={events,deferred:[],fullyCollected:true};
  const result=fitDeepSeekSceneBatch(plan,10000);
  assert.deepEqual(result.events.map(event=>event.id),[0,1,2,3,4,5,6,7,8,9,10,11,12,19]);
  assert.deepEqual(result.deferred.flatMap(event=>event.messageIds),[13,14,15,16,17,18]);
  assert.equal(result.fullyCollected,false);
  assert.equal(plan.events.length,20);
});

test('the approval plan keeps a completed proposal with request-like wording', () => {
  const originalMessages=[{id:0,mes:'She pulled away upset.'},{id:1,mes:'"Talk to me," he said.'}];
  const event={title:'They spoke',complete:true,reason:'He tried to make amends',result:'He attempted to reassure her.',
    closure:{messageId:1,quote:'Talk to me'},segments:[[0,1]]};
  const plan=validateNexusEventPlan({events:[event]},[0,1],{deferUnclassified:true,originalMessages});
  assert.equal(plan.events.length,1);
  assert.deepEqual(plan.events[0].messageIds,[0,1]);
  assert.deepEqual(plan.deferred,[]);
});

test('legacy mixed Nexus updates the same active core and continuity UID in place', () => {
  const content = [
    '=== LONG-TERM MEMORY — A & B ===', '', '[Essential facts / ongoing world state]',
    'A and B share a house.', '', '[Enduring relationship / shared priorities]',
    'They trust one another.', '', '[Active threads — still unconfirmed]',
    '[Thread — The letter]', 'The letter has not arrived.', '',
    '[Physical carryover]', "A's wrist still hurts.", '', '=== END LONG-TERM MEMORY — A & B ===',
  ].join('\n');
  const entry = {uid:15,comment:'Long-Term Memory (Always-On Story Memory)',constant:true,
    content,position:1,order:6500,key:[],STMB_sidePromptRegeneration:{keep:'snapshot'}};
  const book = {entries:{15:entry}};
  assert.deepEqual(describeNexusCollectionEntry(entry).roles,['core','continuity']);
  const maker = () => assert.fail('must reuse the existing UID');
  const {staged} = stageNexusEdits(book,[
    {kind:'continuity',action:'append_section',uid:15,section:'Present Handoff',text:'A is waiting by the fire.'},
    {kind:'continuity',action:'append_section',uid:15,section:'Active Threads',text:'[Thread — A visit]\nA plans to see B later.'},
    {kind:'core',action:'append',uid:15,text:'They share the same house by choice.'},
  ],maker);
  assert.deepEqual(Object.keys(staged.entries),['15']);
  const {content:body,...metadata} = staged.entries[15];
  const {content:oldBody,...oldMetadata} = entry;
  assert.deepEqual(metadata,oldMetadata);
  assert.equal(oldBody,content);
  assert.match(body,/house by choice\.\n\n\[Active threads/);
  assert.match(body,/plans to see B later\.[\s\n]+\[Thread — The letter\]/);
  assert.match(body,/\*\*Thread — A visit:\*\* A plans/);
  assert.match(body,/## Present Handoff\nA is waiting by the fire\.\n\n=== END LONG-TERM MEMORY/);
  assert.throws(() => stageNexusEdits(book,[
    {kind:'continuity',action:'create',title:'Current Continuity',content:'## Present Handoff\nSame situation.'},
  ],maker),/Use existing UID 15/);
  assert.throws(() => stageNexusEdits(book,[
    {kind:'core',action:'replace_exact',uid:15,find:'The letter has not arrived.',text:'The letter arrived.'},
  ],maker),/does not match uniquely/);
  assert.deepEqual(describeNexusCollectionEntry({...entry,position:7}).protected,true);
});

test('active legacy Status and Scene Continuity are editable in place with their original activation and metadata', () => {
  const entries={
    3:{uid:3,comment:'Status',content:'[Physical carryover]\nThe wrist hurts.',constant:false,vectorized:true,stlo:{keep:42}},
    4:{uid:4,comment:'Scene Continuity',content:'Waiting beside the door.',constant:false,key:['door'],selective:true},
    5:{uid:5,comment:'Status (archived)',content:'Preserve',disable:true,constant:true},
  };
  const original={entries,stlo:{priority:40}};
  const {staged}=stageNexusEdits(original,[
    {kind:'continuity',action:'replace_exact',uid:3,find:'The wrist hurts.',text:'The wrist improved.'},
    {kind:'continuity',action:'append_section',uid:4,section:'Present Handoff',text:'The guest has arrived.'},
  ],()=>assert.fail('must reuse the existing UID'));
  assert.deepEqual(staged.entries[3],{...entries[3],content:'[Physical carryover]\nThe wrist improved.'});
  assert.match(staged.entries[4].content,/^Waiting beside the door\.[\s\S]+The guest has arrived\.$/u);
  assert.deepEqual({...staged.entries[4],content:entries[4].content},entries[4]);
  assert.deepEqual(staged.entries[5],entries[5]);
  assert.deepEqual(staged.stlo,original.stlo);
});

test('a new numbered detail cannot duplicate an existing person or topic', () => {
  const entries = {
    3:{uid:3,comment:'NPC 02 | Mme. Émilie Duval',content:'Known person.'},
    4:{uid:4,comment:'LT 01 | The missing letter',content:'Already recorded.'},
  };
  const maker = () => assert.fail('must reuse the existing UID');
  assert.throws(() => stageNexusEdits({entries},[
    {kind:'npc',action:'create',title:'NPC 27 | Madame Emilie Duval',content:'Same person.'},
  ],maker),/Use existing UID 3/);
  assert.throws(() => stageNexusEdits({entries},[
    {kind:'lt',action:'create',title:'LT 20 | The missing letter',content:'Same topic.'},
  ],maker),/Use existing UID 4/);
});

test('NPC updates do not require literal citations; malformed UIDs cannot edit entry zero', () => {
  const original={entries:{0:{uid:0,comment:'NPC 01 | Madame Vasseur',content:'Known person.'}}};
  const update={kind:'npc',action:'append',uid:0,text:'She now visits weekly.'};
  const maker=()=>assert.fail('must reuse existing entry');
  assert.match(stageNexusEdits(original,[update],maker).staged.entries[0].content,/visits weekly/);
  for(const uid of [null,undefined,'',false,[],{}]) {
    assert.throws(()=>stageNexusEdits(original,[{...update,uid}],maker),/numeric UID/);
  }
  assert.equal(original.entries[0].content,'Known person.');
});

const messages=Array.from({length:10},(_,id)=>({id,name:'A',mes:'message '+id}));
test('one owner per listed message produces disjoint source ranges across gaps',()=>{
  const payload={events:[{title:'Lantern returned',reason:'The keeper received it',result:'It was returned',complete:true}],
    deferred:[{reason:'The spare is still missing'}],owners:['e1','d1','e1','e1']};
  const result=validateNexusEventPlan(payload,[4,5,7,8]);
  assert.deepEqual(result.events[0].segments,[[4,4],[7,8]]);
  assert.deepEqual(result.deferred[0].segments,[[5,5]]);
  assert.throws(()=>validateNexusEventPlan({...payload,owners:['e1','d1']},[4,5,7,8]),/exactly one owner/);
  assert.throws(()=>validateNexusEventPlan({...payload,owners:['e1','d1','d2','e1']},[4,5,7,8]),/Unknown scene owner/);
});
test('corrective assignments bind explicit original IDs and reject duplicates, missing IDs and synthetic IDs',()=>{
  const payload={events:[{title:'Lantern returned',reason:'The keeper received it',result:'It was returned',complete:true}],
    deferred:[{reason:'The spare is still missing'}],assignments:[[8,'e1'],[5,'d1'],[4,'e1'],[7,'e1']]};
  const ids=[4,5,7,8];
  const result=validateNexusEventPlan(payload,ids);
  assert.deepEqual(result.events[0].segments,[[4,4],[7,8]]);
  assert.deepEqual(result.deferred[0].segments,[[5,5]]);
  assert.throws(()=>validateNexusEventPlan({...payload,assignments:[[8,'e1'],[8,'d1'],[4,'e1'],[7,'e1']]},ids),/more than one owner/);
  assert.throws(()=>validateNexusEventPlan({...payload,assignments:payload.assignments.slice(1)},ids),/Missing an owner/);
  assert.throws(()=>validateNexusEventPlan({...payload,assignments:[[108,'e1'],...payload.assignments]},ids),/unknown source ID/);
});
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
test('initial AI analysis can defer only omitted valid source IDs for review',()=>{
  const sparse=[0,1,2,3,4,5,6,7,8,9,12];
  const analysis=validateNexusEventPlan({...plan,deferred:[]},sparse,{deferUnclassified:true});
  assert.deepEqual(analysis.deferred[0].segments,[[8,9],[12,12]]);
  assert.equal(analysis.deferred[0].unclassified,true);
  assert.equal(analysis.fullyCollected,false);
  assert.throws(()=>validateNexusEventPlan({...plan,events:[plan.events[0],plan.events[0]]},
    sparse,{deferUnclassified:true}),/already assigned/);
  const open=validateNexusEventPlan({...plan,events:[{...plan.events[0],complete:false}]},
    sparse,{deferUnclassified:true});
  assert.equal(open.events.length,0);
  assert.deepEqual(open.deferred[0].messageIds,plan.events[0].segments.flatMap(([a,b])=>Array.from({length:b-a+1},(_,i)=>a+i)));
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

test('NPC creations cannot duplicate an explicit alias or add a parenthetical qualifier to an existing name',()=>{
  const book={entries:{1:{uid:1,comment:'NPC 01 | Beatrice Vale',content:'Aliases: Bea; The Archivist'}}};
  const create=title=>stageNexusEdits(book,[{kind:'npc',action:'create',title,content:'A distinct role'}],maker);
  assert.throws(()=>create('NPC - The Archivist'),/Use existing UID 1/);
  assert.throws(()=>create('NPC - Beatrice Vale (archivist)'),/Use existing UID 1/);
  assert.equal(create('NPC - Felix Vale').changes.length,1);
});
test('Memory stage keeps three latest complete scenes active, original book unchanged',()=>{
  const book={entries:{0:{uid:0,comment:'001 - Old',content:story,key:[],constant:true,vectorized:false},
    1:{uid:1,comment:'002 - Next',content:story,key:[],constant:true,vectorized:false},
    2:{uid:2,comment:'003 - Recent',content:story,key:[],constant:true,vectorized:false}},stlo:{mode:'manual'}};
  for (const entry of Object.values(book.entries)) {
    entry.stmemorybooks=true;
    entry.STMB_sourceRanges=[[entry.uid,entry.uid]];
  }
  book.entries[99]={uid:99,comment:'Independent entry',content:'Preserve',constant:true};
  const before=structuredClone(book);
  const out=stageMemoryScenes(book,[{title:'Finished',content:story,segments:[[0,2],[5,7]],
    messageIds:[0,1,2,5,6,7],keywords:['promise','apology']}],maker,{chatId:'A-chat'});
  assert.equal(out.writes.length,1);
  assert.equal(out.staged.entries[0].constant,false);
  for(const id of [1,2,100])assert.equal(out.staged.entries[id].constant,true);
  assert.deepEqual(out.staged.entries[100].STMB_sourceRanges,[[0,2],[5,7]]);
  assert.equal(out.staged.entries[100].STMB_chatId,'A-chat');
  assert.equal(out.staged.entries[100].STMB_start,undefined,
      'discontiguous sources must not be disguised as one continuous STMB range');
  assert.equal(out.staged.entries[100].STMB_discontiguous,true);
  assert.deepEqual(out.staged.entries[99],before.entries[99]);
  assert.deepEqual(book,before);
  assert.throws(()=>stageMemoryScenes(book,[{title:'Incomplete',content:'No result',messageIds:[1],segments:[[1,1]]}],maker),/missing Timeline/);
});

test('new scenes rotate structurally complete manual Scenes without assigning provenance',()=>{
  const book={entries:{
    0:{uid:0,comment:'001 - Manual',content:story,key:['original'],constant:true,vectorized:false,legacy:{preserve:true}},
    1:{uid:1,comment:'002 - Manual',content:story,key:['original'],constant:true},
    2:{uid:2,comment:'003 - Manual',content:story,key:['original'],constant:true},
    3:{uid:3,comment:'004 - Disabled',content:story,disable:true,constant:true},
    4:{uid:4,comment:'005 - Outlet',content:story,position:7,outletName:'Archive',constant:true},
    5:{uid:5,comment:'006 - Side',content:story,STMB_sidePromptHistory:{templateKey:'diary'},constant:true},
  }};
  const before=structuredClone(book);
  const {staged}=stageMemoryScenes(book,[{title:'New',content:story,segments:[[4,4]],messageIds:[4]}],maker);
  assert.deepEqual(staged.entries[0],{...before.entries[0],constant:false,vectorized:true});
  for (const uid of [1,2,6]) assert.equal(staged.entries[uid].constant,true);
  for (const uid of [3,4,5]) assert.deepEqual(staged.entries[uid],before.entries[uid]);
  assert.deepEqual(book,before);
});


test('all-unfinished content stays uncollected without creating a fake complete scene',()=>{
  const raw={events:[],deferred:[{reason:'Still developing',segments:[[0,9]]}]};
  const plan=validateNexusEventPlan(raw,messages.map(m=>m.id));
  assert.equal(plan.events.length,0);
  assert.equal(plan.fullyCollected,false);
});

test('shared source references remain pending in Memory metadata and automatic Hide',()=>{
    const messages=Array.from({length:6},(_,id)=>({mes:'message '+id,is_system:false}));
    const story='**Timeline**: Unknown\n\n**Scene**\nA read the letter.\n\n**Result**\nThe letter was read.';
    const scene={title:'Letter',content:story,messageIds:[1,2,3,4],segments:[[1,4]],collectedRanges:[[1,2]]};
    const make=book=>{let uid=0;while(book.entries[uid])uid++;return book.entries[uid]={uid};};
    const {staged}=stageMemoryScenes({entries:{}},[scene],make,{chatId:'same-chat'});
    const entry=Object.values(staged.entries)[0];
    assert.deepEqual(entry.STMB_sourceRanges,[[1,4]]);
    assert.deepEqual(entry.STMB_collectedRanges,[[1,2]]);
    assert.deepEqual(getSlothHideRanges([scene],messages,0),[[1,2]]);
    const replay=stageMemoryScenes(staged,[scene],make,{chatId:'same-chat'});
    assert.equal(Object.keys(replay.staged.entries).length,1);
    assert.equal(replay.writes[0].reused,true);
});

test('repeated generated sequence prefixes are stripped and exact same-chat legacy Scene is reused',()=>{
    const body='**Timeline**: Unknown\n\n**Scene**\nThe letter arrived.\n\n**Result**\nDelivered.';
    const existing={uid:1,comment:'058 - Letter',content:body,stmemorybooks:true,STMB_chatId:'chat',STMB_start:0,STMB_end:1};
    const scene={title:'058 - 058 - Letter',content:body,messageIds:[0,1],segments:[[0,1]],collectedRanges:[[0,1]]};
    const create=book=>book.entries[2]={uid:2};
    const reused=stageMemoryScenes({entries:{1:existing}},[scene],create,{chatId:'chat'});
    assert.equal(reused.writes[0].reused,true);
    assert.equal(Object.keys(reused.staged.entries).length,1);
    assert.equal(reused.staged.entries[1].comment,'058 - Letter');
    const created=stageMemoryScenes({entries:{}},[scene],create,{chatId:'chat'});
    assert.equal(created.staged.entries[2].comment,'001 - Letter');
    const dated=stageMemoryScenes({entries:{}},[{...scene,title:'058 - 2026-11-27: Letter'}],create,{chatId:'chat'});
    assert.equal(dated.staged.entries[2].comment,'001 - 2026-11-27: Letter');
});

test('manual Scene review lists only untracked completed candidates and never infers a covered range',async()=>{
    const {listSlothUntrackedScenes,findSlothLegacyEvidence}=await import('./nexusCollectionPolicy.js');
    const content='**Timeline**: Unknown\n\n**Scene**\nShe said “Keep this promise.”\n\n**Result**\nThey agreed.';
    const entry=(uid,extra={})=>({uid,comment:String(uid+1).padStart(3,'0')+' - Promise',content,...extra});
    const book={entries:{0:entry(0),1:entry(1,{STMB_chatId:'chat',STMB_sourceRanges:[[0,1]]}),
        2:entry(2,{STMB_chatId:'AU'}),3:entry(3,{STMB_chatId:'chat',STMB_collectedRanges:[],STMB_sourceRanges:[[1,2]]}),
        4:entry(4,{STMB_slothSceneSplitArchive:{}}),5:entry(5,{STMB_chatId:'chat',STMB_sourceRanges:[[0,99]]}),
        6:entry(6,{STMB_sourceRanges:[[0,1]]})}};
    const before=structuredClone(book);
    assert.deepEqual(listSlothUntrackedScenes(book,{fileName:'chat'},3).map(e=>e.uid),[0,5,6]);
    assert.deepEqual(findSlothLegacyEvidence(content,[{mes:'Different text.'},{name:'A',mes:'He heard: Keep this promise.',is_system:true},
        {name:'B',mes:'Keep   this promise.'}]),[{id:1,name:'A',quote:'Keep this promise.'},{id:2,name:'B',quote:'Keep this promise.'}]);
    assert.deepEqual(findSlothLegacyEvidence('They agreed.',[{mes:'They agreed.'}]),[]);
    assert.deepEqual(book,before);
});

test('Anchor and historical LT titles share the same role, identity and recall configuration',()=>{
  const book={entries:{7:{uid:7,comment:'LT 02 | Harbor',content:'The quay is quiet.',vectorized:true,selective:true,key:['harbor']}}};
  const before=JSON.stringify(book);
  const createEntry=staged=>staged.entries[8]={uid:8};
  for(const comment of ['LT 02 | Harbor','Anchor - Harbor','Anchor 02 | Harbor'])
    assert.deepEqual(describeNexusCollectionEntry({comment}).roles,['lt']);
  assert.deepEqual(describeNexusCollectionEntry({comment:'NPC - Harbor'}).roles,['npc']);
  assert.throws(()=>stageNexusEdits(book,[{kind:'lt',action:'create',title:'Anchor - Harbor',content:'New fact.'}],createEntry),/Duplicate Nexus role or detail/);
  const result=stageNexusEdits(book,[{kind:'lt',action:'append',uid:7,text:'The tide is low.'},
    {kind:'lt',action:'create',title:'Anchor - Lanterns',content:'The lantern was repaired.',keywords:['lantern']}],createEntry);
  assert.equal(JSON.stringify(book),before);
  assert.equal(result.staged.entries[7].comment,'LT 02 | Harbor');
  assert.equal(result.staged.entries[8].comment,'Anchor - Lanterns');
  assert.equal(result.staged.entries[8].STMB_slothNexusKind,'lt');
  assert.equal(result.staged.entries[8].vectorized,true);
  assert.equal(slothDisplayAnchorTitle('LT 02 | Harbor','앵커'),'앵커 02 | Harbor');
  assert.equal(slothDisplayAnchorTitle('Anchor - Lanterns','앵커'),'앵커 - Lanterns');
  assert.equal(slothDisplayAnchorTitle('SALT - Food'),'SALT - Food');
});
