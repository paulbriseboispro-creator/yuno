import { useMemo, type ReactNode } from 'react';
import {
  Users, TrendingUp, Bell, BellOff, Cake, MapPin, Music, Heart, Star,
  Languages as LangIcon, Loader2, BarChart3, Euro, Clock, Zap, Sparkles,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAudienceData, type AudienceSubject } from './useAudienceData';
import {
  PCard, ZoneHeading, Kpi, BarRow, SplitBar, Coverage, MiniLine,
  RED, POS, T1, T2, T3,
} from './audience-ui';

const langLabel = (code: string) => ({ fr: 'Français', en: 'English', es: 'Español' } as Record<string, string>)[code] || code;
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
const eur = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} €`;

export function AudienceDashboard({ subject, subjectLabel, actions }: {
  subject: AudienceSubject; subjectLabel?: string; actions?: ReactNode;
}) {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es: string) => (language === 'fr' ? fr : language === 'es' ? es : en);
  const { data, loading } = useAudienceData(subject);

  const a = data?.analytics ?? null;
  const g = data?.growth ?? null;
  const seg = data?.segments ?? null;
  const notif = data?.notifications ?? null;
  const rev = data?.revenue ?? null;

  // ── Courbe : série nette (snapshots) sinon brut mensuel (analytics.growth) ──
  const growthSeries = useMemo(() => {
    if (g?.series?.length && g.series.length >= 2) {
      return { pts: g.series.map(s => ({ label: s.date.slice(5), value: s.total })), boundary: undefined as number | undefined, net: true };
    }
    if (a?.growth?.length && a.growth.length >= 2) {
      let run = 0;
      const pts = a.growth.map(m => { run += m.count; return { label: m.month.slice(2), value: run }; });
      return { pts, boundary: undefined, net: false };
    }
    return null;
  }, [g, a]);

  const dowLabel = (d: number | null) => {
    if (d == null) return null;
    const days = [
      t('Dim', 'Sun', 'Dom'), t('Lun', 'Mon', 'Lun'), t('Mar', 'Tue', 'Mar'), t('Mer', 'Wed', 'Mié'),
      t('Jeu', 'Thu', 'Jue'), t('Ven', 'Fri', 'Vie'), t('Sam', 'Sat', 'Sáb'),
    ];
    return days[d] ?? null;
  };

  const genderSegments = useMemo(() => {
    if (!a?.gender?.length) return [];
    const b = new Map<string, { label: string; count: number; color: string }>();
    const add = (k: string, label: string, color: string, c: number) => {
      const cur = b.get(k); if (cur) cur.count += c; else b.set(k, { label, count: c, color });
    };
    for (const gg of a.gender) {
      const l = (gg.label || '').toLowerCase();
      if (['male', 'm', 'homme', 'hombre', 'man', 'h'].includes(l)) add('m', t('Hommes', 'Men', 'Hombres'), '#60A5FA', gg.count);
      else if (['female', 'f', 'femme', 'mujer', 'woman'].includes(l)) add('f', t('Femmes', 'Women', 'Mujeres'), RED, gg.count);
      else add('o', t('Autre', 'Other', 'Otro'), 'rgba(255,255,255,0.35)', gg.count);
    }
    return [...b.values()].sort((x, y) => y.count - x.count);
  }, [a, language]);

  if (loading) {
    return (
      <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin" style={{ color: T3 }} /></div>
    );
  }

  const empty = !a || a.total === 0;
  const reachPct = a ? pct(a.reachable, a.total) : 0;
  const ageMax = a?.age_buckets.length ? Math.max(...a.age_buckets.map(b => b.count)) : 0;

  return (
    <div className="space-y-1">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] sm:text-[26px] font-[680] tracking-tight" style={{ color: T1 }}>
            {t('Audience', 'Audience', 'Audiencia')}
          </h1>
          <p className="text-[13px] mt-1" style={{ color: T3 }}>
            {subjectLabel
              ? t(`Tes abonnés — ${subjectLabel}`, `Your subscribers — ${subjectLabel}`, `Tus suscriptores — ${subjectLabel}`)
              : t('Tes abonnés, ta croissance, ta portée', 'Your subscribers, growth and reach', 'Tus suscriptores, crecimiento y alcance')}
          </p>
        </div>
        {actions && <div className="flex-none">{actions}</div>}
      </div>

      {empty ? (
        <PCard style={{ marginTop: 20 }} icon={<Users className="w-4 h-4" />}
          title={t('Pas encore d\'abonnés', 'No subscribers yet', 'Sin suscriptores todavía')}>
          <p className="text-sm" style={{ color: T3 }}>
            {t(
              'Partage ta page publique pour que le public s\'abonne. Dès le premier abonné, ses statistiques agrégées et anonymes apparaissent ici : démographie, croissance, portée des notifications et revenu généré.',
              'Share your public page so people subscribe. From the first subscriber, their aggregated anonymous stats appear here: demographics, growth, notification reach and revenue generated.',
              'Comparte tu página pública para que la gente se suscriba. Desde el primer suscriptor, sus estadísticas agregadas y anónimas aparecen aquí: demografía, crecimiento, alcance de notificaciones e ingresos generados.',
            )}
          </p>
        </PCard>
      ) : a && (
        <>
          {/* ── KPI ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
            <Kpi icon={<Users className="w-4 h-4" />} label={t('Abonnés', 'Subscribers', 'Suscriptores')} value={a.total.toLocaleString('fr-FR')} delay={0} />
            <Kpi icon={<TrendingUp className="w-4 h-4" />} label={t('30 derniers jours', 'Last 30 days', 'Últimos 30 días')}
              value={`+${a.recent_30d}`} tone={a.recent_30d > 0 ? POS : T1} sub={t('nouveaux abonnés', 'new subscribers', 'nuevos')} delay={0.04} />
            <Kpi icon={<Bell className="w-4 h-4" />} label={t('Joignables', 'Reachable', 'Localizables')}
              value={`${reachPct}%`} tone={reachPct >= 60 ? POS : reachPct >= 30 ? T1 : RED}
              sub={t(`${a.reachable} avec notifs`, `${a.reachable} push-enabled`, `${a.reachable} con push`)} delay={0.08} />
            {rev?.supported && rev.followers ? (
              <Kpi icon={<Euro className="w-4 h-4" />} label={t('Revenu abonnés (90j)', 'Subscriber revenue (90d)', 'Ingresos abonados (90d)')}
                value={eur(rev.followers.net)} tone={POS}
                sub={t(`${rev.follower_share ?? 0}% du total`, `${rev.follower_share ?? 0}% of total`, `${rev.follower_share ?? 0}% del total`)} delay={0.12} />
            ) : (
              <Kpi icon={<Star className="w-4 h-4" />} label={t('Superfans', 'Superfans', 'Superfans')}
                value={String(a.notify_all)} tone={a.notify_all > 0 ? RED : T1}
                sub={t('notifs cross-ville', 'cross-city alerts', 'alertas multi-ciudad')} delay={0.12} />
            )}
          </div>

          {/* ── CROISSANCE ── */}
          <ZoneHeading icon={<TrendingUp className="w-4 h-4" />} label={t('Croissance', 'Growth', 'Crecimiento')} />
          <PCard icon={<TrendingUp className="w-4 h-4" />}
            title={t('Évolution des abonnés', 'Subscriber evolution', 'Evolución de suscriptores')}
            sub={growthSeries?.net
              ? t('Total net dans le temps', 'Net total over time', 'Total neto en el tiempo')
              : t('Cumul des abonnements (historique brut)', 'Cumulative follows (raw history)', 'Suscripciones acumuladas (histórico bruto)')}>
            {growthSeries ? (
              <>
                <MiniLine series={growthSeries.pts} boundaryIndex={growthSeries.boundary} />
                {!growthSeries.net && (
                  <p className="text-[11px] mt-2" style={{ color: T3 }}>
                    {t('Le suivi net (avec désabonnements) démarre avec la capture — la courbe s\'affine chaque jour.',
                      'Net tracking (with unfollows) starts with capture — the curve refines daily.',
                      'El seguimiento neto (con bajas) empieza con la captura — la curva se afina cada día.')}
                  </p>
                )}
              </>
            ) : <p className="text-sm" style={{ color: T3 }}>{t('Pas encore assez de données.', 'Not enough data yet.', 'Aún no hay datos suficientes.')}</p>}
          </PCard>

          {/* ── PORTÉE & NOTIFICATIONS ── */}
          <ZoneHeading icon={<Bell className="w-4 h-4" />} label={t('Portée & notifications', 'Reach & notifications', 'Alcance y notificaciones')} />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <PCard icon={<Bell className="w-4 h-4" />} title={t('Portée push', 'Push reach', 'Alcance push')}>
              <div className="text-[30px] font-[680] tabular-nums" style={{ color: reachPct >= 60 ? POS : RED }}>{reachPct}%</div>
              <p className="text-[12px] mt-1" style={{ color: T3 }}>
                {t(`${a.reachable} sur ${a.total} abonnés peuvent recevoir une notif`,
                   `${a.reachable} of ${a.total} subscribers can get a push`,
                   `${a.reachable} de ${a.total} suscriptores pueden recibir push`)}
              </p>
              {a.total - a.reachable > 0 && (
                <div className="flex items-center gap-1.5 mt-3 text-[11.5px]" style={{ color: T3 }}>
                  <BellOff className="w-3.5 h-3.5 flex-none" />
                  <span>{t(`${a.total - a.reachable} ont coupé les notifs`, `${a.total - a.reachable} opted out`, `${a.total - a.reachable} sin push`)}</span>
                </div>
              )}
            </PCard>

            <PCard icon={<Clock className="w-4 h-4" />} title={t('Meilleur créneau', 'Best send time', 'Mejor momento')}>
              {notif?.best_send?.hour != null ? (
                <>
                  <div className="text-[24px] font-[680]" style={{ color: T1 }}>
                    {dowLabel(notif.best_send.dow) ?? '—'} {notif.best_send.hour}h
                  </div>
                  <p className="text-[12px] mt-1" style={{ color: T3 }}>
                    {t('Quand ton audience est la plus active', 'When your audience is most active', 'Cuando tu audiencia está más activa')}
                  </p>
                </>
              ) : <p className="text-sm" style={{ color: T3 }}>{t('Signal insuffisant.', 'Not enough signal.', 'Señal insuficiente.')}</p>}
            </PCard>

            <PCard icon={<Zap className="w-4 h-4" />} title={t('Engagement notifs (30j)', 'Push engagement (30d)', 'Interacción push (30d)')}>
              {notif?.push_30d && notif.push_30d.sent > 0 ? (
                <>
                  <div className="text-[24px] font-[680] tabular-nums" style={{ color: T1 }}>{notif.push_30d.ctr}%</div>
                  <p className="text-[12px] mt-1" style={{ color: T3 }}>
                    {t(`${notif.push_30d.clicked} clics / ${notif.push_30d.sent} envois`,
                       `${notif.push_30d.clicked} clicks / ${notif.push_30d.sent} sent`,
                       `${notif.push_30d.clicked} clics / ${notif.push_30d.sent} envíos`)}
                  </p>
                </>
              ) : <p className="text-sm" style={{ color: T3 }}>{t('Aucune notif envoyée récemment.', 'No pushes sent recently.', 'Sin envíos recientes.')}</p>}
            </PCard>
          </div>

          {notif?.campaigns && notif.campaigns.length > 0 && (
            <PCard style={{ marginTop: 12 }} icon={<Bell className="w-4 h-4" />}
              title={t('Campagnes récentes', 'Recent campaigns', 'Campañas recientes')}
              sub={t('Taux de clic par campagne', 'Click rate per campaign', 'Tasa de clic por campaña')}>
              <div className="space-y-3">
                {notif.campaigns.map(c => (
                  <div key={c.id} className="flex items-center justify-between gap-3">
                    <span className="text-[13px] truncate" style={{ color: T1 }}>{c.title || '—'}</span>
                    <div className="flex items-center gap-4 flex-none text-[12px] tabular-nums" style={{ color: T3 }}>
                      <span>{c.sent} {t('envois', 'sent', 'envíos')}</span>
                      <span style={{ color: c.ctr >= 10 ? POS : T2 }}>{c.ctr}% CTR</span>
                    </div>
                  </div>
                ))}
              </div>
            </PCard>
          )}

          {/* ── DÉMOGRAPHIE ── */}
          <ZoneHeading icon={<Users className="w-4 h-4" />} label={t('Démographie', 'Demographics', 'Demografía')} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <PCard icon={<Cake className="w-4 h-4" />} title={t('Âge', 'Age', 'Edad')}>
              {a.age_buckets.length ? (
                <>
                  <div className="space-y-3.5">
                    {a.age_buckets.map(b => <BarRow key={b.bucket} label={b.bucket} value={b.count} max={ageMax} accent={b.count === ageMax} />)}
                  </div>
                  <Coverage known={a.age_known} total={a.total} label={t('Âge renseigné', 'Age known', 'Edad conocida')} />
                </>
              ) : <p className="text-sm" style={{ color: T3 }}>{t('Pas encore renseigné.', 'Not set yet.', 'Aún sin datos.')}</p>}
            </PCard>
            <PCard icon={<Users className="w-4 h-4" />} title={t('Sexe', 'Gender', 'Sexo')}>
              {genderSegments.length ? (
                <>
                  <SplitBar segments={genderSegments} />
                  <Coverage known={a.gender_known} total={a.total} label={t('Estimé via guest lists', 'Estimated via guest lists', 'Estimado vía guest lists')} />
                </>
              ) : <p className="text-sm" style={{ color: T3 }}>{t('Pas encore de signal.', 'No signal yet.', 'Sin señal todavía.')}</p>}
            </PCard>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
            <PCard icon={<MapPin className="w-4 h-4" />} title={t('Villes', 'Cities', 'Ciudades')}>
              {a.cities.length ? (
                <div className="space-y-3.5">
                  {a.cities.map((c, i) => <BarRow key={c.city} label={c.city} value={c.count} max={a.cities[0].count} accent={i === 0} />)}
                </div>
              ) : <p className="text-sm" style={{ color: T3 }}>{t('Pas encore renseigné.', 'Not set yet.', 'Aún sin datos.')}</p>}
            </PCard>
            <PCard icon={<LangIcon className="w-4 h-4" />} title={t('Langues', 'Languages', 'Idiomas')}>
              {a.languages.length ? (
                <div className="space-y-3.5">
                  {a.languages.map((l, i) => <BarRow key={l.lang} label={langLabel(l.lang)} value={l.count} max={a.languages[0].count} accent={i === 0} />)}
                </div>
              ) : <p className="text-sm" style={{ color: T3 }}>{t('Aucune donnée.', 'No data.', 'Sin datos.')}</p>}
            </PCard>
          </div>
          {(a.music.length > 0 || a.personas.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
              <PCard icon={<Music className="w-4 h-4" />} title={t('Goûts musicaux', 'Music taste', 'Gustos musicales')}>
                {a.music.length ? (
                  <div className="space-y-3.5">
                    {a.music.map((m, i) => <BarRow key={m.style} label={m.style} value={m.count} max={a.music[0].count} accent={i === 0} />)}
                  </div>
                ) : <p className="text-sm" style={{ color: T3 }}>{t('Pas de données.', 'No data.', 'Sin datos.')}</p>}
              </PCard>
              <PCard icon={<Heart className="w-4 h-4" />} title={t('Profil de fête', 'Party persona', 'Perfil de fiesta')}>
                {a.personas.length ? (
                  <div className="space-y-3.5">
                    {a.personas.map((p, i) => <BarRow key={p.persona} label={p.persona} value={p.count} max={a.personas[0].count} accent={i === 0} />)}
                  </div>
                ) : <p className="text-sm" style={{ color: T3 }}>{t('Pas de données.', 'No data.', 'Sin datos.')}</p>}
              </PCard>
            </div>
          )}

          {/* ── SEGMENTATION ── */}
          {seg && (
            <>
              <ZoneHeading icon={<BarChart3 className="w-4 h-4" />} label={t('Segmentation', 'Segmentation', 'Segmentación')} />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <PCard icon={<Zap className="w-4 h-4" />} title={t('Engagement', 'Engagement', 'Interacción')}
                  sub={t('Qui interagit avec tes notifs', 'Who engages with your pushes', 'Quién interactúa con tus push')}>
                  <SplitBar segments={[
                    { label: t('Engagés', 'Engaged', 'Activos'), count: seg.engagement.engaged, color: POS },
                    { label: t('Passifs', 'Passive', 'Pasivos'), count: seg.engagement.passive, color: 'rgba(255,255,255,0.45)' },
                    { label: t('Injoignables', 'Unreachable', 'Sin push'), count: seg.engagement.unreachable, color: 'rgba(255,92,99,0.65)' },
                  ]} />
                </PCard>
                <PCard icon={<Sparkles className="w-4 h-4" />} title={t('Ancienneté', 'Cohort', 'Antigüedad')}>
                  <SplitBar segments={[
                    { label: t('Nouveaux (30j)', 'New (30d)', 'Nuevos (30d)'), count: seg.cohort.new_30d, color: RED },
                    { label: t('Établis', 'Established', 'Establecidos'), count: seg.cohort.established, color: 'rgba(255,255,255,0.45)' },
                  ]} />
                </PCard>
              </div>
              {subject.type === 'venue' && seg.converted != null && (
                <PCard style={{ marginTop: 12 }} icon={<Euro className="w-4 h-4" />}
                  title={t('Abonnés clients', 'Subscribers who bought', 'Suscriptores que compraron')}
                  sub={t(`${seg.converted} de tes abonnés ont acheté chez toi`, `${seg.converted} of your subscribers bought from you`, `${seg.converted} de tus suscriptores compraron`)}>
                  {seg.spend_tiers && seg.spend_tiers.length > 0 ? (
                    <div className="space-y-3.5">
                      {seg.spend_tiers.map(s => (
                        <BarRow key={s.tier} label={s.tier} value={s.count}
                          sub={`${s.count} · ${eur(s.revenue)}`}
                          max={Math.max(...seg.spend_tiers!.map(x => x.count))} accent={s.tier === 'gold'} />
                      ))}
                    </div>
                  ) : <p className="text-sm" style={{ color: T3 }}>{t('Aucun abonné n\'a encore acheté.', 'No subscriber has purchased yet.', 'Ningún suscriptor ha comprado aún.')}</p>}
                  {seg.recency && (
                    <div className="grid grid-cols-3 gap-2 mt-4 text-center">
                      {[
                        { k: t('Actifs', 'Active', 'Activos'), v: seg.recency.active, c: POS },
                        { k: t('À risque', 'At risk', 'En riesgo'), v: seg.recency.at_risk, c: '#FBBF24' },
                        { k: t('Perdus', 'Lapsed', 'Perdidos'), v: seg.recency.lapsed, c: RED },
                      ].map(x => (
                        <div key={x.k}>
                          <div className="text-[20px] font-[680] tabular-nums" style={{ color: x.c }}>{x.v}</div>
                          <div className="text-[11px]" style={{ color: T3 }}>{x.k}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </PCard>
              )}
            </>
          )}

          {/* ── REVENU ── */}
          <ZoneHeading icon={<Euro className="w-4 h-4" />} label={t('Revenu de l\'audience', 'Audience revenue', 'Ingresos de audiencia')} />
          {rev?.supported && rev.followers && rev.non_followers ? (
            <PCard icon={<Euro className="w-4 h-4" />}
              title={t('Abonnés vs non-abonnés (90j)', 'Subscribers vs non-subscribers (90d)', 'Suscriptores vs no suscriptores (90d)')}
              sub={t('Combien de ton revenu vient de ton audience possédée', 'How much revenue comes from your owned audience', 'Cuántos ingresos vienen de tu audiencia propia')}>
              <SplitBar segments={[
                { label: t('Abonnés', 'Subscribers', 'Suscriptores'), count: Math.round(rev.followers.gross), color: RED },
                { label: t('Non-abonnés', 'Non-subscribers', 'No suscriptores'), count: Math.round(rev.non_followers.gross), color: 'rgba(255,255,255,0.4)' },
              ]} />
              <div className="grid grid-cols-2 gap-3 mt-4">
                <div>
                  <div className="text-[22px] font-[680] tabular-nums" style={{ color: POS }}>{eur(rev.followers.net)}</div>
                  <div className="text-[11.5px]" style={{ color: T3 }}>{t(`de tes abonnés · ${rev.followers.orders} ventes`, `from subscribers · ${rev.followers.orders} sales`, `de suscriptores · ${rev.followers.orders} ventas`)}</div>
                </div>
                <div>
                  <div className="text-[22px] font-[680] tabular-nums" style={{ color: T2 }}>{eur(rev.non_followers.net)}</div>
                  <div className="text-[11.5px]" style={{ color: T3 }}>{t(`des autres · ${rev.non_followers.orders} ventes`, `from others · ${rev.non_followers.orders} sales`, `de otros · ${rev.non_followers.orders} ventas`)}</div>
                </div>
              </div>
            </PCard>
          ) : (
            <PCard icon={<Euro className="w-4 h-4" />} title={t('Revenu généré', 'Revenue generated', 'Ingresos generados')}>
              <p className="text-sm" style={{ color: T3 }}>
                {subject.type === 'dj'
                  ? t('Ton revenu se mesure via tes liens de conversion — voir l\'onglet Statistiques.', 'Your revenue is tracked via your conversion links — see the Analytics tab.', 'Tus ingresos se miden vía tus enlaces de conversión — ve la pestaña Estadísticas.')
                  : t('Aucune vente sur la période.', 'No sales in the period.', 'Sin ventas en el periodo.')}
              </p>
            </PCard>
          )}
        </>
      )}
    </div>
  );
}
