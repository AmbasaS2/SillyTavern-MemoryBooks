import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as mb from '../lore-manager-translations.js';
import * as wi from '../../info/lore-manager-translations.js';
import {translationBookPath,TRANSLATION_STORE_FORMAT} from '../../manager/translation-storage.js';
import {setNexusChatRoleOverride} from '../nexusChatRoleOverrides.js';
import {scopeNexusWorldInfo} from '../nexusWorldInfoScope.js';
import {prepareJevRecall,jevEntryKey} from '../../ordering/jevRecall.mjs';
import {createTokenLedger} from '../../ordering/jevMetrics.mjs';
import {connectStloMetrics} from '../../info/stlo-metrics-link.mjs';

test('actual Manager writer path and both reader implementations agree for Korean, Unicode and same-title books',async()=>{
    assert.equal(readFileSync(new URL('../lore-manager-translations.js',import.meta.url),'utf8'),readFileSync(new URL('../../info/lore-manager-translations.js',import.meta.url),'utf8'));
    for(const book of ['일반 세계관','A Rose & A Rose','🦊狐🦊','A','B','é','é']){
        const path=translationBookPath(book);
        for(const api of [mb,wi]){
            assert.equal(api.managerTranslationBookPath(book),path);
            const snapshot={format:TRANSLATION_STORE_FORMAT,book,revision:1,records:{},pairs:{}};
            let calls=0;
            assert.deepEqual(await api.readManagerTranslationBook(book,async(url,options)=>{
                calls++;assert.equal(url,path);assert.equal(options.cache,'no-store');
                return {ok:true,json:async()=>snapshot};
            }),snapshot);
            assert.equal(calls,1);
        }
    }
});
test('Memory Books AU scope excludes other chats before actual Jev candidate preparation',()=>{
    const avatar='A.png',ref={type:'character',avatarUrl:avatar,fileName:'au'},chatKey='character:A.png:au';
    const settings={nexusCharacterRoles:{[avatar]:{nexus:'A Nexus',memory:'A Memory'},'B.png':{nexus:'B Nexus',memory:'B Memory'}},nexusChatRoleOverrides:{},nexusChatScopedWorlds:{}};
    setNexusChatRoleOverride(settings.nexusChatRoleOverrides,ref,chatKey,{nexus:'AU Nexus',memory:'AU Memory'});
    const entry=(world,uid,props={})=>({world,uid,position:0,content:world+' '+uid,vectorized:true,...props});
    const correct=entry('AU Memory',3),recent=entry('AU Memory',4,{constant:true}),outlet=entry('AU Nexus',5,{position:7,outletName:'PanelAssets'});
    const lists={globalLore:[entry('B Memory',1)],characterLore:[entry('A Memory',1),correct,recent,outlet],chatLore:[entry('AU Memory',6,{disable:true})],personaLore:[]};
    scopeNexusWorldInfo(lists,{settings,ref,avatar,chatKey});
    const all=Object.values(lists).flat();
    assert.deepEqual(all.map(jevEntryKey),[correct,recent,outlet,entry('AU Memory',6)].map(jevEntryKey));
    const prepared=prepareJevRecall(all,new Set(['AU Nexus','AU Memory','A Memory','B Memory']),[{name:'A',mes:'Remember our last meeting?'}]);
    assert.deepEqual([...prepared.candidates.values()],[jevEntryKey(correct)]);
});
test('actual Ordering ledger and WorldInfo Info consumer share exact count and invalidate stale generation',async()=>{
    const ledger=createTokenLedger(),generation={},tokenizer='test-tokenizer';
    let active=true,calls=0,fallbacks=0;
    const bridge={version:1,context:()=>active?{generation,tokenizer}:null,
        lookup:d=>ledger.lookup(d),measure:d=>ledger.measure(d,()=>{calls++;return 13;},()=>active)};
    const link=connectStloMetrics(()=>bridge);
    const entry={world:'AU Memory',uid:3};
    const fallback=()=>{fallbacks++;return 99;};
    assert.deepEqual(await Promise.all([link.count(entry,'scene\n',fallback,()=>true),link.count(entry,'scene\n',fallback,()=>true)]),[13,13]);
    assert.equal(calls,1);assert.equal(fallbacks,0);
    active=false;
    assert.equal(await link.count(entry,'scene\n',fallback,()=>true),99);
    assert.equal(fallbacks,1);
});


