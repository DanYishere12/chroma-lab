import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, cluster, rgbToLab, labToRgb } from '../kmeans.mjs';
import { paletteCss, paletteJson, paletteSvg } from '../exports.mjs';

const pixels = (...colors) => new Uint8ClampedArray(colors.flatMap(rgb => [...rgb, 255]));

test('sRGB ↔ OKLab preserves black, white, primaries and intermediate colors', () => {
  for (let r = 0; r <= 255; r += 51)
    for (let g = 0; g <= 255; g += 51)
      for (let b = 0; b <= 255; b += 51)
        assert.deepEqual(labToRgb(...rgbToLab(r, g, b)), [r, g, b]);
  assert.ok(Math.abs(rgbToLab(255, 255, 255)[0] - 1) < 1e-7);
  assert.deepEqual(rgbToLab(0, 0, 0), [0, 0, 0]);
});

test('solid images return one usable color even when twelve are requested', () => {
  const rgba = pixels(...Array(10).fill([17, 102, 204]));
  const result = analyze(rgba, 12);
  assert.deepEqual(result.output, rgba);
  assert.equal(result.palette.length, 1);
  assert.equal(result.palette[0].hex, '#1166CC');
  assert.equal(result.palette[0].count, 10);
  assert.equal(result.palette[0].share, 1);
});

test('palette shares are actual pixel counts and output uses only palette colors', () => {
  const rgba = pixels([255, 0, 0], [255, 0, 0], [255, 0, 0], [0, 0, 255]);
  const { palette, output } = analyze(rgba, 2);
  assert.deepEqual(palette.map(c => [c.hex, c.count, c.share]), [
    ['#FF0000', 3, 0.75], ['#0000FF', 1, 0.25],
  ]);
  assert.deepEqual(output, rgba);
});

test('large inputs are deterministic, sampled within budget, and not mutated', () => {
  const rgba = new Uint8ClampedArray(8101 * 4);
  for (let i = 0; i < 8101; i++) rgba.set([i % 256, (i * 17) % 256, (i * 31) % 256, 255], i * 4);
  const original = rgba.slice();
  const rounds = [];
  const first = analyze(rgba, 6, round => rounds.push(round));
  const second = analyze(rgba, 6);
  assert.deepEqual(first, second);
  assert.deepEqual(rgba, original);
  assert.equal(first.sampleCount, 8000);
  assert.equal(first.palette.reduce((sum, c) => sum + c.count, 0), 8101);
  assert.ok(Math.abs(first.palette.reduce((sum, c) => sum + c.share, 0) - 1) < 1e-12);
  assert.ok(first.iterations >= 1 && first.iterations <= 30);
  assert.equal(rounds.length, first.iterations);
  const colors = new Set(first.palette.map(c => c.rgb.join(',')));
  for (let i = 0; i < first.output.length; i += 4) {
    assert.ok(colors.has(Array.from(first.output.slice(i, i + 3)).join(',')));
    assert.equal(first.output[i + 3], 255);
  }
});

test('invalid inputs fail explicitly instead of producing misleading palettes', () => {
  for (const k of [0, 1, 13, 2.5, NaN, Infinity, '6'])
    assert.throws(() => analyze(pixels([0, 0, 0]), k), /color count/);
  for (const input of [new Uint8ClampedArray(), new Uint8ClampedArray(3), [0, 0, 0, 255]])
    assert.throws(() => analyze(input, 6), /RGBA/);
  assert.throws(() => cluster([[0, NaN, 0]], 2), /finite/);
  assert.throws(() => cluster([[0, 0, 0]], 2, 0), /iteration limit/);
});

test('exports preserve the analyzed colors, counts and metadata', () => {
  const { palette } = analyze(pixels([255, 0, 0], [0, 0, 255]), 2);
  const metadata = { width: 2, height: 1, requested_colors: 2, iterations: 1, sample_size: 2 };
  const json = JSON.parse(paletteJson(palette, metadata));
  assert.equal(json.width * json.height, json.colors.reduce((n, c) => n + c.pixels, 0));
  assert.equal(json.requested_colors, 2);
  assert.equal(json.colors.length, 2);
  assert.match(paletteCss(palette), /--color-1: #[A-F0-9]{6};/);
  const svg = paletteSvg(palette);
  assert.match(svg, /viewBox="0 0 320 286"/);
  for (const color of palette) {
    assert.ok(svg.includes(color.hex));
    assert.ok(paletteCss(palette).includes(color.hex));
  }
});
