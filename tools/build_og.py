#!/usr/bin/env python3
"""Compose the CGHL Open Graph banner: Higgsfield cinematic backdrop + crisp brand type (Archivo)."""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 1200, 630
CHROME = (255, 229, 0, 255)
WHITE  = (245, 246, 242, 255)
GREY   = (200, 208, 214, 255)
SHADOW = (0, 0, 0)

def archivo(size, weight=600, width=100):
    f = ImageFont.truetype(os.path.join(HERE, "fonts/Archivo.ttf"), size)
    try: f.set_variation_by_axes([weight, width])
    except Exception: pass
    return f

def plexmono(size, semi=False):
    name = "fonts/PlexMono-SemiBold.ttf" if semi else "fonts/PlexMono-Medium.ttf"
    return ImageFont.truetype(os.path.join(HERE, name), size)

def tracked_width(font, text, tracking):
    return sum(font.getlength(c) for c in text) + tracking * max(0, len(text) - 1)

def draw_tracked(draw, x, y, text, font, fill, tracking=0, shadow=(2, 2, 150)):
    cx = float(x)
    for c in text:
        if shadow:
            draw.text((cx + shadow[0], y + shadow[1]), c, font=font,
                      fill=SHADOW + (shadow[2],), anchor="la")
        draw.text((cx, y), c, font=font, fill=fill, anchor="la")
        cx += font.getlength(c) + tracking
    return cx - x

# --- background: Higgsfield backdrop scaled to width, cropped to 630 (keep the golden top) ---
bg = Image.open(os.path.join(HERE, "bg-a.png")).convert("RGB")
scale = W / bg.width
bg = bg.resize((W, round(bg.height * scale)), Image.LANCZOS)
top = 12
img = bg.crop((0, top, W, top + H)).convert("RGBA")

# gentle overall deepening so type reads
img = Image.blend(img, Image.new("RGBA", (W, H), (8, 11, 14, 255)), 0.12)

# left->right dark scrim (keeps the golden glow on the right), plus a bottom scrim
scrim = Image.new("RGBA", (W, H), (0, 0, 0, 0))
sd = scrim.load()
for x in range(W):
    lf = max(0.0, 1 - x / 1050.0)         # dark left, releases to golden right by x~1050
    a_left = int(210 * (lf ** 1.05))
    for y in range(H):
        bf = max(0.0, (y - 355) / 275.0)  # bottom scrim for tagline/domain
        a = min(238, a_left + int(150 * (bf ** 1.4)))
        if a: sd[x, y] = (5, 8, 11, a)
img = Image.alpha_composite(img, scrim)

draw = ImageDraw.Draw(img)

# --- logo tile (soft shadow so the dark tile separates from the dark bg) ---
logo = Image.open(os.path.join(HERE, "logo.png")).convert("RGBA")
LS = 132
logo = logo.resize((LS, LS), Image.LANCZOS)
lx, ly = 80, 168
sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
sh.paste((0, 0, 0, 190), (lx + 6, ly + 12, lx + LS + 6, ly + LS + 12))
sh = sh.filter(ImageFilter.GaussianBlur(14))
img = Image.alpha_composite(img, sh)
img.alpha_composite(logo, (lx, ly))
draw = ImageDraw.Draw(img)

TX = lx + LS + 30   # text block left = 242

# --- eyebrow: dash + tracked chrome mono ---
ey_y = 120
draw.rounded_rectangle((TX, ey_y + 9, TX + 30, ey_y + 12), radius=1, fill=CHROME)
eb = plexmono(21, semi=True)
draw_tracked(draw, TX + 46, ey_y, "COMPETITIVE 6V6  ·  EA SPORTS NHL", eb, CHROME, tracking=3.2, shadow=(1, 2, 160))

# --- wordmark: CHEL (white) GAMING (chrome), auto-fit to a safe width ---
def wm_width(font):
    return (tracked_width(font, "CHEL", 1.5) + font.getlength(" ") * 0.72
            + tracked_width(font, "GAMING", 1.5))
TARGET_WM = 772
sz = 132
while sz > 70:
    wm = archivo(sz, weight=900, width=112)
    if wm_width(wm) <= TARGET_WM: break
    sz -= 1
wy = 176
x = TX
x += draw_tracked(draw, x, wy, "CHEL", wm, WHITE, tracking=1.5, shadow=(3, 4, 175))
x += wm.getlength(" ") * 0.72
draw_tracked(draw, x, wy, "GAMING", wm, CHROME, tracking=1.5, shadow=(3, 4, 175))
wm_right = TX + wm_width(wm)

# --- HOCKEY LEAGUE (tracked to sit just under the wordmark width) ---
hl = archivo(38, weight=800, width=104)
hl_txt = "HOCKEY LEAGUE"
hl_track = max(6, (wm_right - TX - tracked_width(hl, hl_txt, 0)) / (len(hl_txt) - 1))
draw_tracked(draw, TX + 2, 322, hl_txt, hl, WHITE, tracking=hl_track, shadow=(2, 3, 150))

# --- rule ---
draw.line((TX + 2, 424, int(wm_right), 424), fill=(255, 255, 255, 55), width=2)

# --- tagline ---
tg = archivo(27, weight=500, width=100)
draw_tracked(draw, TX + 2, 452, "Eight clubs · two divisions · one champion.", tg, GREY, tracking=0.3, shadow=(1, 2, 150))

# --- domain (right-aligned, chrome mono) ---
dm = plexmono(31, semi=True)
dtxt = "chelgamingleague.com"
dw = tracked_width(dm, dtxt, 0.5)
draw_tracked(draw, W - 80 - dw, 540, dtxt, dm, CHROME, tracking=0.5, shadow=(2, 2, 170))

out = os.path.join(HERE, "out.png")
img.convert("RGB").save(out, "PNG")
print("wrote", out, img.size)
