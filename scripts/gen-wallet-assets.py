#!/usr/bin/env python3
"""Régénère les images FIXES des passes Apple Wallet et les réinjecte en base64
dans supabase/functions/_shared/wallet/assets.ts.

    python3 scripts/gen-wallet-assets.py

L'affiche de la soirée, elle, change à chaque pass : elle est produite à la
volée par supabase/functions/_shared/wallet/artwork.ts, pas ici.

Contraintes Apple (Human Interface Guidelines › Wallet › Pass images) qui
pilotent les choix ci-dessous. Les tailles sont en POINTS, et Apple ne demande
que @2x et @3x pour les passes modernes — on garde @1x, il ne coûte rien et
couvre les vieux simulateurs.

  - icon 38x38          : ce que Wallet montre dans la liste des passes, dans
                          les notifications et sur l'écran verrouillé. C'est
                          l'icône de l'app, pas un glyphe abstrait : un pass
                          qu'on ne reconnaît pas dans une liste de dix est un
                          pass qu'on ne sort pas à la porte.
  - logo h50, w 50..160 : en-tête du eventTicket CLASSIQUE (iOS 17 et
                          antérieurs). Le cadre reste 160x50 pour que l'en-tête
                          garde sa hauteur, mais le wordmark n'y occupe que
                          ~72pt de large, calé à gauche, le reste transparent.
  - primaryLogo h30,
    w 30..126           : en-tête du POSTER event ticket (iOS 18+). Ici Apple
                          cadre au plus juste : le PNG doit être le wordmark
                          détouré, sans marge — watchOS rogne les blancs.

Il n'y a plus de background.png : le design 2026-09 pose un noir plein
(`backgroundColor`), et Wallet ne sait pas faire de dégradé.

Le wordmark n'est pas re-dessiné : on réutilise les glyphes déjà embarqués
(LOGO3X), simplement remis à l'échelle. Aucune police requise.
"""
from __future__ import annotations

import base64
import io
import re
import textwrap
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ASSETS_TS = ROOT / "supabase/functions/_shared/wallet/assets.ts"
APP_ICON = ROOT / "public/icon-512.png"

# --- Icône -----------------------------------------------------------------
ICON_PT = 38

# --- Logo eventTicket classique --------------------------------------------
LOGO_BOX = (160, 50)  # cadre Apple, en points
LOGO_MARK_W = 72      # largeur visible du wordmark, en points (~45% du cadre)
LOGO_INSET_X = 3      # marge gauche, en points

# --- primaryLogo (poster event ticket) --------------------------------------
PRIMARY_LOGO_H = 30   # hauteur Apple, en points — largeur déduite du ratio


def _read_const(src: str, name: str) -> bytes:
    m = re.search(r"const %s\s*=\s*((?:\s*'[^']*'\s*\+?)+);" % name, src)
    if not m:
        raise SystemExit(f"constante {name} introuvable dans assets.ts")
    return base64.b64decode("".join(re.findall(r"'([^']*)'", m.group(1))))


def _trim(mark: Image.Image) -> Image.Image:
    return mark.crop(mark.getchannel("A").getbbox())


def build_logo(mark: Image.Image, scale: int) -> Image.Image:
    """Wordmark redimensionné, calé à gauche et centré dans le cadre Apple."""
    box_w, box_h = LOGO_BOX[0] * scale, LOGO_BOX[1] * scale
    mark = _trim(mark)
    w = LOGO_MARK_W * scale
    h = round(mark.height * w / mark.width)
    mark = mark.resize((w, h), Image.LANCZOS)

    canvas = Image.new("RGBA", (box_w, box_h), (0, 0, 0, 0))
    canvas.paste(mark, (LOGO_INSET_X * scale, (box_h - h) // 2), mark)
    return canvas


def build_primary_logo(mark: Image.Image, scale: int) -> Image.Image:
    """Wordmark détouré au ras — le poster layout cadre lui-même."""
    mark = _trim(mark)
    h = PRIMARY_LOGO_H * scale
    w = round(mark.width * h / mark.height)
    return mark.resize((w, h), Image.LANCZOS)


def build_icon(scale: int) -> Image.Image:
    icon = Image.open(APP_ICON).convert("RGB")
    s = ICON_PT * scale
    return icon.resize((s, s), Image.LANCZOS)


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
        "ICON": build_icon(1),
        "ICON2X": build_icon(2),
        "ICON3X": build_icon(3),
        "LOGO": build_logo(mark, 1),
        "LOGO2X": build_logo(mark, 2),
        "LOGO3X": build_logo(mark, 3),
        "PLOGO": build_primary_logo(mark, 1),
        "PLOGO2X": build_primary_logo(mark, 2),
        "PLOGO3X": build_primary_logo(mark, 3),
    }

    for name, img in out.items():
        pattern = re.compile(r"const %s\s*=\s*(?:\s*'[^']*'\s*\+?)+;" % name)
        if not pattern.search(src):
            raise SystemExit(f"constante {name} absente d'assets.ts — l'ajouter d'abord")
        src = pattern.sub(lambda _m, n=name, i=img: to_b64_literal(i, n), src, count=1)
        print(f"{name:<8} {img.size[0]}x{img.size[1]}")

    ASSETS_TS.write_text(src)
    print(f"\n→ {ASSETS_TS.relative_to(ROOT)} mis à jour")


if __name__ == "__main__":
    main()
