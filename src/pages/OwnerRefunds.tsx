import { useState, useEffect, useMemo, useCallback } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useVenueContext } from '@/hooks/useVenueContext';
import { OwnerHeader } from '@/components/OwnerHeader';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { type RefundableItem } from '@/components/owner/RefundItemCard';
import { RefundCustomerCard, type CustomerGroup } from '@/components/owner/RefundCustomerCard';
import { RefundReasonDialog } from '@/components/owner/RefundReasonDialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { CheckSquare, RefreshCw, History, BarChart3, ShieldX } from 'lucide-react';
import { useCanRefund } from '@/hooks/useCanRefund';
import { alreadyRefundedCents, refundCapCents, type SaleAmounts, type SaleKind } from '@/lib/saleRefund';
import { RefundAnalyticsSection } from '@/components/analytics/RefundAnalyticsSection';
import { format } from 'date-fns';
import type { RefundAnalytics } from '@/hooks/useAnalyticsData';

interface EventOption {
  id: string;
  title: string;
  start_at: string;
}

interface RefundedItem {
  id: string;
  type: string;
  email: string;
  amount: number;
  reason: string;
  refunded_at: string;
  /** Remboursement partiel : la vente reste valable. */
  partial: boolean;
  /** Fait depuis le tableau de bord Stripe (aucun auteur Yuno). */
  viaStripe: boolean;
}

/** Colonnes lues pour le plafond + l'historique (communes aux trois piliers). */
interface SaleRefundRow extends SaleAmounts {
  id: string;
  status: string;
  user_email: string | null;
  created_at: string;
  stripe_payment_intent_id: string | null;
  refund_reason: string | null;
  refunded_at: string | null;
  refunded_by: string | null;
}

/**
 * Une vente → ce que l'écran en montre : à rembourser (reste > 0 et vente
 * valable) et/ou dans l'historique (déjà rendu, même partiellement). Plafond et
 * reste viennent de la règle du serveur (`refundCapCents`).
 */
function splitSale(kind: SaleKind, row: SaleRefundRow, refundableStatus: boolean) {
  const cap = refundCapCents(kind, row) / 100;
  const already = alreadyRefundedCents(row) / 100;
  const refunded: RefundedItem | null = row.status === 'refunded' || already > 0
    ? {
        id: row.id, type: kind, email: row.user_email || '',
        amount: already || (row.status === 'refunded' ? cap : 0),
        reason: row.refund_reason || '', refunded_at: row.refunded_at || '',
        partial: row.status !== 'refunded',
        viaStripe: !row.refunded_by && !row.refund_reason,
      }
    : null;
  const refundable = refundableStatus && row.status !== 'refunded' ? Math.max(0, Math.round((cap - already) * 100) / 100) : 0;
  return { cap, already, refundable, refunded };
}

/** Colonnes communes aux lignes remboursées (orders / tickets / table_reservations). */
interface RefundedOrderRow {
  id: string;
  total: number;
  refund_amount: number | null;
  refund_reason: string | null;
  refunded_at: string | null;
  created_at: string;
}

interface RefundedSaleRow {
  id: string;
  total_price: number;
  refund_amount: number | null;
  refund_reason: string | null;
  refunded_at: string | null;
  event_id: string;
}

/** Ligne d'item d'une commande (JSON `orders.items`), champs réellement lus. */
interface OrderItemLine {
  qty?: number;
  name?: string;
  drinkName?: string;
}

/** Résultat unitaire renvoyé par l'edge function owner-refund. */
interface RefundResult {
  success: boolean;
  type: string;
  id: string;
  error?: string;
}

/** Vente remboursée, ou partiellement remboursée (elle reste alors payée). */
const REFUNDED_FILTER = 'status.eq.refunded,refund_amount.gt.0';

const STRIPE_PERCENT = 0.015;
const STRIPE_FIXED_CENTS = 25;

function calcStripeFee(totalPrice: number): number {
  const totalCents = Math.round(totalPrice * 100);
  return (Math.round(totalCents * STRIPE_PERCENT) + STRIPE_FIXED_CENTS) / 100;
}

