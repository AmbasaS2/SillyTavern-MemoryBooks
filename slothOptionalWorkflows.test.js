import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { automaticCollectionDue, getSlothAutomaticSettings } from './slothAutomaticCollection.js';

test('automatic collection is opt-in and counts only new messages after its book-specific checkpoint', async () => {
    assert.deepEqual(getSlothAutomaticSettings({}), {
        enabled:false,mode:'tokens',field:'slothAutoTokens',threshold:50000,max:1000000,
    });
    const books={nexus:'Core-A',memory:'Memory-A'};
    const source=[{id:4,mes:'old'},{id:5,mes:'first'},{id:7,mes:'second'}];
    const previous={through:4,books};
    const scope={source,previous,books};
    assert.equal(await automaticCollectionDue({...scope,mode:'messages',threshold:2}),true);
    assert.equal(await automaticCollectionDue({...scope,mode:'messages',threshold:3}),false);
    assert.equal(await automaticCollectionDue({...scope,mode:'messages',threshold:3,books:{...books,memory:'Memory-B'}}),true);
    assert.equal(await automaticCollectionDue({...scope,mode:'tokens',threshold:50,countTokens:async text=>{
        assert.equal(text,'first\nsecond');
        return 50;
    }}),true);
});

test('a saved partial window leaves the unread messages due without replacing a concurrent auto checkpoint', async () => {
    const code=readFileSync(new URL('./nexusCollectorRuntime.js',import.meta.url),'utf8');
    const start=code.indexOf('async function updateCollectedLedger(');
    const end=code.indexOf('\nfunction ',start+1);
    const books={nexus:'Core',memory:'Memory'};
    const attempt={chatKey:'chat',through:14,books};
    let markers={slothAutomatic:attempt};
    const update=vm.runInNewContext(code.slice(start,end)+'\nupdateCollectedLedger',{
        getStmbChatKey:()=> 'chat',
        assertOrigin:()=>{},
        stringify:JSON.stringify,
        readReviewedChat:async()=>markers.slothCollection,
        patchVerifiedSlothMetadata:async (_ref,patch)=>{markers=patch(markers);},
    });
    const collect=()=>update({},[{segments:[[0,4]]}],{},books,[0,4],'fingerprint',{attempt,through:9});
    await collect();
    assert.equal(markers.slothAutomatic.through,9);
    assert.equal(await automaticCollectionDue({source:[{id:11},{id:14}],previous:markers.slothAutomatic,
        books,mode:'messages',threshold:2}),true);
    markers.slothAutomatic={...attempt,through:16};
    await collect();
    assert.equal(markers.slothAutomatic.through,16);
});


test('automatic progress reuses the threshold decision without extra exact token calls',async()=>{
    const books={nexus:'N',memory:'M'};
    const source=[{id:0,mes:'old'},{id:1,mes:'first'},{id:2,mes:'second'}];
    const previous={through:0,books};
    const readings=[];
    let calls=0;
    const opts={source,previous,books,mode:'tokens',threshold:20,
        countTokens:async text=>{calls++;assert.equal(text,'first\nsecond');return 11;},
        onReading:reading=>readings.push(reading)};
    assert.equal(await automaticCollectionDue({...opts,upperBound:()=>18}),false);
    assert.deepEqual(readings.pop(),{count:18,exact:false});
    assert.equal(calls,0);
    assert.equal(await automaticCollectionDue({...opts,upperBound:()=>30}),false);
    assert.deepEqual(readings.pop(),{count:11,exact:true});
    assert.equal(calls,1);
    assert.equal(await automaticCollectionDue({...opts,mode:'messages',threshold:2}),true);
    assert.deepEqual(readings.pop(),{count:2,exact:true});
    assert.equal(calls,1);
    assert.equal(await automaticCollectionDue({...opts,source:[]}),false);
    assert.deepEqual(readings.pop(),{count:0,exact:true});
    assert.equal(calls,1);
});
