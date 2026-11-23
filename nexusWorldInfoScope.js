// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only

import { getNexusChatRoleOverride } from './nexusChatRoleOverrides.js';
import { getCharacterNexusRoles } from './nexusCharacterRoles.js';

const names = roles => [roles?.nexus, roles?.memory].filter(name => typeof name === 'string' && name.trim());

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
    const allowed = new Set(isSolo
        ? names(override?.invalid ? null : override || getCharacterNexusRoles(defaults, avatar))
            .filter(book => !isAssignedToAnotherNexusCharacter(settings, avatar, book))
        : defaultBooks);
    if (isSolo) for (const book of defaultBooks) managed.add(book);
    if (!managed.size) return;

    for (const entries of [lists.globalLore, lists.characterLore, lists.chatLore, lists.personaLore]) {
        if (!Array.isArray(entries)) continue;
        let writeIndex = 0;
        for (const entry of entries) {
            if (!managed.has(entry?.world) || allowed.has(entry.world)) entries[writeIndex++] = entry;
        }
        entries.length = writeIndex;
    }
}
