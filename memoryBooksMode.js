// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only

const valid = mode => mode === 'sloth' || mode === 'original';
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const avatarOf = ref => ref?.type === 'character' && typeof ref.avatarUrl === 'string' ? ref.avatarUrl.trim() : '';
export function explicitMemoryBooksMode(settings, ref) {
    const avatar = avatarOf(ref);
    const store = settings?.characterMemoryBooksModes;
    return avatar && record(store) && Object.hasOwn(store, avatar) && valid(store[avatar]) ? store[avatar] : null;
}
export function getMemoryBooksMode(settings, ref) {
    return avatarOf(ref) ? explicitMemoryBooksMode(settings, ref) || 'sloth' : 'original';
}
export function setMemoryBooksMode(settings, ref, mode) {
    const avatar = avatarOf(ref);
    if (!avatar || !valid(mode)) return false;
    if (!record(settings.characterMemoryBooksModes)) settings.characterMemoryBooksModes = {};
    Object.defineProperty(settings.characterMemoryBooksModes, avatar, {
        value: mode, enumerable: true, configurable: true, writable: true,
    });
    return true;
}
export function legacyRotationEnabled(settings, ref) {
    return getMemoryBooksMode(settings, ref) === 'sloth' && settings?.moduleSettings?.nexusSceneRotationEnabled === true;
}
export function moveMemoryBooksMode(settings, from, to) {
    const store = settings?.characterMemoryBooksModes;
    if (!record(store) || !from || !to || from === to || !Object.hasOwn(store, from) || Object.hasOwn(store, to)) return false;
    if (!setMemoryBooksMode(settings, {type:'character', avatarUrl:to}, store[from])) return false;
    delete store[from];
    return true;
}
export function removeMemoryBooksMode(settings, avatar) {
    const store = settings?.characterMemoryBooksModes;
    if (!record(store) || !Object.hasOwn(store, avatar)) return false;
    delete store[avatar];
    return true;
}
