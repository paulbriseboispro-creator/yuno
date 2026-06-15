import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Mail, Loader2, AlertCircle, BarChart3 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useProfileType } from '@/hooks/useProfileType';
import CampaignBuilder from '@/components/campaigns/CampaignBuilder';
import CampaignReport from '@/components/campaigns/CampaignReport';
import { slugifyVenueName } from '@/lib/emailCampaign';
import {
  OrgPage, OrgPageHeader, OrgCard, OrgPill, OrgButton, OrgEmptyState,
  T1, T2, T3,
} from '@/components/org-ui';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';

type Campaign = {
  id: string; name: string; type: 'promotional' | 'informational';
  subject: string; status: string; recipients_count: number; opens_count: number; clicks_count: number;
};

type PillTone = 'default' | 'success' | 'danger' | 'warn' | 'info' | 'muted';

const STATUS_META: Record<string, { fr: string; en: string; es: string; tone: PillTone }> = {
  draft: { fr: 'Brouillon', en: 'Draft', es: 'Borrador', tone: 'muted' },
  scheduled: { fr: 'Planifiée', en: 'Scheduled', es: 'Programada', tone: 'info' },
  sending: { fr: 'Envoi en cours', en: 'Sending', es: 'Enviando', tone: 'warn' },
  sent: { fr: 'Envoyée', en: 'Sent', es: 'Enviada', tone: 'success' },
  failed: { fr: 'Échec', en: 'Failed', es: 'Fallida', tone: 'danger' },
};

export default function OrgAppCampaigns() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { profile } = useProfileType();
  const { language } = useLanguage();
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    supabase.from('email_campaigns').select('id,name,type,subject,status,recipients_count,opens_count,clicks_count')
      .eq('organizer_user_id', user.id).order('created_at', { ascending: false })
      .then(({ data }) => { setCampaigns((data || []) as any); setLoading(false); });
  }, [user?.id]);

  const orgName = profile?.organizationName || 'Mon organisation';
  const fromAddr = `${slugifyVenueName(orgName)}@yunoapp.eu`;

  return (
    <OrgPage className="mx-auto max-w-6xl">
      <div className="mb-4 flex items-center gap-2">
        <button onClick={() => navigate('/organizer-app')} className="inline-flex h-8 w-8 items-center justify-center rounded-lg" style={{ color: T3 }}>
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <OrgPageHeader
            title={t('Campagnes Email', 'Email campaigns', 'Campañas de email')}
            subtitle={t('Newsletter & emails de service à votre audience', 'Newsletter & service emails to your audience', 'Newsletter y emails de servicio para tu audiencia')}
            actions={
              <OrgButton variant="primary" size="sm" onClick={() => navigate('/organizer-app/campaigns/new')}>
                <Plus className="h-4 w-4" /> <span className="hidden sm:inline">{t('Nouvelle campagne', 'New campaign', 'Nueva campaña')}</span>
              </OrgButton>
            }
          />
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl p-4" style={{ background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.22)' }}>
          <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" style={{ color: '#FCD34D' }} />
          <p style={{ color: T3, fontSize: 12.5 }}>
            {t('Les emails partent depuis', 'Emails are sent from', 'Los emails se envían desde')} <span className="font-mono font-semibold" style={{ color: T2 }}>{fromAddr}</span>.
            {' '}{t(
              'Les emails marketing ne sont envoyés qu\'aux contacts ayant explicitement accepté vos communications (RGPD).',
              'Marketing emails are only sent to contacts who explicitly opted in to your communications (GDPR).',
              'Los emails de marketing solo se envían a los contactos que han aceptado explícitamente tus comunicaciones (RGPD).',
            )}
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" style={{ color: T3 }} /></div>
        ) : campaigns.length === 0 ? (
          <OrgEmptyState icon={Mail} title={t('Aucune campagne pour le moment.', 'No campaigns yet.', 'Aún no hay campañas.')} description={t('Créez la première !', 'Create your first one!', '¡Crea la primera!')} />
        ) : (
          <div className="space-y-3">
            {campaigns.map((c) => {
              const s = STATUS_META[c.status];
              const statusLabel = s ? t(s.fr, s.en, s.es) : c.status;
              const statusTone: PillTone = s?.tone ?? 'muted';
              const openRate = c.recipients_count > 0 ? ((c.opens_count / c.recipients_count) * 100).toFixed(1) : '0';
              return (
                <OrgCard key={c.id} onClick={() => navigate(c.status === 'sent'
                  ? `/organizer-app/campaigns/${c.id}/report`
                  : `/organizer-app/campaigns/${c.id}/edit`)} className="cursor-pointer">
                  <div className="flex items-center justify-between gap-4 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <h3 className="truncate" style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{c.name}</h3>
                        <OrgPill tone="muted">{c.type === 'promotional' ? t('Marketing', 'Marketing', 'Marketing') : t('Informatif', 'Informational', 'Informativo')}</OrgPill>
                        <OrgPill tone={statusTone}>{statusLabel}</OrgPill>
                      </div>
                      <p className="truncate" style={{ color: T3, fontSize: 12.5 }}>{c.subject}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <div className="text-right">
                        <div style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{c.recipients_count} {t('destinataires', 'recipients', 'destinatarios')}</div>
                        <div style={{ color: T3, fontSize: 11.5 }}>{openRate}% {t('ouvertures', 'opens', 'aperturas')}</div>
                      </div>
                      {c.status === 'sent' && <BarChart3 className="h-4 w-4" style={{ color: T3 }} />}
                    </div>
                  </div>
                </OrgCard>
              );
            })}
          </div>
        )}
      </div>
    </OrgPage>
  );
}

export function OrgAppCampaignEditor() {
  const { user } = useAuth();
  const { profile } = useProfileType();
  if (!user?.id) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  return (
    <CampaignBuilder
      basePath="/organizer-app/campaigns"
      scope={{
        kind: 'organizer',
        organizerId: user.id,
        name: profile?.organizationName || 'Mon organisation',
        logoUrl: (profile as any)?.organizationLogoUrl || null,
        city: null,
      }}
    />
  );
}

export function OrgAppCampaignReport() {
  const { user } = useAuth();
  const { profile } = useProfileType();
  if (!user?.id) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  return (
    <CampaignReport
      basePath="/organizer-app/campaigns"
      scope={{
        kind: 'organizer',
        organizerId: user.id,
        name: profile?.organizationName || 'Mon organisation',
        logoUrl: (profile as any)?.organizationLogoUrl || null,
        city: null,
      }}
    />
  );
}
