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
        // Unreviewed legacy migration could overwrite or duplicate the older statuses.
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
