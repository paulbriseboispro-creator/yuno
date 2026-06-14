import { useState, useEffect } from 'react';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Mail, Loader2, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useVenueContext } from '@/hooks/useVenueContext';
import { useLanguage } from '@/contexts/LanguageContext';
import CampaignBuilder from '@/components/campaigns/CampaignBuilder';
import { slugifyVenueName } from '@/lib/emailCampaign';

// ─── Yuno Design Tokens ──────────────────────────────────────────────────────
const RED       = '#E8192C';
const T1        = 'rgba(255,255,255,0.96)';
const T2        = 'rgba(255,255,255,0.58)';
const T3        = 'rgba(255,255,255,0.36)';
const BORDER    = 'rgba(255,255,255,0.085)';
const F_BORDER  = 'rgba(255,255,255,0.055)';
const INNER_BG  = 'rgba(255,255,255,0.032)';
const TILE_BG   = 'rgba(255,255,255,0.025)';
const CARD_BG   = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';
const POS       = '#34D399';
const NEG       = '#FF5C63';

type Campaign = {
  id: string; name: string; type: 'promotional' | 'informational';
  subject: string; status: string; recipients_count: number; opens_count: number; clicks_count: number;
};

const STATUS_CFG: Record<string, { labelKey: string; color: string; bg: string; border: string }> = {
  draft:     { labelKey: 'em.status.draft',     color: T3,  bg: INNER_BG,                      border: BORDER },
  scheduled: { labelKey: 'em.status.scheduled', color: T2,  bg: 'rgba(255,255,255,0.06)',       border: BORDER },
  sending:   { labelKey: 'em.status.sending',   color: '#FCD34D', bg: 'rgba(251,191,36,0.10)', border: 'rgba(251,191,36,0.25)' },
  sent:      { labelKey: 'em.status.sent',      color: POS, bg: 'rgba(52,211,153,0.10)',        border: 'rgba(52,211,153,0.25)' },
  failed:    { labelKey: 'em.status.failed',    color: NEG, bg: 'rgba(255,92,99,0.08)',         border: 'rgba(255,92,99,0.20)' },
};

function Chip({ label, color, bg, border }: { label: string; color: string; bg: string; border: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 8px', borderRadius: 6,
      fontSize: 10.5, fontWeight: 600,
      color, background: bg, border: `1px solid ${border}`,
    }}>{label}</span>
  );
}

export default function OwnerCampaigns() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { venueId, venue } = useVenueContext();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!venueId) return;
    supabase.from('email_campaigns').select('id,name,type,subject,status,recipients_count,opens_count,clicks_count')
      .eq('venue_id', venueId).order('created_at', { ascending: false })
      .then(({ data }) => { setCampaigns((data || []) as any); setLoading(false); });
  }, [venueId]);

  const fromAddr = venue?.name ? `${slugifyVenueName(venue.name)}@yunoapp.eu` : 'votre-club@yunoapp.eu';

  return (
    <div className="min-h-screen pb-24" style={{ background: '#000' }}>
      <div className="max-w-4xl mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/owner/dashboard')}
              className="w-9 h-9 flex items-center justify-center rounded-xl cursor-pointer transition-all duration-150"
              style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}
            >
              <ArrowLeft className="w-4 h-4" style={{ color: T2 }} />
            </button>
            <div>
              <h1 className="flex items-center gap-2" style={{ color: T1, fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>
                <Mail className="w-5 h-5" style={{ color: RED }} />
                {t('em.title')}
              </h1>
              <p style={{ color: T3, fontSize: 13, margin: 0 }}>{t('em.subtitle')}</p>
            </div>
          </div>
          <button
            onClick={() => navigate('/owner/campaigns/new')}
            className="flex items-center gap-2 cursor-pointer transition-all duration-150"
            style={{
              background: RED, color: '#fff', border: 'none',
              padding: '9px 16px', borderRadius: 10, fontSize: 13.5, fontWeight: 600,
            }}
          >
            <Plus className="w-4 h-4" />
            {t('em.new')}
          </button>
        </div>

        {/* RGPD notice */}
        <div
          className="flex items-start gap-3 mb-5"
          style={{
            background: 'rgba(251,191,36,0.06)',
            border: '1px solid rgba(251,191,36,0.22)',
            borderRadius: 12, padding: '12px 14px',
          }}
        >
          <AlertCircle className="w-4 h-4 mt-0.5 flex-none" style={{ color: '#FCD34D' }} />
          <p style={{ color: T2, fontSize: 13, margin: 0 }}>
            {t('em.fromPrefix')} <span style={{ fontFamily: 'monospace', fontWeight: 700, color: T1 }}>{fromAddr}</span>.{' '}
            {t('em.gdprNote')}
          </p>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: T3 }} />
          </div>
        ) : campaigns.length === 0 ? (
          <div
            className="text-center py-16"
            style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW }}
          >
            <Mail className="w-12 h-12 mx-auto mb-4" style={{ color: T3 }} />
            <p style={{ color: T3, fontSize: 14 }}>{t('em.empty')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {campaigns.map((c) => {
              const s = STATUS_CFG[c.status] || { labelKey: c.status, color: T3, bg: INNER_BG, border: BORDER };
              const openRate = c.recipients_count > 0 ? ((c.opens_count / c.recipients_count) * 100).toFixed(1) : '0';
              return (
                <button
                  key={c.id}
                  onClick={() => navigate(`/owner/campaigns/${c.id}/edit`)}
                  className="w-full text-left cursor-pointer transition-all duration-150"
                  style={{
                    background: CARD_BG,
                    border: `1px solid ${BORDER}`,
                    borderRadius: 14,
                    boxShadow: CARD_SHADOW,
                    padding: '14px 16px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)')}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = BORDER)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="truncate" style={{ color: T1, fontSize: 14, fontWeight: 600, margin: 0 }}>{c.name}</h3>
                      <Chip
                        label={c.type === 'promotional' ? t('em.typeMarketing') : t('em.typeInfo')}
                        color={T3} bg={TILE_BG} border={F_BORDER}
                      />
                      <Chip label={t(s.labelKey)} color={s.color} bg={s.bg} border={s.border} />
                    </div>
                    <p className="truncate" style={{ color: T3, fontSize: 12.5, margin: 0 }}>{c.subject}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p style={{ color: T1, fontSize: 13.5, fontWeight: 600, margin: 0 }}>{c.recipients_count} {t('em.recipients')}</p>
                    <p style={{ color: T3, fontSize: 11.5, margin: 0 }}>{openRate}% {t('em.openRate')}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function OwnerCampaignEditor() {
  const { venueId, venue, loading } = useVenueContext();
  if (loading || !venueId) return <OwnerPageSkeleton />;
  return (
    <CampaignBuilder
      basePath="/owner/campaigns"
      scope={{
        kind: 'venue',
        venueId,
        name: venue?.name || 'Mon club',
        logoUrl: (venue as any)?.logoUrl || (venue as any)?.logo_url || null,
        city: (venue as any)?.city || null,
      }}
    />
  );
}
