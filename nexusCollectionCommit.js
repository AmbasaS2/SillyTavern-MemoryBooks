// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
// Safe best-effort World Info commit. Not a server-side atomic transaction.

const snapshot = value => JSON.stringify(value);
const isEqual = (a,b) => snapshot(a) === snapshot(b);

export async function commitSlothBooks(states,{loadFresh,save,withLocks,verifyOrigin,resetCache,verifyBeforeWrite}) {
    if(!Array.isArray(states) || states.length!==2 ||
        states[0].name===states[1].name ||
        states.some(s=>!s.name||!s.original?.entries||!s.staged?.entries)) {
        throw new Error('Two distinct, complete World Info snapshots are required.');
    }
    return commitVerifiedWorldInfoBooks(states,{loadFresh,save,withLocks,verifyOrigin,resetCache,verifyBeforeWrite},{label:'Two-book save'});
}

// Shared with Original rollback; callers retain their own staging, origin checks,
// and comparison rules. Acquire all book lanes in canonical order once.
export async function commitVerifiedWorldInfoBooks(states,{loadFresh,save,withLocks,verifyOrigin,resetCache,verifyBeforeWrite},{equals=isEqual,label='World Info save'}={}) {
    if(!Array.isArray(states) || !states.length ||
        new Set(states.map(s=>s.name)).size!==states.length ||
        states.some(s=>!s.name||!s.original?.entries||!s.staged?.entries)) {
        throw new Error('Distinct, complete World Info snapshots are required.');
    }
    if([loadFresh,save,withLocks,verifyOrigin,equals].some(fn=>typeof fn!=='function')) {
        throw new Error('Missing safe World Info transaction dependency.');
    }
    const ordered=[...states].sort((a,b)=>a.name.localeCompare(b.name));
    return await withLocks(ordered.map(s=>s.name),async()=>{
        verifyOrigin();
        // Validate every book before the first write; fail closed on parallel edits.
        for(const state of ordered){
            const fresh=await loadFresh(state.name);
            if(!equals(fresh,state.original)){
                throw new Error('World Info conflict in '+state.name+' before commit. No changes saved.');
            }
            verifyBeforeWrite?.(state.name,state.original);
        }
        const attempted=[];
        try {
            for(const state of ordered){
                // The first save gives other editors time to change the second book.
                if(attempted.length && !equals(await loadFresh(state.name),state.original)){
                    throw new Error('World Info conflict in '+state.name+' during commit.');
                }
                verifyOrigin();
                verifyBeforeWrite?.(state.name,state.original);
                // A rejected request might still have persisted before throwing.
                attempted.push(state);
                await save(state.name,state.staged);
                const readBack=await loadFresh(state.name);
                if(!equals(readBack,state.staged)){
                    throw new Error('Read-back mismatch after writing '+state.name);
                }
            }
            // Earlier read-backs predate later saves. Verify each earlier book
            // again before allowing a caller to advance its chat checkpoint.
            for(const state of ordered.slice(0,-1)){
                if(!equals(await loadFresh(state.name),state.staged)){
                    throw new Error('World Info conflict in '+state.name+' after writing all books.');
                }
            }
            verifyOrigin();
            return {success:true,saved:attempted.map(s=>s.name)};
        }catch(error){
            const recoveryFailures=[];
            for(const state of attempted.reverse()){
                try{
                    const now=await loadFresh(state.name);
                    if(equals(now,state.original)){
                        // ST saveWorldInfo mutates its client-side cache before HTTP.
                        if(verifyBeforeWrite) verifyBeforeWrite(state.name,state.staged,state.original);
                        if(typeof resetCache==='function') await resetCache(state.name,state.original);
                        continue; // Nothing persisted.
                    }
                    if(!equals(now,state.staged)){
                        recoveryFailures.push(state.name+': changed by another writer; unsafe to overwrite.');
                        continue;
                    }
                    verifyBeforeWrite?.(state.name,state.staged);
                    await save(state.name,state.original);
                    const restored=await loadFresh(state.name);
                    if(!equals(restored,state.original)){
                        recoveryFailures.push(state.name+': rollback verification failed.');
                    }
                }catch(e){
                    recoveryFailures.push(state.name+': '+(e?.message||String(e)));
                }
            }
            if(recoveryFailures.length){
                const issue=new Error(label+' failed. Partial data may remain in the affected lorebooks. '+recoveryFailures.join('; '));
                issue.partialRecovery=true;issue.cause=error;
                throw issue;
            }
            throw new Error(label+' failed; prior changes were rolled back or no writes occurred. '+(error?.message||String(error)));
        }
    });
}
