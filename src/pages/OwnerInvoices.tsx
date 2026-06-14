import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';
import { useVenueContext } from '@/hooks/useVenueContext';
import { useCollabReadOnly } from '@/hooks/useCollabReadOnly';
import { OwnerHeader } from '@/components/OwnerHeader';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { supabase } from '@/integrations/supabase/client';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, subMonths, startOfYear, endOfYear } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { Search, Download, FileText, ChevronDown, Ticket, Wine, Sparkles, Loader2, FileSpreadsheet, Files, Archive, X } from 'lucide-react';
import { toast } from 'sonner';
import { downloadInvoicePDF, generateInvoicePDF, InvoiceData, InvoiceItem } from '@/lib/generateInvoicePDF';
import { PDFDocument } from 'pdf-lib';

type InvoiceType = 'ticket' | 'table' | 'order';
type ExportPeriod = 'week' | 'month' | 'quarter' | 'semester' | 'year';

// ─── Yuno Design Tokens ──────────────────────────────────────────────────────
const RED       = '#E8192C';
const T1        = 'rgba(255,255,255,0.96)';
const T2        = 'rgba(255,255,255,0.58)';
const T3        = 'rgba(255,255,255,0.36)';
const BORDER    = 'rgba(255,255,255,0.085)';
const F_BORDER  = 'rgba(255,255,255,0.055)';
const C_FAINT   = 'rgba(255,255,255,0.06)';
const INNER_BG  = 'rgba(255,255,255,0.032)';
const CARD_BG   = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

const TYPE_CFG: Record<InvoiceType, { label_key: string; color: string; bg: string; border: string; Icon: React.FC<any> }> = {
  ticket: { label_key: 'invoices.ticket',   color: RED,       bg: 'rgba(232,25,44,0.10)',    border: 'rgba(232,25,44,0.30)',   Icon: Ticket   },
  table:  { label_key: 'invoices.vipTable', color: '#FCD34D', bg: 'rgba(251,191,36,0.10)',  border: 'rgba(251,191,36,0.25)',  Icon: Sparkles },
  order:  { label_key: 'invoices.order',    color: '#818CF8', bg: 'rgba(129,140,248,0.10)', border: 'rgba(129,140,248,0.25)', Icon: Wine     },
};

function Chip({ label, color, bg, border, icon }: { label: string; color: string; bg: string; border: string; icon?: React.ReactNode }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
      color, background: bg, border: `1px solid ${border}`, whiteSpace: 'nowrap',
    }}>{icon}{label}</span>
  );
}

