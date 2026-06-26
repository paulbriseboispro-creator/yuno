import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { Search, Eye, Crown, Users, ChevronDown } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { tableRevenue } from '@/utils/fees';

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

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  paid:      { bg: 'rgba(52,211,153,0.12)',  color: POS },
  confirmed: { bg: 'rgba(52,211,153,0.12)',  color: POS },
  cancelled: { bg: 'rgba(232,25,44,0.12)',   color: '#FF5C63' },
  refunded:  { bg: 'rgba(232,25,44,0.12)',   color: '#FF5C63' },
  pending:   { bg: 'rgba(255,255,255,0.06)', color: T2 },
};

const STATUS_KEY: Record<string, string> = {
  paid: 'owner.paid',
  confirmed: 'owner.confirmed',
  cancelled: 'owner.cancelled',
  refunded: 'owner.refunded',
  pending: 'orders.status.pending',
};

interface VipOrder {
  id: string;
  userEmail: string;
  fullName: string | null;
  phone: string | null;
  guestCount: number | null;
  deposit: number | null;
  totalPrice: number;
  serviceFee: number;
  managementFee: number | null;
  minimumSpend: number | null;
  status: string;
  vipStatus: string | null;
  createdAt: string;
  paidAt: string | null;
  eventTitle: string;
  eventStartAt: string;
  zoneName: string | null;
}

interface OwnerVipOrdersProps {
  venueId?: string;
  eventId?: string;
  /** Aggregate reservations across a set of events (organizer scope — no single venue). */
  eventIds?: string[];
  /** When set, auto-open the detail dialog for this reservation id (notification deep-link). */
  focusOrderId?: string;
}

function DarkSelect({ value, onChange, options }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="appearance-none pr-8 pl-3 py-2 rounded-lg text-[13px] cursor-pointer w-full"
        style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, outline: 'none' }}
      >
        {options.map(o => (
          <option key={o.value} value={o.value} style={{ background: '#0a0a0c' }}>{o.label}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: T3 }} />
    </div>
  );
}

