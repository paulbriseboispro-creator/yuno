import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import type { Language } from '@/i18n/data';
import { useAdminScope } from '@/components/admin/AdminScope';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  AlertTriangle, Bell, Building2, CalendarPlus, Check, ChevronDown, ExternalLink, Filter, Mail, MessageCircle,
  PartyPopper, Percent, Phone, RefreshCw, StickyNote, UserPlus, Users,
} from 'lucide-react';
import {
  AdminPage, Btn, Card, DistRow, Dot, EmptyState, ErrorState, Modal, PageSkeleton, PeriodFilter,
  Pill, RECHARTS_TOOLTIP, RED, POS, WARN, T1, T2, T3, F_BORDER, INNER_BG, BORDER, CHART,
  Reveal, SectionHeading, Stat, TabBar, INPUT_STYLE,
} from '@/components/admin/ui';
import { fmtAxisDay, fmtDate, fmtNum, fmtPct, fmtPlural, fmtRelative } from '@/lib/adminFormat';
import { whatsappUrl } from '@/lib/yunoLinks';
import { KNOWN_TOOLS, PRO_SIGNUP_ORIGIN } from '@/lib/proSignup';
import {
  KNOWN_DEVICES, alertChannels, journeyResult, personPhones, sourceRows, sourceText,
  type SignupOrigin, type SignupPerson,
} from '@/lib/proSignupPeople';

// ─── Inscriptions pro ─────────────────────────────────────────────────────────
// Une carte par PERSONNE (migration 20261104220000) : les parcours d'une même
// personne (même e-mail, même numéro, même appareil le même jour) sont
// regroupés en base. La carte dit d'abord ce qui s'est passé (compte ouvert,
// bloqué, supprimé, demande), puis comment la joindre, d'où elle vient, si
// Paul l'a invitée et s'il a été alerté ; les parcours sont repliés dessous.
// Le funnel, la courbe et les sources comptent des personnes, robots écartés
// (migration 20261104230000 : navigateur robot / piloté / de test, ou
// ouverture anonyme en rafale ; un contact laissé compte toujours).

type Period = '7' | '30' | '90' | '365';
type Tab = 'all' | 'accounts' | 'none';

interface Funnel {
  opened: number; role: number; structure: number; email: number; created: number; console: number;
  first_event: number; payments: number; live: number; accounts: number; clubs: number; organizers: number;
  invited_accounts: number; deleted: number; leads: number; to_contact: number;
  /** Personnes écartées comme robots sur la période (absent avant 20261104230000). */
  robots?: number;
}
interface Payload {
  funnel: Funnel;
  by_day: { d: string; started: number; created: number }[];
  by_source: { origin: SignupOrigin | null; started: number; created: number }[];
  people?: SignupPerson[];
}
type T = (key: string) => string;

const FUNNEL_STEPS = ['opened', 'role', 'structure', 'email', 'created', 'console', 'first_event', 'payments', 'live'] as const;

const SIZE_LABEL: Record<string, string> = {
  lt300: '< 300', '300_800': '300–800', '800_1500': '800–1 500', gt1500: '1 500+',
  lt200: '< 200', '200_500': '200–500', '500_1500': '500–1 500',
};
const FREQ_LABEL: Record<string, string> = { '1': '1', '2_4': '2–4', '5plus': '5+', '5_plus': '5+' };

