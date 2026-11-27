// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
//
// Classify and write memories in one request, then validate, stage and save.

import { getMemoryBooksMode } from './memoryBooksMode.js';
import { sameSlothDraftBinding } from './slothSingleRecovery.js';
import { stableHashString } from './clipReviewPolicy.js';
import { chat, getRequestHeaders, menu_type, saveSettings, main_api } from '../../../../script.js';
import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../popup.js';
import { hideChatMessageRange } from '../../../chats.js';
import { extension_settings } from '../../../extensions.js';
import { saveWorldInfo, createWorldInfoEntry, reloadEditor, worldInfoCache,
    charUpdateAddAuxWorld, updateWorldInfoList } from '../../../world-info.js';
import { getTokenCountAsync, getTokenizerModel } from '../../../tokenizers.js';
import { DOMPurify } from '../../../../lib.js';
import { escapeHtml } from '../../../utils.js';
import { translate } from '../../../i18n.js';
import { getCurrentStmbChatRef, getStmbChatKey, patchStmbMetadataForChatRef, setSlothCollectionProgress, withStmbWriteLane } from './stmbJobs.js';
import { getSceneMarkers } from './sceneManager.js';
import { getActiveNexusRoleContext, getNexusRoleResolutionForChatRef } from './nexusCharacterRolesRuntime.js';
import { parseReviewedSegments, fingerprintSlothChat, fingerprintSlothReviewedRanges, stageNexusEdits, stageMemoryScenes,
    getSlothHideRanges, normalizeSlothVisibleTail, slothSourceRanges, stageNexusRecallSettings, getNexusRecallModes } from './nexusCollectionPolicy.js';
import { composeSingleSlothCollection, composeSlothScene,
    suggestSlothSceneMerges, composeSlothMergedScene, suggestSlothSceneSplit, compressSlothScene } from './nexusCollectionAI.js';
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
import { normalizeSlothSideRename, sideRenameMatches, planSlothSideSettingsRename,
    slothSideRenameBooks, stageSlothSideIdentityRename, retargetSlothLorebookRoles } from './slothSideIdentity.js';

