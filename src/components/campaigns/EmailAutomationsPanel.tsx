// Automatisations email — la page des RECETTES (club ET organisateur).
//
// Chaque recette est un interrupteur, un délai, un modèle Email Studio et un
// objet. Le moteur (cron 5 min, collect_email_automations) monte une campagne
// enfant par (recette, soirée) et la remplit contact par contact ; cet écran
// règle et rend compte, il n'envoie rien lui-même. Même contrat que la relance
// après clic (FollowupSettings) : sans modèle, rien ne part — d'où le bouton
// « Créer le modèle Yuno » qui pose un modèle prêt à l'emploi en un clic.
// Doctrine et garde-fous : docs/designs/EMAIL_AUTOMATION_PLAN.md.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, CalendarPlus, Clock3, Crown, Eye, HeartHandshake, Loader2, MailOpen, Moon, PartyPopper, ScanLine,
  ShieldAlert, ShieldCheck, ShoppingCart, Sparkles, Target, TrendingUp, UserRoundPlus, Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  AUTOMATION_KINDS, AUTOMATION_META, PLATFORM_AUTOMATION_KINDS, TIER_THRESHOLDS, DEFAULT_TIER_THRESHOLD,
  buildStarter, delayToHours, formatEuro, hoursToDelay, DEFAULT_STUDIO_THEME,
  type AutomationKind, type AutomationPreview, type AutomationSkipReason, type AutomationStats, type EmailAutomationRow,
} from '@/lib/email';
import { useEmailTemplates, useStudioEvents, type StudioScope } from '@/components/email-studio/hooks';
import FollowupPreviewDialog from './FollowupPreviewDialog';
import AutomationSuggestions from './AutomationSuggestions';

const RED = '#E8192C';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';
const POS = '#34D399';
const WARN = '#FCD34D';

const ICONS: Record<AutomationKind, typeof Zap> = {
  abandoned_checkout: ShoppingCart,
  last_call: Zap,
  post_event_thanks: PartyPopper,
  post_event_missed: HeartHandshake,
  welcome: UserRoundPlus,
  win_back: MailOpen,
  table_upsell: Crown,
  tier_closing: TrendingUp,
  new_event: CalendarPlus,
};

const SKIP_REASONS: readonly AutomationSkipReason[] = [
  'bought', 'guest_list', 'has_table', 'unsubscribed', 'suppressed', 'no_consent', 'cooldown', 'event_over',
  'already_event', 'pressure_24h', 'pressure_7d', 'fatigue', 'averse',
];

interface ChildRow {
  id: string;
  name: string;
  status: string;
  automation_id: string;
  recipients_count: number;
  created_at: string;
}

const nf = (n: number) => n.toLocaleString('fr-FR');

