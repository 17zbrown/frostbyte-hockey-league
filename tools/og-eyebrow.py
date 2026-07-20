#!/usr/bin/env python3
"""Rewrite the eyebrow line on the Open Graph card (og.png).

The card is the single most-seen asset the league owns — it renders on every Discord share, every
DM'd link, every cross-post. It shipped reading "EA SPORTS NHL 26", which was already wrong (Season 1
is NHL 27) and would have gone flatly wrong on Sep 11 2026 when NHL 27 releases.

The rest of the card is good design, so this repaints ONLY the eyebrow band and leaves the wordmark,
the watermark and the gradient untouched pixel-for-pixel. The replacement text carries no game-version
clause, so it cannot expire again.

Usage:  python3 tools/og-eyebrow.py [text]
"""
import sys
from PIL import Image, ImageDraw, ImageFont

CARD = "og.png"
TEXT = sys.argv[1] if len(sys.argv) > 1 else "EA SPORTS NHL  ·  COMPETITIVE 6v6"

# Measured off the shipped card so the replacement lands on the original baseline and rhythm.
CHROME = (255, 229, 0)        # --chrome, the one brand accent
BAND = (100, 145)             # rows to repaint (clear of the wordmark below)
CLEAR_X = (80, 815)           # right edge stops short of the watermark ring
RULE_X, RULE_Y = (90, 144), (119, 122)
TEXT_X, CAP_TOP, CAP_H = 164, 113, 19
TRACKING = 3.4                # letterspacing, in px, matching the original

FONT_CANDIDATES = [
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
]


def load_font(cap_target):
    """Pick a size whose CAP height matches the original, not whose em size does."""
    for path in FONT_CANDIDATES:
        for size in range(18, 40):
            try:
                f = ImageFont.truetype(path, size, index=1) if path.endswith(".ttc") else ImageFont.truetype(path, size)
            except Exception:
                break
            box = f.getbbox("H")
            if box and (box[3] - box[1]) >= cap_target:
                return f, path, size
    raise SystemExit("no usable bold sans font found")


def main():
    im = Image.open(CARD).convert("RGB")
    px = im.load()
    d = ImageDraw.Draw(im)

    # Repaint the band row by row, sampling the true background colour from a column that the
    # eyebrow never occupied — the card has a faint vertical gradient and this preserves it.
    for y in range(BAND[0], BAND[1]):
        bg = px[CLEAR_X[0] - 20, y]
        d.rectangle([CLEAR_X[0], y, CLEAR_X[1], y], fill=bg)

    d.rectangle([RULE_X[0], RULE_Y[0], RULE_X[1], RULE_Y[1]], fill=CHROME)

    font, path, size = load_font(CAP_H)
    # Draw glyph by glyph so letterspacing matches the original's wide tracking.
    x = float(TEXT_X)
    top = font.getbbox("H")[1]
    for ch in TEXT:
        d.text((x, CAP_TOP - top), ch, font=font, fill=CHROME)
        x += d.textlength(ch, font=font) + TRACKING

    im.save(CARD)
    print(f"font={path.split('/')[-1]} size={size}  text ends x={int(x)}  -> {CARD}")


if __name__ == "__main__":
    main()