const t=(source,key)=>translate(source,key);
const html=value=>escapeHtml(String(value ?? ''));
const stringify=value=>JSON.stringify(value);
let collectorBusy=false;
// A same-session fallback keeps paid text even if chat metadata cannot be
// written (for example, the user switched chats while the model was running).
const slothPaidDrafts=new Map();
const digestSlothSnapshot=value=>{const json=typeof value==='string'?value:stringify(value);return [json.length,stableHashString(json)];};
function getPaidSlothDraft(ref) {
    const key=getStmbChatKey(ref);
    const memory=slothPaidDrafts.get(key);
    const stored=getSceneMarkers()?.slothCollectionDraft;
    if (memory) return memory;
    return stored?.version===1&&stored.binding?.chatKey===key&&typeof stored.raw==='string'?stored:null;
}
async function rememberPaidSlothDraft(ref,binding,raw) {
    const key=binding.chatKey;
    const record={version:1,binding,raw:String(raw??''),receivedAt:Date.now()};
    slothPaidDrafts.set(key,record);
    // Keep only a small session fallback; the current chat owns durable data.
    while (slothPaidDrafts.size>8) slothPaidDrafts.delete(slothPaidDrafts.keys().next().value);
    try {
        if (getStmbChatKey()!==key) return record;
        await patchStmbMetadataForChatRef(ref,markers=>({...markers,slothCollectionDraft:record}));
    } catch(error) {
        console.warn('Paid Sloth response retained in this browser session; chat draft persistence failed.',error);
    }
    return record;
}
async function forgetPaidSlothDraft(ref,record) {
    if (!record) return;
    const key=record.binding.chatKey;
    try {
        if (getStmbChatKey()===key) await patchStmbMetadataForChatRef(ref,markers=>{
            if (markers.slothCollectionDraft?.receivedAt!==record.receivedAt) return markers;
            const next={...markers};delete next.slothCollectionDraft;return next;
        });
        if (slothPaidDrafts.get(key)?.receivedAt===record.receivedAt) slothPaidDrafts.delete(key);
    } catch(error) { console.warn('Collection saved; recovery record could not be cleared.',error); }
}
async function choosePaidSlothDraft(record,binding,signal) {
    const reusable=sameSlothDraftBinding(record,binding);
    const title=t('Previous collection response','STMemoryBooks_SlothPaidDraftTitle');
    const help=reusable?t('Reuse or correct this response without another AI request. A new request is optional.',
        'STMemoryBooks_SlothPaidDraftHelp'):t('The chat or lorebooks changed. This old response is available to copy, but cannot be automatically applied to the changed source.',
        'STMemoryBooks_SlothPaidDraftStale');
    const popup=markStmbPopup(new Popup(DOMPurify.sanitize('<div class="stmb-sloth-review"><h3>'+html(title)+
        '</h3><p>'+html(help)+'</p><textarea class="text_pole" data-sloth-paid-draft style="width:100%;min-height:220px;white-space:pre-wrap">'+
        html(record.raw)+'</textarea></div>'),reusable?POPUP_TYPE.CONFIRM:POPUP_TYPE.TEXT,'',{
        wide:true,large:true,allowVerticalScrolling:true,
        okButton:reusable?t('Reprocess saved response (no AI call)','STMemoryBooks_SlothPaidDraftApply'):false,
        cancelButton:t('Cancel','STMemoryBooks_Cancel'),
        customButtons:[{text:t('New AI request (uses tokens)','STMemoryBooks_SlothPaidDraftNew'),
            result:POPUP_RESULT.CUSTOM1,classes:['menu_button']}],
    }));
    const field=popup.dlg.querySelector('[data-sloth-paid-draft]');
    if (!reusable) field.readOnly=true;
    const answer=await showCollectionPopup(popup,signal);
    if (reusable&&answer===POPUP_RESULT.AFFIRMATIVE) return {raw:field.value};
    if (answer===POPUP_RESULT.CUSTOM1) return {raw:null};
    return null;
}
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
    throw new Error(t('Previously reviewed messages changed. Review or clear their ranges in Manage existing memories.',
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
        const coverage=Object.hasOwn(entry,'STMB_collectedRanges')?entry.STMB_collectedRanges:entry.STMB_sourceRanges;
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

async function retargetActiveSlothReceipts(change) {
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
    const markers=getSceneMarkers();
    if (stringify(markers) !== stringify(replace(markers))) await patchStmbMetadataForChatRef(ref,replace);
}

function assertSideRenameReady(ref) {
    if (pendingSideRenames(extension_settings.STMemoryBooks).some(change=>sideRenameMatches(change,ref)))
        throw new Error(t('Side Prompt rename recovery is pending. Reload SillyTavern to retry before saving.',
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
        // The migration is rare and scoped to this character's known books.
        // Do not write a book without an exact owner/history change.
        for (const name of names) {
            if (!available.has(name)) continue;
            verifyOrigin();
            const original = await loadServerWorld(name);
            const staged = stageSlothSideIdentityRename(original,change);
            if (!staged) continue;
            await commitSlothNexusMigration({name,original,staged},{
                loadFresh:loadServerWorld, save:(book,data)=>saveWorldInfo(book,data,true),
                withLock:(book,task)=>withStmbWriteLane({type:'lorebook',name:book},task),
                verifyOrigin, verifyBeforeWrite:assertReviewedCache,
                resetCache:(book,data)=>worldInfoCache.set(book,structuredClone(data)),
                operation:'Side Prompt update',
            });
            try { await Promise.resolve(reloadEditor(name)); } catch (error) { console.warn(error); }
        }
        verifyOrigin();
        // Recheck rather than replacing any settings edited during the reads.
        const freshPatch = planSlothSideSettingsRename(params,change);
        await retargetActiveSlothReceipts(change);
        if (change.type === 'lorebook') retargetSlothLorebookRoles(settings,change);
        Object.assign(params,freshPatch);
        await persistSideRenameQueue(params,pendingSideRenames(settings).slice(1));
    }
}

function reportSideRenameFailure(error) {
    console.warn('Memory Books Side Prompt identity migration stopped:',error);
    toastr.warning(t('Side Prompt rename recovery is pending. Reload SillyTavern to retry before saving.',
        'STMemoryBooks_SlothSideRenamePending'),'STMemoryBooks',{preventDuplicates:true});
}

export function queueSlothSideRename(rawChange, books = []) {
    const change = normalizeSlothSideRename(rawChange);
    const params = extension_settings.STMemoryBooks?.moduleSettings;
    if (!change || !params) return Promise.resolve();
    const records = pendingSideRenames(extension_settings.STMemoryBooks);
    const record = {...change,books:[...new Set([...books,...slothSideRenameBooks(extension_settings.STMemoryBooks,change)])]};
    // Add synchronously so an in-flight Side Prompt cannot write under an old identity.
    params.slothSidePendingRenames = [...records,record];
    sideRenameTail = sideRenameTail.catch(()=>{}).then(async()=>{
        await persistSideRenameQueue(params,pendingSideRenames(extension_settings.STMemoryBooks));
        await processSlothSideRenames();
    }).catch(reportSideRenameFailure);
    return sideRenameTail;
}

export function retrySlothSideRenames() {
    if (!pendingSideRenames(extension_settings.STMemoryBooks).length) return Promise.resolve();
    sideRenameTail = sideRenameTail.catch(()=>{}).then(async()=>{
        const settings = extension_settings.STMemoryBooks;
        await persistSideRenameQueue(settings.moduleSettings,pendingSideRenames(settings));
        await processSlothSideRenames();
    }).catch(reportSideRenameFailure);
    return sideRenameTail;
}

const possibleLorebookRenames = new Map();

export function observeSlothLorebookSave(newBook, data, names) {
    if (!Array.isArray(names) || names.includes(newBook)) return;
    for (const [name, candidate] of possibleLorebookRenames) if (Date.now()>candidate.expires) possibleLorebookRenames.delete(name);
    const settings=extension_settings.STMemoryBooks;
    const recorded=slothSideRenameBooks(settings,{type:'lorebook',newBook});
    const fingerprint=stringify(data);
    const matches=recorded.filter(oldBook=>names.includes(oldBook) && worldInfoCache.has(oldBook) &&
        stringify(worldInfoCache.get(oldBook)) === fingerprint);
    if (matches.length === 1) possibleLorebookRenames.set(newBook,{oldBook:matches[0],fingerprint,expires:Date.now()+30000});
}

export async function finishSlothLorebookRename(newBook, names) {
    const candidate=possibleLorebookRenames.get(newBook);
    if (!candidate || !Array.isArray(names) || names.includes(candidate.oldBook) || !names.includes(newBook)) return false;
    possibleLorebookRenames.delete(newBook);
    if (Date.now()>candidate.expires || stringify(await loadServerWorld(newBook)) !== candidate.fingerprint) return false;
    // ST's editor selects the new name after saving the exact copy and removing the old name.
    await queueSlothSideRename({type:'lorebook',oldBook:candidate.oldBook,newBook});
    return true;
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
        console.warn('Sloth Side Prompt editor refresh failed', error);
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

async function runReviewedSlothSidePrompts({ ref, roles, presets, source, profile, verifyOrigin, verifySource, signal }) {
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
                compiled, profile, source.entry, { recallMode: preset.recall, nexus, chatRef: ref, storyKey, allowLegacyInheritance });
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
            console.warn('Sloth Side Prompt could not be generated:', preset.id, error);
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
            toastr.success(t('Side Prompts saved to {{book}}.', 'STMemoryBooks_SlothSideBatchSaved')
                .replace('{{book}}', name), 'STMemoryBooks');
        } catch (error) {
            verifyDestinations();
            console.warn('Sloth Side Prompts could not save to', name, error);
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
        method: 'POST', headers: getRequestHeaders(),
        body: stringify({ avatar_url: ref.avatarUrl, file_name: ref.fileName }),
    });
    if (!response.ok) throw new Error('The original chat could not be read from SillyTavern.');
    const stored = await response.json();
    if (!Array.isArray(stored) || !stored[0]?.chat_metadata) throw new Error('The saved chat could not be verified.');
    return stored;
}

async function readReviewedChat(ref, sourceIds, fingerprint, fingerprintOptions, hiddenRanges=[]) {
    const stored = await readStoredSlothChat(ref);
    if (fingerprintSlothChat(stored.slice(1), sourceIds, fingerprintOptions) !== fingerprint) {
        throw new Error('The saved chat differs from the reviewed messages. Reload it before collecting again.');
    }
    for (const [start,end] of hiddenRanges) for (let id=start;id<=end;id++) {
        if (stored[id+1]?.is_system !== true) throw new Error('The approved Hide range did not persist.');
    }
    fingerprintOptions?.verifyStored?.(stored);
    return stored[0].chat_metadata.STMemoryBooks?.slothCollection;
}

async function updateCollectedLedger(prior, events, ref, roleNames, sourceIds, fingerprint, autoWindow) {
    const savedRanges=[...(prior.savedRanges||[])];
    for(const event of events)for(const range of event.collectedRanges??event.segments)savedRanges.push([...range]);
    const receipt={chatKey:getStmbChatKey(ref),savedRanges,
        books:{nexus:roleNames.nexus,memory:roleNames.memory}};
    const previous = await readReviewedChat(ref, sourceIds, fingerprint);
    await patchStmbMetadataForChatRef(ref, markers => {
        assertOrigin(ref, roleNames, sourceIds, fingerprint);
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
        const previous = getSlothLegacyCoverage(getSceneMarkers(), chatKey, roles);
        const title = t('Review previously summarized messages', 'STMemoryBooks_SlothLegacyCoverage');
        const instructions = t('Enter only message ranges already covered by the selected Memory book. Use chat message numbers, for example 0-18, 22-25. Leave blank to clear these ranges.', 'STMemoryBooks_SlothLegacyCoverageInstructions');
        let review;
        const popup = markStmbPopup(new Popup('<div class="stmb-sloth-review"><h3>' + html(title) +
            '</h3><label for="stmb-legacy-coverage-ranges">' + html(instructions) +
            '</label><input id="stmb-legacy-coverage-ranges" class="text_pole" type="text">' +
            '<div class="stmb-legacy-coverage-preview" role="status"></div></div>', POPUP_TYPE.CONFIRM, '', {
            okButton:t('Save', 'STMemoryBooks_Save'), cancelButton:t('Cancel', 'STMemoryBooks_Cancel'),
            onClosing:({ result }) => result !== POPUP_RESULT.AFFIRMATIVE || Boolean(review),
        }));
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
        await patchStmbMetadataForChatRef(ref, markers => {
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
        const originalBooks=initial?{nexus:{entries:{}},memory:{entries:{}}}:{
            nexus:await loadServerWorld(roleNames.nexus,signal),
            memory:await loadServerWorld(roleNames.memory,signal),
        };
        if(getStmbChatKey()!==getStmbChatKey(ref)) {
            throw new Error('The chat changed while its lorebooks were loading. Start collection from the original chat.');
        }
        const {source,prior,reviewed}=activeSource(ref,originalBooks.memory,roleNames);
        if(!source.length){
            if (automatic) return {saved:false,reason:'no-source'};
            toastr.info(t('No new visible messages need collection.','STMemoryBooks_SlothNoSource'),'STMemoryBooks');
            return {saved:false,reason:'no-source'};
        }
        const sourceIds=source.map(s=>s.id);
        const fingerprint=fingerprintSlothChat(chat,sourceIds);
        const profile=collectionProfile(settings, profileIndex, stConnectionProfileId);
        if(!profile)throw new Error('Choose an AI profile before starting Sloth collection.');
        const characterContext=initialCharacterContext(character);
        const nexusOptions={detailRecallMode:settings.moduleSettings?.nexusDetailRecallMode==='keyword'?'keyword':'vector',recallModes:structuredClone(settings.moduleSettings?.nexusRecallModes)};
        const checkOrigin=()=>{
            assertSlothLegacyCoverage(reviewed);
            if (automatic) {
                const now = getSlothAutomaticSettings(extension_settings.STMemoryBooks);
                if (!now.enabled || now.mode !== automatic.mode || now.threshold !== automatic.threshold)
                    throw new Error('Automatic collection settings changed.');
            }
            if(!initial)return assertOrigin(ref,roleNames,sourceIds,fingerprint);
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
        const [currentChunk,...laterChunks]=await splitSlothCollectionSource(source,getTokenCountAsync);
        checkBeforeSave();
        const partialSource=laterChunks.length>0;
        const draftBinding={chatKey:getStmbChatKey(ref),roles:roleNames,source:currentChunk.map(m=>m.id),
            fingerprint:digestSlothSnapshot(fingerprint),
            books:[digestSlothSnapshot(originalBooks.nexus),digestSlothSnapshot(originalBooks.memory)]};
        const previousDraft=getPaidSlothDraft(ref);
        let rawDraft=null;
        if (previousDraft) {
            if (automatic) {
                if (sameSlothDraftBinding(previousDraft,draftBinding))
                    return {saved:false,reason:'recovery-pending'};
            } else {
                const choice=await choosePaidSlothDraft(previousDraft,draftBinding,signal);
                if (!choice) return {saved:false,reason:'recovery-cancelled'};
                rawDraft=choice.raw;
                checkBeforeSave();
                if (typeof rawDraft==='string')
                    activeDraft=await rememberPaidSlothDraft(ref,draftBinding,rawDraft);
            }
        }
        const autoAttempt=automatic ? {chatKey:automaticChatKey,through:sourceIds.at(-1),books:roleNames} : null;
        const autoWindow=autoAttempt && partialSource ? {attempt:autoAttempt,through:currentChunk.at(-1).id} : null;
        if (automatic) {
            await readReviewedChat(ref,sourceIds,fingerprint);
            await patchStmbMetadataForChatRef(ref,markers=>{
                checkOrigin();
                if (stringify(markers.slothAutomatic)!==stringify(previousAuto))
                    throw new Error('Automatic collection already advanced for this chat.');
                return {...markers,slothAutomatic:autoAttempt};
            });
            publishReading({count:0,exact:true},autoAttempt.through);
        } else {
            toastr.info(t('Analyzing causal events in the unsaved chat...','STMemoryBooks_SlothAnalyzing'),'STMemoryBooks');
        }
        progressChatKey = getStmbChatKey(ref);
        const showProgress = (source, key) => setSlothCollectionProgress(progressChatKey, t(source, key));
        showProgress('Writing memories', 'STMemoryBooks_SlothProgressWriting');
        const collection=await composeSingleSlothCollection({nexus:originalBooks.nexus,memory:originalBooks.memory,
            messages:currentChunk,profile,settings,initial,characterContext,partialSource,signal,
            reviewSummaries,verifyOrigin:checkBeforeSave,rawDraft,
            onDraft:async raw=>{activeDraft=await rememberPaidSlothDraft(ref,draftBinding,raw);}});
        checkBeforeSave();
        const {plan,scenes,edits,skippedNexusEdits,reviewFailed,skippedScenes,recoveryUncertain}=collection;
        const needsRecovery=Boolean(skippedScenes||skippedNexusEdits||recoveryUncertain);
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
            showSkipped();
            if (!automatic) toastr.info(t('There are no completed events or Nexus changes to save.',
                'STMemoryBooks_SlothNoCompleted'),'STMemoryBooks');
            return {saved:false,reason:'no-complete-events-or-deltas'};
        }

        const states=[];
        let savedEntries=[];
        if(scenes.length||initial) {
            const memoryStage=scenes.length?stageMemoryScenes(originalBooks.memory,scenes,
                book=>createWorldInfoEntry(roleNames.memory,book),{
                    chatId:String(ref.fileName||''),
                    olderMode:settings.moduleSettings?.nexusOlderSceneMode==='keyword'?'keyword':'vector',
                }):null;
            const staged=memoryStage?.staged??structuredClone(originalBooks.memory);
            if(memoryStage) savedEntries=memoryStage.writes.filter(write=>!write.reused).map(({uid})=>staged.entries[uid]);
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
        await readReviewedChat(ref,sourceIds,fingerprint,{verifyStored: stored => {
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
        const outcome=initial?await saveInitialNexusCollection(states,{ref,roleNames,checkOrigin,settings}):
            states.length===1?await commitSlothNexusMigration(states[0],{
                ...commitOptions,operation:scenes.length?'Memory Scene save':'Nexus current-state update',
                withLock:(name,task)=>withStmbWriteLane({type:'lorebook',name},task),
            }):await commitSlothBooks(states,{...commitOptions,withLocks:withBothWriteLanes});

        let receiptVerified=false;
        if(scenes.length){
            try {
                await updateCollectedLedger(prior,scenes,ref,roleNames,sourceIds,fingerprint,autoWindow);
                receiptVerified=true;
                if (!automatic || autoWindow) invalidateSlothAutomaticProgress();
            } catch (error) {
                console.warn('Memory Books saved, but the chat receipt could not be verified.',error);
            }
        }
        const hideRanges = approval.hideRanges.length ? getSlothHideRanges(scenes,chat,approval.keepRecent) : [];
        if (hideRanges.length) {
            try {
                if (!receiptVerified) throw new Error('The stored collection receipt could not be verified.');
                let remaining = [...sourceIds];
                assertOrigin(ref,roleNames,remaining,fingerprint);
                for (const [start,end] of hideRanges) {
                    const expected = fingerprintSlothChat(chat,remaining.filter(id=>id<start||id>end));
                    await hideChatMessageRange(start,end,false);
                    remaining = remaining.filter(id=>id<start||id>end);
                    assertOrigin(ref,roleNames,remaining,expected);
                }
                await readReviewedChat(ref,sourceIds,fingerprint,{allowHidden:true},hideRanges);
            } catch (error) {
                console.warn('Memory saved; Sloth Hide stopped.',error);
                toastr.warning(t('The memories are saved. Check which messages were hidden before trying again.',
                    'STMemoryBooks_SlothHideInterrupted'),'STMemoryBooks');
            }
        }
        for(const {name} of states){
            try{await Promise.resolve(reloadEditor(name));}
            catch(error){console.warn('Memory Books editor refresh failed.',error);}
        }
        if (!needsRecovery&&(!scenes.length||receiptVerified)) await forgetPaidSlothDraft(ref,activeDraft);
        const message=scenes.length&&edits.length
            ?t('Memory saved and Nexus updated.','STMemoryBooks_SlothSaved')
            :scenes.length?t('Completed events saved to Memory.','STMemoryBooks_SlothSceneOnlySaved')
                :t('Nexus updated.','STMemoryBooks_SlothNexusOnlySaved');
        if(!automatic){
            const usage=collection.inputTokens===null?'':' · '+t(collection.inputTokensExact?'Input: {{count}} tokens':'Input: ~{{count}} tokens',
                collection.inputTokensExact?'STMemoryBooks_SlothInputTokens':'STMemoryBooks_SlothInputEstimate')
                .replace('{{count}}',Number(collection.inputTokens).toLocaleString());
            toastr.success(message+usage,'STMemoryBooks');
        }
        showSkipped();
        let sidePromptsSaved=0;
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
                    presets:approvedSidePresets,
                    source:{ids,entry:{content:savedEntries.map(entry=>entry.content).join('\n\n')}}});
                sidePromptsSaved=side.count??0;
            } catch (error) {
                console.warn('Memories saved; Side Prompts stopped.',error);
                if(!signal?.aborted) toastr.warning(t('Memory is saved. Run Side Prompts again from a saved scene.',
                    'STMemoryBooks_SlothSideAfterFailure'),'STMemoryBooks');
            }
        }
        return {saved:true,scenes:scenes.length,nexusEdits:edits.length,skippedScenes,skippedNexusEdits,
            receiptVerified,sidePromptsSaved,inputTokens:collection.inputTokens,inputTokensExact:collection.inputTokensExact,result:outcome};
    }catch(error){
        if(activeDraft&&!signal?.aborted) toastr.warning(t('The received AI response was retained. Press collect again to review or reuse it without another AI request.',
            'STMemoryBooks_SlothPaidDraftFailed'),'STMemoryBooks');
        throw error;
    }finally{
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
        await Promise.resolve(reloadEditor(roles.memory)).catch(error=>console.warn('Sloth editor refresh failed.',error));
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
