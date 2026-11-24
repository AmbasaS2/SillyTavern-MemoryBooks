// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only

import { saveSettings } from '../../../../script.js';
import { DOMPurify } from '../../../../lib.js';
import { Popup, POPUP_RESULT, POPUP_TYPE } from '../../../popup.js';
import { translate } from '../../../i18n.js';
import { escapeHtml } from '../../../utils.js';
import { getActiveSlothSummaryPreset, getSlothSummaryPresets, SLOTH_BUILTIN_PROMPT_ID } from './slothSummaryPrompts.js';
import { SLOTH_DEFAULT_SUMMARY_PROMPT } from './nexusSlothScenePrompt.js';
import { getSlothSidePresets, getSlothSideRecall, normalizeSlothSideRecall } from './slothSidePrompts.js';
import { markStmbPopup } from './utils.js';

const t = (source, key) => translate(source, 'STMemoryBooks_' + key);
const html = value => escapeHtml(String(value ?? ''));
const actionButton = (action, icon, label) => `<button type="button" class="menu_button stmb-prompt-icon" data-prompt-action="${action}" title="${html(label)}" aria-label="${html(label)}"><i class="fa-solid ${icon}" aria-hidden="true"></i></button>`;

async function askPresetName(title, initial = '') {
    const prompt = markStmbPopup(new Popup(`<h3>${html(title)}</h3>`, POPUP_TYPE.INPUT, initial,
        {okButton:t('Save','Save'),cancelButton:t('Cancel','Cancel')}));
    const answer = await prompt.show();
    return typeof answer === 'string' ? answer.trim() : null;
}

