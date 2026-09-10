import { analyze } from "./kmeans.mjs";
self.onmessage = ({ data }) => {
  try {
    const start = performance.now();
    const result = analyze(
      new Uint8ClampedArray(data.pixels),
      data.k,
      (round) => self.postMessage({ type: "progress", round }),
    );
    self.postMessage(
      { type: "done", ...result, elapsed: performance.now() - start },
      [result.output.buffer],
    );
  } catch (error) {
    self.postMessage({ type: "error", message: error.message });
  }
};
