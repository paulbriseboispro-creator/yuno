import { useMemo, useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { format, parse } from 'date-fns';
import { fr, enUS, es } from 'date-fns/locale';
import {
  BarChart3, MapPin, Music, TrendingUp, Users, Sparkles, Cake, Languages as LangIcon,
  Heart, Star, Loader2, Info,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDJData } from '@/contexts/DJDataContext';
import { makeDjT } from '@/i18n/djTranslate';
import { supabase } from '@/integrations/supabase/client';
import {
  DJPage, DJHeading, PCard, ZoneHeading, MonthlyBars,
  RED, POS, T1, T2, T3, C_FAINT, INNER_BG, BORDER,
} from '@/components/dj/dj-ui';

// mapbox-gl is heavy — only load it when the analytics page actually renders.
const DJAudienceMap = lazy(() => import('@/components/dj/DJAudienceMap'));

// ─── Types (RPC dj_audience_analytics → jsonb) ────────────────────────────────
interface AudienceData {
  ok: boolean;
  total: number;
  notify_all: number;
  age_known: number;
  gender_known: number;
  recent_30d: number;
  growth: { month: string; count: number }[];
  age_buckets: { bucket: string; count: number }[];
  gender: { label: string; count: number }[];
  cities: { city: string; count: number }[];
  languages: { lang: string; count: number }[];
  personas: { persona: string; count: number }[];
  music: { style: string; count: number }[];
}

// ─── Ranked / distribution bar row ─────────────────────────────────────────────
function BarRow({ label, sub, value, max, accent }: {
  label: string; sub?: string; value: number; max: number; accent?: boolean;
}) {
  const pct = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-[560] truncate capitalize" style={{ color: T1 }}>{label}</span>
        <span className="text-[13px] font-[640] tabular-nums flex-none" style={{ color: accent ? RED : T2 }}>
          {sub ?? value}
        </span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: C_FAINT }}>
        <div className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: accent ? RED : 'rgba(255,255,255,0.45)' }} />
      </div>
    </div>
  );
}

