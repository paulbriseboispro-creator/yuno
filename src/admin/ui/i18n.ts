/**
 * Textes de l'admin : `t(key, { n: 3 })` remplace `{n}` dans la traduction.
 * Le dictionnaire est la section `admin` (src/i18n/locales/admin/modules),
 * triplets [EN, FR, ES], chargée par la coquille avant le premier rendu.
 *
 * Aucune clé ni valeur technique ne s'affiche jamais : une clé absente
 * (souvent `adm.x.${valeur venue de la base}`) rend « Autre : <valeur en mots> »,
 * et `label(valeur)` traduit une valeur brute (statut, action, source…) par le
 * dictionnaire `adm.lbl.*`, avec le même repli.
 */
import { useCallback } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { Language } from '@/i18n/data';

/** Le nombre derrière une variable déjà mise en forme (« 1 240 », « 2,5 »). */
function numberOf(v: string | number | undefined): number | null {
  if (typeof v === 'number') return v;
  if (v == null) return null;
  const n = Number(String(v).replace(/[\s\u202f\u00a0]/g, '').replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Remplit `{n}` et choisit les formes `{n|une forme|plusieurs formes}` : singulier
 * pour 1 (et 0 en français), pluriel sinon. Jamais de « (s) » à l'écran.
 */
export function fill(text: string, vars?: Record<string, string | number>, lang: string = 'en'): string {
  if (!vars) return text;
  const plural = text.replace(/\{(\w+)\|([^|{}]*)\|([^{}]*)\}/g, (m, k: string, one: string, many: string) => {
    if (!(k in vars)) return m;
    const n = numberOf(vars[k]);
    if (n == null) return many;
    const single = lang === 'fr' ? Math.abs(n) < 2 : Math.abs(n) === 1;
    return single ? one : many;
  });
  return plural.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Une valeur technique en mots : « pro_account_hidden » → « pro account hidden ». */
export function humanizeRaw(v: string): string {
  return v.replace(/^adm\.[\w.]*?\.(?=[^.]+$)/, '').replace(/[_.:-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** La famille d'une erreur technique, pour la dire sans jargon. */
export function errorKind(msg: string | null | undefined): 'none' | 'timeout' | 'denied' | 'network' | 'rate' | 'missing' | 'other' {
  const m = (msg ?? '').toLowerCase();
  if (!m) return 'none';
  if (/timeout|timed out|canceling statement|deadline/.test(m)) return 'timeout';
  if (/permission|denied|not allowed|forbidden|unauthori[sz]ed|\b40[13]\b|jwt/.test(m)) return 'denied';
  if (/rate limit|too many|\b429\b|quota/.test(m)) return 'rate';
  if (/network|fetch|econn|socket|\b50[0-4]\b|unavailable|connection/.test(m)) return 'network';
  if (/does not exist|not found|\b404\b|undefined function|missing/.test(m)) return 'missing';
  return 'other';
}

export function useAdminT(): {
  t: (key: string, vars?: Record<string, string | number>) => string;
  label: (raw: string | null | undefined) => string;
  /** Vrai quand la clé a une traduction (pour choisir entre deux sources de texte). */
  has: (key: string) => boolean;
  /** Un message d'erreur technique dit en mots simples (le détail reste dans les journaux). */
  errorText: (msg: string | null | undefined) => string;
  lang: Language;
} {
  const { t: raw, language } = useLanguage();
  const other = useCallback((v: string) => {
    const o = raw('adm.ui.other');
    return o === 'adm.ui.other' ? humanizeRaw(v) : fill(o, { v: humanizeRaw(v) });
  }, [raw]);
  const t = useCallback((key: string, vars?: Record<string, string | number>) => {
    const s = raw(key);
    if (s === key && key.startsWith('adm.')) return other(key.slice(key.lastIndexOf('.') + 1));
    return fill(s, vars, language);
  }, [raw, other, language]);
  const label = useCallback((v: string | null | undefined) => {
    if (v == null || v === '') return '—';
    const key = `adm.lbl.${String(v).toLowerCase()}`;
    const s = raw(key);
    return s === key ? other(String(v)) : s;
  }, [raw, other]);
  const has = useCallback((key: string) => raw(key) !== key, [raw]);
  const errorText = useCallback((msg: string | null | undefined) => raw(`adm.lbl.err.${errorKind(msg)}`), [raw]);
  return { t, label, has, errorText, lang: language };
}
