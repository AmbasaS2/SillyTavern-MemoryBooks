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
    assert.match(text,/rememberPaidSlothDraft\(ref,draftBinding,raw,\{evidencePolicyVersion:2\}/);
    assert.match(text,/strictNexusEvidence:typeof rawDraft!=='string'\|\|\[1,2\]\.includes\(activeDraft\?\.evidencePolicyVersion\)/);
    assert.match(text,/evidencePolicyVersion:typeof rawDraft!=='string'\?2:\(activeDraft\?\.evidencePolicyVersion\?\?0\)/);
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
