// Une soirée de la billetterie connectée, en une ligne : affiche, date,
// billets, CA (valeur faciale), pastilles « complet » / « annulée ». Mène au
// bilan de la soirée ; une soirée à venir propose aussi d'écrire à sa base.

import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useConsoleBase } from '@/lib/crmProduct';
import { TodayDelta } from '@/components/analytics/kit';
import { KIT, useNumberFormat } from '@/components/analytics/kitFormat';

export interface CrmNightRowData {
  event_id: string;
  title: string;
  start_at: string;
  cover_url?: string | null;
  url?: string | null;
  sold_out?: boolean | null;
  cancelled?: boolean | null;
  tickets?: number | null;
  tickets_today?: number | null;
  revenue?: number | null;
  buyers?: number | null;
  new_buyers?: number | null;
  scanned?: number | null;
}

export function CrmNightRow({ night, upcoming = false }: { night: CrmNightRowData; upcoming?: boolean }) {
  const { t } = useLanguage();
  const base = useConsoleBase();
  const { n, eur, locale } = useNumberFormat();
  const start = new Date(night.start_at);
  // L'année ne s'affiche que si elle n'est pas l'année en cours.
  const date = new Intl.DateTimeFormat(locale, {
    weekday: 'short', day: 'numeric', month: 'short',
    year: start.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  }).format(start);
  const pill = night.cancelled ? t('crm.night.cancelled') : night.sold_out ? t('crm.night.soldOut') : null;

  return (
    <div className="flex items-center gap-3 py-2.5" style={{ borderTop: `1px solid ${KIT.BORDER}` }}>
      <Link to={`${base}/crm/nights/${night.event_id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg" style={{ background: 'rgb(var(--ink)/0.06)' }}>
          {night.cover_url && <img src={night.cover_url} alt="" className="h-full w-full object-cover" loading="lazy" />}
        </div>
        <div className="min-w-0">
          <p className="line-clamp-2 break-words" style={{ color: KIT.T1, fontSize: 13.5, fontWeight: 600, lineHeight: 1.3 }}>{night.title}</p>
          <p className="flex flex-wrap items-center gap-x-2" style={{ color: KIT.T3, fontSize: 12 }}>
            <span className="inline-block whitespace-nowrap first-letter:uppercase">{date}</span>
            {pill && <span className="rounded-full px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: night.cancelled ? KIT.T2 : KIT.RED, border: `1px solid ${KIT.BORDER}` }}>{pill}</span>}
            {night.buyers != null && night.buyers > 0 && (
              <span>
                {t('crm.night.buyers').replace('{n}', n(night.buyers))}
                {night.new_buyers != null && <> · {t('crm.night.newBuyers').replace('{n}', n(night.new_buyers))}</>}
              </span>
            )}
            {upcoming && (night.tickets_today ?? 0) > 0 && <TodayDelta value={night.tickets_today ?? 0} size={11} />}
          </p>
        </div>
      </Link>
      <div className="shrink-0 text-right">
        <p className="tabular-nums" style={{ color: KIT.T1, fontSize: 13.5, fontWeight: 600 }}>
          {t('crm.night.tickets').replace('{n}', n(night.tickets ?? 0))}
        </p>
        {night.revenue != null && (
          <p className="whitespace-nowrap tabular-nums" style={{ color: KIT.T3, fontSize: 12 }}>{eur(night.revenue)}</p>
        )}
      </div>
      {upcoming && !night.cancelled && (
        <Link to={`${base}/campaigns/new?event=${night.event_id}`} title={t('crm.night.write')} aria-label={t('crm.night.write')}
          className="shrink-0 rounded-lg p-2" style={{ color: KIT.T2, border: `1px solid ${KIT.BORDER}` }}>
          <Mail className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}
