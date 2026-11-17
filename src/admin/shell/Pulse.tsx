/**
 * La barre de pouls de l'en-tête (v3), visible sur toutes les pages : quatre
 * points d'état (paiements, e-mail, tâches planifiées, apps) avec leur phrase
 * au survol, et les ventes d'aujourd'hui. Les feux quittent la page
 * Aujourd'hui : la santé se lit partout (Vercel, Datadog).
 * Lectures : `admin_cockpit` (bloc health) et `admin_platform_analytics`
 * sur 7 jours (le dernier jour = aujourd'hui), déjà en cache des pages.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { fmtEur } from '@/lib/adminFormat';
import { useAdminFilters } from '../context/useAdminFilters';
import { periodRange } from '../context/period';
import { useCockpit } from '../today/data';
import { lightsOf } from '../today/health';
import { usePlatformAnalytics } from '../money/data';
import { toneColor } from '../ui/tone';
import { useAdminT } from '../ui/i18n';

/** Les ventes du jour (Paris) dans la série par jour, 0 si le jour n'y est pas. */
function todaySales(byDay: Array<{ d: string; tickets: number; tables: number }> | undefined, now = new Date()): number | null {
  if (!byDay) return null;
  const key = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
  const row = byDay.find((r) => r.d.slice(0, 10) === key);
  return row ? row.tickets + row.tables : 0;
}

export function PulseBar() {
  const { t, lang } = useAdminT();
  const { includeDemo } = useAdminFilters();
  const cockpit = useCockpit(includeDemo);
  const week = useMemo(() => periodRange('7d'), []);
  const money = usePlatformAnalytics(week);
  const lights = cockpit.data?.health ? lightsOf(cockpit.data.health, t, lang) : null;
  const sales = todaySales(money.data?.cur.by_day);

  return (
    <Link to="/admin/system" className="a-focus a-pulse hidden items-center gap-3 rounded-md px-2 py-1 no-underline hover:bg-[var(--a-hover)] lg:flex"
      aria-label={t('adm.shell.pulse')}>
      <span className="flex items-center gap-1.5">
        {(lights ?? [null, null, null, null]).map((l, i) => (
          <span key={l?.key ?? i} className="relative inline-flex" title={l ? `${l.label} · ${l.value}` : undefined}>
            <span className="h-2 w-2 rounded-full" style={{ background: l ? toneColor(l.tone) : 'var(--a-grid)' }} />
            <span className="sr-only">{l ? `${l.label} : ${l.value}` : ''}</span>
          </span>
        ))}
      </span>
      <span className="a-mono a-t3 text-[11px]">{t('adm.shell.pulse.today')}</span>
      <span className="a-num a-t1 text-[12.5px] font-semibold">{sales == null ? '…' : fmtEur(sales, lang, { cents: false })}</span>
    </Link>
  );
}
