import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { bindSlothPointerDrag } from './slothPointerDrag.js';

function target(){
    const listeners=new Map();
    return {
        isConnected:true,captured:null,
        addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},
        removeEventListener(type,fn){listeners.get(type)?.delete(fn);},
        fire(type,pointerId=1){for(const fn of [...(listeners.get(type)||[])])fn({type,pointerId});},
        count(){return [...listeners.values()].reduce((n,set)=>n+set.size,0);},
        setPointerCapture(id){this.captured=id;},
        hasPointerCapture(id){return this.captured===id;},
        releasePointerCapture(){this.captured=null;this.fire('lostpointercapture');},
    };
}
function harness(){
    const doc=target(),view=target(),element=target(),results=[],moves=[];
    const start=()=>bindSlothPointerDrag({pointerId:1,target:element},element,e=>moves.push(e.pointerId),result=>results.push(result),doc,view);
    const empty=()=>{assert.equal(doc.count(),0);assert.equal(view.count(),0);assert.equal(element.count(),0);assert.equal(element.captured,null);};
    return {doc,view,element,results,moves,start,empty};
}
test('repeated mobile cancellations leave no active move/up listeners',()=>{
    const h=harness();
    for(let i=0;i<3;i++){h.start();h.doc.fire('pointermove');h.doc.fire('pointercancel');h.empty();}
    assert.deepEqual(h.results,[false,false,false]);
    assert.deepEqual(h.moves,[1,1,1]);
    h.doc.fire('pointermove');assert.equal(h.moves.length,3);
});
test('only the initiating pointer can move or finish; normal pointerup completes once',()=>{
    const h=harness();h.start();
    h.doc.fire('pointermove',2);h.doc.fire('pointerup',2);assert.deepEqual(h.results,[]);
    h.doc.fire('pointermove');h.doc.fire('pointerup');h.empty();
    assert.deepEqual(h.moves,[1]);assert.deepEqual(h.results,[true]);
});
test('blur, lost capture, explicit removal, and detached pointer movement cancel safely',()=>{
    for(const reason of ['blur','lost','explicit','detached']){
        const h=harness(),cancel=h.start();
        if(reason==='blur')h.view.fire('blur');
        if(reason==='lost')h.element.fire('lostpointercapture');
        if(reason==='explicit'){h.element.isConnected=false;cancel();}
        if(reason==='detached'){h.element.isConnected=false;h.doc.fire('pointermove');}
        cancel();h.empty();assert.deepEqual(h.results,[false]);
    }
});
test('both floating controls cancel active gestures before DOM replacement or chat change',()=>{
    const source=readFileSync(new URL('./index.js',import.meta.url),'utf8');
    assert.match(source,/narratorCastDrawerDragState\?\.cancel\(\);\s*if \(!context\.isNarratorMode/);
    assert.match(source,/if \(!isMemoryBoundaryButtonEnabled\(\)\) \{\s*memoryBoundaryButtonDragState\?\.cancel\(\)/);
    assert.match(source,/async function handleChatChanged\(chatId\) \{\s*narratorCastDrawerDragState\?\.cancel\(\);\s*memoryBoundaryButtonDragState\?\.cancel\(\)/);
});
