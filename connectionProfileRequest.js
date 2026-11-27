// Copyright (C) 2024–2026 Aiko Hanasaki
// SPDX-License-Identifier: AGPL-3.0-only

/** Resolve a specific ST connection, or the active one if no ID is provided. */
export function getSelectedConnectionProfile(context, translate = (_key, fallback) => fallback,
    profileId = context?.extensionSettings?.connectionManager?.selectedProfile) {
    const service = context?.ConnectionManagerRequestService;
    if (!profileId) return null;
    if (typeof service?.sendRequest !== 'function') {
        throw new Error(translate('STMemoryBooks_ConnectionManagerUnavailable', 'SillyTavern connection profile requests are unavailable. Update SillyTavern or deselect the connection profile.'));
    }

    const profile = service.getProfile(profileId);
    const mapping = service.validateProfile(profile);
    if (mapping.selected !== 'openai' || !mapping.source) {
        throw new Error(translate('STMemoryBooks_ConnectionProfileRequiresChatCompletion', 'The selected SillyTavern connection profile must use Chat Completion.'));
    }
    return { service, profileId, profile, source: mapping.source };
}

export function listChatCompletionProfiles(context) {
    const service = context?.ConnectionManagerRequestService;
    if (typeof service?.sendRequest !== 'function') return [];
    return (context?.extensionSettings?.connectionManager?.profiles ?? []).filter(profile => {
        try {
            const mapping = service.validateProfile(profile);
            const model = profile['custom-connection']?.settings?.custom_model || profile.model;
            return !!profile.id && !!model && mapping.selected === 'openai' && !!mapping.source;
        } catch {
            return false;
        }
    });
}

/** Preserve connection routing and preset while overriding STMB generation fields. */
export function prepareConnectionProfileRequest(connection, body, signal) {
    if (!connection) return null;
    const { service, profileId } = connection;
    const overrides = {
        model: body.model,
        temperature: body.temperature,
    };
    // Keep STMB's token limit and structured-output choice authoritative over
    // the connection preset, including the absence of a JSON schema.
    for (const field of ['max_tokens', 'max_completion_tokens', 'max_output_tokens', 'max_new_tokens', 'json_schema']) {
        overrides[field] = body[field];
    }
    if (Object.hasOwn(body, 'include_reasoning')) {
        overrides.include_reasoning = body.include_reasoning;
    }
    return () => service.sendRequest(
        profileId,
        body.messages,
        body.max_tokens,
        { stream: body.stream, signal, extractData: false, includePreset: true },
        overrides,
    );
}
