import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ExternalLink, Eye } from 'lucide-react';

interface Props {
  venueId: string;
  venueSlug?: string;
  onComplete: () => void;
}

export function OnboardingStepPreview({ venueId, venueSlug, onComplete }: Props) {
  const { t } = useLanguage();
  const [acknowledged, setAcknowledged] = useState(false);

  const previewUrl = venueSlug ? `/club/${venueSlug}` : `/club/${venueId}`;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold mb-1">{t('onboarding.step8Title')}</h2>
        <p className="text-sm text-muted-foreground">{t('onboarding.step8Desc')}</p>
      </div>

      <div className="rounded-lg bg-muted/50 border border-border p-4 space-y-4">
        <h3 className="font-semibold text-sm">{t('onboarding.orderFlowTitle')}</h3>
        <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-2">
          <li>{t('onboarding.orderFlow1')}</li>
          <li>{t('onboarding.orderFlow2')}</li>
          <li>{t('onboarding.orderFlow3')}</li>
          <li>{t('onboarding.orderFlow4')}</li>
        </ol>
      </div>

      <Button variant="outline" className="w-full gap-2" onClick={() => window.open(previewUrl, '_blank')}>
        <Eye className="w-4 h-4" />
        {t('onboarding.previewAsClient')}
        <ExternalLink className="w-3 h-3" />
      </Button>

      <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/30 border border-border">
        <Checkbox
          id="ack"
          checked={acknowledged}
          onCheckedChange={(v) => setAcknowledged(v === true)}
        />
        <label htmlFor="ack" className="text-sm text-muted-foreground cursor-pointer leading-tight">
          {t('onboarding.previewAck')}
        </label>
      </div>

      <Button onClick={onComplete} disabled={!acknowledged} className="w-full">
        {t('onboarding.continue')}
      </Button>
    </div>
  );
}
