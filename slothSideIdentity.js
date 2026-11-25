// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only

import { fingerprintRollbackEntry } from './memoryRollback.js';
import { getSidePromptHistoryStreamKey } from './sidePromptHistory.js';

const parse = value => {
    try { return JSON.parse(value); } catch { return null; }
};
const name = value => typeof value === 'string' ? value.trim() : '';
const file = value => name(value).replace(/\.jsonl$/u, '');
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const own = (obj,key) => Object.hasOwn(obj || {},key);
const fields = ['slothSideBooks','slothSideCharacterLinks','slothSideEntries','slothSideSlots'];

export function normalizeSlothSideRename(change) {
    const avatar = name(change?.avatar);
    const newAvatar = name(change?.newAvatar);
    if (!avatar) return null;
    if (change.type === 'avatar' && newAvatar && newAvatar !== avatar)
        return {type:'avatar',avatar,newAvatar};
    const oldFile = file(change?.oldFile), newFile = file(change?.newFile);
    if (change.type === 'chat' && oldFile && newFile && oldFile !== newFile)
        return {type:'chat',avatar,oldFile,newFile};
    return null;
}

export function sideRenameMatches(change, ref) {
    if (!ref || ref.type !== 'character') return false;
    if (change.type === 'avatar') return [change.avatar,change.newAvatar].includes(ref.avatarUrl);
    return change.avatar === ref.avatarUrl && [change.oldFile,change.newFile].includes(ref.fileName);
}

function remapKey(key, field, change) {
    if (field === 'slothSideSlots') {
        return change.type === 'avatar' && key === change.avatar ? change.newAvatar : key;
    }
    const tuple = parse(key);
    if (!Array.isArray(tuple) || tuple.length !== (field === 'slothSideEntries' ? 3 : 2) ||
        tuple[0] !== change.avatar) return key;
    if (change.type === 'avatar') tuple[0] = change.newAvatar;
    else {
        if (field !== 'slothSideEntries' || tuple[1] !== change.oldFile) return key;
        tuple[1] = change.newFile;
    }
    return JSON.stringify(tuple);
}

// Plan without mutation. A destination conflict is never silently overwritten.
export function planSlothSideSettingsRename(params, change) {
    const patch = {};
    for (const field of fields) {
        const store = params?.[field];
        if (!store || typeof store !== 'object' || Array.isArray(store)) continue;
        const next = {...store};
        let changed = false;
        for (const [key,value] of Object.entries(store)) {
            const target = remapKey(key,field,change);
            if (target === key) continue;
            if (own(next,target) && !equal(next[target],value))
                throw new Error('Side Prompt settings conflict after rename.');
            Object.defineProperty(next,target,{value,writable:true,enumerable:true,configurable:true});
            delete next[key];
            changed = true;
        }
        if (changed) patch[field] = next;
    }
    return patch;
}

export function slothSideRenameBooks(settings, change) {
    const params = settings?.moduleSettings || {};
    const avatars = new Set([change.avatar,change.newAvatar].filter(Boolean));
    const books = new Set();
    const add = value => { if (name(value) && value !== ':little-things:') books.add(value); };
    for (const [key,value] of Object.entries(params.slothSideBooks || {}))
        if (avatars.has(parse(key)?.[0])) add(value);
    for (const [key,value] of Object.entries(params.slothSideEntries || {}))
        if (avatars.has(parse(key)?.[0])) add(value?.book);
    for (const avatar of avatars) {
        const roles = settings?.nexusCharacterRoles?.[avatar];
        add(roles?.nexus); add(roles?.memory);
        for (const book of settings?.nexusChatScopedWorlds?.[avatar] || []) add(book);
    }
    for (const roles of Object.values(settings?.nexusChatRoleOverrides || {}))
        if (avatars.has(roles?.avatar)) { add(roles.nexus); add(roles.memory); }
    return [...books];
}

function remapHistory(history, change) {
    const tuple = parse(history?.chatKey);
    if (!Array.isArray(tuple) || tuple.length !== 3 || tuple[0] !== 'character' || tuple[1] !== change.avatar)
        return false;
    if (change.type === 'avatar') tuple[1] = change.newAvatar;
    else {
        if (tuple[2] !== change.oldFile || history.chatId !== change.oldFile) return false;
        tuple[2] = change.newFile;
        history.chatId = change.newFile;
        const before = change.oldFile.replace(/\s/g,'').replace(/,/g,'-');
        const after = change.newFile.replace(/\s/g,'').replace(/,/g,'-');
        if (typeof history.group === 'string' && history.group.endsWith('-'+before))
            history.group = history.group.slice(0,-before.length)+after;
    }
    history.chatKey = JSON.stringify(tuple);
    return true;
}

function remapEntry(entry, change) {
    if (!entry || typeof entry !== 'object') return false;
    const history = entry.STMB_sidePromptHistory;
    // Only Sloth's own records: do not migrate other extension or character data.
    if (entry.STMB_slothSideNote !== true && !String(history?.templateKey || '').startsWith('sloth-')) return false;
    const oldGroup = history?.group;
    const snap = entry.STMB_sidePromptRegeneration;
    const snapshotWasCurrent = snap?.version === 2 &&
        fingerprintRollbackEntry(entry,{excludeSidePromptSnapshot:true}) === snap.writtenFingerprint;
    if (!remapHistory(history,change)) return false;
    if (entry.group === oldGroup && typeof oldGroup === 'string') entry.group = history.group;
    if (change.type === 'chat') {
        if (entry.STMB_chatId === change.oldFile) entry.STMB_chatId = change.newFile;
        if (snap?.chatId === change.oldFile) snap.chatId = change.newFile;
    }
    remapHistory(entry.STMB_slothPreviousSideHistory,change);
    if (snap?.priorEntryState) remapEntry(snap.priorEntryState,change);
    if (snapshotWasCurrent) snap.writtenFingerprint = fingerprintRollbackEntry(entry,{excludeSidePromptSnapshot:true});
    return true;
}

export function stageSlothSideIdentityRename(original, change) {
    const staged = structuredClone(original);
    let changed = false;
    const marker = staged?.extensions?.stmbSlothSideBook;
    if (change.type === 'avatar' && marker?.version === 1 && marker.avatar === change.avatar) {
        marker.avatar = change.newAvatar;
        changed = true;
    }
    const untouched = new Set();
    const moved = new Set();
    for (const entry of Object.values(staged.entries || {})) {
        const didMove = remapEntry(entry,change);
        const stream = getSidePromptHistoryStreamKey(entry?.STMB_sidePromptHistory);
        if (stream) (didMove ? moved : untouched).add(stream);
        changed ||= didMove;
    }
    if ([...moved].some(stream => untouched.has(stream)))
        throw new Error('Side Prompt history conflict after rename.');
    return changed ? staged : null;
}
