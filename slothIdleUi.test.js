import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {getMemoryBooksMode} from './memoryBooksMode.js';

const source=readFileSync(new URL('./index.js',import.meta.url),'utf8');
const cut=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)+start.length));
test('World Info row observer is dormant while closed and refreshes once on reopen',async()=>{
    const root={querySelectorAll:()=>[],contains:()=>true};
    let opened=false,observations=[],timers=new Map(),id=0,changes;
    const drawer={classList:{contains:name=>name==='openDrawer'?opened:!opened},querySelector:()=>root};
    class Observer{
        constructor(callback){this.callback=callback;this.active=false;observations.push(this);}
        observe(target,options){this.active=true;this.target=target;this.options=options;}
        disconnect(){this.active=false;}
    }
    const env={document:{getElementById:()=>drawer},MutationObserver:Observer,
        $:()=>({on:(_name,fn)=>{changes=fn;},off(){}}),
        setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:key=>timers.delete(key),
        console,Node:{ELEMENT_NODE:1},getCurrentLorebookEditorName:()=>'',loadWorldInfo:()=>{throw Error('unexpected hidden load');}};
    const api=vm.runInNewContext('let lorebookRegenerationObserver=null,lorebookRegenerationDrawerObserver=null,lorebookRegenerationRoot=null,lorebookRegenerationRefreshTimer=null;\n'+
        cut('let regenerationCache = null;','function fingerprintChatRange(')+
        '\n({initializeLorebookRegenerationObserver,scheduleLorebookRegenerationActionsRefresh,cleanupLorebookRegenerationObserver})',env);
    api.initializeLorebookRegenerationObserver();
    assert.equal(observations.length,1);
    assert.equal(observations[0].options.subtree,undefined);
    api.scheduleLorebookRegenerationActionsRefresh();
    changes();
    assert.equal(timers.size,0);
    opened=true;observations[0].callback([]);
    assert.equal(observations.length,2);
    assert.equal(observations[1].target,root);
    assert.equal(observations[1].options.subtree,true);
    changes();changes();assert.equal(timers.size,1);
    opened=false;observations[0].callback([]);
    assert.equal(observations[1].active,false);
    assert.equal(timers.size,0);
    api.scheduleLorebookRegenerationActionsRefresh();
    assert.equal(timers.size,0);
    opened=true;observations[0].callback([]);
    assert.equal(observations.length,3);
    assert.equal(timers.size,1);
    api.cleanupLorebookRegenerationObserver();
    assert.ok(observations.every(o=>!o.active));
    assert.equal(timers.size,0);
});
test('Sloth still refreshes shared message controls but never runs original automatic summary or trackers',async()=>{
    const ref={type:'character',avatarUrl:'A.png',fileName:'one'};
    const settings={characterMemoryBooksModes:{'A.png':'sloth'}};
    let key='one',scheduled=0,validation=0,summary=0,reminders=0,trackers=0;
    const timers=[];
    const run=vm.runInNewContext(cut('function isOriginalMemoryBooksChat(','function checkMemoryReminders(')+cut('async function handleMessageReceived()','function handleStmbJobStateChanged()')+'\nhandleMessageReceived',{
        getMemoryBooksMode,extension_settings:{STMemoryBooks:settings},getCurrentStmbChatRef:()=>ref,getStmbChatKey:()=>key,
        setTimeout:fn=>timers.push(fn),validateSceneMarkers:()=>validation++,SCENE_MANAGEMENT:{VALIDATION_DELAY_MS:80},
        scheduleSceneButtonRefresh:()=>scheduled++,handleAutoSummaryMessageReceived:async()=>summary++,
        checkMemoryReminders:()=>reminders++,evaluateTrackers:async()=>trackers++,console,
    });
    await run();assert.equal(scheduled,1);assert.equal(summary+reminders+trackers,0);
    settings.characterMemoryBooksModes['A.png']='original';
    await run();assert.equal(scheduled,2);assert.deepEqual([summary,reminders,trackers],[1,1,1]);
    key='another';for(const fn of timers)fn();
    assert.equal(validation,0,'delayed validation cannot apply to another chat');
});
test('message snapshots remain synchronous, while visible Sloth status redraw is coalesced',()=>{
    const ref={type:'character',avatarUrl:'A.png',fileName:'one'};
    const settings={characterMemoryBooksModes:{'A.png':'sloth'}};
    let invalidations=0,redraws=0,snapshots=[],timers=[];
    const popup={dlg:{open:false}};
    const change=vm.runInNewContext(cut('function isOriginalMemoryBooksChat(','function checkMemoryReminders(')+
        cut('let slothStatusRefreshTimer = null;','function syncSlothAutomaticStatus() {')+'\nrecordMemoryBooksMessageChange',{
        getMemoryBooksMode,extension_settings:{STMemoryBooks:settings},getCurrentStmbChatRef:()=>ref,getStmbChatKey:()=>'one',
        chat:[],currentPopupInstance:popup,invalidateSlothAutomaticProgress:()=>invalidations++,
        setTimeout:fn=>{timers.push(fn);return timers.length;},syncSlothAutomaticStatus:()=>redraws++,
        memoryRollbackDeletionTracker:{snapshot:(_key,_chat,id)=>snapshots.push(id)},
    });
    change(1);change(2);assert.equal(timers.length,0);assert.equal(invalidations,2);
    popup.dlg.open=true;change(3);change(4);assert.equal(timers.length,1);assert.equal(invalidations,4);
    timers.shift()();assert.equal(redraws,1);
    settings.characterMemoryBooksModes['A.png']='original';change(5);
    assert.equal(invalidations,4);assert.equal(timers.length,0);
    assert.deepEqual(snapshots,[1,2,3,4,5]);
});
test('memory tier macro counters preserve all categories in one entry traversal',()=>{
    const src=readFileSync(new URL('./memoryTierMacros.js',import.meta.url),'utf8');
    const fn=vm.runInNewContext('let tierCounts,clipCount,sidePromptCount;const EMPTY_TIER_COUNTS={1:0,2:0,3:0};'+
        src.slice(src.indexOf('function updateCounts('),src.indexOf('function clearCounts('))+
        '\n(book)=>{updateCounts(book);return {tierCounts,clipCount,sidePromptCount};}',{
        getEntrySummaryTier:e=>e.tier,isClipEntryTitle:s=>s==='Clip',isSidePromptEntryTitle:s=>s==='Side',
    });
    const out=fn({entries:{1:{stmemorybooks:true,tier:1,comment:'Scene'},2:{comment:'Clip'},
        3:{stmemorybooks:true,tier:2,comment:'Side'},4:{stmemorybooks:false,tier:3,comment:'Side'}}});
    assert.deepEqual(JSON.parse(JSON.stringify(out)),{tierCounts:{1:1,2:1,3:0},clipCount:1,sidePromptCount:2});
});


