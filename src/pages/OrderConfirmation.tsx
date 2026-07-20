import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { transitions, useReducedMotion } from '@/lib/motion';
import { haptics } from '@/lib/haptics';
import { Check, Clock, MapPin, Ticket, ArrowLeft, FileText, Download, CalendarPlus, Navigation, Share2, Mail, QrCode, Bell } from 'lucide-react';
import { FavoriteButton } from '@/components/FavoriteButton';
import { useFavorites } from '@/hooks/useFavorites';
import { useAuth } from '@/hooks/useAuth';
import { downloadICS } from '@/lib/calendar';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatInTimeZone } from 'date-fns-tz';
import { fr, enUS, es } from 'date-fns/locale';
import { PARIS_TIMEZONE } from '@/lib/timezone';
import {
  generateReceiptPDF, generateBilletPDF, downloadBlob, receiptLineLabels,
  type ReceiptLine, type DocLang,
} from '@/lib/generateDocuments';
import { shareContent } from '@/lib/share';
import { toast } from 'sonner';
import QRCode from 'qrcode';
import { WalletButtons } from '@/components/WalletButtons';
import { DrinkCreditsCard } from '@/components/upsell/DrinkCreditsCard';
import { DrinksUpsellCard } from '@/components/upsell/DrinksUpsellCard';
import { TicketQRCarousel } from '@/components/orders/TicketQRCarousel';
import { PublicPage } from '@/components/PublicPage';
interface UpsellSelection {
  name: string;
  price: number;
  offerType: string;
}

/**
 * Résout les profils organisateurs d'une soirée (principal + co-orga), dans
 * l'ordre passé et sans doublon. La RLS de organizer_profiles ne renvoie que
 * les profils `is_public = true` : un profil privé disparaît donc de la liste,
 * et aucun bouton d'abonnement n'est proposé pour lui. Jamais bloquant — une
 * erreur ici ne doit pas empêcher la confirmation de s'afficher.
 */
/**
 * Colonnes de `events` que l'inférence de types Supabase ne fait pas remonter
 * à travers un join `events!inner(...)` posé sur un select `*`. Un seul cast
 * typé par branche, plutôt que des `as any` dispersés sur chaque accès.
 */
type JoinedEventExtras = {
  organizer_user_id: string | null;
  partner_organizer_id: string | null;
  alcohol_free: boolean | null;
};

async function fetchEventOrganizers(ids: (string | null | undefined)[]): Promise<EventOrganizer[]> {
  const unique = [...new Set(ids.filter((v): v is string => !!v))];
  if (unique.length === 0) return [];
  try {
    const { data } = await supabase
      .from('organizer_profiles')
      .select('user_id, display_name, slug, avatar_url')
      .in('user_id', unique);
    const byId = new Map((data ?? []).map(p => [p.user_id, p]));
    return unique
      .map(id => byId.get(id))
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map(p => ({ id: p.user_id, name: p.display_name, slug: p.slug, logoUrl: p.avatar_url }));
  } catch {
    return [];
  }
}

interface EventOrganizer {
  id: string;
  name: string;
  slug: string | null;
  logoUrl: string | null;
}

interface ConfirmationData {
  type: 'ticket' | 'table' | 'order';
  id: string;
  qrCode: string;
  eventId?: string;
  /** Organisateur principal + co-organisateur, résolus et publics. */
  organizers?: EventOrganizer[];
  /** Soirée menée par un orga (events.organizer_user_id) → il passe avant le club. */
  organizerLed?: boolean;
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
  const { isFavorite, toggleFavorite, loading: favoritesLoading } = useFavorites();
  const { user } = useAuth();

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
  // Abonnement au club AU CHARGEMENT, figé. On ne peut pas lire isFavorite()
  // directement au rendu : le client qui s'abonne depuis cette section ferait
  // disparaître le bouton sous son pouce à l'instant du tap, sans confirmation.
  // null = pas encore tranché (favoris en cours de chargement).
  const [followedClubOnArrival, setFollowedClubOnArrival] = useState<boolean | null>(null);
  // Même logique pour les organisateurs, mais eux vivent hors de la table
  // `favorites` (→ organizer_profile_followers), donc hors de useFavorites() :
  // pas de FavoriteButton possible, requête et toggle à la main.
  // null = pas encore tranché ; sinon map orgId → suivi À L'ARRIVÉE.
  const [followedOrgsOnArrival, setFollowedOrgsOnArrival] = useState<Record<string, boolean> | null>(null);
  // État vivant du toggle (optimiste), pour le libellé du bouton après le tap.
  const [orgFollowing, setOrgFollowing] = useState<Record<string, boolean>>({});
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

