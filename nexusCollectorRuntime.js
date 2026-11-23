// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
//
// Analyze the chat, confirm the collection plan, then stage and save its results.

import { chat, getMaxContextSize, getRequestHeaders, menu_type, saveSettings } from '../../../../script.js';
import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../popup.js';
import { extension_settings } from '../../../extensions.js';
import { saveWorldInfo, createWorldInfoEntry, reloadEditor, worldInfoCache,
    charUpdateAddAuxWorld, updateWorldInfoList } from '../../../world-info.js';
import { getTokenCountAsync } from '../../../tokenizers.js';
import { DOMPurify } from '../../../../lib.js';
import { escapeHtml } from '../../../utils.js';
import { translate } from '../../../i18n.js';
import { getCurrentStmbChatRef, getStmbChatKey, patchStmbMetadataForChatRef, withStmbWriteLane } from './stmbJobs.js';
import { getSceneMarkers } from './sceneManager.js';
import { getActiveNexusRoleContext, getNexusRoleResolutionForChatRef } from './nexusCharacterRolesRuntime.js';
import { parseReviewedSegments, fingerprintSlothChat, stageNexusEdits, stageMemoryScenes } from './nexusCollectionPolicy.js';
import { analyzeSlothEvents, composeSlothScene, proposeSlothNexusEdits, InvalidSlothNexusProposal,
    auditSlothDraft, suggestSlothSceneMerges, composeSlothMergedScene, suggestSlothSceneSplit } from './nexusCollectionAI.js';
import { commitSlothBooks } from './nexusCollectionCommit.js';
import { commitSlothNexusMigration } from './nexusLegacyMigrationCommit.js';
import { stageNexusSceneMerge } from './nexusSceneMerge.js';
import { inspectNexusSceneSplit, inspectNexusSceneSplitAvailability, validateNexusSceneSplitProposal,
    stageNexusSceneSplit } from './nexusSceneSplit.js';
import { markStmbPopup } from './utils.js';
import { getLinkedCharacterWorlds, getCharacterNexusRoles, setCharacterNexusRole } from './nexusCharacterRoles.js';
import { canInitializeNexusBooks, getNexusCompanionPlan, initialNexusBookNames,
    commitInitialNexusBooks } from './nexusInitialSetup.js';
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
    const {character,linkedBooks}=getActiveNexusRoleContext(settings);
    return {character,linkedBooks,ref,key:getStmbChatKey(ref),settings};
}

