// Publicité (Meta) pilotée depuis Yuno — club et organisateur.
// Design : docs/designs/META_ADS_INTEGRATION_PLAN.md (phases 3-4).
//
// Une page, quatre blocs : les chiffres qui comptent (dépense, ventes
// attribuées par Yuno, coût par vente), les campagnes (créer, lancer, mettre
// en pause, résultats), les audiences (segments Yuno poussés chez Meta,
// jumeaux), les leads (formulaires Instagram / Facebook versés dans la base).
// Ads Manager compte des conversions ; ici on compte des billets.
//
// `META_INTEGRATION_LIVE = false` : état « En construction », comme la carte
// Meta de Réglages → Intégrations.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useVenueContext } from '@/hooks/useVenueContext';
import { OwnerHeader } from '@/components/OwnerHeader';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { OrgPage, OrgPageHeader } from '@/components/org-ui';
import { useMetaIntegrationLive } from '@/lib/metaIntegration';
import { CampaignWizard } from '@/components/ads/CampaignWizard';
import {
  BUILTIN_AUDIENCES, RULE_AUDIENCES, RULE_AUDIENCE_WINDOWS, LOOKALIKE_RATIOS, isRuleAudience, attributedRevenueCents, attributedSales, costPerSaleCents, creativeCover,
  type AdsAudience, type AdsCampaign, type AdsPayload, type AudienceKind,
} from '@/lib/metaAds';
import type { WizardMode } from '@/components/ads/wizard/types';
import { toast } from 'sonner';
import {
  Rocket, Hammer, Loader2, Play, Pause, RefreshCw, Trash2, Users, Copy, AlertTriangle, ExternalLink,
  CheckCircle2, Sparkles, Inbox, Plug, ChevronDown, ChevronUp, Info, Pencil, CopyPlus, PlayCircle, PauseCircle,
} from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';

const RED = '#E8192C';
const POS = 'var(--acc-34d399)';
const WARN = 'var(--acc-fbbf24)';
const T1 = 'rgb(var(--ink)/var(--ink-a96,0.96))';
const T2 = 'rgb(var(--ink)/var(--ink-a58,0.58))';
const T3 = 'rgb(var(--ink)/var(--ink-a36,0.36))';
const BORDER = 'rgb(var(--ink)/0.085)';
const INNER_BG = 'rgb(var(--ink)/0.032)';
const CARD_BG = 'linear-gradient(180deg,rgb(var(--sheen)/.045) 0%,rgb(var(--sheen)/.008) 100%),var(--sf-0a0a0c)';
const CARD_SHADOW = '0 1px 0 rgb(var(--sheen)/.05) inset,0 18px 40px -28px rgb(0 0 0/calc(.9*var(--pro-shadow-a)))';
const META_BLUE = '#0866FF';

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 20, ...style }}>{children}</div>;
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'pos' | 'warn' }) {
  return (
    <div className="rounded-xl px-3.5 py-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
      <p style={{ color: T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</p>
      <p style={{ color: tone === 'pos' ? POS : tone === 'warn' ? WARN : T1, fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 2 }}>{value}</p>
      {sub && <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>{sub}</p>}
    </div>
  );
}

function Pill({ tone, children }: { tone: 'pos' | 'warn' | 'neg' | 'muted'; children: React.ReactNode }) {
  const s = tone === 'pos' ? { color: POS, background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.3)' }
    : tone === 'warn' ? { color: WARN, background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)' }
    : tone === 'neg' ? { color: RED, background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.35)' }
    : { color: T2, background: INNER_BG, border: `1px solid ${BORDER}` };
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold uppercase tracking-wider" style={s}>{children}</span>;
}

function Btn({ onClick, children, tone = 'ghost', disabled, busy }: { onClick: () => void; children: React.ReactNode; tone?: 'primary' | 'meta' | 'ghost' | 'danger'; disabled?: boolean; busy?: boolean }) {
  const s = tone === 'primary' ? { background: RED, color: '#fff' }
    : tone === 'meta' ? { background: META_BLUE, color: '#fff' }
    : tone === 'danger' ? { background: 'transparent', color: RED, border: '1px solid rgba(232,25,44,0.35)' }
    : { background: 'rgb(var(--ink)/0.08)', color: T1, border: `1px solid ${BORDER}` };
  return (
    <button type="button" onClick={onClick} disabled={disabled || busy}
      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12.5px] font-semibold disabled:opacity-50" style={s}>
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}{children}
    </button>
  );
}