export default function EmailAutomationsPanel({ scope, basePath }: {
  /** Club, organisateur, ou Yuno lui-même (super admin : les deux colonnes de portée à NULL). */
  scope: StudioScope;
  /** Racine des campagnes de la portée (rapports, modèles). */
  basePath: string;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { templates, create } = useEmailTemplates(scope);
  const events = useStudioEvents(scope);
  const nextEvent = events[0] || null;
  const [rows, setRows] = useState<Partial<Record<AutomationKind, EmailAutomationRow>>>({});
  const [stats, setStats] = useState<Partial<Record<AutomationKind, AutomationStats>>>({});
  const [previews, setPreviews] = useState<Partial<Record<AutomationKind, AutomationPreview>>>({});
  const [children, setChildren] = useState<ChildRow[]>([]);
  const [revenue, setRevenue] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<AutomationKind | null>(null);
  const [preview, setPreview] = useState<AutomationKind | null>(null);

  const isPlatform = scope.kind === 'platform';
  const scopeCol = scope.kind === 'venue' ? 'venue_id' : 'organizer_user_id';
  const scopeId = scope.kind === 'venue' ? scope.venueId : scope.kind === 'organizer' ? scope.organizerId : null;
  const kinds = isPlatform ? PLATFORM_AUTOMATION_KINDS : AUTOMATION_KINDS;

  const load = useCallback(async () => {
    const autoQ = supabase.from('email_automations' as never)
      .select('id,kind,enabled,enabled_at,delay_hours,threshold_pct,template_id,subject');
    const [{ data: autoRows }, { data: statRows }, { data: attribution }] = await Promise.all([
      isPlatform ? autoQ.is('venue_id', null).is('organizer_user_id', null) : autoQ.eq(scopeCol, scopeId as string),
      supabase.rpc('get_email_automation_stats' as never, {
        p_venue_id: scope.kind === 'venue' ? scope.venueId : null,
        p_organizer_user_id: scope.kind === 'organizer' ? scope.organizerId : null,
      } as never),
      // Yuno n'encaisse rien pour lui-même : pas de revenu attribué en portée plateforme.
      isPlatform
        ? Promise.resolve({ data: null })
        : supabase.rpc('get_email_campaign_attribution' as never, { p_subject_type: scope.kind, p_subject_id: scopeId } as never),
    ]);
    const byKind: Partial<Record<AutomationKind, EmailAutomationRow>> = {};
    for (const r of ((autoRows || []) as unknown as EmailAutomationRow[])) byKind[r.kind] = r;
    setRows(byKind);
    const st: Partial<Record<AutomationKind, AutomationStats>> = {};
    for (const s of ((statRows || []) as unknown as AutomationStats[])) st[s.kind] = s;
    setStats(st);
    const payload = attribution as unknown as { supported?: boolean; campaigns?: Array<{ id: string; revenue: number }> } | null;
    if (payload?.supported) {
      const map: Record<string, number> = {};
      for (const c of payload.campaigns || []) map[c.id] = c.revenue;
      setRevenue(map);
    }
    // « Yuno cible : … » — éligibles maintenant, par recette. Une RPC légère
    // par recette (compter, pas lister) ; la portée Yuno n'a pas d'audience.
    if (!isPlatform) {
      const found = await Promise.all(kinds.map(async (kind) => {
        const { data } = await supabase.rpc('preview_email_automation' as never, {
          p_venue_id: scope.kind === 'venue' ? scope.venueId : null,
          p_organizer_user_id: scope.kind === 'organizer' ? scope.organizerId : null,
          p_kind: kind,
        } as never);
        return [kind, data as unknown as AutomationPreview | null] as const;
      }));
      const pv: Partial<Record<AutomationKind, AutomationPreview>> = {};
      for (const [kind, data] of found) if (data) pv[kind] = data;
      setPreviews(pv);
    }
    const ids = Object.values(byKind).map((r) => r.id);
    if (ids.length > 0) {
      const { data: kids } = await supabase.from('email_campaigns')
        .select('id,name,status,automation_id,recipients_count,created_at')
        .in('automation_id' as never, ids as never)
        .order('created_at', { ascending: false })
        .limit(40);
      setChildren((kids || []) as unknown as ChildRow[]);
    } else {
      setChildren([]);
    }
    setLoading(false);
  }, [scope, scopeCol, scopeId, isPlatform, kinds]);

  useEffect(() => { void load(); }, [load]);

  /** Écrit la recette (insert à la première écriture), puis relit tout. */
  const save = useCallback(async (kind: AutomationKind, patch: Partial<Pick<EmailAutomationRow, 'enabled' | 'delay_hours' | 'threshold_pct' | 'template_id' | 'subject'>>) => {
    setBusy(kind);
    try {
      const existing = rows[kind];
      if (existing) {
        const { error } = await supabase.from('email_automations' as never).update(patch as never).eq('id', existing.id);
        if (error) { toast.error(error.message); return false; }
      } else {
        const { data: auth } = await supabase.auth.getUser();
        const meta = AUTOMATION_META[kind];
        const { error } = await supabase.from('email_automations' as never).insert({
          ...(isPlatform ? {} : { [scopeCol]: scopeId }), kind, enabled: false,
          delay_hours: delayToHours(meta, meta.defaultDelay), threshold_pct: DEFAULT_TIER_THRESHOLD, template_id: null, subject: null,
          created_by: auth.user?.id || null,
          ...patch,
        } as never);
        if (error) { toast.error(error.message); return false; }
      }
      await load();
      return true;
    } finally {
      setBusy(null);
    }
  }, [rows, scopeCol, scopeId, isPlatform, load]);

  /** Modèle Yuno de la recette, créé d'un clic et attaché. */
  const createStarter = useCallback(async (kind: AutomationKind, thenEnable: boolean) => {
    setBusy(kind);
    try {
      const meta = AUTOMATION_META[kind];
      const content = buildStarter(meta.starter, { venueName: scope.name, theme: DEFAULT_STUDIO_THEME, t });
      const id = await create(t(`studio.starter.${meta.starter}.name`), t(`studio.starter.${meta.starter}.desc`), content);
      if (!id) { toast.error(t('em.auto.createError')); return; }
      setBusy(null);
      if (await save(kind, thenEnable ? { template_id: id, enabled: true } : { template_id: id })) toast.success(t('em.auto.created'));
    } finally {
      setBusy(null);
    }
  }, [scope.name, t, create, save]);

  const toggle = useCallback(async (kind: AutomationKind, next: boolean) => {
    const row = rows[kind];
    if (next && !row?.template_id) {
      // Sans modèle, rien ne part : on le crée en même temps qu'on allume.
      await createStarter(kind, true);
      return;
    }
    await save(kind, { enabled: next });
  }, [rows, createStarter, save]);

  const previewMeta = preview ? AUTOMATION_META[preview] : null;
  const previewTemplate = preview ? templates.find((tpl) => tpl.id === rows[preview]?.template_id) || null : null;

  const enabledCount = useMemo(() => Object.values(rows).filter((r) => r.enabled).length, [rows]);

  return (
    <div className="min-h-screen pb-24" style={{ background: '#000', position: 'relative' }}>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.025),transparent 55%)' }} />
      <div className="max-w-[1100px] mx-auto px-6 py-8" style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* ── En-tête ── */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
          <button
            onClick={() => navigate(basePath)} aria-label={t('studio.top.back')} className="cursor-pointer"
            style={{ width: 34, height: 34, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', background: INNER_BG, border: `1px solid ${BORDER}`, flex: 'none', marginBottom: 2 }}
          >
            <ArrowLeft className="w-4 h-4" style={{ color: T2 }} />
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{scope.name}</div>
            <h1 style={{ margin: '6px 0 0', color: T1, fontSize: 26, fontWeight: 640, letterSpacing: '-0.025em' }}>{t('em.auto.title')}</h1>
            <div style={{ color: T2, fontSize: 13, marginTop: 6, lineHeight: 1.5, maxWidth: 720 }}>{isPlatform ? t('em.auto.platformNote') : t('em.auto.subtitle')}</div>
          </div>
          <div style={{ padding: '6px 12px', borderRadius: 999, fontSize: 11.5, fontWeight: 600, color: enabledCount > 0 ? POS : T3, background: enabledCount > 0 ? 'rgba(52,211,153,0.10)' : INNER_BG, border: `1px solid ${enabledCount > 0 ? 'rgba(52,211,153,0.25)' : BORDER}`, flex: 'none' }}>
            {t('em.auto.enabledCount').replace('{n}', String(enabledCount))}
          </div>
        </div>

        {/* ── Comment ça marche ── */}
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 16, boxShadow: CARD_SHADOW, padding: '14px 18px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          {[
            { icon: Sparkles, key: 'how1' },
            { icon: ShieldCheck, key: 'how2' },
            { icon: Moon, key: 'how3' },
            { icon: Clock3, key: 'how4' },
            { icon: ShieldAlert, key: 'how5' },
          ].map(({ icon: Icon, key }) => (
            <div key={key} className="flex items-start gap-2.5">
              <Icon className="w-4 h-4 shrink-0 mt-0.5" style={{ color: RED }} />
              <span style={{ color: T2, fontSize: 12, lineHeight: 1.5 }}>{t(`em.auto.${key}`)}</span>
            </div>
          ))}
        </div>

        {/* ── Yuno te propose d'allumer… (recettes éteintes que les faits justifient) ── */}
        {!loading && !isPlatform && (
          <AutomationSuggestions scope={scope} basePath={basePath} variant="banner" onEnabled={() => void load()} />
        )}

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin" style={{ color: T3 }} /></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {kinds.map((kind) => (
              <RecipeCard
                key={kind}
                kind={kind}
                row={rows[kind] || null}
                stats={stats[kind] || null}
                preview={isPlatform ? null : (previews[kind] || null)}
                templates={templates}
                childrenRows={children.filter((c) => c.automation_id === rows[kind]?.id).slice(0, 3)}
                revenue={isPlatform ? null : (stats[kind]?.campaign_ids || []).reduce((sum, id) => sum + (revenue[id] || 0), 0)}
                busy={busy === kind}
                basePath={basePath}
                onToggle={(v) => void toggle(kind, v)}
                onDelay={(h) => void save(kind, { delay_hours: h })}
                onThreshold={(p) => void save(kind, { threshold_pct: p })}
                onTemplate={(id) => void save(kind, { template_id: id })}
                onSubject={(s) => void save(kind, { subject: s.trim() || null })}
                onCreateStarter={() => void createStarter(kind, false)}
                onPreview={() => setPreview(kind)}
              />
            ))}
          </div>
        )}
      </div>

      {preview && previewTemplate && previewMeta && rows[preview] && (
        <FollowupPreviewDialog
          template={previewTemplate}
          scope={scope}
          eventId={nextEvent?.id || null}
          campaignId={null}
          automationId={rows[preview]!.id}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

// ── Une recette ──────────────────────────────────────────────────────────────

function RecipeCard({
  kind, row, stats, preview, templates, childrenRows, revenue, busy, basePath,
  onToggle, onDelay, onThreshold, onTemplate, onSubject, onCreateStarter, onPreview,
}: {
  kind: AutomationKind;
  row: EmailAutomationRow | null;
  stats: AutomationStats | null;
  /** null = pas d'aperçu d'audience (portée Yuno, ou pas encore chargé). */
  preview: AutomationPreview | null;
  templates: Array<{ id: string; name: string; subject?: string }>;
  childrenRows: ChildRow[];
  /** null = pas de revenu à montrer (portée Yuno). */
  revenue: number | null;
  busy: boolean;
  basePath: string;
  onToggle: (v: boolean) => void;
  onDelay: (hours: number) => void;
  onThreshold: (pct: number) => void;
  onTemplate: (id: string | null) => void;
  onSubject: (s: string) => void;
  onCreateStarter: () => void;
  onPreview: () => void;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const meta = AUTOMATION_META[kind];
  const Icon = ICONS[kind];
  const enabled = !!row?.enabled;
  const delay = row ? hoursToDelay(meta, row.delay_hours) : meta.defaultDelay;
  const threshold = row?.threshold_pct || DEFAULT_TIER_THRESHOLD;
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(row?.subject || '');
  useEffect(() => { setSubject(row?.subject || ''); }, [row?.subject]);
  const expanded = enabled || open;
  const fill = (key: string, vars: Record<string, string | number>) =>
    Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), t(key));
  const unitLabel = (n: number) => meta.unit === 'days' ? fill('em.auto.days', { d: n }) : fill('studio.sched.fu.hours', { h: n });
  const pctLabel = (p: number) => fill('em.auto.pct', { p });
  // Le déclencheur se lit avec le délai… ou le seuil, pour « le tarif monte ».
  const triggerVar = meta.noDelay ? pctLabel(threshold) : unitLabel(delay);
  const skipped = SKIP_REASONS
    .map((r) => ({ r, n: stats?.skipped?.[r] || 0 }))
    .filter((x) => x.n > 0);
  const chosen = templates.find((tpl) => tpl.id === row?.template_id) || null;

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${enabled ? 'rgba(232,25,44,0.22)' : BORDER}`, borderRadius: 16, boxShadow: CARD_SHADOW, padding: '14px 18px' }}>
      <div className="flex items-center gap-3">
        <div style={{ width: 34, height: 34, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', background: enabled ? 'rgba(232,25,44,0.12)' : INNER_BG, border: `1px solid ${enabled ? 'rgba(232,25,44,0.25)' : BORDER}`, color: enabled ? RED : T3, flex: 'none' }}>
          <Icon className="w-4 h-4" />
        </div>
        <button type="button" onClick={() => setOpen((v) => !v)} className="min-w-0 flex-1 text-left cursor-pointer" style={{ background: 'none', border: 'none', padding: 0 }}>
          <div style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{t(`em.auto.kind.${kind}.title`)}</div>
          <div style={{ color: T3, fontSize: 11.5, marginTop: 2, lineHeight: 1.45 }}>
            {enabled ? fill(`em.auto.kind.${kind}.trigger`, { n: triggerVar }) : t(`em.auto.kind.${kind}.desc`)}
          </div>
        </button>
        {stats && enabled && (stats.sent > 0 || stats.pending > 0) && (
          <div className="hidden md:flex items-center gap-4" style={{ flex: 'none' }}>
            <Stat label={t('em.auto.stat.sent')} value={nf(stats.sent)} />
            <Stat label={t('em.auto.stat.opens')} value={nf(stats.opens)} />
            <Stat label={t('em.auto.stat.clickers')} value={nf(stats.clickers)} />
            {revenue != null && <Stat label={t('em.auto.stat.revenue')} value={formatEuro(revenue)} accent />}
          </div>
        )}
        <button
          type="button" role="switch" aria-checked={enabled} aria-label={t(`em.auto.kind.${kind}.title`)} disabled={busy}
          onClick={() => onToggle(!enabled)}
          style={{ width: 34, height: 20, borderRadius: 999, border: 'none', padding: 0, position: 'relative', flex: 'none', background: enabled ? RED : 'rgba(255,255,255,0.12)', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}
        >
          <span style={{ position: 'absolute', top: 2, left: enabled ? 16 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
        </button>
      </div>

      {expanded && (
        <div className="mt-4 grid gap-4" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)' }}>
          {/* Réglages */}
          <div className="space-y-3 min-w-0">
            {meta.noDelay ? (
              <div>
                <Micro>{t('em.auto.delay.threshold')}</Micro>
                <div className="flex gap-1" style={{ padding: 3, borderRadius: 11, background: 'rgba(255,255,255,0.02)' }}>
                  {TIER_THRESHOLDS.map((p) => (
                    <button
                      key={p} type="button" aria-pressed={threshold === p} disabled={busy}
                      onClick={() => onThreshold(p)}
                      style={{ flex: 1, padding: '7px 4px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 11.5, fontWeight: 560, color: threshold === p ? T1 : T3, background: threshold === p ? 'linear-gradient(180deg,rgba(255,255,255,.13),rgba(255,255,255,.07))' : 'transparent' }}
                    >{pctLabel(p)}</button>
                  ))}
                </div>
                <div style={{ color: T3, fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>{t('em.auto.thresholdHint')}</div>
              </div>
            ) : (
              <div>
                <Micro>{t(`em.auto.delay.${meta.direction}`)}</Micro>
                <div className="flex gap-1" style={{ padding: 3, borderRadius: 11, background: 'rgba(255,255,255,0.02)' }}>
                  {meta.delays.map((d) => (
                    <button
                      key={d} type="button" aria-pressed={delay === d} disabled={busy}
                      onClick={() => onDelay(delayToHours(meta, d))}
                      style={{ flex: 1, padding: '7px 4px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 11.5, fontWeight: 560, color: delay === d ? T1 : T3, background: delay === d ? 'linear-gradient(180deg,rgba(255,255,255,.13),rgba(255,255,255,.07))' : 'transparent' }}
                    >{unitLabel(d)}</button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <Micro>{t('em.auto.template')}</Micro>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={row?.template_id || ''} disabled={busy}
                  onChange={(e) => onTemplate(e.target.value || null)}
                  aria-label={t('em.auto.template')}
                  style={{ flex: 1, minWidth: 200, height: 36, borderRadius: 10, padding: '0 10px', colorScheme: 'dark', background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}`, color: T1, fontSize: 12.5 }}
                >
                  <option value="">{t('studio.sched.fu.templateNone')}</option>
                  {templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
                </select>
                <SmallBtn onClick={onCreateStarter} disabled={busy}>
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  {t('em.auto.createStarter')}
                </SmallBtn>
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                {chosen && (
                  <SmallBtn onClick={onPreview}>
                    <Eye className="w-3.5 h-3.5" style={{ color: RED }} />
                    {t('em.auto.preview')}
                  </SmallBtn>
                )}
                {row?.template_id && (
                  <button type="button" onClick={() => navigate(`${basePath}/templates/${row.template_id}`)} className="cursor-pointer" style={{ background: 'none', border: 'none', padding: 0, color: RED, fontSize: 11.5 }}>
                    {t('studio.sched.fu.editTemplate')} →
                  </button>
                )}
              </div>
              {!row?.template_id && (
                <Notice tone="warn">{t('em.auto.noTemplate')}</Notice>
              )}
            </div>

            <div>
              <Micro>{t('em.auto.subject')}</Micro>
              <input
                value={subject} disabled={busy}
                onChange={(e) => setSubject(e.target.value)}
                onBlur={() => { if ((row?.subject || '') !== subject.trim()) onSubject(subject); }}
                placeholder={chosen?.subject ? `${t('em.auto.subjectPh')} ${chosen.subject}` : t('em.auto.subjectPh')}
                aria-label={t('em.auto.subject')}
                maxLength={200}
                style={{ width: '100%', height: 36, borderRadius: 10, padding: '0 10px', background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}`, color: T1, fontSize: 12.5 }}
              />
              <div style={{ color: T3, fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>{t('em.auto.subjectHint')}</div>
            </div>
          </div>

          {/* Cible + règles + bilan */}
          <div className="space-y-3 min-w-0">
            {/* Ce que Yuno cible : le pro ne choisit jamais l'audience, il la lit. */}
            <div style={{ padding: '10px 12px', borderRadius: 12, background: 'rgba(232,25,44,0.05)', border: '1px solid rgba(232,25,44,0.18)' }}>
              <div className="flex items-start gap-2">
                <Target className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: RED }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: T1, fontSize: 12, lineHeight: 1.5 }}>
                    <span style={{ color: T2 }}>{t('em.auto.targetLabel')}</span>{' '}
                    {t(`em.auto.kind.${kind}.target`)}
                  </div>
                  {preview && (
                    <div style={{ color: T2, fontSize: 11.5, marginTop: 4, lineHeight: 1.5 }}>
                      <span style={{ color: T1, fontWeight: 640, fontVariantNumeric: 'tabular-nums' }}>{nf(preview.eligible)}</span>{' '}
                      {t(preview.eligible === 1 ? 'em.auto.eligibleNowOne' : 'em.auto.eligibleNow')}
                      {preview.next_due_at && (
                        <>
                          {' · '}
                          {fill('em.auto.nextDue', { d: new Date(preview.next_due_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) })}
                        </>
                      )}
                      {preview.next_event_title && (
                        <span style={{ color: T3 }}>{' · '}{preview.next_event_title}</span>
                      )}
                    </div>
                  )}
                  <div style={{ color: T3, fontSize: 11, marginTop: 4, lineHeight: 1.5 }}>{t('em.auto.priorityNote')}</div>
                </div>
              </div>
            </div>

            <div style={{ padding: '10px 12px', borderRadius: 12, background: INNER_BG, border: `1px solid ${BORDER}` }}>
              <Micro>{t('em.auto.rulesTitle')}</Micro>
              <ul style={{ margin: 0, paddingLeft: 16, color: T2, fontSize: 11.5, lineHeight: 1.55 }}>
                {['rule1', 'rule2', 'rule3'].map((k) => <li key={k}>{t(`em.auto.kind.${kind}.${k}`)}</li>)}
                <li>{t('em.auto.ruleNight')}</li>
                {meta.urgent && <li>{t('em.auto.ruleUrgent')}</li>}
              </ul>
              {meta.needsScan && (
                <div className="flex items-start gap-2 mt-2">
                  <ScanLine className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: WARN }} />
                  <span style={{ color: T2, fontSize: 11.5, lineHeight: 1.5 }}>{t('em.auto.scanNote')}</span>
                </div>
              )}
            </div>

            <div style={{ padding: '10px 12px', borderRadius: 12, background: INNER_BG, border: `1px solid ${BORDER}` }}>
              <Micro>{t('em.auto.statsTitle')}</Micro>
              {!stats || (stats.sent === 0 && stats.pending === 0 && stats.queued === 0 && skipped.length === 0) ? (
                <div style={{ color: T3, fontSize: 11.5, lineHeight: 1.5 }}>{enabled ? t('em.auto.noneYet') : t('em.auto.off')}</div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                    <Stat label={t('em.auto.stat.pending')} value={nf(stats.pending)} />
                    <Stat label={t('em.auto.stat.sent')} value={nf(stats.sent)} />
                    <Stat label={t('em.auto.stat.opens')} value={nf(stats.opens)} />
                    <Stat label={t('em.auto.stat.clickers')} value={nf(stats.clickers)} />
                    <Stat label={t('em.auto.stat.unsubscribes')} value={nf(stats.unsubscribes)} />
                    {revenue != null && <Stat label={t('em.auto.stat.revenue')} value={formatEuro(revenue)} accent />}
                  </div>
                  {skipped.length > 0 && (
                    <div style={{ color: T3, fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>
                      {t('em.auto.skipped')}{' '}
                      {skipped.map(({ r, n }) => `${nf(n)} ${t(`em.auto.skip.${r}`)}`).join(' · ')}
                    </div>
                  )}
                </>
              )}
              {childrenRows.length > 0 && (
                <div className="mt-2 space-y-1">
                  {childrenRows.map((c) => (
                    <button
                      key={c.id} type="button" onClick={() => navigate(`${basePath}/${c.id}/report`)}
                      className="flex w-full items-center justify-between gap-2 cursor-pointer text-left"
                      style={{ background: 'none', border: 'none', padding: '4px 0' }}
                    >
                      <span className="truncate" style={{ color: T2, fontSize: 11.5 }}>{c.name}</span>
                      <span style={{ color: RED, fontSize: 11, fontWeight: 600, flex: 'none' }}>
                        {nf(c.recipients_count)} · {t('em.auto.openReport')} →
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Micro({ children }: { children: React.ReactNode }) {
  return <div style={{ color: T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>{children}</div>;
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ color: accent ? RED : T1, fontSize: 15, fontWeight: 640, letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ color: T3, fontSize: 10.5, marginTop: 1 }}>{label}</div>
    </div>
  );
}

function SmallBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      className="inline-flex items-center gap-1.5 cursor-pointer"
      style={{ padding: '8px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}`, color: T1, fontSize: 11.5, fontWeight: 600, opacity: disabled ? 0.6 : 1 }}
    >{children}</button>
  );
}

function Notice({ children, tone }: { children: React.ReactNode; tone: 'warn' }) {
  const color = tone === 'warn' ? WARN : POS;
  return (
    <div className="flex items-start gap-2 mt-2" style={{ padding: '9px 12px', borderRadius: 11, background: 'rgba(252,211,77,0.07)', border: '1px solid rgba(252,211,77,0.22)' }}>
      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color }} />
      <span style={{ color: T2, fontSize: 11.5, lineHeight: 1.5 }}>{children}</span>
    </div>
  );
}
