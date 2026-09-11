// Campagnes SMS de la plateforme — même moteur que le club et l'organisateur
// (SmsCampaignsPanel), portée « plateforme ». Différence unique : Yuno n'achète
// pas de crédits. Le SMS part sur le compte Twilio de Yuno, donc pas de solde,
// pas de débit, pas de blocage pour crédits épuisés — le coût reste lisible sur
// chaque destinataire (`sms_campaign_recipients.credits`).
//
// Tant que SMS_MARKETING_LIVE est à false, tout se prépare mais rien ne part :
// la bannière « bientôt » et les verrous sont ceux des pros, à l'identique.

import { useMemo } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, MessageSquare } from 'lucide-react';
import SmsCampaignsPanel from '@/components/sms/SmsCampaignsPanel';
import { useLanguage } from '@/contexts/LanguageContext';
import type { SmsScope } from '@/lib/smsMarketing';

const RED = '#E8192C';
const T1  = 'rgba(255,255,255,0.96)';
const T2  = 'rgba(255,255,255,0.58)';
const T3  = 'rgba(255,255,255,0.36)';
const F_BORDER = 'rgba(255,255,255,0.055)';
const TILE_BG  = 'rgba(255,255,255,0.025)';

export default function AdminMarketingSms() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const [searchParams] = useSearchParams();

  const scope = useMemo<SmsScope>(() => ({ kind: 'platform', name: 'Yuno' }), []);

  return (
    <div className="min-h-screen pb-16" style={{ background: '#000' }}>
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(232,25,44,.05),transparent 55%)' }} />

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 py-6 space-y-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl flex-none"
            style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}>
            <MessageSquare className="h-4 w-4" style={{ color: RED }} />
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <h1 style={{ color: T1, fontSize: 'clamp(22px,3vw,28px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1 }}>
              {t('pm.smsTitle')}
            </h1>
            <p style={{ color: T3, fontSize: 12.5, marginTop: 6, maxWidth: 680 }}>{t('pm.smsSubtitle')}</p>
          </div>
          <button
            type="button"
            onClick={() => navigate(id ? '/admin/marketing/sms' : '/admin/marketing')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 13px',
              borderRadius: 11, fontSize: 12.5, fontWeight: 600, color: T2,
              background: TILE_BG, border: `1px solid ${F_BORDER}`, cursor: 'pointer',
            }}
          >
            <ArrowLeft className="h-3.5 w-3.5" />{t('pm.back')}
          </button>
        </div>

        <SmsCampaignsPanel
          scope={scope}
          basePath="/admin/marketing/sms"
          selectedId={id ?? null}
          presetEventId={searchParams.get('event')}
        />
      </div>
    </div>
  );
}
