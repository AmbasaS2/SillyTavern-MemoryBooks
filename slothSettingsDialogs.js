// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only

import { saveSettings } from '../../../../script.js';
import { DOMPurify } from '../../../../lib.js';
import { Popup, POPUP_RESULT, POPUP_TYPE } from '../../../popup.js';
import { translate } from '../../../i18n.js';
import { escapeHtml } from '../../../utils.js';
import { getActiveSlothSummaryPreset, getSlothSummaryPresets, SLOTH_BUILTIN_PROMPT_ID } from './slothSummaryPrompts.js';
import { SLOTH_DEFAULT_SUMMARY_PROMPT } from './nexusSlothScenePrompt.js';
import { getSlothSideDestination, getSlothSidePresets, getSlothSideRecall,
    isSlothSideLinked, normalizeSlothSideRecall, SLOTH_CREATE_SIDE_BOOK } from './slothSidePrompts.js';
import { getActiveNexusRoleContext } from './nexusCharacterRolesRuntime.js';
import { getCurrentStmbChatRef, getStmbChatKey } from './stmbJobs.js';
import { getSlothSideContinuationOptions } from './nexusCollectorRuntime.js';
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
        ...(format==='sloth-side-prompt'?{responseFormat:record.responseFormat||'',recallMode:record.recallMode||'disabled'}:{})};
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const link=document.createElement('a');
    link.href=url;
    link.download=format+'-'+record.name.replace(/[^\p{L}\p{N}_ -]/gu,'_').slice(0,65)+'.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function mountPromptLibrary({target, title, heading=title, records, appliedId, format, save, remove, recall, destination, card}) {
    const isSummary=format==='sloth-summary-prompt';
    const suffix=card?'side-'+card.number:'summary';
    const id=field=>`stmb-${suffix}-prompt-${field}`;
    const icon = (name,glyph,label) => actionButton(name,glyph,label);
    const bookLabel=t('Save to lorebook','SlothSideDestination');
    const unassignedBook=t('Choose a lorebook','SlothUnassigned');
    const automaticBook=t('Little Things (create if needed)','SlothSideAutoBook');
    const entryLabel=t('Entry to continue','SlothSideEntryTarget');
    const automaticEntry=t('Find matching entry automatically','SlothSideAutoEntry');
    const editButtons = icon('save','fa-floppy-disk',t('Save','Save')) +
        icon('rename','fa-pen',t('Rename prompt','SlothPromptRename')) +
        icon('copy','fa-file-circle-plus',t('Save as new prompt','SlothPromptSaveAs'));
    target.classList.add('stmb-prompt-library');
    target.innerHTML=DOMPurify.sanitize(`
        <header class="stmb-prompt-heading"><label for="${id(card?'text':'choice')}">${html(heading)}</label><div class="stmb-prompt-tools">
            ${card?editButtons:''}
            ${icon('expand','fa-expand',t('View full prompt','SlothPromptExpand'))}
            ${icon('export','fa-file-export',t('Export prompt','SlothPromptExport'))}
            ${icon('import','fa-file-import',t('Import prompt','SlothPromptImport'))}
            ${icon('delete','fa-trash',t('Delete prompt','SlothPromptDelete'))}
        </div></header>
        ${card?'':`<div class="stmb-prompt-selection">
            <select id="${id('choice')}" class="text_pole" aria-label="${html(title)}"></select>
            ${editButtons}
        </div>`}
        <textarea id="${id('text')}" class="text_pole" rows="5" spellcheck="false" aria-label="${html(title)}"></textarea>
        ${isSummary?'':`<details class="stmb-prompt-format"><summary>${html(t('Response format (optional)','SlothSideFormat'))}</summary>
          <textarea id="${id('format')}" class="text_pole" rows="3" aria-label="${html(t('Response format (optional)','SlothSideFormat'))}"></textarea></details>`}
        ${recall?`<label class="stmb-sloth-inline-field" for="${id('recall')}">${html(t('Side Prompt recall','SlothSideRecall'))}
          <select id="${id('recall')}" class="text_pole">
            <option value="disabled">${html(t('Do not inject','SlothRecallDisabled'))}</option>
            <option value="constant">${html(t('Always include','SlothRecallConstant'))}</option>
            <option value="vector">${html(t('Vector','NexusRecallVector'))}</option>
            <option value="keyword">${html(t('Keywords','SlothRecallKeywords'))}</option>
          </select></label>`:''}
        ${destination?`<label class="stmb-sloth-inline-field" for="${id('book')}">${html(bookLabel)}
          <select id="${id('book')}" class="text_pole"></select></label>
          <button type="button" class="menu_button stmb-sloth-side-target" id="${id('entry')}" hidden></button>
          <small id="${id('destination-help')}"></small>`:''}
        <small class="stmb-prompt-status" id="${id('status')}" role="status" aria-live="polite"></small>
        <input type="file" id="${id('file')}" accept=".json,application/json" hidden>`);
    const find=field=>target.querySelector('#'+id(field));
    const button=action=>target.querySelector(`[data-prompt-action="${action}"]`);
    const select=find('choice'), editor=find('text'), response=find('format'), file=find('file');
    const recallSelect=find('recall');
    const bookSelect=find('book'), entryButton=find('entry');
    const empty={id:'',name:t('New Side Prompt','SlothSideNew'),text:'',responseFormat:''};
    let current=records.find(record=>record.id===appliedId)||records[0]||empty;
    let busy=false;
    const drafts=new Map();
    const value=()=>({...current,text:editor.value,responseFormat:response?.value||''});
    const readOnly=()=>current.builtin===true;
    const dirty=()=>editor.value!==current.text||(response?.value||'')!==(current.responseFormat||'');
    const setStatus=(message='')=>{find('status').textContent=message;};
    const sync=()=>{
        if(select)select.disabled=busy;
        if(recallSelect)recallSelect.disabled=busy||!current.id;
        if(bookSelect) {
            bookSelect.disabled=busy||!current.id||!destination.enabled;
            entryButton.disabled=bookSelect.disabled;
        }
        button('save').disabled=busy||!editor.value.trim()||!(dirty()||(isSummary&&current.id!==appliedId));
        button('copy').disabled=busy||!editor.value.trim()||Boolean(card&&!current.id);
        button('rename').disabled=busy||!current.id||readOnly();
        button('delete').disabled=busy||readOnly()||(!card&&!current.id);
        button('export').disabled=busy||!current.id||dirty();
        button('import').disabled=busy;
        button('expand').disabled=busy||!editor.value.trim();
        setStatus(dirty()?t('Unsaved edits','SlothPromptUnsaved'):
            (isSummary&&current.id===appliedId?t('In use','SlothPromptActive'):''));
    };
    const renderDestination=()=>{
        if(!bookSelect)return;
        const {book,create,entry}=destination.get(current.id);
        const books=destination.books();
        if(book&&!books.includes(book))books.push(book);
        bookSelect.replaceChildren(new Option(unassignedBook,''), ...books.map(name=>new Option(name,name)),
            new Option(automaticBook,SLOTH_CREATE_SIDE_BOOK));
        bookSelect.value=create ? SLOTH_CREATE_SIDE_BOOK : book;
        entryButton.hidden=!destination.enabled||!book;
        entryButton.textContent=entryLabel+(entry ? ' · '+entry.title : '');
        find('destination-help').textContent=!destination.enabled
            ? t('Open a character chat to choose a lorebook.','SlothSideOpenChat')
            : create ? t('The first approved save connects Little Things to this character.','SlothSideAutoBookHelp')
            : book ? t('Existing lorebook links stay as configured. Choose an entry to continue an older record.','SlothSideExistingBookHelp')
            : '';
    };
    const render=()=>{
        if(select) {
            select.replaceChildren(...records.map(record=>new Option(record.name,record.id)));
            select.value=current.id;
        }
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
        }
        renderDestination();
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
        !(card?.names()||records).some(record=>record.id!==id&&record.name.toLocaleLowerCase()===name.toLocaleLowerCase());
    const warning=t('Enter a unique name of up to 80 characters.','SlothPromptNameInvalid');
    const saveRecord=async (draft,activate=true)=>{
        if(!draft.text.trim())return;
        const id=await save(draft,activate);
        const stored={id,name:draft.name,text:draft.text,responseFormat:draft.responseFormat||''};
        if(card&&current.id&&id!==current.id) {
            card.added(stored);
            return;
        }
        const index=records.findIndex(record=>record.id===id);
        if(!records[index]?.builtin) {
            if(index<0) records.push(stored);
            else records[index]=stored;
        }
        if(activate&&isSummary) appliedId=id;
        current=records.find(record=>record.id===id)||stored;
        card?.changed(current);
        drafts.delete(id);
        render();
    };
    const saveAs=async draft=>{
        const name=await askPresetName(t('Save as new prompt','SlothPromptSaveAs'));
        if(name===null)return;
        if(!validName(name,'')) {toastr.warning(warning,'STMemoryBooks');return;}
        await saveRecord({...draft,id:'',name,recallMode:recall?.get(draft.id)});
        drafts.delete('');
    };
    select?.addEventListener('change',()=>{
        if(busy){select.value=current.id;return;}
        if(dirty())drafts.set(current.id,value());
        current=records.find(record=>record.id===select.value)||empty;
        render();
    });
    for(const input of [editor,response])input?.addEventListener('input',sync);
    recallSelect?.addEventListener('change',()=>void run(()=>recall.set(current.id,recallSelect.value)));
    bookSelect?.addEventListener('change',()=>void run(async()=>{
        try { await destination.setBook(current.id,bookSelect.value); }
        finally { renderDestination(); }
    }));
    entryButton?.addEventListener('click',()=>void run(async()=>{
        const {book,entry}=destination.get(current.id);
        if(!book)return;
        const entries=await destination.listEntries(book,current.id);
        const popup=markStmbPopup(new Popup(
            '<h3>'+html(entryLabel)+'</h3><p>'+html(book)+'</p><select class="text_pole stmb-sloth-side-entry-choice"></select>',
            POPUP_TYPE.CONFIRM,'',{okButton:t('Save','Save'),cancelButton:t('Cancel','Cancel')}));
        const choice=popup.dlg.querySelector('select');
        choice.setAttribute('aria-label',entryLabel);
        choice.replaceChildren(new Option(automaticEntry,''),...entries.map(item=>
            new Option((item.comment||'#'+item.uid)+' · #'+item.uid,String(item.uid))));
        choice.value=entry&&entries.some(item=>item.uid===entry.uid)?String(entry.uid):'';
        if(await popup.show()!==POPUP_RESULT.AFFIRMATIVE)return;
        const picked=entries.find(item=>String(item.uid)===choice.value);
        await destination.setEntry(current.id,book,picked);
        renderDestination();
    }));
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
        if(readOnly())return;
        if(!current.id&&card) {card.removed();return;}
        const confirmation=t('Delete “{{name}}”?','DeleteSidePromptConfirm').replace('{{name}}',current.name);
        if(await markStmbPopup(new Popup(html(confirmation),POPUP_TYPE.CONFIRM,'')).show()!==POPUP_RESULT.AFFIRMATIVE)return;
        const id=current.id;
        await remove(id);
        if(card) {card.removed();return;}
        records.splice(records.findIndex(record=>record.id===id),1);
        drafts.delete(id);
        if(appliedId===id)appliedId=records.find(record=>record.builtin)?.id||'';
        current=records.find(record=>record.id===appliedId)||records[0]||empty;
        render();
    }));
    button('export').addEventListener('click',()=>writePresetFile({...current,recallMode:recall?.get(current.id)},format));
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
            responseFormat:!isSummary&&typeof data.responseFormat==='string'?data.responseFormat:'',
            recallMode:!isSummary?normalizeSlothSideRecall(data.recallMode):undefined});
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
    const ref=getCurrentStmbChatRef();
    const chatKey=getStmbChatKey(ref);
    const enabled=ref?.type==='character'&&!!ref.fileName;
    const verifyChat=()=>{
        if(!enabled||getStmbChatKey()!==chatKey)throw new Error('The character chat changed.');
    };
    const getRecords=()=>getSlothSidePresets(settings).map(record=>({...record,
        name:record.builtin?t("Diary (Don't read it)",'SlothDiary'):record.name}));
    const destination={
        enabled,
        books:()=>[...new Set(getActiveNexusRoleContext(settings).worldNames)],
        get:id=>getSlothSideDestination(settings,id,ref),
        setBook:async(id,book)=>{
            verifyChat();
            params.slothSideBooks={...params.slothSideBooks,[JSON.stringify([ref.avatarUrl,id])]:book};
            await saveSettings();
        },
        listEntries:(book,id)=>getSlothSideContinuationOptions(book,id,ref),
        setEntry:async(id,book,entry)=>{
            verifyChat();
            const key=JSON.stringify([ref.avatarUrl,ref.fileName,id]);
            params.slothSideEntries ||= {};
            if(entry)params.slothSideEntries[key]={book,uid:entry.uid,title:entry.comment||'#'+entry.uid};
            else delete params.slothSideEntries[key];
            await saveSettings();
        },
    };
    const recall={
        get:id=>getSlothSideRecall(settings,id),
        set:async(id,mode)=>{
            params.slothSideRecallModes={...params.slothSideRecallModes,[id]:normalizeSlothSideRecall(mode)};
            await saveSettings();
        },
    };
    const save=async draft=>{
        const id=draft.id||'sloth-'+randomId();
        const stored={id,name:draft.name,text:draft.text,responseFormat:draft.responseFormat};
        const previous=getSlothSidePresets(settings).filter(record=>!record.builtin);
        params.slothSidePresets=previous.some(record=>record.id===id)
            ? previous.map(record=>record.id===id?stored:record) : [...previous,stored];
        if(draft.recallMode!==undefined)params.slothSideRecallModes={...params.slothSideRecallModes,
            [id]:normalizeSlothSideRecall(draft.recallMode)};
        await saveSettings();
        return id;
    };
    const remove=async id=>{
        params.slothSidePresets=getSlothSidePresets(settings).filter(record=>!record.builtin&&record.id!==id);
        if(params.slothSideRecallModes)delete params.slothSideRecallModes[id];
        await saveSettings();
    };
    const list=document.createElement('div');
    list.className='stmb-side-cards';
    const add=document.createElement('button');
    add.type='button';
    add.className='menu_button stmb-side-card-add';
    add.textContent=t('Add Side Prompt','SlothSideAdd');
    target.append(list,add);
    let sequence=0;
    function addCard(initial,open) {
        const number=++sequence;
        let record=initial;
        const wrapper=document.createElement('div');
        wrapper.className='stmb-side-card';
        const checkbox=document.createElement('input');
        checkbox.type='checkbox';
        checkbox.className='stmb-side-card-link';
        const details=document.createElement('details');
        const summary=document.createElement('summary');
        const editor=document.createElement('div');
        details.append(summary,editor);
        wrapper.append(checkbox,details);
        list.append(wrapper);
        const refresh=()=>{
            const label=t('Use this prompt for this character','SlothSideLink');
            const name=record?.name||t('New Side Prompt','SlothSideNew');
            summary.textContent=name;
            checkbox.title=label;
            checkbox.setAttribute('aria-label',label+' · '+name);
            checkbox.disabled=!enabled||!record?.id;
            checkbox.checked=!!record&&isSlothSideLinked(settings,record.id,ref);
        };
        refresh();
        checkbox.addEventListener('change',async()=>{
            try {
                verifyChat();
                const key=JSON.stringify([ref.avatarUrl,record.id]);
                params.slothSideCharacterLinks ||= {};
                if(checkbox.checked)params.slothSideCharacterLinks[key]=true;
                else delete params.slothSideCharacterLinks[key];
                checkbox.disabled=true;
                await saveSettings();
            } catch(error) {
                console.warn('Memory Books could not change a character Side Prompt.',error);
                toastr.error(t('Failed to save settings. Please try again.','FailedToSaveSettings'),'STMemoryBooks');
            } finally {refresh();}
        });
        const mount=()=>{
            if(!details.open||editor.firstElementChild)return;
            mountPromptLibrary({target:editor,title:summary.textContent,heading:t('Prompt','SlothPromptText'),
                records:record?[record]:[],format:'sloth-side-prompt',destination,recall,save,remove,
                card:{number,names:getRecords,added:next=>addCard(next,true),
                    changed:next=>{if(!record)add.disabled=false;record=next;refresh();},
                    removed:()=>{if(!record)add.disabled=false;wrapper.remove();}},
            });
        };
        details.open=open;
        if(open)mount();
        details.addEventListener('toggle',mount);
        return details;
    }
    getRecords().forEach((record,index)=>addCard(record,index===0));
    add.addEventListener('click',()=>{
        add.disabled=true;
        addCard(null,true).querySelector('textarea').focus();
    });
}
