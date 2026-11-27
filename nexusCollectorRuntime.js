// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
//
// Classify and write memories in one request, then validate, stage and save.

import { getMemoryBooksMode } from './memoryBooksMode.js';
import { sameSlothDraftBinding, canReplaySlothPartial } from './slothSingleRecovery.js';
import { stableHashString } from './clipReviewPolicy.js';
import { chat, eventSource, getRequestHeaders, menu_type, saveSettings, main_api } from '../../../../script.js';
import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../popup.js';
import { hideChatMessageRange } from '../../../chats.js';
import { extension_settings } from '../../../extensions.js';
import { saveWorldInfo, createWorldInfoEntry, reloadEditor, worldInfoCache,
    charUpdateAddAuxWorld, updateWorldInfoList } from '../../../world-info.js';
import { getTokenCountAsync, getTokenizerModel } from '../../../tokenizers.js';
import { DOMPurify, sha256, showdown } from '../../../../lib.js';
import { createSlothRecoveryStore, selectSlothRecoveryRecord } from './slothRecoveryStore.js';
import { escapeHtml } from '../../../utils.js';
import { translate } from '../../../i18n.js';
import { getCurrentStmbChatRef, getStmbChatKey, patchStmbMetadataForChatRef, setSlothCollectionProgress, withStmbWriteLane } from './stmbJobs.js';
import { getSceneMarkers } from './sceneManager.js';
import { getActiveNexusRoleContext, getNexusRoleResolutionForChatRef } from './nexusCharacterRolesRuntime.js';
import { parseReviewedSegments, fingerprintSlothChat, fingerprintSlothReviewedRanges, stageNexusEdits, stageMemoryScenes,
    listSlothUntrackedScenes, findSlothLegacyEvidence,
    getSlothHideRanges, normalizeSlothVisibleTail, slothSourceRanges, stageNexusRecallSettings, getNexusRecallModes, slothDisplayAnchorTitle } from './nexusCollectionPolicy.js';
import { composeSingleSlothCollection, composeSlothScene,
    suggestSlothSceneMerges, composeSlothMergedScene, suggestSlothSceneSplit, compressSlothScene, suggestSlothNexusHealthReview } from './nexusCollectionAI.js';
import { getCompressibleScene, SLOTH_COMPRESSION_AMOUNTS } from './nexusSceneCompression.js';
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
import { proposeReviewedSidePrompt } from './sidePrompts.js';
import { getRunnableSlothSidePresets, pickSlothSidePresets, normalizeSlothSideKeywords,
    canContinueSlothSideEntry, getSlothSideDestination, isSlothSideLinked, slothSideStoryKey,
    slothSideBookName, slothSideBookOwner, SLOTH_DIARY_ID, SLOTH_NPC_DIRECTORY_ID, SLOTH_QUOTES_ID } from './slothSidePrompts.js';
import { isCompletedSceneEntry } from './nexusSceneRotation.js';
import { expandSplitRanges, sourceRangesForSplit } from './nexusSceneSplitArchives.js';
import { automaticCollectionDue, getSlothAutomaticSettings, createAutomaticTokenCounter,
    createAutomaticTokenUpperBound, getAutomaticCheckpointThrough } from './slothAutomaticCollection.js';
import { splitSlothCollectionSource } from './nexusCollectionBudget.js';
import { inspectSlothNexusHealth, SLOTH_HEALTH_ROLES } from './slothNexusHealth.js';
import { createSlothHealthTranslationSession, createSlothHealthMarkdownRenderer } from './slothHealthReader.js';
import { buildSlothHealthCatalog, stageSlothHealthReviewBatch } from './slothNexusHealthReview.js';
import { showSlothHealthReviewFindings, healthReviewLabel } from './slothNexusHealthReviewDialog.js';
import { createSlothCollectionRun, addSlothRequestMetric, recordSlothCollectionRun } from './slothCollectionStats.js';
import { normalizeSlothSideRename, sideRenameMatches, planSlothSideSettingsRename,
    slothSideRenameBooks, stageSlothSideIdentityRename, retargetSlothLorebookRoles } from './slothSideIdentity.js';

const t=(source,key)=>translate(source,key);
const html=value=>escapeHtml(String(value ?? ''));
const stringify=value=>JSON.stringify(value);
let collectorBusy=false;
// Keep durable recovery in a separate per-chat user file. Session-only
// responses must not be evicted merely because the user opens another chat.
const slothPaidDrafts=new Map();
const slothRecoverySnapshots=new Map();
const slothRecoveryReadErrors=new Set();
const digestSlothSnapshot=value=>{const json=typeof value==='string'?value:stringify(value);return [json.length,stableHashString(json)];};
const slothRecoveryStore=createSlothRecoveryStore({request:(url,options)=>fetch(url,options),headers:getRequestHeaders,hash:sha256});
const recoveryLane=(key,task)=>withStmbWriteLane({type:'sloth-recovery',chatKey:key},async()=>{
    // Same-origin tabs can also serialize their independent file writes when
    // Web Locks is available. Remote HTTP clients may not support Web Locks.
    const locks=globalThis.navigator?.locks;
    return locks?.request?locks.request('stmb-sloth-recovery-'+sha256(key),task):task();
});

function cacheSlothRecovery(key,snapshot) {
    slothRecoverySnapshots.delete(key);
    slothRecoverySnapshots.set(key,snapshot);
    // Bound cached durable copies, never evict an unsaved paid response.
    while(slothRecoverySnapshots.size>16)slothRecoverySnapshots.delete(slothRecoverySnapshots.keys().next().value);
    slothRecoveryReadErrors.delete(key);
}
function getPaidSlothDraft(ref) {
    const key=getStmbChatKey(ref);
    const legacy=getStmbChatKey()===key?getSceneMarkers()?.slothCollectionDraft:null;
    return selectSlothRecoveryRecord(key,slothRecoverySnapshots.get(key),legacy,slothPaidDrafts.get(key));
}
export function isSlothRecoveryUnavailable(ref) {
    return slothRecoveryReadErrors.has(getStmbChatKey(ref));
}
export async function refreshSlothPaidDraft(ref=getCurrentStmbChatRef()) {
    if(ref?.type!=='character'||!ref.avatarUrl||!ref.fileName)return null;
    const key=getStmbChatKey(ref);
    return recoveryLane(key,async()=>{
        try {
            const snapshot=await slothRecoveryStore.read(key);
            cacheSlothRecovery(key,snapshot);
            const fallback=slothPaidDrafts.get(key);
            // A failed response to an upload can still mean that the upload
            // persisted. Resolve that exact retry without a second write.
            if(fallback&&stringify(snapshot.record)===stringify(fallback.record))
                slothPaidDrafts.delete(key);
            return getPaidSlothDraft(ref);
        }catch(error){
            slothRecoveryReadErrors.add(key);
            throw Object.assign(new Error(t('Could not verify the recovery file. Collection stopped before another AI request.',
                'STMemoryBooks_SlothRecoveryReadFailed')),{cause:error});
        }
    });
}
async function rememberPaidSlothDraft(ref,binding,raw,details={},baseline) {
    const key=binding.chatKey;
    if(key!==getStmbChatKey(ref))throw new Error('Invalid original Sloth recovery identity.');
    const record={...details,version:1,binding,raw:String(raw??''),receivedAt:Date.now()};
    return recoveryLane(key,async()=>{
        const fallback=slothPaidDrafts.get(key);
        const snapshot=slothRecoverySnapshots.get(key);
        const expectedRevision=baseline!==undefined?baseline:fallback?fallback.expectedRevision:snapshot?.revision;
        slothPaidDrafts.set(key,{record,expectedRevision});
        try {
            const saved=await slothRecoveryStore.replace(key,record,expectedRevision);
            cacheSlothRecovery(key,saved);
            slothPaidDrafts.delete(key);
        }catch(error){
            console.warn('🦥 STMemoryBooks', 'Paid Sloth response is retained only in this browser session.',error);
            toastr.warning(t('Could not save the recovery file. The received response is retained in this tab only; copy it before refreshing.',
                'STMemoryBooks_SlothRecoveryWriteFailed'),'STMemoryBooks',{preventDuplicates:true,timeOut:0,extendedTimeOut:0});
        }
        return record;
    });
}
async function forgetPaidSlothDraft(ref,record) {
    if(!record)return;
    const key=record.binding.chatKey;
    if(key!==getStmbChatKey(ref))return;
    await recoveryLane(key,async()=>{
        const fallback=slothPaidDrafts.get(key);
        const snapshot=slothRecoverySnapshots.get(key);
        if(stringify(getPaidSlothDraft(ref))!==stringify(record))return;
        try {
            // Keep a tiny cleared marker so old metadata drafts cannot revive
            // after reload. No legacy chat header is written just for cleanup.
            const saved=await slothRecoveryStore.replace(key,null,fallback?fallback.expectedRevision:snapshot?.revision);
            cacheSlothRecovery(key,saved);
            slothPaidDrafts.delete(key);
        }catch(error){
            console.warn('🦥 STMemoryBooks', 'Collection saved; independent recovery record could not be cleared.',error);
            toastr.warning(t('Collection was saved, but the recovery file could not be cleared. Review the retained response before another request.',
                'STMemoryBooks_SlothRecoveryClearFailed'),'STMemoryBooks');
        }
    });
}
function requireDurableSlothDraft(ref,record) {
    if(record&&slothRecoverySnapshots.get(getStmbChatKey(ref))?.revision!==
        slothRecoveryStore.revisionFor(getStmbChatKey(ref),record))
        throw new Error(t('The response is retained in this tab, but its recovery file is not verified. Retry without another AI request before saving memories.',
            'STMemoryBooks_SlothRecoveryNotDurable'));
}
async function verifyDurableSlothDraft(ref,record) {
    if(!record)return;
    const key=getStmbChatKey(ref);
    await recoveryLane(key,async()=>{
        const current=await slothRecoveryStore.read(key);
        cacheSlothRecovery(key,current);
        if(current.revision!==slothRecoveryStore.revisionFor(key,record)){
            // Another client may have cleared/replaced the record. Keep this
            // paid response available in the tab without adopting its revision.
            slothPaidDrafts.set(key,{record,expectedRevision:slothRecoveryStore.revisionFor(key,record)});
            requireDurableSlothDraft(ref,record);
        }
    });
}
async function choosePaidSlothDraft(record,binding,signal,{noSource=false,partialReplay=false}={}) {
    const reusable=partialReplay||(!record.partial&&sameSlothDraftBinding(record,binding));
    const title=t('Previous collection response','STMemoryBooks_SlothPaidDraftTitle');
    const help=noSource?t('No uncollected source remains. You can copy this response before dismissing it.',
        'STMemoryBooks_SlothPaidDraftNoSource'):partialReplay?t('Already saved items are protected. Correct only the remaining items below, then reprocess without a new AI request.',
        'STMemoryBooks_SlothPaidDraftPartialHelp'):reusable?t('Reuse or correct this response without another AI request. A new request is optional.',
        'STMemoryBooks_SlothPaidDraftHelp'):t('The chat or lorebooks changed. This old response is available to copy, but cannot be automatically applied to the changed source.',
        'STMemoryBooks_SlothPaidDraftStale');
    const popup=markStmbPopup(new Popup(DOMPurify.sanitize('<div class="stmb-sloth-review"><h3>'+html(title)+
        '</h3><p>'+html(help)+'</p><textarea class="text_pole" data-sloth-paid-draft style="width:100%;min-height:220px;white-space:pre-wrap">'+
        html(record.raw)+'</textarea>'+(typeof record.originalRaw==='string'?'<details><summary>'+
            html(t('Original AI response (read only)','STMemoryBooks_SlothPaidDraftOriginal'))+
            '</summary><textarea readonly class="text_pole" style="width:100%;min-height:180px">'+
            html(record.originalRaw)+'</textarea></details>':'')+'</div>'),reusable?POPUP_TYPE.CONFIRM:POPUP_TYPE.TEXT,'',{
        wide:true,large:true,allowVerticalScrolling:true,
        okButton:reusable?t('Reprocess saved response (no AI call)','STMemoryBooks_SlothPaidDraftApply'):false,
        cancelButton:t('Cancel','STMemoryBooks_Cancel'),
        customButtons:[{text:noSource?t('Dismiss saved response','STMemoryBooks_SlothPaidDraftDismiss'):
            t('New AI request (uses tokens)','STMemoryBooks_SlothPaidDraftNew'),
            result:POPUP_RESULT.CUSTOM1,classes:['menu_button']}],
    }));
    const field=popup.dlg.querySelector('[data-sloth-paid-draft]');
    if (!reusable) field.readOnly=true;
    const answer=await showCollectionPopup(popup,signal);
    if (reusable&&answer===POPUP_RESULT.AFFIRMATIVE) return {raw:field.value};
    if (answer===POPUP_RESULT.CUSTOM1) return noSource?{dismiss:true}:{raw:null};
    return null;
}
export function hasSlothPaidDraft(ref) { return Boolean(getPaidSlothDraft(ref)); }
export function isSlothOperationBusy() { return collectorBusy; }
const automaticByteBound = createAutomaticTokenUpperBound();
let automaticReading = null;
let automaticReadingRevision = 0;

export function invalidateSlothAutomaticProgress() {
    automaticReading = null;
    automaticReadingRevision++;
}

export function getSlothAutomaticProgress(ref, books, mode) {
    const reading = automaticReading;
    const previous = getSceneMarkers()?.slothAutomatic;
    const chatKey = getStmbChatKey(ref);
    const checkpoint = previous?.chatKey === chatKey && previous?.through < chat.length ? previous : null;
    return reading && reading.chatKey === chatKey && reading.nexus === books.nexus &&
        reading.memory === books.memory && reading.mode === mode && reading.length === chat.length &&
        reading.through === getAutomaticCheckpointThrough(checkpoint,books) ? reading : null;
}

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
    if (menu_type === 'create' || getMemoryBooksMode(settings, ref, getStmbChatKey(ref)) !== 'sloth') return false;
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
    await updateWorldInfoList().catch(error=>console.warn('🦥 STMemoryBooks', 'New lorebooks saved; editor list refresh failed.',error));
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

function assertOrigin(ref, roles, sourceIds, sourceFingerprint, fingerprintOptions) {
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
    if(fingerprintSlothChat(chat,sourceIds,fingerprintOptions)!==sourceFingerprint) {
        throw new Error('Original chat messages changed while AI was running. No save performed.');
    }
}

const legacyPairKey = roles => JSON.stringify([roles.nexus, roles.memory]);

function getSlothLegacyCoverage(markers, chatKey, roles) {
    const receipt = markers?.slothLegacyCoverage?.[legacyPairKey(roles)];
    return receipt?.chatKey === chatKey ? receipt : null;
}

function assertSlothLegacyCoverage(receipt, messages = chat) {
    if (!receipt) return;
    try {
        if (receipt.version === 1 && receipt.ranges.length &&
            fingerprintSlothReviewedRanges(messages, receipt.ranges) === receipt.fingerprint) return;
    } catch { /* The original range is no longer available. */ }
    throw new Error(t('Previously reviewed messages changed. Review or clear their ranges in Memory Workshop.',
        'STMemoryBooks_SlothLegacyCoverageChanged'));
}

