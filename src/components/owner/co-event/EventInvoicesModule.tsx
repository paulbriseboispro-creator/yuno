import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search, Download, Ticket, Wine, Sparkles, FileSpreadsheet, Loader2, Handshake, Eye, User, Building2 } from 'lucide-react';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { toast } from 'sonner';
import { downloadInvoicePDF, type InvoiceData, type InvoiceItem } from '@/lib/generateInvoicePDF';
import { useLanguage } from '@/contexts/LanguageContext';
import { computeYunoFee, getEffectiveSplit, computeShare as computeShareUtil, type InvoiceType } from '@/utils/coEventSplit';

const dfLocale = (lng: string) => (lng === 'fr' ? fr : lng === 'es' ? es : enUS);

type ViewerSide = 'customer' | 'venue' | 'organizer';

interface Invoice {
  id: string;
  invoice_number: string;
  created_at: string;
  type: InvoiceType;
  amount: number;
  customer_email: string;
  customer_name: string | null;
  customer_phone: string | null;
  event_name: string | null;
  event_id: string | null;
  event_date: string | null;
  event_poster: string | null;
  ticket_id: string | null;
  table_reservation_id: string | null;
  order_id: string | null;
}

interface EventCoData {
  venue_id: string | null;
  partner_venue_id: string | null;
  organizer_user_id: string | null;
  partner_organizer_id: string | null;
  event_mode: string | null;
  revenue_split_rules: any;
  venueName: string;
  organizerName: string;
}

interface Props {
  /** Filter invoices for a single event. */
  eventId: string;
}

/**
 * Module Factures scopé à un événement avec adaptation co-organisateur.
 * - Détecte si l'utilisateur est lead/partner venue ou organisateur.
 * - Affiche un sélecteur "Vue facture" : client / ma part / part du partenaire.
 * - Génère un PDF qui inclut la répartition co-événement quand c'est un co-event.
 */
