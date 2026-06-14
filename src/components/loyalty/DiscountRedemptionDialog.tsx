import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Check, Loader2, Percent, Tag, ShoppingCart, Ticket, Wine } from 'lucide-react';
import { motion } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';

interface DiscountRedemptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rewardName: string;
  rewardId: string;
  pointsRequired: number;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  maxCartValue?: number;
  appliesTo?: 'drinks' | 'tickets' | 'all';
  onConfirm: () => Promise<void>;
}

export function DiscountRedemptionDialog({
  open,
  onOpenChange,
  rewardName,
  rewardId,
  pointsRequired,
  discountType,
  discountValue,
  maxCartValue,
  appliesTo = 'all',
  onConfirm
}: DiscountRedemptionDialogProps) {
  const { t } = useLanguage();
  const [confirming, setConfirming] = useState(false);

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (error) {
      console.error('Error confirming redemption:', error);
    } finally {
      setConfirming(false);
    }
  };

  const getAppliesToIcon = () => {
    switch (appliesTo) {
      case 'drinks': return Wine;
      case 'tickets': return Ticket;
      default: return ShoppingCart;
    }
  };

  const getAppliesToLabel = () => {
    switch (appliesTo) {
      case 'drinks': return t('discountRedeem.drinks');
      case 'tickets': return t('discountRedeem.tickets');
      default: return t('discountRedeem.all');
    }
  };

  const AppliesToIcon = getAppliesToIcon();

  const formatDiscount = () => {
    if (discountType === 'percentage') {
      return `${discountValue}%`;
    }
    return `${discountValue}€`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5 text-primary" />
            {t('discountRedeem.title')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-4">
          <div className="text-center">
            <p className="text-sm text-muted-foreground">{rewardName}</p>
            <div className="flex items-center justify-center gap-2 mt-1">
              <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                {pointsRequired} {t('discountRedeem.points')}
              </span>
            </div>
          </div>

          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="p-6 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30 text-center"
          >
            <div className="h-16 w-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-3">
              <Percent className="h-8 w-8 text-primary" />
            </div>
            <p className="text-4xl font-bold text-primary">{formatDiscount()}</p>
            <p className="text-sm text-muted-foreground mt-1">{t('discountRedeem.off')}</p>
          </motion.div>

          <div className="space-y-3">
            {maxCartValue && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t('discountRedeem.maxCart')}</span>
                <span className="font-medium">{maxCartValue}€</span>
              </div>
            )}
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t('discountRedeem.appliesTo')}</span>
              <span className="font-medium flex items-center gap-1.5">
                <AppliesToIcon className="h-4 w-4" />
                {getAppliesToLabel()}
              </span>
            </div>
          </div>

          <div className="bg-muted/50 rounded-xl p-4">
            <p className="text-sm font-medium mb-3">{t('discountRedeem.howItWorks')}</p>
            <div className="space-y-2">
              {['step1', 'step2', 'step3'].map((step, i) => (
                <div key={step} className="flex items-start gap-2">
                  <div className="h-5 w-5 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center shrink-0 mt-0.5">
                    {i + 1}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t(`discountRedeem.${step}`)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="text-center py-2">
            <p className="text-2xl font-bold text-primary">-{pointsRequired}</p>
            <p className="text-sm text-muted-foreground">{t('discountRedeem.points')}</p>
          </div>
        </div>

        <div className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => onOpenChange(false)}
          >
            {t('discountRedeem.cancel')}
          </Button>
          <Button
            className="flex-1"
            disabled={confirming}
            onClick={handleConfirm}
          >
            {confirming ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Check className="h-4 w-4 mr-2" />
            )}
            {t('discountRedeem.activate')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}