test('dry-run and quiet starts do not cancel a scheduled Sloth collection',()=>{
 const segment=cut('  let slothGeneration = null;', '    // Clear any prior persistent failure toast');
 assert.ok(segment.includes('GENERATION_STARTED'));
 const code=segment+'\n  });\nthis.startState=()=>({slothGeneration,slothAutoTimer});this.setTimer=value=>{slothAutoTimer=value;};';
 let callback,cancelled=[];const env={eventSource:{on(_event,fn){callback=fn;}},event_types:{GENERATION_STARTED:'started'},isDryRun:false,clearTimeout:id=>cancelled.push(id),getStmbChatKey:()=> 'chat-1',chat:[{}],getMemoryBooksMode:()=> 'sloth',getCurrentStmbChatRef:()=> ({}),extension_settings:{STMemoryBooks:{}}};
 vm.runInNewContext(code,env);env.setTimer(17);
 callback('normal',{},true);callback('quiet',{},false);
 assert.deepEqual(cancelled,[]);assert.equal(env.startState().slothAutoTimer,17);
 callback('normal',{},false);
 assert.deepEqual(cancelled,[17]);assert.equal(env.startState().slothGeneration.automatic,true);
 const active=env.startState().slothGeneration;
 callback('quiet',{},false);assert.equal(env.startState().slothGeneration,active);
});

