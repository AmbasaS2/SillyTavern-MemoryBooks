// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only

import { saveSettings } from '../../../../script.js';
import { DOMPurify } from '../../../../lib.js';
import { Popup, POPUP_RESULT, POPUP_TYPE } from '../../../popup.js';
import { translate } from '../../../i18n.js';
import { escapeHtml } from '../../../utils.js';
import { getActiveSlothSummaryPreset, getSlothSummaryPresets, SLOTH_BUILTIN_PROMPT_ID } from './slothSummaryPrompts.js';
import { SLOTH_DEFAULT_SUMMARY_PROMPT } from './nexusSlothScenePrompt.js';
import { listTemplates, upsertTemplate } from './sidePromptsManager.js';
import { collectTemplateRuntimeMacros } from './sidePromptMacros.js';
import { markStmbPopup } from './utils.js';

const t = (source, key) => escapeHtml(translate(source, 'STMemoryBooks_' + key));
const h = value => escapeHtml(String(value ?? ''));
const button = (id, label) => `<button id="${id}" type="button" class="menu_button">${label}</button>`;

function dialog(markup, title) {
    const popup = new Popup(DOMPurify.sanitize(`<div class="stmb-sloth-review stmb-sloth-form"><h3>${title}</h3>${markup}</div>`),
        POPUP_TYPE.CONFIRM, '', {
            wide: true, allowVerticalScrolling: true,
            okButton: translate('Save', 'STMemoryBooks_Save'),
            cancelButton: translate('Cancel', 'STMemoryBooks_Cancel'),
        });
    markStmbPopup(popup);
    return popup;
}

export async function showSlothCollectionPrompts(settings) {
    const builtin = { id:SLOTH_BUILTIN_PROMPT_ID, text:SLOTH_DEFAULT_SUMMARY_PROMPT,
        name:translate('Default prompt','STMemoryBooks_SlothPromptDefault') };
    const saved = getActiveSlothSummaryPreset(settings);
    const drafts = [builtin, ...getSlothSummaryPresets(settings).map(preset=>({...preset}))];
    if (saved.id === 'previous' && !drafts.some(preset => preset.id === saved.id)) {
        drafts.push({...saved,name:translate('Previous instructions','STMemoryBooks_SlothPromptPrevious')});
    }
    const popup = dialog(`
        <label class="stmb-sloth-edit">${t('Prompt to use', 'SlothPromptChoose')}
            <select id="stmb-sloth-prompt-choice" class="text_pole"></select>
        </label>
        <label class="stmb-sloth-edit" id="stmb-sloth-prompt-name-field">${t('Name','SlothSideName')}
            <input id="stmb-sloth-prompt-name" type="text" class="text_pole" maxlength="80">
        </label>
        <label class="stmb-sloth-edit">${t('Summary instructions','SlothPromptInstructions')}
            <textarea id="stmb-sloth-prompt" class="text_pole" rows="12" spellcheck="false"></textarea>
        </label>
        <div class="stmb-sloth-controls">
            ${button('stmb-sloth-prompt-copy', t('Copy and edit', 'SlothPromptCopy'))}
            ${button('stmb-sloth-prompt-export', t('Export JSON', 'SidePrompts_ExportJSON'))}
            ${button('stmb-sloth-prompt-import', t('Import JSON', 'SidePrompts_ImportJSON'))}
            <input id="stmb-sloth-prompt-file" type="file" accept="application/json,.json" hidden>
        </div><small id="stmb-sloth-prompt-error" role="status"></small>`, t('Collection prompts', 'SlothPromptSettings'));
    const find = id => popup.dlg.querySelector('#stmb-sloth-prompt-' + id);
    const picker = find('choice');
    const text = popup.dlg.querySelector('#stmb-sloth-prompt');
    const name = find('name');
    const file = find('file');
    let current = drafts.find(preset => preset.id === saved.id) || builtin;
    const store = () => {
        if (current.id === builtin.id) return;
        current.name = name.value.trim() || translate('My prompt','STMemoryBooks_SlothPromptCustom');
        current.text = text.value;
    };
    const render = () => {
        picker.replaceChildren(...drafts.map(preset=>new Option(preset.name,preset.id)));
        picker.value = current.id;
        text.value = current.text;
        text.readOnly = current.id === builtin.id;
        name.value = current.name;
        find('name-field').hidden = text.readOnly;
    };
    picker.addEventListener('change', () => {
        store();
        current = drafts.find(preset => preset.id === picker.value) || builtin;
        render();
    });
    const add = (name,text) => {
        const id=Array.from(crypto.getRandomValues(new Uint32Array(4)),part=>part.toString(16)).join('-');
        current = {id,name,text};
        drafts.push(current);
        render();
    };
    find('copy').addEventListener('click', () => {
        store();
        add(translate('My prompt','STMemoryBooks_SlothPromptCustom'),current.text);
        name.focus();
    });
    find('export').addEventListener('click', () => {
        store();
        const data = {format:'sloth-summary-prompt',version:1,name:current.name,text:current.text};
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'sloth-summary-prompt.json';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    find('import').addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
        try {
            if (!file.files[0]) return;
            if (file.files[0].size > 300000) throw new Error();
            const data = JSON.parse(await file.files[0].text());
            if (data?.format !== 'sloth-summary-prompt' || data.version !== 1 || typeof data.name !== 'string' ||
                !data.name.trim() || data.name.length > 80 || typeof data.text !== 'string' || !data.text.trim()) throw new Error();
            store();
            add(data.name.trim(),data.text);
            find('error').textContent = '';
        } catch {
            find('error').textContent = translate('Choose a Sloth summary prompt JSON export.', 'STMemoryBooks_SlothPromptBadFile');
        } finally {
            file.value = '';
        }
    });
    render();
    if (await popup.show() !== POPUP_RESULT.AFFIRMATIVE) return;
    store();
    settings.moduleSettings.slothSummaryPresets = drafts.slice(1).filter(preset => preset.text.trim());
    settings.moduleSettings.slothSummaryPresetId = current.text.trim() ? current.id : builtin.id;
    delete settings.moduleSettings.slothCollectionPrompt;
    await saveSettings();
}

