#!/usr/bin/env python3
"""Décline le wordmark officiel « yuno » en toutes ses variantes.

Le wordmark est UNE forme, déclinée en couleur — jamais redessinée. Toutes les
surfaces (app, landing, /links, linktrees, emails, passes Wallet, factures PDF)
tirent d'ici, pour qu'un seul fichier fasse foi.

    python3 scripts/gen-brand-wordmark.py
    python3 scripts/gen-brand-wordmark.py --source "~/Desktop/Yuno/logo/WordMark sans fond .png"

Sans --source, on repart de public/yuno-wordmark.png (la version déjà détourée
committée). Avec --source, on repart de l'export brut du designer : le PNG
officiel traîne un halo d'ombre quasi transparent (alpha 1–7) qui s'étend bien
au-delà des lettres — invisible sur fond noir, mais qui se voit comme une
salissure grise sur fond clair (facture PDF, pied d'email à thème clair). On le
coupe à 8, on détoure au ras, et on repeint en aplat : le wordmark doit être une
silhouette pure, pas un raster avec de la couleur résiduelle.

Sorties :
  public/yuno-wordmark.png       blanc  — canonique + URL absolue (emails, Wallet)
  public/yuno-wordmark-dark.png  #0A0A0A — pieds d'email à thème clair
  src/assets/yuno-wordmark.webp       blanc — surfaces sombres du front (bundle)
  src/assets/yuno-wordmark-dark.webp  #0A0A0A — aperçu Canvas de l'Email Studio
  src/assets/yuno-wordmark-red.webp   #E8192C — surfaces claires / accent rouge
  src/assets/yuno-wordmark-red.png    idem, pour jsPDF (facture) qui ignore le webp
"""
import argparse
import pathlib
import subprocess
import sys

try:
    import numpy as np
    from PIL import Image
except ImportError:
    sys.exit("pip install pillow numpy")

ROOT = pathlib.Path(__file__).resolve().parent.parent
ALPHA_FLOOR = 8  # sous ce seuil, c'est le halo d'ombre — pas la lettre.

VARIANTS = [
    ((255, 255, 255), ROOT / "public/yuno-wordmark.png", ROOT / "src/assets/yuno-wordmark.webp"),
    ((10, 10, 10), ROOT / "public/yuno-wordmark-dark.png", ROOT / "src/assets/yuno-wordmark-dark.webp"),
    # jsPDF (facture) ne sait pas lire un webp : le rouge sort aussi en PNG.
    ((232, 25, 44), ROOT / "src/assets/yuno-wordmark-red.png", ROOT / "src/assets/yuno-wordmark-red.webp"),
]


def silhouette(src: pathlib.Path) -> np.ndarray:
    """Canal alpha détouré au ras, halo d'ombre coupé."""
    a = np.array(Image.open(src).convert("RGBA"))[..., 3].astype(np.int16)
    a[a < ALPHA_FLOOR] = 0
    ys, xs = np.where(a > 0)
    if not len(ys):
        sys.exit(f"{src} : aucun pixel opaque")
    return a[ys.min():ys.max() + 1, xs.min():xs.max() + 1].astype(np.uint8)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default=str(ROOT / "public/yuno-wordmark.png"))
    args = ap.parse_args()

    alpha = silhouette(pathlib.Path(args.source).expanduser())
    h, w = alpha.shape
    print(f"wordmark {w}x{h}")

    for rgb, png_out, webp_out in VARIANTS:
        img = np.zeros((h, w, 4), dtype=np.uint8)
        img[..., 0], img[..., 1], img[..., 2] = rgb
        img[..., 3] = alpha
        png = png_out or pathlib.Path(f"/tmp/yuno-wordmark-{rgb[0]}.png")
        Image.fromarray(img, "RGBA").save(png, optimize=True)
        if png_out:
            print(f"  → {png_out.relative_to(ROOT)}")
        if webp_out:
            subprocess.run(
                ["cwebp", "-quiet", "-q", "90", "-m", "6", "-alpha_q", "100", str(png), "-o", str(webp_out)],
                check=True,
            )
            print(f"  → {webp_out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
