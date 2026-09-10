// K-means++ over OKLab pixels. Pure functions shared by the worker and tests.
export function rgbToLab(r, g, b) {
  const linear = (v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  r = linear(r);
  g = linear(g);
  b = linear(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
export function labToRgb(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const gamma = (v) =>
    Math.round(
      255 *
        Math.max(
          0,
          Math.min(
            1,
            v <= 0.0031308
              ? 12.92 * v
              : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055,
          ),
        ),
    );
  return [
    gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    gamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}
const distance = (a, b) =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
export function nearest(point, centers) {
  let index = 0,
    best = Infinity;
  centers.forEach((center, i) => {
    const d = distance(point, center);
    if (d < best) {
      best = d;
      index = i;
    }
  });
  return index;
}
export function cluster(samples, k, maxIterations = 30, progress = () => {}) {
  if (!samples.length || !Number.isInteger(k) || k < 1 || k > 12)
    throw new Error("Clustering needs samples and an integer color count from 1 to 12.");
  if (!Number.isInteger(maxIterations) || maxIterations < 1)
    throw new Error("The iteration limit must be a positive integer.");
  if (samples.some((point) => point.length !== 3 || !point.every(Number.isFinite)))
    throw new Error("Each sample must contain three finite OKLab coordinates.");
  let seed = 42;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  let centers = [samples[Math.floor(random() * samples.length)].slice()];
  let minDistances = samples.map(() => Infinity);
  for (let i = 1; i < k; i++) {
    minDistances = minDistances.map((d, j) =>
      Math.min(d, distance(samples[j], centers[i - 1])),
    );
    const sum = minDistances.reduce((a, b) => a + b, 0);
    if (sum < 1e-16) break; // Uniform images have fewer unique colors than requested.
    let target = random() * sum,
      index = 0;
    while (index < samples.length - 1 && target > minDistances[index])
      target -= minDistances[index++];
    centers.push(samples[index].slice());
  }
  let iterations = 0;
  for (let round = 0; round < maxIterations; round++) {
    const sums = centers.map(() => [0, 0, 0]),
      counts = centers.map(() => 0);
    samples.forEach((point) => {
      const j = nearest(point, centers);
      counts[j]++;
      for (let c = 0; c < 3; c++) sums[j][c] += point[c];
    });
    const updated = centers.map((center, i) =>
      counts[i] ? sums[i].map((v) => v / counts[i]) : center,
    );
    const movement = Math.max(
      ...updated.map((center, i) => distance(center, centers[i])),
    );
    centers = updated;
    iterations = round + 1;
    progress(iterations);
    if (movement < 1e-9) break;
  }
  return { centers, iterations };
}
export function analyze(rgba, k, progress = () => {}) {
  if (!(rgba instanceof Uint8ClampedArray) || !rgba.length || rgba.length % 4)
    throw new Error("Provide a nonempty Uint8ClampedArray of RGBA pixels.");
  if (!Number.isInteger(k) || k < 2 || k > 12)
    throw new Error("Choose an integer color count from 2 to 12.");
  const count = rgba.length / 4,
    sampleCount = Math.min(8000, count),
    samples = [];
  // Seeded uniform sampling avoids locking onto rows of repeating textures.
  let seed = 12345;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < sampleCount; i++) {
    const offset = (count <= 8000 ? i : Math.floor(random() * count)) * 4;
    samples.push(rgbToLab(rgba[offset], rgba[offset + 1], rgba[offset + 2]));
  }
  const { centers, iterations } = cluster(samples, k, 30, progress);
  const colors = centers.map((c) => labToRgb(...c)),
    counts = centers.map(() => 0),
    output = new Uint8ClampedArray(rgba.length);
  // Cache repeated source colors while keeping memory bounded.
  const cache = new Map();
  for (let i = 0; i < count; i++) {
    const p = i * 4,
      key = (rgba[p] << 16) | (rgba[p + 1] << 8) | rgba[p + 2];
    let j = cache.get(key);
    if (j === undefined) {
      j = nearest(rgbToLab(rgba[p], rgba[p + 1], rgba[p + 2]), centers);
      if (cache.size < 65536) cache.set(key, j);
    }
    counts[j]++;
    output[p] = colors[j][0];
    output[p + 1] = colors[j][1];
    output[p + 2] = colors[j][2];
    output[p + 3] = 255;
  }
  // Merge centers that map to the same 8-bit RGB color and omit unused centers.
  const merged = new Map();
  colors.forEach((rgb, i) => {
    if (!counts[i]) return;
    const hex =
      "#" +
      rgb
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();
    const old = merged.get(hex);
    if (old) old.count += counts[i];
    else merged.set(hex, { hex, rgb, count: counts[i] });
  });
  const palette = Array.from(merged.values())
    .sort((a, b) => b.count - a.count)
    .map((c) => ({ ...c, share: c.count / count }));
  return { output, palette, iterations, sampleCount };
}
