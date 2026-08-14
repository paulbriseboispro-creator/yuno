// Moments éditoriaux — temps forts de découverte (Freshers Week, Halloween, NYE…).
//
// Un moment est du CONTENU versionné dans le code, pas un système en base :
// une entrée = une ville + une fenêtre de dates + sa copie EN/FR/ES.
//   • La bannière Explore (ExploreMomentBanner) apparaît quand la ville du
//     visiteur correspond et qu'on est dans [teaserFrom, endDate].
//   • La page programme (/moment/:slug) liste toutes les soirées publiées de
//     la ville sur [startDate, endDate] — natives ET affiliées, toutes agences
//     confondues (chaque carte crédite sa propre agence via son lien).
// Retirer l'entrée du tableau retire la surface : rien d'autre à nettoyer.

export interface MomentTip {
  title: string;
  text: string;
}

export interface MomentCopy {
  /** Titre affiche (rendu en Space Grotesk uppercase géant). */
  title: string;
  /** Pitch une ligne sous le titre de la bannière. */
  tagline: string;
  /** Paragraphe d'intro de la page programme (angle « nouveaux arrivants »). */
  description: string;
  /** Conseils première soirée (3 max) affichés sur la page programme. */
  tips: MomentTip[];
}

export interface FeaturedMoment {
  id: string;
  /** Segment d'URL de la page programme : /moment/<slug>. */
  slug: string;
  /** Ville des soirées ET de l'audience de la bannière (match tolérant). */
  city: string;
  /** Premier soir (yyyy-MM-dd, date locale appareil). */
  startDate: string;
  /** Dernier soir (yyyy-MM-dd) — bannière et page vivent jusqu'à ce soir inclus. */
  endDate: string;
  /** La bannière teaser apparaît à partir de ce jour. */
  teaserFrom: string;
  /**
   * Code promoteur optionnel ajouté en ?ref= aux liens des soirées NATIVES de
   * la page programme (capturé par usePromoterTracking sur la fiche event).
   * Les soirées affiliées n'en ont pas besoin : leur billetterie externe porte
   * déjà le lien de leur agence. Ne touche à aucun code de checkout.
   */
  refCode?: string;
  copy: Record<'en' | 'fr' | 'es', MomentCopy>;
}

export const FEATURED_MOMENTS: FeaturedMoment[] = [
  {
    id: 'freshers-madrid-2026',
    slug: 'freshers-week-madrid',
    city: 'Madrid',
    startDate: '2026-08-31',
    endDate: '2026-09-12',
    teaserFrom: '2026-08-14',
    copy: {
      en: {
        title: 'FRESHERS WEEK',
        tagline: 'Two weeks, the biggest opening parties of the Madrid season.',
        description:
          "New in Madrid? From August 31 to September 12, the city's clubs open the season with their biggest nights. The full program is here, night by night: pick yours, grab your spot, see you on the dancefloor.",
        tips: [
          { title: 'Book online', text: 'The big nights sell out before midnight. Lock your spot before going out.' },
          { title: 'Bring your ID', text: 'Madrid clubs check at the door (18+). Passport or national ID card.' },
          { title: 'Arrive before 1 AM', text: 'Shorter lines, better entry deals. The night runs until sunrise anyway.' },
        ],
      },
      fr: {
        title: 'FRESHERS WEEK',
        tagline: 'Deux semaines, les plus grosses soirées de la rentrée madrilène.',
        description:
          'Nouveau à Madrid ? Du 31 août au 12 septembre, les clubs de la ville lancent la saison avec leurs plus grosses soirées. Tout le programme est ici, soir par soir : choisis ta nuit, prends ta place, et rendez-vous sur le dancefloor.',
        tips: [
          { title: 'Prends ta place en ligne', text: 'Les grosses soirées affichent complet avant minuit. Réserve avant de sortir.' },
          { title: "Pièce d'identité obligatoire", text: "Les clubs madrilènes contrôlent à l'entrée (18+). Passeport ou carte d'identité." },
          { title: 'Arrive avant 1h', text: "Moins d'attente, meilleures conditions d'entrée. La nuit dure jusqu'à l'aube de toute façon." },
        ],
      },
      es: {
        title: 'FRESHERS WEEK',
        tagline: 'Dos semanas, las fiestas más grandes del inicio de temporada en Madrid.',
        description:
          '¿Nuevo en Madrid? Del 31 de agosto al 12 de septiembre, los clubs de la ciudad abren la temporada con sus noches más grandes. Todo el programa está aquí, noche a noche: elige la tuya, reserva tu sitio y nos vemos en la pista.',
        tips: [
          { title: 'Reserva online', text: 'Las noches grandes se agotan antes de medianoche. Asegura tu sitio antes de salir.' },
          { title: 'Trae tu documento', text: 'Los clubs de Madrid lo piden en la puerta (18+). Pasaporte o DNI.' },
          { title: 'Llega antes de la 1', text: 'Menos cola y mejores condiciones de entrada. La noche dura hasta el amanecer igualmente.' },
        ],
      },
    },
  },
];

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Date locale du jour en yyyy-MM-dd (même convention que le reste de l'Explore). */
export function localTodayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Parse un yyyy-MM-dd en Date LOCALE (new Date('yyyy-MM-dd') seul parserait en UTC). */
export function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Moment à mettre en avant pour la ville du visiteur, ou null.
 * Fenêtre d'affichage : du teaser jusqu'au dernier soir inclus — les
 * comparaisons de chaînes yyyy-MM-dd sont sûres (ordre lexicographique).
 */
export function activeMomentForCity(city: string | null | undefined): FeaturedMoment | null {
  if (!city) return null;
  const today = localTodayStr();
  const c = city.toLowerCase();
  return (
    FEATURED_MOMENTS.find(
      m => c.includes(m.city.toLowerCase()) && today >= m.teaserFrom && today <= m.endDate
    ) ?? null
  );
}

/** Résolution par slug pour la page /moment/:slug (sans porte de date : la page décide). */
export function momentBySlug(slug: string | undefined): FeaturedMoment | null {
  if (!slug) return null;
  return FEATURED_MOMENTS.find(m => m.slug === slug) ?? null;
}

/** Le moment est-il en cours (premier soir atteint, dernier soir pas passé) ? */
export function momentIsLive(moment: FeaturedMoment): boolean {
  const today = localTodayStr();
  return today >= moment.startDate && today <= moment.endDate;
}

/** Le moment est-il terminé (dernier soir passé) ? */
export function momentIsOver(moment: FeaturedMoment): boolean {
  return localTodayStr() > moment.endDate;
}

/** Jours restants avant le premier soir (0 si atteint). */
export function momentDaysUntil(moment: FeaturedMoment): number {
  const ms = parseLocalDate(moment.startDate).getTime() - parseLocalDate(localTodayStr()).getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}
