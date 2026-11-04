#!/usr/bin/env python3
"""Create tileable WebGL surface maps from the documented photo palette.

The source JPEGs are evidence only: their sampled RGB patches set the texture
base colors, while repeatable noise and veins supply non-photographic surface
detail. The source archives and photos are never modified.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
REFERENCE = ROOT / "assets" / "reference"
OUTPUT = ROOT / "assets" / "textures"
SIZE = 256

SAMPLES = {
    "stone": ("front-plaque.jpeg", 710, 300),
    "cap": ("front-plaque.jpeg", 700, 240),
    "plinth": ("front-plaque.jpeg", 650, 470),
    "tile": ("front-plaque.jpeg", 520, 480),
    "gravel": ("front-plaque.jpeg", 350, 500),
    "curb": ("oblique-plaza.jpeg", 790, 816),
    "ground": ("planting.jpeg", 1450, 780),
    "navy": ("emblem-detail.jpeg", 580, 220),
    "cyan": ("emblem-detail.jpeg", 940, 220),
    "lotus": ("emblem-detail.jpeg", 765, 270),
    "torch": ("emblem-detail.jpeg", 760, 70),
    "leaf": ("planting.jpeg", 600, 700),
}


def sample_median(filename: str, x: int, y: int, radius: int = 4) -> list[int]:
    with Image.open(REFERENCE / filename) as image:
        patch = np.asarray(image.convert("RGB").crop((x - radius, y - radius, x + radius, y + radius)))
    return [int(value) for value in np.median(patch, axis=(0, 1))]


def periodic_noise(size: int, cells: int, rng: np.random.Generator) -> np.ndarray:
    lattice = rng.normal(0.0, 1.0, (cells, cells))
    coordinates = np.arange(size, dtype=np.float32) * (cells / size)
    x = coordinates[None, :]
    y = coordinates[:, None]
    x0 = np.floor(x).astype(np.int32) % cells
    y0 = np.floor(y).astype(np.int32) % cells
    x1 = (x0 + 1) % cells
    y1 = (y0 + 1) % cells
    tx = x - np.floor(x)
    ty = y - np.floor(y)
    tx = tx * tx * (3.0 - 2.0 * tx)
    ty = ty * ty * (3.0 - 2.0 * ty)
    top = lattice[y0, x0] * (1.0 - tx) + lattice[y0, x1] * tx
    bottom = lattice[y1, x0] * (1.0 - tx) + lattice[y1, x1] * tx
    return top * (1.0 - ty) + bottom * ty


def fractal_noise(seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    octaves = [(4, 0.42), (9, 0.28), (21, 0.19), (64, 0.11)]
    field = np.zeros((SIZE, SIZE), dtype=np.float32)
    for cells, weight in octaves:
        field += periodic_noise(SIZE, cells, rng) * weight
    field /= np.sqrt(sum(weight * weight for _, weight in octaves))
    return field


def make_base_texture(base: list[int], seed: int, amplitude: float, fine: float = 2.5) -> np.ndarray:
    broad = fractal_noise(seed)
    grain = np.random.default_rng(seed + 1000).normal(0.0, 1.0, (SIZE, SIZE)).astype(np.float32)
    variation = broad * amplitude + grain * fine
    rgb = np.asarray(base, dtype=np.float32)[None, None, :] + variation[:, :, None]
    return np.clip(rgb, 0, 255).astype(np.uint8)


def add_periodic_vein(rgb: np.ndarray, *, center: float, amplitude: float, cycles: float, phase: float, width: float, color: tuple[int, int, int], opacity: float) -> None:
    yy, xx = np.mgrid[0:SIZE, 0:SIZE].astype(np.float32)
    centerline = center + amplitude * np.sin((yy / SIZE) * cycles * np.pi * 2.0 + phase)
    distance = np.abs((xx - centerline + SIZE / 2.0) % SIZE - SIZE / 2.0)
    mask = np.exp(-0.5 * (distance / width) ** 2) * opacity
    target = np.asarray(color, dtype=np.float32)[None, None, :]
    rgb[:] = np.clip(rgb.astype(np.float32) * (1.0 - mask[:, :, None]) + target * mask[:, :, None], 0, 255).astype(np.uint8)


def save_rgb(name: str, pixels: np.ndarray) -> None:
    Image.fromarray(pixels, "RGB").save(OUTPUT / name, optimize=True)


def make_gravel(base: list[int]) -> np.ndarray:
    rgb = make_base_texture(base, seed=511, amplitude=7.0, fine=5.0)
    image = Image.fromarray(rgb, "RGB")
    draw = ImageDraw.Draw(image)
    rng = np.random.default_rng(906)
    for _ in range(1250):
        x = int(rng.integers(0, SIZE))
        y = int(rng.integers(0, SIZE))
        rx = int(rng.integers(1, 4))
        ry = int(rng.integers(1, 3))
        shade = int(rng.integers(-22, 23))
        pebble = tuple(int(np.clip(channel + shade, 0, 255)) for channel in base)
        highlight = tuple(int(np.clip(channel + shade + 14, 0, 255)) for channel in base)
        for shift_x in (-SIZE, 0, SIZE):
            for shift_y in (-SIZE, 0, SIZE):
                left, top = x + shift_x - rx, y + shift_y - ry
                draw.ellipse((left, top, left + 2 * rx, top + 2 * ry), fill=pebble)
                draw.ellipse((left + 1, top, left + rx, top + ry), fill=highlight)
    return np.asarray(image)


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    palette = {name: sample_median(*sample) for name, sample in SAMPLES.items()}

    stone = make_base_texture(palette["stone"], seed=41, amplitude=8.0, fine=2.0)
    add_periodic_vein(stone, center=44, amplitude=10, cycles=2, phase=0.4, width=1.4, color=(190, 184, 178), opacity=0.13)
    add_periodic_vein(stone, center=182, amplitude=14, cycles=3, phase=2.0, width=1.0, color=(45, 43, 45), opacity=0.11)
    save_rgb("stone.png", stone)

    cap = make_base_texture(palette["cap"], seed=71, amplitude=3.4, fine=1.2)
    add_periodic_vein(cap, center=60, amplitude=18, cycles=2, phase=0.9, width=1.1, color=(184, 183, 177), opacity=0.28)
    add_periodic_vein(cap, center=193, amplitude=11, cycles=3, phase=2.4, width=0.8, color=(121, 124, 125), opacity=0.18)
    save_rgb("cap-marble.png", cap)

    paving = make_base_texture(palette["tile"], seed=113, amplitude=5.5, fine=1.6)
    save_rgb("paving.png", paving)

    inset_tile = [int(np.clip(channel * 0.97, 0, 255)) for channel in palette["tile"]]
    tile = make_base_texture(inset_tile, seed=117, amplitude=4.0, fine=1.0)
    save_rgb("apron-tile.png", tile)

    curb = make_base_texture(palette["curb"], seed=193, amplitude=4.0, fine=1.3)
    add_periodic_vein(curb, center=128, amplitude=7, cycles=1, phase=0.5, width=1.2, color=(112, 108, 102), opacity=0.1)
    save_rgb("curb-stone.png", curb)

    ground = make_base_texture(palette["ground"], seed=227, amplitude=12.0, fine=5.0)
    save_rgb("grass-ground.png", ground)

    save_rgb("gravel.png", make_gravel(palette["gravel"]))
    (OUTPUT / "palette.json").write_text(json.dumps({
        "method": "8x8 RGB medians from local source photographs; texture detail is generated with deterministic tileable noise and veins.",
        "samples": {
            name: {
                "source": f"assets/reference/{filename}",
                "center_pixel": [x, y],
                "patch_size": "8x8",
                "median_rgb": palette[name],
            }
            for name, (filename, x, y) in SAMPLES.items()
        },
    }, indent=2) + "\n")
    print(f"Generated seven tileable textures in {OUTPUT.relative_to(ROOT)} from {len(SAMPLES)} documented photo samples.")


if __name__ == "__main__":
    main()
