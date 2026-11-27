// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
// A preflight estimate, not provider usage or a guarantee of admission.
const positive=value=>{
    const n=Number(value);
    return Number.isSafeInteger(n)&&n>0?n:null;
};
export const isSlothGemma31=model=>/^(?:google\/)?gemma-4-31b-it$/iu.test(String(model||''));
// Model card: https://huggingface.co/google/gemma-4-31B-it
// 256K is the architecture maximum; a provider may advertise a smaller one.
const knownMaximum=model=>isSlothGemma31(model)?256000:null;
export function resolveSlothCapacity({model,catalog=[],catalogMatches=false,configuredLimit}={}){
    const ceilings=[];
    const known=knownMaximum(model);
    if(known)ceilings.push(known);
    if(catalogMatches&&Array.isArray(catalog)){
        for(const row of catalog){
            if(String(row?.id||'')!==String(model||''))continue;
            for(const value of [row.context_length,row.max_model_len,row.context_window]){
                const n=positive(value);if(n)ceilings.push(n);
            }
        }
    }
    if(ceilings.length)return {limit:Math.min(...ceilings),source:'model'};
    const configured=positive(configuredLimit);
    return {limit:configured,source:configured?'configured':'unknown'};
}
export function assessSlothCapacity({prompt,inputTokens,outputTokens,limit}){
    // When counting fails, deliberately use a conservative UTF-8 byte
    // estimate. It is not a provider tokenizer or an exact token bound.
    const measured=positive(inputTokens);
    const input=measured??Math.max(1,new TextEncoder().encode(String(prompt||'')).length);
    const output=positive(outputTokens)??10000;
    const capacity=positive(limit);
    // Leave extra space for tokenizer differences, message framing and
    // provider/preset overhead. Never silently cut the prompt to fit.
    const reserve=capacity?Math.max(2048,Math.ceil(capacity*.1)):2048;
    const total=input+output+reserve;
    // With no reliable ceiling, retain existing smaller requests; refuse
    // large ones rather than inventing another model's context setting.
    const blocked=capacity?total>capacity:input+output>62000;
    return {input,output,reserve,total,limit:capacity,blocked,estimated:measured===null?'bytes':'tokenizer'};
}
