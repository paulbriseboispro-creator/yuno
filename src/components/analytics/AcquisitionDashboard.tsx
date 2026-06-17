import { useEffect, useState } from 'react';
import { translate } from '@/i18n/orgTranslate';
import { Globe, ArrowUpRight, Search as SearchIcon, Share2, Mail, QrCode, Link2, MousePointer2, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { motion } from 'framer-motion';
import { useOrganizerEventIds } from '@/hooks/useOrganizerEventIds';
import { buildOrganizerScopeOr } from './scopeFilter';

// ─── Design tokens ────────────────────────────────────────────────────────────
const RED = '#E8192C';
const POS = '#34D399';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const FAINT_BORDER = 'rgba(255,255,255,0.055)';

const crd: React.CSSProperties = {
  background: 'rgba(255,255,255,0.032)',
  border: `1px solid ${BORDER}`,
  borderRadius: 14,
  overflow: 'hidden',
};

interface Props {
  scope: { kind: 'venue'; id: string } | { kind: 'organizer'; id: string };
  from?: string;
  to?: string;
  deviceFilter?: string;
  sourceFilter?: string;
}

interface SourceBucket {
  category: string;
  visits: number;
  conversions: number;
}

interface UtmRow {
  source: string;
  medium: string;
  campaign: string;
  visits: number;
  conversions: number;
  revenueCents: number;
}

const CATEGORY_META: Record<string, { label: string; icon: any; color: string }> = {
  direct:      { label: 'Direct',      icon: Link2,         color: '#94a3b8' },
  search:      { label: 'Search',      icon: SearchIcon,    color: '#3b82f6' },
  paid_search: { label: 'Paid Search', icon: SearchIcon,    color: '#0ea5e9' },
  social:      { label: 'Social',      icon: Share2,        color: '#f43f5e' },
  paid_social: { label: 'Paid Social', icon: Share2,        color: '#e11d48' },
  email:       { label: 'Email',       icon: Mail,          color: '#a855f7' },
  qr:          { label: 'QR Code',     icon: QrCode,        color: '#10b981' },
  affiliate:   { label: 'Affiliate',   icon: MousePointer2, color: '#f59e0b' },
  referral:    { label: 'Referral',    icon: ExternalLink,  color: '#64748b' },
  internal:    { label: 'Internal',    icon: Link2,         color: '#475569' },
  other:       { label: 'Other',       icon: Globe,         color: '#6b7280' },
};

export function AcquisitionDashboard({ scope, from, to, deviceFilter, sourceFilter }: Props) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [sources, setSources] = useState<SourceBucket[]>([]);
  const [utms, setUtms] = useState<UtmRow[]>([]);
  const [topReferrers, setTopReferrers] = useState<{ domain: string; visits: number }[]>([]);
  const [topCountries, setTopCountries] = useState<{ country: string; visits: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const { eventIds, venueIds } = useOrganizerEventIds(scope.kind === 'organizer' ? scope.id : null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      let q = supabase
        .from('visitor_sessions')
        .select('referrer_category, referrer_domain, country, utm_source, utm_medium, utm_campaign, completed_order, cart_value_cents, device_type');
      if (scope.kind === 'venue') q = q.eq('venue_id', scope.id);
      else q = q.or(buildOrganizerScopeOr(scope.id, eventIds, venueIds));
      if (from) q = q.gte('visited_at', from);
      if (to) q = q.lte('visited_at', to);
      if (deviceFilter && deviceFilter !== 'all') q = q.eq('device_type', deviceFilter);
      if (sourceFilter && sourceFilter !== 'all') q = q.eq('referrer_category', sourceFilter);

      const { data } = await q.limit(10000);
      if (cancelled) return;

      const srcMap = new Map<string, SourceBucket>();
      const refMap = new Map<string, number>();
      const ctyMap = new Map<string, number>();
      const utmMap = new Map<string, UtmRow>();

      (data ?? []).forEach((r: any) => {
        const cat = r.referrer_category || 'direct';
        if (!srcMap.has(cat)) srcMap.set(cat, { category: cat, visits: 0, conversions: 0 });
        const sb = srcMap.get(cat)!;
        sb.visits += 1;
        if (r.completed_order) sb.conversions += 1;

        if (r.referrer_domain) refMap.set(r.referrer_domain, (refMap.get(r.referrer_domain) || 0) + 1);
        if (r.country) ctyMap.set(r.country, (ctyMap.get(r.country) || 0) + 1);

        if (r.utm_source || r.utm_campaign) {
          const key = `${r.utm_source || '-'}|${r.utm_medium || '-'}|${r.utm_campaign || '-'}`;
          if (!utmMap.has(key)) utmMap.set(key, {
            source: r.utm_source || '-', medium: r.utm_medium || '-', campaign: r.utm_campaign || '-',
            visits: 0, conversions: 0, revenueCents: 0,
          });
          const u = utmMap.get(key)!;
          u.visits += 1;
          if (r.completed_order) {
            u.conversions += 1;
            u.revenueCents += Number(r.cart_value_cents || 0);
          }
        }
      });

      setSources([...srcMap.values()].sort((a, b) => b.visits - a.visits));
      setTopReferrers([...refMap.entries()].map(([domain, visits]) => ({ domain, visits })).sort((a, b) => b.visits - a.visits).slice(0, 8));
      setTopCountries([...ctyMap.entries()].map(([country, visits]) => ({ country, visits })).sort((a, b) => b.visits - a.visits).slice(0, 8));
      setUtms([...utmMap.values()].sort((a, b) => b.visits - a.visits).slice(0, 20));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [scope.kind, scope.id, from, to, deviceFilter, sourceFilter, eventIds.join(','), venueIds.join(',')]);

  const totalVisits = sources.reduce((s, x) => s + x.visits, 0);

  return (
    <div className="space-y-3">
      {/* Acquisition sources */}
      <div style={{ ...crd, padding: '20px 22px' }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 flex items-center justify-center rounded-xl flex-none"
              style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}>
              <Globe className="h-4 w-4" style={{ color: RED }} />
            </div>
            <h3 className="text-[15px] font-semibold leading-tight" style={{ color: T1, letterSpacing: '-0.01em' }}>
              {tt('Sources d\'acquisition', 'Acquisition sources')}
            </h3>
          </div>
          <span className="text-[12px] tabular-nums" style={{ color: T3 }}>
            {totalVisits.toLocaleString()} {tt('visites', 'visits')}
          </span>
        </div>

        {loading ? (
          <div className="h-48 flex items-center justify-center text-sm" style={{ color: T3 }}>
            {tt('Chargement…', 'Loading…')}
          </div>
        ) : sources.length === 0 ? (
          <EmptyState text={tt(
            'Aucune visite enregistrée sur cette période. Activez vos UTM pour mesurer vos campagnes !',
            'No visits recorded on this range. Add UTMs to track your campaigns!',
          )} />
        ) : (
          <div className="grid lg:grid-cols-[200px,1fr] gap-6 items-center">
            <DonutChart data={sources} language={language} />
            <div className="space-y-1.5">
              {sources.map((s, i) => {
                const meta = CATEGORY_META[s.category] || CATEGORY_META.other;
                const Icon = meta.icon;
                const pct = totalVisits ? ((s.visits / totalVisits) * 100).toFixed(1) : '0';
                const conv = s.visits ? ((s.conversions / s.visits) * 100).toFixed(1) : '0';
                return (
                  <motion.div
                    key={s.category}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                  >
                    <div className="flex items-center gap-3 px-2.5 py-2 rounded-xl"
                      style={{ transition: 'background 150ms' }}>
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-none"
                        style={{ background: `${meta.color}1a`, border: `1px solid ${meta.color}35` }}>
                        <Icon className="h-3.5 w-3.5" style={{ color: meta.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium" style={{ color: T2 }}>{meta.label}</span>
                          <span className="text-sm font-semibold tabular-nums" style={{ color: T1 }}>{s.visits}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <div className="flex-1 h-1 rounded-full overflow-hidden"
                            style={{ background: 'rgba(255,255,255,0.06)' }}>
                            <div className="h-full rounded-full transition-all"
                              style={{ width: `${pct}%`, background: meta.color }} />
                          </div>
                          <span className="text-[10px] tabular-nums" style={{ color: T3 }}>{pct}%</span>
                          <span className="text-[10px] tabular-nums" style={{ color: POS }}>↗ {conv}%</span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* UTM table + Top referrers + Top countries */}
      <div className="grid lg:grid-cols-3 gap-3">
        {/* UTM table */}
        <div className="lg:col-span-2" style={{ ...crd, padding: '18px 20px' }}>
          <h3 className="text-[13.5px] font-semibold mb-3 flex items-center gap-2" style={{ color: T1 }}>
            <ArrowUpRight className="h-4 w-4 flex-none" style={{ color: RED }} />
            {tt('Campagnes UTM', 'UTM campaigns')}
          </h3>
          {utms.length === 0 ? (
            <EmptyState text={tt(
              'Aucune campagne UTM. Ajoutez ?utm_source=instagram&utm_campaign=lancement à vos liens.',
              'No UTM campaign. Append ?utm_source=instagram&utm_campaign=launch to your links.',
            )} />
          ) : (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ borderBottom: `1px solid ${FAINT_BORDER}` }}>
                    {['Source', 'Medium', 'Campaign', tt('Visites', 'Visits'), 'Conv.', 'CA'].map((h, i) => (
                      <th key={i} className={`px-2 py-2 font-medium text-left${i >= 3 ? ' text-right' : ''}`}
                        style={{ color: T3 }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {utms.map((u, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${FAINT_BORDER}` }}
                      className="last:border-0">
                      <td className="px-2 py-2 font-semibold" style={{ color: T1 }}>{u.source}</td>
                      <td className="px-2 py-2" style={{ color: T3 }}>{u.medium}</td>
                      <td className="px-2 py-2" style={{ color: T2 }}>{u.campaign}</td>
                      <td className="px-2 py-2 text-right tabular-nums" style={{ color: T1 }}>{u.visits}</td>
                      <td className="px-2 py-2 text-right tabular-nums font-semibold" style={{ color: POS }}>{u.conversions}</td>
                      <td className="px-2 py-2 text-right tabular-nums font-semibold" style={{ color: T1 }}>
                        {(u.revenueCents / 100).toFixed(0)}€
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Referrers + Countries */}
        <div className="space-y-3">
          <div style={{ ...crd, padding: '18px 20px' }}>
            <h3 className="text-[13px] font-semibold mb-3" style={{ color: T1 }}>
              {tt('Top referrers', 'Top referrers')}
            </h3>
            {topReferrers.length === 0 ? (
              <p className="text-xs" style={{ color: T3 }}>{tt('Aucun referrer.', 'No referrer.')}</p>
            ) : (
              <ul className="space-y-2">
                {topReferrers.map((r) => (
                  <li key={r.domain} className="flex items-center justify-between text-[12.5px]">
                    <span className="truncate" style={{ color: T2 }}>{r.domain}</span>
                    <span className="font-semibold tabular-nums ml-2 flex-none" style={{ color: T1 }}>{r.visits}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div style={{ ...crd, padding: '18px 20px' }}>
            <h3 className="text-[13px] font-semibold mb-3" style={{ color: T1 }}>
              {tt('Pays', 'Countries')}
            </h3>
            {topCountries.length === 0 ? (
              <p className="text-xs" style={{ color: T3 }}>{tt('En attente d\'enrichissement géo.', 'Awaiting geo enrichment.')}</p>
            ) : (
              <ul className="space-y-2">
                {topCountries.map((c) => (
                  <li key={c.country} className="flex items-center justify-between text-[12.5px]">
                    <span style={{ color: T2 }}>{c.country}</span>
                    <span className="font-semibold tabular-nums" style={{ color: T1 }}>{c.visits}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────
function EmptyState({ text }: { text: string }) {
  return (
    <div className="text-center py-8 px-4">
      <Globe className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.12)' }} />
      <p className="text-xs max-w-sm mx-auto" style={{ color: T3 }}>{text}</p>
    </div>
  );
}

// ─── Donut chart ──────────────────────────────────────────────────────────────
function DonutChart({ data, language }: { data: SourceBucket[]; language: string }) {
  const total = data.reduce((s, x) => s + x.visits, 0);
  if (total === 0) return null;
  let cumulative = 0;
  const radius = 70;
  const stroke = 20;
  const circ = 2 * Math.PI * radius;

  return (
    <div className="relative w-48 h-48 mx-auto">
      <svg viewBox="0 0 200 200" className="w-full h-full -rotate-90">
        <circle cx="100" cy="100" r={radius} fill="none"
          stroke="rgba(255,255,255,0.04)" strokeWidth={stroke} />
        {data.map((s, i) => {
          const meta = CATEGORY_META[s.category] || CATEGORY_META.other;
          const fraction = s.visits / total;
          const dash = fraction * circ;
          const offset = -cumulative * circ;
          cumulative += fraction;
          return (
            <circle
              key={i}
              cx="100" cy="100" r={radius}
              fill="none"
              stroke={meta.color}
              strokeWidth={stroke}
              strokeDasharray={`${dash} ${circ - dash}`}
              strokeDashoffset={offset}
              style={{ transition: 'all 600ms ease' }}
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold tabular-nums" style={{ color: T1, letterSpacing: '-0.025em' }}>
          {total.toLocaleString()}
        </span>
        <span className="text-[10px] uppercase tracking-wider" style={{ color: T3 }}>
          {language === 'fr' ? 'visites' : language === 'es' ? 'visitas' : 'visits'}
        </span>
      </div>
    </div>
  );
}
