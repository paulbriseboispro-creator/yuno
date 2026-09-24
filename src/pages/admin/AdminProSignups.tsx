import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAdminScope } from '@/components/admin/AdminScope';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  Building2, CalendarPlus, Check, ExternalLink, Filter, Mail, MessageCircle, PartyPopper,
  Percent, Phone, RefreshCw, StickyNote, UserPlus, Users,
} from 'lucide-react';
import {
  AdminPage, Btn, Card, DistRow, Dot, EmptyState, ErrorState, Modal, PageSkeleton, PeriodFilter,
  Pill, RECHARTS_TOOLTIP, RED, POS, WARN, T1, T2, T3, F_BORDER, INNER_BG, BORDER, CHART,
  Reveal, SectionHeading, Stat, TabBar, INPUT_STYLE,
} from '@/components/admin/ui';
import { fmtAxisDay, fmtNum, fmtPct, fmtPlural, fmtRelative } from '@/lib/adminFormat';
import { whatsappUrl } from '@/lib/yunoLinks';
import { KNOWN_TOOLS, PRO_SIGNUP_ORIGIN } from '@/lib/proSignup';

// ─── Inscriptions pro ─────────────────────────────────────────────────────────
// Le funnel de la landing (landing.yunoapp.eu/start) jusqu'à la première
// soirée en ligne. Tout vient d'admin_pro_signups (migration 20260924120000) :
// funnel, courbe, sources, et la progression RÉELLE de chaque compte (soirée
// créée, Stripe, en ligne) lue dans les tables métier, jamais déclarée.

type Period = '7' | '30' | '90' | '365';
type Tab = 'all' | 'accounts' | 'leads';

interface Funnel {
  opened: number; role: number; structure: number; email: number; created: number; console: number;
  first_event: number; payments: number; live: number; clubs: number; organizers: number; leads: number; to_contact: number;
}
interface Row {
  id: string; created_at: string; updated_at: string; kind: string | null; lang: string | null;
  first_name: string | null; last_name: string | null; email: string | null; phone: string | null;
  org_name: string | null; city: string | null; country: string | null;
  size_band: string | null; frequency: string | null; pillars: string[] | null;
  current_tool: string | null; next_night: string | null;
  source: string | null; utm_source: string | null; utm_campaign: string | null; last_step: string | null;
  user_id: string | null; venue_id: string | null;
  account_created_at: string | null; console_opened_at: string | null;
  contacted_at: string | null; admin_notes: string | null;
  events: number; payments: boolean; live: boolean;
}
interface Payload {
  funnel: Funnel;
  by_day: { d: string; started: number; created: number }[];
  by_source: { source: string; started: number; created: number }[];
  rows: Row[];
}

const FUNNEL_STEPS: (keyof Funnel)[] = ['opened', 'role', 'structure', 'email', 'created', 'console', 'first_event', 'payments', 'live'];

const SIZE_LABEL: Record<string, string> = {
  lt300: '< 300', '300_800': '300–800', '800_1500': '800–1 500', gt1500: '1 500+',
  lt200: '< 200', '200_500': '200–500', '500_1500': '500–1 500',
};
// wa.me veut un numéro international sans « + ». Un numéro saisi en national
// (« 06… » en France, « 6… » en Espagne) prend l'indicatif du pays de la ligne.
function intlPhone(raw: string, country: string | null): string {
  let d = raw.replace(/\D/g, '');
  if (raw.trim().startsWith('+')) return d;
  if (d.startsWith('00')) return d.slice(2);
  const cc = country === 'ES' ? '34' : country === 'BE' ? '32' : country === 'CH' ? '41' : '33';
  if (d.startsWith('0')) d = d.slice(1);
  else if (cc !== '34' || d.length !== 9) return d;
  return cc + d;
}

const FREQ_LABEL: Record<string, string> = { '1': '1 / mo', '2_4': '2–4 / mo', '5plus': '5+ / mo' };

