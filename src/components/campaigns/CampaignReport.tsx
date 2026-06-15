import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Loader2, Mail, Users, Eye, MousePointerClick,
  UserMinus, AlertTriangle, ShieldX, CheckCircle2, BarChart3, Palette,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  buildPreviewHtml, DEFAULT_THEME,
  type EmailBlock, type EmailTheme, type SocialLinks,
} from '@/lib/emailCampaign';
import type { SenderScope } from './CampaignBuilder';

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
  preheader: string | null;
  type: string | null;
  status: string;
  sent_at: string | null;
  created_at: string;
  recipients_count: number;
  opens_count: number;
  clicks_count: number;
  unsubscribes_count: number;
  blocks_json: unknown;
  theme_json: unknown;
  social_links_json: unknown;
  logo_url: string | null;
};

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
  const [tab, setTab] = useState<'performance' | 'design'>('performance');

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase.from('email_campaigns').select('*').eq('id', id).maybeSingle();
      if (cancelled) return;
      setCampaign((data as CampaignRow) || null);

      if (data) {
        const evCount = (eventType: string) =>
          supabase.from('email_campaign_events')
            .select('id', { count: 'exact', head: true })
            .eq('campaign_id', id)
            .eq('event_type', eventType);
        const [d, b, c, f] = await Promise.all([
          evCount('delivered'),
          evCount('bounced'),
          evCount('complained'),
          supabase.from('email_campaign_recipients')
            .select('id', { count: 'exact', head: true })
            .eq('campaign_id', id)
            .in('status', ['failed', 'bounced']),
        ]);
        if (!cancelled) {
          setExtra({
            delivered: d.count || 0,
            bounced: b.count || 0,
            complained: c.count || 0,
            failed: f.count || 0,
          });
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id]);

  const designHtml = useMemo(() => {
    if (!campaign) return '';
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
  }, [campaign, scope]);

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
                </div>

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
