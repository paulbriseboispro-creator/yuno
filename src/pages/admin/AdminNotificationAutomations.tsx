/**
 * /admin/notifications — le MOTEUR de notifications Yuno, piloté par le super
 * admin (docs/designs/NOTIFICATION_ENGINE_PLAN.md).
 *
 *   Moteur   : ce qui est parti (30 j), la santé de la file, la politique
 *              anti-spam (heures calmes, plafonds, fatigue, budget par soirée).
 *   Règles   : les neuf étapes du cycle de vie d'une soirée — interrupteur,
 *              réglages, textes FR/EN/ES par raison, chiffres.
 *   Système  : les notifications unitaires hors soirée (achat, remboursement,
 *              pro, découverte…) — le registre historique.
 *   Crédits  : campagnes manuelles des pros (allocation, bonus, demandes).
 *
 * Tous les chiffres viennent d'une RPC (`admin_push_engine_overview`,
 * `get_auto_push_stats`, `admin_push_credit_accounts`) ; la démo est exclue
 * côté serveur.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  BellRing, Coins, Cpu, Gauge, Gift, Inbox, ListChecks, MousePointerClick, RefreshCw, RotateCcw, Save, Search,
  ShieldCheck, ShoppingBag, Sliders, Type, Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTabParam } from '@/hooks/useTabParam';
import {
  AdminPage, Card, Stat, TabBar, Toggle, Btn, Pill, DistRow, EmptyState, ErrorState, PageSkeleton, Reveal,
  TableWrap, Th, Td, Dot, Field, Inner, Notice, INPUT_STYLE, T1, T2, T3, POS, WARN, F_BORDER, CHART, RECHARTS_TOOLTIP,
} from '@/components/admin/ui';
import { fmtNum, fmtEur, fmtPct, fmtDate, fmtRelative, fmtAxisDay } from '@/lib/adminFormat';
import { ENGINE_RULES, tapRate } from '@/lib/pushEngine';

type Tab = 'engine' | 'rules' | 'system' | 'credits';
const TABS: readonly Tab[] = ['engine', 'rules', 'system', 'credits'] as const;

interface RuleStats {
  key: string; enabled: boolean; params: Record<string, number>;
  sent: number; taps: number; buyers: number; revenue: number; queued: number; held: number;
  heldBy: Record<string, number>; lastAt: string | null;
}
interface EngineOverview {
  ok: true; days: number;
  settings: Record<string, number>;
  totals: { sent: number; taps: number; buyers: number; revenue: number; held: number; boughtBefore: number };
  queue: { pending: number; dueNow: number; claimed: number; oldestDue: string | null; holds: Record<string, number> };
  rules: RuleStats[];
  series: { day: string; sent: number; taps: number }[];
}
interface TemplateRow { rule_key: string; variant: string; reason: string; lang: string; title: string; body: string; default_title: string; default_body: string }
interface CreditAccount {
  scope: string; kind: 'venue' | 'org' | 'agency'; name: string | null;
  allowance: number; defaultAllowance: number; override: boolean; used: number; bonus: number; remaining: number; lastRequestAt: string | null;
}
interface KeyStats { notification_key: string; sent_total: number; failed_total: number; clicked_total: number; sent_30d: number; failed_30d: number; clicked_30d: number; last_sent_at: string | null }

const POLICY_FIELDS = ['quiet_start', 'quiet_end', 'daily_cap', 'weekly_cap', 'weekly_cap_engaged', 'weekly_cap_fatigued', 'fatigue_sent', 'fatigue_days', 'urgent_daily_cap', 'per_event_max'] as const;
const CREDIT_FIELDS = ['credits_venue', 'credits_org', 'credits_agency', 'event_info_per_event', 'manual_per_24h'] as const;

// Notifications unitaires hors soirée (registre historique) — le moteur tient
// les règles de soirée, celles-ci restent des interrupteurs simples.
type SysCategory = 'transactional' | 'reminder' | 'engagement' | 'marketing';
const SYSTEM_CATALOG: { key: string; category: SysCategory; dormant?: boolean }[] = [
  { key: 'purchase_ticket', category: 'transactional' },
  { key: 'purchase_table', category: 'transactional' },
  { key: 'order_ready', category: 'transactional' },
  { key: 'refund_confirmed', category: 'transactional' },
  { key: 'guest_list_added', category: 'transactional' },
  { key: 'waitlist_presale', category: 'transactional' },
  { key: 'promoter_announcement', category: 'transactional' },
  { key: 'promoter_commission_cancelled', category: 'transactional' },
  { key: 'promoter_payout_declared', category: 'transactional' },
  { key: 'promoter_payout_confirmed', category: 'transactional' },
  { key: 'promoter_payout_disputed', category: 'transactional' },
  { key: 'collab_amendment_proposed', category: 'transactional' },
  { key: 'collab_amendment_signed', category: 'transactional' },
  { key: 'dj_booking_request', category: 'transactional' },
  { key: 'promoter_payout_reminder', category: 'reminder' },
  { key: 'door_manifest_preload', category: 'reminder' },
  { key: 'dj_lineup', category: 'engagement' },
  { key: 'promoter_goal_reached', category: 'engagement' },
  { key: 'promoter_sale_first', category: 'engagement' },
  { key: 'promoter_night_digest', category: 'engagement' },
  { key: 'promoter_team_override', category: 'engagement' },
  { key: 'promoter_event_assigned', category: 'engagement' },
  { key: 'audience_weekly_recap', category: 'engagement' },
  { key: 'taste_discovery', category: 'marketing' },
  { key: 'inactivity_reminder', category: 'marketing' },
  { key: 'cart_abandonment_drinks', category: 'marketing' },
  { key: 'email_missed_you', category: 'marketing' },
  { key: 'email_next_event_rec', category: 'marketing' },
  { key: 'weekly_digest', category: 'marketing', dormant: true },
  { key: 'discovery_week', category: 'marketing', dormant: true },
  { key: 'discovery_weekend', category: 'marketing', dormant: true },
];

export default function AdminNotificationAutomations() {
  const { t, language } = useLanguage();
  const [tab, setTab] = useTabParam<Tab>('engine', TABS);
  const [days, setDays] = useState(30);
  const [data, setData] = useState<EngineOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const { data: d, error: e } = await supabase.rpc('admin_push_engine_overview' as never, { p_days: days } as never);
    const res = d as unknown as EngineOverview | { ok: false } | null;
    if (e || !res || !res.ok) setError(e?.message ?? t('adm.common.error'));
    else setData(res);
    setLoading(false);
  }, [days, t]);
  useEffect(() => { load(); }, [load]);

  const header = (
    <>
      <div className="inline-flex rounded-xl p-1" style={{ background: 'rgb(var(--ink)/0.032)', border: `1px solid ${F_BORDER}` }}>
        {[7, 30, 90].map((d) => (
          <button key={d} type="button" onClick={() => setDays(d)} className="rounded-lg px-3 py-1.5 text-[12px] font-medium"
            style={d === days ? { background: 'rgb(var(--ink)/0.1)', color: T1 } : { color: T3 }}>
            {t('adm.engine.days').replace('{n}', String(d))}
          </button>
        ))}
      </div>
      <Btn onClick={load} icon={RefreshCw} loading={loading}>{t('adm.common.refresh')}</Btn>
    </>
  );

  return (
    <AdminPage eyebrow={t('adm.engine.eyebrow')} title={t('adm.engine.title')} subtitle={t('adm.engine.subtitle')} actions={header}>
      <TabBar<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'engine', label: t('adm.engine.tab.engine'), icon: Cpu },
          { id: 'rules', label: t('adm.engine.tab.rules'), icon: ListChecks },
          { id: 'system', label: t('adm.engine.tab.system'), icon: BellRing },
          { id: 'credits', label: t('adm.engine.tab.credits'), icon: Coins },
        ]}
      />
      {tab === 'system' ? <SystemTab /> : loading && !data ? <PageSkeleton tiles={6} blocks={2} /> : error || !data ? (
        <Card><ErrorState text={error ?? t('adm.common.error')} onRetry={load} retryLabel={t('adm.common.retry')} /></Card>
      ) : tab === 'engine' ? (
        <EngineTab data={data} language={language} onSaved={load} />
      ) : tab === 'rules' ? (
        <RulesTab data={data} onSaved={load} />
      ) : (
        <CreditsTab settings={data.settings} onSaved={load} />
      )}
    </AdminPage>
  );
}

// ─── Moteur ──────────────────────────────────────────────────────────────────
function EngineTab({ data, language, onSaved }: { data: EngineOverview; language: 'fr' | 'en' | 'es'; onSaved: () => void }) {
  const { t } = useLanguage();
  const tot = data.totals;
  const rate = tapRate(tot.taps, tot.sent);
  const chart = useMemo(() => data.series.map((s) => ({ ...s, label: fmtAxisDay(s.day.slice(0, 10), language) })), [data.series, language]);
  const holds = Object.entries(data.queue.holds).sort((a, b) => b[1] - a[1]);
  const maxHold = Math.max(1, ...holds.map(([, v]) => v));

  return (
    <div className="space-y-5">
      <Reveal>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <Stat label={t('adm.engine.sent')} value={fmtNum(tot.sent, language)} icon={BellRing} highlight />
          <Stat label={t('adm.engine.opened')} value={fmtNum(tot.taps, language)} icon={MousePointerClick} sub={rate == null ? undefined : t('adm.engine.rate').replace('{pct}', fmtPct(rate))} />
          <Stat label={t('adm.engine.buyers')} value={fmtNum(tot.buyers, language)} icon={Users} tone={tot.buyers > 0 ? 'pos' : undefined} />
          <Stat label={t('adm.engine.revenue')} value={fmtEur(tot.revenue, language)} icon={ShoppingBag} sub={t('adm.engine.revenueHint')} />
          <Stat label={t('adm.engine.held')} value={fmtNum(tot.held, language)} icon={ShieldCheck} sub={t('adm.engine.heldHint')} />
          <Stat label={t('adm.engine.boughtBefore')} value={fmtNum(tot.boughtBefore, language)} icon={Gift} sub={t('adm.engine.boughtBeforeHint')} />
        </div>
      </Reveal>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Reveal delay={0.05} className="xl:col-span-2">
          <Card title={t('adm.engine.byDay')} subtitle={t('adm.engine.byDayHint')} icon={BellRing}>
            {chart.every((c) => c.sent === 0) ? (
              <EmptyState icon={Inbox} text={t('adm.engine.noSends')} />
            ) : (
              <>
                <div style={{ height: 220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chart} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                      <CartesianGrid stroke={F_BORDER} vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: T3, fontSize: 10.5 }} axisLine={false} tickLine={false} interval={chart.length > 14 ? 4 : 0} />
                      <YAxis yAxisId="s" tick={{ fill: T3, fontSize: 10.5 }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <YAxis yAxisId="t" orientation="right" hide />
                      <Tooltip contentStyle={RECHARTS_TOOLTIP} cursor={{ fill: 'rgb(var(--ink)/0.03)' }} />
                      <Bar yAxisId="s" dataKey="sent" name={t('adm.engine.sent')} fill={CHART[0]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                      <Line yAxisId="t" type="monotone" dataKey="taps" name={t('adm.engine.opened')} stroke={POS} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex items-center gap-4 mt-2" style={{ fontSize: 11.5, color: T3 }}>
                  <span className="inline-flex items-center gap-1.5"><Dot color={CHART[0]} />{t('adm.engine.sent')}</span>
                  <span className="inline-flex items-center gap-1.5"><Dot color={POS} />{t('adm.engine.opened')}</span>
                </div>
              </>
            )}
          </Card>
        </Reveal>
        <Reveal delay={0.1}>
          <Card title={t('adm.engine.queue')} subtitle={t('adm.engine.queueHint')} icon={Gauge}>
            <div className="grid grid-cols-3 gap-2 mb-4">
              <Inner pad="10px 12px"><p style={{ color: T3, fontSize: 11 }}>{t('adm.engine.pending')}</p><p className="tabular-nums" style={{ color: T1, fontSize: 20, fontWeight: 640 }}>{fmtNum(data.queue.pending, language)}</p></Inner>
              <Inner pad="10px 12px"><p style={{ color: T3, fontSize: 11 }}>{t('adm.engine.dueNow')}</p><p className="tabular-nums" style={{ color: T1, fontSize: 20, fontWeight: 640 }}>{fmtNum(data.queue.dueNow, language)}</p></Inner>
              <Inner pad="10px 12px"><p style={{ color: T3, fontSize: 11 }}>{t('adm.engine.claimed')}</p><p className="tabular-nums" style={{ color: data.queue.claimed > 0 ? WARN : T1, fontSize: 20, fontWeight: 640 }}>{fmtNum(data.queue.claimed, language)}</p></Inner>
            </div>
            {data.queue.oldestDue && (
              <p style={{ color: T3, fontSize: 11.5, marginBottom: 12 }}>{t('adm.engine.oldestDue').replace('{when}', fmtRelative(data.queue.oldestDue, language))}</p>
            )}
            {holds.length === 0 ? (
              <p style={{ color: T3, fontSize: 12 }}>{t('adm.engine.noHolds')}</p>
            ) : (
              <div className="space-y-2.5">
                {holds.map(([k, v]) => (
                  <DistRow key={k} label={holdLabel(t, k)} value={fmtNum(v, language)} pct={(v / maxHold) * 100} />
                ))}
              </div>
            )}
          </Card>
        </Reveal>
      </div>

      <SettingsForm
        title={t('adm.engine.policy')}
        subtitle={t('adm.engine.policyHint')}
        icon={Sliders}
        fields={POLICY_FIELDS}
        settings={data.settings}
        onSaved={onSaved}
      />
    </div>
  );
}

function holdLabel(t: (k: string) => string, key: string): string {
  const k = `adm.engine.hold.${key}`;
  const v = t(k);
  return v === k ? key : v;
}

function SettingsForm({ title, subtitle, icon, fields, settings, onSaved }: {
  title: string; subtitle: string; icon: typeof Sliders;
  fields: readonly string[]; settings: Record<string, number>; onSaved: () => void;
}) {
  const { t } = useLanguage();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setValues(Object.fromEntries(fields.map((f) => [f, String(settings?.[f] ?? '')])));
  }, [fields, settings]);
  const dirty = fields.filter((f) => values[f] !== undefined && values[f] !== String(settings?.[f] ?? ''));

  const save = async () => {
    const patch: Record<string, number> = {};
    for (const f of dirty) {
      const n = Number(values[f]);
      if (!Number.isFinite(n)) { toast.error(t('adm.engine.badNumber')); return; }
      patch[f] = Math.round(n);
    }
    setSaving(true);
    const { error } = await supabase.rpc('admin_set_push_engine_settings' as never, { p_patch: patch } as never);
    setSaving(false);
    if (error) { toast.error(`${t('adm.engine.saveError')} ${error.message}`); return; }
    toast.success(t('adm.engine.saved'));
    onSaved();
  };

  return (
    <Card title={title} subtitle={subtitle} icon={icon} right={<Btn variant="primary" icon={Save} onClick={save} disabled={dirty.length === 0} loading={saving}>{t('adm.engine.save')}</Btn>}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {fields.map((f) => (
          <Field key={f} label={t(`adm.engine.set.${f}`)} hint={t(`adm.engine.setHint.${f}`)}>
            <input
              type="number"
              inputMode="numeric"
              value={values[f] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
              style={{ ...INPUT_STYLE, borderColor: dirty.includes(f) ? 'rgba(232,25,44,0.45)' : undefined }}
            />
          </Field>
        ))}
      </div>
    </Card>
  );
}

// ─── Règles ──────────────────────────────────────────────────────────────────
function RulesTab({ data, onSaved }: { data: EngineOverview; onSaved: () => void }) {
  const { t } = useLanguage();
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const loadTemplates = useCallback(async () => {
    const { data: rows } = await supabase
      .from('push_rule_templates' as never)
      .select('rule_key, variant, reason, lang, title, body, default_title, default_body')
      .order('rule_key').order('variant').order('reason').order('lang');
    setTemplates(((rows as unknown) as TemplateRow[]) ?? []);
  }, []);
  useEffect(() => { loadTemplates(); }, [loadTemplates]);
  const byKey = new Map(data.rules.map((r) => [r.key, r]));

  return (
    <div className="space-y-4">
      <Notice icon={ListChecks}>{t('adm.engine.rulesIntro')}</Notice>
      {ENGINE_RULES.map(({ key, emoji }) => {
        const rule = byKey.get(key);
        if (!rule) return null;
        return (
          <RuleCard
            key={key}
            emoji={emoji}
            rule={rule}
            templates={templates.filter((tp) => tp.rule_key === key)}
            onSaved={onSaved}
            onTemplatesSaved={loadTemplates}
          />
        );
      })}
    </div>
  );
}

function RuleCard({ emoji, rule, templates, onSaved, onTemplatesSaved }: {
  emoji: string; rule: RuleStats; templates: TemplateRow[]; onSaved: () => void; onTemplatesSaved: () => void;
}) {
  const { t, language } = useLanguage();
  const [enabled, setEnabled] = useState(rule.enabled);
  const [params, setParams] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [showTexts, setShowTexts] = useState(false);
  useEffect(() => {
    setEnabled(rule.enabled);
    setParams(Object.fromEntries(Object.entries(rule.params ?? {}).map(([k, v]) => [k, String(v)])));
  }, [rule]);
  const dirtyParams = Object.entries(params).filter(([k, v]) => String(rule.params?.[k]) !== v);
  const rate = tapRate(rule.taps, rule.sent);
  const holds = Object.entries(rule.heldBy ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 4);

  const save = async (nextEnabled?: boolean) => {
    const patch: Record<string, number> = {};
    for (const [k, v] of dirtyParams) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) { toast.error(t('adm.engine.badNumber')); return; }
      patch[k] = Math.round(n);
    }
    setSaving(true);
    const { error } = await supabase.rpc('admin_set_push_rule' as never, {
      p_key: rule.key,
      p_enabled: nextEnabled ?? null,
      p_params: Object.keys(patch).length ? patch : null,
    } as never);
    setSaving(false);
    if (error) { toast.error(`${t('adm.engine.saveError')} ${error.message}`); if (nextEnabled !== undefined) setEnabled(!nextEnabled); return; }
    toast.success(nextEnabled === undefined ? t('adm.engine.saved') : nextEnabled ? t('adm.engine.ruleOn') : t('adm.engine.ruleOff'));
    onSaved();
  };

  return (
    <Card
      title={<span className="inline-flex items-center gap-2"><span aria-hidden>{emoji}</span>{t(`adm.engine.rule.${rule.key}.name`)}</span>}
      subtitle={t(`adm.engine.rule.${rule.key}.desc`)}
      right={<Toggle checked={enabled} onChange={(v) => { setEnabled(v); save(v); }} disabled={saving} />}
      style={{ opacity: enabled ? 1 : 0.7 }}
    >
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        <Pill tone={rule.sent > 0 ? 'pos' : 'muted'} size="xs">{t('adm.engine.pillSent').replace('{n}', fmtNum(rule.sent, language))}</Pill>
        <Pill tone="muted" size="xs">{t('adm.engine.pillRate').replace('{pct}', rate == null ? '—' : fmtPct(rate))}</Pill>
        <Pill tone={rule.buyers > 0 ? 'pos' : 'muted'} size="xs">{t('adm.engine.pillBuyers').replace('{n}', fmtNum(rule.buyers, language))}</Pill>
        {rule.revenue > 0 && <Pill tone="pos" size="xs">{fmtEur(rule.revenue, language)}</Pill>}
        {rule.queued > 0 && <Pill tone="accent" size="xs">{t('adm.engine.pillQueued').replace('{n}', fmtNum(rule.queued, language))}</Pill>}
        {rule.held > 0 && <Pill tone="muted" size="xs">{t('adm.engine.pillHeld').replace('{n}', fmtNum(rule.held, language))}</Pill>}
        {holds.map(([k, v]) => <Pill key={k} tone="muted" size="xs">{holdLabel(t, k)} · {fmtNum(v, language)}</Pill>)}
        <span style={{ color: T3, fontSize: 11 }}>
          {rule.lastAt ? `${t('adm.engine.lastSent')} ${fmtDate(rule.lastAt, language, 'datetime')}` : t('adm.engine.neverSent')}
        </span>
      </div>

      {Object.keys(params).length > 0 && (
        <div className="flex flex-wrap items-end gap-3 mb-3">
          {Object.keys(params).map((k) => (
            <Field key={k} label={t(`adm.engine.param.${k}`)}>
              <input
                type="number"
                inputMode="numeric"
                value={params[k]}
                onChange={(e) => setParams((p) => ({ ...p, [k]: e.target.value }))}
                style={{ ...INPUT_STYLE, width: 140, borderColor: String(rule.params?.[k]) !== params[k] ? 'rgba(232,25,44,0.45)' : undefined }}
              />
            </Field>
          ))}
          <Btn variant="primary" size="sm" icon={Save} onClick={() => save()} disabled={dirtyParams.length === 0} loading={saving}>{t('adm.engine.save')}</Btn>
        </div>
      )}

      <Btn size="sm" icon={Type} onClick={() => setShowTexts((v) => !v)}>
        {showTexts ? t('adm.engine.hideTexts') : t('adm.engine.showTexts').replace('{n}', String(templates.length))}
      </Btn>
      {showTexts && (
        <div className="mt-3 space-y-2.5">
          {templates.map((tp) => (
            <TemplateEditor key={`${tp.variant}|${tp.reason}|${tp.lang}`} row={tp} onSaved={onTemplatesSaved} />
          ))}
          <p style={{ color: T3, fontSize: 11.5, lineHeight: 1.5 }}>{t('adm.engine.varsHint')}</p>
        </div>
      )}
    </Card>
  );
}

function TemplateEditor({ row, onSaved }: { row: TemplateRow; onSaved: () => void }) {
  const { t } = useLanguage();
  const [title, setTitle] = useState(row.title);
  const [body, setBody] = useState(row.body);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setTitle(row.title); setBody(row.body); }, [row.title, row.body]);
  const custom = row.title !== row.default_title || row.body !== row.default_body;
  const dirty = title !== row.title || body !== row.body;

  const call = async (reset: boolean) => {
    setBusy(true);
    const { error } = await supabase.rpc('admin_set_push_template' as never, {
      p_rule: row.rule_key, p_variant: row.variant, p_reason: row.reason, p_lang: row.lang,
      p_title: reset ? null : title, p_body: reset ? null : body,
    } as never);
    setBusy(false);
    if (error) { toast.error(`${t('adm.engine.saveError')} ${error.message}`); return; }
    toast.success(reset ? t('adm.engine.textReset') : t('adm.engine.saved'));
    onSaved();
  };

  const reasonKey = `adm.engine.reason.${row.reason}`;
  const reasonLabel = t(reasonKey) === reasonKey ? row.reason : t(reasonKey);
  const variantKey = `adm.engine.variant.${row.variant}`;
  const variantLabel = t(variantKey) === variantKey ? row.variant : t(variantKey);

  return (
    <Inner pad="12px 14px">
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        <Pill size="xs">{row.lang.toUpperCase()}</Pill>
        {row.variant !== 'default' && <Pill size="xs" tone="accent">{variantLabel}</Pill>}
        {row.reason !== 'any' && <Pill size="xs" tone="muted">{reasonLabel}</Pill>}
        {custom && <Pill size="xs" tone="hot">{t('adm.engine.customText')}</Pill>}
      </div>
      <div className="grid gap-2 md:grid-cols-[1fr,2fr,auto] items-start">
        <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} style={INPUT_STYLE} aria-label={t('adm.engine.textTitle')} />
        <textarea value={body} maxLength={240} rows={2} onChange={(e) => setBody(e.target.value)} style={{ ...INPUT_STYLE, resize: 'vertical' }} aria-label={t('adm.engine.textBody')} />
        <div className="flex gap-1.5">
          <Btn size="sm" variant="primary" icon={Save} onClick={() => call(false)} disabled={!dirty || !title.trim() || !body.trim()} loading={busy}>{t('adm.engine.save')}</Btn>
          {custom && <Btn size="sm" icon={RotateCcw} onClick={() => call(true)} disabled={busy} title={t('adm.engine.resetText')} />}
        </div>
      </div>
    </Inner>
  );
}

// ─── Système ─────────────────────────────────────────────────────────────────
function SystemTab() {
  const { t, language } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [legacy, setLegacy] = useState<string[]>([]);
  const [stats, setStats] = useState<Record<string, KeyStats>>({});

  const load = useCallback(async () => {
    const [settingsRes, statsRes] = await Promise.all([
      supabase.from('platform_notification_settings' as never).select('notification_key, enabled, category'),
      supabase.rpc('get_auto_push_stats' as never),
    ]);
    const map: Record<string, boolean> = {};
    const legacyKeys: string[] = [];
    for (const row of ((settingsRes.data as unknown) as { notification_key: string; enabled: boolean; category: string }[]) ?? []) {
      map[row.notification_key] = row.enabled;
      if (row.category === 'legacy') legacyKeys.push(row.notification_key);
    }
    setEnabled(map);
    setLegacy(legacyKeys.sort());
    const s: Record<string, KeyStats> = {};
    for (const row of ((statsRes.data as unknown) as KeyStats[]) ?? []) s[row.notification_key] = row;
    setStats(s);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = async (key: string, next: boolean) => {
    const prev = enabled[key];
    setEnabled((m) => ({ ...m, [key]: next }));
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('platform_notification_settings' as never)
      .upsert({ notification_key: key, enabled: next, updated_at: new Date().toISOString(), updated_by: user?.id ?? null } as never, { onConflict: 'notification_key' });
    if (error) { setEnabled((m) => ({ ...m, [key]: prev })); toast.error(t('adminAutoPush.toggleError')); }
    else toast.success(next ? t('adminAutoPush.toggledOn') : t('adminAutoPush.toggledOff'));
  };

  const label = (key: string, base: 'name' | 'desc') => {
    const own = t(`adm.auto.k.${key}.${base}`);
    if (!own.startsWith('adm.auto.k.')) return own;
    const old = t(`adminAutoPush.k.${key}.${base}`);
    return old.startsWith('adminAutoPush.k.') ? (base === 'name' ? key : '') : old;
  };

  if (loading) return <PageSkeleton tiles={0} blocks={3} />;

  return (
    <div className="space-y-4">
      <Notice icon={BellRing}>{t('adm.engine.systemIntro')}</Notice>
      {(['transactional', 'reminder', 'engagement', 'marketing'] as SysCategory[]).map((cat) => (
        <Card key={cat} title={t(`adminAutoPush.cat.${cat}`)} subtitle={t(`adminAutoPush.catHint.${cat}`)}>
          <div className="space-y-2">
            {SYSTEM_CATALOG.filter((c) => c.category === cat).map(({ key, dormant }) => {
              const s = stats[key];
              const on = enabled[key] !== false;
              const ctr = s && s.sent_30d > 0 ? Math.round((s.clicked_30d / s.sent_30d) * 100) : null;
              return (
                <Inner key={key} pad="12px 14px" style={{ opacity: on ? 1 : 0.55 }}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{label(key, 'name')}</p>
                        {dormant && <Pill size="xs" tone="muted" title={t('adm.auto.dormantHint')}>{t('adm.auto.dormant')}</Pill>}
                      </div>
                      <p style={{ color: T3, fontSize: 11.5, marginTop: 2, lineHeight: 1.45 }}>{label(key, 'desc')}</p>
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        <Pill size="xs" tone={(s?.sent_30d ?? 0) > 0 ? 'pos' : 'muted'}>{t('adminAutoPush.sent30d')} {fmtNum(s?.sent_30d ?? 0, language)}</Pill>
                        <Pill size="xs" tone="muted">{t('adminAutoPush.ctr')} {ctr == null ? '—' : `${ctr} %`}</Pill>
                        {(s?.failed_30d ?? 0) > 0 && <Pill size="xs" tone="neg">{t('adminAutoPush.failed30d')} {fmtNum(s?.failed_30d ?? 0, language)}</Pill>}
                        <span style={{ color: T3, fontSize: 10.5 }}>
                          {s?.last_sent_at ? `${t('adminAutoPush.lastSent')} ${fmtDate(s.last_sent_at, language, 'datetime')}` : t('adminAutoPush.neverSent')}
                        </span>
                      </div>
                    </div>
                    <Toggle checked={on} onChange={(v) => toggle(key, v)} />
                  </div>
                </Inner>
              );
            })}
          </div>
        </Card>
      ))}
      {legacy.length > 0 && (
        <Card title={t('adm.engine.legacyTitle')} subtitle={t('adm.engine.legacyHint')}>
          <div className="flex flex-wrap gap-1.5">
            {legacy.map((k) => <Pill key={k} size="xs" tone="muted">{k}</Pill>)}
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── Crédits ─────────────────────────────────────────────────────────────────
function CreditsTab({ settings, onSaved }: { settings: Record<string, number>; onSaved: () => void }) {
  const { t, language } = useLanguage();
  const [searchParams] = useSearchParams();
  const [q, setQ] = useState(searchParams.get('q') ?? '');
  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [rows, setRows] = useState<CreditAccount[] | null>(null);
  const [busyScope, setBusyScope] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('admin_push_credit_accounts' as never, { p_q: query || null } as never);
    const res = data as unknown as { ok: boolean; accounts?: CreditAccount[] } | null;
    setRows(res?.ok ? res.accounts ?? [] : []);
  }, [query]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const h = setTimeout(() => setQuery(q.trim()), 350); return () => clearTimeout(h); }, [q]);

  const grant = async (scope: string, amount: number) => {
    setBusyScope(scope);
    const { error } = await supabase.rpc('admin_grant_push_credits' as never, { p_scope: scope, p_amount: amount, p_note: null } as never);
    setBusyScope(null);
    if (error) { toast.error(`${t('adm.engine.saveError')} ${error.message}`); return; }
    toast.success(t('adm.engine.granted').replace('{n}', String(amount)));
    load();
  };
  const setAllowance = async (scope: string, value: string) => {
    const allowance = value.trim() === '' ? null : Number(value);
    if (allowance !== null && (!Number.isFinite(allowance) || allowance < 0 || allowance > 100)) { toast.error(t('adm.engine.badNumber')); return; }
    setBusyScope(scope);
    const { error } = await supabase.rpc('admin_set_push_allowance' as never, { p_scope: scope, p_allowance: allowance } as never);
    setBusyScope(null);
    if (error) { toast.error(`${t('adm.engine.saveError')} ${error.message}`); return; }
    toast.success(t('adm.engine.saved'));
    load();
  };

  return (
    <div className="space-y-5">
      <SettingsForm
        title={t('adm.engine.creditsPolicy')}
        subtitle={t('adm.engine.creditsPolicyHint')}
        icon={Coins}
        fields={CREDIT_FIELDS}
        settings={settings}
        onSaved={onSaved}
      />
      <Card title={t('adm.engine.accounts')} subtitle={t('adm.engine.accountsHint')} icon={Users}
        right={(
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: T3 }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('adm.engine.searchAccount')} style={{ ...INPUT_STYLE, paddingLeft: 32, width: 240 }} />
          </div>
        )}>
        {rows === null ? <PageSkeleton tiles={0} blocks={1} /> : rows.length === 0 ? (
          <EmptyState icon={Coins} text={query ? t('adm.engine.noAccountMatch') : t('adm.engine.noAccounts')} />
        ) : (
          <TableWrap minWidth={820}>
            <thead>
              <tr>
                <Th>{t('adm.engine.col.account')}</Th>
                <Th right>{t('adm.engine.col.allowance')}</Th>
                <Th right>{t('adm.engine.col.used')}</Th>
                <Th right>{t('adm.engine.col.bonus')}</Th>
                <Th right>{t('adm.engine.col.remaining')}</Th>
                <Th>{t('adm.engine.col.request')}</Th>
                <Th right>{t('adm.engine.col.actions')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.scope} style={{ borderTop: `1px solid ${F_BORDER}` }}>
                  <Td>
                    <span style={{ color: T1, fontWeight: 560 }}>{r.name || r.scope}</span>
                    <span style={{ color: T3, fontSize: 11, display: 'block' }}>{t(`adm.engine.kind.${r.kind}`)}</span>
                  </Td>
                  <Td right>
                    <AllowanceInput value={r.override ? String(r.allowance) : ''} placeholder={String(r.defaultAllowance)} disabled={busyScope === r.scope} onCommit={(v) => setAllowance(r.scope, v)} />
                  </Td>
                  <Td right>{fmtNum(r.used, language)}</Td>
                  <Td right>{r.bonus > 0 ? <span style={{ color: POS }}>{fmtNum(r.bonus, language)}</span> : '—'}</Td>
                  <Td right strong>{fmtNum(r.remaining, language)}</Td>
                  <Td muted>{r.lastRequestAt ? fmtRelative(r.lastRequestAt, language) : '—'}</Td>
                  <Td right>
                    <div className="inline-flex gap-1.5">
                      <Btn size="sm" onClick={() => grant(r.scope, 1)} disabled={busyScope === r.scope}>+1</Btn>
                      <Btn size="sm" onClick={() => grant(r.scope, 5)} disabled={busyScope === r.scope}>+5</Btn>
                      {r.bonus > 0 && <Btn size="sm" variant="subtle" onClick={() => grant(r.scope, -r.bonus)} disabled={busyScope === r.scope}>{t('adm.engine.clearBonus')}</Btn>}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}

function AllowanceInput({ value, placeholder, disabled, onCommit }: { value: string; placeholder: string; disabled: boolean; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  return (
    <input
      type="number"
      inputMode="numeric"
      value={v}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v !== value) onCommit(v); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      style={{ ...INPUT_STYLE, width: 72, textAlign: 'right', padding: '6px 8px' }}
    />
  );
}
