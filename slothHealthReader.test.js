import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {managerTranslationBookPath,readManagerTranslationBook,managerTranslatedBody,managerTranslatedTitle} from './lore-manager-translations.js';
import {createSlothHealthTranslationSession,createSlothHealthMarkdownRenderer} from './slothHealthReader.js';

function hash(value){
    let h=2166136261;
    for(let i=0;i<value.length;i++)h=Math.imul(h^value.charCodeAt(i),16777619)>>>0;
    return h.toString(36)+'_'+value.length;
}
const book='마법사의 기록 3',row={uid:4,title:'Title',body:'Original'};
const key=book+'\u241f'+row.uid;
const record={book,uid:'4',language:'Korean',sourceHash:hash(row.body),text:'**번역 본문**',fields:{comment:{source:row.title,text:'번역 제목'}}};
const data={format:'lore-manager-translations-v1',book,revision:2,records:{[key]:record},pairs:{[key]:{translationLanguage:'Korean'}}};

test('WorldInfoInfo translation contract: same Unicode path, one read-only book, exact fresh title and body',async()=>{
    assert.equal(managerTranslationBookPath(book),'/user/files/lore-manager-translation-3-1a24f65c34237384.json');
    assert.equal(managerTranslationBookPath('🦊狐🦊'),'/user/files/lore-manager-translation-book-85f2fac765ffed43.json');
    const calls=[];
    const s=createSlothHealthTranslationSession(book,async(url,options)=>{
        calls.push([url,options]);return {ok:true,json:async()=>data};
    },{'X-Test':'yes'},null,true);
    assert.equal(s.started,false);
    assert.equal(s.body(row),null);
    assert.equal(calls.length,0);
    await Promise.all([s.load(),s.load()]);
    assert.equal(calls.length,1);
    assert.deepEqual(calls[0],[managerTranslationBookPath(book),{method:'GET',credentials:'same-origin',headers:{'X-Test':'yes'},cache:'no-store'}]);
    assert.equal(s.title(row),'번역 제목');
    assert.equal(s.body(row),record.text);
    assert.equal(s.body({...row,body:'Changed'}),null);
    assert.equal(s.title({...row,title:'Changed'}),'');
    assert.equal(s.body({...row,uid:999}),null);
    await s.load();assert.equal(calls.length,1);
});

test('missing extension, malformed files, mismatched language and old settings fall back safely',async()=>{
    const fail=()=>{throw Error('must not call')};
    const absent=createSlothHealthTranslationSession(book,fail,null,null,false);
    await absent.load();assert.equal(absent.body(row),null);
    for(const value of [{...data,book:'Other'},{...data,revision:0},{...data,records:null},{...data,format:'unknown'}]){
        assert.equal(await readManagerTranslationBook(book,async()=>({ok:true,json:async()=>value})),null);
    }
    const legacy={translations:{[key]:record},entryLanguagePairs:data.pairs};
    const s=createSlothHealthTranslationSession(book,async()=>({ok:false}),null,legacy,true);
    await s.load();assert.equal(s.body(row),record.text);
    const entry={world:book,uid:4,comment:row.title,content:row.body};
    assert.equal(managerTranslatedBody(entry,{...data,pairs:{[key]:{translationLanguage:'English'}}},null),null);
    assert.equal(managerTranslatedTitle({...entry,world:'Other'},data,null),'');
});

test('markdown converter is lazy, uses the existing safe rendering pipeline and falls back to text',()=>{
    const calls=[];
    class Converter{constructor(options){calls.push(['create',options]);}makeHtml(value){calls.push(['html',value]);return '<p>content</p>';}}
    const target={};
    const render=createSlothHealthMarkdownRenderer(Converter,(value,options)=>{calls.push(['sanitize',options]);return value;});
    assert.equal(calls.length,0);
    render(target,'=== Heading ===\n[Section]\n**bold**');
    assert.equal(calls[1][1],'### Heading\n#### Section\n**bold**');
    assert.ok(calls[2][1].FORBID_TAGS.includes('script'));
    assert.ok(calls[2][1].FORBID_ATTR.includes('style'));
    render(target,'Next');
    assert.equal(calls.filter(x=>x[0]==='create').length,1);
    const fallback=createSlothHealthMarkdownRenderer(Converter,()=>{throw Error('bad HTML')});
    fallback(target,'Safe <script>');assert.equal(target.textContent,'Safe <script>');
});

test('preview helpers contain no polling, observers, background reads or write path',()=>{
    for(const path of ['lore-manager-translations.js','slothHealthReader.js']){
        const s=readFileSync(new URL('./'+path,import.meta.url),'utf8');
        assert.doesNotMatch(s,/MutationObserver|ResizeObserver|setInterval|setTimeout|requestAnimationFrame|localStorage|\bPOST\b|\bPUT\b/);
    }
});
