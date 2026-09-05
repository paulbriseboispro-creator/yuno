import wordmarkWhite from '@/assets/yuno-wordmark.webp';
import wordmarkRed from '@/assets/yuno-wordmark-red.webp';
import wordmarkDark from '@/assets/yuno-wordmark-dark.webp';

/**
 * Le mot-symbole officiel « yuno ». UNE forme, deux teintes.
 *
 * Toute surface qui affiche le nom de la marque en tant que LOGO passe par ici —
 * app, landing, /links, linktrees, admin. Avant, chacune redessinait le nom en
 * Space Grotesk gras (« Yuno », capitale, letterspacing maison) : cinq logos
 * différents pour une seule marque. Le texte reste du texte quand c'est une
 * phrase (« Frais de service Yuno ») ; c'est un logo seulement quand il porte la
 * marque, et alors c'est ce composant.
 *
 * `height` est la seule dimension pilotée : le ratio est celui du fichier, on ne
 * l'écrase jamais (une lettre étirée n'est plus le logo). Les emails et les
 * passes Wallet ne peuvent pas importer de composant React — ils tirent le même
 * dessin depuis public/yuno-wordmark.png. Tout est régénéré par
 * scripts/gen-brand-wordmark.py.
 */

/** Ratio natif du fichier (856 × 290). */
export const WORDMARK_RATIO = 856 / 290;

export interface WordmarkProps {
  /** Hauteur rendue, en px. La largeur suit le ratio. */
  height: number;
  /**
   * Blanc sur fond sombre (défaut), rouge en accent, sombre sur fond clair.
   * `dark` existe pour que l'aperçu Canvas de l'Email Studio montre la teinte
   * exacte que l'email enverra (public/yuno-wordmark-dark.png).
   */
  tone?: 'white' | 'red' | 'dark';
  className?: string;
  style?: React.CSSProperties;
  /** Titre accessible. Décoratif (alt vide) quand le nom est déjà à côté. */
  alt?: string;
}

const SRC: Record<NonNullable<WordmarkProps['tone']>, string> = {
  white: wordmarkWhite,
  red: wordmarkRed,
  dark: wordmarkDark,
};

export function Wordmark({ height, tone = 'white', className, style, alt = 'Yuno' }: WordmarkProps) {
  return (
    <img
      src={SRC[tone]}
      alt={alt}
      width={Math.round(height * WORDMARK_RATIO)}
      height={height}
      draggable={false}
      className={className}
      style={{ height, width: 'auto', display: 'block', ...style }}
    />
  );
}
