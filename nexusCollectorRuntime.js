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
import { analyzeSlothEvents, composeSlothScene, proposeSlothNexusEdits, auditSlothDraft,
    suggestSlothSceneMerges, composeSlothMergedScene, proposeSlothLegacyContinuity,
    suggestSlothLatestSceneSplit } from './nexusCollectionAI.js';
import { commitSlothBooks } from './nexusCollectionCommit.js';
import { inspectNexusLegacyMigration, stageNexusLegacyMigration } from './nexusLegacyMigration.js';
import { commitSlothNexusMigration } from './nexusLegacyMigrationCommit.js';
import { inspectUnifiedMemorySplit, stageUnifiedMemorySplit } from './nexusUnifiedMigration.js';
import { stageNexusSceneMerge } from './nexusSceneMerge.js';
import {inspectNexusSceneSplit,validateNexusSceneSplitProposal,
    stageNexusSceneSplit} from './nexusSceneSplit.js';
import { inspectSlothLegacyContinuity, stageSlothLegacyContinuity } from './nexusLegacySemantic.js';
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

function downloadSafetyBackup(states,ref,plan,reviewedChanges=[]) {
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    const documentData={
        type:states.length===1?'SillyTavern Sloth Nexus-only pre-commit backup':
            'SillyTavern Sloth two-book pre-commit backup',
        timestamp:new Date().toISOString(),chatRef:ref,plan:{
            events:plan.events.map(e=>({title:e.title,segments:e.segments})),
            deferred:plan.deferred.map(e=>({segments:e.segments,reason:e.reason})),
        },
        originals:Object.fromEntries(states.map(s=>[s.name,s.original])),
        nexusEvidence:reviewedChanges.map(change=>({
            kind:change.kind,action:change.action,uid:change.uid,
            reason:change.reason,evidence:change.evidence,
        })),
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
        html(change.title)+'</summary><p><strong>'+
        html(t('Reason for change','STMemoryBooks_SlothEvidenceWhy'))+
        ':</strong> '+html(change.reason)+'</p><p><strong>'+
        html(t('Original message evidence','STMemoryBooks_SlothEvidenceSource'))+
        ':</strong></p><ul>'+
        (change.evidence||[]).map(item=>'<li>#'+html(item.messageId)+
            ' · '+html(item.quote)+'</li>').join('')+'</ul>'+
        '<p>'+html('BEFORE')+'</p><pre>'+html(change.before)+'</pre>'+
        '<p>'+html('AFTER')+'</p><pre>'+html(change.after)+'</pre></details>').join('');
    const nexusOnly=scenes.length===0 && states.length===1;
    const heading=nexusOnly
        ?t('Review Nexus current-state updates','STMemoryBooks_SlothNexusOnlyReview')
        :t('Review Memory and Nexus edits','STMemoryBooks_SlothReviewDraft');
    const guide=nexusOnly
        ?t('No Scene is complete. Only the selected Nexus lorebook will change after you review exact source quotes and download its full original JSON. Memory and chat messages will not change.',
            'STMemoryBooks_SlothNexusOnlyGuide')
        :t('Both World Info books will change only after approval. A JSON backup will be downloaded first. No messages are hidden.',
            'STMemoryBooks_SlothSaveGuide');
    const body='<div class="stmb-sloth-review"><h3>'+
        html(heading)+'</h3><p>'+html(guide)+
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
            action:()=>{downloadSafetyBackup(states,ref,plan,changes);downloaded=true;}}]});
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
            // An unfinished event cannot become a Scene, but its confirmed
            // current state may still need an explicitly reviewed Nexus delta.
            // Never advance the collected-message ledger or touch Memory here.
            const edits=await proposeSlothNexusEdits({
                scenes:[],nexus:originalBooks.nexus,messages:source,
                plan,profile,settings,
            });
            assertOrigin(ref,roleNames,sourceIds,fingerprint);
            if(!edits.length){
                toastr.info(t('There are no completed events to collect yet. Nothing was changed.',
                    'STMemoryBooks_SlothNoCompleted'),'STMemoryBooks');
                return {saved:false,reason:'no-complete-events-or-deltas'};
            }
            const nexus=stageNexusEdits(originalBooks.nexus,edits,
                book=>createWorldInfoEntry(roleNames.nexus,book));
            const state={name:roleNames.nexus,original:originalBooks.nexus,staged:nexus.staged};
            const changes=nexus.changes.map((change,index)=>({
                ...change,reason:edits[index]?.reason,evidence:edits[index]?.evidence,
            }));
            const accepted=await draftApproval({
                scenes:[],changes,plan,states:[state],ref,
            });
            if(!accepted)return {saved:false,reason:'nexus-only-cancelled'};
            assertOrigin(ref,roleNames,sourceIds,fingerprint);
            const result=await commitSlothNexusMigration(state,{
                loadFresh:loadServerWorld,
                save:(name,book)=>saveWorldInfo(name,book,true),
                withLock:(name,task)=>withStmbWriteLane({type:'lorebook',name},task),
                verifyOrigin:()=>assertOrigin(ref,roleNames,sourceIds,fingerprint),
                resetCache:(name,book)=>worldInfoCache.set(name,structuredClone(book)),
                operation:'Nexus current-state update',
            });
            try{await Promise.resolve(reloadEditor(roleNames.nexus));}
            catch(error){console.warn('Sloth Nexus-only editor refresh failed',error);}
            toastr.success(t('Reviewed current-state updates saved to Nexus. Memory and chat messages were not changed.',
                'STMemoryBooks_SlothNexusOnlySaved'),'🦥 STMemoryBooks');
            return {saved:true,scenes:0,nexusEdits:nexus.changes.length,result};
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
            scenes,nexus:originalBooks.nexus,messages:source,
            plan:approved,profile,settings});
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
            scenes,changes:nexus.changes.map((change,index)=>({
                ...change,reason:edits[index]?.reason,evidence:edits[index]?.evidence,
            })),plan:approved,states,ref});
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


