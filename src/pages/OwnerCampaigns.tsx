import { useEffect, useMemo, useState } from 'react';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Loader2, Mail, Plus, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { useVenueContext } from '@/hooks/useVenueContext';
import { useLanguage } from '@/contexts/LanguageContext';
import StudioShell from '@/components/email-studio/StudioShell';
import CampaignReport from '@/components/campaigns/CampaignReport';
import { slugifyName } from '@/lib/email';
import ImportContactsDialog from '@/components/campaigns/ImportContactsDialog';
import EmailCreditsDialog, { useEmailCreditsReturn } from '@/components/campaigns/EmailCreditsDialog';
import CampaignSendProgress from '@/components/campaigns/CampaignSendProgress';

// ─── Yuno Design Tokens (prototype Email Studio) ─────────────────────────────
const RED = '#E8192C';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const F_BORDER = 'rgba(255,255,255,0.055)';
const INNER_BG = 'rgba(255,255,255,0.032)';
const SUBTLE = 'rgba(255,255,255,0.025)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';
const RED_CARD_BG = 'radial-gradient(ellipse 70% 60% at 90% -20%, rgba(232,25,44,0.10) 0%, transparent 65%),linear-gradient(180deg,rgba(255,255,255,.03) 0%,rgba(255,255,255,.005) 100%),#0a0a0c';
const POS = '#34D399';
const WARN = '#FCD34D';
const NEG = '#FF5C63';

type Campaign = {
  id: string; name: string; type: 'promotional' | 'informational';
  subject: string; status: string; recipients_count: number; opens_count: number; clicks_count: number;
  created_at: string; sent_at: string | null; scheduled_at: string | null;
};

const STATUS_PILL: Record<string, { labelKey: string; color: string; bg: string; border: string }> = {
  draft:     { labelKey: 'em.status.draft',     color: T2, bg: 'rgba(255,255,255,0.05)', border: BORDER },
  scheduled: { labelKey: 'em.status.scheduled', color: WARN, bg: 'rgba(234,179,8,0.08)', border: 'rgba(234,179,8,0.28)' },
  sending:   { labelKey: 'em.status.sending',   color: WARN, bg: 'rgba(234,179,8,0.08)', border: 'rgba(234,179,8,0.28)' },
  paused:    { labelKey: 'em.status.paused',    color: WARN, bg: 'rgba(234,179,8,0.08)', border: 'rgba(234,179,8,0.28)' },
  sent:      { labelKey: 'em.status.sent',      color: POS, bg: 'rgba(52,211,153,0.10)', border: 'rgba(52,211,153,0.25)' },
  failed:    { labelKey: 'em.status.failed',    color: NEG, bg: 'rgba(255,92,99,0.08)', border: 'rgba(255,92,99,0.20)' },
  cancelled: { labelKey: 'em.status.cancelled', color: T3, bg: 'rgba(255,255,255,0.05)', border: BORDER },
};

const nf = (n: number) => n.toLocaleString('fr-FR');

