import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useEventRoute } from '@/hooks/useEventRoute';
import { ArrowLeft, Minus, Plus, Tag, ChevronRight, LogIn, Wine, Lock, Users } from 'lucide-react';
import { getEventSalesStatus } from '@/types/ticketing';
import { fetchEventPaymentsReady } from '@/lib/paymentsReady';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { launchCheckout } from '@/lib/native';
import { haptics } from '@/lib/haptics';
import { useLanguage } from '@/contexts/LanguageContext';
import { useScrollIntoViewOnFocus } from '@/hooks/useScrollIntoViewOnFocus';
import { formatInTimeZone } from 'date-fns-tz';
import { enUS, es, fr } from 'date-fns/locale';
import { PARIS_TIMEZONE, getEventTimezone, countryOfPlace } from '@/lib/timezone';
import { TicketRound, EventWithTicketing, customerTransactionFee } from '@/types/ticketing';
import { useAbsorbYunoFees } from '@/hooks/useAbsorbYunoFees';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { getStoredPromoCodeForVenue, getStoredPromoCodeForScope } from '@/hooks/usePromoterTracking';
import { BuyerFields, BuyerReadyCard, FriendNames } from '@/components/checkout/BuyerDetails';
import { CheckoutStepHeader } from '@/components/checkout/CheckoutStepHeader';
import { OrderEventRow } from '@/components/checkout/OrderEventRow';
import { birthInvalidFieldFor, focusCheckoutField, useBuyerFormUi } from '@/components/checkout/useBuyerForm';
import { buyerFormErrors, firstErrorField, friendsProblems, type AttendeeInfo, type BuyerField } from '@/lib/buyerForm';
import { suggestEmail } from '@/lib/emailTypo';
import type { BirthDateState } from '@/lib/birthDate';
import { TicketUpsellSelector, SelectedUpsell } from '@/components/upsell/TicketUpsellSelector';
import { TermsNotice } from '@/components/TermsAcceptance';
import { recordTermsAcceptance } from '@/lib/termsAcceptance';
import { MinorAuthGate } from '@/components/MinorAuthGate';
import { MarketingOptIns } from '@/components/MarketingOptIns';
import { useEventMarketingHosts } from '@/hooks/useEventMarketingHosts';
import { shareCheckoutConsent } from '@/lib/coorg';
import { useCommunityAccess, CommunityCta, communityStatus } from '@/components/ticketing/CommunityTicketGate';
import { normalizeTicketAudience } from '@/types/ticketing';
import {
  useMarketingConsent, usePlatformMarketingConsent,
  recordConsentGrant, recordPlatformConsentGrant, marketingConsentWording,
} from '@/hooks/useMarketingConsent';
import { CheckoutSummaryBar } from '@/components/CheckoutSummaryBar';
import { PublicPage } from '@/components/PublicPage';
import { useExistingAccountCheck } from '@/hooks/useExistingAccountCheck';
import { ExistingAccountNotice } from '@/components/account/ExistingAccountNotice';
import { TicketCheckoutSkeleton } from '@/components/skeletons/TicketCheckoutSkeleton';
import { useMetaCheckoutPixel } from '@/hooks/useMetaPixel';
import { usePosthogEvent } from '@/hooks/usePosthogEvent';
import { useVisitorTracking } from '@/hooks/useVisitorTracking';
import { capturePosthog } from '@/lib/posthog';
import { marketProps } from '@/lib/geo';
import { checkoutFailReason } from '@/lib/checkoutFailure';
import { PromoCodeField } from '@/components/checkout/PromoCodeField';
import { bestDiscount, forgetPromoForEvent, normalizePromoCode, promoDiscountAmount, promoReasonKey, recallPromoForEvent, rememberPromoForEvent, type AppliedPromo } from '@/lib/promoCode';
import { DRINKS_PILLAR_LIVE } from '@/lib/drinksPillar';

interface PromoterDiscount {
  promoterId: string;
  promoCode: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
}