/** Select a suggested causal pair without changing any World Info or chat state. */
async function chooseSlothMergeCandidate(candidates) {
    const descriptions=candidates.map((candidate,index)=>
        '<details class="stmb-sloth-detail"><summary>'+
        html(String(index+1)+'. '+candidate.titles.join(' + '))+
        '</summary><p>'+html(candidate.reason)+'</p><ul>'+
        candidate.evidence.map(line=>'<li>'+html(line)+'</li>').join('')+
        '</ul><small>UID '+html(candidate.sourceUids.join(' + '))+
        ' · '+html(readableSegments(candidate.plan.sourceRanges))+'</small></details>').join('');
    const choices=candidates.map((candidate,index)=>
        '<option value="'+index+'">'+html(String(index+1)+'. '+candidate.titles.join(' + '))+'</option>').join('');
    const body='<div class="stmb-sloth-review"><h3>'+
        html(t('Review causal Scene merge candidates','STMemoryBooks_SlothMergeChoose'))+
        '</h3><p>'+html(t('Only two records of the same resolved event should be merged. Independent Scenes remain separate. Review the evidence and choose one pair. Nothing has been saved.',
            'STMemoryBooks_SlothMergeChooseHelp'))+'</p>'+descriptions+
        '<label for="stmb-sloth-merge-choice"><strong>'+
        html(t('Pair to inspect','STMemoryBooks_SlothMergeSelect'))+'</strong>'+
        '<select class="text_pole" id="stmb-sloth-merge-choice">'+choices+'</select></label></div>';
    const popup=new Popup(DOMPurify.sanitize(body),POPUP_TYPE.CONFIRM,'',{
        wide:true,large:true,allowVerticalScrolling:true,
        okButton:t('Review this pair','STMemoryBooks_SlothMergeReviewPair'),
        cancelButton:t('Cancel','STMemoryBooks_Cancel'),
    });
    markStmbPopup(popup);
    const showing=popup.show();
    let selected=0;
    popup.dlg?.querySelector('#stmb-sloth-merge-choice')?.addEventListener('change',event=>{
        const index=Number(event.target.value);
        if(Number.isSafeInteger(index)&&index>=0&&index<candidates.length)selected=index;
    });
    return await showing===POPUP_RESULT.AFFIRMATIVE?candidates[selected]:null;
}

/** Human correction of AI's proposed combined prose, before any save or backup. */
async function reviewSlothMergeDraft(candidate,draft) {
    let edited={...draft};
    const body='<div class="stmb-sloth-review"><h3>'+
        html(t('Review combined Scene text','STMemoryBooks_SlothMergeDraft'))+
        '</h3><p>'+html(candidate.reason)+'</p><p>'+
        html(t('Check the actual causal connection, individual voices, knowledge boundaries and completed ending. You can edit the title or prose. The original two records are not deleted.',
            'STMemoryBooks_SlothMergeDraftHelp'))+'</p>'+
        '<label><strong>'+html(t('Scene title','STMemoryBooks_SlothMergeTitle'))+'</strong>'+
        '<input class="text_pole" id="stmb-sloth-merge-title" value="'+html(draft.title)+'" /></label>'+
        '<label><strong>'+html(t('Combined Scene','STMemoryBooks_SlothMergeContent'))+'</strong>'+
        '<textarea class="text_pole" id="stmb-sloth-merge-content" rows="14">'+
        html(draft.content)+'</textarea></label></div>';
    const popup=new Popup(DOMPurify.sanitize(body),POPUP_TYPE.CONFIRM,'',{
        wide:true,large:true,allowVerticalScrolling:true,
        okButton:t('Review merge and backup','STMemoryBooks_SlothMergeReviewDraft'),
        cancelButton:t('Cancel','STMemoryBooks_Cancel'),
    });
    markStmbPopup(popup);
    const showing=popup.show();
    popup.dlg?.querySelector('#stmb-sloth-merge-title')?.addEventListener('input',event=>{
        edited.title=event.target.value.trim();
    });
    popup.dlg?.querySelector('#stmb-sloth-merge-content')?.addEventListener('input',event=>{
        edited.content=event.target.value;
    });
    return await showing===POPUP_RESULT.AFFIRMATIVE?edited:null;
}

