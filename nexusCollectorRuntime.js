// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
//
// Explicit two-stage Sloth collection. No automatic invocation, auto-hide, or
// mutation before both the plan and the exact World Info delta are approved.

import { chat, getRequestHeaders } from '../../../../script.js';
import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../popup.js';
import { extension_settings } from '../../../extensions.js';
import { saveWorldInfo, createWorldInfoEntry, reloadEditor, worldInfoCache } from '../../../world-info.js';
import { DOMPurify } from '../../../../lib.js';
import { escapeHtml } from '../../../utils.js';
import { translate } from '../../../i18n.js';
import { getCurrentStmbChatRef, getStmbChatKey, withStmbWriteLane } from './stmbJobs.js';
import { getSceneMarkers, saveMetadataForCurrentContext } from './sceneManager.js';
import { getActiveNexusRoleContext, getNexusRoleResolutionForChatRef } from './nexusCharacterRolesRuntime.js';
import { validateNexusEventPlan, parseReviewedSegments, fingerprintSlothChat,
    stageNexusEdits, stageMemoryScenes } from './nexusCollectionPolicy.js';
import { analyzeSlothEvents, composeSlothScene, proposeSlothNexusEdits, auditSlothDraft } from './nexusCollectionAI.js';
import { commitSlothBooks } from './nexusCollectionCommit.js';
import { inspectNexusLegacyMigration, stageNexusLegacyMigration } from './nexusLegacyMigration.js';
import { commitSlothNexusMigration } from './nexusLegacyMigrationCommit.js';
import { inspectUnifiedMemorySplit, stageUnifiedMemorySplit } from './nexusUnifiedMigration.js';
import { markStmbPopup } from './utils.js';

const t=(source,key)=>translate(source,key);
const html=value=>escapeHtml(String(value ?? ''));
const stringify=value=>JSON.stringify(value);
let collectorBusy=false;

function assertOrigin(ref, roles, sourceIds, sourceFingerprint) {
    if(getStmbChatKey()!==getStmbChatKey(ref)) {
        throw new Error('Switch back to the original chat. This collection cannot be saved to another chat.');
    }
    const settings=extension_settings.STMemoryBooks;
    for(const role of ['nexus','memory']) {
        const resolved=getNexusRoleResolutionForChatRef(role,ref,settings);
        if(resolved.state!=='ready' || resolved.name!==roles[role]) {
            throw new Error('Character '+role+' lorebook was renamed, unlinked or changed. No save performed.');
        }
    }
    if(fingerprintSlothChat(chat,sourceIds)!==sourceFingerprint) {
        throw new Error('Original chat messages changed while AI was running. No save performed.');
    }
}

function activeSource(ref, memoryBook, roleNames = null) {
    const markers=getSceneMarkers()||{};
    const currentKey=getStmbChatKey(ref);
    const prior=markers.slothCollection?.chatKey===currentKey
        ? markers.slothCollection : {chatKey:currentKey,savedRanges:[]};
    if (roleNames && (prior.savedRanges||[]).length &&
        (prior.books?.nexus !== roleNames.nexus || prior.books?.memory !== roleNames.memory)) {
        throw new Error('This chat has collected Scenes bound to a different Nexus / Memory pair. A reviewed migration is required before changing books.');
    }
    const already=new Set();
    for(const pair of prior.savedRanges||[]) {
        if(!Array.isArray(pair)||pair.length!==2)continue;
        const [a,b]=pair;
        if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||b<a||b>=chat.length)continue;
        for(let id=a;id<=b;id++)already.add(id);
    }
    // Existing entries for THIS exact chat are also authoritative collection
    // receipts. Never collect them again just because old metadata was missing.
    const sourceChatIds=new Set([String(ref.fileName||''),String(ref.chatId||'')].filter(Boolean));
    for(const entry of Object.values(memoryBook?.entries||{})){
        if(!sourceChatIds.has(String(entry?.STMB_chatId||'')))continue;
        const ranges=Array.isArray(entry.STMB_sourceRanges)&&entry.STMB_sourceRanges.length
            ?entry.STMB_sourceRanges
            :Number.isSafeInteger(entry.STMB_start)&&Number.isSafeInteger(entry.STMB_end)
                ?[[entry.STMB_start,entry.STMB_end]]:[];
        for(const pair of ranges){
            if(!Array.isArray(pair)||pair.length!==2)continue;
            const [start,end]=pair;
            if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||
                start<0||end<start||end>=chat.length)continue;
            for(let id=start;id<=end;id++)already.add(id);
        }
    }
    const legacyEnd=Number.isSafeInteger(markers.highestMemoryProcessed)?markers.highestMemoryProcessed:-1;
    const source=chat.map((entry,id)=>({entry,id}))
        .filter(({entry,id})=>id>legacyEnd && !already.has(id) && entry && !entry.is_system)
        .map(({entry,id})=>({id,name:String(entry.name||''),mes:String(entry.mes||''),
            is_user:!!entry.is_user,send_date:entry.send_date||null}));
    return {source,prior,legacyEnd};
}