function activeSource(ref, memoryBook, roleNames, afterId = -1) {
    const markers=getSceneMarkers()||{};
    const currentKey=getStmbChatKey(ref);
    const receipt=markers.slothCollection;
    const prior=receipt?.chatKey===currentKey&&receipt.books?.nexus===roleNames.nexus&&receipt.books?.memory===roleNames.memory
        ? receipt : {chatKey:currentKey,savedRanges:[]};
    const ranges=[];
    const addRange=pair=>{
        if(!Array.isArray(pair)||pair.length!==2)return;
        const [start,end]=pair;
        if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||
            start<0||end<start||end>=chat.length)return;
        ranges.push([start,end]);
    };
    for(const pair of prior.savedRanges||[])addRange(pair);
    const reviewed=getSlothLegacyCoverage(markers,currentKey,roleNames);
    assertSlothLegacyCoverage(reviewed);
    for(const pair of reviewed?.ranges||[])addRange(pair);
    // Existing entries for THIS exact chat are also authoritative receipts.
    const sourceChatIds=new Set([String(ref.fileName||''),String(ref.chatId||'')].filter(Boolean));
    for(const entry of Object.values(memoryBook?.entries||{})){
        if(!sourceChatIds.has(String(entry?.STMB_chatId||'')))continue;
        // Explicit same-chat legacy Memory receipts are safe to inherit; a
        // manually written Scene with no source receipt still needs review.
        const legacy=entry.stmemorybooks===true&&isCompletedSceneEntry(entry)&&
            Number.isSafeInteger(entry.STMB_start)&&Number.isSafeInteger(entry.STMB_end)?
            [[entry.STMB_start,entry.STMB_end]]:[];
        const coverage=Object.hasOwn(entry,'STMB_collectedRanges')?entry.STMB_collectedRanges:
            entry.STMB_sourceRanges??legacy;
        for(const pair of Array.isArray(coverage)?coverage:[])addRange(pair);
    }
    ranges.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    const merged=[];
    for(const pair of ranges){
        const last=merged.at(-1);
        if(last&&pair[0]<=last[1]+1)last[1]=Math.max(last[1],pair[1]);
        else merged.push(pair);
    }
    const source=[];
    let rangeIndex=0;
    for(let id=Math.max(0,afterId+1);id<chat.length;id++){
        while(rangeIndex<merged.length&&merged[rangeIndex][1]<id)rangeIndex++;
        const range=merged[rangeIndex];
        if(range&&id>=range[0]){id=range[1];continue;}
        const entry=chat[id];
        if(!entry||entry.is_system||typeof entry.mes!=='string'||!entry.mes.trim())continue;
        source.push({id,name:String(entry.name||''),mes:entry.mes,
            is_user:!!entry.is_user,send_date:entry.send_date||null});
    }
    return {source,prior,reviewed};
}

function readableSegments(segments) {
    return (segments||[]).map(pair=>pair[0]===pair[1]
        ? String(pair[0]):pair[0]+'-'+pair[1]).join(', ');
}

function sidePromptName(preset) {
    return preset.id === SLOTH_DIARY_ID ? t("Diary (Don't read it)", 'STMemoryBooks_SlothDiary')
        : preset.id === SLOTH_NPC_DIRECTORY_ID ? t(preset.name, 'STMemoryBooks_SlothNpcDirectory')
        : preset.id === SLOTH_QUOTES_ID ? t(preset.name, 'STMemoryBooks_SlothMemorableQuotes') : preset.name;
}

function sidePromptCheckboxes(presets, label) {
    return '<fieldset class="stmb-sloth-side-choices"><legend>' + html(label) + '</legend>' +
        presets.map(preset => {
            const { book } = preset.destination;
            const destinationLabel = book || t('Create lorebook [{{book}}]', 'STMemoryBooks_SlothSideAutoBook')
                .replace('{{book}}', () => slothSideBookName(getActiveNexusRoleContext().character, [], '',
                    t('MemoryBook Side Prompt', 'STMemoryBooks_SlothSideBookSuffix')));
            return '<label class="checkbox_label"><input type="checkbox" name="stmb-side-prompt" value="' +
                html(preset.id) + '"><span>' + html(sidePromptName(preset) + ' · ' + destinationLabel) + '</span></label>';
        }).join('') + '</fieldset>';
}

function checkedSidePrompts(popup) {
    return Array.from(popup.dlg.querySelectorAll('input[name="stmb-side-prompt"]:checked'), input => input.value);
}

function setSidePromptConfirmationAvailable(button, available) {
    button.toggleAttribute('disabled', !available);
    button.setAttribute('aria-disabled', String(!available));
}

async function listSlothSideBooks() {
    const books = await requestNexusSetupData('/api/worldinfo/list');
    if (!Array.isArray(books) || books.some(book => typeof book?.file_id !== 'string')) {
        throw new Error('Could not verify the Side Prompt lorebook list.');
    }
    return books;
}

const pendingSideRenames = settings => Array.isArray(settings?.moduleSettings?.slothSidePendingRenames)
    ? settings.moduleSettings.slothSidePendingRenames : [];
let sideRenameTail = Promise.resolve();
let sideRenameRunning = 0;
let sideRenameFailureNotice = null;
export const SLOTH_RENAME_RETRIED_EVENT = 'stmb_sloth_rename_retried';

function getSlothRenameReceiptChatKey(change) {
    if (change.type !== 'lorebook') return '';
    const ref=getCurrentStmbChatRef();
    if (ref?.type !== 'character' || !ref.fileName) return '';
    const key=getStmbChatKey(ref), markers=getSceneMarkers();
    const hasBook=books=>books?.nexus===change.oldBook || books?.memory===change.oldBook;
    if (['slothCollection','slothAutomatic'].some(field=>
        markers[field]?.chatKey===key && hasBook(markers[field].books))) return key;
    for (const [pair,receipt] of Object.entries(markers.slothLegacyCoverage || {})) {
        if (receipt?.chatKey !== key) continue;
        try { const books=JSON.parse(pair); if(Array.isArray(books)&&books.includes(change.oldBook))return key; }
        catch { /* Existing migration validation handles invalid legacy keys. */ }
    }
    return '';
}

async function retargetActiveSlothReceipts(change, expectedChatKey='') {
    if(expectedChatKey && getStmbChatKey()!==expectedChatKey)
        throw new Error(t('Switch back to the original chat before retrying the lorebook link update.',
            'STMemoryBooks_SlothRenameOriginalChat'));
    const ref=getCurrentStmbChatRef();
    if (ref?.type !== 'character' || !ref.fileName) return;
    const current=getStmbChatKey(ref);
    const oldChatKey=change.type === 'chat' && ref.avatarUrl === change.avatar && ref.fileName === change.newFile
        ? getStmbChatKey({...ref,fileName:change.oldFile}) : '';
    if (!oldChatKey && change.type !== 'lorebook') return;
    const retargetBooks=books=>books && change.type === 'lorebook' ? {
        nexus:books.nexus === change.oldBook ? change.newBook : books.nexus,
        memory:books.memory === change.oldBook ? change.newBook : books.memory,
    } : books;
    const replace=markers=>{
        const next={...markers};
        for (const key of ['slothCollection','slothAutomatic']) {
            const receipt=markers[key];
            if (receipt?.chatKey === (oldChatKey || current))
                next[key]={...receipt,chatKey:current,books:retargetBooks(receipt.books)};
        }
        if (markers.slothLegacyCoverage) {
            const entries=Object.entries(markers.slothLegacyCoverage).map(([key,receipt])=>{
                if (receipt?.chatKey !== (oldChatKey || current)) return [key,receipt];
                const [nexus,memory]=JSON.parse(key);
                return [legacyPairKey(retargetBooks({nexus,memory})),{...receipt,chatKey:current}];
            });
            if (new Set(entries.map(([key])=>key)).size !== entries.length)
                throw new Error('Renamed lorebook would combine distinct reviewed message ranges.');
            next.slothLegacyCoverage=Object.fromEntries(entries);
        }
        return next;
    };
    // A host refresh can replace the metadata object during the awaited
    // verification. Retry only this pre-write identity conflict, never an
    // external edit, and run the complete verification again on the same chat.
    for(let attempt=0;attempt<3;attempt++){
        if(getStmbChatKey()!==current)throw slothWriteConflict();
        const markers=getSceneMarkers();
        try {
            const needsPatch=stringify(markers)!==stringify(replace(markers));
            const saved=needsPatch?await patchVerifiedSlothMetadata(ref,replace):markers;
            // An earlier partial save may have updated local metadata only.
            // Verify persistence before removing its queued rename.
            if(needsPatch||expectedChatKey){
                const stored=await readCurrentSlothChatForWrite(ref);
                if(canonicalSlothWriteSnapshot(normalizeSlothWriteMarkers(saved))!==
                    canonicalSlothWriteSnapshot(normalizeSlothWriteMarkers(stored[0].chat_metadata.STMemoryBooks)))
                    throw slothWriteConflict();
            }
            return;
        }catch(error){
            if(error?.code!=='STMB_METADATA_REPLACED'||attempt===2||getStmbChatKey()!==current)throw error;
        }
    }
}

export function hasPendingSlothSideRename(ref) {
    return pendingSideRenames(extension_settings.STMemoryBooks).some(change=>sideRenameMatches(change,ref));
}
function assertSideRenameReady(ref) {
    if (hasPendingSlothSideRename(ref))
        throw new Error(sideRenameRunning?t('Updating lorebook links. Try again after the update finishes.',
            'STMemoryBooks_SlothRenameUpdating'):t('Side Prompt rename recovery is pending. Reload SillyTavern to retry before saving.',
            'STMemoryBooks_SlothSideRenamePending'));
}

async function persistSideRenameQueue(params, next) {
    const previous = params.slothSidePendingRenames;
    params.slothSidePendingRenames = next;
    try {
        await saveSettings();
        const stored = (await readNexusSetupSettings()).extensions?.moduleSettings;
        if (stringify(stored?.slothSidePendingRenames || []) !== stringify(params.slothSidePendingRenames))
            throw new Error('Side Prompt rename recovery could not be saved.');
    } catch (error) {
        if (params.slothSidePendingRenames === next) params.slothSidePendingRenames = previous;
        throw error;
    }
}

async function processSlothSideRenames() {
    const settings = extension_settings.STMemoryBooks;
    const params = settings?.moduleSettings;
    if (!params) return;
    while (pendingSideRenames(settings).length) {
        const record = pendingSideRenames(settings)[0];
        const change = normalizeSlothSideRename(record);
        if (!change) throw new Error('Invalid Side Prompt rename recovery record.');
        planSlothSideSettingsRename(params,change);
        const books = await listSlothSideBooks();
        const owners = books.filter(book=>change.type === 'lorebook' ? Boolean(slothSideBookOwner(book)) :
            [change.avatar,change.newAvatar].filter(Boolean).includes(slothSideBookOwner(book)));
        if (change.type === 'avatar' && owners.length > 1)
            throw new Error('Multiple dedicated Side Prompt lorebooks conflict after the character rename.');
        const names = new Set([...slothSideRenameBooks(settings,change),...(record.books || []),
            ...owners.map(book=>book.file_id)]);
        const available = new Set(books.map(book=>book.file_id));
        const verifyOrigin = () => {
            if (pendingSideRenames(settings)[0] !== record)
                throw new Error('Side Prompt rename recovery changed.');
        };
        // Keep the same candidate set and sequential verified commits, but
        // overlap the read-only preparation of up to four known books.
        const candidates=[...names].filter(name=>available.has(name));
        for(let offset=0;offset<candidates.length;offset+=4) {
            verifyOrigin();
            const batch=await Promise.all(candidates.slice(offset,offset+4).map(async name=>{
                const original=await loadServerWorld(name);
                return {name,original,staged:stageSlothSideIdentityRename(original,change)};
            }));
            for(const {name,original,staged} of batch) {
                verifyOrigin();
                if(!staged)continue;
                await commitSlothNexusMigration({name,original,staged},{
                loadFresh:loadServerWorld, save:(book,data)=>saveWorldInfo(book,data,true),
                withLock:(book,task)=>withStmbWriteLane({type:'lorebook',name:book},task),
                verifyOrigin, verifyBeforeWrite:assertReviewedCache,
                resetCache:(book,data)=>worldInfoCache.set(book,structuredClone(data)),
                operation:'Side Prompt update',
            });
                try { await Promise.resolve(reloadEditor(name)); } catch (error) { console.warn('🦥 STMemoryBooks', error); }
            }
        }
        verifyOrigin();
        // Recheck rather than replacing any settings edited during the reads.
        await retargetActiveSlothReceipts(change,record.receiptChatKey);
        verifyOrigin();
        const freshPatch = planSlothSideSettingsRename(params,change);
        if (change.type === 'lorebook') retargetSlothLorebookRoles(settings,change);
        Object.assign(params,freshPatch);
        await persistSideRenameQueue(params,pendingSideRenames(settings).slice(1));
    }
}

function clearSideRenameFailureNotice() {
    const notice=sideRenameFailureNotice;
    sideRenameFailureNotice=null;
    if(notice)toastr.clear(notice);
}

function reportSideRenameFailure(error) {
    console.warn('🦥 STMemoryBooks', 'Memory Books Side Prompt identity migration stopped:',error);
    clearSideRenameFailureNotice();
    sideRenameFailureNotice=toastr.warning(t('Lorebook link update is pending. Click this notification to retry in the original chat. If the saved chat changed, reload it first.',
        'STMemoryBooks_SlothRenameRetry'),'STMemoryBooks',{
        timeOut:0,extendedTimeOut:0,tapToDismiss:false,closeButton:true,
        onclick:()=>{void retrySlothSideRenames();},
    });
}

export function queueSlothSideRename(rawChange, books = []) {
    const change = normalizeSlothSideRename(rawChange);
    const params = extension_settings.STMemoryBooks?.moduleSettings;
    if (!change || !params) return Promise.resolve();
    const records = pendingSideRenames(extension_settings.STMemoryBooks);
    const receiptChatKey=getSlothRenameReceiptChatKey(change);
    const record = {...change,books:[...new Set([...books,...slothSideRenameBooks(extension_settings.STMemoryBooks,change)])],
        ...(receiptChatKey?{receiptChatKey}:{})};
    // Add synchronously so an in-flight Side Prompt cannot write under an old identity.
    params.slothSidePendingRenames = [...records,record];
    sideRenameRunning++;
    const notice=change.type==='lorebook'?toastr.info(t('Updating lorebook links. Try again after the update finishes.',
        'STMemoryBooks_SlothRenameUpdating'),'STMemoryBooks',{timeOut:0,extendedTimeOut:0}):null;
    sideRenameTail = sideRenameTail.catch(()=>{}).then(async()=>{
        // An earlier queue item can already have drained this record.
        if(!pendingSideRenames(extension_settings.STMemoryBooks).length)return true;
        await persistSideRenameQueue(params,pendingSideRenames(extension_settings.STMemoryBooks));
        await processSlothSideRenames();
        clearSideRenameFailureNotice();
        return true;
    }).catch(error=>{reportSideRenameFailure(error);return false;}).finally(()=>{
        sideRenameRunning--;
        if(notice)toastr.clear(notice);
    });
    return sideRenameTail;
}

