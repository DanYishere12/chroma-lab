// Pure serializers keep downloads independent of the DOM and easy to verify.
export function paletteCss(palette) {
  return ":root {\n" + palette.map((color, i) =>
    `  --color-${i + 1}: ${color.hex};`
  ).join("\n") + "\n}\n";
}

export function paletteJson(palette, metadata) {
  return JSON.stringify({
    ...metadata,
    colors: palette.map(({ hex, count, share }) => ({ hex, pixels: count, share })),
  }, null, 2) + "\n";
}

export function paletteSvg(palette) {
  const width = 160 * palette.length;
  const cells = palette.map((color, i) =>
    `<rect x="${i * 160}" y="0" width="160" height="200" fill="${color.hex}"/>` +
    `<text x="${i * 160 + 16}" y="230" fill="#25222B" font-family="monospace" font-size="18">${color.hex}</text>` +
    `<text x="${i * 160 + 16}" y="256" fill="#675E72" font-family="sans-serif" font-size="13">${(color.share * 100).toFixed(1)}%</text>`
  ).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="286" viewBox="0 0 ${width} 286" role="img" aria-labelledby="title"><title id="title">Chroma Lab palette, ${palette.length} colors</title><rect width="${width}" height="286" fill="#FFFFFF"/>${cells}</svg>`;
}
