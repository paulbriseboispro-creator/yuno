import { useEffect, useState } from 'react';
import { BarChart3, Building2, ExternalLink, Link2, Megaphone, Users } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { OrgCard, RED, T1, T2, T3, BORDER, INNER_BG, F_BORDER } from '@/components/org-ui';
import { CollabEventSubPage } from '@/components/collab/CollabEventSubPage';
import { CollabAudienceOverlap } from '@/components/collab/CollabAudienceOverlap';
import { AnalyticsLoading, CoverageNote, FillBar, MetricHint } from '@/components/analytics/kit';
import { useNumberFormat } from '@/components/analytics/kitFormat';
import { eventReportHref } from '@/lib/analyticsNav';
import { collabToolHref, type CollabSide } from '@/lib/collabTrail';
import {
  attributionCoverage, fetchPartyBreakdown, shareOf,
  type PartyBreakdown, type PartyFigures,
} from '@/lib/collabPartyBreakdown';

/**
 * « Qui fait vendre ? » — `/owner/collab/event/:id/partners` et
 * `/organizer-app/events/:id/partners`. Ce que chaque partie de la soirée apporte
 * (une RPC, `get_collab_party_breakdown`), en colonnes fixes ; puis l'audience
 * partagée. Tout ce qui n'est pas propre à la collaboration (qui est venu,
 * sources, évolution) vit dans le rapport de soirée d'Analytics : un lien y mène,
 * on ne le recopie pas ici.
 */
export default function CollabEventPartners() {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es: string) => translate(language, fr, en, es);
  return (
    <CollabEventSubPage
      title={t('Qui fait vendre ?', 'Who drives sales?', '¿Quién hace vender?')}
      question={t('Qui fait vendre cette soirée ?', 'Who is selling this event?', '¿Quién vende este evento?')}
      sub={t(
        'Ce que chaque partenaire apporte. Une vente revient à celui dont le lien, le promoteur ou la part de guest list l’a amenée.',
        'What each partner brings. A sale goes to whoever’s link, promoter or guest list share brought it in.',
        'Lo que aporta cada socio. Una venta es de quien la trajo con su enlace, su promotor o su parte de guest list.',
      )}
    >
      {(event, side) => <PartnersBody eventId={event.id} eventTitle={event.title} side={side} />}
    </CollabEventSubPage>
  );
}