export function retrySlothSideRenames() {
    if(sideRenameRunning)return sideRenameTail;
    if(!pendingSideRenames(extension_settings.STMemoryBooks).length){
        clearSideRenameFailureNotice();
        return Promise.resolve(true);
    }
    sideRenameRunning++;
    clearSideRenameFailureNotice();
    const notice=toastr.info(t('Updating lorebook links. Try again after the update finishes.',
        'STMemoryBooks_SlothRenameUpdating'),'STMemoryBooks',{timeOut:0,extendedTimeOut:0});
    sideRenameTail=sideRenameTail.catch(()=>{}).then(async()=>{
        const settings=extension_settings.STMemoryBooks;
        await persistSideRenameQueue(settings.moduleSettings,pendingSideRenames(settings));
        await processSlothSideRenames();
        clearSideRenameFailureNotice();
        try { await eventSource.emit(SLOTH_RENAME_RETRIED_EVENT); }
        catch(error){console.warn('🦥 STMemoryBooks', 'Memory Books rename UI refresh failed:',error);}
        return true;
    }).catch(error=>{reportSideRenameFailure(error);return false;}).finally(()=>{
        sideRenameRunning--;
        if(notice)toastr.clear(notice);
    });
    return sideRenameTail;
}

const possibleLorebookRenames = new Map();
let hostLorebookRename=null;

// Native ST rename has no dedicated event in supported versions. Capture the
// actual editor action before the host opens its name dialog; then require
// its save-new / remove-old sequence and exact read-back. Selection is
// only needed for the legacy cache-based fallback, never for native intent.
export function beginSlothLorebookRename(oldBook,names) {
    const recorded=slothSideRenameBooks(extension_settings.STMemoryBooks,{type:'lorebook',newBook:''});
    hostLorebookRename=oldBook&&Array.isArray(names)&&names.includes(oldBook)&&recorded.includes(oldBook)
        ?{oldBook,names:[...names],expires:Date.now()+300000}:null;
}

export function observeSlothLorebookSave(newBook, data, names, editorName='') {
    if (!Array.isArray(names)||!newBook||!data?.entries) return;
    for (const [name, candidate] of possibleLorebookRenames) if (Date.now()>candidate.expires) possibleLorebookRenames.delete(name);
    const intent=hostLorebookRename;
    const explicit=intent&&Date.now()<=intent.expires&&intent.oldBook===editorName&&
        newBook!==intent.oldBook&&names.includes(intent.oldBook)&&!intent.names.includes(newBook);
    if(names.includes(newBook)&&!explicit)return false;
    const settings=extension_settings.STMemoryBooks;
    const recorded=slothSideRenameBooks(settings,{type:'lorebook',newBook});
    const fingerprint=stringify(data);
    if (explicit&&recorded.includes(intent.oldBook)) {
        // The editor explicitly initiated a rename. Do not require the old
        // cache to still contain an identical object after host normalization.
        possibleLorebookRenames.set(newBook,{oldBook:intent.oldBook,fingerprint,expires:Date.now()+300000,explicit:true});
        hostLorebookRename=null;
        return true;
    }
    if (names.includes(newBook)) return;
    const matches=recorded.filter(oldBook=>names.includes(oldBook) && worldInfoCache.has(oldBook) &&
        stringify(worldInfoCache.get(oldBook)) === fingerprint);
    if (matches.length === 1) possibleLorebookRenames.set(newBook,{oldBook:matches[0],fingerprint,expires:Date.now()+30000});
}

const finishingLorebookRenames=new Set();

async function finishVerifiedSlothLorebookRename(newBook, names, serverListVerified) {
    const candidate=possibleLorebookRenames.get(newBook);
    if (!candidate || finishingLorebookRenames.has(newBook)) return false;
    if(Date.now()>candidate.expires){possibleLorebookRenames.delete(newBook);return false;}
    if(!Array.isArray(names)||names.includes(candidate.oldBook)||!names.includes(newBook))return false;
    finishingLorebookRenames.add(newBook);
    try {
        // Check actual server files, not only the editor's cached options.
        const available=serverListVerified?names:(await listSlothSideBooks()).map(book=>book.file_id);
        if(available.includes(candidate.oldBook)||!available.includes(newBook))return false;
        if(stringify(await loadServerWorld(newBook))!==candidate.fingerprint){
            possibleLorebookRenames.delete(newBook);return false;
        }
        if(possibleLorebookRenames.get(newBook)!==candidate)return false;
        possibleLorebookRenames.delete(newBook);
        const completed=await queueSlothSideRename({type:'lorebook',oldBook:candidate.oldBook,newBook});
        return completed!==false;
    }finally{finishingLorebookRenames.delete(newBook);}
}

export async function finishSlothLorebookRename(newBook,names) {
    return finishVerifiedSlothLorebookRename(newBook,names,false);
}

// Native hosts can rebuild the list without selecting the renamed file.
// Only explicitly observed rename actions qualify for this automatic path.
export async function finishPendingSlothLorebookRenames() {
    for(const [name,candidate] of possibleLorebookRenames)
        if(Date.now()>candidate.expires) possibleLorebookRenames.delete(name);
    const pending=()=>[...possibleLorebookRenames].filter(([,candidate])=>candidate.explicit===true);
    if(!pending().length)return {changed:false,pending:false};
    const names=(await listSlothSideBooks()).map(book=>book.file_id);
    let changed=false;
    for(const [name] of pending()) changed=await finishVerifiedSlothLorebookRename(name,names,true)||changed;
    return {changed,pending:pending().length>0};
}

async function resolveSlothSideBook(ref, books, {book: selected, create}, signal) {
    assertSideRenameReady(ref);
    if (selected) {
        if (!books.some(book => book.file_id === selected)) throw new Error('The selected Side Prompt lorebook no longer exists.');
        const original = await loadServerWorld(selected, signal);
        return { name: selected, original, isNew: false, autoLink: false };
    }
    if (!create) throw new Error('Choose a lorebook for this Side Prompt.');
    const owned = books.filter(book => slothSideBookOwner(book) === ref.avatarUrl);
    if (owned.length > 1) throw new Error('More than one dedicated Side Prompt lorebook is linked to this character.');
    if (owned.length) {
        const name = owned[0].file_id;
        const original = await loadServerWorld(name, signal);
        if (slothSideBookOwner(original) !== ref.avatarUrl) throw new Error('Side Prompt lorebook ownership changed.');
        return { name, original, isNew: false, autoLink: true };
    }
    const suffix = Array.from(crypto.getRandomValues(new Uint8Array(3)), byte => byte.toString(16).padStart(2, '0')).join('');
    const name = slothSideBookName(getActiveNexusRoleContext().character, books.map(book => book.file_id), suffix,
        t('MemoryBook Side Prompt', 'STMemoryBooks_SlothSideBookSuffix'));
    return { name, original: { entries: {}, extensions: { stmbSlothSideBook: { version: 1, avatar: ref.avatarUrl } } },
        isNew: true, autoLink: true };
}

export async function getSlothSideContinuationOptions(book, presetId, ref) {
    if (!(await listSlothSideBooks()).some(item => item.file_id === book)) {
        throw new Error('The selected Side Prompt lorebook no longer exists.');
    }
    const original = await loadServerWorld(book);
    const settings=extension_settings.STMemoryBooks;
    const roles={nexus:getNexusRoleResolutionForChatRef('nexus',ref,settings).name,
        memory:getNexusRoleResolutionForChatRef('memory',ref,settings).name};
    return Object.values(original.entries).filter(entry => canContinueSlothSideEntry(entry,presetId,ref,
        {storyKey:slothSideStoryKey(ref,roles),allowLegacyInheritance:true}));
}

async function ensureSlothSideBookLink(ref, name, verifyOrigin) {
    const { character, linkedBooks } = getActiveNexusRoleContext();
    verifyOrigin();
    if (linkedBooks.includes(name)) return;
    await charUpdateAddAuxWorld(ref.avatarUrl, [name]);
    await saveSettings();
    const stored = await readNexusSetupSettings();
    if (!getLinkedCharacterWorlds({ character, worldInfo: stored.world }).includes(name)) {
        throw new Error('The Side Prompt lorebook was saved, but its character link could not be verified.');
    }
}

async function saveSlothSideBook({ ref, destination, staged, verifyOrigin }) {
    const { name, original, isNew } = destination;
    const save = (bookName, book) => saveWorldInfo(bookName, book, true);
    const link = () => ensureSlothSideBookLink(ref, name, verifyOrigin);
    const result = isNew
        ? await commitInitialNexusBooks([{ name, staged }], {
            list: async () => (await listSlothSideBooks()).map(book => book.file_id),
            load: loadServerWorld, save, verifyOrigin, withLocks: withBothWriteLanes, link,
            verifyUnbound: async () => {
                if ((await listSlothSideBooks()).some(book =>
                    slothSideBookOwner(book) === ref.avatarUrl && book.file_id !== name)) {
                    throw new Error('The dedicated Side Prompt lorebook was already created in another session. Try again.');
                }
            },
        })
        : await commitSlothNexusMigration({ name, original, staged }, {
            loadFresh: async bookName => {
                const fresh = await loadServerWorld(bookName);
                if (!Object.keys(fresh.entries).length &&
                    !(await listSlothSideBooks()).some(book => book.file_id === bookName)) {
                    throw new Error('The Side Prompt lorebook was removed during review.');
                }
                return fresh;
            },
            save,
            withLock: (bookName, task) => withStmbWriteLane({ type: 'lorebook', name: bookName }, task),
            verifyOrigin, verifyBeforeWrite: assertReviewedCache, operation: 'Side Prompt update',
            resetCache: (bookName, book) => worldInfoCache.set(bookName, structuredClone(book)),
        });
    if (!isNew && destination.autoLink) await link();
    try {
        if (isNew) await updateWorldInfoList();
        await Promise.resolve(reloadEditor(name));
    } catch (error) {
        console.warn('🦥 STMemoryBooks', 'Sloth Side Prompt editor refresh failed', error);
    }
    return result;
}

async function reviewSlothSideDrafts(drafts, signal) {
    const title = t('Review Side Prompts', 'STMemoryBooks_SlothSideReview');
    const fields = drafts.map(({ preset, draft, destination }) => '<section class="stmb-sloth-side-draft">' +
        '<label class="checkbox_label"><input class="stmb-sloth-side-save" type="checkbox" checked><strong>' +
        html(sidePromptName(preset)) + '</strong></label>' +
        '<small>' + html(t('Save to {{book}}', 'STMemoryBooks_SlothSideSaveTo').replace('{{book}}', destination.name) + ' · ' +
        (draft.target ? t('Update {{entry}}', 'STMemoryBooks_SlothSideUpdateEntry').replace('{{entry}}', draft.target.comment || String(draft.target.uid)) :
            t('New entry', 'STMemoryBooks_SlothSideNewEntry'))) + '</small>' +
        '<textarea class="text_pole stmb-sloth-side-review" rows="6" aria-label="' + html(sidePromptName(preset)) + '"></textarea>' +
        (preset.recall === 'keyword' ? '<label class="stmb-sloth-edit">' +
            html(t('Recall keywords (comma-separated)', 'STMemoryBooks_SlothSideKeywordInput')) +
            '<input type="text" class="text_pole stmb-sloth-side-keywords"></label>' : '') + '</section>').join('');
    const popup = markStmbPopup(new Popup(DOMPurify.sanitize('<div class="stmb-sloth-review"><h3>' +
        html(title) + '</h3>' + fields + '</div>'), POPUP_TYPE.CONFIRM, '',
    { wide: true, allowVerticalScrolling: true, okButton: t('Save', 'STMemoryBooks_Save'),
        cancelButton: t('Cancel', 'STMemoryBooks_Cancel'),
        onClosing: ({ result }) => result !== POPUP_RESULT.AFFIRMATIVE || canSave() }));
    const rows = [...popup.dlg.querySelectorAll('.stmb-sloth-side-draft')].map((row, index) => {
        const { draft, destination } = drafts[index];
        const content = row.querySelector('textarea');
        const keywords = row.querySelector('.stmb-sloth-side-keywords');
        const checked = row.querySelector('.stmb-sloth-side-save');
        content.value = draft.text;
        if (keywords) keywords.value = draft.keywords.join(', ');
        return { draft, destination, content, keywords, checked };
    });
    const picked = () => rows.filter(row => row.checked.checked);
    const valid = ({ content, keywords }) => content.value.trim() &&
        (!keywords || normalizeSlothSideKeywords(keywords.value).length);
    const canSave = () => picked().length > 0 && picked().every(valid);
    const saveButton = popup.dlg.querySelector('.popup-button-ok');
    const refresh = () => setSidePromptConfirmationAvailable(saveButton, canSave());
    popup.dlg.addEventListener('input', refresh);
    refresh();
    if (await showCollectionPopup(popup, signal) !== POPUP_RESULT.AFFIRMATIVE || !canSave()) return [];
    return picked().map(({ draft, destination, content, keywords }) => ({
        draft, destination, content: content.value.trim(), keywords: normalizeSlothSideKeywords(keywords?.value),
    }));
}

