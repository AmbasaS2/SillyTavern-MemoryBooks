import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {withSlothLorebookWriteLane} from './slothWriteLane.js';
import {commitVerifiedWorldInfoBooks} from './nexusCollectionCommit.js';
import {migrateLorebookSummarySchema} from './summaryTiers.js';
import {fingerprintRollbackEntry} from './memoryRollback.js';

const source=readFileSync(new URL('./index.js',import.meta.url),'utf8');
function section(start,end){
    const a=source.indexOf(start),b=source.indexOf(end,a);
    assert.ok(a>=0&&b>a,start);return source.slice(a,b);
}
const book=()=>({entries:{0:{uid:0,stmbArc:true,content:'old memory'}}});
const clone=structuredClone;
function storage(){
    let disk=book(),writes=0,drop=false;
    const cache=new Map([['A',clone(disk)]]);
    const h=vm.createContext({
        getLorebookDataFingerprint:fingerprintRollbackEntry,deepClone:clone,
        worldInfoHost:{worldInfoCache:cache},
        withStmbWriteLane:(identity,task)=>withSlothLorebookWriteLane(identity.name,task),
        commitVerifiedWorldInfoBooks,migrateLorebookSummarySchema,
        loadRollbackWorldInfo:async()=>clone(disk),
        saveWorldInfo:async(name,data)=>{writes++;cache.set(name,clone(data));if(!drop)disk=clone(data);},
    });
    vm.runInContext(section('async function updateOriginalLorebookUnderLane(', 'async function maybePromptAutoConsolidation('),h);
    return {h,cache,disk:()=>disk,writes:()=>writes,fail:()=>{drop=true;},update:data=>{disk=clone(data);cache.set('A',clone(data));}};
}
test('Original migration waits for a same-book write and retains the new memory',async()=>{
    const s=storage();let release,started;
    const gate=new Promise(r=>release=r),ready=new Promise(r=>started=r);
    const memory=withSlothLorebookWriteLane('A',async()=>{started();await gate;const data=clone(s.disk());data.entries[1]={uid:1,content:'new memory'};s.update(data);});
    await ready;
    const migrate=s.h.loadAndMigrateSummaryLorebook('A');await Promise.resolve();
    assert.equal(s.writes(),0);
    release();await memory;const result=await migrate;
    assert.equal(result.entries[1].content,'new memory');
    assert.equal(result.entries[0].stmbSummary,true);
    assert.equal(s.disk().entries[1].content,'new memory');
    assert.equal(s.writes(),1);
    await s.h.loadAndMigrateSummaryLorebook('A');assert.equal(s.writes(),1);
});
test('Original migration rejects pending editor changes and silent write failure',async()=>{
    const dirty=storage();dirty.cache.get('A').entries[0].content='pending edit';
    await assert.rejects(dirty.h.loadAndMigrateSummaryLorebook('A'),/changed in another editor/);
    assert.equal(dirty.writes(),0);assert.equal(dirty.cache.get('A').entries[0].content,'pending edit');
    const failed=storage();failed.fail();
    await assert.rejects(failed.h.loadAndMigrateSummaryLorebook('A'),/Read-back mismatch/);
    assert.deepEqual(failed.disk(),book());assert.deepEqual(failed.cache.get('A'),book());
});
test('stale selection does not start a schema write',async()=>{
    const s=storage();let release,started;const gate=new Promise(r=>release=r),ready=new Promise(r=>started=r);
    const other=withSlothLorebookWriteLane('A',async()=>{started();await gate;});await ready;
    let current=true;const migration=s.h.loadAndMigrateSummaryLorebook('A',()=>current);
    const rejected=assert.rejects(migration,/selection or chat changed/);current=false;release();await other;await rejected;
    assert.equal(s.writes(),0);
});
function selectionHarness(){
    let handler,resolveB;
    const waiting=new Promise(r=>resolveB=r),select={value:'A'},renders=[];
    const h=vm.createContext({
        dlg:{querySelector:()=>({addEventListener:(_,callback)=>{handler=callback;}})},
        lorebookName:'A',lorebookData:{entries:{A:{uid:'A'}}},allEntries:[{uid:'A'}],
        sourceLorebookLoadSequence:0,isSourceLorebookLoading:false,sourceChatKey:'chat',
        getStmbChatKey:()=> 'chat',
        renderTierState:()=>renders.push(h.isSourceLorebookLoading),
        loadAndMigrateSummaryLorebook:async name=>name==='B'?waiting:{entries:{C:{uid:'C'}}},
        toastr:{error(){}},tr:(_key,fallback)=>fallback,console:{error(){}},
    });
    vm.runInContext(section('    dlg\n      .querySelector("#stmb-consolidation-lorebook")','    dlg\n      .querySelector("#stmb-summary-tier")'),h);
    return {h,select,renders,change:value=>{select.value=value;return handler({target:select});},resolveB};
}
test('A to B to A cannot leave B behind the selected A',async()=>{
    const s=selectionHarness(),b=s.change('B');
    await s.change('A');s.resolveB({entries:{B:{uid:'B'}}});await b;
    assert.equal(s.select.value,'A');assert.equal(s.h.lorebookName,'A');
    assert.equal(s.h.allEntries[0].uid,'A');assert.equal(s.h.isSourceLorebookLoading,false);
});
test('newer C selection wins when B finishes later',async()=>{
    const s=selectionHarness(),b=s.change('B');
    await s.change('C');s.resolveB({entries:{B:{uid:'B'}}});await b;
    assert.equal(s.h.lorebookName,'C');assert.equal(s.h.allEntries[0].uid,'C');
    assert.equal(s.h.isSourceLorebookLoading,false);
});
test('run checks current UI selection and invalidates outstanding loads on close',()=>{
    const run=section('    const res = await popup.show();\n    const sourceSelector','    const targetTier = clampInt(');
    assert.match(run,/!isSourceLorebookLoading/);assert.match(run,/sourceSelector\.value/);
    assert.match(run,/sourceLorebookLoadSequence\+\+/);assert.match(run,/if \(!selectionMatches\)/);
});
