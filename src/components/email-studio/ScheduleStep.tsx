import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CalendarClock, ChevronDown, Eye, Info, Loader2, Plus, Repeat, ShieldCheck, Sparkles, Split, Waves, Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import EmailCreditsDialog from '@/components/campaigns/EmailCreditsDialog';
import FollowupPreviewDialog from '@/components/campaigns/FollowupPreviewDialog';
import {
  buildStarter, computeThrottlePlan, recommendPlan, suggestRate, CLICK_FOLLOWUP_TEMPLATE_NAME_KEY,
  DEFAULT_STUDIO_THEME, MIN_RATE, MAX_DAYS, MIN_DAYS, SMALL_AUDIENCE,
  type PlanWarning, type StudioCampaign, type ThrottleMode, type ThrottlePlan, type ThrottlePlanResult,
} from '@/lib/email';
import { useStudio } from './store';
import { useAudienceCount, useEmailQuota, useEmailTemplates, type EmailQuota, type StudioScope } from './hooks';
import {
  BORDER, CARD_INNER, FlowCard, FONT_UI, MicroLabel, OptionPills, POS, RED, RED_SOFT_GRAD, StatusBadge,
  SUBTLE, Switch, T1, T2, T3, ToggleRow, WARN, inputStyle,
} from './ui';

/** Départ effectif du plan : la date planifiée, sinon « maintenant » arrondi aux 5 min. */
function planStart(scheduledAt: string | null, now: Date): Date {
  if (scheduledAt) {
    const d = new Date(scheduledAt);
    if (!Number.isNaN(d.getTime()) && d.getTime() > now.getTime()) return d;
  }
  const d = new Date(now);
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil((d.getMinutes() + 1) / 5) * 5);
  return d;
}

