import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { usePreviewNavigate } from '@/contexts/OwnerPreviewContext';
import { useEventRoute } from '@/hooks/useEventRoute';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, MapPin, Calendar, Clock, Check, Tag, Repeat, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VipGuestCounter } from '@/components/vip/VipGuestCounter';
import { ZoneUpsellSheet } from '@/components/vip/ZoneUpsellSheet';
import { TermsNotice } from '@/components/TermsAcceptance';
import { recordTermsAcceptance } from '@/lib/termsAcceptance';
import { MinorAuthGate } from '@/components/MinorAuthGate';
import { CheckoutSummaryBar } from '@/components/CheckoutSummaryBar';
import { CheckoutStepHeader } from '@/components/checkout/CheckoutStepHeader';
import { OrderEventRow } from '@/components/checkout/OrderEventRow';
import { OptionalNote } from '@/components/checkout/OptionalNote';
import { BuyerFields, BuyerReadyCard } from '@/components/checkout/BuyerDetails';
import { birthInvalidFieldFor, focusCheckoutField, useBuyerFormUi } from '@/components/checkout/useBuyerForm';
import { buyerFormErrors, firstErrorField, type BuyerField } from '@/lib/buyerForm';
import { suggestEmail } from '@/lib/emailTypo';
import type { BirthDateState } from '@/lib/birthDate';
import { MarketingOptIns } from '@/components/MarketingOptIns';
import { useEventMarketingHosts } from '@/hooks/useEventMarketingHosts';
import { shareCheckoutConsent } from '@/lib/coorg';
import {
  useMarketingConsent, usePlatformMarketingConsent,
  recordConsentGrant, recordPlatformConsentGrant, marketingConsentWording,
} from '@/hooks/useMarketingConsent';
import { ClientFloorPlanPicker } from '@/components/vip/ClientFloorPlanPicker';
import { VipMenuPreview, type PreorderSelection } from '@/components/vip/VipMenuPreview';
import { VipTableWaitlistDialog } from '@/components/vip/VipTableWaitlistDialog';
import { useTableAvailability } from '@/hooks/useTableAvailability';
import { soldOutFlags, isPackSoldOut, type SoldOutEvent } from '@/lib/soldOut';
import { supabase } from '@/integrations/supabase/client';
import { PUBLIC_VENUE_COLUMNS } from '@/integrations/supabase/publicColumns';
import { fetchEventPaymentsReady } from '@/lib/paymentsReady';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { launchCheckout } from '@/lib/native';
import { haptics } from '@/lib/haptics';
import { useLanguage } from '@/contexts/LanguageContext';
import { useScrollIntoViewOnFocus } from '@/hooks/useScrollIntoViewOnFocus';
import { formatInTimeZone } from 'date-fns-tz';
import { enUS, es, fr } from 'date-fns/locale';
import { countryOfPlace, getEventTimezone } from '@/lib/timezone';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { TablePack, TableZone, estimateStripeFee } from '@/types/ticketing';
import { FloorPlanTable, VenueFloorPlan } from '@/types';
import type { Tables } from '@/integrations/supabase/types';
import { getStoredPromoCodeForScope } from '@/hooks/usePromoterTracking';
import { PublicPage } from '@/components/PublicPage';
import { useExistingAccountCheck } from '@/hooks/useExistingAccountCheck';
import { ExistingAccountNotice } from '@/components/account/ExistingAccountNotice';
import { TableCheckoutSkeleton } from '@/components/skeletons/TableCheckoutSkeleton';
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

// Mirrors supabase/functions/_shared/commission.ts (table: 4%, min 0.99€, max 25€).
const MANAGEMENT_FEE_RATE = 0.04;
const MANAGEMENT_FEE_MIN = 0.99;
const MANAGEMENT_FEE_MAX = 25;

// Sous-ensemble des colonnes PUBLIC_VENUE_COLUMNS réellement utilisées par cette page.
type PublicVenueRow = Pick<Tables<'venues'>,
  'id' | 'name' | 'address' | 'city' | 'absorb_yuno_fees' | 'vip_menu_visibility' | 'vip_menu_display_mode' | 'vip_preorder_enabled' | 'vip_placement_enabled'>;

