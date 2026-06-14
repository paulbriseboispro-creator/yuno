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
      {/* Header */}
      <div className="border-b border-border/40 bg-surface/80 backdrop-blur-md p-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <h1 className="text-2xl font-bold">{t('clickCollect.preparing')}</h1>
          <Button
            variant="ghost"
            size="icon"
            onClick={onCancel}
            className="h-10 w-10"
          >
            <X className="h-6 w-6" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* PIN Display */}
          <Card className="border-0 bg-gradient-to-br from-primary to-primary-hover p-8 text-center shadow-primary">
            <p className="text-sm text-primary-foreground/80 mb-2">PIN</p>
            <p className="text-6xl font-bold tracking-wider text-primary-foreground mb-2">
              {pin}
            </p>
            {order.items[0]?.eventTitle && (
              <p className="text-lg text-primary-foreground/90">{order.items[0].eventTitle}</p>
            )}
          </Card>

          {/* Items List */}
          <Card className="border-0 bg-surface p-8 shadow-soft">
            <h2 className="text-2xl font-semibold mb-6">{t('clickCollect.orderItems')}</h2>
            <div className="space-y-4">
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
                  className="flex items-center justify-between p-4 rounded-lg bg-background border border-border/40"
                >
                  <div className="flex items-center gap-4">
                    <div className="flex items-center justify-center h-12 w-12 rounded-full bg-primary/10 text-primary font-bold text-xl">
                      {qty}
                    </div>
                    <span className="text-xl font-medium">{name}</span>
                  </div>
                  <span className="text-xl font-semibold text-accent">
                    {(unitPrice * qty).toFixed(2)}€
                  </span>
                </motion.div>
                );
              })}
            </div>

            <div className="mt-6 pt-6 border-t border-border/40">
              <div className="flex justify-between items-center">
                <span className="text-2xl font-bold">{t('orderDetails.total')}</span>
                <span className="text-3xl font-bold text-accent">{order.total.toFixed(2)}€</span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Footer with Complete Button */}
      <div className="border-t border-border/40 bg-surface/80 backdrop-blur-md p-6">
        <div className="max-w-4xl mx-auto">
          <Button
            onClick={onComplete}
            className="w-full h-16 text-xl font-semibold bg-green-600 hover:bg-green-700 text-white rounded-2xl shadow-lg"
          >
            <CheckCircle2 className="mr-3 h-8 w-8" />
            {t('clickCollect.markAsReady')}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
