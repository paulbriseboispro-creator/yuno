#!/usr/bin/env python3
"""Régénère les images des passes Apple Wallet et les réinjecte en base64 dans
supabase/functions/_shared/wallet/assets.ts.

    python3 scripts/gen-wallet-assets.py

Contraintes Apple (eventTicket) qui pilotent les choix ci-dessous :
  - logo       : plafonné à 160x50pt. Une image qui remplit ce cadre rend au
                 maximum absolu. On garde donc le canvas 160x50 (le header
                 conserve sa hauteur, donc son air) mais on n'y dessine le
                 wordmark qu'à ~72pt de large, calé à gauche et centré
                 verticalement. Le reste est transparent.
  - background : 180x220pt, étiré plein cadre par Wallet (qui pose le QR blanc
                 dans le tiers bas, sur le rouge plein du bas de rampe).

Le wordmark n'est pas re-dessiné : on réutilise les glyphes déjà embarqués
(LOGO3X), simplement remis à l'échelle. Aucune police requise.
"""
from __future__ import annotations

import base64
import io
import re
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ASSETS_TS = ROOT / "supabase/functions/_shared/wallet/assets.ts"

# --- Logo -------------------------------------------------------------------
LOGO_BOX = (160, 50)  # cadre Apple, en points
LOGO_MARK_W = 72      # largeur visible du wordmark, en points (~45% du cadre)
LOGO_INSET_X = 3      # marge gauche, en points

# --- Fond -------------------------------------------------------------------
BG_BOX = (180, 220)   # cadre Apple, en points
# Rampe verticale noir -> rouge de marque, choisie par Paul : le pass s'embrase
# vers le bas et le QR se détache en blanc sur le rouge plein. Paliers linéaires,
# pas de vignette — c'est la reprise exacte du dégradé d'origine.
BG_STOPS = [
    (0.00, (16, 3, 9)),
    (0.30, (38, 7, 16)),
    (0.60, (118, 14, 29)),
    (0.80, (182, 19, 37)),
    (1.00, (232, 25, 44)),
]


def _read_const(src: str, name: str) -> bytes:
    m = re.search(r"const %s\s*=\s*((?:\s*'[^']*'\s*\+?)+);" % name, src)
    if not m:
        raise SystemExit(f"constante {name} introuvable dans assets.ts")
    return base64.b64decode("".join(re.findall(r"'([^']*)'", m.group(1))))


def build_logo(mark: Image.Image, scale: int) -> Image.Image:
    """Wordmark redimensionné, calé à gauche et centré dans le cadre Apple."""
    box_w, box_h = LOGO_BOX[0] * scale, LOGO_BOX[1] * scale
    mark = mark.crop(mark.getchannel("A").getbbox())
    w = LOGO_MARK_W * scale
    h = round(mark.height * w / mark.width)
    mark = mark.resize((w, h), Image.LANCZOS)

    canvas = Image.new("RGBA", (box_w, box_h), (0, 0, 0, 0))
    canvas.paste(mark, (LOGO_INSET_X * scale, (box_h - h) // 2), mark)
    return canvas


def build_background(scale: int) -> Image.Image:
    w, h = BG_BOX[0] * scale, BG_BOX[1] * scale
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)

    for y in range(h):
        t = y / (h - 1)
        for i in range(len(BG_STOPS) - 1):
            t0, c0 = BG_STOPS[i]
            t1, c1 = BG_STOPS[i + 1]
            if t <= t1 or i == len(BG_STOPS) - 2:
                k = 0.0 if t1 == t0 else min(max((t - t0) / (t1 - t0), 0.0), 1.0)
                d.line([(0, y), (w, y)],
                       fill=tuple(round(c0[j] + (c1[j] - c0[j]) * k) for j in range(3)))
                break
    return img


def to_b64_literal(img: Image.Image, name: str) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode()
    lines = textwrap.wrap(b64, 120)
    body = " +\n  ".join(f"'{ln}'" for ln in lines)
    return f"const {name} =\n  {body};"


def main() -> None:
    src = ASSETS_TS.read_text()
    mark = Image.open(io.BytesIO(_read_const(src, "LOGO3X"))).convert("RGBA")

    out = {
        "LOGO": build_logo(mark, 1),
        "LOGO2X": build_logo(mark, 2),
        "LOGO3X": build_logo(mark, 3),
        "BG": build_background(1),
        "BG2X": build_background(2),
        "BG3X": build_background(3),
    }

    for name, img in out.items():
        pattern = re.compile(r"const %s\s*=\s*(?:\s*'[^']*'\s*\+?)+;" % name)
        src = pattern.sub(lambda _m, n=name, i=img: to_b64_literal(i, n), src, count=1)
        print(f"{name:<7} {img.size[0]}x{img.size[1]}")

    ASSETS_TS.write_text(src)
    print(f"\n→ {ASSETS_TS.relative_to(ROOT)} mis à jour")


if __name__ == "__main__":
    main()
