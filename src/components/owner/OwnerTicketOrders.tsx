import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { Search, Eye, Ticket, TrendingUp, ChevronDown, ShieldAlert, FileText, Download } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { fetchMinorDocsByEvents, minorDocKey, ageFromBirthDate, type MinorDoc } from '@/lib/minorTicketDocs';

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
  cancelled: { bg: 'rgba(232,25,44,0.12)',   color: '#FF5C63' },
  refunded:  { bg: 'rgba(232,25,44,0.12)',   color: '#FF5C63' },
  pending:   { bg: 'rgba(255,255,255,0.06)', color: T2 },
};

const STATUS_KEY: Record<string, string> = {
  paid: 'owner.paid',
  cancelled: 'owner.cancelled',
  refunded: 'owner.refunded',
  pending: 'orders.status.pending',
};

interface TicketOrder {
  id: string;
  eventId: string;
  userEmail: string;
  fullName: string | null;
  phone: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  serviceFee: number;
  insuranceFee: number | null;
  status: string;
  ticketType: string;
  createdAt: string;
  paidAt: string | null;
  eventTitle: string;
  eventStartAt: string;
  roundName: string;
  qrCode: string | null;
}

interface OwnerTicketOrdersProps {
  venueId?: string;
  eventId?: string;
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

export function OwnerTicketOrders({ venueId, eventId }: OwnerTicketOrdersProps) {
  const { t, language } = useLanguage();
  const [tickets, setTickets] = useState<TicketOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTicket, setSelectedTicket] = useState<TicketOrder | null>(null);
  const [sortBy, setSortBy] = useState<'date' | 'price'>('date');
  // Minor-ticket records keyed by event+email, to flag minor buyers + their signed doc.
  const [minorDocs, setMinorDocs] = useState<Map<string, MinorDoc>>(new Map());

  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const statusLabel = (s: string) => t(STATUS_KEY[s] ?? 'orders.status.pending');

  const minorDocFor = (ticket: TicketOrder) => minorDocs.get(minorDocKey(ticket.eventId, ticket.userEmail));

  useEffect(() => {
    if (!venueId && !eventId) return;
    fetchTickets();
  }, [venueId, eventId]);