  // Fige l'abonnement au club dès que les favoris ET la commande sont chargés.
  useEffect(() => {
    if (favoritesLoading || !data?.venueId || followedClubOnArrival !== null) return;
    setFollowedClubOnArrival(isFavorite('club', data.venueId));
  }, [favoritesLoading, data?.venueId, followedClubOnArrival, isFavorite]);

  // Idem pour les organisateurs de la soirée. Invité sans compte → map vide :
  // rien n'est suivi, donc tout est proposé (le tap demandera de se connecter).
  const organizers = data?.organizers;
  useEffect(() => {
    if (!organizers?.length || followedOrgsOnArrival !== null) return;
    let cancelled = false;
    (async () => {
      if (!user) {
        if (!cancelled) setFollowedOrgsOnArrival({});
        return;
      }
      const { data: rows } = await supabase
        .from('organizer_profile_followers')
        .select('organizer_user_id')
        .eq('user_id', user.id)
        .in('organizer_user_id', organizers.map(o => o.id));
      if (cancelled) return;
      const map = Object.fromEntries((rows ?? []).map(r => [r.organizer_user_id, true]));
      setFollowedOrgsOnArrival(map);
      setOrgFollowing(map);
    })();
    return () => { cancelled = true; };
  }, [organizers, followedOrgsOnArrival, user]);

