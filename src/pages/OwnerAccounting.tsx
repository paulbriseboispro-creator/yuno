import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { useVenueContext } from '@/hooks/useVenueContext';
import { useDashboardMode } from '@/contexts/DashboardModeContext';
import { OwnerHeader } from '@/components/OwnerHeader';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import {
  OrgCard, OrgEmptyState, POS, T1, T2, T3, BORDER, INNER_BG, C_FAINT,
} from '@/components/org-ui';
import { calcStripeFee } from '@/utils/fees';
import {
  computeYunoFee, getEffectiveSplit, type InvoiceType,
} from '@/utils/coEventSplit';
import { downloadAccountingPDF, type AccountingPdfLine } from '@/lib/generateAccountingPDF';
import { startOfMonth, endOfMonth, subMonths, format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { Calculator, Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const dfLocale = (lng: string) => (lng === 'fr' ? fr : lng === 'es' ? es : enUS);
const r2 = (n: number) => Math.round(n * 100) / 100;
const eur = (n: number) => `${(n || 0).toFixed(2)} €`;

// Guard against malformed dates: a truthy-but-invalid `start_at`/`created_at`
// string would make date-fns `format()` throw "Invalid time value" mid-render
// and crash the whole page through the route ErrorBoundary.
const safeDate = (s?: string | null): Date | null => {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};
const safeFormat = (s: string | null | undefined, fmt: string, opts?: Parameters<typeof format>[2]): string => {
  const d = safeDate(s);
  return d ? format(d, fmt, opts) : '';
};

interface EventRow {
  id: string;
  title: string | null;
  start_at: string | null;
  event_mode: string | null;
  revenue_split_rules: any;
  venue_id: string | null;
  partner_venue_id: string | null;
  organizer_user_id: string | null;
  partner_organizer_id: string | null;
}

interface InvoiceRow {
  id: string;
  type: InvoiceType;
  amount: number;
  event_id: string | null;
  event_name: string | null;
  customer_name: string | null;
  customer_email: string;
  invoice_number: string;
  created_at: string;
  items: any;
  ticket_id: string | null;
  table_reservation_id: string | null;
  order_id: string | null;
}

interface ReportLine { label: string; qty: number; htShare: number; ttcShare: number; }
interface EventReport {
  event: EventRow;
  lines: ReportLine[];
  invoices: InvoiceRow[];
  creatorPct: number;
  ttc: number;
  ht: number;
  vat: number;
  yuno: number;
  stripe: number;
  refund: number;
}

/** Mirrors EventInvoicesModule's co-event detection. */
function isCoEvent(ev: EventRow): boolean {
  return (
    ev.event_mode === 'co_event' || ev.event_mode === 'venue_rental' || ev.event_mode === 'org_hosted'
    || (!!ev.venue_id && !!ev.partner_organizer_id)
    || (!!ev.organizer_user_id && !!ev.partner_venue_id)
  );
}

function txnId(inv: InvoiceRow): string | null {
  return inv.ticket_id || inv.table_reservation_id || inv.order_id;
}

/**
 * Shared accounting page for the Owner club dashboard AND the Organizer app.
 * Aggregates the issued invoices across every event the viewer is party to,
 * one card per event, applying the co-production split so all figures reflect
 * "your share". Mounted at /owner/accounting and /organizer-app/accounting.
 */
export default function OwnerAccounting() {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const { venueId, organizerUserId, scope, loading: venueLoading } = useVenueContext();
  const { basePath } = useDashboardMode();
  const isOrganizerScope = scope === 'organizer';
  const side: 'venue' | 'organizer' = isOrganizerScope ? 'organizer' : 'venue';
  const scopeReady = isOrganizerScope ? !!organizerUserId : !!venueId;

  const [vatRate, setVatRate] = useState(20);
  const [period, setPeriod] = useState<string>(format(new Date(), 'yyyy-MM'));
  const [reports, setReports] = useState<EventReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Last 12 months + all-time, for the period selector.
  const periodOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [{ value: 'all', label: t('acct.allTime') }];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = subMonths(now, i);
      opts.push({ value: format(d, 'yyyy-MM'), label: format(d, 'MMMM yyyy', { locale: dfLocale(language) }) });
    }
    return opts;
  }, [language, t]);

  useEffect(() => {
    if (!scopeReady) return;
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId, organizerUserId, isOrganizerScope, scopeReady, period]);

  async function fetchAll() {
    setLoading(true);
    try {
      const scopeId = isOrganizerScope ? organizerUserId! : venueId!;
      const ownCol = isOrganizerScope ? 'organizer_user_id' : 'venue_id';
      const partnerCol = isOrganizerScope ? 'partner_organizer_id' : 'partner_venue_id';

      const { data: evData, error: evErr } = await supabase
        .from('events')
        .select('id, title, start_at, event_mode, revenue_split_rules, venue_id, partner_venue_id, organizer_user_id, partner_organizer_id')
        .or(`${ownCol}.eq.${scopeId},${partnerCol}.eq.${scopeId}`)
        .order('start_at', { ascending: false });
      if (evErr) throw evErr;

      const events = (evData || []) as EventRow[];
      const eventMap = new Map(events.map(e => [e.id, e]));
      const eventIds = events.map(e => e.id);
      if (eventIds.length === 0) { setReports([]); setLoading(false); return; }

      let invQuery = supabase.from('invoices').select('*').in('event_id', eventIds).order('created_at', { ascending: false });
      if (period !== 'all') {
        const [yy, mm] = period.split('-').map(Number);
        invQuery = invQuery
          .gte('created_at', startOfMonth(new Date(yy, mm - 1)).toISOString())
          .lte('created_at', endOfMonth(new Date(yy, mm - 1)).toISOString());
      }
      const { data: invData, error: invErr } = await invQuery;
      if (invErr) throw invErr;
      const invoices = ((invData || []) as any[]).map(i => ({
        id: i.id, type: i.type as InvoiceType, amount: Number(i.amount) || 0,
        event_id: i.event_id, event_name: i.event_name,
        customer_name: i.customer_name, customer_email: i.customer_email || '',
        invoice_number: i.invoice_number, created_at: i.created_at, items: i.items,
        ticket_id: i.ticket_id, table_reservation_id: i.table_reservation_id, order_id: i.order_id,
      })) as InvoiceRow[];

      // Refund amounts live on the raw sales tables, not on invoices.
      const ticketIds = invoices.map(i => i.ticket_id).filter(Boolean) as string[];
      const tableIds = invoices.map(i => i.table_reservation_id).filter(Boolean) as string[];
      const orderIds = invoices.map(i => i.order_id).filter(Boolean) as string[];
      const refundMap = new Map<string, number>();
      const [tk, tb, od] = await Promise.all([
        ticketIds.length ? supabase.from('tickets').select('id, refund_amount').in('id', ticketIds) : Promise.resolve({ data: [] }),
        tableIds.length ? supabase.from('table_reservations').select('id, refund_amount').in('id', tableIds) : Promise.resolve({ data: [] }),
        orderIds.length ? supabase.from('orders').select('id, refund_amount').in('id', orderIds) : Promise.resolve({ data: [] }),
      ]);
      [...((tk as any).data || []), ...((tb as any).data || []), ...((od as any).data || [])]
        .forEach((r: any) => { if (Number(r.refund_amount)) refundMap.set(r.id, Number(r.refund_amount)); });

      // Group invoices per event and compute the viewer's share.
      const byEvent = new Map<string, InvoiceRow[]>();
      invoices.forEach(inv => {
        if (!inv.event_id) return;
        if (!byEvent.has(inv.event_id)) byEvent.set(inv.event_id, []);
        byEvent.get(inv.event_id)!.push(inv);
      });

      const built: EventReport[] = [];
      for (const [eid, invs] of byEvent) {
        const ev = eventMap.get(eid);
        if (!ev) continue;
        const co = isCoEvent(ev);
        const lineGroups = new Map<string, ReportLine>();
        let ttcTotal = 0, grossClubTotal = 0, yunoTotal = 0, stripeTotal = 0, refundTotal = 0;

        for (const inv of invs) {
          const split = getEffectiveSplit(ev.revenue_split_rules, inv.type, ev.event_mode);
          const pct = co ? (side === 'venue' ? split.venue_pct : split.organizer_pct) : 100;
          const yuno = computeYunoFee(inv.type, inv.amount);
          const grossClub = inv.amount - yuno;
          const ttc = r2(grossClub * pct / 100);
          const factor = pct / 100;
          ttcTotal += ttc;
          grossClubTotal += grossClub;
          yunoTotal += r2(yuno * factor);
          stripeTotal += r2(calcStripeFee(inv.amount) * factor);
          const tid = txnId(inv);
          refundTotal += r2((tid ? refundMap.get(tid) || 0 : 0) * factor);

          // Distribute this invoice's share across its line items.
          let items = Array.isArray(inv.items) ? inv.items as any[] : [];
          if (items.length === 0) items = [{ description: inv.event_name || labelForType(inv.type, t), quantity: 1, total: inv.amount }];
          const sumItems = items.reduce((s, it) => s + (Number(it.total) || 0), 0);
          items.forEach(it => {
            const weight = sumItems > 0 ? (Number(it.total) || 0) / sumItems : 1 / items.length;
            const lineTtc = r2(ttc * weight);
            const key = (it.description || labelForType(inv.type, t)).toString();
            const g = lineGroups.get(key) || { label: key, qty: 0, htShare: 0, ttcShare: 0 };
            g.qty += Number(it.quantity) || 0;
            g.ttcShare += lineTtc;
            lineGroups.set(key, g);
          });
        }

        const ttc = r2(ttcTotal);
        const ht = r2(ttc / (1 + vatRate / 100));
        const lines = [...lineGroups.values()].map(l => ({
          ...l, ttcShare: r2(l.ttcShare), htShare: r2(l.ttcShare / (1 + vatRate / 100)),
        })).sort((a, b) => b.ttcShare - a.ttcShare);

        built.push({
          event: ev, invoices: invs, lines,
          creatorPct: grossClubTotal > 0 ? r2((ttcTotal / grossClubTotal) * 100) : 100,
          ttc, ht, vat: r2(ttc - ht),
          yuno: r2(yunoTotal), stripe: r2(stripeTotal), refund: r2(refundTotal),
        });
      }

      built.sort((a, b) => new Date(b.event.start_at || 0).getTime() - new Date(a.event.start_at || 0).getTime());
      setReports(built);
    } catch (err) {
      console.error(err);
      toast.error(t('acct.loadError'));
    } finally {
      setLoading(false);
    }
  }

  // Recompute HT/VAT split when the VAT selector changes (cheap, no refetch).
  const displayReports = useMemo(() => reports.map(rep => {
    const ht = r2(rep.ttc / (1 + vatRate / 100));
    return {
      ...rep, ht, vat: r2(rep.ttc - ht),
      lines: rep.lines.map(l => ({ ...l, htShare: r2(l.ttcShare / (1 + vatRate / 100)) })),
    };
  }), [reports, vatRate]);

  const totals = useMemo(() => {
    const ttc = r2(displayReports.reduce((s, r) => s + r.ttc, 0));
    const ht = r2(ttc / (1 + vatRate / 100));
    const yuno = r2(displayReports.reduce((s, r) => s + r.yuno, 0));
    const stripe = r2(displayReports.reduce((s, r) => s + r.stripe, 0));
    const refund = r2(displayReports.reduce((s, r) => s + r.refund, 0));
    return { ttc, ht, vat: r2(ttc - ht), yuno, stripe, refund, net: r2(ttc - stripe - refund) };
  }, [displayReports, vatRate]);

  async function handlePdf(rep: EventReport, lang: 'fr' | 'en') {
    setDownloading(`${rep.event.id}-${lang}`);
    try {
      const lines: AccountingPdfLine[] = rep.lines.map(l => ({
        label: l.label, qty: l.qty, htShare: r2(l.ttcShare / (1 + vatRate / 100)), ttcShare: l.ttcShare,
      }));
      const ht = r2(rep.ttc / (1 + vatRate / 100));
      downloadAccountingPDF({
        venueName: rep.event.title || '',
        eventTitle: rep.event.title || '—',
        eventDate: rep.event.start_at ? new Date(rep.event.start_at) : undefined,
        creatorSharePct: rep.creatorPct,
        vatRate,
        lines,
        totalHt: ht,
        totalVat: r2(rep.ttc - ht),
        totalBalance: rep.ttc,
      }, `compta-${(rep.event.title || 'event').slice(0, 24).replace(/\s+/g, '-')}-${lang}.pdf`, lang);
    } finally {
      setDownloading(null);
    }
  }

  function exportCSV() {
    if (displayReports.length === 0) { toast.error(t('acct.nothingToExport')); return; }
    setExporting(true);
    try {
      const headers = [
        t('acct.csvEvent'), t('acct.csvDate'), t('acct.csvInvoice'), t('acct.csvType'),
        t('acct.csvClient'), t('acct.csvAmountTtc'), t('acct.csvShareTtc'), t('acct.csvShareHt'), t('acct.csvVat'),
      ];
      const rows: string[][] = [];
      displayReports.forEach(rep => {
        const co = isCoEvent(rep.event);
        rep.invoices.forEach(inv => {
          const split = getEffectiveSplit(rep.event.revenue_split_rules, inv.type, rep.event.event_mode);
          const pct = co ? (side === 'venue' ? split.venue_pct : split.organizer_pct) : 100;
          const ttcShare = r2((inv.amount - computeYunoFee(inv.type, inv.amount)) * pct / 100);
          const htShare = r2(ttcShare / (1 + vatRate / 100));
          rows.push([
            rep.event.title || '', safeFormat(inv.created_at, 'dd/MM/yyyy'),
            inv.invoice_number, labelForType(inv.type, t),
            inv.customer_name || inv.customer_email,
            inv.amount.toFixed(2), ttcShare.toFixed(2), htShare.toFixed(2), r2(ttcShare - htShare).toFixed(2),
          ]);
        });
      });
      const csv = [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `compta-${period}-${side}-${format(new Date(), 'yyyy-MM-dd')}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success(`${rows.length} ${t('acct.exported')}`);
    } finally {
      setExporting(false);
    }
  }

  if (venueLoading || (loading && reports.length === 0)) {
    return (
      <div>
        {!isOrganizerScope && <OwnerHeader title={t('acct.title')} />}
        <OwnerPageSkeleton />
      </div>
    );
  }

  const selectStyle: React.CSSProperties = {
    background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10,
    color: T1, fontSize: 13, padding: '8px 11px', outline: 'none', cursor: 'pointer',
  };

  const periodVatControls = (
    <div className="flex items-center gap-2">
      <select value={period} onChange={e => setPeriod(e.target.value)} style={selectStyle}>
        {periodOptions.map(o => <option key={o.value} value={o.value} style={{ background: '#0a0a0c' }}>{o.label}</option>)}
      </select>
      <select value={vatRate} onChange={e => setVatRate(Number(e.target.value))} style={selectStyle}>
        {[20, 10, 5.5, 0].map(rt => <option key={rt} value={rt} style={{ background: '#0a0a0c' }}>{t('acct.vat')} {rt}%</option>)}
      </select>
    </div>
  );

  return (
    <div>
      {/* Organizer scope renders inside the org shell (which already has its own
          header + OwnerVenueProvider-free context), so we surface the title and
          controls in-body instead of via OwnerHeader to avoid the provider crash. */}
      {!isOrganizerScope && <OwnerHeader title={t('acct.title')} rightContent={periodVatControls} />}

      <div className="mx-auto max-w-5xl px-4 pb-16">
        {isOrganizerScope && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h1 style={{ color: T1, fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>{t('acct.title')}</h1>
            {periodVatControls}
          </div>
        )}
        <p style={{ color: T3, fontSize: 13, marginBottom: 16 }}>{t('acct.subtitle')}</p>

        {/* Global summary */}
        <OrgCard className="mb-5" style={{ padding: 20 }}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-y-5 gap-x-3">
            <Kpi label={t('acct.kpiHt')} value={eur(totals.ht)} />
            <Kpi label={t('acct.kpiVat')} value={eur(totals.vat)} />
            <Kpi label={t('acct.kpiTtc')} value={eur(totals.ttc)} />
            <Kpi label={t('acct.kpiNet')} value={eur(totals.net)} accent={POS} />
            <Kpi label={t('acct.kpiYuno')} value={`- ${eur(totals.yuno)}`} muted />
            <Kpi label={t('acct.kpiStripe')} value={`- ${eur(totals.stripe)}`} muted />
            <Kpi label={t('acct.kpiRefunds')} value={`- ${eur(totals.refund)}`} muted />
            <div className="flex items-end">
              <button
                onClick={exportCSV}
                disabled={exporting || displayReports.length === 0}
                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12.5px] font-semibold disabled:opacity-50"
                style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}
              >
                {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                {t('acct.exportCsv')}
              </button>
            </div>
          </div>
        </OrgCard>

        {/* Per-event cards */}
        {displayReports.length === 0 ? (
          <OrgEmptyState icon={Calculator} title={t('acct.emptyTitle')} description={t('acct.emptyDesc')} />
        ) : (
          <div className="space-y-4">
            {displayReports.map(rep => (
              <OrgCard key={rep.event.id} style={{ padding: 22 }}>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 style={{ color: T1, fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em' }}>
                      {rep.event.title || '—'}
                    </h3>
                    <p style={{ color: T3, fontSize: 12, marginTop: 3 }}>
                      {safeFormat(rep.event.start_at, 'EEEE d MMMM yyyy', { locale: dfLocale(language) })}
                      {'  ·  '}{t('acct.creatorShare')}: {rep.creatorPct.toFixed(2)}%
                      {'  ·  '}{t('acct.vat')}: {vatRate}%
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 gap-2">
                    <PdfBtn loading={downloading === `${rep.event.id}-fr`} onClick={() => handlePdf(rep, 'fr')} label="PDF FR" />
                    <PdfBtn loading={downloading === `${rep.event.id}-en`} onClick={() => handlePdf(rep, 'en')} label="PDF EN" />
                  </div>
                </div>

                {/* Line items */}
                <div className="overflow-x-auto">
                  <table className="w-full" style={{ borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ color: T3, textAlign: 'left' }}>
                        <th style={{ padding: '6px 8px', fontWeight: 600 }}>{t('acct.colRate')}</th>
                        <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right' }}>{t('acct.colQty')}</th>
                        <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right' }}>{t('acct.colHt')}</th>
                        <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right' }}>{t('acct.colTtc')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rep.lines.map((l, i) => (
                        <tr key={i} style={{ borderTop: `1px solid ${BORDER}`, color: T1 }}>
                          <td style={{ padding: '9px 8px' }}>{l.label}</td>
                          <td style={{ padding: '9px 8px', textAlign: 'right', color: T2 }}>{l.qty}</td>
                          <td style={{ padding: '9px 8px', textAlign: 'right', color: T2, fontVariantNumeric: 'tabular-nums' }}>{eur(l.htShare)}</td>
                          <td style={{ padding: '9px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{eur(l.ttcShare)}</td>
                        </tr>
                      ))}
                      <tr style={{ borderTop: `1px solid ${BORDER}`, color: T2 }}>
                        <td colSpan={3} style={{ padding: '9px 8px', textAlign: 'right', fontWeight: 600 }}>{t('acct.totalHt')}</td>
                        <td style={{ padding: '9px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{eur(rep.ht)}</td>
                      </tr>
                      <tr style={{ color: T2 }}>
                        <td colSpan={3} style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600 }}>{t('acct.vat')}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{eur(rep.vat)}</td>
                      </tr>
                      <tr style={{ borderTop: `1px solid ${BORDER}` }}>
                        <td colSpan={3} style={{ padding: '11px 8px', textAlign: 'right', color: T1, fontWeight: 800, letterSpacing: '0.02em' }}>{t('acct.totalBalance')}</td>
                        <td style={{ padding: '11px 8px', textAlign: 'right', color: T1, fontSize: 18, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{eur(rep.ttc)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </OrgCard>
            ))}
          </div>
        )}

        <p style={{ color: T3, fontSize: 11.5, marginTop: 18, lineHeight: 1.5 }}>{t('acct.footnote')}</p>
      </div>
    </div>
  );
}

function labelForType(type: InvoiceType, t: (k: string) => string): string {
  return type === 'ticket' ? t('acct.typeTicket') : type === 'table' ? t('acct.typeTable') : t('acct.typeDrink');
}

function Kpi({ label, value, accent, muted }: { label: string; value: string; accent?: string; muted?: boolean }) {
  return (
    <div>
      <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</p>
      <p style={{ color: accent || (muted ? T2 : T1), fontSize: 19, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</p>
    </div>
  );
}

function PdfBtn({ loading, onClick, label }: { loading: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold disabled:opacity-50"
      style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
}
