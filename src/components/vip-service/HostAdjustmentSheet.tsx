import { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { adjustmentArgs, type PlacementAdjustment } from '@/lib/vipTableRules';
import type { PlacementArgs } from '@/lib/vipTableApi';

interface Props {
  open: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (adjustment: NonNullable<PlacementArgs['adjustment']>) => void;
}

/**
 * Table d'une autre formule (le serveur a répondu YU005) : « Surclassement offert » ou « Différence à régler sur place ».
 * Même règle que la feuille de la Console ; l'hôte n'a pas les prix des formules sous la main, il saisit le montant.
 */
export function HostAdjustmentSheet({ open, busy, onCancel, onConfirm }: Props) {
  const { t } = useLanguage();
  const [choice, setChoice] = useState<PlacementAdjustment | null>(null);
  const [amount, setAmount] = useState('');
  useEffect(() => { if (!open) { setChoice(null); setAmount(''); } }, [open]);

  const adj = adjustmentArgs(choice, parseFloat(amount.replace(',', '.')) || 0);
  const valid = !!adj && (choice !== 'pay_on_site' || (parseFloat(amount.replace(',', '.')) || 0) > 0);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && !busy && onCancel()}>
      <SheetContent side="bottom" className="rounded-t-3xl">
        <SheetHeader className="pb-3">
          <SheetTitle className="text-base">{t('tblg.adj.title')}</SheetTitle>
          <p className="text-sm text-muted-foreground">{t('tblg.hostAdj.intro')}</p>
        </SheetHeader>
        <div className="space-y-3 pb-4">
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input type="radio" name="host-adj" checked={choice === 'upgrade_free'} onChange={() => setChoice('upgrade_free')} className="mt-1" />
            <span>{t('tblg.adj.upgradeFreeOption')}</span>
          </label>
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input type="radio" name="host-adj" checked={choice === 'pay_on_site'} onChange={() => setChoice('pay_on_site')} className="mt-1" />
            <span>{t('tblg.hostAdj.payOnSiteOption')}</span>
          </label>
          {choice === 'pay_on_site' && (
            <div className="flex items-center gap-2 pl-6">
              <Input
                type="number" min="0" step="1" inputMode="decimal" value={amount}
                onChange={(e) => setAmount(e.target.value)} className="h-9 w-28 text-right"
                aria-label={t('tblg.adj.amountLabel')}
              />
              <span className="text-sm">€</span>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">{t('tblg.adj.noOnlineCharge')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1 h-12" disabled={busy} onClick={onCancel}>{t('tblg.hostAdj.cancel')}</Button>
          <Button className="flex-1 h-12 font-semibold" disabled={!valid || busy} onClick={() => adj && onConfirm(adj)}>
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : t('tblg.hostAdj.confirm')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
