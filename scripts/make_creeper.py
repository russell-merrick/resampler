"""Front-view Minecraft creeper: cube head, tall box body, short rectangular legs."""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "src" / "resample" / "static" / "creeper.png"

BG = (13, 6, 20)
INK = (10, 12, 8)
FACE = (16, 18, 12)
GREENS = (
    (52, 104, 30),
    (70, 132, 38),
    (88, 156, 46),
    (64, 120, 34),
    (96, 168, 52),
)

# Logical pixels. Head 8x8, body 8x12, legs 4x6 each.
W, H = 16, 28


def green(x: int, y: int) -> tuple[int, int, int]:
    return GREENS[(x * 13 + y * 7) % len(GREENS)]


def put(px: list[list[tuple[int, int, int]]], x: int, y: int, c: tuple[int, int, int]) -> None:
    if 0 <= x < W and 0 <= y < H:
        px[y][x] = c


def rect(px, x0, y0, x1, y1, color) -> None:
    for y in range(y0, y1):
        for x in range(x0, x1):
            put(px, x, y, color(x, y) if callable(color) else color)


def outline(px, x0, y0, x1, y1) -> None:
    for x in range(x0, x1):
        put(px, x, y0, INK)
        put(px, x, y1 - 1, INK)
    for y in range(y0, y1):
        put(px, x0, y, INK)
        put(px, x1 - 1, y, INK)


def draw() -> list[list[tuple[int, int, int]]]:
    px = [[BG for _ in range(W)] for _ in range(H)]
    ox = 4  # center the 8-wide creeper

    # Head 8x8
    rect(px, ox, 1, ox + 8, 9, green)
    # Classic 8x8 face
    face = [
        "        ",
        "        ",
        " ##  ## ",
        " ##  ## ",
        "   ##   ",
        " ##  ## ",
        " ###### ",
        " ##  ## ",
    ]
    for y, row in enumerate(face):
        for x, ch in enumerate(row):
            if ch == "#":
                put(px, ox + x, 1 + y, FACE)
    outline(px, ox, 1, ox + 8, 9)

    # Body 8x12
    rect(px, ox, 8, ox + 8, 20, green)
    outline(px, ox, 8, ox + 8, 20)

    # Two short rectangular front legs (4x6). Back pair sits behind as a 1px shelf.
    rect(px, ox, 19, ox + 4, 26, green)
    rect(px, ox + 4, 19, ox + 8, 26, green)
    outline(px, ox, 19, ox + 4, 26)
    outline(px, ox + 4, 19, ox + 8, 26)
    # tiny back-leg hint so it isn't a horse — short blocks only
    put(px, ox - 1, 20, INK)
    put(px, ox - 1, 21, green(ox - 1, 21))
    put(px, ox - 1, 22, green(ox - 1, 22))
    put(px, ox - 1, 23, INK)
    put(px, ox + 8, 20, INK)
    put(px, ox + 8, 21, green(ox + 8, 21))
    put(px, ox + 8, 22, green(ox + 8, 22))
    put(px, ox + 8, 23, INK)

    return px


def scale(px: list[list[tuple[int, int, int]]], n: int) -> list[list[tuple[int, int, int]]]:
    h, w = len(px), len(px[0])
    return [[px[y // n][x // n] for x in range(w * n)] for y in range(h * n)]


def write_png(path: Path, px: list[list[tuple[int, int, int]]]) -> None:
    h, w = len(px), len(px[0])
    raw = b"".join(b"\x00" + b"".join(bytes(p) for p in row) for row in px)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    )


def main() -> None:
    write_png(OUT, scale(draw(), 20))
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