test('Sloth auto collection is scheduled only by a completed normal reply, not generation UI events', async()=>{
 const calls=[], timers=new Map();let next=0,key='chat-1',enabled=true;
 const segment=cut('  let slothGeneration = null;', '    // Clear any prior persistent failure toast')+'\n  });\n'+
   cut('  function scheduleSlothCollectionForReply(', '  eventSource.makeFirst(event_types.WORLDINFO_ENTRIES_LOADED')+
   '\nthis.receive=scheduleSlothCollectionForReply;';
 const callbacks={};const chat=[{is_user:true,mes:'question'}];
 const env={eventSource:{on(event,fn){callbacks[event]=fn;}},event_types:{GENERATION_STARTED:'start',GENERATION_ENDED:'end',GENERATION_STOPPED:'stop',CHAT_CHANGED:'chat'},isDryRun:false,
   getStmbChatKey:()=>key,chat,extension_settings:{STMemoryBooks:{}},getMemoryBooksMode:()=> 'sloth',getCurrentStmbChatRef:()=>({}),
   getSlothAutomaticSettings:()=>({enabled}),getSlothProfileConfiguration:()=>({}),streamingProcessor:null,
   setTimeout:fn=>{const id=++next;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
   runNexusCollector:async options=>{calls.push(options.automaticChatKey);return {saved:false};},refreshSlothRoleControls:()=>{},
   syncSlothAutomaticStatus:()=>{},narratorResponseGeneration:{end(){},clear(){}},clearGenerationLorebookSnapshots:()=>{},console};
 vm.runInNewContext(segment,env);
 callbacks.start('normal',{},false);
 chat.push({mes:'reply'});callbacks.end();
 callbacks.stop();
 assert.equal(timers.size,0,'ambiguous UI unlock and stop are not a completed reply');
 env.receive(1,'quiet');env.receive(1,'first_message');
 assert.equal(timers.size,0);
 env.streamingProcessor={messageId:1,isFinished:false,isStopped:true};env.receive(1,'normal');
 assert.equal(timers.size,0,'failed stream is not a completed reply');
 env.streamingProcessor={messageId:1,isFinished:true,isStopped:false};env.receive(1,'normal');
 assert.equal(timers.size,1);
 env.receive(1,'normal');callbacks.start('quiet',{},false);callbacks.end();callbacks.stop();
 assert.equal(timers.size,1,'unrelated completion and stop preserve the completed reply timer');
 await [...timers.values()][0]();timers.clear();assert.deepEqual(calls,['chat-1']);
 callbacks.start('normal',{},false);chat.push({mes:'another reply'});env.streamingProcessor=null;env.receive(2,'normal');
 enabled=false;await [...timers.values()][0]();assert.deepEqual(calls,['chat-1'],'turning auto collection off prevents a queued call');
 timers.clear();enabled=true;
 callbacks.start('normal',{},false);
 chat.push({mes:'aborted reply'});
 env.streamingProcessor={type:'normal',messageId:3,isFinished:false,isStopped:true};
 callbacks.stop();env.receive(3,'normal');
 assert.equal(timers.size,0,'an explicitly aborted stream never schedules');
 callbacks.start('normal',{},false);env.streamingProcessor=null;
 chat.push({mes:'reply after switching'});
 callbacks.chat();env.receive(4,'normal');
 assert.equal(timers.size,0,'chat switch invalidates the old reply candidate');
 callbacks.start('normal',{},false);
 chat.push({mes:'completed reply'});env.receive(5,'normal');
 assert.equal(timers.size,1);
 callbacks.chat();
 assert.equal(timers.size,0,'chat switch cancels a previously queued timer');
});