export function OwnerVipOrders({ venueId, eventId, eventIds, focusOrderId }: OwnerVipOrdersProps) {
  const { t, language } = useLanguage();
  // `eventIds` defined (even empty) means organizer scope: filter by this event set.
  const orgScope = eventIds !== undefined;
  const [reservations, setReservations] = useState<VipOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedReservation, setSelectedReservation] = useState<VipOrder | null>(null);
  const [sortBy, setSortBy] = useState<'date' | 'price'>('date');

  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const statusLabel = (s: string) => t(STATUS_KEY[s] ?? 'orders.status.pending');

  useEffect(() => {
    if (!venueId && !eventId && !orgScope) return;
    fetchReservations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId, eventId, eventIds?.join(',')]);

  // Notification deep-link: open the matching reservation's detail dialog once it loads.
  const lastFocusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusOrderId || lastFocusRef.current === focusOrderId) return;
    const match = reservations.find((r) => r.id === focusOrderId);
    if (match) { setSelectedReservation(match); lastFocusRef.current = focusOrderId; }
  }, [focusOrderId, reservations]);

  const fetchReservations = async () => {
    try {
      // Organizer with no events yet → nothing to show (avoids an unfiltered query).
      if (orgScope && eventIds!.length === 0) { setReservations([]); return; }
      let query = supabase
        .from('table_reservations')
        .select(`*, events!inner(title, start_at, venue_id), table_zones(name)`)
        .in('status', ['paid', 'confirmed', 'cancelled', 'refunded'])
        .order('created_at', { ascending: false });
      if (eventId) query = query.eq('event_id', eventId);
      else if (orgScope) query = query.in('event_id', eventIds!);
      else if (venueId) query = query.eq('events.venue_id', venueId);
      const { data, error } = await query;
      if (error) throw error;
      const mapped: VipOrder[] = (data || []).map((r: any) => ({
        id: r.id,
        userEmail: r.user_email,
        fullName: r.full_name,
        phone: r.phone,
        guestCount: r.guest_count,
        deposit: r.deposit,
        totalPrice: r.total_price,
        serviceFee: r.service_fee,
        managementFee: r.management_fee,
        minimumSpend: r.minimum_spend,
        status: r.status,
        vipStatus: r.vip_status,
        createdAt: r.created_at,
        paidAt: r.paid_at,
        eventTitle: r.events.title,
        eventStartAt: r.events.start_at,
        zoneName: r.table_zones?.name || null,
      }));
      setReservations(mapped);
    } catch (error) {
      console.error('Error fetching VIP reservations:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredReservations = reservations
    .filter((r) => statusFilter === 'all' || r.status === statusFilter)
    .filter((r) => !searchQuery
      || r.userEmail.toLowerCase().includes(searchQuery.toLowerCase())
      || r.fullName?.toLowerCase().includes(searchQuery.toLowerCase())
      || r.eventTitle.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => sortBy === 'date'
      ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      : b.totalPrice - a.totalPrice
    );

  // CA club = montant payé par le client − frais Yuno (service + gestion). Les frais
  // Yuno transitent par Stripe mais ne sont jamais du revenu club — ne pas afficher le TTC.
  const totalRevenue = filteredReservations.reduce(
    (s, r) => s + tableRevenue({ total_price: r.totalPrice, service_fee: r.serviceFee, management_fee: r.managementFee }).gross,
    0,
  );
  const totalGuests = filteredReservations.reduce((s, r) => s + (r.guestCount ?? 0), 0);

  return (
    <>
      {/* Stats */}
      <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '16px 22px', marginBottom: 16 }}>
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: t('owner.reservations'), value: filteredReservations.length.toString() },
            { label: t('owner.ord.totalGuests'), value: totalGuests.toString() },
            { label: t('owner.ord.vipRevenue'), value: `€${totalRevenue.toFixed(0)}` },
          ].map(({ label, value }) => (
            <div key={label} className="text-center">
              <div style={{ color: T3, fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
              <div style={{ color: T1, fontSize: 22, fontWeight: 640, letterSpacing: '-0.02em' }} className="tabular-nums leading-none">{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '16px 20px', marginBottom: 16 }}>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: T3 }} />
            <input
              placeholder={t('owner.searchVipPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg text-[13px]"
              style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, outline: 'none' }}
            />
          </div>
          <div className="flex gap-2">
            <DarkSelect value={statusFilter} onChange={setStatusFilter} options={[
              { value: 'all', label: t('owner.allStatuses') },
              { value: 'paid', label: t('owner.paid') },
              { value: 'confirmed', label: t('owner.confirmed') },
              { value: 'cancelled', label: t('owner.cancelled') },
              { value: 'refunded', label: t('owner.refunded') },
            ]} />
            <DarkSelect value={sortBy} onChange={(v) => setSortBy(v as 'date' | 'price')} options={[
              { value: 'date', label: t('owner.sortByDate') },
              { value: 'price', label: t('owner.sortByPrice') },
            ]} />
          </div>
        </div>
      </div>

      {/* Table */}
      <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, overflow: 'hidden' }}>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-2" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
          </div>
        ) : filteredReservations.length === 0 ? (
          <div className="text-center py-16 px-4">
            <Crown className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.12)' }} />
            <p style={{ color: T3, fontSize: 13 }}>{t('owner.noVipOrders')}</p>
          </div>
        ) : (
          <div>
            <div className="grid items-center px-5 py-3" style={{ gridTemplateColumns: '1fr 100px 80px 60px 100px 40px', borderBottom: `1px solid ${F_BORDER}` }}>
              {[t('owner.th.client'), t('owner.th.zone'), t('owner.th.total'), t('owner.th.guests'), t('owner.th.status'), ''].map((h, idx) => (
                <span key={idx} style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{h}</span>
              ))}
            </div>
            {filteredReservations.map((res, i) => {
              const st = STATUS_STYLE[res.status] ?? STATUS_STYLE.pending;
              return (
                <motion.div
                  key={res.id}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.025 }}
                  className="grid items-center px-5 py-3.5 cursor-pointer transition-colors duration-150"
                  style={{ gridTemplateColumns: '1fr 100px 80px 60px 100px 40px', borderBottom: i < filteredReservations.length - 1 ? `1px solid ${F_BORDER}` : 'none' }}
                  onClick={() => setSelectedReservation(res)}
                >
                  <div className="min-w-0">
                    <div style={{ color: T1, fontSize: 13, fontWeight: 560 }} className="truncate">
                      {res.fullName ?? res.userEmail}
                    </div>
                    <div style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>
                      {format(new Date(res.createdAt), 'dd/MM HH:mm', { locale: dateLocale })}
                    </div>
                  </div>
                  <span style={{ color: T2, fontSize: 12 }} className="truncate">{res.zoneName ?? '—'}</span>
                  <span style={{ color: T1, fontSize: 14, fontWeight: 620, letterSpacing: '-0.01em' }} className="tabular-nums">
                    €{res.totalPrice.toFixed(2)}
                  </span>
                  <span style={{ color: T2, fontSize: 13 }} className="tabular-nums flex items-center gap-1">
                    {res.guestCount ? <><Users className="w-3 h-3" />{res.guestCount}</> : '—'}
                  </span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: st.bg, color: st.color }}>
                    {statusLabel(res.status)}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setSelectedReservation(res); }}
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

      {/* Detail Dialog */}
      <Dialog open={!!selectedReservation} onOpenChange={() => setSelectedReservation(null)}>
        <DialogContent className="border-0 p-0 overflow-hidden" style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 18, maxWidth: 440 }}>
          <DialogHeader className="px-6 pt-6 pb-0">
            <DialogTitle style={{ color: T1, fontSize: 15.5, fontWeight: 600 }}>{t('owner.vipOrderDetails')}</DialogTitle>
            <DialogDescription className="sr-only">{t('owner.vipOrderDetails')}</DialogDescription>
          </DialogHeader>
          {selectedReservation && (
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between p-4 rounded-xl" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[12px] font-semibold"
                    style={{ background: STATUS_STYLE[selectedReservation.status]?.bg ?? C_FAINT, color: STATUS_STYLE[selectedReservation.status]?.color ?? T2 }}>
                    {statusLabel(selectedReservation.status)}
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
                    style={{ background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.25)', color: '#FCD34D' }}>
                    <Crown className="w-3 h-3" />VIP
                  </span>
                </div>
                <span style={{ color: T1, fontSize: 24, fontWeight: 640, letterSpacing: '-0.02em' }} className="tabular-nums">
                  €{selectedReservation.totalPrice.toFixed(2)}
                </span>
              </div>

              <div className="p-4 rounded-xl space-y-1.5" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                <p style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{selectedReservation.eventTitle}</p>
                <p style={{ color: T3, fontSize: 12 }}>{t('owner.eventDate')}: {format(new Date(selectedReservation.eventStartAt), 'dd/MM/yyyy HH:mm', { locale: dateLocale })}</p>
                <p style={{ color: T3, fontSize: 12 }}>{t('owner.createdOn')} {format(new Date(selectedReservation.createdAt), 'dd/MM/yyyy à HH:mm', { locale: dateLocale })}</p>
                {selectedReservation.paidAt && <p style={{ color: T3, fontSize: 12 }}>{t('owner.paidOn')} {format(new Date(selectedReservation.paidAt), 'dd/MM/yyyy à HH:mm', { locale: dateLocale })}</p>}
              </div>

              <div className="p-4 rounded-xl space-y-1.5" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 6 }}>{t('owner.customerInfo')}</p>
                {selectedReservation.fullName && <p style={{ color: T1, fontSize: 13 }}>{selectedReservation.fullName}</p>}
                <p style={{ color: T2, fontSize: 13 }}>{selectedReservation.userEmail}</p>
                {selectedReservation.phone && <p style={{ color: T2, fontSize: 13 }}>{selectedReservation.phone}</p>}
                {selectedReservation.guestCount && (
                  <p style={{ color: T2, fontSize: 13 }} className="flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5" style={{ color: T3 }} />
                    {selectedReservation.guestCount} {t('owner.guests')}
                  </p>
                )}
              </div>

              <div>
                <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8 }}>{t('owner.items')}</p>
                <div className="space-y-1.5">
                  {selectedReservation.zoneName && (
                    <div className="flex justify-between px-3 py-2.5 rounded-xl" style={{ background: INNER_BG }}>
                      <span style={{ color: T1, fontSize: 13 }} className="flex items-center gap-1.5">
                        <Crown className="w-3.5 h-3.5" style={{ color: '#FCD34D' }} />
                        {t('owner.vipTable')} — {selectedReservation.zoneName}
                      </span>
                      <span style={{ color: T1, fontSize: 13, fontWeight: 620 }} className="tabular-nums">
                        €{(selectedReservation.deposit || selectedReservation.totalPrice).toFixed(2)}
                      </span>
                    </div>
                  )}
                  {selectedReservation.serviceFee > 0 && (
                    <div className="flex justify-between px-3 py-2.5 rounded-xl" style={{ background: INNER_BG }}>
                      <span style={{ color: T2, fontSize: 13 }}>{t('owner.serviceFee')}</span>
                      <span style={{ color: T2, fontSize: 13 }} className="tabular-nums">€{selectedReservation.serviceFee.toFixed(2)}</span>
                    </div>
                  )}
                  {(selectedReservation.managementFee ?? 0) > 0 && (
                    <div className="flex justify-between px-3 py-2.5 rounded-xl" style={{ background: INNER_BG }}>
                      <span style={{ color: T2, fontSize: 13 }}>{t('owner.managementFee')}</span>
                      <span style={{ color: T2, fontSize: 13 }} className="tabular-nums">€{selectedReservation.managementFee!.toFixed(2)}</span>
                    </div>
                  )}
                  {selectedReservation.minimumSpend && (
                    <div className="flex justify-between px-3 py-2.5 rounded-xl" style={{ background: INNER_BG }}>
                      <span style={{ color: T2, fontSize: 13 }}>{t('owner.minimumSpend')}</span>
                      <span style={{ color: T2, fontSize: 13 }} className="tabular-nums">€{selectedReservation.minimumSpend.toFixed(2)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