/** Écran Planification : quand partir, quota du mois, délivrabilité, A/B. */
export default function ScheduleStep({ scope, basePath }: { scope: StudioScope; basePath?: string }) {
  const { t } = useLanguage();
  const campaign = useStudio((s) => s.campaign);
  const patchCampaign = useStudio((s) => s.patchCampaign);
  const { quota, refresh } = useEmailQuota(scope);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const saveSeq = useStudio((s) => s.saveSeq);
  // Le net réel de l'audience (RPC sur la campagne sauvegardée) : c'est lui qui
  // dimensionne les vagues du lissage.
  const { count, loading: countLoading } = useAudienceCount(campaign.id, saveSeq, campaign.audiences.length > 0);
  const net = campaign.audiences.length > 0 ? (count?.net ?? null) : 0;
  // Figé au montage : un « maintenant » qui bouge à chaque rendu ferait
  // recalculer la proposition en boucle.
  const [now] = useState(() => new Date());
  const start = useMemo(() => planStart(campaign.scheduledAt, now), [campaign.scheduledAt, now]);

  const throttleOn = campaign.throttlePerHour != null;
  const plan: ThrottlePlan = campaign.throttlePlan || { mode: 'day', days: MIN_DAYS, custom: false };

  const enableThrottle = () => {
    const reco = recommendPlan(net ?? 0, quota?.dayCap);
    patchCampaign({
      throttlePerHour: suggestRate({ total: net ?? 0, start, mode: reco.mode, days: reco.days, quietHours: campaign.quietHours }),
      throttleWindowMinutes: reco.mode === 'hour' ? 15 : 60,
      throttlePlan: { ...reco, custom: false },
    });
  };

  // Tant que le pro n'a pas fixé son propre plafond, la proposition suit
  // l'audience, l'heure de départ, la nuit et le cadre choisi.
  useEffect(() => {
    if (!throttleOn || plan.custom || net == null) return;
    const rate = suggestRate({ total: net, start, mode: plan.mode, days: plan.days, quietHours: campaign.quietHours });
    const window = plan.mode === 'hour' ? 15 : 60;
    if (rate !== campaign.throttlePerHour || window !== campaign.throttleWindowMinutes) {
      patchCampaign({ throttlePerHour: rate, throttleWindowMinutes: window });
    }
  }, [throttleOn, plan.custom, plan.mode, plan.days, net, start, campaign.quietHours, campaign.throttlePerHour, campaign.throttleWindowMinutes, patchCampaign]);

  const mode: 'now' | 'later' = campaign.scheduledAt ? 'later' : 'now';
  const [datePart, timePart] = (campaign.scheduledAt || 'T').split('T');

  const setSchedule = () => {
    if (!campaign.scheduledAt) {
      const in2h = new Date(Date.now() + 2 * 3_600_000);
      in2h.setMinutes(0, 0, 0);
      const pad = (n: number) => String(n).padStart(2, '0');
      patchCampaign({
        scheduledAt: `${in2h.getFullYear()}-${pad(in2h.getMonth() + 1)}-${pad(in2h.getDate())}T${pad(in2h.getHours())}:00`,
      });
    }
  };

  return (
    <div className="yn-in" style={{ maxWidth: 860, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ── Quand partir ? ── */}
      <FlowCard>
        <h3 style={{ margin: '0 0 4px', color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', fontFamily: FONT_UI }}>
          {t('studio.sched.when')}
        </h3>
        <p style={{ margin: '0 0 16px', color: T3, fontSize: 11.5, fontFamily: FONT_UI }}>
          {t('studio.sched.whenHint')}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <ModeCard
            on={mode === 'now'}
            onClick={() => patchCampaign({ scheduledAt: null })}
            icon={<Zap size={16} strokeWidth={1.75} />}
            title={t('studio.sched.now')}
            desc={t('studio.sched.nowHelp')}
          />
          <ModeCard
            on={mode === 'later'}
            onClick={setSchedule}
            icon={<CalendarClock size={16} strokeWidth={1.75} />}
            title={t('studio.sched.later')}
            desc={t('studio.sched.laterHelp')}
          />
          <ModeCard
            on={false}
            disabled
            icon={<Sparkles size={16} strokeWidth={1.75} />}
            title={t('studio.sched.sto')}
            desc={t('studio.sched.stoHelp')}
            badge={t('studio.sched.soon')}
          />
        </div>

        {mode === 'later' && (
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginTop: 14 }}>
            <div>
              <MicroLabel style={{ marginBottom: 7 }}>{t('studio.sched.date')}</MicroLabel>
              <input
                type="date"
                value={datePart || ''}
                onChange={(e) => patchCampaign({ scheduledAt: `${e.target.value}T${timePart || '18:30'}` })}
                aria-label={t('studio.sched.date')}
                style={{ ...inputStyle, colorScheme: 'dark' }}
              />
            </div>
            <div>
              <MicroLabel style={{ marginBottom: 7 }}>{t('studio.sched.time')}</MicroLabel>
              <input
                type="time"
                value={timePart || ''}
                onChange={(e) => patchCampaign({ scheduledAt: `${datePart || new Date().toISOString().slice(0, 10)}T${e.target.value}` })}
                aria-label={t('studio.sched.time')}
                style={{ ...inputStyle, colorScheme: 'dark' }}
              />
            </div>
          </div>
        )}
      </FlowCard>

      {/* ── Délivrabilité ── */}
      <FlowCard style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h3 style={{ margin: 0, color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', fontFamily: FONT_UI }}>
          {t('studio.sched.deliverability')}
        </h3>
        {/* ── Quota du mois — discret tant que tout va bien ──────────────
            <80 % : une ligne neutre, rien d'autre. ≥80 % : la barre passe en
            ambre + le reste dispo + un lien texte. Épuisé : état factuel (pas
            une erreur) + la date de reprise + le bouton d'achat. */}
        {quota && (() => {
          const pctFree = Math.min(1, quota.used / Math.max(1, quota.free));
          const exhausted = quota.remaining <= 0;
          const warn = !exhausted && pctFree >= 0.8;
          const barColor = exhausted ? RED : warn ? '#FCD34D' : 'rgba(255,255,255,0.35)';
          const resetDate = new Date(quota.resetsOn).toLocaleDateString();
          const nf = (n: number) => n.toLocaleString('fr-FR');
          return (
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 7 }}>
                <MicroLabel>{t('studio.sched.quotaTitle')}</MicroLabel>
                <span style={{ flex: 1 }} />
                {quota.credits > 0 && (
                  <span style={{
                    color: T2, fontSize: 10.5, fontWeight: 600, fontFamily: FONT_UI, padding: '2px 7px',
                    borderRadius: 999, background: 'rgba(255,255,255,0.06)', border: `1px solid ${BORDER}`,
                    fontVariantNumeric: 'tabular-nums',
                  }}>{t('studio.sched.quotaCredits').replace('{n}', nf(quota.credits))}</span>
                )}
                <span style={{ color: warn || exhausted ? T1 : T2, fontSize: 12, fontWeight: 560, fontFamily: FONT_UI, fontVariantNumeric: 'tabular-nums' }}>
                  {nf(quota.used)} / {nf(quota.free)}
                </span>
              </div>
              <div style={{ height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: `${Math.round(pctFree * 100)}%`, borderRadius: 999,
                  background: barColor, transition: 'width .3s, background .3s',
                }} />
              </div>
              {warn && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                  <span style={{ color: T3, fontSize: 11.5, fontFamily: FONT_UI, flex: 1 }}>
                    {t('studio.sched.quotaLeft').replace('{n}', nf(quota.remaining))}
                  </span>
                  <button
                    type="button" onClick={() => setCreditsOpen(true)}
                    style={{
                      background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                      color: T2, fontSize: 11.5, fontWeight: 600, fontFamily: FONT_UI,
                      textDecoration: 'underline', textUnderlineOffset: 3,
                    }}
                  >{t('studio.sched.quotaBuy')}</button>
                </div>
              )}
              {exhausted && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, padding: '10px 12px',
                  borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: `1px solid ${BORDER}`,
                }}>
                  <span style={{ color: T2, fontSize: 11.5, lineHeight: 1.45, fontFamily: FONT_UI, flex: 1 }}>
                    {t('studio.sched.quotaFull').replace('{date}', resetDate)}
                  </span>
                  <button
                    type="button" onClick={() => setCreditsOpen(true)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, flex: 'none', cursor: 'pointer',
                      padding: '7px 12px', borderRadius: 10, background: RED, border: `1px solid ${RED}`,
                      color: '#fff', fontSize: 11.5, fontWeight: 600, fontFamily: FONT_UI,
                    }}
                  ><Plus size={13} strokeWidth={2.25} />{t('studio.sched.quotaBuy')}</button>
                </div>
              )}
            </div>
          );
        })()}

        <ToggleRow
          checked={throttleOn}
          onChange={(v) => {
            if (v) enableThrottle();
            else patchCampaign({ throttlePerHour: null, throttlePlan: null, throttleWindowMinutes: 60 });
          }}
          label={t('studio.sched.throttle')}
          help={t('studio.sched.throttleHelp')}
        />
        {throttleOn && (
          <ThrottlePlanner
            campaign={campaign}
            plan={plan}
            net={net}
            countLoading={countLoading}
            quota={quota}
            start={start}
            onPatch={patchCampaign}
          />
        )}
        <ToggleRow
          checked={campaign.quietHours}
          onChange={(v) => patchCampaign({ quietHours: v })}
          label={t('studio.sched.quiet')}
          help={t('studio.sched.quietHelp')}
        />
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 9, padding: '11px 13px', borderRadius: 12,
          background: 'rgba(52,211,153,0.07)', border: '1px solid rgba(52,211,153,0.2)',
        }}>
          <ShieldCheck size={14} strokeWidth={1.75} style={{ color: '#34D399', marginTop: 1, flex: 'none' }} />
          <span style={{ color: T2, fontSize: 11.5, lineHeight: 1.5, fontFamily: FONT_UI }}>
            {t('studio.sched.domainOkPre')} <span style={{ color: T1 }}>yunoapp.eu</span> {t('studio.sched.domainOkPost')}
          </span>
        </div>
      </FlowCard>

      {/* ── Relance ciblée après clic ── */}
      {campaign.type === 'promotional' && (
        <FollowupCard campaign={campaign} scope={scope} basePath={basePath} onPatch={patchCampaign} />
      )}

      {/* ── A/B ── */}
      <FlowCard style={{ display: 'flex', alignItems: 'center', gap: 14, flexDirection: 'row' }}>
        <div style={{
          width: 32, height: 32, borderRadius: 11, display: 'flex', alignItems: 'center',
          justifyContent: 'center', background: 'rgba(232,25,44,0.1)',
          border: '1px solid rgba(232,25,44,0.2)', color: RED, flex: 'none',
        }}><Split size={16} strokeWidth={1.75} /></div>
        <div style={{ flex: 1 }}>
          <div style={{ color: T1, fontSize: 13, fontWeight: 560, fontFamily: FONT_UI }}>{t('studio.data.abToggle')}</div>
          <div style={{ color: T3, fontSize: 11.5, marginTop: 2, fontFamily: FONT_UI }}>{t('studio.sched.abSub')}</div>
        </div>
        <Switch
          checked={campaign.abOn}
          onChange={(v) => patchCampaign({ abOn: v })}
          ariaLabel={t('studio.data.abToggle')}
        />
      </FlowCard>

      {/* La plateforme puise dans le pool marketing de Yuno : rien a acheter. */}
      {scope.kind !== 'platform' && (
        <EmailCreditsDialog
          open={creditsOpen}
          onClose={() => setCreditsOpen(false)}
          scope={scope.kind === 'venue' ? { kind: 'venue', venueId: scope.venueId } : { kind: 'organizer', organizerId: scope.organizerId }}
          onCredited={refresh}
        />
      )}
    </div>
  );
}

