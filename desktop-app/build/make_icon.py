#!/usr/bin/env python3
"""Generate a 1024x1024 macOS app icon for LazyOffice: an indigo squircle
with a white document sheet (folded corner + text lines) and an amber
lightning bolt — 'office docs, automated/fast'. Rounded corners are baked in
(macOS does not mask app icons)."""
import sys
from PIL import Image, ImageDraw

SIZE = 1024
# App theme accent (docgen THEME_ACCENT = 2C3E8C) as the base indigo.
TOP = (58, 79, 176)      # lighter indigo
BOT = (30, 42, 110)      # deep indigo
PAPER = (250, 250, 252)
LINE = (196, 201, 214)
BOLT = (245, 190, 66)    # amber
BOLT_EDGE = (214, 158, 40)

def squircle_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m

def vertical_gradient(size, top, bot):
    g = Image.new("RGB", (1, size))
    for y in range(size):
        t = y / (size - 1)
        g.putpixel((0, y), tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))
    return g.resize((size, size))

img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))

# --- squircle background with gradient (with macOS-style padding) ---
margin = 96
inner = SIZE - 2 * margin
grad = vertical_gradient(inner, TOP, BOT).convert("RGBA")
mask = squircle_mask(inner, radius=int(inner * 0.235))
bg = Image.new("RGBA", (inner, inner), (0, 0, 0, 0))
bg.paste(grad, (0, 0), mask)
img.paste(bg, (margin, margin), bg)

d = ImageDraw.Draw(img)

# --- white document sheet, slightly left of center ---
doc_w, doc_h = 372, 470
dx, dy = 300, 300
fold = 92
# drop shadow
sh = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
ImageDraw.Draw(sh).rounded_rectangle([dx + 14, dy + 20, dx + doc_w + 14, dy + doc_h + 20], radius=26, fill=(0, 0, 0, 60))
img.alpha_composite(sh)
# sheet body (with folded top-right corner)
d.rounded_rectangle([dx, dy, dx + doc_w, dy + doc_h], radius=26, fill=PAPER)
# cut + draw the fold
d.polygon([(dx + doc_w - fold, dy), (dx + doc_w, dy + fold), (dx + doc_w - fold, dy + fold)], fill=(225, 228, 236))
d.polygon([(dx + doc_w - fold, dy), (dx + doc_w, dy), (dx + doc_w, dy + fold)], fill=PAPER)  # keep square top-right white-ish
# redo clean fold triangle look
d.rectangle([dx + doc_w - fold, dy, dx + doc_w, dy + fold], fill=PAPER)
d.polygon([(dx + doc_w - fold, dy), (dx + doc_w, dy + fold), (dx + doc_w - fold, dy + fold)], fill=(216, 220, 230))

# text lines
lx = dx + 46
lw = doc_w - 92
for i, y in enumerate(range(dy + 150, dy + doc_h - 40, 58)):
    w = lw if i % 3 != 2 else int(lw * 0.6)
    d.rounded_rectangle([lx, y, lx + w, y + 20], radius=10, fill=LINE)

# --- amber lightning bolt overlapping bottom-right ---
bolt = [(628, 470), (556, 660), (612, 660), (568, 812),
        (712, 604), (650, 604), (700, 470)]
d.polygon(bolt, fill=BOLT)
d.line(bolt + [bolt[0]], fill=BOLT_EDGE, width=6, joint="curve")

img.save(sys.argv[1] if len(sys.argv) > 1 else "icon_1024.png")
print("wrote", sys.argv[1] if len(sys.argv) > 1 else "icon_1024.png")
