// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
// Read-only display of bounded, browser-local, non-content metrics.
import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../popup.js';
import { escapeHtml } from '../../../utils.js';
import { translate } from '../../../i18n.js';
import { markStmbPopup } from './utils.js';
import { readSlothCollectionHistory, clearSlothCollectionHistory, totalSlothRequestMetrics,
    slothMetricParts, SLOTH_STATS_PHASES } from './slothCollectionStats.js';

const tr=(key,fallback)=>translate(fallback,'STMemoryBooks_SlothStats'+key);
const html=value=>escapeHtml(String(value??''));
const num=value=>value===null||value===undefined?'—':Number(value).toLocaleString(undefined,{maximumFractionDigits:8});
const time=value=>value===null||value===undefined?'—':num(Math.round(value/100)/10)+' s';
const phaseLabel=p=>({collection:tr('Collection','Collection'),review:tr('Review','Summary review'),side:tr('Side','Attached Side Prompts')})[p];
const triggerLabel=p=>({manual:tr('Manual','Manual'),automatic:tr('Automatic','Automatic'),recovery:tr('Recovery','Recovery')})[p]??'—';
const statusLabel=p=>({saved:tr('Saved','Saved'),recovered:tr('Recovered','Recovered'),partial:tr('Partial','Partial'),held:tr('Held','Held for recovery'),failed:tr('Failed','Failed'),cancelled:tr('Cancelled','Cancelled'),blocked:tr('Blocked','Blocked before sending'),empty:tr('Empty','Nothing to save'),uncertain:tr('Uncertain','Save unverified')})[p]??'—';
const dateLabel=n=>new Date(n).toLocaleString();
const metric=(value,cost=false)=>{
    const parts=slothMetricParts(value);
    if(!parts.length)return '—';
    return parts.map(p=>{
        if(p.kind==='unknown')return tr('Unmeasured','Unmeasured')+' ×'+num(p.value);
        if(p.kind==='bytes')return num(p.value)+' '+tr('Bytes','bytes (estimate)');
        if(p.kind==='estimated')return '~'+num(p.value)+' '+tr('Estimated','estimated');
        return (cost?'$':'')+num(p.value)+' '+tr('Reported','reported');
    }).join(' · ');
};
const pair=(label,value)=>'<div class="stmb-stats-pair"><span>'+html(label)+'</span><strong>'+html(value)+'</strong></div>';
const yesno=v=>v===null?'—':v?tr('Verified','Verified'):tr('NotVerified','Not verified');
function usage(g){
    return pair(tr('Requests','Requests'),num(g.requests))+
        pair(tr('Responses','Responses'),num(g.responded))+
        pair(tr('RequestFailures','Failed / cancelled'),num(g.failed)+' / '+num(g.cancelled))+
        pair(tr('BlockedRequests','Blocked requests'),num(g.blocked))+
        pair(tr('Input','Input tokens'),metric(g.values.input))+
        pair(tr('Output','Output tokens'),metric(g.values.output))+
        pair(tr('CacheRead','Cache read tokens'),metric(g.values.cacheRead))+
        pair(tr('CacheWrite','Cache write tokens'),metric(g.values.cacheWrite))+
        pair(tr('Cost','Reported cost (USD)'),metric(g.values.usd,true))+
        pair(tr('RequestTime','Request time'),time(g.durationMs))+
        (g.models.length?pair(tr('Models','Models'),g.models.join(', ')):'')+
        (g.blockedEstimate?pair(tr('BlockedInput','Blocked input estimate'),
            '~'+num(g.blockedEstimate.value)+' '+(g.blockedEstimate.kind==='bytes'?tr('Bytes','bytes (estimate)'):tr('Tokens','tokens'))):'');
}
function renderRun(run){
    const c=run.counts,s=run.source,total=totalSlothRequestMetrics(run.groups);
    const range=s.ranges.map(([a,b])=>a===b?String(a):a+'–'+b).join(', ')+(s.rangeCount>s.ranges.length?' …':'');
    const options=[triggerLabel(run.trigger),run.initial?tr('Initial','Initial setup'):'',run.partialSource?tr('Chunk','Chunked source'):'',run.reviewSummaries?tr('Review','Summary review'):''].filter(Boolean).join(' · ');
    return '<div class="stmb-stats-card">'+pair(tr('Status','Status'),statusLabel(run.status))+
        pair(tr('Method','Method'),tr('Single','Single collection')+' · '+options)+
        pair(tr('Range','Message ranges'),range||'—')+
        pair(tr('Messages','Source messages'),num(s.messageCount))+
        pair(tr('Elapsed','Total elapsed time'),time(run.elapsedMs))+
        pair(tr('EvidencePolicy','Evidence policy'),num(run.evidencePolicyVersion))+'</div>'+
        '<div class="stmb-stats-card"><h4>'+html(tr('Usage','AI usage'))+'</h4>'+usage(total)+
        SLOTH_STATS_PHASES.filter(p=>run.groups[p].requests||run.groups[p].blocked).map(p=>'<details class="stmb-stats-phase"><summary>'+html(phaseLabel(p))+'</summary>'+usage(run.groups[p])+'</details>').join('')+'</div>'+
        '<div class="stmb-stats-card"><h4>'+html(tr('Results','Collection results'))+'</h4>'+
        pair(tr('SceneProposed','Scenes proposed / accepted'),num(c.sceneProposed)+' / '+num(c.sceneAccepted))+
        pair(tr('SceneSaved','Scenes created / reused'),num(c.sceneCreated)+' / '+num(c.sceneReused))+
        pair(tr('NexusProposed','Nexus edits proposed / accepted'),num(c.nexusProposed)+' / '+num(c.nexusAccepted))+
        pair(tr('NexusSaved','Nexus entries created / updated'),num(c.nexusCreated)+' / '+num(c.nexusUpdated))+
        pair(tr('NexusEdits','Verified Nexus edits saved'),num(c.nexusEditsSaved))+
        pair(tr('HeldCounts','Scenes / Nexus edits held'),num(c.sceneHeld)+' / '+num(c.nexusHeld))+
        pair(tr('Pending','Pending source messages'),num(c.pendingMessages))+
        pair(tr('SideSaved','Side Prompts saved'),num(c.sideSaved))+
        pair(tr('Receipt','Collection receipt'),yesno(run.receiptVerified))+
        pair(tr('RecoveryReceipt','Recovery record'),yesno(run.recoveryVerified))+'</div>';
}
export async function showSlothCollectionStats(){
    let rows=readSlothCollectionHistory();
    const empty=tr('NoHistory','No recent collection records in this browser.');
    const popup=markStmbPopup(new Popup('<div class="stmb-sloth-review stmb-collection-stats"><h3>'+html(tr('Title','Recent collection statistics'))+'</h3>'+
        '<small>'+html(tr('Help','Up to 30 completed attempts in this browser. Reported usage comes from provider responses; estimates are separate. Missing values are not zero. Cached tokens may overlap input tokens. Times exclude no-send preflight from request time. No chat text or credentials are recorded.'))+'</small>'+
        '<select class="text_pole" data-sloth-stats-select aria-label="'+html(tr('Select','Select collection run'))+'"></select>'+
        '<div data-sloth-stats-body></div><div class="stmb-sloth-controls"><button type="button" class="menu_button" data-sloth-stats-clear>'+html(tr('Clear','Clear local history'))+'</button></div></div>',
        POPUP_TYPE.TEXT,'',{wide:false,large:false,allowVerticalScrolling:true}));
    popup.dlg.classList.add('stmb-collection-stats-popup');
    const select=popup.dlg.querySelector('[data-sloth-stats-select]'),body=popup.dlg.querySelector('[data-sloth-stats-body]'),clear=popup.dlg.querySelector('[data-sloth-stats-clear]');
    const render=()=>{const row=rows[Number(select.value)];body.innerHTML=row?renderRun(row):'<p>'+html(empty)+'</p>';};
    const refresh=()=>{
        select.replaceChildren();
        for(const [i,row] of rows.entries()){
            const option=document.createElement('option');option.value=String(i);
            option.textContent=dateLabel(row.finishedAt)+' · '+triggerLabel(row.trigger)+' · '+statusLabel(row.status);
            select.append(option);
        }
        select.hidden=!rows.length;clear.disabled=!rows.length;render();
    };
    select.addEventListener('change',render);
    clear.addEventListener('click',async()=>{
        const confirm=markStmbPopup(new Popup(html(tr('ClearConfirm','Clear only the collection statistics in this browser? Memories, settings and recovery records will not change.')),POPUP_TYPE.CONFIRM));
        if(await confirm.show()!==POPUP_RESULT.AFFIRMATIVE)return;
        if(!clearSlothCollectionHistory()){toastr.warning(tr('ClearFailed','Browser storage could not be cleared.'));return;}
        rows=readSlothCollectionHistory();refresh();
    });
    refresh();await popup.show();return {saved:false};
}