  // Haptic de succès, une seule fois, quand la confirmation s'affiche.
  // PAS de confettis ici : l'overlay passait par-dessus le QR code, qui est
  // la seule chose que le client vient chercher sur cette page. Le badge
  // « Confirmé » du hero porte déjà la célébration visuelle.
  // Fidélité light : si l'achat a rapporté des points (award_loyalty_points
  // côté verify-*-payment), toast discret « +N points ».
  useEffect(() => {
    if (loading || !data) return;
    haptics.success();

    let cancelled = false;
    (async () => {
      try {
        // RLS : ne renvoie que les transactions du client connecté (via
        // customer_loyalty). Invité sans compte → liste vide, silencieux.
        const { data: txs } = await supabase
          .from('loyalty_transactions')
          .select('points, transaction_type')
          .eq('reference_id', data.id)
          .in('transaction_type', ['earn', 'bonus']);
        const points = (txs ?? []).reduce((sum, tx) => sum + (tx.points || 0), 0);
        if (points > 0 && !cancelled) {
          setTimeout(() => {
            if (!cancelled) toast(t('celebrate.pointsEarned').replace('{points}', String(points)));
          }, 1400);
        }
      } catch {
        // Points non affichés : jamais bloquant pour la confirmation.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, data]);

  const fetchData = async () => {
    try {
      if (type === 'ticket') {
        // Try normal fetch first
        const { data: ticket, error } = await supabase
          .from('tickets')
          .select(`
            *,
            events!inner(id, title, start_at, venue_id, poster_url, alcohol_free, organizer_user_id, partner_organizer_id),
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
            eventId: gd.eventId,
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

        const ticketEvent = ticket.events as typeof ticket.events & JoinedEventExtras;

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
        if (ticketEvent.alcohol_free) {
          let minorDoc: { url: string | null; name: string | null } | null = null;
          if (ticket.events.venue_id) {
            const { data: v } = await supabase.from('venues').select('minor_auth_doc_url, minor_auth_doc_name').eq('id', ticket.events.venue_id).maybeSingle();
            if ((v as any)?.minor_auth_doc_url) minorDoc = { url: (v as any).minor_auth_doc_url, name: (v as any).minor_auth_doc_name };
          } else if (ticketEvent.organizer_user_id) {
            const { data: o } = await supabase.from('organizer_profiles').select('minor_auth_doc_url, minor_auth_doc_name').eq('user_id', ticketEvent.organizer_user_id).maybeSingle();
            if ((o as any)?.minor_auth_doc_url) minorDoc = { url: (o as any).minor_auth_doc_url, name: (o as any).minor_auth_doc_name };
          }
          if (minorDoc?.url) {
            accessDocs.push({ id: 'minor-auth', label: t('confirmation.minorDocLabel'), fileUrl: minorDoc.url, fileName: minorDoc.name || 'authorization.pdf' });
          }
        }

        const ticketOrganizers = await fetchEventOrganizers([
          ticketEvent.organizer_user_id,
          ticketEvent.partner_organizer_id,
        ]);

        setData({
          type: 'ticket',
          organizers: ticketOrganizers.length > 0 ? ticketOrganizers : undefined,
          organizerLed: !!ticketEvent.organizer_user_id,
          alcoholFree: ticketEvent.alcohol_free ?? false,
          accessDocs: accessDocs.length > 0 ? accessDocs : undefined,
          id: ticket.id,
          qrCode: ticket.qr_code,
          eventId: ticket.events.id,
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
            events!inner(id, title, start_at, venue_id, poster_url, organizer_user_id, partner_organizer_id),
            table_packs!inner(name, deposit),
            table_zones(name)
          `)
          .eq('id', id)
          .single();

        if (error) throw error;

        const reservationEvent = reservation.events as typeof reservation.events & JoinedEventExtras;

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

        const tableOrganizers = await fetchEventOrganizers([
          reservationEvent.organizer_user_id,
          reservationEvent.partner_organizer_id,
        ]);

        setData({
          type: 'table',
          organizers: tableOrganizers.length > 0 ? tableOrganizers : undefined,
          organizerLed: !!reservationEvent.organizer_user_id,
          id: reservation.id,
          qrCode: reservation.qr_code,
          eventId: reservation.events.id,
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
          .select('*, venues!inner(id, name, address, logo_url, legal_name, siret, vat_number, legal_address), events(id, title, start_at, poster_url)')
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
          eventId: order.events?.id,
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

  // Public, shareable event URL (NOT this private confirmation page). Lets friends
  // grab their own spot — the viral loop. Degrades gracefully if the deep-link is unknown.
  const buildEventUrl = (): string => {
    const origin = window.location.origin;
    if (data?.eventId && data?.venueId) return `${origin}/club/${data.venueId}/event/${data.eventId}`;
    if (data?.eventId) return `${origin}/event/${data.eventId}`;
    return origin;
  };

  /**
   * Abonnement à un organisateur. Écrit directement dans
   * organizer_profile_followers (RLS : insert/delete réservés à
   * auth.uid() = user_id), avec bascule optimiste et rollback en cas d'échec.
   * Invité sans compte : toast et on s'arrête là — surtout PAS de redirection
   * vers /auth comme sur le profil public, ça ferait perdre le QR code au
   * client qui vient de payer.
   */
  const toggleOrganizerFollow = async (orgId: string) => {
    if (!user) {
      haptics.error();
      toast.info(t('event.loginToFollow'));
      return;
    }
    const wasFollowing = orgFollowing[orgId] || false;
    haptics[wasFollowing ? 'selection' : 'success']();
    setOrgFollowing(prev => ({ ...prev, [orgId]: !wasFollowing }));
    try {
      const { error } = wasFollowing
        ? await supabase.from('organizer_profile_followers').delete().eq('organizer_user_id', orgId).eq('user_id', user.id)
        : await supabase.from('organizer_profile_followers').insert({ organizer_user_id: orgId, user_id: user.id });
      if (error) throw error;
      toast.success(wasFollowing ? t('subscribe.removed') : t('subscribe.added'));
    } catch {
      setOrgFollowing(prev => ({ ...prev, [orgId]: wasFollowing }));
      haptics.error();
      toast.error(t('subscribe.error'));
    }
  };

  // Share the event with friends; clipboard fallback when the native sheet is unavailable.
  const handleShare = async () => {
    if (!data) return;
    const url = buildEventUrl();
    const shareData = {
      title: data.eventTitle || data.venueName || 'Yuno',
      text: [data.eventTitle, data.venueName].filter(Boolean).join(' · '),
      url,
    };
    try {
      const outcome = await shareContent(shareData);
      if (outcome === 'copied') toast.success(t('confirmation.linkCopied') || 'Lien copié');
    } catch {
      /* clipboard blocked — nothing more we can do */
    }
  };

  // Add the night to the user's calendar (universal .ics download).
  const handleAddToCalendar = () => {
    if (!data?.eventDate) return;
    downloadICS(
      {
        title: data.eventTitle || data.venueName || 'Yuno',
        start: new Date(data.eventDate),
        location: [data.venueName, data.venueAddress].filter(Boolean).join(', ') || undefined,
        details: data.details,
        url: buildEventUrl(),
      },
      `Yuno-${(data.eventTitle || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}.ics`,
    );
  };

  // Maps deep-link to the venue (same pattern used across EventDetails / VenuePage).
  const directionsUrl = data?.venueAddress
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(data.venueAddress)}`
    : data?.venueName
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(data.venueName)}`
      : null;

  // Countdown label for the hero badge (always-on, unlike EventCountdown which hides > 7d).
  const countdownLabel = (): string | null => {
    if (!data?.eventDate) return null;
    const diff = new Date(data.eventDate).getTime() - Date.now();
    if (diff <= 0) return t('countdown.live') || 'LIVE';
    const days = Math.floor(diff / 86_400_000);
    if (days === 0) return t('confirmation.today') || 'Ce soir';
    if (days === 1) return t('confirmation.tomorrow') || 'Demain';
    return `${t('confirmation.inPrefix')} ${days} ${t('confirmation.daysWord')}`;
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

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center" style={{ background: '#0A0A0A' }}>
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: '#E8192C', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center p-6 text-center" style={{ background: '#0A0A0A' }}>
        <p className="font-mono uppercase mb-5" style={{ fontSize: '12px', letterSpacing: '0.06em', color: '#9A9A9A' }}>
          {t('confirmation.notFound') || 'Confirmation non trouvée'}
        </p>
        <button className="btn btn--secondary" onClick={() => navigate('/')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t('common.back') || 'Retour'}
        </button>
      </div>
    );
  }

  // « Reste dans la boucle » — les entités qu'on peut encore proposer de suivre.
  // On ne garde que celles NON suivies à l'arrivée : afficher un « Abonné·e »
  // ici, c'est n'offrir qu'un moyen de se désabonner par erreur. Le club et les
  // orgas peuvent coexister (soirée d'orga hébergée par un club, ou co-soirée) ;
  // l'entité qui porte la soirée passe en premier.
  const clubFollowPending = !!data.venueId && !!data.venueName && followedClubOnArrival === false;
  const orgsFollowPending = (data.organizers ?? []).filter(o => followedOrgsOnArrival?.[o.id] !== true);
  // Tant qu'une source n'a pas tranché, on n'affiche rien plutôt que d'afficher
  // puis rétracter la section sous le pouce.
  const followResolved =
    (!data.venueId || followedClubOnArrival !== null) &&
    (!data.organizers?.length || followedOrgsOnArrival !== null);
  const clubTarget = clubFollowPending
    ? [{ kind: 'club' as const, id: data.venueId!, name: data.venueName!, logoUrl: data.venueLogoUrl ?? null }]
    : [];
  const orgTargets = orgsFollowPending.map(o => ({ kind: 'organizer' as const, id: o.id, name: o.name, logoUrl: o.logoUrl }));
  const followTargets = followResolved
    ? (data.organizerLed ? [...orgTargets, ...clubTarget] : [...clubTarget, ...orgTargets])
    : [];

  const surface: React.CSSProperties = {
    background: '#141414',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 10,
  };
  const posterFallback = 'linear-gradient(160deg, #1a0a0d, #7a1428)';
  const cd = countdownLabel();
  const dayLabel = data.eventDate
    ? formatInTimeZone(new Date(data.eventDate), PARIS_TIMEZONE, 'EEE d MMM', { locale: getLocale() }).toUpperCase()
    : null;
  const timeLabel = data.eventDate
    ? formatInTimeZone(new Date(data.eventDate), PARIS_TIMEZONE, 'HH:mm')
    : null;
  const heroTitle = data.eventTitle || data.venueName || 'Yuno';

  // Timeline « Et maintenant ? » — the three things that happen next.
  const steps = [
    { icon: Mail, title: t('confirmation.step1Title'), desc: t('confirmation.step1Desc'), extra: data.customerEmail, done: true },
    { icon: QrCode, title: t('confirmation.step2Title'), desc: t('confirmation.step2Desc'), extra: null, done: false },
    {
      icon: Clock,
      title: t('confirmation.step3Title'),
      desc: t('confirmation.step3Desc'),
      extra: timeLabel ? `${t('confirmation.doorsAt')} ${timeLabel}` : null,
      done: false,
    },
  ];

  return (
    <div className="min-h-[100dvh] overflow-x-hidden" style={{ background: '#0A0A0A', paddingBottom: 'calc(2.5rem + env(safe-area-inset-bottom))' }}>
      {/* Floating back control over the hero */}
      <div className="absolute left-0 right-0 z-30 flex px-4" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 14px)' }}>
        <button
          onClick={() => navigate('/my-orders')}
          className="flex items-center gap-2 font-mono uppercase active:scale-[0.97]"
          style={{
            height: 36, padding: '0 14px', borderRadius: 2, fontSize: '10.5px', letterSpacing: '0.10em',
            color: '#fff', background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.14)', transition: 'transform 160ms cubic-bezier(0.16,1,0.3,1)',
          }}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('confirmation.myOrders')}
        </button>
      </div>

      {/* ── HERO : the affiche of the night they just secured ── */}
      <section
        className="relative w-full overflow-hidden"
        style={{ aspectRatio: '4 / 5', maxHeight: '64vh', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
      >
        <div
          className="absolute inset-0"
          style={{
            background: data.eventPosterUrl ? `url(${data.eventPosterUrl}) center/cover` : posterFallback,
          }}
        />
        {/* Overlay gradient — content anchored at bottom */}
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to top, rgba(10,10,10,0.97) 0%, rgba(10,10,10,0.2) 52%, rgba(10,10,10,0.55) 100%)' }}
        />

        <div className="absolute inset-x-0 bottom-0 px-5 pb-7" style={{ maxWidth: 600, margin: '0 auto' }}>
          {/* Confirmed badge + countdown */}
          <div className="flex items-center gap-2.5 mb-3 animate-hero-label">
            <motion.span
              initial={reduceMotion ? { opacity: 0 } : { scale: 0.6, opacity: 0 }}
              animate={reduceMotion ? { opacity: 1 } : { scale: 1, opacity: 1 }}
              transition={reduceMotion ? { duration: 0.3 } : transitions.celebrate}
              className="inline-flex items-center gap-1.5 font-mono font-bold uppercase"
              style={{
                fontSize: '10px', letterSpacing: '0.10em', color: '#fff', padding: '5px 10px 5px 6px',
                borderRadius: 999, background: '#E8192C', boxShadow: '0 8px 22px rgba(232,25,44,0.32)',
              }}
            >
              <span className="inline-flex items-center justify-center rounded-full" style={{ width: 16, height: 16, background: 'rgba(255,255,255,0.22)' }}>
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
              {t('confirmation.confirmed')}
            </motion.span>
            {cd && (
              <span
                className="inline-flex items-center font-mono font-semibold uppercase"
                style={{
                  fontSize: '10px', letterSpacing: '0.08em', color: '#E5E5E5', padding: '5px 10px',
                  borderRadius: 999, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.14)',
                }}
              >
                {cd}
              </span>
            )}
          </div>

          {data.details && (
            <p className="font-mono uppercase mb-2 animate-hero-label" style={{ fontSize: '10px', letterSpacing: '0.10em', color: '#9A9A9A' }}>
              {data.details}
            </p>
          )}

          <h1
            className="font-display text-white uppercase animate-hero-h1"
            style={{ fontSize: 'clamp(30px, 8vw, 52px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 0.92 }}
          >
            {heroTitle}
          </h1>

          {(dayLabel || data.venueName) && (
            <p className="font-mono uppercase mt-3 animate-hero-body" style={{ fontSize: '11px', letterSpacing: '0.05em', color: '#9A9A9A' }}>
              {[dayLabel && timeLabel ? `${dayLabel} · ${timeLabel}` : dayLabel, data.eventTitle ? data.venueName : null]
                .filter(Boolean)
                .join('  —  ')}
            </p>
          )}
        </div>
      </section>

      <PublicPage variant="flow">
      {/* ── Reading column ── */}
      <div className="mx-auto px-5 w-full box-border" style={{ maxWidth: 600 }}>

        {/* TON PASS — the QR / utility centerpiece */}
        <motion.section {...rise(0.1)} className="py-7" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <p className="section-label-ruled mb-5">{t('confirmation.yourPass')}</p>

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
              qrCodeImage && (
                <div className="bg-white p-4 mb-4" style={{ borderRadius: 8 }}>
                  <img src={qrCodeImage} alt="QR Code" className="w-48 h-48" />
                </div>
              )
            )}
            <p className="font-mono uppercase text-center mb-5" style={{ fontSize: '10px', letterSpacing: '0.08em', color: '#5A5A5E' }}>
              {t('confirmation.showQR') || 'Présentez ce QR code à l\'entrée'}
            </p>

            {/* Apple Wallet — mis en avant ici (et pas en bas de page) : c'est
                l'instant où l'œil est sur le QR et où « ne pas le reperdre »
                devient l'action évidente. Le composant rend null hors iOS. */}
            <WalletButtons type={data.type} id={data.id} variant="hero" />

            {/* Details rows */}
            <div className="w-full" style={{ ...surface, padding: '4px 16px' }}>
              {data.quantity && (
                <div className="flex justify-between items-center" style={{ padding: '11px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <span className="font-mono uppercase" style={{ fontSize: '10px', letterSpacing: '0.06em', color: '#9A9A9A' }}>{t('confirmation.quantity') || 'Quantité'}</span>
                  <span className="font-sans font-medium text-white" style={{ fontSize: '14px' }}>{data.quantity} {data.quantity > 1 ? (t('tickets.tickets') || 'billets') : (t('tickets.ticket') || 'billet')}</span>
                </div>
              )}
              {data.guestCount && (
                <div className="flex justify-between items-center" style={{ padding: '11px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <span className="font-mono uppercase" style={{ fontSize: '10px', letterSpacing: '0.06em', color: '#9A9A9A' }}>{t('confirmation.guests') || 'Invités'}</span>
                  <span className="font-sans font-medium text-white" style={{ fontSize: '14px' }}>{data.guestCount}</span>
                </div>
              )}
              {data.totalPrice != null && (
                <div className="flex justify-between items-center" style={{ padding: '11px 0' }}>
                  <span className="font-mono uppercase" style={{ fontSize: '10px', letterSpacing: '0.06em', color: '#9A9A9A' }}>{t('confirmation.total') || 'Total payé'}</span>
                  <span className="font-display font-bold" style={{ fontSize: '17px', color: '#E8192C', letterSpacing: '-0.01em' }}>{data.totalPrice.toFixed(2)} €</span>
                </div>
              )}
            </div>
          </div>
        </motion.section>

        {/* ET MAINTENANT ? — what happens next */}
        <motion.section {...rise(0.15)} className="py-7" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <p className="section-label-ruled mb-6">{t('confirmation.nextTitle')}</p>
          <div>
            {steps.map((step, i) => {
              const Icon = step.icon;
              const isLast = i === steps.length - 1;
              return (
                <div key={i} className="flex gap-4">
                  <div className="flex flex-col items-center flex-none">
                    <div
                      className="flex items-center justify-center"
                      style={{
                        width: 38, height: 38, borderRadius: 8,
                        background: step.done ? '#E8192C' : 'rgba(255,255,255,0.05)',
                        border: step.done ? 'none' : '1px solid rgba(255,255,255,0.12)',
                        color: step.done ? '#fff' : '#E5E5E5',
                      }}
                    >
                      {step.done ? <Check className="h-4 w-4" strokeWidth={2.5} /> : <Icon className="h-4 w-4" />}
                    </div>
                    {!isLast && <div style={{ width: 1, flex: 1, minHeight: 18, background: 'rgba(255,255,255,0.10)', margin: '4px 0' }} />}
                  </div>
                  <div style={{ paddingBottom: isLast ? 0 : 18 }}>
                    <h4 className="font-display font-bold text-white" style={{ fontSize: '15px', letterSpacing: '-0.01em' }}>{step.title}</h4>
                    <p className="font-sans mt-1" style={{ fontSize: '13.5px', lineHeight: 1.5, color: '#9A9A9A' }}>{step.desc}</p>
                    {step.extra && (
                      <p className="font-mono mt-1.5 truncate" style={{ fontSize: '11px', letterSpacing: '0.02em', color: '#5A5A5E' }}>{step.extra}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </motion.section>

        {/* PRÉPARE TA SOIRÉE — calendar + directions */}
        {(data.eventDate || directionsUrl) && (
          <motion.section {...rise(0.2)} className="py-7" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <p className="section-label-ruled mb-5">{t('confirmation.prepTitle')}</p>
            <div className="grid grid-cols-2 gap-3">
              {data.eventDate && (
                <button
                  onClick={handleAddToCalendar}
                  className="flex flex-col items-start gap-3 text-left active:scale-[0.98]"
                  style={{ ...surface, padding: '16px', transition: 'transform 160ms cubic-bezier(0.16,1,0.3,1), border-color 200ms' }}
                >
                  <CalendarPlus className="h-5 w-5" style={{ color: '#E8192C' }} />
                  <span className="font-mono uppercase" style={{ fontSize: '10.5px', letterSpacing: '0.06em', color: '#E5E5E5' }}>{t('confirmation.addToCalendar')}</span>
                </button>
              )}
              {directionsUrl && (
                <a
                  href={directionsUrl} target="_blank" rel="noopener noreferrer"
                  className="flex flex-col items-start gap-3 active:scale-[0.98]"
                  style={{ ...surface, padding: '16px', transition: 'transform 160ms cubic-bezier(0.16,1,0.3,1), border-color 200ms' }}
                >
                  <Navigation className="h-5 w-5" style={{ color: '#E8192C' }} />
                  <span className="font-mono uppercase" style={{ fontSize: '10.5px', letterSpacing: '0.06em', color: '#E5E5E5' }}>{t('confirmation.getDirections')}</span>
                </a>
              )}
            </div>
            {data.venueName && (
              <div className="flex items-center gap-1.5 mt-4 font-mono uppercase" style={{ fontSize: '10.5px', letterSpacing: '0.05em', color: '#9A9A9A' }}>
                <MapPin className="h-3.5 w-3.5 flex-none" />
                <span className="truncate">{data.venueAddress || data.venueName}</span>
              </div>
            )}
          </motion.section>
        )}

        {/* Access documents to download & fill before entry */}
        {data.type === 'ticket' && data.accessDocs && data.accessDocs.length > 0 && (
          <motion.section {...rise(0.25)} className="py-7" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <p className="section-label-ruled mb-2">{t('confirmation.accessDocsTitle')}</p>
            <p className="font-sans mb-5" style={{ fontSize: '13.5px', lineHeight: 1.5, color: '#9A9A9A' }}>{t('confirmation.accessDocsDesc')}</p>
            <div className="space-y-2.5">
              {data.accessDocs.map(doc => (
                <a key={doc.id} href={doc.fileUrl} target="_blank" rel="noopener noreferrer" download
                  className="flex items-center justify-between gap-3 active:scale-[0.99]"
                  style={{ ...surface, padding: '14px 16px', transition: 'transform 160ms cubic-bezier(0.16,1,0.3,1)' }}>
                  <span className="flex items-center gap-2.5 min-w-0">
                    <FileText className="h-4 w-4 flex-none" style={{ color: '#9A9A9A' }} />
                    <span className="truncate font-sans font-medium text-white" style={{ fontSize: '14px' }}>{doc.label}</span>
                  </span>
                  <Download className="h-4 w-4 flex-none" style={{ color: '#E8192C' }} />
                </a>
              ))}
            </div>
          </motion.section>
        )}

        {/* Drink Credits from pack */}
        {data.type === 'ticket' && (data.packName || data.upsellSelections?.some(u => u.offerType === 'drink_pack' || u.offerType === 'single_drink_discount' || u.offerType === 'combo')) && (
          <motion.section {...rise(0.28)} className="py-7" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <DrinkCreditsCard ticketId={data.id} venueId={data.venueId} />
          </motion.section>
        )}

        {/* Rappel boissons (upsell post-achat) — la carte gère sa propre
            éligibilité et rend null (aucune section vide) sinon. */}
        {data.type === 'ticket' && data.venueId && (
          <DrinksUpsellCard ticketId={data.id} venueId={data.venueId} eventId={data.eventId} />
        )}

        {/* VIENS AVEC TA TEAM — share the event (viral loop) */}
        <motion.section {...rise(0.32)} className="py-7" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <p className="section-label-ruled mb-3">{t('confirmation.crewTitle')}</p>
          <p className="font-sans mb-5" style={{ fontSize: '14px', lineHeight: 1.55, color: '#E5E5E5' }}>{t('confirmation.crewDesc')}</p>
          <button className="btn btn--primary w-full" onClick={handleShare}>
            <Share2 className="h-4 w-4 mr-2" />
            {t('confirmation.shareEvent')}
          </button>
        </motion.section>

        {/* RESTE DANS LA BOUCLE — suivre le club et/ou le ou les organisateurs.
            Voir followTargets plus haut : seules les entités PAS ENCORE suivies
            à l'arrivée y figurent, donc la section disparaît d'elle-même quand
            il n'y a plus personne à proposer.
            Une seule entité → on garde le CTA pleine largeur, qui la nomme dans
            la phrase (cas de très loin le plus fréquent, et le plus vendeur).
            Deux entités → une ligne par entité : deux boutons pleine largeur
            identiques ne diraient pas à quoi on s'abonne. */}
        {followTargets.length > 0 && (
          <motion.section {...rise(0.36)} className="py-7" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <p className="section-label-ruled mb-3">{t('confirmation.followTitle')}</p>
            <p className="font-sans mb-5" style={{ fontSize: '14px', lineHeight: 1.55, color: '#E5E5E5' }}>
              {followTargets.length === 1 ? (
                <>
                  {t('confirmation.followDescPrefix')} <span className="text-white font-medium">{followTargets[0].name}</span> {t('confirmation.followDescSuffix')}
                </>
              ) : (
                t('confirmation.followDescMulti')
              )}
            </p>

            {followTargets.length === 1 ? (
              followTargets[0].kind === 'club' ? (
                <FavoriteButton type="club" id={followTargets[0].id} variant="default" size="lg" showLabel className="w-full" />
              ) : (
                <button
                  onClick={() => toggleOrganizerFollow(followTargets[0].id)}
                  className="btn btn--primary w-full"
                  aria-pressed={!!orgFollowing[followTargets[0].id]}
                >
                  <Bell className="h-4 w-4 mr-2" style={{ fill: orgFollowing[followTargets[0].id] ? 'currentColor' : 'transparent' }} />
                  {orgFollowing[followTargets[0].id] ? t('subscribe.active') : t('subscribe.action')}
                </button>
              )
            ) : (
              <div className="space-y-2.5">
                {followTargets.map(target => {
                  const following = target.kind === 'club'
                    ? isFavorite('club', target.id)
                    : !!orgFollowing[target.id];
                  return (
                    <div key={`${target.kind}-${target.id}`} className="flex items-center gap-3" style={{ ...surface, padding: '12px 14px' }}>
                      <div
                        className="shrink-0 overflow-hidden flex items-center justify-center"
                        style={{ width: 40, height: 40, borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', background: '#191919' }}
                      >
                        {target.logoUrl ? (
                          <img src={target.logoUrl} alt="" loading="lazy" className="w-full h-full object-contain" />
                        ) : (
                          <span className="font-mono font-bold" style={{ fontSize: '11px', color: '#5A5A5E' }}>{target.name.slice(0, 2).toUpperCase()}</span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-sans font-medium text-white truncate" style={{ fontSize: '14px' }}>{target.name}</p>
                        <p className="font-mono uppercase mt-0.5" style={{ fontSize: '10px', letterSpacing: '0.06em', color: '#5A5A5E' }}>
                          {target.kind === 'club' ? t('confirmation.followKindClub') : t('confirmation.followKindOrganizer')}
                        </p>
                      </div>
                      {/* Même pilule pour le club et pour l'orga, alors que le
                          stockage diffère (favorites vs organizer_profile_followers) :
                          côte à côte dans la même liste, un <FavoriteButton>
                          shadcn et une pilule mono feraient cohabiter deux
                          langages visuels. 44px de haut = cible tactile. */}
                      <button
                        onClick={() => (target.kind === 'club' ? toggleFavorite('club', target.id) : toggleOrganizerFollow(target.id))}
                        aria-pressed={following}
                        className="shrink-0 inline-flex items-center gap-1.5 font-mono font-semibold uppercase cursor-pointer transition-colors active:scale-[0.97]"
                        style={{
                          fontSize: '10px', height: 44, padding: '0 14px', borderRadius: 2, letterSpacing: '0.08em',
                          border: '1px solid', borderColor: following ? 'rgba(232,25,44,0.4)' : '#2A2A2A',
                          background: following ? 'rgba(232,25,44,0.08)' : 'transparent',
                          color: following ? '#E8192C' : '#E5E5E5',
                        }}
                      >
                        <Bell className="h-3 w-3" strokeWidth={2} style={{ fill: following ? '#E8192C' : 'transparent' }} />
                        {following ? t('subscribe.active') : t('subscribe.action')}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </motion.section>
        )}

        {/* TES DOCUMENTS — billet + receipt + wallet */}
        <motion.section {...rise(0.4)} className="py-7">
          <p className="section-label-ruled mb-5">{t('confirmation.documentsTitle')}</p>
          <div className="space-y-3">
            {data.type !== 'order' && (
              <button className="btn btn--primary w-full" onClick={handleDownloadBillet} disabled={downloadingBillet}>
                {downloadingBillet ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent mr-2" />
                ) : (
                  <Ticket className="h-4 w-4 mr-2" />
                )}
                {t('confirmation.downloadBillet') || 'Télécharger le billet'}
              </button>
            )}
            <button
              className={data.type === 'order' ? 'btn btn--primary w-full' : 'btn btn--ghost w-full'}
              onClick={handleDownloadReceipt}
              disabled={downloadingReceipt}
            >
              {downloadingReceipt ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent mr-2" />
              ) : (
                <FileText className="h-4 w-4 mr-2" />
              )}
              {t('confirmation.downloadReceipt') || 'Télécharger le reçu'}
            </button>
          </div>

          <div className="mt-6 text-center">
            <button
              onClick={() => navigate('/my-orders')}
              className="font-mono uppercase link-slide"
              style={{ fontSize: '11px', letterSpacing: '0.08em', color: '#9A9A9A' }}
            >
              {t('confirmation.viewAllOrders')}
            </button>
          </div>
        </motion.section>
      </div>
      </PublicPage>
    </div>
  );
}
