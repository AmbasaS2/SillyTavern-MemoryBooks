// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
//
// Optimistic single-World-Info save with a verified, best-effort compensation.
// The World Info server offers no atomic two-book transaction. This helper
// changes exactly the one reviewed book supplied by the caller (Nexus or Memory).

const equal=(left,right)=>JSON.stringify(left)===JSON.stringify(right);

export async function commitSlothNexusMigration(state,{
    loadFresh,save,withLock,verifyOrigin,resetCache,operation='Nexus migration',
}) {
    const subject=['Memory Scene merge','Memory Scene split'].includes(operation)
        ?'Memory':'Nexus';
    const reviewAction=operation==='Memory Scene split'?'split':
        subject==='Memory'?'merge':'migration';
    if (!state?.name || !state.original?.entries || !state.staged?.entries ||
        [loadFresh,save,withLock,verifyOrigin].some(fn=>typeof fn!=='function')) {
        throw new Error('A complete Nexus migration snapshot and save dependencies are required.');
    }
    return await withLock(state.name,async()=>{
        verifyOrigin();
        const current=await loadFresh(state.name);
        if (!equal(current,state.original)) {
            throw new Error(subject+' changed while '+reviewAction+' was being reviewed. Nothing saved.');
        }
        try {
            verifyOrigin();
            await save(state.name,state.staged);
            const readBack=await loadFresh(state.name);
            if (!equal(readBack,state.staged)) {
                throw new Error(operation+' read-back mismatch.');
            }
            return {success:true,name:state.name};
        }catch(error){
            let recoveryIssue='';
            try {
                const now=await loadFresh(state.name);
                if(equal(now,state.original)){
                    if(typeof resetCache==='function') await resetCache(state.name,state.original);
                } else if(equal(now,state.staged)){
                    // Do not clobber a third-party writer's changes.
                    await save(state.name,state.original);
                    const restored=await loadFresh(state.name);
                    if(!equal(restored,state.original)) recoveryIssue='Rollback could not be verified.';
                    else if(typeof resetCache==='function') await resetCache(state.name,state.original);
                } else recoveryIssue='Another writer changed '+subject+'; automatic rollback is unsafe.';
            }catch(e){
                recoveryIssue='Rollback failed: '+(e?.message||String(e));
            }
            if(recoveryIssue){
                const failure=new Error(operation+' may be partially saved. Restore the downloaded original backup manually. '+recoveryIssue);
                failure.partialRecovery=true;failure.cause=error;
                throw failure;
            }
            throw new Error(operation+' was not saved, or the original was restored. '+(error?.message||String(error)));
        }
    });
}