export default function AdsPage() {
  const { t, language } = useLanguage();
  const locale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { venueId, organizerUserId, scope, mode, loading: scopeLoading } = useVenueContext();
  const metaLive = useMetaIntegrationLive();
  const [data, setData] = useState<AdsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardInitial, setWizardInitial] = useState<{ campaign: AdsCampaign; mode: WizardMode } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AdsCampaign | null>(null);
  const [confirmActivate, setConfirmActivate] = useState<AdsCampaign | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [showAudienceForm, setShowAudienceForm] = useState(false);
  const [audKind, setAudKind] = useState<Exclude<AudienceKind, 'lookalike'>>('builtin');
  const [lookalikeRatio, setLookalikeRatio] = useState<number>(0.03);
  const [audRef, setAudRef] = useState<string>('buyers_12m');
  const [audCount, setAudCount] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const isOrganizer = scope === 'organizer';
  const metaScope = useMemo(() => (isOrganizer ? { organizerUserId } : { venueId }), [isOrganizer, organizerUserId, venueId]);
  const basePath = mode === 'organizer' ? '/organizer-app' : mode === 'manager' ? '/manager' : '/owner';
  const ready = isOrganizer ? !!organizerUserId : !!venueId;

  const load = useCallback(async () => {
    if (!ready) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: d, error } = await supabase.rpc('get_my_meta_ads' as any, { p_venue_id: venueId ?? null, p_organizer_user_id: isOrganizer ? organizerUserId : null });
    // Une panne de lecture n'est pas « pas connecté » : on l'affiche, avec un bouton.
    if (error) setLoadError(true);
    else { setLoadError(false); setData(d as unknown as AdsPayload); }
    setLoading(false);
  }, [ready, venueId, organizerUserId, isOrganizer]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (searchParams.get('event') && data?.connection?.ads_ready && metaLive) setWizardOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.connection?.ads_ready]);

  const call = async (action: string, body: Record<string, unknown>) => {
    const { data: res, error } = await supabase.functions.invoke('meta-connect', { body: { action, scope: { venueId: metaScope.venueId ?? null, organizerUserId: metaScope.organizerUserId ?? null }, ...body } });
    if (error) {
      const ctx = (error as { context?: Response }).context;
      let code: string | null = null; let detail: string | null = null;
      if (ctx instanceof Response) { try { const j = (await ctx.clone().json()) as { error?: string; detail?: string }; code = j.error ?? null; detail = j.detail ?? null; } catch { /* no-op */ } }
      throw new Error(detail ? `${code}: ${detail}` : (code ?? error.message));
    }
    return res as Record<string, unknown>;
  };
  const run = async (key: string, fn: () => Promise<void>, okMsg?: string) => {
    setBusy(key);
    try { await fn(); if (okMsg) toast.success(okMsg); await load(); }
    catch (e) { toast.error(`${t('ads.err.generic')} ${e instanceof Error ? e.message : ''}`.trim()); }
    finally { setBusy(null); }
  };

  // Comptage en direct d'une audience avant création.
  useEffect(() => {
    if (!showAudienceForm || !data?.connection) return;
    let cancelled = false;
    setAudCount(null);
    if (isRuleAudience(audKind)) { setAudCount(-1); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase.rpc('count_meta_audience' as any, { p_connection_id: data.connection.id, p_kind: audKind, p_ref: audRef }).then(({ data: n }) => { if (!cancelled) setAudCount(typeof n === 'number' ? n : 0); });
    return () => { cancelled = true; };
  }, [showAudienceForm, audKind, audRef, data?.connection]);

  const fmtMoney = (cents: number) => new Intl.NumberFormat(language === 'en' ? 'en-GB' : language === 'es' ? 'es-ES' : 'fr-FR', { style: 'currency', currency: data?.connection?.last_health?.ad_account?.currency ?? 'EUR', maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
  const fmtDate = (iso: string | null | undefined, f = 'd MMM, HH:mm') => (iso ? format(new Date(iso), f, { locale }) : '—');
  // Identité retenue à la connexion (Page + Instagram relié) : montrée dans l'aperçu de la pub.
  const metaAssets = data?.connection?.assets as { pages?: { id: string; name: string }[]; instagram?: { page_id: string; id: string; username: string | null }[] } | null | undefined;
  const pageName = metaAssets?.pages?.find((p) => p.id === data?.connection?.page_id)?.name ?? null;
  const igUsername = metaAssets?.instagram?.find((i) => i.page_id === data?.connection?.page_id)?.username ?? null;

  const totals = useMemo(() => {
    const cs = data?.campaigns ?? [];
    const spend = cs.reduce((s, c) => s + (c.insights?.spend_cents ?? 0), 0);
    const sales = cs.reduce((s, c) => s + attributedSales(c.attributed), 0);
    const revenue = cs.reduce((s, c) => s + attributedRevenueCents(c.attributed), 0);
    const clicks = cs.reduce((s, c) => s + (c.insights?.link_clicks ?? 0), 0);
    return { spend, sales, revenue, clicks, cps: costPerSaleCents(spend, sales) };
  }, [data]);

  const audienceName = (kind: string, ref: string) => {
    if (kind === 'builtin') return t(`ads.audience.builtin.${ref}`);
    if (isRuleAudience(kind)) return `${t(`ads.audience.rule.${kind}`)} · ${t('ads.audience.rule.days').replace('{n}', ref)}`;
    if (kind === 'venue_segment') return data?.segments.venue.find((s) => s.id === ref)?.name ?? ref;
    if (kind === 'contact_segment') return data?.segments.contact.find((s) => s.id === ref)?.name ?? ref;
    return ref;
  };

  const header = mode === 'organizer'
    ? <OrgPageHeader title={t('ads.title')} subtitle={t('ads.subtitle')} />
    : <OwnerHeader title={t('ads.title')} />;

  const body = (() => {
    if (scopeLoading || (loading && !data)) return <OwnerPageSkeleton />;

    if (!metaLive) {
      return (
        <Card>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(232,25,44,0.14)', border: '1px solid rgba(232,25,44,0.35)' }}><Rocket className="w-5 h-5" style={{ color: RED }} /></div>
              <div>
                <p style={{ color: T1, fontSize: 16, fontWeight: 700 }}>{t('ads.building.title')}</p>
                <p style={{ color: T2, fontSize: 13, marginTop: 2, maxWidth: 600, lineHeight: 1.5 }}>{t('ads.building.body')}</p>
              </div>
            </div>
            <Pill tone="warn"><Hammer className="w-3 h-3" /> {t('integ.meta.status.building')}</Pill>
          </div>
          <div className="grid gap-2 sm:grid-cols-4 mt-5">
            {(['launch', 'target', 'measure', 'leads'] as const).map((k) => (
              <div key={k} className="rounded-xl px-3 py-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                <p style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{t(`ads.building.${k}.h`)}</p>
                <p style={{ color: T2, fontSize: 12.5, marginTop: 4, lineHeight: 1.45 }}>{t(`ads.building.${k}.b`)}</p>
              </div>
            ))}
          </div>
        </Card>
      );
    }

    if (loadError && !data) {
      return (
        <Card>
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: WARN }} />
            <div className="flex-1">
              <p style={{ color: T1, fontSize: 15, fontWeight: 700 }}>{t('ads.err.load')}</p>
              <div className="mt-4"><Btn onClick={() => { setLoading(true); load(); }}><RefreshCw className="w-3.5 h-3.5" /> {t('ads.action.retry')}</Btn></div>
            </div>
          </div>
        </Card>
      );
    }

    const conn = data?.connection ?? null;
    if (!conn || !conn.ads_ready) {
      return (
        <Card>
          <div className="flex items-start gap-3">
            <Plug className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: META_BLUE }} />
            <div className="flex-1">
              <p style={{ color: T1, fontSize: 15, fontWeight: 700 }}>{!conn ? t('ads.connect.title') : conn.mode !== 'oauth' ? t('ads.connect.manualTitle') : t('ads.connect.assetsTitle')}</p>
              <p style={{ color: T2, fontSize: 13, marginTop: 4, lineHeight: 1.5, maxWidth: 640 }}>{!conn ? t('ads.connect.body') : conn.mode !== 'oauth' ? t('ads.connect.manualBody') : t('ads.connect.assetsBody')}</p>
              <div className="mt-4"><Btn tone="meta" onClick={() => navigate(`${basePath}/integrations`)}>{t('ads.connect.cta')}</Btn></div>
            </div>
          </div>
        </Card>
      );
    }

    const acct = conn.last_health?.ad_account;
    const campaigns = data!.campaigns;
    const audiences = data!.audiences;

    return (
      <>
        {/* Compte pub */}
        <Card style={{ padding: 16 }}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              <Pill tone="pos"><CheckCircle2 className="w-3 h-3" /> {t('ads.account.connected')}</Pill>
              {/* Meta n'expose `funding_source` que pour les comptes au moyen de
                  paiement hérité : un compte facturé au niveau du portefeuille
                  d'entreprise rend le champ ABSENT alors que la carte est bien
                  enregistrée (vérifié le 22/09 sur « Amoris Ads » : carte
                  Mastercard présente, account_status 1, champ omis malgré
                  ads_management, business_management et la tâche MANAGE). On ne
                  prétend donc jamais qu'il n'y a pas de moyen de paiement : on
                  le confirme quand Meta le dit, et on n'alerte que sur un état
                  de compte qui empêche vraiment la diffusion (impayé, suspendu,
                  fermé). */}
              {acct?.has_funding && <Pill tone="muted">{t('ads.account.fundingOk')}</Pill>}
              {acct && acct.account_status != null && acct.account_status !== 1 && (
                <Pill tone="warn"><AlertTriangle className="w-3 h-3" /> {t('ads.account.billingIssue')}</Pill>
              )}
              {acct && (acct.custom_audience_tos ? <Pill tone="muted">{t('ads.account.tosOk')}</Pill> : (
                <a href={acct.tos_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] underline underline-offset-2" style={{ color: WARN }}>
                  <AlertTriangle className="w-3 h-3" /> {t('ads.account.tosMissing')} <ExternalLink className="w-3 h-3" />
                </a>
              ))}
              {acct?.checked_at && <span style={{ color: T3, fontSize: 11.5 }}>{t('ads.account.checked').replace('{date}', fmtDate(acct.checked_at))}</span>}
            </div>
            <div className="flex items-center gap-2">
              <Btn onClick={() => run('acct', async () => { await call('ads_account_status', {}); })} busy={busy === 'acct'}><RefreshCw className="w-3.5 h-3.5" /> {t('ads.account.check')}</Btn>
              <Btn tone="primary" onClick={() => setWizardOpen(true)} disabled={(data!.events.length === 0)}><Rocket className="w-3.5 h-3.5" /> {t('ads.boost')}</Btn>
            </div>
          </div>
          {!acct && <p className="mt-2" style={{ color: T3, fontSize: 12 }}>{t('ads.account.checkHint')}</p>}
        </Card>

        {/* Chiffres */}
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label={t('ads.stat.spend')} value={fmtMoney(totals.spend)} sub={t('ads.stat.allCampaigns')} />
          <Stat label={t('ads.stat.sales')} value={String(totals.sales)} sub={t('ads.stat.salesSub')} tone="pos" />
          <Stat label={t('ads.stat.revenue')} value={fmtMoney(totals.revenue)} sub={t('ads.stat.revenueSub')} />
          <Stat label={t('ads.stat.cps')} value={totals.cps == null ? '—' : fmtMoney(totals.cps)} sub={totals.clicks ? t('ads.stat.clicks').replace('{n}', String(totals.clicks)) : undefined} />
        </div>

        {/* Campagnes */}
        <Card>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
            <div>
              <p style={{ color: T1, fontSize: 15, fontWeight: 700 }}>{t('ads.campaigns.title')}</p>
              <p style={{ color: T3, fontSize: 12.5 }}>{t('ads.campaigns.subtitle')}</p>
            </div>
          </div>
          {campaigns.length === 0 ? (
            <div className="rounded-xl px-4 py-6 text-center" style={{ background: INNER_BG, border: `1px dashed ${BORDER}` }}>
              <Rocket className="w-6 h-6 mx-auto" style={{ color: T3 }} />
              <p className="mt-2" style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{t('ads.campaigns.emptyTitle')}</p>
              <p style={{ color: T2, fontSize: 12.5, marginTop: 4 }}>{t('ads.campaigns.emptyBody')}</p>
              <div className="mt-4"><Btn tone="primary" onClick={() => setWizardOpen(true)} disabled={data!.events.length === 0}><Rocket className="w-3.5 h-3.5" /> {t('ads.boost')}</Btn></div>
              {data!.events.length === 0 && <p className="mt-2" style={{ color: T3, fontSize: 12 }}>{t('ads.campaigns.noEvents')}</p>}
            </div>
          ) : (
            <div className="space-y-3">
              {campaigns.map((c) => {
                const ins = c.insights;
                const sales = attributedSales(c.attributed);
                const rev = attributedRevenueCents(c.attributed);
                const cps = costPerSaleCents(ins?.spend_cents ?? 0, sales);
                const tone = c.status === 'active' ? 'pos' : c.status === 'paused' ? 'warn' : c.status === 'error' ? 'neg' : 'muted';
                const isOpen = expanded === c.id;
                return (
                  <div key={c.id} className="rounded-xl overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
                    <div className="flex items-start gap-3 p-3" style={{ background: INNER_BG }}>
                      <div className="h-16 w-12 rounded-lg overflow-hidden flex-shrink-0" style={{ background: 'rgb(var(--ink)/0.06)' }}>
                        {(() => { const src = (c.creatives?.[0] ? creativeCover(c.creatives[0]) : null) || c.creative?.image_url || c.event_poster_url; return src ? <img src={src} alt="" className="h-full w-full object-cover" /> : null; })()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="truncate" style={{ color: T1, fontSize: 14, fontWeight: 700 }}>{c.name}</p>
                          <Pill tone={tone}>{t(`ads.status.${c.status}`)}</Pill>
                          {c.effective_status && c.effective_status.includes('REVIEW') && <Pill tone="warn">{t('ads.status.inReview')}</Pill>}
                          {(c.creatives?.length ?? 0) > 1 && <Pill tone="muted">{t('ads.row.creatives').replace('{n}', String(c.creatives.length))}</Pill>}
                        </div>
                        <p style={{ color: T3, fontSize: 12, marginTop: 2 }}>
                          {c.event_title ?? '—'} · {fmtMoney(c.budget_cents)} {c.budget_type === 'daily' ? t('ads.wizard.perDay') : t('ads.wizard.inTotal')} · {fmtDate(c.start_at, 'd MMM')} → {c.end_at ? fmtDate(c.end_at, 'd MMM') : '∞'}
                        </p>
                        {(c.last_error || c.review_feedback) && (
                          <p className="mt-1" style={{ color: c.status === 'error' ? RED : WARN, fontSize: 12 }}>{c.review_feedback || c.last_error}</p>
                        )}
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-3">
                          {[
                            [t('ads.stat.spend'), fmtMoney(ins?.spend_cents ?? 0)],
                            [t('ads.row.impressions'), String(ins?.impressions ?? 0)],
                            [t('ads.row.metaLinkClicks'), String(ins?.link_clicks ?? 0)],
                            [t('ads.row.yunoSales'), `${sales}${rev ? ` · ${fmtMoney(rev)}` : ''}`],
                            [t('ads.stat.cps'), cps == null ? '—' : fmtMoney(cps)],
                          ].map(([k, v]) => (
                            <div key={k}><p style={{ color: T3, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{k}</p><p style={{ color: T1, fontSize: 13.5, fontWeight: 700 }}>{v}</p></div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 flex-wrap px-3 py-2" style={{ borderTop: `1px solid ${BORDER}` }}>
                      <div className="flex items-center gap-2 flex-wrap">
                        {c.status === 'paused' && <Btn tone="meta" onClick={() => setConfirmActivate(c)} busy={busy === `st:${c.id}`}><Play className="w-3.5 h-3.5" /> {t('ads.action.activate')}</Btn>}
                        {c.status === 'active' && <Btn onClick={() => run(`st:${c.id}`, async () => { await call('campaign_set_status', { campaignId: c.id, status: 'paused' }); }, t('ads.toast.paused'))} busy={busy === `st:${c.id}`}><Pause className="w-3.5 h-3.5" /> {t('ads.action.pause')}</Btn>}
                        {c.meta_campaign_id && <Btn onClick={() => run(`rf:${c.id}`, async () => { await call('campaign_refresh', { campaignId: c.id }); })} busy={busy === `rf:${c.id}`}><RefreshCw className="w-3.5 h-3.5" /> {t('ads.action.refresh')}</Btn>}
                        {c.tracked_code && (
                          <Btn onClick={() => { navigator.clipboard?.writeText(`https://yunoapp.eu/l/${c.tracked_code}`); toast.success(t('ads.toast.linkCopied')); }}><Copy className="w-3.5 h-3.5" /> {t('ads.action.copyLink')}</Btn>
                        )}
                        {(c.status === 'paused' || c.status === 'active') && (
                          <Btn onClick={() => { setWizardInitial({ campaign: c, mode: 'edit' }); setWizardOpen(true); }}><Pencil className="w-3.5 h-3.5" /> {t('ads.action.edit')}</Btn>
                        )}
                        <Btn onClick={() => { setWizardInitial({ campaign: c, mode: 'duplicate' }); setWizardOpen(true); }}><CopyPlus className="w-3.5 h-3.5" /> {t('ads.action.duplicate')}</Btn>
                      </div>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => setExpanded(isOpen ? null : c.id)} className="p-1.5 rounded-lg" style={{ color: T3 }} aria-label={t('ads.action.details')}>{isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</button>
                        <Btn tone="danger" onClick={() => setConfirmDelete(c)}><Trash2 className="w-3.5 h-3.5" /></Btn>
                      </div>
                    </div>
                    {isOpen && (
                      <div className="px-3 py-3 grid gap-3 sm:grid-cols-2" style={{ borderTop: `1px solid ${BORDER}` }}>
                        <div className="space-y-1.5">
                          <p style={{ color: T3, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{t('ads.row.attributed')}</p>
                          {[
                            [t('ads.row.tickets'), `${c.attributed.tickets} · ${fmtMoney(c.attributed.tickets_revenue_cents)}`],
                            [t('ads.row.tables'), `${c.attributed.tables} · ${fmtMoney(c.attributed.tables_revenue_cents)}`],
                            [t('ads.row.orders'), `${c.attributed.orders} · ${fmtMoney(c.attributed.orders_revenue_cents)}`],
                            [t('ads.row.guestList'), String(c.attributed.guest_list)],
                            [t('ads.row.linkClicks'), String(c.attributed.clicks)],
                            [t('ads.row.metaPurchases'), `${ins?.purchases ?? 0} · ${fmtMoney(ins?.purchase_value_cents ?? 0)}`],
                          ].map(([k, v]) => <div key={k} className="flex justify-between gap-3"><span style={{ color: T2, fontSize: 12.5 }}>{k}</span><span style={{ color: T1, fontSize: 12.5, fontWeight: 600 }}>{v}</span></div>)}
                          <p style={{ color: T3, fontSize: 11.5, marginTop: 6, lineHeight: 1.45 }}>{t('ads.row.attributionNote')}</p>
                        </div>
                        <div className="space-y-1.5">
                          <p style={{ color: T3, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{t('ads.row.setup')}</p>
                          <div className="flex justify-between gap-3"><span style={{ color: T2, fontSize: 12.5 }}>{t('ads.wizard.zone')}</span><span style={{ color: T1, fontSize: 12.5, textAlign: 'right' }}>{c.targeting?.cities?.length ? c.targeting.cities.map((x) => x.name).join(', ') : (c.targeting?.countries ?? []).join(', ') || '—'}</span></div>
                          <div className="flex justify-between gap-3"><span style={{ color: T2, fontSize: 12.5 }}>{t('ads.wizard.age')}</span><span style={{ color: T1, fontSize: 12.5 }}>{c.targeting?.age_min ?? 18}–{c.targeting?.age_max ?? 65}</span></div>
                          <div className="flex justify-between gap-3"><span style={{ color: T2, fontSize: 12.5 }}>{t('ads.wizard.audiences')}</span><span style={{ color: T1, fontSize: 12.5, textAlign: 'right' }}>{(c.targeting?.audience_ids ?? []).map((id) => audiences.find((a) => a.id === id)?.name ?? '?').join(', ') || '—'}</span></div>
                          <div className="flex justify-between gap-3"><span style={{ color: T2, fontSize: 12.5 }}>{t('ads.wizard.headline')}</span><span style={{ color: T1, fontSize: 12.5, textAlign: 'right' }}>{c.creative?.headline}</span></div>
                          <div className="flex justify-between gap-3"><span style={{ color: T2, fontSize: 12.5 }}>{t('ads.wizard.cta')}</span><span style={{ color: T1, fontSize: 12.5 }}>{t(`ads.cta.${c.creative?.cta ?? 'LEARN_MORE'}`)}</span></div>
                          <div className="flex justify-between gap-3"><span style={{ color: T2, fontSize: 12.5 }}>{t('ads.row.lastSync')}</span><span style={{ color: T1, fontSize: 12.5 }}>{fmtDate(c.last_synced_at)}</span></div>
                        </div>
                        {/* Résultats par création : une ligne par pub Meta, la meilleure
                            (achats, sinon clics) mise en avant. C'est la réponse à « lequel
                            de mes visuels vend ? ». */}
                        {(c.creatives?.length ?? 0) > 0 && (
                          <div className="sm:col-span-2 space-y-1.5">
                            <p style={{ color: T3, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{t('ads.row.byCreative')}</p>
                            {(() => {
                              const rows = c.creatives.map((cr, i) => {
                                const ref = (c.meta_ads ?? []).find((a) => a.index === i) ?? null;
                                const ins = ref ? (c.ad_insights ?? []).find((a) => a.ad_id === ref.ad_id) ?? null : null;
                                return { i, cr, ref, ins };
                              });
                              const score = (r: typeof rows[number]) => r.ins ? r.ins.purchases * 1000 + r.ins.link_clicks : -1;
                              const best = rows.reduce((b, r) => (score(r) > score(b) ? r : b), rows[0]);
                              const hasAny = rows.some((r) => r.ins);
                              return (
                                <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
                                  {rows.map((r) => (
                                    <div key={r.i} className="flex items-center gap-3 px-3 py-2 flex-wrap" style={{ borderBottom: `1px solid ${BORDER}`, background: hasAny && r === best && score(r) > 0 ? 'rgba(52,211,153,0.05)' : undefined }}>
                                      <div className="h-10 w-10 rounded-lg overflow-hidden flex-shrink-0" style={{ background: 'rgb(var(--ink)/0.06)' }}>{creativeCover(r.cr) && <img src={creativeCover(r.cr)!} alt="" className="h-full w-full object-cover" />}</div>
                                      <div className="min-w-0 flex-1">
                                        <p className="truncate" style={{ color: T1, fontSize: 12.5, fontWeight: 600 }}>{t('ads.w.creative.n').replace('{n}', String(r.i + 1))} · {t(`ads.w.format.${r.cr.format}`)}{r.cr.destination && r.cr.destination !== 'all' ? ` · ${t(`ads.w.dest.${r.cr.destination}`)}` : ''}{hasAny && r === best && score(r) > 0 ? ` · ${t('ads.row.best')}` : ''}</p>
                                        <p className="truncate" style={{ color: T3, fontSize: 11.5 }}>{r.cr.headline}{r.ref?.review ? ` · ${r.ref.review}` : ''}</p>
                                      </div>
                                      <div className="flex gap-4 tabular-nums">
                                        {[[t('ads.stat.spend'), fmtMoney(r.ins?.spend_cents ?? 0)], [t('ads.row.impressions'), String(r.ins?.impressions ?? 0)], [t('ads.row.clicks'), String(r.ins?.link_clicks ?? 0)], [t('ads.row.metaPurchases'), String(r.ins?.purchases ?? 0)]].map(([k, v]) => (
                                          <div key={k} className="text-right"><p style={{ color: T3, fontSize: 10 }}>{k}</p><p style={{ color: T1, fontSize: 12.5, fontWeight: 700 }}>{v}</p></div>
                                        ))}
                                      </div>
                                      {r.ref && c.status === 'active' && c.creatives.length > 1 && (
                                        (r.ref.effective_status ?? '').toUpperCase().startsWith('PAUSED')
                                          ? <button type="button" onClick={() => run(`ad:${r.ref!.ad_id}`, async () => { await call('ad_set_status', { campaignId: c.id, adId: r.ref!.ad_id, status: 'active' }); })} className="h-8 w-8 rounded-lg flex items-center justify-center cursor-pointer hover:bg-white/[0.06]" style={{ color: POS }} aria-label={t('ads.action.activate')} disabled={busy === `ad:${r.ref.ad_id}`}><PlayCircle className="w-4 h-4" /></button>
                                          : <button type="button" onClick={() => run(`ad:${r.ref!.ad_id}`, async () => { await call('ad_set_status', { campaignId: c.id, adId: r.ref!.ad_id, status: 'paused' }); })} className="h-8 w-8 rounded-lg flex items-center justify-center cursor-pointer hover:bg-white/[0.06]" style={{ color: WARN }} aria-label={t('ads.action.pause')} disabled={busy === `ad:${r.ref.ad_id}`}><PauseCircle className="w-4 h-4" /></button>
                                      )}
                                    </div>
                                  ))}
                                  {!hasAny && <p className="px-3 py-2" style={{ color: T3, fontSize: 11.5 }}>{t('ads.row.noAdInsights')}</p>}
                                </div>
                              );
                            })()}
                            <p style={{ color: T3, fontSize: 11.5, lineHeight: 1.45 }}>{t('ads.row.byCreativeNote')}</p>
                          </div>
                        )}
                        {(() => {
                          const bd = c.insight_breakdowns;
                          const ag = (bd?.age_gender ?? []).filter((r) => r.impressions > 0).sort((a, b) => b.spend_cents - a.spend_cents).slice(0, 8);
                          const pl = (bd?.placements ?? []).filter((r) => r.impressions > 0).sort((a, b) => b.spend_cents - a.spend_cents).slice(0, 8);
                          if (!ag.length && !pl.length) return null;
                          const Tbl = ({ title, rows }: { title: string; rows: Array<{ key: string; label: string; spend_cents: number; impressions: number; link_clicks: number; purchases: number }> }) => (
                            <div className="space-y-1.5">
                              <p style={{ color: T3, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{title}</p>
                              <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
                                {rows.map((r) => (
                                  <div key={r.key} className="flex items-center gap-3 px-3 py-1.5 tabular-nums" style={{ borderBottom: `1px solid ${BORDER}` }}>
                                    <span className="flex-1 truncate" style={{ color: T1, fontSize: 12.5 }}>{r.label}</span>
                                    <span style={{ color: T2, fontSize: 12 }}>{fmtMoney(r.spend_cents)}</span>
                                    <span className="w-16 text-right" style={{ color: T2, fontSize: 12 }}>{r.impressions}</span>
                                    <span className="w-10 text-right" style={{ color: T2, fontSize: 12 }}>{r.link_clicks}</span>
                                    <span className="w-8 text-right" style={{ color: r.purchases ? POS : T3, fontSize: 12, fontWeight: 700 }}>{r.purchases}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                          return (
                            <div className="sm:col-span-2 grid gap-3 sm:grid-cols-2">
                              {ag.length > 0 && <Tbl title={t('ads.row.byAgeGender')} rows={ag.map((r) => ({ ...r, label: `${r.age} · ${r.gender === 'female' ? t('ads.wizard.genderWomen') : r.gender === 'male' ? t('ads.wizard.genderMen') : r.gender}` }))} />}
                              {pl.length > 0 && <Tbl title={t('ads.row.byPlacement')} rows={pl.map((r) => ({ ...r, label: `${r.platform} · ${r.position.replace(/_/g, ' ')}` }))} />}
                              <p className="sm:col-span-2" style={{ color: T3, fontSize: 11.5 }}>{t('ads.row.breakdownNote')}</p>
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Audiences */}
        <Card>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <div>
              <p style={{ color: T1, fontSize: 15, fontWeight: 700 }}>{t('ads.audiences.title')}</p>
              <p style={{ color: T3, fontSize: 12.5, maxWidth: 640 }}>{t('ads.audiences.subtitle')}</p>
            </div>
            <Btn onClick={() => setShowAudienceForm((v) => !v)}><Users className="w-3.5 h-3.5" /> {t('ads.audiences.create')}</Btn>
          </div>
          {showAudienceForm && (
            <div className="rounded-xl p-3 mb-3 space-y-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
              <div className="flex gap-2 flex-wrap">
                {([...(['builtin', 'venue_segment', 'contact_segment'] as const), ...RULE_AUDIENCES] as Array<Exclude<AudienceKind, 'lookalike'>>).filter((k) => k !== 'venue_segment' || !isOrganizer).filter((k) => !(k === 'ig_engagers' || k === 'ig_visitors') || !!conn.ig_user_id).map((k) => (
                  <button key={k} type="button" onClick={() => { setAudKind(k); setAudRef(k === 'builtin' ? 'buyers_12m' : isRuleAudience(k) ? '90' : (k === 'venue_segment' ? data!.segments.venue[0]?.id : data!.segments.contact[0]?.id) ?? ''); }}
                    className="px-3 py-1.5 rounded-full text-[12.5px] font-semibold"
                    style={audKind === k ? { background: 'rgba(232,25,44,0.14)', border: '1px solid rgba(232,25,44,0.45)', color: 'var(--acc-ff7a82)' } : { background: 'rgb(var(--ink)/0.05)', border: `1px solid ${BORDER}`, color: T2 }}>
                    {t(`ads.audiences.kind.${k}`)}
                  </button>
                ))}
              </div>
              <select value={audRef} onChange={(e) => setAudRef(e.target.value)} style={{ background: 'rgb(var(--ink)/0.05)', border: `1px solid ${BORDER}`, color: T1, borderRadius: 12, padding: '10px 12px', fontSize: 13.5, width: '100%' }}>
                {audKind === 'builtin' && BUILTIN_AUDIENCES.map((b) => <option key={b} value={b}>{t(`ads.audience.builtin.${b}`)}</option>)}
                {audKind === 'venue_segment' && data!.segments.venue.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                {audKind === 'contact_segment' && data!.segments.contact.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                {isRuleAudience(audKind) && RULE_AUDIENCE_WINDOWS.map((d) => <option key={d} value={String(d)}>{t('ads.audience.rule.days').replace('{n}', String(d))}</option>)}
              </select>
              {isRuleAudience(audKind) && <p style={{ color: T2, fontSize: 12.5, lineHeight: 1.5 }}>{t(`ads.audience.rule.${audKind}Desc`)}</p>}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p style={{ color: audCount != null && audCount >= 0 && audCount < 100 ? WARN : T2, fontSize: 12.5 }}>
                  {audCount == null ? t('ads.audiences.counting') : audCount < 0 ? t('ads.audience.rule.metaFills') : t('ads.audiences.count').replace('{n}', String(audCount))}
                  {audCount != null && audCount >= 0 && audCount < 100 && ` · ${t('ads.audiences.tooSmall')}`}
                </p>
                <Btn tone="primary" disabled={!audRef || audCount == null || audCount === 0} busy={busy === 'aud:create'}
                  onClick={() => run('aud:create', async () => { await call('audience_create', { kind: audKind, ref: audRef, name: audienceName(audKind, audRef) }); setShowAudienceForm(false); }, t('ads.toast.audienceCreated'))}>
                  {t('ads.audiences.push')}
                </Btn>
              </div>
              <p style={{ color: T3, fontSize: 11.5, lineHeight: 1.45 }}>{isRuleAudience(audKind) ? t('ads.audience.rule.note') : t('ads.audiences.consentNote')}</p>
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap mb-3" style={{ color: T3, fontSize: 12 }}>
            <span>{t('ads.audiences.lookalikeRatio')}</span>
            {LOOKALIKE_RATIOS.map((r) => (
              <button key={r} type="button" onClick={() => setLookalikeRatio(r)} className="px-2.5 py-1 rounded-full text-[12px] font-semibold cursor-pointer"
                style={lookalikeRatio === r ? { background: 'rgba(232,25,44,0.14)', border: '1px solid rgba(232,25,44,0.45)', color: 'var(--acc-ff7a82)' } : { background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>{Math.round(r * 100)} %</button>
            ))}
            <span>{t('ads.audiences.lookalikeRatioHint')}</span>
          </div>
          {audiences.length === 0 ? (
            <p style={{ color: T3, fontSize: 12.5 }}>{t('ads.audiences.empty')}</p>
          ) : (
            <div className="space-y-2">
              {audiences.map((a: AdsAudience) => (
                <div key={a.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5 flex-wrap" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                  {a.kind === 'lookalike' ? <Sparkles className="w-4 h-4 flex-shrink-0" style={{ color: WARN }} /> : <Users className="w-4 h-4 flex-shrink-0" style={{ color: T3 }} />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate" style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{a.name}</p>
                    <p style={{ color: T3, fontSize: 11.5 }}>
                      {a.kind === 'lookalike' ? t('ads.audiences.lookalikeOf').replace('{p}', String(Math.round((a.lookalike_ratio ?? 0) * 100))).replace('{c}', a.lookalike_country ?? '') : isRuleAudience(a.kind) ? `${t(`ads.audience.rule.${a.kind}`)} · ${t('ads.audience.rule.days').replace('{n}', a.ref)}` : t(`ads.audiences.kind.${a.kind}`)}
                      {a.size_uploaded != null && a.kind !== 'lookalike' ? ` · ${t('ads.audiences.people').replace('{n}', String(a.size_uploaded))}` : ''}
                      {a.last_sync_at ? ` · ${fmtDate(a.last_sync_at)}` : ''}
                      {a.last_error ? ` · ${a.last_error === 'custom_audience_tos' ? t('ads.account.tosMissing') : a.last_error}` : ''}
                    </p>
                  </div>
                  <Pill tone={a.status === 'ready' ? 'pos' : a.status === 'error' ? 'neg' : 'warn'}>{t(`ads.audiences.status.${a.status}`)}</Pill>
                  {a.kind !== 'lookalike' && a.status === 'ready' && (a.size_uploaded ?? 0) >= 100 && !isRuleAudience(a.kind) && (
                    <Btn onClick={() => run(`lk:${a.id}`, async () => { await call('audience_lookalike', { audienceId: a.id, ratio: lookalikeRatio, country: language === 'es' ? 'ES' : 'FR' }); }, t('ads.toast.lookalikeCreated'))} busy={busy === `lk:${a.id}`}><Sparkles className="w-3.5 h-3.5" /> {t('ads.audiences.lookalike')}</Btn>
                  )}
                  <Btn onClick={() => run(`sy:${a.id}`, async () => { await call('audience_sync', { audienceId: a.id }); })} busy={busy === `sy:${a.id}`}><RefreshCw className="w-3.5 h-3.5" /></Btn>
                  <Btn tone="danger" onClick={() => run(`del:${a.id}`, async () => { await call('audience_delete', { audienceId: a.id }); })} busy={busy === `del:${a.id}`}><Trash2 className="w-3.5 h-3.5" /></Btn>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Leads */}
        <Card>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <div>
              <p style={{ color: T1, fontSize: 15, fontWeight: 700 }}>{t('ads.leads.title')}</p>
              <p style={{ color: T3, fontSize: 12.5, maxWidth: 640 }}>{t('ads.leads.subtitle')}</p>
            </div>
            {conn.last_health?.leads_subscribed_at
              ? <Pill tone="pos"><CheckCircle2 className="w-3 h-3" /> {t('ads.leads.subscribed')}</Pill>
              : <Btn tone="meta" onClick={() => run('leads', async () => { await call('leads_subscribe', {}); }, t('ads.toast.leadsSubscribed'))} busy={busy === 'leads'}><Inbox className="w-3.5 h-3.5" /> {t('ads.leads.subscribe')}</Btn>}
          </div>
          <div className="grid gap-3 sm:grid-cols-3 mb-3">
            <Stat label={t('ads.leads.total')} value={String(data!.leads.total)} />
            <Stat label={t('ads.leads.last30')} value={String(data!.leads.last_30d)} tone="pos" />
            <Stat label={t('ads.leads.pending')} value={String(data!.leads.pending)} tone={data!.leads.pending > 0 ? 'warn' : undefined} />
          </div>
          {data!.leads.recent.length === 0 ? (
            <p style={{ color: T3, fontSize: 12.5 }}>{t('ads.leads.empty')}</p>
          ) : (
            <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
              {data!.leads.recent.map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-3 px-3 py-2" style={{ borderBottom: `1px solid ${BORDER}` }}>
                  <div className="min-w-0"><p className="truncate" style={{ color: T1, fontSize: 12.5, fontWeight: 600 }}>{l.name || l.email || l.id}</p><p style={{ color: T3, fontSize: 11.5 }}>{l.email ?? ''}{l.error ? ` · ${l.error}` : ''}</p></div>
                  <div className="flex items-center gap-2 flex-shrink-0"><span style={{ color: T3, fontSize: 11.5 }}>{fmtDate(l.received_at)}</span><Pill tone={l.processed ? 'pos' : 'warn'}>{l.processed ? t('ads.leads.inBase') : t('ads.leads.waiting')}</Pill></div>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-start gap-2 mt-3"><Info className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: T3 }} /><p style={{ color: T3, fontSize: 12, lineHeight: 1.45 }}>{t('ads.leads.note')}</p></div>
        </Card>
      </>
    );
  })();

  return (
    <>
      {mode === 'organizer' ? (
        <OrgPage>{header}<div className="space-y-5">{body}</div></OrgPage>
      ) : (
        <div className="min-h-screen pb-28" style={{ background: 'var(--sf-000000)' }}>
          <div className="fixed inset-0 pointer-events-none z-0" style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgb(var(--ink)/.025),transparent 55%)' }} />
          {header}
          <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 pt-2 space-y-5">
            <p style={{ color: T2, fontSize: 13.5, maxWidth: 720 }}>{t('ads.subtitle')}</p>
            {body}
          </div>
        </div>
      )}

      {wizardOpen && data && (
        <CampaignWizard
          scope={metaScope}
          events={data.events}
          audiences={data.audiences}
          homeCity={data.home?.city ?? null}
          defaultEventId={searchParams.get('event')}
          currency={data.connection?.last_health?.ad_account?.currency ?? 'EUR'}
          pageId={data.connection?.page_id ?? null}
          pageName={pageName}
          igUsername={igUsername}
          mode={wizardInitial?.mode}
          initial={wizardInitial?.campaign ?? null}
          onClose={() => { setWizardOpen(false); setWizardInitial(null); }}
          onCreated={load}
        />
      )}

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('ads.delete.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('ads.delete.body')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('integ.meta.cancel')}</AlertDialogCancel>
            <AlertDialogAction style={{ background: RED, color: '#fff' }} onClick={() => { const c = confirmDelete; setConfirmDelete(null); if (c) run(`dl:${c.id}`, async () => { await call('campaign_delete', { campaignId: c.id }); }, t('ads.toast.deleted')); }}>
              {t('ads.delete.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Activer = la seule action qui fait dépenser : toujours confirmée. */}
      <AlertDialog open={!!confirmActivate} onOpenChange={(o) => { if (!o) setConfirmActivate(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('ads.activate.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('ads.activate.body')}{confirmActivate ? ` ${fmtMoney(confirmActivate.budget_cents)} ${confirmActivate.budget_type === 'daily' ? t('ads.wizard.perDay') : t('ads.wizard.inTotal')}.` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('integ.meta.cancel')}</AlertDialogCancel>
            <AlertDialogAction style={{ background: META_BLUE, color: '#fff' }} onClick={() => { const c = confirmActivate; setConfirmActivate(null); if (c) run(`st:${c.id}`, async () => { await call('campaign_set_status', { campaignId: c.id, status: 'active' }); }, t('ads.toast.activated')); }}>
              {t('ads.activate.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
