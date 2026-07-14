import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CheckCircle2, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Order } from '@/types';

interface OrderPreparationViewProps {
  order: Order;
  onComplete: () => void;
  onCancel: () => void;
}

export function OrderPreparationView({ order, onComplete, onCancel }: OrderPreparationViewProps) {
  const { t } = useLanguage();
  const pin = order.token?.slice(-4).toUpperCase();

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-background flex flex-col"
    >
      {/* Header — full-screen view: pays the notch itself (no ProShellChrome) */}
      <div
        className="border-b border-border/40 bg-surface/80 backdrop-blur-md px-4 pb-3 md:pb-4"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
      >
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          <h1 className="min-w-0 flex-1 truncate text-xl md:text-2xl font-bold">{t('clickCollect.preparing')}</h1>
          <Button
            variant="ghost"
            size="icon"
            onClick={onCancel}
            className="h-11 w-11 shrink-0 sm:h-10 sm:w-10"
          >
            <X className="h-6 w-6" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="max-w-4xl mx-auto space-y-4 md:space-y-6">
          {/* PIN Display */}
          <Card className="border-0 bg-gradient-to-br from-primary to-primary-hover p-6 md:p-8 text-center shadow-primary">
            <p className="text-sm text-primary-foreground/80 mb-2">PIN</p>
            <p className="text-5xl md:text-6xl font-bold tracking-wider text-primary-foreground mb-2">
              {pin}
            </p>
            {order.items[0]?.eventTitle && (
              <p className="truncate text-base md:text-lg text-primary-foreground/90">{order.items[0].eventTitle}</p>
            )}
          </Card>

          {/* Items List */}
          <Card className="border-0 bg-surface p-4 md:p-8 shadow-soft">
            <h2 className="text-lg md:text-2xl font-semibold mb-4 md:mb-6">{t('clickCollect.orderItems')}</h2>
            <div className="space-y-3 md:space-y-4">
              {order.items.map((item, index) => {
                const qty = item.qty || (item as any).quantity || 1;
                const name = item.name || 'Unknown';
                const unitPrice = item.unitPrice || (item as any).price || 0;
                return (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="flex items-center justify-between gap-3 p-3 md:p-4 rounded-lg bg-background border border-border/40"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3 md:gap-4">
                    <div className="flex shrink-0 items-center justify-center h-11 w-11 md:h-12 md:w-12 rounded-full bg-primary/10 text-primary font-bold text-lg md:text-xl">
                      {qty}
                    </div>
                    <span className="truncate text-base md:text-xl font-medium">{name}</span>
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-lg md:text-xl font-semibold text-accent">
                    {(unitPrice * qty).toFixed(2)}€
                  </span>
                </motion.div>
                );
              })}
            </div>

            <div className="mt-4 pt-4 md:mt-6 md:pt-6 border-t border-border/40">
              <div className="flex justify-between items-center gap-3">
                <span className="min-w-0 truncate text-xl md:text-2xl font-bold">{t('orderDetails.total')}</span>
                <span className="shrink-0 whitespace-nowrap text-2xl md:text-3xl font-bold text-accent">{order.total.toFixed(2)}€</span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Footer with Complete Button — pads the home indicator on iOS */}
      <div
        className="border-t border-border/40 bg-surface/80 backdrop-blur-md px-4 pt-4 md:px-6 md:pt-6"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}
      >
        <div className="max-w-4xl mx-auto">
          <Button
            onClick={onComplete}
            className="w-full h-16 text-lg md:text-xl font-semibold bg-green-600 hover:bg-green-700 text-white rounded-2xl shadow-lg"
          >
            <CheckCircle2 className="mr-2 md:mr-3 h-6 w-6 md:h-8 md:w-8 shrink-0" />
            <span className="truncate">{t('clickCollect.markAsReady')}</span>
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