function PartnersBody({ eventId, eventTitle, side }: { eventId: string; eventTitle: string; side: CollabSide }) {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es: string) => translate(language, fr, en, es);
  const { n, eur } = useNumberFormat();
  const [data, setData] = useState<PartyBreakdown | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchPartyBreakdown(eventId)
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [eventId]);

  const base = side === 'venue' ? '/owner' : '/organizer-app';
  const reportHref = collabToolHref(eventReportHref(`${base}/analytics`, eventId), { eventId, title: eventTitle, tool: 'analytics' });
  const linksHref = collabToolHref(`${base}/coorg/${eventId}`, { eventId, title: eventTitle, tool: 'coorg' });

  if (error || (data && !data.ok)) {
    return <OrgCard><p className="p-8 text-center" style={{ color: T3, fontSize: 13 }}>{t('Ces chiffres ne sont pas disponibles pour ce compte.', 'These figures are not available for this account.', 'Estas cifras no están disponibles para esta cuenta.')}</p></OrgCard>;
  }
  if (!data) return <AnalyticsLoading rows={2} />;

  const coverage = attributionCoverage(data);
  const money = data.money;
  const cols = money ? 'minmax(180px,1.6fr) minmax(120px,1.1fr) repeat(5,minmax(64px,0.6fr)) minmax(90px,0.8fr)' : 'minmax(180px,1.6fr) minmax(120px,1.1fr) repeat(5,minmax(64px,0.6fr))';
  const head = [
    t('Clics', 'Clicks', 'Clics'), t('Billets', 'Tickets', 'Entradas'), t('Tables', 'Tables', 'Mesas'),
    t('Guest list', 'Guest list', 'Guest list'), t('Entrées', 'Entries', 'Accesos'),
    ...(money ? [t('CA', 'Revenue', 'Ingresos')] : []),
  ];
  const cells = (f: PartyFigures, clicks: number | null) => [
    clicks === null ? '—' : n(clicks),
    n(f.tickets),
    f.tables ? `${n(f.tables)} · ${n(f.table_guests)} ${t('pers.', 'ppl', 'pers.')}` : '0',
    n(f.guests),
    n(f.entered),
    ...(money ? [f.revenue == null ? '—' : eur(f.revenue)] : []),
  ];
  const Row = ({ label, icon, f, clicks, mine, muted, strong }: {
    label: string; icon: React.ReactNode; f: PartyFigures; clicks: number | null; mine?: boolean; muted?: boolean; strong?: boolean;
  }) => {
    const share = shareOf(f, data.totals);
    return (
      <div className="grid items-center gap-3 px-4 py-3" style={{ gridTemplateColumns: cols, borderTop: `1px solid ${F_BORDER}`, opacity: muted ? 0.7 : 1, background: mine ? 'rgba(232,25,44,0.05)' : undefined }}>
        <div className="flex min-w-0 items-center gap-2.5">
          {icon}
          <span className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: strong ? 700 : 600 }}>{label}</span>
          {mine && <span className="flex-none rounded-full px-2 py-0.5" style={{ background: 'rgba(232,25,44,0.12)', color: RED, fontSize: 10.5, fontWeight: 650 }}>{t('toi', 'you', 'tú')}</span>}
        </div>
        <div className="flex items-center gap-2">
          {strong ? <span style={{ color: T3, fontSize: 12 }}>100 %</span> : (
            <>
              <div className="flex-1"><FillBar pct={share} /></div>
              <span className="w-10 text-right tabular-nums" style={{ color: T2, fontSize: 12 }}>{share === null ? '—' : `${share} %`}</span>
            </>
          )}
        </div>
        {cells(f, clicks).map((c, i) => (
          <span key={i} className="text-right tabular-nums" style={{ color: strong ? T1 : T2, fontSize: 13, fontWeight: strong ? 700 : 500 }}>{c}</span>
        ))}
      </div>
    );
  };

  const avatar = (url: string | null, kind: 'venue' | 'org') => url
    ? <img src={url} alt="" className="h-7 w-7 flex-none rounded-full object-cover" style={{ border: `1px solid ${BORDER}` }} />
    : <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full" style={{ background: INNER_BG }}>
        {kind === 'venue' ? <Building2 className="h-3.5 w-3.5" style={{ color: T3 }} /> : <Megaphone className="h-3.5 w-3.5" style={{ color: T3 }} />}
      </span>;

  const hasUnattributed = coverage.total > coverage.known;

  return (
    <div className="space-y-5">
      <OrgCard className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
          <h2 className="flex items-center gap-2" style={{ color: T1, fontSize: 15, fontWeight: 650 }}>
            {t('Ce que chacun apporte', 'What each partner brings', 'Lo que aporta cada uno')}
            <MetricHint text={t(
              'Une vente compte pour la partie dont le lien suivi (ou un de ses promoteurs) l’a amenée, sinon pour celle dont la part de guest list l’a reçue. Le public = billets + convives de table + inscrits guest list, remboursements exclus.',
              'A sale counts for the party whose tracked link (or one of its promoters) brought it, otherwise for the party whose guest list share received it. Audience = tickets + table guests + guest list sign-ups, refunds excluded.',
              'Una venta cuenta para la parte cuyo enlace (o uno de sus promotores) la trajo; si no, para la parte cuya guest list la recibió. Público = entradas + invitados de mesa + inscritos, sin reembolsos.',
            )} />
          </h2>
          <CoverageNote known={coverage.known} total={coverage.total} unit={t('personnes rattachées à un partenaire', 'people credited to a partner', 'personas atribuidas a un socio')} />
        </div>
        <div className="mt-3 overflow-x-auto">
          <div style={{ minWidth: money ? 860 : 760 }}>
            <div className="grid gap-3 px-4 pb-2" style={{ gridTemplateColumns: cols }}>
              <span style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{t('Partie', 'Party', 'Parte')}</span>
              <span style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{t('Part du public', 'Share of crowd', 'Parte del público')}</span>
              {head.map((h) => (
                <span key={h} className="text-right" style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{h}</span>
              ))}
            </div>
            {data.parties.map((p) => (
              <Row key={p.party} label={p.name} icon={avatar(p.avatar_url, p.kind)} f={p} clicks={p.clicks} mine={p.mine} />
            ))}
            {hasUnattributed && (
              <Row label={t('Sans partenaire identifié', 'No partner identified', 'Sin socio identificado')}
                icon={<span className="flex h-7 w-7 flex-none items-center justify-center rounded-full" style={{ background: INNER_BG }}><Users className="h-3.5 w-3.5" style={{ color: T3 }} /></span>}
                f={data.unattributed} clicks={null} muted />
            )}
            <Row label={t('Total de la soirée', 'Event total', 'Total del evento')} icon={<span className="h-7 w-7 flex-none" />}
              f={data.totals} clicks={data.parties.reduce((s, p) => s + p.clicks, 0)} strong />
          </div>
        </div>
        {hasUnattributed && (
          <div className="m-4 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
            <p style={{ color: T2, fontSize: 12.5, lineHeight: 1.5 }}>
              {t(
                'Une vente passée par le lien général de la soirée ne revient à personne. Pour que tes ventes te soient attribuées, partage TON lien de vente.',
                'A sale made through the event’s general link is credited to no one. To get your sales credited, share YOUR sales link.',
                'Una venta hecha con el enlace general del evento no se atribuye a nadie. Para que tus ventas cuenten, comparte TU enlace de venta.',
              )}
            </p>
            <a href={linksHref} target="_blank" rel="noopener" className="inline-flex flex-none items-center gap-1.5 rounded-lg px-3 py-1.5"
              style={{ background: RED, color: '#fff', fontSize: 12.5, fontWeight: 650, textDecoration: 'none' }}>
              <Link2 className="h-3.5 w-3.5" /> {t('Mon lien de vente', 'My sales link', 'Mi enlace de venta')}
            </a>
          </div>
        )}
      </OrgCard>

      <section className="space-y-3">
        <div>
          <h2 style={{ color: T1, fontSize: 15, fontWeight: 650 }}>{t('Audience partagée', 'Shared audience', 'Audiencia compartida')}</h2>
          <p className="mt-0.5" style={{ color: T3, fontSize: 12.5 }}>
            {t('Les abonnés que vous avez en commun, et ceux que la collaboration fait découvrir à chacun.', 'The followers you share, and those the collaboration introduces to each side.', 'Los seguidores que compartís y los que la colaboración aporta a cada uno.')}
          </p>
        </div>
        <CollabAudienceOverlap eventId={eventId} />
      </section>

      <a href={reportHref} target="_blank" rel="noopener"
        className="flex items-center gap-3 rounded-2xl p-4 transition-all duration-150 hover:bg-[rgb(var(--ink)/0.04)]"
        style={{ background: INNER_BG, border: `1px solid ${BORDER}`, textDecoration: 'none' }}>
        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl" style={{ background: 'rgba(232,25,44,0.10)', border: '1px solid rgba(232,25,44,0.22)' }}>
          <BarChart3 className="h-4 w-4" style={{ color: RED }} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block" style={{ color: T1, fontSize: 14, fontWeight: 650 }}>{t('Le rapport complet de la soirée', 'The full event report', 'El informe completo del evento')}</span>
          <span className="mt-0.5 block" style={{ color: T3, fontSize: 12 }}>{t('Ventes, évolution, trafic, qui est venu, ce qui a fait vendre — dans Analytics.', 'Sales, trend, traffic, who came, what drove sales — in Analytics.', 'Ventas, evolución, tráfico, quién vino, qué hizo vender — en Analytics.')}</span>
        </span>
        <ExternalLink className="h-4 w-4 flex-none" style={{ color: T3 }} />
      </a>
    </div>
  );
}