function readableSegments(segments) {
    return (segments||[]).map(pair=>pair[0]===pair[1]
        ? String(pair[0]):pair[0]+'-'+pair[1]).join(', ');
}

async function planApproval(plan) {
    const rows=plan.events.map((item,i)=>{
        return '<label class="stmb-sloth-plan-item">'+
            '<strong>'+html(String(i+1))+'. '+html(item.title)+'</strong>'+
            '<small>'+html(item.reason)+'</small>'+
            '<span>'+html(item.result)+'</span>'+
            '<input class="text_pole stmb-sloth-title-edit" data-index="'+i+
                '" aria-label="Scene title" value="'+html(item.title)+'" />'+
            '<input class="text_pole stmb-sloth-range-edit" data-index="'+i+
                '" aria-label="Source ranges" value="'+html(readableSegments(item.segments))+'" />'+
            '</label>';
    }).join('');
    const deferred=plan.deferred.map(item=>
        '<li>'+html(readableSegments(item.segments))+' · '+html(item.reason)+'</li>').join('');
    const body='<div class="stmb-sloth-review">'+
        '<h3>'+html(t('Review proposed complete events','STMemoryBooks_SlothReviewPlan'))+'</h3>'+
        '<p>'+html(t('Check causal closure and original message ranges before writing. Titles and ranges can be edited.','STMemoryBooks_SlothPlanGuide'))+'</p>'+
        rows+(deferred?'<h4>'+html(t('Unfinished / deferred','STMemoryBooks_SlothDeferred'))+
            '</h4><ul>'+deferred+'</ul>':'')+'</div>';
    const popup=new Popup(DOMPurify.sanitize(body),POPUP_TYPE.CONFIRM,'',{
        wide:true,large:true,allowVerticalScrolling:true,
        okButton:t('Approve event plan','STMemoryBooks_SlothApprovePlan'),
        cancelButton:t('Cancel','STMemoryBooks_Cancel')});
    markStmbPopup(popup);
    const showing=popup.show();
    // Read the entered text BEFORE Popup closes, rather than trusting stale markup.
    const inputs=popup.dlg?.querySelectorAll('.stmb-sloth-title-edit,.stmb-sloth-range-edit')||[];
    const changed=plan.events.map(e=>({...e,segments:e.segments.map(pair=>[...pair])}));
    for(const input of inputs)input.addEventListener('input',()=>{
        const index=Number(input.dataset.index);
        if(!Number.isInteger(index)||!changed[index])return;
        if(input.classList.contains('stmb-sloth-title-edit'))changed[index].title=input.value.trim();
        else changed[index].newSegments=input.value;
    });
    if(await showing!==POPUP_RESULT.AFFIRMATIVE)return null;
    const raw={events:changed.map(e=>({title:e.title,complete:true,reason:e.reason,
        result:e.result,segments:e.newSegments===undefined?e.segments:
            parseReviewedSegments(e.newSegments,plan.sourceIds)})),
        deferred:plan.deferred.map(e=>({reason:e.reason,segments:e.segments}))};
    return validateNexusEventPlan(raw,plan.sourceIds);
}

