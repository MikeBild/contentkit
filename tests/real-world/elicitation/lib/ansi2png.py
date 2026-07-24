#!/usr/bin/env python3
"""Render a `tmux capture-pane -e -p` ANSI text frame to a PNG.

Minimal SGR support — 16/256-color foreground/background, bold, reset —
which covers what Claude Code and Codex TUIs emit. Monospace-rendered with
PIL so the harness has no external screenshot dependency.

Usage: ansi2png.py frame.ansi.txt frame.png
"""

import re
import sys

from PIL import Image, ImageDraw, ImageFont

SGR = re.compile(r"\x1b\[([0-9;]*)m")
OTHER_ESC = re.compile(r"\x1b[\[\]()][0-9;?]*[a-zA-Z]?")

BASE16 = [
    (0, 0, 0), (205, 49, 49), (13, 188, 121), (229, 229, 16),
    (36, 114, 200), (188, 63, 188), (17, 168, 205), (229, 229, 229),
    (102, 102, 102), (241, 76, 76), (35, 209, 139), (245, 245, 67),
    (59, 142, 234), (214, 112, 214), (41, 184, 219), (255, 255, 255),
]


def color256(n: int):
    if n < 16:
        return BASE16[n]
    if n < 232:
        n -= 16
        r, g, b = n // 36, (n % 36) // 6, n % 6
        steps = [0, 95, 135, 175, 215, 255]
        return (steps[r], steps[g], steps[b])
    v = 8 + (n - 232) * 10
    return (v, v, v)


DEFAULT_FG = (220, 220, 220)
DEFAULT_BG = (24, 24, 24)


def parse(line: str):
    """Yield (char, fg, bg, bold) for one line."""
    fg, bg, bold = DEFAULT_FG, None, False
    pos = 0
    out = []
    while pos < len(line):
        m = SGR.match(line, pos)
        if m:
            codes = [int(c) for c in m.group(1).split(";") if c] or [0]
            i = 0
            while i < len(codes):
                c = codes[i]
                if c == 0:
                    fg, bg, bold = DEFAULT_FG, None, False
                elif c == 1:
                    bold = True
                elif c == 22:
                    bold = False
                elif 30 <= c <= 37:
                    fg = BASE16[c - 30 + (8 if bold else 0)]
                elif 90 <= c <= 97:
                    fg = BASE16[c - 90 + 8]
                elif 40 <= c <= 47:
                    bg = BASE16[c - 40]
                elif 100 <= c <= 107:
                    bg = BASE16[c - 100 + 8]
                elif c == 38 and i + 2 < len(codes) and codes[i + 1] == 5:
                    fg = color256(codes[i + 2]); i += 2
                elif c == 48 and i + 2 < len(codes) and codes[i + 1] == 5:
                    bg = color256(codes[i + 2]); i += 2
                elif c == 39:
                    fg = DEFAULT_FG
                elif c == 49:
                    bg = None
                i += 1
            pos = m.end()
            continue
        m = OTHER_ESC.match(line, pos)
        if m:
            pos = m.end()
            continue
        out.append((line[pos], fg, bg, bold))
        pos += 1
    return out


def main() -> int:
    src, dst = sys.argv[1], sys.argv[2]
    with open(src, encoding="utf-8", errors="replace") as f:
        lines = [parse(raw.rstrip("\n")) for raw in f]

    font = None
    for cand in (
        "/System/Library/Fonts/Menlo.ttc",
        "/System/Library/Fonts/Monaco.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    ):
        try:
            font = ImageFont.truetype(cand, 13)
            break
        except OSError:
            continue
    if font is None:
        font = ImageFont.load_default()

    box = font.getbbox("M")
    cw, ch = box[2] - box[0], (box[3] - box[1]) + 5
    cols = max((len(l) for l in lines), default=80)
    img = Image.new("RGB", (cw * max(cols, 80) + 16, ch * max(len(lines), 1) + 16), DEFAULT_BG)
    draw = ImageDraw.Draw(img)

    for y, cells in enumerate(lines):
        for x, (char, fg, bg, _bold) in enumerate(cells):
            px, py = 8 + x * cw, 8 + y * ch
            if bg:
                draw.rectangle((px, py, px + cw, py + ch), fill=bg)
            if char.strip():
                draw.text((px, py), char, fill=fg, font=font)

    img.save(dst)
    return 0


if __name__ == "__main__":
    sys.exit(main())