async function runReviewedSlothSidePrompts({ ref, roles, presets, source, profile, verifyOrigin, verifySource, signal, onRequestMetric=null, onSaved=null, onSaveFailure=null }) {
    if (!presets.length) return { saved: false };
    const verifyDestinations = () => {
        assertSideRenameReady(ref);
        verifyOrigin();
        if (presets.some(preset => !isSlothSideLinked(extension_settings.STMemoryBooks, preset.id, ref) ||
            stringify(preset.destination) !==
            stringify(getSlothSideDestination(extension_settings.STMemoryBooks, preset.id, ref)))) {
            throw new Error('Side Prompt destination changed during review.');
        }
    };
    verifyDestinations();
    const books = await listSlothSideBooks();
    const nexus = await loadServerWorld(roles.nexus, signal);
    const storyKey=slothSideStoryKey(ref,roles);
    if(!storyKey)throw new Error('Side Prompt story is not configured.');
    const assigned=getCharacterNexusRoles(extension_settings.STMemoryBooks.nexusCharacterRoles,ref.avatarUrl);
    const otherStories=Object.values(extension_settings.STMemoryBooks.nexusChatRoleOverrides||{})
        .some(record=>record?.avatar===ref.avatarUrl&&(record.nexus!==roles.nexus||record.memory!==roles.memory));
    const allowLegacyInheritance=assigned.nexus===roles.nexus&&assigned.memory===roles.memory&&!otherStories;
    const destinations = new Map();
    const targets = new Set();
    const compiled = source.ids ? compileScene(createSceneRequest(source.ids[0], source.ids.at(-1)),
        { messageIndices: source.ids, includeHiddenMessages: true }) : null;
    const drafts = [];
    const failed = [];
    for (const preset of presets) {
        verifyDestinations();
        try {
            const selected = preset.destination.book || null;
            if (!destinations.has(selected)) destinations.set(selected,
                await resolveSlothSideBook(ref, books, preset.destination, signal));
            const destination = destinations.get(selected);
            const draft = await proposeReviewedSidePrompt(preset, destination.name, destination.original,
                compiled, profile, source.entry, { recallMode: preset.recall, nexus, chatRef: ref, storyKey, allowLegacyInheritance, onRequestMetric });
            if (!draft) continue;
            if (draft.target) {
                const key = JSON.stringify([destination.name, draft.target.uid]);
                if (targets.has(key)) throw new Error('Two Side Prompts target the same entry.');
                targets.add(key);
            }
            drafts.push({ preset, draft, destination });
        } catch (error) {
            verifyDestinations();
            failed.push(sidePromptName(preset));
            console.warn('🦥 STMemoryBooks', 'Sloth Side Prompt could not be generated:', preset.id, error);
        }
    }
    if (failed.length) toastr.warning(t('Could not write: {{names}}', 'STMemoryBooks_SlothSideFailed')
        .replace('{{names}}', failed.join(', ')), 'STMemoryBooks');
    if (!drafts.length) {
        if (!failed.length) toastr.info(t('No new details to save.', 'STMemoryBooks_SlothSideNoDetails'), 'STMemoryBooks');
        return { saved: false, failed };
    }
    verifyDestinations();
    const approved = await reviewSlothSideDrafts(drafts, signal);
    if (!approved.length) return { saved: false, failed };
    await verifySource();
    const byBook = new Map();
    for (const item of approved) {
        const name = item.destination.name;
        if (!byBook.has(name)) byBook.set(name, []);
        byBook.get(name).push(item);
    }
    let count = 0;
    for (const [name, group] of byBook) {
        verifyDestinations();
        try {
            const destination = group.find(item => item.destination.autoLink)?.destination || group[0].destination;
            const staged = group.reduce((book, { draft, content, keywords }) =>
                draft.stage(book, content, keywords), destination.original);
            await saveSlothSideBook({ ref, destination, staged, verifyOrigin: verifyDestinations });
            count += group.length;
            if(onSaved)try{onSaved(count);}catch{/* Statistics are optional. */}
            toastr.success(t('Side Prompts saved to {{book}}.', 'STMemoryBooks_SlothSideBatchSaved')
                .replace('{{book}}', name), 'STMemoryBooks');
        } catch (error) {
            verifyDestinations();
            if(onSaveFailure)try{onSaveFailure();}catch{/* Statistics are optional. */}
            console.warn('🦥 STMemoryBooks', 'Sloth Side Prompts could not save to', name, error);
            toastr.error(t('Could not save to {{book}}. Check the lorebook and try again.',
                'STMemoryBooks_SlothSideSaveFailed').replace('{{book}}', name), 'STMemoryBooks');
        }
    }
    return { saved: count > 0, count, failed };
}

export async function runNexusSidePromptFollowup({ profileIndex, stConnectionProfileId } = {}) {
    if (collectorBusy) throw new Error('A Sloth operation is already in progress.');
    collectorBusy = true;
    try {
        const settings = extension_settings.STMemoryBooks;
        const ref = structuredClone(getCurrentStmbChatRef());
        const runnable = getRunnableSlothSidePresets(settings, ref);
        if (!runnable.length) {
            toastr.info(t('Check a Side Prompt for this character and choose its lorebook first.',
                'STMemoryBooks_SlothSideSetupRequired'), 'STMemoryBooks');
            return { saved: false };
        }
        const roles = Object.fromEntries(['nexus', 'memory'].map(role =>
            [role, getNexusRoleResolutionForChatRef(role, ref, settings).name]));
        assertSlothBookRoles(ref, roles);
        const memory = await loadServerWorld(roles.memory);
        assertSlothBookRoles(ref, roles);
        const chatIds = new Set([ref.fileName, ref.chatId].filter(Boolean).map(value => String(value).replace(/\.jsonl$/i, '')));
        const fingerprintOptions = { allowHidden: true };
        const scenes = Object.values(memory.entries).flatMap(entry => {
            if (entry.disable || !isCompletedSceneEntry(entry) ||
                !chatIds.has(String(entry.STMB_chatId || '').replace(/\.jsonl$/i, ''))) return [];
            try {
                const ranges = sourceRangesForSplit(entry);
                const ids = expandSplitRanges(ranges);
                if (ids.some(id => !chat[id]?.mes?.trim())) return [{ entry }];
                return [{ entry, ranges, ids, fingerprint: fingerprintSlothChat(chat, ids, fingerprintOptions) }];
            } catch {
                return [{ entry }];
            }
        }).sort((left, right) => (right.ids?.at(-1) ?? -1) - (left.ids?.at(-1) ?? -1) || right.entry.uid - left.entry.uid);
        if (!scenes.length) {
            toastr.info(t('There are no saved events from this chat. Run Collect memories first.',
                'STMemoryBooks_SlothSidePromptNoSource'), 'STMemoryBooks');
            return { saved: false };
        }
        const options = scenes.map(({ entry, ranges }, index) => '<option value="' + index + '">' +
            html(entry.comment + ' · ' + (ranges ? '#' + readableSegments(ranges) :
                t('Saved text', 'STMemoryBooks_SlothSideSavedText'))) + '</option>').join('');
        const selection = markStmbPopup(new Popup(DOMPurify.sanitize('<div class="stmb-sloth-review"><h3>' +
            html(t('Run Side Prompts', 'STMemoryBooks_SlothSidePromptAction')) + '</h3><label class="stmb-sloth-edit">' +
            html(t('Saved Scene', 'STMemoryBooks_SlothSidePromptSource')) +
            '<select class="text_pole" id="stmb-sideprompt-source">' + options + '</select></label>' +
            sidePromptCheckboxes(runnable, t('Choose prompts to run', 'STMemoryBooks_SlothSideChoose')) +
            '</div>'), POPUP_TYPE.CONFIRM, '', {
            wide: true, allowVerticalScrolling: true,
            okButton: t('Write drafts', 'STMemoryBooks_SlothSidePromptGenerate'),
            cancelButton: t('Cancel', 'STMemoryBooks_Cancel'),
            onClosing: ({ result }) => result !== POPUP_RESULT.AFFIRMATIVE || checkedSidePrompts(selection).length > 0,
        }));
        const button = selection.dlg.querySelector('.popup-button-ok');
        const update = () => setSidePromptConfirmationAvailable(button, checkedSidePrompts(selection).length > 0);
        selection.dlg.addEventListener('input', update);
        update();
        if (await selection.show() !== POPUP_RESULT.AFFIRMATIVE) return { saved: false };
        const scene = scenes[Number(selection.dlg.querySelector('#stmb-sideprompt-source').value)];
        if (!scene) throw new Error('The reviewed selection changed.');
        const verifyOrigin = () => {
            if (scene.ids) assertOrigin(ref, roles, scene.ids, scene.fingerprint, fingerprintOptions);
            else assertSlothBookRoles(ref, roles);
        };
        const verifySource = async () => {
            if (scene.ids) await readReviewedChat(ref, scene.ids, scene.fingerprint, fingerprintOptions);
            const stored = await loadServerWorld(roles.memory);
            if (!Object.values(stored.entries).some(entry => entry.uid === scene.entry.uid &&
                stringify(entry) === stringify(scene.entry))) throw new Error('The source Scene changed during review.');
        };
        return await runReviewedSlothSidePrompts({ ref, roles, source: scene, verifyOrigin, verifySource,
            presets: pickSlothSidePresets(settings, checkedSidePrompts(selection), ref),
            profile: collectionProfile(settings, profileIndex, stConnectionProfileId) });
    } finally {
        collectorBusy = false;
    }
}

async function showCollectionPopup(popup, signal) {
    signal?.throwIfAborted();
    const close = () => { void popup.completeCancelled(); };
    signal?.addEventListener('abort', close, { once: true });
    try {
        const result = await popup.show();
        signal?.throwIfAborted();
        return result;
    } finally {
        signal?.removeEventListener('abort', close);
    }
}

async function loadServerWorld(name, signal) {
    // Never trust stale worldInfoCache for optimistic locking or read-back.
    const response=await fetch('/api/worldinfo/get',{
        method:'POST',headers:getRequestHeaders(),body:JSON.stringify({name}),signal});
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

async function readStoredSlothChat(ref) {
    const response = await fetch('/api/chats/get', {
        method: 'POST', headers: getRequestHeaders(), cache:'no-cache',
        body: stringify({ avatar_url: ref.avatarUrl, file_name: ref.fileName }),
    });
    if (!response.ok) throw new Error('The original chat could not be read from SillyTavern.');
    const stored = await response.json();
    if (!Array.isArray(stored) || !stored[0]?.chat_metadata) throw new Error('The saved chat could not be verified.');
    return stored;
}

// Host saveMetadata()/Hide save the entire loaded chat, not just a header
// patch. Check ALL persisted turns immediately before such a write, including
// already collected/hidden turns and alternate swipes, not only source IDs.
function canonicalSlothWriteSnapshot(value) {
    return JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)
        ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
}

function slothWriteConflict() {
    return Object.assign(new Error(t('The saved chat changed outside this tab. Reload the original chat before saving. The previous AI response is retained.',
        'STMemoryBooks_SlothExternalChatConflict')),{code:'STMB_SLOTH_EXTERNAL_CHAT_CONFLICT'});
}

async function readCurrentSlothChatForWrite(ref) {
    const key=getStmbChatKey(ref);
    if(!key||getStmbChatKey()!==key) throw slothWriteConflict();
    const snapshot=canonicalSlothWriteSnapshot(chat);
    const stored=await readStoredSlothChat(ref);
    if(getStmbChatKey()!==key||canonicalSlothWriteSnapshot(chat)!==snapshot||
        canonicalSlothWriteSnapshot(stored.slice(1))!==snapshot) throw slothWriteConflict();
    return stored;
}

function normalizeSlothWriteMarkers(value) {
    const result={...(value||{})};
    // Reading getSceneMarkers() initializes these two optional null fields.
    for(const key of ['sceneStart','sceneEnd']) if(result[key]==null) delete result[key];
    return result;
}

async function patchVerifiedSlothMetadata(ref,patcher) {
    // The async patcher runs under patchStmbMetadataForChatRef's existing
    // chat write lane. Never save the stale loaded chat to "preserve" a draft.
    return await patchStmbMetadataForChatRef(ref,async markers=>{
        const stored=await readCurrentSlothChatForWrite(ref);
        const persisted=stored[0].chat_metadata.STMemoryBooks;
        if(canonicalSlothWriteSnapshot(normalizeSlothWriteMarkers(markers))!==
            canonicalSlothWriteSnapshot(normalizeSlothWriteMarkers(persisted))) throw slothWriteConflict();
        return patcher(markers);
    });
}

async function readReviewedChat(ref, sourceIds, fingerprint, fingerprintOptions, hiddenRanges=[]) {
    const stored = fingerprintOptions?.requireCurrentChat
        ?await readCurrentSlothChatForWrite(ref):await readStoredSlothChat(ref);
    if (fingerprintSlothChat(stored.slice(1), sourceIds, fingerprintOptions) !== fingerprint) {
        throw new Error('The saved chat differs from the reviewed messages. Reload it before collecting again.');
    }
    for (const [start,end] of hiddenRanges) for (let id=start;id<=end;id++) {
        if (stored[id+1]?.is_system !== true) throw new Error('The approved Hide range did not persist.');
    }
    fingerprintOptions?.verifyStored?.(stored);
    return stored[0].chat_metadata.STMemoryBooks?.slothCollection;
}

