import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { usePreviewNavigate } from '@/contexts/OwnerPreviewContext';
import { useEventRoute } from '@/hooks/useEventRoute';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, MapPin, Calendar, Clock, Check, Tag, ArrowRight, Repeat, ChevronRight, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { VipGuestCounter } from '@/components/vip/VipGuestCounter';
import { ZoneUpsellSheet } from '@/components/vip/ZoneUpsellSheet';
import { TermsAcceptance } from '@/components/TermsAcceptance';
import { AgeGate } from '@/components/AgeGate';
import { MarketingOptIns } from '@/components/MarketingOptIns';
import { PhoneInputWithCountry } from '@/components/PhoneInputWithCountry';
import { Separator } from '@/components/ui/separator';
import { VipCheckoutSteps } from '@/components/vip/VipCheckoutSteps';
import { ClientFloorPlanPicker } from '@/components/vip/ClientFloorPlanPicker';
import { VipMenuPreview, type PreorderSelection } from '@/components/vip/VipMenuPreview';
import { VipTableWaitlistDialog } from '@/components/vip/VipTableWaitlistDialog';
import { useTableAvailability } from '@/hooks/useTableAvailability';
import { supabase } from '@/integrations/supabase/client';
import { PUBLIC_VENUE_COLUMNS } from '@/integrations/supabase/publicColumns';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { launchCheckout } from '@/lib/native';
import { haptics } from '@/lib/haptics';
import { useLanguage } from '@/contexts/LanguageContext';
import { useScrollIntoViewOnFocus } from '@/hooks/useScrollIntoViewOnFocus';
import { formatInTimeZone } from 'date-fns-tz';
import { enUS, es, fr } from 'date-fns/locale';
import { PARIS_TIMEZONE } from '@/lib/timezone';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { TablePack, TableZone, estimateStripeFee } from '@/types/ticketing';
import { VenueFloorPlan } from '@/types';
import { getStoredPromoCode } from '@/hooks/usePromoterTracking';
import { PublicPage } from '@/components/PublicPage';

interface PromoterDiscount {
  promoterId: string;
  promoCode: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
}

const MANAGEMENT_FEE_RATE = 0.04;
const MANAGEMENT_FEE_MIN = 0.99;

const tableInputClass =
  'h-11 rounded-lg bg-[#1F1F22] border-white/[0.08] text-white placeholder:text-[#5A5A5E] focus-visible:ring-0 focus-visible:border-primary/50';