function downloadSafetyBackup(states,ref,plan) {
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    const documentData={
        type:'SillyTavern Sloth two-book pre-commit backup',
        timestamp:new Date().toISOString(),chatRef:ref,plan:{
            events:plan.events.map(e=>({title:e.title,segments:e.segments})),
            deferred:plan.deferred.map(e=>({segments:e.segments,reason:e.reason})),
        },
        originals:Object.fromEntries(states.map(s=>[s.name,s.original])),
    };
    const blob=new Blob([stringify(documentData)],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');anchor.href=url;anchor.download='Sloth_WorldInfo_Backup_'+stamp+'.json';
    document.body.appendChild(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
}

async function draftApproval({scenes,changes,plan,states,ref}) {
    const pieces=scenes.map(scene=>
        '<details class="stmb-sloth-detail"><summary>'+html(scene.title)+' · '+
        html(readableSegments(scene.segments))+'</summary><pre>'+html(scene.content)+'</pre></details>').join('');
    const delta=changes.map(change=>
        '<details class="stmb-sloth-detail"><summary>'+html(change.action)+' · '+
        html(change.title)+'</summary><p>'+html('BEFORE')+'</p><pre>'+html(change.before)+'</pre>'+
        '<p>'+html('AFTER')+'</p><pre>'+html(change.after)+'</pre></details>').join('');
    const body='<div class="stmb-sloth-review"><h3>'+
        html(t('Review Memory and Nexus edits','STMemoryBooks_SlothReviewDraft'))+'</h3><p>'+
        html(t('Both World Info books will change only after approval. A JSON backup will be downloaded first. No messages are hidden.','STMemoryBooks_SlothSaveGuide'))+
        '</p><h4>Memory · '+scenes.length+'</h4>'+pieces+
        '<h4>Nexus · '+changes.length+'</h4>'+(delta||'<p>No Nexus changes proposed.</p>')+
        (plan.deferred.length?'<p>'+html(t('Unfinished source remains in chat. It will not be marked collected.','STMemoryBooks_SlothDeferredNote'))+'</p>':'')+
        '</div>';
    let downloaded=false;
    const popup=new Popup(DOMPurify.sanitize(body),POPUP_TYPE.TEXT,'',{
        wide:true,large:true,allowVerticalScrolling:true,
        okButton:false,cancelButton:t('Cancel','STMemoryBooks_Cancel'),
        customButtons:[{text:t('Download backup and approve save','STMemoryBooks_SlothBackupApprove'),
            result:POPUP_RESULT.CUSTOM1,classes:['menu_button'],
            action:()=>{downloadSafetyBackup(states,ref,plan);downloaded=true;}}]});
    markStmbPopup(popup);
    const result=await popup.show();
    return result===POPUP_RESULT.CUSTOM1 && downloaded;
}

async function loadServerWorld(name) {
    // Never trust stale worldInfoCache for optimistic locking or read-back.
    const response=await fetch('/api/worldinfo/get',{
        method:'POST',headers:getRequestHeaders(),body:JSON.stringify({name})});
    if(!response.ok)throw new Error('World Info server read failed for '+name+': '+response.status);
    const book=await response.json();
    if(!book?.entries || typeof book.entries!=='object')throw new Error('World Info returned invalid data for '+name);
    return book;
}

async function withBothWriteLanes(names,task) {
    const ordered=[...new Set(names)].sort((a,b)=>a.localeCompare(b));
    const visit=i=>i===ordered.length?task():
        withStmbWriteLane({type:'lorebook',name:ordered[i]},()=>visit(i+1));
    return await visit(0);
}

function updateCollectedLedger(prior,events,ref,roleNames) {
    const markers=getSceneMarkers();
    const savedRanges=[...(prior.savedRanges||[])];
    for(const event of events)for(const range of event.segments)savedRanges.push([...range]);
    markers.slothCollection={chatKey:getStmbChatKey(ref),savedRanges,
        books:{nexus:roleNames.nexus,memory:roleNames.memory}};
    saveMetadataForCurrentContext();
}

function assertLegacyMigrationOrigin(ref, roles) {
    if (getStmbChatKey()!==getStmbChatKey(ref)) {
        throw new Error('Return to the original character chat before saving legacy memory migration.');
    }
    for (const role of ['nexus','memory']) {
        const now=getNexusRoleResolutionForChatRef(role,ref,extension_settings.STMemoryBooks);
        if (now.state!=='ready'||now.name!==roles[role]) {
            throw new Error('Nexus / Memory role assignment changed during migration. No changes saved.');
        }
    }
}

function downloadNexusMigrationBackup(name,original,ref) {
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    const payload={type:'Sloth Nexus migration: FULL ORIGINAL World Info backup',
        timestamp:new Date().toISOString(),
        lorebook:name,chatRef:ref,original};
    const blob=new Blob([JSON.stringify(payload)],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob),anchor=document.createElement('a');
    anchor.href=url;anchor.download='Sloth_Nexus_PreMigration_'+stamp+'.json';
    document.body.appendChild(anchor);
    try{anchor.click();}finally{anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
}

async function approveNexusLegacyMigration({state,changes,ref,plan}) {
    const created=changes.filter(x=>x.action==='create');
    const archived=changes.filter(x=>x.action==='archive');
    const details=created.map(change=>'<details class="stmb-sloth-detail"><summary>'+
        html(change.title)+' · '+html(change.after.length)+' chars</summary><pre>'+
        html(change.after)+'</pre></details>').join('');
    const originals=archived.map(change=>'<details class="stmb-sloth-detail"><summary>'+
        html(change.title)+' · UID '+html(change.uid)+'</summary><pre>'+
        html(change.before)+'</pre></details>').join('');
    const body='<div class="stmb-sloth-review"><h3>'+
        html(t('Review legacy Nexus migration','STMemoryBooks_SlothLegacyReview'))+
        '</h3><p>'+
        html(t('The old entries and their history will be kept as disabled archives. New Core Memory and Current Continuity entries contain the original text without AI rewriting. Review both copies. A full JSON backup is downloaded before any save. Memory Scenes are not changed.',
            'STMemoryBooks_SlothLegacyGuide'))+
        '</p><p>'+html(plan.sourceUids.length)+' entries · '+html(plan.totalCharacters)+' characters</p>'+
        '<h4>'+html(t('New always-on entries','STMemoryBooks_SlothLegacyNew'))+'</h4>'+details+
        '<h4>'+html(t('Preserved original entries (archived, not deleted)',
            'STMemoryBooks_SlothLegacyOld'))+'</h4>'+originals+
        (plan.hasHistory?'<p class="stmb-sloth-warning">'+
        html(t('Existing Side Prompt history is preserved; old templates will be blocked from rewriting archived entries.',
            'STMemoryBooks_SlothLegacyHistory'))+'</p>':'')+
        '</div>';
    let downloaded=false;
    const popup=new Popup(DOMPurify.sanitize(body),POPUP_TYPE.TEXT,'',{
        wide:true,large:true,allowVerticalScrolling:true,
        okButton:false,cancelButton:t('Cancel','STMemoryBooks_Cancel'),
        customButtons:[{
            text:t('Download original backup and approve migration','STMemoryBooks_SlothLegacyApprove'),
            result:POPUP_RESULT.CUSTOM1,classes:['menu_button'],
            action:()=>{downloadNexusMigrationBackup(state.name,state.original,ref);downloaded=true;}
        }],
    });
    markStmbPopup(popup);
    return await popup.show()===POPUP_RESULT.CUSTOM1 && downloaded;
}

/** Explicit, reviewed migration of the existing Nexus book only.
 * The old single-book (mixed Scenes + non-Scenes) layout has a separate, more
 * complex two-book migration path and is not modified by this command.
 */
async function approveUnifiedMemorySplit({states,staged,ref}) {
    const list=staged.mapping.map(item=>'<li>'+html(item.title)+
        ' · Memory UID '+html(item.originalUid)+' → Nexus UID '+html(item.newUid)+'</li>').join('');
    const previews=staged.changes.filter(change=>change.action==='create')
        .map(change=>'<details class="stmb-sloth-detail"><summary>'+
            html(change.title)+'</summary><pre>'+html(change.after)+'</pre></details>').join('');
    const body='<div class="stmb-sloth-review"><h3>'+
        html(t('Review combined Memory / Nexus migration','STMemoryBooks_SlothUnifiedReview'))+
        '</h3><p>'+html(t('This combined Memory book contains Scenes and other entries. The non-Scenes will be moved to Nexus with a full copy of their original entry metadata, and removed from the old Memory file. Memory will retain all original Scenes, with only recent-3 recall flags rotated. Both original books will be backed up before an explicitly approved two-book save. Neither chat messages nor Scene text will change.',
            'STMemoryBooks_SlothUnifiedGuide'))+'</p>'+
        '<h4>Memory → Nexus · '+html(staged.mapping.length)+'</h4><ul>'+list+'</ul>'+
        '<h4>'+html(t('New Core and Continuity','STMemoryBooks_SlothUnifiedTargets'))+'</h4>'+previews+
        '<p>'+html(t('Existing Scenes preserved','STMemoryBooks_SlothUnifiedScenes'))+
        ': '+html(staged.plan.sceneCount)+
        ' · '+html(t('Recall flags adjusted','STMemoryBooks_SlothUnifiedRotation'))+
        ': '+html(staged.sceneRotation.length)+'</p></div>';
    let downloaded=false;
    const popup=new Popup(DOMPurify.sanitize(body),POPUP_TYPE.TEXT,'',{
        wide:true,large:true,allowVerticalScrolling:true,
        okButton:false,cancelButton:t('Cancel','STMemoryBooks_Cancel'),
        customButtons:[{
            text:t('Back up both originals and approve split','STMemoryBooks_SlothUnifiedApprove'),
            result:POPUP_RESULT.CUSTOM1,classes:['menu_button'],
            action:()=>{
                downloadSafetyBackup(states,ref,{events:[],deferred:[]});
                downloaded=true;
            },
        }],
    });
    markStmbPopup(popup);
    return await popup.show()===POPUP_RESULT.CUSTOM1 && downloaded;
}

export async function runNexusLegacyMigration() {
    if(collectorBusy)throw new Error('A Sloth collection or migration is already in progress.');
    collectorBusy=true;
    try {
        const ref=structuredClone(getCurrentStmbChatRef());
        if(ref.type!=='character')throw new Error('Choose an individual-character chat for migration.');
        const settings=extension_settings.STMemoryBooks;
        const roles={
            nexus:getNexusRoleResolutionForChatRef('nexus',ref,settings),
            memory:getNexusRoleResolutionForChatRef('memory',ref,settings),
        };
        if(roles.nexus.state!=='ready'||roles.memory.state!=='ready'||
            roles.nexus.name===roles.memory.name)throw new Error('Connect two different Nexus and Memory books first.');
        const roleNames={nexus:roles.nexus.name,memory:roles.memory.name};
        const [nexus, memory]=await Promise.all([
            loadServerWorld(roleNames.nexus),loadServerWorld(roleNames.memory),
        ]);
        assertLegacyMigrationOrigin(ref,roleNames);
        const unified=inspectUnifiedMemorySplit(memory,nexus);
        if(unified.required){
            if(unified.errors.length) {
                throw new Error('Combined Memory cannot be safely split: '+unified.errors.join(' '));
            }
            const staged=stageUnifiedMemorySplit({
                memory,nexus,createNexusEntry:book=>createWorldInfoEntry(roleNames.nexus,book),
                olderMode:settings.moduleSettings?.nexusOlderSceneMode==='keyword'?'keyword':'vector',
            });
            const states=[
                {name:roleNames.memory,original:memory,staged:staged.memory},
                {name:roleNames.nexus,original:nexus,staged:staged.nexus},
            ];
            const accepted=await approveUnifiedMemorySplit({states,staged,ref});
            if(!accepted)return {saved:false,reason:'unified-split-cancelled'};
            assertLegacyMigrationOrigin(ref,roleNames);
            const outcome=await commitSlothBooks(states,{
                loadFresh:loadServerWorld,
                save:(name,book)=>saveWorldInfo(name,book,true),
                resetCache:(name,book)=>worldInfoCache.set(name,structuredClone(book)),
                withLocks:withBothWriteLanes,
                verifyOrigin:()=>assertLegacyMigrationOrigin(ref,roleNames),
            });
            for(const name of [roleNames.nexus,roleNames.memory]){
                try{await Promise.resolve(reloadEditor(name));}
                catch(error){console.warn('Sloth unified editor refresh failed:',error);}
            }
            toastr.success(t('Combined Memory separated into Nexus and Scene-only Memory. Both original books were backed up.',
                'STMemoryBooks_SlothUnifiedSaved'),'STMemoryBooks');
            return {saved:true,split:true,moved:staged.mapping.length,result:outcome};
        }
        const plan=inspectNexusLegacyMigration(nexus);
        if(!plan.required){
            toastr.info(t('No unmigrated legacy entries in the assigned Nexus.',
                'STMemoryBooks_SlothLegacyNone'),'STMemoryBooks');
            return {saved:false,reason:'no-legacy'};
        }
        const staged=stageNexusLegacyMigration(nexus,
            book=>createWorldInfoEntry(roleNames.nexus,book));
        const state={name:roleNames.nexus,original:nexus,staged:staged.staged};
        const accepted=await approveNexusLegacyMigration({
            state,changes:staged.changes,plan:staged.plan,ref,
        });
        if(!accepted)return {saved:false,reason:'cancelled'};
        assertLegacyMigrationOrigin(ref,roleNames);
        const result=await commitSlothNexusMigration(state,{
            loadFresh:loadServerWorld,
            save:(name,book)=>saveWorldInfo(name,book,true),
            withLock:(name,task)=>withStmbWriteLane({type:'lorebook',name},task),
            verifyOrigin:()=>assertLegacyMigrationOrigin(ref,roleNames),
            resetCache:(name,book)=>worldInfoCache.set(name,structuredClone(book)),
        });
        try{await Promise.resolve(reloadEditor(roleNames.nexus));}
        catch(error){console.warn('Sloth Nexus migration editor refresh failed',error);}
        toastr.success(t('Legacy Nexus memories migrated. Original entries remain archived.',
            'STMemoryBooks_SlothLegacySaved'),'STMemoryBooks');
        return {saved:true,sourceUids:plan.sourceUids,result};
    }finally{
        collectorBusy=false;
    }
}

export async function runNexusCollector({profileIndex}={}) {
    if(collectorBusy)throw new Error('A Sloth collection is already in progress.');
    collectorBusy=true;
    try {
        const settings=extension_settings.STMemoryBooks;
        const ref=structuredClone(getCurrentStmbChatRef());
        if(ref.type!=='character')throw new Error('Sloth collection currently supports individual character chats only.');
        const roles={
            memory:getNexusRoleResolutionForChatRef('memory',ref,settings),
            nexus:getNexusRoleResolutionForChatRef('nexus',ref,settings),
        };
        if(roles.memory.state!=='ready'||roles.nexus.state!=='ready'||
            roles.memory.name===roles.nexus.name) {
            throw new Error('Assign two existing, linked, different Nexus and Memory lorebooks first.');
        }
        const roleNames={memory:roles.memory.name,nexus:roles.nexus.name};
        const originalBooks={
            nexus:await loadServerWorld(roleNames.nexus),
            memory:await loadServerWorld(roleNames.memory),
        };
        const {source,prior}=activeSource(ref,originalBooks.memory,roleNames);
        if(!source.length){
            toastr.info(t('No new visible messages need collection.','STMemoryBooks_SlothNoSource'),'STMemoryBooks');
            return {saved:false,reason:'no-source'};
        }
        const sourceIds=source.map(s=>s.id);
        const fingerprint=fingerprintSlothChat(chat,sourceIds);
        const profile=settings.profiles?.[profileIndex??settings.defaultProfile]
            ||settings.profiles?.[settings.defaultProfile];
        if(!profile)throw new Error('Choose an AI profile before starting Sloth collection.');
        const character=getActiveNexusRoleContext(settings).character;
        const data=character?.data||{};
        const characterContext=JSON.stringify({
            name:character?.name,description:data.description,
            personality:data.personality,scenario:data.scenario});
        if(characterContext.length>16000){
            throw new Error('Character data is too large for a safe initial analysis; no content was truncated.');
        }
        // Legacy data must be migrated explicitly, with an independent backup
        // and review, before the regular AI collector touches Nexus.
        const migration=inspectNexusLegacyMigration(originalBooks.nexus);
        if(migration.required){
            throw new Error('Old Long-Term Memory / Status / Scene Continuity entries found. Use the reviewed Nexus migration command first. Nothing saved.');
        }
        const titles=Object.values(originalBooks.nexus.entries).map(e=>String(e.comment||'').trim());
        const hasCore=titles.includes('Core Memory'),hasCurrent=titles.includes('Current Continuity');
        const hasLegacyCore=titles.some(title=>/^Long-Term Memory(?:\b|\s|\()/i.test(title));
        const hasLegacyCurrent=titles.some(title=>/^(?:Scene Continuity|Status)(?:\b|\s|\()/i.test(title));
        const ambiguousCurrent=titles.some(title=>/^Current Continuity(?:\b|\s|\()/i.test(title))&&!hasCurrent;
        const ambiguousCore=titles.some(title=>/^Core Memory(?:\b|\s|\()/i.test(title))&&!hasCore;
        if((!hasCore && hasLegacyCore)||(!hasCurrent && hasLegacyCurrent)||
            ambiguousCore||ambiguousCurrent){
            throw new Error('Legacy Core/Status entries require a reviewed migration before automated Nexus edits. Nothing saved.');
        }
        toastr.info(t('Analyzing causal events in the unsaved chat...','STMemoryBooks_SlothAnalyzing'),'STMemoryBooks');
        const plan=await analyzeSlothEvents({messages:source,profile,settings,characterContext});
        assertOrigin(ref,roleNames,sourceIds,fingerprint);
        if(!plan.events.length){
            toastr.info(t('There are no completed events to collect yet. Nothing was changed.',
                'STMemoryBooks_SlothNoCompleted'),'STMemoryBooks');
            return {saved:false,reason:'no-complete-events'};
        }
        const approved=await planApproval(plan);
        if(!approved)return {saved:false,reason:'plan-cancelled'};
        assertOrigin(ref,roleNames,sourceIds,fingerprint);
        toastr.info(t('Writing approved Scenes and Nexus changes...','STMemoryBooks_SlothComposing'),'STMemoryBooks');
        const scenes=[];
        for(const event of approved.events){
            const composed=await composeSlothScene({event,messages:source,profile,settings,characterContext});
            scenes.push(composed);
            assertOrigin(ref,roleNames,sourceIds,fingerprint);
        }
        const edits=await proposeSlothNexusEdits({
            scenes,nexus:originalBooks.nexus,profile,settings});
        assertOrigin(ref,roleNames,sourceIds,fingerprint);
        if(settings.moduleSettings?.slothPreciseReviewEnabled===true){
            toastr.info(t('Checking for missed or misattributed details...',
                'STMemoryBooks_SlothAuditing'),'STMemoryBooks');
            await auditSlothDraft({messages:source,scenes,edits,profile,settings});
            assertOrigin(ref,roleNames,sourceIds,fingerprint);
        }
        const memory=stageMemoryScenes(originalBooks.memory,scenes,
            book=>createWorldInfoEntry(roleNames.memory,book),{
                chatId:String(ref.fileName||''),
                olderMode:settings.moduleSettings?.nexusOlderSceneMode==='keyword'?'keyword':'vector'});
        const nexus=stageNexusEdits(originalBooks.nexus,edits,
            book=>createWorldInfoEntry(roleNames.nexus,book));
        const states=[
            {name:roleNames.memory,original:originalBooks.memory,staged:memory.staged},
            {name:roleNames.nexus,original:originalBooks.nexus,staged:nexus.staged},
        ];
        const accepted=await draftApproval({
            scenes,changes:nexus.changes,plan:approved,states,ref});
        if(!accepted)return {saved:false,reason:'draft-cancelled'};
        assertOrigin(ref,roleNames,sourceIds,fingerprint);
        const outcome=await commitSlothBooks(states,{
            loadFresh:loadServerWorld,save:(name,book)=>saveWorldInfo(name,book,true),
            resetCache:(name,original)=>worldInfoCache.set(name,structuredClone(original)),
            withLocks:withBothWriteLanes,
            verifyOrigin:()=>assertOrigin(ref,roleNames,sourceIds,fingerprint),
        });
        // Metadata must change ONLY after both book writes and read-backs succeeded.
        updateCollectedLedger(prior,approved.events,ref,roleNames);
        for(const state of states){
            try{await Promise.resolve(reloadEditor(state.name));}
            catch(error){console.warn('Sloth: editor refresh failed',error);}
        }
        const msg=t('Collection saved to both lorebooks. No chat messages were hidden.','STMemoryBooks_SlothSaved');
        const hideHint=approved.fullyCollected
            ? t('Manual hide may be considered through original message #',
                'STMemoryBooks_SlothHideCandidate')+String(approved.end)
            :t('Unfinished source remains, so no hide boundary can be recommended.',
                'STMemoryBooks_SlothNoHideCandidate');
        toastr.success(msg+' '+hideHint,'STMemoryBooks',{timeOut:9000});
        return {saved:true,scenes:scenes.length,nexusEdits:nexus.changes.length,
            deferred:approved.deferred.length,result:outcome};
    }finally{
        collectorBusy=false;
    }
}