export function EventInvoicesModule({ eventId }: Props) {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [eventCo, setEventCo] = useState<EventCoData | null>(null);
  const [myRole, setMyRole] = useState<ViewerSide>('customer');
  const [viewMode, setViewMode] = useState<ViewerSide>('customer');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | InvoiceType>('all');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!eventId) return;
    fetchAll();
  }, [eventId, user]);

  async function fetchAll() {
    setLoading(true);
    // Load event co-event metadata
    const { data: ev } = await supabase
      .from('events')
      .select('venue_id, partner_venue_id, organizer_user_id, partner_organizer_id, event_mode, revenue_split_rules, is_bde')
      .eq('id', eventId)
      .maybeSingle();

    let venueName = '';
    let organizerName = t('owner.coev.organizer');
    if (ev) {
      const vid = ev.venue_id ?? ev.partner_venue_id;
      const oid = ev.organizer_user_id ?? ev.partner_organizer_id;
      const [{ data: v }, { data: o }] = await Promise.all([
        vid ? supabase.from('venues').select('name').eq('id', vid).maybeSingle() : Promise.resolve({ data: null }),
        oid ? supabase.from('organizer_profiles' as any).select('display_name').eq('user_id', oid).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      venueName = (v as any)?.name ?? '';
      organizerName = (o as any)?.display_name ?? t('owner.coev.organizer');

      setEventCo({
        venue_id: ev.venue_id,
        partner_venue_id: ev.partner_venue_id,
        organizer_user_id: ev.organizer_user_id,
        partner_organizer_id: ev.partner_organizer_id,
        event_mode: ev.event_mode,
        revenue_split_rules: ev.revenue_split_rules,
        venueName,
        organizerName,
      });

      // Detect viewer role
      let role: ViewerSide = 'customer';
      if (user) {
        if (oid && oid === user.id) role = 'organizer';
        else if (vid) {
          const { data: venueOwned } = await supabase
            .from('venues').select('id').eq('id', vid).eq('owner_id', user.id).maybeSingle();
          if (venueOwned) role = 'venue';
        }
      }
      setMyRole(role);
      setViewMode(role); // default to "my view"
    }

    const { data, error } = await supabase
      .from('invoices')
      .select('*')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error(error);
      toast.error(t('coInv.loadError'));
      setLoading(false);
      return;
    }
    setInvoices(((data || []) as any[]).map(inv => ({
      id: inv.id,
      invoice_number: inv.invoice_number,
      created_at: inv.created_at,
      type: inv.type as InvoiceType,
      amount: Number(inv.amount) || 0,
      customer_email: inv.customer_email || '',
      customer_name: inv.customer_name,
      customer_phone: inv.customer_phone,
      event_name: inv.event_name,
      event_id: inv.event_id,
      event_date: inv.event_date,
      event_poster: inv.event_poster,
      ticket_id: inv.ticket_id,
      table_reservation_id: inv.table_reservation_id,
      order_id: inv.order_id,
    })));
    setLoading(false);
  }

  const isCoEvent = !!eventCo && (
    eventCo.event_mode === 'co_event' || eventCo.event_mode === 'venue_rental' || eventCo.event_mode === 'org_hosted'
    || (!!eventCo.venue_id && !!eventCo.partner_organizer_id)
    || (!!eventCo.organizer_user_id && !!eventCo.partner_venue_id)
  );

  const filtered = useMemo(() => {
    return invoices.filter(inv => {
      if (typeFilter !== 'all' && inv.type !== typeFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          inv.invoice_number.toLowerCase().includes(q) ||
          inv.customer_email.toLowerCase().includes(q) ||
          inv.customer_name?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [invoices, search, typeFilter]);

  /** Compute the viewer's share for an invoice given current viewMode. */
  function computeShare(inv: Invoice, side: 'venue' | 'organizer'): { share: number; pct: number; net: number; yuno: number } {
    return computeShareUtil(inv.amount, inv.type, side, eventCo?.revenue_split_rules, eventCo?.event_mode ?? null, (eventCo as any)?.is_bde ?? false);
  }

  /** Adaptive totals depending on the active viewMode. */
  const totals = useMemo(() => {
    const base = {
      count: filtered.length,
      total: filtered.reduce((s, i) => s + i.amount, 0),
      byType: {
        ticket: filtered.filter(i => i.type === 'ticket').reduce((s, i) => s + i.amount, 0),
        table: filtered.filter(i => i.type === 'table').reduce((s, i) => s + i.amount, 0),
        order: filtered.filter(i => i.type === 'order').reduce((s, i) => s + i.amount, 0),
      },
      yourShare: 0,
      partnerShare: 0,
      yuno: 0,
    };
    if (isCoEvent && (viewMode === 'venue' || viewMode === 'organizer')) {
      filtered.forEach(inv => {
        const yours = computeShare(inv, viewMode);
        const partner = computeShare(inv, viewMode === 'venue' ? 'organizer' : 'venue');
        base.yourShare += yours.share;
        base.partnerShare += partner.share;
        base.yuno += yours.yuno;
      });
    }
    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, viewMode, isCoEvent, eventCo]);

  async function buildInvoiceData(invoice: Invoice): Promise<InvoiceData | null> {
    const { data: stored } = await supabase
      .from('invoices')
      .select('items, service_fee, management_fee, insurance_fee, qr_code, venue_id, ticket_id, table_reservation_id')
      .eq('id', invoice.id)
      .maybeSingle();

    // Short claim reference (TK-/VP-XXXXXX), shown as the ticket number on the bill.
    let referenceCode: string | undefined;
    if (invoice.type === 'ticket' && stored?.ticket_id) {
      const { data: tk } = await supabase.from('tickets').select('reference_code').eq('id', stored.ticket_id).maybeSingle();
      referenceCode = tk?.reference_code || undefined;
    } else if (invoice.type === 'table' && stored?.table_reservation_id) {
      const { data: tr } = await supabase.from('table_reservations').select('reference_code').eq('id', stored.table_reservation_id).maybeSingle();
      referenceCode = tr?.reference_code || undefined;
    }

    const venueId = stored?.venue_id ?? eventCo?.venue_id ?? eventCo?.partner_venue_id ?? null;
    const { data: venue } = venueId ? await supabase
      .from('venues')
      .select('name, legal_name, address, siret, vat_number, logo_url')
      .eq('id', venueId)
      .maybeSingle() : { data: null };

    let items: InvoiceItem[] = [];
    if (stored?.items && Array.isArray(stored.items)) {
      items = (stored.items as any[]).map(it => ({
        description: it.description || 'Item',
        quantity: it.quantity || 1,
        unitPrice: it.unitPrice || 0,
        total: it.total || 0,
      }));
    } else {
      items = [{
        description: invoice.event_name || 'Item',
        quantity: 1,
        unitPrice: invoice.amount,
        total: invoice.amount,
      }];
    }

    const totalHT = invoice.amount / 1.2;

    // Build co-event block if applicable AND the user is venue/organizer
    let coEvent: InvoiceData['coEvent'] = undefined;
    if (isCoEvent && eventCo && (viewMode === 'venue' || viewMode === 'organizer')) {
      const split = getEffectiveSplit(eventCo.revenue_split_rules, invoice.type, eventCo.event_mode);
      const yuno = computeYunoFee(invoice.type, invoice.amount, (eventCo as any)?.is_bde ?? false);
      const net = invoice.amount - yuno;
      const venueShare = Math.round((net * split.venue_pct) / 100 * 100) / 100;
      const organizerShare = Math.round((net * split.organizer_pct) / 100 * 100) / 100;
      coEvent = {
        viewerSide: viewMode,
        venuePartyName: eventCo.venueName || t('owner.coev.establishment'),
        organizerPartyName: eventCo.organizerName || t('owner.coev.organizer'),
        venuePct: split.venue_pct,
        organizerPct: split.organizer_pct,
        yunoFee: yuno,
        netAmount: net,
        viewerShare: viewMode === 'venue' ? venueShare : organizerShare,
        partnerShare: viewMode === 'venue' ? organizerShare : venueShare,
        mode: eventCo.event_mode || 'co_event',
      };
    }

    return {
      invoiceNumber: invoice.invoice_number,
      invoiceDate: new Date(invoice.created_at),
      paymentDate: new Date(invoice.created_at),
      venueName: venue?.name || eventCo?.venueName || 'Venue',
      venueLegalName: (venue as any)?.legal_name || venue?.name,
      venueAddress: venue?.address,
      venueSiret: venue?.siret,
      venueVatNumber: (venue as any)?.vat_number,
      venueLogoUrl: (venue as any)?.logo_url,
      customerName: invoice.customer_name || invoice.customer_email,
      customerEmail: invoice.customer_email,
      customerPhone: invoice.customer_phone || undefined,
      eventTitle: invoice.event_name || undefined,
      eventDate: invoice.event_date ? new Date(invoice.event_date) : undefined,
      eventPosterUrl: invoice.event_poster || undefined,
      type: invoice.type,
      items,
      serviceFee: Number((stored as any)?.service_fee) || 0,
      managementFee: Number((stored as any)?.management_fee) || 0,
      insuranceFee: Number((stored as any)?.insurance_fee) || 0,
      totalHT,
      tva: invoice.amount - totalHT,
      totalTTC: invoice.amount,
      qrCode: (stored as any)?.qr_code || invoice.invoice_number,
      referenceCode,
      coEvent,
    };
  }

  async function handleDownload(inv: Invoice) {
    setDownloadingId(inv.id);
    try {
      const data = await buildInvoiceData(inv);
      if (data) {
        const suffix = data.coEvent ? `-${data.coEvent.viewerSide}` : '';
        await downloadInvoicePDF(data, `facture-${inv.invoice_number}${suffix}.pdf`, language);
        toast.success(t('coInv.downloaded'));
      }
    } catch (err) {
      console.error(err);
      toast.error(t('coInv.downloadError'));
    } finally {
      setDownloadingId(null);
    }
  }

  async function exportCSV() {
    if (filtered.length === 0) { toast.error(t('coInv.nothingToExport')); return; }
    setExporting(true);
    const isCo = isCoEvent && (viewMode === 'venue' || viewMode === 'organizer');
    const headers = isCo
      ? [t('coInv.csvNumber'), t('coInv.csvDate'), t('coInv.csvType'), t('coInv.csvAmountTTC'), t('coInv.csvYunoFees'), t('coInv.csvNetToSplit'), t('coInv.csvMyShare'), t('coInv.csvPartnerShare'), t('coInv.csvClient'), t('coInv.csvEmail')]
      : [t('coInv.csvNumber'), t('coInv.csvDate'), t('coInv.csvType'), t('coInv.csvAmount'), t('coInv.csvClient'), t('coInv.csvEmail')];
    const rows = filtered.map(i => {
      const base = [
        i.invoice_number,
        format(new Date(i.created_at), 'dd/MM/yyyy HH:mm'),
        i.type === 'ticket' ? t('coInv.badgeTicket') : i.type === 'table' ? t('coInv.tablesVip') : t('coInv.badgeDrink'),
      ];
      if (isCo && (viewMode === 'venue' || viewMode === 'organizer')) {
        const me = computeShare(i, viewMode);
        const them = computeShare(i, viewMode === 'venue' ? 'organizer' : 'venue');
        return [
          ...base,
          `${i.amount.toFixed(2)} €`,
          `${me.yuno.toFixed(2)} €`,
          `${me.net.toFixed(2)} €`,
          `${me.share.toFixed(2)} €`,
          `${them.share.toFixed(2)} €`,
          i.customer_name || '-',
          i.customer_email,
        ];
      }
      return [...base, `${i.amount.toFixed(2)} €`, i.customer_name || '-', i.customer_email];
    });
    const csv = [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `factures-event-${eventId.slice(0, 8)}-${viewMode}-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setExporting(false);
    toast.success(`${filtered.length} ${t('coInv.exported')}`);
  }

  if (loading) return <Skeleton className="h-64 w-full" />;

  const typeIcon = (t: InvoiceType) =>
    t === 'ticket' ? <Ticket className="h-3.5 w-3.5" />
    : t === 'table' ? <Sparkles className="h-3.5 w-3.5" />
    : <Wine className="h-3.5 w-3.5" />;

  const typeBadge = (t: InvoiceType) =>
    t === 'ticket' ? 'bg-red-500/15 text-red-500 border-red-500/30'
    : t === 'table' ? 'bg-amber-500/15 text-amber-500 border-amber-500/30'
    : 'bg-blue-500/15 text-blue-500 border-blue-500/30';

  const showCoSelector = isCoEvent && (myRole === 'venue' || myRole === 'organizer');

  return (
    <div className="space-y-4">
      {/* Co-event banner + view selector */}
      {showCoSelector && (
        <Card className="owner-card border-0 border-l-2 border-l-primary">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <Handshake className="h-4 w-4 text-primary" />
              <span className="font-medium">{t('coInv.coEventDetected')}</span>
              <Badge variant="outline" className="text-[10px]">
                {eventCo?.event_mode === 'venue_rental' ? t('coInv.modeRental') : eventCo?.event_mode === 'org_hosted' ? t('coInv.modeHosted') : t('coInv.modeCoEvent')}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('coInv.perspectiveNote')}
            </p>
            <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewerSide)}>
              <TabsList className="grid grid-cols-3 w-full">
                <TabsTrigger value="customer" className="gap-1.5 text-xs">
                  <Eye className="h-3 w-3" /> {t('coInv.viewCustomer')}
                </TabsTrigger>
                <TabsTrigger value="venue" className="gap-1.5 text-xs">
                  <Building2 className="h-3 w-3" /> {t('coInv.sideClub')}{myRole === 'venue' ? t('coInv.youSuffix') : ''}
                </TabsTrigger>
                <TabsTrigger value="organizer" className="gap-1.5 text-xs">
                  <User className="h-3 w-3" /> {t('coInv.sideOrg')}{myRole === 'organizer' ? t('coInv.youSuffix') : ''}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </CardContent>
        </Card>
      )}

      {/* KPIs - adaptive */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="owner-card border-0"><CardContent className="p-3 text-center">
          <p className="text-2xl font-bold">{totals.count}</p>
          <p className="text-[10px] text-muted-foreground">{t('coInv.invoices')}</p>
        </CardContent></Card>
        <Card className="owner-card border-0"><CardContent className="p-3 text-center">
          <p className="text-2xl font-bold">{totals.total.toFixed(0)} €</p>
          <p className="text-[10px] text-muted-foreground">{t('coInv.totalCollected')}</p>
        </CardContent></Card>
        {showCoSelector && (viewMode === 'venue' || viewMode === 'organizer') ? (
          <>
            <Card className="owner-card border-0 ring-1 ring-primary/40"><CardContent className="p-3 text-center">
              <p className="text-2xl font-bold text-primary">{totals.yourShare.toFixed(0)} €</p>
              <p className="text-[10px] text-muted-foreground">
                {viewMode === 'venue' ? t('coInv.clubShare') : t('coInv.organizerShare')}
              </p>
            </CardContent></Card>
            <Card className="owner-card border-0"><CardContent className="p-3 text-center">
              <p className="text-2xl font-bold text-muted-foreground">{totals.partnerShare.toFixed(0)} €</p>
              <p className="text-[10px] text-muted-foreground">{t('coInv.partnerShare')}</p>
            </CardContent></Card>
          </>
        ) : (
          <>
            <Card className="owner-card border-0"><CardContent className="p-3 text-center">
              <p className="text-2xl font-bold">{totals.byType.ticket.toFixed(0)} €</p>
              <p className="text-[10px] text-muted-foreground">{t('coInv.tickets')}</p>
            </CardContent></Card>
            <Card className="owner-card border-0"><CardContent className="p-3 text-center">
              <p className="text-2xl font-bold">{totals.byType.table.toFixed(0)} €</p>
              <p className="text-[10px] text-muted-foreground">{t('coInv.tables')}</p>
            </CardContent></Card>
          </>
        )}
      </div>

      {/* Filters */}
      <Card className="owner-card border-0">
        <CardContent className="p-3 flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('coInv.searchPlaceholder')} className="pl-8" />
          </div>
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as any)}>
            <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('coInv.allTypes')}</SelectItem>
              <SelectItem value="ticket">{t('coInv.tickets')}</SelectItem>
              <SelectItem value="table">{t('coInv.tablesVip')}</SelectItem>
              <SelectItem value="order">{t('coInv.drinks')}</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={exportCSV} disabled={exporting || filtered.length === 0}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 mr-2" />}
            CSV
          </Button>
        </CardContent>
      </Card>

      {/* List */}
      <Card className="owner-card border-0">
        <CardHeader>
          <CardTitle className="text-base">
            {t('coInv.eventInvoices')}
            {showCoSelector && viewMode !== 'customer' && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                — {t('coInv.viewWord')} {viewMode === 'venue' ? t('coInv.clubWord') : t('coInv.orgWord')}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">{t('coInv.noInvoices')}</p>
          ) : (
            <div className="divide-y divide-border/50 max-h-[500px] overflow-y-auto">
              {filtered.map(inv => {
                const co = showCoSelector && (viewMode === 'venue' || viewMode === 'organizer')
                  ? computeShare(inv, viewMode) : null;
                return (
                  <div key={inv.id} className="py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <Badge variant="outline" className={`text-[10px] gap-1 ${typeBadge(inv.type)}`}>
                          {typeIcon(inv.type)} {inv.type === 'ticket' ? t('coInv.badgeTicket') : inv.type === 'table' ? t('coInv.badgeTable') : t('coInv.badgeDrink')}
                        </Badge>
                        <span className="font-mono text-xs text-muted-foreground">{inv.invoice_number}</span>
                      </div>
                      <div className="text-sm font-medium truncate">{inv.customer_name || inv.customer_email}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {format(new Date(inv.created_at), 'dd MMM yyyy · HH:mm', { locale: dfLocale(language) })}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {co ? (
                        <>
                          <div className="font-mono text-sm font-semibold text-primary">{co.share.toFixed(2)} €</div>
                          <div className="text-[10px] text-muted-foreground">
                            {t('coInv.onWord')} {inv.amount.toFixed(2)} € · {co.pct.toFixed(0)}%
                          </div>
                        </>
                      ) : (
                        <div className="font-mono text-sm font-semibold">{inv.amount.toFixed(2)} €</div>
                      )}
                      <Button size="sm" variant="ghost" className="h-7 text-xs mt-1" onClick={() => handleDownload(inv)} disabled={downloadingId === inv.id}>
                        {downloadingId === inv.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3 mr-1" />}
                        PDF
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
