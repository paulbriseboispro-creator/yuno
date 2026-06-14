import { Lock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card } from '@/components/ui/card';
import { ReactNode } from 'react';

interface Props {
  planName?: string;
  children?: ReactNode;
}

export function AnalyticsLockedOverlay({ planName = 'Pro', children }: Props) {
  const { t } = useLanguage();

  return (
    <Card className="glass-card p-8 rounded-2xl relative overflow-hidden">
      <div className="absolute inset-0 bg-background/60 backdrop-blur-md z-10 flex flex-col items-center justify-center">
        <div className="bg-muted/30 p-4 rounded-2xl border border-border/30 mb-4">
          <Lock className="h-8 w-8 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-muted-foreground mb-1">{t('plan.advancedAnalyticsLocked')}</p>
        <Link to="/owner/billing" className="text-xs text-primary hover:underline">
          {t('plan.upgradeTo')} {planName}
        </Link>
      </div>
      <div className="opacity-20">
        {children || (
          <div className="space-y-4">
            <div className="h-[300px] bg-muted/10 rounded-xl" />
            <div className="grid grid-cols-2 gap-4">
              <div className="h-[200px] bg-muted/10 rounded-xl" />
              <div className="h-[200px] bg-muted/10 rounded-xl" />
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
