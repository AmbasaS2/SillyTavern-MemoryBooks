// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
//
// Optional, chat-scoped World Info role overrides. This registry lives in
// extension settings, not copied chat metadata, so queued jobs resolve their
// originating chat even after the user opens another one.

const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value);
const name = value => typeof value === 'string' ? value.trim() : '';
const validOrigin = (ref, chatKey) => ref?.type === 'character' &&
    !!name(ref.avatarUrl) && !!name(ref.fileName) &&
    chatKey === 'character:' + name(ref.avatarUrl) + ':' + name(ref.fileName);

export function getNexusChatRoleOverride(store, ref, chatKey) {
    if (!validOrigin(ref, chatKey) || !isRecord(store) ||
        !Object.prototype.hasOwnProperty.call(store, chatKey)) return null;
    const raw = store[chatKey];
    if (!isRecord(raw) || raw.version !== 1 || raw.avatar !== name(ref.avatarUrl)) {
        // Never silently fall back to another book when an existing record is corrupt.
        return { invalid: true, nexus: '', memory: '' };
    }
    const nexus = name(raw.nexus), memory = name(raw.memory);
    return { nexus, memory, invalid: !!(nexus && memory && nexus === memory) };
}

export function setNexusChatRoleOverride(store, ref, chatKey, roles) {
    if (!isRecord(store) || !validOrigin(ref, chatKey) || !isRecord(roles)) {
        throw new Error('Choose an existing individual-character chat before overriding lorebooks.');
    }
    const nexus = name(roles.nexus), memory = name(roles.memory);
    if (nexus && memory && nexus === memory) {
        throw new Error('Nexus and Memory must be different lorebooks.');
    }
    const next = { version: 1, avatar: name(ref.avatarUrl), nexus, memory };
    const previous = Object.prototype.hasOwnProperty.call(store, chatKey) ? store[chatKey] : null;
    if (JSON.stringify(previous) === JSON.stringify(next)) return false;
    Object.defineProperty(store, chatKey, {
        value: next, enumerable: true, configurable: true, writable: true,
    });
    return true;
}

export function clearNexusChatRoleOverride(store, ref, chatKey) {
    if (!isRecord(store) || !validOrigin(ref, chatKey) ||
        !Object.prototype.hasOwnProperty.call(store, chatKey)) return false;
    delete store[chatKey];
    return true;
}

// Avatar filenames, not character display names, define ST character identity.
// Preserve per-chat separation if a character's avatar filename changes.
export function moveNexusChatRoleOverrides(store, fromAvatar, toAvatar) {
    const from = name(fromAvatar), to = name(toAvatar);
    if (!isRecord(store) || !from || !to || from === to) return 0;
    const prefix = 'character:' + from + ':';
    let moved = 0;
    for (const key of Object.keys(store)) {
        if (!key.startsWith(prefix)) continue;
        const target = 'character:' + to + ':' + key.slice(prefix.length);
        if (Object.prototype.hasOwnProperty.call(store, target)) continue;
        const record = store[key];
        if (!isRecord(record) || record.version !== 1 || record.avatar !== from) continue;
        Object.defineProperty(store, target, {
            value: { ...record, avatar: to }, enumerable: true, configurable: true, writable: true,
        });
        delete store[key];
        moved++;
    }
    return moved;
}

export function removeNexusChatRoleOverrides(store, avatar) {
    const keyPrefix = 'character:' + name(avatar) + ':';
    if (!isRecord(store) || !name(avatar)) return 0;
    let removed = 0;
    for (const key of Object.keys(store)) {
        if (key.startsWith(keyPrefix)) { delete store[key]; removed++; }
    }
    return removed;
}

// A chat that already advanced its collection checkpoint must not point at
// a different World Info pair without a separate, explicit data migration.
export function canChangeNexusChatRolePair(markers, chatKey, previous, next, legacyBook = '') {
    if (name(previous?.nexus) === name(next?.nexus) &&
        name(previous?.memory) === name(next?.memory)) return true;
    const sloth = markers?.slothCollection;
    const hasSlothReceipts = sloth?.chatKey === chatKey &&
        Array.isArray(sloth.savedRanges) && sloth.savedRanges.length > 0;
    const hasOldCheckpoint = Number.isSafeInteger(markers?.highestMemoryProcessed) &&
        markers.highestMemoryProcessed >= 0;
    if (hasSlothReceipts) return false;
    if (!hasOldCheckpoint) return true;
    // Give an existing chat its first pair without losing its known legacy book.
    // Keep the guard for complete Sloth pairs and checkpoints with unknown origin.
    if (!name(legacyBook) || (name(previous?.nexus) && name(previous?.memory))) return false;
    if (name(next?.nexus) && name(next?.memory)) {
        return [name(next.nexus), name(next.memory)].includes(name(legacyBook));
    }
    return true;
}
