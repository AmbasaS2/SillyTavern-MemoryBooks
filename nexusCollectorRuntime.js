// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
//
// Explicit two-stage Sloth collection. No automatic invocation, auto-hide, or
// mutation before both the plan and the exact World Info delta are approved.

import { chat, chat_metadata, getMaxContextSize, getRequestHeaders, menu_type, saveSettings } from '../../../../script.js';
import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../popup.js';
import { extension_settings } from '../../../extensions.js';
import { saveWorldInfo, createWorldInfoEntry, reloadEditor, worldInfoCache,
    world_info, world_info_budget, world_info_budget_cap, METADATA_KEY, charUpdateAddAuxWorld, updateWorldInfoList } from '../../../world-info.js';
import { getTokenCountAsync } from '../../../tokenizers.js';
import { DOMPurify } from '../../../../lib.js';
import { escapeHtml } from '../../../utils.js';
import { translate } from '../../../i18n.js';
import { getCurrentStmbChatRef, getStmbChatKey, patchStmbMetadataForChatRef, withStmbWriteLane } from './stmbJobs.js';
import { getSceneMarkers } from './sceneManager.js';
import { getActiveNexusRoleContext, getNexusRoleResolutionForChatRef } from './nexusCharacterRolesRuntime.js';
import { validateNexusEventPlan, parseReviewedSegments, fingerprintSlothChat,
    stageNexusEdits, stageMemoryScenes } from './nexusCollectionPolicy.js';
import { analyzeSlothEvents, composeSlothScene, proposeSlothNexusEdits, InvalidSlothNexusProposal, auditSlothDraft,
    suggestSlothSceneMerges, composeSlothMergedScene, proposeSlothLegacyContinuity,
    suggestSlothSceneSplit } from './nexusCollectionAI.js';
import { commitSlothBooks } from './nexusCollectionCommit.js';
import { inspectNexusLegacyMigration, listNexusMigrationCandidates, stageNexusLegacyMigration } from './nexusLegacyMigration.js';
import { commitSlothNexusMigration } from './nexusLegacyMigrationCommit.js';
import { inspectUnifiedMemorySplit, stageUnifiedMemorySplit } from './nexusUnifiedMigration.js';
import { stageNexusSceneMerge } from './nexusSceneMerge.js';
import {inspectNexusSceneSplit,inspectNexusSceneSplitAvailability,validateNexusSceneSplitProposal,
    stageNexusSceneSplit} from './nexusSceneSplit.js';
import { inspectSlothLegacyContinuity, stageSlothLegacyContinuity } from './nexusLegacySemantic.js';
import { markStmbPopup } from './utils.js';
import { getLinkedCharacterWorlds, getCharacterNexusRoles, setCharacterNexusRole } from './nexusCharacterRoles.js';
import { canInitializeNexusBooks, getNexusCompanionPlan, initialNexusBookNames,
    commitInitialNexusBooks } from './nexusInitialSetup.js';
import { reviewSlothSceneDrafts, reviewSlothNexusDrafts } from './nexusCollectionReview.js';
import { validateGroundedNexusEdits } from './nexusEditEvidence.js';
import { compileScene, createSceneRequest } from './chatcompile.js';
import { listReviewedSidePromptOptions, proposeReviewedSidePrompt } from './sidePrompts.js';
import { isManagedNexusWorld } from './nexusWorldInfoScope.js';
import { isCompletedSceneEntry } from './nexusSceneRotation.js';
import { expandSplitRanges, sourceRangesForSplit } from './nexusSceneSplitArchives.js';

const t=(source,key)=>translate(source,key);
const html=value=>escapeHtml(String(value ?? ''));
const stringify=value=>JSON.stringify(value);
let collectorBusy=false;

function assertReviewedCache(name, ...allowed) {
    // Core World Info updates the cache before its debounced HTTP write.
    // A different cached value can be a live editor's still-pending change.
    const cached = worldInfoCache.get(name);
    if (cached && !allowed.some(book => stringify(cached) === stringify(book))) {
        throw new Error(t('World Info has a different local version. Finish any open edits, then reload and review again.',
            'STMemoryBooks_SlothLocalConflict') + ' (' + name + ')');
    }
}

export function canStartNexusSetup(ref = getCurrentStmbChatRef(), settings = extension_settings.STMemoryBooks) {
    if (menu_type === 'create') return false;
    return canInitializeNexusBooks(setupContext(ref,settings));
}

function setupContext(ref,settings) {
    const {character,worldNames}=getActiveNexusRoleContext(settings);
    return {
        character,ref,key:getStmbChatKey(ref),settings,worldInfo:world_info,worldNames,
        chatBook:chat_metadata?.[METADATA_KEY],markers:chat_metadata?.STMemoryBooks,
    };
}

export function canPrepareNexusCompanion(ref = getCurrentStmbChatRef(), settings = extension_settings.STMemoryBooks) {
    return menu_type!=='create' && !!getNexusCompanionPlan(setupContext(ref,settings));
}

function proposeNexusBookNames(character) {
    const id=Array.from(crypto.getRandomValues(new Uint8Array(6)),
        v=>v.toString(16).padStart(2,'0')).join('');
    return initialNexusBookNames(character,id);
}

async function requestNexusSetupData(url) {
    const reply=await fetch(url,{method:'POST',headers:getRequestHeaders(),body:'{}',cache:'no-store'});
    if(!reply.ok)throw new Error('Could not verify SillyTavern data ('+reply.status+').');
    return await reply.json();
}

async function readNexusSetupSettings() {
    const reply=await requestNexusSetupData('/api/settings/get');
    if(typeof reply.settings!=='string')throw new Error('SillyTavern settings could not be verified.');
    const stored=JSON.parse(reply.settings);
    if(!stored.world_info_settings?.world_info || !stored.extension_settings) {
        throw new Error('SillyTavern settings are missing the World Info or extension section.');
    }
    return {world:stored.world_info_settings.world_info,extensions:stored.extension_settings.STMemoryBooks};
}

async function listNexusSetupBooks(avatar, ownNames=[]) {
    const books=await requestNexusSetupData('/api/worldinfo/list');
    if(!Array.isArray(books)||books.some(book=>typeof book?.file_id!=='string')) {
        throw new Error('Could not verify conflicting lorebook names.');
    }
    const pending=books.filter(book=>book.extensions?.stmbNexusSetup?.avatar===avatar &&
        !ownNames.includes(book.file_id));
    if(pending.length) {
        throw new Error('Review the earlier setup books before creating another pair: ' +
            pending.map(book=>book.file_id).join(', '));
    }
    return books.map(book=>book.file_id);
}

function initialCharacterContext(character) {
    const data=character?.data||{};
    return JSON.stringify({name:character?.name,description:data.description,
        personality:data.personality,scenario:data.scenario});
}