function writePresetFile(record, format) {
    const data={format,version:1,name:record.name,text:record.text,
        ...(format==='sloth-side-prompt'?{responseFormat:record.responseFormat||''}:{})};
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const link=document.createElement('a');
    link.href=url;
    link.download=format+'-'+record.name.replace(/[^\p{L}\p{N}_ -]/gu,'_').slice(0,65)+'.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function mountPromptLibrary({target, title, heading=title, records, appliedId, format, save, remove, recall}) {
    const isSummary=format==='sloth-summary-prompt';
    const suffix=isSummary?'summary':'side';
    const id=field=>`stmb-${suffix}-prompt-${field}`;
    const icon = (name,glyph,label) => actionButton(name,glyph,label);
    target.classList.add('stmb-prompt-library');
    target.innerHTML=DOMPurify.sanitize(`
        <header class="stmb-prompt-heading"><label for="${id('choice')}">${html(heading)}</label><div class="stmb-prompt-tools">
            ${icon('expand','fa-expand',t('View full prompt','SlothPromptExpand'))}
            ${icon('export','fa-file-export',t('Export prompt','SlothPromptExport'))}
            ${icon('import','fa-file-import',t('Import prompt','SlothPromptImport'))}
            ${icon('delete','fa-trash',t('Delete prompt','SlothPromptDelete'))}
        </div></header>
        <div class="stmb-prompt-selection">
            <select id="${id('choice')}" class="text_pole" aria-label="${html(title)}"></select>
            ${icon('save','fa-floppy-disk',t('Save','Save'))}
            ${icon('rename','fa-pen',t('Rename prompt','SlothPromptRename'))}
            ${icon('copy','fa-file-circle-plus',t('Save as new prompt','SlothPromptSaveAs'))}
        </div>
        <textarea id="${id('text')}" class="text_pole" rows="5" spellcheck="false" aria-label="${html(title)}"></textarea>
        ${isSummary?'':`<details class="stmb-prompt-format"><summary>${html(t('Response format (optional)','SlothSideFormat'))}</summary>
          <textarea id="${id('format')}" class="text_pole" rows="3" aria-label="${html(t('Response format (optional)','SlothSideFormat'))}"></textarea></details>`}
        ${recall?`<label class="stmb-sloth-inline-field" for="${id('recall')}">${html(t('Side Prompt recall','SlothSideRecall'))}
          <select id="${id('recall')}" class="text_pole">
            <option value="disabled">${html(t('Do not inject','SlothRecallDisabled'))}</option>
            <option value="vector">${html(t('Vector','NexusRecallVector'))}</option>
            <option value="keyword">${html(t('Keywords','SlothRecallKeywords'))}</option>
          </select></label><small>${html(t('Applies when you update this Side Prompt.','SlothSideRecallHelp'))}</small>`:''}
        <small class="stmb-prompt-status" id="${id('status')}" role="status" aria-live="polite"></small>
        <input type="file" id="${id('file')}" accept=".json,application/json" hidden>`);
    const find=field=>target.querySelector('#'+id(field));
    const button=action=>target.querySelector(`[data-prompt-action="${action}"]`);
    const select=find('choice'), editor=find('text'), response=find('format'), file=find('file');
    const recallSelect=find('recall');
    const empty={id:'',name:t('New Side Prompt','SlothSideNew'),text:'',responseFormat:''};
    let current=records.find(record=>record.id===appliedId)||records[0]||empty;
    let busy=false;
    const drafts=new Map();
    const value=()=>({...current,text:editor.value,responseFormat:response?.value||''});
    const readOnly=()=>current.builtin===true;
    const dirty=()=>editor.value!==current.text||(response?.value||'')!==(current.responseFormat||'');
    const setStatus=(message='')=>{find('status').textContent=message;};
    const sync=()=>{
        button('save').disabled=busy||!editor.value.trim()||!(dirty()||(isSummary&&current.id!==appliedId));
        button('copy').disabled=busy||!editor.value.trim();
        button('rename').disabled=busy||!current.id||readOnly();
        button('delete').disabled=busy||!current.id||readOnly();
        button('export').disabled=busy||!current.id||dirty();
        button('import').disabled=busy;
        button('expand').disabled=busy||!editor.value.trim();
        setStatus(dirty()?t('Unsaved edits','SlothPromptUnsaved'):
            (isSummary&&current.id===appliedId?t('In use','SlothPromptActive'):''));
    };
    const render=()=>{
        const options=isSummary?records:[empty,...records];
        select.replaceChildren(...options.map(record=>new Option(record.name,record.id)));
        select.value=current.id;
        const draft=drafts.get(current.id)||current;
        editor.value=draft.text;
        editor.scrollTop=0;
        editor.readOnly=readOnly();
        if(response) {
            response.value=draft.responseFormat||'';
            response.readOnly=readOnly();
        }
        if(recallSelect) {
            recallSelect.value=recall.get(current.id);
            recallSelect.disabled=!current.id;
        }
        sync();
    };
    const run=async task=>{
        if(busy)return;
        busy=true;
        sync();
        try { await task(); }
        catch(error) {
            console.warn('Memory Books could not update a prompt preset.',error);
            toastr.error(t('Failed to save settings. Please try again.','FailedToSaveSettings'),'STMemoryBooks');
        } finally {busy=false;sync();}
    };
    const validName=(name,id)=>name&&name.length<=80&&!/[\r\n]/u.test(name)&&
        !records.some(record=>record.id!==id&&record.name.toLocaleLowerCase()===name.toLocaleLowerCase());
    const warning=t('Enter a unique name of up to 80 characters.','SlothPromptNameInvalid');
    const saveRecord=async (draft,activate=true)=>{
        if(!draft.text.trim())return;
        const id=await save(draft,activate);
        const stored={id,name:draft.name,text:draft.text,responseFormat:draft.responseFormat||''};
        const index=records.findIndex(record=>record.id===id);
        if(!records[index]?.builtin) {
            if(index<0) records.push(stored);
            else records[index]=stored;
        }
        if(activate&&isSummary) appliedId=id;
        current=records.find(record=>record.id===id)||stored;
        drafts.delete(id);
        render();
    };
    const saveAs=async draft=>{
        const name=await askPresetName(t('Save as new prompt','SlothPromptSaveAs'));
        if(name===null)return;
        if(!validName(name,'')) {toastr.warning(warning,'STMemoryBooks');return;}
        await saveRecord({...draft,id:'',name});
        drafts.delete('');
    };
    select.addEventListener('change',()=>{
        if(busy){select.value=current.id;return;}
        if(dirty())drafts.set(current.id,value());
        current=records.find(record=>record.id===select.value)||empty;
        render();
    });
    for(const input of [editor,response])input?.addEventListener('input',sync);
    recallSelect?.addEventListener('change',()=>void run(()=>recall.set(current.id,recallSelect.value)));
    button('save').addEventListener('click',()=>void run(()=>current.id?saveRecord(value()):saveAs(value())));
    button('copy').addEventListener('click',()=>void run(()=>saveAs(value())));
    button('rename').addEventListener('click',()=>void run(async()=>{
        const name=await askPresetName(t('Rename prompt','SlothPromptRename'),current.name);
        if(name===null)return;
        if(!validName(name,current.id)){toastr.warning(warning,'STMemoryBooks');return;}
        const previous=value();
        await saveRecord({...current,name},false);
        editor.value=previous.text;
        if(response)response.value=previous.responseFormat;
    }));
    button('delete').addEventListener('click',()=>void run(async()=>{
        if(!current.id||readOnly())return;
        const confirmation=t('Delete “{{name}}”?','DeleteSidePromptConfirm').replace('{{name}}',current.name);
        if(await markStmbPopup(new Popup(html(confirmation),POPUP_TYPE.CONFIRM,'')).show()!==POPUP_RESULT.AFFIRMATIVE)return;
        const id=current.id;
        await remove(id);
        records.splice(records.findIndex(record=>record.id===id),1);
        drafts.delete(id);
        if(appliedId===id)appliedId=records.find(record=>record.builtin)?.id||'';
        current=records.find(record=>record.id===appliedId)||records[0]||empty;
        render();
    }));
    button('export').addEventListener('click',()=>writePresetFile(current,format));
    button('expand').addEventListener('click',()=>void run(async()=>{
        const readOnlyPrompt=readOnly();
        const overlay=markStmbPopup(new Popup(DOMPurify.sanitize(`<div class="stmb-prompt-expanded">
            <h3>${html(current.name)}</h3><textarea rows="5" class="text_pole" spellcheck="false" aria-label="${html(current.name)}"></textarea></div>`),
            readOnlyPrompt?POPUP_TYPE.TEXT:POPUP_TYPE.CONFIRM,'',{
                wide:true,allowVerticalScrolling:true,okButton:readOnlyPrompt?false:t('Apply','Apply'),
                cancelButton:t(readOnlyPrompt?'Close':'Cancel',readOnlyPrompt?'Close':'Cancel'),
            }));
        const expanded=overlay.dlg.querySelector('.stmb-prompt-expanded textarea');
        expanded.value=editor.value;
        expanded.readOnly=readOnlyPrompt;
        const fitEditor=()=>{
            expanded.style.height='';
            const border=expanded.offsetHeight-expanded.clientHeight;
            expanded.style.height=(expanded.scrollHeight+border)+'px';
        };
        expanded.addEventListener('input',fitEditor);
        const result=overlay.show();
        requestAnimationFrame(fitEditor);
        if(await result===POPUP_RESULT.AFFIRMATIVE&&!readOnlyPrompt) editor.value=expanded.value;
    }));
    button('import').addEventListener('click',()=>file.click());
    file.addEventListener('change',()=>void run(async()=>{
        const selected=file.files[0];
        file.value='';
        if(!selected)return;
        let data;
        try {if(selected.size<=300000)data=JSON.parse(await selected.text());} catch { /* Show the common import error below. */ }
        if(data?.format!==format||data.version!==1||typeof data.name!=='string'||!data.name.trim()||
            typeof data.text!=='string'||!data.text.trim()) {
            toastr.warning(t('Choose a compatible prompt JSON file.','SlothPromptInvalidFile'),'STMemoryBooks');
            return;
        }
        const label=data.name.trim().replace(/[\r\n]+/g,' ').slice(0,72);
        let name=label;
        for(let number=2;!validName(name,'');number++)name=`${label} (${number})`;
        if(dirty()) drafts.set(current.id,value());
        await saveRecord({id:'',name,text:data.text,
            responseFormat:!isSummary&&typeof data.responseFormat==='string'?data.responseFormat:''});
    }));
    render();
}

