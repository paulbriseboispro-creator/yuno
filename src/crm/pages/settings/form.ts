/**
 * Le formulaire de l'écran Réglages : ce qui se compare à l'état enregistré
 * (barre « N modifications », points du rail), et les petites règles de
 * présentation (heures, adresse de page).
 */
import type { BusinessType, CrmSettings } from '@/crm/data/settings';
import type { SecId } from './settingsUi';

export interface SettingsForm {
  name: string;
  city: string;
  type: BusinessType;
  logo: string | null;
  nHab: number;
  perHab: 6 | 12 | 24;
  mois: number;
  jour: number;
  /** Mois sans activité avant effacement ; null = jamais. */
  conserv: 24 | 36 | 60 | null;
}

export function toForm(s: CrmSettings): SettingsForm {
  return {
    name: s.identity?.name ?? '',
    city: s.identity?.city ?? '',
    type: s.business_type,
    logo: s.identity?.logo_url ?? null,
    nHab: s.regular_min_nights,
    perHab: s.regular_window_months,
    mois: s.lapse_months,
    jour: s.night_end_hour,
    conserv: s.retention_months,
  };
}

/** Champs de chaque section (points rouges du rail). */
export const SEC_KEYS: Record<SecId, (keyof SettingsForm)[]> = {
  a: ['name', 'city', 'type', 'logo'],
  b: [],
  c: ['nHab', 'perHab', 'mois', 'jour'],
  d: ['conserv'],
  e: [],
};

export function dirtyKeys(f: SettingsForm, s: SettingsForm): (keyof SettingsForm)[] {
  return (Object.keys(f) as (keyof SettingsForm)[]).filter((k) => {
    const a = k === 'name' || k === 'city' ? String(f[k]).trim() : f[k];
    const b = k === 'name' || k === 'city' ? String(s[k]).trim() : s[k];
    return a !== b;
  });
}

/** « 4 h » en français et en espagnol, « 4 am » en anglais. */
export function hourLabel(h: number, lang: string): string {
  const x = ((h % 24) + 24) % 24;
  if (lang !== 'en') return `${x} h`;
  if (x === 0) return '12 am';
  if (x === 12) return '12 pm';
  return x < 12 ? `${x} am` : `${x - 12} pm`;
}

/** Adresse de page proposée à partir du nom (aperçu : la page est à venir). */
export function slugify(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'votre-nom';
}

/** Initiales d'un nom (logo absent). */
export function initials(name: string): string {
  const w = name.trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] ?? '') + (w[1]?.[0] ?? '')).toUpperCase() || 'Y';
}

/** Heures de fin de nuit proposées ; une valeur enregistrée hors liste s'y ajoute. */
export function nightHours(current: number): number[] {
  const base = [4, 5, 6, 8, 10];
  return base.includes(current) ? base : [...base, current].sort((a, b) => a - b);
}