export default function OwnerRefunds() {
  const { t } = useLanguage();
  const { venueId, organizerUserId, scope } = useVenueContext();
  // Un manager sans le droit « Remboursements » arrive ici par l'URL : il ne
  // voit pas de bouton que le serveur lui refuserait.
  const canRefund = useCanRefund();
  const isOrganizerScope = scope === 'organizer';
  // Resolves the dashboard owner's events — venue-scoped for clubs, user-scoped for organizers.
  const scopeReady = isOrganizerScope ? !!organizerUserId : !!venueId;

  const [events, setEvents] = useState<EventOption[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [items, setItems] = useState<RefundableItem[]>([]);
  const [refundedItems, setRefundedItems] = useState<RefundedItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [globalRefundAnalytics, setGlobalRefundAnalytics] = useState<RefundAnalytics | null>(null);
  const [fetchingAnalytics, setFetchingAnalytics] = useState(false);

  useEffect(() => {
    if (!scopeReady) return;
    const fetchEvents = async () => {
      const base = supabase
        .from('events')
        .select('id, title, start_at')
        .order('start_at', { ascending: false })
        .limit(50);
      const { data } = isOrganizerScope
        ? await base.or(`organizer_user_id.eq.${organizerUserId},partner_organizer_id.eq.${organizerUserId}`)
        : await base.eq('venue_id', venueId);
      setEvents(data || []);
    };
    fetchEvents();
  }, [venueId, organizerUserId, isOrganizerScope, scopeReady]);

  /** Org scope has no venue, so drink orders never apply; tickets/tables are scoped by event id. */
  const fetchOrganizerEventIds = useCallback(async (): Promise<string[]> => {
    const { data } = await supabase
      .from('events')
      .select('id')
      .or(`organizer_user_id.eq.${organizerUserId},partner_organizer_id.eq.${organizerUserId}`);
    return (data ?? []).map((e) => e.id);
  }, [organizerUserId]);

  const fetchGlobalRefundAnalytics = useCallback(async () => {
    if (!scopeReady) return;
    setFetchingAnalytics(true);
    try {
      let refOrders: RefundedOrderRow[] | null = [];
      let refTickets: RefundedSaleRow[] | null = [];
      let refTables: RefundedSaleRow[] | null = [];
      let paidOrdersCount = 0, paidTicketsCount = 0, paidTablesCount = 0;

      if (isOrganizerScope) {
        // Organizers never sell drinks (no venue) — tickets + tables scoped by their event ids.
        const ids = await fetchOrganizerEventIds();
        if (ids.length > 0) {
          refTickets = (await supabase.from('tickets').select('id, total_price, refund_amount, refund_reason, refunded_at, event_id').in('event_id', ids).or(REFUNDED_FILTER)).data;
          refTables = (await supabase.from('table_reservations').select('id, total_price, refund_amount, refund_reason, refunded_at, event_id').in('event_id', ids).or(REFUNDED_FILTER)).data;
          paidTicketsCount = (await supabase.from('tickets').select('*', { count: 'exact', head: true }).in('event_id', ids).in('status', ['paid', 'refunded'])).count || 0;
          paidTablesCount = (await supabase.from('table_reservations').select('*', { count: 'exact', head: true }).in('event_id', ids).in('status', ['paid', 'refunded'])).count || 0;
        }
      } else {
        refOrders = (await supabase.from('orders').select('id, total, refund_amount, refund_reason, refunded_at, created_at').eq('venue_id', venueId).or(REFUNDED_FILTER)).data;
        refTickets = (await supabase.from('tickets').select('id, total_price, refund_amount, refund_reason, refunded_at, event_id, events!inner(venue_id)').eq('events.venue_id', venueId).or(REFUNDED_FILTER)).data;
        refTables = (await supabase.from('table_reservations').select('id, total_price, refund_amount, refund_reason, refunded_at, event_id, events!inner(venue_id)').eq('events.venue_id', venueId).or(REFUNDED_FILTER)).data;
        paidOrdersCount = (await supabase.from('orders').select('*', { count: 'exact', head: true }).eq('venue_id', venueId).in('status', ['paid', 'served', 'refunded'])).count || 0;
        paidTicketsCount = (await supabase.from('tickets').select('*, events!inner(venue_id)', { count: 'exact', head: true }).eq('events.venue_id', venueId).in('status', ['paid', 'refunded'])).count || 0;
        paidTablesCount = (await supabase.from('table_reservations').select('*, events!inner(venue_id)', { count: 'exact', head: true }).eq('events.venue_id', venueId).in('status', ['paid', 'refunded'])).count || 0;
      }

      interface RI { type: string; amount: number; reason: string; date: string; }
      const all: RI[] = [];
      (refOrders || []).forEach((o) => all.push({ type: 'order', amount: Number(o.refund_amount) || Number(o.total), reason: o.refund_reason || '', date: o.refunded_at ? format(new Date(o.refunded_at), 'yyyy-MM-dd') : format(new Date(o.created_at), 'yyyy-MM-dd') }));
      (refTickets || []).forEach((t) => all.push({ type: 'ticket', amount: Number(t.refund_amount) || Number(t.total_price), reason: t.refund_reason || '', date: t.refunded_at ? format(new Date(t.refunded_at), 'yyyy-MM-dd') : '' }));
      (refTables || []).forEach((t) => all.push({ type: 'table_reservation', amount: Number(t.refund_amount) || Number(t.total_price), reason: t.refund_reason || '', date: t.refunded_at ? format(new Date(t.refunded_at), 'yyyy-MM-dd') : '' }));

      const totalRefunded = all.reduce((s, r) => s + r.amount, 0);
      const totalRefundCount = all.length;
      const totalTx = (paidOrdersCount || 0) + (paidTicketsCount || 0) + (paidTablesCount || 0);
      const refundRate = totalTx > 0 ? (totalRefundCount / totalTx) * 100 : 0;
      const avgRefundAmount = totalRefundCount > 0 ? totalRefunded / totalRefundCount : 0;

      const byType: Record<string, { count: number; amount: number }> = {};
      all.forEach(r => { if (!byType[r.type]) byType[r.type] = { count: 0, amount: 0 }; byType[r.type].count++; byType[r.type].amount += r.amount; });

      const byDay: Record<string, { amount: number; count: number }> = {};
      all.forEach(r => { if (!r.date) return; if (!byDay[r.date]) byDay[r.date] = { amount: 0, count: 0 }; byDay[r.date].amount += r.amount; byDay[r.date].count++; });

      const byReason: Record<string, { count: number; amount: number }> = {};
      all.forEach(r => { const k = r.reason || ''; if (!byReason[k]) byReason[k] = { count: 0, amount: 0 }; byReason[k].count++; byReason[k].amount += r.amount; });

      setGlobalRefundAnalytics({
        totalRefunded, totalRefundCount,
        refundsByType: Object.entries(byType).map(([type, d]) => ({ type, ...d })),
        refundsByDay: Object.entries(byDay).map(([date, d]) => ({ date, ...d })).sort((a, b) => a.date.localeCompare(b.date)),
        refundsByReason: Object.entries(byReason).map(([reason, d]) => ({ reason, ...d })).sort((a, b) => b.amount - a.amount),
        refundRate, avgRefundAmount,
      });
    } catch (err) {
      console.error(err);
    } finally {
      setFetchingAnalytics(false);
    }
  }, [venueId, isOrganizerScope, scopeReady, fetchOrganizerEventIds]);

  const fetchItems = useCallback(async () => {
    if (!selectedEventId || !scopeReady) return;
    setFetching(true);
    try {
      const refundable: RefundableItem[] = [];
      const refunded: RefundedItem[] = [];

      const push = (kind: SaleKind, row: SaleRefundRow, extra: { name?: string; details?: string }, refundableStatus: boolean) => {
        const { cap, already, refundable: left, refunded: done } = splitSale(kind, row, refundableStatus);
        if (done) refunded.push(done);
        if (left <= 0) return;
        // Montant réellement débité (base des frais Stripe du club) : pour une
        // table, l'acompte et ses frais — jamais le budget complet de la table.
        const deposit = Number(row.deposit) || 0;
        const total = kind === 'order'
          ? Number(row.total) || 0
          : kind === 'table_reservation' && deposit > 0
            ? deposit + (Number(row.service_fee) || 0) + (row.fee_absorbed ? 0 : Number(row.management_fee) || 0)
            : Number(row.total_price) || 0;
        refundable.push({
          id: row.id, type: kind, email: row.user_email || '', name: extra.name, details: extra.details,
          amount: total, serviceFee: Number(row.service_fee || 0), stripeFee: calcStripeFee(total),
          clubReceived: cap, alreadyRefunded: already, refundable: left,
          createdAt: row.created_at, hasPaymentIntent: !!row.stripe_payment_intent_id,
        });
      };
      const REFUND_COLS = 'refund_amount, refund_reason, refunded_at, refunded_by, fee_absorbed';

      // Orders (drinks) only exist for venues — organizers have no venue, so skip.
      const { data: orders } = isOrganizerScope
        ? { data: [] as never[] }
        : await supabase
            .from('orders')
            .select(`id, user_email, total, service_fee, created_at, stripe_payment_intent_id, items, status, ${REFUND_COLS}`)
            .eq('venue_id', venueId)
            .eq('event_id', selectedEventId);

      for (const o of orders || []) {
        const itemsList = Array.isArray(o.items) ? o.items as OrderItemLine[] : [];
        const details = itemsList.map((i) => `${i.qty || 1}x ${i.name || i.drinkName || ''}`).join(', ');
        push('order', o as unknown as SaleRefundRow, { details }, o.status === 'paid');
      }

      // Tickets — un billet scanné (la personne est entrée) ne se rembourse pas d'ici.
      const { data: tickets } = await supabase
        .from('tickets')
        .select(`id, user_email, full_name, total_price, service_fee, insurance_fee, created_at, stripe_payment_intent_id, entry_scanned, status, ${REFUND_COLS}`)
        .eq('event_id', selectedEventId);

      for (const tk of tickets || []) {
        push('ticket', tk as unknown as SaleRefundRow, { name: tk.full_name || undefined }, tk.status === 'paid' && !tk.entry_scanned);
      }

      // Table reservations — le plafond est l'acompte encaissé, pas le budget de la table.
      const { data: tables } = await supabase
        .from('table_reservations')
        .select(`id, user_email, full_name, total_price, service_fee, management_fee, deposit, created_at, stripe_payment_intent_id, status, ${REFUND_COLS}`)
        .eq('event_id', selectedEventId);

      for (const tr of tables || []) {
        push('table_reservation', tr as unknown as SaleRefundRow, { name: tr.full_name || undefined }, tr.status === 'paid');
      }

      setItems(refundable);
      setRefundedItems(refunded);
      setSelectedIds(new Set());
    } catch (err) {
      console.error(err);
    } finally {
      setFetching(false);
    }
  }, [selectedEventId, scopeReady, isOrganizerScope, venueId]);

  useEffect(() => {
    if (!selectedEventId || !scopeReady) { setItems([]); setRefundedItems([]); return; }
    fetchItems();
  }, [selectedEventId, scopeReady, fetchItems]);

  const toggleItem = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAllForCustomer = (_email: string, itemIds: string[]) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      const allSelected = itemIds.every(id => next.has(id));
      if (allSelected) {
        itemIds.forEach(id => next.delete(id));
      } else {
        itemIds.forEach(id => next.add(id));
      }
      return next;
    });
  };

  const customerGroups = useMemo<CustomerGroup[]>(() => {
    const map = new Map<string, CustomerGroup>();
    for (const item of items) {
      const key = item.email;
      if (!map.has(key)) {
        map.set(key, { email: key, name: item.name || '', items: [], totalRefundable: 0 });
      }
      const group = map.get(key)!;
      group.items.push(item);
      group.totalRefundable += item.refundable;
      if (!group.name && item.name) group.name = item.name;
    }
    return Array.from(map.values()).sort((a, b) => b.totalRefundable - a.totalRefundable);
  }, [items]);

  const selectAll = () => {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map(i => i.id)));
    }
  };

  const selectedItems = useMemo(() => items.filter(i => selectedIds.has(i.id)), [items, selectedIds]);

  const handleRefund = async (reason: string, amounts: Record<string, number>) => {
    setLoading(true);
    try {
      const payload = selectedItems.map(i => ({ type: i.type, id: i.id, amount: amounts[i.id] || 0 }));
      const { data, error } = await supabase.functions.invoke('owner-refund', {
        body: { items: payload, reason },
      });

      if (error) throw error;

      const results: RefundResult[] = data?.results || [];
      const successes = results.filter((r) => r.success).length;
      const failures = results.filter((r) => !r.success);

      if (successes > 0) {
        toast.success(`${successes} ${t('refund.refundedSuccess')}`);
      }
      for (const f of failures) {
        toast.error(`${f.type} ${f.id.slice(0, 8)}: ${f.error}`);
      }

      setDialogOpen(false);
      fetchItems();
    } catch (err) {
      toast.error((err as Error).message || 'Error');
    } finally {
      setLoading(false);
    }
  };

  if (!canRefund) {
    return (
      <div className={isOrganizerScope ? 'pb-12' : 'min-h-screen dashboard-gradient-bg pb-24'}>
        {!isOrganizerScope && <OwnerHeader title={t('refund.title')} showBackButton backTo="/owner/dashboard" />}
        <div className="mx-auto max-w-md p-8 text-center text-muted-foreground">
          <ShieldX className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium text-foreground">{t('refund.noPermission')}</p>
          <p className="text-sm mt-1">{t('refund.noPermissionDesc')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={isOrganizerScope ? 'pb-12' : 'min-h-screen dashboard-gradient-bg pb-24'}>
      {!isOrganizerScope && <OwnerHeader title={t('refund.title')} showBackButton backTo="/owner/dashboard" />}

      <div className="mx-auto max-w-3xl p-4 space-y-4">
        {isOrganizerScope && (
          <h1 className="mb-1" style={{ color: 'rgb(var(--ink)/var(--ink-a96,0.96))', fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em' }}>{t('refund.title')}</h1>
        )}
        <div>
          <label className="text-sm font-medium mb-1.5 block">{t('refund.selectEvent')}</label>
          <Select value={selectedEventId} onValueChange={setSelectedEventId}>
            <SelectTrigger>
              <SelectValue placeholder={t('refund.selectEventPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {events.map(e => (
                <SelectItem key={e.id} value={e.id}>
                  {e.title} — {new Date(e.start_at).toLocaleDateString()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedEventId && (
          <Tabs defaultValue="pending" onValueChange={(v) => { if (v === 'analyse' && !globalRefundAnalytics) fetchGlobalRefundAnalytics(); }}>
            <TabsList className="w-full owner-tabs">
              <TabsTrigger value="pending" className="flex-1 gap-1">
                {t('refund.pendingTab')}
                {items.length > 0 && <Badge variant="secondary" className="ml-1">{items.length}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="history" className="flex-1 gap-1">
                <History className="h-3.5 w-3.5" />
                {t('refund.historyTab')}
                {refundedItems.length > 0 && <Badge variant="secondary" className="ml-1">{refundedItems.length}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="analyse" className="flex-1 gap-1">
                <BarChart3 className="h-3.5 w-3.5" />
                {t('refund.analytics.tab')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="pending" className="space-y-3 mt-3">
              {fetching ? (
                <div className="flex justify-center py-8">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              ) : items.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <CheckSquare className="h-10 w-10 mx-auto mb-3 opacity-40" />
                  <p className="font-medium">{t('refund.noItems')}</p>
                  <p className="text-sm">{t('refund.noItemsDesc')}</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <Button variant="outline" size="sm" onClick={selectAll}>
                      {selectedIds.size === items.length ? t('refund.deselectAll') : t('refund.selectAll')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={fetchItems}>
                      <RefreshCw className="h-3.5 w-3.5 mr-1" /> {t('refund.refresh')}
                    </Button>
                  </div>

                  <div className="space-y-3">
                    {customerGroups.map(group => (
                      <RefundCustomerCard
                        key={group.email}
                        group={group}
                        selectedIds={selectedIds}
                        onToggleItem={toggleItem}
                        onToggleAll={toggleAllForCustomer}
                      />
                    ))}
                  </div>

                  {selectedIds.size > 0 && (
                    <div className="sticky bottom-20 z-10">
                      <Button
                        className="w-full bg-red-600 hover:bg-red-700 text-snow"
                        size="lg"
                        onClick={() => setDialogOpen(true)}
                      >
                        {t('refund.refundSelection')} ({selectedIds.size})
                      </Button>
                    </div>
                  )}
                </>
              )}
            </TabsContent>

            <TabsContent value="history" className="space-y-2 mt-3">
              {refundedItems.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground text-sm">{t('refund.noHistory')}</p>
              ) : (
                refundedItems.map(ri => (
                  <div key={ri.id} className="p-3 rounded-lg owner-list-item">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium truncate">{ri.email}</span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        {ri.partial && <Badge variant="secondary" className="text-[10px]">{t('refund.partial')}</Badge>}
                        <span className="text-sm font-semibold text-green-500">{ri.amount.toFixed(2)} €</span>
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{ri.reason || (ri.viaStripe ? t('refund.viaStripe') : '')}</p>
                    <p className="text-xs text-muted-foreground">{ri.refunded_at ? new Date(ri.refunded_at).toLocaleString() : ''}</p>
                  </div>
                ))
              )}
            </TabsContent>

            <TabsContent value="analyse" className="mt-3">
              {fetchingAnalytics ? (
                <div className="flex justify-center py-8">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              ) : globalRefundAnalytics && globalRefundAnalytics.totalRefundCount > 0 ? (
                <RefundAnalyticsSection data={globalRefundAnalytics} />
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-40" />
                  <p className="font-medium">{t('refund.noItems')}</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>

      <RefundReasonDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onConfirm={handleRefund}
        items={selectedItems}
        loading={loading}
      />
    </div>
  );
}