  const fetchTickets = async () => {
    try {
      let query = supabase
        .from('tickets')
        .select(`*, events!inner(title, start_at, venue_id), ticket_rounds!inner(name)`)
        .in('status', ['paid', 'cancelled', 'refunded'])
        .order('created_at', { ascending: false });
      if (eventId) query = query.eq('event_id', eventId);
      else if (venueId) query = query.eq('events.venue_id', venueId);
      const { data, error } = await query;
      if (error) throw error;
      const mapped: TicketOrder[] = (data || []).map((t: any) => ({
        id: t.id,
        eventId: t.event_id,
        userEmail: t.user_email,
        fullName: t.full_name,
        phone: t.phone,
        quantity: t.quantity,
        unitPrice: t.unit_price,
        totalPrice: t.total_price,
        serviceFee: t.service_fee,
        insuranceFee: t.insurance_fee,
        status: t.status,
        ticketType: t.ticket_type,
        createdAt: t.created_at,
        paidAt: t.paid_at,
        eventTitle: t.events.title,
        eventStartAt: t.events.start_at,
        roundName: t.ticket_rounds.name,
        qrCode: t.qr_code,
      }));
      setTickets(mapped);

      // Enrich with minor-ticket records for the events in view.
      const eventIds = [...new Set(mapped.map((m) => m.eventId).filter(Boolean))];
      setMinorDocs(await fetchMinorDocsByEvents(eventIds));
    } catch (error) {
      console.error('Error fetching tickets:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredTickets = tickets
    .filter((t) => statusFilter === 'all' || t.status === statusFilter)
    .filter((t) => !searchQuery
      || t.userEmail.toLowerCase().includes(searchQuery.toLowerCase())
      || t.fullName?.toLowerCase().includes(searchQuery.toLowerCase())
      || t.eventTitle.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => sortBy === 'date'
      ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      : b.totalPrice - a.totalPrice
    );

  // Club revenue excludes Yuno fees (service + insurance) — never Yuno's cut.
  const totalRevenue = filteredTickets.reduce((s, t) => s + (t.totalPrice - t.serviceFee - (t.insuranceFee ?? 0)), 0);
  const totalQty = filteredTickets.reduce((s, t) => s + t.quantity, 0);

  return (
    <>
      {/* Stats */}
      <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '16px 22px', marginBottom: 16 }}>
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: t('owner.orders'), value: filteredTickets.length.toString() },
            { label: t('owner.ord.ticketsSold'), value: totalQty.toString() },
            { label: t('owner.totalRevenue'), value: `€${totalRevenue.toFixed(0)}` },
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
              placeholder={t('owner.searchTicketPlaceholder')}
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
        ) : filteredTickets.length === 0 ? (
          <div className="text-center py-16 px-4">
            <Ticket className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.12)' }} />
            <p style={{ color: T3, fontSize: 13 }}>{t('owner.noTicketOrders')}</p>
          </div>
        ) : (
          <div>
            <div className="grid items-center px-5 py-3" style={{ gridTemplateColumns: '1fr 120px 80px 100px 40px', borderBottom: `1px solid ${F_BORDER}` }}>
              {[t('owner.th.client'), t('owner.th.event'), t('owner.th.total'), t('owner.th.status'), ''].map((h, idx) => (
                <span key={idx} style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{h}</span>
              ))}
            </div>
            {filteredTickets.map((ticket, i) => {
              const st = STATUS_STYLE[ticket.status] ?? STATUS_STYLE.pending;
              return (
                <motion.div
                  key={ticket.id}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.025 }}
                  className="grid items-center px-5 py-3.5 cursor-pointer transition-colors duration-150"
                  style={{ gridTemplateColumns: '1fr 120px 80px 100px 40px', borderBottom: i < filteredTickets.length - 1 ? `1px solid ${F_BORDER}` : 'none' }}
                  onClick={() => setSelectedTicket(ticket)}
                >
                  <div className="min-w-0">
                    <div style={{ color: T1, fontSize: 13, fontWeight: 560 }} className="truncate flex items-center gap-1.5">
                      <span className="truncate">{ticket.fullName ?? ticket.userEmail}</span>
                      {minorDocFor(ticket) && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full shrink-0" style={{ background: 'rgba(232,25,44,0.12)', color: '#FF7A80', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                          <ShieldAlert className="w-2.5 h-2.5" />
                          {t('minorClients.badge')}
                        </span>
                      )}
                    </div>
                    <div style={{ color: T3, fontSize: 11.5, marginTop: 1 }} className="flex items-center gap-1">
                      <Ticket className="w-3 h-3 inline" />
                      {ticket.quantity}× {ticket.roundName}
                      {ticket.ticketType === 'vip' && <span style={{ color: '#FCD34D', marginLeft: 4 }}>VIP</span>}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div style={{ color: T2, fontSize: 12 }} className="truncate">{ticket.eventTitle}</div>
                    <div style={{ color: T3, fontSize: 11 }}>{format(new Date(ticket.createdAt), 'dd/MM HH:mm', { locale: dateLocale })}</div>
                  </div>
                  <span style={{ color: T1, fontSize: 14, fontWeight: 620, letterSpacing: '-0.01em' }} className="tabular-nums">
                    €{ticket.totalPrice.toFixed(2)}
                  </span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: st.bg, color: st.color }}>
                    {statusLabel(ticket.status)}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setSelectedTicket(ticket); }}
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
      <Dialog open={!!selectedTicket} onOpenChange={() => setSelectedTicket(null)}>
        <DialogContent className="border-0 p-0 overflow-hidden" style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 18, maxWidth: 440 }}>
          <DialogHeader className="px-6 pt-6 pb-0">
            <DialogTitle style={{ color: T1, fontSize: 15.5, fontWeight: 600 }}>{t('owner.ticketOrderDetails')}</DialogTitle>
            <DialogDescription className="sr-only">{t('owner.ticketOrderDetails')}</DialogDescription>
          </DialogHeader>
          {selectedTicket && (
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between p-4 rounded-xl" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[12px] font-semibold"
                  style={{ background: STATUS_STYLE[selectedTicket.status]?.bg ?? C_FAINT, color: STATUS_STYLE[selectedTicket.status]?.color ?? T2 }}>
                  {statusLabel(selectedTicket.status)}
                </span>
                <span style={{ color: T1, fontSize: 24, fontWeight: 640, letterSpacing: '-0.02em' }} className="tabular-nums">
                  €{selectedTicket.totalPrice.toFixed(2)}
                </span>
              </div>

              <div className="p-4 rounded-xl space-y-1.5" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                <p style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{selectedTicket.eventTitle}</p>
                <p style={{ color: T3, fontSize: 12 }}>{t('owner.eventDate')}: {format(new Date(selectedTicket.eventStartAt), 'dd/MM/yyyy HH:mm', { locale: dateLocale })}</p>
                <p style={{ color: T3, fontSize: 12 }}>{t('owner.createdOn')} {format(new Date(selectedTicket.createdAt), 'dd/MM/yyyy à HH:mm', { locale: dateLocale })}</p>
                {selectedTicket.paidAt && <p style={{ color: T3, fontSize: 12 }}>{t('owner.paidOn')} {format(new Date(selectedTicket.paidAt), 'dd/MM/yyyy à HH:mm', { locale: dateLocale })}</p>}
              </div>

              <div className="p-4 rounded-xl space-y-1.5" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 6 }}>{t('owner.customerInfo')}</p>
                {selectedTicket.fullName && <p style={{ color: T1, fontSize: 13 }}>{selectedTicket.fullName}</p>}
                <p style={{ color: T2, fontSize: 13 }}>{selectedTicket.userEmail}</p>
                {selectedTicket.phone && <p style={{ color: T2, fontSize: 13 }}>{selectedTicket.phone}</p>}
              </div>

              {/* Minor ticket → birth date + signed authorization */}
              {(() => {
                const md = minorDocFor(selectedTicket);
                if (!md) return null;
                const age = ageFromBirthDate(md.birthDate);
                return (
                  <div className="p-4 rounded-xl space-y-2.5" style={{ background: 'rgba(232,25,44,0.06)', border: '1px solid rgba(232,25,44,0.25)' }}>
                    <p className="flex items-center gap-1.5" style={{ color: '#FF7A80', fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                      <ShieldAlert className="w-3.5 h-3.5" />
                      {t('minorClients.badge')}
                    </p>
                    {md.birthDate && (
                      <p style={{ color: T2, fontSize: 13 }}>
                        {t('minorClients.bornOn')} {format(new Date(md.birthDate), 'dd/MM/yyyy', { locale: dateLocale })}
                        {age != null && <span style={{ color: T3 }}> · {age} {language === 'fr' ? 'ans' : language === 'es' ? 'años' : 'yo'}</span>}
                      </p>
                    )}
                    {md.docUrl ? (
                      <a href={md.docUrl} target="_blank" rel="noopener noreferrer" download
                        className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                        <FileText className="w-4 h-4 shrink-0" style={{ color: RED }} />
                        <span style={{ color: T1, fontSize: 13 }} className="flex-1 truncate">{md.docName || t('minorClients.signedDoc')}</span>
                        <Download className="w-4 h-4 shrink-0" style={{ color: T2 }} />
                      </a>
                    ) : (
                      <p style={{ color: T3, fontSize: 12 }}>{t('minorClients.noDoc')}</p>
                    )}
                  </div>
                );
              })()}

              <div>
                <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8 }}>{t('owner.items')}</p>
                <div className="space-y-1.5">
                  <div className="flex justify-between px-3 py-2.5 rounded-xl" style={{ background: INNER_BG }}>
                    <span style={{ color: T1, fontSize: 13 }} className="flex items-center gap-1.5">
                      <Ticket className="w-3.5 h-3.5" style={{ color: T3 }} />
                      {selectedTicket.quantity}× {selectedTicket.roundName}
                      {selectedTicket.ticketType === 'vip' && <span style={{ color: '#FCD34D' }}>VIP</span>}
                    </span>
                    <span style={{ color: T1, fontSize: 13, fontWeight: 620 }} className="tabular-nums">€{(selectedTicket.unitPrice * selectedTicket.quantity).toFixed(2)}</span>
                  </div>
                  {selectedTicket.serviceFee > 0 && (
                    <div className="flex justify-between px-3 py-2.5 rounded-xl" style={{ background: INNER_BG }}>
                      <span style={{ color: T2, fontSize: 13 }}>{t('owner.serviceFee')}</span>
                      <span style={{ color: T2, fontSize: 13 }} className="tabular-nums">€{selectedTicket.serviceFee.toFixed(2)}</span>
                    </div>
                  )}
                  {(selectedTicket.insuranceFee ?? 0) > 0 && (
                    <div className="flex justify-between px-3 py-2.5 rounded-xl" style={{ background: INNER_BG }}>
                      <span style={{ color: T2, fontSize: 13 }}>{t('owner.insuranceFee')}</span>
                      <span style={{ color: T2, fontSize: 13 }} className="tabular-nums">€{selectedTicket.insuranceFee!.toFixed(2)}</span>
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
