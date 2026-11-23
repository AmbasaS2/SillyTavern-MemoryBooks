// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
//
// Deterministic, review-first, LOSSLESS legacy Nexus migration.
// No LLM guesses. No source title/content/UID/history rewriting. No live writes.

const hasEntries = book => !!book && !!book.entries &&
    typeof book.entries === 'object' && !Array.isArray(book.entries);
const canonical = value => typeof value === 'string' ? value.trim() : '';
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const requireSafe = (condition, reason) => { if (!condition) throw new Error(reason); };

const TYPE_PATTERN = Object.freeze({
    core: /^Long-Term Memory(?:$|\s*\([^)]*\)$|\s*[—–-]\s*.+$)/i,
    continuity: /^Scene Continuity(?:$|\s*\([^)]*\)$|\s*[—–-]\s*.+$)/i,
    status: /^Status(?:$|\s*\([^)]*\)$|\s*[—–-]\s*.+$)/i,
});
const TARGET = Object.freeze({core:'Core Memory', continuity:'Current Continuity'});
const LEGACY_ARCHIVE = 'STMB_slothLegacyArchive';

export function classifyNexusLegacyTitle(title) {
    const name = canonical(title);
    return Object.keys(TYPE_PATTERN).find(kind => TYPE_PATTERN[kind].test(name)) || '';
}

export function archivedNexusLegacyKind(entry) {
    const archive=entry?.[LEGACY_ARCHIVE];
    return archive?.explicitRole===true && Object.hasOwn(TYPE_PATTERN,archive.kind)
        ? archive.kind : classifyNexusLegacyTitle(entry?.comment);
}

export function listNexusMigrationCandidates(book) {
    requireSafe(hasEntries(book), 'Nexus must be a valid World Info JSON object.');
    return Object.values(book.entries).filter(entry=>
        entry && Number.isSafeInteger(entry.uid) && entry.uid>=0 &&
        entry.disable!==true && !entry[LEGACY_ARCHIVE] &&
        canonical(entry.content) && Number(entry.position)!==7 && !canonical(entry.outletName) &&
        ![TARGET.core,TARGET.continuity].includes(canonical(entry.comment)) &&
        !/^(?:Kinks|PanelAssets)(?:\b|$)/i.test(canonical(entry.comment)) &&
        !entry.stmemorybooks && !entry.stmbSummary && !entry.stmbArc
    ).map(entry=>({uid:entry.uid,title:canonical(entry.comment)}));
}

