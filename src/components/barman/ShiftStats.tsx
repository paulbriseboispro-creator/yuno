import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { ShoppingCart, CheckCircle, DollarSign } from 'lucide-react';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED      = '#E8192C';
const POS      = '#34D399';
const T1       = 'rgba(255,255,255,0.96)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';

const tile: React.CSSProperties = {
  background: INNER_BG,
  border: `1px solid ${BORDER}`,
  borderRadius: 14,
  padding: 12,
  textAlign: 'center',
};

interface ShiftStatsProps {
  venueId: string;
}

export function ShiftStats({ venueId }: ShiftStatsProps) {
  const { t } = useLanguage();
  const [stats, setStats] = useState({ served: 0, pending: 0, revenue: 0 });

  useEffect(() => {
    if (!venueId) return;

    const fetchShiftStats = async () => {
      // Get today's start (6 PM yesterday or 6 AM today as shift boundary)
      const now = new Date();
      const shiftStart = new Date();
      if (now.getHours() < 6) {
        shiftStart.setDate(shiftStart.getDate() - 1);
      }
      shiftStart.setHours(6, 0, 0, 0);

      const { data: orders } = await supabase
        .from('orders')
        .select('status, total, prep_status')
        .eq('venue_id', venueId)
        .gte('created_at', shiftStart.toISOString());

      if (orders) {
        const served = orders.filter(o => o.status === 'served').length;
        const pending = orders.filter(o => o.status === 'paid' && o.prep_status !== 'served').length;
        const revenue = orders
          .filter(o => o.status === 'served' || o.status === 'paid')
          .reduce((sum, o) => sum + Number(o.total || 0), 0);
        setStats({ served, pending, revenue });
      }
    };

    fetchShiftStats();

    // Refresh every 30 seconds
    const interval = setInterval(fetchShiftStats, 30_000);
    return () => clearInterval(interval);
  }, [venueId]);

  if (!venueId) return null;

  return (
    <div className="grid grid-cols-3 gap-2 mb-4">
      <div style={tile}>
        <CheckCircle className="h-4 w-4 mx-auto mb-1" style={{ color: POS }} />
        <p className="tabular-nums" style={{ color: T1, fontSize: 18, fontWeight: 640, letterSpacing: '-0.02em' }}>{stats.served}</p>
        <p className="leading-tight" style={{ color: T3, fontSize: 10 }}>{t('barman.shiftServed')}</p>
      </div>
      <div style={tile}>
        <ShoppingCart className="h-4 w-4 mx-auto mb-1" style={{ color: '#FCD34D' }} />
        <p className="tabular-nums" style={{ color: T1, fontSize: 18, fontWeight: 640, letterSpacing: '-0.02em' }}>{stats.pending}</p>
        <p className="leading-tight" style={{ color: T3, fontSize: 10 }}>{t('barman.shiftPending')}</p>
      </div>
      <div style={tile}>
        <DollarSign className="h-4 w-4 mx-auto mb-1" style={{ color: RED }} />
        <p className="tabular-nums" style={{ color: T1, fontSize: 18, fontWeight: 640, letterSpacing: '-0.02em' }}>{stats.revenue.toFixed(0)}€</p>
        <p className="leading-tight" style={{ color: T3, fontSize: 10 }}>{t('barman.shiftRevenue')}</p>
      </div>
    </div>
  );
}