export async function showSlothSidePromptSettings() {
    const templates = (await listTemplates()).filter(template => !template.specialKind);
    const popup = dialog(`
        <label class="stmb-sloth-edit">${t('Side Prompt to edit', 'SlothSideChoose')}
            <select id="stmb-sloth-side-choice" class="text_pole">
                <option value="">${t('New Side Prompt', 'SlothSideNew')}</option>
                ${templates.map(template => `<option value="${h(template.key)}">${h(template.name)}</option>`).join('')}
            </select>
        </label>
        <label class="stmb-sloth-edit">${t('Name', 'SlothSideName')}
            <input id="stmb-sloth-side-name" type="text" class="text_pole">
        </label>
        <label class="stmb-sloth-edit">${t('What should the AI record?', 'SlothSideInstruction')}
            <textarea id="stmb-sloth-side-text" class="text_pole" rows="6"></textarea>
        </label>
        <label class="stmb-sloth-edit">${t('Response format (optional)', 'SlothSideFormat')}
            <textarea id="stmb-sloth-side-format" class="text_pole" rows="2"></textarea>
        </label>
        <small>${t('New prompts run when you choose Update Side Prompt and save to Nexus.', 'SlothSideSimpleHelp')}</small>`,
        t('Side Prompt settings', 'SlothSidePromptSettings'));
    const field = id => popup.dlg.querySelector('#stmb-sloth-side-' + id);
    const choice = field('choice');
    const name = field('name');
    const text = field('text');
    const format = field('format');
    const updateSaveState = () => { popup.dlg.querySelector('.popup-button-ok').disabled = !name.value.trim() || !text.value.trim(); };
    choice.addEventListener('change', () => {
        const existing = templates.find(template => template.key === choice.value);
        name.value = existing?.name || '';
        text.value = existing?.prompt || '';
        format.value = existing?.responseFormat || '';
        updateSaveState();
    });
    for (const field of [name, text]) field.addEventListener('input', updateSaveState);
    updateSaveState();
    if (await popup.show() !== POPUP_RESULT.AFFIRMATIVE) return;
    if (!name.value.trim() || !text.value.trim()) return;
    const existing = templates.find(template => template.key === choice.value);
    const input = { key: existing?.key, name: name.value.trim(), prompt: text.value.trim(), responseFormat: format.value.trim() };
    if (!existing) input.triggers = { commands: ['sideprompt'] };
    if (collectTemplateRuntimeMacros(input).length) {
        toastr.info(translate('This prompt uses variables that require values. It will be available in an existing set with those values.',
            'STMemoryBooks_SlothSideNeedsVariables'), 'STMemoryBooks');
    }
    await upsertTemplate(input);
}