/** Inspect without making or persisting any changes. */
export function inspectNexusLegacyMigration(book,selection) {
    requireSafe(hasEntries(book), 'Nexus must be a valid World Info JSON object.');
    const entries = Object.values(book.entries);
    const uids = new Set();
    for (const e of entries) {
        requireSafe(e && typeof e === 'object' &&
            Number.isSafeInteger(e.uid) && e.uid >= 0 && !uids.has(e.uid),
        'Nexus contains missing or duplicate UIDs. Migration cancelled.');
        uids.add(e.uid);
    }
    const sources={core:[],continuity:[],status:[]};
    const targets={core:[],continuity:[]};
    let selected;
    if(selection!==undefined){
        requireSafe(selection && typeof selection==='object' && !Array.isArray(selection), 'Invalid Nexus migration selection.');
        const eligible=new Set(listNexusMigrationCandidates(book).map(entry=>entry.uid));
        const chosen=Object.entries(selection);
        requireSafe(chosen.every(([kind,uid])=>Object.hasOwn(TYPE_PATTERN,kind)&&eligible.has(uid)) &&
            new Set(chosen.map(([,uid])=>uid)).size===chosen.length,
            'The selected entries must be different eligible Nexus entries.');
        selected=new Map(chosen.map(([kind,uid])=>[uid,kind]));
    }
    for (const e of entries) {
        const title=canonical(e.comment), kind=selected?selected.get(e.uid):classifyNexusLegacyTitle(title);
        if (title===TARGET.core) targets.core.push(e);
        if (title===TARGET.continuity) targets.continuity.push(e);
        if (kind && !e[LEGACY_ARCHIVE]) sources[kind].push(e);
        if (e[LEGACY_ARCHIVE]) {
            const archive=e[LEGACY_ARCHIVE];
            const target=entries.find(item=>item.uid===archive?.targetUid);
            requireSafe(archive?.version===1 && e.disable===true &&
                archivedNexusLegacyKind(e)===archive.kind && target?.comment===archive.targetTitle &&
                Array.isArray(target.STMB_slothLegacySources) &&
                target.STMB_slothLegacySources.includes(e.uid),
            'An archived legacy entry has a missing or inconsistent migration target.');
        }
    }
    for (const [kind,items] of Object.entries(sources)) {
        requireSafe(items.length<=1,'More than one active legacy '+kind+' entry. Resolve ambiguity manually.');
    }
    for (const [kind,items] of Object.entries(targets)) {
        requireSafe(items.length<=1,'Duplicate '+TARGET[kind]+' targets. Resolve ambiguity manually.');
    }
    if (sources.core.length && targets.core.length) {
        throw new Error('Both Core Memory and active Long-Term Memory exist; manual reconciliation required.');
    }
    if ((sources.continuity.length||sources.status.length) && targets.continuity.length) {
        throw new Error('Both Current Continuity and active legacy status/continuity exist; manual reconciliation required.');
    }
    const required=Object.values(sources).some(items=>items.length);
    for (const [kind,items] of Object.entries(sources)) {
        if (!items.length) continue;
        const e=items[0];
        requireSafe(e.disable!==true,'Disabled legacy '+kind+' entry requires manual review before activation.');
        requireSafe(Number(e.position)!==7 && !canonical(e.outletName),
            'Legacy '+kind+' uses a custom Outlet; migration requires manual review.');
        requireSafe(typeof e.content==='string' && !!e.content.trim(),
            'Legacy '+kind+' entry has blank or invalid content; no migration.');
        requireSafe(!e.stmemorybooks && !e.stmbSummary && !e.stmbArc,
            'Legacy '+kind+' is marked as a Scene or summary. Migration blocked.');
    }
    const unmigrated=Object.values(sources).flat();
    return {
        required,
        targets,
        sources,
        sourceUids:unmigrated.map(e=>e.uid),
        totalCharacters:unmigrated.reduce((sum,e)=>sum+e.content.length,0),
        hasHistory:unmigrated.some(e=>!!e.STMB_sidePromptRegeneration ||
            !!e.STMB_sidePromptHistory || !!e.STMB_sidePromptRegenerationHistory),
    };
}

function configureTarget(entry,title,content,source,sourceUids) {
    entry.comment=title;
    entry.content=content;
    entry.constant=true; entry.vectorized=false; entry.disable=false;
    entry.selective=true; entry.key=[];
    entry.outletName='';
    // Retain the original always-on insertion configuration, never an Outlet.
    for (const key of ['position','order','depth','ignoreBudget','excludeRecursion',
        'preventRecursion','delayUntilRecursion','role','sticky','cooldown']) {
        if (own(source,key)) entry[key]=structuredClone(source[key]);
    }
    entry.STMB_slothLegacySources=[...sourceUids];
    entry.STMB_slothLegacyMigrationVersion=1;
}

function rawBlock(kind,source) {
    const label=kind==='continuity'?'Scene Continuity':'Status';
    // The original text is injected byte-for-byte inside this labelled section.
    // No AI-generated inference about its recency, actors or meaning.
    return '=== BEGIN ORIGINAL '+label+' (UID '+source.uid+') ===\n'+source.content+
        '\n=== END ORIGINAL '+label+' (UID '+source.uid+') ===';
}

