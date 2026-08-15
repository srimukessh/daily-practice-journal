#!/usr/bin/env python3
"""Generate PWA app icons with no third-party deps (pure stdlib PNG encoder).

Design: calm indigo rounded-square with a soft cream crescent moon — fits a
meditation / evening-review journal. Rendered at 3x supersample then box-
downscaled for smooth anti-aliased edges.

Run: python3 scripts/generate_icons.py
"""
import math
import struct
import zlib
from pathlib import Path

# palette
BG_TOP = (79, 70, 229)      # indigo-600
BG_BOT = (49, 46, 129)      # indigo-900
MOON = (253, 246, 227)      # warm cream
SS = 3                       # supersample factor

OUT = Path(__file__).resolve().parent.parent / "icons"


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def rounded_rect_alpha(x, y, w, h, r):
    """Coverage (0..1) of point (x,y) inside a rounded rect [0,w]x[0,h]."""
    # distance outside the rounded rect; 0 inside
    dx = max(r - x, x - (w - r), 0)
    dy = max(r - y, y - (h - r), 0)
    if dx == 0 or dy == 0:
        inside = (0 <= x <= w) and (0 <= y <= h)
        return 1.0 if inside else 0.0
    return 1.0 if math.hypot(dx, dy) <= r else 0.0


def render(size):
    S = size * SS
    r = S * 0.22  # corner radius
    # moon geometry (big cream disc minus an offset disc = crescent)
    cx, cy, cr = S * 0.60, S * 0.42, S * 0.30
    ox, oy, orr = S * 0.72, S * 0.34, S * 0.30

    big = bytearray(S * S * 3)
    for j in range(S):
        for i in range(S):
            idx = (j * S + i) * 3
            bg = lerp(BG_TOP, BG_BOT, j / S)
            in_rect = rounded_rect_alpha(i, j, S, S, r)
            if in_rect < 0.5:
                # transparent-ish: encode as background dark for non-alpha PNG
                big[idx:idx + 3] = bytes(BG_BOT)
                continue
            d_moon = math.hypot(i - cx, j - cy)
            d_cut = math.hypot(i - ox, j - oy)
            if d_moon <= cr and d_cut > orr:
                big[idx:idx + 3] = bytes(MOON)
            else:
                big[idx:idx + 3] = bytes(bg)

    # box downscale SS -> 1
    out = bytearray(size * size * 3)
    for j in range(size):
        for i in range(size):
            rr = gg = bb = 0
            for dj in range(SS):
                for di in range(SS):
                    si = (i * SS + di)
                    sj = (j * SS + dj)
                    k = (sj * S + si) * 3
                    rr += big[k]; gg += big[k + 1]; bb += big[k + 2]
            n = SS * SS
            o = (j * size + i) * 3
            out[o] = rr // n; out[o + 1] = gg // n; out[o + 2] = bb // n
    return bytes(out)


def write_png(path, rgb, size):
    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff))
    raw = bytearray()
    stride = size * 3
    for j in range(size):
        raw.append(0)
        raw.extend(rgb[j * stride:(j + 1) * stride])
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (180, 192, 512):
        rgb = render(size)
        write_png(OUT / f"icon-{size}.png", rgb, size)
        print(f"wrote icons/icon-{size}.png")


if __name__ == "__main__":
    main()