export default function TicketCheckout() {
  const { roundId } = useParams();
  // `resolving` : sur une URL propre /events/:host/:slug, l'id de la soirée
  // n'est connu qu'après une résolution serveur. Tant qu'elle court, la page
  // ne sait RIEN — ni que la soirée existe, ni qu'elle manque. Conclure
  // pendant ce temps affichait « Événement introuvable » à qui arrive par un
  // lien d'email ou de partage, avant que la billetterie ne s'affiche.
  const { eventId, basePath, resolving } = useEventRoute();
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  // Clavier iOS : garder le champ focus visible (formulaire long).
  useScrollIntoViewOnFocus();
  const { user, loading: authLoading } = useAuth();
  
  const [event, setEvent] = useState<EventWithTicketing | null>(null);
  const [venue, setVenue] = useState<{ id: string; name: string; city: string } | null>(null);
  useMetaCheckoutPixel({ eventId: event?.id ?? null, enabled: !!event?.id });
  const [round, setRound] = useState<TicketRound | null>(null);
  // Indicatif par défaut du champ téléphone = pays de la soirée. Un acheteur à
  // Madrid qui tape son numéro sous un drapeau français laisse un téléphone
  // injoignable sur son billet, et on ne le découvre qu'à la porte.
  const phoneCountry = countryOfPlace({ timezone: event?.timezone, city: venue?.city })?.code ?? null;
  // Billet communauté : statut de la personne (hôte + abonné profil / newsletter).
  // La porte réelle est serveur ; ici on évite un clic « Payer » condamné et on
  // montre l'action qui débloque. `communityDenied` = refus serveur (lien direct
  // ou invité avec un email non abonné).
  const [communityDenied, setCommunityDenied] = useState(false);
  const communityAudience = round?.audience ?? 'everyone';
  const community = useCommunityAccess(eventId, communityAudience !== 'everyone');
  const communityStatusNow = communityAudience === 'everyone' ? 'open' : communityStatus(communityAudience, community.access, community.loggedIn);
  const communityBlocked = communityStatusNow === 'locked' || (communityDenied && communityStatusNow !== 'open');
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  // Quantité choisie sur /billets (`?qty=`) : la page de sélection la portait
  // déjà, elle retombait à 1 ici. Bornée ensuite par maxQuantity (effet plus bas).
  const [quantity, setQuantity] = useState(() => {
    const q = Number(new URLSearchParams(window.location.search).get('qty'));
    return Number.isInteger(q) && q >= 1 && q <= 10 ? q : 1;
  });
  const [promoterDiscount, setPromoterDiscount] = useState<PromoterDiscount | null>(null);
  // Code promo saisi (lot F) : aperçu ici, décision serveur au paiement.
  const [appliedPromo, setAppliedPromo] = useState<AppliedPromo | null>(null);
  const [promoRestored, setPromoRestored] = useState(false);
  
  // Attendees info - index 0 is always the primary buyer
  const [attendees, setAttendees] = useState<AttendeeInfo[]>([
    { fullName: '', email: '', phone: '' }
  ]);
  // Ce qui est tapé dans la date de naissance ; null = déjà connue par le profil.
  const [birthState, setBirthState] = useState<BirthDateState | null>({ status: 'empty' });
  // Client connecté dont le profil porte déjà nom et téléphone : ses infos tiennent
  // dans une carte « Tout est prêt » ; « Modifier » rouvre les champs.
  const [profileComplete, setProfileComplete] = useState(false);
  // Profil d'un client connecté lu : la page attend cette lecture pour ne pas
  // montrer des champs vides (date de naissance comprise) qui disparaissent.
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [birthKnown, setBirthKnown] = useState(false);
  const [editingIdentity, setEditingIdentity] = useState(false);
  const fieldRefs = {
    name: useRef<HTMLDivElement>(null),
    email: useRef<HTMLDivElement>(null),
    phone: useRef<HTMLDivElement>(null),
  };
  const birthRef = useRef<HTMLFieldSetElement>(null);

  // Retour depuis Stripe par « Retour » / annulation (`?payment_cancelled=true`) :
  // on le dit, et on rend à l'acheteur ce qu'il avait tapé (quantité, nom, email,
  // téléphone) au lieu d'un formulaire vide. Le brouillon est posé juste avant le
  // départ vers Stripe et ne vit que dans cet onglet.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment_cancelled') !== 'true') return;
    try {
      const raw = sessionStorage.getItem(`yuno_ticket_draft_${roundId}`);
      const draft = raw ? JSON.parse(raw) as { quantity?: number; buyer?: AttendeeInfo } : null;
      if (draft?.quantity && Number.isInteger(draft.quantity) && draft.quantity >= 1 && draft.quantity <= 10) setQuantity(draft.quantity);
      if (draft?.buyer) setAttendees(prev => [{ ...prev[0], ...draft.buyer }, ...prev.slice(1)]);
    } catch {
      // Stockage indisponible : formulaire vide, rien de plus.
    }
    toast(t('cart.paymentCancelled'), { description: t('cart.paymentCancelledDesc') });
    params.delete('payment_cancelled');
    const rest = params.toString();
    window.history.replaceState(window.history.state, '', window.location.pathname + (rest ? `?${rest}` : ''));
  }, []); // une fois, au retour de Stripe
  // Compte déjà existant sur l'email de l'acheteur : dit à la saisie, pas au
  // bout du parcours. L'achat en invité reste possible — aucun mur ici.
  const { exists: buyerEmailHasAccount } = useExistingAccountCheck(attendees[0]?.email || '', !user);
   const [newsletterOptIn, setNewsletterOptIn] = useState(false);
  const [smsOptIn, setSmsOptIn] = useState(false);
  // Accord donné à YUNO lui-même. Troisième case, jamais fusionnée avec celles
  // du club : le consentement donné au Club A ne couvre pas Yuno (EDPB 05/2020
  // §65), pas plus que l'email ne couvre le SMS.
  const [yunoOptIn, setYunoOptIn] = useState(false);
  // Portée du consentement marketing : le club, ou l'organisateur pour une
  // soirée sans club. `venue` ci-dessus fusionne les deux cas sous un même id
  // d'affichage, ce qui ne suffit pas ici — il faut savoir LEQUEL des deux.
  const [consentScope, setConsentScope] = useState<{
    venueId: string | null;
    organizerUserId: string | null;
    scopeName: string;
  } | null>(null);
  // Marché de la soirée (analytics PostHog) : fuseau + ville, club ou orga.
  const ticketMarket = marketProps({
    timezone: event?.timezone,
    city: venue?.city,
    eventId: event?.id,
    venueId: consentScope?.venueId,
    organizerUserId: consentScope?.organizerUserId,
  });
  usePosthogEvent('checkout_started', event?.id, { pillar: 'tickets', ...ticketMarket });
  // Le parcours d'achat CONTINUE la visite de l'onglet : la Vue en direct la
  // garde vivante, et son étape (panier, paiement) vient du tunnel.
  useVisitorTracking(undefined, event?.id || undefined, undefined, { keepSession: true });
  // « A-t-elle déjà dit oui à CE club ? » — la seule question qui vaille.
  const marketingConsent = useMarketingConsent(consentScope);
  // Co-organisation : la case email nomme TOUS les hôtes qui partagent le CRM.
  const coorgHosts = useEventMarketingHosts(eventId, consentScope, language, marketingConsent.emailGranted);
  // Même question pour Yuno, dans sa propre portée (les deux colonnes à NULL).
  const platformConsent = usePlatformMarketingConsent(true);
  const [selectedUpsells, setSelectedUpsells] = useState<SelectedUpsell[]>([]);
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
  // Sale controls (per-person limit + password gate)
  const [salePasswordEnabled, setSalePasswordEnabled] = useState(false);
  const [perPersonLimit, setPerPersonLimit] = useState<number | null>(null);
  const [alreadyPurchased, setAlreadyPurchased] = useState(0);
  
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

  // Pre-fill user profile data (for logged-in users). Le compte, pas l'objet
  // session : un rafraîchissement du jeton ne relit pas le profil et n'écrase
  // pas ce que la personne vient de corriger.
  const userId = user?.id;
  const userEmail = user?.email;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const fetchUserProfile = async () => {
      const { data: profile } = await supabase
        .from('profiles')
        .select('first_name, last_name, phone, birth_date')
        .eq('id', userId)
        .maybeSingle();
      if (cancelled) return;

      if (profile) {
        setBirthKnown(!!profile.birth_date);
        const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ');
        setAttendees(prev => {
          const updated = [...prev];
          updated[0] = {
            ...updated[0],
            fullName: fullName || updated[0].fullName,
            email: userEmail || updated[0].email,
            phone: profile.phone || updated[0].phone,
          };
          return updated;
        });
        const known = buyerFormErrors({ fullName, email: userEmail || '', phone: profile.phone || '', birth: null });
        setProfileComplete(Object.keys(known).length === 0);
      }
      // Lecture en échec : la page s'ouvre quand même, champs vides.
      setProfileLoaded(true);
      // Le consentement marketing n'est PLUS déduit ici. Il était lu depuis
      // `profiles.phone_sms_opt_in` (drapeau plateforme) et depuis un `tickets`
      // sans filtre de club : un opt-in donné au Club A cochait la case pour le
      // Club B et la masquait, si bien que le Club B héritait d'un contact
      // marketing sans avoir jamais été nommé. La lecture correcte, portée par
      // club, vit maintenant dans useMarketingConsent.
    };

    fetchUserProfile();
    return () => { cancelled = true; };
  }, [userId, userEmail]);

  useEffect(() => {
    if (user?.email && !attendees[0].email) {
      setAttendees(prev => {
        const updated = [...prev];
        updated[0] = { ...updated[0], email: user.email || '' };
        return updated;
      });
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
      const storedCode = getStoredPromoCodeForScope(venue.id, venue.id);
      
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
          // Le destinataire du consentement est l'ORGANISATEUR : son nom public
          // (organizer_profiles) d'abord, le nom hérité ensuite, le lieu en
          // dernier recours seulement — la case nommait sinon le rooftop qui
          // accueille la soirée, pas celui qui écrira au client.
          const [{ data: orgPublic }, { data: orgProfile }] = await Promise.all([
            supabase.from('organizer_profiles').select('display_name')
              .eq('user_id', eventData.organizer_user_id).maybeSingle(),
            supabase.from('profiles').select('organization_name')
              .eq('id', eventData.organizer_user_id).maybeSingle(),
          ]);
          if (orgPublic?.display_name) orgName = orgPublic.display_name;
          else if (orgProfile?.organization_name) orgName = orgProfile.organization_name;
        }
        setVenue({
          id: eventData.organizer_user_id || eventData.id,
          name: orgName,
          city: eventData.location_city || '',
        });
        setConsentScope({
          venueId: null,
          organizerUserId: eventData.organizer_user_id ?? null,
          scopeName: orgName,
        });
      } else {
        const { data: venueData, error: venueError } = await supabase
          .from('venues')
          .select('id, name, city')
          .eq('id', eventData.venue_id)
          .maybeSingle();

        if (venueError) throw venueError;
        if (!venueData) throw new Error('Venue not found');

        setVenue({
          id: venueData.id,
          name: venueData.name,
          city: venueData.city,
        });
        setConsentScope({
          venueId: venueData.id,
          organizerUserId: null,
          scopeName: venueData.name,
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
        timezone: eventData.timezone,
        isActive: eventData.is_active,
        ticketingEnabled: eventData.ticketing_enabled,
        // Billetterie de la soirée marquée complète à la main (lib/soldOut.ts) :
        // la vente est fermée même si la capacité n'est pas atteinte.
        ticketsSoldOut: !!eventData.tickets_sold_out,
        maxTickets: eventData.max_tickets,
        tablesEnabled: eventData.tables_enabled,
        alcoholFree: eventData.alcohol_free ?? false,
        isBde: eventData.is_bde ?? false,
        createdAt: eventData.created_at,
        updatedAt: eventData.updated_at,
      });

      setSalePasswordEnabled(eventData.sale_password_enabled ?? false);
      setPerPersonLimit(eventData.max_tickets_per_person ?? null);

      // Alcohol-free events welcome minors. If the venue (or, for venue-less events,
      // the organizer) requires a signed authorization, load that blank template so
      // a minor buyer can download, sign, and re-upload it before paying.
      if (eventData.alcohol_free) {
        let doc: { url: string; name: string } | null = null;
        if (eventData.venue_id) {
          const { data: v } = await supabase
            .from('venues')
            .select('minor_auth_doc_url, minor_auth_doc_name')
            .eq('id', eventData.venue_id)
            .maybeSingle();
          if (v?.minor_auth_doc_url) doc = { url: v.minor_auth_doc_url, name: v.minor_auth_doc_name || '' };
        } else if (eventData.organizer_user_id) {
          const { data: o } = await supabase
            .from('organizer_profiles')
            .select('minor_auth_doc_url, minor_auth_doc_name')
            .eq('user_id', eventData.organizer_user_id)
            .maybeSingle();
          if (o?.minor_auth_doc_url) doc = { url: o.minor_auth_doc_url, name: o.minor_auth_doc_name || '' };
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
        manuallySoldOut: roundData.manually_sold_out ?? false,
        audience: normalizeTicketAudience(roundData.audience),
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
          endAt: eventData.end_at || undefined,
        },
        false, // We don't check sold out here, just access
      );

      // Soirée terminée : le checkout n'est plus accessible, même via URL directe.
      if (salesStatus === 'ended') {
        toast.error(t('salesStatus.ended'));
        navigate(-1);
        return;
      }

      // Billetterie marquée complète à la main : porte fermée ici, URL directe
      // comprise — le serveur refuserait de toute façon au clic « Payer ».
      if (eventData.tickets_sold_out) {
        toast(t('event.soldOut'));
        navigate(basePath, { replace: true });
        return;
      }

      // Club sans compte Stripe actif : le serveur refuserait ce checkout à la
      // fin du formulaire (« payments not set up »). On ferme la porte ICI,
      // URL directe comprise, avec un message neutre — jamais un message
      // d'erreur après saisie. Comptes démo @womber.fr exclus de la porte.
      if (!(await fetchEventPaymentsReady(eventId!))) {
        toast(t('salesStatus.salesNotOpenYet'));
        navigate(basePath, { replace: true });
        return;
      }

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
    // Montant PAR billet, comme le serveur (create-ticket-checkout).
    return Math.min(promoterDiscount.discountValue * quantity, subtotal);
  };

  const promoterAmount = calculateDiscount();
  const promoAmount = appliedPromo
    ? promoDiscountAmount(appliedPromo.discountType, appliedPromo.discountValue, 'tickets', quantity, subtotal)
    : 0;
  // Jamais de cumul : la plus forte des deux remises, comme le serveur.
  const best = bestDiscount(promoterAmount, promoAmount);
  const discount = best.amount;
  const discountedSubtotal = subtotal - discount;

  // Un lien « …?promo=CODE » (ou un code déjà saisi dans la session) est
  // réappliqué tout seul, après vérification.
  useEffect(() => {
    if (promoRestored || !event?.id || !round?.id) return;
    setPromoRestored(true);
    const fromUrl = normalizePromoCode(new URLSearchParams(window.location.search).get('promo'));
    if (fromUrl) rememberPromoForEvent(event.id, fromUrl);
    const code = fromUrl ?? recallPromoForEvent(event.id);
    if (!code) return;
    void (async () => {
      const { data } = await supabase.rpc('check_promo_code' as never, {
        p_code: code, p_event_id: event.id, p_pillar: 'tickets', p_ticket_round_id: round.id,
      } as never);
      const res = data as { ok?: boolean; code?: string; discountType?: 'percentage' | 'fixed'; discountValue?: number } | null;
      const ok = !!(res?.ok && res.discountType && res.discountValue != null);
      capturePosthog('promo_code_applied', {
        pillar: 'tickets',
        result: ok ? 'applied' : 'rejected',
        reason: ok ? null : ((res as { reason?: string } | null)?.reason ?? 'not_found'),
        source: fromUrl ? 'link' : 'session',
        ...marketProps({ eventId: event.id }),
      });
      if (res?.ok && res.discountType && res.discountValue != null) {
        setAppliedPromo({ code: res.code ?? code, discountType: res.discountType, discountValue: Number(res.discountValue) });
      }
    })();
  }, [promoRestored, event?.id, round?.id]);
  // Lien promoteur retenu pour ce paiement (le code vient du lien, jamais saisi).
  usePosthogEvent('promoter_attributed', event?.id && promoterDiscount?.promoterId ? `${event.id}:${promoterDiscount.promoterId}` : null, {
    pillar: 'tickets',
    source: 'link',
    stage: 'checkout',
    promoter_id: promoterDiscount?.promoterId ?? null,
    ...ticketMarket,
  });
  // Absorb mode: the club covers the Yuno commission, so the fan only pays the Stripe
  // transaction fee. Mirrors create-ticket-checkout so this total matches the charge.
  const feeAbsorbed = useAbsorbYunoFees(venue?.id ?? null);
  const serviceFee = customerTransactionFee(discountedSubtotal, 'tickets', feeAbsorbed, event?.isBde ?? false);
  const upsellTotal = selectedUpsells.reduce((sum, u) => sum + u.price, 0);
  const total = discountedSubtotal + serviceFee + upsellTotal;
  // Ce que le client aurait payé sans la remise (frais recalculés sur le plein
  // tarif) : c'est l'« ancien prix » barré à côté du total et dans la carte.
  const undiscountedTotal = subtotal + customerTransactionFee(subtotal, 'tickets', feeAbsorbed, event?.isBde ?? false) + upsellTotal;
  const unitPriceAfterDiscount = quantity > 0 ? discountedSubtotal / quantity : 0;
  const discountBadge = best.source === 'promo' && appliedPromo
    ? (appliedPromo.discountType === 'percentage' ? `-${appliedPromo.discountValue}%` : `-${(discount / Math.max(quantity, 1)).toFixed(2)} €`)
    : best.source === 'promoter' && promoterDiscount
      ? (promoterDiscount.discountType === 'percentage' ? `-${promoterDiscount.discountValue}%` : `-${(discount / Math.max(quantity, 1)).toFixed(2)} €`)
      : null;
  const appliedCodeLabel = best.source === 'promo' ? appliedPromo?.code ?? null : best.source === 'promoter' ? promoterDiscount?.promoCode ?? null : null;
  // Un round marqué épuisé manuellement n'a aucune dispo, même si la capacité n'est pas atteinte.
  const remainingTickets = round && !event?.ticketsSoldOut ? (round.manuallySoldOut ? 0 : round.maxTickets - round.ticketsSold) : 0;
  // Per-person allowance: limit minus what this buyer already holds. No limit → 10.
  const perOrderAllowance = perPersonLimit != null ? perPersonLimit - alreadyPurchased : 10;
  const maxQuantity = Math.min(Math.max(perOrderAllowance, 0), remainingTickets);
  const perPersonLimitReached = perPersonLimit != null && perOrderAllowance <= 0;

  // The age gate must be satisfied before paying: a known birth date (entered now
  // or reused from the profile) that resolves to an adult, a minor allowed without
  // a doc, or a minor whose signed authorization has been uploaded. No date, or a
  // minor on an adults-only event, keeps the pay button in its "incomplete" state.
  const minorGateBlocked = !minorGateReady;

  // Consentement SMS : la réponse est écrite sur le profil AU MOMENT où elle est
  // donnée, pas à la fin du paiement. Un checkout qui échoue (ou un rechargement)
  // ne doit pas la perdre — c'est ce qui obligeait à recocher la case à chaque
  // tentative. Best-effort : une écriture qui échoue ne bloque jamais l'achat.
  // La case SMS ne pousse plus rien sur le profil au moment du clic. Elle est
  // libellée « offres de <Club> » : la cocher engage ce club, pas la plateforme
  // entière, or `profiles.phone_sms_opt_in` est un drapeau global qui alimente
  // la segmentation admin. Écrire l'un depuis l'autre étendait le consentement
  // à une portée jamais montrée à la personne (EDPB 05/2020 §65).
  //
  // La réponse est désormais persistée après paiement par recordSmsConsent(),
  // qui alimente venue_sms_contacts (la liste du club, celle qui fait foi).
  const handleSmsOptInChange = (value: boolean) => {
    setSmsOptIn(value);
  };




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

  // Le formulaire lu d'un coup : codes d'erreur dans l'ordre de la page
  // (lib/buyerForm.ts). Le bouton n'est jamais grisé pour un oubli : au tap, la
  // page descend au premier champ à revoir et chaque champ dit quoi faire.
  const buyer = attendees[0];
  const buyerEmail = user?.email ?? buyer.email;
  const formErrors = buyerFormErrors({ fullName: buyer.fullName, email: buyerEmail, phone: buyer.phone, birth: birthState, requireTwoWords: true });
  // La date est lisible mais la soirée la refuse, ou le document signé manque :
  // c'est toujours la date qu'il faut revoir, avec le message de MinorAuthGate.
  const gateProblem = !formErrors.birth && minorGateBlocked;
  const missingCount = Object.keys(formErrors).length + (gateProblem ? 1 : 0) + Object.keys(friendsProblems(attendees)).length;
  // Un champ dit son erreur quand on le quitte (sauf « obligatoire », réservé au
  // tap sur le bouton), et le tap mène au premier oubli.
  const { touched, submitted, setSubmitted, shownError, fieldValid, markTouched } = useBuyerFormUi(formErrors);
  const emailSuggestion = !user && touched.email && !formErrors.email ? suggestEmail(buyer.email) : null;
  const birthInvalidField = birthInvalidFieldFor(formErrors.birth);

  const scrollToField = (f: BuyerField) => {
    // Un champ caché dans la carte « Tout est prêt » : on la rouvre d'abord.
    if (f !== 'birth' && user && profileComplete && !editingIdentity) setEditingIdentity(true);
    window.setTimeout(() => focusCheckoutField(f === 'birth' ? birthRef.current : fieldRefs[f].current), 0);
  };

  // Billet de plusieurs personnes : le nom complet et l'e-mail de CHAQUE autre personne
  // sont obligatoires (elle reçoit son billet). Les tables VIP n'ont pas cette règle.
  const friendProblems = friendsProblems(attendees);
  const firstFriendProblem = Object.keys(friendProblems).map(Number).sort((x, y) => x - y)[0];

  const validateForm = (): boolean => {
    const first = firstErrorField(formErrors) ?? (gateProblem ? 'birth' : null);
    if (!first && firstFriendProblem !== undefined) {
      setSubmitted(true);
      haptics.error();
      const errs = friendProblems[firstFriendProblem];
      const target = errs.name ? `ck-friend-${firstFriendProblem}-first` : `ck-friend-email-${firstFriendProblem}`;
      window.setTimeout(() => focusCheckoutField(document.getElementById(target)?.closest('.flex-col') as HTMLElement | null), 50);
      return false;
    }
    if (!first) return true;
    setSubmitted(true);
    haptics.error();
    scrollToField(first);
    return false;
  };

  const handleCheckout = async () => {
    // Re-entrancy guard: ignore a second trigger while a checkout is in flight
    // (covers Enter-key submits and render-timing races, not just the disabled button).
    if (checkoutLoading) return;
    // Validate form FIRST before checking auth
    if (!validateForm()) return;
    if (!round || !event) return;
    capturePosthog('checkout_step_completed', { pillar: 'tickets', step: 'details', quantity, ...ticketMarket });

    setCheckoutLoading(true);
    // CGV : le bouton porte « En continuant, vous acceptez les conditions de
    // vente » ; le tap vaut acceptation et laisse sa trace, comme la case d'avant.
    const termsRecorded = recordTermsAcceptance({ userId: user?.id, guestEmail: !user ? buyer.email.trim() : null, context: 'ticket' });
    // checkout_failed : une fois par échec, raison courte (jamais le message).
    let failureTracked = false;
    const trackFailure = (err: unknown, code?: unknown) => {
      if (failureTracked) return;
      failureTracked = true;
      capturePosthog('checkout_failed', { pillar: 'tickets', reason: checkoutFailReason(err, code), ...ticketMarket });
    };
    try {
      // Password-gated sale: mint the access grant for THIS buyer's identity
      // (user_id when authed, email for guests) right before checkout. The
      // reservation RPC requires this grant, so a direct-link bypass is blocked.
      if (salePasswordEnabled) {
        const storedPw = sessionStorage.getItem(`yuno_sale_pw_${event.id}`) || '';
        const guestEmailForGrant = !user ? attendees[0].email.trim() : null;
        const { data: unlocked, error: unlockErr } = await supabase.rpc('unlock_event_sale', {
          p_event_id: event.id,
          p_password: storedPw,
          p_guest_email: guestEmailForGrant,
        });
        if (unlockErr || unlocked !== true) {
          trackFailure(unlockErr, 'sale_password');
          toast.error(t('tickets.salePasswordWrong'));
          setCheckoutLoading(false);
          navigate(`${basePath}/billets`, { state: { eventId } });
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
          await supabase.from('minor_ticket_docs').insert({
            event_id: event.id,
            buyer_email: attendees[0].email.trim(),
            buyer_name: attendees[0].fullName.trim() || null,
            birth_date: minorInfo.birthDate || null,
            doc_url: minorInfo.docUrl,
            doc_name: minorInfo.docName,
          });
        } catch (e) {
          console.error('minor_ticket_docs insert failed:', e);
        }
      }

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

      // Consentement transmis = la case cochée maintenant, OU le consentement
      // déjà actif pour ce club (auquel cas aucune case n'a été affichée). Le
      // renvoyer garde la liste du club à jour et remet à zéro le compteur des
      // 36 mois côté base : un habitué ne bascule jamais en contact périmé.
      const effectiveNewsletterOptIn = newsletterOptIn || marketingConsent.emailGranted;
      const effectiveSmsOptIn = smsOptIn || marketingConsent.smsGranted;
      const effectivePlatformOptIn = yunoOptIn || platformConsent.granted;

      // Preuve d'un consentement NOUVEAU uniquement (art. 7(1) RGPD). Un
      // consentement déjà actif a déjà sa ligne au journal : le rejouer à chaque
      // achat gonflerait la preuve sans rien prouver de plus (EDPB §106).
      const consentEmail = (user?.email ?? attendees[0].email).trim();
      const consentPhone = attendees[0].phone.trim();
      const { email: emailConsentWording } = marketingConsentWording(t, coorgHosts.emailScopeName || consentScope?.scopeName, language);
      const { sms: smsConsentWording } = marketingConsentWording(t, consentScope?.scopeName, language);
      if (newsletterOptIn && !marketingConsent.emailGranted) {
        void recordConsentGrant({
          channel: 'email',
          wordingText: emailConsentWording,
          wordingKey: 'consent.emailOffersFrom',
          venueId: consentScope?.venueId ?? null,
          organizerUserId: consentScope?.organizerUserId ?? null,
          email: consentEmail,
          locale: language,
          source: 'ticket_checkout',
        });
      }
      if (smsOptIn && !marketingConsent.smsGranted) {
        void recordConsentGrant({
          channel: 'sms',
          wordingText: smsConsentWording,
          wordingKey: 'consent.smsOffersFrom',
          venueId: consentScope?.venueId ?? null,
          organizerUserId: consentScope?.organizerUserId ?? null,
          email: consentEmail,
          phoneE164: consentPhone,
          locale: language,
          source: 'ticket_checkout',
        });
      }
      if (yunoOptIn && !platformConsent.granted) {
        void recordPlatformConsentGrant({
          wordingText: t('consent.yunoOffers'),
          wordingKey: 'consent.yunoOffers',
          email: consentEmail,
          locale: language,
          source: 'ticket_checkout',
        });
      }

      const { data, error } = await invokeEdgeFunction('create-ticket-checkout', {
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
          // Primary buyer info
          fullName: attendees[0].fullName.trim(),
          phone: attendees[0].phone.trim(),
          newsletterOptIn: effectiveNewsletterOptIn,
          smsOptIn: effectiveSmsOptIn,
          platformOptIn: effectivePlatformOptIn,
          // Signed minor authorization uploaded by the buyer (alcohol-free events).
          minorAuthDocUrl: minorDocUrl,
          // Always send promoCode if we have it stored (even if client can't read promoters table due to RLS).
          // venue.id porte l'id du club, ou celui de l'organisateur quand la soirée
          // n'a pas de club (cf. fetchData). On cherche donc dans les deux portées :
          // un id de club est un slug texte, un id d'organisateur un UUID, aucune
          // collision possible. Sans ça, une soirée d'organisateur partait sans code.
          promoCode: getStoredPromoCodeForScope(venue?.id, venue?.id) ?? promoterDiscount?.promoCode ?? null,
          promoterId: promoterDiscount?.promoterId || null,
          discountAmount: discount,
          // Code promo saisi (lot F) : le serveur le revalide et retient un usage.
          discountCode: appliedPromo?.code ?? null,
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

      // Le corps de réponse est lu AVANT `error` : un refus métier arrive avec un
      // statut 4xx, et supabase-js n'expose alors qu'un « non-2xx status code »
      // opaque. invokeEdgeFunction rattache le corps réel — c'est lui qui porte le
      // motif (club sans paiement configuré, sold out…) et le code d'aiguillage.
      if (data?.code === 'PAYMENTS_DISABLED') {
        trackFailure(error, data.code);
        toast.error(t('payments.disabledBanner'));
        return;
      }
      if (data?.error) {
        trackFailure(error, data.code);
        if (data.code === 'COMMUNITY_ONLY') {
          // Tarif réservé à la communauté : on montre l'action qui débloque au
          // lieu d'un simple toast (le message serveur est déjà localisé).
          setCommunityDenied(true);
          void community.refresh();
          toast.error(data.error);
          return;
        }
        if (data.code === 'PROMO_INVALID') {
          // Code devenu invalide entre l'aperçu et le paiement (quota épuisé,
          // fin de validité) : on le retire et on le dit, le total se recalcule.
          capturePosthog('promo_code_applied', { pillar: 'tickets', result: 'rejected', reason: data.reason ?? 'invalid', source: 'checkout', ...ticketMarket });
          setAppliedPromo(null);
          forgetPromoForEvent(event?.id);
          toast.error(t(promoReasonKey(data.reason)));
          return;
        }
        if (data.code === 'ACCOUNT_EXISTS') {
          toast.error(data.error);
          navigate(`/auth?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`);
          return;
        }
        throw new Error(data.error);
      }
      if (error) throw error;

      // Soirée co-organisée : la case cochée NOMMAIT chaque hôte — son accord
      // est versé au registre de chacun (la vente existe maintenant, le serveur
      // le vérifie). Jamais sur le seul accord hérité de la portée principale.
      if (newsletterOptIn && coorgHosts.hasCohosts && event) {
        await shareCheckoutConsent({
          eventId: event.id, email: consentEmail, wording: emailConsentWording,
          locale: language, source: 'ticket_checkout', hostKeys: coorgHosts.cohostKeys,
          proof: data?.sessionId ?? data?.ticketId ?? null,
        });
      }

      // Update user's phone if they were logged in and phone was missing
      if (user && attendees[0].phone.trim()) {
        await supabase
          .from('profiles')
          .update({ phone: attendees[0].phone.trim() })
          .eq('id', user.id)
          .is('phone', null);
      }

      // Capture the buyer's name onto their profile if it's still empty (e.g. they
      // signed up with just email + password). The single `fullName` field splits
      // back into first/last; `.is('first_name', null)` guards against overwriting
      // a name they already set.
      if (user && attendees[0].fullName.trim()) {
        const parts = attendees[0].fullName.trim().split(/\s+/);
        const firstName = parts.shift() || '';
        const lastName = parts.join(' ');
        await supabase
          .from('profiles')
          .update({ first_name: firstName, last_name: lastName || null })
          .eq('id', user.id)
          .is('first_name', null);
      }

      if (data?.testMode && data?.redirectUrl) {
        // Pas de Stripe (billet gratuit, ou achat simulé d'un compte démo) :
        // la vente est confirmée ici, pas par une page Verify*.
        capturePosthog('purchase_completed', { pillar: 'tickets', payment: 'free', value: 0, currency: 'EUR', quantity, ...ticketMarket });
        await termsRecorded;
        toast.success(t('tickets.purchaseSuccess'));
        // Navigation SPA (jamais window.location.href : rechargement complet du
        // bundle → replay du splash dans l'app native, état perdu).
        // Billets gratuits/démo connectés : même détour upsell boissons que le
        // paiement Stripe (la page redirige vers la confirmation si inéligible).
        const confirmMatch = user && DRINKS_PILLAR_LIVE ? String(data.redirectUrl).match(/^\/order-confirmation\?type=ticket&id=([0-9a-f-]{36})$/i) : null;
        navigate(confirmMatch ? `/order/upsell?ticket=${confirmMatch[1]}` : data.redirectUrl);
        return;
      }

      if (data?.url) {
        capturePosthog('checkout_step_completed', { pillar: 'tickets', step: 'payment', quantity, ...ticketMarket });
        haptics.medium();
        try {
          sessionStorage.setItem(`yuno_ticket_draft_${roundId}`, JSON.stringify({ quantity, buyer: attendees[0] }));
        } catch {
          // Stockage indisponible : le retour depuis Stripe repartira d'un formulaire vide.
        }
        await termsRecorded;
        launchCheckout(data.url);
      }
    } catch (error) {
      console.error('Checkout error:', error);
      trackFailure(error);
      haptics.error();
      toast.error((error as Error).message || t('tickets.checkoutError'));
    } finally {
      setCheckoutLoading(false);
    }
  };

  if (loading || authLoading || resolving || (!!user && !profileLoaded)) {
    return <TicketCheckoutSkeleton />;
  }

  if (!event || !venue || !round) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ background: '#0A0A0A' }}>
        <p className="font-mono uppercase text-[11px] tracking-[0.06em] text-[#9A9A9A]">{t('tickets.eventNotFound')}</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate(`${basePath}`, { state: { eventId } })}>
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

  const locale = language === 'en' ? 'en-GB' : language === 'es' ? 'es-ES' : 'fr-FR';
  const money = (v: number) => `${v.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  const dateLine = [
    formatInTimeZone(new Date(event.startAt), getEventTimezone(event), 'EEE d MMM · HH:mm', { locale: getLocale() }),
    venue.city,
  ].filter(Boolean).join(' · ');
  const showIdentityCard = !!user && profileComplete && !editingIdentity;
  const payOnline = total > 0;
  const loginHref = `/auth?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
  // Ligne rouge de la barre : seulement après un tap, et seulement pour dire
  // combien d'infos restent à revoir (le détail est sous chaque champ).
  const barAlert = perPersonLimitReached
    ? t('tickets.maxPerPersonReached').replace('{count}', String(perPersonLimit))
    : submitted && missingCount > 0
      ? (missingCount === 1 ? t('ticketCheckout.missingOne') : t('ticketCheckout.missingMany').replace('{n}', String(missingCount)))
      : null;

  return (
    <div className="min-h-screen" style={{ background: '#0A0A0A' }}>
      <CheckoutStepHeader
        title={t('ticketCheckout.stepTitle')}
        step={2}
        total={3}
        onBack={() => navigate(`${basePath}/billets`, {
          replace: true,
          state: { restoredSelection: { type: 'ticket', id: roundId, quantity, price: round?.price || 0, name: round?.name || '' }, eventId }
        })}
      />

      <PublicPage variant="flow">
      <div className="mx-auto max-w-lg px-4 pb-6 pt-5">
        {/* Votre commande : la soirée, le billet, la quantité, le code promo. */}
        <section aria-label={t('ticketCheckout.summary')} className="overflow-hidden rounded-[10px] border border-white/[0.08] bg-[#141414]">
          <OrderEventRow posterUrl={event.posterUrl} dateLine={dateLine} title={event.title} />

          <div className="h-px bg-white/[0.07]" />

          <div className="flex items-center gap-3 p-3.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-[1.3] text-white [overflow-wrap:anywhere]">{round.name}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] leading-[1.4] text-[#9A9A9A]">
                {discount > 0 ? (
                  <>
                    <span className="line-through">{money(round.price)}</span>
                    <span className="font-semibold text-white">{money(unitPriceAfterDiscount)}</span>
                    {discountBadge && (
                      <span className="rounded-sm border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-px font-mono text-[9px] font-bold uppercase tracking-[0.06em] text-emerald-400">
                        {discountBadge}
                      </span>
                    )}
                  </>
                ) : (
                  <span>{money(round.price)}</span>
                )}
              </p>
              {roundWithDrink.includesDrink && (
                <p className="mt-1 flex items-center gap-1.5 text-[12.5px] leading-[1.4] text-[#9A9A9A]">
                  <Wine className="h-3 w-3 shrink-0" aria-hidden />
                  1 {t('tickets.drinkBefore').toLowerCase()} {formatDrinkDeadline()}
                </p>
              )}
              {communityAudience !== 'everyone' && (
                <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-[#E5E5E5]">
                  <Users className="h-3 w-3 shrink-0" aria-hidden />
                  {t('community.checkoutNotice').replace('{name}', community.access?.hostName ?? '')}
                </p>
              )}
              {remainingTickets > 0 && remainingTickets <= 20 && (
                <p className="mt-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-amber-400">
                  {t('tickets.onlyLeft').replace('{count}', remainingTickets.toString())}
                </p>
              )}
              {perPersonLimit != null && !perPersonLimitReached && (
                <p className="mt-1 text-[11.5px] text-[#9A9A9A]">
                  {t('tickets.maxPerPersonNotice').replace('{count}', String(perPersonLimit))}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleQuantityChange(-1)}
                disabled={quantity <= 1}
                aria-label={t('ticketCheckout.qtyMinus')}
                className="flex h-10 w-10 items-center justify-center bg-white/[0.07] text-[#E5E5E5] transition-all hover:bg-white/[0.12] active:scale-90 disabled:opacity-30 disabled:active:scale-100"
                style={{ borderRadius: 4 }}
              >
                <Minus className="h-3.5 w-3.5" strokeWidth={2.5} />
              </button>
              <span aria-live="polite" className="w-6 text-center text-base font-bold tabular-nums text-white">{quantity}</span>
              <button
                type="button"
                onClick={() => handleQuantityChange(1)}
                disabled={quantity >= maxQuantity}
                aria-label={t('ticketCheckout.qtyPlus')}
                className="flex h-10 w-10 items-center justify-center text-white transition-all active:scale-90 disabled:bg-white/[0.07] disabled:opacity-30 disabled:active:scale-100"
                style={{ borderRadius: 4, backgroundColor: quantity < maxQuantity ? '#E8192C' : undefined }}
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
              </button>
            </div>
          </div>

          {promoterDiscount && best.source === 'promoter' && (
            <div className="flex items-center gap-2.5 border-t border-white/[0.07] px-3.5 py-3" style={{ backgroundColor: 'rgba(16,185,129,0.06)' }}>
              <Tag className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />
              <span className="font-mono text-[11px] uppercase tracking-[0.04em] text-emerald-400">
                Code <span className="font-bold">{promoterDiscount.promoCode}</span>
                {promoterDiscount.discountType === 'percentage'
                  ? ` (-${promoterDiscount.discountValue}%)`
                  : ` (-${money(discount)})`}
              </span>
            </div>
          )}

          <div className="border-t border-white/[0.07]">
            <PromoCodeField
              variant="row"
              eventId={event.id}
              pillar="tickets"
              ticketRoundId={round.id}
              applied={appliedPromo}
              onChange={(promo) => {
                setAppliedPromo(promo);
                if (promo) rememberPromoForEvent(event.id, promo.code);
                else forgetPromoForEvent(event.id);
              }}
              discount={promoAmount}
              outranked={!!appliedPromo && best.source === 'promoter'}
            />
          </div>
        </section>

        {/* Upsells boissons — dorment avec le pilier (src/lib/drinksPillar.ts) */}
        {DRINKS_PILLAR_LIVE && venue && (
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

        {/* Prévente : connexion obligatoire (la liste d'attente est liée au compte). */}
        {!user && !authLoading && blockGuestMode && (
          <div className="mt-7 space-y-3">
            <SectionLabel label={t('guest.authChoiceTitle')} />
            <div className="p-3 border border-amber-500/20" style={{ backgroundColor: 'rgba(245,158,11,0.06)', borderRadius: 4 }}>
              <p className="text-[12px] text-amber-400">{t('tickets.presaleLoginRequired')}</p>
            </div>
            <button
              onClick={() => navigate(loginHref)}
              className="w-full flex items-center gap-3 p-4 border text-left transition-all active:scale-[0.99]"
              style={{ backgroundColor: 'rgba(232,25,44,0.05)', borderColor: 'rgba(232,25,44,0.25)', borderRadius: 10 }}
            >
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <LogIn className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-white">{t('guest.loginOption')}</p>
                <p className="text-[12px] text-[#9A9A9A] mt-0.5">{t('guest.loginOptionDesc')}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-[#9A9A9A]" />
            </button>
          </div>
        )}

        {/* Vos infos : une colonne, aucune carte autour des champs. */}
        {(user || (!authLoading && !blockGuestMode)) && (
          <section className="mt-7 flex flex-col gap-[18px]">
            <div>
              <h1 className="font-display text-2xl font-bold leading-[1.1] tracking-[-0.015em] text-white">
                {showIdentityCard && birthKnown ? t('ticketCheckout.readyTitle') : t('ticketCheckout.formTitle')}
              </h1>
              {showIdentityCard && birthKnown ? (
                <p className="mt-2 text-[13.5px] leading-[1.45] text-[#9A9A9A]">{t('ticketCheckout.readySub')}</p>
              ) : !user ? (
                <p className="mt-2 text-[13.5px] leading-[1.45] text-[#9A9A9A]">
                  {t('guest.haveAccountQuestion')}{' '}
                  <button
                    type="button"
                    onClick={() => navigate(loginHref)}
                    className="font-semibold text-white underline underline-offset-[3px] transition-colors hover:text-[#E5E5E5]"
                  >
                    {t('guest.logIn')}
                  </button>
                </p>
              ) : null}
            </div>

            {showIdentityCard ? (
              <BuyerReadyCard fullName={buyer.fullName} email={buyerEmail} phone={buyer.phone} onEdit={() => setEditingIdentity(true)} />
            ) : (
              <BuyerFields
                buyer={user ? { ...buyer, email: buyerEmail } : buyer}
                onChange={(field, value) => handleAttendeeChange(0, field, value)}
                onBlur={markTouched}
                errors={{ name: shownError('name') ?? undefined, email: shownError('email') ?? undefined, phone: shownError('phone') ?? undefined }}
                valid={{
                  name: fieldValid('name', buyer.fullName),
                  email: !user && fieldValid('email', buyer.email),
                  phone: fieldValid('phone', buyer.phone),
                }}
                emailReadOnly={!!user}
                emailSuggestion={emailSuggestion}
                onAcceptSuggestion={() => emailSuggestion && handleAttendeeChange(0, 'email', emailSuggestion)}
                emailNotice={!user && buyerEmailHasAccount ? <ExistingAccountNotice email={buyer.email.trim()} /> : undefined}
                defaultCountry={phoneCountry}
                splitName
                fieldRefs={fieldRefs}
              />
            )}

            {/* Date de naissance : demandée une fois, puis lue sur le profil. La
                même porte classe ensuite (majeur, mineur accepté, refusé, document). */}
            <MinorAuthGate
              userId={user?.id}
              eventId={event.id}
              acceptsMinors={!!event.alcoholFree}
              template={minorTemplate}
              onReady={setMinorGateReady}
              onDocUploaded={setMinorDocUrl}
              onMinorInfo={setMinorInfo}
              onDocPending={setMinorDocPending}
              onBirthState={setBirthState}
              error={shownError('birth')}
              invalidField={birthInvalidField}
              onBlur={() => markTouched('birth')}
              highlightDoc={submitted && minorDocPending}
              anchorRef={birthRef}
            />

            <FriendNames
              friends={attendees.slice(1)}
              onChange={(index, field, value) => handleAttendeeChange(index, field, value)}
              submitted={submitted}
            />

            {/* Billet communauté : verrou + action qui débloque (suivre / s'abonner),
                ou rappel de l'email abonné pour un invité sans compte. */}
            {communityAudience !== 'everyone' && communityBlocked && (
              <CommunityCta
                audience={communityAudience}
                access={community.access}
                eventId={eventId!}
                onChanged={async () => { await community.refresh(); setCommunityDenied(false); }}
              />
            )}
            {communityAudience !== 'everyone' && !user && !communityBlocked && (
              <p className="text-xs text-[#9A9A9A] leading-snug flex items-start gap-2">
                <Users className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                {t('community.checkoutGuestHint').replace('{name}', community.access?.hostName ?? '')}
              </p>
            )}

            <div className="pt-2.5">
              <MarketingOptIns
                variant="flat"
                // Pas de nom de destinataire résolu = pas de case à son nom : une
                // case qui ne nomme pas qui écrit ne couvre personne (EDPB
                // 05/2020 §65). La ligne Yuno, elle, se nomme toujours.
                showEmail={!!consentScope}
                showSms={!!consentScope}
                newsletterOptIn={newsletterOptIn}
                onNewsletterChange={setNewsletterOptIn}
                smsOptIn={smsOptIn}
                onSmsChange={handleSmsOptInChange}
                scopeName={coorgHosts.emailScopeName || consentScope?.scopeName}
                smsScopeName={consentScope?.scopeName}
                // Déjà abonné à l'hôte principal ne vaut pas accord pour les
                // co-hôtes : la case revient, en ne nommant que ceux à qui il reste à
                // demander (useEventMarketingHosts filtre les accords déjà donnés).
                emailAlreadyGranted={marketingConsent.emailGranted && !coorgHosts.hasCohosts}
                smsAlreadyGranted={marketingConsent.smsGranted}
                pending={marketingConsent.pending || platformConsent.pending || coorgHosts.pending}
                showYuno
                yunoOptIn={yunoOptIn}
                onYunoChange={setYunoOptIn}
                yunoAlreadyGranted={platformConsent.granted}
              />
            </div>
          </section>
        )}
      </div>
      </PublicPage>

      {/* La même barre qu'au choix du billet : total frais compris, un seul bouton
          toujours actif (un oubli mène au champ, il ne grise rien), et ce que le
          tap engage dit en clair dessous. */}
      <CheckoutSummaryBar
        reserveSpace
        total={total}
        fee={serviceFee}
        feeLabel={t('ticketCheckout.feeIncluded')}
        compareTotal={discount > 0 ? undiscountedTotal : undefined}
        buttonText={payOnline ? t('ticketSel.goToPayment') : t('tickets.continue')}
        icon={payOnline ? <Lock className="h-3.5 w-3.5" strokeWidth={2.4} aria-hidden /> : undefined}
        onClick={() => void handleCheckout()}
        loading={checkoutLoading}
        disabled={perPersonLimitReached || communityBlocked}
        alert={barAlert}
        footnote={(
          <>
            {payOnline && <>{t('ticketCheckout.payOnStripe')}<br /></>}
            <TermsNotice />
          </>
        )}
      />
    </div>
  );
}

function SectionLabel({ label }: { label: string }) {
  return <p className="section-label-ruled mb-1">{label}</p>;
}