export default function AdminProSignups() {
  const { t, language } = useLanguage();
  const { includeDemo } = useAdminScope();
  const [period, setPeriod] = useState<Period>('30');
  const [tab, setTab] = useState<Tab>('all');
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notesFor, setNotesFor] = useState<SignupPerson | null>(null);
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

  // « Contacté » et la note valent pour la personne : écrits sur tous ses parcours.
  const update = useCallback(async (person: SignupPerson, patch: { p_contacted?: boolean; p_notes?: string }) => {
    const { error: e } = await supabase.rpc('admin_update_pro_signups' as never, { p_ids: person.ids, ...patch } as never);
    if (e) { setError(e.message); return false; }
    setData((prev) => prev && ({
      ...prev,
      people: (prev.people ?? []).map((p) => p.key !== person.key ? p : {
        ...p,
        contacted_at: patch.p_contacted === undefined ? p.contacted_at : patch.p_contacted ? (p.contacted_at ?? new Date().toISOString()) : null,
        admin_notes: patch.p_notes === undefined ? p.admin_notes : (patch.p_notes.trim() || null),
      }),
    }));
    return true;
  }, []);

  const f = data?.funnel;
  const people = useMemo(() => data?.people ?? [], [data]);
  const withAccount = useMemo(() => people.filter((p) => p.outcome === 'account'), [people]);
  const shown = tab === 'accounts' ? withAccount : tab === 'none' ? people.filter((p) => p.outcome !== 'account') : people;

  const chart = useMemo(
    () => (data?.by_day ?? []).map((d) => ({ ...d, label: fmtAxisDay(d.d, language) })),
    [data, language],
  );
  const sources = useMemo(() => sourceRows(data?.by_source ?? [], t), [data, t]);

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
  const accountsSub = t('adm.signups.accountsSub')
    .replace('{c}', fmtNum(f?.clubs ?? 0, language)).replace('{o}', fmtNum(f?.organizers ?? 0, language))
    + ((f?.invited_accounts ?? 0) > 0 ? t('adm.signups.accountsInvited').replace('{n}', fmtNum(f?.invited_accounts ?? 0, language)) : '');

  return (
    <AdminPage {...pageProps}>
      {/* 01 · Qui s'est inscrit : quatre chiffres, puis une carte par personne */}
      <Reveal>
        <SectionHeading n={1} label={t('adm.signups.s1')} icon={Users} accent />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
          <Stat
            label={t('adm.signups.accounts')} value={fmtNum(f?.accounts ?? 0, language)} icon={UserPlus} highlight
            sub={accountsSub}
            spark={(data?.by_day ?? []).slice(-14).map((d) => d.created)} sparkAccent
          />
          <Stat
            label={t('adm.signups.toContact')} value={fmtNum(f?.to_contact ?? 0, language)} icon={Phone}
            tone={(f?.to_contact ?? 0) > 0 ? 'warn' : undefined} sub={t('adm.signups.toContactSub')}
          />
          <Stat
            label={t('adm.signups.activated')} value={fmtNum(f?.first_event ?? 0, language)} icon={CalendarPlus}
            tone={(f?.first_event ?? 0) > 0 ? 'pos' : undefined}
            sub={t('adm.signups.activatedSub').replace('{n}', fmtNum(f?.payments ?? 0, language))}
          />
          <Stat label={t('adm.signups.conversion')} value={fmtPct(conv)} icon={Percent} sub={t('adm.signups.conversionSub')} />
        </div>
        <p style={{ color: T3, fontSize: 11.5, marginTop: 10, maxWidth: 880 }}>{t('adm.signups.peopleHint')}</p>

        <div className="mt-4">
          <TabBar<Tab>
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'all', label: t('adm.signups.tabAll'), count: people.length },
              { id: 'accounts', label: t('adm.signups.tabAccounts'), count: withAccount.length },
              { id: 'none', label: t('adm.signups.tabNoAccount'), count: people.length - withAccount.length },
            ]}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3 items-start">
          {shown.length === 0 && <div className="lg:col-span-2"><Card><EmptyState icon={UserPlus} text={t('adm.signups.empty')} /></Card></div>}
          {shown.map((p) => (
            <PersonCard
              key={p.key}
              p={p}
              t={t}
              language={language}
              onContacted={() => update(p, { p_contacted: !p.contacted_at })}
              onNotes={() => { setNotesFor(p); setNotesDraft(p.admin_notes ?? ''); }}
            />
          ))}
        </div>
      </Reveal>

      {/* 02 · Où ça bloque : funnel, courbe et provenances, en personnes */}
      <Reveal delay={0.1}>
        <SectionHeading n={2} label={t('adm.signups.s2')} icon={Filter} />
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-3">
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
                  sub={i > 0 && prev > 0 ? fmtPct((v / prev) * 100) : undefined}
                  pct={(v / top) * 100}
                  color={k === 'created' ? RED : k === 'live' ? POS : undefined}
                />
              );
            })}
            {(f?.robots ?? 0) > 0 && (
              <p style={{ color: T3, fontSize: 11.5, margin: '12px 0 0' }}>
                {fmtPlural(f?.robots ?? 0, language, t('adm.signups.funnelRobotsOne'), t('adm.signups.funnelRobots'))}
              </p>
            )}
          </Card>
          <Card title={t('adm.signups.chart')} subtitle={t('adm.signups.chartHint')} icon={Users} className="xl:col-span-2">
            <div style={{ height: 230 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                  <CartesianGrid stroke={F_BORDER} vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: T3, fontSize: 10.5 }} axisLine={false} tickLine={false} minTickGap={16} />
                  <YAxis tick={{ fill: T3, fontSize: 10.5 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={RECHARTS_TOOLTIP} cursor={{ fill: 'rgb(var(--ink)/0.03)' }} />
                  <Bar dataKey="started" name={t('adm.signups.chartStarted')} fill={CHART[3]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                  <Bar dataKey="created" name={t('adm.signups.chartCreated')} fill={RED} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center gap-4 mt-2 flex-wrap" style={{ fontSize: 11.5, color: T3 }}>
              <span className="inline-flex items-center gap-1.5"><Dot color={CHART[3]} />{t('adm.signups.chartStarted')}</span>
              <span className="inline-flex items-center gap-1.5"><Dot color={RED} />{t('adm.signups.chartCreated')}</span>
            </div>
            {sources.length > 0 && (
              <div className="mt-4" style={{ borderTop: `1px solid ${F_BORDER}`, paddingTop: 10 }}>
                <div style={{ color: T2, fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{t('adm.signups.bySource')}</div>
                {sources.slice(0, 8).map((s) => (
                  <DistRow
                    key={s.label}
                    label={s.label}
                    value={fmtNum(s.started, language)}
                    sub={t('adm.signups.bySourceLine').replace('{c}', fmtNum(s.created, language))}
                    pct={(s.started / Math.max(1, sources[0]?.started ?? 1)) * 100}
                  />
                ))}
              </div>
            )}
          </Card>
        </div>
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
              const ok = await update(notesFor, { p_notes: notesDraft });
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

// ─── Une personne ────────────────────────────────────────────────────────────

function PersonCard({ p, t, language, onContacted, onNotes }: {
  p: SignupPerson; t: T; language: Language; onContacted: () => void; onNotes: () => void;
}) {
  const [open, setOpen] = useState(false);
  const phones = personPhones(p.phones, p.country);
  const name = [p.first_name, p.last_name].filter(Boolean).join(' ');
  const title = p.org_name || name || p.email || phones[0]?.pretty || '—';
  const kindKey = p.kind === 'club' || p.kind === 'organizer' || p.kind === 'promoter' ? p.kind : 'other';
  const retries = p.retries_after_account;
  const acc = p.account;

  const waText = t(retries > 0 ? 'adm.signups.waRetry' : acc ? 'adm.signups.waAccount' : 'adm.signups.waLead')
    .replace('{name}', p.first_name || '').replace('{org}', p.org_name || '');
  const wa = phones[0] ? whatsappUrl(phones[0].wa, waText) : null;
  const openTo = acc?.venue_id ? `/admin/venues/${acc.venue_id}` : acc?.user_id ? `/admin/people/${acc.user_id}` : null;

  // Ce qui s'est passé, en premier.
  const outcome = (() => {
    switch (p.outcome) {
      case 'account': return { text: t('adm.signups.outcome.account').replace('{d}', fmtDate(acc?.created_at, language, 'datetime')), color: POS, icon: Check };
      case 'deleted': return { text: t('adm.signups.outcome.deleted'), color: T3, icon: null };
      case 'request': return { text: t('adm.signups.outcome.request'), color: T2, icon: null };
      case 'invited': return { text: t('adm.signups.outcome.invited'), color: T2, icon: null };
      default: return { text: t('adm.signups.outcome.blocked').replace('{s}', t(`adm.signups.step.${p.furthest_step ?? 'opened'}`)), color: WARN, icon: AlertTriangle };
    }
  })();

  const invite = p.invited && p.invite
    ? [t('adm.signups.invited'),
       p.invite.source === 'demo_preview' ? t('adm.signups.invite.demo')
         : p.invite.offer === 'founder' ? t('adm.signups.invite.founder')
         : p.invite.offer ? t('adm.signups.invite.standard') : null,
      ].filter(Boolean).join(' · ')
    : null;

  const facts = [
    p.city,
    p.size_band ? SIZE_LABEL[p.size_band] ?? p.size_band : null,
    p.frequency && FREQ_LABEL[p.frequency] ? t('adm.signups.perMonth').replace('{n}', FREQ_LABEL[p.frequency]) : null,
    p.current_tool && p.current_tool !== 'none' ? t('adm.signups.tool').replace('{t}', KNOWN_TOOLS[p.current_tool] ?? p.current_tool) : null,
    p.lang?.toUpperCase(),
  ].filter(Boolean) as string[];

  // Ce qu'il faut savoir avant d'appeler.
  const warnings: { text: string; color: string }[] = [];
  if (retries > 0) warnings.push({ text: fmtPlural(retries, language, t('adm.signups.retriesOne'), t('adm.signups.retriesMany')), color: WARN });
  if (acc && p.deleted_accounts > 0) warnings.push({ text: t('adm.signups.recreated'), color: T2 });
  if (phones.length > 1) warnings.push({ text: t('adm.signups.twoPhones').replace('{p}', phones.map((x) => x.pretty).join(' / ')), color: T2 });
  if (p.next_night && p.outcome !== 'deleted') {
    warnings.push({ text: t(`adm.signups.nextNight.${p.next_night}`), color: p.next_night === 'week' ? RED : p.next_night === 'month' ? WARN : T3 });
  }

  const lastAlert = p.alerts[0];
  const alertLine = lastAlert
    ? lastAlert.status === 'sent'
      ? [
          t('adm.signups.alerted').replace('{d}', fmtDate(lastAlert.sent_at ?? lastAlert.at, language, 'datetime')),
          t(`adm.signups.alert.${lastAlert.kind}`),
          alertChannels(lastAlert).map((c) => t(`adm.signups.ch.${c}`)).join(', '),
          p.alerts.length > 1 ? t('adm.signups.alertsMany').replace('{n}', fmtNum(p.alerts.length, language)) : null,
        ].filter(Boolean).join(' · ')
      : t(lastAlert.status === 'failed' ? 'adm.signups.alertFailed' : 'adm.signups.alertPending')
    : null;

  const contact = [name && name !== title ? name : null, p.email && p.email !== title ? p.email : null].filter(Boolean).join(' · ');

  return (
    <Card pad={16}>
      <div className="flex items-start gap-3">
        <span
          className="flex items-center justify-center flex-none"
          style={{ width: 38, height: 38, borderRadius: 11, background: acc ? 'rgba(232,25,44,0.12)' : INNER_BG, border: `1px solid ${acc ? 'rgba(232,25,44,0.25)' : BORDER}`, color: acc ? RED : T2 }}
        >
          {p.kind === 'club' ? <Building2 className="h-4 w-4" /> : <PartyPopper className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="truncate" style={{ color: T1, fontSize: 14.5, fontWeight: 650 }}>{title}</span>
            <Pill size="xs" tone={acc ? 'hot' : 'muted'}>{t(`adm.signups.kind.${kindKey}`)}</Pill>
            {p.product === 'crm' && <Pill size="xs" tone="default">{t('adm.signups.product.crm')}</Pill>}
            {invite && <Pill size="xs" tone="accent">{invite}</Pill>}
            {p.contacted_at && <Pill size="xs" tone="pos" icon={Check}>{t('adm.signups.contacted')}</Pill>}
          </div>
          <div className="flex items-center gap-1.5 mt-1" style={{ color: outcome.color, fontSize: 12.5, fontWeight: 600 }}>
            {outcome.icon && <outcome.icon className="h-3.5 w-3.5 flex-none" />}
            <span>{outcome.text}</span>
          </div>
        </div>
        <span style={{ color: T3, fontSize: 11, flex: 'none' }} title={fmtDate(p.last_at, language, 'datetime')}>{fmtRelative(p.last_at, language)}</span>
      </div>

      <div style={{ marginTop: 10, fontSize: 12.5, color: T2 }} className="space-y-0.5">
        {contact && <div className="truncate">{contact}</div>}
        <div className="flex items-center gap-1.5 flex-wrap">
          {phones.length > 0
            ? <span style={{ color: T1, fontWeight: 560 }} className="tabular-nums">{phones[0].pretty}</span>
            : <span style={{ color: T3 }}>{t('adm.signups.noPhone')}</span>}
        </div>
        <div style={{ color: T3, fontSize: 11.5 }}>
          {t('adm.signups.via').replace('{s}', sourceText(p.origin, t))}
          {facts.length > 0 ? ` · ${facts.join(' · ')}` : ''}
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="mt-2 space-y-1">
          {warnings.map((w) => <div key={w.text} style={{ color: w.color, fontSize: 11.5, fontWeight: 560 }}>{w.text}</div>)}
        </div>
      )}

      {acc && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {([
            ['console', !!acc.console_opened_at],
            ['night', acc.events > 0],
            ['pay', acc.payments],
            ['live', acc.live],
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
              {k === 'night' && acc.events > 1 ? ` · ${acc.events}` : ''}
            </span>
          ))}
        </div>
      )}

      {alertLine && (
        <div className="flex items-center gap-1.5 mt-2.5" style={{ color: T3, fontSize: 11.5 }}>
          <Bell className="h-3 w-3 flex-none" /><span>{alertLine}</span>
        </div>
      )}

      {p.admin_notes && (
        <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 10, background: INNER_BG, color: T2, fontSize: 12, whiteSpace: 'pre-wrap' }}>
          {p.admin_notes}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 mt-3">
        {wa && <Btn size="sm" variant="subtle" icon={MessageCircle} href={wa}>{t('adm.signups.whatsapp')}</Btn>}
        {phones[0] && <Btn size="sm" variant="subtle" icon={Phone} href={`tel:${phones[0].e164}`}>{t('adm.signups.call')}</Btn>}
        {p.email && <Btn size="sm" variant="subtle" icon={Mail} href={`mailto:${p.email}`}>Email</Btn>}
        <Btn size="sm" variant="ghost" icon={Check} onClick={onContacted}>
          {p.contacted_at ? t('adm.signups.contacted') : t('adm.signups.markContacted')}
        </Btn>
        <Btn size="sm" variant="ghost" icon={StickyNote} onClick={onNotes}>{t('adm.signups.notes')}</Btn>
        {openTo && <Btn size="sm" variant="ghost" icon={ExternalLink} to={openTo}>{t('adm.signups.open')}</Btn>}
      </div>

      {/* Les parcours, repliés : le plus récent en haut */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 mt-3 w-full text-left"
        style={{ color: T3, fontSize: 11.5, borderTop: `1px solid ${F_BORDER}`, paddingTop: 10 }}
        aria-expanded={open}
      >
        <ChevronDown className="h-3.5 w-3.5 transition-transform" style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
        {fmtPlural(p.journeys.length, language, t('adm.signups.journeysOne'), t('adm.signups.journeysMany'))}
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          {p.journeys.map((j) => {
            const r = journeyResult(j);
            const resultText = r.key === 'stopped'
              ? t('adm.signups.j.stopped').replace('{s}', t(`adm.signups.step.${r.step}`))
              : t(`adm.signups.j.${r.key}`);
            const meta = [
              sourceText(j, t),
              j.device && KNOWN_DEVICES.has(j.device) ? t(`adm.signups.dev.${j.device}`) : null,
              j.has_email ? null : t('adm.signups.j.noEmail'),
            ].filter(Boolean).join(' · ');
            return (
              <div key={j.id} className="flex items-baseline gap-2" style={{ fontSize: 11.5 }}>
                <span className="tabular-nums flex-none" style={{ color: T2, minWidth: 92 }}>{fmtDate(j.at, language, 'datetime')}</span>
                <span className="min-w-0 flex-1" style={{ color: T3 }}>
                  <span style={{ color: r.key === 'account' ? POS : r.key === 'stopped' ? T2 : T3, fontWeight: 560 }}>{resultText}</span>
                  {meta ? ` · ${meta}` : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
