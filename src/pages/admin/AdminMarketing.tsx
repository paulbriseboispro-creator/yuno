// ───────────────────────────────────────────────────────────────────────────
// Marketing Yuno — l'écran depuis lequel la plateforme écrit à sa propre base.
//
// Ce n'est PAS un second système : c'est la troisième portée du moteur qui sert
// déjà les clubs et les organisateurs (Email Studio, file d'envoi, gouverneur
// de quota, liste de suppression, file SMS). La portée « plateforme » = les
// deux colonnes de portée à NULL en base, un créneau que seule la RLS du super
// admin ouvre. Voir supabase/migrations/20260908210000_platform_marketing_scope.sql
// et docs/PLATFORM_MARKETING.md.
//
// Le registre de consentement est `newsletter_subscriptions` (portée
// plateforme) : c'est lui qui porte le jeton de désinscription. Rien n'entre
// dans une campagne sans y passer — d'où le bouton « Actualiser la base », qui
// verse les sources internes (comptes, liste d'attente, leads pro) dans le
// registre au lieu de les lire à l'envoi.
// ───────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AtSign, Download, Loader2, Mail, MessageSquare, Plus, RefreshCw, ShieldOff,
  Upload, Users, Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage, persistedLanguage } from '@/contexts/LanguageContext';
import { fmtDate, fmtNum } from '@/lib/adminFormat';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import StudioShell from '@/components/email-studio/StudioShell';
import CampaignReport from '@/components/campaigns/CampaignReport';
import ContactImportDialog from '@/components/contacts/ContactImportDialog';
import type { StudioScope } from '@/components/email-studio/hooks';

// ─── Yuno Design Tokens (dashboards pro / admin) ─────────────────────────────
const RED         = '#E8192C';
const POS         = '#34D399';
const T1          = 'rgba(255,255,255,0.96)';
const T2          = 'rgba(255,255,255,0.58)';
const T3          = 'rgba(255,255,255,0.36)';
const BORDER      = 'rgba(255,255,255,0.085)';
const F_BORDER    = 'rgba(255,255,255,0.055)';
const TILE_BG     = 'rgba(255,255,255,0.025)';
const CARD_BG     = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

export const PLATFORM_SCOPE: StudioScope = { kind: 'platform', name: 'Yuno' };
const EMAIL_BASE = '/admin/marketing/email';

// ── Formes serveur (get_platform_marketing_overview) ───────────────────────
interface Overview {
  email: {
    total: number; opted_in: number; opted_out: number; suppressed: number;
    reachable: number; by_source: Record<string, number>;
  };
  sms: { total: number; reachable: number; unsubscribed: number };
  imports: Array<{ id: string; list_name: string | null; filename: string | null; created_at: string; contacts: number }>;
  campaigns: { email_drafts: number; email_sent: number; sms_drafts: number; sms_sent: number };
  quota: { used: number; free: number; remaining: number; day_used: number; day_cap: number; pool_used: number; pool_cap: number };
}

interface CampaignRow {
  id: string;
  name: string;
  subject: string;
  status: string;
  total_recipients: number;
  recipients_count: number;
  opens_count: number;
  clicks_count: number;
  scheduled_at: string | null;
  sent_at: string | null;
  created_at: string;
}

const SOURCE_KEYS: Record<string, string> = {
  'platform:clients':  'pm.seg.clients',
  'platform:pros':     'pm.seg.pros',
  'platform:waitlist': 'pm.seg.waitlist',
  'platform:leads':    'pm.seg.leads',
  'platform:import':   'pm.src.import',
};

