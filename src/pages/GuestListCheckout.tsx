import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { useEventRoute } from '@/hooks/useEventRoute';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { capturePosthog, getAnalyticsCheckoutContext } from '@/lib/posthog';
import { usePosthogEvent } from '@/hooks/usePosthogEvent';
import { useVisitorTracking } from '@/hooks/useVisitorTracking';
import { marketProps } from '@/lib/geo';
import { checkoutFailReason } from '@/lib/checkoutFailure';
import { useLanguage } from '@/contexts/LanguageContext';
import { useScrollIntoViewOnFocus } from '@/hooks/useScrollIntoViewOnFocus';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { CheckoutSummaryBar } from '@/components/CheckoutSummaryBar';
import { CheckoutStepHeader } from '@/components/checkout/CheckoutStepHeader';
import { OrderEventRow } from '@/components/checkout/OrderEventRow';
import { BuyerFields, BuyerReadyCard } from '@/components/checkout/BuyerDetails';
import { GenderChoice, type GuestGender } from '@/components/checkout/GenderChoice';
import { focusCheckoutField, useBuyerFormUi } from '@/components/checkout/useBuyerForm';
import { buyerFormErrors, firstErrorField } from '@/lib/buyerForm';
import { suggestEmail } from '@/lib/emailTypo';
import { getStoredPromoCodeForVenue, getStoredPromoCodeForScope } from '@/hooks/usePromoterTracking';
import { formatInTimeZone } from 'date-fns-tz';
import { countryOfPlace, getEventTimezone } from '@/lib/timezone';
import { fr, es, enUS } from 'date-fns/locale';
import { toast } from 'sonner';
import { ArrowLeft, Clock, Wine, CheckCircle, Ticket, PartyPopper } from 'lucide-react';
import QRCode from 'qrcode';
import { haptics } from '@/lib/haptics';
import { PublicPage } from '@/components/PublicPage';
import { WalletButtons } from '@/components/WalletButtons';
import { useExistingAccountCheck } from '@/hooks/useExistingAccountCheck';
import { ExistingAccountNotice } from '@/components/account/ExistingAccountNotice';
import { GuestAccountUnlock } from '@/components/account/GuestAccountUnlock';
import { MarketingOptIns } from '@/components/MarketingOptIns';
import { useEventMarketingHosts } from '@/hooks/useEventMarketingHosts';
import { shareCheckoutConsent } from '@/lib/coorg';
import { cleanNamePart, composeFullName } from '@/lib/guestName';
import {
  useMarketingConsent, usePlatformMarketingConsent, recordConsentGrant,
  recordPlatformConsentGrant, marketingConsentWording,
} from '@/hooks/useMarketingConsent';
import { Wordmark } from '@/components/brand/Wordmark';
import { GuestListCheckoutSkeleton } from '@/components/skeletons/GuestListCheckoutSkeleton';
import { useEventScarcity } from '@/hooks/useScarcitySettings';
import { guestListScarcity, scarcityBadgeText } from '@/lib/guestListScarcity';
import { soldOutFlags, isGuestListSoldOut } from '@/lib/soldOut';
import { getMetaCheckoutContext } from '@/lib/metaPixel';

interface GuestListInfo {
  id: string;
  quota: number | null;
  quotaFemale: number | null;
  quotaMale: number | null;
  freeBeforeTime: string;
  includesDrink: boolean;
  /** false = le visiteur voit seulement ouvert/complet, jamais le remplissage. */
  showRemaining: boolean;
  shareToken: string;
  eventTitle: string;
  eventStartAt: string;
  eventEndAt: string;
  /** Fuseau de la soirée (date affichée dans la carte « Votre commande »). */
  eventTimezone: string | null;
  eventImageUrl: string | null;
  venueId: string | null;
  venueName: string;
  /** Pays où se déroule la soirée — indicatif par défaut du champ téléphone. */
  phoneCountry: string | null;
  /** Marché de la soirée (analytics PostHog : pays, ville, ids). */
  market: Record<string, string>;
  /** « Complet » posé à la main — toute la soirée, ou cette part (lib/soldOut.ts). */
  soldOut: boolean;
}

/**
 * Public guest-list checkout — the normal Yuno reservation flow for a guest list
 * surfaced on the club page (visible_on_club_page). Reached from TicketSelection's
 * "Continue" footer, NOT from a share link. The token-based share link still lands
 * on GuestListSignup. Direct URL access is gated to publicly-visible lists.
 */
