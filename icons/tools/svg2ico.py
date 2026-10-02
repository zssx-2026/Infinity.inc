#!/usr/bin/env python3
"""
svg2ico.py - turn the project's icon SVGs into .ico files, with no libraries.

Why this exists rather than a one-line call to some converter: the suite is
built so that it needs nothing but a compiler, and the icon pipeline follows
the same rule. There is no Pillow, no cairosvg and no ImageMagick on this
machine, and adding one would mean the icons could only be rebuilt on a
machine that had it.

So the subset of SVG the icons actually use is implemented here - rounded
rectangles, circles (filled or stroked) and straight-edged polygons - along
with a PNG writer and an ICO packer. Both file formats are small enough to
write directly: PNG needs a zlib stream and four chunks, and ICO is a
directory of those PNGs.

Anti-aliasing comes from supersampling: the shapes are drawn into a canvas
four times the target size with hard edges, then averaged down. Overlaps
composite correctly because the compositing happens at the high resolution,
not after the averaging.
"""

import os
import re
import struct
import sys
import zlib

SUPERSAMPLE = 4
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]


# --------------------------------------------------------------------- svg

COMMENT = re.compile(r"<!--.*?-->", re.S)
ELEMENT = re.compile(r"<(rect|circle|polygon)\b([^>]*?)/?>", re.S)
ATTR = re.compile(r'([a-zA-Z-]+)\s*=\s*"([^"]*)"')


def parse_color(value, default=None):
    """#rgb, #rrggbb, or 'none'."""
    if value is None:
        return default
    value = value.strip()
    if value == "none":
        return None
    if not value.startswith("#"):
        raise ValueError("only #rrggbb colours are supported, got " + value)
    body = value[1:]
    if len(body) == 3:
        body = "".join(c * 2 for c in body)
    if len(body) != 6:
        raise ValueError("bad colour: " + value)
    return (int(body[0:2], 16), int(body[2:4], 16), int(body[4:6], 16), 255)


def parse_points(value):
    numbers = [float(n) for n in re.findall(r"-?\d+(?:\.\d+)?", value)]
    if len(numbers) % 2:
        raise ValueError("polygon needs an even number of coordinates")
    return list(zip(numbers[0::2], numbers[1::2]))


def parse_svg(path):
    """Returns (width, height, [shapes])."""
    text = COMMENT.sub("", open(path, "r", encoding="utf-8").read())
    view = re.search(r'viewBox\s*=\s*"([^"]*)"', text)
    if not view:
        raise ValueError("the SVG has no viewBox: " + path)
    box = [float(n) for n in re.findall(r"-?\d+(?:\.\d+)?", view.group(1))]
    if len(box) != 4:
        raise ValueError("bad viewBox in " + path)
    width, height = box[2], box[3]

    shapes = []
    for name, body in ELEMENT.findall(text):
        a = dict(ATTR.findall(body))
        if name == "rect":
            shapes.append({
                "kind": "rect",
                "x": float(a.get("x", 0)), "y": float(a.get("y", 0)),
                "w": float(a.get("width", 0)), "h": float(a.get("height", 0)),
                "r": float(a.get("rx", 0)),
                "fill": parse_color(a.get("fill")),
            })
        elif name == "circle":
            shapes.append({
                "kind": "circle",
                "cx": float(a.get("cx", 0)), "cy": float(a.get("cy", 0)),
                "r": float(a.get("r", 0)),
                "fill": parse_color(a.get("fill")),
                "stroke": parse_color(a.get("stroke")),
                "strokeWidth": float(a.get("stroke-width", 0)),
            })
        else:
            shapes.append({
                "kind": "polygon",
                "points": parse_points(a.get("points", "")),
                "fill": parse_color(a.get("fill")),
            })
    return width, height, shapes


# ------------------------------------------------------------------ raster

def inside_rect(s, x, y):
    if s["r"] <= 0:
        return s["x"] <= x <= s["x"] + s["w"] and s["y"] <= y <= s["y"] + s["h"]
    r = min(s["r"], s["w"] / 2, s["h"] / 2)
    left, top = s["x"] + r, s["y"] + r
    right, bottom = s["x"] + s["w"] - r, s["y"] + s["h"] - r
    if not (s["x"] <= x <= s["x"] + s["w"] and s["y"] <= y <= s["y"] + s["h"]):
        return False
    cx = min(max(x, left), right)
    cy = min(max(y, top), bottom)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r + 1e-9


def inside_polygon(points, x, y):
    """Ray casting; the shapes here are simple, so winding order does not matter."""
    inside = False
    n = len(points)
    for i in range(n):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            t = (y - y1) / (y2 - y1)
            if x < x1 + t * (x2 - x1):
                inside = not inside
    return inside


