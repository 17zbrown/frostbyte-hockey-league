#!/usr/bin/env python3
"""One scrollable file per guide (2026-09-16): the Discord-sized pages of a poster
(docs/guides/pages/<topic>-<n>.png, from build-pages.mjs) bound into a single PDF,
docs/guides/pdf/<topic>.pdf. Every page is 2400 px wide at 300 dpi (8 in), so a viewer
fits the width and the reader scrolls page to page — one file, no Discord downscaling.
    python3 tools/guides/build-pdf.py [topic …]
"""
import glob, os, sys
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PAGES = os.path.join(ROOT, "docs/guides/pages"); OUT = os.path.join(ROOT, "docs/guides/pdf")
os.makedirs(OUT, exist_ok=True)
want = sys.argv[1:]
topics = sorted(set(os.path.basename(f).rsplit("-", 1)[0] for f in glob.glob(PAGES + "/*.png")))
for t in topics:
    if want and t not in want: continue
    files = sorted(glob.glob(f"{PAGES}/{t}-*.png"), key=lambda f: int(f.rsplit("-", 1)[1][:-4]))
    ims = [Image.open(f).convert("RGB") for f in files]
    out = f"{OUT}/{t}.pdf"
    ims[0].save(out, "PDF", resolution=300.0, save_all=True, append_images=ims[1:], quality=88)
    print(f"{t}: {len(ims)} page(s) → {out} ({os.path.getsize(out)//1024} KB)")
