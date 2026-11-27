import test from 'node:test';
import assert from 'node:assert/strict';
import { slothNotificationTitle, createSlothToastr } from './sloth-notification-policy.js';

test('Sloth toast titles use the current language and preserve specific titles', () => {
    assert.equal(slothNotificationTitle('ko-KR', 'STMemoryBooks'), '🦥 메모리북');
    assert.equal(slothNotificationTitle('en-US'), '🦥 STMemoryBooks');
    assert.equal(slothNotificationTitle('en', 'Memory rollback failed'), '🦥 STMemoryBooks · Memory rollback failed');
    assert.equal(slothNotificationTitle('ko', '🦥 메모리북'), '🦥 메모리북');
});
test('all severities, native receiver, toast handle, onclick and clear options are unchanged', () => {
    let locale = 'en-US';
    const calls = [], handle = {};
    const native = {};
    for (const level of ['error', 'warning', 'info', 'success', 'clear']) {
        native[level] = function (...args) { assert.equal(this, native); calls.push([level, ...args]); return handle; };
    }
    const branded = createSlothToastr(() => native, () => locale);
    const options = { timeOut: 0, extendedTimeOut: 0, onclick: () => true };
    for (const level of ['error', 'warning', 'info', 'success']) {
        assert.equal(branded[level]('body', 'STMemoryBooks', options), handle);
        assert.deepEqual(calls.at(-1), [level, 'body', '🦥 STMemoryBooks', options]);
        assert.equal(calls.at(-1)[3], options);
    }
    locale = 'ko-KR';
    assert.equal(branded.warning('body'), handle);
    assert.deepEqual(calls.at(-1), ['warning', 'body', '🦥 메모리북']);
    const clearOptions = { force: true };
    assert.equal(branded.clear(handle, clearOptions), handle);
    assert.deepEqual(calls.at(-1), ['clear', handle, clearOptions]);
    assert.equal(native.warning === branded.warning, false);
});
