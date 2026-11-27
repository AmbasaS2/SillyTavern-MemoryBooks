// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only

// Active-gesture listeners only. Capture the original pointer target to keep
// normal click targeting intact, and release all listeners on every exit.
export function bindSlothPointerDrag(start, element, onMove, onFinish, doc = document, view = window) {
    const id = start.pointerId;
    const target = start.target?.setPointerCapture ? start.target : element;
    let active = true;
    const matches = event => event.pointerId === id;
    const finish = completed => {
        if (!active) return;
        active = false;
        doc.removeEventListener('pointermove', move, true);
        doc.removeEventListener('pointerup', up, true);
        doc.removeEventListener('pointercancel', cancel, true);
        target.removeEventListener?.('lostpointercapture', lost);
        view.removeEventListener('blur', blur);
        try {
            if (target.hasPointerCapture?.(id)) target.releasePointerCapture(id);
        } catch { /* detached target or already-released pointer */ }
        onFinish(completed);
    };
    const move = event => {
        if (!matches(event)) return;
        if (!element.isConnected) return finish(false);
        onMove(event);
    };
    const up = event => { if (matches(event)) finish(element.isConnected); };
    const cancel = event => { if (matches(event)) finish(false); };
    const lost = event => { if (matches(event)) finish(false); };
    const blur = () => finish(false);
    doc.addEventListener('pointermove', move, true);
    doc.addEventListener('pointerup', up, true);
    doc.addEventListener('pointercancel', cancel, true);
    target.addEventListener?.('lostpointercapture', lost);
    view.addEventListener('blur', blur);
    try { target.setPointerCapture?.(id); } catch { /* document listeners remain active */ }
    return () => finish(false);
}
