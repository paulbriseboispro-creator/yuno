#!/usr/bin/env python3
"""Repose le mot-symbole officiel sur le Launch Screen natif de l'app client.

    python3 scripts/gen-splash-wordmark.py

Le Launch Screen (`ios/App/App/Assets.xcassets/Splash.imageset/*.png`) est un
APLAT : fond rouge #E51D2A, verre en trait blanc, « yuno » en dessous. Le mot y
était dessiné dans une graisse fine (Poppins-like), différente du wordmark
officiel — soit un troisième lettrage pour une seule marque.

On ne redessine rien à la main : on efface la bande du mot, on reconstruit le
fond (le rouge y est plat, la lueur radiale du splash est centrée bien plus
haut), et on repose `public/yuno-wordmark.png` DANS LA MÊME BOÎTE — mêmes
bornes gauche/droite, même ligne de base. La taille optique et la composition
ne bougent pas d'un pixel ; seules les lettres changent.

⚠️ Ce PNG est compilé dans le binaire : il ne part PAS en OTA. Tant que le
build qui l'embarque n'est pas approuvé par Apple, le loader web
(index.html + SplashScreen.tsx) doit rester sur l'ancien dessin — c'est ce que
pilote OFFICIAL_SPLASH_WORDMARK dans src/lib/brandSplash.ts. Les deux se
flippent ENSEMBLE, sinon le logo saute entre le Launch Screen et le splash web.

Le splash de l'app Pro n'est pas concerné : c'est l'icône de l'app rendue en
volume (biseau, ombre portée, pastille PRO), pas un wordmark à plat.
"""
from __future__ import annotations

import pathlib

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SPLASH_DIR = ROOT / "ios/App/App/Assets.xcassets/Splash.imageset"
WORDMARK = ROOT / "public/yuno-wordmark.png"

# Boîte du mot dans le splash d'origine (mesurée sur le PNG 2732×2732).
BAND = (1600, 2100)   # fenêtre de travail, marge comprise
BOX_X = (923, 1802)   # bornes gauche/droite de l'encre
BASELINE = 1895       # ligne de base (bas du « o »)
MARK_BASELINE = 0.7483  # où tombe la ligne de base DANS le fichier wordmark


def repaint(img: Image.Image, mark: Image.Image) -> Image.Image:
    a = np.array(img.convert("RGB")).astype(np.float32)
    y0, y1 = BAND

    # 1. Effacer : tout ce qui n'est pas le rouge du fond dans la fenêtre.
    #    Seuil bas + dilatation pour emporter l'anti-crénelage jusqu'au dernier
    #    pixel — un liseré blanc résiduel se verrait sur un aplat.
    win = a[y0:y1]
    ink = np.minimum(win[:, :, 1], win[:, :, 2]) > 55
    for _ in range(6):
        ink[:, 1:] |= ink[:, :-1]; ink[:, :-1] |= ink[:, 1:]
        ink[1:, :] |= ink[:-1, :]; ink[:-1, :] |= ink[1:, :]
    # Le fond est plat ligne par ligne dans cette bande : la médiane des pixels
    # non encrés de la ligne EST le fond.
    for i in range(win.shape[0]):
        keep = ~ink[i]
        if keep.sum() < 50:
            continue
        win[i][ink[i]] = np.median(win[i][keep], axis=0)
    a[y0:y1] = win

    # 2. Reposer le mot officiel dans la même boîte.
    w = BOX_X[1] - BOX_X[0] + 1
    h = round(w * mark.height / mark.width)
    top = round(BASELINE - h * MARK_BASELINE)
    scaled = mark.resize((w, h), Image.LANCZOS)
    m = np.array(scaled).astype(np.float32)
    alpha = (m[:, :, 3:4] / 255.0)
    region = a[top:top + h, BOX_X[0]:BOX_X[0] + w]
    a[top:top + h, BOX_X[0]:BOX_X[0] + w] = region * (1 - alpha) + m[:, :, :3] * alpha

    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGB")


def main() -> None:
    mark = Image.open(WORDMARK).convert("RGBA")
    targets = sorted(SPLASH_DIR.glob("*.png"))
    if not targets:
        raise SystemExit(f"aucun PNG dans {SPLASH_DIR}")
    # Les trois variantes de l'imageset sont identiques : on rend une fois.
    out = repaint(Image.open(targets[0]), mark)
    for t in targets:
        out.save(t, format="PNG", optimize=True)
        print(f"  → {t.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
