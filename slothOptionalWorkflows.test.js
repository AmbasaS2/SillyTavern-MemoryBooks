import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticCollectionDue, getSlothAutomaticSettings } from './slothAutomaticCollection.js';
import { applySlothJevRecall, prepareSlothJevRecall, requestSlothJevRecall } from './slothJevRecall.js';

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

test('Jev submits scoped old memory candidates once and injects only selected copies', async () => {
    const scene=(uid, value={})=>({uid, world:'Memory-A', comment:uid+' - The red lantern',
        content:'**Scene**\nShe left a red lantern.\n\n**Result**\nThe lantern stayed.', key:['red lantern'],
        constant:false,vectorized:true, ...value});
    const chosenSource=scene(1);
    const recent=scene(2,{constant:true});
    const archived=scene(3,{disable:true});
    const otherWorld=scene(4,{world:'Memory-B'});
    const otherOld=scene(5);
    const lists={globalLore:[chosenSource,recent,archived],characterLore:[chosenSource,otherWorld,otherOld]};
    const prepared=prepareSlothJevRecall(lists,'Memory-A',[
        {name:'User',mes:'What about the red lantern?'},
        {name:'System',mes:'Hidden direction.',is_system:true},
    ]);
    assert.deepEqual(prepared.candidateIds,[5,1]);
    assert.equal(prepared.body.state.current.length,1);
    assert.deepEqual(Object.keys(prepared.body.questions),['m5','m1']);
    const response={answers:{m1:{choice:'include',probabilities:{include:.93}},m5:{choice:'skip'},m2:{choice:'include'}}};
    const selected=await requestSlothJevRecall(prepared,{}, {
        fetchImpl:async (route,request)=>{
            assert.equal(route,'/api/plugins/scene-reader-jev/nanogpt/systemone');
            assert.equal(JSON.parse(request.body).model,'typesafe/jev-1.14');
            return {ok:true,json:async()=>response};
        },
    });
    const applied=applySlothJevRecall(lists,'Memory-A',new Set([...selected,2,3,4,999]));
    assert.deepEqual([...applied],[1]);
    assert.deepEqual(lists.globalLore,[{...chosenSource,constant:true,vectorized:false},recent,archived]);
    assert.deepEqual(lists.characterLore,[otherWorld]);
    assert.equal(chosenSource.constant,false);
    await assert.rejects(requestSlothJevRecall(prepared,{}, {
        fetchImpl:async()=>({ok:false,status:404}),
    }),/unavailable/);
});