function downloadSlothMergeBackup(name,memory,ref,plan) {
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    const data={type:'Sloth reviewed Scene merge: FULL ORIGINAL Memory World Info backup',
        timestamp:new Date().toISOString(),lorebook:name,chatRef:ref,
        sourceUids:plan.sourceUids,sourceRanges:plan.sourceRanges,original:memory};
    const blob=new Blob([stringify(data)],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob),anchor=document.createElement('a');
    anchor.href=url;anchor.download='Sloth_Memory_PreMerge_'+stamp+'.json';
    document.body.appendChild(anchor);
    try {anchor.click();}
    finally {anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
}

/** Last approval downloads a complete original JSON. NO automatic Hide or Nexus edits. */
async function approveSlothSceneMerge({name,original,staged,candidate,ref}) {
    const changes=staged.changes;
    const snapshots=staged.originalSnapshots.map(entry=>
        '<details class="stmb-sloth-detail"><summary>'+
        html(entry.comment)+' · UID '+html(entry.uid)+'</summary>'+
        '<pre>'+html(entry.content)+'</pre></details>').join('');
    const body='<div class="stmb-sloth-review"><h3>'+
        html(t('Final Scene merge and backup','STMemoryBooks_SlothMergeFinal'))+
        '</h3><p>'+html(t('Only the selected Memory lorebook will be changed. The earlier Scene remains as a disabled full-history archive, the later UID contains the combined text, and unrelated Scenes stay intact. Verify both originals and download the complete JSON before saving.',
            'STMemoryBooks_SlothMergeFinalHelp'))+'</p><p>'+
        html(candidate.reason)+'</p><h4>'+
        html(t('Original Scenes','STMemoryBooks_SlothMergeOriginals'))+'</h4>'+
        snapshots+'<h4>'+html(t('Proposed combined Scene','STMemoryBooks_SlothMergeCombined'))+
        '</h4><pre>'+html(staged.proposedMemory.entries[
            Object.keys(staged.proposedMemory.entries).find(key=>
                staged.proposedMemory.entries[key].uid===staged.plan.survivorUid)
        ]?.content)+'</pre><small>'+
        html('UID '+staged.plan.retiredUid+' → disabled archive; UID '+
            staged.plan.survivorUid+' → combined; rotation updates: '+staged.rotation.length)+
        '</small></div>';
    let downloaded=false;
    const popup=new Popup(DOMPurify.sanitize(body),POPUP_TYPE.TEXT,'',{
        wide:true,large:true,allowVerticalScrolling:true,
        okButton:false,cancelButton:t('Cancel','STMemoryBooks_Cancel'),
        customButtons:[{
            text:t('Download Memory JSON and approve save','STMemoryBooks_SlothMergeApprove'),
            result:POPUP_RESULT.CUSTOM1,classes:['menu_button'],
            action:()=>{downloadSlothMergeBackup(name,original,ref,staged.plan);downloaded=true;},
        }],
    });
    markStmbPopup(popup);
    return await popup.show()===POPUP_RESULT.CUSTOM1 && downloaded;
}

/** Explicit, three-review operation on one Memory book, never an automatic repair. */
export async function runNexusSceneMerge({profileIndex}={}) {
    if(collectorBusy)throw new Error('A Sloth collection or migration is already in progress.');
    collectorBusy=true;
    try {
        const settings=extension_settings.STMemoryBooks;
        const ref=structuredClone(getCurrentStmbChatRef());
        if(ref.type!=='character' || !String(ref.fileName||'').trim()) {
            throw new Error('Choose a saved individual-character chat before reviewing Scene merges.');
        }
        const roles={
            nexus:getNexusRoleResolutionForChatRef('nexus',ref,settings),
            memory:getNexusRoleResolutionForChatRef('memory',ref,settings),
        };
        if(roles.nexus.state!=='ready'||roles.memory.state!=='ready'||
            roles.nexus.name===roles.memory.name) {
            throw new Error('Connect two existing, different Nexus and Memory books first.');
        }
        const names={nexus:roles.nexus.name,memory:roles.memory.name};
        const original=await loadServerWorld(names.memory);
        assertLegacyMigrationOrigin(ref,names);
        const profile=settings.profiles?.[profileIndex??settings.defaultProfile]
            ||settings.profiles?.[settings.defaultProfile];
        if(!profile)throw new Error('Choose an AI profile before reviewing Scene merges.');
        toastr.info(t('Looking for previously split causal Scenes...',
            'STMemoryBooks_SlothMergeScanning'),'🦥 STMemoryBooks');
        const chatIds=[String(ref.fileName||''),String(ref.chatId||'')].filter(Boolean);
        const candidates=await suggestSlothSceneMerges({
            memory:original,chatIds,profile,settings,
        });
        assertLegacyMigrationOrigin(ref,names);
        if(!candidates.length){
            toastr.info(t('No sufficiently evidenced Scene merge pairs were proposed. No books changed.',
                'STMemoryBooks_SlothMergeNone'),'🦥 STMemoryBooks');
            return {saved:false,reason:'no-candidates'};
        }
        const candidate=await chooseSlothMergeCandidate(candidates);
        if(!candidate)return {saved:false,reason:'pair-cancelled'};
        assertLegacyMigrationOrigin(ref,names);
        const drafted=await composeSlothMergedScene({candidate,profile,settings});
        assertLegacyMigrationOrigin(ref,names);
        const edited=await reviewSlothMergeDraft(candidate,drafted);
        if(!edited)return {saved:false,reason:'draft-cancelled'};
        assertLegacyMigrationOrigin(ref,names);
        const staged=stageNexusSceneMerge(original,{
            sourceUids:candidate.sourceUids,title:edited.title,
            content:edited.content,keywords:edited.keywords,
            sameCausalIncident:true,
            olderMode:settings.moduleSettings?.nexusOlderSceneMode==='keyword'?'keyword':'vector',
        });
        const accepted=await approveSlothSceneMerge({
            name:names.memory,original,staged,candidate,ref,
        });
        if(!accepted)return {saved:false,reason:'save-cancelled'};
        assertLegacyMigrationOrigin(ref,names);
        const result=await commitSlothNexusMigration({
            name:names.memory,original,staged:staged.proposedMemory,
        },{
            loadFresh:loadServerWorld,
            save:(name,book)=>saveWorldInfo(name,book,true),
            withLock:(name,task)=>withStmbWriteLane({type:'lorebook',name},task),
            verifyOrigin:()=>assertLegacyMigrationOrigin(ref,names),
            resetCache:(name,book)=>worldInfoCache.set(name,structuredClone(book)),
            operation:'Memory Scene merge',
        });
        try {await Promise.resolve(reloadEditor(names.memory));}
        catch(error){console.warn('Sloth Memory Scene merge editor refresh failed',error);}
        toastr.success(t('Reviewed Scene merge saved in Memory. The original is archived; no chat messages were hidden.',
            'STMemoryBooks_SlothMergeSaved'),'🦥 STMemoryBooks');
        return {saved:true,sourceUids:staged.plan.sourceUids,result};
    }finally {
        collectorBusy=false;
    }
}


/**
 * A special, one-time explicit review: de-inject archived old status text
 * only after confirming replacement facts from the current chat.
 * Original disabled entries and a full snapshot in Nexus metadata survive.
 */
export async function runNexusLegacyContinuityReview({profileIndex}={}) {
    if(collectorBusy)throw new Error('A Sloth collection or migration is already in progress.');
    collectorBusy=true;
    try {
        const ref=structuredClone(getCurrentStmbChatRef());
        if(ref.type!=='character' || !String(ref.fileName||'').trim()) {
            throw new Error('Select a saved individual-character chat before reviewing old state.');
        }
        const settings=extension_settings.STMemoryBooks;
        const roles={
            nexus:getNexusRoleResolutionForChatRef('nexus',ref,settings),
            memory:getNexusRoleResolutionForChatRef('memory',ref,settings),
        };
        if(roles.nexus.state!=='ready'||roles.memory.state!=='ready'||
            roles.nexus.name===roles.memory.name) {
            throw new Error('Connect two different character-linked Nexus and Memory books first.');
        }
        const names={nexus:roles.nexus.name,memory:roles.memory.name};
        const original=await loadServerWorld(names.nexus);
        assertLegacyMigrationOrigin(ref,names);
        const plan=inspectSlothLegacyContinuity(original);
        if(!plan.required){
            toastr.info(t('No untouched legacy Current Continuity is available for review.',
                'STMemoryBooks_SlothLegacySemanticNone'),'🦥 STMemoryBooks');
            return {saved:false,reason:plan.reason};
        }
        const source=chat.map((entry,id)=>({entry,id}))
            .filter(({entry})=>entry && !entry.is_system &&
                typeof entry.mes==='string' && !!entry.mes.trim())
            .map(({entry,id})=>({id,name:String(entry.name||''),
                mes:entry.mes,is_user:!!entry.is_user,send_date:entry.send_date||null}));
        if(!source.length){
            throw new Error('No visible chat evidence to confirm current state. Original archive preserved.');
        }
        const sourceIds=source.map(s=>s.id);
        const fingerprint=fingerprintSlothChat(chat,sourceIds),chatLength=chat.length;
        const assertReviewOrigin=()=>{
            assertLegacyMigrationOrigin(ref,names);
            if(chat.length!==chatLength ||
                fingerprintSlothChat(chat,sourceIds)!==fingerprint){
                throw new Error('Original chat changed during semantic review. No save performed.');
            }
        };
        const profile=settings.profiles?.[profileIndex??settings.defaultProfile]
            ||settings.profiles?.[settings.defaultProfile];
        if(!profile)throw new Error('Choose an AI profile before reviewing old Continuity.');
        toastr.info(t('Comparing preserved old states with the visible current chat...',
            'STMemoryBooks_SlothLegacySemanticAnalyzing'),'🦥 STMemoryBooks');
        const proposal=await proposeSlothLegacyContinuity({
            plan,messages:source,profile,settings,
        });
        assertReviewOrigin();
        if(!proposal.current.length){
            toastr.warning(t('No old status was corroborated by current chat evidence. Original Current Continuity was left untouched.',
                'STMemoryBooks_SlothLegacySemanticUnverified'),'🦥 STMemoryBooks');
            return {saved:false,reason:'not-currently-corroborated'};
        }
        const staged=stageSlothLegacyContinuity(original,proposal,{
            chatKey:getStmbChatKey(ref),messages:source,
        });
        const details=proposal.current.map(item=>
            '<details class="stmb-sloth-detail"><summary>'+
            html(item.section)+' · '+html(item.text)+'</summary>'+
            '<p>'+html(item.reason)+'</p>'+
            '<small>Legacy UID '+html(item.archive.uid)+' · '+html(item.archive.quote)+'</small>'+
            '<p>#'+html(item.chat.messageId)+' · '+html(item.chat.quote)+'</p>'+
            '</details>').join('');
        const excluded=proposal.notCurrent.map(item=>
            '<li><strong>'+html(item.status)+'</strong> · '+
            html(item.reason)+' (UID '+html(item.archive.uid)+')<p>'+
            html(item.archive.quote)+'</p></li>').join('');
        const body='<div class="stmb-sloth-review"><h3>'+
            html(t('Review historical Continuity restructuring',
                'STMemoryBooks_SlothLegacySemanticReview'))+'</h3>'+
            '<p class="stmb-sloth-warning">'+
            html(t('The old status text will no longer be injected as current. The original source entries and exact old Current Continuity body remain preserved in the full JSON history. Review every excluded old fact and every new sentence before approval.',
                'STMemoryBooks_SlothLegacySemanticWarning'))+'</p>'+
            '<h4>'+html(t('Old active text','STMemoryBooks_SlothLegacySemanticBefore'))+
            '</h4><details class="stmb-sloth-detail"><summary>'+
            html(t('Expand complete old text','STMemoryBooks_SlothLegacySemanticExpand'))+
            '</summary><pre>'+html(staged.previous)+'</pre></details>'+
            '<h4>'+html(t('Proposed current facts and evidence','STMemoryBooks_SlothLegacySemanticEvidence'))+
            '</h4>'+details+
            '<h4>'+html(t('Historical / uncertain items not injected',
                'STMemoryBooks_SlothLegacySemanticExcluded'))+'</h4><ul>'+
            (excluded||'<li>None</li>')+'</ul>'+
            '<h4>'+html(t('Proposed active Current Continuity',
                'STMemoryBooks_SlothLegacySemanticAfter'))+'</h4>'+
            '<pre>'+html(staged.next)+'</pre></div>';
        const state={name:names.nexus,original,staged:staged.staged};
        let downloaded=false;
        const popup=new Popup(DOMPurify.sanitize(body),POPUP_TYPE.TEXT,'',{
            wide:true,large:true,allowVerticalScrolling:true,
            okButton:false,cancelButton:t('Cancel','STMemoryBooks_Cancel'),
            customButtons:[{
                text:t('Back up original Nexus JSON and approve current-state replacement',
                    'STMemoryBooks_SlothLegacySemanticApprove'),
                result:POPUP_RESULT.CUSTOM1,classes:['menu_button'],
                action:()=>{
                    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
                    const payload={type:'Sloth original Nexus before reviewed semantic Continuity',
                        timestamp:new Date().toISOString(),chatRef:ref,
                        originalNexus:original,approvedProposal:proposal,
                        exactLegacyContent:staged.previous};
                    const blob=new Blob([JSON.stringify(payload)],
                        {type:'application/json;charset=utf-8'});
                    const url=URL.createObjectURL(blob);
                    const anchor=document.createElement('a');
                    anchor.href=url;
                    anchor.download='Sloth_Nexus_PreSemanticReview_'+stamp+'.json';
                    document.body.appendChild(anchor);
                    try{anchor.click();downloaded=true;}
                    finally{anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
                },
            }],
        });
        markStmbPopup(popup);
        const accepted=await popup.show()===POPUP_RESULT.CUSTOM1 && downloaded;
        if(!accepted)return {saved:false,reason:'review-cancelled'};
        assertReviewOrigin();
        const result=await commitSlothNexusMigration(state,{
            loadFresh:loadServerWorld,
            save:(name,book)=>saveWorldInfo(name,book,true),
            withLock:(name,task)=>withStmbWriteLane({type:'lorebook',name},task),
            verifyOrigin:assertReviewOrigin,
            resetCache:(name,book)=>worldInfoCache.set(name,structuredClone(book)),
            operation:'Nexus continuity semantic reconciliation',
        });
        try{await Promise.resolve(reloadEditor(names.nexus));}
        catch(error){console.warn('Sloth Continuity editor refresh failed:',error);}
        toastr.success(t('Reviewed Current Continuity saved. Original historical entries remain archived. Memory and chat unchanged.',
            'STMemoryBooks_SlothLegacySemanticSaved'),'🦥 STMemoryBooks');
        return {saved:true,currentFacts:proposal.current.length,
            notCurrentFacts:proposal.notCurrent.length,result};
    }finally{
        collectorBusy=false;
    }
}


/** Explicit newest-Scene split, limited to verified visible original messages. */
export async function runNexusLatestSceneSplit({profileIndex}={}) {
    if(collectorBusy)throw new Error('A Sloth collection or repair is already in progress.');
    collectorBusy=true;
    try{
        const settings=extension_settings.STMemoryBooks;
        const ref=structuredClone(getCurrentStmbChatRef());
        if(ref.type!=='character'||!String(ref.fileName||'').trim()) {
            throw new Error('Choose a saved individual-character chat before splitting a Scene.');
        }
        const roles={
            nexus:getNexusRoleResolutionForChatRef('nexus',ref,settings),
            memory:getNexusRoleResolutionForChatRef('memory',ref,settings),
        };
        if(roles.nexus.state!=='ready'||roles.memory.state!=='ready'||
            roles.nexus.name===roles.memory.name) {
            throw new Error('Assign two different character-linked Nexus and Memory lorebooks.');
        }
        const names={nexus:roles.nexus.name,memory:roles.memory.name};
        const original=await loadServerWorld(names.memory);
        assertLegacyMigrationOrigin(ref,names);
        const chatIds=[String(ref.fileName||''),String(ref.chatId||'')].filter(Boolean);
        const sourcePlan=inspectNexusSceneSplit(original,chatIds);
        const messages=sourcePlan.sourceIds.map(id=>{
            const message=chat[id];
            if(!message||message.is_system||typeof message.mes!=='string'||
                !message.mes.trim()){
                throw new Error('Original message #'+id+
                    ' is hidden, missing or blank. Split requires the visible original chat.');
            }
            return {id,name:String(message.name||''),mes:message.mes,
                is_user:!!message.is_user,send_date:message.send_date||null};
        });
        const sourceIds=sourcePlan.sourceIds,chatLength=chat.length;
        const originalFingerprint=fingerprintSlothChat(chat,sourceIds);
        const verifyOrigin=()=>{
            assertLegacyMigrationOrigin(ref,names);
            if(chat.length!==chatLength ||
                fingerprintSlothChat(chat,sourceIds)!==originalFingerprint) {
                throw new Error('Original chat changed during Scene split. No data saved.');
            }
        };
        const profile=settings.profiles?.[profileIndex??settings.defaultProfile]
            ||settings.profiles?.[settings.defaultProfile];
        if(!profile)throw new Error('Choose an AI profile before reviewing a Scene split.');
        toastr.info(t('Checking the newest Scene for independent completed events...',
            'STMemoryBooks_SlothSplitAnalyzing'),'🦥 STMemoryBooks');
        const candidate=await suggestSlothLatestSceneSplit({
            plan:sourcePlan,messages,profile,settings,
        });
        verifyOrigin();
        if(!candidate){
            toastr.info(t('No independently completed incidents were found. Memory was not changed.',
                'STMemoryBooks_SlothSplitNone'),'🦥 STMemoryBooks');
            return {saved:false,reason:'no-independent-events'};
        }
        const items=candidate.parts.map((part,i)=>
            '<label class="stmb-sloth-plan-item"><strong>'+
            html(String(i+1)+'. '+part.title)+'</strong><small>'+
            html(part.reason)+'</small><p>'+html(part.result)+'</p>'+
            '<small>'+html(part.evidence.map(e=>'#'+e.messageId+' '+e.quote).join(' · '))+
            '</small><input class="text_pole stmb-sloth-split-title" data-index="'+i+
            '" value="'+html(part.title)+'" aria-label="Scene title" />'+
            '<input class="text_pole stmb-sloth-split-ranges" data-index="'+i+
            '" value="'+html(readableSegments(part.segments))+'" aria-label="Source ranges" />'+
            '</label>').join('');
        const planBody='<div class="stmb-sloth-review"><h3>'+
            html(t('Review independent Scene events','STMemoryBooks_SlothSplitPlanTitle'))+
            '</h3><p>'+html(t('Only the newest completed Scene can be split safely without renumbering older memories. Check the independent causes, endings and exact message ranges. Missing or repeated source messages block the change.',
                'STMemoryBooks_SlothSplitPlanHelp'))+'</p>'+
            '<details class="stmb-sloth-detail"><summary>'+html(sourcePlan.sourceTitle)+
            ' · UID '+html(sourcePlan.sourceUid)+'</summary><pre>'+
            html(sourcePlan.sourceContent)+'</pre></details>'+items+'</div>';
        const planPopup=new Popup(DOMPurify.sanitize(planBody),POPUP_TYPE.CONFIRM,'',{
            wide:true,large:true,allowVerticalScrolling:true,
            okButton:t('Approve split boundaries','STMemoryBooks_SlothSplitPlanApprove'),
            cancelButton:t('Cancel','STMemoryBooks_Cancel'),
        });
        markStmbPopup(planPopup);
        const showingPlan=planPopup.show();
        const reviewed=candidate.parts.map(item=>({
            title:item.title,reason:item.reason,result:item.result,
            complete:true,segments:item.segments.map(r=>[...r]),
            evidence:structuredClone(item.evidence),
        }));
        for(const input of planPopup.dlg?.querySelectorAll(
            '.stmb-sloth-split-title,.stmb-sloth-split-ranges')||[]){
            input.addEventListener('input',()=>{
                const i=Number(input.dataset.index);
                if(!Number.isSafeInteger(i)||!reviewed[i])return;
                if(input.classList.contains('stmb-sloth-split-title')){
                    reviewed[i].title=input.value.trim();
                }else reviewed[i].rawRanges=input.value;
            });
        }
        if(await showingPlan!==POPUP_RESULT.AFFIRMATIVE)return {saved:false,reason:'plan-cancelled'};
        for(const item of reviewed){
            if(item.rawRanges!==undefined) {
                item.segments=parseReviewedSegments(item.rawRanges,sourceIds);
            }
            delete item.rawRanges;
        }
        const plan=validateNexusSceneSplitProposal(sourcePlan,{parts:reviewed},messages);
        verifyOrigin();
        const drafts=[];
        for(const event of plan.parts){
            const composed=await composeSlothScene({
                event,messages,profile,settings,characterContext:'',
            });
            drafts.push({...event,content:composed.content,
                keywords:composed.keywords});
            verifyOrigin();
        }
        if(settings.moduleSettings?.slothPreciseReviewEnabled===true){
            await auditSlothDraft({messages,scenes:drafts,edits:[],profile,settings});
            verifyOrigin();
        }
        const draftBody='<div class="stmb-sloth-review"><h3>'+
            html(t('Review split Scene prose','STMemoryBooks_SlothSplitDraftTitle'))+
            '</h3><p>'+html(t('Edit each new Scene if needed. Preserve actor-specific voice, actual dialogue and a completed Result. Nothing is saved at this step.',
                'STMemoryBooks_SlothSplitDraftHelp'))+'</p>'+
            drafts.map((item,i)=>
                '<label class="stmb-sloth-plan-item"><strong>'+html(item.title)+
                ' · '+html(readableSegments(item.segments))+'</strong>'+
                '<input class="text_pole stmb-sloth-split-draft-title" data-index="'+i+
                '" value="'+html(item.title)+'" aria-label="Scene title" />'+
                '<textarea class="text_pole stmb-sloth-split-draft-content" rows="13" data-index="'+i+
                '" aria-label="Completed Scene">'+html(item.content)+'</textarea></label>').join('')+
            '</div>';
        const draftPopup=new Popup(DOMPurify.sanitize(draftBody),POPUP_TYPE.CONFIRM,'',{
            wide:true,large:true,allowVerticalScrolling:true,
            okButton:t('Review full Memory split and backup','STMemoryBooks_SlothSplitDraftApprove'),
            cancelButton:t('Cancel','STMemoryBooks_Cancel'),
        });
        markStmbPopup(draftPopup);
        const showingDraft=draftPopup.show();
        for(const input of draftPopup.dlg?.querySelectorAll(
            '.stmb-sloth-split-draft-title,.stmb-sloth-split-draft-content')||[]){
            input.addEventListener('input',()=>{
                const i=Number(input.dataset.index);
                if(!Number.isSafeInteger(i)||!drafts[i])return;
                if(input.classList.contains('stmb-sloth-split-draft-title')){
                    drafts[i].title=input.value.trim();
                }else drafts[i].content=input.value;
            });
        }
        if(await showingDraft!==POPUP_RESULT.AFFIRMATIVE)return {saved:false,reason:'draft-cancelled'};
        verifyOrigin();
        const staged=stageNexusSceneSplit(original,{
            sourceUid:sourcePlan.sourceUid,parts:drafts,messages,
            createEntry:book=>createWorldInfoEntry(names.memory,book),
            olderMode:settings.moduleSettings?.nexusOlderSceneMode==='keyword'?'keyword':'vector',
        });
        const preview='<div class="stmb-sloth-review"><h3>'+
            html(t('Final split, original backup and save','STMemoryBooks_SlothSplitFinalTitle'))+
            '</h3><p>'+html(t('The entire original Memory JSON must be backed up before saving. The original Scene will remain as a disabled full-history archive. Separate completed Scenes receive new UIDs. All other lorebooks and chat messages remain unchanged.',
                'STMemoryBooks_SlothSplitFinalHelp'))+'</p>'+
            '<h4>'+html(t('Original archived Scene','STMemoryBooks_SlothSplitOld'))+
            '</h4><details class="stmb-sloth-detail"><summary>'+
            html(staged.plan.sourceTitle)+' · UID '+html(staged.retiredUid)+
            '</summary><pre>'+html(staged.originalSnapshot.content)+'</pre></details>'+
            '<h4>'+html(t('Independent replacement Scenes','STMemoryBooks_SlothSplitNew'))+
            '</h4>'+staged.writes.map(item=>
                '<details class="stmb-sloth-detail"><summary>'+
                html(item.title)+' · UID '+html(item.uid)+
                ' · '+html(readableSegments(item.segments))+
                '</summary><pre>'+html(item.after)+'</pre></details>').join('')+
            '<small>'+html('Rotation changes: '+staged.rotation.length)+'</small></div>';
        let downloaded=false;
        const finalPopup=new Popup(DOMPurify.sanitize(preview),POPUP_TYPE.TEXT,'',{
            wide:true,large:true,allowVerticalScrolling:true,
            okButton:false,cancelButton:t('Cancel','STMemoryBooks_Cancel'),
            customButtons:[{
                text:t('Download original Memory JSON and approve split',
                    'STMemoryBooks_SlothSplitApprove'),
                result:POPUP_RESULT.CUSTOM1,classes:['menu_button'],
                action:()=>{
                    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
                    const backup={type:'Sloth approved latest Scene split: original Memory World Info',
                        timestamp:new Date().toISOString(),chatRef:ref,
                        originalMemory:original,
                        sourceUid:staged.retiredUid,
                        reviewedParts:staged.writes.map(x=>({
                            uid:x.uid,title:x.title,segments:x.segments,
                        }))};
                    const blob=new Blob([JSON.stringify(backup)],
                        {type:'application/json;charset=utf-8'});
                    const url=URL.createObjectURL(blob);
                    const anchor=document.createElement('a');anchor.href=url;
                    anchor.download='Sloth_Memory_PreSplit_'+stamp+'.json';
                    document.body.appendChild(anchor);
                    try{anchor.click();downloaded=true;}
                    finally{anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
                },
            }],
        });
        markStmbPopup(finalPopup);
        const confirmed=await finalPopup.show()===POPUP_RESULT.CUSTOM1 && downloaded;
        if(!confirmed)return {saved:false,reason:'save-cancelled'};
        verifyOrigin();
        const result=await commitSlothNexusMigration({
            name:names.memory,original,staged:staged.proposedMemory,
        },{
            loadFresh:loadServerWorld,
            save:(name,book)=>saveWorldInfo(name,book,true),
            withLock:(name,task)=>withStmbWriteLane({type:'lorebook',name},task),
            verifyOrigin,
            resetCache:(name,book)=>worldInfoCache.set(name,structuredClone(book)),
            operation:'Memory Scene split',
        });
        try{await Promise.resolve(reloadEditor(names.memory));}
        catch(error){console.warn('Sloth Memory split editor refresh failed:',error);}
        toastr.success(t('Reviewed Scene split saved to Memory. The original was archived, with no chat messages hidden.',
            'STMemoryBooks_SlothSplitSaved'),'🦥 STMemoryBooks');
        return {saved:true,retiredUid:sourcePlan.sourceUid,
            newUids:staged.writes.map(x=>x.uid),result};
    }finally{collectorBusy=false;}
}