export function getSlothCompanion(ref, settings) {
    if (menu_type === 'create') return null;
    const plan = getNexusCompanionPlan(setupContext(ref, settings));
    return plan && getNexusRoleResolutionForChatRef(plan.existingRole, ref, settings).state === 'ready' ? plan : null;
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
    const {linkedBooks}=getActiveNexusRoleContext();
    const pending=books.filter(book=>book.extensions?.stmbNexusSetup?.avatar===avatar &&
        !ownNames.includes(book.file_id) && !linkedBooks.includes(book.file_id));
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
            const context = {...setupContext(ref,settings),character,settings:stored.extensions,
                linkedBooks:getLinkedCharacterWorlds({character,worldInfo:stored.world})};
            const eligible = companion ? stringify(getNexusCompanionPlan(context))===stringify(companion) :
                canInitializeNexusBooks(context);
            if(!eligible) {
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

export async function createSlothCompanion() {
    if (collectorBusy) throw new Error('A Sloth operation is already in progress.');
    collectorBusy = true;
    try {
        const ref = structuredClone(getCurrentStmbChatRef());
        const settings = extension_settings.STMemoryBooks;
        const companion = getSlothCompanion(ref, settings);
        if (!companion) return {saved:false};
        const {character} = setupContext(ref, settings);
        const {existing, existingRole, missingRole} = companion;
        const name = proposeNexusBookNames(character)[missingRole];
        const checkOrigin = () => {
            if (getStmbChatKey() !== getStmbChatKey(ref) ||
                stringify(getSlothCompanion(ref, settings)) !== stringify(companion)) {
                throw new Error(t('Lorebook roles changed. Check the selected books and try again.',
                    'STMemoryBooks_SlothInvalidChoice'));
            }
        };
        const staged = {entries:{},extensions:{stmbNexusSetup:{version:1,avatar:ref.avatarUrl,
            role:missingRole,pairedBook:existing}}};
        const roleNames = {[existingRole]:existing,[missingRole]:name};
        await saveInitialNexusCollection([{name,staged}],{ref,roleNames,checkOrigin,settings,companion});
        toastr.success(t('The missing lorebook was created and linked.', 'STMemoryBooks_SlothCompanionSaved'), 'STMemoryBooks');
        return {saved:true};
    } finally {
        collectorBusy = false;
    }
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

function activeSource(ref, memoryBook, roleNames) {
    const markers=getSceneMarkers()||{};
    const currentKey=getStmbChatKey(ref);
    const receipt=markers.slothCollection;
    const prior=receipt?.chatKey===currentKey&&receipt.books?.nexus===roleNames.nexus&&receipt.books?.memory===roleNames.memory
        ? receipt : {chatKey:currentKey,savedRanges:[]};
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
        const ranges=Array.isArray(entry.STMB_sourceRanges)?entry.STMB_sourceRanges:[];
        for(const pair of ranges){
            if(!Array.isArray(pair)||pair.length!==2)continue;
            const [start,end]=pair;
            if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||
                start<0||end<start||end>=chat.length)continue;
            for(let id=start;id<=end;id++)already.add(id);
        }
    }
    const source=chat.map((entry,id)=>({entry,id}))
        .filter(({entry,id})=>!already.has(id) && entry && !entry.is_system && typeof entry.mes==='string' && entry.mes.trim())
        .map(({entry,id})=>({id,name:String(entry.name||''),mes:String(entry.mes||''),
            is_user:!!entry.is_user,send_date:entry.send_date||null}));
    return {source,prior};
}

function readableSegments(segments) {
    return (segments||[]).map(pair=>pair[0]===pair[1]
        ? String(pair[0]):pair[0]+'-'+pair[1]).join(', ');
}

export async function runNexusSidePromptFollowup({ profileIndex, stConnectionProfileId } = {}) {
    if (collectorBusy) throw new Error('A Sloth operation is already in progress.');
    collectorBusy = true;
    try {
        const settings = extension_settings.STMemoryBooks;
        const ref = structuredClone(getCurrentStmbChatRef());
        const roles = Object.fromEntries(['nexus', 'memory'].map(role =>
            [role, getNexusRoleResolutionForChatRef(role, ref, settings).name]));
        assertSlothBookRoles(ref, roles);
        const isAllowedBook = name => name !== roles.memory &&
            (name === roles.nexus || !isManagedNexusWorld(settings, name));
        const options = await listReviewedSidePromptOptions(roles.nexus, isAllowedBook);
        assertSlothBookRoles(ref, roles);
        if (!options.length) {
            toastr.info(t('No after-memory Side Prompt has an available destination in this chat.',
                'STMemoryBooks_SlothSidePromptEmpty'), 'STMemoryBooks');
            return { saved: false };
        }
        const memory = await loadServerWorld(roles.memory);
        assertSlothBookRoles(ref, roles);
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
            okButton: t('Update Side Prompt', 'STMemoryBooks_SlothSidePromptGenerate'),
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
        assertSlothBookRoles(ref, roles);
        if (!scene || !option || !isAllowedBook(option.lorebookName)) throw new Error('The reviewed selection changed.');
        const fingerprint = scene.fingerprint;
        const verifyOrigin = () => {
            assertOrigin(ref, roles, scene.ids, fingerprint);
            if (!isAllowedBook(option.lorebookName)) throw new Error('The Side Prompt destination is no longer available for this chat.');
        };
        const compiled = compileScene(createSceneRequest(scene.ids[0], scene.ids.at(-1)), { messageIndices: scene.ids });
        const profile = collectionProfile(settings, profileIndex, stConnectionProfileId);
        verifyOrigin();
        const original = await loadServerWorld(option.lorebookName);
        verifyOrigin();
        const draft = await proposeReviewedSidePrompt(option, original, compiled, profile);
        verifyOrigin();
        const staged = draft.stage(draft.text);
        await readReviewedChat(ref, scene.ids, fingerprint);
        const storedMemory = await loadServerWorld(roles.memory);
        if (!Object.values(storedMemory.entries).some(entry => entry.uid === scene.entry.uid && stringify(entry) === stringify(scene.entry))) {
            throw new Error('The source Scene changed while the Side Prompt was being written.');
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

async function planApproval(plan,initial) {
    const lastScene=plan.events.at(-1)?.end;
    const pending=plan.deferred.reduce((count,item)=>count+item.messageIds.length,0);
    const eventCount=t('{{count}} events','STMemoryBooks_SlothPlanEvents').replace('{{count}}',String(plan.events.length));
    const rows=plan.events.map(item=>'<li><strong>'+html(item.title)+'</strong><small> #'+
        html(readableSegments(item.segments))+'</small></li>').join('');
    const body='<div class="stmb-sloth-review"><h3>'+
        html(t('Collection plan','STMemoryBooks_SlothReviewPlan'))+'</h3><dl class="stmb-sloth-plan-summary">'+
        '<dt>Memory</dt><dd>'+html(eventCount)+
        (lastScene===undefined?'':' · '+html(t('through message','STMemoryBooks_SlothPlanThrough'))+' #'+html(lastScene))+'</dd>'+
        '<dt>Nexus</dt><dd>'+html(t('Review through message','STMemoryBooks_SlothPlanNexusThrough'))+' #'+html(plan.end)+'</dd>'+
        (pending?'<dt>'+html(t('Held for later','STMemoryBooks_SlothPlanPending'))+'</dt><dd>'+html(pending)+'</dd>':'')+
        '</dl>'+(rows?'<ol class="stmb-sloth-plan-list">'+rows+'</ol>':'')+
        (initial?'<p>'+html(t('New Nexus and Memory lorebooks will be connected to this character.',
            'STMemoryBooks_SlothFirstBooksReview'))+'</p>':'')+'</div>';
    const popup=new Popup(DOMPurify.sanitize(body),POPUP_TYPE.CONFIRM,'',{
        wide:true,allowVerticalScrolling:true,
        okButton:plan.events.length?t('Collect memories','STMemoryBooks_SlothApprovePlan'):
            t('Update Nexus','STMemoryBooks_SlothNexusOnlyReview'),
        cancelButton:t('Cancel','STMemoryBooks_Cancel'),
    });
    markStmbPopup(popup);
    return await popup.show()===POPUP_RESULT.AFFIRMATIVE;
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

function assertSlothBookRoles(ref, roles) {
    if (getStmbChatKey()!==getStmbChatKey(ref)) {
        throw new Error('Return to the original chat before updating the lorebook.');
    }
    for (const role of ['nexus','memory']) {
        const now=getNexusRoleResolutionForChatRef(role,ref,extension_settings.STMemoryBooks);
        if (now.state!=='ready'||now.name!==roles[role]) {
            throw new Error('Nexus / Memory role assignment changed. No changes saved.');
        }
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
        toastr.info(t('Analyzing causal events in the unsaved chat...','STMemoryBooks_SlothAnalyzing'),'STMemoryBooks');
        const plan=await analyzeSlothEvents({messages:source,profile,settings,characterContext});
        checkOrigin();
        if(!await planApproval(plan,initial))return {saved:false,reason:'plan-cancelled'};
        checkOrigin();

        toastr.info(t('Writing approved Scenes and Nexus changes...','STMemoryBooks_SlothComposing'),'STMemoryBooks');
        const scenes=[];
        for(const event of plan.events){
            scenes.push(await composeSlothScene({event,messages:source,profile,settings,characterContext}));
            checkOrigin();
        }
        let edits;
        try {
            edits=await proposeSlothNexusEdits({scenes,nexus:originalBooks.nexus,messages:source,
                plan,profile,settings,initial,characterContext});
        } catch(error) {
            if(!(error instanceof InvalidSlothNexusProposal))throw error;
            throw new Error(t('The Nexus changes could not be verified. No memories were saved.',
                'STMemoryBooks_SlothCollectionInvalidNexus'),{cause:error});
        }
        checkOrigin();
        if(!scenes.length&&!edits.length){
            toastr.info(t('There are no completed events or Nexus changes to save.',
                'STMemoryBooks_SlothNoCompleted'),'STMemoryBooks');
            return {saved:false,reason:'no-complete-events-or-deltas'};
        }

        const states=[];
        if(scenes.length||initial) {
            const staged=scenes.length?stageMemoryScenes(originalBooks.memory,scenes,
                book=>createWorldInfoEntry(roleNames.memory,book),{
                    chatId:String(ref.fileName||''),
                    olderMode:settings.moduleSettings?.nexusOlderSceneMode==='keyword'?'keyword':'vector',
                }).staged:structuredClone(originalBooks.memory);
            states.push({name:roleNames.memory,original:originalBooks.memory,staged});
        }
        if(edits.length||initial) {
            const staged=stageNexusEdits(originalBooks.nexus,edits,
                book=>createWorldInfoEntry(roleNames.nexus,book),nexusOptions).staged;
            states.push({name:roleNames.nexus,original:originalBooks.nexus,staged});
        }
        if(initial){
            for(const state of states){
                const other=state.name===roleNames.nexus?'memory':'nexus';
                state.staged.extensions={stmbNexusSetup:{version:1,avatar:ref.avatarUrl,
                    role:other==='memory'?'nexus':'memory',pairedBook:roleNames[other]}};
            }
        }
        await readReviewedChat(ref,sourceIds,fingerprint);
        const commitOptions={
            loadFresh:loadServerWorld,save:(name,book)=>saveWorldInfo(name,book,true),
            verifyBeforeWrite:assertReviewedCache,
            resetCache:(name,original)=>worldInfoCache.set(name,structuredClone(original)),
            verifyOrigin:checkOrigin,
        };
        const outcome=initial?await saveInitialNexusCollection(states,{ref,roleNames,checkOrigin,settings}):
            states.length===1?await commitSlothNexusMigration(states[0],{
                ...commitOptions,operation:scenes.length?'Memory Scene save':'Nexus current-state update',
                withLock:(name,task)=>withStmbWriteLane({type:'lorebook',name},task),
            }):await commitSlothBooks(states,{...commitOptions,withLocks:withBothWriteLanes});

        let receiptVerified=false;
        if(scenes.length){
            try {
                await updateCollectedLedger(prior,plan.events,ref,roleNames,sourceIds,fingerprint);
                receiptVerified=true;
            } catch (error) {
                console.warn('Memory Books saved, but the chat receipt could not be verified.',error);
            }
        }
        for(const {name} of states){
            try{await Promise.resolve(reloadEditor(name));}
            catch(error){console.warn('Memory Books editor refresh failed.',error);}
        }
        const message=scenes.length&&edits.length
            ?t('Memory saved and Nexus updated.','STMemoryBooks_SlothSaved')
            :scenes.length?t('Completed events saved to Memory.','STMemoryBooks_SlothSceneOnlySaved')
                :t('Nexus updated.','STMemoryBooks_SlothNexusOnlySaved');
        toastr.success(message,'STMemoryBooks');
        return {saved:true,scenes:scenes.length,nexusEdits:edits.length,receiptVerified,result:outcome};
    }finally{
        collectorBusy=false;
    }
}

function isVisibleSceneMessage(id) {
    const message=chat[id];
    return !!message&&!message.is_system&&typeof message.mes==='string'&&!!message.mes.trim();
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
        assertSlothBookRoles(ref,names);
        const profile=collectionProfile(settings, profileIndex, stConnectionProfileId);
        if(!profile)throw new Error('Choose an AI profile before reviewing Scene merges.');
        toastr.info(t('Looking for previously split causal Scenes...',
            'STMemoryBooks_SlothMergeScanning'),'🦥 STMemoryBooks');
        const chatIds=[String(ref.fileName||''),String(ref.chatId||'')].filter(Boolean);
        const candidates=await suggestSlothSceneMerges({
            memory:original,chatIds,profile,settings,
        });
        assertSlothBookRoles(ref,names);
        if(!candidates.length){
            toastr.info(t('No sufficiently evidenced Scene merge pairs were proposed. No books changed.',
                'STMemoryBooks_SlothMergeNone'),'🦥 STMemoryBooks');
            return {saved:false,reason:'no-candidates'};
        }
        const candidate=await chooseSlothMergeCandidate(candidates);
        if(!candidate)return {saved:false,reason:'pair-cancelled'};
        assertSlothBookRoles(ref,names);
        const drafted=await composeSlothMergedScene({candidate,profile,settings});
        assertSlothBookRoles(ref,names);
        const edited=await reviewSlothMergeDraft(candidate,drafted);
        if(!edited)return {saved:false,reason:'draft-cancelled'};
        assertSlothBookRoles(ref,names);
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
        assertSlothBookRoles(ref,names);
        const result=await commitSlothNexusMigration({
            name:names.memory,original,staged:staged.proposedMemory,
        },{
            loadFresh:loadServerWorld,
            save:(name,book)=>saveWorldInfo(name,book,true),
            withLock:(name,task)=>withStmbWriteLane({type:'lorebook',name},task),
            verifyOrigin:()=>assertSlothBookRoles(ref,names),
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
        assertSlothBookRoles(ref,names);
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
        assertSlothBookRoles(ref,names);
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
            assertSlothBookRoles(ref,names);
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
