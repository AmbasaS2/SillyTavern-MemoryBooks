// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only

import { getCharacterNexusRoles, getLinkedCharacterWorlds } from './nexusCharacterRoles.js';
import { getNexusChatRoleOverride } from './nexusChatRoleOverrides.js';
import { getCharacterMemoryBookLock } from './characterMemoryBookLocks.js';

export function canInitializeNexusBooks({ character, ref, key, settings, worldInfo,
    chatBook, markers }) {
    const avatar = character?.avatar;
    if (!avatar || ref?.type !== 'character' || ref.avatarUrl !== avatar || !ref.fileName || !key) return false;
    const roles = getCharacterNexusRoles(settings?.nexusCharacterRoles, avatar);
    const receipt = markers?.slothCollection;
    return !roles.nexus && !roles.memory
        && !getNexusChatRoleOverride(settings?.nexusChatRoleOverrides, ref, key)
        && !getCharacterMemoryBookLock(settings?.characterMemoryBookLocks, avatar)
        && !markers?.manualLorebook && !chatBook && !character?.data?.character_book && !character?.character_book
        && !getLinkedCharacterWorlds({ character, worldInfo }).length
        && !(Number.isSafeInteger(markers?.highestMemoryProcessed) && markers.highestMemoryProcessed >= 0)
        && !receipt;
}

/** Resolve a single existing book without guessing from its title or contents. */
export function getNexusCompanionPlan({character,ref,key,settings,worldInfo,chatBook,markers,worldNames}) {
    const avatar=character?.avatar;
    if(!avatar||ref?.type!=='character'||ref.avatarUrl!==avatar||!ref.fileName||!key||
        getNexusChatRoleOverride(settings?.nexusChatRoleOverrides,ref,key)||markers?.slothCollection||
        character?.data?.character_book||character?.character_book) return null;
    const links=getLinkedCharacterWorlds({character,worldInfo});
    if(links.length!==1||!Array.isArray(worldNames)||!worldNames.includes(links[0])) return null;
    const [existing]=links;
    const roles=getCharacterNexusRoles(settings?.nexusCharacterRoles,avatar);
    if(roles.nexus&&roles.memory) return null;
    const bindings=[chatBook,markers?.manualLorebook,
        getCharacterMemoryBookLock(settings?.characterMemoryBookLocks,avatar)?.lorebookName].filter(Boolean);
    if(bindings.some(name=>name!==existing)) return null;
    const recordedMemory=bindings.includes(existing);
    const hasCheckpoint=Number.isSafeInteger(markers?.highestMemoryProcessed)&&markers.highestMemoryProcessed>=0;
    if(hasCheckpoint&&(!recordedMemory||roles.nexus)) return null;
    const existingRole=roles.nexus===existing?'nexus':
        roles.memory===existing||(!roles.nexus&&!roles.memory&&recordedMemory)?'memory':null;
    if(!existingRole||roles[existingRole==='nexus'?'memory':'nexus']) return null;
    return {existing,existingRole,missingRole:existingRole==='nexus'?'memory':'nexus'};
}

export function initialNexusBookNames(character, id) {
    const label = String(character?.name || 'Character').normalize('NFC')
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim();
    const safeLabel = Array.from(label).slice(0, 36).join('') || 'Character';
    if (!/^[a-f0-9]{12}$/.test(id)) throw new Error('Invalid first-collection identifier.');
    return { nexus: `Nexus - ${safeLabel} - ${id}`, memory: `Memory - ${safeLabel} - ${id}` };
}

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const comparableName = name => String(name).normalize('NFKC').toLowerCase();

// No create-if-absent or delete-if-unchanged exists in World Info. Use unique
// names, check absence before each write, and keep any partially created books
// for inspection. Do not delete a file another editor might have changed.
export async function commitInitialNexusBooks(states, {
    list, load, save, verifyOrigin, verifyUnbound, withLocks, link,
}) {
    const names = states.map(state => state.name);
    if (names.length < 1 || names.length > 2 || new Set(names.map(comparableName)).size !== names.length ||
        states.some(state => !state.name || !state.staged?.entries)) {
        throw new Error('The new lorebook drafts must have distinct names.');
    }
    return withLocks(names, async () => {
        const attempted = [];
        const assertAbsent = async name => {
            const existing = await list();
            if (existing.some(value => comparableName(value) === comparableName(name))) {
                throw new Error('A lorebook with the proposed name already exists: ' + name);
            }
        };
        try {
            for (const name of names) await assertAbsent(name);
            for (const state of states) {
                await verifyUnbound();
                await assertAbsent(state.name);
                verifyOrigin();
                attempted.push(state.name);
                await save(state.name, state.staged);
                if (!equal(await load(state.name), state.staged)) {
                    throw new Error('New lorebook could not be verified: ' + state.name);
                }
            }
            for (const state of states) {
                if (!equal(await load(state.name), state.staged)) {
                    throw new Error('New lorebook changed before linking: ' + state.name);
                }
            }
            await verifyUnbound();
            verifyOrigin();
            await link();
            for (const state of states) {
                if (!equal(await load(state.name), state.staged)) {
                    throw new Error('New lorebook changed during linking: ' + state.name);
                }
            }
            return { success: true, saved: names };
        } catch (cause) {
            if (!attempted.length) throw cause;
            const error = new Error(cause.message + ' Inspect the backup and these new lorebooks before retrying: ' +
                attempted.join(', '), { cause });
            error.partialRecovery = true;
            throw error;
        }
    });
}