// ── Relance ciblée après clic ────────────────────────────────────────────────

const FOLLOWUP_DELAYS = [6, 12, 24, 48];

function FollowupCard({ campaign, scope, basePath, onPatch }: {
  campaign: StudioCampaign; scope: StudioScope; basePath?: string; onPatch: (patch: Partial<StudioCampaign>) => void;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { templates, create } = useEmailTemplates(scope);
  const [creating, setCreating] = useState(false);
  const [preview, setPreview] = useState(false);
  const chosen = templates.find((tpl) => tpl.id === campaign.followupTemplateId) || null;
  const on = campaign.followupEnabled;
  const hasEvent = !!campaign.eventId;
  const fill = (key: string, vars: Record<string, string | number>) =>
    Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), t(key));

  // Le modèle Yuno, créé d'un clic dans les modèles du compte : le pro le
  // retouche ensuite comme n'importe quel modèle, la relance prend toujours
  // la dernière version enregistrée au moment de partir.
  const createStarter = async () => {
    setCreating(true);
    try {
      const content = buildStarter('click_followup', { venueName: scope.name, theme: DEFAULT_STUDIO_THEME, t });
      const id = await create(t(CLICK_FOLLOWUP_TEMPLATE_NAME_KEY), t('studio.starter.click_followup.desc'), content);
      if (!id) { toast.error(t('studio.sched.fu.createError')); return; }
      onPatch({ followupTemplateId: id, followupEnabled: true });
      toast.success(t('studio.sched.fu.created'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <FlowCard style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 11, display: 'flex', alignItems: 'center',
          justifyContent: 'center', background: 'rgba(232,25,44,0.1)',
          border: '1px solid rgba(232,25,44,0.2)', color: RED, flex: 'none',
        }}><Repeat size={16} strokeWidth={1.75} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: T1, fontSize: 13, fontWeight: 560, fontFamily: FONT_UI }}>{t('studio.sched.fu.title')}</div>
          <div style={{ color: T3, fontSize: 11.5, marginTop: 2, fontFamily: FONT_UI, lineHeight: 1.45 }}>
            {hasEvent ? fill('studio.sched.fu.sub', { h: campaign.followupDelayHours }) : t('studio.sched.fu.needEvent')}
          </div>
        </div>
        <Switch
          checked={on && hasEvent}
          disabled={!hasEvent}
          onChange={(v) => onPatch({ followupEnabled: v })}
          ariaLabel={t('studio.sched.fu.title')}
        />
      </div>

      {on && hasEvent && (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 14, padding: 14, borderRadius: 14,
          background: CARD_INNER, border: `1px solid ${BORDER}`,
        }}>
          <div>
            <MicroLabel style={{ marginBottom: 8 }}>{t('studio.sched.fu.delay')}</MicroLabel>
            <OptionPills<number>
              value={campaign.followupDelayHours}
              onChange={(h) => onPatch({ followupDelayHours: h })}
              ariaLabel={t('studio.sched.fu.delay')}
              options={FOLLOWUP_DELAYS.map((h) => ({ value: h, label: fill('studio.sched.fu.hours', { h }) }))}
            />
          </div>

          <div>
            <MicroLabel style={{ marginBottom: 8 }}>{t('studio.sched.fu.template')}</MicroLabel>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select
                value={campaign.followupTemplateId || ''}
                onChange={(e) => onPatch({ followupTemplateId: e.target.value || null })}
                aria-label={t('studio.sched.fu.template')}
                style={{ ...inputStyle, flex: 1, minWidth: 220, colorScheme: 'dark' }}
              >
                <option value="">{t('studio.sched.fu.templateNone')}</option>
                {templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
              </select>
              <button
                type="button" onClick={() => void createStarter()} disabled={creating}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', flex: 'none',
                  padding: '8px 12px', borderRadius: 10, background: SUBTLE, border: `1px solid ${BORDER}`,
                  color: T1, fontSize: 11.5, fontWeight: 600, fontFamily: FONT_UI, opacity: creating ? 0.6 : 1,
                }}
              >
                {creating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} strokeWidth={1.75} />}
                {creating ? t('studio.sched.fu.creating') : t('studio.sched.fu.createStarter')}
              </button>
            </div>
            {chosen && (
              <button
                type="button" onClick={() => setPreview(true)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginTop: 8,
                  padding: '8px 12px', borderRadius: 10, background: SUBTLE, border: `1px solid ${BORDER}`,
                  color: T1, fontSize: 11.5, fontWeight: 600, fontFamily: FONT_UI,
                }}
              >
                <Eye size={13} strokeWidth={1.75} style={{ color: RED }} />
                {t('studio.sched.fu.preview')}
              </button>
            )}
            <div style={{ color: T3, fontSize: 11, marginTop: 7, lineHeight: 1.5, fontFamily: FONT_UI }}>
              {campaign.followupTemplateId && basePath ? (
                <button
                  type="button" onClick={() => navigate(`${basePath}/templates/${campaign.followupTemplateId}`)}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: RED, fontSize: 11, fontFamily: FONT_UI }}
                >{t('studio.sched.fu.editTemplate')} →</button>
              ) : t('studio.sched.fu.editHint')}
            </div>
            {!campaign.followupTemplateId && (
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: 9, padding: '9px 12px', borderRadius: 11, marginTop: 8,
                background: 'rgba(252,211,77,0.07)', border: '1px solid rgba(252,211,77,0.22)',
              }}>
                <AlertTriangle size={13} strokeWidth={1.75} style={{ color: WARN, marginTop: 1, flex: 'none' }} />
                <span style={{ color: T2, fontSize: 11.5, lineHeight: 1.5, fontFamily: FONT_UI }}>{t('studio.sched.fu.noTemplate')}</span>
              </div>
            )}
          </div>

          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 9, padding: '10px 12px', borderRadius: 11,
            background: 'rgba(52,211,153,0.07)', border: '1px solid rgba(52,211,153,0.2)',
          }}>
            <Sparkles size={13} strokeWidth={1.75} style={{ color: POS, marginTop: 1, flex: 'none' }} />
            <span style={{ color: T2, fontSize: 11.5, lineHeight: 1.5, fontFamily: FONT_UI }}>{t('studio.sched.fu.smart')}</span>
          </div>

          <div>
            <MicroLabel style={{ marginBottom: 6 }}>{t('studio.sched.fu.rulesTitle')}</MicroLabel>
            <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {['rule1', 'rule2', 'rule3', 'rule4', 'rule5'].map((k) => (
                <li key={k} style={{ color: T2, fontSize: 11.5, lineHeight: 1.5, fontFamily: FONT_UI }}>{t(`studio.sched.fu.${k}`)}</li>
              ))}
            </ul>
            <div style={{ color: T3, fontSize: 11, marginTop: 8, lineHeight: 1.5, fontFamily: FONT_UI }}>
              {t('studio.sched.fu.night')}
            </div>
          </div>
        </div>
      )}

      {preview && chosen && (
        <FollowupPreviewDialog
          template={chosen}
          scope={scope}
          eventId={campaign.eventId}
          campaignId={campaign.id}
          onClose={() => setPreview(false)}
        />
      )}
    </FlowCard>
  );
}

