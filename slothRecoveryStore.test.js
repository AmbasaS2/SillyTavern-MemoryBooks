import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createSlothRecoveryStore,slothRecoveryFileName,selectSlothRecoveryRecord,encodeSlothRecoveryFile} from './slothRecoveryStore.js';
const hash=text=>createHash('sha256').update(text).digest('hex');
const key='character:캐릭터.png:chapter-1';
const record=(raw='{"events":[],"edits":[]}')=>({version:1,binding:{chatKey:key},raw,receivedAt:1});
function harness(){
    const files=new Map(),requests=[];
    const request=async(url,options)=>{
        requests.push([url,options.method]);
        if(url.startsWith('/user/files/')){
            const name=url.slice('/user/files/'.length);
            return files.has(name)?{ok:true,status:200,text:async()=>files.get(name)}:{ok:false,status:404};
        }
        assert.equal(url,'/api/files/upload');
        const {name,data}=JSON.parse(options.body);
        assert.deepEqual(options.headers,{'X-CSRF-Token':'test'});
        files.set(name,Buffer.from(data,'base64').toString('utf8'));
        return {ok:true,status:200};
    };
    const store=()=>createSlothRecoveryStore({request,headers:()=>({'X-CSRF-Token':'test'}),hash});
    return {files,requests,store};
}
test('recovery file names isolate chats without revealing character or chat names',()=>{
    const name=slothRecoveryFileName(key,hash);
    assert.match(name,/^stmb-sloth-recovery-[a-f0-9]{64}\.json$/);
    assert.notEqual(name,slothRecoveryFileName('character:캐릭터.png:AU',hash));
    assert.notEqual(name,slothRecoveryFileName('character:Other.png:chapter-1',hash));
});
test('unicode and large drafts round-trip across clients, independent of chat APIs',async()=>{
    const h=harness(),store=h.store();
    const raw='{"events":[{"scene":"한글 ☀️ 😀 café '+('긴 응답 '.repeat(25000))+'"}]}';
    const value={...record(raw),partial:{version:1,lockedScenes:[{content:'原文'}],committedEdits:[]}};
    const absent=await store.read(key);
    assert.equal(absent.revision,null);
    const saved=await store.replace(key,value,absent.revision);
    assert.deepEqual((await h.store().read(key)).record,value);
    assert.equal(saved.revision,store.revisionFor(key,value));
    assert.ok(h.requests.every(([url])=>url.startsWith('/user/files/')||url==='/api/files/upload'));
    assert.equal(Buffer.from(encodeSlothRecoveryFile(raw),'base64').toString('utf8'),raw);
});
test('a verified cleared marker masks legacy draft even after restart',async()=>{
    const h=harness(),store=h.store(),legacy=record();
    assert.deepEqual(selectSlothRecoveryRecord(key,await store.read(key),legacy),legacy);
    const saved=await store.replace(key,legacy,null);
    await store.replace(key,null,saved.revision);
    const cleared=await h.store().read(key);
    assert.notEqual(cleared.revision,null);
    assert.equal(cleared.record,null);
    assert.equal(selectSlothRecoveryRecord(key,cleared,legacy),null);
    assert.equal(selectSlothRecoveryRecord(key,null,{...legacy,binding:{chatKey:'another'}}),null);
});
test('changed independent file blocks stale replacements and stale cleanup',async()=>{
    const h=harness(),a=h.store(),b=h.store();
    const first=await a.replace(key,record('first'),null);
    const other=await b.replace(key,record('other'),first.revision);
    await assert.rejects(a.replace(key,record('stale'),first.revision),{code:'STMB_SLOTH_RECOVERY_CONFLICT'});
    await assert.rejects(a.replace(key,null,first.revision),{code:'STMB_SLOTH_RECOVERY_CONFLICT'});
    assert.equal((await a.read(key)).record.raw,'other');
    const writes=h.requests.filter(([,method])=>method==='POST').length;
    assert.deepEqual(await b.replace(key,record('other'),first.revision),other,'an exact retry is idempotent');
    assert.equal(h.requests.filter(([,method])=>method==='POST').length,writes);
});
test('corrupt or wrong-identity files are never treated as absent',async()=>{
    const h=harness(),store=h.store(),name=slothRecoveryFileName(key,hash);
    h.files.set(name,'not json');
    await assert.rejects(store.read(key),/not valid JSON/);
    await assert.rejects(store.replace(key,record(),null),/not valid JSON/);
    h.files.set(name,JSON.stringify({format:'stmb-sloth-recovery',version:1,chatKey:'other',record:null}));
    await assert.rejects(store.read(key),/different chat identity/);
    assert.equal(h.requests.filter(([,method])=>method==='POST').length,0);
});
test('non-404 reads and failed read-back cannot be mistaken for success',async()=>{
    const failing=createSlothRecoveryStore({request:async()=>({ok:false,status:403}),headers:()=>({}),hash});
    await assert.rejects(failing.read(key),/read failed: 403/);
    const noWrite=createSlothRecoveryStore({request:async(url)=>url==='/api/files/upload'?{ok:true,status:200}:{ok:false,status:404},headers:()=>({}),hash});
    await assert.rejects(noWrite.replace(key,record(),null),{code:'STMB_SLOTH_RECOVERY_CONFLICT'});
});
