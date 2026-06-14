import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { Search, Eye, Copy, CheckCircle, Wine, ArrowUpRight, TrendingUp, ChevronDown } from 'lucide-react';
import { Order, OrderStatus } from '@/types';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED     = '#E8192C';
const POS     = '#34D399';
const T1      = 'rgba(255,255,255,0.96)';
const T2      = 'rgba(255,255,255,0.58)';
const T3      = 'rgba(255,255,255,0.36)';
const C_FAINT = 'rgba(255,255,255,0.06)';
const BORDER  = 'rgba(255,255,255,0.085)';
const F_BORDER= 'rgba(255,255,255,0.055)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const INNER_BG = 'rgba(255,255,255,0.032)';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  paid:      { bg: 'rgba(52,211,153,0.12)',  color: POS,           label: 'Payé' },
  served:    { bg: 'rgba(99,102,241,0.12)',  color: '#818CF8',     label: 'Servi' },
  refunded:  { bg: 'rgba(232,25,44,0.12)',   color: '#FF5C63',     label: 'Remboursé' },
  cancelled: { bg: 'rgba(232,25,44,0.12)',   color: '#FF5C63',     label: 'Annulé' },
  pending:   { bg: 'rgba(255,255,255,0.06)', color: T2,            label: 'En attente' },
};

interface OwnerDrinkOrdersProps {
  venueId?: string;
  eventId?: string;
}

function DarkSelect({ value, onChange, options }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const current = options.find(o => o.value === value)?.label ?? '';
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="appearance-none pr-8 pl-3 py-2 rounded-lg text-[13px] cursor-pointer w-full"
        style={{
          background: INNER_BG,
          border: `1px solid ${BORDER}`,
          color: T1,
          outline: 'none',
        }}
      >
        {options.map(o => (
          <option key={o.value} value={o.value} style={{ background: '#0a0a0c' }}>{o.label}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: T3 }} />
    </div>
  );
}

