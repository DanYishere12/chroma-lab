// Adapt the browser worker's transport to Node; exercise the real worker module.
import { parentPort } from 'node:worker_threads';
globalThis.self = {
  postMessage: (message, transfers) => parentPort.postMessage(message, transfers),
};
await import('../worker.js');
parentPort.on('message', data => self.onmessage({ data }));
parentPort.postMessage({ type: 'ready' });