export default function AdminProSignups() {
  const { t, language } = useLanguage();
  const { includeDemo } = useAdminScope();
  const [period, setPeriod] = useState<Period>('30');
  const [tab, setTab] = useState<Tab>('all');
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notesFor, setNotesFor] = useState<Row | null>(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true); setError(null);
    const { data: d, error: e } = await supabase.rpc('admin_pro_signups' as never, { p_days: Number(period), p_include_demo: includeDemo } as never);
    if (e) setError(e.message);
    else setData(d as unknown as Payload);
    setLoading(false);
  }, [period, includeDemo]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const update = useCallback(async (id: string, patch: { p_contacted?: boolean; p_notes?: string }) => {
    const { error: e } = await supabase.rpc('admin_update_pro_signup' as never, { p_id: id, ...patch } as never);
    if (e) { setError(e.message); return false; }
    setData((prev) => prev && ({
      ...prev,
      rows: prev.rows.map((r) => r.id !== id ? r : {
        ...r,
        contacted_at: patch.p_contacted === undefined ? r.contacted_at : patch.p_contacted ? (r.contacted_at ?? new Date().toISOString()) : null,
        admin_notes: patch.p_notes === undefined ? r.admin_notes : (patch.p_notes.trim() || null),
      }),
    }));
    return true;
  }, []);

  const f = data?.funnel;
  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    if (tab === 'accounts') return all.filter((r) => r.user_id);
    if (tab === 'leads') return all.filter((r) => !r.user_id);
    return all;
  }, [data, tab]);

  const chart = useMemo(
    () => (data?.by_day ?? []).map((d) => ({ ...d, label: fmtAxisDay(d.d, language) })),
    [data, language],
  );

  const header = (
    <>
      {includeDemo && <Pill tone="accent">{t('adm.common.demoIncluded')}</Pill>}
      <PeriodFilter<Period>
        value={period}
        onChange={setPeriod}
        options={[
          { key: '7', label: t('adm.signups.period7') },
          { key: '30', label: t('adm.signups.period30') },
          { key: '90', label: t('adm.signups.period90') },
          { key: '365', label: t('adm.signups.period365') },
        ]}
      />
      <Btn href={`${PRO_SIGNUP_ORIGIN}/fr/start`} icon={ExternalLink} variant="ghost">{t('adm.signups.openLanding')}</Btn>
      <Btn onClick={fetchAll} icon={RefreshCw} loading={loading}>{t('adm.common.refresh')}</Btn>
    </>
  );

  const pageProps = { eyebrow: t('adm.signups.eyebrow'), title: t('adm.signups.title'), subtitle: t('adm.signups.subtitle'), actions: header };

  if (loading && !data) return <AdminPage {...pageProps}><PageSkeleton tiles={4} blocks={2} /></AdminPage>;
  if (error && !data) return <AdminPage {...pageProps}><ErrorState text={error} onRetry={fetchAll} retryLabel={t('adm.common.refresh')} /></AdminPage>;

  const conv = f && f.role > 0 ? (f.created / f.role) * 100 : 0;
  const kindLabel = (k: string | null) => t(`adm.signups.kind.${k === 'club' || k === 'organizer' || k === 'promoter' ? k : 'other'}`);

  return (
    <AdminPage {...pageProps}>
      {/* 01 · Résultats + funnel */}
      <Reveal>
        <SectionHeading n={1} label={t('adm.signups.s1')} icon={UserPlus} accent />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
          <Stat
            label={t('adm.signups.created')} value={fmtNum(f?.created ?? 0, language)} icon={UserPlus} highlight
            sub={t('adm.signups.createdSub').replace('{c}', fmtNum(f?.clubs ?? 0, language)).replace('{o}', fmtNum(f?.organizers ?? 0, language))}
            spark={(data?.by_day ?? []).slice(-14).map((d) => d.created)} sparkAccent
          />
          <Stat label={t('adm.signups.conversion')} value={fmtPct(conv)} icon={Percent} sub={t('adm.signups.conversionSub')} />
          <Stat
            label={t('adm.signups.activated')} value={fmtNum(f?.first_event ?? 0, language)} icon={CalendarPlus}
            tone={(f?.first_event ?? 0) > 0 ? 'pos' : undefined}
            sub={t('adm.signups.activatedSub').replace('{n}', fmtNum(f?.payments ?? 0, language))}
          />
          <Stat
            label={t('adm.signups.toContact')} value={fmtNum(f?.to_contact ?? 0, language)} icon={Phone}
            tone={(f?.to_contact ?? 0) > 0 ? 'warn' : undefined} sub={t('adm.signups.toContactSub')}
          />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-4">
          <Card title={t('adm.signups.funnel')} subtitle={t('adm.signups.funnelHint')} icon={Filter}>
            {FUNNEL_STEPS.map((k, i) => {
              const v = f?.[k] ?? 0;
              const top = Math.max(1, f?.opened ?? 0);
              const prev = i > 0 ? f?.[FUNNEL_STEPS[i - 1]] ?? 0 : 0;
              return (
                <DistRow
                  key={k}
                  label={t(`adm.signups.f.${k}`)}
                  value={fmtNum(v, language)}
                  sub={i > 0 && prev > 0 ? `${fmtPct((v / prev) * 100)}` : undefined}
                  pct={(v / top) * 100}
                  color={k === 'created' ? RED : k === 'live' ? POS : undefined}
                />
              );
            })}
          </Card>
          <Card title={t('adm.signups.chart')} icon={Users} className="xl:col-span-2">
            <div style={{ height: 230 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                  <CartesianGrid stroke={F_BORDER} vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: T3, fontSize: 10.5 }} axisLine={false} tickLine={false} minTickGap={16} />
                  <YAxis tick={{ fill: T3, fontSize: 10.5 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={RECHARTS_TOOLTIP} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                  <Bar dataKey="started" name={t('adm.signups.chartStarted')} fill={CHART[3]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                  <Bar dataKey="created" name={t('adm.signups.chartCreated')} fill={RED} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center gap-4 mt-2 flex-wrap" style={{ fontSize: 11.5, color: T3 }}>
              <span className="inline-flex items-center gap-1.5"><Dot color={CHART[3]} />{t('adm.signups.chartStarted')}</span>
              <span className="inline-flex items-center gap-1.5"><Dot color={RED} />{t('adm.signups.chartCreated')}</span>
            </div>
            {(data?.by_source ?? []).length > 0 && (
              <div className="mt-4" style={{ borderTop: `1px solid ${F_BORDER}`, paddingTop: 10 }}>
                <div style={{ color: T2, fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{t('adm.signups.bySource')}</div>
                {(data?.by_source ?? []).slice(0, 6).map((s) => (
                  <DistRow
                    key={s.source}
                    label={s.source}
                    value={fmtNum(s.created, language)}
                    sub={t('adm.signups.bySourceLine').replace('{s}', fmtNum(s.started, language)).replace('{c}', fmtNum(s.created, language))}
                    pct={(s.started / Math.max(1, data?.by_source[0]?.started ?? 1)) * 100}
                  />
                ))}
              </div>
            )}
          </Card>
        </div>
      </Reveal>

      {/* 02 · Les inscrits */}
      <Reveal delay={0.1}>
        <SectionHeading
          n={2}
          label={t('adm.signups.s2')}
          icon={Users}
          right={
            <TabBar<Tab>
              value={tab}
              onChange={setTab}
              tabs={[
                { id: 'all', label: t('adm.signups.tabAll'), count: data?.rows.length ?? 0 },
                { id: 'accounts', label: t('adm.signups.tabAccounts'), count: (data?.rows ?? []).filter((r) => r.user_id).length },
                { id: 'leads', label: t('adm.signups.tabLeads'), count: (data?.rows ?? []).filter((r) => !r.user_id).length },
              ]}
            />
          }
        />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
          {rows.length === 0 && <div className="lg:col-span-2"><Card><EmptyState icon={UserPlus} text={t('adm.signups.empty')} /></Card></div>}
          {rows.map((r) => {
            const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || r.email || '—';
            const org = r.org_name || '—';
            const wa = r.phone
              ? whatsappUrl(intlPhone(r.phone, r.country), t(r.user_id ? 'adm.signups.waAccount' : 'adm.signups.waLead')
                  .replace('{name}', r.first_name || '').replace('{org}', org))
              : null;
            const openTo = r.venue_id ? `/admin/venues/${r.venue_id}` : r.user_id ? `/admin/people/${r.user_id}` : null;
            const facts = [
              r.city,
              r.size_band ? SIZE_LABEL[r.size_band] ?? r.size_band : null,
              r.frequency ? FREQ_LABEL[r.frequency] ?? r.frequency : null,
              r.current_tool && r.current_tool !== 'none'
                ? t('adm.signups.tool').replace('{t}', KNOWN_TOOLS[r.current_tool] ?? r.current_tool) : null,
              r.lang?.toUpperCase(),
              r.utm_source || r.source,
            ].filter(Boolean) as string[];
            return (
              <Card key={r.id} pad={16}>
                <div className="flex items-start gap-3">
                  <span
                    className="flex items-center justify-center flex-none"
                    style={{ width: 38, height: 38, borderRadius: 11, background: r.user_id ? 'rgba(232,25,44,0.12)' : INNER_BG, border: `1px solid ${r.user_id ? 'rgba(232,25,44,0.25)' : BORDER}`, color: r.user_id ? RED : T2 }}
                  >
                    {r.kind === 'club' ? <Building2 className="h-4 w-4" /> : <PartyPopper className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="truncate" style={{ color: T1, fontSize: 14.5, fontWeight: 650 }}>{org}</span>
                      <Pill size="sm" tone={r.user_id ? 'hot' : 'muted'}>{kindLabel(r.kind)}</Pill>
                      {r.contacted_at && <Pill size="sm" tone="pos" icon={Check}>{t('adm.signups.contacted')}</Pill>}
                    </div>
                    <div style={{ color: T2, fontSize: 12.5, marginTop: 2 }} className="truncate">
                      {name}{r.email && name !== r.email ? ` · ${r.email}` : ''}{r.phone ? ` · ${r.phone}` : ''}
                    </div>
                    {facts.length > 0 && <div style={{ color: T3, fontSize: 11.5, marginTop: 4 }}>{facts.join(' · ')}</div>}
                    {r.next_night && (
                      <div style={{ color: r.next_night === 'week' ? RED : r.next_night === 'month' ? WARN : T3, fontSize: 11.5, marginTop: 2, fontWeight: 560 }}>
                        {t(`adm.signups.nextNight.${r.next_night}`)}
                      </div>
                    )}
                  </div>
                  <span style={{ color: T3, fontSize: 11, flex: 'none' }}>{fmtRelative(r.account_created_at ?? r.updated_at, language)}</span>
                </div>

                {r.user_id ? (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {([
                      ['console', !!r.console_opened_at],
                      ['night', r.events > 0],
                      ['pay', r.payments],
                      ['live', r.live],
                    ] as const).map(([k, ok]) => (
                      <span
                        key={k}
                        className="inline-flex items-center gap-1"
                        style={{
                          fontSize: 11, padding: '3px 8px', borderRadius: 999,
                          color: ok ? POS : T3,
                          background: ok ? 'rgba(52,211,153,0.08)' : INNER_BG,
                          border: `1px solid ${ok ? 'rgba(52,211,153,0.22)' : F_BORDER}`,
                        }}
                      >
                        {ok && <Check className="h-3 w-3" />}{t(`adm.signups.p.${k}`)}
                        {k === 'night' && r.events > 1 ? ` · ${r.events}` : ''}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: WARN, fontSize: 11.5, marginTop: 10 }}>
                    {t('adm.signups.stoppedAt').replace('{s}', t(`adm.signups.step.${r.last_step ?? 'opened'}`))}
                  </div>
                )}

                {r.admin_notes && (
                  <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 10, background: INNER_BG, color: T2, fontSize: 12, whiteSpace: 'pre-wrap' }}>
                    {r.admin_notes}
                  </div>
                )}

                <div className="flex flex-wrap gap-1.5 mt-3">
                  {wa && <Btn size="sm" variant="subtle" icon={MessageCircle} href={wa}>{t('adm.signups.whatsapp')}</Btn>}
                  {r.email && <Btn size="sm" variant="subtle" icon={Mail} href={`mailto:${r.email}`}>Email</Btn>}
                  <Btn
                    size="sm" variant="ghost" icon={Check}
                    onClick={() => update(r.id, { p_contacted: !r.contacted_at })}
                  >
                    {r.contacted_at ? t('adm.signups.contacted') : t('adm.signups.markContacted')}
                  </Btn>
                  <Btn size="sm" variant="ghost" icon={StickyNote} onClick={() => { setNotesFor(r); setNotesDraft(r.admin_notes ?? ''); }}>
                    {t('adm.signups.notes')}
                  </Btn>
                  {openTo && <Btn size="sm" variant="ghost" icon={ExternalLink} to={openTo}>{t('adm.signups.open')}</Btn>}
                </div>
              </Card>
            );
          })}
        </div>
        {(data?.rows.length ?? 0) > 0 && (
          <p style={{ color: T3, fontSize: 11.5, marginTop: 10 }}>
            {fmtPlural(f?.leads ?? 0, language, t('adm.signups.leadsOne'), t('adm.signups.leadsMany'))}
          </p>
        )}
      </Reveal>

      <Modal
        open={!!notesFor}
        onClose={() => setNotesFor(null)}
        title={t('adm.signups.notes')}
        subtitle={notesFor?.org_name ?? undefined}
        footer={
          <Btn
            variant="primary" loading={saving}
            onClick={async () => {
              if (!notesFor) return;
              setSaving(true);
              const ok = await update(notesFor.id, { p_notes: notesDraft });
              setSaving(false);
              if (ok) setNotesFor(null);
            }}
          >
            {t('adm.signups.save')}
          </Btn>
        }
      >
        <textarea
          value={notesDraft}
          onChange={(e) => setNotesDraft(e.target.value)}
          placeholder={t('adm.signups.notesPh')}
          rows={6}
          maxLength={2000}
          style={{ ...INPUT_STYLE, width: '100%', resize: 'vertical', minHeight: 120 }}
        />
      </Modal>
    </AdminPage>
  );
}
