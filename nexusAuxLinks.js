// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only

import { getCharacterNexusRoles } from './nexusCharacterRoles.js';

const roleNames = roles => [roles?.nexus, roles?.memory].filter(name => typeof name === 'string' && name.length > 0);
export const autoLinkCharacterBooks = settings => settings?.moduleSettings?.slothAutoLinkCharacterBooks !== false;

export function getCharacterAuxBooks(worldInfo, fileName) {
    const rows = (Array.isArray(worldInfo?.charLore) ? worldInfo.charLore : []).filter(row => row?.name === fileName);
    if (rows.length > 1) throw new Error('Duplicate character lorebook records; review the native character settings first.');
    return Array.isArray(rows[0]?.extraBooks) ? [...rows[0].extraBooks] : [];
}

export function assignedNexusBooks(settings, avatar) {
    return [...new Set([
        ...roleNames(getCharacterNexusRoles(settings?.nexusCharacterRoles, avatar)),
        ...Object.entries(settings?.nexusChatRoleOverrides || {})
            .filter(([key, record]) => key.startsWith('character:' + avatar + ':') && record?.version === 1 && record.avatar === avatar)
            .flatMap(([, record]) => roleNames(record)),
    ])];
}

// Only unlink roles explicitly removed by this operation; retain unrelated
// extras and every role still used by a character default or an AU chat.
export function planNexusAuxBooks({ current, previous, next, ensure = [] }) {
    const retained = new Set(next);
    const removed = new Set(previous.filter(name => !retained.has(name)));
    const result = current.filter(name => !removed.has(name));
    for (const name of ensure) {
        if (retained.has(name) && !result.includes(name)) result.push(name);
    }
    return result;
}

let syncing = false;
export function isSlothRoleSyncPending() { return syncing; }
export async function withSlothRoleSync(task) {
    if (syncing) throw new Error('A character lorebook change is already in progress.');
    syncing = true;
    try { return await task(); }
    finally { syncing = false; }
}
