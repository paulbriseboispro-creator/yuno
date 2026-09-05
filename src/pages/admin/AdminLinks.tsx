import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area,
} from 'recharts';
import {
  Link2, Eye, Users, MousePointerClick, Percent, ListPlus, Briefcase, ExternalLink, Copy,
  Globe, Languages, Smartphone, Share2, Megaphone, MapPin, CalendarDays, Check, Trash2, MessageCircle, Mail,
  type LucideIcon,
} from 'lucide-react';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import {
  LINKS_PUBLIC_URL,
  DEFAULT_LINKS_CONFIG,
  fetchLinksConfig,
  saveLinksConfig,
  type LinksAnalytics,
  type LinksConfig,
  type LinksProLead,
} from '@/lib/yunoLinks';

/**
 * /admin/links — le back-office de la page bio (Yuno Links, route /links).
 * Trois onglets : l'audience (vues, clics par lien, provenance), les réglages
 * (liens Instagram FR / EU, TikTok, WhatsApp, villes, sections) et les leads
 * pro arrivés par le formulaire. Super admin uniquement (AdminLayout).
 */

// ─── Yuno Design Tokens (dashboards pro) ─────────────────────────────────────
const RED         = '#E8192C';
const POS         = '#34D399';
const T1          = 'rgba(255,255,255,0.96)';
const T2          = 'rgba(255,255,255,0.58)';
const T3          = 'rgba(255,255,255,0.36)';
const C_FAINT     = 'rgba(255,255,255,0.06)';
const BORDER      = 'rgba(255,255,255,0.085)';
const F_BORDER    = 'rgba(255,255,255,0.055)';
const INNER_BG    = 'rgba(255,255,255,0.032)';
const CARD_BG     = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';
const AXIS_TICK   = { fill: 'rgba(255,255,255,0.36)', fontSize: 10.5 } as const;

type Tab = 'audience' | 'settings' | 'leads';

// ─── Primitives ──────────────────────────────────────────────────────────────
function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={className} style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 22, overflow: 'hidden' }}>
      {children}
    </div>
  );
}

function CardTitle({ icon: Icon, children, sub }: { icon: LucideIcon; children: React.ReactNode; sub?: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="flex h-8 w-8 items-center justify-center rounded-xl flex-none" style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>{children}</h3>
        {sub && <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>{sub}</p>}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, icon: Icon, highlight }: { label: string; value: string | number; sub?: string; icon: LucideIcon; highlight?: boolean }) {
  return (
    <div style={{ background: highlight ? 'linear-gradient(135deg,rgba(232,25,44,0.14),rgba(232,25,44,0.035)),#0a0a0c' : CARD_BG, border: `1px solid ${highlight ? 'rgba(232,25,44,0.24)' : BORDER}`, borderRadius: 16, boxShadow: CARD_SHADOW, padding: '16px 18px', height: '100%' }}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <p style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</p>
        <div className="flex h-7 w-7 items-center justify-center rounded-lg flex-none" style={{ background: highlight ? 'rgba(232,25,44,0.12)' : C_FAINT, border: `1px solid ${highlight ? 'rgba(232,25,44,0.2)' : F_BORDER}` }}>
          <Icon className="h-3.5 w-3.5" style={{ color: highlight ? RED : T2 }} />
        </div>
      </div>
      <p className="tabular-nums" style={{ color: highlight ? RED : T1, fontSize: 26, fontWeight: 640, letterSpacing: '-0.025em', lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ color: T3, fontSize: 11.5, marginTop: 6 }}>{sub}</p>}
    </div>
  );
}

function BarRow({ label, value, max, sub, accent }: { label: string; value: number; max: number; sub?: string; accent?: boolean }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between" style={{ fontSize: 12.5 }}>
        <span className="truncate pr-2" style={{ color: T2 }}>{label}</span>
        <span className="tabular-nums flex-none" style={{ color: T1 }}>
          {value.toLocaleString()}
          {sub !== undefined && <span style={{ color: T3 }}> · {sub}</span>}
        </span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: accent ? 'linear-gradient(90deg, rgba(232,25,44,0.8), rgba(232,25,44,0.4))' : 'rgba(255,255,255,0.28)' }} />
      </div>
    </div>
  );
}

