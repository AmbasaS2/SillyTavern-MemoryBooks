// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
// One selected preview at a time, with no automatic application.
import {Popup,POPUP_TYPE,POPUP_RESULT} from '../../../popup.js';
import {escapeHtml} from '../../../utils.js';
import {translate} from '../../../i18n.js';
import {markStmbPopup} from './utils.js';
import {stageSlothHealthReviewChange,stageSlothHealthReviewBatch} from './slothNexusHealthReview.js';

export const healthReviewLabel=(key,fallback)=>translate(fallback,'STMemoryBooks_SlothHealthReview'+key);
const tr=healthReviewLabel;
const html=v=>escapeHtml(String(v??''));
const kindLabel=kind=>({duplicate:tr('Duplicate','Possible duplicate'),conflict:tr('Conflict','Possible conflict'),
    validity:tr('Validity','Check current validity'),core_to_lt:tr('Move','Core → LT candidate')})[kind];
function renderChange(change){
    const mode=change.constant?tr('Constant','Always-on'):change.vectorized?tr('Vector','Vector'):tr('Keyword','Keyword');
    return '<section class="stmb-health-section stmb-health-review-change"><h4>'+html(change.title)+' · '+html(mode)+'</h4>'+
        '<small>'+html(tr('Before','Before'))+'</small><pre>'+html(change.before??tr('NewEntry','New entry'))+'</pre>'+
        '<small>'+html(tr('After','After'))+'</small><pre>'+html(change.after)+'</pre>'+
        (change.keywords.length?'<small>'+html(tr('Keywords','Keywords'))+': '+html(change.keywords.join(', '))+'</small>':'')+'</section>';
}
export async function showSlothHealthReviewFindings({review,catalog,original,moduleSettings,showPopup}){
    const rows=review.findings;
    let approved=null;
    const selected=new Set();
    const summary=tr('Summary','Eligible: {{count}} · Excluded: {{excluded}} · Findings: {{findings}} · Rejected: {{rejected}}')
        .replace('{{count}}',String(catalog.entries.length)).replace('{{excluded}}',String(catalog.excluded))
        .replace('{{findings}}',String(rows.length)).replace('{{rejected}}',String(review.rejected));
    const popup=markStmbPopup(new Popup('<div class="stmb-sloth-review stmb-health-review"><h3>'+html(tr('Title','AI Nexus health review'))+'</h3>'+
        '<p>'+html(summary)+'</p><small>'+html(tr('Help','These are review clues from stored memories, not proof of current truth. Review one finding and its citations. Only an exact duplicate removal or a verbatim Core-to-LT move can be applied. Everything else remains advice.'))+'</small>'+
        (rows.length?'<select class="text_pole" data-health-review-select aria-label="'+html(tr('Select','Select a finding'))+'"><option value="">'+
            html(tr('Select','Select a finding'))+'</option>'+rows.map((row,i)=>'<option value="'+i+'">'+html((i+1)+'. '+kindLabel(row.kind)+' · '+row.reason.slice(0,100))+'</option>').join('')+
            '</select><div data-health-review-body></div><div data-health-review-plan></div>':'<p>'+html(tr('NoFindings','No grounded findings were returned. This does not establish that all memories are correct.'))+'</p>')+'</div>',
        rows.length?POPUP_TYPE.CONFIRM:POPUP_TYPE.TEXT,'',{wide:false,large:false,allowVerticalScrolling:true,
            okButton:tr('Apply','Apply reviewed changes'),cancelButton:tr('Close','Close'),
            onClosing:({result})=>result!==POPUP_RESULT.AFFIRMATIVE||!rows.length||Boolean(approved)}));
    popup.dlg.classList.add('stmb-health-review-popup');
    const select=popup.dlg.querySelector('[data-health-review-select]');
    if(!select){await showPopup(popup);return null;}
    const body=popup.dlg.querySelector('[data-health-review-body]'),plan=popup.dlg.querySelector('[data-health-review-plan]'),button=popup.dlg.querySelector('.popup-button-ok');
    const enabled=()=>{button?.toggleAttribute('disabled',!approved);button?.setAttribute('aria-disabled',String(!approved));};
    const updatePlan=()=>{
        approved=null;
        if(!selected.size){plan.replaceChildren();enabled();return true;}
        try{
            const findings=[...selected].sort((a,b)=>a-b).map(i=>rows[i]);
            const {changes}=stageSlothHealthReviewBatch(original,findings,{moduleSettings});
            approved={findings,changes};
            plan.innerHTML='<details class="stmb-health-section" open><summary>'+
                html(tr('Plan','Selected changes'))+' ('+selected.size+')</summary><p>'+
                html(tr('Approval','Review the exact before and after text. Applying may change recall behavior and affect pending recovery in other chats sharing this book. Only the selected changes will be saved.'))+
                '</p>'+changes.map(renderChange).join('')+'</details>';
            enabled();return true;
        }catch{
            plan.innerHTML='<p>'+html(tr('PlanConflict','The selected changes conflict. Remove a conflicting choice before applying.'))+'</p>';
            enabled();return false;
        }
    };
    const render=()=>{
        const i=select.value===''?-1:Number(select.value),finding=rows[i];
        if(!finding){body.replaceChildren();return;}
        let preview='',note='';
        if(finding.change){
            try{
                const {changes}=stageSlothHealthReviewChange(original,finding,{moduleSettings});
                preview=changes.map(renderChange).join('')+
                    '<label class="checkbox_label stmb-health-review-choice"><input type="checkbox" data-health-review-include '+(selected.has(i)?'checked':'')+'><span>'+
                    html(tr('Include','Include this change in the approval plan'))+'</span></label>';
            }catch{note=tr('Unavailable','This change is not eligible under the current Nexus or recall settings. Review manually.');}
        }else note=finding.changeUnavailable?tr('Unavailable','This change is not eligible under the current Nexus or recall settings. Review manually.'):
            tr('Advice','Review only. No automatic change is available for this finding.');
        body.innerHTML='<h4>'+html(kindLabel(finding.kind))+'</h4><p>'+html(finding.reason)+'</p>'+
            finding.refs.map(ref=>'<div class="stmb-health-section"><small>'+html(catalog.entries.find(e=>e.uid===ref.uid)?.title)+' · UID '+html(ref.uid)+'</small><pre>'+html(ref.quote)+'</pre></div>').join('')+
            (note?'<p>'+html(note)+'</p>':'')+preview;
        const check=body.querySelector('[data-health-review-include]');
        check?.addEventListener('change',()=>{
            if(check.checked){
                selected.add(i);
                if(!updatePlan()){
                    selected.delete(i);check.checked=false;updatePlan();
                    toastr.warning(tr('PlanConflict','The selected changes conflict. Remove a conflicting choice before applying.'),'STMemoryBooks');
                }
            }else{selected.delete(i);updatePlan();}
            for(let j=0;j<rows.length;j++){
                const option=select.options[j+1];
                if(option)option.textContent=(selected.has(j)?'✓ ':'')+(j+1)+'. '+kindLabel(rows[j].kind)+' · '+rows[j].reason.slice(0,100);
            }
        });
    };
    select.addEventListener('change',render);render();updatePlan();
    return await showPopup(popup)===POPUP_RESULT.AFFIRMATIVE?approved:null;
}