export function OwnerDrinkOrders({ venueId, eventId }: OwnerDrinkOrdersProps) {
  const { t, language } = useLanguage();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);
  const [sortBy, setSortBy] = useState<'date' | 'price'>('date');
  const [drinkFilter, setDrinkFilter] = useState('all');

  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  useEffect(() => {
    if (!venueId && !eventId) return;
    fetchOrders();
  }, [venueId, eventId]);

  const fetchOrders = async () => {
    try {
      let query = supabase
        .from('orders')
        .select('*')
        .in('status', ['paid', 'served'])
        .order('created_at', { ascending: false });
      if (eventId) query = query.eq('event_id', eventId);
      else if (venueId) query = query.eq('venue_id', venueId);
      const { data, error } = await query;
      if (error) throw error;
      const mappedOrders: Order[] = (data || []).map((order) => ({
        id: order.id,
        userEmail: order.user_email || undefined,
        venueId: order.venue_id,
        items: order.items as any,
        total: Number(order.total),
        status: order.status as 'pending' | 'paid' | 'served',
        createdAt: order.created_at,
        paidAt: order.paid_at || undefined,
        servedAt: order.served_at || undefined,
        token: order.token || undefined,
        tokenUsed: order.token_used || undefined,
        tokenExpiresAt: order.token_expires_at || undefined,
      }));
      setOrders(mappedOrders);
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const uniqueDrinks = Array.from(new Set(orders.flatMap((o) => o.items.map((item) => item.name))));

  const filteredOrders = orders
    .filter((o) => statusFilter === 'all' || o.status === statusFilter)
    .filter((o) => !searchQuery || o.userEmail?.toLowerCase().includes(searchQuery.toLowerCase()) || o.token?.toLowerCase().includes(searchQuery.toLowerCase()))
    .filter((o) => drinkFilter === 'all' || o.items.some((item) => item.name === drinkFilter))
    .sort((a, b) => sortBy === 'date'
      ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      : b.total - a.total
    );

  const totalRevenue = filteredOrders.reduce((s, o) => s + o.total, 0);
  const avgOrder = filteredOrders.length ? totalRevenue / filteredOrders.length : 0;

  const copyToken = (token: string) => {
    navigator.clipboard.writeText(token);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  return (
    <>
      {/* Stats strip */}
      <div
        style={{
          background: CARD_BG,
          border: `1px solid ${BORDER}`,
          borderRadius: 18,
          boxShadow: CARD_SHADOW,
          padding: '16px 22px',
          marginBottom: 16,
          overflow: 'hidden',
        }}
      >
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Commandes', value: filteredOrders.length.toString(), icon: Wine },
            { label: 'Revenu total', value: `€${totalRevenue.toFixed(0)}`, icon: TrendingUp },
            { label: 'Panier moyen', value: `€${avgOrder.toFixed(0)}`, icon: ArrowUpRight },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="text-center">
              <div style={{ color: T3, fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
              <div style={{ color: T1, fontSize: 22, fontWeight: 640, letterSpacing: '-0.02em' }} className="tabular-nums leading-none">{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div
        style={{
          background: CARD_BG,
          border: `1px solid ${BORDER}`,
          borderRadius: 18,
          boxShadow: CARD_SHADOW,
          padding: '16px 20px',
          marginBottom: 16,
        }}
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: T3 }} />
            <input
              placeholder={t('owner.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg text-[13px]"
              style={{
                background: INNER_BG,
                border: `1px solid ${BORDER}`,
                color: T1,
                outline: 'none',
              }}
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <DarkSelect
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: 'all', label: t('owner.allStatuses') },
                { value: 'paid', label: t('owner.paid') },
                { value: 'served', label: t('owner.served') },
              ]}
            />
            <DarkSelect
              value={sortBy}
              onChange={(v) => setSortBy(v as 'date' | 'price')}
              options={[
                { value: 'date', label: t('owner.sortByDate') },
                { value: 'price', label: t('owner.sortByPrice') },
              ]}
            />
            <DarkSelect
              value={drinkFilter}
              onChange={setDrinkFilter}
              options={[
                { value: 'all', label: t('owner.allDrinks') },
                ...uniqueDrinks.map(d => ({ value: d, label: d })),
              ]}
            />
          </div>
        </div>
      </div>

      {/* Orders table */}
      <div
        style={{
          background: CARD_BG,
          border: `1px solid ${BORDER}`,
          borderRadius: 18,
          boxShadow: CARD_SHADOW,
          overflow: 'hidden',
        }}
      >
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-2" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="text-center py-16 px-4">
            <Wine className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.12)' }} />
            <p style={{ color: T3, fontSize: 13 }}>{t('owner.noOrders')}</p>
          </div>
        ) : (
          <div>
            {/* Table header */}
            <div className="grid items-center px-5 py-3" style={{ gridTemplateColumns: '1fr 90px 80px 100px 40px', borderBottom: `1px solid ${F_BORDER}` }}>
              {['Client', 'Articles', 'Total', 'Statut', ''].map((h) => (
                <span key={h} style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{h}</span>
              ))}
            </div>
            {filteredOrders.map((order, i) => {
              const st = STATUS_STYLE[order.status] ?? STATUS_STYLE.pending;
              return (
                <motion.div
                  key={order.id}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.025 }}
                  className="grid items-center px-5 py-3.5 cursor-pointer transition-colors duration-150"
                  style={{ gridTemplateColumns: '1fr 90px 80px 100px 40px', borderBottom: i < filteredOrders.length - 1 ? `1px solid ${F_BORDER}` : 'none' }}
                  onClick={() => setSelectedOrder(order)}
                >
                  <div className="min-w-0">
                    <div style={{ color: T1, fontSize: 13, fontWeight: 560 }} className="truncate">
                      {order.userEmail ?? '—'}
                    </div>
                    <div style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>
                      {format(new Date(order.createdAt), 'dd/MM HH:mm', { locale: dateLocale })}
                    </div>
                  </div>
                  <span style={{ color: T2, fontSize: 13 }} className="tabular-nums">
                    {order.items.length} article{order.items.length > 1 ? 's' : ''}
                  </span>
                  <span style={{ color: T1, fontSize: 14, fontWeight: 620, letterSpacing: '-0.01em' }} className="tabular-nums">
                    €{order.total.toFixed(2)}
                  </span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: st.bg, color: st.color }}>
                    {st.label}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setSelectedOrder(order); }}
                    className="w-8 h-8 flex items-center justify-center rounded-lg cursor-pointer transition-all duration-150"
                    style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* Order Detail Dialog */}
      <Dialog open={!!selectedOrder} onOpenChange={() => setSelectedOrder(null)}>
        <DialogContent className="border-0 p-0 overflow-hidden" style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 18, maxWidth: 440 }}>
          <DialogHeader className="px-6 pt-6 pb-0">
            <DialogTitle style={{ color: T1, fontSize: 15.5, fontWeight: 600 }}>{t('owner.orderDetails')}</DialogTitle>
            <DialogDescription className="sr-only">{t('owner.orderDetails')}</DialogDescription>
          </DialogHeader>
          {selectedOrder && (
            <div className="p-6 space-y-4">
              {/* Status + Total */}
              <div className="flex items-center justify-between p-4 rounded-xl" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[12px] font-semibold"
                  style={{ background: STATUS_STYLE[selectedOrder.status]?.bg ?? C_FAINT, color: STATUS_STYLE[selectedOrder.status]?.color ?? T2 }}>
                  {STATUS_STYLE[selectedOrder.status]?.label ?? selectedOrder.status}
                </span>
                <span style={{ color: T1, fontSize: 24, fontWeight: 640, letterSpacing: '-0.02em' }} className="tabular-nums">
                  €{selectedOrder.total.toFixed(2)}
                </span>
              </div>

              {/* Dates */}
              <div className="space-y-1.5" style={{ padding: '0 4px' }}>
                <p style={{ color: T3, fontSize: 12 }}>{t('owner.createdOn')} {format(new Date(selectedOrder.createdAt), 'dd/MM/yyyy à HH:mm', { locale: dateLocale })}</p>
                {selectedOrder.paidAt && <p style={{ color: T3, fontSize: 12 }}>{t('owner.paidOn')} {format(new Date(selectedOrder.paidAt), 'dd/MM/yyyy à HH:mm', { locale: dateLocale })}</p>}
                {selectedOrder.servedAt && <p style={{ color: T3, fontSize: 12 }}>{t('owner.servedOn')} {format(new Date(selectedOrder.servedAt), 'dd/MM/yyyy à HH:mm', { locale: dateLocale })}</p>}
              </div>

              {/* Token */}
              {selectedOrder.token && (
                <div className="p-3 rounded-xl" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                  <p style={{ color: T3, fontSize: 11, marginBottom: 6 }}>{t('owner.token')}</p>
                  <div className="flex items-center gap-2">
                    <code style={{ color: T2, fontSize: 11 }} className="flex-1 overflow-hidden text-ellipsis">{selectedOrder.token}</code>
                    <button
                      onClick={() => copyToken(selectedOrder.token!)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg cursor-pointer transition-all duration-150"
                      style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}
                    >
                      {copiedToken ? <CheckCircle className="w-3.5 h-3.5" style={{ color: POS }} /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <p style={{ color: T3, fontSize: 11, marginTop: 4 }}>{t('owner.pin')}: {selectedOrder.token.slice(-4).toUpperCase()}</p>
                </div>
              )}

              {/* Items */}
              <div>
                <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8 }}>{t('owner.items')}</p>
                <div className="space-y-1.5">
                  {selectedOrder.items.map((item) => (
                    <div key={item.drinkId} className="flex justify-between items-center px-3 py-2.5 rounded-xl" style={{ background: INNER_BG }}>
                      <span style={{ color: T1, fontSize: 13 }}>{item.qty}× {item.name}</span>
                      <span style={{ color: T1, fontSize: 13, fontWeight: 620 }} className="tabular-nums">€{(item.unitPrice * item.qty).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