const randomId=()=>Array.from(crypto.getRandomValues(new Uint32Array(4)),value=>value.toString(16)).join('-');

export function mountSlothCollectionPrompts(target,settings) {
    const params=settings.moduleSettings;
    const active=getActiveSlothSummaryPreset(settings);
    const records=[{id:SLOTH_BUILTIN_PROMPT_ID,name:t('🦥 Prompt (Default)','SlothPromptDefault'),text:SLOTH_DEFAULT_SUMMARY_PROMPT,builtin:true},
        ...getSlothSummaryPresets(settings).map(preset=>({...preset}))];
    if(active.id==='previous'&&!records.some(preset=>preset.id===active.id)) {
        records.push({...active,name:t('Previous instructions','SlothPromptPrevious')});
    }
    const write=async(presets,selected)=>{
        params.slothSummaryPresets=presets;
        params.slothSummaryPresetId=selected;
        delete params.slothCollectionPrompt;
        await saveSettings();
    };
    mountPromptLibrary({target,title:t('Summary prompts','SlothPromptSettings'),records,appliedId:active.id,format:'sloth-summary-prompt',
        save:async(draft,activate)=>{
            const id=draft.id||randomId();
            const entries=records.filter(record=>record.id!==SLOTH_BUILTIN_PROMPT_ID&&record.id!==id);
            if(id!==SLOTH_BUILTIN_PROMPT_ID)entries.push({id,name:draft.name,text:draft.text});
            await write(entries,activate?id:getActiveSlothSummaryPreset(settings).id);
            return id;
        },
        remove:async id=>write(records.filter(record=>record.id!==id&&record.id!==SLOTH_BUILTIN_PROMPT_ID),
            getActiveSlothSummaryPreset(settings).id===id?SLOTH_BUILTIN_PROMPT_ID:getActiveSlothSummaryPreset(settings).id),
    });
}

