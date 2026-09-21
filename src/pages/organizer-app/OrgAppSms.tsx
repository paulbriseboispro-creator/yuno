import { useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useActingOrganizer } from '@/hooks/useActingOrganizer';
import { useLanguage } from '@/contexts/LanguageContext';
import { OrgPage, OrgPageHeader, T3 } from '@/components/org-ui';
import SmsCampaignsPanel from '@/components/sms/SmsCampaignsPanel';
import type { SmsScope } from '@/lib/smsMarketing';

/** Campagnes SMS d'un organisateur — même moteur que le club, portée organisateur. */
export default function OrgAppSms() {
  const { organizerId, organizationName } = useActingOrganizer();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const [searchParams] = useSearchParams();

  const scope = useMemo<SmsScope | null>(
    () => (organizerId ? { kind: 'organizer', organizerUserId: organizerId, name: organizationName || t('smsc.orgDefaultSender') } : null),
    [organizerId, organizationName, t],
  );

  if (!scope) return null;

  return (
    <OrgPage className="mx-auto max-w-5xl">
      <div className="mb-4 flex items-center gap-2">
        <button onClick={() => navigate(id ? '/organizer-app/sms' : '/organizer-app')} className="inline-flex h-8 w-8 items-center justify-center rounded-lg" style={{ color: T3 }}>
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <OrgPageHeader title={t('smsCampaigns.title')} subtitle={t('smsc.orgSubtitle')} />
        </div>
      </div>
      <SmsCampaignsPanel scope={scope} basePath="/organizer-app/sms" selectedId={id ?? null} presetEventId={searchParams.get('event')} />
    </OrgPage>
  );
}
