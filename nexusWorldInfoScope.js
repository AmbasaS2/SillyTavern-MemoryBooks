// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only

import { getNexusChatRoleOverride } from './nexusChatRoleOverrides.js';
import { getCharacterNexusRoles } from './nexusCharacterRoles.js';
import { getSidePromptHistoryStreamKey } from './sidePromptHistory.js';

const names = roles => [roles?.nexus, roles?.memory].filter(name => typeof name === 'string' && name.trim());

export function isManagedNexusWorld(settings, book) {
    return [settings?.nexusCharacterRoles, settings?.nexusChatRoleOverrides]
        .some(store => Object.values(store || {}).some(roles => names(roles).includes(book))) ||
        Object.values(settings?.nexusChatScopedWorlds || {}).some(books => Array.isArray(books) && books.includes(book));
}

export function isAssignedToAnotherNexusCharacter(settings, avatar, book) {
    if (!book) return false;
    return Object.entries(settings?.nexusCharacterRoles || {}).some(([owner, roles]) => owner !== avatar && names(roles).includes(book)) ||
        Object.values(settings?.nexusChatRoleOverrides || {}).some(roles =>
            roles?.version === 1 && roles.avatar !== avatar && names(roles).includes(book));
}

export function rememberNexusChatWorlds(store, avatar, roles) {
    const previous = Object.hasOwn(store, avatar) && Array.isArray(store[avatar]) ? store[avatar] : [];
    const books = [...new Set([...previous, ...names(roles)])];
    if (books.length) {
        Object.defineProperty(store, avatar, { value: books, enumerable: true, writable: true, configurable: true });
    }
}

/** Filter only managed book names from SillyTavern's per-generation entry lists. */
export function scopeNexusWorldInfo(lists, { settings, ref, chatKey, avatar }) {
    const defaults = settings?.nexusCharacterRoles;
    const overrides = settings?.nexusChatRoleOverrides;
    const scoped = settings?.nexusChatScopedWorlds;
    const defaultBooks = Object.values(defaults || {}).flatMap(names);
    const managed = new Set([
        ...Object.values(overrides || {}).flatMap(names),
        ...Object.values(scoped || {}).filter(Array.isArray).flat().filter(name => typeof name === 'string' && name.trim()),
    ]);
    const isSolo = ref?.type === 'character' && typeof avatar === 'string' && avatar.length > 0;
    const override = isSolo ? getNexusChatRoleOverride(overrides, ref, chatKey) : null;
    const pair=isSolo?(override?.invalid?null:override||getCharacterNexusRoles(defaults,avatar)):null;
    const allowed = new Set(isSolo
        ? names(pair).filter(book => !isAssignedToAnotherNexusCharacter(settings, avatar, book))
        : defaultBooks);
    const storyKey=pair?.nexus&&pair?.memory&&pair.nexus!==pair.memory&&allowed.has(pair.nexus)&&allowed.has(pair.memory)
        ?JSON.stringify([avatar,pair.nexus,pair.memory]):null;
    if (isSolo) for (const book of defaultBooks) managed.add(book);
    const sideChatKey = isSolo && ref.fileName ? JSON.stringify(['character',ref.avatarUrl,ref.fileName]) : null;

    const entryLists = [lists.globalLore, lists.characterLore, lists.chatLore, lists.personaLore];
    const dedicated = new Set();
    const legacy = new Map();
    for (const entries of entryLists) {
        if (!Array.isArray(entries)) continue;
        let writeIndex = 0;
        for (const entry of entries) {
            if(entry?.STMB_slothSideNote){
                const history=entry.STMB_sidePromptHistory;
                if(history?.storyKey ? !storyKey||history.storyKey!==storyKey : !sideChatKey||history?.chatKey!==sideChatKey)continue;
            }
            if (managed.has(entry?.world) && !allowed.has(entry.world)) continue;
            if (entry?.STMB_slothSideNote) {
                const stream = getSidePromptHistoryStreamKey(entry.STMB_sidePromptHistory);
                if (stream && entry.STMB_slothSideBook) dedicated.add(stream);
                else if (stream) legacy.set(entry, stream);
            }
            entries[writeIndex++] = entry;
        }
        entries.length = writeIndex;
    }
    // A saved copy in Little Things supersedes that prompt's old Nexus note
    // for this chat, including when the new copy is configured not to inject.
    if (!dedicated.size || !legacy.size) return;
    for (const entries of entryLists) {
        if (!Array.isArray(entries)) continue;
        let writeIndex = 0;
        for (const entry of entries) {
            if (!dedicated.has(legacy.get(entry))) entries[writeIndex++] = entry;
        }
        entries.length = writeIndex;
    }
}
