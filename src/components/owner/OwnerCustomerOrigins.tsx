import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { ComposableMap, Geographies, Geography } from 'react-simple-maps';
import worldTopo from 'world-atlas/countries-110m.json';
import { motion } from 'framer-motion';
import { Globe, Users, MapPin, Plane, Building2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { COUNTRY_BY_NUMERIC, countryFromPhone, getCountryName, type Country } from '@/lib/countries';

// Lazy so mapbox-gl stays out of the main bundle (only loaded when the City tab opens).
const CityGlobe = lazy(() => import('@/components/analytics/CityGlobe'));

// ─── Yuno Design Tokens (kept local — same palette as OwnerCustomers) ─────────
const RED      = '#E8192C';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const F_BORDER = 'rgba(255,255,255,0.055)';
const CARD_BG  = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const INNER_BG = 'rgba(255,255,255,0.032)';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

const OCEAN_FILL   = 'rgba(255,255,255,0.022)';   // countries with no customers
const GEO_STROKE   = 'rgba(255,255,255,0.10)';

interface OriginCustomer { phone: string | null; total_spent: number; }

interface OriginStat {
  country: Country; count: number; revenue: number;
}

interface CityStat { city: string; count: number; }
interface CityResponse { ok: boolean; total: number; city_known: number; cities: CityStat[]; }

type Scope = { kind: 'venue' | 'organizer'; id: string };

interface Props {
  customers: OriginCustomer[];
  onSelectCountry?: (code: string) => void;
  /** When set, unlocks the "By city" tab (fetches scoped city counts via RPC). */
  scope?: Scope;
}

// Interpolate from a faint red to full Yuno red based on density t∈[0,1].
function densityFill(t: number): string {
  // ease so mid values stay visible
  const e = Math.sqrt(Math.max(0, Math.min(1, t)));
  const r = Math.round(40 + e * (232 - 40));
  const g = Math.round(16 + e * (25 - 16));
  const b = Math.round(20 + e * (44 - 20));
  const a = 0.30 + e * 0.70;
  return `rgba(${r},${g},${b},${a})`;
}

export function OwnerCustomerOrigins({ customers, onSelectCountry, scope }: Props) {
  const { language } = useLanguage();
  const [view, setView] = useState<'country' | 'city'>('country');
  const [hover, setHover] = useState<{ name: string; flag: string; count: number; revenue: number; x: number; y: number } | null>(null);
  const [activeCode, setActiveCode] = useState<string | null>(null);

  // ── City data (lazy: only fetched once the City tab is opened) ──
  const [cityData, setCityData] = useState<CityResponse | null>(null);
  const [cityLoading, setCityLoading] = useState(false);
  useEffect(() => {
    if (view !== 'city' || !scope || cityData) return;
    let cancelled = false;
    (async () => {
      setCityLoading(true);
      const { data } = await supabase.rpc('event_origin_cities', {
        p_scope: scope.kind, p_scope_id: scope.id, p_event_id: null, p_from: null, p_to: null,
      });
      if (cancelled) return;
      const parsed = data as unknown as CityResponse | null;
      setCityData(parsed && parsed.ok ? parsed : { ok: true, total: 0, city_known: 0, cities: [] });
      setCityLoading(false);
    })();
    return () => { cancelled = true; };
  }, [view, scope, cityData]);

  const { stats, byNumeric, maxCount, totalKnown, unknown } = useMemo(() => {
    const map = new Map<string, OriginStat>();
    let unknown = 0;
    for (const c of customers) {
      const country = countryFromPhone(c.phone);
      if (!country) { unknown++; continue; }
      const cur = map.get(country.code) || { country, count: 0, revenue: 0 };
      cur.count += 1;
      cur.revenue += Number(c.total_spent || 0);
      map.set(country.code, cur);
    }
    const stats = [...map.values()].sort((a, b) => b.count - a.count);
    const byNumeric = new Map<number, OriginStat>();
    stats.forEach(s => byNumeric.set(s.country.isoNumeric, s));
    const maxCount = stats.length ? stats[0].count : 0;
    const totalKnown = stats.reduce((s, x) => s + x.count, 0);
    return { stats, byNumeric, maxCount, totalKnown, unknown };
  }, [customers]);

  const totalCustomers = totalKnown + unknown;
  const topCountry = stats[0];
  const coverage = totalCustomers ? Math.round((totalKnown / totalCustomers) * 100) : 0;
  const topShare = totalKnown && topCountry ? Math.round((topCountry.count / totalKnown) * 100) : 0;

  const selectCountry = (code: string) => {
    setActiveCode(code);
    onSelectCountry?.(code);
  };

  // ── City derived stats ──
  const cities = cityData?.cities ?? [];
  const cityTotalKnown = cities.reduce((s, c) => s + c.count, 0);
  const cityMax = cities.length ? cities[0].count : 0;
  const topCity = cities[0];
  const cityTopShare = cityTotalKnown && topCity ? Math.round((topCity.count / cityTotalKnown) * 100) : 0;
  const cityCoverage = cityData && cityData.total ? Math.round((cityData.city_known / cityData.total) * 100) : 0;

  return (
    <div className="mt-4 space-y-4">
      {/* Country / City toggle (only when scope is wired) */}
      {scope && (
        <div className="inline-flex p-0.5 rounded-xl" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
          {([
            { key: 'country', icon: Globe, label: 'origins.tabCountry' },
            { key: 'city', icon: Building2, label: 'origins.tabCity' },
          ] as const).map(({ key, icon: Icon, label }) => (
            <button key={key} onClick={() => setView(key)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[10px] text-[13px] font-[560] transition-all duration-150 cursor-pointer"
              style={{ background: view === key ? RED : 'transparent', color: view === key ? '#fff' : T2 }}>
              <Icon className="w-3.5 h-3.5" />
              {L(label, language)}
            </button>
          ))}
        </div>
      )}

      {view === 'country' ? (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { icon: Globe, label: 'origins.countries', value: stats.length, color: T2 },
              { icon: MapPin, label: 'origins.topCountry', value: topCountry ? `${topCountry.country.flag} ${getCountryName(topCountry.country, language)}` : '—', color: T2 },
              { icon: Users, label: 'origins.topShare', value: topCountry ? `${topShare}%` : '—', color: RED },
              { icon: Plane, label: 'origins.coverage', value: `${coverage}%`, color: T2 },
            ].map(({ icon: Icon, label, value, color }) => (
              <div key={label} className="px-4 py-3 rounded-xl" style={{ background: CARD_BG, border: `1px solid ${BORDER}`, boxShadow: CARD_SHADOW }}>
                <div className="flex items-center gap-1.5 mb-0.5">
                  <Icon className="w-3 h-3" style={{ color }} />
                  <p style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{L(label, language)}</p>
                </div>
                <p className="truncate" style={{ color: T1, fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 2 }}>{value}</p>
              </div>
            ))}
          </div>

          <div className="grid lg:grid-cols-5 gap-4">
            {/* ─── World choropleth ─── */}
            <div className="lg:col-span-3 relative" style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 12, overflow: 'hidden' }}>
              <div className="flex items-center gap-2 px-2 pt-1 pb-2">
                <Globe className="w-4 h-4" style={{ color: T3 }} />
                <p style={{ color: T2, fontSize: 13, fontWeight: 600 }}>{L('origins.mapTitle', language)}</p>
              </div>

              {/* subtle red glow behind the map */}
              <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(60% 50% at 50% 40%,rgba(232,25,44,0.06),transparent 70%)' }} />

              <div className="relative" onMouseLeave={() => setHover(null)}>
                <ComposableMap
                  projection="geoEqualEarth"
                  projectionConfig={{ scale: 165 }}
                  width={900}
                  height={420}
                  style={{ width: '100%', height: 'auto' }}
                >
                  <Geographies geography={worldTopo as any}>
                    {({ geographies }: { geographies: any[] }) =>
                      geographies.map((geo) => {
                        const numeric = Number(geo.id);
                        const stat = byNumeric.get(numeric);
                        const country = COUNTRY_BY_NUMERIC.get(numeric);
                        const t = stat && maxCount ? stat.count / maxCount : 0;
                        const isActive = country && activeCode === country.code;
                        const fill = stat ? densityFill(t) : OCEAN_FILL;
                        return (
                          <Geography
                            key={geo.rsmKey}
                            geography={geo}
                            onMouseEnter={(e: any) => {
                              if (!stat || !country) return;
                              setHover({ name: getCountryName(country, language), flag: country.flag, count: stat.count, revenue: stat.revenue, x: e.clientX, y: e.clientY });
                            }}
                            onMouseMove={(e: any) => { if (stat) setHover(h => h ? { ...h, x: e.clientX, y: e.clientY } : h); }}
                            onClick={() => { if (country && stat) selectCountry(country.code); }}
                            style={{
                              default: { fill, stroke: isActive ? RED : GEO_STROKE, strokeWidth: isActive ? 1.1 : 0.4, outline: 'none', cursor: stat ? 'pointer' : 'default', transition: 'fill 150ms' },
                              hover: { fill: stat ? RED : OCEAN_FILL, stroke: GEO_STROKE, strokeWidth: 0.5, outline: 'none', cursor: stat ? 'pointer' : 'default' },
                              pressed: { fill: RED, stroke: GEO_STROKE, strokeWidth: 0.6, outline: 'none' },
                            }}
                          />
                        );
                      })
                    }
                  </Geographies>
                </ComposableMap>

                {/* Tooltip */}
                {hover && (
                  <div
                    className="fixed z-50 pointer-events-none rounded-xl px-3 py-2"
                    style={{ left: hover.x + 14, top: hover.y + 14, background: '#0a0a0c', border: `1px solid ${BORDER}`, boxShadow: '0 10px 30px -12px rgba(0,0,0,.9)' }}
                  >
                    <p style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{hover.flag} {hover.name}</p>
                    <p style={{ color: T2, fontSize: 11.5 }}>
                      {hover.count} {L('origins.clients', language)} · {hover.revenue.toFixed(0)}€
                    </p>
                  </div>
                )}
              </div>

              {/* Legend */}
              <div className="flex items-center gap-2 px-2 pt-2">
                <span style={{ color: T3, fontSize: 10.5 }}>{L('origins.fewer', language)}</span>
                <div className="flex-1 h-1.5 rounded-full" style={{ background: `linear-gradient(90deg, ${densityFill(0.05)}, ${densityFill(0.4)}, ${densityFill(1)})` }} />
                <span style={{ color: T3, fontSize: 10.5 }}>{L('origins.more', language)}</span>
              </div>
            </div>

            {/* ─── Ranked country list ─── */}
            <div className="lg:col-span-2" style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, overflow: 'hidden' }}>
              <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
                <p style={{ color: T2, fontSize: 13, fontWeight: 600 }}>{L('origins.ranking', language)}</p>
                <p style={{ color: T3, fontSize: 11 }}>{totalKnown} {L('origins.clients', language)}</p>
              </div>

              <div className="max-h-[420px] overflow-y-auto">
                {stats.length === 0 ? (
                  <div className="text-center py-14 px-4">
                    <Globe className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.10)' }} />
                    <p style={{ color: T3, fontSize: 13 }}>{L('origins.empty', language)}</p>
                  </div>
                ) : (
                  stats.map((s, i) => {
                    const share = totalKnown ? (s.count / totalKnown) * 100 : 0;
                    const active = activeCode === s.country.code;
                    return (
                      <motion.button
                        key={s.country.code}
                        initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.015, 0.3) }}
                        onClick={() => selectCountry(s.country.code)}
                        className="w-full text-left flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-all duration-150"
                        style={{ borderBottom: `1px solid ${F_BORDER}`, background: active ? 'rgba(232,25,44,0.06)' : 'transparent' }}
                      >
                        <span style={{ color: T3, fontSize: 11, fontWeight: 700, minWidth: 16 }}>{i + 1}</span>
                        <span style={{ fontSize: 20 }}>{s.country.flag}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate" style={{ color: T1, fontSize: 13, fontWeight: 500 }}>{getCountryName(s.country, language)}</span>
                            <span style={{ color: T1, fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{s.count}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
                              <div style={{ width: `${share}%`, height: '100%', background: RED }} />
                            </div>
                            <span style={{ color: T3, fontSize: 10.5, minWidth: 64, textAlign: 'right' }}>{share.toFixed(0)}% · {s.revenue.toFixed(0)}€</span>
                          </div>
                        </div>
                      </motion.button>
                    );
                  })
                )}
                {unknown > 0 && (
                  <div className="flex items-center gap-3 px-4 py-2.5" style={{ borderTop: `1px solid ${BORDER}` }}>
                    <span style={{ fontSize: 20, filter: 'grayscale(1)', opacity: 0.5 }}>🏳️</span>
                    <div className="flex-1 flex items-center justify-between">
                      <span style={{ color: T3, fontSize: 13 }}>{L('origins.unknown', language)}</span>
                      <span style={{ color: T3, fontSize: 13, fontWeight: 600 }}>{unknown}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      ) : (
        /* ─────────────────────────── City view ─────────────────────────── */
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { icon: Building2, label: 'origins.cities', value: cities.length, color: T2 },
              { icon: MapPin, label: 'origins.topCity', value: topCity ? topCity.city : '—', color: T2 },
              { icon: Users, label: 'origins.topShare', value: topCity ? `${cityTopShare}%` : '—', color: RED },
              { icon: Plane, label: 'origins.coverage', value: `${cityCoverage}%`, color: T2 },
            ].map(({ icon: Icon, label, value, color }) => (
              <div key={label} className="px-4 py-3 rounded-xl" style={{ background: CARD_BG, border: `1px solid ${BORDER}`, boxShadow: CARD_SHADOW }}>
                <div className="flex items-center gap-1.5 mb-0.5">
                  <Icon className="w-3 h-3" style={{ color }} />
                  <p style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{L(label, language)}</p>
                </div>
                <p className="truncate" style={{ color: T1, fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 2 }}>{value}</p>
              </div>
            ))}
          </div>

          <div className="grid lg:grid-cols-5 gap-4">
            {/* ─── Zoomable globe ─── */}
            <div className="lg:col-span-3 relative" style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 12, overflow: 'hidden' }}>
              <div className="flex items-center gap-2 px-2 pt-1 pb-2">
                <Globe className="w-4 h-4" style={{ color: T3 }} />
                <p style={{ color: T2, fontSize: 13, fontWeight: 600 }}>{L('origins.cityMapTitle', language)}</p>
              </div>

              <div className="relative" style={{ minHeight: 420 }}>
                {/* Placeholder behind the globe — shows through when the map can't render. */}
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 pointer-events-none">
                  <Globe className="h-9 w-9 mb-2" style={{ color: 'rgba(255,255,255,0.10)' }} />
                  <p style={{ color: T3, fontSize: 13 }}>
                    {cityLoading ? L('origins.cityLoading', language)
                      : cities.length === 0 ? L('origins.cityEmpty', language)
                      : L('origins.cityMapUnavailable', language)}
                  </p>
                </div>
                {cities.length > 0 && (
                  <Suspense fallback={<div className="rounded-[14px] animate-pulse" style={{ height: 420, background: INNER_BG }} />}>
                    <CityGlobe cities={cities} />
                  </Suspense>
                )}
              </div>
            </div>

            {/* ─── Ranked city list ─── */}
            <div className="lg:col-span-2" style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, overflow: 'hidden' }}>
              <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
                <p style={{ color: T2, fontSize: 13, fontWeight: 600 }}>{L('origins.cityRanking', language)}</p>
                <p style={{ color: T3, fontSize: 11 }}>{cityTotalKnown} {L('origins.clients', language)}</p>
              </div>

              <div className="max-h-[420px] overflow-y-auto">
                {cities.length === 0 ? (
                  <div className="text-center py-14 px-4">
                    <Building2 className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.10)' }} />
                    <p style={{ color: T3, fontSize: 13 }}>{cityLoading ? L('origins.cityLoading', language) : L('origins.cityEmpty', language)}</p>
                  </div>
                ) : (
                  cities.map((c, i) => {
                    const share = cityMax ? (c.count / cityMax) * 100 : 0;
                    return (
                      <motion.div
                        key={c.city + i}
                        initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.015, 0.3) }}
                        className="w-full flex items-center gap-3 px-4 py-2.5"
                        style={{ borderBottom: `1px solid ${F_BORDER}` }}
                      >
                        <span style={{ color: i === 0 ? RED : T3, fontSize: 11, fontWeight: 700, minWidth: 16 }}>{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate capitalize" style={{ color: T1, fontSize: 13, fontWeight: 500 }}>{c.city}</span>
                            <span style={{ color: T1, fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{c.count}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
                              <div style={{ width: `${share}%`, height: '100%', background: i === 0 ? RED : 'rgba(255,255,255,0.42)' }} />
                            </div>
                            <span style={{ color: T3, fontSize: 10.5, minWidth: 40, textAlign: 'right' }}>
                              {cityTotalKnown ? Math.round((c.count / cityTotalKnown) * 100) : 0}%
                            </span>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// tiny local i18n shim to keep this component self-contained
function L(key: string, language: string): string {
  const M: Record<string, { en: string; fr: string; es: string }> = {
    'origins.countries':   { en: 'Countries',        fr: 'Pays',              es: 'Países' },
    'origins.topCountry':  { en: 'Top country',       fr: 'Pays n°1',          es: 'País n.º1' },
    'origins.topShare':    { en: 'Top share',         fr: 'Part du n°1',       es: 'Cuota n.º1' },
    'origins.coverage':    { en: 'Located',           fr: 'Localisés',         es: 'Localizados' },
    'origins.mapTitle':    { en: 'Customer origins',  fr: 'Origine des clients', es: 'Origen de clientes' },
    'origins.ranking':     { en: 'By country',        fr: 'Par pays',          es: 'Por país' },
    'origins.clients':     { en: 'customers',         fr: 'clients',           es: 'clientes' },
    'origins.empty':       { en: 'No origin data yet (needs phone numbers).', fr: 'Pas encore de données d\'origine (téléphone requis).', es: 'Aún no hay datos de origen (se requiere teléfono).' },
    'origins.unknown':     { en: 'Unknown origin',    fr: 'Origine inconnue',  es: 'Origen desconocido' },
    'origins.fewer':       { en: 'Fewer',             fr: 'Moins',             es: 'Menos' },
    'origins.more':        { en: 'More',              fr: 'Plus',              es: 'Más' },
    // ── City tab ──
    'origins.tabCountry':  { en: 'By country',        fr: 'Par pays',          es: 'Por país' },
    'origins.tabCity':     { en: 'By city',           fr: 'Par ville',         es: 'Por ciudad' },
    'origins.cities':      { en: 'Cities',            fr: 'Villes',            es: 'Ciudades' },
    'origins.topCity':     { en: 'Top city',          fr: 'Ville n°1',         es: 'Ciudad n.º1' },
    'origins.cityMapTitle':{ en: 'Origins by city',   fr: 'Origine par ville', es: 'Origen por ciudad' },
    'origins.cityRanking': { en: 'By city',           fr: 'Par ville',         es: 'Por ciudad' },
    'origins.cityLoading': { en: 'Loading cities…',   fr: 'Chargement des villes…', es: 'Cargando ciudades…' },
    'origins.cityEmpty':   { en: 'No city data yet (needs profile city).', fr: 'Pas encore de données de ville (ville du profil requise).', es: 'Aún no hay datos de ciudad (se requiere la ciudad del perfil).' },
    'origins.cityMapUnavailable': { en: 'Map unavailable (Mapbox token missing).', fr: 'Carte indisponible (jeton Mapbox manquant).', es: 'Mapa no disponible (falta el token de Mapbox).' },
  };
  return M[key]?.[language as 'en' | 'fr' | 'es'] || M[key]?.en || key;
}
