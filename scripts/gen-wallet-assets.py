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
  - logo h50, w 50..160 : en-tête du eventTicket. DÉTOURÉ AU RAS, sans marge.
                          Le cadre 160x50 d'origine réservait 88pt de pixels
                          transparents à droite du wordmark — et Wallet réserve
                          la largeur de l'IMAGE, pas celle de l'encre. L'en-tête
                          payait donc 55 % de sa place pour du vide, ce qui
                          écrasait les champs contre le bord droit. Le wordmark
                          garde exactement la même taille à l'écran.
  - primaryLogo h30,
    w 30..126           : en-tête du POSTER event ticket (iOS 18+). Ici Apple
                          cadre au plus juste : le PNG doit être le wordmark
                          détouré, sans marge — watchOS rogne les blancs.

Il n'y a plus de background.png : le design 2026-09 pose un noir plein
(`backgroundColor`), et Wallet ne sait pas faire de dégradé.

Le wordmark n'est pas re-dessiné : il est LU depuis `public/yuno-wordmark.png`,
le mot-symbole officiel, celui-là même que servent l'app, la landing, /links,
les linktrees et les emails (voir scripts/gen-brand-wordmark.py). Il était
auparavant détouré de l'icône de l'app par seuillage — ce qui marchait, mais
récupérait au passage l'ombre portée et le grain du raster. Une seule source de
vérité pour la marque, aucune police requise, et le pass ne peut pas dériver.
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
WORDMARK = ROOT / "public/yuno-wordmark.png"

# --- Icône -----------------------------------------------------------------
ICON_PT = 38

# --- Logo eventTicket classique --------------------------------------------
LOGO_W = 72           # largeur du wordmark, en points (le cadre Apple va jusqu'à 160)

# --- primaryLogo (poster event ticket) --------------------------------------
PRIMARY_LOGO_H = 30   # hauteur Apple, en points — largeur déduite du ratio


def _trim(mark: Image.Image) -> Image.Image:
    return mark.crop(mark.getchannel("A").getbbox())


def extract_wordmark() -> Image.Image:
    """Le mot-symbole officiel « yuno », blanc plein — voir l'en-tête."""
    return Image.open(WORDMARK).convert("RGBA")


def build_logo(mark: Image.Image, scale: int) -> Image.Image:
    """Wordmark détouré, sans un pixel de marge — voir l'en-tête du fichier."""
    mark = _trim(mark)
    w = LOGO_W * scale
    h = round(mark.height * w / mark.width)
    return mark.resize((w, h), Image.LANCZOS)


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
    mark = extract_wordmark()

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
