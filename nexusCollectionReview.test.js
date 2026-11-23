// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reviewSlothSceneDrafts, reviewSlothNexusDrafts } from './nexusCollectionReview.js';
import { stageNexusEdits, stageMemoryScenes } from './nexusCollectionPolicy.js';
import { validateGroundedNexusEdits } from './nexusEditEvidence.js';

const text='**Timeline**: Unknown\n\n**Scene**\nA promised to bring the letter. B accepted.\n\n**Result**\nB accepted the promise.';
const scene={id:'event-1',title:'Promised letter',content:text,
    keywords:['letter','promise','paper','nightfall','blue ink'],
    segments:[[2,3],[7,8]],messageIds:[2,3,7,8]};
const maker=book=>{
    const uid=Math.max(-1,...Object.keys(book.entries).map(Number))+1;
    return book.entries[uid]={uid,disable:false,position:0,key:[]};
};

test('reviewed Scene title, text and five keywords persist while source segments stay immutable',()=>{
    const original=structuredClone(scene);
    const changed=reviewSlothSceneDrafts([scene],[{
        title:'Answered letter',content:text.replace('bring','deliver'),
        keywords:['letter','promise','paper','morning','blue ink'],
    }]);
    assert.equal(changed[0].title,'Answered letter');
    assert.match(changed[0].content,/deliver/);
    assert.deepEqual(changed[0].segments,[[2,3],[7,8]]);
    assert.deepEqual(scene,original);
    const staged=stageMemoryScenes({entries:{}},changed,maker,{chatId:'chat-name'});
    assert.match(staged.staged.entries[0].content,/deliver/);
    assert.match(staged.staged.entries[0].comment,/Answered letter/);
    assert.deepEqual(staged.staged.entries[0].STMB_sourceRanges,[[2,3],[7,8]]);
});

test('reviewed Scene rejects missing fields, broken JSON layout and duplicate/absent keys',()=>{
    for(const forms of [
        [], [{title:'',content:text,keywords:scene.keywords}],
        [{title:'A\nB',content:text,keywords:scene.keywords}],
        [{title:'Valid',content:'A private correction without Result',keywords:scene.keywords}],
        [{title:'Valid',content:text,keywords:['repeat','repeat','paper','night','ink']}],
        [{title:'Valid',content:text,keywords:['repeat']}],
    ])assert.throws(()=>reviewSlothSceneDrafts([scene],forms));
});

test('Nexus direct edits preserve reason, original UID, source citations and other entries',()=>{
    const messages=[{id:2,mes:'I delivered the letter today and B replied.'}];
    const original={entries:{
        1:{uid:1,comment:'Current Continuity',content:'## Active Threads\nThe letter remains unanswered.\n\n## Active Conditions\nB is tired.'},
        2:{uid:2,comment:'Kinks',content:'Keep this unchanged',outletName:'Kinks',position:7},
    }};
    const op={kind:'continuity',action:'replace_exact',uid:1,
        find:'The letter remains unanswered.',text:'The letter was answered.',
        supersession:'observed_resolution',
        reason:'A confirmed the letter arrived and B replied.',
        evidence:[{messageId:2,quote:'I delivered the letter today and B replied.'}]};
    const reviewed=reviewSlothNexusDrafts([op],[{body:'The letter was answered today.'}]);
    assert.equal(reviewed[0].uid,op.uid);
    assert.equal(reviewed[0].find,op.find);
    assert.deepEqual(reviewed[0].evidence,op.evidence);
    const grounded=validateGroundedNexusEdits(reviewed,messages);
    const result=stageNexusEdits(original,grounded,maker);
    assert.match(result.staged.entries[1].content,/answered today/);
    assert.equal(result.staged.entries[2].content,'Keep this unchanged');
    assert.equal(original.entries[1].content.includes('unanswered'),true);
});

test('Nexus direct edit fails before staging when a single exact span or special Outlet is crossed',()=>{
    const op={kind:'continuity',action:'append_section',uid:1,
        section:'Active Threads',text:'Letter is pending.',
        evidence:[{messageId:2,quote:'I am still waiting for a reply.'}],
        reason:'The reply remains explicitly outstanding.'};
    const old={entries:{1:{uid:1,comment:'Current Continuity',
        content:'## Active Threads\nStill waiting.\n\n## Active Conditions\nInjured wrist.'}}};
    const changed=reviewSlothNexusDrafts([op],[{body:'## Active Conditions\nInvented status'}]);
    assert.throws(()=>stageNexusEdits(old,changed,maker),/cannot introduce/);
    assert.deepEqual(old.entries[1].content,'## Active Threads\nStill waiting.\n\n## Active Conditions\nInjured wrist.');
    assert.throws(()=>reviewSlothNexusDrafts([op],[]),/missing/);
});

test('Sloth collection UI has a real editable draft and a scoped advanced Legacy drawer',()=>{
    const runtime=readFileSync(new URL('./nexusCollectorRuntime.js',import.meta.url),'utf8');
    const template=readFileSync(new URL('./templates.js',import.meta.url),'utf8');
    const source=readFileSync(new URL('./index.js',import.meta.url),'utf8');
    for(const target of ['data-sloth-scene-title','data-sloth-scene-content','data-sloth-nexus-body',
        'reviewSlothSceneDrafts','reviewSlothNexusDrafts','applyReviewedDraft','validateGroundedNexusEdits']){
        assert.ok(runtime.includes(target),'missing review UI bridge '+target);
    }
    assert.ok(template.includes('stmb-sloth-profile-select'));
    assert.ok(template.includes('stmb-sloth-legacy-settings'));
    assert.ok(template.includes('STMemoryBooks_SlothDashboardSubtitle'));
    assert.ok(source.includes("if (!templateData.slothWorkspaceActive)"));
    assert.ok(source.includes("popupElement.querySelector('#stmb-sloth-profile-select')"));
});
