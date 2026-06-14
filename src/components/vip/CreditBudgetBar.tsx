import { Progress } from '@/components/ui/progress';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sparkles } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface CreditBudgetBarProps {
  includedBudget: number;
  cartTotal: number;
  packName?: string | null;
  zoneName?: string;
  zoneColor?: string;
}

export function CreditBudgetBar({ 
  includedBudget, 
  cartTotal, 
  packName, 
  zoneName,
  zoneColor 
}: CreditBudgetBarProps) {
  const { t } = useLanguage();
  
  const coveredByCredit = Math.min(cartTotal, includedBudget);
  const extraAmount = Math.max(0, cartTotal - includedBudget);
  const usagePercent = includedBudget > 0 ? Math.min((coveredByCredit / includedBudget) * 100, 100) : 0;
  const isFullyUsed = coveredByCredit >= includedBudget && includedBudget > 0;

  return (
    <Card className="overflow-hidden bg-gradient-to-br from-surface-elevated to-surface border-0 shadow-[var(--shadow-primary)]">
      {/* Decorative top border */}
      <div className="h-0.5 bg-gradient-to-r from-primary/60 via-primary to-primary/60" />
      
      <div className="p-4 space-y-3">
        {/* Header with pack/zone info */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <span className="font-semibold text-sm">{t('vipBudget.yourFormula')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {packName && (
              <Badge variant="secondary" className="text-[10px] bg-muted/50">
                {packName}
              </Badge>
            )}
            {zoneName && (
              <Badge 
                variant="outline" 
                style={{ borderColor: zoneColor, color: zoneColor }}
                className="text-[10px]"
              >
                {zoneName}
              </Badge>
            )}
          </div>
        </div>

        {/* Credit display */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted-foreground">{t('vipBudget.includedCredit')}</span>
            <span className={`text-xl font-bold ${isFullyUsed ? 'text-primary' : 'text-foreground'}`}>
              {includedBudget}€
            </span>
          </div>
          
          <Progress 
            value={usagePercent} 
            className="h-2 bg-muted/50"
          />
          
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{coveredByCredit}€ / {includedBudget}€ {t('vipBudget.usedLabel')}</span>
            <span className="font-medium text-foreground/70">{Math.max(0, includedBudget - coveredByCredit)}€ {t('vipBudget.remaining')}</span>
          </div>
        </div>

        {/* Cart summary */}
        {cartTotal > 0 && (
          <div className="pt-2 border-t border-border/30 flex items-center justify-between text-sm">
            <div className="flex items-center gap-3">
              <span>
                <span className="text-muted-foreground">{t('vipBudget.cart')}:</span>{' '}
                <span className="font-medium">{cartTotal}€</span>
              </span>
              {extraAmount === 0 ? (
                <Badge className="bg-emerald-500/15 text-emerald-400 border-0 text-[10px]">
                  {t('vipBudget.covered')}
                </Badge>
              ) : (
                <Badge className="bg-primary/15 text-primary border-0 text-[10px]">
                  +{extraAmount}€ {t('vipBudget.extra')}
                </Badge>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