async function updateCollectedLedger(prior, events, ref, roleNames, sourceIds, fingerprint, autoWindow, fingerprintOptions) {
    const allRanges=[...(prior.savedRanges||[])];
    for(const event of events)for(const range of event.collectedRanges??event.segments)allRanges.push([...range]);
    const savedRanges=[];
    for(const pair of allRanges.filter(pair=>Array.isArray(pair)&&pair.length===2&&pair.every(Number.isSafeInteger)&&
        pair[0]>=0&&pair[1]>=pair[0]).sort((a,b)=>a[0]-b[0]||a[1]-b[1])) {
        const last=savedRanges.at(-1);
        if(last&&pair[0]<=last[1]+1)last[1]=Math.max(last[1],pair[1]);
        else savedRanges.push([...pair]);
    }
    const receipt={chatKey:getStmbChatKey(ref),savedRanges,
        books:{nexus:roleNames.nexus,memory:roleNames.memory}};
    const previous = await readReviewedChat(ref, sourceIds, fingerprint, fingerprintOptions);
    await patchVerifiedSlothMetadata(ref, markers => {
        assertOrigin(ref, roleNames, sourceIds, fingerprint, fingerprintOptions);
        if (stringify(markers.slothCollection) !== stringify(previous)) {
            throw new Error('The saved collection receipt changed during review.');
        }
        const next={...markers,slothCollection:receipt};
        // After a successful partial collection, leave the unread tail eligible
        // for the next automatic interval. Failed attempts keep their throttle.
        if (autoWindow && stringify(markers.slothAutomatic)===stringify(autoWindow.attempt)) {
            next.slothAutomatic={...autoWindow.attempt,through:autoWindow.through};
        }
        return next;
    });
    if (stringify(await readReviewedChat(ref, sourceIds, fingerprint, fingerprintOptions)) !== stringify(receipt)) {
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

export async function reviewSlothLegacyCoverage() {
    if (collectorBusy) throw new Error('A Sloth operation is already in progress.');
    collectorBusy = true;
    try {
        const settings = extension_settings.STMemoryBooks;
        const ref = structuredClone(getCurrentStmbChatRef());
        const roles = { nexus:getNexusRoleResolutionForChatRef('nexus', ref, settings).name,
            memory:getNexusRoleResolutionForChatRef('memory', ref, settings).name };
        const chatKey = getStmbChatKey(ref);
        const pair = legacyPairKey(roles);
        assertSlothBookRoles(ref, roles);
        assertSideRenameReady(ref);
        const memory=await loadServerWorld(roles.memory);
        assertSlothBookRoles(ref,roles);
        const memoryDigest=digestSlothSnapshot(memory);
        const untracked=listSlothUntrackedScenes(memory,ref,chat.length);
        const previous = getSlothLegacyCoverage(getSceneMarkers(), chatKey, roles);
        const title = t('Register previously summarized ranges', 'STMemoryBooks_SlothLegacyCoverage');
        const instructions = t('Enter only message ranges already covered by the selected Memory book. Use chat message numbers, for example 0-18, 22-25. Leave blank to clear these ranges.', 'STMemoryBooks_SlothLegacyCoverageInstructions');
        let review;
        const popup = markStmbPopup(new Popup('<div class="stmb-sloth-review"><h3>' + html(title) +
            '</h3><details><summary>'+html(t('Compare existing Scenes without verified source ranges','STMemoryBooks_SlothLegacyCompare'))+
            ' ('+untracked.length+')</summary><p>'+html(t('Choose a saved Scene to read its text and find exact quoted phrases in this chat. Matches are clues, not proof of a complete range. Only the ranges you enter below are marked reviewed.',
                'STMemoryBooks_SlothLegacyCompareHelp'))+'</p><select class="text_pole" data-stmb-legacy-scene aria-label="'+
            html(t('Existing Scene','STMemoryBooks_SlothLegacyScene'))+'"><option value="">'+html(t('Choose a Scene','STMemoryBooks_SlothLegacyChooseScene'))+
            '</option></select><textarea class="text_pole" data-stmb-legacy-body readonly hidden style="width:100%;min-height:160px"></textarea>'+
            '<div data-stmb-legacy-evidence role="status"></div></details><label for="stmb-legacy-coverage-ranges">' + html(instructions) +
            '</label><input id="stmb-legacy-coverage-ranges" class="text_pole" type="text">' +
            '<div class="stmb-legacy-coverage-preview" role="status"></div></div>', POPUP_TYPE.CONFIRM, '', {
            wide:true,large:true,allowVerticalScrolling:true,
            okButton:t('Save', 'STMemoryBooks_Save'), cancelButton:t('Cancel', 'STMemoryBooks_Cancel'),
            onClosing:({ result }) => result !== POPUP_RESULT.AFFIRMATIVE || Boolean(review),
        }));
        const selector=popup.dlg.querySelector('[data-stmb-legacy-scene]');
        const body=popup.dlg.querySelector('[data-stmb-legacy-body]');
        const evidence=popup.dlg.querySelector('[data-stmb-legacy-evidence]');
        for(const [i,entry] of untracked.entries()){
            const option=document.createElement('option');
            option.value=String(i);option.textContent=entry.comment+' · UID '+entry.uid;
            selector.append(option);
        }
        selector.addEventListener('change',()=>{
            body.hidden=true;body.value='';evidence.replaceChildren();
            if(!selector.value||getStmbChatKey()!==chatKey)return;
            const selected=untracked[Number(selector.value)];
            if(!selected)return;
            body.hidden=false;body.value=selected.content;
            const hits=findSlothLegacyEvidence(selected.content,chat);
            const heading=document.createElement('p');
            heading.textContent=hits.length?t('Matching original phrases (message IDs)','STMemoryBooks_SlothLegacyEvidence'):
                t('No exact quoted phrases found. Compare the saved Scene and original chat manually.','STMemoryBooks_SlothLegacyNoEvidence');
            evidence.append(heading);
            for(const hit of hits){
                const line=document.createElement('div');
                line.textContent='#'+hit.id+' · '+hit.name+' · '+hit.quote;
                evidence.append(line);
            }
        });
        const input = popup.dlg.querySelector('#stmb-legacy-coverage-ranges');
        const preview = popup.dlg.querySelector('.stmb-legacy-coverage-preview');
        input.value = readableSegments(Array.isArray(previous?.ranges) ? previous.ranges : []);
        const updatePreview = () => {
            review = null;
            preview.replaceChildren();
            try {
                const entered = input.value.trim();
                const ranges = entered ? parseReviewedSegments(entered, Array.from(chat.keys())) : [];
                const fingerprint = fingerprintSlothReviewedRanges(chat, ranges);
                for (const [start, end] of ranges) {
                    for (const id of new Set([start, end])) {
                        const line = document.createElement('div');
                        line.textContent = '#' + id + ' · ' + chat[id].name + ' · ' + chat[id].mes.trim().slice(0, 140);
                        preview.append(line);
                    }
                }
                review = { version:1, chatKey, ranges, fingerprint };
            } catch (error) { preview.textContent = error.message; }
        };
        input.addEventListener('input', updatePreview);
        updatePreview();
        if (await popup.show() !== POPUP_RESULT.AFFIRMATIVE || !review) return { saved:false };
        const next = review.ranges.length ? review : null;
        const verify = () => {
            assertSlothBookRoles(ref, roles);
            assertSideRenameReady(ref);
            assertSlothLegacyCoverage(next);
        };
        const readStored = async () => {
            const stored = await readStoredSlothChat(ref);
            assertSlothLegacyCoverage(next, stored.slice(1));
            return getSlothLegacyCoverage(stored[0].chat_metadata.STMemoryBooks, chatKey, roles);
        };
        verify();
        if (stringify(await readStored()) !== stringify(previous)) throw new Error('The saved reviewed ranges changed. Reload the chat.');
        if (stringify(previous) === stringify(next)) return { saved:false };
        const latestMemory=await loadServerWorld(roles.memory);
        if(stringify(digestSlothSnapshot(latestMemory))!==stringify(memoryDigest))
            throw new Error(t('Memory changed while you were reviewing ranges. Reopen the review before saving.',
                'STMemoryBooks_SlothLegacyMemoryChanged'));
        assertReviewedCache(roles.memory,memory);
        await patchVerifiedSlothMetadata(ref, markers => {
            verify();
            if (stringify(getSlothLegacyCoverage(markers, chatKey, roles)) !== stringify(previous))
                throw new Error('The reviewed ranges changed while saving.');
            const coverage = { ...markers.slothLegacyCoverage };
            if (next) coverage[pair] = next;
            else delete coverage[pair];
            return { ...markers, slothLegacyCoverage:coverage };
        });
        if (stringify(await readStored()) !== stringify(next)) throw new Error('The reviewed ranges did not persist.');
        invalidateSlothAutomaticProgress();
        return { saved:true };
    } finally { collectorBusy = false; }
}

export async function showSlothNexusHealth(){
    if(collectorBusy)throw new Error('A Sloth operation is already in progress.');
    collectorBusy=true;
    try{
        const settings=extension_settings.STMemoryBooks,ref=structuredClone(getCurrentStmbChatRef());
        const roles={nexus:getNexusRoleResolutionForChatRef('nexus',ref,settings).name,
            memory:getNexusRoleResolutionForChatRef('memory',ref,settings).name};
        const verify=()=>{assertSlothBookRoles(ref,roles);assertSideRenameReady(ref);};
        verify();
        const book=await loadServerWorld(roles.nexus);
        const report=await inspectSlothNexusHealth(book,getTokenCountAsync);
        verify();
        const tr=(key,fallback)=>t(fallback,'STMemoryBooks_SlothHealth'+key);
        const labels={core:tr('Core','Core Memory'),continuity:tr('Continuity','Continuity'),lt:tr('LT','Anchor'),npc:'NPC',
            mixed:tr('Mixed','Mixed roles'),other:tr('Other','Other'),protected:tr('Protected','Protected')};
        const num=n=>Number(n).toLocaleString();
        const amount=(n,missing=0)=>n===0&&missing?'—':'~ '+num(n);
        const unknown=n=>n?'<small class="stmb-health-unknown">'+html(tr('Unknown','Uncounted: '))+num(n)+'</small>':'';
        const value=(n,missing)=>'<span class="stmb-health-value">'+html(amount(n,missing))+unknown(missing)+'</span>';
        const summary=(label,n,missing)=>'<div class="stmb-health-stat"><span>'+html(label)+'</span><strong>'+
            html(amount(n,missing))+'</strong>'+unknown(missing)+'</div>';
        const units=t('Tokens','STMemoryBooks_Tokens');
        const stored=tr('Total','Stored'),always=tr('Always','Always-on');
        const groupRows=SLOTH_HEALTH_ROLES.filter(role=>report.groups[role].entries>0).map(role=>{
            const group=report.groups[role];
            return '<div class="stmb-health-row"><span class="stmb-health-role">'+html(labels[role])+
                ' <small aria-label="'+html(tr('Entries','Entries')+': '+num(group.entries))+'">('+num(group.entries)+')</small></span>'+
                value(group.tokens,group.uncounted)+value(group.alwaysOnTokens,group.alwaysOnUncounted)+'</div>';
        }).join('');
        const helpLabel=tr('HelpLabel','About these counts');
        const chooser=(attribute,label,placeholder)=>'<select class="text_pole" '+attribute+' aria-label="'+html(label)+
            '"><option value="">'+html(placeholder)+'</option></select>';
        const popup=markStmbPopup(new Popup('<div class="stmb-sloth-review stmb-nexus-health">'+
            '<header class="stmb-health-heading"><h3>'+html(tr('Title','Memory overview'))+
            '</h3><button type="button" class="stmb-health-info stmb-sloth-info" data-health-help-toggle aria-expanded="false" aria-controls="stmb-health-help" title="'+
            html(helpLabel)+'" aria-label="'+html(helpLabel)+'"><i class="fa-solid fa-circle-info" aria-hidden="true"></i></button></header>'+
            '<p class="stmb-health-book">'+html(roles.nexus)+'</p><p id="stmb-health-help" class="stmb-health-help" hidden>'+
            html(tr('Help','Read-only snapshot of stored body text, estimated with the current tokenizer. Always-on flags are not proof of actual injection. Nothing is deleted or reclassified.'))+'</p>'+
            '<div class="stmb-health-stats">'+summary(stored+' · '+units,report.total,report.uncounted)+
            summary(always+' · '+units,report.alwaysOn,report.alwaysOnUncounted)+'</div>'+
            '<div class="stmb-health-breakdown"><div class="stmb-health-row stmb-health-labels"><span>'+html(tr('Role','Role'))+
            '</span><span>'+html(stored)+'</span><span>'+html(always)+'</span></div>'+groupRows+'</div>'+
            '<details class="stmb-health-section" data-health-entries><summary>'+html(tr('Inspect','Inspect entries by size'))+
            ' <span>('+num(report.rows.length)+')</span></summary>'+chooser('data-health-entry',tr('Inspect','Inspect entries by size'),tr('Choose','Choose an entry'))+
            '<div class="stmb-health-reader-controls" data-health-reader-controls hidden><button type="button" class="menu_button" data-health-original aria-pressed="false">'+html(tr('ViewOriginal','View original'))+'</button></div>'+
            '<div class="stmb-health-text stmb-health-markdown" data-health-body hidden></div></details>'+
            '<details class="stmb-health-section" data-health-repeats><summary>'+html(tr('Duplicates','Identical paragraphs'))+
            ' <span>('+num(report.duplicates.length)+')</span></summary><p class="stmb-health-help">'+
            html(tr('RepeatHelp','Literal repeated paragraphs are review clues, not proof of redundant meaning.'))+'</p>'+
            (report.duplicates.length?chooser('data-health-repeat',tr('Duplicates','Identical paragraphs'),tr('Choose','Choose an entry'))+
                '<div class="stmb-health-text stmb-health-markdown" data-health-repeat-body hidden></div>':'')+'</details></div>',
            POPUP_TYPE.TEXT,'',{wide:false,large:false,allowVerticalScrolling:true}));
        popup.dlg.classList.add('stmb-nexus-health-popup');
        const helpButton=popup.dlg.querySelector('[data-health-help-toggle]'),help=popup.dlg.querySelector('#stmb-health-help');
        helpButton.addEventListener('click',()=>{help.hidden=!help.hidden;helpButton.setAttribute('aria-expanded',String(!help.hidden));});
        // Reuse the exact WorldInfoInfo file lookup. Read one book only after
        // an entry is selected; render the original immediately, never wait
        // for translation before showing the popup or the selected body.
        const legacySettings=extension_settings['simple-lorebook'];
        const translations=createSlothHealthTranslationSession(roles.nexus,
            (url,options)=>fetch(url,options),getRequestHeaders(),legacySettings,
            Boolean(legacySettings||globalThis.__slbLoreManagerActive));
        const renderMarkdown=createSlothHealthMarkdownRenderer(showdown.Converter,(value,options)=>DOMPurify.sanitize(value,options));
        const mountList=(detailsSelector,selectSelector,bodySelector,items,labelFor,textFor,readEntry=false)=>{
            const details=popup.dlg.querySelector(detailsSelector),select=details?.querySelector(selectSelector);
            if(!select)return;
            const body=details.querySelector(bodySelector);
            const controls=readEntry?details.querySelector('[data-health-reader-controls]'):null;
            const switchButton=controls?.querySelector('[data-health-original]');
            let populated=false,selection=0,current=null,showOriginal=false,lastRendered=null,translatedLabelsApplied=false;
            const render=(text)=>{
                body.hidden=false;
                if(text===lastRendered)return;
                renderMarkdown(body,text);
                lastRendered=text;
                body.scrollTop=0;
            };
            const updateReader=()=>{
                if(!current)return;
                const translated=translations.body(current);
                if(controls)controls.hidden=!translated;
                if(switchButton){
                    switchButton.textContent=showOriginal?tr('ViewTranslation','View translation'):tr('ViewOriginal','View original');
                    switchButton.setAttribute('aria-pressed',String(showOriginal));
                }
                render(!showOriginal&&translated?translated:textFor(current));
            };
            if(switchButton)switchButton.addEventListener('click',()=>{
                showOriginal=!showOriginal;
                updateReader();
            });
            details.addEventListener('toggle',()=>{
                if(!details.open||populated)return;
                const options=document.createDocumentFragment();
                for(const [i,item] of items.entries()){
                    const option=document.createElement('option');
                    option.value=String(i);option.textContent=labelFor(item);options.append(option);
                }
                select.append(options);populated=true;
            });
            select.addEventListener('change',async()=>{
                const ticket=++selection;
                current=select.value===''?null:items[Number(select.value)];
                showOriginal=false;
                if(!current){
                    body.replaceChildren();body.hidden=true;lastRendered=null;
                    if(controls)controls.hidden=true;
                    return;
                }
                if(!readEntry){render(textFor(current));return;}
                updateReader();
                await translations.load();
                if(!popup.dlg.open||ticket!==selection)return;
                if(!translatedLabelsApplied){
                    translatedLabelsApplied=true;
                    // Update existing option labels in place once; do not rebuild
                    // the select or hash every body. Source token counts stay put.
                    for(const option of select.options){
                        if(option.value==='')continue;
                        const row=items[Number(option.value)];
                        if(!row)continue;
                        const label=labelFor(row);
                        if(option.textContent!==label)option.textContent=label;
                    }
                }else{
                    const label=labelFor(current);
                    if(select.selectedOptions[0]?.textContent!==label&&select.selectedOptions[0])
                        select.selectedOptions[0].textContent=label;
                }
                updateReader();
            });
        };
        mountList('[data-health-entries]','[data-health-entry]','[data-health-body]',report.rows,
            row=>slothDisplayAnchorTitle(translations.title(row)||row.title||'UID '+row.uid,labels.lt)+' · '+labels[row.role]+' · '+(row.tokens===null?'—':amount(row.tokens)),row=>row.body,true);
        mountList('[data-health-repeats]','[data-health-repeat]','[data-health-repeat-body]',report.duplicates,
            item=>item.entries.map(e=>slothDisplayAnchorTitle(e.title||'UID '+e.uid,labels.lt)).join(' · '),item=>item.text);
        await popup.show();
        return {saved:false};
    }finally{collectorBusy=false;}
}

export async function applySlothNexusRecallSettings(){
    if(collectorBusy)throw new Error('A Sloth operation is already in progress.');
    collectorBusy=true;
    try{
        const settings=extension_settings.STMemoryBooks,ref=structuredClone(getCurrentStmbChatRef());
        const roles={nexus:getNexusRoleResolutionForChatRef('nexus',ref,settings).name,
            memory:getNexusRoleResolutionForChatRef('memory',ref,settings).name};
        const modes=stringify(getNexusRecallModes(settings.moduleSettings));
        const verifyOrigin=()=>{
            assertSlothBookRoles(ref,roles);
            if(modes!==stringify(getNexusRecallModes(extension_settings.STMemoryBooks.moduleSettings)))
                throw new Error('Nexus injection settings changed.');
        };
        verifyOrigin();
        const original=await loadServerWorld(roles.nexus);
        const {staged,changed,skipped}=stageNexusRecallSettings(original,settings.moduleSettings);
        if(!changed.length){
            toastr.info(t('No eligible entries need changes.','STMemoryBooks_SlothRecallNoChange'),'STMemoryBooks');
            return {saved:false};
        }
        const message=t('Change injection for {{count}} existing entries? Skipped: {{skipped}} (missing keywords or mixed roles).',
            'STMemoryBooks_SlothRecallApplyConfirm').replace('{{count}}',String(changed.length)).replace('{{skipped}}',String(skipped.length));
        const popup=new Popup(html(message),POPUP_TYPE.CONFIRM,'',{
            okButton:t('Apply','STMemoryBooks_Apply'),cancelButton:t('Cancel','STMemoryBooks_Cancel')});
        markStmbPopup(popup);
        if(await popup.show()!==POPUP_RESULT.AFFIRMATIVE)return {saved:false};
        verifyOrigin();
        await commitSlothNexusMigration({name:roles.nexus,original,staged},{
            loadFresh:loadServerWorld,save:(name,book)=>saveWorldInfo(name,book,true),
            verifyBeforeWrite:assertReviewedCache,verifyOrigin,
            resetCache:(name,book)=>worldInfoCache.set(name,structuredClone(book)),
            withLock:(name,task)=>withStmbWriteLane({type:'lorebook',name},task),
            operation:'Nexus injection settings',
        });
        await Promise.resolve(reloadEditor(roles.nexus));
        return {saved:true,changed:changed.length,skipped:skipped.length};
    }finally{collectorBusy=false;}
}

/** Explicit AI health review. Inspecting the ordinary health snapshot never calls AI. */
export async function runSlothNexusHealthReview({profileIndex,stConnectionProfileId,signal,onSaveStart}={}){
    if(collectorBusy)throw new Error('A Sloth operation is already in progress.');
    collectorBusy=true;
    const tr=healthReviewLabel;
    try{
        const settings=extension_settings.STMemoryBooks,ref=structuredClone(getCurrentStmbChatRef());
        if(ref?.type!=='character'||!ref.fileName)throw new Error(tr('NeedChat','Open an individual character chat first.'));
        const roles={nexus:getNexusRoleResolutionForChatRef('nexus',ref,settings).name,
            memory:getNexusRoleResolutionForChatRef('memory',ref,settings).name};
        const profile=collectionProfile(settings,profileIndex,stConnectionProfileId);
        if(!profile)throw new Error(tr('NeedProfile','Choose a collection AI profile first.'));
        const moduleSettings=structuredClone(settings.moduleSettings||{});
        const modes=stringify(getNexusRecallModes(moduleSettings));
        const verifyOrigin=()=>{
            signal?.throwIfAborted();
            assertSlothBookRoles(ref,roles);assertSideRenameReady(ref);
            if(getMemoryBooksMode(extension_settings.STMemoryBooks,ref,getStmbChatKey(ref))!=='sloth'||
                roles.nexus===roles.memory||modes!==stringify(getNexusRecallModes(extension_settings.STMemoryBooks.moduleSettings)))
                throw new Error(tr('Changed','The memory mode or recall settings changed. Start a new review.'));
        };
        const verifyRecovery=async()=>{
            if(await refreshSlothPaidDraft(ref))throw new Error(tr('Pending','Finish the pending collection recovery before changing Nexus.'));
            verifyOrigin();
        };
        verifyOrigin();
        const confirmation=markStmbPopup(new Popup('<div class="stmb-sloth-review"><h3>'+
            html(tr('Title','AI memory review and cleanup'))+'</h3><p>'+
            html(tr('Consent','Analyze memories with AI? Active Nexus memories are sent to the selected AI. Chats are not sent. Only approved changes are saved. AI usage may apply.'))+
            '</p><small>'+html(tr('Excluded','Protected, disabled and archived source entries are excluded.'))+'</small></div>',
            POPUP_TYPE.CONFIRM,'',{wide:false,allowVerticalScrolling:true,
                okButton:tr('Analyze','Analyze with AI'),cancelButton:t('Cancel','STMemoryBooks_Cancel')}));
        if(await showCollectionPopup(confirmation,signal)!==POPUP_RESULT.AFFIRMATIVE)return {saved:false};
        await verifyRecovery();
        const original=await loadServerWorld(roles.nexus,signal);
        verifyOrigin();assertReviewedCache(roles.nexus,original);
        const catalog=buildSlothHealthCatalog(original);
        if(!catalog.entries.length){
            toastr.info(tr('Empty','No eligible Nexus entries to review.'),'STMemoryBooks');
            return {saved:false};
        }
        const review=await suggestSlothNexusHealthReview({catalog,profile,settings,signal,verifyOrigin,
            language:tr('Language','English')});
        verifyOrigin();
        if(stringify(await loadServerWorld(roles.nexus,signal))!==stringify(original))
            throw new Error(tr('Stale','Nexus changed during the review. Nothing was saved.'));
        verifyOrigin();assertReviewedCache(roles.nexus,original);
        const approved=await showSlothHealthReviewFindings({review,catalog,original,moduleSettings,
            showPopup:popup=>showCollectionPopup(popup,signal)});
        if(!approved)return {saved:false};
        await verifyRecovery();
        const actual=stageSlothHealthReviewBatch(original,approved.findings,{moduleSettings,
            createEntry:book=>createWorldInfoEntry(roles.nexus,book)});
        // The preview allocates a provisional new UID. All visible text,
        // title, flags and keywords must otherwise match the final stage.
        const visible=changes=>changes.map(({uid,...change})=>({...change,...(change.before!==null?{uid}:{})}));
        if(stringify(visible(actual.changes))!==stringify(visible(approved.changes)))
            throw new Error(tr('Stale','Nexus changed during the review. Nothing was saved.'));
        verifyOrigin();onSaveStart?.();
        await commitSlothNexusMigration({name:roles.nexus,original,staged:actual.staged},{
            loadFresh:loadServerWorld,save:(name,book)=>saveWorldInfo(name,book,true),
            verifyBeforeWrite:assertReviewedCache,verifyOrigin,
            resetCache:(name,book)=>worldInfoCache.set(name,structuredClone(book)),
            withLock:(name,task)=>withStmbWriteLane({type:'lorebook',name},task),
            operation:'Nexus health review',
        });
        try{await Promise.resolve(reloadEditor(roles.nexus));}
        catch(error){console.warn('🦥 STMemoryBooks','Nexus health editor refresh failed.',error);}
        toastr.success(tr('Saved','Reviewed Nexus change saved.'),'STMemoryBooks');
        return {saved:true,changed:actual.changes.length};
    }finally{collectorBusy=false;}
}

async function settleSlothAutoAttempt(ref,attempt,status) {
    if (!ref||!attempt||getStmbChatKey()!==attempt.chatKey) return;
    try {
        await patchVerifiedSlothMetadata(ref,markers=>{
            const current=markers.slothAutomatic;
            if (current?.attemptId!==attempt.attemptId||current.chatKey!==attempt.chatKey||
                stringify(current.books)!==stringify(attempt.books)) return markers;
            return {...markers,slothAutomatic:{...current,status}};
        });
    } catch(error) { console.warn('🦥 STMemoryBooks', 'Automatic collection status could not be saved.',error); }
    invalidateSlothAutomaticProgress();
}

function collectionProfile(settings, profileIndex, stConnectionProfileId) {
    return stConnectionProfileId ? {stConnectionProfileId} :
        settings.profiles?.[profileIndex ?? settings.defaultProfile] || settings.profiles?.[settings.defaultProfile];
}

export async function runNexusCollector({profileIndex, stConnectionProfileId, automaticChatKey='', signal, onSaveStart}={}) {
    if(collectorBusy) {
        if (automaticChatKey) return {saved:false,reason:'busy'};
        throw new Error('A Sloth collection is already in progress.');
    }
    collectorBusy=true;
    let progressChatKey = '';
    let activeDraft=null;
    let attemptedAuto=null,attemptedRef=null;
    const collectionStartedAt=Date.now();let runMetric=null,commitStarted=false;
    try {
        signal?.throwIfAborted();
        const settings=extension_settings.STMemoryBooks;
        const ref=structuredClone(getCurrentStmbChatRef());
        const automatic=automaticChatKey ? getSlothAutomaticSettings(settings) : null;
        const reviewSummaries=settings.moduleSettings?.slothSummaryReview===true;
        if (automatic && (!automatic.enabled || getStmbChatKey(ref)!==automaticChatKey || ref?.type!=='character'))
            return {saved:false,reason:'inactive-chat'};
        if(ref.type!=='character')throw new Error('Sloth collection currently supports individual character chats only.');
        if (getMemoryBooksMode(settings, ref, getStmbChatKey(ref)) !== 'sloth') {
            if (automatic) return {saved:false,reason:'mode-inactive'};
            throw new Error(t('Choose Sloth mode in Memory Books settings first.', 'STMemoryBooks_ModeSlothRequired'));
        }
        if(hasPendingSlothSideRename(ref)){
            if(automatic)return {saved:false,reason:'rename-pending'};
            assertSideRenameReady(ref);
        }
        const roles={
            memory:getNexusRoleResolutionForChatRef('memory',ref,settings),
            nexus:getNexusRoleResolutionForChatRef('nexus',ref,settings),
        };
        const initial=canStartNexusSetup(ref,settings);
        if (automatic && (initial || roles.memory.state!=='ready' || roles.nexus.state!=='ready' ||
            roles.memory.name===roles.nexus.name)) return {saved:false,reason:'books-unavailable'};
        if(!initial&&(roles.memory.state!=='ready'||roles.nexus.state!=='ready'||
            roles.memory.name===roles.nexus.name)) {
            throw new Error('Assign two existing, linked, different Nexus and Memory lorebooks first.');
        }
        const character=getActiveNexusRoleContext(settings).character;
        const roleNames=initial?proposeNexusBookNames(character):
            {memory:roles.memory.name,nexus:roles.nexus.name};
        // The automatic checkpoint throttles attempts; it is not a collection
        // receipt. A paid failed draft pauses auto requests until reviewed.
        if (automatic&&getPaidSlothDraft(ref)&&await refreshSlothPaidDraft(ref)) {
            invalidateSlothAutomaticProgress();
            return {saved:false,reason:'recovery-pending'};
        }
        const previousAuto = automatic ? structuredClone(getSceneMarkers().slothAutomatic) : null;
        const checkpoint = previousAuto?.chatKey === automaticChatKey && previousAuto?.through < chat.length ?
            previousAuto : null;
        const countAutomaticTokens = createAutomaticTokenCounter(getTokenCountAsync);
        // Only use the byte bound for a known host tiktoken path. Remote and
        // other tokenizers always get the original exact check.
        const knownTiktoken = automatic?.mode === 'tokens' && main_api === 'openai' &&
            /^(?:gpt-[345](?:[.o-]|$)|o[134](?:-|$)|chatgpt-4o)/i.test(String(getTokenizerModel() || ''));
        const automaticUpperBound = knownTiktoken ? automaticByteBound : undefined;
        const through = getAutomaticCheckpointThrough(checkpoint,roleNames);
        const revision = automaticReadingRevision;
        const readingLength = chat.length;
        const publishReading = (reading, checkedThrough = through) => {
            if (revision !== automaticReadingRevision || getStmbChatKey() !== automaticChatKey || chat.length !== readingLength) return;
            automaticReading = {...reading,chatKey:automaticChatKey,...roleNames,mode:automatic.mode,
                length:readingLength,through:checkedThrough};
        };
        const thresholdMet = source => automaticCollectionDue({
            source,previous:checkpoint,books:roleNames,mode:automatic.mode,
            threshold:automatic.threshold,countTokens:countAutomaticTokens,upperBound:automaticUpperBound,
            onReading:publishReading,
        });
        // The chat receipt is enough to check an upper bound without fetching
        // either book at every reply. Saved older book entries can narrow this
        // set further, which is checked before starting an AI request.
        const pending = automatic ? activeSource(ref,null,roleNames,through).source : null;
        if (automatic && !await thresholdMet(pending)) return {saved:false,reason:'below-threshold'};
        let previousDraft=await refreshSlothPaidDraft(ref);
        if(getStmbChatKey()!==getStmbChatKey(ref))throw slothWriteConflict();
        if(automatic&&previousDraft){
            invalidateSlothAutomaticProgress();
            return {saved:false,reason:'recovery-pending'};
        }
        const key=getStmbChatKey(ref);
        const fallbackAtStart=slothPaidDrafts.get(key);
        const recoveryBaseline=fallbackAtStart?fallbackAtStart.expectedRevision:slothRecoverySnapshots.get(key)?.revision;
        const originalBooks=initial?{nexus:{entries:{}},memory:{entries:{}}}:{
            nexus:await loadServerWorld(roleNames.nexus,signal),
            memory:await loadServerWorld(roleNames.memory,signal),
        };
        if(getStmbChatKey()!==getStmbChatKey(ref)) {
            throw new Error('The chat changed while its lorebooks were loading. Start collection from the original chat.');
        }
        const {source:liveSource,prior,reviewed}=activeSource(ref,originalBooks.memory,roleNames);
        let source=liveSource,partialReplay=null,rawDraft=null;
        // A partial save legitimately changes the books and removes collected
        // IDs from activeSource. Reuse the original input only against the
        // verified postcommit snapshot, including already hidden source turns.
        const booksFingerprint=[digestSlothSnapshot(originalBooks.nexus),digestSlothSnapshot(originalBooks.memory)];
        if(!automatic&&!initial&&previousDraft?.partial) {
            const receipt=previousDraft.partial;
            let originalFingerprint=null;
            try { originalFingerprint=digestSlothSnapshot(fingerprintSlothChat(chat,receipt.sourceIds,{allowHidden:true})); }
            catch { /* The old source is unavailable; keep the response read only. */ }
            if(originalFingerprint&&canReplaySlothPartial(previousDraft,{chatKey:getStmbChatKey(ref),
                roles:roleNames,books:booksFingerprint,fingerprint:originalFingerprint})) {
                const choice=await choosePaidSlothDraft(previousDraft,null,signal,{partialReplay:true});
                if(!choice) return {saved:false,reason:'recovery-cancelled'};
                if(typeof choice.raw==='string') {
                    partialReplay=receipt;rawDraft=choice.raw;
                    source=receipt.sourceIds.map(id=>{
                        const entry=chat[id];
                        return {id,name:String(entry.name||''),mes:entry.mes,is_user:!!entry.is_user,send_date:entry.send_date||null};
                    });
                    // The review dialog can remain open while the user edits a chat.
                    if(digestSlothSnapshot(fingerprintSlothChat(chat,receipt.sourceIds,{allowHidden:true})).join(':')!==originalFingerprint.join(':'))
                        throw new Error('Original source changed during recovery.');
                } else previousDraft=null; // explicitly chose a new paid request
            }
        }
        if(!source.length){
            if (automatic) return {saved:false,reason:'no-source'};
            if (previousDraft) {
                const choice=await choosePaidSlothDraft(previousDraft,null,signal,{noSource:true});
                if (choice?.dismiss&&getStmbChatKey()===getStmbChatKey(ref)) await forgetPaidSlothDraft(ref,previousDraft);
            }
            toastr.info(t('No new visible messages need collection.','STMemoryBooks_SlothNoSource'),'STMemoryBooks');
            return {saved:false,reason:'no-source'};
        }
        const sourceIds=source.map(s=>s.id);
        const fingerprintOptions=partialReplay?{allowHidden:true}:undefined;
        const fingerprint=fingerprintSlothChat(chat,sourceIds,fingerprintOptions);
        const profile=collectionProfile(settings, profileIndex, stConnectionProfileId);
        if(!profile)throw new Error('Choose an AI profile before starting Sloth collection.');
        const characterContext=initialCharacterContext(character);
        const nexusOptions={detailRecallMode:settings.moduleSettings?.nexusDetailRecallMode==='keyword'?'keyword':'vector',recallModes:structuredClone(settings.moduleSettings?.nexusRecallModes)};
        const checkOrigin=()=>{
            assertSideRenameReady(ref);
            assertSlothLegacyCoverage(reviewed);
            if (automatic) {
                const now = getSlothAutomaticSettings(extension_settings.STMemoryBooks);
                if (!now.enabled || now.mode !== automatic.mode || now.threshold !== automatic.threshold)
                    throw new Error('Automatic collection settings changed.');
            }
            if(!initial)return assertOrigin(ref,roleNames,sourceIds,fingerprint,fingerprintOptions);
            if(getStmbChatKey()!==getStmbChatKey(ref)||!canStartNexusSetup(ref,settings)||
                initialCharacterContext(getActiveNexusRoleContext(settings).character)!==characterContext||
                fingerprintSlothChat(chat,sourceIds)!==fingerprint) {
                throw new Error('The original chat, character or lorebook setup changed. Verify it before retrying.');
            }
        };
        const checkBeforeSave=()=>{
            signal?.throwIfAborted();
            checkOrigin();
        };
        if(initial){
            await listNexusSetupBooks(ref.avatarUrl);
        }
        checkBeforeSave();
        // Check the authoritative pending range before spending time splitting the
        // source. An identical preflight needs neither a second count nor a join.
        if (automatic) {
            const remaining = source.filter(message => message.id > through);
            if ((remaining.length !== pending.length ||
                remaining.some((message,i)=>message.id !== pending[i]?.id || message.mes !== pending[i]?.mes)) &&
                !await thresholdMet(remaining)) return {saved:false,reason:'below-threshold'};
        }
        checkBeforeSave();
        const [currentChunk,...laterChunks]=partialReplay?[source.filter(message=>partialReplay.chunkIds.includes(message.id))]:
            await splitSlothCollectionSource(source,getTokenCountAsync);
        checkBeforeSave();
        const partialSource=partialReplay?partialReplay.partialSource===true:laterChunks.length>0;
        const draftBinding=partialReplay?previousDraft.binding:{chatKey:getStmbChatKey(ref),roles:roleNames,source:currentChunk.map(m=>m.id),
            fingerprint:digestSlothSnapshot(fingerprint),books:booksFingerprint};
        if (partialReplay) {
            activeDraft=await rememberPaidSlothDraft(ref,draftBinding,rawDraft,{partial:partialReplay,
                originalRaw:previousDraft.originalRaw??previousDraft.raw,
                ...([1,2,3,4].includes(previousDraft.evidencePolicyVersion)?{evidencePolicyVersion:previousDraft.evidencePolicyVersion}:{})},recoveryBaseline);
        } else if (previousDraft) {
            if (automatic) {
                if (sameSlothDraftBinding(previousDraft,draftBinding))
                    return {saved:false,reason:'recovery-pending'};
            } else {
                const choice=await choosePaidSlothDraft(previousDraft,draftBinding,signal);
                if (!choice) return {saved:false,reason:'recovery-cancelled'};
                rawDraft=choice.raw;
                checkBeforeSave();
                if (typeof rawDraft==='string')
                    activeDraft=await rememberPaidSlothDraft(ref,draftBinding,rawDraft,{
                        originalRaw:previousDraft.originalRaw??previousDraft.raw,
                        ...([1,2,3,4].includes(previousDraft.evidencePolicyVersion)?{evidencePolicyVersion:previousDraft.evidencePolicyVersion}:{})},recoveryBaseline);
            }
        }
        const autoAttempt=automatic ? {chatKey:automaticChatKey,through:sourceIds.at(-1),books:roleNames,
            status:'running',attemptId:Date.now()} : null;
        const autoWindow=autoAttempt && partialSource ? {attempt:autoAttempt,through:currentChunk.at(-1).id} : null;
        if (automatic) {
            await readReviewedChat(ref,sourceIds,fingerprint);
            await patchVerifiedSlothMetadata(ref,markers=>{
                checkOrigin();
                if (stringify(markers.slothAutomatic)!==stringify(previousAuto))
                    throw new Error('Automatic collection already advanced for this chat.');
                return {...markers,slothAutomatic:autoAttempt};
            });
            attemptedAuto=autoAttempt;attemptedRef=ref;
            invalidateSlothAutomaticProgress();
        } else {
            toastr.info(t('Analyzing causal events in the unsaved chat...','STMemoryBooks_SlothAnalyzing'),'STMemoryBooks');
        }
        // Record eligible collection chunks, not idle automatic threshold checks.
        runMetric=createSlothCollectionRun({ids:currentChunk.map(message=>message.id),startedAt:collectionStartedAt,automatic:!!automatic,replayed:typeof rawDraft==='string',initial,partialSource,reviewSummaries,evidencePolicyVersion:typeof rawDraft!=='string'?4:(activeDraft?.evidencePolicyVersion??0)});
        const onRequestMetric=metric=>addSlothRequestMetric(runMetric,metric);
        // Also refuse a new paid request/replay if the loaded chat is already stale.
        requireDurableSlothDraft(ref,activeDraft);
        await readCurrentSlothChatForWrite(ref);
        checkBeforeSave();
        progressChatKey = getStmbChatKey(ref);
        const showProgress = (source, key) => setSlothCollectionProgress(progressChatKey, t(source, key));
        showProgress('Writing memories', 'STMemoryBooks_SlothProgressWriting');
        const collection=await composeSingleSlothCollection({nexus:originalBooks.nexus,memory:originalBooks.memory,
            messages:currentChunk,profile,settings,initial,characterContext,partialSource,signal,
            reviewSummaries,verifyOrigin:checkBeforeSave,rawDraft,onRequestMetric,
            strictNexusEvidence:typeof rawDraft!=='string'||[1,2,3,4].includes(activeDraft?.evidencePolicyVersion),
            evidencePolicyVersion:typeof rawDraft!=='string'?4:(activeDraft?.evidencePolicyVersion??0),
            lockedScenes:partialReplay?.lockedScenes??[],committedEdits:partialReplay?.committedEdits??[],
            onDraft:async raw=>{
                activeDraft=await rememberPaidSlothDraft(ref,draftBinding,raw,{evidencePolicyVersion:4},recoveryBaseline);
                requireDurableSlothDraft(ref,activeDraft);
            }});
        checkBeforeSave();
        const {plan,scenes,edits,skippedNexusEdits,reviewFailed,skippedScenes}=collection;
        const needsRecovery=Boolean(skippedScenes||skippedNexusEdits||collection.recoveryUncertain);
        Object.assign(runMetric.counts,{sceneProposed:collection.collectionProposals?.scenes??null,nexusProposed:collection.collectionProposals?.nexusEdits??null,sceneAccepted:scenes.length,nexusAccepted:edits.length,sceneHeld:skippedScenes,nexusHeld:skippedNexusEdits,pendingMessages:collection.pendingRanges?.reduce((n,[start,end])=>n+end-start+1,0)??null,sideSaved:0});
        const approval={hideRanges:!automatic&&settings.moduleSettings?.slothHideAfter===true
            ? getSlothHideRanges(scenes,chat,normalizeSlothVisibleTail(settings.moduleSettings?.slothHideRecent)) : [],
            keepRecent:normalizeSlothVisibleTail(settings.moduleSettings?.slothHideRecent)};
        const approvedSidePresets=automatic?[]:getRunnableSlothSidePresets(settings,ref);
        showProgress('Validating memories','STMemoryBooks_SlothValidating');
        const showSkipped=()=>{
            if (automatic&&!needsRecovery) return;
            if (skippedScenes) toastr.warning(t('{{count}} planned memories were incomplete and were skipped.',
                'STMemoryBooks_SlothCollectionSkippedScenes').replace('{{count}}',String(skippedScenes)),'STMemoryBooks');
            if (skippedNexusEdits) toastr.warning(t('Skipped {{count}} Nexus changes that could not be verified.',
                'STMemoryBooks_SlothCollectionSkippedNexus').replace('{{count}}',String(skippedNexusEdits)),'STMemoryBooks');
            if (reviewFailed) toastr.warning(t('Summary review failed. The original drafts were kept.',
                'STMemoryBooks_SlothSummaryReviewFailed'),'STMemoryBooks');
            if (needsRecovery) toastr.warning(t('The received response was retained. Valid memories are saved independently; unverified source stays available.',
                'STMemoryBooks_SlothPaidDraftRetained'),'STMemoryBooks');
        };
        if(!scenes.length&&!edits.length){
            if (!needsRecovery) await forgetPaidSlothDraft(ref,activeDraft);
            else if(activeDraft&&collection.pendingDraft?.recoveryIssues?.length){
                // Even an entirely rejected response keeps its immutable paid
                // original and an editable draft with the local failure reasons.
                activeDraft=await rememberPaidSlothDraft(ref,draftBinding,JSON.stringify(collection.pendingDraft,null,2),{
                    ...(activeDraft.partial?{partial:activeDraft.partial}:{}),
                    originalRaw:activeDraft.originalRaw??activeDraft.raw,
                    ...([1,2,3,4].includes(activeDraft.evidencePolicyVersion)?{evidencePolicyVersion:activeDraft.evidencePolicyVersion}:{})},
                    slothRecoveryStore.revisionFor(key,activeDraft));
            }
            showSkipped();
            if (!automatic) toastr.info(t('There are no completed events or Nexus changes to save.',
                'STMemoryBooks_SlothNoCompleted'),'STMemoryBooks');
            runMetric.status=needsRecovery?'held':'empty';
            Object.assign(runMetric.counts,{sceneCreated:0,sceneReused:0,nexusCreated:0,nexusUpdated:0,nexusEditsSaved:0});
            runMetric.recoveryVerified=needsRecovery?!!activeDraft&&!slothPaidDrafts.has(key):null;
            await settleSlothAutoAttempt(attemptedRef,attemptedAuto,needsRecovery?'recovery':'checked');
            return {saved:false,reason:'no-complete-events-or-deltas'};
        }

        const states=[];
        let savedEntries=[],nexusChanges=[],reusedScenes=0;
        if(scenes.length||initial) {
            const memoryStage=scenes.length?stageMemoryScenes(originalBooks.memory,scenes,
                book=>createWorldInfoEntry(roleNames.memory,book),{
                    chatId:String(ref.fileName||''),
                    olderMode:settings.moduleSettings?.nexusOlderSceneMode==='keyword'?'keyword':'vector',
                }):null;
            const staged=memoryStage?.staged??structuredClone(originalBooks.memory);
            if(memoryStage){
                savedEntries=memoryStage.writes.filter(write=>!write.reused).map(({uid})=>staged.entries[uid]);
                reusedScenes=memoryStage.writes.filter(write=>write.reused).length;
            }
            states.push({name:roleNames.memory,original:originalBooks.memory,staged});
        }
        if(edits.length||initial) {
            const nexusStage=stageNexusEdits(originalBooks.nexus,edits,
                book=>createWorldInfoEntry(roleNames.nexus,book),nexusOptions);
            nexusChanges=nexusStage.changes;
            states.push({name:roleNames.nexus,original:originalBooks.nexus,staged:nexusStage.staged});
        }
        if(initial){
            for(const state of states){
                const other=state.name===roleNames.nexus?'memory':'nexus';
                state.staged.extensions={stmbNexusSetup:{version:1,avatar:ref.avatarUrl,
                    role:other==='memory'?'nexus':'memory',pairedBook:roleNames[other]}};
            }
        }
        await verifyDurableSlothDraft(ref,activeDraft);
        await readReviewedChat(ref,sourceIds,fingerprint,{...fingerprintOptions,requireCurrentChat:true,verifyStored: stored => {
            const storedCoverage=getSlothLegacyCoverage(stored[0].chat_metadata.STMemoryBooks,getStmbChatKey(ref),roleNames);
            if (stringify(storedCoverage) !== stringify(reviewed)) throw new Error('The reviewed ranges changed during collection.');
            assertSlothLegacyCoverage(reviewed,stored.slice(1));
        }});
        signal?.throwIfAborted();
        onSaveStart?.();
        showProgress('Saving', 'STMemoryBooks_Jobs_Saving');
        const commitOptions={
            loadFresh:loadServerWorld,save:(name,book)=>saveWorldInfo(name,book,true),
            verifyBeforeWrite:assertReviewedCache,
            resetCache:(name,original)=>worldInfoCache.set(name,structuredClone(original)),
            verifyOrigin:checkOrigin,
        };
        commitStarted=true;
        const outcome=initial?await saveInitialNexusCollection(states,{ref,roleNames,checkOrigin,settings}):
            states.length===1?await commitSlothNexusMigration(states[0],{
                ...commitOptions,operation:scenes.length?'Memory Scene save':'Nexus current-state update',
                withLock:(name,task)=>withStmbWriteLane({type:'lorebook',name},task),
            }):await commitSlothBooks(states,{...commitOptions,withLocks:withBothWriteLanes});
        commitStarted=false;
        const newNexus=new Set(nexusChanges.filter(change=>change.action==='create').map(change=>change.uid));
        const updatedNexus=new Set(nexusChanges.filter(change=>change.action!=='create'&&!newNexus.has(change.uid)).map(change=>change.uid));
        Object.assign(runMetric.counts,{sceneCreated:savedEntries.length,sceneReused:reusedScenes,nexusCreated:newNexus.size,nexusUpdated:updatedNexus.size,nexusEditsSaved:nexusChanges.length});
        runMetric.status='partial'; // verified writes; receipt/remaining stages not yet finished

        // Only the successful, read-back-verified write is allowed to advance
        // a partial replay's trusted baseline. Keep the original paid text too.
        const persistPartial=async()=>{
            if (!activeDraft) return false;
            const after=role=>states.find(state=>state.name===roleNames[role])?.staged??originalBooks[role];
            const partial={version:1,sourceIds:[...sourceIds],chunkIds:currentChunk.map(message=>message.id),
                partialSource,books:[digestSlothSnapshot(after('nexus')),digestSlothSnapshot(after('memory'))],
                lockedScenes:scenes,committedEdits:collection.committedEdits??[]};
            activeDraft=await rememberPaidSlothDraft(ref,draftBinding,JSON.stringify(collection.pendingDraft,null,2),
                {partial,originalRaw:activeDraft.originalRaw??activeDraft.raw,
                    ...([1,2,3,4].includes(activeDraft.evidencePolicyVersion)?{evidencePolicyVersion:activeDraft.evidencePolicyVersion}:{})},
                slothRecoveryStore.revisionFor(key,activeDraft));
            return !slothPaidDrafts.has(key);
        };
        let recoveryVerified=!needsRecovery||await persistPartial();
        let receiptVerified=false;
        if(scenes.length){
            try {
                await updateCollectedLedger(prior,scenes,ref,roleNames,sourceIds,fingerprint,autoWindow,fingerprintOptions);
                receiptVerified=true;
                if (!automatic || autoWindow) invalidateSlothAutomaticProgress();
            } catch (error) {
                console.warn('🦥 STMemoryBooks', 'Memory Books saved, but the chat receipt could not be verified.',error);
            }
        }
        if(!needsRecovery&&scenes.length&&!receiptVerified) recoveryVerified=await persistPartial();
        const hideRanges = approval.hideRanges.length ? getSlothHideRanges(scenes,chat,approval.keepRecent) : [];
        let hiddenMessages=0;
        if (hideRanges.length) {
            try {
                if (!recoveryVerified) throw new Error('The partial recovery file could not be verified.');
                if (!receiptVerified) throw new Error('The stored collection receipt could not be verified.');
                let remaining = [...sourceIds];
                assertOrigin(ref,roleNames,remaining,fingerprint,fingerprintOptions);
                for (const [start,end] of hideRanges) {
                    const expected = fingerprintSlothChat(chat,remaining.filter(id=>id<start||id>end),fingerprintOptions);
                    await readCurrentSlothChatForWrite(ref);
                    await hideChatMessageRange(start,end,false);
                    remaining = remaining.filter(id=>id<start||id>end);
                    assertOrigin(ref,roleNames,remaining,expected,fingerprintOptions);
                }
                await readReviewedChat(ref,sourceIds,fingerprint,{allowHidden:true},hideRanges);
                hiddenMessages=hideRanges.reduce((count,[start,end])=>count+end-start+1,0);
            } catch (error) {
                hiddenMessages=null; // no claim about an unverified partial Hide
                console.warn('🦥 STMemoryBooks', 'Memory saved; Sloth Hide stopped.',error);
                toastr.warning(t('The memories are saved. Check which messages were hidden before trying again.',
                    'STMemoryBooks_SlothHideInterrupted'),'STMemoryBooks');
            }
        }
        for(const {name} of states){
            try{await Promise.resolve(reloadEditor(name));}
            catch(error){console.warn('🦥 STMemoryBooks', 'Memory Books editor refresh failed.',error);}
        }
        if (!needsRecovery&&(!scenes.length||receiptVerified)) await forgetPaidSlothDraft(ref,activeDraft);
        await settleSlothAutoAttempt(attemptedRef,attemptedAuto,needsRecovery||scenes.length&&!receiptVerified?'recovery':'saved');
        const message=scenes.length&&edits.length
            ?t('Memory saved and Nexus updated.','STMemoryBooks_SlothCollectionSavedBoth')
            :scenes.length?t('Completed events saved to Memory.','STMemoryBooks_SlothSceneOnlySaved')
                :t('Nexus updated.','STMemoryBooks_SlothNexusOnlySaved');
        if(!automatic){
            const usage=collection.inputTokens===null?'':' · '+t(collection.inputTokensExact?'Input: {{count}} tokens':'Input: ~{{count}} tokens',
                collection.inputTokensExact?'STMemoryBooks_SlothInputTokens':'STMemoryBooks_SlothInputEstimate')
                .replace('{{count}}',Number(collection.inputTokens).toLocaleString());
            const hidden=hiddenMessages===null?'':' · '+t('Hidden: {{count}} messages','STMemoryBooks_SlothCollectionHiddenCount')
                .replace('{{count}}',String(hiddenMessages));
            toastr.success(message+hidden+usage,'STMemoryBooks');
        }
        showSkipped();
        runMetric.receiptVerified=scenes.length?receiptVerified:null;
        runMetric.recoveryVerified=needsRecovery||scenes.length&&!receiptVerified?recoveryVerified:null;
        let sidePromptsSaved=0,sideFailed=false;
        if (savedEntries.length && approvedSidePresets.length) {
            try {
                assertSlothBookRoles(ref, roleNames);
                const ids=[...new Set(scenes.flatMap(scene=>scene.messageIds))].sort((a,b)=>a-b);
                const options={allowHidden:true};
                const reviewed=fingerprintSlothChat(chat,ids,options);
                const verifyOrigin=()=>{signal?.throwIfAborted();assertOrigin(ref,roleNames,ids,reviewed,options);};
                const verifySource=async()=>{
                    await readReviewedChat(ref,ids,reviewed,options);
                    const stored=await loadServerWorld(roleNames.memory);
                    if(savedEntries.some(entry=>stringify(stored.entries[entry.uid])!==stringify(entry))) {
                        throw new Error('A saved Scene changed during Side Prompt review.');
                    }
                };
                showProgress('Writing Side Prompts','STMemoryBooks_SlothSideProgress');
                const side=await runReviewedSlothSidePrompts({ref,roles:roleNames,profile,signal,verifyOrigin,verifySource,
                    presets:approvedSidePresets,onRequestMetric,onSaved:count=>{runMetric.counts.sideSaved=count;},onSaveFailure:()=>{sideFailed=true;},
                    source:{ids,entry:{content:savedEntries.map(entry=>entry.content).join('\n\n')}}});
                sidePromptsSaved=side.count??0;
                runMetric.counts.sideSaved=sidePromptsSaved;
                sideFailed ||= !!side.failed?.length;
            } catch (error) {
                sideFailed=true;
                console.warn('🦥 STMemoryBooks', 'Memories saved; Side Prompts stopped.',error);
                if(!signal?.aborted) toastr.warning(t('Memory is saved. Run Side Prompts again from a saved scene.',
                    'STMemoryBooks_SlothSideAfterFailure'),'STMemoryBooks');
            }
        }
        runMetric.status=needsRecovery||scenes.length&&!receiptVerified||hiddenMessages===null||reviewFailed||sideFailed?'partial':collection.replayed?'recovered':'saved';
        return {saved:true,scenes:scenes.length,nexusEdits:edits.length,skippedScenes,skippedNexusEdits,
            receiptVerified,recoveryVerified,sidePromptsSaved,hiddenMessages,inputTokens:collection.inputTokens,inputTokensExact:collection.inputTokensExact,result:outcome};
    }catch(error){
        if(runMetric){
            if(commitStarted)runMetric.status='uncertain'; // no verified save count after an interrupted transaction
            else if(runMetric.status!=='partial')runMetric.status=error?.code==='STMB_SLOTH_INPUT_BUDGET'?'blocked':signal?.aborted?'cancelled':activeDraft?'held':'failed';
            if(activeDraft)runMetric.recoveryVerified=!slothPaidDrafts.has(activeDraft.binding.chatKey);
        }
        await settleSlothAutoAttempt(attemptedRef,attemptedAuto,activeDraft?'recovery':'failed');
        if(activeDraft&&!signal?.aborted) toastr.warning(t('The received AI response was retained. Press collect again to review or reuse it without another AI request.',
            'STMemoryBooks_SlothPaidDraftFailed'),'STMemoryBooks');
        throw error;
    }finally{
        if(runMetric)recordSlothCollectionRun(runMetric);
        collectorBusy=false;
        if (progressChatKey) setSlothCollectionProgress(progressChatKey, '');
    }
}

function isVisibleSceneMessage(id) {
    const message=chat[id];
    return !!message&&!message.is_system&&typeof message.mes==='string'&&!!message.mes.trim();
}

export async function runSlothSceneCompression({ profileIndex, stConnectionProfileId } = {}) {
    if (collectorBusy) throw new Error('A Sloth operation is already in progress.');
    collectorBusy = true;
    try {
        const settings = extension_settings.STMemoryBooks;
        const ref = structuredClone(getCurrentStmbChatRef());
        const roles = Object.fromEntries(['nexus','memory'].map(role=>[role,getNexusRoleResolutionForChatRef(role,ref,settings).name]));
        const verifyOrigin = () => assertSlothBookRoles(ref,roles);
        verifyOrigin();
        const original = await loadServerWorld(roles.memory);
        verifyOrigin();
        const candidates = Object.values(original.entries).filter(entry=>isCompletedSceneEntry(entry) && getCompressibleScene(entry)).reverse();
        if (!candidates.length) {
            toastr.info(t('There are no saved events long enough to shorten.','STMemoryBooks_SlothCompressEmpty'),'STMemoryBooks');
            return {saved:false};
        }
        const focusOptions = [
            ['voice',t('Distinctive dialogue and humor','STMemoryBooks_SlothCompressVoice')],
            ['relationships',t('Relationships and emotions','STMemoryBooks_SlothCompressRelationships')],
            ['recall',t('Objects, places and recall cues','STMemoryBooks_SlothCompressRecall')],
        ];
        const title = html(t('Shorten an event','STMemoryBooks_SlothCompress'));
        const choice = new Popup(DOMPurify.sanitize(`<div class="stmb-sloth-review stmb-sloth-form"><h3>${title}</h3>
            <label class="stmb-sloth-edit">${html(t('Saved event','STMemoryBooks_SlothSidePromptSource'))}
              <select id="stmb-sloth-compress-source" class="text_pole">${candidates.map((entry,index)=>`<option value="${index}">${html(entry.comment)}</option>`).join('')}</select></label>
            <label class="stmb-sloth-edit">${html(t('Length to keep','STMemoryBooks_SlothCompressAmount'))}
              <select id="stmb-sloth-compress-length" class="text_pole">${SLOTH_COMPRESSION_AMOUNTS.map(value=>`<option value="${value}" ${value===55?'selected':''}>${value}%</option>`).join('')}</select></label>
            <fieldset class="stmb-sloth-focus"><legend>${html(t('Give extra priority to','STMemoryBooks_SlothCompressFocus'))}</legend>
              ${focusOptions.map(([key,label])=>`<label class="checkbox_label"><input name="stmb-sloth-compress-focus" type="checkbox" value="${key}" checked> ${html(label)}</label>`).join('')}
            </fieldset></div>`), POPUP_TYPE.CONFIRM, '', {wide:true,allowVerticalScrolling:true,
            okButton:t('Make a shorter draft','STMemoryBooks_SlothCompressGenerate'),cancelButton:t('Cancel','STMemoryBooks_Cancel')});
        markStmbPopup(choice);
        if (await choice.show()!==POPUP_RESULT.AFFIRMATIVE) return {saved:false};
        verifyOrigin();
        const entry = candidates[Number(choice.dlg.querySelector('#stmb-sloth-compress-source').value)];
        const amount = Number(choice.dlg.querySelector('#stmb-sloth-compress-length').value);
        const focus = Array.from(choice.dlg.querySelectorAll('input[name="stmb-sloth-compress-focus"]:checked'),control=>control.value);
        const profile = collectionProfile(settings,profileIndex,stConnectionProfileId);
        let next;
        try { next=await compressSlothScene({entry,amount,focus,profile,settings,verifyOrigin}); }
        catch (cause) {
            if (!['STMB_SLOTH_COMPRESSION_FORMAT','STMB_SLOTH_COMPRESSION_VOICE','STMB_SLOTH_MALFORMED_JSON'].includes(cause.code)) throw cause;
            throw new Error(t('The draft did not meet the selected compression conditions. Try another length.','STMemoryBooks_SlothCompressInvalid'),{cause});
        }
        const compare = (label,text) => `<div><p>${html(label)}</p><pre>${html(text)}</pre></div>`;
        const originalParts=getCompressibleScene(entry);
        const kept = Math.round((next.content.length-originalParts.before.length-originalParts.after.length) * 100 / originalParts.scene.length);
        const amountLabel = t('Target {{target}}% · Draft {{actual}}%', 'STMemoryBooks_SlothCompressActual')
            .replace('{{target}}',amount).replace('{{actual}}',kept);
        const review = new Popup(DOMPurify.sanitize(`<div class="stmb-sloth-review"><h3>${title}</h3><strong>${html(entry.comment)}</strong>
            <small>${html(amountLabel)}</small>
            <div class="stmb-sloth-comparison has-before">${compare(t('Before','STMemoryBooks_Regeneration_Before'),entry.content)}
            ${compare(t('After','STMemoryBooks_Regeneration_After'),next.content)}</div></div>`), POPUP_TYPE.CONFIRM, '',
            {wide:true,allowVerticalScrolling:true,okButton:t('Save','STMemoryBooks_Save'),cancelButton:t('Cancel','STMemoryBooks_Cancel')});
        markStmbPopup(review);
        if (await review.show()!==POPUP_RESULT.AFFIRMATIVE) return {saved:false};
        const staged = structuredClone(original);
        const key = Object.keys(original.entries).find(key=>original.entries[key]===entry);
        staged.entries[key]=next;
        await commitSlothNexusMigration({name:roles.memory,original,staged},{
            loadFresh:loadServerWorld,save:(name,book)=>saveWorldInfo(name,book,true),verifyOrigin,
            withLock:(name,task)=>withStmbWriteLane({type:'lorebook',name},task),verifyBeforeWrite:assertReviewedCache,
            resetCache:(name,book)=>worldInfoCache.set(name,structuredClone(book)),operation:'Shorten saved Scene',
        });
        await Promise.resolve(reloadEditor(roles.memory)).catch(error=>console.warn('🦥 STMemoryBooks', 'Sloth editor refresh failed.',error));
        toastr.success(t('The shortened event was saved.','STMemoryBooks_SlothCompressSaved'),'STMemoryBooks');
        return {saved:true};
    } finally {
        collectorBusy = false;
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
        catch(error){console.warn('🦥 STMemoryBooks', 'Sloth Memory Scene merge editor refresh failed',error);}
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
        catch(error){console.warn('🦥 STMemoryBooks', 'Sloth Memory split editor refresh failed:',error);}
        toastr.success(t('Reviewed Scene split saved to Memory. The original was archived, with no chat messages hidden.',
            'STMemoryBooks_SlothSplitSaved'),'🦥 STMemoryBooks');
        return {saved:true,retiredUid:sourcePlan.sourceUid,
            newUids:staged.writes.map(x=>x.uid),result};
    }finally{collectorBusy=false;}
}

import { slothToastr as toastr } from './sloth-notifications.js';
