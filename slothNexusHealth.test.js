// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectSlothNexusHealth} from './slothNexusHealth.js';
const repeated='This is an exact repeated paragraph with enough detail.';
test('health counts each stored body once, separates protected and mixed roles, and does not edit a book',async()=>{
    const entries={
        1:{uid:1,comment:'Core Memory',content:repeated,constant:true},
        2:{uid:2,comment:'LT - Rain',content:repeated,constant:false},
        3:{uid:3,comment:'Current Continuity',content:'## Active Threads\nThe parcel is still waiting.',constant:true},
        4:{uid:4,comment:'PanelAssets',content:repeated,position:7,constant:true},
        5:{uid:5,comment:'LT - Old',content:repeated,disable:true,constant:true},
        6:{uid:6,comment:'Long-Term Memory',constant:true,content:'[Essential facts / ongoing world state]\nFacts\n[Enduring relationship / shared priorities]\nRule\n[Physical carryover]\nOpen'},
        7:{uid:7,comment:'LT - Empty',content:''},
    };
    const book={entries},before=JSON.stringify(book);
    const report=await inspectSlothNexusHealth(book,s=>s.length);
    assert.equal(report.total,Object.values(entries).reduce((n,e)=>n+e.content.length,0));
    assert.equal(report.alwaysOn,entries[1].content.length+entries[3].content.length+entries[4].content.length+entries[6].content.length);
    assert.equal(report.groups.mixed.entries,1);
    assert.equal(report.groups.protected.entries,2);
    assert.equal(report.duplicates.length,1);
    assert.deepEqual(report.duplicates[0].entries.map(e=>e.uid),[1,2]);
    assert.equal(JSON.stringify(book),before);
});
test('unknown tokenizer results are not treated as zero, including a thrown count',async()=>{
    const book={entries:{1:{uid:1,comment:'Core Memory',content:'Known source',constant:true},
        2:{uid:2,comment:'LT - X',content:'Unknown source'},3:{uid:3,comment:'LT - Y',content:'Another source'}}};
    const report=await inspectSlothNexusHealth(book,s=>s==='Known source'?10:s==='Unknown source'?0:Promise.reject(Error('offline')));
    assert.equal(report.total,10);assert.equal(report.uncounted,2);
    assert.equal(report.rows.find(r=>r.uid===2).tokens,null);
    assert.equal(report.groups.lt.uncounted,2);
});
test('health button uses a read-only popup and scoped layout',()=>{
    const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
    const source=read('./nexusCollectorRuntime.js');
    const fn=source.slice(source.indexOf('export async function showSlothNexusHealth('),source.indexOf('export async function applySlothNexusRecallSettings('));
    assert.match(fn,/loadServerWorld/);assert.match(fn,/inspectSlothNexusHealth/);assert.match(fn,/verify\(\)/);
    assert.doesNotMatch(fn,/saveWorldInfo|requester\(|requestCompletion|stageNexusEdits|hideChatMessageRange|patchVerifiedSlothMetadata/);
    assert.match(read('./templates.js'),/data-stmb-sloth-action="nexus-health"/);
    assert.match(read('./index.js'),/'nexus-health': \(\) => showSlothNexusHealth\(\)/);
    assert.match(read('./style.css'),/\.popup\.stmb-popup \.stmb-health-stats\{/);
});

test('always-on unknowns are independent of inactive or vector-only unknowns; duplicate text counts once',async()=>{
    const book={entries:{
        1:{uid:1,comment:'Core Memory',content:'Known',constant:true},
        2:{uid:2,comment:'NPC - A',content:'Unknown vector',constant:false},
        3:{uid:3,comment:'LT - B',content:'Unknown vector',constant:false},
    }};
    const calls=[];
    const measure=async s=>{calls.push(s);return s==='Known'?7:null;};
    let report=await inspectSlothNexusHealth(book,measure);
    assert.equal(report.total,7);
    assert.equal(report.alwaysOn,7);
    assert.equal(report.uncounted,2);
    assert.equal(report.alwaysOnUncounted,0);
    assert.equal(report.groups.npc.alwaysOnUncounted,0);
    assert.deepEqual(calls,['Known','Unknown vector']);
    book.entries[2].constant=true;
    report=await inspectSlothNexusHealth(book,measure);
    assert.equal(report.alwaysOnUncounted,1);
    assert.equal(report.groups.npc.alwaysOnUncounted,1);
    assert.equal(report.groups.lt.alwaysOnUncounted,0);
});
test('health UI keeps two summary values, on-demand help and list bodies, without a large or observed popup',()=>{
    const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
    const source=read('./nexusCollectorRuntime.js');
    const fn=source.slice(source.indexOf('export async function showSlothNexusHealth('),source.indexOf('export async function applySlothNexusRecallSettings('));
    assert.match(fn,/report\.alwaysOnUncounted/);
    assert.match(fn,/group\.alwaysOnUncounted/);
    assert.match(fn,/aria-expanded="false"/);
    assert.match(fn,/details\.addEventListener\('toggle'/);
    assert.match(fn,/if\(!details\.open\|\|populated\)return/);
    assert.match(fn,/body\.textContent=item\?textFor\(item\)/);
    assert.match(fn,/wide:false,large:false/);
    assert.doesNotMatch(fn,/MutationObserver|ResizeObserver|setInterval|requestAnimationFrame|<table/);
    assert.match(read('./style.css'),/\.popup\.stmb-popup\.stmb-nexus-health-popup\{[^}]*height:fit-content/);
});

test('health help stays beside its title and dividers use a scoped theme-aware contrast color',()=>{
    const css=readFileSync(new URL('./style.css',import.meta.url),'utf8');
    assert.match(css,/\.popup\.stmb-popup \.stmb-health-heading\{[^}]*justify-content:flex-start;gap:4px/);
    assert.match(css,/\.popup\.stmb-popup \.stmb-health-heading h3\{[^}]*flex:0 1 auto;width:auto/);
    assert.match(css,/\.stmb-nexus-health\{[^}]*--stmb-health-border:color-mix/);
    assert.match(css,/\.stmb-health-row\{[^}]*border-bottom:1px solid var\(--stmb-health-border/);
});