interface TooltipEntry { name?: string | number; value?: string | number; color?: string; stroke?: string; fill?: string }
function CountTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipEntry[]; label?: string | number }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px 14px' }}>
      {label !== undefined && <p style={{ color: T3, fontSize: 11, marginBottom: 4 }}>{String(label)}</p>}
      {payload.map((p, i) => (
        <p key={i} className="tabular-nums" style={{ color: T1, fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color || p.stroke || p.fill, flexShrink: 0, display: 'inline-block' }} />
          <span style={{ color: T2, fontWeight: 400 }}>{p.name}</span>
          {Number(p.value).toLocaleString()}
        </p>
      ))}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, color: T1, fontSize: 13,
  padding: '9px 12px', outline: 'none', width: '100%',
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span style={{ display: 'block', color: T2, fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{label}</span>
      {children}
      {hint && <span style={{ display: 'block', color: T3, fontSize: 11.5, marginTop: 5, lineHeight: 1.5 }}>{hint}</span>}
    </label>
  );
}

const TARGET_KEYS = new Set(['app_store', 'web_app', 'instagram', 'tiktok', 'whatsapp', 'share', 'featured_all', 'event']);
const LEAD_TYPES = new Set(['club', 'organizer', 'promoter', 'agency', 'other']);

function flagEmoji(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return '';
  return code.replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function AdminLinks() {
  const { t, language } = useLanguage();
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const [tab, setTab] = useState<Tab>('audience');

  // Audience
  const [period, setPeriod] = useState<string>('28');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<LinksAnalytics | null>(null);

  // Réglages
  const [config, setConfig] = useState<LinksConfig>(DEFAULT_LINKS_CONFIG);
  const [liveCitiesText, setLiveCitiesText] = useState('');
  const [waitlistCitiesText, setWaitlistCitiesText] = useState('');
  const [saving, setSaving] = useState(false);

  // Leads
  const [leads, setLeads] = useState<LinksProLead[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [leadNotes, setLeadNotes] = useState<Record<string, string>>({});

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const now = new Date();
      const from = period === '1' ? startOfDay(now).toISOString() : startOfDay(subDays(now, parseInt(period))).toISOString();
      const to = endOfDay(now).toISOString();
      const { data, error } = await supabase.rpc('get_links_analytics', { p_from: from, p_to: to });
      if (error) {
        console.error('[AdminLinks] analytics error', error);
        toast.error(t('adminLinks.loadError'));
        setStats(null);
      } else {
        setStats(data as unknown as LinksAnalytics);
      }
    } finally {
      setLoading(false);
    }
  }, [period, t]);

  const fetchLeads = useCallback(async () => {
    setLeadsLoading(true);
    try {
      const { data, error } = await supabase.from('links_pro_leads').select('*').order('created_at', { ascending: false }).limit(300);
      if (error) throw error;
      const rows = (data ?? []) as unknown as LinksProLead[];
      setLeads(rows);
      setLeadNotes(Object.fromEntries(rows.map((l) => [l.id, l.notes ?? ''])));
    } catch (e) {
      console.error('[AdminLinks] leads error', e);
      toast.error(t('adminLinks.loadError'));
    } finally {
      setLeadsLoading(false);
    }
  }, [t]);

  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => { fetchLeads(); }, [fetchLeads]);
  useEffect(() => {
    fetchLinksConfig().then((c) => {
      setConfig(c);
      setLiveCitiesText(c.live_cities.join(', '));
      setWaitlistCitiesText(c.waitlist_cities.join(', '));
    });
  }, []);

  const splitCities = (s: string) => Array.from(new Set(s.split(/[,\n;]/).map((x) => x.trim()).filter(Boolean))).slice(0, 12);

  const save = async () => {
    setSaving(true);
    try {
      const next: LinksConfig = {
        ...config,
        live_cities: splitCities(liveCitiesText).length ? splitCities(liveCitiesText) : DEFAULT_LINKS_CONFIG.live_cities,
        waitlist_cities: splitCities(waitlistCitiesText).length ? splitCities(waitlistCitiesText) : DEFAULT_LINKS_CONFIG.waitlist_cities,
        featured_limit: Math.min(12, Math.max(1, Math.round(Number(config.featured_limit) || 6))),
      };
      await saveLinksConfig(next);
      setConfig(next);
      setLiveCitiesText(next.live_cities.join(', '));
      setWaitlistCitiesText(next.waitlist_cities.join(', '));
      toast.success(t('adminLinks.saved'));
    } catch (e) {
      console.error('[AdminLinks] save error', e);
      toast.error(t('adminLinks.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(LINKS_PUBLIC_URL);
      toast.success(t('adminLinks.copied'));
    } catch {
      toast.error(t('adminLinks.copyError'));
    }
  };

  const toggleContacted = async (lead: LinksProLead) => {
    const contacted_at = lead.contacted_at ? null : new Date().toISOString();
    const { error } = await supabase.from('links_pro_leads').update({ contacted_at }).eq('id', lead.id);
    if (error) { toast.error(t('adminLinks.leadError')); return; }
    setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, contacted_at } : l)));
  };

  const saveNotes = async (lead: LinksProLead) => {
    const notes = (leadNotes[lead.id] ?? '').trim() || null;
    if ((lead.notes ?? null) === notes) return;
    const { error } = await supabase.from('links_pro_leads').update({ notes }).eq('id', lead.id);
    if (error) { toast.error(t('adminLinks.leadError')); return; }
    setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, notes } : l)));
  };

  const deleteLead = async (lead: LinksProLead) => {
    if (!confirm(t('adminLinks.leadConfirmDelete'))) return;
    const { error } = await supabase.from('links_pro_leads').delete().eq('id', lead.id);
    if (error) { toast.error(t('adminLinks.leadError')); return; }
    setLeads((prev) => prev.filter((l) => l.id !== lead.id));
    toast.success(t('adminLinks.leadDeleted'));
  };

  // ── Dérivés audience ──
  const totals = stats?.totals;
  const hasData = !!totals && (totals.views > 0 || totals.clicks > 0 || totals.waitlist > 0 || totals.pro_leads > 0);
  const isHourly = stats?.granularity === 'hour';
  const ctr = totals && totals.visitors > 0 ? `${Math.round((totals.click_visitors / totals.visitors) * 100)}%` : '0%';
  const seriesData = useMemo(() => (stats?.series ?? []).map((p) => ({
    t: format(new Date(p.t), isHourly ? 'HH:mm' : 'dd/MM'),
    views: p.views, visitors: p.visitors, clicks: p.clicks, signups: p.signups,
  })), [stats, isHourly]);
  const xInterval = isHourly ? 3 : period === '90' ? 6 : period === '28' ? 2 : 0;

  const targetLabel = (k: string) => (TARGET_KEYS.has(k) ? t(`adminLinks.target.${k}`) : k);
  const leadTypeLabel = (k: string) => (LEAD_TYPES.has(k) ? t(`adminLinks.type.${k}`) : k);
  const deviceLabel = (d: string) => (d === 'mobile' || d === 'tablet' || d === 'desktop' ? t(`adminTraffic.dev_${d}`) : t('adminTraffic.dev_unknown'));
  const max = (arr: { n?: number; clicks?: number }[] | undefined, key: 'n' | 'clicks') => Math.max(1, ...(arr ?? []).map((x) => Number(x[key] ?? 0)));

  const periodOptions = [
    { value: '1', label: t('adminTraffic.periodToday') },
    { value: '7', label: t('adminTraffic.days7') },
    { value: '28', label: t('adminTraffic.days28') },
    { value: '90', label: t('adminTraffic.days90') },
  ];

  const tabs: { key: Tab; label: string; icon: LucideIcon; badge?: number }[] = [
    { key: 'audience', label: t('adminLinks.tabAudience'), icon: Eye },
    { key: 'settings', label: t('adminLinks.tabSettings'), icon: Link2 },
    { key: 'leads', label: t('adminLinks.tabLeads'), icon: Briefcase, badge: leads.filter((l) => !l.contacted_at).length || undefined },
  ];

  const btn = (primary?: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 8, height: 38, padding: '0 14px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    background: primary ? RED : INNER_BG, border: `1px solid ${primary ? RED : BORDER}`, color: primary ? '#fff' : T1,
  });

  return (
    <div className="min-h-screen pb-16" style={{ background: '#000' }}>
      <div className="fixed inset-0 pointer-events-none z-0" style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(232,25,44,.05),transparent 55%)' }} />

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div>
            <h1 style={{ color: T1, fontSize: 'clamp(22px,3vw,28px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1 }}>{t('adminLinks.title')}</h1>
            <p style={{ color: T3, fontSize: 13, marginTop: 4 }}>{t('adminLinks.subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <code style={{ color: T2, fontSize: 12.5, background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '9px 12px' }}>{LINKS_PUBLIC_URL}</code>
            <button type="button" onClick={copyUrl} style={btn()}><Copy className="h-4 w-4" />{t('adminLinks.copy')}</button>
            <a href={LINKS_PUBLIC_URL} target="_blank" rel="noopener noreferrer" style={btn(true)}><ExternalLink className="h-4 w-4" />{t('adminLinks.open')}</a>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-2">
          {tabs.map(({ key, label, icon: Icon, badge }) => {
            const on = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 38, padding: '0 14px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: on ? 'rgba(232,25,44,0.12)' : INNER_BG, border: `1px solid ${on ? 'rgba(232,25,44,0.35)' : BORDER}`, color: on ? '#fff' : T2 }}
              >
                <Icon className="h-4 w-4" style={{ color: on ? RED : T3 }} />
                {label}
                {badge ? <span className="tabular-nums" style={{ background: RED, color: '#fff', borderRadius: 999, fontSize: 10.5, fontWeight: 700, padding: '1px 7px' }}>{badge}</span> : null}
              </button>
            );
          })}
        </div>

        {/* ── Audience ── */}
        {tab === 'audience' && (
          <>
            <div className="flex justify-end">
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, color: T1, fontSize: 13, padding: '9px 12px', outline: 'none', cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none', minWidth: 170 }}
              >
                {periodOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {loading ? (
              <div className="flex min-h-[40vh] items-center justify-center">
                <div className="h-12 w-12 animate-spin rounded-full border-2" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
              </div>
            ) : !hasData ? (
              <Card>
                <div className="text-center py-12 max-w-md mx-auto">
                  <Link2 className="h-10 w-10 mx-auto mb-3" style={{ color: 'rgba(255,255,255,0.16)' }} />
                  <h3 style={{ color: T1, fontSize: 16, fontWeight: 600 }}>{t('adminLinks.emptyTitle')}</h3>
                  <p className="mt-2" style={{ color: T3, fontSize: 13, lineHeight: 1.6 }}>{t('adminLinks.emptyBody')}</p>
                </div>
              </Card>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                  <StatCard label={t('adminLinks.kVisitors')} value={totals!.visitors.toLocaleString()} icon={Users} highlight />
                  <StatCard label={t('adminLinks.kViews')} value={totals!.views.toLocaleString()} icon={Eye} />
                  <StatCard label={t('adminLinks.kClicks')} value={totals!.clicks.toLocaleString()} sub={`${totals!.click_visitors.toLocaleString()} ${t('adminLinks.sVisitors')}`} icon={MousePointerClick} />
                  <StatCard label={t('adminLinks.kCtr')} value={ctr} sub={t('adminLinks.kCtrSub')} icon={Percent} />
                  <StatCard label={t('adminLinks.kWaitlist')} value={totals!.waitlist.toLocaleString()} icon={ListPlus} />
                  <StatCard label={t('adminLinks.kLeads')} value={totals!.pro_leads.toLocaleString()} icon={Briefcase} />
                </div>

                <Card>
                  <CardTitle icon={Eye} sub={t('adminLinks.chartSub')}>{t('adminLinks.chartTitle')}</CardTitle>
                  <div style={{ height: 260 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={seriesData} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                        <defs>
                          <linearGradient id="ynl-views" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={RED} stopOpacity={0.35} />
                            <stop offset="100%" stopColor={RED} stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="ynl-clicks" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#fff" stopOpacity={0.25} />
                            <stop offset="100%" stopColor="#fff" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke={F_BORDER} vertical={false} />
                        <XAxis dataKey="t" tick={AXIS_TICK} axisLine={false} tickLine={false} interval={xInterval} />
                        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
                        <Tooltip content={<CountTooltip />} cursor={{ stroke: BORDER }} />
                        <Area type="monotone" dataKey="views" name={t('adminLinks.kViews')} stroke={RED} strokeWidth={2} fill="url(#ynl-views)" />
                        <Area type="monotone" dataKey="clicks" name={t('adminLinks.kClicks')} stroke="rgba(255,255,255,0.7)" strokeWidth={1.5} fill="url(#ynl-clicks)" />
                        <Area type="monotone" dataKey="signups" name={t('adminLinks.kSignups')} stroke={POS} strokeWidth={1.5} fill="none" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <Card>
                    <CardTitle icon={MousePointerClick} sub={t('adminLinks.targetsSub')}>{t('adminLinks.targetsTitle')}</CardTitle>
                    <div className="space-y-3">
                      {(stats!.targets ?? []).map((x) => (
                        <BarRow key={x.target} label={targetLabel(x.target)} value={x.clicks} max={max(stats!.targets, 'clicks')} sub={`${x.visitors} ${t('adminLinks.sVisitors')}`} accent={x.target === 'app_store' || x.target === 'web_app'} />
                      ))}
                      {!stats!.targets?.length && <p style={{ color: T3, fontSize: 13 }}>{t('adminLinks.noClicks')}</p>}
                    </div>
                  </Card>
                  <Card>
                    <CardTitle icon={CalendarDays} sub={t('adminLinks.eventsSub')}>{t('adminLinks.eventsTitle')}</CardTitle>
                    <div className="space-y-3">
                      {(stats!.events ?? []).map((x) => (
                        <BarRow key={x.event_id} label={x.title || x.event_id} value={x.clicks} max={max(stats!.events, 'clicks')} accent />
                      ))}
                      {!stats!.events?.length && <p style={{ color: T3, fontSize: 13 }}>{t('adminLinks.noClicks')}</p>}
                    </div>
                  </Card>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                  <Card>
                    <CardTitle icon={Share2}>{t('adminLinks.referrersTitle')}</CardTitle>
                    <div className="space-y-3">{(stats!.referrers ?? []).map((x) => <BarRow key={x.k} label={x.k === 'direct' ? t('adminTraffic.ch_direct') : x.k} value={x.n} max={max(stats!.referrers, 'n')} />)}</div>
                  </Card>
                  <Card>
                    <CardTitle icon={Globe}>{t('adminLinks.countriesTitle')}</CardTitle>
                    <div className="space-y-3">{(stats!.countries ?? []).map((x) => <BarRow key={x.k} label={`${flagEmoji(x.k)} ${x.k}`.trim()} value={x.n} max={max(stats!.countries, 'n')} />)}</div>
                  </Card>
                  <Card>
                    <CardTitle icon={Languages}>{t('adminLinks.langsTitle')}</CardTitle>
                    <div className="space-y-3">{(stats!.langs ?? []).map((x) => <BarRow key={x.k} label={x.k.toUpperCase()} value={x.n} max={max(stats!.langs, 'n')} />)}</div>
                  </Card>
                  <Card>
                    <CardTitle icon={Smartphone}>{t('adminLinks.devicesTitle')}</CardTitle>
                    <div className="space-y-3">{(stats!.devices ?? []).map((x) => <BarRow key={x.k} label={deviceLabel(x.k)} value={x.n} max={max(stats!.devices, 'n')} />)}</div>
                  </Card>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <Card>
                    <CardTitle icon={Megaphone} sub={t('adminLinks.utmSub')}>{t('adminLinks.utmTitle')}</CardTitle>
                    <div className="space-y-3">
                      {(stats!.utm ?? []).map((x) => <BarRow key={x.k} label={x.k} value={x.n} max={max(stats!.utm, 'n')} />)}
                      {!stats!.utm?.length && <p style={{ color: T3, fontSize: 13 }}>{t('adminLinks.noUtm')}</p>}
                    </div>
                  </Card>
                  <Card>
                    <CardTitle icon={MapPin} sub={t('adminLinks.wlCitiesSub')}>{t('adminLinks.wlCitiesTitle')}</CardTitle>
                    <div className="space-y-3">
                      {(stats!.waitlist_cities ?? []).map((x) => <BarRow key={x.k} label={x.k} value={x.n} max={max(stats!.waitlist_cities, 'n')} accent />)}
                      {!stats!.waitlist_cities?.length && <p style={{ color: T3, fontSize: 13 }}>{t('adminLinks.noWaitlist')}</p>}
                    </div>
                    <a href="/admin/waitlist" style={{ display: 'inline-flex', marginTop: 14, color: RED, fontSize: 12.5, fontWeight: 600 }}>{t('adminLinks.wlOpen')} →</a>
                  </Card>
                  <Card>
                    <CardTitle icon={Briefcase}>{t('adminLinks.leadTypesTitle')}</CardTitle>
                    <div className="space-y-3">
                      {(stats!.lead_types ?? []).map((x) => <BarRow key={x.k} label={leadTypeLabel(x.k)} value={x.n} max={max(stats!.lead_types, 'n')} />)}
                      {!stats!.lead_types?.length && <p style={{ color: T3, fontSize: 13 }}>{t('adminLinks.leadsEmpty')}</p>}
                    </div>
                    <button type="button" onClick={() => setTab('leads')} style={{ display: 'inline-flex', marginTop: 14, color: RED, fontSize: 12.5, fontWeight: 600, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>{t('adminLinks.tabLeads')} →</button>
                  </Card>
                </div>
              </>
            )}
          </>
        )}

        {/* ── Réglages ── */}
        {tab === 'settings' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardTitle icon={Link2}>{t('adminLinks.setLinks')}</CardTitle>
              <div className="space-y-4">
                <Field label={t('adminLinks.setInstagramFr')}>
                  <input style={inputStyle} value={config.instagram_fr} onChange={(e) => setConfig({ ...config, instagram_fr: e.target.value })} placeholder="https://www.instagram.com/…" />
                </Field>
                <Field label={t('adminLinks.setInstagramIntl')} hint={t('adminLinks.setInstagramHint')}>
                  <input style={inputStyle} value={config.instagram_intl} onChange={(e) => setConfig({ ...config, instagram_intl: e.target.value })} placeholder="https://www.instagram.com/…" />
                </Field>
                <Field label={t('adminLinks.setTiktok')} hint={t('adminLinks.setTiktokHint')}>
                  <input style={inputStyle} value={config.tiktok} onChange={(e) => setConfig({ ...config, tiktok: e.target.value })} placeholder="https://www.tiktok.com/@…" />
                </Field>
                <Field label={t('adminLinks.setWhatsapp')} hint={t('adminLinks.setWhatsappHint')}>
                  <input style={inputStyle} value={config.whatsapp_number} onChange={(e) => setConfig({ ...config, whatsapp_number: e.target.value })} placeholder="+33612345678" inputMode="tel" />
                </Field>
                <Field label={t('adminLinks.setAppStore')}>
                  <input style={inputStyle} value={config.app_store_url} onChange={(e) => setConfig({ ...config, app_store_url: e.target.value })} />
                </Field>
              </div>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardTitle icon={MapPin}>{t('adminLinks.setContent')}</CardTitle>
                <div className="space-y-4">
                  <Field label={t('adminLinks.setLiveCities')} hint={t('adminLinks.setLiveCitiesHint')}>
                    <input style={inputStyle} value={liveCitiesText} onChange={(e) => setLiveCitiesText(e.target.value)} placeholder="Madrid, Paris" />
                  </Field>
                  <Field label={t('adminLinks.setWaitlistCities')} hint={t('adminLinks.setWaitlistCitiesHint')}>
                    <input style={inputStyle} value={waitlistCitiesText} onChange={(e) => setWaitlistCitiesText(e.target.value)} placeholder="Lyon, Bordeaux, Toulouse" />
                  </Field>
                  <Field label={t('adminLinks.setFeaturedLimit')}>
                    <input style={{ ...inputStyle, width: 120 }} type="number" min={1} max={12} value={config.featured_limit} onChange={(e) => setConfig({ ...config, featured_limit: Number(e.target.value) })} />
                  </Field>
                </div>
              </Card>

              <Card>
                <CardTitle icon={Eye}>{t('adminLinks.setSections')}</CardTitle>
                <div className="space-y-3">
                  {([
                    ['show_featured', t('adminLinks.setShowFeatured')],
                    ['show_waitlist', t('adminLinks.setShowWaitlist')],
                    ['show_pros', t('adminLinks.setShowPros')],
                  ] as [keyof LinksConfig, string][]).map(([key, label]) => (
                    <div key={key} className="flex items-center justify-between gap-3 py-2" style={{ borderBottom: `1px solid ${F_BORDER}` }}>
                      <span style={{ color: T1, fontSize: 13.5 }}>{label}</span>
                      <Switch checked={Boolean(config[key])} onCheckedChange={(v) => setConfig({ ...config, [key]: v })} />
                    </div>
                  ))}
                </div>
                <p style={{ color: T3, fontSize: 11.5, marginTop: 14, lineHeight: 1.5 }}>{t('adminLinks.preview')}</p>
                <div className="flex justify-end mt-4">
                  <button type="button" onClick={save} disabled={saving} style={{ ...btn(true), opacity: saving ? 0.7 : 1 }}>
                    <Check className="h-4 w-4" />{saving ? '…' : t('adminLinks.save')}
                  </button>
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* ── Leads pro ── */}
        {tab === 'leads' && (
          <Card>
            <CardTitle icon={Briefcase} sub={t('adminLinks.leadsSub')}>{t('adminLinks.tabLeads')}</CardTitle>
            {leadsLoading ? (
              <div className="flex min-h-[20vh] items-center justify-center">
                <div className="h-10 w-10 animate-spin rounded-full border-2" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
              </div>
            ) : leads.length === 0 ? (
              <p style={{ color: T3, fontSize: 13 }}>{t('adminLinks.leadsEmpty')}</p>
            ) : (
              <div className="space-y-3">
                {leads.map((lead) => {
                  const digits = (lead.phone ?? '').replace(/\D/g, '');
                  const done = !!lead.contacted_at;
                  return (
                    <div key={lead.id} style={{ background: INNER_BG, border: `1px solid ${done ? F_BORDER : 'rgba(232,25,44,0.22)'}`, borderRadius: 14, padding: 16, opacity: done ? 0.72 : 1 }}>
                      <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span style={{ color: T1, fontSize: 15, fontWeight: 650 }}>{lead.name}</span>
                            <span style={{ color: RED, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', background: 'rgba(232,25,44,0.10)', border: '1px solid rgba(232,25,44,0.25)', borderRadius: 999, padding: '2px 8px' }}>{leadTypeLabel(lead.org_type)}</span>
                            {done && <span style={{ color: POS, fontSize: 11.5, fontWeight: 600 }}>✓ {t('adminLinks.leadContacted')}</span>}
                          </div>
                          <p style={{ color: T2, fontSize: 13, marginTop: 4 }}>
                            {[lead.org_name, lead.city].filter(Boolean).join(' · ') || '—'}
                          </p>
                          <p className="tabular-nums" style={{ color: T3, fontSize: 11.5, marginTop: 4 }}>
                            {format(new Date(lead.created_at), 'PPp', { locale: dateLocale })}
                            {lead.lang ? ` · ${lead.lang.toUpperCase()}` : ''}
                            {lead.phone ? ` · ${lead.phone}` : ''}
                            {lead.email ? ` · ${lead.email}` : ''}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2 flex-none">
                          {digits.length >= 8 && (
                            <a href={`https://wa.me/${digits}`} target="_blank" rel="noopener noreferrer" style={btn()}><MessageCircle className="h-4 w-4" />{t('adminLinks.leadWhatsapp')}</a>
                          )}
                          {lead.email && (
                            <a href={`mailto:${lead.email}`} style={btn()}><Mail className="h-4 w-4" />{t('adminLinks.leadEmail')}</a>
                          )}
                          <button type="button" onClick={() => toggleContacted(lead)} style={btn(!done)}>
                            <Check className="h-4 w-4" />{done ? t('adminLinks.leadUnmark') : t('adminLinks.leadMarkContacted')}
                          </button>
                          <button type="button" onClick={() => deleteLead(lead)} style={{ ...btn(), color: '#FF5C63' }} aria-label={t('adminLinks.leadDelete')}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      <textarea
                        value={leadNotes[lead.id] ?? ''}
                        onChange={(e) => setLeadNotes({ ...leadNotes, [lead.id]: e.target.value })}
                        onBlur={() => saveNotes(lead)}
                        placeholder={t('adminLinks.leadNotes')}
                        rows={2}
                        style={{ ...inputStyle, marginTop: 12, resize: 'vertical', fontFamily: 'inherit' }}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