async function saveInitialNexusCollection(states, {ref, roleNames, checkOrigin, settings, companion=null}) {
    const character=getActiveNexusRoleContext(settings).character;
    const result=await commitInitialNexusBooks(states,{
        list:()=>listNexusSetupBooks(ref.avatarUrl,states.map(state=>state.name)),
        load:loadServerWorld,
        save:(name,book)=>saveWorldInfo(name,book,true),
        verifyOrigin:checkOrigin,
        verifyUnbound:async()=>{
            const stored=await readNexusSetupSettings();
            const savedContext={...setupContext(ref,settings),character,
                settings:stored.extensions,worldInfo:stored.world};
            const unchanged=companion?
                stringify(getNexusCompanionPlan(savedContext))===stringify(companion.plan)&&
                    stringify(await loadServerWorld(companion.plan.existing))===stringify(companion.original):
                canInitializeNexusBooks(savedContext);
            if(!unchanged) {
                throw new Error('The saved character lorebook configuration changed. Review it before retrying.');
            }
        },
        withLocks:withBothWriteLanes,
        link:async()=>{
            await charUpdateAddAuxWorld(ref.avatarUrl,states.map(state=>state.name));
            settings.nexusCharacterRoles ||= {};
            setCharacterNexusRole(settings.nexusCharacterRoles,ref.avatarUrl,'nexus',roleNames.nexus);
            setCharacterNexusRole(settings.nexusCharacterRoles,ref.avatarUrl,'memory',roleNames.memory);
            await saveSettings();
            const stored=await readNexusSetupSettings();
            const assigned=getCharacterNexusRoles(stored.extensions?.nexusCharacterRoles,ref.avatarUrl);
            const linked=getLinkedCharacterWorlds({character,worldInfo:stored.world});
            if(!['nexus','memory'].every(role=>assigned[role]===roleNames[role] && linked.includes(roleNames[role]))) {
                throw new Error('The new lorebooks were saved, but their character links could not be verified.');
            }
        },
    });
    await updateWorldInfoList().catch(error=>console.warn('New lorebooks saved; editor list refresh failed.',error));
    return result;
}

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

export async function runNexusSidePromptFollowup({ profileIndex } = {}) {
    if (collectorBusy) throw new Error('A Sloth operation is already in progress.');
    collectorBusy = true;
    try {
        const settings = extension_settings.STMemoryBooks;
        const ref = structuredClone(getCurrentStmbChatRef());
        const roles = Object.fromEntries(['nexus', 'memory'].map(role =>
            [role, getNexusRoleResolutionForChatRef(role, ref, settings).name]));
        assertLegacyMigrationOrigin(ref, roles);
        const isAllowedBook = name => name !== roles.memory &&
            (name === roles.nexus || !isManagedNexusWorld(settings, name));
        const options = await listReviewedSidePromptOptions(roles.nexus, isAllowedBook);
        assertLegacyMigrationOrigin(ref, roles);
        if (!options.length) {
            toastr.info(t('No after-memory Side Prompt has an available destination in this chat.',
                'STMemoryBooks_SlothSidePromptEmpty'), 'STMemoryBooks');
            return { saved: false };
        }
        const memory = await loadServerWorld(roles.memory);
        assertLegacyMigrationOrigin(ref, roles);
        const scenes = Object.values(memory.entries).flatMap(entry => {
            if (entry.disable || !isCompletedSceneEntry(entry) || entry.STMB_chatId !== ref.fileName) return [];
            try {
                const ranges = sourceRangesForSplit(entry);
                const ids = expandSplitRanges(ranges);
                if (ids.some(id => !isVisibleSceneMessage(id))) return [];
                return [{ entry, ranges, ids, fingerprint: fingerprintSlothChat(chat, ids) }];
            } catch {
                return [];
            }
        }).sort((left, right) => right.ids.at(-1) - left.ids.at(-1));
        if (!scenes.length) {
            toastr.info(t('No saved Scene in this chat has all of its original messages visible.',
                'STMemoryBooks_SlothSidePromptNoSource'), 'STMemoryBooks');
            return { saved: false };
        }
        const choose = (label, id, values) => '<label class="stmb-sloth-edit">' + html(label) +
            '<select class="text_pole" id="' + id + '">' + values.map((value, index) =>
                '<option value="' + index + '">' + html(value) + '</option>').join('') + '</select></label>';
        const title = t('Review a Side Prompt', 'STMemoryBooks_SlothSidePromptAction');
        const selection = new Popup(DOMPurify.sanitize('<div class="stmb-sloth-review"><h3>' + html(title) + '</h3>' +
            choose(t('Saved Scene', 'STMemoryBooks_SlothSidePromptSource'), 'stmb-sideprompt-source', scenes.map(({ entry, ranges }) =>
                entry.comment + ' · ' + readableSegments(ranges))) +
            choose(t('Side Prompt', 'STMemoryBooks_SidePrompt'), 'stmb-sideprompt-template', options.map(item =>
                item.name + ' · ' + item.lorebookName)) + '</div>'), POPUP_TYPE.CONFIRM, '', {
            wide: true, allowVerticalScrolling: true,
            okButton: t('Generate preview', 'STMemoryBooks_SlothSidePromptGenerate'),
            cancelButton: t('Cancel', 'STMemoryBooks_Cancel'),
        });
        markStmbPopup(selection);
        const selectionResult = selection.show();
        const selected = { source: 0, template: 0 };
        for (const key of Object.keys(selected)) {
            selection.dlg.querySelector('#stmb-sideprompt-' + key).addEventListener('change', event => {
                selected[key] = Number(event.target.value);
            });
        }
        if (await selectionResult !== POPUP_RESULT.AFFIRMATIVE) return { saved: false };
        const scene = scenes[selected.source];
        const option = options[selected.template];
        assertLegacyMigrationOrigin(ref, roles);
        if (!scene || !option || !isAllowedBook(option.lorebookName)) throw new Error('The reviewed selection changed.');
        const fingerprint = scene.fingerprint;
        const verifyOrigin = () => {
            assertOrigin(ref, roles, scene.ids, fingerprint);
            if (!isAllowedBook(option.lorebookName)) throw new Error('The Side Prompt destination is no longer available for this chat.');
        };
        const compiled = compileScene(createSceneRequest(scene.ids[0], scene.ids.at(-1)), { messageIndices: scene.ids });
        const profiles = settings.profiles || [];
        const profile = profiles[profileIndex] || profiles[settings.defaultProfile];
        verifyOrigin();
        const original = await loadServerWorld(option.lorebookName);
        verifyOrigin();
        const draft = await proposeReviewedSidePrompt(option, original, compiled, profile);
        verifyOrigin();
        const contents = '<div class="stmb-sloth-review"><h3>' + html(draft.title) + '</h3><p>' +
            html(option.lorebookName + ' · ' + readableSegments(scene.ranges)) + '</p>' +
            (draft.before ? '<details class="stmb-sloth-detail"><summary>' +
                html(t('Before', 'STMemoryBooks_Regeneration_Before')) + '</summary><pre>' + html(draft.before) + '</pre></details>' : '') +
            '<label class="stmb-sloth-edit">' + html(t('Memory content', 'STMemoryBooks_MemoryContent')) +
            '<textarea id="stmb-sideprompt-draft" class="text_pole" rows="12">' + html(draft.text) + '</textarea></label></div>';
        let staged;
        const approval = new Popup(DOMPurify.sanitize(contents), POPUP_TYPE.TEXT, '', {
            wide: true, large: true, allowVerticalScrolling: true, okButton: false,
            cancelButton: t('Cancel', 'STMemoryBooks_Cancel'), customButtons: [{
                text: t('Download backup and approve save', 'STMemoryBooks_SlothBackupApprove'),
                result: POPUP_RESULT.CUSTOM1,
                action(event) {
                    try {
                        verifyOrigin();
                        const content = approval.dlg.querySelector('#stmb-sideprompt-draft')?.value.trim();
                        if (!content) throw new Error('The reviewed Side Prompt is blank.');
                        const candidate = draft.stage(content);
                        downloadNexusSetupBackup({ type: 'Sloth Side Prompt pre-save backup', chatRef: ref,
                            sourceRanges: scene.ranges, originals: { [option.lorebookName]: original } });
                        staged = candidate;
                    } catch (error) {
                        event.stopImmediatePropagation();
                        toastr.error(error.message, 'STMemoryBooks');
                    }
                },
            }],
        });
        markStmbPopup(approval);
        if (await approval.show() !== POPUP_RESULT.CUSTOM1 || !staged) return { saved: false };
        await readReviewedChat(ref, scene.ids, fingerprint);
        const storedMemory = await loadServerWorld(roles.memory);
        if (!Object.values(storedMemory.entries).some(entry => entry.uid === scene.entry.uid && stringify(entry) === stringify(scene.entry))) {
            throw new Error('The source Scene changed while the Side Prompt was being reviewed.');
        }
        const result = await commitSlothNexusMigration({ name: option.lorebookName, original, staged }, {
            loadFresh: loadServerWorld, save: (name, book) => saveWorldInfo(name, book, true),
            withLock: (name, task) => withStmbWriteLane({ type: 'lorebook', name }, task), verifyOrigin,
            verifyBeforeWrite: assertReviewedCache, operation: 'Side Prompt update',
            resetCache: (name, book) => worldInfoCache.set(name, structuredClone(book)),
        });
        try { await Promise.resolve(reloadEditor(option.lorebookName)); }
        catch (error) { console.warn('Sloth Side Prompt editor refresh failed', error); }
        toastr.success(t('The reviewed Side Prompt was saved.', 'STMemoryBooks_SlothSidePromptSaved'), 'STMemoryBooks');
        return { saved: true, result };
    } finally {
        collectorBusy = false;
    }
}

