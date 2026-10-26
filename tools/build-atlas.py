"""Compose the 4x4 block atlas used by src/world/atlas.js.

Run once after changing a tile:  python3 tools/build-atlas.py

The tile order must match TILE in shared/blocks.js. Water, bedrock and the
four alert devices have no source texture in the pack, so they are generated.

Needs Pillow: pip install pillow
"""
import pathlib
import random

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "textures" / "source"
OUT = ROOT / "src" / "assets" / "blocks-atlas.png"

TILE_PX = 16
COLS = 4
ROWS = 4

# Index == TILE value in shared/blocks.js
TILES = [
    "grass_top",        # 0  GRASS_TOP
    "grass_side",       # 1  GRASS_SIDE
    "dirt",             # 2  DIRT
    "stone_generic",    # 3  STONE
    "oak_log_side",     # 4  BARK
    "oak_log_top",      # 5  LOG_TOP
    "oak_leaves",       # 6  LEAVES
    "sand_ugly",        # 7  SAND
    "glass",            # 8  GLASS
    "cobblestone_bricks",  # 9  BRICK
    None,               # 10 WATER, generated
    None,               # 11 BEDROCK, generated
    None,               # 12 BEACON, generated
    None,               # 13 SIREN, generated
    None,               # 14 SENSOR, generated
    None,               # 15 DISPATCH, generated
]


def water(rnd):
    img = Image.new("RGBA", (TILE_PX, TILE_PX))
    for y in range(TILE_PX):
        for x in range(TILE_PX):
            wave = int(8 * (((x + y) % 6) / 6 - 0.5))
            j = rnd.randint(-6, 6)
            img.putpixel((x, y), (48 + wave + j, 120 + wave + j, 210, 190))
    return img


def bedrock(rnd):
    img = Image.new("RGBA", (TILE_PX, TILE_PX))
    for y in range(TILE_PX):
        for x in range(TILE_PX):
            chunk = 14 if ((x // 4) + (y // 4)) % 2 == 0 else -10
            j = rnd.randint(-8, 8)
            v = 60 + chunk + j
            img.putpixel((x, y), (v, v, v + 4, 255))
    return img


def beacon(rnd):
    # bright yellow lamp in a dark housing, a ring of light around the middle
    img = Image.new("RGBA", (TILE_PX, TILE_PX), (70, 60, 40, 255))
    for y in range(TILE_PX):
        for x in range(TILE_PX):
            d = max(abs(x - 7.5), abs(y - 7.5))
            if d < 4:
                img.putpixel((x, y), (255, 226 + rnd.randint(-6, 6), 70, 255))
            elif d < 6:
                img.putpixel((x, y), (235, 190, 60, 255))
    return img


def siren(rnd):
    # red and white warning stripes
    img = Image.new("RGBA", (TILE_PX, TILE_PX))
    for y in range(TILE_PX):
        for x in range(TILE_PX):
            stripe = (x + y) // 4 % 2 == 0
            img.putpixel((x, y), (230, 60, 60, 255) if stripe else (245, 245, 245, 255))
    return img


def sensor(rnd):
    # cyan panel with a single bright dot in the centre
    img = Image.new("RGBA", (TILE_PX, TILE_PX), (40, 150, 170, 255))
    for y in range(TILE_PX):
        for x in range(TILE_PX):
            if abs(x - 7.5) < 1.5 and abs(y - 7.5) < 1.5:
                img.putpixel((x, y), (200, 255, 255, 255))
            elif x in (0, TILE_PX - 1) or y in (0, TILE_PX - 1):
                img.putpixel((x, y), (30, 100, 115, 255))
    return img


def dispatch(rnd):
    # blue console with a white cross, the place where "Проверить" starts
    img = Image.new("RGBA", (TILE_PX, TILE_PX), (45, 80, 160, 255))
    for y in range(TILE_PX):
        for x in range(TILE_PX):
            if abs(x - 7.5) < 1.2 or abs(y - 7.5) < 1.2:
                img.putpixel((x, y), (240, 245, 255, 255))
            elif x in (0, TILE_PX - 1) or y in (0, TILE_PX - 1):
                img.putpixel((x, y), (25, 45, 100, 255))
    return img


def main():
    rnd = random.Random(0xB10C)
    atlas = Image.new("RGBA", (COLS * TILE_PX, ROWS * TILE_PX), (0, 0, 0, 0))
    generated = {
        10: water(rnd), 11: bedrock(rnd),
        12: beacon(rnd), 13: siren(rnd), 14: sensor(rnd), 15: dispatch(rnd),
    }
    for index, name in enumerate(TILES):
        if name is None:
            tile = generated[index]
        else:
            tile = Image.open(SOURCE / f"{name}.png").convert("RGBA")
        assert tile.size == (TILE_PX, TILE_PX), f"{name} is {tile.size}"
        col = index % COLS
        row = index // COLS
        atlas.paste(tile, (col * TILE_PX, row * TILE_PX))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(OUT, optimize=True)
    print(f"wrote {OUT.relative_to(ROOT)} {atlas.size}")


if __name__ == "__main__":
    main()
