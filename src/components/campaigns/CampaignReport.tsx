import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Link2, Loader2, Mail, Users, Eye, MousePointerClick, Split, Trophy,
  UserMinus, AlertTriangle, ShieldX, CheckCircle2, BarChart3, Palette, Euro,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import CampaignSendProgress from '@/components/campaigns/CampaignSendProgress';
import {
  buildPreviewHtml, DEFAULT_THEME,
  type EmailBlock, type EmailTheme, type SocialLinks,
} from '@/lib/emailCampaign';
import {
  normalizeTheme, normalizeV2Blocks, renderEmailHtml,
  type SocialLinks as StudioSocialLinks,
} from '@/lib/email';
import { useStudioLiveData, type StudioScope as SenderScope } from '@/components/email-studio/hooks';

// ─── Yuno Design Tokens (match OwnerCampaigns) ───────────────────────────────
const RED         = '#E8192C';
const T1          = 'rgba(255,255,255,0.96)';
const T2          = 'rgba(255,255,255,0.58)';
const T3          = 'rgba(255,255,255,0.36)';
const BORDER      = 'rgba(255,255,255,0.085)';
const INNER_BG    = 'rgba(255,255,255,0.032)';
const CARD_BG     = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';
const POS         = '#34D399';
const WARN        = '#FCD34D';
const NEG         = '#FF5C63';

interface Props {
  scope: SenderScope;
  basePath: string;
}

type CampaignRow = {
  id: string;
  name: string;
  subject: string;
  subject_b: string | null;
  ab_enabled: boolean | null;
  ab_winner: string | null;
  preheader: string | null;
  type: string | null;
  status: string;
  sent_at: string | null;
  created_at: string;
  recipients_count: number;
  opens_count: number;
  clicks_count: number;
  unsubscribes_count: number;
  delivered_count: number;
  bounced_count: number;
  complained_count: number;
  blocks_json: unknown;
  blocks_version: number | null;
  theme_json: unknown;
  social_links_json: unknown;
  logo_url: string | null;
  event_id: string | null;
};

interface AbStats { sent_a: number; sent_b: number; opens_a: number; opens_b: number; winner: string | null }
interface LinkStat { url: string; n: number }

/** URL de clic → libellé lisible (référence campagne retirée, origine raccourcie). */
function prettyLink(raw: string): string {
  try {
    const u = new URL(raw);
    u.searchParams.delete('yc');
    const path = `${u.pathname}${u.search}`.replace(/\/$/, '') || '/';
    return u.hostname.replace(/^www\./, '') + (path === '/' ? '' : path);
  } catch {
    return raw;
  }
}