export default function OwnerCampaigns() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { venueId, venue } = useVenueContext();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [revenue, setRevenue] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  useEmailCreditsReturn();
  const [pendingDelete, setPendingDelete] = useState<Campaign | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!venueId) return;
    supabase.from('email_campaigns')
      .select('id,name,type,subject,status,recipients_count,opens_count,clicks_count,created_at,sent_at,scheduled_at')
      .eq('venue_id', venueId).order('created_at', { ascending: false })
      .then(({ data }) => { setCampaigns((data || []) as Campaign[]); setLoading(false); });

    // Revenu attribué (clic → achat 72 h) : un appel pour toute la liste.
    supabase.rpc('get_email_campaign_attribution' as never, {
      p_subject_type: 'venue', p_subject_id: venueId,
    } as never).then(({ data }) => {
      const payload = data as unknown as { supported?: boolean; campaigns?: Array<{ id: string; revenue: number }> } | null;
      if (payload?.supported) {
        const map: Record<string, number> = {};
        for (const row of payload.campaigns || []) map[row.id] = row.revenue;
        setRevenue(map);
      }
    });
  }, [venueId]);

  // Suppression d'un brouillon. Le serveur a le dernier mot (trigger
  // guard_email_campaign_delete) : on ne retire la ligne de l'écran qu'après
  // un aller-retour réussi.
  const deleteDraft = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    const { error } = await supabase.from('email_campaigns').delete().eq('id', pendingDelete.id);
    setDeleting(false);
    if (error) {
      toast.error(t('em.del.error'));
      return;
    }
    setCampaigns((prev) => prev.filter((x) => x.id !== pendingDelete.id));
    setPendingDelete(null);
    toast.success(t('em.del.done'));
  };

  // KPIs 30 jours — calculés depuis les campagnes réelles, jamais inventés.
  const kpis = useMemo(() => {
    const cutoff = Date.now() - 30 * 86_400_000;
    const recent = campaigns.filter((c) => c.status === 'sent' && c.sent_at && new Date(c.sent_at).getTime() >= cutoff);
    const sent = recent.reduce((a, c) => a + c.recipients_count, 0);
    const opens = recent.reduce((a, c) => a + c.opens_count, 0);
    const clicks = recent.reduce((a, c) => a + c.clicks_count, 0);
    const rev = recent.reduce((a, c) => a + (revenue[c.id] || 0), 0);
    return {
      sent,
      openRate: sent > 0 ? (opens / sent) * 100 : null,
      clickRate: sent > 0 ? (clicks / sent) * 100 : null,
      revenue: rev,
    };
  }, [campaigns, revenue]);

  const fromAddr = venue?.name ? `${slugifyName(venue.name)}@yunoapp.eu` : 'votre-club@yunoapp.eu';
  const maxOpen = Math.max(1, ...campaigns.map((c) => (c.recipients_count > 0 ? (c.opens_count / c.recipients_count) * 100 : 0)));

  const whenLabel = (c: Campaign) => {
    const statusLabel = t(STATUS_PILL[c.status]?.labelKey || c.status);
    const iso = c.sent_at || c.scheduled_at || c.created_at;
    const date = new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', hour: c.scheduled_at && !c.sent_at ? '2-digit' : undefined, minute: c.scheduled_at && !c.sent_at ? '2-digit' : undefined });
    return `${statusLabel} · ${date}`;
  };

  const colHeader: React.CSSProperties = {
    color: T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase',
  };

  return (
    <div className="min-h-screen pb-24" style={{ background: '#000', position: 'relative' }}>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.025),transparent 55%)' }} />
      <div className="max-w-[1340px] mx-auto px-6 py-8" style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* ── En-tête ── */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
          <button
            onClick={() => navigate('/owner/dashboard')}
            aria-label={t('studio.top.back')}
            className="cursor-pointer"
            style={{
              width: 34, height: 34, borderRadius: 11, display: 'flex', alignItems: 'center',
              justifyContent: 'center', background: INNER_BG, border: `1px solid ${BORDER}`,
              flex: 'none', marginBottom: 2,
            }}
          >
            <ArrowLeft className="w-4 h-4" style={{ color: T2 }} />
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {venue?.name || ''}{(venue as { city?: string | null } | null)?.city ? ` — ${(venue as { city?: string | null }).city}` : ''}
            </div>
            <h1 style={{ margin: '6px 0 0', color: T1, fontSize: 26, fontWeight: 640, letterSpacing: '-0.025em' }}>
              {t('em.title')}
            </h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <button
              onClick={() => setImportOpen(true)}
              className="cursor-pointer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px',
                borderRadius: 10, border: `1px solid ${BORDER}`, background: SUBTLE,
                color: T2, fontSize: 12.5, fontWeight: 500,
              }}
            >
              <Upload className="w-4 h-4" /> {t('em.import.button')}
            </button>
            <button
              onClick={() => navigate('/owner/campaigns/new')}
              className="cursor-pointer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px',
                borderRadius: 10, background: RED, color: '#fff', fontSize: 12.5, fontWeight: 600,
                border: 'none', boxShadow: '0 0 18px -6px #E8192C',
              }}
            >
              <Plus className="w-4 h-4" /> {t('em.new')}
            </button>
          </div>
        </div>

        {/* ── KPIs 30 j ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4" style={{ gap: 12 }}>
          <KpiCard label={t('studio.list.kpiSent')} value={nf(kpis.sent)} sub={t('studio.list.kpi30d')} />
          <KpiCard label={t('studio.list.kpiOpen')} value={kpis.openRate != null ? `${kpis.openRate.toFixed(1).replace('.', ',')} %` : '—'} sub={t('studio.list.kpi30d')} />
          <KpiCard label={t('studio.list.kpiClick')} value={kpis.clickRate != null ? `${kpis.clickRate.toFixed(1).replace('.', ',')} %` : '—'} sub={t('studio.list.kpi30d')} />
          <KpiCard red label={t('studio.list.kpiRevenue')} value={`${nf(Math.round(kpis.revenue))} €`} sub={t('studio.list.kpiRevenueSub')} />
        </div>

        {/* ── RGPD ── */}
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 10,
          background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.22)',
          borderRadius: 12, padding: '10px 14px',
        }}>
          <AlertCircle className="w-4 h-4 mt-0.5 flex-none" style={{ color: WARN }} />
          <p style={{ color: T2, fontSize: 12.5, margin: 0 }}>
            {t('em.fromPrefix')} <span style={{ fontFamily: 'ui-monospace,Menlo,monospace', fontWeight: 700, color: T1 }}>{fromAddr}</span>.{' '}
            {t('em.gdprNote')}
          </p>
        </div>

        {/* ── Tableau des campagnes ── */}
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 22, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 11, display: 'flex', alignItems: 'center',
              justifyContent: 'center', background: 'rgba(255,255,255,0.06)',
              border: `1px solid ${BORDER}`, color: T2,
            }}><Mail className="w-4 h-4" /></div>
            <div style={{ flex: 1 }}>
              <h3 style={{ margin: 0, color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>
                {t('studio.list.allCampaigns')}
              </h3>
              <p style={{ margin: '2px 0 0', color: T3, fontSize: 11.5 }}>{t('studio.list.rowHint')}</p>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-14">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: T3 }} />
            </div>
          ) : campaigns.length === 0 ? (
            <div className="text-center py-14">
              <Mail className="w-10 h-10 mx-auto mb-3" style={{ color: T3 }} />
              <p style={{ color: T3, fontSize: 13 }}>{t('em.empty')}</p>
            </div>
          ) : (
            <>
              <div
                className="hidden md:grid"
                style={{
                  gridTemplateColumns: '2.2fr 0.9fr 1.3fr 1.3fr 0.9fr 0.8fr',
                  gap: 14, padding: '0 12px 10px', borderBottom: `1px solid ${F_BORDER}`,
                }}
              >
                <span style={colHeader}>{t('studio.list.name')}</span>
                <span style={{ ...colHeader, textAlign: 'right' }}>{t('studio.list.sent')}</span>
                <span style={colHeader}>{t('studio.list.opens')}</span>
                <span style={colHeader}>{t('studio.list.clicks')}</span>
                <span style={{ ...colHeader, textAlign: 'right' }}>{t('studio.list.revenue')}</span>
                <span style={{ ...colHeader, textAlign: 'right' }}>{t('studio.list.status')}</span>
              </div>
              {campaigns.map((c) => {
                const pill = STATUS_PILL[c.status] || STATUS_PILL.draft;
                const openPct = c.recipients_count > 0 ? (c.opens_count / c.recipients_count) * 100 : 0;
                const clickPct = c.recipients_count > 0 ? (c.clicks_count / c.recipients_count) * 100 : 0;
                const rev = revenue[c.id];
                const inFlight = c.status === 'sending' || c.status === 'paused';
                return (
                  <div key={c.id}>
                    <div
                      role="button" tabIndex={0}
                      onClick={() => navigate(['sent', 'sending', 'paused'].includes(c.status)
                        ? `/owner/campaigns/${c.id}/report`
                        : `/owner/campaigns/${c.id}/edit`)}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.click(); }}
                      className="grid grid-cols-2 md:[grid-template-columns:2.2fr_0.9fr_1.3fr_1.3fr_0.9fr_0.8fr] cursor-pointer"
                      style={{
                        gap: 14, alignItems: 'center', padding: '14px 12px',
                        borderBottom: `1px solid ${F_BORDER}`, borderRadius: 10,
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <div className="min-w-0 col-span-2 md:col-span-1">
                        <div className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{c.name}</div>
                        <div style={{ color: T3, fontSize: 11, marginTop: 3 }}>{whenLabel(c)}</div>
                      </div>
                      <div className="hidden md:block" style={{ color: T1, fontSize: 13, fontWeight: 620, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {c.recipients_count ? nf(c.recipients_count) : '—'}
                      </div>
                      <div className="hidden md:block">
                        <div style={{ color: T1, fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>
                          {c.recipients_count ? `${openPct.toFixed(0)} %` : '—'}
                        </div>
                        <div style={{ height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.06)', marginTop: 6, overflow: 'hidden' }}>
                          <div style={{
                            height: '100%', width: `${Math.min(100, (openPct / maxOpen) * 100)}%`,
                            borderRadius: 999, background: 'linear-gradient(90deg,rgba(232,25,44,0.75),rgba(232,25,44,0.35))',
                          }} />
                        </div>
                      </div>
                      <div className="hidden md:block">
                        <div style={{ color: T1, fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>
                          {c.recipients_count ? `${clickPct.toFixed(1).replace('.', ',')} %` : '—'}
                        </div>
                        <div style={{ height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.06)', marginTop: 6, overflow: 'hidden' }}>
                          <div style={{
                            height: '100%', width: `${Math.min(100, clickPct * 4)}%`,
                            borderRadius: 999, background: 'rgba(255,255,255,0.4)',
                          }} />
                        </div>
                      </div>
                      <div className="hidden md:block" style={{
                        color: rev ? T1 : T3, fontSize: 13, fontWeight: rev ? 620 : 400,
                        textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                      }}>
                        {rev ? `${nf(Math.round(rev))} €` : '—'}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px',
                          borderRadius: 999, fontSize: 10.5, fontWeight: 600,
                          color: pill.color, background: pill.bg, border: `1px solid ${pill.border}`,
                        }}>{t(pill.labelKey)}</span>
                        {/* Corbeille sur les brouillons seulement : une campagne
                            partie garde ses statistiques et son revenu attribué. */}
                        {c.status === 'draft' && (
                          <button
                            type="button"
                            aria-label={t('em.del.button')}
                            title={t('em.del.button')}
                            onClick={(e) => { e.stopPropagation(); setPendingDelete(c); }}
                            className="cursor-pointer"
                            style={{
                              width: 26, height: 26, borderRadius: 8, flex: 'none',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              background: 'transparent', border: `1px solid ${F_BORDER}`, color: T3,
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.color = NEG; e.currentTarget.style.borderColor = 'rgba(255,92,99,0.35)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = T3; e.currentTarget.style.borderColor = F_BORDER; }}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    {inFlight && (
                      <div style={{ padding: '0 12px 12px' }}>
                        <CampaignSendProgress
                          campaignId={c.id}
                          onSettled={(status) => setCampaigns((prev) => prev.map((x) => x.id === c.id ? { ...x, status } : x))}
                          onBuyCredits={() => setCreditsOpen(true)}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>

      {venueId && (
        <EmailCreditsDialog
          open={creditsOpen}
          onClose={() => setCreditsOpen(false)}
          scope={{ kind: 'venue', venueId }}
        />
      )}
      {venueId && (
        <ImportContactsDialog
          open={importOpen}
          onClose={() => setImportOpen(false)}
          scope={{ kind: 'venue', venueId }}
        />
      )}

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('em.del.title').replace('{name}', pendingDelete?.name || '')}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('em.del.desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void deleteDraft(); }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground"
            >
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function KpiCard({ label, value, sub, red }: { label: string; value: string; sub: string; red?: boolean }) {
  return (
    <div style={{
      background: red ? RED_CARD_BG : CARD_BG,
      border: `1px solid ${red ? 'rgba(232,25,44,0.22)' : BORDER}`,
      borderRadius: 18, boxShadow: CARD_SHADOW, padding: 20,
    }}>
      <div style={{
        color: red ? RED : T3, fontSize: 11, fontWeight: 600,
        letterSpacing: '0.08em', textTransform: 'uppercase',
      }}>{label}</div>
      <div style={{
        color: T1, fontSize: 30, fontWeight: 640, letterSpacing: '-0.025em',
        marginTop: 8, fontVariantNumeric: 'tabular-nums',
      }}>{value}</div>
      <div style={{ color: T3, fontSize: 12, marginTop: 6 }}>{sub}</div>
    </div>
  );
}

export function OwnerCampaignEditor() {
  const { venueId, venue, loading } = useVenueContext();
  if (loading || !venueId) return <OwnerPageSkeleton />;
  return (
    <StudioShell
      basePath="/owner/campaigns"
      scope={{
        kind: 'venue',
        venueId,
        name: venue?.name || 'Mon club',
        logoUrl: (venue as { logoUrl?: string | null; logo_url?: string | null } | null)?.logoUrl
          || (venue as { logo_url?: string | null } | null)?.logo_url || null,
        city: (venue as { city?: string | null } | null)?.city || null,
      }}
    />
  );
}

export function OwnerCampaignReport() {
  const { venueId, venue, loading } = useVenueContext();
  if (loading || !venueId) return <OwnerPageSkeleton />;
  return (
    <CampaignReport
      basePath="/owner/campaigns"
      scope={{
        kind: 'venue',
        venueId,
        name: venue?.name || 'Mon club',
        logoUrl: (venue as { logoUrl?: string | null; logo_url?: string | null } | null)?.logoUrl
          || (venue as { logo_url?: string | null } | null)?.logo_url || null,
        city: (venue as { city?: string | null } | null)?.city || null,
      }}
    />
  );
}
