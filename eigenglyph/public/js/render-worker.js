// render worker: traces one horizontal band of the 3D view (see render3d.js)
import { traceRows } from './render3d.js';
self.onmessage = e => {
  const { id, k, y0, y1, C } = e.data, step = e.data.step || 1;
  const n = Math.ceil((y1 - y0) / step) * C.cols;
  const A = new Uint8ClampedArray(n * 4), B = new Uint8ClampedArray(n * 4);
  const depth = new Float32Array(n), vmId = new Int16Array(n);
  const t0 = performance.now();
  traceRows(C, y0, y1, y0 * C.cols, A, B, depth, vmId, step);
  self.ms = performance.now() - t0;
  self.postMessage({ id, k, y0, step, ms: self.ms, A, B, depth, vmId }, [A.buffer, B.buffer, depth.buffer, vmId.buffer]);
};
