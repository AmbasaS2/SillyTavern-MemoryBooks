// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
// Safe best-effort two-World-Info commit. Not a server-side atomic transaction.

const snapshot = value => JSON.stringify(value);
const isEqual = (a,b) => snapshot(a) === snapshot(b);

export async function commitSlothBooks(states,{loadFresh,save,withLocks,verifyOrigin,resetCache}) {
    if(!Array.isArray(states) || states.length!==2 ||
        states[0].name===states[1].name ||
        states.some(s=>!s.name||!s.original?.entries||!s.staged?.entries)) {
        throw new Error('Two distinct, complete World Info snapshots are required.');
    }
    if([loadFresh,save,withLocks,verifyOrigin].some(fn=>typeof fn!=='function')) {
        throw new Error('Missing safe World Info transaction dependency.');
    }
    const ordered=[...states].sort((a,b)=>a.name.localeCompare(b.name));
    return await withLocks(ordered.map(s=>s.name),async()=>{
        verifyOrigin();
        // Validate every book before the first write; fail closed on parallel edits.
        for(const state of ordered){
            const fresh=await loadFresh(state.name);
            if(!isEqual(fresh,state.original)){
                throw new Error('World Info conflict in '+state.name+' before commit. No changes saved.');
            }
        }
        const attempted=[];
        try {
            for(const state of ordered){
                verifyOrigin();
                // A rejected request might still have persisted before throwing.
                attempted.push(state);
                await save(state.name,state.staged);
                const readBack=await loadFresh(state.name);
                if(!isEqual(readBack,state.staged)){
                    throw new Error('Read-back mismatch after writing '+state.name);
                }
            }
            return {success:true,saved:attempted.map(s=>s.name)};
        }catch(error){
            const recoveryFailures=[];
            for(const state of attempted.reverse()){
                try{
                    const now=await loadFresh(state.name);
                    if(isEqual(now,state.original)){
                        // ST saveWorldInfo mutates its client-side cache before HTTP.
                        if(typeof resetCache==='function') await resetCache(state.name,state.original);
                        continue; // Nothing persisted.
                    }
                    if(!isEqual(now,state.staged)){
                        recoveryFailures.push(state.name+': changed by another writer; unsafe to overwrite.');
                        continue;
                    }
                    await save(state.name,state.original);
                    const restored=await loadFresh(state.name);
                    if(!isEqual(restored,state.original)){
                        recoveryFailures.push(state.name+': rollback verification failed.');
                    }
                }catch(e){
                    recoveryFailures.push(state.name+': '+(e?.message||String(e)));
                }
            }
            if(recoveryFailures.length){
                const issue=new Error('Two-book save failed. Partial data may remain; use the approved backup for manual recovery. '+recoveryFailures.join('; '));
                issue.partialRecovery=true;issue.cause=error;
                throw issue;
            }
            throw new Error('Two-book save failed; prior changes were rolled back or no writes occurred. '+(error?.message||String(error)));
        }
    });
}
