import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Wine } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';

interface PackCredit {
  id: string;
  total_credits: number;
  used_credits: number;
  pack_id: string;
  event_id: string | null;
  expires_at: string | null;
  venue_id: string;
  packName?: string;
}

interface DrinkCreditsCardProps {
  venueId?: string;
  ticketId?: string;
  compact?: boolean;
}

export function DrinkCreditsCard({ venueId, ticketId, compact = false }: DrinkCreditsCardProps) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [credits, setCredits] = useState<PackCredit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    fetchCredits();
  }, [user, venueId, ticketId]);

  const fetchCredits = async () => {
    if (!user) return;

    let query = supabase
      .from('order_pack_credits')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (venueId) query = query.eq('venue_id', venueId);
    if (ticketId) query = query.eq('ticket_order_id', ticketId);

    const { data } = await query;

    if (data) {
      const now = new Date().toISOString();
      // Show all credits for active events (not yet expired), including fully used ones
      const activeCredits = data.filter(c => (!c.expires_at || c.expires_at > now));
      
      const mapped = activeCredits.map(c => ({
        ...c,
        packName: 'Crédit Conso',
      }));
      setCredits(mapped);
    }
    setLoading(false);
  };

  if (loading || credits.length === 0) return null;

  const totalRemaining = credits.reduce((sum, c) => sum + (c.total_credits - c.used_credits), 0);

  // Hide the entire card when no credits remain
  if (totalRemaining <= 0) return null;
  const totalAll = credits.reduce((sum, c) => sum + c.total_credits, 0);
  const totalUsed = credits.reduce((sum, c) => sum + c.used_credits, 0);

  if (compact) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20"
      >
        <Wine className="h-4 w-4 text-amber-400" />
        <span className="text-sm font-medium">
          {t('upsell.creditsAvailable').replace('{count}', String(totalRemaining))}
        </span>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <Card className="overflow-hidden border-border/40 bg-card">
        <div className="p-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Wine className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">{t('upsell.yourDrinkCredits')}</h3>
            </div>
            <Badge variant="secondary" className="text-xs font-bold">
              {totalRemaining} / {totalAll}
            </Badge>
          </div>

          {/* Single unified row */}
          <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Crédit Conso</span>
              <span className="text-xs text-muted-foreground">
                {totalUsed}/{totalAll} utilisées
              </span>
            </div>

            {/* Visual dots */}
            <div className="flex gap-1.5 flex-wrap">
              {Array.from({ length: totalAll }).map((_, i) => (
                <div
                  key={i}
                  className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                    i < totalUsed
                      ? 'bg-muted/50 text-muted-foreground'
                      : 'bg-amber-500/20 text-amber-400'
                  }`}
                >
                  <Wine className={`h-3 w-3 ${i < totalUsed ? 'opacity-30' : ''}`} />
                </div>
              ))}
            </div>
          </div>

          {/* Usage instructions */}
          <div className="mt-3 space-y-1">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Utilisation</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Rendez-vous sur la page du club lié à vos crédits, choisissez votre boisson et validez avec votre crédit. Présentez ensuite le QR de commande au bar.
            </p>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
