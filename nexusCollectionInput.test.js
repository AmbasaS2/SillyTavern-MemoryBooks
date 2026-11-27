import test from 'node:test';
import assert from 'node:assert/strict';
import {selectNexusPromptEntries,validateSelectedNexusResponse,estimateNexusTokens,SELECTIVE_DETAIL_BUDGET,SLOTH_NEXUS_INPUT_STRATEGY} from './nexusCollectionInput.js';
const messages=[{mes:'They discussed piano and 피아노 again.'}];
const row=(uid,comment,content,extra={})=>({uid,comment,content,...extra});
const small={entries:{
    1:row(1,'Core Memory','They trust each other.'),
    2:row(2,'Current Continuity','Injured hand.'),
    3:row(3,'LT - Piano','She plays piano.'),
    4:row(4,'LT - Bakery','Bakery address.'),
    5:row(5,'NPC - 아린','피아노 연주자.'),
    6:row(6,'PanelAssets','secret',{outletName:'panel'}),
    7:row(7,'LT - Constant','Permanent context',{constant:true}),
    8:row(8,'LT - Disabled','Never read this',{disable:true}),
}};
test('all strategies preserve core, continuity and constant entries; selective reads relevant details only',()=>{
    assert.equal(selectNexusPromptEntries(small,messages,'full'),null);
    assert.equal(selectNexusPromptEntries(small,messages,'hybrid'),null);
    const selected=selectNexusPromptEntries(small,messages,'selective');
    assert.deepEqual([...selected].sort((a,b)=>a-b),[1,2,3,5,7]);
    assert.equal(selectNexusPromptEntries(small,messages)===null,SLOTH_NEXUS_INPUT_STRATEGY==='hybrid');
});
test('hybrid selects on a large Nexus and detail input obeys approximate budget',()=>{
    const large=structuredClone(small);
    for(let i=10;i<30;i++)large.entries[i]=row(i,'LT - Piano '+i,'piano '.repeat(1500));
    const selected=selectNexusPromptEntries(large,messages,'hybrid');
    assert.deepEqual(selected,selectNexusPromptEntries(large,messages,'selective'));
    const details=[...selected].filter(uid=>uid!==1&&uid!==2&&uid!==7);
    assert.ok(details.reduce((sum,uid)=>sum+estimateNexusTokens(large.entries[uid].content),0)<=SELECTIVE_DETAIL_BUDGET);
    assert.ok(selected.has(1)&&selected.has(2)&&selected.has(7));
});
test('omitted body edit or requested omitted UID aborts before save, without a second request',()=>{
    const selected=selectNexusPromptEntries(small,messages,'selective');
    assert.doesNotThrow(()=>validateSelectedNexusResponse({needsNexusUids:[],edits:[{action:'append',uid:3}]},selected,small));
    assert.throws(()=>validateSelectedNexusResponse({needsNexusUids:[4],edits:[]},selected,small),/no memories saved/);
    assert.throws(()=>validateSelectedNexusResponse({needsNexusUids:[],edits:[{action:'append',uid:4}]},selected,small),/no memories saved/);
    assert.throws(()=>validateSelectedNexusResponse({edits:[]},selected,small),/missing needsNexusUids/);
    assert.doesNotThrow(()=>validateSelectedNexusResponse({edits:[]},null,small));
});
