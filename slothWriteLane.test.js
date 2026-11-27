import test from 'node:test';
import assert from 'node:assert/strict';
import { withSlothLorebookWriteLane as write } from './slothWriteLane.js';
const other = await import('./slothWriteLane.js?other-extension');
test('separate module copies share same-book lanes and recover from rejection', async () => {
    const order = [];
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const first = write('same', async () => { order.push('first'); await gate; throw Error('failed'); });
    const second = other.withSlothLorebookWriteLane('same', () => order.push('second'));
    await write('other', () => order.push('other'));
    assert.deepEqual(order, ['first','other']);
    release();
    await assert.rejects(first, /failed/);
    await second;
    assert.deepEqual(order, ['first','other','second']);
    assert.equal(globalThis[Symbol.for('sloth.worldinfo.write-lanes.v1')].size, 0);
});
