import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Minus, Plus, ShieldCheck, Tag, ChevronRight, ChevronUp, LogIn, Calendar, Wine, Lock } from 'lucide-react';
import { getEventSalesStatus } from '@/types/ticketing';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatInTimeZone } from 'date-fns-tz';
import { enUS, es, fr } from 'date-fns/locale';
import { PARIS_TIMEZONE } from '@/lib/timezone';
import { TicketRound, EventWithTicketing, calculateServiceFee } from '@/types/ticketing';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { getStoredPromoCodeForVenue } from '@/hooks/usePromoterTracking';
import { TicketAttendeeForm, AttendeeInfo } from '@/components/TicketAttendeeForm';
import { TicketUpsellSelector, SelectedUpsell } from '@/components/upsell/TicketUpsellSelector';
import { TermsAcceptance } from '@/components/TermsAcceptance';
import { MinorAuthGate } from '@/components/MinorAuthGate';
import { MarketingOptIns } from '@/components/MarketingOptIns';
import { CheckoutSteps } from '@/components/CheckoutSteps';

interface PromoterDiscount {
  promoterId: string;
  promoCode: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
}

export default function TicketCheckout() {
  const { eventId, roundId, slug } = useParams();
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const { user, loading: authLoading } = useAuth();
  
  const [event, setEvent] = useState<EventWithTicketing | null>(null);
  const [venue, setVenue] = useState<{ id: string; name: string; city: string; cancellationInsuranceEnabled: boolean } | null>(null);
  const [round, setRound] = useState<TicketRound | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [hasInsurance, setHasInsurance] = useState(false);
  const [promoterDiscount, setPromoterDiscount] = useState<PromoterDiscount | null>(null);
  
  // Attendees info - index 0 is always the primary buyer
  const [attendees, setAttendees] = useState<AttendeeInfo[]>([
    { fullName: '', email: '', phone: '' }
  ]);
  const [confirmEmail, setConfirmEmail] = useState('');
   const [newsletterOptIn, setNewsletterOptIn] = useState(false);
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [alreadyOptedIn, setAlreadyOptedIn] = useState(false);
  const [selectedUpsells, setSelectedUpsells] = useState<SelectedUpsell[]>([]);
  const [acceptCgv, setAcceptCgv] = useState(false);
  // Single age/minor gate for ticket sales (decision tree in MinorAuthGate). A
  // birth date is required; once entered it's saved on the profile and never asked
  // again on future events:
  //   no date                                → blocked (date of birth required)
  //   adult                                  → normal ticket, nothing shown
  //   minor + event forbids minors           → blocked ("must be of legal age")
  //   minor + event allows minors + needs doc→ download + upload the signed form, then OK
  //   minor + event allows minors + no doc   → minor ticket OK
  // `minorTemplate` is the blank form the venue/organizer attached; `minorGateReady`
  // gates the pay button; `minorDocUrl` is the buyer's uploaded copy (saved on the ticket).
  const [minorTemplate, setMinorTemplate] = useState<{ url: string; name: string } | null>(null);
  // A birth date is mandatory to buy. The gate starts blocked and only flips to
  // true once a valid date is known (entered now, or reused from the profile) and
  // resolves to an adult, a minor allowed without a doc, or a minor whose signed
  // authorization has been uploaded.
  const [minorGateReady, setMinorGateReady] = useState(false);
  // True only while a minor on a minors-allowed event still owes their signed
  // authorization upload. This is the ONLY blocked state that shows the dashed
  // "complete the form" CTA; every other blocked state (e.g. no birth date yet)
  // simply disables the normal pay button.
  const [minorDocPending, setMinorDocPending] = useState(false);
  const [minorDocUrl, setMinorDocUrl] = useState<string | null>(null);
  // Full minor classification from the gate — used to record a minor-ticket row at checkout.
  const [minorInfo, setMinorInfo] = useState<{ isMinor: boolean; birthDate: string; docUrl: string | null; docName: string | null } | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  // Sale controls (per-person limit + password gate)
  const [salePasswordEnabled, setSalePasswordEnabled] = useState(false);
  const [perPersonLimit, setPerPersonLimit] = useState<number | null>(null);
  const [alreadyPurchased, setAlreadyPurchased] = useState(0);
  const INSURANCE_RATE = 0.10;
  
  const getLocale = () => {
    switch (language) {
      case 'es': return es;
      case 'fr': return fr;
      default: return enUS;
    }
  };

  // Update attendees array when quantity changes
  useEffect(() => {
    setAttendees(prev => {
      if (quantity > prev.length) {
        // Add new attendees
        const newAttendees = [...prev];
        for (let i = prev.length; i < quantity; i++) {
          newAttendees.push({ fullName: '', email: '', phone: '' });
        }
        return newAttendees;
      } else if (quantity < prev.length) {
        // Remove excess attendees
        return prev.slice(0, quantity);
      }
      return prev;
    });
  }, [quantity]);

  // Pre-fill user profile data (for logged-in users) + check newsletter opt-in
  useEffect(() => {
    const fetchUserProfile = async () => {
      if (!user) return;
      
      const { data: profile } = await supabase
        .from('profiles')
        .select('first_name, last_name, phone')
        .eq('id', user.id)
        .single();
      
      if (profile) {
        const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ');
        setAttendees(prev => {
          const updated = [...prev];
          updated[0] = {
            ...updated[0],
            fullName: fullName || updated[0].fullName,
            email: user.email || updated[0].email,
            phone: profile.phone || updated[0].phone,
          };
          return updated;
        });
        setConfirmEmail(user.email || '');
      }

      // Check if user already opted in to newsletter for any ticket
      const { data: existingOptIn } = await supabase
        .from('tickets')
        .select('id')
        .eq('user_id', user.id)
        .eq('newsletter_opt_in', true)
        .limit(1);
      
      if (existingOptIn && existingOptIn.length > 0) {
        setAlreadyOptedIn(true);
        setNewsletterOptIn(true);
      }
    };
    
    fetchUserProfile();
  }, [user]);

  useEffect(() => {
    if (user?.email && !attendees[0].email) {
      setAttendees(prev => {
        const updated = [...prev];
        updated[0] = { ...updated[0], email: user.email || '' };
        return updated;
      });
      setConfirmEmail(user.email);
    }
  }, [user]);

  useEffect(() => {
    if (eventId && roundId) {
      fetchData();
    }
  }, [eventId, roundId]);

  // For a per-person limit, count what this logged-in buyer already holds so the
  // quantity selector reflects the remaining allowance (server is the hard cap).
  useEffect(() => {
    const fetchAlreadyPurchased = async () => {
      if (!user || !eventId || perPersonLimit == null) { setAlreadyPurchased(0); return; }
      const { data } = await supabase
        .from('tickets')
        .select('quantity')
        .eq('event_id', eventId)
        .eq('user_id', user.id)
        .eq('status', 'paid');
      const total = (data || []).reduce((sum, row: { quantity: number }) => sum + (row.quantity || 0), 0);
      setAlreadyPurchased(total);
    };
    fetchAlreadyPurchased();
  }, [user, eventId, perPersonLimit]);

  useEffect(() => {
    const checkPromoterDiscount = async () => {
      if (!venue?.id) return;
      
      // Use venue-specific lookup to ensure we match the right venue
      const storedCode = getStoredPromoCodeForVenue(venue.id);
      
      if (!storedCode) return;

      try {
        const { data: promoter, error } = await supabase
          .from('promoters')
          .select('id, promo_code, ticket_discount_type, ticket_discount_value')
          .eq('venue_id', venue.id)
          .ilike('promo_code', storedCode)
          .eq('is_active', true)
          .maybeSingle();

        if (error || !promoter) {
          return;
        }


        // Set promoter discount - even if discount is 0, we need to track the conversion
        setPromoterDiscount({
          promoterId: promoter.id,
          promoCode: promoter.promo_code,
          discountType: (promoter.ticket_discount_type as 'percentage' | 'fixed') || 'percentage',
          discountValue: promoter.ticket_discount_value || 0,
        });
      } catch (error) {
        console.error('Error checking promoter discount:', error);
      }
    };

    checkPromoterDiscount();
  }, [venue?.id]);

  // Determine if guest checkout should be blocked (presale/waitlist events)
  const [blockGuestMode, setBlockGuestMode] = useState(false);

  const fetchData = async () => {
    try {
      const { data: eventData, error: eventError } = await supabase
        .from('events')
        .select('*')
        .eq('id', eventId)
        .single();

      if (eventError) throw eventError;

      // Standalone organizer event (no venue) — load organizer name
      if (!eventData.venue_id) {
        let orgName = eventData.location_name || 'Organisateur';
        if (eventData.organizer_user_id) {
          const { data: orgProfile } = await supabase
            .from('profiles')
            .select('organization_name')
            .eq('id', eventData.organizer_user_id)
            .maybeSingle();
          if (orgProfile?.organization_name) orgName = orgProfile.organization_name;
        }
        setVenue({
          id: eventData.organizer_user_id || eventData.id,
          name: orgName,
          city: eventData.location_city || '',
          cancellationInsuranceEnabled: false, // no insurance for standalone events
        });
      } else {
        const { data: venueData, error: venueError } = await supabase
          .from('venues')
          .select('id, name, city, cancellation_insurance_enabled')
          .eq('id', eventData.venue_id)
          .maybeSingle();

        if (venueError) throw venueError;
        if (!venueData) throw new Error('Venue not found');

        setVenue({
          id: venueData.id,
          name: venueData.name,
          city: venueData.city,
          cancellationInsuranceEnabled: venueData.cancellation_insurance_enabled ?? true,
        });
      }

      const { data: roundData, error: roundError } = await supabase
        .from('ticket_rounds')
        .select('*')
        .eq('id', roundId)
        .single();

      if (roundError) throw roundError;

      setEvent({
        id: eventData.id,
        venueId: eventData.venue_id,
        title: eventData.title,
        description: eventData.description,
        posterUrl: eventData.poster_url,
        startAt: eventData.start_at,
        endAt: eventData.end_at,
        isActive: eventData.is_active,
        ticketingEnabled: eventData.ticketing_enabled,
        maxTickets: eventData.max_tickets,
        tablesEnabled: eventData.tables_enabled,
        alcoholFree: (eventData as any).alcohol_free ?? false,
        createdAt: eventData.created_at,
        updatedAt: eventData.updated_at,
      });

      setSalePasswordEnabled((eventData as any).sale_password_enabled ?? false);
      setPerPersonLimit((eventData as any).max_tickets_per_person ?? null);

      // Alcohol-free events welcome minors. If the venue (or, for venue-less events,
      // the organizer) requires a signed authorization, load that blank template so
      // a minor buyer can download, sign, and re-upload it before paying.
      if ((eventData as any).alcohol_free) {
        let doc: { url: string; name: string } | null = null;
        if (eventData.venue_id) {
          const { data: v } = await supabase
            .from('venues')
            .select('minor_auth_doc_url, minor_auth_doc_name')
            .eq('id', eventData.venue_id)
            .maybeSingle();
          if ((v as any)?.minor_auth_doc_url) doc = { url: (v as any).minor_auth_doc_url, name: (v as any).minor_auth_doc_name || '' };
        } else if (eventData.organizer_user_id) {
          const { data: o } = await supabase
            .from('organizer_profiles')
            .select('minor_auth_doc_url, minor_auth_doc_name')
            .eq('user_id', eventData.organizer_user_id)
            .maybeSingle();
          if ((o as any)?.minor_auth_doc_url) doc = { url: (o as any).minor_auth_doc_url, name: (o as any).minor_auth_doc_name || '' };
        }
        setMinorTemplate(doc);
      }

      setRound({
        id: roundData.id,
        eventId: roundData.event_id,
        name: roundData.name,
        price: Number(roundData.price),
        maxTickets: roundData.max_tickets,
        ticketsSold: roundData.tickets_sold,
        position: roundData.position,
        isActive: roundData.is_active,
        autoActivate: roundData.auto_activate,
        lastTicketsThreshold: roundData.last_tickets_threshold ?? 20,
        createdAt: roundData.created_at,
        updatedAt: roundData.updated_at,
        includesDrink: roundData.includes_drink,
        drinkDeadlineHours: roundData.drink_deadline_hours,
        drinkDeadlineType: roundData.drink_deadline_type,
        drinkCutoffTime: roundData.drink_cutoff_time,
        allowedDrinkCollections: roundData.allowed_drink_collections,
      } as TicketRound & { includesDrink?: boolean; drinkDeadlineHours?: number; drinkDeadlineType?: string; drinkCutoffTime?: string; allowedDrinkCollections?: string[] });

      // Validate presale access - prevent direct URL bypass
      const salesStatus = getEventSalesStatus(
        {
          presaleStartAt: eventData.presale_start_at || undefined,
          publicSaleStartAt: eventData.public_sale_start_at || undefined,
          waitlistEnabled: eventData.waitlist_enabled || false,
        },
        false, // We don't check sold out here, just access
      );

      // Block guest mode for presale/coming_soon events (guests can't be on waitlist)
      if (salesStatus === 'coming_soon' || salesStatus === 'presale') {
        setBlockGuestMode(true);
      }

      if (salesStatus === 'coming_soon' || salesStatus === 'presale') {
        // Check if user has presale access
        const searchParams = new URLSearchParams(window.location.search);
        const hasPromoRef = !!searchParams.get('ref') || (eventData.venue_id ? !!getStoredPromoCodeForVenue(eventData.venue_id) : false);
        
        if (!hasPromoRef) {
          const { data: { user: authUser } } = await supabase.auth.getUser();
          if (authUser) {
            const filters = [`user_id.eq.${authUser.id}`];
            const normalizedEmail = authUser.email?.toLowerCase().trim();
            if (normalizedEmail) filters.push(`email.eq.${normalizedEmail}`);

            const { data: wlEntry } = await supabase
              .from('event_waitlist')
              .select('id')
              .eq('event_id', eventId!)
              .or(filters.join(','))
              .maybeSingle();

            if (!wlEntry) {
              toast.error(t('tickets.presaleOnly'));
              navigate(-1);
              return;
            }
          } else {
            toast.error(t('tickets.presaleOnly'));
            navigate(-1);
            return;
          }
        }
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error(t('tickets.errorLoading'));
    } finally {
      setLoading(false);
    }
  };

  const subtotal = round ? round.price * quantity : 0;
  
  const calculateDiscount = () => {
    if (!promoterDiscount) return 0;
    if (promoterDiscount.discountType === 'percentage') {
      return Math.round(subtotal * (promoterDiscount.discountValue / 100) * 100) / 100;
    }
    return Math.min(promoterDiscount.discountValue, subtotal);
  };
  
  const discount = calculateDiscount();
  const discountedSubtotal = subtotal - discount;
  const serviceFee = calculateServiceFee(discountedSubtotal, 'tickets');
  const insuranceFee = hasInsurance ? Math.round(discountedSubtotal * INSURANCE_RATE * 100) / 100 : 0;
  const upsellTotal = selectedUpsells.reduce((sum, u) => sum + u.price, 0);
  const total = discountedSubtotal + serviceFee + insuranceFee + upsellTotal;
  const remainingTickets = round ? round.maxTickets - round.ticketsSold : 0;
  // Per-person allowance: limit minus what this buyer already holds. No limit → 10.
  const perOrderAllowance = perPersonLimit != null ? perPersonLimit - alreadyPurchased : 10;
  const maxQuantity = Math.min(Math.max(perOrderAllowance, 0), remainingTickets);
  const perPersonLimitReached = perPersonLimit != null && perOrderAllowance <= 0;

  // The age gate must be satisfied before paying: a known birth date (entered now
  // or reused from the profile) that resolves to an adult, a minor allowed without
  // a doc, or a minor whose signed authorization has been uploaded. No date, or a
  // minor on an adults-only event, keeps the pay button in its "incomplete" state.
  const minorGateBlocked = !minorGateReady;

  // Hide insurance if event < 24h away or venue disabled it
  const hoursUntilEvent = event ? (new Date(event.startAt).getTime() - Date.now()) / (1000 * 60 * 60) : Infinity;
  const showInsurance = (venue?.cancellationInsuranceEnabled ?? true) && hoursUntilEvent >= 24;

  // Reset insurance if no longer available
  useEffect(() => {
    if (!showInsurance && hasInsurance) setHasInsurance(false);
  }, [showInsurance]);

  // Clamp the selected quantity down when the per-person allowance shrinks.
  useEffect(() => {
    if (maxQuantity >= 1 && quantity > maxQuantity) setQuantity(maxQuantity);
  }, [maxQuantity]);

  const handleQuantityChange = (delta: number) => {
    setQuantity(prev => Math.max(1, Math.min(maxQuantity, prev + delta)));
  };

  const handleAttendeeChange = (index: number, field: keyof AttendeeInfo, value: string) => {
    setAttendees(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const validateForm = (): boolean => {
    // Validate primary buyer (first attendee)
    if (!attendees[0].fullName.trim()) {
      toast.error(t('ticketCheckout.nameRequired'));
      return false;
    }
    if (!attendees[0].email.trim()) {
      toast.error(t('ticketCheckout.emailRequired'));
      return false;
    }
    if (attendees[0].email !== confirmEmail) {
      toast.error(t('ticketCheckout.emailMismatch'));
      return false;
    }
    if (!attendees[0].phone.trim()) {
      toast.error(t('ticketCheckout.phoneRequired'));
      return false;
    }
    
    // Validate other attendees (all fields required)
    for (let i = 1; i < attendees.length; i++) {
      if (!attendees[i].fullName.trim()) {
        toast.error(t('ticketCheckout.attendeeNameRequired').replace('{number}', String(i)));
        return false;
      }
      if (!attendees[i].email.trim()) {
        toast.error(t('ticketCheckout.attendeeEmailRequired').replace('{number}', String(i)));
        return false;
      }
      if (!attendees[i].phone.trim()) {
        toast.error(t('ticketCheckout.attendeePhoneRequired').replace('{number}', String(i)));
        return false;
      }
    }
    
    if (!acceptCgv) {
      toast.error(t('cgv.required'));
      return false;
    }
    if (minorGateBlocked) {
      toast.error(t('minorAuth.incomplete'));
      return false;
    }

    return true;
  };

  const handleCheckout = async () => {
    // Re-entrancy guard: ignore a second trigger while a checkout is in flight
    // (covers Enter-key submits and render-timing races, not just the disabled button).
    if (checkoutLoading) return;
    // Validate form FIRST before checking auth
    if (!validateForm()) return;
    if (!round || !event) return;

    setCheckoutLoading(true);
    try {
      // Password-gated sale: mint the access grant for THIS buyer's identity
      // (user_id when authed, email for guests) right before checkout. The
      // reservation RPC requires this grant, so a direct-link bypass is blocked.
      if (salePasswordEnabled) {
        const storedPw = sessionStorage.getItem(`yuno_sale_pw_${event.id}`) || '';
        const guestEmailForGrant = !user ? attendees[0].email.trim() : null;
        const { data: unlocked, error: unlockErr } = await supabase.rpc('unlock_event_sale' as any, {
          p_event_id: event.id,
          p_password: storedPw,
          p_guest_email: guestEmailForGrant,
        });
        if (unlockErr || unlocked !== true) {
          toast.error(t('tickets.salePasswordWrong'));
          setCheckoutLoading(false);
          navigate(`/club/${slug}/event/${eventId}/billets`);
          return;
        }
      }

      // Record a minor-ticket row (best-effort) so the owner/organizer can later
      // see who bought a minor ticket and access their signed document. Written
      // here (not via the edge fn) so it works without an edge deploy; it only
      // surfaces once intersected with a paid purchase, so an abandoned checkout
      // never shows up. Never block the purchase if this insert fails.
      if (minorInfo?.isMinor) {
        try {
          await supabase.from('minor_ticket_docs' as any).insert({
            event_id: event.id,
            buyer_email: attendees[0].email.trim(),
            buyer_name: attendees[0].fullName.trim() || null,
            birth_date: minorInfo.birthDate || null,
            doc_url: minorInfo.docUrl,
            doc_name: minorInfo.docName,
          } as any);
        } catch (e) {
          console.error('minor_ticket_docs insert failed:', e);
        }
      }

      // CGV acceptance is handled by TermsAcceptance component
      // Prepare guest checkout data if user is not logged in
      const isGuest = !user;
      const guestCheckout = isGuest ? {
        guestEmail: attendees[0].email.trim(),
        guestFullName: attendees[0].fullName.trim(),
        guestPhone: attendees[0].phone.trim(),
      } : null;

      const { getPurchaseSource, getTrackedLinkForCheckout } = await import('@/hooks/usePurchaseSourceTracking');
      const purchaseSource = getPurchaseSource(event.id);
      const trackedLinkId = getTrackedLinkForCheckout(event.id);

      const { data, error } = await supabase.functions.invoke('create-ticket-checkout', {
        body: {
          eventId: event.id,
          language,
          ticketRoundId: round.id,
          purchaseSource,
          trackedLinkId,
          quantity,
          unitPrice: round.price,
          serviceFee,
          total,
          hasInsurance,
          insuranceFee,
          // Primary buyer info
          fullName: attendees[0].fullName.trim(),
          phone: attendees[0].phone.trim(),
          newsletterOptIn,
          smsOptIn,
          // Signed minor authorization uploaded by the buyer (alcohol-free events).
          minorAuthDocUrl: minorDocUrl,
          // Always send promoCode if we have it stored (even if client can't read promoters table due to RLS).
          promoCode: (venue?.id ? getStoredPromoCodeForVenue(venue.id) : null) ?? promoterDiscount?.promoCode ?? null,
          promoterId: promoterDiscount?.promoterId || null,
          discountAmount: discount,
          upsellSelections: selectedUpsells.map(u => ({ offerId: u.offerId, offerType: u.offerType, price: u.price, drinkCount: u.drinkCount })),
          cancelUrl: window.location.pathname,
          // All attendees for nominative tickets
          attendees: attendees.map((a) => ({
            fullName: a.fullName.trim(),
            email: a.email.trim(),
            phone: a.phone.trim(),
          })),
          // Guest checkout data
          ...guestCheckout,
        }
      });

      if (error) throw error;
      if (data?.code === 'PAYMENTS_DISABLED') {
        toast.error(t('payments.disabledBanner'));
        return;
      }
      if (data?.error) {
        if (data.code === 'ACCOUNT_EXISTS') {
          toast.error(data.error);
          navigate(`/auth?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`);
          return;
        }
        throw new Error(data.error);
      }

      // Update user's phone if they were logged in and phone was missing
      if (user && attendees[0].phone.trim()) {
        await supabase
          .from('profiles')
          .update({ phone: attendees[0].phone.trim() })
          .eq('id', user.id)
          .is('phone', null);
      }

      if (data?.testMode && data?.redirectUrl) {
        toast.success(t('tickets.purchaseSuccess'));
        window.location.href = data.redirectUrl;
        return;
      }

      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (error: any) {
      console.error('Checkout error:', error);
      toast.error(error.message || t('tickets.checkoutError'));
    } finally {
      setCheckoutLoading(false);
    }
  };

  if (loading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0A0A0A' }}>
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!event || !venue || !round) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ background: '#0A0A0A' }}>
        <p className="font-mono uppercase text-[11px] tracking-[0.06em] text-[#9A9A9A]">{t('tickets.eventNotFound')}</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate(`/club/${slug}/event/${eventId}`)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t('common.back')}
        </Button>
      </div>
    );
  }

  const roundWithDrink = round as TicketRound & { includesDrink?: boolean; drinkDeadlineHours?: number; drinkDeadlineType?: string; drinkCutoffTime?: string };

  const formatDrinkDeadline = () => {
    if (roundWithDrink.drinkDeadlineType === 'fixed_time' && roundWithDrink.drinkCutoffTime) {
      return roundWithDrink.drinkCutoffTime.slice(0, 5);
    }
    const eventStart = new Date(event.startAt);
    const deadlineTime = new Date(eventStart.getTime() + (roundWithDrink.drinkDeadlineHours || 2) * 60 * 60 * 1000);
    return formatInTimeZone(deadlineTime, PARIS_TIMEZONE, 'HH:mm');
  };

  return (
    <div className="min-h-screen" style={{ background: '#0A0A0A' }}>
      {/* Header */}
      <header
        className="sticky top-0 z-40"
        style={{ background: 'rgba(10,10,10,0.90)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
      >
        <div className="flex items-center justify-between px-4 h-12">
          <button
            onClick={() => navigate(`/club/${slug}/event/${eventId}/billets`, {
              replace: true,
              state: { restoredSelection: { type: 'ticket', id: roundId, quantity, price: round?.price || 0, name: round?.name || '' } }
            })}
            className="h-8 w-8 flex items-center justify-center bg-white/[0.06] hover:bg-white/[0.10] transition-colors"
            style={{ borderRadius: 2 }}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <p className="font-mono uppercase truncate mx-3 flex-1 text-center" style={{ fontSize: '11px', letterSpacing: '0.06em', color: '#9A9A9A' }}>{event.title}</p>
          <span className="font-mono text-[10px] font-bold text-[#5A5A5E] bg-white/[0.06] px-2 py-1" style={{ borderRadius: 2 }}>+18</span>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 pt-4 pb-36">
        <CheckoutSteps currentStep={2} />

        {/* Ticket type card */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative border border-white/[0.08] bg-[#141414] overflow-hidden mt-4"
          style={{ borderRadius: 4 }}
        >
          <div className="absolute left-0 inset-y-0 w-[3px] bg-primary" />
          <div className="pl-5 pr-4 py-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display font-bold uppercase text-white" style={{ fontSize: '17px', letterSpacing: '-0.01em', lineHeight: 1.1 }}>{round.name}</h2>
              {roundWithDrink.includesDrink && (
                <p className="font-mono uppercase text-primary mt-1.5 flex items-center gap-1.5" style={{ fontSize: '10px', letterSpacing: '0.04em' }}>
                  <Wine className="h-3 w-3" />
                  1 {t('tickets.drinkBefore')} {formatDrinkDeadline()}
                </p>
              )}
            </div>
            <p className="font-display font-bold tabular-nums shrink-0 text-white" style={{ fontSize: '22px', letterSpacing: '-0.02em' }}>{round.price.toFixed(2)} €</p>
          </div>
        </motion.div>

        {/* Quantity */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="mt-6"
        >
          <p className="font-mono uppercase text-center mb-4" style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.14em', color: '#5A5A5E' }}>
            {t('tickets.selectQuantity')}
          </p>
          <div className="flex items-center justify-center gap-8">
            <button
              onClick={() => handleQuantityChange(-1)}
              disabled={quantity <= 1}
              className="h-11 w-11 rounded-full bg-white/[0.07] flex items-center justify-center transition-all disabled:opacity-25 hover:bg-white/[0.12] active:scale-90"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="font-display font-bold w-16 text-center tabular-nums text-white" style={{ fontSize: '52px', letterSpacing: '-0.04em', lineHeight: 1 }}>{quantity}</span>
            <button
              onClick={() => handleQuantityChange(1)}
              disabled={quantity >= maxQuantity}
              className="h-11 w-11 rounded-full flex items-center justify-center transition-all disabled:opacity-25 active:scale-90"
              style={{ backgroundColor: quantity < maxQuantity ? 'rgba(232,25,44,0.80)' : 'rgba(255,255,255,0.07)' }}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          {remainingTickets <= 20 && (
            <p className="font-mono uppercase text-amber-400 text-center mt-3" style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.06em' }}>
              {t('tickets.onlyLeft').replace('{count}', remainingTickets.toString())}
            </p>
          )}
          {perPersonLimit != null && !perPersonLimitReached && (
            <p className="text-center mt-2" style={{ fontSize: '10.5px', color: '#9A9A9A' }}>
              {t('tickets.maxPerPersonNotice').replace('{count}', String(perPersonLimit))}
            </p>
          )}
          {perPersonLimitReached && (
            <p className="font-mono uppercase text-amber-400 text-center mt-3" style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.06em' }}>
              {t('tickets.maxPerPersonReached').replace('{count}', String(perPersonLimit))}
            </p>
          )}
        </motion.div>

        {/* Insurance */}
        {showInsurance && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.10 }}
            className="mt-5"
          >
            <label
              htmlFor="insurance"
              className="flex items-start gap-3 p-4 border cursor-pointer transition-all"
              style={hasInsurance
                ? { backgroundColor: 'rgba(232,25,44,0.05)', borderColor: 'rgba(232,25,44,0.28)', borderRadius: 10 }
                : { backgroundColor: '#141414', borderColor: 'rgba(255,255,255,0.08)', borderRadius: 10 }}
            >
              <Checkbox
                id="insurance"
                checked={hasInsurance}
                onCheckedChange={(checked) => setHasInsurance(checked === true)}
                className="mt-0.5"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  <span className="text-sm font-bold text-white">{t('tickets.insurance')}</span>
                  <span className="font-mono text-[9px] font-bold text-primary px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(232,25,44,0.10)' }}>+10%</span>
                </div>
                <p className="text-[11px] text-[#9A9A9A]">{t('tickets.insuranceDescription')}</p>
              </div>
            </label>
          </motion.div>
        )}

        {/* Upsells */}
        {venue && (
          <TicketUpsellSelector
            venueId={venue.id}
            selectedUpsells={selectedUpsells}
            onToggle={(upsell) => {
              setSelectedUpsells(prev => {
                const exists = prev.find(u => u.offerId === upsell.offerId);
                if (exists) return prev.filter(u => u.offerId !== upsell.offerId);
                return [...prev, upsell];
              });
            }}
          />
        )}

        {/* Promo code */}
        {promoterDiscount && discount > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 }}
            className="mt-3 flex items-center gap-2.5 p-3 border border-emerald-500/20"
            style={{ backgroundColor: 'rgba(16,185,129,0.06)', borderRadius: 4 }}
          >
            <Tag className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            <span className="font-mono uppercase text-emerald-400" style={{ fontSize: '11px', letterSpacing: '0.04em' }}>
              Code <span className="font-bold">{promoterDiscount.promoCode}</span>
              {promoterDiscount.discountType === 'percentage'
                ? ` (-${promoterDiscount.discountValue}%)`
                : ` (-${discount.toFixed(2)}€)`}
            </span>
          </motion.div>
        )}

        <div className="my-6 h-px bg-white/[0.06]" />

        {/* Presale: force login */}
        {!user && !authLoading && blockGuestMode && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="space-y-3"
          >
            <SectionLabel label={t('guest.authChoiceTitle')} />
            <div className="p-3 border border-amber-500/20" style={{ backgroundColor: 'rgba(245,158,11,0.06)', borderRadius: 4 }}>
              <p className="text-[11px] text-amber-400">
                {t('tickets.presaleLoginRequired') || 'Cet événement nécessite un compte Yuno. Connectez-vous pour continuer.'}
              </p>
            </div>
            <button
              onClick={() => navigate(`/auth?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`)}
              className="w-full flex items-center gap-3 p-4 border text-left transition-all active:scale-[0.99]"
              style={{ backgroundColor: 'rgba(232,25,44,0.05)', borderColor: 'rgba(232,25,44,0.25)', borderRadius: 10 }}
            >
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <LogIn className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-white">{t('guest.loginOption')}</p>
                <p className="text-[11px] text-[#9A9A9A] mt-0.5">{t('guest.loginOptionDesc')}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-[#5A5A5E]" />
            </button>
          </motion.div>
        )}

        {/* Attendee forms */}
        {(user || (!authLoading && !blockGuestMode)) && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="space-y-4"
          >
            <SectionLabel label={quantity > 1 ? t('ticketCheckout.attendeesInfo') : t('ticketCheckout.buyerInfo')} />

            {/* Guest checkout is the default — no decision blocks the form. Returning
                users get an optional, non-blocking link to log in and auto-fill. */}
            {!user && (
              <button
                onClick={() => navigate(`/auth?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`)}
                className="flex items-center gap-1.5 text-[12px] text-[#9A9A9A] hover:text-white transition-colors"
              >
                <LogIn className="h-3.5 w-3.5 text-primary shrink-0" />
                <span>{t('guest.haveAccountQuestion')}{' '}
                  <span className="text-primary font-semibold underline underline-offset-2">{t('guest.logIn')}</span>
                </span>
              </button>
            )}

            {attendees.map((attendee, idx) => (
              <TicketAttendeeForm
                key={idx}
                index={idx}
                attendee={attendee}
                onChange={handleAttendeeChange}
                isPrimary={idx === 0}
                showConfirmEmail={idx === 0}
                confirmEmail={confirmEmail}
                onConfirmEmailChange={setConfirmEmail}
              />
            ))}

            {/* Single age/minor gate: collect the date of birth, then branch —
                adult → normal ticket; minor on an adults-only event → blocked;
                minor on a minors-allowed event → minor ticket, plus a download +
                upload step when the venue/organizer requires a signed authorization. */}
            <MinorAuthGate
              userId={user?.id}
              eventId={event.id}
              acceptsMinors={!!event.alcoholFree}
              template={minorTemplate}
              onReady={setMinorGateReady}
              onDocUploaded={setMinorDocUrl}
              onMinorInfo={setMinorInfo}
              onDocPending={setMinorDocPending}
            />

            <MarketingOptIns
              newsletterOptIn={newsletterOptIn}
              onNewsletterChange={setNewsletterOptIn}
              smsOptIn={smsOptIn}
              onSmsChange={setSmsOptIn}
              showNewsletter={!alreadyOptedIn}
            />

            {/* Terms consent lives in the scroll flow, right below the marketing
                opt-ins — not glued to the sticky footer. */}
            <TermsAcceptance userId={user?.id} guestEmail={!user ? attendees[0]?.email : null} context="ticket" onAcceptedChange={setAcceptCgv} />
          </motion.div>
        )}
      </div>

      {/* Sticky Footer with expandable details */}
      <div className="fixed bottom-0 left-0 right-0 z-50" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <AnimatePresence>
          {showDetails && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/60 z-40"
              onClick={() => setShowDetails(false)}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showDetails && (
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="fixed bottom-0 left-0 right-0 z-50 bg-[#0A0A0A] rounded-t-3xl border-t border-white/[0.08] shadow-[0_-16px_48px_rgba(0,0,0,0.6)]"
              style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
            >
              <div className="flex justify-center pt-3 pb-2">
                <div className="w-10 h-1 rounded-full bg-white/15" />
              </div>
              <div className="max-w-lg mx-auto px-5 pb-28 max-h-[68vh] overflow-y-auto space-y-3">
                {/* Event info — calendar tile like the drink checkout (no poster image) */}
                <div className="border border-white/[0.08] bg-[#141414] p-3 flex items-center gap-3" style={{ borderRadius: 10 }}>
                  <div className="w-11 h-11 shrink-0 flex items-center justify-center bg-primary/10" style={{ borderRadius: 8 }}>
                    <Calendar className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-display font-bold uppercase text-white leading-tight" style={{ fontSize: '15px', letterSpacing: '-0.005em' }}>{event.title}</p>
                    <p className="font-mono uppercase text-[#9A9A9A] flex items-center gap-1.5 mt-1.5" style={{ fontSize: '10px', letterSpacing: '0.04em' }}>
                      {formatInTimeZone(new Date(event.startAt), PARIS_TIMEZONE, 'EEE d MMM · HH:mm', { locale: getLocale() })}
                      {' – '}
                      {formatInTimeZone(new Date(event.endAt), PARIS_TIMEZONE, 'HH:mm', { locale: getLocale() })}
                    </p>
                  </div>
                </div>

                {/* Order breakdown */}
                <div className="border border-white/[0.08] bg-[#141414] p-4" style={{ borderRadius: 10 }}>
                  <p className="font-mono uppercase mb-3" style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.14em', color: '#5A5A5E' }}>
                    {t('tickets.orderDetails')}
                  </p>
                  <div className="space-y-2.5 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[#9A9A9A]">{quantity}× {round.name}</span>
                      <span className="font-mono font-medium tabular-nums text-[#E5E5E5]">{subtotal.toFixed(2)} €</span>
                    </div>
                    {discount > 0 && (
                      <div className="flex items-center justify-between gap-3 text-emerald-400">
                        <span>{t('tickets.discount')}</span>
                        <span className="font-mono font-medium tabular-nums">-{discount.toFixed(2)} €</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[#9A9A9A]">{t('tickets.serviceFee')}</span>
                      <span className="font-mono font-medium tabular-nums text-[#E5E5E5]">{serviceFee.toFixed(2)} €</span>
                    </div>
                    {hasInsurance && (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[#9A9A9A]">{t('tickets.insurance')}</span>
                        <span className="font-mono font-medium tabular-nums text-[#E5E5E5]">{insuranceFee.toFixed(2)} €</span>
                      </div>
                    )}
                    {selectedUpsells.map((u) => (
                      <div key={u.offerId} className="flex items-center justify-between gap-3">
                        <span className="text-[#9A9A9A]">{u.name}</span>
                        <span className="font-mono font-medium tabular-nums text-[#E5E5E5]">{u.price.toFixed(2)} €</span>
                      </div>
                    ))}
                    <div className="border-t border-white/[0.08] pt-3 mt-1 flex items-center justify-between">
                      <span className="font-display font-bold text-white" style={{ fontSize: '15px' }}>{t('tickets.total')}</span>
                      <span className="font-display font-bold tabular-nums text-white" style={{ fontSize: '17px', letterSpacing: '-0.01em' }}>{total.toFixed(2)} €</span>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="relative z-50">
          {/* The pay button greys out until the age gate is satisfied. Without this
              line the disabled state is silent — the buyer can't tell a date of
              birth (collected higher up) is what's blocking them. */}
          {!checkoutLoading && minorGateBlocked && !minorDocPending && (
            <div className="max-w-lg mx-auto px-4 pt-2 pb-1 bg-[#0A0A0A]">
              <p className="text-center text-amber-400" style={{ fontSize: '11px' }}>
                {t('tickets.dobRequiredHint')}
              </p>
            </div>
          )}
          <div className="flex justify-center px-4 pb-4 bg-[#0A0A0A]">
            <div
              className="inline-flex items-center w-full max-w-md gap-4 rounded-xl px-5 py-3 justify-between"
              style={{
                background: 'rgba(14, 14, 16, 0.92)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                border: '1px solid rgba(255, 255, 255, 0.10)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(232,25,44,0.08)',
              }}
            >
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="text-left flex flex-col min-w-0"
              >
                <div className="flex items-center gap-1.5">
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '9px', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#5A5A5E' }}>
                    {t('tickets.total')}
                  </span>
                  <ChevronUp className={`h-3 w-3 text-[#5A5A5E] transition-transform ${showDetails ? 'rotate-180' : ''}`} />
                </div>
                <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '22px', fontWeight: 700, letterSpacing: '-0.02em', color: '#FFFFFF', lineHeight: 1.1 }}>
                  {total.toFixed(2)} €
                </span>
                <span style={{ fontSize: '10px', color: '#5A5A5E', marginTop: '1px' }}>{t('tickets.feesIncluded')}</span>
              </button>
              {minorGateBlocked && minorDocPending ? (
                /* Minor-needs-doc flow only: visibly incomplete, non-functional CTA
                   that nudges the buyer to download + upload the signed form. Every
                   other blocked state (e.g. no birth date yet) keeps the normal
                   pay button below, just disabled. */
                <button
                  type="button"
                  disabled
                  aria-disabled
                  className="px-5 h-11 rounded-lg font-semibold shrink-0 text-sm flex items-center gap-1.5 cursor-not-allowed"
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px dashed rgba(232,25,44,0.55)',
                    color: '#C9C9CE',
                    fontFamily: "'Inter', sans-serif",
                    letterSpacing: '0.01em',
                  }}
                >
                  <Lock className="h-4 w-4 text-primary" />
                  {t('minorAuth.incomplete')}
                </button>
              ) : (
                <button
                  onClick={handleCheckout}
                  disabled={checkoutLoading || perPersonLimitReached || minorGateBlocked}
                  className="px-6 h-11 rounded-lg font-semibold shrink-0 text-sm text-white transition-all duration-150 hover:brightness-110 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100 disabled:active:scale-100 flex items-center"
                  style={{ background: '#E8192C', border: 'none', boxShadow: '0 6px 24px rgba(232,25,44,0.35)', fontFamily: "'Inter', sans-serif", letterSpacing: '0.01em' }}
                >
                  {checkoutLoading ? (
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  ) : (
                    <>
                      {t('tickets.continue')}
                      <ChevronRight className="h-5 w-5 ml-1" />
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ label }: { label: string }) {
  return <p className="section-label-ruled mb-1">{label}</p>;
}