// Verify the actual separate copies loaded by both independently installed extensions.
import {withSlothLorebookWriteLane as memoryWrite} from '../slothWriteLane.js';
import {withSlothLorebookWriteLane as managerWrite} from '../../manager/slothWriteLane.js';
test('Memory Books and Manager share a per-book lane, including recovery from rejection',async()=>{
    const events=[];
    let release,started;
    const firstStarted=new Promise(resolve=>{started=resolve;});
    const gate=new Promise(resolve=>{release=resolve;});
    const first=memoryWrite('shared book',async()=>{events.push('memory:start');started();await gate;events.push('memory:end');throw new Error('write rejected');});
    const rejected=assert.rejects(first,/write rejected/);
    await firstStarted;
    const second=managerWrite('shared book',async()=>{events.push('manager');return 42;});
    await managerWrite('independent book',async()=>{events.push('independent');});
    assert.deepEqual(events,['memory:start','independent']);
    release();
    await rejected;
    assert.equal(await second,42);
    assert.deepEqual(events,['memory:start','independent','memory:end','manager']);
    assert.equal(await memoryWrite('shared book',()=>17),17);
});

test('actual ST emitter awaits Memory Books enrichment before Ordering calculates budgets',async()=>{
    const vm=await import('node:vm');
    const {mergeNarratorLorebookEntries}=await import('../narratorMode.js');
    const host=readFileSync(new URL('../../host/public/lib/eventemitter.js',import.meta.url),'utf8');
    const errors=[];
    const logger={debug(){},trace(){},error(...args){errors.push(args);}};
    const EventEmitter=vm.runInNewContext(host.replace(/export\s*\{\s*EventEmitter\s*\}\s*;?/,'')+'\nEventEmitter',{
        localStorage:{getItem:()=>null},console:logger
    });
    const eventSource=new EventEmitter();
    const event_types={WORLDINFO_ENTRIES_LOADED:'worldinfo_entries_loaded'};
    const ordering=readFileSync(new URL('../../ordering/index.js',import.meta.url),'utf8');
    const a=ordering.indexOf('async function applyPriorityOrdering(');
    const b=ordering.indexOf('\n// Extension initialization',a);
    assert.ok(a>=0&&b>a);
    const state={currentSpeakingCharacter:'A',scanWorldSettings:new Map()};
    const settingsReads=[];
    const apply=vm.runInNewContext(ordering.slice(a,b)+'\napplyPriorityOrdering',{
        EXTENSION_STATE:state,PRIORITY_LEVELS:{DEFAULT:3},HAS_WORLDINFO_SCAN_DONE:false,
        jevGeneration:null,getProtectAlwaysOn:()=>false,DEBUG_STLO:false,
        getLorebookSettings:async name=>{settingsReads.push(name);return {priority:5};},console:logger
    });
    eventSource.on(event_types.WORLDINFO_ENTRIES_LOADED,async lists=>{assert.equal(await apply(lists),true);});
    const memory=readFileSync(new URL('../index.js',import.meta.url),'utf8');
    const start=memory.indexOf('  eventSource.makeFirst(event_types.WORLDINFO_ENTRIES_LOADED, async lists => {');
    const end=memory.indexOf('\n  window.addEventListener("resize", () => {',start);
    assert.ok(start>=0&&end>start);
    const ref={type:'character',avatarUrl:'A.png',fileName:'narrator'};
    vm.runInNewContext(memory.slice(start,end),{
        eventSource,event_types,getCurrentStmbChatRef:()=>ref,extension_settings:{STMemoryBooks:{}},
        getStmbChatKey:()=> 'character:A.png:narrator',scopeNexusWorldInfo,
        narratorGenerationSnapshot:['member'],manualGroupGenerationSnapshot:null,
        getCurrentMemoryBooksContext:()=>({isNarratorMode:true}),
        getCurrentNarratorConfig:()=>({members:[{id:'member',lorebookName:'narrator-book'}]}),
        characters:[{avatar:'A.png'}],this_chid:0,
        loadWorldInfo:async()=>{await Promise.resolve();return {entries:{1:{uid:1,content:'Lore',order:100}}};},
        mergeNarratorLorebookEntries
    });
    const lists={globalLore:[],characterLore:[],chatLore:[],personaLore:[]};
    await eventSource.emit(event_types.WORLDINFO_ENTRIES_LOADED,lists);
    assert.deepEqual(errors,[]);
    assert.deepEqual(settingsReads,['narrator-book']);
    const all=Object.values(lists).flat();
    assert.equal(all.length,1);
    assert.equal(all[0].world,'narrator-book');
    assert.equal(all[0].order,50100);
    assert.equal(state.scanWorldSettings.has('narrator-book'),true);
});
