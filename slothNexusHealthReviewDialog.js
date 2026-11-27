// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
// Memory Workshop: changed paragraphs first; complete before/after on demand.
import {Popup,POPUP_TYPE,POPUP_RESULT} from '../../../popup.js';
import {escapeHtml} from '../../../utils.js';
import {translate} from '../../../i18n.js';
import {markStmbPopup} from './utils.js';
import {stageSlothHealthReviewChange,stageSlothHealthReviewBatch} from './slothNexusHealthReview.js';
import {slothDisplayAnchorTitle} from './nexusCollectionPolicy.js';

export const healthReviewLabel=(key,fallback)=>translate(fallback,'STMemoryBooks_SlothHealthReview'+key);
const tr=healthReviewLabel;
const html=v=>escapeHtml(String(v??''));
const kindLabel=kind=>({duplicate:tr('Duplicate','Duplicate memory'),conflict:tr('Conflict','Conflicting memories'),
    validity:tr('Validity','Needs review'),core_to_lt:tr('Move','Move memory')})[kind];
const countLabel=(key,fallback,count)=>tr(key,fallback).replace('{{count}}',String(count));
// Display labels only. Preserve the original title and UID for staging and saving.
function displayTitle(title){
    const value=String(title??'');
    if(value==='Core Memory')return tr('CoreName','Core Memory');
    return slothDisplayAnchorTitle(value,tr('LTName','Anchor'));
}
function renderChange(change){
    const mode=change.constant?tr('Constant','Always-on'):change.vectorized?tr('Vector','Vector'):tr('Keyword','Keyword');
    return '<section class="stmb-workshop-full-entry"><h4>'+html(displayTitle(change.title))+' <small>'+html(mode)+'</small></h4>'+
        '<span class="stmb-workshop-muted">'+html(tr('Before','Before'))+'</span><div class="stmb-workshop-full-text">'+html(change.before??tr('NewEntry','New memory'))+'</div>'+
        '<span class="stmb-workshop-muted">'+html(tr('After','After'))+'</span><div class="stmb-workshop-full-text">'+html(change.after)+'</div>'+
        (change.keywords.length?'<small class="stmb-workshop-muted">'+html(tr('Keywords','Keywords'))+': '+html(change.keywords.join(', '))+'</small>':'')+'</section>';
}
export async function showSlothHealthReviewFindings({review,catalog,original,moduleSettings,showPopup}){
    const rows=review.findings,selected=new Set(),titles=new Map(catalog.entries.map(entry=>[entry.uid,entry.title]));
    const titleOf=uid=>displayTitle(titles.get(uid)||('UID '+uid));
    let approved=null,prepared=null,confirmed=false;
    const eligible=rows.map(finding=>{
        if(!finding.change)return false;
        try{stageSlothHealthReviewChange(original,finding,{moduleSettings});return true;}
        catch{return false;}
    });
    const count=eligible.filter(Boolean).length;
    const summary=tr('Summary','Reviewed {{count}} · Excluded {{excluded}} · Found {{findings}} · Invalid {{rejected}}')
        .replace('{{count}}',String(catalog.entries.length)).replace('{{excluded}}',String(catalog.excluded))
        .replace('{{findings}}',String(rows.length)).replace('{{rejected}}',String(review.rejected));
    function rowHtml(finding,i){
        const change=eligible[i]?finding.change:null;
        const title=change?.type==='dedupe'?tr('DedupeAction','Remove duplicate'):kindLabel(finding.kind);
        const direction=change?.type==='move'?'<div class="stmb-workshop-route"><span>'+html(titleOf(change.sourceUid))+'</span><i class="fa-solid fa-arrow-right" aria-hidden="true"></i><span>'+html(change.targetUid!==undefined?titleOf(change.targetUid):displayTitle(change.newTitle))+'</span></div>':
            change?.type==='dedupe'?'<div class="stmb-workshop-muted">'+html(titleOf(change.uid))+' · '+html(tr('DedupeOne','Remove one identical paragraph'))+'</div>':'';
        const details='<details class="stmb-workshop-evidence"><summary>'+html(tr('Reason','Details'))+'</summary><p>'+html(finding.reason)+'</p>'+
            finding.refs.map(ref=>'<div class="stmb-workshop-reference"><small>'+html(titleOf(ref.uid))+'</small><div class="stmb-workshop-quote">'+html(ref.quote)+'</div></div>').join('')+'</details>';
        return '<article class="stmb-workshop-item'+(change?'':' stmb-workshop-advice')+'">'+
            '<div class="stmb-workshop-item-header">'+(change?'<input type="checkbox" data-health-review-include="'+i+'" aria-label="'+html(title)+'">':'<i class="fa-solid fa-circle-info" aria-hidden="true"></i>')+
            '<strong>'+html(title)+'</strong>'+(!change?'<small class="stmb-workshop-muted">'+html(tr('Advice','Review only'))+'</small>':'')+'</div>'+
            (change?'<div class="stmb-workshop-quote">'+html(change.paragraph)+'</div>'+direction:
                '<p class="stmb-workshop-muted">'+html(finding.changeUnavailable?tr('Unavailable','Manual review required.'):tr('AdviceDetail','Review the content manually.'))+'</p>')+
            details+'</article>';
    }
    const popup=markStmbPopup(new Popup('<div class="stmb-sloth-review stmb-health-review">'+
        '<header class="stmb-workshop-heading"><i class="fa-solid fa-wrench" aria-hidden="true"></i><h3>'+html(tr('Title','AI memory review and cleanup'))+'</h3>'+
        '<button type="button" class="stmb-health-info" data-workshop-help aria-expanded="false" aria-label="'+html(tr('HelpLabel','About AI memory review'))+'" title="'+html(tr('HelpLabel','About AI memory review'))+'"><i class="fa-solid fa-circle-info" aria-hidden="true"></i></button></header>'+
        '<div class="stmb-workshop-help" hidden>'+html(tr('Help','Review suggested changes to Nexus memories. Only selected changes are saved. Memories moved from Core to Anchor may not appear in every conversation turn. Other chats sharing the book may have pending recovery affected. AI suggestions can be wrong.'))+
        '<p>'+html(summary)+'</p></div>'+
        '<div class="stmb-workshop-metrics"><div><span>'+html(tr('Available','Changes'))+'</span><strong>'+count+'</strong></div><div><span>'+html(tr('ReviewOnly','Review only'))+'</span><strong>'+(rows.length-count)+'</strong></div></div>'+
        (rows.length?'<div class="stmb-workshop-list">'+rows.map(rowHtml).join('')+'</div><div data-health-review-plan></div>':
        '<p>'+html(tr('NoFindings','No suggested changes.'))+'</p>')+'</div>',
        rows.length?POPUP_TYPE.CONFIRM:POPUP_TYPE.TEXT,'',{wide:false,large:false,allowVerticalScrolling:true,
            okButton:tr('Apply','Apply selected changes'),cancelButton:tr('Close','Close'),
            onClosing:({result})=>result!==POPUP_RESULT.AFFIRMATIVE||!rows.length||Boolean(approved)}));
    popup.dlg.classList.add('stmb-health-review-popup');
    const root=popup.dlg.querySelector('.stmb-health-review');
    const help=root.querySelector('[data-workshop-help]'),helpBody=root.querySelector('.stmb-workshop-help');
    help.addEventListener('click',()=>{helpBody.hidden=!helpBody.hidden;help.setAttribute('aria-expanded',String(!helpBody.hidden));});
    const plan=root.querySelector('[data-health-review-plan]'),button=popup.dlg.querySelector('.popup-button-ok');
    if(!plan){await showPopup(popup);return null;}
    function enabled(){
        button?.toggleAttribute('disabled',!approved);
        button?.setAttribute('aria-disabled',String(!approved));
        if(button)button.textContent=selected.size?countLabel('ApplyCount','Apply {{count}} changes',selected.size):tr('Apply','Apply selected changes');
    }
    function updatePlan(){
        approved=null;prepared=null;confirmed=false;
        if(!selected.size){plan.replaceChildren();enabled();return true;}
        try{
            const findings=[...selected].sort((a,b)=>a-b).map(i=>rows[i]);
            const {changes}=stageSlothHealthReviewBatch(original,findings,{moduleSettings});
            prepared={findings,changes};
            const moves=findings.some(f=>f.change?.type==='move');
            // Keep a single complete, exact preview, collapsed until requested.
            plan.innerHTML='<details class="stmb-workshop-preview"><summary>'+html(tr('FullPreview','View complete before/after'))+'</summary>'+
                changes.map(renderChange).join('')+'</details>'+
                (moves?'<label class="checkbox_label stmb-workshop-confirm"><input type="checkbox" data-health-core-ack><span>'+
                    html(tr('CoreAck','I understand moved memories may not be recalled on every turn.'))+'</span></label>':'');
            if(!moves)approved=prepared;
            const ack=plan.querySelector('[data-health-core-ack]');
            ack?.addEventListener('change',()=>{confirmed=ack.checked;approved=confirmed?prepared:null;enabled();});
            enabled();return true;
        }catch{
            plan.textContent=tr('PlanConflict','The selected changes conflict. Remove a conflicting selection.');
            enabled();return false;
        }
    }
    root.addEventListener('change',event=>{
        const check=event.target;
        if(!check.matches?.('input[data-health-review-include]'))return;
        const i=Number(check.dataset.healthReviewInclude);
        if(!Number.isSafeInteger(i)||!eligible[i]){check.checked=false;return;}
        if(check.checked){
            selected.add(i);
            if(!updatePlan()){
                selected.delete(i);check.checked=false;updatePlan();
                toastr.warning(tr('PlanConflict','The selected changes conflict. Remove a conflicting selection.'),'STMemoryBooks');
            }
        }else{selected.delete(i);updatePlan();}
    });
    enabled();
    return await showPopup(popup)===POPUP_RESULT.AFFIRMATIVE?approved:null;
}
