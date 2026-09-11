import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { useEventRoute } from '@/hooks/useEventRoute';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useScrollIntoViewOnFocus } from '@/hooks/useScrollIntoViewOnFocus';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckoutSteps } from '@/components/CheckoutSteps';
import { PhoneInputWithCountry } from '@/components/PhoneInputWithCountry';
import { StickyCheckoutFooter } from '@/components/StickyCheckoutFooter';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';
import { getStoredPromoCodeForVenue, getStoredPromoCodeForScope } from '@/hooks/usePromoterTracking';
import { formatInTimeZone } from 'date-fns-tz';
import { PARIS_TIMEZONE, countryOfPlace } from '@/lib/timezone';
import { fr, es, enUS } from 'date-fns/locale';
import { toast } from 'sonner';
import { ArrowLeft, Clock, Wine, CheckCircle, Ticket, LogIn, PartyPopper, Calendar } from 'lucide-react';
import QRCode from 'qrcode';
import { haptics } from '@/lib/haptics';
import { PublicPage } from '@/components/PublicPage';
import { WalletButtons } from '@/components/WalletButtons';
import { useExistingAccountCheck } from '@/hooks/useExistingAccountCheck';
import { ExistingAccountNotice } from '@/components/account/ExistingAccountNotice';
import { GuestAccountUnlock } from '@/components/account/GuestAccountUnlock';
import { MarketingOptIns } from '@/components/MarketingOptIns';
import { composeFullName, isCompleteName } from '@/lib/guestName';
import {
  useMarketingConsent, usePlatformMarketingConsent, recordConsentGrant,
  recordPlatformConsentGrant, marketingConsentWording,
} from '@/hooks/useMarketingConsent';
import { Wordmark } from '@/components/brand/Wordmark';
import { GuestListCheckoutSkeleton } from '@/components/skeletons/GuestListCheckoutSkeleton';
import { useEventScarcity } from '@/hooks/useScarcitySettings';
import { guestListScarcity, scarcityBadgeText } from '@/lib/guestListScarcity';

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
  eventImageUrl: string | null;
  venueId: string | null;
  venueName: string;
  /** Pays où se déroule la soirée — indicatif par défaut du champ téléphone. */
  phoneCountry: string | null;
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
  // Guest registration (no account) — mirrors the ticket/table guest flow.
  // Prénom ET nom, séparément — cf. src/lib/guestName.ts : la liste de porte
  // ne montre que le nom, un seul mot n'y identifie personne.
  const [guestFirstName, setGuestFirstName] = useState('');
  const [guestLastName, setGuestLastName] = useState('');
  const guestName = composeFullName(guestFirstName, guestLastName);
  const guestNameReady = isCompleteName(guestName);
  const [guestEmail, setGuestEmail] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  // Inscrit CONNECTÉ : le serveur compose son nom depuis `profiles`. On montre
  // ce nom, on le laisse corriger, et on l'écrit avant d'appeler la fonction.
  const [profileFirstName, setProfileFirstName] = useState('');
  const [profileLastName, setProfileLastName] = useState('');
  const profileNameReady = isCompleteName(composeFullName(profileFirstName, profileLastName));
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

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    supabase.from('profiles').select('first_name, last_name').eq('id', user.id).maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        setProfileFirstName(data.first_name || '');
        setProfileLastName(data.last_name || '');
      });
    return () => { cancelled = true; };
  }, [user]);

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
        .select('id, quota, quota_female, quota_male, free_before_time, includes_drink, show_remaining, share_token, holder_type, events!inner(id, title, start_at, end_at, venue_id, partner_venue_id, organizer_user_id, partner_organizer_id, poster_url, timezone, location_city)')
        .eq('event_id', eventId)
        .eq('is_active', true)
        .eq('visible_on_club_page', true);
      if (glError) throw glError;
      // Liste club prioritaire ; sinon la première part marquée « publique » (visibilité
      // choisie dans son preset). Les parts non visibles restent accessibles par lien.
      const gl = (glRows || []).find((r: { holder_type?: string }) => r.holder_type === 'club') ?? (glRows || [])[0] ?? null;

      if (!gl) { setLoading(false); return; }

      const ev = (gl as any).events;
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
        eventImageUrl: ev.poster_url || null,
        venueId: eventVenueId,
        venueName,
        // Indicatif par défaut = pays de la soirée (fuseau figé à la
        // publication, ville en repli). venues.timezone n'est pas anon-readable.
        phoneCountry: countryOfPlace({
          timezone: ev.timezone,
          city: venueCity || ev.location_city,
        })?.code ?? null,
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

  // Retrait immédiat, sans quitter la page (EDPB 05/2020 §114).
  const handleWithdrawConsent = async (channel: 'email' | 'sms', wordingText: string) => {
    const ok = await marketingConsent.withdraw(channel, wordingText, language, 'guestlist_checkout');
    if (ok) {
      if (channel === 'email') setNewsletterOptIn(false);
      else setSmsOptIn(false);
      toast.success(t('consent.unsubscribed'));
    } else {
      toast.error(t('consent.withdrawFailed'));
    }
    return ok;
  };

  const handleWithdrawYuno = async (wordingText: string) => {
    const ok = await platformConsent.withdraw(wordingText, language, 'guestlist_checkout');
    if (ok) {
      setYunoOptIn(false);
      toast.success(t('consent.unsubscribed'));
    } else {
      toast.error(t('consent.withdrawFailed'));
    }
    return ok;
  };

  /** Les cases d'accord, identiques sur les deux formulaires (invité et connecté). */
  const marketingOptIns = (
    <MarketingOptIns
      // Destinataire introuvable = pas de case à son nom, mais la ligne Yuno
      // reste : elle, elle nomme bien qui reçoit.
      showEmail={!!consentScope}
      showSms={!!consentScope}
      newsletterOptIn={newsletterOptIn}
      onNewsletterChange={setNewsletterOptIn}
      smsOptIn={smsOptIn}
      onSmsChange={setSmsOptIn}
      scopeName={consentScope?.scopeName}
      emailAlreadyGranted={marketingConsent.emailGranted}
      smsAlreadyGranted={marketingConsent.smsGranted}
      pending={marketingConsent.pending || platformConsent.pending}
      onWithdraw={handleWithdrawConsent}
      showYuno
      yunoOptIn={yunoOptIn}
      onYunoChange={setYunoOptIn}
      yunoAlreadyGranted={platformConsent.granted}
      onWithdrawYuno={handleWithdrawYuno}
    />
  );

  const handleConfirm = async () => {
    if (!guestList || submitting) return;
    if ((guestList.quotaFemale !== null || guestList.quotaMale !== null) && !gender) {
      toast.error(t('guestList.genderRequired'));
      return;
    }
    // Guests register without an account — validate their contact info up front.
    if (!user && (!guestEmail.trim() || !guestPhone.trim())) {
      toast.error(t('tickets.fillRequired'));
      return;
    }
    // Le nom part sur la liste de porte : un seul mot n'y identifie personne.
    if (!user && !guestNameReady) {
      toast.error(t('guestList.nameIncomplete'));
      return;
    }
    if (user && !profileNameReady) {
      toast.error(t('guestList.nameIncomplete'));
      return;
    }

    setSubmitting(true);
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
      const consentEmail = (user?.email ?? guestEmail).trim();
      const effectiveNewsletter = newsletterOptIn || marketingConsent.emailGranted;
      const effectiveSms = smsOptIn || marketingConsent.smsGranted;
      const effectiveYuno = yunoOptIn || platformConsent.granted;
      const { email: emailWording, sms: smsWording } = marketingConsentWording(t, consentScope?.scopeName);
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
          email: consentEmail, phoneE164: guestPhone.trim() || undefined,
          locale: language, source: 'guestlist_checkout',
        });
      }
      if (yunoOptIn && !platformConsent.granted) {
        void recordPlatformConsentGrant({
          wordingText: t('consent.yunoOffers'), wordingKey: 'consent.yunoOffers',
          email: consentEmail, locale: language, source: 'guestlist_checkout',
        });
      }

      // Le nom corrigé sur cet écran doit être en base AVANT l'appel : la
      // fonction lit `profiles` pour composer `full_name` de l'entrée.
      if (user) {
        const { error: profileError } = await supabase.from('profiles')
          .update({ first_name: profileFirstName.trim(), last_name: profileLastName.trim() })
          .eq('id', user.id);
        if (profileError) throw profileError;
      }

      const { data, error } = await supabase.functions.invoke('create-guest-list-entry', {
        body: {
          shareToken: guestList.shareToken,
          ...(trackedLinkId ? { trackedLinkId } : {}),
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
            guestFullName: guestName.trim(),
            guestEmail: guestEmail.trim(),
            guestPhone: guestPhone.trim(),
          }),
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Le couple (id, email) de l'inscription : c'est la cle du rattachement au
      // compte propose juste apres. L'email vient de la reponse serveur, pas du
      // champ local -- c'est celui qui est reellement stocke, donc le seul que la
      // fonction de rattachement acceptera comme preuve.
      if (data?.entry?.id) setEntryId(data.entry.id);
      setEmailSent(typeof data?.emailSent === 'boolean' ? data.emailSent : null);
      setEntryEmail((data?.entry?.email || guestEmail).trim());

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
    } catch (err: any) {
      let msg = err?.message || t('guestList.registrationError');
      // supabase-js wraps a non-2xx function response; the real message is in the body.
      try {
        if (err?.context && typeof err.context.json === 'function') {
          const body = await err.context.json();
          if (body?.error) msg = body.error;
        }
      } catch { /* ignore body parse errors */ }
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
  if (loading || authLoading || resolving) {
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
  const isFull = (effectiveQuota !== null && effectiveCount >= effectiveQuota)
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
  const showCounter = glSignal.counter !== null;
  const scarcityBadge = glSignal.badge ? (
    <span className="inline-block rounded-full border border-red-500/25 bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-400 animate-pulse">
      {scarcityBadgeText(glSignal.badge, t)}
    </span>
  ) : null;
  // A gender picker is only needed as a fallback for a gendered list reached without ?gender.
  const genderRequired = (guestList.quotaFemale !== null || guestList.quotaMale !== null) && !genderParam;
  const displayTitle = genderParam === 'female'
    ? `${t('guestList.title')} ${t('guestList.female')}`
    : genderParam === 'male'
      ? `${t('guestList.title')} ${t('guestList.male')}`
      : t('guestList.title');

  // ── Event ended ──
  if (eventEnded) {
    return (
      <CheckoutShell title={displayTitle} onBack={backToSelection}>
        <div className="max-w-lg mx-auto px-4 pt-10 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-white/[0.06] flex items-center justify-center mx-auto">
            <PartyPopper className="h-9 w-9 text-white/40" />
          </div>
          <h2 className="text-xl font-bold">{t('guestList.eventOver')}</h2>
          <p className="text-sm text-white/45">{guestList.eventTitle}</p>
          <Button className="w-full" onClick={() => navigate('/')}>🎉 {t('guestList.discoverNextParty')}</Button>
        </div>
      </CheckoutShell>
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
      <CheckoutShell title={displayTitle} onBack={() => navigate(qrLocked ? '/' : '/my-orders')}>
        <div className="max-w-lg mx-auto px-4 pt-6 pb-10">
          <CheckoutSteps currentStep={3} />
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-6 border border-orange-500/25 bg-[#141414] p-6 text-center space-y-4"
            style={{ borderRadius: 12, backgroundColor: 'rgba(249,115,22,0.04)' }}
          >
            <div className="w-16 h-16 rounded-full bg-orange-500/15 flex items-center justify-center mx-auto">
              <CheckCircle className="h-9 w-9 text-orange-400" />
            </div>
            <h2 className="text-xl font-bold">{t('guestList.confirmed')}</h2>
            <p className="text-sm text-white/45">{guestList.eventTitle}</p>
            <div className="text-sm space-y-1 text-white/55">
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
                <p className="text-xs text-white/40">{t('guestList.showQR')}</p>
                {emailSent !== null && (
                  <p className={`text-xs ${emailSent ? 'text-white/40' : 'text-amber-500'}`}>
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
                fullName={guestName.trim()}
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
      </CheckoutShell>
    );
  }

  return (
    <CheckoutShell title={displayTitle} onBack={backToSelection}>
      <PublicPage variant="flow">
      <div className="max-w-lg mx-auto px-4 pt-4 pb-36">
        <CheckoutSteps currentStep={2} />

        {/* Event card */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 border border-white/[0.08] bg-[#141414] p-3 flex items-center gap-3"
          style={{ borderRadius: 10 }}
        >
          {guestList.eventImageUrl && (
            <div className="w-16 h-16 shrink-0 overflow-hidden bg-white/[0.04]" style={{ borderRadius: 6 }}>
              <img
                src={getOptimizedImageUrl(guestList.eventImageUrl, { width: 128, height: 128, quality: 82 })}
                alt={guestList.eventTitle}
                className="w-full h-full object-cover object-center"
              />
            </div>
          )}
          <div className="min-w-0">
            <p className="font-display font-bold uppercase text-white leading-tight" style={{ fontSize: '15px', letterSpacing: '-0.005em' }}>{guestList.eventTitle}</p>
            {guestList.venueName && <p className="text-[11px] text-white/45 mt-0.5">{guestList.venueName}</p>}
            <p className="font-mono uppercase text-[#9A9A9A] flex items-center gap-1.5 mt-1.5" style={{ fontSize: '10px', letterSpacing: '0.04em' }}>
              <Calendar className="h-3 w-3 shrink-0" />
              {formatInTimeZone(new Date(guestList.eventStartAt), PARIS_TIMEZONE, 'EEE d MMM · HH:mm', { locale: dateLocale })}
            </p>
          </div>
        </motion.div>

        {/* Perks */}
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-orange-400 bg-orange-500/10 border border-orange-500/20 px-2.5 py-1 rounded-sm">
            {t('guestList.free')} — 0 €
          </span>
          <span className="text-[11px] font-medium text-white/55 bg-white/[0.04] border border-white/[0.08] px-2.5 py-1 rounded-sm flex items-center gap-1.5">
            <Clock className="h-3 w-3" />{t('guestList.freeBefore')} {guestList.freeBeforeTime}
          </span>
          {guestList.includesDrink && (
            <span className="text-[11px] font-medium text-orange-400 bg-orange-500/10 border border-orange-500/20 px-2.5 py-1 rounded-sm flex items-center gap-1.5">
              <Wine className="h-3 w-3" />{t('guestList.drinkIncluded')}
            </span>
          )}
        </div>

        {/* Spots — chiffre masqué si le club a coupé show_remaining (ou part illimitée). */}
        {!isFull && (showCounter || timeLeft || scarcityBadge) && (
          <div className="mt-3 border border-orange-500/15 p-4 text-center" style={{ backgroundColor: 'rgba(249,115,22,0.06)', borderRadius: 10 }}>
            {scarcityBadge && <div className="mb-2">{scarcityBadge}</div>}
            {showCounter ? (
              <>
                <p className="text-3xl font-bold text-orange-400">{glSignal.counter}</p>
                <p className="text-sm text-white/45">{t('guestList.spotsLeft')}</p>
              </>
            ) : (
              <p className="text-sm font-semibold text-orange-400">{t('guestList.listOpen')}</p>
            )}
            {timeLeft && <p className="text-xs text-white/40 mt-1">⏱ {timeLeft}</p>}
          </div>
        )}

        {/* States */}
        {isFull ? (
          <div className="mt-4 border border-red-500/20 p-5 text-center" style={{ backgroundColor: 'rgba(239,68,68,0.06)', borderRadius: 10 }}>
            <p className="text-lg font-bold text-red-400">{t('guestList.full')}</p>
            <Button className="mt-3" onClick={backToSelection}>
              <Ticket className="h-4 w-4 mr-2" />{t('guestList.buyTicket')}
            </Button>
          </div>
        ) : alreadyRegistered ? (
          <div className="mt-4 border border-orange-500/25 p-6 text-center space-y-3" style={{ backgroundColor: 'rgba(249,115,22,0.05)', borderRadius: 10 }}>
            <div className="w-14 h-14 rounded-full bg-orange-500/15 flex items-center justify-center mx-auto">
              <CheckCircle className="h-8 w-8 text-orange-400" />
            </div>
            <h3 className="text-base font-bold">{t('guestList.alreadyOnList')}</h3>
            <p className="text-sm text-white/45">{t('guestList.alreadyOnListDesc')}</p>
            <Button className="w-full" onClick={() => navigate('/my-orders')}>
              <Ticket className="h-4 w-4 mr-2" />{t('guestList.viewInOrders')}
            </Button>
          </div>
        ) : !user ? (
          /* Guest registration — no account required (mirrors the ticket/table guest flow).
             Account creation becomes an optional upsell after success, not a wall before it. */
          <div className="mt-5 border border-white/[0.08] bg-[#141414] p-4 space-y-4" style={{ borderRadius: 10 }}>
            <div className="space-y-1">
              <p className="text-sm font-medium">{t('guestList.yourDetails')}</p>
              <p className="text-xs text-white/45">{t('guestList.guestSubtitle')}</p>
            </div>

            <button
              type="button"
              onClick={() => navigate(`/auth?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`)}
              className="flex items-center gap-1.5 text-[12px] text-white/55 hover:text-white transition-colors"
            >
              <LogIn className="h-3.5 w-3.5 text-orange-400 shrink-0" />
              <span>{t('guest.haveAccountQuestion')}{' '}
                <span className="text-orange-400 font-semibold underline underline-offset-2">{t('guest.logIn')}</span>
              </span>
            </button>

            <div className="space-y-3">
              {/* `autoComplete` explicite : sans lui, un navigateur in-app
                  (Instagram, TikTok) remplit le champ avec le pseudo du profil
                  au lieu du nom civil. */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="gl-first-name" className="text-xs text-white/55">{t('guest.firstName')} *</Label>
                  <Input id="gl-first-name" name="given-name" autoComplete="given-name" value={guestFirstName}
                    onChange={(e) => setGuestFirstName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gl-last-name" className="text-xs text-white/55">{t('guest.lastName')} *</Label>
                  <Input id="gl-last-name" name="family-name" autoComplete="family-name" value={guestLastName}
                    onChange={(e) => setGuestLastName(e.target.value)} />
                </div>
              </div>
              <p className="text-[11px] text-white/45">{t('guestList.nameDoorHint')}</p>
              <div className="space-y-1.5">
                <Label htmlFor="gl-email" className="text-xs text-white/55">{t('guestList.email')} *</Label>
                <Input id="gl-email" type="email" name="email" autoComplete="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} placeholder={t('guestList.emailPlaceholder')} />
                {/* Dit tout de suite ce qu'on ne disait qu'après le mot de passe.
                    Simple information : la place reste accessible sans compte. */}
                {typedEmailHasAccount && <ExistingAccountNotice email={guestEmail.trim()} />}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gl-phone" className="text-xs text-white/55">{t('guestList.phone')} *</Label>
                <PhoneInputWithCountry id="gl-phone" value={guestPhone} onChange={setGuestPhone} defaultCountry={guestList?.phoneCountry} />
              </div>
            </div>

            {genderRequired && (
              <div>
                <p className="text-sm font-medium mb-2">{t('guestList.gender')} *</p>
                <Select value={gender} onValueChange={setGender}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('guestList.selectGender')} />
                  </SelectTrigger>
                  <SelectContent>
                    {(guestList.quotaFemale === null || guestList.quotaFemale > 0) && (
                      <SelectItem value="female">{t('guestList.female')}</SelectItem>
                    )}
                    {(guestList.quotaMale === null || guestList.quotaMale > 0) && (
                      <SelectItem value="male">{t('guestList.male')}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

            {marketingOptIns}

            <div className="border-t border-white/[0.08] pt-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-white/70">{displayTitle} — {guestList.eventTitle}</span>
                <span className="font-bold text-orange-400">0 €</span>
              </div>
              {guestList.includesDrink && (
                <div className="flex justify-between text-sm text-white/45">
                  <span>🍸 {t('guestList.drinkIncluded')}</span>
                  <span>{t('guestList.included')}</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Logged-in confirmation form */
          <div className="mt-5 border border-white/[0.08] bg-[#141414] p-4 space-y-4" style={{ borderRadius: 10 }}>
            <div className="rounded-lg bg-white/[0.04] p-3 space-y-1">
              <p className="text-sm font-medium">{t('guestList.registeredAs')}</p>
              <p className="text-sm text-white/45">{user.email}</p>
            </div>

            {/* Le nom lu à la porte — montré, et corrigeable ici. */}
            <div className="space-y-1.5">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="gl-me-first" className="text-xs text-white/55">{t('guest.firstName')} *</Label>
                  <Input id="gl-me-first" name="given-name" autoComplete="given-name" value={profileFirstName}
                    onChange={(e) => setProfileFirstName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gl-me-last" className="text-xs text-white/55">{t('guest.lastName')} *</Label>
                  <Input id="gl-me-last" name="family-name" autoComplete="family-name" value={profileLastName}
                    onChange={(e) => setProfileLastName(e.target.value)} />
                </div>
              </div>
              <p className="text-[11px] text-white/45">{t('guestList.nameDoorHint')}</p>
            </div>

            {genderRequired && (
              <div>
                <p className="text-sm font-medium mb-2">{t('guestList.gender')} *</p>
                <Select value={gender} onValueChange={setGender}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('guestList.selectGender')} />
                  </SelectTrigger>
                  <SelectContent>
                    {(guestList.quotaFemale === null || guestList.quotaFemale > 0) && (
                      <SelectItem value="female">{t('guestList.female')}</SelectItem>
                    )}
                    {(guestList.quotaMale === null || guestList.quotaMale > 0) && (
                      <SelectItem value="male">{t('guestList.male')}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

            {marketingOptIns}

            <div className="border-t border-white/[0.08] pt-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-white/70">{displayTitle} — {guestList.eventTitle}</span>
                <span className="font-bold text-orange-400">0 €</span>
              </div>
              {guestList.includesDrink && (
                <div className="flex justify-between text-sm text-white/45">
                  <span>🍸 {t('guestList.drinkIncluded')}</span>
                  <span>{t('guestList.included')}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      </PublicPage>

      {/* Sticky confirm — shown on the registration form (logged-in or guest) */}
      {!isFull && !alreadyRegistered && (
        <StickyCheckoutFooter
          amount={0}
          label={`${displayTitle} · ${t('guestList.free')}`}
          buttonText={t('guestList.confirmRegistration')}
          isLoading={submitting}
          disabled={(genderRequired && !gender) || (user ? !profileNameReady : (!guestNameReady || !guestEmail.trim() || !guestPhone.trim()))}
          onClick={handleConfirm}
        />
      )}

      {/* Powered by Yuno — Core plan only */}
      {(venuePlan === 'core' || venuePlan === 'collab') && (
        <div className="pb-6 pt-2 flex items-center justify-center gap-2" style={{ opacity: 0.45 }}>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#fff', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Powered by</span>
          <Wordmark height={10} tone="red" />
        </div>
      )}
    </CheckoutShell>
  );
}

function CheckoutShell({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <div className="min-h-screen" style={{ background: '#0A0A0A' }}>
      <header
        className="sticky top-0 z-40"
        style={{ background: 'rgba(10,10,10,0.90)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
      >
        <div className="flex items-center gap-3 px-4 h-12">
          <button
            onClick={onBack}
            className="h-8 w-8 flex items-center justify-center bg-white/[0.06] hover:bg-white/[0.10] transition-colors"
            style={{ borderRadius: 2 }}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <p className="font-mono uppercase truncate flex-1" style={{ fontSize: '11px', letterSpacing: '0.06em', color: '#9A9A9A' }}>{title}</p>
        </div>
      </header>
      {children}
    </div>
  );
}