export default function TableCheckout() {
  const { packId } = useParams();
  // `resolving` : sur une URL propre /events/:host/:slug, l'id de la soirée
  // n'est connu qu'après une résolution serveur. Tant qu'elle court, la page
  // ne sait RIEN — ni que la soirée existe, ni qu'elle manque. Conclure
  // pendant ce temps affichait « Événement introuvable » à qui arrive par un
  // lien d'email ou de partage, avant que la billetterie ne s'affiche.
  const { eventId, basePath, resolving } = useEventRoute();
  const [searchParams] = useSearchParams();
  const navigate = usePreviewNavigate();
  const { t, language } = useLanguage();
  // Clavier iOS : garder le champ focus visible (formulaire long).
  useScrollIntoViewOnFocus();
  const { user, loading: authLoading } = useAuth();
  
  const zoneId = searchParams.get('zone');
  const guestCountParam = searchParams.get('guests');
  
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // `select('*')` ne rend pas les champs calculés (cohost_*_ids) que le type
  // généré de la table inclut : on les retire du type de l'état.
  const [event, setEvent] = useState<Omit<Tables<'events'>, 'cohost_org_ids' | 'cohost_venue_ids'> | null>(null);
  const [venue, setVenue] = useState<PublicVenueRow | null>(null);
  useMetaCheckoutPixel({ eventId: eventId ?? null, enabled: !!eventId });
  // Marché de la soirée (analytics PostHog) : fuseau + ville, club ou orga.
  const tableMarket = marketProps({
    timezone: event?.timezone,
    city: venue?.city ?? event?.location_city,
    eventId,
    venueId: venue?.id,
    organizerUserId: event?.organizer_user_id ?? event?.partner_organizer_id,
  });
  usePosthogEvent('checkout_started', event?.id, { pillar: 'tables', ...tableMarket });
  // Le parcours d'achat CONTINUE la visite de l'onglet : la Vue en direct la
  // garde vivante, et son étape (panier, paiement) vient du tunnel.
  useVisitorTracking(undefined, event?.id || undefined, undefined, { keepSession: true });
  // Indicatif par défaut du champ téléphone = pays de la soirée (fuseau figé à
  // la publication, ville en repli) — pas le pays du siège de Yuno.
  const phoneCountry = countryOfPlace({ timezone: event?.timezone, city: venue?.city ?? event?.location_city })?.code ?? null;
  // Organisateur de la soirée (soirée sans club) : c'est lui qui encaisse,
  // porte le consentement marketing et absorbe (ou non) les frais.
  const [organizer, setOrganizer] = useState<{ user_id: string; display_name: string | null; absorb_yuno_fees: boolean } | null>(null);
  const [pack, setPack] = useState<TablePack | null>(null);
  const [zone, setZone] = useState<TableZone | null>(null);
  const [promoterDiscount, setPromoterDiscount] = useState<PromoterDiscount | null>(null);
  // Code promo saisi (lot F) : aperçu ici, décision serveur au paiement.
  const [appliedPromo, setAppliedPromo] = useState<AppliedPromo | null>(null);
  const [floorPlan, setFloorPlan] = useState<VenueFloorPlan | null>(null);
  const [placementEnabled, setPlacementEnabled] = useState(false);
  const [allZones, setAllZones] = useState<TableZone[]>([]);
  const [packsByZone, setPacksByZone] = useState<Record<string, TablePack[]>>({});
  const [zoneSheetOpen, setZoneSheetOpen] = useState(false);
  
  // Multi-step state (2 steps: 1=Summary+Placement, 2=Contact)
  const [currentStep, setCurrentStep] = useState<1 | 2>(1);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [placementStatus, setPlacementStatus] = useState<'none' | 'requested' | 'assign_on_arrival'>('none');
  const [upsellTable, setUpsellTable] = useState<(FloorPlanTable & { zoneName?: string; zoneColor?: string }) | null>(null);
  // Après un changement de zone / formule : où poser le client une fois les
  // données rechargées (la table gardée, ou le plan cadré sur la zone).
  const [switchFocus, setSwitchFocus] = useState<{ packId: string; zoneId: string; tableId: string | null; nonce: number } | null>(null);
  const [focusZone, setFocusZone] = useState<{ zoneId: string; nonce: number } | null>(null);
  const planSectionRef = useRef<HTMLDivElement | null>(null);
  
  // Form state — même grammaire que le paiement billet (src/lib/buyerForm.ts) :
  // nom complet, e-mail (pas de « Confirmer l'e-mail »), téléphone, date de
  // naissance en trois cases. Le bouton n'est jamais grisé pour un oubli.
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  // Compte déjà existant sur cet email : dit à la saisie. La réservation de
  // table reste ouverte en invité — c'est une information, pas une porte.
  const { exists: guestEmailHasAccount } = useExistingAccountCheck(email, !user);
  const [phone, setPhone] = useState('');
  const [remarks, setRemarks] = useState('');
  const [newsletterOptIn, setNewsletterOptIn] = useState(false);
  const [smsOptIn, setSmsOptIn] = useState(false);
  // Accord donné à YUNO lui-même. Troisième case, jamais fusionnée avec celles
  // du club : le consentement donné au Club A ne couvre pas Yuno (EDPB 05/2020
  // §65), pas plus que l'email ne couvre le SMS.
  const [yunoOptIn, setYunoOptIn] = useState(false);
  // Portée du consentement : le club quand la soirée en a un, sinon
  // l'organisateur (soirée sans club) — même règle que TicketCheckout.
  const marketingConsent = useMarketingConsent(
    venue?.id
      ? { venueId: venue.id, organizerUserId: null, scopeName: venue.name ?? '' }
      : organizer
        ? { venueId: null, organizerUserId: organizer.user_id, scopeName: organizer.display_name ?? '' }
        : null,
  );
  // Même question pour Yuno, dans sa propre portée (les deux colonnes à NULL).
  const platformConsent = usePlatformMarketingConsent(true);
  const scopeName = venue?.name ?? organizer?.display_name ?? undefined;
  // Co-organisation : la case email nomme les hôtes qui partagent le CRM et à
  // qui il reste à demander (un accord se demande une fois par destinataire).
  const coorgHosts = useEventMarketingHosts(
    eventId,
    venue?.id
      ? { venueId: venue.id, organizerUserId: null, scopeName: venue.name ?? '' }
      : organizer ? { venueId: null, organizerUserId: organizer.user_id, scopeName: organizer.display_name ?? '' } : null,
    language,
    marketingConsent.emailGranted,
  );
  // Date de naissance : demandée une fois, puis lue sur le profil. Une table est
  // réservée aux majeurs (MinorAuthGate sans mineurs) ; la date déclarée part au
  // serveur comme déclaration sur l'honneur (age-declaration.ts).
  const [birthState, setBirthState] = useState<BirthDateState | null>({ status: 'empty' });
  const [ageGateReady, setAgeGateReady] = useState(false);
  const [declaredBirthDate, setDeclaredBirthDate] = useState<string | null>(null);
  // Client connecté au profil complet : carte « Tout est prêt », « Modifier » rouvre les champs.
  const [profileComplete, setProfileComplete] = useState(false);
  const [editingIdentity, setEditingIdentity] = useState(false);
  const fieldRefs = {
    name: useRef<HTMLDivElement>(null),
    email: useRef<HTMLDivElement>(null),
    phone: useRef<HTMLDivElement>(null),
  };
  const birthRef = useRef<HTMLFieldSetElement>(null);
  
  const [guestCount, setGuestCount] = useState(1);
  const [preOrderBottles, setPreOrderBottles] = useState<PreorderSelection[]>([]);
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const { unavailableTableIds, reservationsByZone, reservationsByPack } = useTableAvailability(eventId);

  // Zone capacity guard — block once `tables_count` is reached for the selected zone.
  const activeZoneId = zoneId || pack?.zoneId || null;
  const zoneCapacity = activeZoneId
    ? (allZones.find((z) => z.id === activeZoneId)?.tablesCount ?? zone?.tablesCount ?? 0)
    : 0;
  const zoneUsed = activeZoneId ? (reservationsByZone[activeZoneId] || 0) : 0;
  const zoneFull = zoneCapacity > 0 && zoneUsed >= zoneCapacity;
  // Plafond propre à la formule (limit_tables) — le serveur reste le juge final.
  const packUsed = pack ? (reservationsByPack[pack.id] || 0) : 0;
  const packFull = !!pack?.limitTables && pack.tablesCount > 0 && packUsed >= pack.tablesCount;
  // « Complet » posé à la main par le club/organisateur sur cette soirée : toutes
  // les tables, ou cette formule. Le serveur refuse déjà le checkout — on ne
  // laisse pas remplir un formulaire condamné.
  const soldOut = soldOutFlags(event as SoldOutEvent | null);
  const packSoldOut = isPackSoldOut(soldOut, pack?.id);
  // Formules connues de cette soirée (même périmètre que le checkout) : sert à
  // lire la formule fixée d'une table du plan et à basculer dessus.
  const allPacks = useMemo(() => Object.values(packsByZone).flat(), [packsByZone]);
  const packNames = useMemo(() => Object.fromEntries(allPacks.map((p) => [p.id, p.name])), [allPacks]);
  // Formules encore proposables à la bascule de zone : une formule marquée
  // complète ne s'offre pas en alternative (le serveur la refuserait).
  const sellablePacksByZone = useMemo(() => {
    const out: Record<string, TablePack[]> = {};
    for (const [zid, list] of Object.entries(packsByZone)) {
      const keep = list.filter((p) => !isPackSoldOut(soldOut, p.id));
      if (keep.length) out[zid] = keep;
    }
    return out;
  }, [packsByZone, soldOut.tablesSoldOut, soldOut.soldOutPackIds]);

  // Table hors périmètre (autre zone ou autre formule) : on n'y bascule
  // jamais en douce. La feuille montre la formule, l'écart de prix et attend
  // une confirmation ; c'est elle qui rappelle handleTableConfirmed.
  const handleTableUpsell = (table: FloorPlanTable & { zoneName?: string; zoneColor?: string }) => {
    setUpsellTable(table);
  };

  const handleTableConfirmed = (tableId: string, newZoneId: string, newPackId: string) => {
    setUpsellTable(null);
    setSelectedTableId(tableId);
    if (pack && newPackId === pack.id && newZoneId === (zoneId || pack.zoneId)) return;
    applySwitch(newZoneId, newPackId, tableId);
  };


  // Auto-deselect table if guest count exceeds table capacity
  useEffect(() => {
    if (!selectedTableId || !floorPlan) return;
    const tables = floorPlan.layout?.tables || [];
    const table = tables.find((t) => t.id === selectedTableId);
    if (!table) return;
    const tableMax = (table.capacity || 99) + (table.maxExtraPersons || 0);
    if (guestCount > tableMax) {
      setSelectedTableId(null);
    }
  }, [guestCount, selectedTableId, floorPlan]);

  const getLocale = () => {
    switch (language) {
      case 'es': return es;
      case 'fr': return fr;
      default: return enUS;
    }
  };

  // Pre-fill user profile data
  useEffect(() => {
    const fetchUserProfile = async () => {
      if (!user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('first_name, last_name, phone')
        .eq('id', user.id)
        .single();
      if (profile) {
        const profileFullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ');
        if (profileFullName) setFullName(profileFullName);
        if (profile.phone) setPhone(profile.phone);
        const known = buyerFormErrors({ fullName: profileFullName, email: user.email || '', phone: profile.phone || '', birth: null });
        setProfileComplete(Object.keys(known).length === 0);
      }
      if (user.email) setEmail(user.email);
    };
    fetchUserProfile();
  }, [user]);

  // Le consentement marketing n'est plus déduit de `phone_sms_opt_in` : ce
  // drapeau est global à la plateforme et pré-cochait une case libellée au nom
  // d'un club précis. Une case pré-cochée ne vaut pas consentement (CJUE
  // C-673/17, Planet49), et un accord donné à un autre club ne vaut pas pour
  // celui-ci (EDPB 05/2020 §65). La lecture par club vit dans
  // useMarketingConsent.
  const handleSmsOptInChange = (value: boolean) => {
    setSmsOptIn(value);
  };




  useEffect(() => {
    if (eventId && packId) fetchData();
  }, [eventId, packId, zoneId]);

  const fetchData = async () => {
    try {
      const { data: eventData, error: eventError } = await supabase
        .from('events').select('*').eq('id', eventId).single();
      if (eventError) throw eventError;
      setEvent(eventData);

      // Club sans compte Stripe actif : le serveur refuserait cette réservation
      // au clic « Payer ». Porte fermée dès l'arrivée, URL directe comprise,
      // message neutre. Comptes démo @womber.fr exclus de la porte.
      // Pack « règlement sur place » : rien n'est encaissé en ligne, la porte
      // ne s'applique pas (c'est ce qui permet une soirée sans Stripe).
      const { data: packModeRow } = await supabase.from('table_packs').select('payment_mode').eq('id', packId).maybeSingle();
      const packOnSite = packModeRow?.payment_mode === 'on_site';
      if (!packOnSite && !(await fetchEventPaymentsReady(eventId!))) {
        toast(t('salesStatus.salesNotOpenYet'));
        navigate(basePath, { replace: true });
        return;
      }

      // Resolve venue (event.venue_id OR partner_venue_id for orga-led co-events).
      // Soirée SANS club (organisateur seul) : pas de venue, l'organisateur
      // porte tout — zones/packs/plan event-scopés, encaissement sur son compte.
      const effectiveVenueId = eventData.venue_id ?? eventData.partner_venue_id;
      let venueData: PublicVenueRow | null = null;
      if (effectiveVenueId) {
        const { data, error: venueError } = await supabase
          .from('venues').select(PUBLIC_VENUE_COLUMNS).eq('id', effectiveVenueId).single();
        if (venueError) throw venueError;
        venueData = data;
      }
      setVenue(venueData);
      const organizerId = eventData.organizer_user_id ?? eventData.partner_organizer_id ?? null;
      if (!effectiveVenueId && organizerId) {
        const { data: org } = await supabase
          .from('organizer_profiles').select('user_id, display_name, absorb_yuno_fees').eq('user_id', organizerId).maybeSingle();
        setOrganizer(org ? { user_id: org.user_id, display_name: org.display_name, absorb_yuno_fees: !!org.absorb_yuno_fees } : { user_id: organizerId, display_name: null, absorb_yuno_fees: false });
      } else {
        setOrganizer(null);
      }

      // Detect basic mode → no interactive placement. Sans club, TOUT est
      // event-scopé (basic comme élite) : aucun pack venue-scopé à réutiliser.
      const isBasicMode = eventData.tables_mode === 'basic';
      const eventScoped = isBasicMode || !effectiveVenueId;
      // Placement interactif : réglage du club quand il y en a un ; sans club,
      // le mode élite de l'organisateur vaut placement (son plan est event-scopé).
      const placementOn = !isBasicMode && (venueData ? (venueData.vip_placement_enabled || false) : true);
      setPlacementEnabled(placementOn);

      // Floor plan: prefer event-scoped (basic mode / organizer plan) then venue-scoped
      const { data: fpEvent } = await supabase
        .from('venue_floor_plans').select('*').eq('event_id', eventId).maybeSingle();
      const fpData = fpEvent ?? (placementOn && effectiveVenueId
        ? (await supabase.from('venue_floor_plans').select('*').eq('venue_id', effectiveVenueId).is('event_id', null).maybeSingle()).data
        : null);
      if (fpData) {
        setFloorPlan({
          id: fpData.id,
          venueId: fpData.venue_id,
          backgroundImageUrl: fpData.background_image_url,
          layout: fpData.layout as VenueFloorPlan['layout'],
          createdAt: fpData.created_at,
          updatedAt: fpData.updated_at,
        });
      } else {
        setFloorPlan(null);
      }

      const { data: packData, error: packError } = await supabase
        .from('table_packs').select('*').eq('id', packId).single();
      if (packError) throw packError;

      let priceOverride: number | null = null;
      const { data: eventSettingsData } = await supabase
        .from('event_table_settings').select('*').eq('event_id', eventId).maybeSingle();

      if (eventSettingsData?.preset_id) {
        const { data: presetData } = await supabase
          .from('table_pack_presets').select('*').eq('id', eventSettingsData.preset_id).single();
        if (presetData?.packs) {
          const presetPacks = presetData.packs as { packId: string; customPrice: number | null }[];
          const found = presetPacks.find(p => p.packId === packId);
          if (found?.customPrice !== null && found?.customPrice !== undefined) priceOverride = found.customPrice;
        }
      } else if (eventSettingsData?.custom_prices) {
        const customPrices = eventSettingsData.custom_prices as { packId: string; customPrice: number | null }[];
        const found = customPrices.find(p => p.packId === packId);
        if (found?.customPrice !== null && found?.customPrice !== undefined) priceOverride = found.customPrice;
      }
      
      setPack({
        id: packData.id, zoneId: packData.zone_id, venueId: packData.venue_id,
        name: packData.name, description: packData.description,
        basePrice: priceOverride ?? Number(packData.base_price),
        baseCapacity: packData.base_capacity,
        extraPersonPrice: packData.extra_person_price ? Number(packData.extra_person_price) : 0,
        maxExtraPersons: packData.max_extra_persons ?? 0,
        deposit: packData.deposit ? Number(packData.deposit) : 0,
        depositType: (packData.deposit_type as 'fixed' | 'percentage') || 'fixed',
        includedBottlesQuota: packData.included_bottles_quota || 0,
        minimumSpend: Number(packData.minimum_spend) || 0,
        arrivalDeadline: packData.arrival_deadline,
        paymentMode: (packData.payment_mode as 'online' | 'on_site') || 'online',
        tablesCount: packData.tables_count || 1,
        limitTables: !!packData.limit_tables,
        position: packData.position, isActive: packData.is_active,
        createdAt: packData.created_at, updatedAt: packData.updated_at,
      });
      
      if (zoneId) {
        const { data: zoneData } = await supabase.from('table_zones').select('*').eq('id', zoneId).single();
        if (zoneData) {
          setZone({
            id: zoneData.id, venueId: zoneData.venue_id, name: zoneData.name, color: zoneData.color,
            tablesCount: zoneData.tables_count || 1, position: zoneData.position,
            lastTablesThreshold: zoneData.last_tables_threshold ?? 20,
            createdAt: zoneData.created_at, updatedAt: zoneData.updated_at,
          });
        }
      }

      // Fetch all zones and packs for zone upsell — event-scoped (basic / sans club), else by venue_id
      const zoneQuery = eventScoped
        ? supabase.from('table_zones').select('*').eq('event_id', eventId).order('position')
        : supabase.from('table_zones').select('*').eq('venue_id', effectiveVenueId).order('position');
      const { data: allZonesData } = await zoneQuery;
      if (allZonesData) {
        const zones: TableZone[] = allZonesData.map(z => ({
          id: z.id, venueId: z.venue_id, name: z.name, color: z.color,
          tablesCount: z.tables_count || 1, position: z.position,
          lastTablesThreshold: z.last_tables_threshold ?? 20,
          createdAt: z.created_at, updatedAt: z.updated_at,
        }));
        setAllZones(zones);

        const packQuery = eventScoped
          ? supabase.from('table_packs').select('*').eq('event_id', eventId).eq('is_active', true).order('position')
          : supabase.from('table_packs').select('*').eq('venue_id', effectiveVenueId).eq('is_active', true).order('position');
        const { data: allPacksData } = await packQuery;
        if (allPacksData) {
          const grouped: Record<string, TablePack[]> = {};
          for (const p of allPacksData) {
            const tp: TablePack = {
              id: p.id, zoneId: p.zone_id, venueId: p.venue_id,
              name: p.name, description: p.description,
              basePrice: Number(p.base_price), baseCapacity: p.base_capacity,
              extraPersonPrice: p.extra_person_price ? Number(p.extra_person_price) : 0,
              maxExtraPersons: p.max_extra_persons ?? 0,
              deposit: p.deposit ? Number(p.deposit) : 0,
              depositType: (p.deposit_type as 'fixed' | 'percentage') || 'fixed',
              includedBottlesQuota: p.included_bottles_quota || 0,
              minimumSpend: Number(p.minimum_spend) || 0,
              arrivalDeadline: p.arrival_deadline,
              tablesCount: p.tables_count || 1,
              limitTables: !!p.limit_tables,
              position: p.position, isActive: p.is_active,
              createdAt: p.created_at, updatedAt: p.updated_at,
            };
            if (!grouped[tp.zoneId]) grouped[tp.zoneId] = [];
            grouped[tp.zoneId].push(tp);
          }
          setPacksByZone(grouped);
        }
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error(t('tickets.errorLoading'));
    } finally {
      setLoading(false);
    }
  };

  // Promoter discount
  useEffect(() => {
    const checkPromoterDiscount = async () => {
      const organizerId = event?.organizer_user_id ?? event?.partner_organizer_id ?? null;
      if (!venue?.id && !organizerId) return;
      // Scopé à la soirée (club OU organisateur, même logique que
      // TicketCheckout) : un code stocké pour le club A ne doit pas créditer
      // un promoteur homonyme du club B.
      const storedCode = getStoredPromoCodeForScope(venue?.id, organizerId);
      if (!storedCode) return;
      try {
        const scopeOr = [
          venue?.id ? `venue_id.eq.${venue.id}` : null,
          organizerId ? `organizer_user_id.eq.${organizerId}` : null,
        ].filter(Boolean).join(',');
        const { data: promoter, error } = await supabase
          .from('promoters')
          .select('id, promo_code, table_discount_type, table_discount_value')
          .or(scopeOr).ilike('promo_code', storedCode).eq('is_active', true).limit(1).maybeSingle();
        if (error || !promoter) return;
        if (promoter.table_discount_value && promoter.table_discount_value > 0) {
          setPromoterDiscount({
            promoterId: promoter.id, promoCode: promoter.promo_code,
            discountType: (promoter.table_discount_type as 'percentage' | 'fixed') || 'percentage',
            discountValue: promoter.table_discount_value,
          });
        }
      } catch (error) {
        console.error('Error checking promoter discount:', error);
      }
    };
    checkPromoterDiscount();
  }, [venue?.id, event?.organizer_user_id, event?.partner_organizer_id]);

  // Lien promoteur retenu pour cette réservation (le code vient du lien).
  usePosthogEvent('promoter_attributed', event?.id && promoterDiscount?.promoterId ? `${event.id}:${promoterDiscount.promoterId}` : null, {
    pillar: 'tables',
    source: 'link',
    stage: 'checkout',
    promoter_id: promoterDiscount?.promoterId ?? null,
    ...tableMarket,
  });
  usePosthogEvent('table_zone_viewed', zone?.id, { zone_id: zone?.id, placement: 'checkout', ...tableMarket });

  const packGuestLimit = pack ? pack.baseCapacity + pack.maxExtraPersons : 1;

  useEffect(() => {
    if (!pack) return;

    const parsedGuests = Number.parseInt(guestCountParam || '', 10);
    if (!Number.isFinite(parsedGuests)) return;

    const nextGuestCount = Math.min(Math.max(parsedGuests, 1), packGuestLimit);
    setGuestCount(current => (current === nextGuestCount ? current : nextGuestCount));
  }, [pack, packGuestLimit, guestCountParam]);

  const calculatePricing = () => {
    if (!pack) return { totalPrice: 0, deposit: 0, managementFee: 0, toPay: 0, remainingBalance: 0, discount: 0, promoterAmount: 0, promoAmount: 0, discountSource: null as 'promoter' | 'promo' | null, fullPrice: 0, fullDeposit: 0, fullToPay: 0 };
    const effectiveGuestCount = Math.min(Math.max(guestCount, 1), packGuestLimit);
    const baseGuests = pack.baseCapacity;
    const extraGuests = Math.max(0, Math.min(effectiveGuestCount - baseGuests, pack.maxExtraPersons));
    const fullPrice = pack.basePrice + (extraGuests * pack.extraPersonPrice);
    // Règlement sur place : rien à payer en ligne, rien à remiser, le prix reste informatif.
    if (pack.paymentMode === 'on_site') {
      return { totalPrice: fullPrice, deposit: 0, managementFee: 0, toPay: 0, remainingBalance: fullPrice, discount: 0, promoterAmount: 0, promoAmount: 0, discountSource: null as 'promoter' | 'promo' | null, fullPrice, fullDeposit: 0, fullToPay: 0 };
    }
    // Miroir de create-table-checkout : l'acompte se calcule sur le prix plein
    // (pas d'acompte = tout payer en ligne), et la remise — promoteur OU code
    // promo, jamais les deux — porte sur cet acompte puis sur le total.
    let fullDeposit = fullPrice;
    if (pack.deposit > 0) {
      fullDeposit = pack.depositType === 'percentage'
        ? Math.round(fullPrice * pack.deposit / 100 * 100) / 100
        : pack.deposit;
    }
    let promoterAmount = 0;
    if (promoterDiscount && promoterDiscount.discountValue > 0) {
      promoterAmount = promoterDiscount.discountType === 'percentage'
        ? Math.round(fullDeposit * (promoterDiscount.discountValue / 100) * 100) / 100
        : Math.min(promoterDiscount.discountValue, fullDeposit);
    }
    const promoAmount = appliedPromo
      ? promoDiscountAmount(appliedPromo.discountType, appliedPromo.discountValue, 'tables', 1, fullDeposit)
      : 0;
    const best = bestDiscount(promoterAmount, promoAmount);
    const discount = best.amount;
    const deposit = fullDeposit - discount;
    const totalPrice = fullPrice - discount;
    // Absorb mode: the club covers the Yuno commission, so the fan pays only the Stripe
    // transaction cost on the deposit charged now. Mirrors create-table-checkout's
    // `transactionFee`; the default path is left byte-identical.
    const feeAbsorbed = venue ? venue.absorb_yuno_fees === true : organizer?.absorb_yuno_fees === true;
    const feeFor = (dep: number) => {
      const base = dep > 0 ? dep * MANAGEMENT_FEE_RATE : (fullPrice / 2) * MANAGEMENT_FEE_RATE;
      return feeAbsorbed
        ? estimateStripeFee(dep)
        : Math.round(Math.min(MANAGEMENT_FEE_MAX, Math.max(MANAGEMENT_FEE_MIN, base)) * 100) / 100;
    };
    const managementFee = feeFor(deposit);
    const toPay = deposit + managementFee;
    const remainingBalance = totalPrice - deposit;
    // Les montants SANS remise (prix barrés à côté des montants remisés).
    const fullToPay = fullDeposit + feeFor(fullDeposit);
    return { totalPrice, deposit, managementFee, toPay, remainingBalance, discount, promoterAmount, promoAmount, discountSource: best.source, fullPrice, fullDeposit, fullToPay };
  };

  const pricing = calculatePricing();

  // Un lien « …?promo=CODE » (ou un code déjà saisi dans la session) est
  // réappliqué tout seul, après vérification.
  const [promoRestored, setPromoRestored] = useState(false);
  useEffect(() => {
    if (promoRestored || !event?.id || !pack || pack.paymentMode === 'on_site') return;
    setPromoRestored(true);
    const fromUrl = normalizePromoCode(new URLSearchParams(window.location.search).get('promo'));
    if (fromUrl) rememberPromoForEvent(event.id, fromUrl);
    const code = fromUrl ?? recallPromoForEvent(event.id);
    if (!code) return;
    void (async () => {
      const { data } = await supabase.rpc('check_promo_code' as never, {
        p_code: code, p_event_id: event.id, p_pillar: 'tables',
      } as never);
      const res = data as { ok?: boolean; reason?: string; code?: string; discountType?: 'percentage' | 'fixed'; discountValue?: number } | null;
      const ok = !!(res?.ok && res.discountType && res.discountValue != null);
      capturePosthog('promo_code_applied', {
        pillar: 'tables',
        result: ok ? 'applied' : 'rejected',
        reason: ok ? null : (res?.reason ?? 'not_found'),
        source: fromUrl ? 'link' : 'session',
        ...marketProps({ eventId: event.id }),
      });
      if (res?.ok && res.discountType && res.discountValue != null) {
        setAppliedPromo({ code: res.code ?? code, discountType: res.discountType, discountValue: Number(res.discountValue) });
      }
    })();
  }, [promoRestored, event?.id, pack]);

  const handleNextStep = () => {
    if (currentStep === 1) {
      // If user selected a table, set placement to requested
      if (selectedTableId) {
        setPlacementStatus('requested');
      }
      // If placement is available but user hasn't chosen and hasn't skipped, default to skip
      if (showPlacement && !selectedTableId && placementStatus === 'none') {
        setPlacementStatus('assign_on_arrival');
      }
      capturePosthog('checkout_step_completed', {
        pillar: 'tables',
        step: 'placement',
        table_chosen: !!selectedTableId,
        guests: guestCount,
        ...tableMarket,
      });
      setCurrentStep(2);
    }
  };

  const handlePrevStep = () => {
    if (currentStep === 2) {
      setCurrentStep(1);
    }
  };

  const handleSkipPlacement = () => {
    setSelectedTableId(null);
    setPlacementStatus('assign_on_arrival');
    toast.success(t('vipCheckout.skipPlacementConfirm') || 'Le club choisira votre table à votre arrivée');
  };

  const handleZoneChange = (newZoneId: string, newPackId: string) => {
    setZoneSheetOpen(false);
    setUpsellTable(null);
    // Venu de la liste des zones : la table courante n'appartient plus à la
    // zone choisie, on repart sans table et on cadre la zone sur le plan.
    applySwitch(newZoneId, newPackId, null);
  };

  const packPriceFor = (p: TablePack, guests: number) => {
    const extra = Math.max(0, Math.min(guests - p.baseCapacity, p.maxExtraPersons));
    return p.basePrice + extra * p.extraPersonPrice;
  };

  /**
   * Bascule le checkout sur une autre zone / formule. Rien n'est payé à ce
   * stade, donc pas de confirmation : la bascule est immédiate et un toast
   * « Annuler » restaure l'état exact d'avant (zone, formule, table, convives).
   * The data-fetch effect keys off [eventId, packId, zoneId] : changer la route
   * recharge la zone / formule sans rechargement de page.
   */
  const applySwitch = (newZoneId: string, newPackId: string, keepTableId: string | null) => {
    if (!pack) return;
    const previous = { zoneId: zoneId || pack.zoneId, packId: pack.id, tableId: selectedTableId, guests: guestCount };
    const target = allPacks.find((p) => p.id === newPackId);
    const targetZone = allZones.find((z) => z.id === newZoneId);
    setSelectedTableId(keepTableId);
    setSwitchFocus({ packId: newPackId, zoneId: newZoneId, tableId: keepTableId, nonce: Date.now() });
    navigate(`${basePath}/table/${newPackId}?zone=${newZoneId}&guests=${guestCount}`, { replace: true, state: { eventId } });
    if (!target) return;
    capturePosthog('table_pack_selected', {
      pack_id: target.id,
      zone_id: newZoneId,
      payment_mode: target.paymentMode ?? 'online',
      price: packPriceFor(target, Math.max(1, Math.min(guestCount, target.baseCapacity + target.maxExtraPersons))),
      guests: guestCount,
      source: 'switch',
      ...tableMarket,
    });
    const keptTable = keepTableId ? (floorPlan?.layout?.tables || []).find((tb) => tb.id === keepTableId) : undefined;
    const guestsForPrice = Math.max(1, Math.min(guestCount, target.baseCapacity + target.maxExtraPersons));
    toast(`${target.name} · ${Math.round(packPriceFor(target, guestsForPrice))} €`, {
      id: 'vip-switch',
      duration: 6000,
      description: keptTable
        ? t('vipCheckout.tableKept').replace('{table}', keptTable.name)
        : t('vipCheckout.pickTableIn').replace('{zone}', targetZone?.name || ''),
      action: {
        label: t('common.cancel'),
        onClick: () => {
          toast.dismiss('vip-switch');
          setSelectedTableId(previous.tableId);
          setSwitchFocus({ packId: previous.packId, zoneId: previous.zoneId, tableId: previous.tableId, nonce: Date.now() });
          navigate(`${basePath}/table/${previous.packId}?zone=${previous.zoneId}&guests=${previous.guests}`, { replace: true, state: { eventId } });
        },
      },
    });
  };

  // Une fois la nouvelle formule chargée : défiler jusqu'au plan, cadré sur
  // la zone. Avec une table gardée il ne reste qu'à continuer ; sans table il
  // ne reste qu'à en choisir une. Une seule question à l'écran, pas deux.
  useEffect(() => {
    if (!switchFocus || !pack || pack.id !== switchFocus.packId) return;
    const el = planSectionRef.current;
    const raf = requestAnimationFrame(() => {
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setFocusZone({ zoneId: switchFocus.zoneId, nonce: switchFocus.nonce });
    });
    setSwitchFocus(null);
    return () => cancelAnimationFrame(raf);
  }, [switchFocus, pack]);

  const payAtClubGuests = 0;

  // Changement d'étape : on repart du haut (l'étape 1 se termine souvent sous le plan).
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [currentStep]);

  // Le formulaire lu d'un coup (lib/buyerForm.ts). Connecté : l'adresse est celle
  // du compte, le serveur n'en lit pas d'autre (create-table-checkout).
  const buyerEmail = user?.email ?? email;
  const formErrors = buyerFormErrors({ fullName, email: buyerEmail, phone, birth: birthState });
  // Date lisible mais refusée (mineur) : c'est la date qu'il faut revoir.
  const gateProblem = !formErrors.birth && !ageGateReady;
  const missingCount = Object.keys(formErrors).length + (gateProblem ? 1 : 0);
  const { touched, submitted, setSubmitted, shownError, fieldValid, markTouched } = useBuyerFormUi(formErrors);
  const emailSuggestion = !user && touched.email && !formErrors.email ? suggestEmail(email) : null;

  const scrollToField = (f: BuyerField) => {
    // Un champ caché dans la carte « Tout est prêt » : on la rouvre d'abord.
    if (f !== 'birth' && user && profileComplete && !editingIdentity) setEditingIdentity(true);
    window.setTimeout(() => focusCheckoutField(f === 'birth' ? birthRef.current : fieldRefs[f].current), 0);
  };

  const validateForm = (): boolean => {
    const first = firstErrorField(formErrors) ?? (gateProblem ? 'birth' : null);
    if (!first) return true;
    setSubmitted(true);
    haptics.error();
    scrollToField(first);
    return false;
  };

  const handleSubmit = async () => {
    // Re-entrancy guard: ignore a second submit while one is already in flight.
    if (submitting) return;
    if (packSoldOut) {
      toast.error(t('tables.soldOutNotice'));
      setSubmitting(false);
      return;
    }

    if (zoneFull) {
      toast.error(
        t('tableCheckout.zoneFull') ||
          `Cette zone est complète (${zoneUsed}/${zoneCapacity} tables réservées). Choisis une autre zone.`,
      );
      setSubmitting(false);
      return;
    }
    if (packFull) {
      toast.error(t('tableCheckout.packFull'));
      setSubmitting(false);
      return;
    }
    // Un oubli ne grise rien : le tap mène au premier champ à revoir.
    if (!validateForm()) return;
    capturePosthog('checkout_step_completed', { pillar: 'tables', step: 'details', guests: guestCount, ...tableMarket });
    
    setSubmitting(true);
    // CGV et âge : la phrase sous le bouton (« En continuant, vous certifiez avoir
    // 18 ans ou plus et acceptez les conditions de vente ») ; le tap vaut
    // acceptation et laisse sa trace, comme la case d'avant.
    const termsRecorded = recordTermsAcceptance({ userId: user?.id, guestEmail: !user ? email.trim() : null, context: 'table' });
    // checkout_failed : une fois par échec, raison courte (jamais le message).
    let failureTracked = false;
    const trackFailure = (err: unknown, code?: unknown) => {
      if (failureTracked) return;
      failureTracked = true;
      capturePosthog('checkout_failed', { pillar: 'tables', reason: checkoutFailReason(err, code), ...tableMarket });
    };
    try {
      const isGuest = !user;
      const guestCheckout = isGuest ? { guestEmail: email.trim(), guestFullName: fullName.trim(), guestPhone: phone.trim() } : null;
      const consentEmail = buyerEmail.trim();

      const { getPurchaseSource, getTrackedLinkForCheckout } = await import('@/hooks/usePurchaseSourceTracking');
      const purchaseSource = getPurchaseSource(eventId);
      const trackedLinkId = getTrackedLinkForCheckout(eventId);

      // Case cochée maintenant, OU consentement déjà actif pour ce club (auquel
      // cas aucune case n'a été montrée). Le renvoyer rafraîchit la liste du
      // club et remet à zéro le compteur des 36 mois.
      const effectiveNewsletterOptIn = newsletterOptIn || marketingConsent.emailGranted;
      const effectiveSmsOptIn = smsOptIn || marketingConsent.smsGranted;
      const effectivePlatformOptIn = yunoOptIn || platformConsent.granted;

      // Preuve d'un consentement nouveau seulement (art. 7(1) RGPD ; EDPB
      // 05/2020 §108 pour le libellé exact, §106 pour ne pas journaliser plus
      // que nécessaire).
      const { email: emailConsentWording } = marketingConsentWording(t, coorgHosts.emailScopeName || scopeName, language);
      const { sms: smsConsentWording } = marketingConsentWording(t, scopeName, language);
      const consentOrganizerId = venue?.id ? null : (organizer?.user_id ?? null);
      if (newsletterOptIn && !marketingConsent.emailGranted) {
        void recordConsentGrant({
          channel: 'email',
          wordingText: emailConsentWording,
          wordingKey: 'consent.emailOffersFrom',
          venueId: venue?.id ?? null,
          organizerUserId: consentOrganizerId,
          email: consentEmail,
          locale: language,
          source: 'table_checkout',
        });
      }
      if (smsOptIn && !marketingConsent.smsGranted) {
        void recordConsentGrant({
          channel: 'sms',
          wordingText: smsConsentWording,
          wordingKey: 'consent.smsOffersFrom',
          venueId: venue?.id ?? null,
          organizerUserId: consentOrganizerId,
          email: consentEmail,
          phoneE164: phone.trim(),
          locale: language,
          source: 'table_checkout',
        });
      }
      if (yunoOptIn && !platformConsent.granted) {
        void recordPlatformConsentGrant({
          wordingText: t('consent.yunoOffers'),
          wordingKey: 'consent.yunoOffers',
          email: consentEmail,
          locale: language,
          source: 'table_checkout',
        });
      }

      const { data, error } = await invokeEdgeFunction('create-table-checkout', {
        body: {
          eventId, packId, zoneId,
          language,
          purchaseSource,
          trackedLinkId,
          guestCount: Math.min(guestCount, pack!.baseCapacity + pack!.maxExtraPersons),
          extraGuestsAtClub: payAtClubGuests,
          totalPrice: pricing.totalPrice, deposit: pricing.deposit,
          managementFee: pricing.managementFee,
          fullName: fullName.trim(), email: consentEmail, phone: phone.trim(),
          remarks: payAtClubGuests > 0
            ? `${remarks.trim()}\n[+${payAtClubGuests} personne(s) supplémentaire(s) — à régler sur place]`.trim()
            : remarks.trim(),
          newsletterOptIn: effectiveNewsletterOptIn,
          smsOptIn: effectiveSmsOptIn,
          platformOptIn: effectivePlatformOptIn,
          // Le code stocké part TOUJOURS, même sans remise table.
          //
          // Ces deux champs venaient de promoterDiscount, qui n'est renseigné
          // que si (a) la requête cliente sur `promoters` aboutit — or aucune
          // policy RLS ne laisse un acheteur lire cette table, donc elle ne
          // renvoie jamais rien — et (b) le promoteur a une remise table non
          // nulle. Résultat : le checkout partait sans code, et AUCUNE vente de
          // table n'a jamais généré de commission. Le serveur, lui, sait
          // résoudre le code (il utilise la clé service).
          promoCode: promoterDiscount?.promoCode || getStoredPromoCodeForScope(venue?.id, event.organizer_user_id ?? event.partner_organizer_id),
          promoterId: promoterDiscount?.promoterId || null,
          discountAmount: pricing.discount,
          // Code promo saisi (lot F) : le serveur le revalide et retient un usage.
          discountCode: pack?.paymentMode === 'on_site' ? null : appliedPromo?.code ?? null,
          cancelUrl: window.location.pathname,
          // Placement data
          requestedTableId: selectedTableId,
          placementStatus: placementStatus,
          ageDeclaration: { confirmed: true, birthDate: declaredBirthDate ?? undefined },
          // Pré-commande bouteilles (préparées pour l'arrivée, réglées à la table)
          preOrderBottles: preOrderBottles.map(b => ({
            menuItemId: b.menuItemId, quantity: b.quantity, unitPrice: b.unitPrice, itemName: b.itemName,
          })),
          ...guestCheckout,
        }
      });
      
      // Corps de réponse lu AVANT `error` : un refus métier revient en 4xx, et
      // supabase-js n'expose alors qu'un « non-2xx status code » opaque. Le motif
      // réel (et le code d'aiguillage) vit dans le corps, rattaché par invokeEdgeFunction.
      if (data?.code === 'PAYMENTS_DISABLED') {
        trackFailure(error, data.code);
        toast.error(t('payments.disabledBanner'));
        return;
      }
      if (data?.error) {
        trackFailure(error, data.code);
        if (data.code === 'PROMO_INVALID') {
          capturePosthog('promo_code_applied', { pillar: 'tables', result: 'rejected', reason: data.reason ?? 'invalid', source: 'checkout', ...tableMarket });
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

      // Soirée co-organisée : la case cochée nommait chaque hôte.
      if (newsletterOptIn && coorgHosts.hasCohosts && eventId) {
        await shareCheckoutConsent({
          eventId, email: consentEmail, wording: emailConsentWording,
          locale: language, source: 'table_checkout', hostKeys: coorgHosts.cohostKeys,
          proof: data?.sessionId ?? data?.reservationId ?? null,
        });
      }

      if (user && phone.trim()) {
        await supabase.from('profiles').update({ phone: phone.trim() }).eq('id', user.id).is('phone', null);
      }

      // Capture the buyer's name onto their profile if it's still empty (e.g. they
      // signed up with just email + password). Guarded so we never overwrite an
      // existing name.
      if (user && fullName.trim()) {
        const parts = fullName.trim().split(/\s+/);
        const firstName = parts.shift() || '';
        const lastName = parts.join(' ');
        await supabase.from('profiles').update({ first_name: firstName, last_name: lastName || null }).eq('id', user.id).is('first_name', null);
      }
      
      // Reçu passé par l'état de navigation : un invité (sans compte) ne peut
      // pas relire sa réservation sous RLS, la page de confirmation s'en sert
      // en repli — même mécanique que les billets (guestTicketData).
      const guestTableData = data?.reservationId ? {
        id: data.reservationId,
        qrCode: data.qrCode,
        eventId: event.id,
        eventTitle: event.title,
        eventDate: event.start_at,
        eventTimezone: getEventTimezone(event),
        eventCity: venue?.city || event.location_city || undefined,
        eventPosterUrl: event.poster_url,
        venueName: venue?.name ?? event.location_name ?? organizer?.display_name ?? undefined,
        venueAddress: venue?.address ?? event.location_address ?? undefined,
        venueId: venue?.id,
        details: `${zone?.name || ''} - ${pack.name}`,
        guestCount: Math.min(Math.max(guestCount, 1), packGuestLimit),
        totalPrice: pricing.totalPrice,
        managementFee: pricing.managementFee,
        unitPrice: pricing.deposit,
        customerName: fullName.trim(),
        customerEmail: consentEmail,
        customerPhone: phone.trim(),
        paidAt: new Date().toISOString(),
        onSitePayment: pack.paymentMode === 'on_site',
        organizerLed: !!event.organizer_user_id,
      } : undefined;
      // Réservation confirmée sans Stripe (formule réglée sur place, ou achat
      // simulé d'un compte démo) : la vente se compte ici, pas dans Verify*.
      if (!data?.url && data?.redirectUrl) {
        capturePosthog('purchase_completed', {
          pillar: 'tables',
          payment: pack.paymentMode === 'on_site' ? 'on_site' : 'free',
          value: pricing.totalPrice,
          currency: 'EUR',
          ...tableMarket,
        });
      }
      await termsRecorded;
      if (data?.testMode && data?.redirectUrl) {
        toast.success(t('tables.reservationSuccess') || 'Réservation confirmée !');
        // Navigation SPA — window.location.href recharge le bundle (splash natif).
        navigate(data.redirectUrl, { state: { guestTableData } });
        return;
      }
      if (data?.url) {
        capturePosthog('checkout_step_completed', { pillar: 'tables', step: 'payment', guests: guestCount, ...tableMarket });
        haptics.medium();
        launchCheckout(data.url);
      }
      else if (data?.redirectUrl) {
        toast.success(t('tables.reservationSuccess') || 'Réservation confirmée !');
        navigate(data.redirectUrl, { state: { guestTableData } });
      }
    } catch (error) {
      console.error('Checkout error:', error);
      trackFailure(error);
      haptics.error();
      toast.error((error as Error).message || t('tickets.checkoutError'));
      // Échec de réservation (le plus souvent : zone complète) -> proposer la liste d'attente.
      setWaitlistOpen(true);
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading || loading || resolving) {
    return <TableCheckoutSkeleton />;
  }

  if (!event || !pack) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ background: 'var(--sf-0a0a0a)' }}>
        <p className="font-mono uppercase text-[11px] tracking-[0.06em] text-[var(--tx-9a9a9a)]">{t('tickets.eventNotFound')}</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate(`${basePath}`, { state: { eventId } })}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t('common.back')}
        </Button>
      </div>
    );
  }


  const showPlacement = placementEnabled && !!floorPlan;
  const onSite = pack.paymentMode === 'on_site';
  const locale = language === 'en' ? 'en-GB' : language === 'es' ? 'es-ES' : 'fr-FR';
  const money = (v: number) => `${v.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  const venueLabel = venue?.name ?? event.location_name ?? organizer?.display_name ?? null;
  const dateLine = [
    formatInTimeZone(new Date(event.start_at), getEventTimezone(event), 'EEE d MMM · HH:mm', { locale: getLocale() }),
    venueLabel,
  ].filter(Boolean).join(' · ');
  const effectiveGuests = Math.min(Math.max(guestCount, 1), packGuestLimit);
  const guestsLabel = effectiveGuests === 1
    ? t('tableCheckout.guestOne')
    : t('tableCheckout.guestsN').replace('{n}', String(effectiveGuests));
  const chosenTableName = selectedTableId
    ? (floorPlan?.layout?.tables || []).find((tb) => tb.id === selectedTableId)?.name ?? null
    : null;
  // Les tables du plan portent déjà leur nom complet (« Table 4 »).
  const tableLabel = chosenTableName ?? (showPlacement ? t('tableCheckout.tableByClub') : null);
  const remaining = !onSite && pricing.remainingBalance > 0.004 ? pricing.remainingBalance : 0;
  // Ce que dit la barre : le montant prélevé maintenant (acompte + frais) ; une
  // formule réglée sur place n'a rien à payer en ligne, la barre ne porte que le bouton.
  const barTotal = onSite ? 0 : pricing.toPay;
  const barTotalLabel = !onSite && remaining > 0 ? t('tableCheckout.depositToday') : undefined;
  const capacityAlert = packSoldOut
    ? t('tables.soldOutNotice')
    : zoneFull
      ? t('tableCheckout.zoneFull')
      : packFull ? t('tableCheckout.packFull') : null;
  const showIdentityCard = !!user && profileComplete && !editingIdentity;
  const loginHref = `/auth?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
  // Ligne rouge de la barre, à l'étape 2 : un vrai blocage (complet), ou — après
  // un tap seulement — combien d'infos restent à revoir (le détail est sous chaque champ).
  const detailsAlert = capacityAlert
    ?? (submitted && missingCount > 0
      ? (missingCount === 1 ? t('ticketCheckout.missingOne') : t('ticketCheckout.missingMany').replace('{n}', String(missingCount)))
      : null);
  // Sous le bouton : une formule réglée sur place n'a pas de montant dans la
  // barre, la phrase le dit. Le reste à régler au club, lui, vit dans la carte.
  const balanceNote = onSite
    ? t('tableCheckout.onSiteFootnote').replace('{amount}', money(pricing.totalPrice))
    : null;

  return (
    <div className="min-h-screen" style={{ background: '#0A0A0A' }}>
      <CheckoutStepHeader
        title={currentStep === 1 ? t('tableCheckout.stepTable') : t('ticketCheckout.stepTitle')}
        step={currentStep}
        total={3}
        onBack={currentStep === 1 ? () => navigate(`${basePath}/billets`, { replace: true, state: { eventId } }) : handlePrevStep}
      />

      <PublicPage variant="flow">
      <div className="mx-auto max-w-lg px-4 pb-6 pt-5">
          <AnimatePresence mode="wait">
            {/* ÉTAPE 1 : la formule, le nombre de personnes, la table. */}
            {currentStep === 1 && (
              <motion.div key="step1" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                {/* Pack header */}
                <div className="flex items-start justify-between gap-3 mb-5">
                  <div className="min-w-0">
                    <h1 className="font-display font-bold uppercase text-white" style={{ fontSize: 'clamp(24px, 6vw, 32px)', letterSpacing: '-0.02em', lineHeight: 0.95 }}>{zone?.name || pack.name}</h1>
                    <p className="font-mono uppercase mt-1.5" style={{ fontSize: '10px', letterSpacing: '0.06em', color: '#9A9A9A' }}>{pack.name}</p>
                  </div>
                  {allZones.length > 1 && (
                    <button
                      onClick={() => setZoneSheetOpen(true)}
                      className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 bg-white/[0.06] hover:bg-white/[0.10] font-mono uppercase text-[10px] font-bold tracking-[0.08em] text-[#E5E5E5] transition-colors"
                      style={{ borderRadius: 4, border: '1px solid rgba(255,255,255,0.12)' }}
                    >
                      <Repeat className="h-3 w-3" />
                      {t('vipCheckout.changeZone') || 'Changer de zone'}
                    </button>
                  )}
                </div>

                {/* Premium guest counter */}
                <VipGuestCounter
                  count={guestCount}
                  onChange={setGuestCount}
                  baseCapacity={pack.baseCapacity}
                  maxExtraPersons={pack.maxExtraPersons}
                  extraPersonPrice={pack.extraPersonPrice}
                  payAtClubMax={0}
                />

                {/* Event meta */}
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-5 font-mono uppercase" style={{ fontSize: '10px', letterSpacing: '0.06em', color: '#9A9A9A' }}>
                  <div className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" aria-hidden />
                    {formatInTimeZone(new Date(event.start_at), getEventTimezone(event), 'EEE d MMM', { locale: getLocale() })}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" aria-hidden />
                    {formatInTimeZone(new Date(event.start_at), getEventTimezone(event), 'HH:mm')}
                  </div>
                  {(venue?.address || event.location_name) && (
                    <div className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5" aria-hidden />
                      {venue?.name ?? event.location_name}
                    </div>
                  )}
                </div>

                {/* Arrival cutoff — shown only when the owner set one on the pack */}
                {pack.arrivalDeadline && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border px-3 py-2.5" style={{ borderColor: 'rgba(232,25,44,0.25)', background: 'rgba(232,25,44,0.06)' }}>
                    <Clock className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
                    <div className="min-w-0">
                      <p className="font-mono uppercase" style={{ fontSize: '11px', letterSpacing: '0.04em', color: '#F5F5F5' }}>
                        {(t('tableCheckout.arrivalBefore') || 'Arrivée avant {time}').replace('{time}', pack.arrivalDeadline)}
                      </p>
                      <p style={{ fontSize: '12px', color: '#9A9A9A', marginTop: 2 }}>{t('tableCheckout.arrivalBeforeNote')}</p>
                    </div>
                  </div>
                )}

                {/* Le prix : ce qui se paie maintenant, ce qui reste au club, le code promo. */}
                <section aria-label={t('ticketCheckout.summary')} className="mt-5 overflow-hidden rounded-[10px] border border-white/[0.08] bg-[#141414]">
                  <div className="space-y-2.5 p-3.5">
                    {appliedPromo && pricing.discountSource === 'promo' && (
                      <PriceRow
                        tone="discount"
                        label={<><Tag className="h-3 w-3" aria-hidden />Code {appliedPromo.code}{appliedPromo.discountType === 'percentage' ? ` (-${appliedPromo.discountValue}%)` : ''}</>}
                        value={`-${money(pricing.discount)}`}
                      />
                    )}
                    {promoterDiscount && pricing.discountSource === 'promoter' && (
                      <PriceRow
                        tone="discount"
                        label={<><Tag className="h-3 w-3" aria-hidden />Code {promoterDiscount.promoCode}{promoterDiscount.discountType === 'percentage' ? ` (-${promoterDiscount.discountValue}%)` : ''}</>}
                        value={`-${money(pricing.discount)}`}
                      />
                    )}
                    <PriceRow
                      label={t('tableCheckout.totalPrice')}
                      value={money(pricing.totalPrice)}
                      was={pricing.discount > 0 ? money(pricing.fullPrice) : undefined}
                    />
                    {onSite ? (
                      <div className="rounded-lg px-3 py-2.5" style={{ background: 'rgba(52,211,153,0.07)', border: '1px solid rgba(52,211,153,0.2)' }}>
                        <p className="font-display font-bold text-emerald-400" style={{ fontSize: '14px' }}>{t('tableCheckout.onSiteTitle')}</p>
                        <p className="mt-0.5 text-[12px] text-[#9A9A9A]">{t('tableCheckout.onSiteDesc')}</p>
                      </div>
                    ) : (
                      <>
                        {remaining > 0 && (
                          <PriceRow
                            label={t('tableCheckout.deposit')}
                            value={money(pricing.deposit)}
                            was={pricing.discount > 0 ? money(pricing.fullDeposit) : undefined}
                          />
                        )}
                        <PriceRow label={t('tableCheckout.managementFee')} value={money(pricing.managementFee)} />
                        <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] pt-3">
                          <span className="font-display text-[15px] font-bold text-white">{t('tableCheckout.toPay')}</span>
                          <span className="flex items-baseline gap-2 whitespace-nowrap">
                            {pricing.discount > 0 && <span className="font-mono text-[12px] tabular-nums text-[#9A9A9A] line-through">{money(pricing.fullToPay)}</span>}
                            <span className="font-display text-xl font-bold tabular-nums text-white" style={{ letterSpacing: '-0.02em' }}>{money(pricing.toPay)}</span>
                          </span>
                        </div>
                        {remaining > 0 && (
                          <p className="text-[12px] leading-[1.45] text-[#9A9A9A]">
                            {t('tableCheckout.remainingAtClub').replace('{amount}', money(remaining))}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                  {/* Code promo (lot F) — rien à remiser sur une formule réglée sur place */}
                  {!onSite && (
                    <div className="border-t border-white/[0.07]">
                      <PromoCodeField
                        variant="row"
                        eventId={event.id}
                        pillar="tables"
                        applied={appliedPromo}
                        onChange={(promo) => {
                          setAppliedPromo(promo);
                          if (promo) rememberPromoForEvent(event.id, promo.code);
                          else forgetPromoForEvent(event.id);
                        }}
                        discount={pricing.promoAmount}
                        outranked={!!appliedPromo && pricing.discountSource === 'promoter'}
                      />
                    </div>
                  )}
                </section>

                {/* Vitrine carte bouteilles (idée #2) — pilotée par le réglage club.
                    Pilier boissons en pause (src/lib/drinksPillar.ts) : la précommande de
                    bouteilles dort avec lui (les bouteilles INCLUSES dans la formule restent). */}
                {DRINKS_PILLAR_LIVE && venue?.id && (
                  <VipMenuPreview
                    venueId={venue.id}
                    packId={pack?.id}
                    zoneId={activeZoneId}
                    visibility={venue.vip_menu_visibility}
                    displayMode={venue.vip_menu_display_mode === 'visual' ? 'visual' : 'text'}
                    preorderEnabled={!!venue.vip_preorder_enabled}
                    onPreorderChange={setPreOrderBottles}
                    minimumSpend={pack?.minimumSpend}
                  />
                )}

                {/* Interactive floor plan for table selection */}
                {showPlacement && floorPlan && (
                  <div className="mt-7" ref={planSectionRef} style={{ scrollMarginTop: 'calc(env(safe-area-inset-top, 0px) + 5rem)' }}>
                    <p className="section-label-ruled mb-1.5">{t('vipCheckout.selectTable')}</p>
                    <p className="text-[12px] text-[#9A9A9A] mb-4">{t('vipCheckout.selectTableDescription')}</p>
                    {placementStatus === 'assign_on_arrival' && !selectedTableId ? (
                      <div className="text-center py-7 space-y-3 border border-white/[0.08] bg-[#141414]" style={{ borderRadius: 10 }}>
                        <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                          <Check className="h-6 w-6 text-primary" />
                        </div>
                        <div className="px-4">
                          <p className="font-display font-bold uppercase text-white" style={{ fontSize: '14px' }}>{t('vipCheckout.clubWillAssign') || 'Le club choisira votre table'}</p>
                          <p className="text-xs text-[#9A9A9A] mt-1.5 leading-relaxed">
                            {t('vipCheckout.clubWillAssignDesc') || 'L\'équipe VIP vous assignera la meilleure table disponible à votre arrivée'}
                          </p>
                        </div>
                        <button
                          onClick={() => setPlacementStatus('none')}
                          className="inline-flex items-center h-9 px-4 font-mono uppercase text-[10px] font-bold tracking-[0.10em] text-[#E5E5E5] bg-white/[0.06] hover:bg-white/[0.10] transition-colors"
                          style={{ borderRadius: 4 }}
                        >
                          {t('vipCheckout.chooseMyself') || 'Je préfère choisir moi-même'}
                        </button>
                      </div>
                    ) : (
                      <ClientFloorPlanPicker
                        floorPlan={floorPlan}
                        unavailableTableIds={unavailableTableIds}
                        selectedTableId={selectedTableId}
                        onSelectTable={setSelectedTableId}
                        onSkip={handleSkipPlacement}
                        primaryZoneId={zoneId || undefined}
                        packId={pack.id}
                        packNames={packNames}
                        onUpsellTable={handleTableUpsell}
                        guestCount={guestCount}
                        focusZone={focusZone}
                      />
                    )}
                  </div>
                )}

                {/* Zone Upsell Sheet */}
                <ZoneUpsellSheet
                  open={zoneSheetOpen || !!upsellTable}
                  onClose={() => { setZoneSheetOpen(false); setUpsellTable(null); }}
                  currentZoneId={zoneId || pack.zoneId}
                  currentPackPrice={pricing.totalPrice}
                  currentPackName={pack.name}
                  currentPackId={pack.id}
                  zones={allZones}
                  packsByZone={sellablePacksByZone}
                  guestCount={guestCount}
                  onSelectZone={handleZoneChange}
                  targetTable={upsellTable}
                  onSelectTable={handleTableConfirmed}
                />
              </motion.div>
            )}

            {/* ÉTAPE 2 : vos infos — même grammaire que le paiement billet. */}
            {currentStep === 2 && (
              <motion.div key="step2" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                {/* Votre commande : la soirée, la table, ce qui se paie maintenant. */}
                <section aria-label={t('ticketCheckout.summary')} className="overflow-hidden rounded-[10px] border border-white/[0.08] bg-[#141414]">
                  <OrderEventRow posterUrl={event.poster_url} dateLine={dateLine} title={event.title} />
                  <div className="h-px bg-white/[0.07]" />
                  <div className="flex items-start gap-3 p-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold leading-[1.3] text-white [overflow-wrap:anywhere]">
                        {zone?.name && zone.name !== pack.name ? `${zone.name} · ${pack.name}` : pack.name}
                      </p>
                      <p className="mt-1 text-[12.5px] leading-[1.4] text-[#9A9A9A]">
                        {[guestsLabel, tableLabel].filter(Boolean).join(' · ')}
                      </p>
                      {pack.arrivalDeadline && (
                        <p className="mt-1 flex items-center gap-1.5 text-[12.5px] leading-[1.4] text-[#9A9A9A]">
                          <Clock className="h-3 w-3 shrink-0" aria-hidden />
                          {(t('tableCheckout.arrivalBefore') || 'Arrivée avant {time}').replace('{time}', pack.arrivalDeadline)}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={handlePrevStep}
                      className="h-8 shrink-0 px-2.5 font-mono text-[10.5px] font-bold uppercase tracking-[0.08em] text-white transition-colors hover:bg-white/[0.06]"
                      style={{ borderRadius: 4, border: '1px solid rgba(255,255,255,0.14)' }}
                    >
                      {t('ticketCheckout.edit')}
                    </button>
                  </div>
                  <div className="space-y-2 border-t border-white/[0.07] p-3.5">
                    <PriceRow
                      label={t('tableCheckout.totalPrice')}
                      value={money(pricing.totalPrice)}
                      was={pricing.discount > 0 ? money(pricing.fullPrice) : undefined}
                    />
                    {onSite ? (
                      <p className="text-[12.5px] font-medium leading-[1.4] text-emerald-400">{t('tableCheckout.onSiteDesc')}</p>
                    ) : remaining > 0 ? (
                      <PriceRow label={t('tableCheckout.remainingLabel')} value={money(remaining)} />
                    ) : null}
                    {pricing.discount > 0 && (
                      <p className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.04em] text-emerald-400">
                        <Tag className="h-3 w-3 shrink-0" aria-hidden />
                        {t('tableCheckout.discountApplied').replace('{amount}', money(pricing.discount))}
                      </p>
                    )}
                  </div>
                </section>

                {/* Vos infos : une colonne, aucune carte autour des champs. */}
                <section className="mt-7 flex flex-col gap-[18px]">
                  <div>
                    <h1 className="font-display text-2xl font-bold leading-[1.1] tracking-[-0.015em] text-white">
                      {showIdentityCard ? t('ticketCheckout.readyTitle') : t('tableCheckout.formTitle')}
                    </h1>
                    {showIdentityCard ? (
                      <p className="mt-2 text-[13.5px] leading-[1.45] text-[#9A9A9A]">
                        {onSite ? t('tableCheckout.readySubOnSite') : t('ticketCheckout.readySub')}
                      </p>
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
                    <BuyerReadyCard fullName={fullName} email={buyerEmail} phone={phone} onEdit={() => setEditingIdentity(true)} />
                  ) : (
                    <BuyerFields
                      buyer={{ fullName, email: buyerEmail, phone }}
                      onChange={(field, value) => {
                        if (field === 'fullName') setFullName(value);
                        else if (field === 'email') setEmail(value);
                        else setPhone(value);
                      }}
                      onBlur={markTouched}
                      errors={{ name: shownError('name') ?? undefined, email: shownError('email') ?? undefined, phone: shownError('phone') ?? undefined }}
                      valid={{
                        name: fieldValid('name', fullName),
                        email: !user && fieldValid('email', email),
                        phone: fieldValid('phone', phone),
                      }}
                      emailReadOnly={!!user}
                      emailSuggestion={emailSuggestion}
                      onAcceptSuggestion={() => emailSuggestion && setEmail(emailSuggestion)}
                      emailNotice={!user && guestEmailHasAccount ? <ExistingAccountNotice email={email.trim()} /> : undefined}
                      emailHint={t('tableCheckout.emailHint')}
                      emailAccountHint={t('tableCheckout.emailAccountHint')}
                      defaultCountry={phoneCountry}
                      fieldRefs={fieldRefs}
                    />
                  )}

                  {/* Date de naissance : une table est réservée aux majeurs. Demandée
                      une fois, puis lue sur le profil ; la porte contrôle la pièce d'identité. */}
                  <MinorAuthGate
                    userId={user?.id}
                    eventId={event.id}
                    acceptsMinors={false}
                    template={null}
                    hint={t('tableCheckout.birthHint')}
                    onReady={setAgeGateReady}
                    onDocUploaded={() => {}}
                    onMinorInfo={(info) => setDeclaredBirthDate(info?.birthDate || null)}
                    onBirthState={setBirthState}
                    error={shownError('birth')}
                    invalidField={birthInvalidFieldFor(formErrors.birth)}
                    onBlur={() => markTouched('birth')}
                    anchorRef={birthRef}
                  />

                  <OptionalNote
                    id="tc-remarks"
                    title={t('tableCheckout.remarksAdd')}
                    hint={t('tableCheckout.remarksHint')}
                    label={t('tableCheckout.remarksLabel')}
                    placeholder={t('tableCheckout.remarksPlaceholder')}
                    value={remarks}
                    onChange={setRemarks}
                  />

                  <div className="pt-2.5">
                    <MarketingOptIns
                      variant="flat"
                      // Pas de nom de destinataire résolu = pas de case à son nom :
                      // une case qui ne nomme pas qui écrit ne couvre personne
                      // (EDPB 05/2020 §65). La ligne Yuno, elle, se nomme toujours.
                      showEmail={!!scopeName}
                      showSms={!!scopeName}
                      newsletterOptIn={newsletterOptIn}
                      onNewsletterChange={setNewsletterOptIn}
                      smsOptIn={smsOptIn}
                      onSmsChange={handleSmsOptInChange}
                      scopeName={coorgHosts.emailScopeName || scopeName}
                      smsScopeName={scopeName}
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
              </motion.div>
            )}
          </AnimatePresence>
      </div>
      </PublicPage>

      {/* Liste d'attente : proposée après un refus (zone complète). Hors des étapes,
          pour s'ouvrir aussi depuis l'étape 2, là où la réservation échoue. */}
      {venue?.id && (
        <VipTableWaitlistDialog
          open={waitlistOpen}
          onOpenChange={setWaitlistOpen}
          venueId={venue.id}
          eventId={eventId}
          zoneId={activeZoneId}
          packId={pack?.id}
          defaultName={fullName}
          defaultEmail={buyerEmail}
          defaultPhone={phone}
          guestCount={guestCount}
        />
      )}

      {/* La même barre que les billets : le montant prélevé maintenant, un seul
          bouton. Étape 1 : « Continuer ». Étape 2 : le paiement (ou la
          confirmation d'une formule réglée sur place), et ce que le tap engage. */}
      {currentStep === 1 ? (
        <CheckoutSummaryBar
          reserveSpace
          total={barTotal}
          totalLabel={barTotalLabel}
          fee={onSite ? 0 : pricing.managementFee}
          feeLabel={t('tableCheckout.feeIncluded')}
          compareTotal={!onSite && pricing.discount > 0 ? pricing.fullToPay : undefined}
          buttonText={t('ticketSel.continue')}
          onClick={handleNextStep}
          disabled={zoneFull || packSoldOut}
          alert={capacityAlert}
          footnote={balanceNote ?? undefined}
        />
      ) : (
        <CheckoutSummaryBar
          reserveSpace
          total={barTotal}
          totalLabel={barTotalLabel}
          fee={onSite ? 0 : pricing.managementFee}
          feeLabel={t('tableCheckout.feeIncluded')}
          compareTotal={!onSite && pricing.discount > 0 ? pricing.fullToPay : undefined}
          buttonText={onSite ? t('tableCheckout.confirmReservation') : t('ticketSel.goToPayment')}
          icon={onSite ? undefined : <Lock className="h-3.5 w-3.5" strokeWidth={2.4} aria-hidden />}
          onClick={() => void handleSubmit()}
          loading={submitting}
          disabled={zoneFull || packSoldOut}
          alert={detailsAlert}
          footnote={(
            <>
              {balanceNote && <>{balanceNote}<br /></>}
              {!onSite && <>{t('ticketCheckout.payOnStripe')}<br /></>}
              <TermsNotice lead={t('tableCheckout.termsAgeBefore')} />
            </>
          )}
        />
      )}
    </div>
  );
}

/** Une ligne de la carte de prix : libellé à gauche, montant (et l'ancien, barré) à droite. */
function PriceRow({ label, value, was, tone }: { label: React.ReactNode; value: string; was?: string; tone?: 'discount' }) {
  const discount = tone === 'discount';
  return (
    <div className={`flex items-center justify-between gap-3 text-sm ${discount ? 'text-emerald-400' : ''}`}>
      <span
        className={discount ? 'flex items-center gap-1.5 font-mono uppercase' : 'text-[#9A9A9A]'}
        style={discount ? { fontSize: '11px', letterSpacing: '0.04em' } : undefined}
      >
        {label}
      </span>
      <span className="flex items-baseline gap-2 whitespace-nowrap">
        {was && <span className="font-mono text-[12px] tabular-nums text-[#9A9A9A] line-through">{was}</span>}
        <span className={`font-mono font-medium tabular-nums ${discount ? '' : 'text-[#E5E5E5]'}`}>{value}</span>
      </span>
    </div>
  );
}