function ExportDropdown({ label, icon, periods, onSelect, loading, disabled }: {
  label: string; icon: React.ReactNode;
  periods: Record<ExportPeriod, string>;
  onSelect: (p: ExportPeriod) => void;
  loading: boolean; disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handler(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => !disabled && setOpen(!open)}
        className="flex items-center gap-2 transition-all duration-150"
        style={{
          background: INNER_BG, border: `1px solid ${open ? 'rgba(255,255,255,0.15)' : BORDER}`,
          borderRadius: 10, padding: '8px 12px', color: disabled ? T3 : T1,
          fontSize: 13, fontWeight: 500, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
        }}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
        {label}
        <ChevronDown className="h-3.5 w-3.5" style={{ color: T3, transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s' }} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }}
            style={{
              position: 'absolute', top: 'calc(100% + 6px)', right: 0,
              background: '#0a0a0c', border: `1px solid ${BORDER}`,
              borderRadius: 12, overflow: 'hidden', zIndex: 50,
              boxShadow: '0 20px 40px -12px rgba(0,0,0,0.9)', minWidth: 160,
            }}
          >
            {(Object.entries(periods) as [ExportPeriod, string][]).map(([p, lbl]) => (
              <button key={p} onClick={() => { onSelect(p); setOpen(false); }}
                className="w-full flex items-center px-4 py-3 text-left transition-all duration-150"
                style={{ borderBottom: `1px solid ${F_BORDER}`, color: T2, fontSize: 13 }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = C_FAINT; (e.currentTarget as HTMLElement).style.color = T1; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = T2; }}
              >{lbl}</button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

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
  // For PDF generation
  ticket_id: string | null;
  table_reservation_id: string | null;
  order_id: string | null;
}

export default function OwnerInvoices() {
  const { language, t } = useLanguage();
  const { venueId, venue, organizerUserId, scope, loading: venueLoading } = useVenueContext();
  const isOrganizerScope = scope === 'organizer';
  const { canExport } = useCollabReadOnly();
  // In organizer scope there is no venue, so the PDF issuer block is built from the
  // organizer's own legal profile instead of the venue's.
  const allowExport = isOrganizerScope ? true : canExport;
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [orgIssuer, setOrgIssuer] = useState<{
    name: string; legalName?: string; address?: string; siret?: string; vatNumber?: string; email?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | InvoiceType>('all');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [exportingPeriod, setExportingPeriod] = useState<ExportPeriod | null>(null);

  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  useEffect(() => {
    if (isOrganizerScope ? organizerUserId : venueId) {
      fetchInvoices();
    }
  }, [venueId, organizerUserId, isOrganizerScope]);

  const fetchInvoices = async () => {
    if (isOrganizerScope ? !organizerUserId : !venueId) return;
    setLoading(true);

    try {
      let invoiceData: any[] | null = null;
      let error: any = null;

      if (isOrganizerScope) {
        // Organizer scope: invoices tagged with this organizer OR linked to one of their events.
        const { data: events } = await supabase
          .from('events')
          .select('id')
          .or(`organizer_user_id.eq.${organizerUserId},partner_organizer_id.eq.${organizerUserId}`);
        const ids = (events ?? []).map((e) => e.id);
        const orFilter = ids.length > 0
          ? `organizer_user_id.eq.${organizerUserId},event_id.in.(${ids.join(',')})`
          : `organizer_user_id.eq.${organizerUserId}`;
        const res = await supabase
          .from('invoices')
          .select('*')
          .or(orFilter)
          .order('created_at', { ascending: false });
        invoiceData = res.data;
        error = res.error;

        // Load the organizer's legal info once for the PDF issuer block.
        const { data: orgProfile } = await supabase
          .from('organizer_profiles')
          .select('display_name, legal_name, legal_address, siret, vat_number, billing_email')
          .eq('user_id', organizerUserId!)
          .maybeSingle();
        if (orgProfile) {
          setOrgIssuer({
            name: (orgProfile as any).legal_name || (orgProfile as any).display_name || 'Organisateur',
            legalName: (orgProfile as any).legal_name || (orgProfile as any).display_name || undefined,
            address: (orgProfile as any).legal_address || undefined,
            siret: (orgProfile as any).siret || undefined,
            vatNumber: (orgProfile as any).vat_number || undefined,
            email: (orgProfile as any).billing_email || undefined,
          });
        }
      } else {
        // Venue scope: invoices from the dedicated invoices table (stored for 2 years)
        const res = await supabase
          .from('invoices')
          .select('*')
          .eq('venue_id', venueId)
          .order('created_at', { ascending: false });
        invoiceData = res.data;
        error = res.error;
      }

      if (error) throw error;

      const mappedInvoices: Invoice[] = (invoiceData || []).map(inv => ({
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
      }));

      setInvoices(mappedInvoices);
    } catch (error) {
      console.error('Error fetching invoices:', error);
      toast.error(t('invoices.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const filteredInvoices = useMemo(() => {
    return invoices.filter(inv => {
      // Type filter
      if (typeFilter !== 'all' && inv.type !== typeFilter) return false;

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          inv.invoice_number.toLowerCase().includes(query) ||
          inv.customer_email.toLowerCase().includes(query) ||
          (inv.customer_name?.toLowerCase().includes(query)) ||
          (inv.event_name?.toLowerCase().includes(query))
        );
      }

      return true;
    });
  }, [invoices, typeFilter, searchQuery]);

  const getDateRangeForPeriod = (period: ExportPeriod) => {
    const now = new Date();
    switch (period) {
      case 'week':
        return { start: startOfWeek(now, { locale: dateLocale }), end: endOfWeek(now, { locale: dateLocale }) };
      case 'month':
        return { start: startOfMonth(now), end: endOfMonth(now) };
      case 'quarter':
        return { start: startOfQuarter(now), end: endOfQuarter(now) };
      case 'semester':
        return { start: subMonths(startOfMonth(now), 5), end: endOfMonth(now) };
      case 'year':
        return { start: startOfYear(now), end: endOfYear(now) };
    }
  };

  const exportInvoicesCSV = (period: ExportPeriod) => {
    const { start, end } = getDateRangeForPeriod(period);
    
    const periodInvoices = invoices.filter(inv => {
      const date = new Date(inv.created_at);
      return date >= start && date <= end;
    });

    if (periodInvoices.length === 0) {
      toast.error(t('invoices.noInvoicesPeriod'));
      return;
    }

    // Generate CSV
    const headers = ['Numéro', 'Date', 'Type', 'Montant', 'Client', 'Email', 'Événement'];
    const rows = periodInvoices.map(inv => [
      inv.invoice_number,
      format(new Date(inv.created_at), 'dd/MM/yyyy HH:mm'),
      inv.type === 'ticket' ? 'Billet' : inv.type === 'table' ? 'Table VIP' : 'Boisson',
      `${inv.amount.toFixed(2)} €`,
      inv.customer_name || '-',
      inv.customer_email,
      inv.event_name || '-',
    ]);

    const csv = [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    
    const periodLabelsFile: Record<ExportPeriod, string> = {
      week: 'semaine',
      month: 'mois',
      quarter: 'trimestre',
      semester: 'semestre',
      year: 'annee',
    };
    
    link.href = url;
    link.download = `factures_${periodLabelsFile[period]}_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    toast.success(t('invoices.exportedCSV').replace('{{count}}', String(periodInvoices.length)));
  };

  const exportInvoicesPDF = async (period: ExportPeriod) => {
    const { start, end } = getDateRangeForPeriod(period);
    
    const periodInvoices = invoices.filter(inv => {
      const date = new Date(inv.created_at);
      return date >= start && date <= end;
    });

    if (periodInvoices.length === 0) {
      toast.error(t('invoices.noInvoicesPeriod'));
      return;
    }

    setExportingPeriod(period);
    toast.info(t('invoices.generating').replace('{{count}}', String(periodInvoices.length)));

    try {
      // Create merged PDF
      const mergedPdf = await PDFDocument.create();
      
      for (const invoice of periodInvoices) {
        // Generate invoice data for each invoice
        const invoiceData = await buildInvoiceData(invoice);
        if (invoiceData) {
          const pdfBlob = await generateInvoicePDF(invoiceData);
          const pdfBytes = await pdfBlob.arrayBuffer();
          const pdf = await PDFDocument.load(pdfBytes);
          const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
          copiedPages.forEach((page) => mergedPdf.addPage(page));
        }
      }

      // Download merged PDF
      const mergedPdfBytes = await mergedPdf.save();
      const blob = new Blob([new Uint8Array(mergedPdfBytes)], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      
      const periodLabelsFile: Record<ExportPeriod, string> = {
        week: 'semaine',
        month: 'mois',
        quarter: 'trimestre',
        semester: 'semestre',
        year: 'annee',
      };
      
      link.href = url;
      link.download = `factures_${periodLabelsFile[period]}_${format(new Date(), 'yyyy-MM-dd')}.pdf`;
      link.click();
      URL.revokeObjectURL(url);

      toast.success(t('invoices.exportedPDF').replace('{{count}}', String(periodInvoices.length)));
    } catch (error) {
      console.error('Error exporting PDF:', error);
      toast.error(t('invoices.exportError'));
    } finally {
      setExportingPeriod(null);
    }
  };

  const buildInvoiceData = async (invoice: Invoice): Promise<InvoiceData | null> => {
    // Fetch stored items from invoices table
    const { data: storedInvoice } = await supabase
      .from('invoices')
      .select('items, service_fee, management_fee, insurance_fee, qr_code')
      .eq('id', invoice.id)
      .maybeSingle();

    let items: InvoiceItem[] = [];
    let serviceFee = Number(storedInvoice?.service_fee) || 0;
    let managementFee = Number(storedInvoice?.management_fee) || 0;
    let insuranceFee = Number(storedInvoice?.insurance_fee) || 0;
    let qrCode = storedInvoice?.qr_code || invoice.invoice_number;

    if (storedInvoice?.items && Array.isArray(storedInvoice.items)) {
      items = (storedInvoice.items as any[]).map(item => ({
        description: item.description || 'Item',
        quantity: item.quantity || 1,
        unitPrice: item.unitPrice || 0,
        total: item.total || 0,
      }));
    } else {
      // Fallback: generate items from type
      if (invoice.type === 'ticket') {
        items = [{
          description: invoice.event_name || t('invoices.ticket'),
          quantity: 1,
          unitPrice: invoice.amount,
          total: invoice.amount,
        }];
      } else if (invoice.type === 'table') {
        items = [{
          description: `${t('invoices.vipTable')} - ${invoice.event_name || ''}`,
          quantity: 1,
          unitPrice: invoice.amount,
          total: invoice.amount,
        }];
      } else {
        items = [{
          description: t('invoices.order'),
          quantity: 1,
          unitPrice: invoice.amount,
          total: invoice.amount,
        }];
      }
    }

    const totalHT = invoice.amount / 1.2;
    const tva = invoice.amount - totalHT;

    return {
      invoiceNumber: invoice.invoice_number,
      invoiceDate: new Date(invoice.created_at),
      paymentDate: new Date(invoice.created_at),
      venueName: isOrganizerScope ? (orgIssuer?.name || 'Organisateur') : (venue?.name || 'Venue'),
      venueLegalName: isOrganizerScope ? (orgIssuer?.legalName || orgIssuer?.name) : (venue?.legalName || venue?.name),
      venueAddress: isOrganizerScope ? orgIssuer?.address : venue?.address,
      venueSiret: isOrganizerScope ? orgIssuer?.siret : venue?.siret,
      venueVatNumber: isOrganizerScope ? orgIssuer?.vatNumber : venue?.vatNumber,
      venueLogoUrl: isOrganizerScope ? undefined : venue?.logoUrl,
      customerName: invoice.customer_name || invoice.customer_email,
      customerEmail: invoice.customer_email,
      customerPhone: invoice.customer_phone || undefined,
      eventTitle: invoice.event_name || undefined,
      eventDate: invoice.event_date ? new Date(invoice.event_date) : undefined,
      eventPosterUrl: invoice.event_poster || undefined,
      type: invoice.type,
      items,
      serviceFee,
      managementFee,
      insuranceFee,
      totalHT,
      tva,
      totalTTC: invoice.amount,
      qrCode,
    };
  };

  const handleDownloadInvoice = async (invoice: Invoice) => {
    setDownloadingId(invoice.id);
    try {
      const invoiceData = await buildInvoiceData(invoice);
      if (invoiceData) {
        await downloadInvoicePDF(invoiceData, `facture-${invoice.invoice_number}.pdf`);
        toast.success(t('invoices.downloaded'));
      }
    } catch (error) {
      console.error('Error downloading invoice:', error);
      toast.error(t('invoices.downloadError'));
    } finally {
      setDownloadingId(null);
    }
  };

  if (loading || venueLoading) return <OwnerPageSkeleton />;

  const periodLabels: Record<ExportPeriod, string> = {
    week: t('invoices.week'), month: t('invoices.month'),
    quarter: t('invoices.quarter'), semester: t('invoices.semester'), year: t('invoices.year'),
  };

  const typeFilters: { value: 'all' | InvoiceType; label: string }[] = [
    { value: 'all', label: t('invoices.allTypes') },
    { value: 'ticket', label: t('invoices.tickets') },
    { value: 'table', label: t('invoices.vipTables') },
    { value: 'order', label: t('invoices.drinks') },
  ];

  return (
    <div className={isOrganizerScope ? 'pb-12' : 'min-h-screen pb-24'} style={isOrganizerScope ? undefined : { background: '#000' }}>
      {!isOrganizerScope && <OwnerHeader title={t('invoices.title')} showBackButton />}

      <div className="mx-auto max-w-7xl p-4">

        {/* Organizer scope renders inside the org shell (which already has a header),
            so we surface the page title in-body instead of via OwnerHeader. */}
        {isOrganizerScope && (
          <div className="mb-5">
            <h1 style={{ color: T1, fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>{t('invoices.title')}</h1>
          </div>
        )}

        {/* Retention Notice */}
        <div className="flex items-start gap-3 mb-6"
          style={{ background: 'rgba(232,25,44,0.05)', border: '1px solid rgba(232,25,44,0.18)', borderRadius: 12, padding: '12px 14px' }}>
          <Archive className="h-4 w-4 mt-0.5 flex-none" style={{ color: RED }} />
          <p style={{ color: T2, fontSize: 13, margin: 0 }}>{t('invoices.retentionNotice')}</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {([
            { label: t('invoices.totalInvoices'), value: invoices.length, color: T1 },
            { label: t('invoices.tickets'), value: invoices.filter(i => i.type === 'ticket').length, color: TYPE_CFG.ticket.color },
            { label: t('invoices.vipTables'), value: invoices.filter(i => i.type === 'table').length, color: TYPE_CFG.table.color },
            { label: t('invoices.drinks'), value: invoices.filter(i => i.type === 'order').length, color: TYPE_CFG.order.color },
          ] as const).map((s, i) => (
            <div key={i} style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 14, boxShadow: CARD_SHADOW, padding: '14px 16px' }}>
              <p style={{ color: T3, fontSize: 11.5, marginBottom: 4 }}>{s.label}</p>
              <p style={{ color: s.color, fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Filters & Export */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: T3 }} />
            <input
              placeholder={t('invoices.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full outline-none"
              style={{
                background: INNER_BG, border: `1px solid ${searchQuery ? 'rgba(255,255,255,0.15)' : BORDER}`,
                borderRadius: 10, padding: '9px 36px 9px 36px', color: T1, fontSize: 13.5, fontFamily: 'inherit',
              }}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: T3 }}>
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex gap-1.5 flex-wrap">
            {typeFilters.map(f => (
              <button key={f.value} onClick={() => setTypeFilter(f.value)}
                style={{
                  background: typeFilter === f.value ? 'rgba(255,255,255,0.06)' : 'transparent',
                  border: `1px solid ${typeFilter === f.value ? 'rgba(255,255,255,0.16)' : BORDER}`,
                  color: typeFilter === f.value ? T1 : T3,
                  borderRadius: 8, padding: '7px 12px', fontSize: 12.5, fontWeight: 500,
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >{f.label}</button>
            ))}
          </div>

          {allowExport ? (
            <div className="flex gap-2">
              <ExportDropdown
                label={t('invoices.exportCSV')} icon={<FileSpreadsheet className="h-4 w-4" />}
                periods={periodLabels} onSelect={exportInvoicesCSV}
                loading={exportingPeriod !== null} disabled={exportingPeriod !== null}
              />
              <ExportDropdown
                label={t('invoices.exportPDF')} icon={<Files className="h-4 w-4" />}
                periods={periodLabels} onSelect={exportInvoicesPDF}
                loading={exportingPeriod !== null} disabled={exportingPeriod !== null}
              />
            </div>
          ) : (
            <div className="flex items-center gap-2"
              style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '8px 12px', color: T3, fontSize: 13, opacity: 0.5 }}
              title="Export indisponible en mode démo Collab"
            >
              <Download className="h-4 w-4" />
              Export désactivé (Collab)
            </div>
          )}
        </div>

        {/* Invoice List */}
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, overflow: 'hidden' }}>
          {filteredInvoices.length === 0 ? (
            <div className="text-center py-16">
              <FileText className="h-10 w-10 mx-auto mb-3" style={{ color: T3 }} />
              <p style={{ color: T3, fontSize: 14 }}>
                {searchQuery || typeFilter !== 'all' ? t('invoices.noResults') : t('invoices.noInvoices')}
              </p>
            </div>
          ) : (
            filteredInvoices.map((invoice, idx) => {
              const cfg = TYPE_CFG[invoice.type];
              const Icon = cfg.Icon;
              return (
                <div key={invoice.id} className="flex items-center gap-3 flex-wrap"
                  style={{ padding: '12px 16px', borderBottom: idx < filteredInvoices.length - 1 ? `1px solid ${F_BORDER}` : 'none' }}>
                  <p style={{ color: T2, fontSize: 12, fontFamily: 'monospace', margin: 0, minWidth: 80 }}>{invoice.invoice_number}</p>
                  <p style={{ color: T3, fontSize: 12, margin: 0, minWidth: 120 }}>
                    {format(new Date(invoice.created_at), 'dd/MM/yyyy HH:mm', { locale: dateLocale })}
                  </p>
                  <Chip label={cfg.label_key ? t(cfg.label_key) : invoice.type} color={cfg.color} bg={cfg.bg} border={cfg.border}
                    icon={<Icon className="h-3 w-3" />} />
                  <p style={{ color: T1, fontSize: 13, fontWeight: 600, margin: 0, minWidth: 60 }}>{invoice.amount.toFixed(2)} €</p>
                  <div className="flex-1 min-w-0">
                    {invoice.customer_name && <p className="truncate" style={{ color: T1, fontSize: 13, fontWeight: 500, margin: 0 }}>{invoice.customer_name}</p>}
                    <p className="truncate" style={{ color: T3, fontSize: 12, margin: 0 }}>{invoice.customer_email}</p>
                  </div>
                  <p className="hidden sm:block truncate" style={{ color: T2, fontSize: 12, margin: 0, maxWidth: 140 }}>{invoice.event_name || '—'}</p>
                  <button
                    onClick={() => handleDownloadInvoice(invoice)}
                    disabled={downloadingId === invoice.id}
                    title={t('invoices.downloadPDF')}
                    className="w-9 h-9 flex items-center justify-center rounded-lg cursor-pointer transition-all duration-150 ml-auto"
                    style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T3 }}
                  >
                    {downloadingId === invoice.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Download className="h-3.5 w-3.5" />
                    }
                  </button>
                </div>
              );
            })
          )}
        </div>

        {filteredInvoices.length > 0 && (
          <p className="mt-3 text-right" style={{ color: T3, fontSize: 12.5 }}>
            {filteredInvoices.length} {t('invoices.invoiceCount')} &bull;{' '}
            {filteredInvoices.reduce((sum, inv) => sum + inv.amount, 0).toFixed(2)} €
          </p>
        )}
      </div>
    </div>
  );
}
