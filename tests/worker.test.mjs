import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';

test('worker transfers pixel buffers, reports progress, and recovers after invalid input', async () => {
  const worker = new Worker(new URL('./worker-harness.mjs', import.meta.url));
  try {
    await once(worker, 'message');
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]);
    const messages = [];
    const complete = new Promise((resolve, reject) => {
      worker.on('error', reject);
      worker.on('message', message => {
        messages.push(message);
        if (message.type === 'done') resolve(message);
      });
    });
    worker.postMessage({ pixels: rgba.buffer, k: 2 }, [rgba.buffer]);
    assert.equal(rgba.byteLength, 0);
    const result = await complete;
    assert.equal(result.output.byteLength, 8);
    assert.equal(result.palette.length, 2);
    assert.ok(messages.some(m => m.type === 'progress'));
    assert.ok(result.elapsed >= 0);
    const invalid = once(worker, 'message');
    worker.postMessage({ pixels: new ArrayBuffer(0), k: 6 });
    assert.equal((await invalid)[0].type, 'error');
    const recovered = new Promise(resolve => worker.on('message', m => {
      if (m.type === 'done') resolve(m);
    }));
    worker.postMessage({ pixels: new Uint8ClampedArray([0, 0, 0, 255]).buffer, k: 2 });
    assert.equal((await recovered).palette[0].hex, '#000000');
  } finally {
    await worker.terminate();
  }
});