async function planApproval(plan) {
    const rows=plan.events.map((item,i)=>{
        return '<section class="stmb-sloth-plan-item">'+
            '<label class="checkbox_label"><input type="checkbox" data-sloth-plan-include="'+i+'" checked> '+
            html(t('Collect this Scene','STMemoryBooks_SlothIncludeScene'))+'</label>'+
            '<small>'+html(item.reason)+'</small>'+
            '<span>'+html(item.result)+'</span>'+
            '<label class="stmb-sloth-edit">'+html(t('Memory title','STMemoryBooks_MemoryTitle'))+
            '<input class="text_pole stmb-sloth-title-edit" data-index="'+i+'" value="'+html(item.title)+'"></label>'+
            '<label class="stmb-sloth-edit">'+html(t('Original message ranges','STMemoryBooks_SlothRangesLabel'))+
            '<input class="text_pole stmb-sloth-range-edit" data-index="'+i+
                '" value="'+html(readableSegments(item.segments))+'"></label></section>';
    }).join('');
    const deferred=plan.deferred.map((item,index)=>
        '<li><label class="stmb-sloth-edit"><span>'+html(item.unclassified
            ? t('The AI left these messages unclassified. They will stay in chat.',
                'STMemoryBooks_SlothUnclassifiedSource') : item.reason)+
        '</span><input class="text_pole stmb-sloth-deferred-range" data-index="'+index+
        '" value="'+html(readableSegments(item.segments))+'" aria-label="'+
        html(t('Original message ranges','STMemoryBooks_SlothRangesLabel'))+'"></label></li>').join('');
    const body='<div class="stmb-sloth-review">'+
        '<h3>'+html(t('Review proposed complete events','STMemoryBooks_SlothReviewPlan'))+'</h3>'+
        '<p>'+html(t('Check causal closure and original message ranges before writing. Titles and ranges can be edited.','STMemoryBooks_SlothPlanGuide'))+'</p>'+
        (plan.events.length>1?'<p>'+html(t('To combine proposals, put all source ranges in one Scene. Clear the ranges and uncheck the other proposals.',
            'STMemoryBooks_SlothCombinePlanRanges'))+'</p>':'')+
        rows+(deferred?'<h4>'+html(t('Unfinished / deferred','STMemoryBooks_SlothDeferred'))+
            '</h4><p>'+html(t('To move messages into a Scene, update both ranges. Clear a deferred range when moving all its messages.',
                'STMemoryBooks_SlothEditDeferredGuide'))+'</p><ul>'+deferred+'</ul>':'')+'</div>';
    let approvedPlan;
    const popup=new Popup(DOMPurify.sanitize(body),POPUP_TYPE.CONFIRM,'',{
        wide:true,large:true,allowVerticalScrolling:true,
        okButton:t('Approve event plan','STMemoryBooks_SlothApprovePlan'),
        cancelButton:t('Cancel','STMemoryBooks_Cancel'),
        onClosing(closing){
            if(closing.result!==POPUP_RESULT.AFFIRMATIVE)return true;
            try{
                const value=(selector,index)=>{
                    const field=closing.dlg.querySelector(selector+'[data-index="'+index+'"]');
                    if(!field)throw new Error('An original-message range field is missing.');
                    return field.value.trim();
                };
                const deferred=plan.deferred.flatMap((item,index)=>{
                    const reviewed=value('.stmb-sloth-deferred-range',index);
                    return reviewed?[{reason:item.reason,segments:parseReviewedSegments(reviewed,plan.sourceIds)}]:[];
                });
                const events=[];
                for (const [index,event] of plan.events.entries()) {
                    const inclusion=closing.dlg.querySelector('[data-sloth-plan-include="'+index+'"]');
                    if (!inclusion) throw new Error('A Scene inclusion control is missing.');
                    const range=value('.stmb-sloth-range-edit',index);
                    if (!inclusion.checked && !range) continue;
                    const segments=parseReviewedSegments(range,plan.sourceIds);
                    if (inclusion.checked) {
                        events.push({...event,complete:true,title:value('.stmb-sloth-title-edit',index),segments});
                    } else {
                        deferred.push({reason:'The reviewer deferred this proposed Scene.',segments});
                    }
                }
                approvedPlan=validateNexusEventPlan({events,deferred},plan.sourceIds);
                return true;
            }catch(error){
                toastr.error(error.message,'STMemoryBooks');
                return false;
            }
        },
    });
    markStmbPopup(popup);
    return await popup.show()===POPUP_RESULT.AFFIRMATIVE ? (approvedPlan ?? null) : null;
}

function downloadSafetyBackup(states,ref,plan,reviewedChanges=[],initial=false) {
    const documentData={
        type:states.length===1?'SillyTavern Sloth Nexus-only pre-commit backup':
            'SillyTavern Sloth two-book pre-commit backup',
        timestamp:new Date().toISOString(),chatRef:ref,plan:{
            events:plan.events.map(e=>({title:e.title,segments:e.segments})),
            deferred:plan.deferred.map(e=>({segments:e.segments,reason:e.reason})),
        },
        originals:Object.fromEntries(states.map(s=>[s.name,initial?null:s.original])),
        ...(initial?{initialSetup:true,priorCharacterRoles:null,
            approvedNewBooks:Object.fromEntries(states.map(s=>[s.name,s.staged]))}:{}),
        nexusEvidence:reviewedChanges.map(change=>({
            kind:change.kind,action:change.action,uid:change.uid,
            reason:change.reason,evidence:change.evidence,
        })),
    };
    downloadNexusSetupBackup(documentData);
}

