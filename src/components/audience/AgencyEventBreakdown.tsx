import { useEffect, useState } from 'react';
import { CalendarDays, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { PCard, ZoneHeading, BarRow, T3 } from './audience-ui';

/**
 * « Par soirée » : la ventilation demandée pour les RP. Pour chaque soirée
 * rattachée à l'agence (par contrat actif, fenêtre -90j / +120j), combien de SES
 * abonnés ont acheté et le taux de conversion sur l'audience. Alimenté par la RPC
 * get_agency_event_breakdown (SECURITY DEFINER, gardée can_read_audience).
 */
type EventRow = {
  event_id: string;
  title: string;
  start_at: string;
  venue_name: string | null;
  buyers: number;
  conversion: number;
};

export function AgencyEventBreakdown({ agencyId }: { agencyId: string }) {
  const { language } = useLanguage();
  const t = (frr: string, en: string, esr: string) => (language === 'fr' ? frr : language === 'es' ? esr : en);
  const locale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  const [rows, setRows] = useState<EventRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!agencyId) return;
    let active = true;
    (async () => {
      setLoading(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase.rpc as any)('get_agency_event_breakdown', { p_agency_id: agencyId });
      if (!active) return;
      const d = data as { ok?: boolean; events?: EventRow[] } | null;
      setRows(d?.ok ? (d.events ?? []) : []);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [agencyId]);

  if (loading) {
    return (
      <>
        <ZoneHeading icon={<CalendarDays className="w-4 h-4" />} label={t('Par soirée', 'Per event', 'Por evento')} />
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" style={{ color: T3 }} /></div>
      </>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <>
        <ZoneHeading icon={<CalendarDays className="w-4 h-4" />} label={t('Par soirée', 'Per event', 'Por evento')} />
        <PCard icon={<CalendarDays className="w-4 h-4" />}
          title={t('Aucune soirée à afficher', 'No events to show', 'Sin eventos que mostrar')}>
          <p className="text-sm" style={{ color: T3 }}>
            {t(
              'Dès qu\'une soirée d\'un club sous contrat approche, tu verras ici combien de tes abonnés y achètent.',
              'As soon as an event from a club under contract comes up, you\'ll see how many of your subscribers buy for it here.',
              'En cuanto se acerque un evento de un club con contrato, verás aquí cuántos de tus suscriptores compran.',
            )}
          </p>
        </PCard>
      </>
    );
  }

  const maxConv = Math.max(1, ...rows.map(r => r.conversion));

  return (
    <>
      <ZoneHeading icon={<CalendarDays className="w-4 h-4" />} label={t('Par soirée', 'Per event', 'Por evento')} />
      <PCard icon={<CalendarDays className="w-4 h-4" />}
        title={t('Conversion des abonnés par soirée', 'Subscriber conversion per event', 'Conversión de suscriptores por evento')}
        sub={t('Part de tes abonnés qui achètent (billet ou table) pour chaque soirée',
               'Share of your subscribers who buy (ticket or table) for each event',
               'Parte de tus suscriptores que compran (entrada o mesa) por evento')}>
        <div className="space-y-3.5">
          {rows.map(r => {
            const dateLabel = (() => {
              try { return format(new Date(r.start_at), 'dd MMM', { locale }); } catch { return ''; }
            })();
            const sub = [
              t(`${r.buyers} abonné·es`, `${r.buyers} subscribers`, `${r.buyers} suscriptores`),
              [r.venue_name, dateLabel].filter(Boolean).join(' · '),
            ].filter(Boolean).join(' · ');
            return (
              <BarRow
                key={r.event_id}
                label={r.title}
                value={r.conversion}
                sub={`${r.conversion}% · ${sub}`}
                max={maxConv}
                accent={r.conversion >= maxConv && r.conversion > 0}
              />
            );
          })}
        </div>
      </PCard>
    </>
  );
}
