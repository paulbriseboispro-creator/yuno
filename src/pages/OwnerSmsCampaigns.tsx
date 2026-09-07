import { useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { OwnerHeader } from '@/components/OwnerHeader';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import SmsCampaignsPanel from '@/components/sms/SmsCampaignsPanel';
import { useVenueContext } from '@/hooks/useVenueContext';
import { useLanguage } from '@/contexts/LanguageContext';
import type { SmsScope } from '@/lib/smsMarketing';

/** Campagnes SMS du club — même moteur que l'organisateur (SmsCampaignsPanel). */
export default function OwnerSmsCampaigns() {
  const { venueId, venue, loading } = useVenueContext();
  const { t } = useLanguage();
  const { id } = useParams<{ id?: string }>();
  const [searchParams] = useSearchParams();

  const scope = useMemo<SmsScope | null>(
    () => (venueId ? { kind: 'venue', venueId, name: venue?.name ?? t('smsCampaigns.previewSender') } : null),
    [venueId, venue?.name, t],
  );

  if (loading || !scope) return <OwnerPageSkeleton />;

  return (
    <div className="min-h-screen bg-background pb-20">
      <OwnerHeader title={t('smsCampaigns.title')} backTo={id ? '/owner/sms-campaigns' : undefined} />
      <div className="mx-auto max-w-5xl px-4 py-6">
        <SmsCampaignsPanel scope={scope} basePath="/owner/sms-campaigns" selectedId={id ?? null} presetEventId={searchParams.get('event')} />
      </div>
    </div>
  );
}
