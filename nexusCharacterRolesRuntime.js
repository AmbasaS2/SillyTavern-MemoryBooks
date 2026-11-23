// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
//
// Read-only runtime adapter for SillyTavern character-linked World Info.
// Does not attach, create or edit lorebooks, and never copies chat progress.

import { characters, this_chid } from '../../../../script.js';
import { selected_group } from '../../../group-chats.js';
import { world_info, world_names } from '../../../world-info.js';
import { extension_settings } from '../../../extensions.js';
import { getCurrentStmbChatRef, getStmbChatKey } from './stmbJobs.js';
import { getNexusChatRoleOverride } from './nexusChatRoleOverrides.js';
import {
    getCharacterNexusRoles,
    getLinkedCharacterWorlds,
    resolveCharacterNexusRole,
} from './nexusCharacterRoles.js';

export function getActiveNexusCharacter() {
    if (selected_group || this_chid === undefined || this_chid === null || this_chid === '' ||
        !Number.isSafeInteger(Number(this_chid))) return null;
    return characters?.[this_chid] || null;
}

export function getActiveNexusRoleContext(settings = extension_settings.STMemoryBooks) {
    const character = getActiveNexusCharacter();
    const linkedBooks = getLinkedCharacterWorlds({
        character, worldInfo: world_info, worldNames: world_names,
    });
    const assigned = getCharacterNexusRoles(settings?.nexusCharacterRoles, character?.avatar);
    return { character, linkedBooks, assigned, worldNames: world_names || [] };
}

/**
 * Resolve an operation using the originating character, not the open chat.
 * The avatar filename remains stable when character-array positions change.
 */
export function getNexusRoleResolutionForChatRef(role, chatRef, settings = extension_settings.STMemoryBooks) {
    if (!chatRef) return getCurrentNexusRoleResolution(role, settings);
    if (chatRef.type === 'group') return { state: 'no-character', name: '', role };
    if (chatRef.type !== 'character' || !String(chatRef.avatarUrl || '').trim()) {
        return { state: 'missing-character', name: '', role };
    }
    const avatar = String(chatRef.avatarUrl).trim();
    const character = characters?.find(item => item?.avatar === avatar);
    if (!character) {
        return { state: 'missing-character', name: getCharacterNexusRoles(settings?.nexusCharacterRoles, avatar)[role] || '', role };
    }
    const linkedBooks = getLinkedCharacterWorlds({
        character, worldInfo: world_info, worldNames: world_names,
    });
    const override = getNexusChatRoleOverride(
        settings?.nexusChatRoleOverrides, chatRef, getStmbChatKey(chatRef));
    if (override?.invalid) return { state: 'invalid-override', name: '', role };
    return resolveCharacterNexusRole({
        roles: override ? { [avatar]: override } : settings?.nexusCharacterRoles,
        avatar, role, linkedBooks, worldNames: world_names || [],
    });
}

export function getCurrentNexusRoleResolution(role, settings = extension_settings.STMemoryBooks) {
    const { character, linkedBooks, worldNames } = getActiveNexusRoleContext(settings);
    if (!character) return { state: 'no-character', name: '', role };
    const currentRef = getCurrentStmbChatRef();
    if (currentRef?.type === 'character' && currentRef.avatarUrl === character.avatar &&
        String(currentRef.fileName || '').trim()) {
        return getNexusRoleResolutionForChatRef(role, currentRef, settings);
    }
    return resolveCharacterNexusRole({
        roles: settings?.nexusCharacterRoles,
        avatar: character.avatar,
        role, linkedBooks, worldNames,
    });
}