export default function TableCheckout() {
  const { packId } = useParams();
  const { eventId, basePath } = useEventRoute();
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
  const [event, setEvent] = useState<any>(null);
  const [venue, setVenue] = useState<any>(null);
  const [pack, setPack] = useState<TablePack | null>(null);
  const [zone, setZone] = useState<TableZone | null>(null);
  const [promoterDiscount, setPromoterDiscount] = useState<PromoterDiscount | null>(null);
  const [floorPlan, setFloorPlan] = useState<VenueFloorPlan | null>(null);
  const [placementEnabled, setPlacementEnabled] = useState(false);
  const [allZones, setAllZones] = useState<TableZone[]>([]);
  const [packsByZone, setPacksByZone] = useState<Record<string, TablePack[]>>({});
  const [zoneSheetOpen, setZoneSheetOpen] = useState(false);
  
  // Multi-step state (2 steps: 1=Summary+Placement, 2=Contact)
  const [currentStep, setCurrentStep] = useState<1 | 2>(1);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [placementStatus, setPlacementStatus] = useState<'none' | 'requested' | 'assign_on_arrival'>('none');
  const [upsellTable, setUpsellTable] = useState<any>(null);
  
  // Form state
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [remarks, setRemarks] = useState('');
  const [newsletterOptIn, setNewsletterOptIn] = useState(false);
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [ageVerified, setAgeVerified] = useState(false);
  // Self-declared birth date (honor system) — recorded server-side at checkout.
  const [ageBirthDate, setAgeBirthDate] = useState<string | undefined>(undefined);
  
  const [guestCount, setGuestCount] = useState(1);
  const [preOrderBottles, setPreOrderBottles] = useState<PreorderSelection[]>([]);
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const { unavailableTableIds, reservationsByZone } = useTableAvailability(eventId);

  // Zone capacity guard — block once `tables_count` is reached for the selected zone.
  const activeZoneId = zoneId || pack?.zoneId || null;
  const zoneCapacity = activeZoneId
    ? (allZones.find((z) => z.id === activeZoneId)?.tablesCount ?? zone?.tablesCount ?? 0)
    : 0;
  const zoneUsed = activeZoneId ? (reservationsByZone[activeZoneId] || 0) : 0;
  const zoneFull = zoneCapacity > 0 && zoneUsed >= zoneCapacity;


  // Auto-deselect table if guest count exceeds table capacity
  useEffect(() => {
    if (!selectedTableId || !floorPlan) return;
    const tables = (floorPlan.layout?.tables || []) as any[];
    const table = tables.find((t: any) => t.id === selectedTableId);
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
      }
      if (user.email) {
        setEmail(user.email);
        setConfirmEmail(user.email);
      }
    };
    fetchUserProfile();
  }, [user]);

  useEffect(() => {
    if (eventId && packId) fetchData();
  }, [eventId, packId, zoneId]);

  const fetchData = async () => {
    try {
      const { data: eventData, error: eventError } = await supabase
        .from('events').select('*').eq('id', eventId).single();
      if (eventError) throw eventError;
      setEvent(eventData);

      // Resolve venue (event.venue_id OR partner_venue_id for orga-led co-events)
      const effectiveVenueId = (eventData as any).venue_id ?? (eventData as any).partner_venue_id;
      const { data: venueData, error: venueError } = await supabase
        .from('venues').select(PUBLIC_VENUE_COLUMNS).eq('id', effectiveVenueId).single();
      if (venueError) throw venueError;
      setVenue(venueData);

      // Detect basic mode → no interactive placement, scope by event_id
      const isBasicMode = (eventData as any).tables_mode === 'basic';
      const placementOn = !isBasicMode && (venueData.vip_placement_enabled || false);
      setPlacementEnabled(placementOn);

      // Floor plan: prefer event-scoped (basic mode) then venue-scoped
      const { data: fpEvent } = await supabase
        .from('venue_floor_plans').select('*').eq('event_id', eventId).maybeSingle();
      const fpData = fpEvent ?? (placementOn
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
        includedItems: packData.included_items,
        includedBottlesQuota: (packData as any).included_bottles_quota || 0,
        minimumSpend: Number((packData as any).minimum_spend) || 0,
        tablesCount: packData.tables_count || 1,
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

      // Fetch all zones and packs for zone upsell — basic = scope by event_id, elite = by venue_id
      const zoneQuery = isBasicMode
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

        const packQuery = isBasicMode
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
              includedItems: p.included_items,
              includedBottlesQuota: (p as any).included_bottles_quota || 0,
              minimumSpend: Number((p as any).minimum_spend) || 0,
              tablesCount: p.tables_count || 1,
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
      if (!venue?.id) return;
      const storedCode = getStoredPromoCode();
      if (!storedCode) return;
      try {
        const { data: promoter, error } = await supabase
          .from('promoters')
          .select('id, promo_code, table_discount_type, table_discount_value')
          .eq('venue_id', venue.id).ilike('promo_code', storedCode).eq('is_active', true).single();
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
  }, [venue?.id]);

  const packGuestLimit = pack ? pack.baseCapacity + pack.maxExtraPersons : 1;

  useEffect(() => {
    if (!pack) return;

    const parsedGuests = Number.parseInt(guestCountParam || '', 10);
    if (!Number.isFinite(parsedGuests)) return;

    const nextGuestCount = Math.min(Math.max(parsedGuests, 1), packGuestLimit);
    setGuestCount(current => (current === nextGuestCount ? current : nextGuestCount));
  }, [pack, packGuestLimit, guestCountParam]);

  const calculatePricing = () => {
    if (!pack) return { totalPrice: 0, deposit: 0, managementFee: 0, toPay: 0, remainingBalance: 0, discount: 0 };
    const effectiveGuestCount = Math.min(Math.max(guestCount, 1), packGuestLimit);
    const baseGuests = pack.baseCapacity;
    const extraGuests = Math.max(0, Math.min(effectiveGuestCount - baseGuests, pack.maxExtraPersons));
    let totalPrice = pack.basePrice + (extraGuests * pack.extraPersonPrice);
    let discount = 0;
    if (promoterDiscount && promoterDiscount.discountValue > 0) {
      if (promoterDiscount.discountType === 'percentage') {
        discount = Math.round(totalPrice * (promoterDiscount.discountValue / 100) * 100) / 100;
      } else {
        discount = Math.min(promoterDiscount.discountValue, totalPrice);
      }
      totalPrice = totalPrice - discount;
    }
    let deposit = 0;
    if (pack.deposit > 0) {
      if (pack.depositType === 'percentage') {
        deposit = Math.round(totalPrice * pack.deposit / 100 * 100) / 100;
      } else {
        deposit = pack.deposit;
      }
    }
    const feeBase = deposit > 0 ? deposit * MANAGEMENT_FEE_RATE : (totalPrice / 2) * MANAGEMENT_FEE_RATE;
    // Absorb mode: the club covers the Yuno commission, so the fan pays only the Stripe
    // transaction cost on the deposit charged now. Mirrors create-table-checkout's
    // `transactionFee`; the default path is left byte-identical.
    const feeAbsorbed = venue?.absorb_yuno_fees === true;
    const managementFee = feeAbsorbed
      ? estimateStripeFee(deposit)
      : Math.round(Math.max(MANAGEMENT_FEE_MIN, feeBase) * 100) / 100;
    const toPay = deposit + managementFee;
    const remainingBalance = totalPrice - deposit;
    return { totalPrice, deposit, managementFee, toPay, remainingBalance, discount };
  };

  const pricing = calculatePricing();

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
    // The data-fetch effect keys off [eventId, packId, zoneId], so changing the
    // route here re-fetches the new zone/pack without a full-page reload.
    navigate(`${basePath}/table/${newPackId}?zone=${newZoneId}&guests=${guestCount}`, { replace: true, state: { eventId } });
  };

  const payAtClubGuests = 0;

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    // Re-entrancy guard: ignore a second submit while one is already in flight.
    if (submitting) return;
    if (!fullName.trim()) { toast.error(t('tableCheckout.nameRequired')); return; }
    if (!email.trim()) { toast.error(t('tableCheckout.emailRequired')); return; }
    if (email !== confirmEmail) { toast.error(t('tableCheckout.emailMismatch')); return; }
    if (!phone.trim()) { toast.error(t('tableCheckout.phoneRequired')); return; }
    if (!acceptTerms) { toast.error(t('cgv.required')); return; }
    if (!ageVerified) { toast.error(t('ageGate.required')); return; }
    
    if (zoneFull) {
      toast.error(
        t('tableCheckout.zoneFull') ||
          `Cette zone est complète (${zoneUsed}/${zoneCapacity} tables réservées). Choisis une autre zone.`,
      );
      setSubmitting(false);
      return;
    }
    
    setSubmitting(true);
    try {
      const isGuest = !user;
      const guestCheckout = isGuest ? { guestEmail: email.trim(), guestFullName: fullName.trim(), guestPhone: phone.trim() } : null;

      const { getPurchaseSource, getTrackedLinkForCheckout } = await import('@/hooks/usePurchaseSourceTracking');
      const purchaseSource = getPurchaseSource(eventId);
      const trackedLinkId = getTrackedLinkForCheckout(eventId);

      const { data, error } = await invokeEdgeFunction('create-table-checkout', {
        body: {
          eventId, packId, zoneId,
          purchaseSource,
          trackedLinkId,
          guestCount: Math.min(guestCount, pack!.baseCapacity + pack!.maxExtraPersons),
          extraGuestsAtClub: payAtClubGuests,
          totalPrice: pricing.totalPrice, deposit: pricing.deposit,
          managementFee: pricing.managementFee,
          fullName: fullName.trim(), email: email.trim(), phone: phone.trim(),
          remarks: payAtClubGuests > 0
            ? `${remarks.trim()}\n[+${payAtClubGuests} personne(s) supplémentaire(s) — à régler sur place]`.trim()
            : remarks.trim(),
          newsletterOptIn,
          smsOptIn,
          promoCode: promoterDiscount?.promoCode || null,
          promoterId: promoterDiscount?.promoterId || null,
          discountAmount: pricing.discount,
          cancelUrl: window.location.pathname,
          // Placement data
          requestedTableId: selectedTableId,
          placementStatus: placementStatus,
          ageDeclaration: { confirmed: true, birthDate: ageBirthDate },
          // Pré-commande bouteilles (préparées pour l'arrivée, réglées à la table)
          preOrderBottles: preOrderBottles.map(b => ({
            menuItemId: b.menuItemId, quantity: b.quantity, unitPrice: b.unitPrice, itemName: b.itemName,
          })),
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
      
      if (data?.testMode && data?.redirectUrl) {
        toast.success(t('tables.reservationSuccess') || 'Réservation confirmée !');
        // Navigation SPA — window.location.href recharge le bundle (splash natif).
        navigate(data.redirectUrl);
        return;
      }
      if (data?.url) { haptics.medium(); launchCheckout(data.url); }
      else if (data?.redirectUrl) { navigate(data.redirectUrl); }
    } catch (error: any) {
      console.error('Checkout error:', error);
      haptics.error();
      toast.error(error.message || t('tickets.checkoutError'));
      // Échec de réservation (le plus souvent : zone complète) -> proposer la liste d'attente.
      setWaitlistOpen(true);
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0A0A0A' }}>
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!event || !pack) {
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

  const showPlacement = placementEnabled && !!floorPlan;

  return (
    <div className="min-h-screen pb-24" style={{ background: '#0A0A0A' }}>
      {/* Header */}
      <header
        className="fixed top-0 z-40 w-full"
        style={{ background: 'rgba(10,10,10,0.90)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
      >
        <div className="mx-auto flex h-12 max-w-lg items-center px-4">
          <button
            onClick={currentStep === 1 ? () => navigate(`${basePath}/billets`, { replace: true, state: { eventId } }) : handlePrevStep}
            className="flex items-center gap-2 h-8 px-3 -ml-2 font-mono uppercase text-[10px] font-semibold tracking-[0.10em] text-[#9A9A9A] hover:text-white transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            {currentStep === 1 ? t('common.back') : t('common.previous')}
          </button>
        </div>
      </header>

      <PublicPage variant="flow">
      <div className="pt-12">
        <div className="mx-auto max-w-lg px-4 py-5">
          {/* Step indicator */}
          <VipCheckoutSteps currentStep={currentStep} />

          <AnimatePresence mode="wait">
            {/* STEP 1: Package Summary */}
            {currentStep === 1 && (
              <motion.div key="step1" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                {/* Pack header */}
                <div className="flex items-start justify-between gap-3 mt-4 mb-5">
                  <div className="min-w-0">
                    <h1 className="font-display font-bold uppercase text-white" style={{ fontSize: 'clamp(24px, 6vw, 32px)', letterSpacing: '-0.02em', lineHeight: 0.95 }}>{zone?.name || pack.name}</h1>
                    <p className="font-mono uppercase mt-1.5" style={{ fontSize: '10px', letterSpacing: '0.06em', color: '#9A9A9A' }}>{pack.name}</p>
                  </div>
                  {allZones.length > 1 && (
                    <button
                      onClick={() => setZoneSheetOpen(true)}
                      className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-white/[0.06] hover:bg-white/[0.10] font-mono uppercase text-[9px] font-bold tracking-[0.10em] text-[#E5E5E5] transition-colors"
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
                    <Calendar className="h-3.5 w-3.5 text-[#5A5A5E]" />
                    {formatInTimeZone(new Date(event.start_at), PARIS_TIMEZONE, 'EEE d MMM', { locale: getLocale() })}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-[#5A5A5E]" />
                    {formatInTimeZone(new Date(event.start_at), PARIS_TIMEZONE, 'HH:mm')}
                  </div>
                  {venue?.address && (
                    <div className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-[#5A5A5E]" />
                      {venue.name}
                    </div>
                  )}
                </div>

                {/* Price breakdown */}
                <div className="mt-5 border border-white/[0.08] bg-[#141414] p-4 space-y-2.5" style={{ borderRadius: 10 }}>
                  {promoterDiscount && pricing.discount > 0 && (
                    <div className="flex justify-between items-center gap-3 text-emerald-400 text-sm">
                      <span className="font-mono uppercase flex items-center gap-1.5" style={{ fontSize: '11px', letterSpacing: '0.04em' }}>
                        <Tag className="h-3 w-3" />
                        Code {promoterDiscount.promoCode}
                        {promoterDiscount.discountType === 'percentage' ? ` (-${promoterDiscount.discountValue}%)` : ''}
                      </span>
                      <span className="font-mono font-medium tabular-nums">-{pricing.discount.toFixed(2)} €</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center gap-3 text-sm">
                    <span className="text-[#9A9A9A]">{t('tableCheckout.totalPrice')}</span>
                    <span className="font-mono font-medium tabular-nums text-[#E5E5E5]">{pricing.totalPrice.toFixed(2)} €</span>
                  </div>
                  <div className="flex justify-between items-center gap-3 text-sm">
                    <span className="text-[#9A9A9A]">{t('tableCheckout.deposit')}</span>
                    <span className="font-mono font-medium tabular-nums text-[#E5E5E5]">{pricing.deposit.toFixed(2)} €</span>
                  </div>
                  <div className="flex justify-between items-center gap-3 text-sm">
                    <span className="text-[#9A9A9A]">{t('tableCheckout.managementFee')}</span>
                    <span className="font-mono font-medium tabular-nums text-[#E5E5E5]">{pricing.managementFee.toFixed(2)} €</span>
                  </div>

                  <div className="border-t border-white/[0.08] pt-3 mt-1 flex justify-between items-center gap-3">
                    <span className="font-display font-bold text-white" style={{ fontSize: '15px' }}>{t('tableCheckout.toPay')}</span>
                    <span className="font-display font-bold tabular-nums text-primary" style={{ fontSize: '20px', letterSpacing: '-0.02em' }}>{pricing.toPay.toFixed(2)} €</span>
                  </div>

                  <p className="text-center pt-1 text-[11px] text-[#5A5A5E]">
                    {t('tableCheckout.remainingNote').replace('{amount}', pricing.remainingBalance.toFixed(2))}
                  </p>
                </div>

                {/* Vitrine carte bouteilles (idée #2) — pilotée par le réglage club */}
                {venue?.id && (
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

                {venue?.id && (
                  <VipTableWaitlistDialog
                    open={waitlistOpen}
                    onOpenChange={setWaitlistOpen}
                    venueId={venue.id}
                    eventId={eventId}
                    zoneId={activeZoneId}
                    packId={pack?.id}
                    defaultName={fullName}
                    defaultEmail={email}
                    defaultPhone={phone}
                    guestCount={guestCount}
                  />
                )}

                {/* Interactive floor plan for table selection */}
                {showPlacement && floorPlan && (
                  <div className="mt-7">
                    <p className="section-label-ruled mb-1.5">{t('vipCheckout.selectTable')}</p>
                    <p className="text-[11px] text-[#9A9A9A] mb-4">{t('vipCheckout.selectTableDescription')}</p>
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
                          className="inline-flex items-center h-9 px-4 rounded-full font-mono uppercase text-[10px] font-bold tracking-[0.10em] text-[#E5E5E5] bg-white/[0.06] hover:bg-white/[0.10] transition-colors"
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
                        onUpsellTable={(table) => setUpsellTable(table)}
                        guestCount={guestCount}
                      />
                    )}
                  </div>
                )}

                <button
                  onClick={handleNextStep}
                  className="w-full h-12 mt-7 rounded-full flex items-center justify-center font-semibold text-sm text-white transition-all active:scale-[0.98]"
                  style={{ background: '#E8192C', boxShadow: '0 10px 28px rgba(232,25,44,0.32)', letterSpacing: '0.01em' }}
                >
                  {t('common.next')}
                  <ArrowRight className="h-5 w-5 ml-2" />
                </button>

                {/* Zone Upsell Sheet */}
                <ZoneUpsellSheet
                  open={zoneSheetOpen || !!upsellTable}
                  onClose={() => { setZoneSheetOpen(false); setUpsellTable(null); }}
                  currentZoneId={zoneId || pack.zoneId}
                  currentPackPrice={pricing.totalPrice}
                  zones={allZones}
                  packsByZone={packsByZone}
                  guestCount={guestCount}
                  onSelectZone={handleZoneChange}
                />
              </motion.div>
            )}

            {/* STEP 2: Customer Details */}
            {currentStep === 2 && (
              <motion.div key="step2" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="mt-4">
                <p className="section-label-ruled mb-4">{t('tableCheckout.yourInfo')}</p>
                {/* No account required: tell the guest so plainly, and give returning
                    users an optional link to log in (auto-fills + avoids the
                    ACCOUNT_EXISTS bounce after they've filled everything). */}
                {!user && (
                  <div className="mb-4 space-y-2">
                    <p className="text-[12px] text-[#9A9A9A]">{t('guest.noAccountNeeded')}</p>
                    <button
                      type="button"
                      onClick={() => navigate(`/auth?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`)}
                      className="flex items-center gap-1.5 text-[12px] text-[#9A9A9A] hover:text-white transition-colors"
                    >
                      <LogIn className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span>{t('guest.haveAccountQuestion')}{' '}
                        <span className="text-primary font-semibold underline underline-offset-2">{t('guest.logIn')}</span>
                      </span>
                    </button>
                  </div>
                )}
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="fullName" className="font-mono uppercase text-[10px] tracking-[0.10em] text-[#5A5A5E]">{t('tableCheckout.fullName')} *</Label>
                    <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={t('tableCheckout.fullNamePlaceholder')} required className={tableInputClass} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="email" className="font-mono uppercase text-[10px] tracking-[0.10em] text-[#5A5A5E]">{t('tableCheckout.email')} *</Label>
                    <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('tableCheckout.emailPlaceholder')} required className={tableInputClass} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="confirmEmail" className="font-mono uppercase text-[10px] tracking-[0.10em] text-[#5A5A5E]">{t('tableCheckout.confirmEmail')} *</Label>
                    <Input id="confirmEmail" type="email" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} placeholder={t('tableCheckout.confirmEmailPlaceholder')} required className={tableInputClass} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="phone" className="font-mono uppercase text-[10px] tracking-[0.10em] text-[#5A5A5E]">{t('tableCheckout.phone')} *</Label>
                    <PhoneInputWithCountry id="phone" value={phone} onChange={setPhone} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="remarks" className="font-mono uppercase text-[10px] tracking-[0.10em] text-[#5A5A5E]">{t('tableCheckout.remarks')}</Label>
                    <Textarea id="remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder={t('tableCheckout.remarksPlaceholder')} rows={3} className="rounded-lg bg-[#1F1F22] border-white/[0.08] text-white placeholder:text-[#5A5A5E] focus-visible:ring-0 focus-visible:border-primary/50" />
                  </div>
                  <AgeGate userId={user?.id} onVerified={(v, bd) => { setAgeVerified(v); if (bd) setAgeBirthDate(bd); }} />
                  <MarketingOptIns
                    newsletterOptIn={newsletterOptIn}
                    onNewsletterChange={setNewsletterOptIn}
                    smsOptIn={smsOptIn}
                    onSmsChange={setSmsOptIn}
                  />
                  <TermsAcceptance userId={user?.id} guestEmail={!user ? email : null} context="table" onAcceptedChange={setAcceptTerms} />
                </form>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      </PublicPage>

      {/* Fixed bottom capsule bar for step 2 */}
      {currentStep === 2 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center px-4 pb-5 pt-2 pointer-events-none" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)' }}>
          <div
            className="inline-flex items-center w-full max-w-md gap-4 rounded-xl px-5 py-3 justify-between pointer-events-auto"
            style={{
              background: 'rgba(14, 14, 16, 0.92)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              border: '1px solid rgba(255, 255, 255, 0.10)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(232,25,44,0.08)',
            }}
          >
            <div className="flex flex-col min-w-0">
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '9px', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#5A5A5E' }}>
                {t('tableCheckout.deposit')}
              </span>
              <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '22px', fontWeight: 700, letterSpacing: '-0.02em', color: '#FFFFFF', lineHeight: 1.1, whiteSpace: 'nowrap' }}>
                {pricing.toPay.toFixed(2)}&nbsp;€
              </span>
              <span className="truncate" style={{ fontSize: '10px', color: '#5A5A5E', marginTop: '1px' }}>{t('tickets.feesIncluded') || 'Frais inclus'}</span>
            </div>
            <button
              onClick={handleSubmit}
              disabled={submitting || zoneFull}
              className="px-6 h-11 rounded-lg font-semibold shrink-0 text-sm text-white transition-all duration-150 hover:brightness-110 active:scale-[0.97] disabled:opacity-40 flex items-center"
              style={{ background: '#E8192C', border: 'none', boxShadow: '0 6px 24px rgba(232,25,44,0.35)', fontFamily: "'Inter', sans-serif", letterSpacing: '0.01em' }}
            >
              {submitting ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : zoneFull ? (
                <>{t('tableCheckout.zoneFullShort') || 'Zone complète'}</>
              ) : (
                <>
                  {t('tickets.continue')}
                  <ChevronRight className="h-5 w-5 ml-1" />
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
