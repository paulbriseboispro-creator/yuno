import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Minus, Plus } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { OrderItem } from './myorders-types';

interface EditOrderDialogProps {
  open: boolean;
  items: OrderItem[];
  onClose: () => void;
  onUpdateQty: (id: string, delta: number) => void;
  onSave: () => void;
}

// Drink-order quantity editor dialog (from MyOrders).
export function EditOrderDialog({ open, items, onClose, onUpdateQty, onSave }: EditOrderDialogProps) {
  const { t } = useLanguage();
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('orders.editOrder')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('orders.editOrder')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {items.map((item, idx) => (
            <div key={idx} className="flex items-center justify-between p-3 bg-background rounded-lg">
              <div className="flex-1">
                <p className="font-medium">{item.name}</p>
                <p className="text-sm text-muted-foreground">{item.unitPrice.toFixed(2)}€</p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="icon" variant="outline" onClick={() => onUpdateQty(item.id, -1)} disabled={item.qty <= 1}>
                  <Minus className="h-4 w-4" />
                </Button>
                <span className="w-8 text-center font-semibold">{item.qty}</span>
                <Button size="icon" variant="outline" onClick={() => onUpdateQty(item.id, 1)}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <div className="ml-4 text-right min-w-[60px]">
                <p className="font-bold">{(item.qty * item.unitPrice).toFixed(2)}€</p>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between pt-3 border-t">
          <span className="font-semibold">{t('orders.total')}</span>
          <span className="text-2xl font-bold text-accent">
            {items.reduce((sum, item) => sum + (item.qty * item.unitPrice), 0).toFixed(2)}€
          </span>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={onSave}>{t('common.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