export default function GuestListCheckout() {
  // `resolving` : sur une URL propre /events/:host/:slug, l'id de la soirée
  // n'est connu qu'après une résolution serveur. Tant qu'elle court, la page
  // ne sait RIEN — ni que la soirée existe, ni qu'elle manque. Conclure
  // pendant ce temps affichait « Événement introuvable » à qui arrive par un
  // lien d'email ou de partage, avant que la billetterie ne s'affiche.
  const { eventId, basePath, resolving } = useEventRoute();
  // Rareté de la soirée (badge / compteur plafonné) — voir lib/guestListScarcity.
  const scarcitySettings = useEventScarcity(eventId);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { t, language } = useLanguage();
  // Clavier iOS : garder le champ focus visible (formulaire long).
  useScrollIntoViewOnFocus();
  const { user, loading: authLoading } = useAuth();
  const ref = searchParams.get('ref');
  // Gendered guest lists arrive here as ?gender=female|male (one card per gender),
  // so the gender is already decided — no in-page picker.
  const genderParam = searchParams.get('gender') as 'female' | 'male' | null;
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  const [guestList, setGuestList] = useState<GuestListInfo | null>(null);
  // Entrée dans le tunnel d'inscription : l'étape « paiement » de la guest list
  // (Analytics › Trafic › Par soirée).
  usePosthogEvent('checkout_started', guestList ? eventId : null, { pillar: 'guest_list', ...(guestList?.market ?? {}) });
  // Le parcours d'achat CONTINUE la visite de l'onglet : la Vue en direct la
  // garde vivante, et son étape (panier, paiement) vient du tunnel.
  useVisitorTracking(undefined, eventId || undefined, undefined, { keepSession: true });
  const [entriesCount, setEntriesCount] = useState(0);
  const [genderCount, setGenderCount] = useState(0);
  const [loading, setLoading] = useState(true);
  // Distingue « invitation introuvable » (data vide) d'un échec réseau/RLS :
  // un hoquet réseau ne doit pas afficher « introuvable » (symptôme identique
  // au cache PWA périmé, rend les vrais bugs indiscernables).
  const [loadError, setLoadError] = useState(false);
  const [venuePlan, setVenuePlan] = useState<string>('core');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
  const [gender, setGender] = useState<string>(genderParam || '');
  const [qrImage, setQrImage] = useState('');
  // Ne promettre l'email que si le serveur confirme qu'il est parti.
  const [emailSent, setEmailSent] = useState<boolean | null>(null);
  const [timeLeft, setTimeLeft] = useState('');
  // Mêmes champs que le paiement billet (lib/buyerForm.ts) : un seul « Nom et
  // prénom », l'e-mail, le téléphone. La liste de porte n'imprime que le nom :
  // un seul mot n'y identifie personne, d'où `requireTwoWords` (même garde que
  // le serveur, src/lib/guestName.ts) et `autocomplete="name"` contre le pseudo
  // qu'un navigateur in-app recopiait dans un champ qui n'en avait pas.
  const [fullName, setFullName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [phone, setPhone] = useState('');
  // Inscrit CONNECTÉ : le serveur compose son nom et lit son téléphone depuis
  // `profiles`. L'écran part du profil ; une correction y est écrite avant l'appel.
  const [profileName, setProfileName] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  // Profil complet : carte « Tout est prêt », « Modifier » rouvre les champs.
  const [profileComplete, setProfileComplete] = useState(false);
  // Profil d'un inscrit connecté lu : la page attend cette lecture pour ne pas
  // montrer des champs vides qui disparaissent derrière « Tout est prêt ».
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [editingIdentity, setEditingIdentity] = useState(false);
  const fieldRefs = {
    name: useRef<HTMLDivElement>(null),
    email: useRef<HTMLDivElement>(null),
    phone: useRef<HTMLDivElement>(null),
  };
  const genderRef = useRef<HTMLDivElement>(null);
  // Identifiants de l'inscription qui vient d'être créée — c'est ce couple
  // (id + email) qui permet de rattacher l'inscription au compte créé juste
  // après. Sans lui, l'invité repart avec un QR que personne ne peut relier.
  const [entryId, setEntryId] = useState('');
  const [entryEmail, setEntryEmail] = useState('');
  const [accountCreated, setAccountCreated] = useState(false);
  // « Cet email a-t-il déjà un compte ? » posée pendant la saisie — la réponse
  // arrive avant qu'un mot de passe soit choisi pour rien. (Sur l'écran de
  // déverrouillage, GuestAccountUnlock repose la question pour son compte.)
  const { exists: typedEmailHasAccount } = useExistingAccountCheck(guestEmail, !user);

  // ── Accords marketing ────────────────────────────────────────────────────
  // Même question que sur le lien privé : sans elle, le club remplit sa soirée
  // et n'a personne à qui réécrire. Jamais pré-cochées, chacune nomme qui reçoit.
  const [newsletterOptIn, setNewsletterOptIn] = useState(false);
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [yunoOptIn, setYunoOptIn] = useState(false);
  const [consentScope, setConsentScope] = useState<{
    venueId: string | null;
    organizerUserId: string | null;
    scopeName: string;
  } | null>(null);
  const marketingConsent = useMarketingConsent(consentScope);
  const platformConsent = usePlatformMarketingConsent(true);
  // Co-organisation : la case email nomme TOUS les hôtes qui partagent le CRM.
  const coorgHosts = useEventMarketingHosts(eventId, consentScope, language, marketingConsent.emailGranted);

  // Retour vers la sélection : on DÉPILE, comme partout ailleurs dans le tunnel
  // (fiche event, billets, checkout billet). Empiler `/billets` d'ici enfermait
  // l'utilisateur : la flèche de `/billets` dépile, elle retombait donc sur ce
  // checkout, puis celle du checkout réempilait `/billets`… la fiche de la
  // soirée devenait inatteignable. Tout retour du tunnel doit dépiler, sinon
  // deux pages se renvoient la balle indéfiniment.
  //
  // Le point d'entrée est figé AU MONTAGE : `location.key` ne vaut 'default'
  // que sur un chargement neuf (lien direct, rechargement). Le lire plus tard
  // est faux — même piège que dans useBackConfirm. Sans ce garde-fou, un
  // `navigate(-1)` sur un lien direct sortirait du site.
  const isEntryPointRef = useRef(location.key === 'default');
  const backToSelection = () => {
    if (!isEntryPointRef.current) {
      navigate(-1);
      return;
    }
    navigate(eventId ? `${basePath}/billets` : '/', { replace: true, state: { eventId } });
  };

  useEffect(() => {
    fetchGuestList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, user]);

  // Le compte, pas l'objet session : un rafraîchissement du jeton ne relit pas
  // le profil et n'écrase pas ce que la personne vient de corriger.
  const userId = user?.id;
  const userEmail = user?.email;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    supabase.from('profiles').select('first_name, last_name, phone').eq('id', userId).maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (data) {
          const name = composeFullName(data.first_name || '', data.last_name || '');
          const tel = data.phone || '';
          setProfileName(name);
          setFullName(name);
          setProfilePhone(tel);
          setPhone(tel);
          const known = buyerFormErrors({ fullName: name, email: userEmail || '', phone: tel, birth: null, requireTwoWords: true });
          setProfileComplete(Object.keys(known).length === 0);
        }
        // Lecture en échec : la page s'ouvre quand même, champs vides.
        setProfileLoaded(true);
      });
    return () => { cancelled = true; };
  }, [userId, userEmail]);

  // Retour de connexion pour un email qui avait deja un compte : on rattache
  // l'inscription maintenant que la session existe. La preuve est la meme que
  // pour une creation de compte -- l'email authentifie doit etre celui de
  // l'inscription -- et c'est le serveur qui la verifie.
  const linkParam = searchParams.get('link');
  useEffect(() => {
    if (!linkParam || !user || authLoading) return;
    let cancelled = false;
    (async () => {
      try {
        await supabase.functions.invoke('claim-guest-order', {
          body: { action: 'link_after_signup', purchaseId: linkParam, purchaseType: 'guestlist', userId: user.id },
        });
        if (cancelled) return;
        toast.success(t('glconf.linked'));
      } catch (err) {
        console.error('Guest list link error:', err);
      } finally {
        if (!cancelled) navigate('/my-orders?tab=tickets', { replace: true });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkParam, user, authLoading]);

  useEffect(() => {
    if (!guestList) return;
    const timer = setInterval(() => {
      const eventDate = new Date(guestList.eventStartAt);
      const [hours, minutes] = guestList.freeBeforeTime.split(':').map(Number);
      const deadline = new Date(eventDate);
      deadline.setHours(hours, minutes, 0, 0);
      if (deadline < eventDate) deadline.setDate(deadline.getDate() + 1);

      const diff = deadline.getTime() - Date.now();
      if (diff <= 0) {
        setTimeLeft(t('guestList.expired'));
        clearInterval(timer);
        return;
      }
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      setTimeLeft(days > 0 ? `${days}${t('guestList.unitDay')} ${h}h ${m}min` : `${h}h ${m}min`);
    }, 1000);
    return () => clearInterval(timer);
  }, [guestList, t]);

  const fetchGuestList = async () => {
    // Résolution en cours : on ne conclut pas, le squelette reste.
    if (!eventId) { if (!resolving) setLoading(false); return; }
    setLoadError(false);
    try {
      // Public-only gate: a direct URL must point at a list the club chose to show.
      const { data: glRows, error: glError } = await supabase
        .from('guest_lists')
        .select('id, quota, quota_female, quota_male, free_before_time, includes_drink, show_remaining, share_token, holder_type, manually_sold_out, events!inner(id, title, start_at, end_at, venue_id, partner_venue_id, organizer_user_id, partner_organizer_id, poster_url, timezone, location_city, guest_list_sold_out)')
        .eq('event_id', eventId)
        .eq('is_active', true)
        .eq('visible_on_club_page', true);
      if (glError) throw glError;
      // Liste club prioritaire ; sinon la première part marquée « publique » (visibilité
      // choisie dans son preset). Les parts non visibles restent accessibles par lien.
      const gl = (glRows || []).find((r: { holder_type?: string }) => r.holder_type === 'club') ?? (glRows || [])[0] ?? null;

      if (!gl) { setLoading(false); return; }

      const ev = gl.events;
      let venueName = '';
      let venueCity = '';
      // Co-soirée menée par un organisateur : le club physique est partner_venue_id.
      const eventVenueId = ev?.venue_id ?? ev?.partner_venue_id ?? null;
      if (eventVenueId) {
        const { data: venue } = await supabase.from('venues').select('name, city').eq('id', eventVenueId).maybeSingle();
        venueName = venue?.name || '';
        venueCity = venue?.city || '';
        const { data: sub } = await supabase.from('venue_subscriptions').select('subscription_plan').eq('venue_id', eventVenueId).in('status', ['active', 'trialing']).maybeSingle();
        setVenuePlan(sub?.subscription_plan || 'core');
      }

      // Destinataire des accords marketing : le club, sinon l'organisateur d'une
      // soirée sans club. MIROIR de la résolution du trigger
      // auto_subscribe_guest_list_entry et de celle de GuestListSignup — la case
      // nomme exactement qui recevra. Le nom public d'un organisateur vit dans
      // `organizer_profiles` : `profiles` n'est pas lisible par un anonyme.
      const eventOrganizerId = ev?.organizer_user_id ?? ev?.partner_organizer_id ?? null;
      if (eventVenueId && venueName) {
        setConsentScope({ venueId: eventVenueId, organizerUserId: null, scopeName: venueName });
      } else if (eventOrganizerId) {
        const [{ data: orgPublic }, { data: legacyProfile }] = await Promise.all([
          supabase.from('organizer_profiles').select('display_name').eq('user_id', eventOrganizerId).maybeSingle(),
          supabase.from('profiles').select('organization_name').eq('id', eventOrganizerId).maybeSingle(),
        ]);
        const orgName = orgPublic?.display_name || legacyProfile?.organization_name || '';
        // Sans nom, pas de case à son nom : seule la ligne Yuno reste affichée.
        setConsentScope(orgName ? { venueId: null, organizerUserId: eventOrganizerId, scopeName: orgName } : null);
      } else {
        setConsentScope(null);
      }

      setGuestList({
        soldOut: isGuestListSoldOut(soldOutFlags(ev), gl),
        id: gl.id,
        quota: gl.quota,
        quotaFemale: gl.quota_female,
        quotaMale: gl.quota_male,
        freeBeforeTime: gl.free_before_time?.substring(0, 5) || '02:00',
        includesDrink: gl.includes_drink,
        showRemaining: gl.show_remaining ?? true,
        shareToken: gl.share_token,
        eventTitle: ev.title,
        eventStartAt: ev.start_at,
        eventEndAt: ev.end_at,
        eventTimezone: ev.timezone ?? null,
        eventImageUrl: ev.poster_url || null,
        venueId: eventVenueId,
        venueName,
        // Indicatif par défaut = pays de la soirée (fuseau figé à la
        // publication, ville en repli). venues.timezone n'est pas anon-readable.
        phoneCountry: countryOfPlace({
          timezone: ev.timezone,
          city: venueCity || ev.location_city,
        })?.code ?? null,
        market: marketProps({
          timezone: ev.timezone,
          city: venueCity || ev.location_city,
          eventId: ev.id,
          venueId: eventVenueId,
          organizerUserId: eventOrganizerId,
        }),
      });

      // Fill counts via the aggregated SECURITY DEFINER RPC. A direct count() on
      // guest_list_entries returns 0 SILENTLY for an anonymous visitor (no anon
      // SELECT policy) — a FULL list then rendered wide open on the club page,
      // over-promising capacity until submit. Same fix as GuestListSignup.
      const { data: fillRaw } = await supabase
        .rpc('get_guest_list_public_fill', { _guest_list_id: gl.id })
        .maybeSingle();
      const fill = fillRaw as { total_count: number; female_count: number; male_count: number } | null;
      setEntriesCount(fill?.total_count || 0);
      if (genderParam === 'female') setGenderCount(fill?.female_count || 0);
      else if (genderParam === 'male') setGenderCount(fill?.male_count || 0);

      if (user) {
        const { count: existing } = await supabase
          .from('guest_list_entries')
          .select('*', { count: 'exact', head: true })
          .eq('guest_list_id', gl.id)
          .eq('user_id', user.id)
          .neq('status', 'cancelled');
        if (existing && existing > 0) setAlreadyRegistered(true);
      }
    } catch (err) {
      console.error('Error fetching guest list:', err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  // Retour de connexion qui rattache l'inscription à l'arrivée (`?link=`) —
  // le chemin de l'email déjà pris, que GuestAccountUnlock propose à la place
  // d'un mot de passe qui serait refusé.
  const relinkBackUrl = entryId
    ? `${location.pathname}${location.search ? location.search + '&' : '?'}link=${entryId}`
    : '';




  // Le formulaire lu d'un coup. Connecté : l'adresse est celle du compte, le
  // serveur n'en lit pas d'autre (create-guest-list-entry).
  const buyerEmail = user?.email ?? guestEmail;
  const formErrors = buyerFormErrors({ fullName, email: buyerEmail, phone, birth: null, requireTwoWords: true });
  // Liste genrée ouverte sans `?gender=` : le genre se choisit ici (quotas).
  const genderMissing = !!guestList && (guestList.quotaFemale !== null || guestList.quotaMale !== null) && !gender;
  const missingCount = Object.keys(formErrors).length + (genderMissing ? 1 : 0);
  const { touched, submitted, setSubmitted, shownError, fieldValid, markTouched } = useBuyerFormUi(formErrors);
  const emailSuggestion = !user && touched.email && !formErrors.email ? suggestEmail(guestEmail) : null;

  // Le bouton n'est jamais grisé pour un oubli : le tap mène au premier champ à revoir.
  const validateForm = (): boolean => {
    const first = firstErrorField(formErrors) ?? (genderMissing ? 'gender' as const : null);
    if (!first) return true;
    setSubmitted(true);
    haptics.error();
    // Un champ caché dans la carte « Tout est prêt » : on la rouvre d'abord.
    if (first !== 'gender' && user && profileComplete && !editingIdentity) setEditingIdentity(true);
    window.setTimeout(() => focusCheckoutField(
      first === 'gender' ? genderRef.current : first === 'birth' ? null : fieldRefs[first].current,
    ), 0);
    return false;
  };

  const handleConfirm = async () => {
    if (!guestList || submitting) return;
    if (!validateForm()) return;

    setSubmitting(true);
    // Code court d'un refus serveur, pour `checkout_failed` (jamais le message).
    let failCode: string | null = null;
    let joined = false;
    try {
      const promoterCode = ref || getStoredPromoCodeForScope(guestList.venueId, guestList.venueId) || undefined;
      // Attribution du canal (newsletter, instagram…) : ce tunnel s'ouvre
      // depuis la page de la soirée, donc le `?tl=` n'est plus dans l'URL —
      // seul le lien mémorisé fait foi, comme pour les billets et les tables.
      const { getTrackedLinkForCheckout } = await import('@/hooks/usePurchaseSourceTracking');
      const trackedLinkId = searchParams.get('tl') || getTrackedLinkForCheckout(eventId);

      // ── Accords marketing ──────────────────────────────────────────────
      // On transmet la case cochée maintenant OU l'accord déjà actif pour ce
      // destinataire (aucune case n'a alors été affichée) : le renvoyer remet à
      // zéro le compteur des 36 mois, un habitué ne périme jamais.
      const consentEmail = buyerEmail.trim();
      const effectiveNewsletter = newsletterOptIn || marketingConsent.emailGranted;
      const effectiveSms = smsOptIn || marketingConsent.smsGranted;
      const effectiveYuno = yunoOptIn || platformConsent.granted;
      const { email: emailWording } = marketingConsentWording(t, coorgHosts.emailScopeName || consentScope?.scopeName, language);
      const { sms: smsWording } = marketingConsentWording(t, consentScope?.scopeName, language);
      // Preuve d'un accord NOUVEAU uniquement (art. 7(1) RGPD).
      if (newsletterOptIn && !marketingConsent.emailGranted) {
        void recordConsentGrant({
          channel: 'email', wordingText: emailWording, wordingKey: 'consent.emailOffersFrom',
          venueId: consentScope?.venueId ?? null,
          organizerUserId: consentScope?.organizerUserId ?? null,
          email: consentEmail, locale: language, source: 'guestlist_checkout',
        });
      }
      if (smsOptIn && !marketingConsent.smsGranted) {
        void recordConsentGrant({
          channel: 'sms', wordingText: smsWording, wordingKey: 'consent.smsOffersFrom',
          venueId: consentScope?.venueId ?? null,
          organizerUserId: consentScope?.organizerUserId ?? null,
          email: consentEmail, phoneE164: phone.trim() || undefined,
          locale: language, source: 'guestlist_checkout',
        });
      }
      if (yunoOptIn && !platformConsent.granted) {
        void recordPlatformConsentGrant({
          wordingText: t('consent.yunoOffers'), wordingKey: 'consent.yunoOffers',
          email: consentEmail, locale: language, source: 'guestlist_checkout',
        });
      }

      // Le nom et le téléphone corrigés sur cet écran doivent être en base AVANT
      // l'appel : la fonction lit `profiles` pour composer l'entrée. Seulement ce
      // qui a changé — un « Marie Anne Dupont » du profil n'est pas redécoupé.
      if (user) {
        const patch: { first_name?: string; last_name?: string | null; phone?: string } = {};
        const typedName = cleanNamePart(fullName);
        if (typedName !== profileName) {
          const [first, ...rest] = typedName.split(' ');
          patch.first_name = first;
          patch.last_name = rest.join(' ') || null;
        }
        if (phone.trim() && phone.trim() !== profilePhone) patch.phone = phone.trim();
        if (Object.keys(patch).length > 0) {
          const { error: profileError } = await supabase.from('profiles').update(patch).eq('id', user.id);
          if (profileError) throw profileError;
        }
      }

      const { data, error } = await supabase.functions.invoke('create-guest-list-entry', {
        body: {
          shareToken: guestList.shareToken,
          ...(trackedLinkId ? { trackedLinkId } : {}),
          // Consentement publicité + identifiants Meta (Lead côté serveur).
          meta: getMetaCheckoutContext(),
          analytics: getAnalyticsCheckoutContext(),
          // Langue lue par l'invité = langue de son email de confirmation.
          lang: language,
          gender: gender || undefined,
          promoterCode,
          // Accords marketing : le serveur écrit l'abonnement, jamais le client.
          newsletterOptIn: effectiveNewsletter,
          smsOptIn: effectiveSms,
          platformOptIn: effectiveYuno,
          // Guest contact info — the function uses these only when no valid JWT
          // is present, creating an entry with user_id = null.
          ...(user ? {} : {
            guestFullName: cleanNamePart(fullName),
            guestEmail: guestEmail.trim(),
            guestPhone: phone.trim(),
          }),
        },
      });

      if (error) throw error;
      if (data?.error) {
        failCode = typeof data.code === 'string' ? data.code : null;
        throw new Error(data.error);
      }
      capturePosthog('guest_list_joined', { pillar: 'guest_list', via_invite: false, ...(guestList.market ?? marketProps({ eventId })) });
      joined = true;

      // Soirée co-organisée : la case cochée nommait chaque hôte.
      if (newsletterOptIn && coorgHosts.hasCohosts && eventId) {
        await shareCheckoutConsent({
          eventId: eventId, email: consentEmail, wording: emailWording,
          locale: language, source: 'guestlist_checkout', hostKeys: coorgHosts.cohostKeys,
          proof: data?.entry?.id ?? data?.entry?.qrCode ?? null,
        });
      }

      // Le couple (id, email) de l'inscription : c'est la cle du rattachement au
      // compte propose juste apres. L'email vient de la reponse serveur, pas du
      // champ local -- c'est celui qui est reellement stocke, donc le seul que la
      // fonction de rattachement acceptera comme preuve.
      if (data?.entry?.id) setEntryId(data.entry.id);
      setEmailSent(typeof data?.emailSent === 'boolean' ? data.emailSent : null);
      setEntryEmail((data?.entry?.email || buyerEmail).trim());

      if (data?.entry?.qrCode) {
        const qrUrl = await QRCode.toDataURL(data.entry.qrCode, {
          width: 250,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' },
        });
        setQrImage(qrUrl);
      }

      setSuccess(true);
      haptics.success();
      toast.success(t('guestList.registrationSuccess'));
    } catch (caught: unknown) {
      const err = caught as { message?: string; context?: { json?: () => Promise<{ error?: string; code?: string } | null> } } | null | undefined;
      let msg = err?.message || t('guestList.registrationError');
      // supabase-js wraps a non-2xx function response; the real message is in the body.
      try {
        if (err?.context && typeof err.context.json === 'function') {
          const body = await err.context.json();
          if (body?.error) msg = body.error;
          if (typeof body?.code === 'string') failCode = body.code;
        }
      } catch { /* ignore body parse errors */ }
      if (!joined) capturePosthog('checkout_failed', {
        pillar: 'guest_list',
        reason: failCode
          ?? (/authentication required|log in/i.test(msg) ? 'auth_required'
            : /first name and last name/i.test(msg) ? 'name_incomplete'
            : msg.includes('already registered') ? 'already_registered'
            : msg.includes('quota reached') ? 'quota_reached'
            : msg.includes('full') ? 'full'
            : checkoutFailReason(err)),
        ...(guestList?.market ?? {}),
      });
      // Graceful fallback until the guest-capable edge function is deployed: a guest
      // who can't yet be registered without an account is routed to login instead of
      // hitting a dead-end error. Once the function ships, guests succeed and never
      // reach this branch.
      if (!user && /authentication required|log in/i.test(msg)) {
        navigate(`/auth?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      }
      if (/first name and last name/i.test(msg)) toast.error(t('guestList.nameIncomplete'));
      else if (msg.includes('full')) toast.error(t('guestList.full'));
      else if (msg.includes('already registered')) toast.error(t('guestList.alreadyRegistered'));
      else if (msg.includes('quota reached')) toast.error(t('guestList.quotaReached'));
      else toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Loading ──
  if (loading || authLoading || resolving || (!!user && !profileLoaded)) {
    return <GuestListCheckoutSkeleton />;
  }

  // ── Échec réseau/RLS : « connexion impossible » + réessai, pas « introuvable » ──
  if (loadError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 gap-4" style={{ background: '#0A0A0A' }}>
        <p className="font-mono uppercase text-[11px] tracking-[0.06em] text-[#9A9A9A]">{t('guestList.loadError')}</p>
        <Button variant="outline" onClick={() => { setLoading(true); fetchGuestList(); }}>
          {t('common.retry')}
        </Button>
      </div>
    );
  }

  // ── Not found / not public ──
  if (!guestList) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 gap-4" style={{ background: '#0A0A0A' }}>
        <p className="font-mono uppercase text-[11px] tracking-[0.06em] text-[#9A9A9A]">{t('guestList.notFound')}</p>
        <Button variant="outline" onClick={backToSelection}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t('common.back')}
        </Button>
      </div>
    );
  }

  const eventEnded = new Date(guestList.eventEndAt) < new Date();
  // Gendered card: cap against this gender's quota AND the overall list quota.
  const genderQuota = genderParam === 'female' ? guestList.quotaFemale : genderParam === 'male' ? guestList.quotaMale : null;
  const effectiveQuota = genderParam && genderQuota !== null ? genderQuota : guestList.quota;
  const effectiveCount = genderParam ? genderCount : entriesCount;
  // Convention quota NULL = illimité : jamais plein, aucun « restantes » à montrer
  // (sans ce garde, quota - count donnait NaN dans le compteur).
  const isFull = guestList.soldOut
    || (effectiveQuota !== null && effectiveCount >= effectiveQuota)
    || (guestList.quota !== null && entriesCount >= guestList.quota);
  const caps = [
    effectiveQuota !== null ? effectiveQuota - effectiveCount : null,
    guestList.quota !== null ? guestList.quota - entriesCount : null,
  ].filter((n): n is number => n !== null);
  const remaining = caps.length ? Math.max(0, Math.min(...caps)) : null;
  // Rareté (event_scarcity_settings) : même règle que les billets — sans
  // réglage, le compteur brut suit `show_remaining` de la part.
  const glSignal = guestListScarcity(scarcitySettings, {
    capKey: genderParam && genderQuota !== null ? `${guestList.id}:${genderParam}` : guestList.id,
    quota: effectiveQuota, count: effectiveCount, remaining, showRemaining: guestList.showRemaining,
  });
  // Une ligne, comme « Plus que N entrées » au billet : le badge de rareté s'il y
  // en a un, sinon le compteur (masqué si le club a coupé show_remaining).
  const scarcityLine = glSignal.badge
    ? scarcityBadgeText(glSignal.badge, t)
    : glSignal.counter !== null ? `${glSignal.counter} ${t('guestList.spotsLeft')}` : null;
  const freeExpired = timeLeft === t('guestList.expired');
  // A gender picker is only needed as a fallback for a gendered list reached without ?gender.
  const genderRequired = (guestList.quotaFemale !== null || guestList.quotaMale !== null) && !genderParam;
  const genderOptions = ([
    (guestList.quotaFemale === null || guestList.quotaFemale > 0) ? 'female' : null,
    (guestList.quotaMale === null || guestList.quotaMale > 0) ? 'male' : null,
  ] as const).filter((g): g is GuestGender => g !== null);
  const genderError = submitted && genderMissing ? t('guestList.genderRequired') : null;
  const displayTitle = genderParam === 'female'
    ? `${t('guestList.title')} ${t('guestList.female')}`
    : genderParam === 'male'
      ? `${t('guestList.title')} ${t('guestList.male')}`
      : t('guestList.title');
  const dateLine = [
    formatInTimeZone(new Date(guestList.eventStartAt), getEventTimezone({ timezone: guestList.eventTimezone }), 'EEE d MMM · HH:mm', { locale: dateLocale }),
    guestList.venueName,
  ].filter(Boolean).join(' · ');
  const showIdentityCard = !!user && profileComplete && !editingIdentity;
  const loginHref = `/auth?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
  // Ligne rouge de la barre : seulement après un tap, pour dire combien d'infos
  // restent à revoir (le détail est sous chaque champ).
  const barAlert = submitted && missingCount > 0
    ? (missingCount === 1 ? t('ticketCheckout.missingOne') : t('ticketCheckout.missingMany').replace('{n}', String(missingCount)))
    : null;
  const poweredBy = (venuePlan === 'core' || venuePlan === 'collab') ? (
    <div className="flex items-center justify-center gap-2 pb-2 pt-8" style={{ opacity: 0.45 }}>
      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#fff', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Powered by</span>
      <Wordmark height={10} tone="red" />
    </div>
  ) : null;

  // ── Event ended ──
  if (eventEnded) {
    return (
      <GuestListShell title={t('ticketCheckout.stepTitle')} step={2} onBack={backToSelection}>
        <div className="max-w-lg mx-auto px-4 pt-10 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-white/[0.06] flex items-center justify-center mx-auto">
            <PartyPopper className="h-9 w-9 text-white/40" />
          </div>
          <h2 className="text-xl font-bold">{t('guestList.eventOver')}</h2>
          <p className="text-sm text-[#9A9A9A]">{guestList.eventTitle}</p>
          <Button className="w-full" onClick={() => navigate('/')}>{t('guestList.discoverNextParty')}</Button>
        </div>
      </GuestListShell>
    );
  }

  // ── Success (QR) ──
  if (success) {
    // Le QR est derrière un mot de passe, exactement comme sur le lien privé :
    // c'est la même inscription, le même inconnu, la même contrepartie. La place
    // est acquise avant cette étape et le QR part aussi par email — le verrou
    // n'enferme personne dehors. Un compte déjà connecté n'est pas concerné.
    const qrLocked = !user && !accountCreated && !!entryId;
    return (
      <GuestListShell title={t('guestList.stepDone')} step={3} onBack={() => navigate(qrLocked ? '/' : '/my-orders')}>
        <div className="max-w-lg mx-auto px-4 pt-5 pb-10">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="border border-orange-500/25 bg-[#141414] p-6 text-center space-y-4"
            style={{ borderRadius: 12, backgroundColor: 'rgba(249,115,22,0.04)' }}
          >
            <div className="w-16 h-16 rounded-full bg-orange-500/15 flex items-center justify-center mx-auto">
              <CheckCircle className="h-9 w-9 text-orange-400" />
            </div>
            <h2 className="text-xl font-bold">{t('guestList.confirmed')}</h2>
            <p className="text-sm text-[#9A9A9A]">{guestList.eventTitle}</p>
            <div className="text-sm space-y-1 text-[#9A9A9A]">
              <p><Clock className="h-3.5 w-3.5 inline mr-1" />{t('guestList.freeBefore')} {guestList.freeBeforeTime}</p>
              {guestList.includesDrink && (
                <p className="text-orange-400"><Wine className="h-3.5 w-3.5 inline mr-1" />{t('guestList.drinkIncluded')}</p>
              )}
            </div>
            {/* Tant que le QR est verrouillé, cette carte ne dit QUE l'essentiel :
                la place est prise. Le QR, le pass Wallet et les sorties vivent
                sous le verrou. */}
            {!qrLocked && (
              <>
                {qrImage && <img src={qrImage} alt="QR Code" className="mx-auto rounded-lg" />}
                <p className="text-xs text-[#9A9A9A]">{t('guestList.showQR')}</p>
                {emailSent !== null && (
                  <p className={`text-xs ${emailSent ? 'text-[#9A9A9A]' : 'text-amber-500'}`}>
                    {t(emailSent ? 'guestList.emailSent' : 'guestList.emailFailed')}
                  </p>
                )}
                {/* Apple Wallet juste sous le QR : le pass se prend ici, pas
                    seulement depuis Mes Commandes. Le composant se masque hors
                    appareil Apple et sans session. */}
                {entryId && <WalletButtons type="guestlist" id={entryId} variant="hero" />}
                {(user || accountCreated) && (
                  <Button className="w-full" onClick={() => navigate('/my-orders?tab=tickets')}>
                    <Ticket className="h-4 w-4 mr-2" />{t('guestList.viewInOrders')}
                  </Button>
                )}
              </>
            )}
          </motion.div>

          {/* Le déverrouillage vit SOUS la carte de confirmation : la place est
              acquise (la carte le dit), le mot de passe est l'étape suivante. */}
          {qrLocked && (
            <div className="mt-6">
              <GuestAccountUnlock
                email={entryEmail}
                fullName={cleanNamePart(fullName)}
                entryId={entryId}
                qrImage={qrImage}
                relinkBackUrl={relinkBackUrl}
                emailSent={emailSent}
                accent="#F97316"
                onCreated={() => {
                  setAccountCreated(true);
                  toast.success(t('glconf.created'));
                }}
              />
            </div>
          )}
        </div>
      </GuestListShell>
    );
  }

  return (
    <GuestListShell title={t('ticketCheckout.stepTitle')} step={2} onBack={backToSelection}>
      <PublicPage variant="flow">
      <div className="mx-auto max-w-lg px-4 pb-6 pt-5">
        {/* Votre commande : la soirée, la liste, ce qu'elle donne. */}
        <section aria-label={t('ticketCheckout.summary')} className="overflow-hidden rounded-[10px] border border-white/[0.08] bg-[#141414]">
          <OrderEventRow posterUrl={guestList.eventImageUrl} dateLine={dateLine} title={guestList.eventTitle} />
          <div className="h-px bg-white/[0.07]" />
          <div className="flex items-start gap-3 p-3.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-[1.3] text-white [overflow-wrap:anywhere]">{displayTitle}</p>
              <p className="mt-1 flex items-center gap-1.5 text-[12.5px] leading-[1.4] text-[#9A9A9A]">
                <Clock className="h-3 w-3 shrink-0" aria-hidden />
                {t('guestList.freeBefore')} {guestList.freeBeforeTime}
                {timeLeft && !freeExpired && !isFull && <> · {t('guestList.freeFor').replace('{time}', timeLeft)}</>}
              </p>
              {guestList.includesDrink && (
                <p className="mt-1 flex items-center gap-1.5 text-[12.5px] leading-[1.4] text-[#9A9A9A]">
                  <Wine className="h-3 w-3 shrink-0" aria-hidden />
                  {t('guestList.drinkIncluded')}
                </p>
              )}
              {!isFull && scarcityLine && (
                <p className="mt-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-amber-400">{scarcityLine}</p>
              )}
            </div>
            <span className="shrink-0 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-white">{t('guestList.free')}</span>
          </div>
        </section>

        {isFull ? (
          <div className="mt-7 rounded-[10px] border border-red-500/25 p-5 text-center" style={{ backgroundColor: 'rgba(239,68,68,0.06)' }}>
            <p className="font-display text-lg font-bold text-red-400">{t('guestList.full')}</p>
            <Button className="mt-3" onClick={backToSelection}>
              <Ticket className="h-4 w-4 mr-2" />{t('guestList.buyTicket')}
            </Button>
          </div>
        ) : alreadyRegistered ? (
          <div className="mt-7 space-y-3 rounded-[10px] border border-orange-500/25 p-6 text-center" style={{ backgroundColor: 'rgba(249,115,22,0.05)' }}>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-orange-500/15">
              <CheckCircle className="h-8 w-8 text-orange-400" />
            </div>
            <h3 className="text-base font-bold">{t('guestList.alreadyOnList')}</h3>
            <p className="text-sm text-[#9A9A9A]">{t('guestList.alreadyOnListDesc')}</p>
            <Button className="w-full" onClick={() => navigate('/my-orders')}>
              <Ticket className="h-4 w-4 mr-2" />{t('guestList.viewInOrders')}
            </Button>
          </div>
        ) : (
          /* Vos infos : une colonne, aucune carte autour des champs. Pas de compte
             exigé ; la création d'un compte est proposée APRÈS l'inscription. */
          <section className="mt-7 flex flex-col gap-[18px]">
            <div>
              <h1 className="font-display text-2xl font-bold leading-[1.1] tracking-[-0.015em] text-white">
                {showIdentityCard ? t('ticketCheckout.readyTitle') : t('guestList.formTitle')}
              </h1>
              {showIdentityCard ? (
                <p className="mt-2 text-[13.5px] leading-[1.45] text-[#9A9A9A]">{t('guestList.readySub')}</p>
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
                  else if (field === 'email') setGuestEmail(value);
                  else setPhone(value);
                }}
                onBlur={markTouched}
                errors={{ name: shownError('name') ?? undefined, email: shownError('email') ?? undefined, phone: shownError('phone') ?? undefined }}
                valid={{
                  name: fieldValid('name', fullName),
                  email: !user && fieldValid('email', guestEmail),
                  phone: fieldValid('phone', phone),
                }}
                emailReadOnly={!!user}
                emailSuggestion={emailSuggestion}
                onAcceptSuggestion={() => emailSuggestion && setGuestEmail(emailSuggestion)}
                // Dit tout de suite ce qu'on ne disait qu'après le mot de passe.
                // Simple information : la place reste accessible sans compte.
                emailNotice={!user && typedEmailHasAccount ? <ExistingAccountNotice email={guestEmail.trim()} /> : undefined}
                nameHint={t('guestList.nameHint')}
                emailHint={t('guestList.emailHint')}
                emailAccountHint={t('guestList.emailAccountHint')}
                defaultCountry={guestList.phoneCountry}
                fieldRefs={fieldRefs}
              />
            )}

            {/* Liste genrée ouverte sans `?gender=` : deux choix, jamais un menu. */}
            {genderRequired && (
              <GenderChoice value={gender} onChange={setGender} options={genderOptions} error={genderError} anchorRef={genderRef} />
            )}

            <div className="pt-2.5">
              <MarketingOptIns
                variant="flat"
                // Destinataire introuvable = pas de case à son nom, mais la ligne
                // Yuno reste : elle, elle nomme bien qui reçoit.
                showEmail={!!consentScope}
                showSms={!!consentScope}
                newsletterOptIn={newsletterOptIn}
                onNewsletterChange={setNewsletterOptIn}
                smsOptIn={smsOptIn}
                onSmsChange={setSmsOptIn}
                scopeName={coorgHosts.emailScopeName || consentScope?.scopeName}
                smsScopeName={consentScope?.scopeName}
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

        {/* Powered by Yuno — Core plan only */}
        {poweredBy}
      </div>
      </PublicPage>

      {/* La même barre que les billets : rien à payer, un seul bouton toujours
          actif (un oubli mène au champ, il ne grise rien). */}
      {!isFull && !alreadyRegistered && (
        <CheckoutSummaryBar
          reserveSpace
          total={0}
          fee={0}
          buttonText={t('guestList.confirmRegistration')}
          onClick={() => void handleConfirm()}
          loading={submitting}
          alert={barAlert}
          footnote={t('guestList.footnote')}
        />
      )}
    </GuestListShell>
  );
}

/** Coquille du tunnel : l'en-tête d'étape commun (billets, tables, guest list). */
function GuestListShell({ title, step, onBack, children }: { title: string; step: number; onBack: () => void; children: React.ReactNode }) {
  return (
    <div className="min-h-screen" style={{ background: '#0A0A0A' }}>
      <CheckoutStepHeader title={title} step={step} total={3} onBack={onBack} />
      {children}
    </div>
  );
}