def shape_bounds(s, pad=0.0):
    if s["kind"] == "rect":
        return (s["x"] - pad, s["y"] - pad, s["x"] + s["w"] + pad, s["y"] + s["h"] + pad)
    if s["kind"] == "circle":
        outer = s["r"] + (s["strokeWidth"] / 2 if s["stroke"] else 0) + pad
        return (s["cx"] - outer, s["cy"] - outer, s["cx"] + outer, s["cy"] + outer)
    xs = [p[0] for p in s["points"]]
    ys = [p[1] for p in s["points"]]
    return (min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad)


def render(width, height, shapes, size):
    """Composite every shape into a supersampled RGBA canvas, then average down."""
    ss = SUPERSAMPLE
    W, H = size * ss, size * ss
    scale = W / width

    # straight RGBA, non-premultiplied; the icons are fully opaque or fully
    # transparent, so a plain source-over is enough.
    canvas = [[0.0, 0.0, 0.0, 0.0] for _ in range(W * H)]

    for s in shapes:
        layers = []
        if s["kind"] == "circle" and s["stroke"]:
            layers.append(("annulus", s["stroke"]))
        if s.get("fill"):
            layers.append(("fill", s["fill"]))
        for mode, colour in layers:
            x0, y0, x1, y1 = shape_bounds(s, pad=2.0)
            px0 = max(0, int(x0 * scale) - 1)
            py0 = max(0, int(y0 * scale) - 1)
            px1 = min(W - 1, int(x1 * scale) + 1)
            py1 = min(H - 1, int(y1 * scale) + 1)
            if px1 < px0 or py1 < py0:
                continue
            r, g, b, a = [c / 255.0 for c in colour]
            for py in range(py0, py1 + 1):
                wy = (py + 0.5) / scale
                row = py * W
                for px in range(px0, px1 + 1):
                    wx = (px + 0.5) / scale
                    if s["kind"] == "rect":
                        hit = inside_rect(s, wx, wy)
                    elif s["kind"] == "circle":
                        d = ((wx - s["cx"]) ** 2 + (wy - s["cy"]) ** 2) ** 0.5
                        if mode == "annulus":
                            half = s["strokeWidth"] / 2
                            hit = abs(d - s["r"]) <= half
                        else:
                            hit = d <= s["r"]
                    else:
                        hit = inside_polygon(s["points"], wx, wy)
                    if not hit:
                        continue
                    dst = canvas[row + px]
                    da = dst[3]
                    out_a = a + da * (1 - a)
                    if out_a <= 0:
                        continue
                    dst[0] = (r * a + dst[0] * da * (1 - a)) / out_a
                    dst[1] = (g * a + dst[1] * da * (1 - a)) / out_a
                    dst[2] = (b * a + dst[2] * da * (1 - a)) / out_a
                    dst[3] = out_a

    # box filter down to the requested size
    pixels = bytearray(size * size * 4)
    inv = 1.0 / (ss * ss)
    for y in range(size):
        for x in range(size):
            ar = ag = ab = aa = 0.0
            for dy in range(ss):
                row = (y * ss + dy) * W
                for dx in range(ss):
                    c = canvas[row + x * ss + dx]
                    ar += c[0] * c[3]
                    ag += c[1] * c[3]
                    ab += c[2] * c[3]
                    aa += c[3]
            aa *= inv
            at = (y * size + x) * 4
            if aa <= 0:
                pixels[at:at + 4] = b"\x00\x00\x00\x00"
                continue
            # un-premultiply, then round
            pixels[at] = min(255, int(ar * inv / aa * 255 + 0.5))
            pixels[at + 1] = min(255, int(ag * inv / aa * 255 + 0.5))
            pixels[at + 2] = min(255, int(ab * inv / aa * 255 + 0.5))
            pixels[at + 3] = min(255, int(aa * 255 + 0.5))
    return pixels


# -------------------------------------------------------------------- png

def png_bytes(pixels, size):
    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)  # filter type 0
        raw += pixels[y * stride:(y + 1) * stride]

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", header)
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + chunk(b"IEND", b""))


# -------------------------------------------------------------------- ico

def ico_bytes(images):
    """images: list of (size, png bytes). 256 is written as 0 in the directory."""
    count = len(images)
    header = struct.pack("<HHH", 0, 1, count)
    offset = 6 + 16 * count
    directory = bytearray()
    for size, data in images:
        dim = 0 if size >= 256 else size
        directory += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    return header + bytes(directory) + b"".join(d for _, d in images)


def build(svg_path, ico_path):
    width, height, shapes = parse_svg(svg_path)
    images = []
    for size in ICO_SIZES:
        images.append((size, png_bytes(render(width, height, shapes, size), size)))
    data = ico_bytes(images)
    parent = os.path.dirname(os.path.abspath(ico_path))
    os.makedirs(parent, exist_ok=True)
    with open(ico_path, "wb") as f:
        f.write(data)
    return len(data)


def main(argv):
    if len(argv) < 3:
        print("usage: svg2ico.py <input.svg> <output.ico>")
        return 2
    size = build(argv[1], argv[2])
    print("%-46s %8d B  %s" % (os.path.basename(argv[2]), size, ", ".join(str(s) for s in ICO_SIZES)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
