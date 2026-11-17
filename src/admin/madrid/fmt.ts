/** Formats de la rubrique « Madrid » (nombres, parts, euros, jours, mois). */
import { useAdminT } from '@/admin/ui';
import { fmtDate, fmtEur, fmtNum, fmtPct, localeOf } from '@/lib/adminFormat';
import { shareOf } from './rules';

export function useMadridFmt() {
  const { t, lang } = useAdminT();
  const n = (v: number | null | undefined) => fmtNum(v ?? 0, lang);
  /** Part à afficher, ou les nombres bruts quand la base est sous 10. */
  const rate = (num: number, base: number) => {
    const s = shareOf(num, base);
    return s == null ? t('adm.mad.rawRate', { n: fmtNum(num, lang), base: fmtNum(base, lang) }) : fmtPct(s * 100, s < 0.1 ? 1 : 0, lang);
  };
  const pct = (s: number) => fmtPct(s * 100, s > 0 && s < 0.1 ? 1 : 0, lang);
  const eur = (v: number | null | undefined) => fmtEur(v ?? 0, lang);
  const noon = (iso: string) => (iso.length === 10 ? `${iso}T12:00:00` : iso);
  const day = (iso: string | null | undefined) => (iso ? fmtDate(noon(iso), lang, 'day') : '—');
  const month = (iso: string) => new Date(noon(iso)).toLocaleDateString(localeOf(lang), { month: 'long', year: 'numeric' });
  const exitsN = (v: number) => t(v === 1 ? 'adm.mad.cl.exitsOne' : 'adm.mad.cl.exitsN', { n: n(v) });
  return { t, lang, n, rate, pct, eur, day, month, exitsN };
}
