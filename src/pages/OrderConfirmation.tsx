import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle, Calendar, Clock, MapPin, Users, Ticket, ArrowLeft, FileText, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatInTimeZone } from 'date-fns-tz';
import { fr, enUS, es } from 'date-fns/locale';
import { PARIS_TIMEZONE } from '@/lib/timezone';
import { downloadInvoicePDF, type InvoiceData, type InvoiceItem } from '@/lib/generateInvoicePDF';
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
  
  const [loading, setLoading] = useState(true);
  const [downloadingInvoice, setDownloadingInvoice] = useState(false);
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
      } catch (error) {
        console.log('Share cancelled');
      }
    }
  };

  const handleDownloadInvoice = async () => {
    if (!data) return;
    
    setDownloadingInvoice(true);
    try {
      // Generate or fetch invoice number
      let invoiceNum = invoiceNumber;
      
      if (!invoiceNum && data.venueId) {
        // Generate new invoice number via RPC
        const { data: newInvoiceNum, error: rpcError } = await supabase
          .rpc('generate_invoice_number', { p_venue_id: data.venueId });
        
        if (rpcError) throw rpcError;
        invoiceNum = newInvoiceNum;

        // Save to invoice_numbers table
        const insertData: any = {
          venue_id: data.venueId,
          invoice_number: invoiceNum,
        };

        if (type === 'ticket') insertData.ticket_id = id;
        else if (type === 'table') insertData.table_reservation_id = id;
        else if (type === 'order') insertData.order_id = id;

        await supabase.from('invoice_numbers').insert(insertData);
        setInvoiceNumber(invoiceNum);
      }

      if (!invoiceNum) {
        invoiceNum = `FAC-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
      }

      // Build invoice items
      const items: InvoiceItem[] = [];
      
      if (type === 'ticket' && data.quantity && data.unitPrice) {
        items.push({
          description: `Billet ${data.details}`,
          quantity: data.quantity,
          unitPrice: data.unitPrice,
          total: data.quantity * data.unitPrice,
        });
        // Add upsell selections to invoice
        if (data.upsellSelections && data.upsellSelections.length > 0) {
          data.upsellSelections.forEach(u => {
            items.push({
              description: u.name,
              quantity: 1,
              unitPrice: u.price,
              total: u.price,
            });
          });
        } else if (data.packName && data.packPrice) {
          // Legacy pack
          items.push({
            description: `Pack Conso - ${data.packName}`,
            quantity: 1,
            unitPrice: data.packPrice,
            total: data.packPrice,
          });
        }
      } else if (type === 'table' && data.unitPrice) {
        items.push({
          description: `${t('invoice.tableReservation')} - ${data.details}`,
          quantity: 1,
          unitPrice: data.unitPrice,
          total: data.unitPrice,
        });
      } else if (type === 'order' && data.items) {
        data.items.forEach(item => {
          items.push({
            description: item.name,
            quantity: item.qty,
            unitPrice: item.unitPrice,
            total: item.qty * item.unitPrice,
          });
        });
      }

      // Calculate totals
      const itemsSubtotal = items.reduce((sum, item) => sum + item.total, 0);
      const fees = (data.serviceFee || 0) + (data.managementFee || 0) + (data.insuranceFee || 0);
      const totalTTC = data.totalPrice || (itemsSubtotal + fees);
      const tva = totalTTC * 0.2 / 1.2; // Extract TVA from TTC (20%)
      const totalHT = totalTTC - tva;

      const invoiceData: InvoiceData = {
        invoiceNumber: invoiceNum,
        invoiceDate: new Date(),
        paymentDate: data.paidAt ? new Date(data.paidAt) : new Date(),
        
        venueName: data.venueName || 'Établissement',
        venueLegalName: data.venueLegalName,
        venueAddress: data.venueLegalAddress || data.venueAddress,
        venueSiret: data.venueSiret,
        venueVatNumber: data.venueVatNumber,
        venueLogoUrl: data.venueLogoUrl,
        
        customerName: data.customerName || 'Client',
        customerEmail: data.customerEmail || '',
        customerPhone: data.customerPhone,
        
        eventTitle: data.eventTitle,
        eventDate: data.eventDate ? new Date(data.eventDate) : undefined,
        eventPosterUrl: data.eventPosterUrl,
        
        type: data.type,
        items,
        serviceFee: data.serviceFee,
        managementFee: data.managementFee,
        insuranceFee: data.insuranceFee,
        totalHT,
        tva,
        totalTTC,
        
        qrCode: data.qrCode,
        attendees: data.attendees,
      };

      await downloadInvoicePDF(invoiceData, `facture-${invoiceNum}.pdf`, language);
      toast.success(t('invoice.downloaded') || 'Facture téléchargée');
    } catch (error) {
      console.error('Error generating invoice:', error);
      toast.error(t('invoice.error') || 'Erreur lors de la génération de la facture');
    } finally {
      setDownloadingInvoice(false);
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
          {/* Success Animation */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 15 }}
            className="flex justify-center mb-6"
          >
            <div className="h-20 w-20 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <CheckCircle className="h-12 w-12 text-emerald-500" />
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-center mb-8"
          >
            <h1 className="text-2xl font-bold mb-2">{getTypeLabel()}</h1>
            <p className="text-muted-foreground">
              {t('confirmation.emailSent') || 'Un email de confirmation vous a été envoyé'}
            </p>
          </motion.div>

          {/* QR Code Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
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
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.33 }}
              className="mb-4"
            >
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
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 }}
              className="mb-4"
            >
              <DrinkCreditsCard ticketId={data.id} venueId={data.venueId} />
            </motion.div>
          )}

          {/* Action Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="space-y-3"
          >
            {/* Download Invoice Button - Primary action */}
            <Button 
              className="w-full" 
              onClick={handleDownloadInvoice}
              disabled={downloadingInvoice}
            >
              {downloadingInvoice ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent mr-2" />
              ) : (
                <FileText className="h-4 w-4 mr-2" />
              )}
              {t('confirmation.downloadInvoice')}
            </Button>

            {/* Add to Wallet Button - Native Apple/Google Wallet design */}
            <WalletButtons type={data.type} id={data.id} />
          </motion.div>

          {/* Back to orders */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="mt-6 text-center"
          >
            <Button variant="link" onClick={() => navigate('/my-orders')}>
              {t('confirmation.viewAllOrders')}
            </Button>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