export function mountSlothSidePromptSettings(target,settings) {
    const params=settings.moduleSettings;
    const records=getSlothSidePresets(settings).map(record=>({...record,
        name:record.builtin?t('Little Things','SlothLittleThings'):record.name}));
    const write=async (presets,selected)=>{
        params.slothSidePresets=presets;
        params.slothSidePresetId=selected;
        await saveSettings();
    };
    mountPromptLibrary({target,title:t('Side Prompt settings','SlothSidePromptSettings'),heading:t('Prompt','SlothPromptText'),records,
        appliedId:params.slothSidePresetId,format:'sloth-side-prompt',
        recall:{
            get:id=>getSlothSideRecall(settings,id),
            set:async (id,mode)=>{
                if(!id)return;
                params.slothSideRecallModes={...params.slothSideRecallModes,[id]:normalizeSlothSideRecall(mode)};
                await saveSettings();
            },
        },
        save:async (draft,activate)=>{
            const id=draft.id||'sloth-'+randomId();
            const entries=records.filter(record=>!record.builtin&&record.id!==id);
            entries.push({id,name:draft.name,text:draft.text,responseFormat:draft.responseFormat});
            await write(entries,activate?id:params.slothSidePresetId);
            return id;
        },
        remove:async id=>{
            if(params.slothSideRecallModes)delete params.slothSideRecallModes[id];
            await write(records.filter(record=>!record.builtin&&record.id!==id),
                params.slothSidePresetId===id?'':params.slothSidePresetId);
        },
    });
}
