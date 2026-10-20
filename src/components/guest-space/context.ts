import type { GuestSpaceData, GuestSpaceLanguage, GuestSpaceWords, GuestTab } from '@/lib/guestSpace';

/** Ce que chaque onglet reçoit : les données, les mots et les formats de la langue de l'espace. */
export interface GuestTabProps {
  d: GuestSpaceData;
  w: GuestSpaceWords;
  lang: GuestSpaceLanguage;
  token: string;
  /** Nombres et montants au format de la langue de l'espace. */
  num: (n: number) => string;
  eur: (n: number) => string;
  /** Date et heure dans le fuseau de la soirée. */
  date: (iso: string, opts: Intl.DateTimeFormatOptions) => string;
  reload: () => Promise<void>;
  go: (tab: GuestTab) => void;
  toast: (message: string, tone?: 'ok' | 'err') => void;
}
