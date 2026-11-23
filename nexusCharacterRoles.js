// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
//
// Pure character-scoped role policies. No chat metadata or World Info writes.

const ROLE_NAMES = ['nexus', 'memory'];

const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value.trim() : '';
const safePut = (obj, key, value) => Object.defineProperty(obj, key, {
    value, enumerable: true, writable: true, configurable: true,
});

export function normalizeNexusCharacterRoles(value) {
    const result = {};
    let changed = !isRecord(value);
    for (const [rawAvatar, rawRoles] of Object.entries(isRecord(value) ? value : {})) {
        const avatar = text(rawAvatar);
        if (!avatar || !isRecord(rawRoles)) { changed = true; continue; }
        const nexus = text(rawRoles.nexus);
        const memory = text(rawRoles.memory);
        if (!nexus && !memory) { changed = true; continue; }
        if (nexus && memory && nexus === memory) { changed = true; continue; }
        safePut(result, avatar, { nexus, memory });
        if (avatar !== rawAvatar || rawRoles.nexus !== nexus || rawRoles.memory !== memory ||
            Object.keys(rawRoles).some(key => !ROLE_NAMES.includes(key))) changed = true;
    }
    return { roles: result, changed };
}

export function getCharacterNexusRoles(store, avatar) {
    const record = isRecord(store) ? store[text(avatar)] : null;
    if (!isRecord(record)) return { nexus: '', memory: '' };
    return { nexus: text(record.nexus), memory: text(record.memory) };
}

export function setCharacterNexusRole(store, avatar, role, name) {
    const key = text(avatar);
    if (!isRecord(store) || !key || !ROLE_NAMES.includes(role)) return false;
    const current = getCharacterNexusRoles(store, key);
    const next = text(name);
    if (current[role] === next) return false;
    if (next && next === current[role === 'nexus' ? 'memory' : 'nexus']) {
        throw new Error('Nexus and Memory must be different lorebooks.');
    }
    const updated = { ...current, [role]: next };
    if (!updated.nexus && !updated.memory) delete store[key];
    else safePut(store, key, updated);
    return true;
}

export function moveCharacterNexusRoles(store, fromAvatar, toAvatar) {
    const from = text(fromAvatar), to = text(toAvatar);
    if (!isRecord(store) || !from || !to || from === to || !Object.hasOwn(store, from)) return false;
    // Never overwrite another character's existing role assignments.
    if (Object.hasOwn(store, to)) return false;
    safePut(store, to, getCharacterNexusRoles(store, from));
    delete store[from];
    return true;
}

export function removeCharacterNexusRoles(store, avatar) {
    const key = text(avatar);
    if (!isRecord(store) || !key || !Object.hasOwn(store, key)) return false;
    delete store[key];
    return true;
}

/**
 * SillyTavern's primary and additional character World Info books.
 * An avatar's filename without its final extension identifies charLore[].name.
 * worldNames filters deleted files, while preserving assignment records elsewhere.
 */
export function getLinkedCharacterWorlds({ character, worldInfo, worldNames } = {}) {
    if (!character || !isRecord(character)) return [];
    const avatar = text(character.avatar);
    if (!avatar) return [];
    const fileName = avatar.replace(/\.[^/.]+$/, '');
    const primary = text(character.data?.extensions?.world);
    const extras = Array.isArray(worldInfo?.charLore)
        ? worldInfo.charLore.filter(entry => text(entry?.name) === fileName)
            .flatMap(entry => Array.isArray(entry.extraBooks) ? entry.extraBooks : [])
        : [];
    const known = Array.isArray(worldNames) ? new Set(worldNames) : null;
    const used = new Set();
    return [primary, ...extras].map(text).filter(name => {
        if (!name || used.has(name) || (known && !known.has(name))) return false;
        used.add(name);
        return true;
    });
}

export function resolveCharacterNexusRole({ roles, avatar, role, linkedBooks, worldNames } = {}) {
    if (!ROLE_NAMES.includes(role)) return { state: 'unsupported', name: '', role };
    const name = getCharacterNexusRoles(roles, avatar)[role];
    if (!name) return { state: 'unassigned', name: '', role };
    if (!Array.isArray(worldNames) || !worldNames.includes(name)) {
        return { state: 'missing', name, role };
    }
    if (!Array.isArray(linkedBooks) || !linkedBooks.includes(name)) {
        return { state: 'detached', name, role };
    }
    return { state: 'ready', name, role };
}
