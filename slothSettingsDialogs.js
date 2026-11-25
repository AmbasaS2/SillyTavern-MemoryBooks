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
        <header class="stmb-prompt-heading">${card?`<button type="button" class="stmb-side-card-toggle" aria-expanded="true" aria-controls="${id('body')}"><i class="fa-solid fa-chevron-down" aria-hidden="true"></i><span></span></button>`:`<label for="${id('choice')}">${html(heading)}</label>`}<div class="stmb-prompt-tools">
            ${icon('expand','fa-expand',t('View full prompt','SlothPromptExpand'))}
            ${icon('export','fa-file-export',t('Export prompt','SlothPromptExport'))}
            ${icon('import','fa-file-import',t('Import prompt','SlothPromptImport'))}
            ${icon('delete','fa-trash',t('Delete prompt','SlothPromptDelete'))}
        </div></header>
        ${card?`<div class="stmb-side-card-body" id="${id('body')}">`:''}
        <div class="stmb-prompt-selection">
            <select id="${id('choice')}" class="text_pole" aria-label="${html(title)}"></select>
            ${editButtons}
        </div>
        <textarea id="${id('text')}" class="text_pole" rows="5" spellcheck="false" aria-label="${html(title)}"></textarea>
        ${isSummary?'':`<details class="stmb-prompt-format"><summary>${html(t('Response format (optional)','SlothSideFormat'))}</summary>
          <textarea id="${id('format')}" class="text_pole" rows="3" aria-label="${html(t('Response format (optional)','SlothSideFormat'))}"></textarea></details>`}
        ${card?'<div class="stmb-side-card-settings">':''}
        ${recall?`<label class="stmb-sloth-inline-field" for="${id('recall')}">${html(t('Side Prompt recall','SlothSideRecall'))}
          <select id="${id('recall')}" class="text_pole">
            <option value="disabled">${html(t('Do not inject','SlothRecallDisabled'))}</option>
            <option value="constant">${html(t('Always include','SlothRecallConstant'))}</option>
            <option value="vector">${html(t('Vector','NexusRecallVector'))}</option>
            <option value="keyword">${html(t('Keywords','SlothRecallKeywords'))}</option>
          </select></label>`:''}
        ${destination?`<label class="stmb-sloth-inline-field" for="${id('book')}">${html(bookLabel)}
          <select id="${id('book')}" class="text_pole"></select></label>`:''}
        ${card?'</div>':''}
        ${destination?`<button type="button" class="menu_button stmb-sloth-side-target" id="${id('entry')}" hidden></button>
          <small id="${id('destination-help')}"></small>`:''}
        <small class="stmb-prompt-status" id="${id('status')}" role="status" aria-live="polite"></small>
        <input type="file" id="${id('file')}" accept=".json,application/json" hidden>
        ${card?'</div>':''}`);
    if(card) {
        const heading=target.querySelector('.stmb-prompt-heading');
        const toggle=heading.querySelector('.stmb-side-card-toggle');
        const tools=heading.querySelector('.stmb-prompt-tools');
        const body=target.querySelector('.stmb-side-card-body');
        heading.append(card.removeSlot);
        target.querySelector('.stmb-prompt-selection').prepend(card.checkbox);
        const setOpen=expanded=>{
            body.hidden=!expanded;
            tools.hidden=!expanded;
            toggle.setAttribute('aria-expanded',String(expanded));
        };
        toggle.addEventListener('click',()=>setOpen(body.hidden));
        setOpen(card.open);
    }
    const find=field=>target.querySelector('#'+id(field));
    const button=action=>target.querySelector(`[data-prompt-action="${action}"]`);
    const select=find('choice'), editor=find('text'), response=find('format'), file=find('file');
    const recallSelect=find('recall');
    const bookSelect=find('book'), entryButton=find('entry');
    const empty={id:'',name:t('Choose a prompt','SlothSideChoosePreset'),text:'',responseFormat:''};
    let current=records.find(record=>record.id===appliedId)||(card?empty:records[0]);
    let busy=false;
    const drafts=new Map();
    const value=()=>({...current,text:editor.value,responseFormat:response?.value||''});
    const readOnly=()=>current.builtin===true;
    const dirty=()=>editor.value!==current.text||(response?.value||'')!==(current.responseFormat||'');
    const setStatus=(message='')=>{find('status').textContent=message;};
    const sync=()=>{
        select.disabled=busy;
        if(recallSelect)recallSelect.disabled=busy||!current.id;
        if(bookSelect) {
            bookSelect.disabled=busy||!current.id||!destination.enabled;
            entryButton.disabled=bookSelect.disabled;
        }
        button('save').disabled=busy||!editor.value.trim()||!(dirty()||(isSummary&&current.id!==appliedId));
        button('copy').disabled=busy||!editor.value.trim()||Boolean(card&&!current.id);
        button('rename').disabled=busy||!current.id||readOnly();
        button('delete').disabled=busy||readOnly()||!current.id;
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
    const renderChoices=()=>{
        const choices=card?[empty,...card.choices()]:records;
        select.replaceChildren(...choices.map(record=>new Option(record.name,record.id)));
        select.value=current.id;
    };
    const render=()=>{
        renderChoices();
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
            await card.added(stored);
            return;
        }
        const index=records.findIndex(record=>record.id===id);
        if(!records[index]?.builtin) {
            if(index<0) records.push(stored);
            else records[index]=stored;
        }
        if(activate&&isSummary) appliedId=id;
        current=records.find(record=>record.id===id)||stored;
        drafts.delete(id);
        render();
        await card?.changed(current);
    };
    const saveAs=async draft=>{
        const name=await askPresetName(t('Save as new prompt','SlothPromptSaveAs'));
        if(name===null)return;
        if(!validName(name,'')) {toastr.warning(warning,'STMemoryBooks');return;}
        await saveRecord({...draft,id:'',name,recallMode:recall?.get(draft.id)});
        drafts.delete('');
    };
    if(card)select.addEventListener('focus',renderChoices);
    select.addEventListener('change',()=>{
        if(busy){select.value=current.id;return;}
        const next=(card?.choices()||records).find(record=>record.id===select.value)||empty;
        void run(async()=>{
            if(dirty())drafts.set(current.id,value());
            current=next;
            render();
            await card?.changed(current);
        });
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
        if(!current.id||readOnly())return;
        const confirmation=t('Delete “{{name}}”?','DeleteSidePromptConfirm').replace('{{name}}',current.name);
        if(await markStmbPopup(new Popup(html(confirmation),POPUP_TYPE.CONFIRM,'')).show()!==POPUP_RESULT.AFFIRMATIVE)return;
        const id=current.id;
        await remove(id);
        const recordIndex=records.findIndex(record=>record.id===id);
        if(recordIndex>=0)records.splice(recordIndex,1);
        drafts.delete(id);
        if(card) {
            current=empty;
            render();
            await card.changed(current);
            return;
        }
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
    const section=target.closest('#stmb-sloth-side-prompts');
    const info=section?.querySelector('#stmb-sloth-side-help-toggle');
    const help=section?.querySelector('#stmb-sloth-side-help');
    if(info&&help) {
        const setHelp=visible=>{
            help.hidden=!visible;
            info.setAttribute('aria-expanded',String(visible));
        };
        info.addEventListener('click',event=>{
            event.preventDefault();
            event.stopPropagation();
            const visible=help.hidden;
            if(visible)section.open=true;
            setHelp(visible);
        });
        section.addEventListener('toggle',()=>{if(!section.open)setHelp(false);});
    }
    const list=document.createElement('div');
    list.className='stmb-side-cards';
    const add=document.createElement('button');
    add.type='button';
    add.className='menu_button stmb-side-card-add';
    const addIcon=document.createElement('i');
    addIcon.className='fa-solid fa-plus';
    addIcon.setAttribute('aria-hidden','true');
    add.append(addIcon,document.createTextNode(t('Add Side Prompt','SlothSideAdd')));
    target.append(list,add);
    const rows=[];
    let sequence=0;
    const persistSlots=async()=>{
        if(!enabled)return;
        verifyChat();
        params.slothSideSlots={...params.slothSideSlots,[ref.avatarUrl]:rows.map(row=>row.record?.id||'')};
        await saveSettings();
    };
    const setLink=(id,use)=>{
        if(!enabled||!id)return;
        const key=JSON.stringify([ref.avatarUrl,id]);
        params.slothSideCharacterLinks ||= {};
        if(use)params.slothSideCharacterLinks[key]=true;
        else delete params.slothSideCharacterLinks[key];
    };
    const reportSettingsError=error=>{
        console.warn('Memory Books could not change a Side Prompt slot.',error);
        toastr.error(t('Failed to save settings. Please try again.','FailedToSaveSettings'),'STMemoryBooks');
    };
    const refreshRemoveButtons=()=>rows.forEach(row=>{row.remove.hidden=rows.length===1;});
    function addCard(initial,open) {
        const number=++sequence;
        const wrapper=document.createElement('div');
        wrapper.className='stmb-side-row';
        const checkbox=document.createElement('input');
        checkbox.type='checkbox';
        checkbox.className='stmb-side-card-link';
        const removeSlot=document.createElement('button');
        removeSlot.type='button';
        removeSlot.className='menu_button stmb-side-slot-remove';
        const removeLabel=t('Remove Side Prompt slot','SlothSideRemoveSlot');
        removeSlot.setAttribute('aria-label',removeLabel);
        removeSlot.title=removeLabel;
        removeSlot.innerHTML='<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
        const row={record:initial,remove:removeSlot};
        rows.push(row);
        list.append(wrapper);
        const refresh=()=>{
            const label=t('Use this prompt for this character','SlothSideLink');
            const name=row.record?.name||t('Choose a prompt','SlothSideChoosePreset');
            wrapper.querySelector('.stmb-side-card-toggle span').textContent=name;
            checkbox.title=label;
            checkbox.setAttribute('aria-label',label+' · '+name);
            checkbox.disabled=!enabled||!row.record?.id;
            checkbox.checked=!!row.record?.id&&isSlothSideLinked(settings,row.record.id,ref);
        };
        checkbox.addEventListener('change',async()=>{
            try {
                verifyChat();
                setLink(row.record?.id,checkbox.checked);
                checkbox.disabled=true;
                await saveSettings();
            } catch(error) {reportSettingsError(error);}
            finally {refresh();}
        });
        removeSlot.addEventListener('click',async()=>{
            if(rows.length===1)return;
            try {
                if(enabled)verifyChat();
                setLink(row.record?.id,false);
                rows.splice(rows.indexOf(row),1);
                wrapper.remove();
                refreshRemoveButtons();
                await persistSlots();
            } catch(error) {reportSettingsError(error);}
        });
        mountPromptLibrary({target:wrapper,title:t('Choose a prompt','SlothSideChoosePreset'),
            records:getRecords(),appliedId:row.record?.id,format:'sloth-side-prompt',destination,recall,save,remove,
            card:{
                number,names:getRecords,checkbox,removeSlot,open,
                choices:()=>getRecords().filter(record=>!rows.some(other=>other!==row&&other.record?.id===record.id)),
                added:async next=>{addCard(next,true);await persistSlots();},
                changed:async next=>{
                    const previous=row.record?.id||'';
                    if(previous!==next.id&&enabled)verifyChat();
                    row.record=next.id?next:null;
                    refresh();
                    if(previous===next.id)return;
                    setLink(previous,false);
                    await persistSlots();
                },
            },
        });
        refresh();
        refreshRemoveButtons();
        return wrapper;
    }
    const available=getRecords();
    const stored=enabled?params.slothSideSlots?.[ref.avatarUrl]:null;
    const selected=Array.isArray(stored)?stored:available.filter(record=>{
        const choice=destination.get(record.id);
        return isSlothSideLinked(settings,record.id,ref)||choice.book||choice.create;
    }).map(record=>record.id);
    (selected.length?selected:['']).forEach((id,index)=>{
        const record=rows.some(row=>row.record?.id===id)?null:available.find(item=>item.id===id);
        addCard(record||null,index===0);
    });
    add.addEventListener('click',async()=>{
        add.disabled=true;
        try {
            if(enabled)verifyChat();
            addCard(null,true).querySelector('select').focus();
            await persistSlots();
        } catch(error) {reportSettingsError(error);}
        finally {add.disabled=false;}
    });
}