function downloadNexusSetupBackup(documentData) {
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    const blob=new Blob([stringify(documentData)],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');anchor.href=url;anchor.download='Sloth_WorldInfo_Backup_'+stamp+'.json';
    document.body.appendChild(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
}

export async function runNexusCompanionSetup() {
    if(collectorBusy)throw new Error('A Sloth collection or migration is already in progress.');
    collectorBusy=true;
    try {
        const ref=structuredClone(getCurrentStmbChatRef());
        const settings=extension_settings.STMemoryBooks;
        const context=setupContext(ref,settings);
        const plan=menu_type==='create'?null:getNexusCompanionPlan(context);
        if(!plan)throw new Error('Check the existing lorebook and choose its role before preparing the missing book.');
        const checkOrigin=()=>{
            if(menu_type==='create'||getStmbChatKey()!==getStmbChatKey(ref)||
                stringify(getNexusCompanionPlan(setupContext(ref,settings)))!==stringify(plan)) {
                throw new Error('The original chat or existing book binding changed. Review it before retrying.');
            }
        };
        await listNexusSetupBooks(ref.avatarUrl);
        const original=await loadServerWorld(plan.existing);
        checkOrigin();
        const name=proposeNexusBookNames(context.character)[plan.missingRole];
        const roleNames={[plan.existingRole]:plan.existing,[plan.missingRole]:name};
        const staged={entries:{},extensions:{stmbNexusSetup:{version:1,avatar:ref.avatarUrl,
            role:plan.missingRole,pairedBook:plan.existing}}};
        const review='<div class="stmb-sloth-review"><h3>'+
            html(t('Prepare the missing lorebook','STMemoryBooks_SlothPrepareCompanion'))+'</h3><p>'+
            html(t('Review the existing book before creating its empty companion. The original book is backed up and kept intact. Migration is a separate review.',
                'STMemoryBooks_SlothCompanionHelp'))+'</p><ul>'+
            '<li>'+html(plan.existingRole==='nexus'?'Nexus':'Memory')+': '+html(plan.existing)+'</li>'+
            '<li>'+html(plan.missingRole==='nexus'?'Nexus':'Memory')+': '+html(name)+'</li></ul></div>';
        let downloaded=false;
        const popup=new Popup(DOMPurify.sanitize(review),POPUP_TYPE.TEXT,'',{
            wide:true,allowVerticalScrolling:true,okButton:false,
            cancelButton:t('Cancel','STMemoryBooks_Cancel'),
            customButtons:[{text:t('Download backup and approve save','STMemoryBooks_SlothBackupApprove'),
                result:POPUP_RESULT.CUSTOM1,classes:['menu_button'],
                action:()=>{
                    downloadNexusSetupBackup({type:'SillyTavern Sloth missing-book pre-commit backup',
                        timestamp:new Date().toISOString(),chatRef:ref,
                        priorCharacterRoles:getCharacterNexusRoles(settings.nexusCharacterRoles,ref.avatarUrl),
                        originals:{[plan.existing]:original,[name]:null},approvedNewBooks:{[name]:staged}});
                    downloaded=true;
                }}],
        });
        markStmbPopup(popup);
        if(await popup.show()!==POPUP_RESULT.CUSTOM1||!downloaded)return {saved:false,reason:'companion-cancelled'};
        checkOrigin();
        const result=await saveInitialNexusCollection([{name,staged}],{
            ref,roleNames,checkOrigin,settings,companion:{plan,original},
        });
        toastr.success(t('The missing lorebook is connected. Review migration for any legacy entries.',
            'STMemoryBooks_SlothCompanionSaved'),'STMemoryBooks');
        return {saved:true,result};
    } finally {
        collectorBusy=false;
    }
}

async function draftApproval({scenes,changes,plan,states,ref,initial=false,sceneOnly=false,edits,applyReviewedDraft}) {
    if (edits.length !== changes.length) throw new Error('Nexus review changes no longer match the proposed edits.');
    const alwaysOn = states.flatMap(state => Object.values(state.staged.entries))
        .filter(entry => entry.constant && !entry.disable && !entry.ignoreBudget)
        .map(entry => String(entry.content || '')).join('\n');
    let tokens;
    const contextSize = getMaxContextSize();
    if (Number.isFinite(contextSize) && contextSize > 0) {
        try { tokens = await getTokenCountAsync(alwaysOn); }
        catch (error) { console.debug('Sloth: World Info token preview unavailable.', error); }
    }
    const nativeBudget = Math.round(world_info_budget * contextSize / 100) || 1;
    const cap = world_info_budget_cap > 0 ? Math.min(nativeBudget, world_info_budget_cap) : nativeBudget;
    const budget = Number.isFinite(tokens) ? '<p class="stmb-sloth-budget' + (tokens >= cap ? ' warning' : '') + '">' +
        html(t('Always-on draft / SillyTavern World Info budget', 'STMemoryBooks_SlothBudgetPreview')) + ' · ' +
        html(tokens.toLocaleString()) + ' / ' + html(cap.toLocaleString()) + ' ' +
        html(t('tokens', 'STMemoryBooks_Tokens')) + '</p>' : '';
    const rotation = scenes.length ? states.flatMap(state => Object.entries(state.staged.entries)
        .filter(([key, entry]) => {
            const before = state.original.entries[key];
            return before && (before.constant !== entry.constant || before.vectorized !== entry.vectorized);
        }).map(([, entry]) => '<li>' + html(entry.comment) + ' · ' + html(entry.constant
            ? t('Constant', 'STMemoryBooks_Constant')
            : entry.vectorized ? t('Vector', 'STMemoryBooks_NexusRecallVector')
                : t('Keywords', 'STMemoryBooks_PromptFrame_KeywordsLabel')) + '</li>')).join('') : '';
    const recall = rotation ? '<details class="stmb-sloth-detail"><summary>' +
        html(t('Older Scene recall', 'STMemoryBooks_NexusRecallMode')) + '</summary><ul>' + rotation + '</ul></details>' : '';
    const beforeLabel=html(t('Before','STMemoryBooks_Regeneration_Before'));
    const afterLabel=html(t('After','STMemoryBooks_Regeneration_After'));
    const pieces=scenes.map((scene,index)=>
        '<details class="stmb-sloth-detail"'+(index===0?' open':'')+'><summary>'+html(scene.title)+' · '+
        html(readableSegments(scene.segments))+'</summary><label class="stmb-sloth-edit">'+
        html(t('Scene title','STMemoryBooks_SlothMergeTitle'))+
        '<input class="text_pole" data-sloth-scene-title="'+index+'" value="'+html(scene.title)+'"></label>'+
        '<label class="stmb-sloth-edit">'+
        html(t('Memory content','STMemoryBooks_MemoryContent'))+
        '<textarea class="text_pole" rows="9" data-sloth-scene-content="'+index+'">'+html(scene.content)+'</textarea></label>'+
        '<fieldset class="stmb-sloth-keywords"><legend>'+
        html(t('Keywords','STMemoryBooks_PromptFrame_KeywordsLabel'))+'</legend>'+
        scene.keywords.map((key,i)=>'<input class="text_pole" data-sloth-keywords="'+index+
            '" aria-label="'+html(t('Keywords','STMemoryBooks_PromptFrame_KeywordsLabel')+' '+(i+1))+
            '" value="'+html(key)+'">').join('')+'</fieldset></details>').join('');
    const delta=changes.map((change,index)=>
        '<details class="stmb-sloth-detail"><summary>'+html(change.action)+' · '+
        html(change.title)+'</summary><label class="checkbox_label">'+
        '<input type="checkbox" data-sloth-nexus-include="'+index+'" checked> '+
        html(t('Apply this change','STMemoryBooks_SlothApplyNexusChange'))+'</label><p><strong>'+
        html(t('Reason for change','STMemoryBooks_SlothEvidenceWhy'))+
        ':</strong> '+html(change.reason)+'</p><p><strong>'+
        html(t('Original message evidence','STMemoryBooks_SlothEvidenceSource'))+
        ':</strong></p><ul>'+
        (change.evidence||[]).map(item=>'<li>#'+html(item.messageId)+
            ' · '+html(item.quote)+'</li>').join('')+'</ul>'+
        '<div class="stmb-sloth-comparison'+(change.before?' has-before':'')+'">'+
        (change.before?'<div><p>'+beforeLabel+'</p><pre>'+html(change.before)+'</pre></div>':'')+
        '<div><p>'+afterLabel+'</p><pre>'+html(change.after)+'</pre></div></div>'+
        '<label class="stmb-sloth-edit">'+html(t('Edit only the proposed text','STMemoryBooks_SlothEditNexusText'))+
        '<textarea class="text_pole" rows="4" data-sloth-nexus-body="'+index+'">'+
        html(edits[index].action==='create'?edits[index].content:edits[index].text)+'</textarea></label>'+
        (change.keywords?'<label class="stmb-sloth-keywords">'+
            html(t('Keywords','STMemoryBooks_PromptFrame_KeywordsLabel'))+
            '<textarea class="text_pole" rows="3" data-sloth-nexus-keywords="'+index+'">'+
            html(change.keywords.join('\n'))+'</textarea></label>':'')+'</details>').join('');
    const nexusOnly=scenes.length===0 && states.length===1;
    const heading=nexusOnly
        ?t('Review Nexus current-state updates','STMemoryBooks_SlothNexusOnlyReview')
        :t('Review Memory and Nexus edits','STMemoryBooks_SlothReviewDraft');
    const guide=nexusOnly
        ?t('No Scene is complete. Only the selected Nexus lorebook will change after you review exact source quotes and download its full original JSON. Memory and chat messages will not change.',
            'STMemoryBooks_SlothNexusOnlyGuide')
        :sceneOnly
            ?t('The approved Scene changes will be saved to Memory after a JSON backup. No Nexus changes are staged.',
                'STMemoryBooks_SlothSceneOnlyGuide')
            :t('Both World Info books will change only after approval. A JSON backup will be downloaded first. No messages are hidden.',
                'STMemoryBooks_SlothSaveGuide');
    const creation=initial?'<p>'+html(t('These new lorebooks will be created and linked to this character.','STMemoryBooks_SlothFirstBooksReview'))+'</p><ul>'+
        states.map(state=>'<li>'+html(state.name)+'</li>').join('')+'</ul>':'';
    const body='<div class="stmb-sloth-review"><h3>'+
        html(heading)+'</h3>'+creation+'<p>'+html(guide)+
        '</p>'+budget+'<h4>Memory · '+scenes.length+'</h4>'+pieces+recall+
        '<h4>Nexus · '+changes.length+'</h4>'+delta+
        (plan.deferred.length?'<p>'+html(t('Unfinished source remains in chat. It will not be marked collected.','STMemoryBooks_SlothDeferredNote'))+'</p>':'')+
        '</div>';
    let downloaded=false;
    const popup=new Popup(DOMPurify.sanitize(body),POPUP_TYPE.TEXT,'',{
        wide:true,large:true,allowVerticalScrolling:true,
        okButton:false,cancelButton:t('Cancel','STMemoryBooks_Cancel'),
        customButtons:[{text:t('Download backup and approve save','STMemoryBooks_SlothBackupApprove'),
            result:POPUP_RESULT.CUSTOM1,classes:['menu_button'],
            action:event=>{
                try {
                    const field = (name, index, property = 'value') => {
                        const matches = popup.dlg.querySelectorAll(`[data-sloth-${name}="${index}"]`);
                        if (matches.length !== 1) throw new Error('A reviewed field is missing or repeated.');
                        return matches[0][property];
                    };
                    const reviewedScenes = reviewSlothSceneDrafts(scenes, scenes.map((_, index) => ({
                        title: field('scene-title', index), content: field('scene-content', index),
                        keywords: [...popup.dlg.querySelectorAll(`[data-sloth-keywords="${index}"]`)].map(input => input.value),
                    })));
                    const editableEdits = edits.map((edit, index) => changes[index].keywords ?
                        { ...edit, keywords: changes[index].keywords } : edit);
                    const reviewedEdits = reviewSlothNexusDrafts(editableEdits, editableEdits.map((edit, index) => ({
                        include: field('nexus-include', index, 'checked'),
                        body: field('nexus-body', index),
                        keywords: changes[index].keywords ? field('nexus-keywords', index).split(/\r?\n/) : edit.keywords,
                    })));
                    if (!reviewedScenes.length && !reviewedEdits.length) {
                        throw new Error(t('Select at least one Nexus change to save, or cancel.',
                            'STMemoryBooks_SlothNoApprovedChanges'));
                    }
                    const approvedChanges = applyReviewedDraft(reviewedScenes, reviewedEdits);
                    downloadSafetyBackup(states, ref, { ...plan, events: reviewedScenes }, approvedChanges, initial);
                    downloaded=true;
                } catch(error) {
                    event?.stopImmediatePropagation();
                    toastr.error(error.message,'STMemoryBooks');
                }
            }}]});
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

async function readReviewedChat(ref, sourceIds, fingerprint) {
    const response = await fetch('/api/chats/get', {
        method: 'POST', headers: getRequestHeaders(),
        body: stringify({ avatar_url: ref.avatarUrl, file_name: ref.fileName }),
    });
    if (!response.ok) throw new Error('The original chat could not be read from SillyTavern.');
    const stored = await response.json();
    if (!Array.isArray(stored) || !stored[0]?.chat_metadata ||
        fingerprintSlothChat(stored.slice(1), sourceIds) !== fingerprint) {
        throw new Error('The saved chat differs from the reviewed messages. Reload it before collecting again.');
    }
    return stored[0].chat_metadata.STMemoryBooks?.slothCollection;
}

async function updateCollectedLedger(prior, events, ref, roleNames, sourceIds, fingerprint) {
    const savedRanges=[...(prior.savedRanges||[])];
    for(const event of events)for(const range of event.segments)savedRanges.push([...range]);
    const receipt={chatKey:getStmbChatKey(ref),savedRanges,
        books:{nexus:roleNames.nexus,memory:roleNames.memory}};
    const previous = await readReviewedChat(ref, sourceIds, fingerprint);
    await patchStmbMetadataForChatRef(ref, markers => {
        assertOrigin(ref, roleNames, sourceIds, fingerprint);
        if (stringify(markers.slothCollection) !== stringify(previous)) {
            throw new Error('The saved collection receipt changed during review.');
        }
        return { ...markers, slothCollection: receipt };
    });
    if (stringify(await readReviewedChat(ref, sourceIds, fingerprint)) !== stringify(receipt)) {
        throw new Error('The collection receipt did not persist in the original chat.');
    }
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

function downloadNexusMigrationBackup(name,original,ref,timestamp,filename) {
    const payload={type:'Sloth Nexus migration: FULL ORIGINAL World Info backup',
        timestamp,
        lorebook:name,chatRef:ref,original};
    const blob=new Blob([JSON.stringify(payload)],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob),anchor=document.createElement('a');
    anchor.href=url;anchor.download=filename;
    document.body.appendChild(anchor);
    try{anchor.click();}finally{anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
}

async function approveNexusLegacyMigration({state,changes,ref,plan}) {
    const created=changes.filter(x=>x.action==='create');
    const timestamp=new Date().toISOString();
    const filename='Sloth_Nexus_PreMigration_'+timestamp.replace(/[:.]/g,'-')+'.json';
    const details=created.map(change=>'<details class="stmb-sloth-detail"><summary>'+
        html(change.from.map(source=>source.title).join(' + '))+' → '+html(change.title)+'</summary><pre>'+
        html(change.after)+'</pre></details>').join('');
    const body='<div class="stmb-sloth-review"><h3>'+
        html(t('Review legacy Nexus migration','STMemoryBooks_SlothLegacyReview'))+
        '</h3><p><strong>'+html(state.name)+'</strong></p><p>'+
        html(t('The entries on the right become active. The previous entries on the left stay in this lorebook, switched off, with their history.',
            'STMemoryBooks_SlothLegacyGuide'))+
        '</p>'+details+
        '<p>'+html(t('On approval, the original book is saved to your browser’s downloads. Open the download list to find the file.',
            'STMemoryBooks_SlothLegacyBackupLocation'))+'<br><code>'+html(filename)+'</code></p>'+
        (plan.hasHistory?'<p class="stmb-sloth-warning">'+
        html(t('Existing Side Prompt history is preserved; old templates will be blocked from rewriting archived entries.',
            'STMemoryBooks_SlothLegacyHistory'))+'</p>':'')+
        '</div>';
    let downloaded=false;
    const popup=new Popup(DOMPurify.sanitize(body),POPUP_TYPE.TEXT,'',{
        wide:true,large:true,allowVerticalScrolling:true,
        okButton:false,cancelButton:t('Cancel','STMemoryBooks_Cancel'),
        customButtons:[{
            text:t('Approve migration','STMemoryBooks_SlothLegacyApprove'),
            result:POPUP_RESULT.CUSTOM1,classes:['menu_button'],
            action:()=>{downloadNexusMigrationBackup(state.name,state.original,ref,timestamp,filename);downloaded=true;}
        }],
    });
    markStmbPopup(popup);
    return await popup.show()===POPUP_RESULT.CUSTOM1 && downloaded;
}

async function chooseNexusMigrationSources(book,candidates) {
    const titles=new Set(Object.values(book.entries).map(entry=>String(entry.comment||'').trim()));
    const options='<option value="">'+html(t('Leave empty','STMemoryBooks_SlothLegacyLeaveEmpty'))+'</option>'+
        candidates.map(entry=>'<option value="'+html(entry.uid)+'">'+html(entry.title||'#'+entry.uid)+'</option>').join('');
    const field=(kind,label)=>'<label class="stmb-sloth-edit">'+html(label)+
        '<select class="text_pole" data-sloth-migration-role="'+kind+'">'+options+'</select></label>';
    const body='<div class="stmb-sloth-review"><h3>'+html(t('Choose existing Nexus entries','STMemoryBooks_SlothLegacyChoose'))+'</h3><p>'+
        html(t('Choose entries by what they contain. Leave a role empty if you do not want to move anything into it.',
            'STMemoryBooks_SlothLegacyChooseHelp'))+'</p>'+
        (titles.has('Core Memory')?'':field('core',t('Core Memory · lasting settings','STMemoryBooks_SlothLegacyCoreRole')))+
        (titles.has('Current Continuity')?'':field('continuity',t('Current Continuity · current state','STMemoryBooks_SlothLegacyCurrentRole'))+
            field('status',t('Additional current-state entry','STMemoryBooks_SlothLegacyAdditionalState')))+
        '</div>';
    const popup=new Popup(DOMPurify.sanitize(body),POPUP_TYPE.CONFIRM,'',{
        wide:true,allowVerticalScrolling:true,
        okButton:t('Review migration','STMemoryBooks_SlothLegacyReview'),
        cancelButton:t('Cancel','STMemoryBooks_Cancel'),
    });
    markStmbPopup(popup);
    if(await popup.show()!==POPUP_RESULT.AFFIRMATIVE)return null;
    return Object.fromEntries([...popup.dlg.querySelectorAll('[data-sloth-migration-role]')]
        .filter(select=>select.value!=='').map(select=>[select.dataset.slothMigrationRole,Number(select.value)]));
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
                verifyBeforeWrite:assertReviewedCache,
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
        const candidates=listNexusMigrationCandidates(nexus);
        const alreadyHasBothTargets=['Core Memory','Current Continuity'].every(title=>
            Object.values(nexus.entries).some(entry=>String(entry.comment||'').trim()===title));
        if(!candidates.length || alreadyHasBothTargets){
            toastr.info(t('No entries are available to move into a new Core Memory or Current Continuity.',
                'STMemoryBooks_SlothLegacyNone'),'STMemoryBooks');
            return {saved:false,reason:'no-legacy'};
        }
        const selection=await chooseNexusMigrationSources(nexus,candidates);
        if(!selection||!Object.keys(selection).length)return {saved:false,reason:'cancelled'};
        if(new Set(Object.values(selection)).size!==Object.keys(selection).length){
            toastr.info(t('Choose a different existing entry for each field.','STMemoryBooks_SlothLegacyDifferentEntries'),'STMemoryBooks');
            return {saved:false,reason:'duplicate-migration-selection'};
        }
        assertLegacyMigrationOrigin(ref,roleNames);
        const staged=stageNexusLegacyMigration(nexus,
            book=>createWorldInfoEntry(roleNames.nexus,book),selection);
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
            verifyBeforeWrite:assertReviewedCache,
            resetCache:(name,book)=>worldInfoCache.set(name,structuredClone(book)),
        });
        try{await Promise.resolve(reloadEditor(roleNames.nexus));}
        catch(error){console.warn('Sloth Nexus migration editor refresh failed',error);}
        toastr.success(t('Legacy Nexus memories migrated. Original entries remain archived.',
            'STMemoryBooks_SlothLegacySaved'),'STMemoryBooks');
        return {saved:true,sourceUids:staged.plan.sourceUids,result};
    }finally{
        collectorBusy=false;
    }
}

function collectionProfile(settings, profileIndex, stConnectionProfileId) {
    return stConnectionProfileId ? {stConnectionProfileId} :
        settings.profiles?.[profileIndex ?? settings.defaultProfile] || settings.profiles?.[settings.defaultProfile];
}

export async function runNexusCollector({profileIndex, stConnectionProfileId}={}) {
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
        const initial=canStartNexusSetup(ref,settings);
        if(!initial&&(roles.memory.state!=='ready'||roles.nexus.state!=='ready'||
            roles.memory.name===roles.nexus.name)) {
            throw new Error('Assign two existing, linked, different Nexus and Memory lorebooks first.');
        }
        const character=getActiveNexusRoleContext(settings).character;
        const roleNames=initial?proposeNexusBookNames(character):
            {memory:roles.memory.name,nexus:roles.nexus.name};
        const originalBooks=initial?{nexus:{entries:{}},memory:{entries:{}}}:{
            nexus:await loadServerWorld(roleNames.nexus),
            memory:await loadServerWorld(roleNames.memory),
        };
        if(getStmbChatKey()!==getStmbChatKey(ref)) {
            throw new Error('The chat changed while its lorebooks were loading. Start collection from the original chat.');
        }
        const {source,prior}=activeSource(ref,originalBooks.memory,roleNames);
        if(!source.length){
            toastr.info(t('No new visible messages need collection.','STMemoryBooks_SlothNoSource'),'STMemoryBooks');
            return {saved:false,reason:'no-source'};
        }
        const sourceIds=source.map(s=>s.id);
        const fingerprint=fingerprintSlothChat(chat,sourceIds);
        const profile=collectionProfile(settings, profileIndex, stConnectionProfileId);
        if(!profile)throw new Error('Choose an AI profile before starting Sloth collection.');
        const characterContext=initialCharacterContext(character);
        const nexusOptions={detailRecallMode:settings.moduleSettings?.nexusDetailRecallMode==='keyword'?'keyword':'vector'};
        const stageReviewedNexus=edits=>{
            const result=stageNexusEdits(originalBooks.nexus,edits,
                book=>createWorldInfoEntry(roleNames.nexus,book),nexusOptions);
            const changes=result.changes.map((change,index)=>({
                ...change,reason:edits[index].reason,evidence:edits[index].evidence,
            }));
            return {staged:result.staged,changes};
        };
        const auditReviewed=async(scenes,edits,plan)=>{
            if(settings.moduleSettings?.slothPreciseReviewEnabled!==true)return;
            toastr.info(t('Checking for missed or misattributed details...',
                'STMemoryBooks_SlothAuditing'),'STMemoryBooks');
            await auditSlothDraft({messages:source,scenes,edits,plan,profile,settings});
            checkOrigin();
        };
        const checkOrigin=()=>{
            if(!initial)return assertOrigin(ref,roleNames,sourceIds,fingerprint);
            if(getStmbChatKey()!==getStmbChatKey(ref)||!canStartNexusSetup(ref,settings)||
                initialCharacterContext(getActiveNexusRoleContext(settings).character)!==characterContext||
                fingerprintSlothChat(chat,sourceIds)!==fingerprint) {
                throw new Error('The original chat, character or lorebook setup changed. Verify it before retrying.');
            }
        };
        if(initial){
            await listNexusSetupBooks(ref.avatarUrl);
        }
        checkOrigin();
        if (characterContext.length > 16000) {
            const contextLimit = getMaxContextSize();
            const outputLimit = Number(settings.moduleSettings?.maxTokens) || 0;
            const characterTokens = await getTokenCountAsync(characterContext);
            checkOrigin();
            if (!Number.isFinite(contextLimit) || !Number.isFinite(characterTokens) ||
                characterTokens + outputLimit + 2048 >= contextLimit) {
                throw new Error('The character card cannot fit with the selected context and completion settings. No content was truncated.');
            }
        }
        // Legacy data must be migrated explicitly, with an independent backup
        // and review, before the regular AI collector touches Nexus.
        const migration=inspectNexusLegacyMigration(originalBooks.nexus);
        if(migration.required){
            throw new Error('Old Long-Term Memory / Status / Scene Continuity entries found. Use the reviewed Nexus migration command first. Nothing saved.');
        }
        if(!initial&&inspectUnifiedMemorySplit(originalBooks.memory,originalBooks.nexus).required) {
            throw new Error('Memory contains a legacy combined book. Review its migration before collecting.');
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
        checkOrigin();
        if(!initial&&!plan.events.length){
            // An unfinished event cannot become a Scene, but its confirmed
            // current state may still need an explicitly reviewed Nexus delta.
            // Never advance the collected-message ledger or touch Memory here.
            const reviewed=await planApproval(plan);
            if(!reviewed)return {saved:false,reason:'plan-cancelled'};
            checkOrigin();
            let edits=await proposeSlothNexusEdits({
                scenes:[],nexus:originalBooks.nexus,messages:source,
                plan:reviewed,profile,settings,
            });
            assertOrigin(ref,roleNames,sourceIds,fingerprint);
            if(!edits.length){
                toastr.info(t('There are no completed events to collect yet. Nothing was changed.',
                    'STMemoryBooks_SlothNoCompleted'),'STMemoryBooks');
                return {saved:false,reason:'no-complete-events-or-deltas'};
            }
            const nexus=stageReviewedNexus(edits);
            const state={name:roleNames.nexus,original:originalBooks.nexus,staged:nexus.staged};
            const accepted=await draftApproval({
                scenes:[],changes:nexus.changes,plan:reviewed,states:[state],ref,edits,
                applyReviewedDraft:(_scenes,corrected)=>{
                    const verified = validateGroundedNexusEdits(corrected, source);
                    const restaged = stageReviewedNexus(verified);
                    state.staged = restaged.staged;
                    edits = verified;
                    return restaged.changes;
                },
            });
            if(!accepted)return {saved:false,reason:'nexus-only-cancelled'};
            assertOrigin(ref,roleNames,sourceIds,fingerprint);
            await auditReviewed([],edits,reviewed);
            const result=await commitSlothNexusMigration(state,{
                loadFresh:loadServerWorld,
                save:(name,book)=>saveWorldInfo(name,book,true),
                withLock:(name,task)=>withStmbWriteLane({type:'lorebook',name},task),
                verifyOrigin:()=>assertOrigin(ref,roleNames,sourceIds,fingerprint),
                verifyBeforeWrite:assertReviewedCache,
                resetCache:(name,book)=>worldInfoCache.set(name,structuredClone(book)),
                operation:'Nexus current-state update',
            });
            try{await Promise.resolve(reloadEditor(roleNames.nexus));}
            catch(error){console.warn('Sloth Nexus-only editor refresh failed',error);}
            toastr.success(t('Reviewed current-state updates saved to Nexus. Memory and chat messages were not changed.',
                'STMemoryBooks_SlothNexusOnlySaved'),'🦥 STMemoryBooks');
            return {saved:true,scenes:0,nexusEdits:edits.length,result};
        }
        const approved=await planApproval(plan);
        if(!approved)return {saved:false,reason:'plan-cancelled'};
        if(plan.events.length&&!approved.events.length) {
            toastr.info(t('There are no completed events to collect yet. Nothing was changed.',
                'STMemoryBooks_SlothNoCompleted'),'STMemoryBooks');
            return {saved:false,reason:'all-events-deferred'};
        }
        checkOrigin();
        toastr.info(t('Writing approved Scenes and Nexus changes...','STMemoryBooks_SlothComposing'),'STMemoryBooks');
        let scenes=[];
        for(const event of approved.events){
            const composed=await composeSlothScene({event,messages:source,profile,settings,characterContext});
            scenes.push(composed);
            checkOrigin();
        }
        let edits,sceneOnly=false;
        try {
            edits=await proposeSlothNexusEdits({
                scenes,nexus:originalBooks.nexus,messages:source,
                plan:approved,profile,settings,initial,characterContext});
        } catch(error) {
            if(!(error instanceof InvalidSlothNexusProposal)||!scenes.length)throw error;
            checkOrigin();
            const notice='<div class="stmb-sloth-review"><p>'+
                html(t('The AI’s Nexus changes failed validation. You can review the completed Scenes separately.',
                    'STMemoryBooks_SlothInvalidNexus'))+'</p><small>'+html(error.message)+'</small></div>';
            const popup=new Popup(DOMPurify.sanitize(notice),POPUP_TYPE.CONFIRM,'',{
                okButton:t('Review Scenes only','STMemoryBooks_SlothReviewScenesOnly'),
                cancelButton:t('Cancel','STMemoryBooks_Cancel'),
            });
            markStmbPopup(popup);
            if(await popup.show()!==POPUP_RESULT.AFFIRMATIVE)return {saved:false,reason:'invalid-nexus-cancelled'};
            sceneOnly=true;
            edits=[];
        }
        checkOrigin();
        if(initial&&!scenes.length&&!edits.length) {
            toastr.info(t('There are no completed events to collect yet. Nothing was changed.',
                'STMemoryBooks_SlothNoCompleted'),'STMemoryBooks');
            return {saved:false,reason:'no-complete-events-or-deltas'};
        }
        const stageReviewedMemory=reviewed=>stageMemoryScenes(originalBooks.memory,reviewed,
            book=>createWorldInfoEntry(roleNames.memory,book),{
                chatId:String(ref.fileName||''),
                olderMode:settings.moduleSettings?.nexusOlderSceneMode==='keyword'?'keyword':'vector'});
        const nexus=stageReviewedNexus(edits);
        const states=[
            {name:roleNames.memory,original:originalBooks.memory,
                staged:scenes.length?stageReviewedMemory(scenes).staged:structuredClone(originalBooks.memory)},
            {name:roleNames.nexus,original:originalBooks.nexus,staged:nexus.staged},
        ];
        if(initial){
            for(const state of states){
                const role=state.name===roleNames.nexus?'nexus':'memory';
                state.staged.extensions={stmbNexusSetup:{version:1,avatar:ref.avatarUrl,
                    role,pairedBook:roleNames[role==='nexus'?'memory':'nexus']}};
            }
        }
        const accepted=await draftApproval({
            scenes,changes:nexus.changes,plan:approved,states,ref,initial,sceneOnly,edits,
            applyReviewedDraft:(reviewedScenes,reviewedEdits)=>{
                const verified = validateGroundedNexusEdits(reviewedEdits, source);
                const nextNexus = stageReviewedNexus(verified);
                const nextMemory = reviewedScenes.length ? stageReviewedMemory(reviewedScenes).staged : states[0].staged;
                if (initial) {
                    nextNexus.staged.extensions = states[1].staged.extensions;
                    nextMemory.extensions = states[0].staged.extensions;
                }
                states[0].staged = nextMemory;
                states[1].staged = nextNexus.staged;
                scenes = reviewedScenes;
                edits = verified;
                return nextNexus.changes;
            }});
        if(!accepted)return {saved:false,reason:'draft-cancelled'};
        checkOrigin();
        await auditReviewed(scenes,edits,approved);
        if (approved.events.length) await readReviewedChat(ref, sourceIds, fingerprint);
        const commitOptions={
            loadFresh:loadServerWorld,save:(name,book)=>saveWorldInfo(name,book,true),
            verifyBeforeWrite:assertReviewedCache,
            resetCache:(name,original)=>worldInfoCache.set(name,structuredClone(original)),
            verifyOrigin:checkOrigin,
        };
        const outcome=initial?await saveInitialNexusCollection(states,{ref,roleNames,checkOrigin,settings}):
            sceneOnly?await commitSlothNexusMigration(states[0],{
                ...commitOptions,operation:'Memory Scene save',
                withLock:(name,task)=>withStmbWriteLane({type:'lorebook',name},task),
            }):await commitSlothBooks(states,{...commitOptions,withLocks:withBothWriteLanes});
        // Write the chat receipt only after verified World Info persistence.
        let receiptVerified = false;
        try {
            if (approved.events.length) {
                await updateCollectedLedger(prior, approved.events, ref, roleNames, sourceIds, fingerprint);
                receiptVerified = true;
            }
            assertOrigin(ref,roleNames,sourceIds,fingerprint);
        } catch (error) {
            console.warn('Sloth: books verified but the original chat receipt is unavailable.', error);
            toastr.warning(sceneOnly&&!initial
                ?t('Memory was saved. Check the original chat before hiding any messages.',
                    'STMemoryBooks_SlothSceneReceiptUnavailable')
                :t('Both lorebooks were saved. Check the original chat before hiding any messages.',
                    'STMemoryBooks_SlothReceiptUnavailable'), 'STMemoryBooks', { timeOut: 10000 });
            return { saved:true, receiptVerified, reason:'chat-receipt-unavailable', result:outcome };
        }
        for(const state of states){
            try{await Promise.resolve(reloadEditor(state.name));}
            catch(error){console.warn('Sloth: editor refresh failed',error);}
        }
        const msg=sceneOnly&&!initial
            ?t('Approved Scenes saved to Memory.','STMemoryBooks_SlothSceneOnlySaved')
            :t('Collection saved to both lorebooks. No chat messages were hidden.','STMemoryBooks_SlothSaved');
        const hideHint=sceneOnly
            ? t('Keep the original messages visible until you can review the Nexus changes.',
                'STMemoryBooks_SlothSceneOnlyKeepSource')
            :approved.fullyCollected
            ? t('Manual hide may be considered through original message #',
                'STMemoryBooks_SlothHideCandidate')+String(approved.end)
            :t('Unfinished source remains, so no hide boundary can be recommended.',
                'STMemoryBooks_SlothNoHideCandidate');
        toastr.success(msg+' '+hideHint,'STMemoryBooks',{timeOut:9000});
        return {saved:true,scenes:scenes.length,nexusEdits:edits.length,
            deferred:approved.deferred.length,receiptVerified,result:outcome};
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
export async function runNexusSceneMerge({profileIndex, stConnectionProfileId}={}) {
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
        const profile=collectionProfile(settings, profileIndex, stConnectionProfileId);
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
            verifyBeforeWrite:assertReviewedCache,
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
export async function runNexusLegacyContinuityReview({profileIndex, stConnectionProfileId}={}) {
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
        if(plan.reason==='needs-migration'){
            toastr.info(t('Use “Review legacy Nexus migration” first. This tool checks which migrated facts still apply.',
                'STMemoryBooks_SlothLegacySemanticNeedsMigration'),'STMemoryBooks');
            return {saved:false,reason:plan.reason};
        }
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
        const profile=collectionProfile(settings, profileIndex, stConnectionProfileId);
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
            verifyBeforeWrite:assertReviewedCache,
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


function isVisibleSceneMessage(id) {
    const message=chat[id];
    return !!message && !message.is_system && typeof message.mes==='string' && !!message.mes.trim();
}

async function chooseSlothSplitSource(sources) {
    if(sources.length===1)return sources[0];
    const body='<div class="stmb-sloth-review"><label class="stmb-sloth-edit">'+
        html(t('Completed Scene to split','STMemoryBooks_SlothSplitChoose'))+
        '<select class="text_pole" id="stmb-sloth-split-source">'+sources.map((source,index)=>
            '<option value="'+index+'">'+html(source.title)+'</option>').join('')+
        '</select></label></div>';
    const popup=new Popup(DOMPurify.sanitize(body),POPUP_TYPE.CONFIRM,'',{
        wide:true,allowVerticalScrolling:true,
        okButton:t('Analyze selected Scene','STMemoryBooks_SlothSplitChooseApprove'),
        cancelButton:t('Cancel','STMemoryBooks_Cancel'),
    });
    markStmbPopup(popup);
    const showing=popup.show();
    const choice=popup.dlg.querySelector('#stmb-sloth-split-source');
    let selected=0;
    choice.addEventListener('change',()=>{selected=Number(choice.value);});
    return await showing===POPUP_RESULT.AFFIRMATIVE?sources[selected]:null;
}

/** Explicit split, limited to verified visible messages and completion order. */
export async function runNexusSceneSplit({profileIndex, stConnectionProfileId}={}) {
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
        const {sources,reason}=inspectNexusSceneSplitAvailability(original,chatIds,isVisibleSceneMessage);
        if(!sources.length){
            const messages={
                'empty-memory': ['Memory has no saved Scenes to split.','STMemoryBooks_SlothSplitEmptyMemory'],
                'unavailable-messages': ['The original messages for the saved Scene are hidden or missing. Open the original chat and make those messages visible to split it.', 'STMemoryBooks_SlothSplitUnavailableMessages'],
                'other-chat': ['No saved Scene in this book is linked to the open chat. Open the Scene’s original chat to split it.', 'STMemoryBooks_SlothSplitOtherChat'],
                'unverified-source': ['The original range or completion order of the saved Scenes could not be verified.', 'STMemoryBooks_SlothSplitNoSource'],
            };
            toastr.info(t(...messages[reason]),'STMemoryBooks');
            return {saved:false,reason:'no-eligible-source'};
        }
        const selected=await chooseSlothSplitSource(sources);
        if(!selected)return {saved:false,reason:'source-cancelled'};
        assertLegacyMigrationOrigin(ref,names);
        const sourcePlan=inspectNexusSceneSplit(original,chatIds,selected.uid);
        const messages=sourcePlan.sourceIds.map(id=>{
            const message=chat[id];
            if(!isVisibleSceneMessage(id)){
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
        const profile=collectionProfile(settings, profileIndex, stConnectionProfileId);
        if(!profile)throw new Error('Choose an AI profile before reviewing a Scene split.');
        toastr.info(t('Checking the selected Scene for independent completed events...',
            'STMemoryBooks_SlothSplitAnalyzing'),'🦥 STMemoryBooks');
        const candidate=await suggestSlothSceneSplit({
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
            '</h3><p>'+html(t('Check the independent causes, endings and exact message ranges. Replacement Scenes keep their original place in completion order and receive new numbers. Missing or repeated messages block the change.',
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
        if(settings.moduleSettings?.slothPreciseReviewEnabled===true){
            await auditSlothDraft({messages,scenes:drafts,edits:[],profile,settings});
            verifyOrigin();
        }
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
            verifyBeforeWrite:assertReviewedCache,
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
