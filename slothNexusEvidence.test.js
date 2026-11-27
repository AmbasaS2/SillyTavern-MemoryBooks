import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {requiresSlothNexusEvidence,assertSlothNexusEvidence} from './slothNexusEvidence.js';
import {stageNexusEdits} from './nexusCollectionPolicy.js';
import {slothEditSignature} from './slothSingleRecovery.js';

const nexus={entries:{
    1:{uid:1,comment:'Core Memory',content:'They are friends.',constant:true},
    2:{uid:2,comment:'LT - Tea',content:'She likes tea.'},
    3:{uid:3,comment:'Current Continuity',constant:true,
        content:'## Present Handoff\nThey are outside.\n\n## Knowledge Boundaries\nOnly she knows the password.'},
}};
const messages=[{id:4,mes:'They agreed to be partners.'},{id:5,mes:'She gave him the password.'},{id:6,mes:'The kettle boiled.'}];
const source=new Map(messages.map(m=>[m.id,m.mes]));
const core={uid:1,kind:'core',action:'replace_exact',find:'They are friends.',text:'They are partners.'};
const ordinary={uid:2,kind:'lt',action:'append',text:'She uses a blue teapot.',risk:'ordinary'};
const knowledge={uid:3,kind:'continuity',action:'replace_exact',find:'Only she knows the password.',text:'They both know the password.'};
const handoff={uid:3,kind:'continuity',action:'replace_exact',find:'They are outside.',text:'They are inside.'};
test('evidence is selected by risk and structural scope, not all edits',()=>{
    for(const edit of [core,knowledge,{...ordinary,risk:'sensitive'},
        {...handoff,text:'',supersession:'observed_resolution'},
        {kind:'continuity',action:'append_section',section:'Knowledge Boundaries',text:'She knows.'},
        {kind:'continuity',action:'create',content:'## Knowledge Boundaries\nShe knows.'}]){
        assert.equal(requiresSlothNexusEvidence(edit,nexus),true);
        assert.throws(()=>assertSlothNexusEvidence(edit,nexus,source),/needs one to three/);
    }
    assert.equal(requiresSlothNexusEvidence(ordinary,nexus),false);
    assert.equal(requiresSlothNexusEvidence(handoff,nexus),false);
    assert.doesNotThrow(()=>assertSlothNexusEvidence(ordinary,nexus,source));
    assert.doesNotThrow(()=>assertSlothNexusEvidence({...core,evidence:[{messageId:4,quote:'agreed to be partners'}]},nexus,source));
    assert.throws(()=>assertSlothNexusEvidence({...core,evidence:[{messageId:5,quote:'agreed to be partners'}]},nexus,source),/does not match/);
});
test('new sensitive failures remain pending independently and legacy drafts retain their old contract',()=>{
    const text=readFileSync(new URL('./nexusCollectionAI.js',import.meta.url),'utf8');
    const section=(a,b)=>text.slice(text.indexOf(a),text.indexOf(b,text.indexOf(a)));
    const filter=vm.runInNewContext(section('function canonicalizeNewNexusTitles(','function parseStrictJSON(')+'\n'+
        section('function readSlothNexusEdits(','async function reviewSlothSceneDrafts(')+'\nreadSlothNexusEdits',{
        stageNexusEdits,slothEditSignature,assertSlothNexusEvidence,console:{warn(){}},
    });
    const before=JSON.stringify(nexus),validKnowledge={...knowledge,evidence:[{messageId:5,quote:'gave him the password'}]};
    const raw={edits:[core,ordinary,validKnowledge]};
    const fresh=filter(raw,{messages,nexus,strictNexusEvidence:true});
    assert.deepEqual(JSON.parse(JSON.stringify(fresh.edits)),[ordinary,validKnowledge]);
    assert.deepEqual(JSON.parse(JSON.stringify(fresh.pendingEdits)),[core]);
    assert.match(fresh.pendingIssues[0].reason,/needs one to three/);
    assert.equal(JSON.stringify(nexus),before);
    const repaired={...core,evidence:[{messageId:4,quote:'agreed to be partners'}]};
    const replay=filter({edits:[repaired,ordinary,validKnowledge]},{messages,nexus,strictNexusEvidence:true,committedEdits:fresh.edits});
    assert.deepEqual(JSON.parse(JSON.stringify(replay.edits)),[repaired]);
    const legacy=filter(raw,{messages,nexus});
    assert.equal(legacy.edits.length,3);
});
test('evidence policy is stored before parsing and follows whole and partial recovery',()=>{
    const text=readFileSync(new URL('./nexusCollectorRuntime.js',import.meta.url),'utf8');
    assert.match(text,/rememberPaidSlothDraft\(ref,draftBinding,raw,\{evidencePolicyVersion:4\}/);
    assert.match(text,/strictNexusEvidence:typeof rawDraft!=='string'\|\|\[1,2,3,4\]\.includes\(activeDraft\?\.evidencePolicyVersion\)/);
    assert.match(text,/evidencePolicyVersion:typeof rawDraft!=='string'\?4:\(activeDraft\?\.evidencePolicyVersion\?\?0\)/);
    assert.match(text,/evidencePolicyVersion:previousDraft\.evidencePolicyVersion/);
    assert.match(text,/evidencePolicyVersion:activeDraft\.evidencePolicyVersion/);
    assert.match(text,/originalRaw:previousDraft\.originalRaw\?\?previousDraft\.raw/);
    assert.match(text,/originalRaw:activeDraft\.originalRaw\?\?activeDraft\.raw/);
});

test('v2 preserves structural evidence checks while deferring model-tagged LT sensitivity; v1 replay is unchanged',()=>{
    const marked={...ordinary,risk:'sensitive'};
    assert.equal(requiresSlothNexusEvidence(marked,nexus,1),true);
    assert.equal(requiresSlothNexusEvidence(marked,nexus,2),false);
    assert.throws(()=>assertSlothNexusEvidence(marked,nexus,source,1),/needs one to three/);
    assert.doesNotThrow(()=>assertSlothNexusEvidence(marked,nexus,source,2));
    for(const edit of [core,knowledge,{...handoff,text:'',supersession:'observed_resolution'},
        {kind:'continuity',action:'append_section',section:'Knowledge Boundaries',text:'She knows.'},
        {kind:'continuity',action:'create',content:'## Knowledge Boundaries\nShe knows.'}]){
        assert.equal(requiresSlothNexusEvidence(edit,nexus,2),true);
        assert.throws(()=>assertSlothNexusEvidence(edit,nexus,source,2),/needs one to three/);
    }
});
test('v2 stages valid rows independently, keeps structural failure reasons and preserves old evidence contract',()=>{
    const text=readFileSync(new URL('./nexusCollectionAI.js',import.meta.url),'utf8');
    const section=(a,b)=>text.slice(text.indexOf(a),text.indexOf(b,text.indexOf(a)));
    const filter=vm.runInNewContext(section('function canonicalizeNewNexusTitles(','function parseStrictJSON(')+'\n'+
        section('function readSlothNexusEdits(','async function reviewSlothSceneDrafts(')+'\nreadSlothNexusEdits',{
        stageNexusEdits,slothEditSignature,assertSlothNexusEvidence,console:{warn(){}},
    });
    const marked={...ordinary,risk:'sensitive'},bad={...ordinary,uid:99};
    const validKnowledge={...knowledge,evidence:[{messageId:5,quote:'gave him the password'}]};
    const raw={edits:[core,marked,validKnowledge,bad]};
    const before=JSON.stringify(nexus);
    const v2=filter(raw,{messages,nexus,strictNexusEvidence:true,evidencePolicyVersion:2});
    assert.deepEqual(JSON.parse(JSON.stringify(v2.edits)),[marked,validKnowledge]);
    assert.deepEqual(JSON.parse(JSON.stringify(v2.pendingEdits)),[core,bad]);
    assert.equal(v2.pendingIssues.length,2);
    const v1=filter(raw,{messages,nexus,strictNexusEvidence:true,evidencePolicyVersion:1});
    assert.deepEqual(JSON.parse(JSON.stringify(v1.edits)),[validKnowledge]);
    const legacy=filter(raw,{messages,nexus});
    assert.deepEqual(JSON.parse(JSON.stringify(legacy.edits)),[core,marked,validKnowledge]);
    assert.equal(legacy.pendingIssues.length,1);
    assert.equal(JSON.stringify(nexus),before);
});
test('stabilization preserves baseline writing guidance and narrows only the evidence contract',()=>{
    const text=readFileSync(new URL('./nexusCollectionAI.js',import.meta.url),'utf8');
    assert.match(text,/Core Memory stores durable operative rules, habits, wounds, boundaries, promises, secrets, lasting changes and concrete Recall Cues\.['"]/);
    assert.doesNotMatch(text,/Before finalizing each completed row|For each Nexus edit set risk to ordinary or sensitive/);
    assert.match(text,/For Core changes, Current Continuity retirement/);
});

test('v3 uses an existing LT title or changed claim even when the model omits or denies risk',()=>{
    const book={entries:{...nexus.entries,
        4:{uid:4,comment:'LT - Studio agreement',content:'Jo waits for permission.'},
        5:{uid:5,comment:'LT - Studio',content:'Jo rings the bell three times.'},
        6:{uid:6,comment:'LT - 약속',content:'연락하기로 했다.'},
    }};
    for(const e of [
        {uid:4,kind:'lt',action:'append',text:'They reaffirmed the three-times rule.'},
        {uid:5,kind:'lt',action:'replace_exact',find:'Jo rings the bell three times.',text:'Jo rings three bells.',risk:'ordinary'},
        {uid:2,kind:'lt',action:'append',text:'She promised to ask first.',risk:'ordinary'},
        {kind:'lt',action:'create',title:'LT - Visits',content:'He must not disclose the code.'},
        {kind:'lt',action:'create',title:'LT - 약속',content:'다음 주에 온다.'},
        {uid:6,kind:'lt',action:'append',text:'매주 금요일에 연락한다.'},
    ]){
        assert.equal(requiresSlothNexusEvidence(e,book,3),true);
        assert.throws(()=>assertSlothNexusEvidence(e,book,source,3),/needs one to three/);
        assert.equal(requiresSlothNexusEvidence(e,book,2),false);
    }
    const ordinaryAdds=[ordinary,{kind:'lt',action:'create',title:'LT - Bakery',content:'She likes sourdough.'},
        {uid:5,kind:'lt',action:'append',text:'The bell is brass.'}];
    for(const e of ordinaryAdds)assert.equal(requiresSlothNexusEvidence(e,book,3),false);
    assert.equal(requiresSlothNexusEvidence({...ordinary,risk:'sensitive'},book,3),false);
    assert.equal(requiresSlothNexusEvidence({...ordinary,kind:'npc'},book,3),false);
    assert.equal(requiresSlothNexusEvidence(core,book,3),true);
    assert.equal(requiresSlothNexusEvidence(knowledge,book,3),true);
});
test('v3 holds an unsupported LT replacement alone and accepts a corrected replay without reapplying ordinary edits',()=>{
    const text=readFileSync(new URL('./nexusCollectionAI.js',import.meta.url),'utf8');
    const section=(a,b)=>text.slice(text.indexOf(a),text.indexOf(b,text.indexOf(a)));
    const filter=vm.runInNewContext(section('function canonicalizeNewNexusTitles(','function parseStrictJSON(')+'\n'+
        section('function readSlothNexusEdits(','async function reviewSlothSceneDrafts(')+'\nreadSlothNexusEdits',{
        stageNexusEdits,slothEditSignature,assertSlothNexusEvidence,console:{warn(){}},
    });
    const book={entries:{...nexus.entries,4:{uid:4,comment:'LT - Studio agreement',content:'Jo rings the bell twice.'}}};
    const original=JSON.stringify(book),sourceMessages=[...messages,{id:7,mes:'Jo agreed to ring the bell three times.'}];
    const wrong={uid:4,kind:'lt',action:'replace_exact',find:'Jo rings the bell twice.',text:'Jo rings three bells.',risk:'ordinary'};
    const raw={edits:[wrong,ordinary]};
    const args={messages:sourceMessages,nexus:book,strictNexusEvidence:true,evidencePolicyVersion:3};
    const first=filter(raw,args);
    assert.deepEqual(JSON.parse(JSON.stringify(first.edits)),[ordinary]);
    assert.deepEqual(JSON.parse(JSON.stringify(first.pendingEdits)),[wrong]);
    assert.match(first.pendingIssues[0].reason,/needs one to three/);
    const badQuote={...wrong,evidence:[{messageId:7,quote:'ring three bells'}]};
    assert.equal(filter({edits:[badQuote]},args).edits.length,0);
    const corrected={...wrong,text:'Jo rings the bell three times.',evidence:[{messageId:7,quote:'ring the bell three times'}]};
    const replay=filter({edits:[corrected,ordinary]},{...args,committedEdits:first.acceptedRawEdits});
    assert.deepEqual(JSON.parse(JSON.stringify(replay.edits)),[corrected]);
    assert.equal(JSON.stringify(book),original);
    assert.equal(filter(raw,{...args,evidencePolicyVersion:2}).edits.length,2);
    assert.equal(filter(raw,{...args,strictNexusEvidence:false}).edits.length,2);
});

test('v4 uses the changed LT claim, so a title alone no longer holds ordinary appends',()=>{
    const book={entries:{...nexus.entries,4:{uid:4,comment:'LT - Travel Agreement',content:'They agreed to ask before booking.'}}};
    const everyday={kind:'lt',action:'append',uid:4,text:'She put the notebook away.'};
    assert.equal(requiresSlothNexusEvidence(everyday,book,3),true);
    assert.equal(requiresSlothNexusEvidence(everyday,book,4),false);
    for(const text of ['He would check with her before booking.','From now on, they would ask first.','The decision was up to Mara.','He gave her his word.','Mara does not know the code.','다음부터 먼저 연락하기로 했다.','今後は先に聞くことにした。','从今以后先问她。']){
        const edit={...everyday,text,risk:'ordinary'};
        assert.equal(requiresSlothNexusEvidence(edit,book,4),true,text);
        assert.throws(()=>assertSlothNexusEvidence(edit,book,source,4),/needs one to three/);
    }
    assert.equal(requiresSlothNexusEvidence({...everyday,action:'replace_exact'},book,4),true);
    assert.equal(requiresSlothNexusEvidence({kind:'lt',action:'create',title:'LT - Promise',content:'She will return.'},book,4),true);
    assert.equal(requiresSlothNexusEvidence({...everyday,kind:'npc'},book,4),false);
    assert.equal(requiresSlothNexusEvidence(core,book,4),true);
    assert.equal(requiresSlothNexusEvidence(knowledge,book,4),true);
});
test('v4 catches direct contradictory knowledge evidence without pretending to infer general meaning',()=>{
    const edit={kind:'lt',action:'append',uid:2,text:'Mara knows the code.',risk:'ordinary'};
    const original=new Map([[7,'Mara does not know the code.'],[8,'Mara knows the code.'],[9,'Leo does not know the code.'],[10,'Mara did not know the code.'],[11,'Mara does not know the code yet.'],[12,'Iris said Mara does not know the code.']]);
    const cite=(...ids)=>({...edit,evidence:ids.map(messageId=>({messageId,quote:original.get(messageId)}))});
    assert.throws(()=>assertSlothNexusEvidence(cite(7),nexus,original,4),/directly contradicts/);
    assert.throws(()=>assertSlothNexusEvidence({...edit,evidence:[{messageId:7,quote:'know the code'}]},nexus,original,4),/directly contradicts/);
    assert.throws(()=>assertSlothNexusEvidence({...cite(8),text:'Mara does not know the code.'},nexus,original,4),/directly contradicts/);
    assert.doesNotThrow(()=>assertSlothNexusEvidence(cite(7),nexus,original,3));
    for(const ids of [[8],[9],[10],[11],[12],[7,8]])assert.doesNotThrow(()=>assertSlothNexusEvidence(cite(...ids),nexus,original,4));
    assert.doesNotThrow(()=>assertSlothNexusEvidence({...cite(7),text:'She knows the code.'},nexus,original,4));
});
test('v4 mixed response holds direct contradiction and indirect unsupported obligation independently; v2 and v3 replay remain distinct',()=>{
    const text=readFileSync(new URL('./nexusCollectionAI.js',import.meta.url),'utf8');
    const section=(a,b)=>text.slice(text.indexOf(a),text.indexOf(b,text.indexOf(a)));
    const filter=vm.runInNewContext(section('function canonicalizeNewNexusTitles(','function parseStrictJSON(')+'\n'+section('function readSlothNexusEdits(','async function reviewSlothSceneDrafts(')+'\nreadSlothNexusEdits',{stageNexusEdits,slothEditSignature,assertSlothNexusEvidence,console:{warn(){}}});
    const book={entries:{...nexus.entries,4:{uid:4,comment:'LT - Travel Agreement',content:'They agreed to ask before booking.'},5:{uid:5,comment:'LT - Code',content:'A code exists.'}}};
    const ordinaryAppend={kind:'lt',action:'append',uid:4,text:'She put the notebook away.'};
    const obligation={kind:'lt',action:'append',uid:2,text:'He would check with her before booking.'};
    const wrong={kind:'lt',action:'append',uid:5,text:'Mara knows the code.',evidence:[{messageId:7,quote:'Mara does not know the code.'}]};
    const msg=[...messages,{id:7,mes:'Mara does not know the code.'},{id:8,mes:'He would check with her before booking.'}];
    const args={messages:msg,nexus:book,strictNexusEvidence:true};
    const raw={edits:[ordinaryAppend,obligation,wrong]};
    const result=filter(raw,{...args,evidencePolicyVersion:4});
    assert.deepEqual(JSON.parse(JSON.stringify(result.edits)),[ordinaryAppend]);
    assert.deepEqual(JSON.parse(JSON.stringify(result.pendingEdits)),[obligation,wrong]);
    const repaired=[{...obligation,evidence:[{messageId:8,quote:msg.at(-1).mes}]},{...wrong,text:'Mara does not know the code.'}];
    const replay=filter({edits:[ordinaryAppend,...repaired]},{...args,evidencePolicyVersion:4,committedEdits:result.acceptedRawEdits});
    assert.deepEqual(JSON.parse(JSON.stringify(replay.edits)),repaired);
    assert.equal(filter(raw,{...args,evidencePolicyVersion:2}).edits.length,3);
    assert.deepEqual(JSON.parse(JSON.stringify(filter(raw,{...args,evidencePolicyVersion:3}).edits)),[obligation,wrong]);
});