function MetricTile({
  icon: Icon, label, value, sub, accent,
}: {
  icon: typeof Users; label: string; value: string; sub?: string; accent?: string;
}) {
  return (
    <div
      style={{
        background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 14,
        boxShadow: CARD_SHADOW, padding: '14px 16px',
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4" style={{ color: accent || T3 }} />
        <span style={{ color: T2, fontSize: 12, fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ color: accent || T1, fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
        {value}
      </div>
      {sub && <div style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function FunnelBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span style={{ color: T2, fontSize: 12.5 }}>{label}</span>
        <span style={{ color: T1, fontSize: 12.5, fontWeight: 600 }}>
          {value.toLocaleString()} <span style={{ color: T3, fontWeight: 400 }}>· {pct.toFixed(1)}%</span>
        </span>
      </div>
      <div style={{ height: 8, borderRadius: 6, background: INNER_BG, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 6, transition: 'width .4s ease' }} />
      </div>
    </div>
  );
}

export default function CampaignReport({ scope, basePath }: Props) {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const { id } = useParams<{ id: string }>();

  const [loading, setLoading] = useState(true);
  const [campaign, setCampaign] = useState<CampaignRow | null>(null);
  const [extra, setExtra] = useState({ delivered: 0, bounced: 0, complained: 0, failed: 0 });
  // Attribution clic→achat 72 h (get_email_campaign_attribution, net de frais).
  const [attribution, setAttribution] = useState<{ revenue: number; buyers: number } | null>(null);
  // Test A/B d'objet : échantillons + ouvertures par variante (RPC dédiée).
  const [ab, setAb] = useState<AbStats | null>(null);
  // Liens les plus cliqués — agrégés depuis le payload Resend des événements.
  const [topLinks, setTopLinks] = useState<LinkStat[]>([]);
  const [tab, setTab] = useState<'performance' | 'design'>('performance');

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase.from('email_campaigns').select('*').eq('id', id).maybeSingle();
      if (cancelled) return;
      setCampaign((data as unknown as CampaignRow) || null);

      if (data) {
        // delivered/bounced/complained viennent des compteurs de la campagne
        // (recalculés serveur par destinataire unique de la file) — jamais d'un
        // count sur email_campaign_events : les lignes brutes incluent les
        // envois de test et les doublons de retries, et affichaient plus de
        // délivrés que de destinataires.
        const counters = data as unknown as CampaignRow;
        const { count: failedCount } = await supabase.from('email_campaign_recipients')
          .select('id', { count: 'exact', head: true })
          .eq('campaign_id', id)
          .in('status', ['failed', 'bounced']);
        if (!cancelled) {
          setExtra({
            delivered: counters.delivered_count || 0,
            bounced: counters.bounced_count || 0,
            complained: counters.complained_count || 0,
            failed: failedCount || 0,
          });
        }
        // Test A/B : stats par variante — best-effort, carte absente sans A/B.
        const row = data as unknown as CampaignRow;
        if (row.ab_enabled && (row.subject_b || '').trim()) {
          try {
            const { data: abData } = await supabase.rpc('get_campaign_ab_stats' as never, { p_campaign_id: id } as never);
            const payload = abData as ({ supported?: boolean } & AbStats) | null;
            if (!cancelled && payload?.supported) {
              setAb({
                sent_a: payload.sent_a || 0, sent_b: payload.sent_b || 0,
                opens_a: payload.opens_a || 0, opens_b: payload.opens_b || 0,
                winner: payload.winner || null,
              });
            }
          } catch { /* carte absente */ }
        }

        // Top des liens cliqués — le payload Resend porte l'URL de chaque clic.
        try {
          const { data: clickRows } = await supabase
            .from('email_campaign_events')
            .select('metadata')
            .eq('campaign_id', id)
            .eq('event_type', 'clicked')
            .limit(2000);
          if (!cancelled && clickRows && clickRows.length > 0) {
            const counts = new Map<string, number>();
            for (const r of clickRows) {
              const meta = r.metadata as { click?: { link?: string }; link?: string } | null;
              const link = meta?.click?.link || meta?.link;
              if (typeof link !== 'string' || !link) continue;
              const key = prettyLink(link);
              counts.set(key, (counts.get(key) || 0) + 1);
            }
            setTopLinks([...counts.entries()]
              .map(([url, n]) => ({ url, n }))
              .sort((a, b) => b.n - a.n)
              .slice(0, 6));
          }
        } catch { /* carte absente */ }

        // Revenus attribués — best-effort : sans donnée, les tuiles n'apparaissent pas.
        try {
          const subject = (data as { venue_id?: string | null; organizer_user_id?: string | null });
          const args = subject.venue_id
            ? { p_subject_type: 'venue', p_subject_id: subject.venue_id }
            : subject.organizer_user_id
              ? { p_subject_type: 'organizer', p_subject_id: subject.organizer_user_id }
              : null;
          if (args) {
            const { data: attr } = await supabase.rpc('get_email_campaign_attribution' as never, args as never);
            const payload = attr as { supported?: boolean; campaigns?: Array<{ id: string; revenue: number; buyers: number }> } | null;
            if (!cancelled && payload?.supported) {
              const mine = (payload.campaigns || []).find((campRow) => campRow.id === id);
              setAttribution(mine ? { revenue: mine.revenue, buyers: mine.buyers } : { revenue: 0, buyers: 0 });
            }
          }
        } catch { /* tuiles absentes */ }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Campagne v2 (Email Studio) : MÊME renderer que l'éditeur et l'envoi, avec
  // les données live des blocs Yuno. Le renderer v1 ne sert plus qu'aux
  // anciennes campagnes (blocks_version 1) — le router à l'aveugle affichait
  // un aperçu faux pour toutes les campagnes Studio.
  const isV2 = Number(campaign?.blocks_version || 1) >= 2;
  const v2Blocks = useMemo(
    () => (campaign && isV2 ? normalizeV2Blocks(campaign.blocks_json) : []),
    [campaign, isV2],
  );
  const v2Live = useStudioLiveData(v2Blocks, campaign?.event_id ?? null);

  const designHtml = useMemo(() => {
    if (!campaign) return '';
    if (isV2) {
      return renderEmailHtml(v2Blocks, normalizeTheme(campaign.theme_json), {
        venueName: scope.name,
        city: scope.city,
        logoUrl: campaign.logo_url || scope.logoUrl,
        emailType: (campaign.type as 'promotional' | 'informational') || 'promotional',
        subject: campaign.subject,
        preheader: campaign.preheader || '',
        recipient: { email: 'aperçu@exemple.com', firstName: 'Camille' },
        unsubscribeUrl: '#',
        socialLinks: (campaign.social_links_json as StudioSocialLinks) || {},
        baseUrl: 'https://yunoapp.eu',
        live: v2Live,
        ignoreConds: true,
      });
    }
    const blocks = ((campaign.blocks_json as EmailBlock[]) || []).map(b =>
      b.type === 'header' && !(b as { logo_url?: string }).logo_url && campaign.logo_url
        ? { ...b, logo_url: campaign.logo_url }
        : b,
    );
    return buildPreviewHtml({
      blocks,
      preheader: campaign.preheader || '',
      emailType: (campaign.type as 'promotional' | 'informational') || 'promotional',
      venueName: scope.name,
      city: scope.city,
      theme: { ...DEFAULT_THEME, ...((campaign.theme_json as EmailTheme) || {}) },
      socialLinks: (campaign.social_links_json as SocialLinks) || {},
      flush: true,
    });
  }, [campaign, scope, isV2, v2Blocks, v2Live]);

  const rc = campaign?.recipients_count || 0;
  const opens = campaign?.opens_count || 0;
  const clicks = campaign?.clicks_count || 0;
  const unsubs = campaign?.unsubscribes_count || 0;
  const delivered = extra.delivered;
  const fmtPct = (n: number, d: number) => `${d > 0 ? ((n / d) * 100).toFixed(1) : '0'}%`;

  const sentDate = campaign?.sent_at
    ? new Date(campaign.sent_at).toLocaleDateString(language, { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  return (
    <div className="min-h-screen pb-24" style={{ background: '#000' }}>
      <div className="max-w-4xl mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate(basePath)}
            className="w-9 h-9 flex items-center justify-center rounded-xl cursor-pointer transition-all duration-150 shrink-0"
            style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}
          >
            <ArrowLeft className="w-4 h-4" style={{ color: T2 }} />
          </button>
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 truncate" style={{ color: T1, fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>
              <BarChart3 className="w-5 h-5 shrink-0" style={{ color: RED }} />
              <span className="truncate">{campaign?.name || t('em.report.title')}</span>
            </h1>
            <p style={{ color: T3, fontSize: 13, margin: 0 }} className="truncate">
              {campaign?.subject}
              {sentDate ? ` · ${t('em.report.sentOn')} ${sentDate}` : ''}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin" style={{ color: T3 }} /></div>
        ) : !campaign ? (
          <div className="text-center py-16" style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW }}>
            <Mail className="w-12 h-12 mx-auto mb-4" style={{ color: T3 }} />
            <p style={{ color: T3, fontSize: 14 }}>{t('em.report.notFound')}</p>
          </div>
        ) : (
          <>
            {/* Envoi en cours : suivi temps réel + pause / reprise / annulation.
                La liste des campagnes route désormais ici (et non vers
                l'éditeur) dès qu'une campagne est en vol — on n'édite pas un
                email dont une moitié est déjà partie. */}
            {(campaign.status === 'sending' || campaign.status === 'paused') && (
              <div className="mb-5">
                <CampaignSendProgress campaignId={campaign.id} />
              </div>
            )}

            {/* Tabs */}
            <div className="flex items-center gap-2 mb-5">
              {([
                { id: 'performance' as const, label: t('em.report.tabPerformance'), icon: BarChart3 },
                { id: 'design' as const, label: t('em.report.tabDesign'), icon: Palette },
              ]).map(({ id: tid, label, icon: Icon }) => (
                <button
                  key={tid}
                  onClick={() => setTab(tid)}
                  className="flex items-center gap-2 cursor-pointer transition-all duration-150"
                  style={{
                    padding: '8px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                    color: tab === tid ? T1 : T2,
                    background: tab === tid ? 'rgba(255,255,255,0.06)' : INNER_BG,
                    border: `1px solid ${tab === tid ? 'rgba(255,255,255,0.18)' : BORDER}`,
                  }}
                >
                  <Icon className="w-4 h-4" /> {label}
                </button>
              ))}
            </div>

            {tab === 'performance' ? (
              <div className="space-y-5">
                {/* Metric tiles */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <MetricTile icon={Users} label={t('em.report.recipients')} value={rc.toLocaleString()} />
                  <MetricTile icon={CheckCircle2} label={t('em.report.delivered')} value={delivered.toLocaleString()} sub={fmtPct(delivered, rc)} accent={POS} />
                  <MetricTile icon={Eye} label={t('em.report.opens')} value={opens.toLocaleString()} sub={`${fmtPct(opens, rc)} ${t('em.report.openRate')}`} accent={RED} />
                  <MetricTile icon={MousePointerClick} label={t('em.report.clicks')} value={clicks.toLocaleString()} sub={`${fmtPct(clicks, rc)} ${t('em.report.clickRate')}`} accent={RED} />
                  <MetricTile icon={UserMinus} label={t('em.report.unsubscribes')} value={unsubs.toLocaleString()} sub={fmtPct(unsubs, rc)} accent={unsubs > 0 ? WARN : undefined} />
                  <MetricTile icon={AlertTriangle} label={t('em.report.bounces')} value={extra.bounced.toLocaleString()} sub={fmtPct(extra.bounced, rc)} accent={extra.bounced > 0 ? WARN : undefined} />
                  {attribution && (
                    <>
                      <MetricTile icon={Euro} label={t('em.report.attributedRevenue')} value={`${attribution.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}€`} accent={POS} />
                      <MetricTile icon={Users} label={t('em.report.attributedBuyers')} value={attribution.buyers.toLocaleString()} accent={POS} />
                    </>
                  )}
                </div>
                {attribution && (
                  <p style={{ color: T3, fontSize: 11, lineHeight: 1.5, marginTop: -8 }}>{t('em.report.attributionNote')}</p>
                )}

                {/* Test A/B d'objet : échantillons, ouvertures, gagnant */}
                {ab && campaign.subject_b && (
                  <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 16, boxShadow: CARD_SHADOW, padding: '18px 18px 20px' }}>
                    <h3 className="flex items-center gap-2" style={{ color: T1, fontSize: 14, fontWeight: 600, margin: '0 0 4px' }}>
                      <Split className="w-4 h-4" style={{ color: RED }} /> {t('em.report.abTitle')}
                    </h3>
                    <p style={{ color: T3, fontSize: 11.5, margin: '0 0 14px' }}>
                      {ab.winner ? t('em.report.abResolved') : t('em.report.abPending')}
                    </p>
                    <div className="space-y-4">
                      {([
                        { variant: 'a' as const, subject: campaign.subject, sent: ab.sent_a, opens: ab.opens_a },
                        { variant: 'b' as const, subject: campaign.subject_b, sent: ab.sent_b, opens: ab.opens_b },
                      ]).map(({ variant, subject, sent, opens }) => {
                        const isWinner = ab.winner === variant;
                        const rate = sent > 0 ? (opens / sent) * 100 : 0;
                        return (
                          <div key={variant}>
                            <div className="flex items-center justify-between gap-3 mb-1">
                              <span className="flex items-center gap-2 min-w-0" style={{ color: T2, fontSize: 12.5 }}>
                                <span style={{
                                  width: 18, height: 18, borderRadius: 6, flex: 'none',
                                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                  background: isWinner ? 'rgba(52,211,153,0.15)' : INNER_BG,
                                  border: `1px solid ${isWinner ? 'rgba(52,211,153,0.35)' : BORDER}`,
                                  color: isWinner ? POS : T2, fontSize: 10, fontWeight: 700,
                                }}>{variant.toUpperCase()}</span>
                                <span className="truncate">{subject}</span>
                                {isWinner && (
                                  <span className="inline-flex items-center gap-1 shrink-0" style={{ color: POS, fontSize: 11, fontWeight: 600 }}>
                                    <Trophy className="w-3 h-3" /> {t('em.report.abWinner')}
                                  </span>
                                )}
                              </span>
                              <span className="shrink-0" style={{ color: T1, fontSize: 12.5, fontWeight: 600 }}>
                                {rate.toFixed(1)}% <span style={{ color: T3, fontWeight: 400 }}>· {opens}/{sent}</span>
                              </span>
                            </div>
                            <div style={{ height: 8, borderRadius: 6, background: INNER_BG, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${Math.min(100, rate)}%`, background: isWinner ? POS : RED, borderRadius: 6 }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <p style={{ color: T3, fontSize: 11, lineHeight: 1.5, margin: '12px 0 0' }}>{t('em.report.abNote')}</p>
                  </div>
                )}

                {/* Funnel */}
                <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 16, boxShadow: CARD_SHADOW, padding: '18px 18px 20px' }}>
                  <h3 style={{ color: T1, fontSize: 14, fontWeight: 600, margin: '0 0 14px' }}>{t('em.report.funnel')}</h3>
                  <div className="space-y-3.5">
                    <FunnelBar label={t('em.report.recipients')} value={rc} total={rc} color="rgba(255,255,255,0.28)" />
                    <FunnelBar label={t('em.report.delivered')} value={delivered} total={rc} color={POS} />
                    <FunnelBar label={t('em.report.opens')} value={opens} total={rc} color={RED} />
                    <FunnelBar label={t('em.report.clicks')} value={clicks} total={rc} color="#A78BFA" />
                  </div>
                  {(extra.complained > 0 || extra.failed > 0) && (
                    <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-4 pt-4" style={{ borderTop: `1px solid ${BORDER}` }}>
                      {extra.failed > 0 && (
                        <span className="inline-flex items-center gap-1.5" style={{ color: NEG, fontSize: 12 }}>
                          <AlertTriangle className="w-3.5 h-3.5" /> {extra.failed.toLocaleString()} {t('em.report.failed')}
                        </span>
                      )}
                      {extra.complained > 0 && (
                        <span className="inline-flex items-center gap-1.5" style={{ color: WARN, fontSize: 12 }}>
                          <ShieldX className="w-3.5 h-3.5" /> {extra.complained.toLocaleString()} {t('em.report.complaints')}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Liens les plus cliqués : où l'audience est vraiment allée */}
                {topLinks.length > 0 && (
                  <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 16, boxShadow: CARD_SHADOW, padding: '18px 18px 20px' }}>
                    <h3 className="flex items-center gap-2" style={{ color: T1, fontSize: 14, fontWeight: 600, margin: '0 0 14px' }}>
                      <Link2 className="w-4 h-4" style={{ color: RED }} /> {t('em.report.topLinks')}
                    </h3>
                    <div className="space-y-3">
                      {topLinks.map((l) => {
                        const max = topLinks[0].n;
                        return (
                          <div key={l.url}>
                            <div className="flex items-center justify-between gap-3 mb-1">
                              <span className="truncate" style={{ color: T2, fontSize: 12.5, fontFamily: 'ui-monospace,Menlo,monospace' }}>{l.url}</span>
                              <span className="shrink-0" style={{ color: T1, fontSize: 12.5, fontWeight: 600 }}>
                                {l.n.toLocaleString()} <span style={{ color: T3, fontWeight: 400 }}>{t('em.report.topLinksClicks')}</span>
                              </span>
                            </div>
                            <div style={{ height: 6, borderRadius: 6, background: INNER_BG, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${(l.n / max) * 100}%`, background: '#A78BFA', borderRadius: 6 }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 16, boxShadow: CARD_SHADOW, padding: 16 }}>
                <p style={{ color: T3, fontSize: 12.5, margin: '0 0 12px' }}>{t('em.report.designNote')}</p>
                <div className="flex justify-center">
                  <iframe
                    srcDoc={designHtml}
                    title="email-design"
                    className="bg-white rounded-lg w-full"
                    style={{ height: 760, maxWidth: 600, border: 'none' }}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