const nf = (n: number) => fmtNum(n, persistedLanguage());

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18,
      boxShadow: CARD_SHADOW, padding: 22, ...style,
    }}>{children}</div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div style={{ background: TILE_BG, border: `1px solid ${F_BORDER}`, borderRadius: 14, padding: 14 }}>
      <div style={{ color: T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ color: tone || T1, fontSize: 26, fontWeight: 700, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {hint && <div style={{ color: T3, fontSize: 11, marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

function Btn({ children, onClick, busy, variant = 'ghost' }: {
  children: React.ReactNode; onClick: () => void; busy?: boolean; variant?: 'ghost' | 'primary';
}) {
  const primary = variant === 'primary';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 13px',
        borderRadius: 11, fontSize: 12.5, fontWeight: 600, cursor: busy ? 'default' : 'pointer',
        color: primary ? '#fff' : T2,
        background: primary ? RED : TILE_BG,
        border: `1px solid ${primary ? RED : F_BORDER}`,
        opacity: busy ? 0.6 : 1,
      }}
    >{children}</button>
  );
}

const STATUS_TONE: Record<string, string> = {
  sent: POS, sending: 'rgba(255,255,255,0.40)', scheduled: '#FCD34D', paused: '#FCD34D',
  failed: RED, cancelled: T3, draft: T3,
};

/** Hub du marketing plateforme : base de contacts, quota, campagnes. */
export default function AdminMarketing() {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ovRes, cRes] = await Promise.all([
        supabase.rpc('get_platform_marketing_overview' as never),
        supabase.from('email_campaigns')
          .select('id,name,subject,status,total_recipients,recipients_count,opens_count,clicks_count,scheduled_at,sent_at,created_at')
          .is('venue_id', null).is('organizer_user_id', null)
          .order('created_at', { ascending: false }).limit(40),
      ]);
      // supabase-js ne lève pas : sans ce test, une RPC refusée affichait des
      // zéros partout, silencieusement.
      if (ovRes.error) throw new Error(ovRes.error.message);
      if (cRes.error) throw new Error(cRes.error.message);
      setOverview((ovRes.data as unknown as Overview) ?? null);
      setCampaigns(((cRes.data as unknown) as CampaignRow[]) || []);
    } catch (e) {
      console.error('AdminMarketing load error:', e);
      toast.error(t('pm.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  /** Verse les sources internes dans le registre de consentement plateforme. */
  const sync = async () => {
    setSyncing(true);
    const { data, error } = await supabase.rpc('sync_platform_marketing_contacts' as never, {
      p_sources: ['clients', 'pros', 'waitlist', 'leads'],
    } as never);
    setSyncing(false);
    if (error) { toast.error(error.message); return; }
    const r = data as unknown as { email_added: number; sms_added: number; scanned: number };
    toast.success(t('pm.syncDone')
      .replace('{email}', String(r?.email_added ?? 0))
      .replace('{sms}', String(r?.sms_added ?? 0)));
    void load();
  };

  const bySource = useMemo(() => {
    const src = overview?.email.by_source ?? {};
    return Object.entries(src).sort((a, b) => b[1] - a[1]);
  }, [overview]);

  if (loading) return <OwnerPageSkeleton />;

  const q = overview?.quota;

  return (
    <div className="min-h-screen pb-16" style={{ background: '#000' }}>
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(232,25,44,.05),transparent 55%)' }} />

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 py-6 space-y-6">

        {/* ── En-tête ── */}
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl flex-none"
            style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}>
            <Mail className="h-4 w-4" style={{ color: RED }} />
          </div>
          <div style={{ flex: 1, minWidth: 260 }}>
            <h1 style={{ color: T1, fontSize: 'clamp(22px,3vw,28px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1 }}>
              {t('pm.title')}
            </h1>
            <p style={{ color: T3, fontSize: 12.5, marginTop: 6, maxWidth: 680 }}>{t('pm.subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Btn onClick={sync} busy={syncing}>
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {t('pm.sync')}
            </Btn>
            <Btn onClick={() => setImportOpen(true)}><Upload className="h-3.5 w-3.5" />{t('pm.import')}</Btn>
            <Btn onClick={() => navigate('/admin/marketing/sms')}><MessageSquare className="h-3.5 w-3.5" />{t('pm.smsLink')}</Btn>
            <Btn variant="primary" onClick={() => navigate(`${EMAIL_BASE}/new`)}>
              <Plus className="h-3.5 w-3.5" />{t('pm.newCampaign')}
            </Btn>
          </div>
        </div>

        {/* ── La base ── */}
        <Card>
          <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
            <Users className="h-4 w-4" style={{ color: T3 }} />
            <h2 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>{t('pm.base')}</h2>
          </div>
          <p style={{ color: T3, fontSize: 11.5, marginBottom: 16, maxWidth: 720 }}>{t('pm.baseHint')}</p>

          <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
            <Stat label={t('pm.emailReachable')} value={nf(overview?.email.reachable ?? 0)}
              hint={t('pm.ofTotal').replace('{n}', nf(overview?.email.total ?? 0))} tone={POS} />
            <Stat label={t('pm.smsReachable')} value={nf(overview?.sms.reachable ?? 0)}
              hint={t('pm.ofTotal').replace('{n}', nf(overview?.sms.total ?? 0))} />
            <Stat label={t('pm.optedOut')} value={nf(overview?.email.opted_out ?? 0)} hint={t('pm.optedOutHint')} />
            <Stat label={t('pm.suppressed')} value={nf(overview?.email.suppressed ?? 0)} hint={t('pm.suppressedHint')} />
          </div>

          {bySource.length > 0 && (
            <div className="flex flex-wrap gap-1.5" style={{ marginTop: 14 }}>
              {bySource.map(([src, n]) => (
                <span key={src} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1"
                  style={{ background: TILE_BG, border: `1px solid ${F_BORDER}`, fontSize: 11, color: T2, fontWeight: 600 }}>
                  <span style={{ color: T3, fontWeight: 500 }}>
                    {SOURCE_KEYS[src] ? t(SOURCE_KEYS[src]) : src}
                  </span>
                  {nf(n)}
                </span>
              ))}
            </div>
          )}
        </Card>

        {/* ── Quota d'envoi ── */}
        <Card>
          <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
            <Wallet className="h-4 w-4" style={{ color: T3 }} />
            <h2 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>{t('pm.quota')}</h2>
          </div>
          <p style={{ color: T3, fontSize: 11.5, marginBottom: 16, maxWidth: 720 }}>{t('pm.quotaHint')}</p>
          <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
            <Stat label={t('pm.quotaMonth')} value={nf(q?.used ?? 0)} hint={`/ ${nf(q?.free ?? 0)}`} />
            <Stat label={t('pm.quotaDay')} value={nf(q?.day_used ?? 0)} hint={`/ ${nf(q?.day_cap ?? 0)}`} />
            <Stat label={t('pm.quotaPool')} value={nf(q?.pool_used ?? 0)} hint={`/ ${nf(q?.pool_cap ?? 0)}`} />
            <Stat label={t('pm.campaignsSent')} value={nf(overview?.campaigns.email_sent ?? 0)}
              hint={t('pm.draftsN').replace('{n}', nf(overview?.campaigns.email_drafts ?? 0))} />
          </div>
        </Card>

        {/* ── Listes importées ── */}
        {(overview?.imports.length ?? 0) > 0 && (
          <Card>
            <div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
              <Download className="h-4 w-4" style={{ color: T3 }} />
              <h2 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>{t('pm.imports')}</h2>
            </div>
            <div className="space-y-2">
              {overview!.imports.map((li) => (
                <div key={li.id} className="flex items-center justify-between gap-3 rounded-xl p-3"
                  style={{ background: TILE_BG, border: `1px solid ${F_BORDER}` }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ color: T1, fontSize: 13, fontWeight: 560 }} className="truncate">
                      {li.list_name || (li.filename || '').replace(/\.[a-z0-9]+$/i, '') || t('pm.importUnnamed')}
                    </p>
                    <p style={{ color: T3, fontSize: 11, marginTop: 2 }}>
                      {fmtDate(li.created_at, language)}
                    </p>
                  </div>
                  <span style={{ color: T2, fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {nf(li.contacts)}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* ── Campagnes email ── */}
        <Card>
          <div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
            <AtSign className="h-4 w-4" style={{ color: T3 }} />
            <h2 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>{t('pm.campaigns')}</h2>
          </div>

          {campaigns.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10">
              <ShieldOff className="h-6 w-6" style={{ color: T3 }} />
              <p style={{ color: T3, fontSize: 12.5 }}>{t('pm.noCampaign')}</p>
              <Btn variant="primary" onClick={() => navigate(`${EMAIL_BASE}/new`)}>
                <Plus className="h-3.5 w-3.5" />{t('pm.newCampaign')}
              </Btn>
            </div>
          ) : (
            <div className="space-y-2">
              {campaigns.map((c) => {
                const sent = Number(c.recipients_count || 0);
                const openRate = sent > 0 ? Math.round((Number(c.opens_count || 0) / sent) * 100) : null;
                const done = c.status === 'sent';
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => navigate(done || c.status === 'sending' || c.status === 'paused'
                      ? `${EMAIL_BASE}/${c.id}/report`
                      : `${EMAIL_BASE}/${c.id}/edit`)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl p-3 text-left"
                    style={{ background: TILE_BG, border: `1px solid ${F_BORDER}`, cursor: 'pointer' }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ color: T1, fontSize: 13, fontWeight: 560 }} className="truncate">{c.name || c.subject}</p>
                      <p style={{ color: T3, fontSize: 11, marginTop: 2 }} className="truncate">{c.subject}</p>
                    </div>
                    <div className="flex items-center gap-3 flex-none">
                      {done && (
                        <span style={{ color: T2, fontSize: 11.5, fontVariantNumeric: 'tabular-nums' }}>
                          {nf(sent)} · {openRate === null ? '—' : `${openRate}%`}
                        </span>
                      )}
                      <span className="rounded-full px-2 py-0.5"
                        style={{
                          fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
                          color: STATUS_TONE[c.status] || T3,
                          background: 'rgba(255,255,255,0.04)', border: `1px solid ${F_BORDER}`,
                        }}>
                        {t(`em.status.${c.status}`)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <ContactImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        scope={{ kind: 'platform' }}
        onChanged={() => void load()}
      />
    </div>
  );
}

/** Éditeur (Email Studio) en portée plateforme. */
export function AdminMarketingEmailEditor() {
  return <StudioShell basePath={EMAIL_BASE} scope={PLATFORM_SCOPE} />;
}

/** Rapport de campagne en portée plateforme. */
export function AdminMarketingEmailReport() {
  return <CampaignReport basePath={EMAIL_BASE} scope={PLATFORM_SCOPE} />;
}