// ─── Segmented split bar (gender) ──────────────────────────────────────────────
function SplitBar({ segments }: { segments: { label: string; count: number; color: string }[] }) {
  const total = segments.reduce((a, s) => a + s.count, 0) || 1;
  return (
    <div className="space-y-3">
      <div className="flex h-3 w-full overflow-hidden rounded-full" style={{ background: C_FAINT }}>
        {segments.map(s => (
          <div key={s.label} title={s.label} style={{ width: `${(s.count / total) * 100}%`, background: s.color }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map(s => (
          <div key={s.label} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full flex-none" style={{ background: s.color }} />
            <span className="text-[12.5px]" style={{ color: T2 }}>{s.label}</span>
            <span className="text-[12.5px] font-[640] tabular-nums" style={{ color: T1 }}>
              {Math.round((s.count / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, tone, icon }: {
  label: string; value: string; sub?: string; tone?: string; icon: React.ReactNode;
}) {
  return (
    <PCard style={{ padding: 16 }}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: T3 }}>{label}</span>
        <span style={{ color: T3 }}>{icon}</span>
      </div>
      <div className="mt-2.5 text-[clamp(20px,2.6vw,26px)] font-[640] leading-none tabular-nums"
        style={{ color: tone ?? T1, letterSpacing: '-0.025em' }}>
        {value}
      </div>
      {sub && <p className="mt-1.5 text-[11px]" style={{ color: T3 }}>{sub}</p>}
    </PCard>
  );
}

function Coverage({ known, total, label }: { known: number; total: number; label: string }) {
  if (total === 0) return null;
  const pct = Math.round((known / total) * 100);
  return (
    <div className="flex items-center gap-1.5 mt-3 text-[11px]" style={{ color: T3 }}>
      <Info className="w-3 h-3 flex-none" />
      <span>{label} — {known}/{total} ({pct}%)</span>
    </div>
  );
}

export default function DJAnalytics() {
  const { language } = useLanguage();
  const tt = makeDjT(language);
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const { dj, allSets, venues } = useDJData();

  const multiVenue = venues.length > 1;
  const [aud, setAud] = useState<AudienceData | null>(null);
  const [loadingAud, setLoadingAud] = useState(true);

  const fetchAudience = useCallback(async () => {
    if (!dj?.user_id) return;
    setLoadingAud(true);
    const { data } = await supabase.rpc('dj_audience_analytics', { p_dj_user_id: dj.user_id });
    const res = data as unknown as AudienceData | null;
    setAud(res && res.ok ? res : null);
    setLoadingAud(false);
  }, [dj?.user_id]);

  useEffect(() => { fetchAudience(); }, [fetchAudience]);

  // ── Career stats (from owned gig data) ─────────────────────────────────────
  const career = useMemo(() => {
    const now = new Date();
    const upcoming = allSets.filter(s => new Date(s.start_time) >= now).length;
    const venueMap = new Map<string, number>();
    for (const s of allSets) {
      const name = s.venue?.name || tt('Lieu privé', 'Private booking', 'Reserva privada');
      venueMap.set(name, (venueMap.get(name) || 0) + 1);
    }
    const topVenues = [...venueMap.entries()].map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count).slice(0, 6);
    const monthMap = new Map<string, number>();
    [...allSets].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
      .forEach(s => {
        const m = format(new Date(s.start_time), 'MMM yy', { locale: dateLocale });
        monthMap.set(m, (monthMap.get(m) || 0) + 1);
      });
    const monthly = [...monthMap.entries()].map(([month, amount]) => ({ month, amount })).slice(-12);
    const feeSets = allSets.filter(s => s.fee > 0);
    const avgFee = feeSets.length ? Math.round(feeSets.reduce((a, s) => a + s.fee, 0) / feeSets.length) : 0;
    return { total: allSets.length, upcoming, venuesPlayed: venueMap.size, topVenues, monthly, avgFee };
  }, [allSets, dateLocale, tt]);

  // ── Derived audience views ─────────────────────────────────────────────────
  const growthData = useMemo(() => {
    if (!aud?.growth?.length) return [];
    return aud.growth.slice(-12).map(g => {
      const d = parse(g.month, 'yyyy-MM', new Date());
      return { month: format(d, 'MMM yy', { locale: dateLocale }), amount: g.count };
    });
  }, [aud, dateLocale]);

  const genderSegments = useMemo(() => {
    if (!aud?.gender?.length) return [];
    const buckets = new Map<string, { label: string; count: number; color: string }>();
    const add = (key: string, label: string, color: string, count: number) => {
      const cur = buckets.get(key);
      if (cur) cur.count += count; else buckets.set(key, { label, count, color });
    };
    for (const g of aud.gender) {
      const l = (g.label || '').toLowerCase();
      if (['male', 'm', 'homme', 'hombre', 'man', 'h'].includes(l)) add('m', tt('Hommes', 'Men', 'Hombres'), '#60A5FA', g.count);
      else if (['female', 'f', 'femme', 'mujer', 'woman'].includes(l)) add('f', tt('Femmes', 'Women', 'Mujeres'), RED, g.count);
      else add('o', tt('Autre', 'Other', 'Otro'), 'rgba(255,255,255,0.35)', g.count);
    }
    return [...buckets.values()].sort((a, b) => b.count - a.count);
  }, [aud, tt]);

  const langLabel = (code: string) => ({ fr: 'Français', en: 'English', es: 'Español' }[code] || code);

  if (!dj) return null;

  const noAudience = !loadingAud && (!aud || aud.total === 0);
  const ageMax = aud?.age_buckets.length ? Math.max(...aud.age_buckets.map(b => b.count)) : 0;

  return (
    <DJPage>
      <DJHeading
        title={tt('Statistiques', 'Analytics', 'Estadísticas')}
        subtitle={tt('Ton audience et ta carrière', 'Your audience and your career', 'Tu audiencia y tu carrera')}
      />

      {/* ════ AUDIENCE ════ */}
      <ZoneHeading icon={<Users className="w-4 h-4" />} label={tt('Ton audience', 'Your audience', 'Tu audiencia')} />

      {loadingAud ? (
        <PCard><div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" style={{ color: T3 }} /></div></PCard>
      ) : noAudience ? (
        <PCard icon={<Users className="w-4 h-4" />} title={tt('Pas encore d\'abonnés', 'No subscribers yet', 'Sin suscriptores todavía')}>
          <p className="text-sm" style={{ color: T3 }}>
            {tt(
              'Partage ta page publique et ton press kit pour que les fans s\'abonnent. Leurs données démographiques apparaîtront ici, agrégées et anonymes.',
              'Share your public page and press kit so fans subscribe. Their demographics show up here, aggregated and anonymous.',
              'Comparte tu página pública y tu press kit para que los fans se suscriban. Sus datos demográficos aparecerán aquí, agregados y anónimos.',
            )}
          </p>
        </PCard>
      ) : aud && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Kpi icon={<Users className="w-4 h-4" />} label={tt('Abonnés', 'Subscribers', 'Suscriptores')} value={String(aud.total)} />
            <Kpi icon={<TrendingUp className="w-4 h-4" />} label={tt('30 derniers j', 'Last 30 days', 'Últimos 30 d')}
              value={`+${aud.recent_30d}`} tone={aud.recent_30d > 0 ? POS : T1}
              sub={tt('nouveaux', 'new fans', 'nuevos')} />
            <Kpi icon={<Star className="w-4 h-4" />} label={tt('Superfans', 'Superfans', 'Superfans')} value={String(aud.notify_all)}
              tone={aud.notify_all > 0 ? RED : T1} sub={tt('notifs cross-ville', 'cross-city alerts', 'alertas multi-ciudad')} />
            <Kpi icon={<MapPin className="w-4 h-4" />} label={tt('Villes', 'Cities', 'Ciudades')} value={String(aud.cities.length)}
              sub={aud.cities[0]?.city} />
          </div>

          {/* Growth */}
          {growthData.length > 1 && (
            <PCard icon={<TrendingUp className="w-4 h-4" />}
              title={tt('Croissance de l\'audience', 'Audience growth', 'Crecimiento de audiencia')}
              sub={tt('Nouveaux abonnés par mois', 'New subscribers per month', 'Nuevos suscriptores por mes')}>
              <MonthlyBars data={growthData} />
            </PCard>
          )}

          {/* Age + Gender */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <PCard icon={<Cake className="w-4 h-4" />} title={tt('Âge', 'Age', 'Edad')}>
              {aud.age_buckets.length ? (
                <>
                  <div className="space-y-3.5">
                    {aud.age_buckets.map(b => (
                      <BarRow key={b.bucket} label={b.bucket} value={b.count} max={ageMax}
                        accent={b.count === ageMax} />
                    ))}
                  </div>
                  <Coverage known={aud.age_known} total={aud.total}
                    label={tt('Âge renseigné', 'Age known', 'Edad conocida')} />
                </>
              ) : (
                <p className="text-sm" style={{ color: T3 }}>{tt('Tes abonnés n\'ont pas encore renseigné leur date de naissance.', "Your fans haven't set their birth date yet.", 'Tus fans aún no indicaron su fecha de nacimiento.')}</p>
              )}
            </PCard>

            <PCard icon={<Users className="w-4 h-4" />} title={tt('Sexe', 'Gender', 'Sexo')}>
              {genderSegments.length ? (
                <>
                  <SplitBar segments={genderSegments} />
                  <Coverage known={aud.gender_known} total={aud.total}
                    label={tt('Estimé via guest lists', 'Estimated via guest lists', 'Estimado vía guest lists')} />
                </>
              ) : (
                <p className="text-sm" style={{ color: T3 }}>
                  {tt('Pas encore de signal de sexe (collecté en guest list).', 'No gender signal yet (collected at guest list).', 'Sin señal de sexo todavía (se recoge en guest list).')}
                </p>
              )}
            </PCard>
          </div>

          {/* Cities + Languages */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <PCard icon={<MapPin className="w-4 h-4" />} title={tt('Localisation', 'Location', 'Ubicación')}
              sub={tt('D\'où viennent tes abonnés', 'Where your fans come from', 'De dónde vienen tus fans')}>
              {aud.cities.length ? (
                <div className="space-y-4">
                  <Suspense fallback={<div className="h-[280px] rounded-xl animate-pulse" style={{ background: INNER_BG }} />}>
                    <DJAudienceMap cities={aud.cities} />
                  </Suspense>
                  <div className="space-y-3.5">
                    {aud.cities.map((c, i) => (
                      <BarRow key={c.city} label={c.city} value={c.count} max={aud.cities[0].count} accent={i === 0} />
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-sm" style={{ color: T3 }}>
                  {tt('Tes abonnés n\'ont pas encore renseigné leur ville.', "Your fans haven't set their city yet.", 'Tus fans aún no indicaron su ciudad.')}
                </p>
              )}
            </PCard>

            <PCard icon={<LangIcon className="w-4 h-4" />} title={tt('Langues', 'Languages', 'Idiomas')}>
              {aud.languages.length ? (
                <div className="space-y-3.5">
                  {aud.languages.map((l, i) => (
                    <BarRow key={l.lang} label={langLabel(l.lang)} value={l.count}
                      max={aud.languages[0].count} accent={i === 0} />
                  ))}
                </div>
              ) : <p className="text-sm" style={{ color: T3 }}>{tt('Aucune langue renseignée.', 'No language data.', 'Sin idiomas.')}</p>}
            </PCard>
          </div>

          {/* Music taste + Persona */}
          {(aud.music.length > 0 || aud.personas.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <PCard icon={<Music className="w-4 h-4" />} title={tt('Goûts musicaux', 'Music taste', 'Gustos musicales')}
                sub={tt('Ce que tes abonnés aiment', 'What your fans love', 'Lo que aman tus fans')}>
                {aud.music.length ? (
                  <div className="space-y-3.5">
                    {aud.music.map((m, i) => (
                      <BarRow key={m.style} label={m.style} value={m.count} max={aud.music[0].count} accent={i === 0} />
                    ))}
                  </div>
                ) : <p className="text-sm" style={{ color: T3 }}>{tt('Pas encore de données.', 'No data yet.', 'Sin datos.')}</p>}
              </PCard>

              <PCard icon={<Heart className="w-4 h-4" />} title={tt('Profil de fête', 'Party persona', 'Perfil de fiesta')}>
                {aud.personas.length ? (
                  <div className="space-y-3.5">
                    {aud.personas.map((p, i) => (
                      <BarRow key={p.persona} label={p.persona} value={p.count} max={aud.personas[0].count} accent={i === 0} />
                    ))}
                  </div>
                ) : <p className="text-sm" style={{ color: T3 }}>{tt('Pas encore de données.', 'No data yet.', 'Sin datos.')}</p>}
              </PCard>
            </div>
          )}
        </>
      )}

      {/* ════ CAREER ════ */}
      <ZoneHeading icon={<BarChart3 className="w-4 h-4" />} label={tt('Ta carrière', 'Your career', 'Tu carrera')} />

      {career.total === 0 ? (
        <PCard icon={<Sparkles className="w-4 h-4" />} title={tt('Pas encore de dates', 'No gigs yet', 'Sin fechas')}>
          <p className="text-sm" style={{ color: T3 }}>
            {tt('Tes stats de carrière apparaissent dès ta première date.', 'Career stats appear from your first gig.', 'Las estadísticas aparecen desde tu primera fecha.')}
          </p>
        </PCard>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Kpi icon={<BarChart3 className="w-4 h-4" />} label={tt('Dates totales', 'Total gigs', 'Fechas totales')} value={String(career.total)} />
            <Kpi icon={<Sparkles className="w-4 h-4" />} label={tt('À venir', 'Upcoming', 'Próximas')} value={String(career.upcoming)}
              tone={career.upcoming > 0 ? POS : T1} />
            <Kpi icon={<MapPin className="w-4 h-4" />} label={tt('Scènes', 'Venues', 'Salas')} value={String(career.venuesPlayed)} />
            <Kpi icon={<TrendingUp className="w-4 h-4" />} label={tt('Cachet moyen', 'Avg fee', 'Caché medio')} value={`${career.avgFee} €`} />
          </div>

          {career.monthly.length > 1 && (
            <PCard icon={<TrendingUp className="w-4 h-4" />}
              title={tt('Rythme de bookings', 'Booking momentum', 'Ritmo de bookings')}
              sub={multiVenue ? tt('Toutes scènes', 'All venues', 'Todas las salas') : tt('Dates par mois', 'Gigs per month', 'Fechas por mes')}>
              <MonthlyBars data={career.monthly} />
            </PCard>
          )}

          <PCard icon={<MapPin className="w-4 h-4" />} title={tt('Tes scènes', 'Where you play', 'Dónde tocas')}>
            <div className="space-y-3.5">
              {career.topVenues.map((v, i) => (
                <BarRow key={v.name} label={v.name}
                  sub={`${v.count} ${v.count > 1 ? tt('dates', 'gigs', 'fechas') : tt('date', 'gig', 'fecha')}`}
                  value={v.count} max={career.topVenues[0].count} accent={i === 0} />
              ))}
            </div>
          </PCard>
        </>
      )}
    </DJPage>
  );
}
