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
  - background : 180x220pt, étiré plein cadre par Wallet. Le QR blanc est posé
                 par iOS dans le tiers bas → le dégradé doit y revenir au noir,
                 sinon la carte blanche flotte sur du rouge saturé.

Le wordmark n'est pas re-dessiné : on réutilise les glyphes déjà embarqués
(LOGO3X), simplement remis à l'échelle. Aucune police requise.
"""
from __future__ import annotations

import base64
import io
import re
import textwrap
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ASSETS_TS = ROOT / "supabase/functions/_shared/wallet/assets.ts"

# --- Logo -------------------------------------------------------------------
LOGO_BOX = (160, 50)  # cadre Apple, en points
LOGO_MARK_W = 72      # largeur visible du wordmark, en points (~45% du cadre)
LOGO_INSET_X = 3      # marge gauche, en points

# --- Fond -------------------------------------------------------------------
BG_BOX = (180, 220)   # cadre Apple, en points
# Rampe verticale : noir en haut (header), halo rouge profond derrière les
# champs, retour au noir en bas pour que le QR se pose sur du sombre.
BG_STOPS = [
    (0.00, (0x0A, 0x0A, 0x0C)),
    (0.22, (0x18, 0x06, 0x0A)),
    (0.42, (0x4E, 0x0C, 0x17)),
    (0.56, (0x8E, 0x12, 0x21)),  # coeur du halo
    (0.68, (0x5A, 0x0C, 0x16)),
    (0.82, (0x1C, 0x07, 0x0C)),
    (1.00, (0x0A, 0x0A, 0x0C)),
]
BG_VIGNETTE = 0.55    # force de l'assombrissement des bords (0 = aucun)


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
    px = img.load()

    for y in range(h):
        t = y / (h - 1)
        for i in range(len(BG_STOPS) - 1):
            t0, c0 = BG_STOPS[i]
            t1, c1 = BG_STOPS[i + 1]
            if t <= t1 or i == len(BG_STOPS) - 2:
                k = 0.0 if t1 == t0 else min(max((t - t0) / (t1 - t0), 0.0), 1.0)
                k = k * k * (3 - 2 * k)  # smoothstep : pas de bande visible
                row = tuple(round(c0[j] + (c1[j] - c0[j]) * k) for j in range(3))
                break
        cx = (w - 1) / 2
        for x in range(w):
            # Vignette horizontale douce : les bords plongent vers le noir.
            d = abs(x - cx) / cx
            f = 1.0 - BG_VIGNETTE * (d ** 2.2)
            px[x, y] = tuple(round(c * f) for c in row)

    # Wallet floute déjà le fond ; on lisse en amont pour éviter tout banding
    # résiduel une fois l'image étirée sur toute la hauteur du pass.
    return img.filter(ImageFilter.GaussianBlur(radius=1.2 * scale))


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
