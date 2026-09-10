"""Discover an image palette using K-means++ in OKLab color space.

Run: python python/palette.py assets/sample.jpg --colors 6 --output output
The browser implementation lives in kmeans.mjs; this independent Python
implementation uses the same method with NumPy and Pillow.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps


# OKLab matrices: https://bottosson.github.io/posts/oklab/
RGB_TO_LMS = np.array([
    [0.4122214708, 0.5363325363, 0.0514459929],
    [0.2119034982, 0.6806995451, 0.1073969566],
    [0.0883024619, 0.2817188376, 0.6299787005],
])
LMS_TO_LAB = np.array([
    [0.2104542553, 0.7936177850, -0.0040720468],
    [1.9779984951, -2.4285922050, 0.4505937099],
    [0.0259040371, 0.7827717662, -0.8086757660],
])


def rgb_to_oklab(rgb: np.ndarray) -> np.ndarray:
    """Convert uint8 sRGB pixels to perceptual OKLab coordinates."""
    rgb = np.asarray(rgb, dtype=np.float64) / 255.0
    linear = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    return np.cbrt(linear @ RGB_TO_LMS.T) @ LMS_TO_LAB.T


def oklab_to_rgb(lab: np.ndarray) -> np.ndarray:
    """Convert centers to displayable, gamut-clipped sRGB colors."""
    lms = np.asarray(lab) @ np.linalg.inv(LMS_TO_LAB).T
    linear = lms**3 @ np.linalg.inv(RGB_TO_LMS).T
    srgb = np.where(linear <= 0.0031308, 12.92 * linear,
                    1.055 * np.maximum(linear, 0) ** (1 / 2.4) - 0.055)
    return np.rint(np.clip(srgb, 0, 1) * 255).astype(np.uint8)


def squared_distances(points: np.ndarray, centers: np.ndarray) -> np.ndarray:
    return np.sum((points[:, None, :] - centers[None, :, :]) ** 2, axis=2)


def kmeans(points: np.ndarray, k: int, seed: int = 42,
           max_iterations: int = 30) -> tuple[np.ndarray, int]:
    """Seed with K-means++, then alternate assignment and mean updates."""
    points = np.asarray(points, dtype=np.float64)
    if isinstance(k, bool) or not isinstance(k, (int, np.integer)) or not 2 <= k <= 12:
        raise ValueError('Provide pixels and a color count between 2 and 12.')
    if points.ndim != 2 or points.shape[1] != 3 or not len(points) or not np.isfinite(points).all():
        raise ValueError('Provide a nonempty array of finite OKLab triples.')
    if isinstance(max_iterations, bool) or not isinstance(max_iterations, (int, np.integer)) or max_iterations < 1:
        raise ValueError('The iteration limit must be a positive integer.')
    rng = np.random.default_rng(seed)
    centers = [points[rng.integers(len(points))].copy()]
    distances = np.full(len(points), np.inf)
    for _ in range(1, k):
        distances = np.minimum(distances, np.sum((points - centers[-1]) ** 2, axis=1))
        total = distances.sum()
        if total < 1e-16:
            break  # Fewer distinct source colors than requested.
        centers.append(points[rng.choice(len(points), p=distances / total)].copy())
    centers = np.asarray(centers)
    iterations = 0
    for iterations in range(1, max_iterations + 1):
        labels = squared_distances(points, centers).argmin(axis=1)
        updated = np.array([
            points[labels == j].mean(axis=0) if np.any(labels == j) else center
            for j, center in enumerate(centers)
        ])
        movement = np.max(np.sum((centers - updated) ** 2, axis=1))
        centers = updated
        if movement < 1e-9:
            break
    return centers, iterations


def extract_palette(image: Image.Image, colors: int = 6) -> tuple[Image.Image, dict]:
    image = ImageOps.exif_transpose(image).convert('RGBA')
    image.thumbnail((1200, 1200), Image.Resampling.LANCZOS)
    white = Image.new('RGBA', image.size, 'white')
    rgb = np.asarray(Image.alpha_composite(white, image).convert('RGB'))
    pixels = rgb.reshape(-1, 3)
    rng = np.random.default_rng(12345)
    indices = rng.integers(len(pixels), size=8000) if len(pixels) > 8000 else np.arange(len(pixels))
    centers, iterations = kmeans(rgb_to_oklab(pixels[indices]), colors)
    center_rgb = oklab_to_rgb(centers)
    output = np.empty_like(pixels)
    counts = np.zeros(len(centers), dtype=np.int64)
    # Bound temporary memory when assigning every pixel.
    for start in range(0, len(pixels), 16384):
        stop = min(start + 16384, len(pixels))
        labels = squared_distances(rgb_to_oklab(pixels[start:stop]), centers).argmin(axis=1)
        output[start:stop] = center_rgb[labels]
        counts += np.bincount(labels, minlength=len(centers))
    merged = {}
    for color, count in zip(center_rgb, counts):
        if not count:
            continue
        hex_color = '#' + ''.join(f'{v:02X}' for v in color)
        merged[hex_color] = merged.get(hex_color, 0) + int(count)
    palette = [
        {'hex': color, 'pixels': count, 'share': count / len(pixels)}
        for color, count in sorted(merged.items(), key=lambda item: -item[1])
    ]
    metadata = {'colors': palette, 'requested_colors': colors, 'iterations': iterations,
                'sample_size': len(indices), 'width': image.width, 'height': image.height}
    return Image.fromarray(output.reshape(rgb.shape)), metadata


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('image', type=Path)
    parser.add_argument('--colors', type=int, choices=range(2, 13), default=6)
    parser.add_argument('--output', type=Path, default=Path('output'))
    args = parser.parse_args()
    with Image.open(args.image) as image:
        poster, metadata = extract_palette(image, args.colors)
    args.output.mkdir(parents=True, exist_ok=True)
    poster.save(args.output / 'posterized.png')
    (args.output / 'palette.json').write_text(json.dumps(metadata, indent=2) + '\n')
    css = ':root {\n' + '\n'.join(
        f"  --color-{i + 1}: {color['hex']};" for i, color in enumerate(metadata['colors'])
    ) + '\n}\n'
    (args.output / 'palette.css').write_text(css)
    print(f"Found {len(metadata['colors'])} colors in {metadata['iterations']} rounds.")
    print(f'Wrote posterized.png, palette.json, and palette.css to {args.output}')


if __name__ == '__main__':
    main()
