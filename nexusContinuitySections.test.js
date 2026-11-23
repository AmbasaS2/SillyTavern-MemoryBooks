import test from 'node:test';
import assert from 'node:assert/strict';
import {appendContinuitySection, guardContinuityChange} from './nexusContinuitySections.js';
import {stageNexusEdits} from './nexusCollectionPolicy.js';

const initial = [
    '## Present Handoff',
    'The pair is in the kitchen.',
    '',
    '## Active Threads',
    'The letter remains unanswered.',
    '',
    '## Knowledge Boundaries',
    'A knows the secret. B does not.',
    '',
    '## Active Conditions',
    'B is recovering from an injury.',
].join('\n');
const book = value => ({
    entries: {
        3: {uid:3,comment:'Current Continuity',content:value,constant:true,
            disable:false,position:0,STMB_sourceHistory:{readOnly:'keep'}},
        5: {uid:5,comment:'NPC: A',content:'The original personality.',
            constant:false,vectorized:true,position:0},
    },
    stlo: {order:['A','B']},
});
const maker = world => {
    const uid = Math.max(...Object.values(world.entries).map(item=>item.uid))+1;
    return world.entries[uid]={uid,comment:'',content:'',disable:false};
};

test('append_section preserves all other Continuity sections, custom metadata and original book',()=>{
    const original=book(initial),snapshot=structuredClone(original);
    const result=stageNexusEdits(original,[{
        kind:'continuity',action:'append_section',uid:3,
        section:'Active Threads',text:'A promised to answer the letter tomorrow.',
    }],maker);
    const updated=result.staged.entries[3].content;
    assert.match(updated,/letter remains unanswered\.[\s\S]*A promised to answer/);
    assert.equal(updated.slice(updated.indexOf('## Knowledge Boundaries')),
        initial.slice(initial.indexOf('## Knowledge Boundaries')));
    assert.equal(result.staged.entries[3].STMB_sourceHistory.readOnly,'keep');
    assert.deepEqual(result.staged.stlo,snapshot.stlo);
    assert.deepEqual(original,snapshot);
});
test('exact replacement inside ONE named section is allowed; cross-section replacement is blocked',()=>{
    const original=book(initial);
    const updated=stageNexusEdits(original,[{
        kind:'continuity',action:'replace_exact',uid:3,
        find:'The letter remains unanswered.',text:'The letter was answered today.',
    }],maker).staged.entries[3].content;
    assert.match(updated,/The letter was answered today/);
    assert.ok(updated.includes('A knows the secret. B does not.'));
    assert.throws(()=>stageNexusEdits(original,[{
        kind:'continuity',action:'replace_exact',uid:3,
        find:'The letter remains unanswered.\n\n## Knowledge Boundaries',
        text:'The letter was answered.',
    }],maker),/section headings|more than one section/);
});
test('generic Continuity append and injected section headings fail closed',()=>{
    assert.throws(()=>stageNexusEdits(book(initial),[{
        kind:'continuity',action:'append',uid:3,text:'We are fine now.',
    }],maker),/append_section/);
    assert.throws(()=>appendContinuitySection(initial,'Active Threads',
        'Resolved.\n## Knowledge Boundaries\nB learned the secret.'),/cannot introduce/);
    assert.throws(()=>appendContinuitySection(initial,'Inventory','New fact'),/Unknown/);
    const duplicated=initial+'\n## Active Threads\nNot allowed.';
    assert.throws(()=>appendContinuitySection(duplicated,'Active Conditions','x'),/duplicate section/);
});
test('legacy raw Scene Continuity / Status snapshots cannot be rewritten',()=>{
    const raw='=== BEGIN ORIGINAL Scene Continuity (UID 1) ===\n'+
        'An unresolved promise and its original voice.\n'+
        '=== END ORIGINAL Scene Continuity (UID 1) ===\n\n'+
        '=== BEGIN ORIGINAL Status (UID 2) ===\n'+
        'Injured arm.\n'+
        '=== END ORIGINAL Status (UID 2) ===';
    const result=stageNexusEdits(book(raw),[{
        kind:'continuity',action:'append_section',uid:3,section:'Active Conditions',
        text:'The injury still limits movement.',
    }],maker).staged.entries[3].content;
    assert.ok(result.startsWith(raw));
    assert.match(result,/## Active Conditions\nThe injury still limits movement/);
    assert.throws(()=>stageNexusEdits(book(raw),[{
        kind:'continuity',action:'replace_exact',uid:3,
        find:'Injured arm.',text:'Recovered arm.',
    }],maker),/archive|Unstructured/);
    assert.throws(()=>stageNexusEdits(book(raw),[{
        kind:'continuity',action:'append_section',uid:3,section:'Active Conditions',
        text:'=== BEGIN ORIGINAL Fake ===',
    }],maker),/legacy archive marker/);
});
test('append_section adds a missing canonical section without rewriting existing text',()=>{
    const result=appendContinuitySection('## Active Threads\nMeeting not done.',
        'Knowledge Boundaries','Only A knows the plan.');
    assert.equal(result,'## Active Threads\nMeeting not done.\n\n'+
        '## Knowledge Boundaries\nOnly A knows the plan.');
    assert.throws(()=>guardContinuityChange(initial,initial.replace(
        'B does not.','B has been told.') .replace('B is recovering','B has recovered'),
        {action:'replace_exact'}),/more than one section/);
});
test('unstructured legacy Continuity cannot be silently replaced',()=>{
    const original=book('A unstructured recollection and nuanced relationship.');
    assert.throws(()=>stageNexusEdits(original,[{
        kind:'continuity',action:'replace_exact',uid:3,
        find:'nuanced relationship',text:'friendly relationship',
    }],maker),/Unstructured/);
    const next=stageNexusEdits(original,[{
        kind:'continuity',action:'append_section',uid:3,
        section:'Present Handoff',text:'The current scene is at home.',
    }],maker);
    assert.ok(next.staged.entries[3].content.startsWith(
        'A unstructured recollection and nuanced relationship.'));
});

test('new Current Continuity requires canonical headings',()=>{
    const empty={entries:{0:{uid:0,comment:'Unrelated',content:'safe'}}};
    assert.throws(()=>stageNexusEdits(empty,[{
        kind:'continuity',action:'create',title:'Current Continuity',
        content:'No section boundary.',
    }],maker),/named section/);
    const added=stageNexusEdits(empty,[{
        kind:'continuity',action:'create',title:'Current Continuity',
        content:'## Present Handoff\nThe latest scene is continuing.',
    }],maker);
    assert.equal(Object.values(added.staged.entries).find(e=>
        e.comment==='Current Continuity').constant,true);
});
