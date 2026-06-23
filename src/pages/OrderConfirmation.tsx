import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { transitions, useReducedMotion } from '@/lib/motion';
import { CheckCircle, Calendar, Clock, MapPin, Users, Ticket, ArrowLeft, FileText, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatInTimeZone } from 'date-fns-tz';
import { fr, enUS, es } from 'date-fns/locale';
import { PARIS_TIMEZONE } from '@/lib/timezone';
import {
  generateReceiptPDF, generateBilletPDF, downloadBlob, receiptLineLabels,
  type ReceiptLine, type DocLang,
} from '@/lib/generateDocuments';
import { toast } from 'sonner';
import QRCode from 'qrcode';
import { WalletButtons } from '@/components/WalletButtons';
import { DrinkCreditsCard } from '@/components/upsell/DrinkCreditsCard';
import { TicketQRCarousel } from '@/components/orders/TicketQRCarousel';
interface UpsellSelection {
  name: string;
  price: number;
  offerType: string;
}

interface ConfirmationData {
  type: 'ticket' | 'table' | 'order';
  id: string;
  qrCode: string;
  eventTitle?: string;
  eventDate?: string;
  eventPosterUrl?: string;
  venueName?: string;
  venueAddress?: string;
  venueLegalName?: string;
  venueSiret?: string;
  venueVatNumber?: string;
  venueLegalAddress?: string;
  venueLogoUrl?: string;
  details?: string;
  quantity?: number;
  guestCount?: number;
  totalPrice?: number;
  serviceFee?: number;
  managementFee?: number;
  insuranceFee?: number;
  unitPrice?: number;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  paidAt?: string;
  attendees?: Array<{ firstName: string; lastName: string }>;
  items?: Array<{ name: string; qty: number; unitPrice: number }>;
  venueId?: string;
  packName?: string;
  packPrice?: number;
  upsellSelections?: UpsellSelection[];
  alcoholFree?: boolean;
  accessDocs?: Array<{ id: string; label: string; fileUrl: string; fileName: string }>;
}

