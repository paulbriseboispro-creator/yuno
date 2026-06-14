import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Crown, Star, Wine, Ticket, Calendar, TrendingUp, Sparkles } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { motion } from 'framer-motion';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED      = '#E8192C';
const T1       = 'rgba(255,255,255,0.96)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';

const statTile: React.CSSProperties = {
  background: INNER_BG,
  border: `1px solid ${BORDER}`,
  borderRadius: 14,
  padding: 12,
  textAlign: 'center',
};

interface TopClientInfo {
  rank: number;
  firstName: string | null;
  lastName: string | null;
  totalSpent: number;
  ticketCount: number;
  orderCount: number;
  tableCount: number;
  tier: string;
  firstVisit: string | null;
  lastVisit: string | null;
  favoriteDrinkCategory: string | null;
}

interface TopClientDialogProps {
  open: boolean;
  onClose: () => void;
  clientInfo: TopClientInfo | null;
  ticketHolderName?: string;
}

export function TopClientDialog({ open, onClose, clientInfo, ticketHolderName }: TopClientDialogProps) {
  const { t, language } = useLanguage();

  if (!clientInfo) return null;

  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'platinum': return 'bg-gradient-to-r from-gray-300 to-gray-100 text-gray-800';
      case 'gold': return 'bg-gradient-to-r from-amber-500 to-yellow-400 text-black';
      case 'silver': return 'bg-gradient-to-r from-gray-400 to-gray-300 text-gray-800';
      default: return 'bg-gradient-to-r from-amber-700 to-amber-600 text-white';
    }
  };

  const getTierLabel = (tier: string) => {
    switch (tier) {
      case 'platinum': return 'PLATINUM';
      case 'gold': return 'GOLD';
      case 'silver': return 'SILVER';
      default: return 'BRONZE';
    }
  };

  const displayName = clientInfo.firstName && clientInfo.lastName 
    ? `${clientInfo.firstName} ${clientInfo.lastName}`
    : ticketHolderName || 'Client VIP';

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md border-amber-500/50 bg-gradient-to-b from-surface to-background">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-500">
            <Crown className="h-6 w-6" />
            <span>{t('bouncer.topClientTitle')}</span>
          </DialogTitle>
        </DialogHeader>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="space-y-4"
        >
          {/* Rank Badge */}
          <div className="flex items-center justify-center">
            <div className="relative">
              <div className="absolute -inset-1 bg-gradient-to-r from-amber-500 to-yellow-400 rounded-full blur opacity-40" />
              <div className="relative flex items-center gap-2 bg-surface border border-amber-500/50 rounded-full px-6 py-3">
                <Star className="h-5 w-5 text-amber-500 fill-amber-500" />
                <span className="text-xl font-bold text-amber-500">TOP #{clientInfo.rank}</span>
              </div>
            </div>
          </div>

          {/* Client Name & Tier */}
          <div className="text-center space-y-2">
            <h3 style={{ color: T1, fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>{displayName}</h3>
            <Badge className={`${getTierColor(clientInfo.tier)} px-4 py-1 text-sm font-bold`}>
              <Sparkles className="h-4 w-4 mr-1" />
              {getTierLabel(clientInfo.tier)}
            </Badge>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div style={statTile}>
              <TrendingUp className="h-5 w-5 mx-auto mb-1" style={{ color: RED }} />
              <p className="tabular-nums" style={{ color: T1, fontSize: 18, fontWeight: 640, letterSpacing: '-0.02em' }}>{clientInfo.totalSpent.toFixed(0)}€</p>
              <p style={{ color: T3, fontSize: 12 }}>{t('bouncer.totalSpent')}</p>
            </div>
            <div style={statTile}>
              <Ticket className="h-5 w-5 mx-auto mb-1" style={{ color: RED }} />
              <p className="tabular-nums" style={{ color: T1, fontSize: 18, fontWeight: 640, letterSpacing: '-0.02em' }}>{clientInfo.ticketCount}</p>
              <p style={{ color: T3, fontSize: 12 }}>{t('bouncer.eventsAttended')}</p>
            </div>
            <div style={statTile}>
              <Wine className="h-5 w-5 mx-auto mb-1" style={{ color: RED }} />
              <p className="tabular-nums" style={{ color: T1, fontSize: 18, fontWeight: 640, letterSpacing: '-0.02em' }}>{clientInfo.orderCount}</p>
              <p style={{ color: T3, fontSize: 12 }}>{t('bouncer.ordersPlaced')}</p>
            </div>
            <div style={statTile}>
              <Calendar className="h-5 w-5 mx-auto mb-1" style={{ color: RED }} />
              <p className="tabular-nums" style={{ color: T1, fontSize: 18, fontWeight: 640, letterSpacing: '-0.02em' }}>{clientInfo.tableCount}</p>
              <p style={{ color: T3, fontSize: 12 }}>{t('bouncer.tablesReserved')}</p>
            </div>
          </div>

          {/* Favorite Drink */}
          {clientInfo.favoriteDrinkCategory && (
            <div className="text-center" style={{ background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.3)', borderRadius: 12, padding: 12 }}>
              <p style={{ color: '#FCD34D', fontSize: 13, fontWeight: 500 }}>
                {t('bouncer.favoriteDrink')}: {clientInfo.favoriteDrinkCategory}
              </p>
            </div>
          )}

          {/* Call to action */}
          <div className="text-center" style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.3)', borderRadius: 12, padding: 16 }}>
            <p className="flex items-center justify-center gap-1.5" style={{ color: RED, fontSize: 13, fontWeight: 500 }}>
              <Star className="h-4 w-4 fill-current" />
              {t('bouncer.vipServiceReminder')}
            </p>
          </div>

          <Button onClick={onClose} className="w-full" variant="default">
            {t('bouncer.understood')}
          </Button>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}
