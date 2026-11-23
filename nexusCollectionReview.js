// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
// Final human edits remain scoped to already approved Scene sources / Nexus operations.

import { validateSlothSceneResponse } from './nexusSlothScenePrompt.js';

const requireThat = (ok,message) => { if (!ok) throw new Error(message); };
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);

/** Edits cannot change which source messages an approved Scene covers. */
export function reviewSlothSceneDrafts(scenes, forms) {
    requireThat(Array.isArray(scenes) && Array.isArray(forms) && scenes.length === forms.length,
        'A reviewed Scene form is missing; no changes saved.');
    return scenes.map((scene,index) => {
        const form=forms[index];
        requireThat(record(form) && typeof form.title==='string' && typeof form.content==='string',
            'Scene '+(index+1)+' has missing review fields.');
        const title=form.title.trim();
        requireThat(title.length>0 && title.length<=180 && !/[\r\n]/.test(title),
            'Scene '+(index+1)+' needs a short, single-line title.');
        const checked=validateSlothSceneResponse({
            title,content:form.content,keywords:form.keywords,
        });
        // The caller preserves the AI/plan source IDs and event completion order.
        return {...scene,title,content:checked.content,keywords:checked.keywords};
    });
}

/** The operator, UID, reason and quoted source evidence are never editable here. */
export function reviewSlothNexusDrafts(edits, forms) {
    requireThat(Array.isArray(edits) && Array.isArray(forms) && edits.length===forms.length,
        'A reviewed Nexus change is missing; no changes saved.');
    return edits.map((edit,index) => {
        const form=forms[index];
        requireThat(record(edit) && record(form) && typeof form.body==='string' &&
            form.body.length<=60000, 'Nexus change '+(index+1)+' has an invalid review body.');
        const updated={...edit};
        if(edit.action==='create') updated.content=form.body;
        else updated.text=form.body;
        if(edit.keywords!==undefined){
            requireThat(Array.isArray(form.keywords),
                'Nexus change '+(index+1)+' has missing keyword fields.');
            const keywords=form.keywords.map(value=>String(value).trim()).filter(Boolean);
            requireThat(keywords.length<=16 && new Set(keywords.map(x=>x.toLowerCase())).size===keywords.length,
                'Nexus detail keywords must be distinct and no more than 16.');
            updated.keywords=keywords;
        }
        return updated;
    });
}