export default function OrderConfirmation() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { t, language } = useLanguage();
  const reduceMotion = useReducedMotion();

  // Entrées de contenu (rares → célébration légitime). Reduced-motion → opacité seule.
  const rise = (delay: number) =>
    reduceMotion
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.3 } }
      : {
          initial: { opacity: 0, y: 20 },
          animate: { opacity: 1, y: 0 },
          transition: { delay, duration: 0.45, ease: [0.16, 1, 0.3, 1] as const },
        };

  const [loading, setLoading] = useState(true);
  const [downloadingReceipt, setDownloadingReceipt] = useState(false);
  const [downloadingBillet, setDownloadingBillet] = useState(false);
  const [data, setData] = useState<ConfirmationData | null>(null);
  const [qrCodeImage, setQrCodeImage] = useState<string>('');
  const [invoiceNumber, setInvoiceNumber] = useState<string | null>(null);

  const type = searchParams.get('type') as 'ticket' | 'table' | 'order';
  const id = searchParams.get('id');
  const guestTicketData = (location.state as any)?.guestTicketData;

  const getLocale = () => {
    switch (language) {
      case 'es': return es;
      case 'fr': return fr;
      default: return enUS;
    }
  };

  useEffect(() => {
    if (type && id) {
      fetchData();
    } else {
      // Missing type/id query params: stop loading so the "not found"
      // state renders instead of an indefinite loading screen.
      setLoading(false);
    }
  }, [type, id]);

  const fetchData = async () => {
    try {
      if (type === 'ticket') {
        // Try normal fetch first
        const { data: ticket, error } = await supabase
          .from('tickets')
          .select(`
            *,
            events!inner(title, start_at, venue_id, poster_url, alcohol_free, organizer_user_id),
            ticket_rounds!inner(name, price)
          `)
          .eq('id', id)
          .single();

        if (error && guestTicketData) {
          // Fallback: use guest ticket data passed via navigation state
          const gd = guestTicketData;
          setData({
            type: 'ticket',
            id: gd.id,
            qrCode: gd.qrCode,
            eventTitle: gd.eventTitle,
            eventDate: gd.eventDate,
            eventPosterUrl: gd.eventPosterUrl,
            venueName: gd.venueName,
            venueAddress: gd.venueAddress,
            venueLegalName: gd.venueLegalName,
            venueSiret: gd.venueSiret,
            venueVatNumber: gd.venueVatNumber,
            venueLegalAddress: gd.venueLegalAddress,
            venueLogoUrl: gd.venueLogoUrl,
            venueId: gd.venueId,
            details: gd.roundName,
            quantity: gd.quantity,
            totalPrice: gd.totalPrice,
            serviceFee: gd.serviceFee,
            insuranceFee: gd.insuranceFee,
            unitPrice: gd.unitPrice || gd.roundPrice,
            customerName: gd.customerName,
            customerEmail: gd.customerEmail,
            customerPhone: gd.customerPhone,
            paidAt: gd.paidAt,
          });

          if (gd.invoiceNumber) {
            setInvoiceNumber(gd.invoiceNumber);
          }

          if (gd.qrCode) {
            const QRCode = (await import('qrcode')).default;
            const qrImage = await QRCode.toDataURL(gd.qrCode, { width: 200, margin: 2 });
            setQrCodeImage(qrImage);
          }
          setLoading(false);
          return;
        }

        if (error) throw error;

        const { data: venue } = await supabase
          .from('venues')
          .select('id, name, address, logo_url, legal_name, siret, vat_number, legal_address')
          .eq('id', ticket.events.venue_id)
          .maybeSingle();

        // Fetch attendees if nominative
        const { data: attendees } = await supabase
          .from('ticket_attendees')
          .select('full_name')
          .eq('ticket_id', id);

        // Fetch existing invoice number
        const { data: existingInvoice } = await supabase
          .from('invoice_numbers')
          .select('invoice_number')
          .eq('ticket_id', id)
          .maybeSingle();

        if (existingInvoice) {
          setInvoiceNumber(existingInvoice.invoice_number);
        }

        // Fetch upsell selections
        const { data: upsellSels } = await supabase
          .from('ticket_upsell_selections')
          .select('offer_type, unit_price, total_price, ticket_upsell_offers(name)')
          .eq('ticket_id', id);

        const upsellSelections: UpsellSelection[] = (upsellSels || []).map((s: any) => ({
          name: s.ticket_upsell_offers?.name || s.offer_type,
          price: Number(s.total_price || 0),
          offerType: s.offer_type,
        }));

        // Legacy: fetch pack credits if no upsell selections found
        let packName: string | undefined;
        let packPrice: number | undefined;
        if (upsellSelections.length === 0) {
          const { data: packCredits } = await supabase
            .from('order_pack_credits')
            .select('*')
            .eq('ticket_order_id', id)
            .maybeSingle();

          if (packCredits) {
            // Try upsell_drink_packs first, then ticket_upsell_offers
            const { data: dp } = await supabase.from('upsell_drink_packs').select('name, pack_price').eq('id', packCredits.pack_id).maybeSingle();
            if (dp) {
              packName = dp.name;
              packPrice = dp.pack_price ? Number(dp.pack_price) : undefined;
            } else {
              const { data: tuo } = await supabase.from('ticket_upsell_offers').select('name, pack_price').eq('id', packCredits.pack_id).maybeSingle();
              if (tuo) {
                packName = tuo.name;
                packPrice = tuo.pack_price ? Number(tuo.pack_price) : undefined;
              }
            }
          }
        }

        // Calculate real total including upsells
        const upsellTotal = upsellSelections.reduce((sum, u) => sum + u.price, 0);
        const displayTotal = (ticket.total_price || 0) + upsellTotal;

        // Venue access documents (to download + fill before entry)
        const { data: docs } = ticket.events.venue_id ? await supabase
          .from('venue_access_documents')
          .select('id, label, file_url, file_name')
          .eq('venue_id', ticket.events.venue_id)
          .eq('is_active', true)
          .order('position', { ascending: true }) : { data: [] as any[] };
        const accessDocs = (docs || []).map((d: any) => ({ id: d.id, label: d.label, fileUrl: d.file_url, fileName: d.file_name }));

        // Alcohol-free events: surface the minor-authorization document (from the
        // venue, or the organizer for venue-less events) so minors can sign it.
        if ((ticket.events as any)?.alcohol_free) {
          let minorDoc: { url: string | null; name: string | null } | null = null;
          if (ticket.events.venue_id) {
            const { data: v } = await supabase.from('venues').select('minor_auth_doc_url, minor_auth_doc_name').eq('id', ticket.events.venue_id).maybeSingle();
            if ((v as any)?.minor_auth_doc_url) minorDoc = { url: (v as any).minor_auth_doc_url, name: (v as any).minor_auth_doc_name };
          } else if ((ticket.events as any)?.organizer_user_id) {
            const { data: o } = await supabase.from('organizer_profiles').select('minor_auth_doc_url, minor_auth_doc_name').eq('user_id', (ticket.events as any).organizer_user_id).maybeSingle();
            if ((o as any)?.minor_auth_doc_url) minorDoc = { url: (o as any).minor_auth_doc_url, name: (o as any).minor_auth_doc_name };
          }
          if (minorDoc?.url) {
            accessDocs.push({ id: 'minor-auth', label: t('confirmation.minorDocLabel'), fileUrl: minorDoc.url, fileName: minorDoc.name || 'authorization.pdf' });
          }
        }

        setData({
          type: 'ticket',
          alcoholFree: (ticket.events as any)?.alcohol_free ?? false,
          accessDocs: accessDocs.length > 0 ? accessDocs : undefined,
          id: ticket.id,
          qrCode: ticket.qr_code,
          eventTitle: ticket.events.title,
          eventDate: ticket.events.start_at,
          eventPosterUrl: ticket.events.poster_url,
          venueName: venue?.name,
          venueAddress: venue?.address,
          venueLegalName: venue?.legal_name,
          venueSiret: venue?.siret,
          venueVatNumber: venue?.vat_number,
          venueLegalAddress: venue?.legal_address,
          venueLogoUrl: venue?.logo_url,
          venueId: venue?.id,
          details: ticket.ticket_rounds.name,
          quantity: ticket.quantity,
          totalPrice: displayTotal,
          serviceFee: ticket.service_fee,
          insuranceFee: ticket.insurance_fee,
          unitPrice: ticket.ticket_rounds.price,
          customerName: ticket.full_name,
          customerEmail: ticket.user_email,
          customerPhone: ticket.phone,
          paidAt: ticket.paid_at,
          packName,
          packPrice,
          upsellSelections: upsellSelections.length > 0 ? upsellSelections : undefined,
          attendees: attendees?.map(a => {
            const parts = (a.full_name || '').split(' ');
            return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') || '' };
          }),
        });

        if (ticket.qr_code) {
          const qrImage = await QRCode.toDataURL(ticket.qr_code, { width: 200, margin: 2 });
          setQrCodeImage(qrImage);
        }
      } else if (type === 'table') {
        const { data: reservation, error } = await supabase
          .from('table_reservations')
          .select(`
            *,
            events!inner(title, start_at, venue_id, poster_url),
            table_packs!inner(name, deposit),
            table_zones(name)
          `)
          .eq('id', id)
          .single();

        if (error) throw error;

        const { data: venue } = await supabase
          .from('venues')
          .select('id, name, address, logo_url, legal_name, siret, vat_number, legal_address')
          .eq('id', reservation.events.venue_id)
          .single();

        // Fetch existing invoice number
        const { data: existingInvoice } = await supabase
          .from('invoice_numbers')
          .select('invoice_number')
          .eq('table_reservation_id', id)
          .maybeSingle();

        if (existingInvoice) {
          setInvoiceNumber(existingInvoice.invoice_number);
        }

        setData({
          type: 'table',
          id: reservation.id,
          qrCode: reservation.qr_code,
          eventTitle: reservation.events.title,
          eventDate: reservation.events.start_at,
          eventPosterUrl: reservation.events.poster_url,
          venueName: venue?.name,
          venueAddress: venue?.address,
          venueLegalName: venue?.legal_name,
          venueSiret: venue?.siret,
          venueVatNumber: venue?.vat_number,
          venueLegalAddress: venue?.legal_address,
          venueLogoUrl: venue?.logo_url,
          venueId: venue?.id,
          details: `${reservation.table_zones?.name || ''} - ${reservation.table_packs.name}`,
          guestCount: reservation.guest_count,
          totalPrice: reservation.total_price,
          managementFee: reservation.management_fee,
          unitPrice: reservation.deposit,
          customerName: reservation.full_name,
          customerEmail: reservation.user_email,
          customerPhone: reservation.phone,
          paidAt: reservation.paid_at,
        });

        if (reservation.qr_code) {
          const qrImage = await QRCode.toDataURL(reservation.qr_code, { width: 200, margin: 2 });
          setQrCodeImage(qrImage);
        }
      } else if (type === 'order') {
        const { data: order, error } = await supabase
          .from('orders')
          .select('*, venues!inner(id, name, address, logo_url, legal_name, siret, vat_number, legal_address), events(title, start_at, poster_url)')
          .eq('id', id)
          .single();

        if (error) throw error;

        // Fetch existing invoice number
        const { data: existingInvoice } = await supabase
          .from('invoice_numbers')
          .select('invoice_number')
          .eq('order_id', id)
          .maybeSingle();

        if (existingInvoice) {
          setInvoiceNumber(existingInvoice.invoice_number);
        }

        // Parse order items
        const orderItems = (order.items as any[])?.map(item => ({
          name: item.name,
          qty: item.qty,
          unitPrice: item.unitPrice,
        })) || [];

        setData({
          type: 'order',
          id: order.id,
          qrCode: order.token || order.id,
          venueName: order.venues.name,
          venueAddress: order.venues.address,
          venueLegalName: order.venues.legal_name,
          venueSiret: order.venues.siret,
          venueVatNumber: order.venues.vat_number,
          venueLegalAddress: order.venues.legal_address,
          venueLogoUrl: order.venues.logo_url,
          venueId: order.venues.id,
          eventTitle: order.events?.title,
          eventDate: order.events?.start_at,
          eventPosterUrl: order.events?.poster_url,
          totalPrice: order.total,
          customerEmail: order.user_email,
          paidAt: order.paid_at,
          items: orderItems,
        });

        const qrImage = await QRCode.toDataURL(order.token || order.id, { width: 200, margin: 2 });
        setQrCodeImage(qrImage);
      }
    } catch (error) {
      console.error('Error fetching confirmation data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleShare = async () => {
    if (navigator.share && data) {
      try {
        await navigator.share({
          title: data.eventTitle || 'Ma commande',
          text: `${data.eventTitle} - ${data.venueName}`,
          url: window.location.href,
        });
      } catch {
        /* share dismissed by user */
      }
    }
  };

  // Resolve (and persist) the canonical order/invoice number for the receipt.
  const ensureInvoiceNumber = async (): Promise<string> => {
    if (invoiceNumber) return invoiceNumber;
    if (data?.venueId) {
      try {
        const { data: newNum, error } = await supabase
          .rpc('generate_invoice_number', { p_venue_id: data.venueId });
        if (!error && newNum) {
          const insertData: any = { venue_id: data.venueId, invoice_number: newNum };
          if (type === 'ticket') insertData.ticket_id = id;
          else if (type === 'table') insertData.table_reservation_id = id;
          else if (type === 'order') insertData.order_id = id;
          await supabase.from('invoice_numbers').insert(insertData);
          setInvoiceNumber(newNum);
          return newNum;
        }
      } catch { /* fall through to a local fallback */ }
    }
    const fallback = `FAC-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
    setInvoiceNumber(fallback);
    return fallback;
  };

  // Build the fiscal receipt lines (ticket/table/drinks + Yuno fees), each at its
  // VAT rate. Mirrors the server-side lines in send-ticket-confirmation.
  const buildReceiptLines = (): ReceiptLine[] => {
    if (!data) return [];
    const VAT = 20;
    const lines: ReceiptLine[] = [];
    const fee = receiptLineLabels(language as DocLang);
    if (data.type === 'ticket') {
      const q = data.quantity || 1;
      const u = data.unitPrice || 0;
      lines.push({ label: data.details || t('confirmation.ticket') || 'Billet', qty: q, ttc: q * u, vatRate: VAT });
      if (data.upsellSelections?.length) {
        data.upsellSelections.forEach(uu => lines.push({ label: uu.name, qty: 1, ttc: uu.price, vatRate: VAT }));
      } else if (data.packName && data.packPrice) {
        lines.push({ label: data.packName, qty: 1, ttc: data.packPrice, vatRate: VAT });
      }
    } else if (data.type === 'table') {
      lines.push({ label: data.details || t('acct.typeTable') || 'Table VIP', qty: 1, ttc: data.unitPrice || 0, vatRate: VAT });
    } else if (data.type === 'order' && data.items) {
      data.items.forEach(it => lines.push({ label: it.name, qty: it.qty, ttc: it.qty * it.unitPrice, vatRate: VAT }));
    }
    if (data.serviceFee) lines.push({ label: fee.serviceFee, qty: 1, ttc: data.serviceFee, vatRate: VAT });
    if (data.managementFee) lines.push({ label: fee.managementFee, qty: 1, ttc: data.managementFee, vatRate: VAT });
    if (data.insuranceFee) lines.push({ label: fee.insurance, qty: 1, ttc: data.insuranceFee, vatRate: VAT });
    return lines;
  };

  // Fiscal "Reçu de transaction" — club is the sole seller. No QR.
  const handleDownloadReceipt = async () => {
    if (!data) return;
    setDownloadingReceipt(true);
    try {
      const orderNumber = await ensureInvoiceNumber();
      const blob = await generateReceiptPDF({
        lang: language as DocLang,
        orderNumber,
        receiptDate: new Date(),
        paymentDate: data.paidAt ? new Date(data.paidAt) : new Date(),
        sellerName: data.venueLegalName || data.venueName || 'Yuno',
        sellerAddress: data.venueLegalAddress || data.venueAddress,
        sellerSiret: data.venueSiret,
        sellerVatNumber: data.venueVatNumber,
        sellerLogoUrl: data.venueLogoUrl,
        customerName: data.customerName || '',
        customerEmail: data.customerEmail || '',
        customerPhone: data.customerPhone,
        eventTitle: data.eventTitle,
        eventDate: data.eventDate ? new Date(data.eventDate) : undefined,
        lines: buildReceiptLines(),
      });
      downloadBlob(blob, `Yuno-recu-${orderNumber}.pdf`);
      toast.success(t('invoice.downloaded') || 'Reçu téléchargé');
    } catch (error) {
      console.error('Error generating receipt:', error);
      toast.error(t('invoice.error') || 'Erreur lors de la génération du reçu');
    } finally {
      setDownloadingReceipt(false);
    }
  };

  // Entry "Billet" — poster, event, QR. Tickets & VIP tables only.
  const handleDownloadBillet = async () => {
    if (!data) return;
    setDownloadingBillet(true);
    try {
      // The page only carries the raw scan value; fetch the short human ref for display.
      let reference = data.qrCode;
      try {
        const tbl = data.type === 'table' ? 'table_reservations' : 'tickets';
        const { data: row } = await supabase.from(tbl).select('reference_code').eq('id', data.id).maybeSingle();
        const ref = (row as { reference_code?: string } | null)?.reference_code;
        if (ref) reference = ref;
      } catch { /* keep raw qr value as the reference */ }
      const blob = await generateBilletPDF({
        lang: language as DocLang,
        eventTitle: data.eventTitle || data.venueName || '',
        organizerName: data.venueName || '',
        eventStart: data.eventDate ? new Date(data.eventDate) : undefined,
        address: data.venueAddress,
        entranceName: data.details,
        reference,
        price: `${(data.totalPrice || 0).toFixed(2).replace('.', ',')} €`,
        orderNumber: invoiceNumber || reference,
        customerName: data.customerName,
        posterUrl: data.eventPosterUrl,
        qrValue: data.qrCode,
        index: 1,
        total: 1,
      });
      downloadBlob(blob, `Yuno-billet-${reference}.pdf`);
      toast.success(t('confirmation.billetDownloaded') || 'Billet téléchargé');
    } catch (error) {
      console.error('Error generating billet:', error);
      toast.error(t('invoice.error') || 'Erreur lors de la génération du billet');
    } finally {
      setDownloadingBillet(false);
    }
  };

  const handleDownloadQR = () => {
    if (qrCodeImage) {
      const link = document.createElement('a');
      link.download = `qr-${data?.id}.png`;
      link.href = qrCodeImage;
      link.click();
    }
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-background flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center p-4">
        <p className="text-muted-foreground mb-4">{t('confirmation.notFound') || 'Confirmation non trouvée'}</p>
        <Button variant="outline" onClick={() => navigate('/')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t('common.back') || 'Retour'}
        </Button>
      </div>
    );
  }

  const getTypeLabel = () => {
    switch (data.type) {
      case 'ticket': return t('confirmation.ticketConfirmed') || 'Billet confirmé !';
      case 'table': return t('confirmation.tableConfirmed') || 'Réservation confirmée !';
      case 'order': return t('confirmation.orderConfirmed') || 'Commande confirmée !';
    }
  };

  const getTypeIcon = () => {
    switch (data.type) {
      case 'ticket': return <Ticket className="h-5 w-5" />;
      case 'table': return <Users className="h-5 w-5" />;
      case 'order': return <CheckCircle className="h-5 w-5" />;
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background overflow-x-hidden">
      {/* Header */}
      <header className="fixed top-0 z-40 w-full border-b border-border/40 bg-surface/80 backdrop-blur-md" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="mx-auto flex h-14 sm:h-16 max-w-7xl items-center px-3 sm:px-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/my-orders')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t('confirmation.myOrders')}
          </Button>
        </div>
      </header>

      <div style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 3.5rem)' }}>
        <div className="mx-auto max-w-lg px-4 py-8 w-full box-border" style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))' }}>
          {/* Success Animation — moment rare + célébratoire : overshoot intentionnel.
              Jamais scale(0) (rien n'apparaît "de nulle part") → part de 0.6 + opacity. */}
          <motion.div
            initial={reduceMotion ? { opacity: 0 } : { scale: 0.6, opacity: 0 }}
            animate={reduceMotion ? { opacity: 1 } : { scale: 1, opacity: 1 }}
            transition={reduceMotion ? { duration: 0.3 } : transitions.celebrate}
            className="flex justify-center mb-6"
          >
            <div className="h-20 w-20 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <CheckCircle className="h-12 w-12 text-emerald-500" />
            </div>
          </motion.div>

          <motion.div {...rise(0.2)} className="text-center mb-8">
            <h1 className="text-2xl font-bold mb-2">{getTypeLabel()}</h1>
            <p className="text-muted-foreground">
              {t('confirmation.emailSent') || 'Un email de confirmation vous a été envoyé'}
            </p>
          </motion.div>

          {/* QR Code Card */}
          <motion.div {...rise(0.3)}>
            <Card className="mb-6">
              <CardContent className="pt-6">
                {/* Event Info */}
                {data.eventTitle && (
                  <div className="text-center mb-4">
                    <div className="flex items-center justify-center gap-2 text-primary mb-1">
                      {getTypeIcon()}
                      <span className="font-medium">{data.details}</span>
                    </div>
                    <h2 className="text-xl font-bold">{data.eventTitle}</h2>
                  </div>
                )}

                {/* Date & Location */}
                {data.eventDate && (
                  <div className="flex flex-wrap justify-center gap-4 text-sm text-muted-foreground mb-4">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-4 w-4" />
                      {formatInTimeZone(new Date(data.eventDate), PARIS_TIMEZONE, 'EEEE d MMMM yyyy', { locale: getLocale() })}
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      {formatInTimeZone(new Date(data.eventDate), PARIS_TIMEZONE, 'HH:mm')}
                    </div>
                  </div>
                )}

                {data.venueName && (
                  <div className="flex items-center justify-center gap-1 text-sm text-muted-foreground mb-6">
                    <MapPin className="h-4 w-4" />
                    {data.venueName}
                  </div>
                )}

                <Separator className="mb-6" />

                {/* QR Code - Carousel for multi-ticket, single for others */}
                <div className="flex flex-col items-center">
                  {data.type === 'ticket' && data.quantity && data.quantity > 1 ? (
                    <TicketQRCarousel
                      ticketId={data.id}
                      ticketQrCode={data.qrCode}
                      quantity={data.quantity}
                      roundName={data.details || ''}
                      eventTitle={data.eventTitle || ''}
                      venueName={data.venueName || ''}
                      onClose={() => {}}
                      embedded
                    />
                  ) : (
                    <>
                      {qrCodeImage && (
                        <div className="bg-white p-4 rounded-xl mb-4">
                          <img src={qrCodeImage} alt="QR Code" className="w-48 h-48" />
                        </div>
                      )}
                    </>
                  )}
                  <p className="text-sm text-muted-foreground text-center mb-4">
                    {t('confirmation.showQR') || 'Présentez ce QR code à l\'entrée'}
                  </p>

                  {/* Details */}
                  <div className="w-full space-y-2 text-sm">
                    {data.quantity && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('confirmation.quantity') || 'Quantité'}</span>
                        <span className="font-medium">{data.quantity} {data.quantity > 1 ? (t('tickets.tickets') || 'billets') : (t('tickets.ticket') || 'billet')}</span>
                      </div>
                    )}
                    {data.guestCount && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('confirmation.guests') || 'Invités'}</span>
                        <span className="font-medium">{data.guestCount} personnes</span>
                      </div>
                    )}
                    {data.totalPrice && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('confirmation.total') || 'Total payé'}</span>
                        <span className="font-bold text-primary">{data.totalPrice.toFixed(2)} €</span>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Access documents to download & fill before entry */}
          {data.type === 'ticket' && data.accessDocs && data.accessDocs.length > 0 && (
            <motion.div {...rise(0.33)} className="mb-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-start gap-3 mb-4">
                    <FileText className="h-5 w-5 text-primary flex-none mt-0.5" />
                    <div>
                      <h3 className="font-semibold">{t('confirmation.accessDocsTitle')}</h3>
                      <p className="text-sm text-muted-foreground">{t('confirmation.accessDocsDesc')}</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {data.accessDocs.map(doc => (
                      <a key={doc.id} href={doc.fileUrl} target="_blank" rel="noopener noreferrer" download
                        className="flex items-center justify-between gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                        <span className="flex items-center gap-2 min-w-0">
                          <FileText className="h-4 w-4 text-muted-foreground flex-none" />
                          <span className="truncate text-sm font-medium">{doc.label}</span>
                        </span>
                        <Download className="h-4 w-4 text-primary flex-none" />
                      </a>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Drink Credits from pack */}
          {data.type === 'ticket' && (data.packName || data.upsellSelections?.some(u => u.offerType === 'drink_pack' || u.offerType === 'single_drink_discount' || u.offerType === 'combo')) && (
            <motion.div {...rise(0.35)} className="mb-4">
              <DrinkCreditsCard ticketId={data.id} venueId={data.venueId} />
            </motion.div>
          )}

          {/* Action Buttons */}
          <motion.div {...rise(0.4)} className="space-y-3">
            {/* Billet (ticket / VIP table only) — primary action */}
            {data.type !== 'order' && (
              <Button
                className="w-full"
                onClick={handleDownloadBillet}
                disabled={downloadingBillet}
              >
                {downloadingBillet ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent mr-2" />
                ) : (
                  <Ticket className="h-4 w-4 mr-2" />
                )}
                {t('confirmation.downloadBillet') || 'Télécharger le billet'}
              </Button>
            )}

            {/* Reçu de transaction (fiscal) */}
            <Button
              className="w-full"
              variant={data.type === 'order' ? 'default' : 'outline'}
              onClick={handleDownloadReceipt}
              disabled={downloadingReceipt}
            >
              {downloadingReceipt ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent mr-2" />
              ) : (
                <FileText className="h-4 w-4 mr-2" />
              )}
              {t('confirmation.downloadReceipt') || 'Télécharger le reçu'}
            </Button>

            {/* Add to Wallet Button - Native Apple/Google Wallet design */}
            <WalletButtons type={data.type} id={data.id} />
          </motion.div>

          {/* Back to orders */}
          <motion.div {...rise(0.5)} className="mt-6 text-center">
            <Button variant="link" onClick={() => navigate('/my-orders')}>
              {t('confirmation.viewAllOrders')}
            </Button>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