// ── Lissage : cadre, vagues, chronologie, alertes, pédagogie ─────────────────

function ThrottlePlanner({ campaign, plan, net, countLoading, quota, start, onPatch }: {
  campaign: StudioCampaign;
  plan: ThrottlePlan;
  net: number | null;
  countLoading: boolean;
  quota: EmailQuota | null;
  start: Date;
  onPatch: (patch: Partial<StudioCampaign>) => void;
}) {
  const { t, language } = useLanguage();
  const [whyOpen, setWhyOpen] = useState(false);
  const locale = language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB';
  const nf = (n: number) => n.toLocaleString(locale);
  const fmtDay = (d: Date) => d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtTime = (d: Date) => d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const fill = (key: string, vars: Record<string, string | number>) =>
    Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), t(key));

  const reco = useMemo(() => recommendPlan(net ?? 0, quota?.dayCap), [net, quota?.dayCap]);
  const result: ThrottlePlanResult | null = useMemo(() => {
    if (net == null) return null;
    return computeThrottlePlan({
      total: net, start, mode: plan.mode, days: plan.days, quietHours: campaign.quietHours,
      rate: campaign.throttlePerHour, dayCap: quota?.dayCap, dayUsed: quota?.dayUsed,
    });
  }, [net, start, plan.mode, plan.days, campaign.quietHours, campaign.throttlePerHour, quota?.dayCap, quota?.dayUsed]);

  const setMode = (mode: ThrottleMode) => onPatch({
    throttlePlan: { ...plan, mode, custom: false },
    throttleWindowMinutes: mode === 'hour' ? 15 : 60,
  });
  const setDays = (days: number) => onPatch({ throttlePlan: { ...plan, days, custom: false } });
  const setRate = (raw: string) => {
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n)) return;
    onPatch({ throttlePerHour: Math.max(MIN_RATE, n), throttlePlan: { ...plan, custom: true } });
  };
  const resetRate = () => onPatch({
    throttlePerHour: result?.suggestedRate ?? MIN_RATE,
    throttlePlan: { ...plan, custom: false },
  });

  const unitKey = plan.mode === 'hour' ? 'studio.sched.thr.perQuarter' : 'studio.sched.thr.perHour';
  const modeLabel = (m: ThrottleMode) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {t(`studio.sched.thr.mode.${m}`)}
      {reco.mode === m && (
        <span style={{
          fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
          color: POS, padding: '1px 5px', borderRadius: 5, background: 'rgba(52,211,153,0.12)',
        }}>{t('studio.sched.thr.recoBadge')}</span>
      )}
    </span>
  );

  const adviceKey = net == null ? null
    : net < SMALL_AUDIENCE ? 'studio.sched.thr.advice.small'
    : `studio.sched.thr.advice.${reco.mode}`;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 14, padding: 14, borderRadius: 14,
      background: CARD_INNER, border: `1px solid ${BORDER}`,
    }}>
      {/* Cadre */}
      <div>
        <MicroLabel style={{ marginBottom: 8 }}>{t('studio.sched.thr.frame')}</MicroLabel>
        <OptionPills<ThrottleMode>
          value={plan.mode}
          onChange={setMode}
          ariaLabel={t('studio.sched.thr.frame')}
          options={[
            { value: 'hour', label: modeLabel('hour') },
            { value: 'day', label: modeLabel('day') },
            { value: 'days', label: modeLabel('days') },
          ]}
        />
        <div style={{ color: T3, fontSize: 11, marginTop: 7, lineHeight: 1.5, fontFamily: FONT_UI }}>
          {fill(`studio.sched.thr.modeHelp.${plan.mode}`, { days: plan.days })}
        </div>
      </div>

      {plan.mode === 'days' && (
        <div>
          <MicroLabel style={{ marginBottom: 8 }}>{t('studio.sched.thr.days')}</MicroLabel>
          <OptionPills<number>
            value={plan.days}
            onChange={setDays}
            ariaLabel={t('studio.sched.thr.days')}
            options={Array.from({ length: MAX_DAYS - MIN_DAYS + 1 }, (_, i) => ({ value: MIN_DAYS + i, label: String(MIN_DAYS + i) }))}
          />
        </div>
      )}

      {net == null || countLoading ? (
        <div style={{ color: T3, fontSize: 11.5, fontFamily: FONT_UI }}>
          {campaign.audiences.length === 0 ? t('studio.sched.thr.noAudience') : t('studio.sched.thr.loading')}
        </div>
      ) : net === 0 ? (
        <div style={{ color: T3, fontSize: 11.5, fontFamily: FONT_UI }}>{t('studio.sched.thr.noAudience')}</div>
      ) : result && (
        <>
          {/* Plafond par vague — la proposition, modifiable */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ color: T1, fontSize: 12.5, fontWeight: 500, fontFamily: FONT_UI }}>{t('studio.sched.thr.rate')}</div>
              <div style={{ color: T3, fontSize: 11, marginTop: 2, fontFamily: FONT_UI }}>
                {plan.custom
                  ? fill('studio.sched.thr.rateCustom', { n: nf(result.suggestedRate) })
                  : t('studio.sched.thr.rateSuggested')}
                {plan.custom && (
                  <>
                    {' · '}
                    <button
                      type="button" onClick={resetRate}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: RED, fontSize: 11, fontFamily: FONT_UI }}
                    >{t('studio.sched.thr.reset')}</button>
                  </>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="number" min={MIN_RATE} step={10}
                value={campaign.throttlePerHour ?? result.rate}
                onChange={(e) => setRate(e.target.value)}
                aria-label={t('studio.sched.thr.rate')}
                style={{ ...inputStyle, width: 96, textAlign: 'right', colorScheme: 'dark' }}
              />
              <span style={{ color: T2, fontSize: 11.5, fontFamily: FONT_UI, whiteSpace: 'nowrap' }}>{t(unitKey)}</span>
            </div>
          </div>

          {/* Résumé */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', borderRadius: 11,
            background: RED_SOFT_GRAD, border: '1px solid rgba(232,25,44,0.2)',
          }}>
            <Waves size={14} strokeWidth={1.75} style={{ color: RED, flex: 'none' }} />
            <span style={{ color: T1, fontSize: 12, lineHeight: 1.5, fontFamily: FONT_UI }}>
              {fill('studio.sched.thr.summary', {
                n: nf(net), waves: result.waves.length, rate: nf(result.rate),
                end: result.endAt ? `${fmtDay(result.endAt)} ${fmtTime(result.endAt)}` : '—',
              })}
            </span>
          </div>

          {/* Chronologie : une ligne par jour, une barre par vague */}
          <Timeline result={result} start={start} fmtDay={fmtDay} fmtTime={fmtTime} nf={nf} t={t} />

          {/* Alertes */}
          {result.warnings.map((w) => (
            <Warning
              key={w} kind={w}
              text={fill(`studio.sched.thr.warn.${w}`, {
                n: nf(SMALL_AUDIENCE), cap: nf(quota?.dayCap || 0), days: result.spanDays,
                date: result.endAt ? fmtDay(result.endAt) : '—',
              })}
              action={w === 'night' ? { label: t('studio.sched.thr.enableQuiet'), onClick: () => onPatch({ quietHours: true }) } : undefined}
            />
          ))}

          <div style={{ color: T3, fontSize: 10.5, lineHeight: 1.5, fontFamily: FONT_UI }}>
            {t('studio.sched.thr.estimate')}
          </div>
        </>
      )}

      {/* Pédagogie : pourquoi, et ce que ça risque */}
      <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 12 }}>
        <button
          type="button" onClick={() => setWhyOpen((v) => !v)} aria-expanded={whyOpen}
          style={{
            display: 'flex', alignItems: 'center', gap: 7, width: '100%', background: 'none', border: 'none',
            padding: 0, cursor: 'pointer', color: T2, fontSize: 12, fontWeight: 500, fontFamily: FONT_UI, textAlign: 'left',
          }}
        >
          <Info size={13} strokeWidth={1.75} style={{ color: T3 }} />
          <span style={{ flex: 1 }}>{t('studio.sched.thr.why')}</span>
          <ChevronDown size={14} strokeWidth={1.75} style={{ transform: whyOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s', color: T3 }} />
        </button>
        {whyOpen && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, marginTop: 12 }}>
            <WhyList title={t('studio.sched.thr.whyPro')} tone={POS} items={[t('studio.sched.thr.pro1'), t('studio.sched.thr.pro2'), t('studio.sched.thr.pro3')]} />
            <WhyList title={t('studio.sched.thr.whyRisk')} tone={WARN} items={[t('studio.sched.thr.risk1'), t('studio.sched.thr.risk2'), t('studio.sched.thr.risk3')]} />
            {adviceKey && (
              <div style={{
                gridColumn: '1 / -1', padding: '10px 12px', borderRadius: 11, background: SUBTLE,
                border: `1px solid ${BORDER}`, color: T2, fontSize: 11.5, lineHeight: 1.55, fontFamily: FONT_UI,
              }}>
                <span style={{ color: T1, fontWeight: 600 }}>{t('studio.sched.thr.adviceTitle')}</span>{' '}
                {fill(adviceKey, { n: nf(net ?? 0), days: reco.days, small: nf(SMALL_AUDIENCE) })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Timeline({ result, start, fmtDay, fmtTime, nf, t }: {
  result: ThrottlePlanResult; start: Date;
  fmtDay: (d: Date) => string; fmtTime: (d: Date) => string; nf: (n: number) => string; t: (k: string) => string;
}) {
  const max = Math.max(1, ...result.waves.map((w) => w.count));
  const startKey = start.toDateString();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {result.days.map((day) => {
        const dense = day.waves.length > 8;
        const isStartDay = day.date.toDateString() === startKey;
        return (
          <div key={day.date.toISOString()}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 5 }}>
              <span style={{ color: T2, fontSize: 11.5, fontWeight: 500, fontFamily: FONT_UI, textTransform: 'capitalize' }}>
                {fmtDay(day.date)}
                {isStartDay && <span style={{ color: T3, fontWeight: 400 }}> · {t('studio.sched.thr.startDay')}</span>}
              </span>
              <span style={{ color: T1, fontSize: 11.5, fontWeight: 600, fontFamily: FONT_UI }}>
                {nf(day.count)} <span style={{ color: T3, fontWeight: 400 }}>· {day.waves.length} {t(day.waves.length > 1 ? 'studio.sched.thr.waves' : 'studio.sched.thr.wave')}</span>
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: dense ? 2 : 4, height: 34 }}>
              {day.waves.map((w) => (
                <div
                  key={w.at.toISOString()} title={`${fmtTime(w.at)} · ${nf(w.count)}`}
                  style={{
                    flex: 1, minWidth: 2, borderRadius: 3,
                    height: `${Math.max(12, Math.round((w.count / max) * 100))}%`,
                    background: 'linear-gradient(180deg, rgba(232,25,44,0.75), rgba(232,25,44,0.4))',
                  }}
                />
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              {dense ? (
                <>
                  <span style={{ color: T3, fontSize: 10, fontFamily: FONT_UI }}>{fmtTime(day.waves[0].at)}</span>
                  <span style={{ color: T3, fontSize: 10, fontFamily: FONT_UI }}>{fmtTime(day.waves[day.waves.length - 1].at)}</span>
                </>
              ) : day.waves.map((w) => (
                <span key={w.at.toISOString()} style={{ flex: 1, textAlign: 'center', color: T3, fontSize: 10, fontFamily: FONT_UI }}>
                  {fmtTime(w.at)}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Warning({ kind, text, action }: {
  kind: PlanWarning; text: string; action?: { label: string; onClick: () => void };
}) {
  const info = kind === 'small';
  const color = info ? T3 : WARN;
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 9, padding: '9px 12px', borderRadius: 11,
      background: info ? SUBTLE : 'rgba(252,211,77,0.07)', border: `1px solid ${info ? BORDER : 'rgba(252,211,77,0.22)'}`,
    }}>
      {info
        ? <Info size={13} strokeWidth={1.75} style={{ color, marginTop: 1, flex: 'none' }} />
        : <AlertTriangle size={13} strokeWidth={1.75} style={{ color, marginTop: 1, flex: 'none' }} />}
      <span style={{ color: T2, fontSize: 11.5, lineHeight: 1.5, fontFamily: FONT_UI, flex: 1 }}>{text}</span>
      {action && (
        <button
          type="button" onClick={action.onClick}
          style={{
            flex: 'none', padding: '4px 10px', borderRadius: 8, cursor: 'pointer',
            background: 'rgba(252,211,77,0.14)', border: '1px solid rgba(252,211,77,0.3)',
            color: WARN, fontSize: 11, fontWeight: 600, fontFamily: FONT_UI,
          }}
        >{action.label}</button>
      )}
    </div>
  );
}

function WhyList({ title, tone, items }: { title: string; tone: string; items: string[] }) {
  return (
    <div>
      <div style={{ color: tone, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6, fontFamily: FONT_UI }}>
        {title}
      </div>
      <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 5 }}>
        {items.map((it) => (
          <li key={it} style={{ color: T2, fontSize: 11.5, lineHeight: 1.5, fontFamily: FONT_UI }}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

function ModeCard({ on, onClick, icon, title, desc, badge, disabled }: {
  on: boolean; onClick?: () => void; icon: React.ReactNode; title: string; desc: string;
  badge?: string; disabled?: boolean;
}) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} aria-pressed={on}
      style={{
        display: 'flex', gap: 12, alignItems: 'flex-start', padding: '15px 16px', borderRadius: 14,
        cursor: disabled ? 'default' : 'pointer', textAlign: 'left', width: '100%',
        background: on ? RED_SOFT_GRAD : SUBTLE,
        border: `1px solid ${on ? 'rgba(232,25,44,0.28)' : BORDER}`,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <div style={{
        width: 32, height: 32, borderRadius: 11, display: 'flex', alignItems: 'center',
        justifyContent: 'center', flex: 'none',
        background: on ? 'rgba(232,25,44,0.12)' : 'rgba(255,255,255,0.05)',
        border: `1px solid ${on ? 'rgba(232,25,44,0.25)' : BORDER}`,
        color: on ? RED : T3,
      }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: on ? T1 : T2, fontSize: 13.5, fontWeight: 560, fontFamily: FONT_UI }}>{title}</span>
          {badge && <StatusBadge label={badge} tone="neutral" />}
        </div>
        <div style={{ color: T3, fontSize: 11.5, marginTop: 2, fontFamily: FONT_UI }}>{desc}</div>
      </div>
      <span style={{
        width: 16, height: 16, borderRadius: '50%', flex: 'none', marginTop: 2,
        border: `1px solid ${on ? RED : 'rgba(255,255,255,0.2)'}`,
        background: on ? RED : 'transparent',
        boxShadow: on ? 'inset 0 0 0 3px #0a0a0c' : 'none',
      }} />
    </button>
  );
}