export function stageNexusLegacyMigration(book, createEntry, selection) {
    const plan=inspectNexusLegacyMigration(book,selection);
    if (!plan.required) return {staged:structuredClone(book),changes:[],plan,alreadyCurrent:true};
    requireSafe(typeof createEntry==='function','World Info entry creator is required.');
    const staged=structuredClone(book),changes=[];
    const sourceById=uid=>Object.values(staged.entries).find(e=>e.uid===uid);
    const sourceKinds=new Map(Object.entries(plan.sources).flatMap(([kind,entries])=>entries.map(entry=>[entry.uid,kind])));
    function add(kind, sources, content) {
        const anchor=sources[0], entry=createEntry(staged);
        requireSafe(entry && Number.isSafeInteger(entry.uid) &&
            !sources.some(e=>e.uid===entry.uid),'World Info entry creator returned an invalid UID.');
        configureTarget(entry,TARGET[kind],content,anchor,sources.map(e=>e.uid));
        changes.push({action:'create',title:TARGET[kind],uid:entry.uid,
            from:sources.map(e=>({uid:e.uid,title:e.comment,characters:e.content.length})),
            after:content,before:'',active:true});
        for (const original of sources) {
            const preserved=sourceById(original.uid);
            const originalKind=sourceKinds.get(original.uid);
            // Deactivate but KEEP the original entry and ALL original metadata.
            // A versioned annotation is the only additional metadata.
            preserved.disable=true;
            preserved[LEGACY_ARCHIVE]={version:1,kind:originalKind,
                ...(originalKind!==classifyNexusLegacyTitle(original.comment)?{explicitRole:true}:{}),
                targetUid:entry.uid,targetTitle:entry.comment};
            changes.push({action:'archive',title:preserved.comment,uid:preserved.uid,
                before:preserved.content,after:preserved.content,active:false,
                originalMetadataPreserved:true});
        }
    }
    if (plan.sources.core.length) {
        const source=plan.sources.core[0];
        add('core',[source],source.content);
    }
    const contextSources=[...plan.sources.continuity,...plan.sources.status];
    if (contextSources.length) {
        add('continuity',contextSources,contextSources.map(source=>
            rawBlock(sourceKinds.get(source.uid),source)).join('\n\n'));
    }
    // Strong structural proof: every original entry remains in the same slot
    // with the same body and every metadata field, except disable+archive mark.
    for (const [key,oldEntry] of Object.entries(book.entries)) {
        const next=staged.entries[key];
        requireSafe(next && next.uid===oldEntry.uid && next.comment===oldEntry.comment &&
            next.content===oldEntry.content,'Migration changed an original entry.');
        const stripped=structuredClone(next);delete stripped[LEGACY_ARCHIVE];
        stripped.disable=oldEntry.disable;
        requireSafe(JSON.stringify(stripped)===JSON.stringify(oldEntry),
            'Migration changed original metadata, beyond archive flags.');
    }
    for (const [kind,items] of Object.entries(plan.sources)) {
        for (const source of items) {
            const target=changes.find(change=>change.action==='create'&&
                change.from.some(item=>item.uid===source.uid));
            requireSafe(target && target.after.includes(source.content),
                'Migration omitted legacy '+kind+' content.');
        }
    }
    return {staged,changes,plan,alreadyCurrent:false};
}

/** Safety rail for old Side Prompt upserts after migration.
 * Source templates must be manually retargeted/replaced, not silently
 * allowed to reactivate an archived entry or recreate a duplicate.
 */
export function guardArchivedNexusSidePromptWrite(book,title,historyTitle='') {
    if (!hasEntries(book)) return;
    const requested=[title,historyTitle].map(value=>canonical(value).toLowerCase()).filter(Boolean);
    const archived=Object.values(book.entries).filter(e=>e?.[LEGACY_ARCHIVE]?.version===1);
    if (requested.some(name=>archived.some(e=>canonical(e.comment).toLowerCase()===name ||
        (e[LEGACY_ARCHIVE].explicitRole!==true && e[LEGACY_ARCHIVE].kind===classifyNexusLegacyTitle(name))))) {
        throw new Error('Legacy Side Prompt is archived by Sloth migration. Use the new Core Memory / Current Continuity update flow instead. No write performed.');
    }
}
