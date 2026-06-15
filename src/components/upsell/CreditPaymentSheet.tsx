import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Wine, Sparkles, QrCode, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

interface PackCredit {
  id: string;
  total_credits: number;
  used_credits: number;
  pack_id: string;
  event_id: string | null;
  venue_id: string;
  packName?: string;
}

interface CreditPaymentSheetProps {
  open: boolean;
  onClose: () => void;
  drinkId: string;
  drinkName: string;
  eventId: string;
  eventTitle: string;
  venueId: string;
}

export function CreditPaymentSheet({
  open,
  onClose,
  drinkId,
  drinkName,
  eventId,
  eventTitle,
  venueId,
}: CreditPaymentSheetProps) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [credits, setCredits] = useState<PackCredit[]>([]);
  const [loading, setLoading] = useState(true);
  const [using, setUsing] = useState(false);

  useEffect(() => {
    if (open && user && venueId) {
      fetchCredits();
    }
  }, [open, user, venueId]);

  const fetchCredits = async () => {
    if (!user) return;
    setLoading(true);

    const { data } = await supabase
      .from('order_pack_credits')
      .select('*')
      .eq('user_id', user.id)
      .eq('venue_id', venueId)
      .order('created_at', { ascending: false });

    if (data) {
      const activeCredits = data.filter((c) => c.total_credits > c.used_credits);
      
      // Resolve names from both tables
      const packIds = [...new Set(activeCredits.map(c => c.pack_id))];
      const { data: dpNames } = await supabase
        .from('upsell_drink_packs')
        .select('id, name')
        .in('id', packIds);
      const dpMap = new Map((dpNames || []).map(d => [d.id, d.name]));
      
      const missingIds = packIds.filter(id => !dpMap.has(id));
      let tuoMap = new Map<string, string>();
      if (missingIds.length > 0) {
        const { data: tuoNames } = await supabase
          .from('ticket_upsell_offers')
          .select('id, name')
          .in('id', missingIds);
        tuoMap = new Map((tuoNames || []).map(d => [d.id, d.name]));
      }
      
      const mapped = activeCredits.map((c) => ({
        ...c,
        packName: dpMap.get(c.pack_id) || tuoMap.get(c.pack_id) || 'Pack',
      }));
      setCredits(mapped);
    }
    setLoading(false);
  };

  const handleUseCredit = async (credit: PackCredit) => {
    setUsing(true);
    try {
      const { data, error } = await supabase.functions.invoke('use-drink-credit', {
        body: { creditId: credit.id, drinkId, eventId },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed');

      toast.success(t('upsell.creditUsedSuccess') || `${drinkName} commandé avec un crédit !`);
      onClose();
      navigate(`/order/${data.orderId}/qr`);
    } catch (err: any) {
      console.error('Credit use error:', err);
      toast.error(err.message || 'Erreur');
    } finally {
      setUsing(false);
    }
  };

  const totalRemaining = credits.reduce((sum, c) => sum + (c.total_credits - c.used_credits), 0);

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[70vh]">
        <SheetHeader className="text-left mb-4">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-400" />
            {t('upsell.useCredit') || 'Utiliser un crédit'}
          </SheetTitle>
        </SheetHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : credits.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            {t('upsell.noCredits') || 'Aucun crédit disponible'}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <div className="flex items-center gap-2 mb-1">
                <Wine className="h-4 w-4 text-amber-400" />
                <span className="text-sm font-bold">{drinkName}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('upsell.creditWillBeUsed') || 'Un crédit sera utilisé pour cette boisson. Pas de paiement requis.'}
              </p>
            </div>

            <div className="space-y-2">
              {credits.map((credit) => {
                const remaining = credit.total_credits - credit.used_credits;
                return (
                  <motion.div
                    key={credit.id}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <div className="p-3 rounded-lg bg-surface border border-border/30 flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{credit.packName}</p>
                        <div className="flex items-center gap-1.5 mt-1">
                          {Array.from({ length: Math.min(credit.total_credits, 10) }).map((_, i) => (
                            <div
                              key={i}
                              className={`w-4 h-4 rounded-full flex items-center justify-center ${
                                i < credit.used_credits
                                  ? 'bg-muted'
                                  : 'bg-amber-500/20'
                              }`}
                            >
                              <Wine className={`h-2.5 w-2.5 ${i < credit.used_credits ? 'text-muted-foreground opacity-30' : 'text-amber-400'}`} />
                            </div>
                          ))}
                          <span className="text-[10px] text-muted-foreground ml-1">
                            {remaining}/{credit.total_credits}
                          </span>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        disabled={using}
                        onClick={() => handleUseCredit(credit)}
                        className="bg-amber-500 hover:bg-amber-600 text-black font-bold shrink-0"
                      >
                        {using ? '...' : t('upsell.useOneCredit') || 'Utiliser'}
                      </Button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
