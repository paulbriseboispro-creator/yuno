import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar, Plus, Pencil, Trash2, Clock, Upload, X, Archive, ChevronDown, ChevronUp, Info, Tag, Lock, Users, Ticket, Crown, RefreshCw, Sparkles, ExternalLink, Eye, Building2, Check, Settings2, Link2, Ban, Rocket, type LucideIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import type { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';
import { Event } from '@/types';
import { formatInTimeZone } from 'date-fns-tz';
import { fr, es, enUS } from 'date-fns/locale';
import { toast } from 'sonner';
import { PARIS_TIMEZONE, toParisTime, fromParisTime, nowInParis, getEventTimezone, fromWallClockInTz, toWallClockInputInTz, cityToTimezone, SUPPORTED_TIMEZONES, tzOffsetLabel } from '@/lib/timezone';
import { notifyDjLineup } from '@/lib/djNotify';
import { loadLineupEntries, saveLineup, type LineupEntry } from '@/lib/djLineup';
import { loadGuestArtists, saveGuestArtists, type GuestArtist } from '@/lib/guestArtists';
import { useLanguage } from '@/contexts/LanguageContext';
import { useVenueContext } from '@/hooks/useVenueContext';
import { useDashboardMode } from '@/contexts/DashboardModeContext';
import { OwnerHeader } from '@/components/OwnerHeader';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { PosterCropper, PosterPosition } from '@/components/PosterCropper';
import { DJLineupSelector } from '@/components/dj/DJLineupSelector';
import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';
import { isCollabPlan } from '@/lib/planFeatures';
import { useMetaIntegrationLive } from '@/lib/metaIntegration';
import { useOrganizerPartnerships, useVenuePartnerships } from '@/hooks/useOrganizerPartnerships';
import { useOrganizerStripe } from '@/hooks/useOrganizerStripe';
import { useProposeCollab, fetchLiveEventContract } from '@/hooks/useProposeCollab';
import { ResponsibilitiesPicker } from '@/components/collab/ResponsibilitiesPicker';
import { defaultResponsibilities, normalizeResponsibilities, type CollabResponsibilities } from '@/utils/collabResponsibilities';
import { CollabActivateBanner } from '@/components/collab/CollabActivateBanner';
import { CollabReadOnlyBanner } from '@/components/CollabReadOnlyBanner';
import { OwnerCollaborationsSection } from '@/components/owner/OwnerCollaborationsSection';
import TrackedLinksManager, { TrackedOwnerKind } from '@/components/tracking/TrackedLinksManager';
import { RecurringEventsManager } from '@/components/owner/RecurringEventsManager';
import { useNavigate } from 'react-router-dom';

import type { EventKind, CollabMode, OwnerEventRow, VenuePreset } from '@/components/owner/events/events-types';
import {
  RED, T1, T2, T3, C_FAINT, BORDER, F_BORDER, CARD_BG, INNER_BG, CARD_SHADOW,
  DarkInput, DarkTextarea, FieldLabel,
} from '@/components/owner/events/events-ui';
import { cropToSquare } from '@/components/owner/events/events-utils';
import { EventVideoField } from '@/components/owner/events/EventVideoField';
import { PublishingOverlay, type PublishStage, type PublishedEvent } from '@/components/owner/events/PublishingOverlay';
import { AddressAutocomplete } from '@/components/location/AddressAutocomplete';
import { startEventVideoUpload, startOrganizerImageUpload } from '@/lib/eventMedia';
import { useDeferredMedia } from '@/hooks/useDeferredMedia';
import { EventGenrePicker } from '@/components/owner/events/EventGenrePicker';
import { openExternal, publicUrl } from '@/lib/native';
import { useTabParam } from '@/hooks/useTabParam';

// Shape of one round stored in a ticket preset's JSON `rounds` column.
type PresetRound = {
  name: string;
  price: number;
  maxTickets?: number;
  lastTicketsThreshold?: number;
  includesDrink?: boolean;
  entryDeadline?: string | null;
};

// A saved club guest-list template, used by the inline picker on each event card.
type GuestPreset = {
  id: string;
  name: string;
  is_default: boolean;
  quota: number;
  quota_normal: number;
  quota_drink: number;
  quota_table: number;
  quota_female: number | null;
  quota_male: number | null;
  free_before_time: string;
  entry_deadline: string | null;
  includes_drink: boolean;
  visible_on_club_page: boolean;
  entry_kind: string;
};

export default function OwnerEvents() {
  const { t, language } = useLanguage();
  // Helper tri-lingue local pour les libelles de co-organisation cote club.
  // Les 3 fichiers de locales sont en cours d'edition par ailleurs : y ajouter
  // des cles maintenant creerait un conflit pour rien.
  const tl = (frTxt: string, en: string, esTxt: string) =>
    (language === 'en' ? en : language === 'es' ? esTxt : frTxt);
  const navigate = useNavigate();
  const { venueId, organizerUserId, scope, loading: venueLoading } = useVenueContext();
  const { basePath } = useDashboardMode();
  const isOrganizerScope = scope === 'organizer';
  const scopeReady = isOrganizerScope ? !!organizerUserId : !!venueId;
  const { plan, loading: planLoading } = useSubscriptionPlan();
  // Collab read-only / subscription plans are venue concepts — never gate organizers.
  const collabReadOnly = !isOrganizerScope && !planLoading && isCollabPlan(plan);
  // Organizer payments status — selling tickets requires a Stripe account that can charge.
  // Venues handle Stripe elsewhere, so this hook is a no-op (null userId) outside organizer scope.
  const { canSell, status: stripeStatus, loading: stripeLoading } = useOrganizerStripe(isOrganizerScope ? organizerUserId : null);
  // True only when we positively know an organizer cannot yet charge.
  //
  // Cette porte ferme les PILIERS PAYANTS (billets, tables, boissons) — elle ne
  // ferme PAS la publication de la soirée. Une guest list est gratuite : elle
  // n'encaisse rien, donc elle n'a besoin d'aucun compte Stripe pour être en
  // ligne. Une soirée en liste invités seule doit pouvoir être active dans
  // l'app sans que l'organisateur ait branché Stripe.
  const orgSellingBlocked = isOrganizerScope && !stripeLoading && !canSell;
  // Partner clubs the organizer has an active partnership with (used by collab/co-event modes).
  const { partnerships } = useOrganizerPartnerships();
  const activePartnerships = partnerships.filter((p) => p.status === 'active');
  // Miroir côté club : les organisateurs partenaires actifs, pour proposer une
  // co-organisation depuis la fiche soirée — dans les deux sens, pas seulement orga → club.
  const { partnerships: venuePartnerships } = useVenuePartnerships(isOrganizerScope ? undefined : (venueId ?? undefined));
  const activeOrgPartners = venuePartnerships.filter((p) => p.status === 'active');
  const { propose } = useProposeCollab(isOrganizerScope ? 'organizer' : 'venue', isOrganizerScope ? organizerUserId : venueId);
  const [events, setEvents] = useState<OwnerEventRow[]>([]);
  const [view, setView] = useTabParam<'events' | 'recurring'>('events', ['events', 'recurring']);
  const [presets, setPresets] = useState<VenuePreset[]>([]);
  const [guestPresets, setGuestPresets] = useState<GuestPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [posterFile, setPosterFile] = useState<File | null>(null);
  const [posterPreview, setPosterPreview] = useState<string>('');
  // Affiche et logo de lieu d'un ORGANISATEUR : envoyés tels quels jusqu'ici,
  // au clic sur « Publier », une photo d'iPhone comprise. Ils partent
  // maintenant compressés dès le choix du fichier. L'affiche d'un CLUB, elle,
  // dépend du cadre que le pro fait glisser : elle ne peut pas partir avant,
  // mais elle sort recadrée à ~300 Ko, pas à 8 Mo.
  const orgPoster = useDeferredMedia((f) => startOrganizerImageUpload(f, organizerUserId!, 'poster'));
  const locationLogo = useDeferredMedia((f) => startOrganizerImageUpload(f, organizerUserId!, 'venue-logo'));
  const [posterPosition, setPosterPosition] = useState<PosterPosition | null>(null);
  // Vidéo de la page soirée : l'envoi part dès que le fichier est choisi et
  // voyage pendant que le reste du formulaire se remplit, pour que « Publier »
  // n'ait plus 30 Mo à attendre. `videoRemoved` = retrait d'une vidéo en ligne.
  const video = useDeferredMedia(startEventVideoUpload);
  const [videoRemoved, setVideoRemoved] = useState(false);
  const [showArchivedEvents, setShowArchivedEvents] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  // Écran de publication : il ne s'ouvre QUE sur une création — une
  // modification n'a rien à « mettre en ligne », elle a déjà son toast.
  // `publishStage` compte les étapes réellement TERMINÉES côté serveur ; c'est
  // lui seul qui fait avancer l'animation (voir `PublishingOverlay`).
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishStage, setPublishStage] = useState<PublishStage>(0);
  const [publishedEvent, setPublishedEvent] = useState<PublishedEvent | null>(null);
  const publishedIdRef = useRef<string | null>(null);
  const [lineupEntries, setLineupEntries] = useState<LineupEntry[]>([]);
  const [initialLineupEntries, setInitialLineupEntries] = useState<LineupEntry[]>([]);
  // Line-up invité : artistes sans compte Yuno (nom + photo + Instagram).
  const [guestArtists, setGuestArtists] = useState<GuestArtist[]>([]);
  const [formData, setFormData] = useState({
    title: '', description: '', posterUrl: '', videoUrl: '', startAt: '', endAt: '',
    isActive: true, musicGenres: ['Open Format'] as string[], eventType: 'club',
    timezone: PARIS_TIMEZONE,
  });
  // Fuseau par défaut du compte (dérivé de la ville de la venue, éditable par event).
  const [venueTimezone, setVenueTimezone] = useState<string>(PARIS_TIMEZONE);

  // ─── Organizer-only event fields (visibility / collab / secret venue) ──
  const [eventKind, setEventKind] = useState<EventKind>('public_event');
  const [collabMode, setCollabMode] = useState<CollabMode>('solo');
  const [partnerVenueId, setPartnerVenueId] = useState<string>('');
  const [locationName, setLocationName] = useState('');
  const [locationCity, setLocationCity] = useState('');
  const [locationAddress, setLocationAddress] = useState('');
  // Logo du LIEU en texte libre : un endroit qui n'est pas un club Yuno n'a
  // aucune ligne `venues` où poser son identité visuelle.
  const [locationLogoPreview, setLocationLogoPreview] = useState('');
  const [locationIsSecret, setLocationIsSecret] = useState(false);
  // Secret-location reveal: true = address in the booking confirmation email,
  // false = the organizer reveals it via their own scheduled/manual email.
  const [revealAddressInEmail, setRevealAddressInEmail] = useState(true);
  // Minors / alcohol-free: global lives on the venue (owner) or organizer profile.
  // Per-event opt-out is only offered when the global is on.
  const [globalMinorsAllowed, setGlobalMinorsAllowed] = useState(false);
  const [minorsDisabled, setMinorsDisabled] = useState(false);

  // ─── Co-organisation, dans les deux sens ──────────────────────────────────
  // Côté club, le partenaire est un organisateur ; côté organisateur, c'est un club.
  // Le même bloc sert à la création ET à l'édition : proposer une collab « après
  // coup » revient à rouvrir la soirée et à y choisir un partenaire.
  const [partnerOrganizerId, setPartnerOrganizerId] = useState<string>('');
  const [collabResponsibilities, setCollabResponsibilities] = useState<CollabResponsibilities>(
    () => defaultResponsibilities('co_event'));
  // Contrat vivant de la soirée en cours d'édition : tant qu'il existe, le
  // partenaire et le mode sont engagés et ne se rejouent pas depuis ce formulaire.
  const [liveContract, setLiveContract] = useState<{ id: string; status: string } | null>(null);

  const partnerId = isOrganizerScope ? partnerVenueId : partnerOrganizerId;
  const setPartnerId = isOrganizerScope ? setPartnerVenueId : setPartnerOrganizerId;
  const requiresPartner = eventKind === 'public_event' && collabMode !== 'solo'
    && (isOrganizerScope || !collabReadOnly);

  useEffect(() => {
    if (!scopeReady) return;
    if (!isOrganizerScope && planLoading) return; // venues wait for the subscription plan
    fetchEvents();
    fetchPresets();
    fetchGuestPresets();
    const scopeId = isOrganizerScope ? organizerUserId! : venueId!;
    const ownCol = isOrganizerScope ? 'organizer_user_id' : 'venue_id';
    const partnerCol = isOrganizerScope ? 'partner_organizer_id' : 'partner_venue_id';
    const channel = supabase.channel(`events-changes-${scopeId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter: `${ownCol}=eq.${scopeId}` }, () => fetchEvents())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter: `${partnerCol}=eq.${scopeId}` }, () => fetchEvents())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [venueId, organizerUserId, isOrganizerScope, scopeReady, planLoading, plan]);

  // Load the creator's global "minors allowed" setting (venue for owners, profile for organizers).
  useEffect(() => {
    if (!scopeReady) return;
    (async () => {
      if (isOrganizerScope) {
        const { data } = await supabase.from('organizer_profiles').select('minors_allowed, city').eq('user_id', organizerUserId!).maybeSingle();
        setGlobalMinorsAllowed(data?.minors_allowed ?? false);
        setVenueTimezone(cityToTimezone(data?.city));
      } else {
        const { data } = await supabase.from('venues').select('minors_allowed, timezone, city').eq('id', venueId!).maybeSingle();
        setGlobalMinorsAllowed(data?.minors_allowed ?? false);
        setVenueTimezone(data?.timezone || cityToTimezone(data?.city));
      }
    })();
  }, [venueId, organizerUserId, isOrganizerScope, scopeReady]);

  const fetchEvents = async () => {
    if (!scopeReady) return;
    try {
      let query;
      if (isOrganizerScope) {
        query = supabase.from('events').select('*').or(`organizer_user_id.eq.${organizerUserId},partner_organizer_id.eq.${organizerUserId}`).order('start_at', { ascending: false });
      } else {
        const includePartnerLed = !planLoading && !isCollabPlan(plan);
        query = includePartnerLed
          ? supabase.from('events').select('*').or(`venue_id.eq.${venueId},partner_venue_id.eq.${venueId}`).order('start_at', { ascending: false })
          : supabase.from('events').select('*').eq('venue_id', venueId).order('start_at', { ascending: false });
      }
      const { data, error } = await query;
      if (error) throw error;
      const mappedEvents = (data || []).map((event) => ({
        id: event.id, venueId: event.venue_id, partnerVenueId: event.partner_venue_id ?? null, title: event.title,
        description: event.description || undefined,
        posterUrl: event.poster_url || undefined,
        videoUrl: event.video_url || undefined,
        posterPosition: event.poster_position as unknown as PosterPosition | undefined,
        startAt: event.start_at, endAt: event.end_at, timezone: event.timezone,
        isActive: event.is_active,
        createdAt: event.created_at, updatedAt: event.updated_at,
        musicGenres: event.music_genres || [event.music_genre || 'Open Format'],
        eventType: event.event_type || 'club',
        isPartnerHosted: isOrganizerScope ? false : (event.partner_venue_id === venueId && event.venue_id !== venueId && !!event.organizer_user_id),
        isPrivate: isOrganizerScope && (event.event_kind === 'private_event' || event.visibility === 'private'),
        organizerUserId: event.organizer_user_id ?? null,
        ticketingEnabled: event.ticketing_enabled ?? false,
        tablesEnabled: event.tables_enabled ?? false,
        guestListEnabled: false,
        hasGuestList: false,
        ticketsSoldOut: event.tickets_sold_out ?? false,
        tablesSoldOut: event.tables_sold_out ?? false,
        guestListSoldOut: event.guest_list_sold_out ?? false,
        ticketSellingMode: event.ticket_selling_mode || 'rounds',
        roundsCount: 0,
      }));

      // Count ticket rounds per event so the inline toggle knows whether a
      // preset still needs to be applied before publishing.
      const eventIds = mappedEvents.map(e => e.id);
      if (eventIds.length > 0) {
        const { data: roundsData } = await supabase
          .from('ticket_rounds')
          .select('event_id')
          .in('event_id', eventIds);
        const counts: Record<string, number> = {};
        (roundsData || []).forEach(r => { counts[r.event_id] = (counts[r.event_id] || 0) + 1; });
        mappedEvents.forEach(e => { e.roundsCount = counts[e.id] || 0; });

        // Club guest list presence + active state per event (drives the inline toggle).
        // Toutes les parts, pas seulement la maison : l'interrupteur publie la
        // part maison, mais « Complet » doit pouvoir fermer une soirée dont la
        // liste ne vient que des promoteurs ou des DJs.
        const { data: glData } = await supabase
          .from('guest_lists')
          .select('event_id, is_active, holder_type')
          .in('event_id', eventIds);
        const glMap: Record<string, boolean> = {};
        const anyMap: Record<string, boolean> = {};
        (glData || []).forEach(gl => {
          if (gl.holder_type === 'club') glMap[gl.event_id] = gl.is_active;
          if (gl.is_active) anyMap[gl.event_id] = true;
        });
        mappedEvents.forEach(e => {
          e.guestListEnabled = glMap[e.id] ?? false;
          e.hasGuestList = anyMap[e.id] ?? false;
        });
      }

      setEvents(mappedEvents);
    } catch (error) {
      console.error('Error fetching events:', error);
      toast.error(t('owner.toastLoadError'));
    } finally {
      setLoading(false);
    }
  };

  const fetchPresets = async () => {
    if (!scopeReady) return;
    const base = supabase
      .from('ticket_presets')
      .select('id, name, ticket_type, total_capacity, selling_mode, rounds')
      .order('created_at', { ascending: false });
    const { data } = isOrganizerScope
      ? await base.eq('organizer_user_id', organizerUserId!)
      : await base.eq('venue_id', venueId!);
    setPresets((data || []) as VenuePreset[]);
  };

  // Saved club guest-list templates — feed the inline picker that appears when a
  // card publishes its guest list for the first time (default sorted first).
  const fetchGuestPresets = async () => {
    if (!scopeReady) return;
    const base = supabase
      .from('guest_list_templates')
      .select('id, name, is_default, quota, quota_normal, quota_drink, quota_table, quota_female, quota_male, free_before_time, entry_deadline, includes_drink, visible_on_club_page, entry_kind')
      .eq('holder_type', 'club')
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false });
    const { data } = isOrganizerScope
      ? await base.eq('organizer_user_id', organizerUserId!)
      : await base.eq('venue_id', venueId!);
    setGuestPresets((data || []) as GuestPreset[]);
  };


  /**
   * Persiste le line-up via le handshake booking : ajouts directs (profils sans
   * compte) écrits dans event_djs, DJs avec compte notifiés par une demande de
   * booking qu'ils valident depuis leur app — l'acceptation les inscrit à
   * l'affiche. Retourne le résultat pour le diff send-event-update.
   */
  const persistLineup = async (eventId: string) => {
    // Les deux moitiés du line-up écrivent dans des tables différentes
    // (`event_djs` / `dj_booking_requests` d'un côté, `event_guest_artists` de
    // l'autre) : les enchaîner ne faisait qu'additionner deux allers-retours
    // sur le temps que le pro passe à regarder son bouton tourner.
    //
    // Le line-up invité se persiste par DIFF (jamais delete+insert) : chaque
    // ligne porte son compteur de clics Instagram, qu'un réenregistrement de la
    // soirée ne doit pas remettre à zéro.
    const [res, guestRes] = await Promise.all([
      saveLineup({
        eventId,
        eventLocalDate: formData.startAt.slice(0, 10),
        scope: isOrganizerScope ? { organizerUserId } : { venueId },
        entries: lineupEntries,
        initialEntries: initialLineupEntries,
        eventGenres: formData.musicGenres,
      }),
      saveGuestArtists(eventId, guestArtists),
    ]);
    for (const e of guestRes.errors) toast.error(`${e.name} : ${e.message}`);
    if (res.addedDirectIds.length > 0) notifyDjLineup(eventId, res.addedDirectIds);
    if (res.requestsSent > 0) {
      toast.success(
        tl('Demande de booking envoyée', 'Booking request sent', 'Solicitud de booking enviada'),
        { description: tl(
          `${res.requestsSent} DJ rejoindront l'affiche dès qu'ils auront accepté.`,
          `${res.requestsSent} DJ(s) will join the line-up once they accept.`,
          `${res.requestsSent} DJ(s) se unirán al cartel cuando acepten.`,
        ) },
      );
    }
    for (const err of res.errors) {
      toast.error(tl(
        `Demande impossible pour ${err.name}`,
        `Could not send the request for ${err.name}`,
        `No se pudo enviar la solicitud para ${err.name}`,
      ), { description: err.message });
    }
    return res;
  };

  // Organizer event save — visibility (public/private), collab mode, partner club, secret venue, 1:1 poster.
  const saveOrganizerEvent = async (
    { startAtUTC, endAtUTC }: { startAtUTC: string; endAtUTC: string },
    bump: (stage: PublishStage) => void,
  ) => {
    const sanitize = (url: string) => (url && (url.startsWith('blob:') || url.startsWith('data:')) ? '' : url);
    // Les trois médias sont partis au choix du fichier : ici on ne fait plus
    // qu'attendre des promesses presque toujours déjà tenues. Un échec annule
    // l'enregistrement — une soirée qui annonce une affiche ou une vidéo
    // qu'elle n'a pas serait un mensonge silencieux.
    let posterUrl = sanitize(posterPreview);
    let locationLogoUrl = sanitize(locationLogoPreview);
    let videoUrl: string | null = videoRemoved ? null : (formData.videoUrl || null);
    try {
      const [poster, logo, vid] = await Promise.all([orgPoster.settle(), locationLogo.settle(), video.settle()]);
      if (poster) posterUrl = poster;
      if (logo) locationLogoUrl = logo;
      if (vid) videoUrl = vid;
    } catch (err) {
      console.error('Event media upload failed:', err);
      toast.error(t('owner.eventVideo.uploadError'));
      throw err;
    }
    bump(2); // les visuels sont en ligne

    const visibility = eventKind === 'private_event' ? 'private' : 'public';
    const payload: TablesInsert<'events'> = {
      organizer_user_id: organizerUserId,
      title: formData.title.trim(),
      description: formData.description.trim() || null,
      poster_url: posterUrl || null,
      video_url: videoUrl,
      poster_position: posterPosition ? { x: posterPosition.x, y: posterPosition.y, scale: posterPosition.scale } : null,
      start_at: startAtUTC, end_at: endAtUTC, timezone: formData.timezone || PARIS_TIMEZONE,
      location_name: locationName.trim() || null,
      location_city: locationCity.trim() || null,
      location_address: locationAddress.trim() || null,
      location_logo_url: locationLogoUrl || null,
      location_is_secret: (isOrganizerScope && !requiresPartner) ? locationIsSecret : false,
      reveal_address_in_email: (isOrganizerScope && !requiresPartner && locationIsSecret) ? revealAddressInEmail : true,
      is_active: formData.isActive,
      minors_disabled: minorsDisabled,
      music_genres: formData.musicGenres,
      event_type: formData.eventType,
      event_kind: eventKind,
      visibility,
      is_discoverable: eventKind === 'public_event',
      discovery_status: 'approved',
    };
    if (requiresPartner) {
      payload.partner_venue_id = partnerVenueId;
      payload.event_mode = collabMode === 'co_event' ? 'co_event' : collabMode === 'venue_rental' ? 'venue_rental' : 'org_hosted';
    } else {
      payload.partner_venue_id = null;
      payload.event_mode = 'solo_organizer';
    }

    let savedId = editingEvent?.id;
    if (editingEvent) {
      const { error } = await supabase.from('events').update(payload as TablesUpdate<'events'>).eq('id', editingEvent.id);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from('events').insert(payload).select('id').single();
      if (error) throw error;
      savedId = data.id;
    }
    // La soirée pointe maintenant sur ces fichiers : `resetForm()` ne doit plus
    // les retirer du bucket comme il retire un envoi abandonné.
    orgPoster.commit(); locationLogo.commit(); video.commit();
    bump(3); // la ligne `events` existe
    // Le line-up et la demande de collaboration touchent des tables distinctes :
    // elles partent ensemble, la soirée est en ligne quand les deux ont répondu.
    if (savedId) {
      await Promise.all([persistLineup(savedId), proposeIfNeeded(savedId)]);
    }
    bump(4); // line-up, artistes invités et partenaire réglés
    toast.success(editingEvent ? t('owner.toastEventUpdated') : t('owner.toastEventCreated'));
    return savedId;
  };

  /**
   * Ouvre le contrat de collaboration et previent le partenaire, quand la soiree
   * vient d'etre rattachee a quelqu'un et qu'aucun contrat vivant ne la couvre.
   *
   * C'est ce qui manquait : le formulaire posait bien `partner_venue_id` mais
   * n'ouvrait aucun contrat, donc le CONTRACT GUARD laissait `revenue_split_rules`
   * a NULL et la co-soiree ne pouvait rien vendre, sans que le partenaire soit
   * meme prevenu qu'on lui proposait quelque chose.
   */
  const proposeIfNeeded = async (eventId: string | undefined) => {
    if (!eventId || !requiresPartner || !partnerId || liveContract) return;
    const dbMode = collabMode === 'venue_rental' ? 'venue_rental'
      : collabMode === 'hosted_by_venue' ? 'org_hosted' : 'co_event';
    try {
      await propose({ eventId, partnerId, mode: dbMode, responsibilities: collabResponsibilities });
      toast.success(
        tl('Demande de collaboration envoyee', 'Collaboration request sent', 'Solicitud de colaboracion enviada'),
        { description: tl(
          'Ton partenaire doit signer le contrat avant que la billetterie ouvre.',
          'Your partner must sign the contract before ticketing opens.',
          'Tu socio debe firmar el contrato antes de abrir la venta.',
        ) },
      );
    } catch (err) {
      // Echec bloquant a signaler : la soiree est enregistree mais reste sans
      // contrat, donc sans vente possible. Le taire laisserait un co-event muet.
      toast.error((err as { message?: string })?.message
        || tl('La demande de collaboration a echoue', 'The collaboration request failed', 'La solicitud de colaboracion fallo'));
    }
  };

  /** « Toulouse · sam. 26 sept. · 23:00 » — la ligne de la carte de fin. */
  const publishedMeta = () => {
    const tz = formData.timezone || PARIS_TIMEZONE;
    const startUTC = new Date(fromWallClockInTz(formData.startAt, tz));
    return [
      isOrganizerScope ? locationCity.trim() : '',
      formatInTimeZone(startUTC, tz, 'EEE d MMM', { locale: dateLocale }),
      formatInTimeZone(startUTC, tz, 'HH:mm'),
    ].filter(Boolean).join(' · ');
  };

  /**
   * Cinquième et dernière étape : la soirée doit APPARAÎTRE dans la liste avant
   * que l'écran annonce « en ligne ». `fetchEvents()` partait jusqu'ici sans
   * être attendu — l'étape 05 aurait menti d'une demi-seconde.
   *
   * Sur une création, le panneau reste ouvert : c'est la carte de fin qui rend
   * la main (« Voir la page » ou « Fermer »). Sur une modification, rien ne
   * change : on referme comme avant.
   */
  const finishPublish = async (
    { isCreate, id, bump }: { isCreate: boolean; id?: string; bump: (s: PublishStage) => void },
  ) => {
    // Un rafraîchissement de liste qui échoue ne doit PAS faire passer pour
    // ratée une soirée qui est bel et bien créée.
    await fetchEvents().catch((err) => console.error('Event list refresh failed:', err));
    if (isCreate) {
      publishedIdRef.current = id ?? null;
      setPublishedEvent({ title: formData.title.trim(), meta: publishedMeta() });
      bump(5);
      return;
    }
    setIsDialogOpen(false);
    resetForm();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    if (!formData.title || !formData.startAt || !formData.endAt) { toast.error(t('owner.toastFieldsRequired')); return; }
    const parsedStart = new Date(formData.startAt), parsedEnd = new Date(formData.endAt);
    if (isNaN(parsedStart.getTime()) || isNaN(parsedEnd.getTime())) { toast.error(t('owner.toastFieldsRequired')); return; }
    if (parsedEnd <= parsedStart) { toast.error(t('owner.toastEndAfterStart')); return; }
    if (!scopeReady) { toast.error(t('owner.toastVenueNotFound')); return; }
    if (requiresPartner && !partnerId) {
      toast.error(isOrganizerScope
        ? t('owner.ev.selectPartnerClub')
        : tl('Choisis l\'organisateur partenaire.', 'Pick the partner organizer.', 'Elige el organizador socio.'));
      return;
    }
    // Organizer events that define their own location must be placeable in a city
    // (kept even when the location is secret — the city is what filters the event).
    if (isOrganizerScope && !requiresPartner && (!locationName.trim() || !locationCity.trim() || !locationAddress.trim())) {
      toast.error(t('owner.ev.locationRequired')); return;
    }
    setIsSaving(true);
    // Une création se publie derrière l'écran de mise en ligne ; une
    // modification garde son enregistrement discret.
    const isCreate = !editingEvent;
    const bump = (stage: PublishStage) => { if (isCreate) setPublishStage(stage); };
    if (isCreate) {
      publishedIdRef.current = null;
      setPublishedEvent(null);
      setPublishStage(0);
      setPublishOpen(true);
    }
    bump(1); // la soirée est valide : on peut l'écrire
    try {
      // ── Organizer scope: visibility / collab / secret venue (mirrors the org event flow) ──
      if (isOrganizerScope) {
        // `saveOrganizerEvent` a déjà lancé la demande de collaboration en
        // parallèle du line-up : il n'y a plus rien à attendre ici.
        const savedId = await saveOrganizerEvent(
          { startAtUTC: fromWallClockInTz(formData.startAt, formData.timezone), endAtUTC: fromWallClockInTz(formData.endAt, formData.timezone) },
          bump,
        );
        await finishPublish({ isCreate, id: savedId, bump });
        return;
      }
      // L'affiche d'un club se recadre au dernier moment (le cadre bouge tant
      // que le panneau est ouvert), mais elle sort à ~300 Ko. La vidéo, elle,
      // est partie au choix du fichier : on n'attend plus qu'une promesse.
      let posterUrl = formData.posterUrl;
      let videoUrl: string | null = videoRemoved ? null : (formData.videoUrl || null);
      const posterUpload = (posterFile && posterPreview)
        ? (async () => {
            const croppedBlob = await cropToSquare(posterPreview, posterPosition);
            const filePath = `events/${Date.now()}-poster.jpg`;
            const { error: uploadError } = await supabase.storage.from('event-images').upload(filePath, croppedBlob, { contentType: 'image/jpeg' });
            if (uploadError) { toast.error(t('owner.toastPosterUploadError')); return null; }
            return supabase.storage.from('event-images').getPublicUrl(filePath).data.publicUrl;
          })()
        : Promise.resolve(null);
      try {
        const [poster, vid] = await Promise.all([
          posterUpload.catch((err) => { console.error('Poster upload exception:', err); return null; }),
          video.settle(),
        ]);
        if (poster) posterUrl = poster;
        if (vid) videoUrl = vid;
      } catch (err) {
        console.error('Event video upload failed:', err);
        toast.error(t('owner.eventVideo.uploadError'));
        throw err;
      }
      bump(2); // les visuels sont en ligne
      const startAtUTC = fromWallClockInTz(formData.startAt, formData.timezone);
      const endAtUTC = fromWallClockInTz(formData.endAt, formData.timezone);
      let savedId = editingEvent?.id;
      if (editingEvent) {
        const { error } = await supabase.from('events').update({
          title: formData.title, description: formData.description || null,
          poster_url: posterUrl || null,
          video_url: videoUrl,
          poster_position: posterPosition ? { x: posterPosition.x, y: posterPosition.y, scale: posterPosition.scale } : null,
          start_at: startAtUTC, end_at: endAtUTC, timezone: formData.timezone || PARIS_TIMEZONE, is_active: formData.isActive,
          venue_id: venueId, minors_disabled: minorsDisabled, music_genres: formData.musicGenres, event_type: formData.eventType,
        }).eq('id', editingEvent.id);
        if (error) throw error;
        video.commit(); // le fichier a servi : plus un envoi abandonné à nettoyer
        bump(3);
        const oldDjIds = initialLineupEntries.filter(e => e.status === 'confirmed').map(e => e.djId).sort();
        const [lineupRes] = await Promise.all([persistLineup(editingEvent.id), proposeIfNeeded(editingEvent.id)]);
        bump(4);
        const newDjIdsSorted = [...lineupRes.directIds].sort();
        const djsChanged = JSON.stringify(oldDjIds) !== JSON.stringify(newDjIdsSorted);
        const timeChanged = new Date(editingEvent.startAt).toISOString() !== startAtUTC || new Date(editingEvent.endAt).toISOString() !== endAtUTC;
        const descChanged = (editingEvent.description || '') !== (formData.description || '');
        if (timeChanged || djsChanged || descChanged) {
          const changes: Record<string, { old: string; new: string }> = {};
          if (new Date(editingEvent.startAt).toISOString() !== startAtUTC) changes.start_at = { old: new Date(editingEvent.startAt).toISOString(), new: startAtUTC };
          if (new Date(editingEvent.endAt).toISOString() !== endAtUTC) changes.end_at = { old: new Date(editingEvent.endAt).toISOString(), new: endAtUTC };
          if (djsChanged) changes.dj_lineup = { old: oldDjIds.join(','), new: newDjIdsSorted.join(',') };
          if (descChanged) changes.conditions = { old: editingEvent.description || '', new: formData.description || '' };
          supabase.functions.invoke('send-event-update', { body: { event_id: editingEvent.id, changes } }).catch(err => console.error(err));
        }
        toast.success(t('owner.toastEventUpdated'));
      } else {
        const { data: newEvent, error } = await supabase.from('events').insert({
          title: formData.title, description: formData.description || null,
          poster_url: posterUrl || null,
          video_url: videoUrl,
          poster_position: posterPosition ? { x: posterPosition.x, y: posterPosition.y, scale: posterPosition.scale } : null,
          start_at: startAtUTC, end_at: endAtUTC, timezone: formData.timezone || PARIS_TIMEZONE, is_active: formData.isActive,
          venue_id: venueId, minors_disabled: minorsDisabled, music_genres: formData.musicGenres, event_type: formData.eventType,
        }).select('id').single();
        if (error) throw error;
        video.commit(); // le fichier a servi : plus un envoi abandonné à nettoyer
        bump(3);
        savedId = newEvent?.id;
        await Promise.all([
          (newEvent && (lineupEntries.length > 0 || guestArtists.length > 0))
            ? persistLineup(newEvent.id)
            : Promise.resolve(),
          proposeIfNeeded(newEvent?.id),
        ]);
        bump(4);
        toast.success(t('owner.toastEventCreated'));
      }
      await finishPublish({ isCreate, id: savedId, bump });
    } catch (error) {
      console.error('Error saving event:', error);
      // L'écran de publication se retire : le message d'erreur doit être lisible,
      // et il ne faut surtout pas laisser un compteur figé à 60 % à l'écran.
      setPublishOpen(false);
      toast.error(t('owner.toastSaveError'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('owner.confirmDeleteEvent'))) return;
    try {
      const { error } = await supabase.from('events').delete().eq('id', id);
      if (error) throw error;
      toast.success(t('owner.toastEventDeleted'));
      fetchEvents();
    } catch (error) { toast.error(t('owner.toastDeleteError')); }
  };

  const handleToggleActive = async (event: Event) => {
    try {
      const { error } = await supabase.from('events').update({ is_active: !event.isActive }).eq('id', event.id);
      if (error) throw error;
      toast.success(event.isActive ? t('owner.toastEventDeactivated') : t('owner.toastEventActivated'));
      fetchEvents();
    } catch (error) { toast.error(t('owner.toastToggleError')); }
  };

  // ─── Inline ticketing / tables publishing (avoids tab navigation) ──────────
  // Returns false when activation needs a table plan first (no bookable inventory),
  // so the card routes the user to the table setup instead of flipping a dead flag.
  const handleToggleTables = async (event: OwnerEventRow): Promise<boolean> => {
    // Mettre des tables en vente encaisse de l'argent, exactement comme les
    // billets : sans compte Stripe capable de charger, le client atteindrait un
    // checkout qui ne peut rien collecter. Retirer la vente reste toujours permis.
    if (!event.tablesEnabled && orgSellingBlocked) {
      toast.error(
        stripeStatus === 'pending'
          ? t('owner.ev.stripePendingToast')
          : t('owner.ev.stripeNotConfiguredToast'),
        { action: { label: t('owner.ev.configure'), onClick: () => navigate(`${basePath}/payments`) } }
      );
      return true; // handled — don't route to the table setup
    }
    try {
      // Turning sales OFF is always allowed.
      if (event.tablesEnabled) {
        const { error } = await supabase.from('events').update({ tables_enabled: false }).eq('id', event.id);
        if (error) throw error;
        toast.success(t('owner.ev.tablesRemoved'));
        fetchEvents();
        return true;
      }
      // Turning ON requires bookable inventory, else clients reach an empty tables tab.
      if (isOrganizerScope) {
        // Organizer events use event-scoped zones/packs (OrgEventTablesPanel).
        const { count } = await supabase
          .from('table_packs').select('id', { count: 'exact', head: true }).eq('event_id', event.id);
        if (!count) return false; // caller routes to the event's table setup
        const { error } = await supabase.from('events').update({
          tables_enabled: true, tables_mode: 'basic', tables_owner_user_id: organizerUserId,
        }).eq('id', event.id);
        if (error) throw error;
      } else {
        // Venue events are configured via presets (event_table_settings) or event-scoped packs.
        const [{ count: packCount }, { count: settingCount }] = await Promise.all([
          supabase.from('table_packs').select('id', { count: 'exact', head: true }).eq('event_id', event.id),
          supabase.from('event_table_settings').select('id', { count: 'exact', head: true }).eq('event_id', event.id),
        ]);
        if (!packCount && !settingCount) return false; // caller routes to /owner/tables
        const { error } = await supabase.from('events').update({ tables_enabled: true }).eq('id', event.id);
        if (error) throw error;
      }
      toast.success(t('owner.ev.tablesOnlineToast'));
      fetchEvents();
      return true;
    } catch { toast.error(t('owner.toastSaveError')); return true; }
  };

  // Toggle the club guest list. Returns false when activation needs a template (no
  // list created yet) so the card opens its inline picker — we never silently spin
  // up a list with guessed quotas. ON (existing): reactivate. OFF: deactivate.
  const handleToggleGuestList = async (event: OwnerEventRow): Promise<boolean> => {
    try {
      const { data: existing } = await supabase.from('guest_lists')
        .select('id, is_active').eq('event_id', event.id).eq('holder_type', 'club').maybeSingle();
      if (!existing) return false; // caller opens the inline guest-list picker
      const { error } = await supabase.from('guest_lists').update({ is_active: !existing.is_active }).eq('id', existing.id);
      if (error) throw error;
      toast.success(existing.is_active ? t('owner.ev.guestListRemoved') : t('owner.ev.guestListOnline'));
      fetchEvents();
      return true;
    } catch { toast.error(t('owner.toastSaveError')); return true; }
  };

  // Create the club guest list from a chosen template, then publish it — all inline.
  const handleApplyGuestListPresetAndPublish = async (event: OwnerEventRow, tpl: GuestPreset) => {
    try {
      // Guard against a race where a list was created between toggle and publish.
      const { data: existing } = await supabase.from('guest_lists')
        .select('id').eq('event_id', event.id).eq('holder_type', 'club').maybeSingle();
      if (existing) {
        const { error } = await supabase.from('guest_lists').update({ is_active: true }).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('guest_lists').insert({
          event_id: event.id,
          // Co-soirée org-led : venue_id est NULL, le club physique est
          // partner_venue_id — sans le fallback, le scan en ligne du videur
          // du club ne retrouve pas la part (« Billet introuvable »).
          venue_id: isOrganizerScope ? (event.venueId ?? event.partnerVenueId ?? null) : venueId,
          organizer_user_id: isOrganizerScope ? organizerUserId : null,
          holder_type: 'club',
          is_active: true,
          quota: tpl.quota,
          quota_normal: tpl.quota_normal,
          quota_drink: tpl.quota_drink,
          quota_table: tpl.quota_table,
          quota_female: tpl.quota_female,
          quota_male: tpl.quota_male,
          free_before_time: tpl.free_before_time,
          entry_deadline: tpl.entry_deadline,
          includes_drink: tpl.includes_drink,
          visible_on_club_page: tpl.visible_on_club_page,
          entry_kind: tpl.entry_kind,
        });
        if (error) throw error;
      }
      toast.success(t('owner.ev.guestListOnline'));
      fetchEvents();
    } catch { toast.error(t('owner.toastSaveError')); }
  };

  // Toggle ticketing. Returns false when activation needs a preset (no rounds yet)
  // so the card can open its inline preset picker instead.
  // « Complet » d'un pilier, depuis la fiche de la soirée. Ce n'est PAS la
  // bascule de vente juste au-dessus : la billetterie / les tables / la liste
  // restent en ligne et affichées, elles ne se vendent plus. Réversible d'un clic
  // (aucun palier refermé, aucune formule désactivée), et le réglage fin
  // (formule par formule, part par part) vit dans les pages Tables et Guest list.
  const handleToggleSoldOut = async (event: OwnerEventRow, pillar: 'tickets' | 'tables' | 'guestList') => {
    const column = pillar === 'tickets' ? 'tickets_sold_out' : pillar === 'tables' ? 'tables_sold_out' : 'guest_list_sold_out';
    const current = pillar === 'tickets' ? !!event.ticketsSoldOut : pillar === 'tables' ? !!event.tablesSoldOut : !!event.guestListSoldOut;
    const next = !current;
    try {
      const { error } = await supabase.from('events').update({ [column]: next } as TablesUpdate<'events'>).eq('id', event.id);
      if (error) throw error;
      setEvents(prev => prev.map(e => e.id === event.id
        ? { ...e, ...(pillar === 'tickets' ? { ticketsSoldOut: next } : pillar === 'tables' ? { tablesSoldOut: next } : { guestListSoldOut: next }) }
        : e));
      toast.success(next ? t('soldOut.marked') : t('soldOut.cleared'));
    } catch (e) {
      console.error('Error toggling sold out:', e);
      toast.error(t('owner.ev.saveError'));
    }
  };

  const handleToggleTicketing = async (event: OwnerEventRow): Promise<boolean> => {
    // Putting tickets on sale requires the organizer's Stripe account to be able to charge,
    // otherwise buyers reach a checkout that cannot collect money. Turning sales OFF is always allowed.
    if (!event.ticketingEnabled && orgSellingBlocked) {
      toast.error(
        stripeStatus === 'pending'
          ? t('owner.ev.stripePendingToast')
          : t('owner.ev.stripeNotConfiguredToast'),
        { action: { label: t('owner.ev.configure'), onClick: () => navigate(`${basePath}/payments`) } }
      );
      return true; // handled — don't open the inline preset panel
    }
    if (!event.ticketingEnabled && (event.roundsCount ?? 0) === 0) {
      return false; // caller opens the inline preset panel
    }
    try {
      const { error } = await supabase.from('events').update({ ticketing_enabled: !event.ticketingEnabled }).eq('id', event.id);
      if (error) throw error;
      toast.success(event.ticketingEnabled ? t('owner.ev.ticketingRemovedToast') : t('owner.ev.ticketingOnlineToast'));
      fetchEvents();
    } catch { toast.error(t('owner.toastSaveError')); }
    return true;
  };

  // Apply a ticket preset to an event then publish ticketing — all inline.
  const handleApplyPresetAndPublish = async (event: OwnerEventRow, preset: VenuePreset) => {
    if (orgSellingBlocked) {
      toast.error(
        stripeStatus === 'pending'
          ? t('owner.ev.stripePendingToast')
          : t('owner.ev.stripeNotConfiguredToast'),
        { action: { label: t('owner.ev.configure'), onClick: () => navigate(`${basePath}/payments`) } }
      );
      return;
    }
    try {
      const sellingMode = preset.selling_mode || 'rounds';
      const rounds = (preset.rounds as PresetRound[] | null) || [];
      if (rounds.length === 0) { toast.error(t('owner.ev.presetNoRounds')); return; }

      // Fresh start: remove any existing rounds of this ticket type.
      const { data: existing } = await supabase.from('ticket_rounds').select('id, ticket_type').eq('event_id', event.id);
      const toDelete = (existing || []).filter(r => (r.ticket_type || 'standard') === preset.ticket_type).map(r => r.id);
      if (toDelete.length > 0) await supabase.from('ticket_rounds').delete().in('id', toDelete);

      const toInsert = rounds.map((r, index) => ({
        event_id: event.id,
        name: r.name,
        price: r.price,
        max_tickets: sellingMode === 'simple' ? 999999 : r.maxTickets,
        last_tickets_threshold: r.lastTicketsThreshold ?? 20,
        position: index,
        is_active: sellingMode === 'simple' ? true : index === 0,
        auto_activate: sellingMode !== 'timed_entry' && sellingMode !== 'simple',
        ticket_type: preset.ticket_type,
        includes_drink: r.includesDrink ?? false,
        drink_deadline_type: r.includesDrink ? 'fixed_time' : 'none',
        drink_cutoff_time: r.includesDrink ? '02:00' : null,
        entry_deadline: r.entryDeadline ? r.entryDeadline + ':00' : null,
      }));
      const { error: insErr } = await supabase.from('ticket_rounds').insert(toInsert);
      if (insErr) throw insErr;

      const update: TablesUpdate<'events'> = { ticketing_enabled: true, ticket_selling_mode: sellingMode };
      if (sellingMode === 'simple' && preset.total_capacity) update.max_tickets = preset.total_capacity;
      const { error: evErr } = await supabase.from('events').update(update).eq('id', event.id);
      if (evErr) throw evErr;

      toast.success(t('owner.ev.ticketingOnlineToast'));
      fetchEvents();
    } catch (err) {
      console.error('Error applying preset:', err);
      toast.error(t('owner.toastSaveError'));
    }
  };

  // Ouverture directe d'une soirée depuis un lien externe (?edit=<id>) — le
  // tableau de bord collab y renvoie pour l'outil « Infos & affiche ». Un seul
  // déclenchement : sans le drapeau, refermer la modale la rouvrirait aussitôt.
  const editParamDone = useRef(false);
  useEffect(() => {
    if (editParamDone.current || !events.length) return;
    const wanted = new URLSearchParams(window.location.search).get('edit');
    if (!wanted) return;
    const found = events.find((e) => e.id === wanted);
    if (!found) return;
    editParamDone.current = true;
    handleEdit(found as never);
  }, [events]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEdit = async (event: Event & { posterPosition?: PosterPosition }) => {
    setEditingEvent(event);
    setPosterPreview(event.posterUrl || '');
    setPosterPosition(event.posterPosition || null);
    video.reset(); orgPoster.reset(); locationLogo.reset(); setVideoRemoved(false);
    const eventTz = getEventTimezone(event);
    setFormData({
      title: event.title, description: event.description || '', posterUrl: event.posterUrl || '', videoUrl: event.videoUrl || '',
      startAt: toWallClockInputInTz(event.startAt, eventTz),
      endAt: toWallClockInputInTz(event.endAt, eventTz),
      isActive: event.isActive,
      musicGenres: (event as Event & { musicGenres?: string[] }).musicGenres || ['Open Format'],
      eventType: (event as Event & { eventType?: string }).eventType || 'club',
      timezone: eventTz,
    });
    const entries = await loadLineupEntries(event.id);
    setLineupEntries(entries);
    setInitialLineupEntries(entries);
    setGuestArtists(await loadGuestArtists(event.id));
    const { data: mdRow } = await supabase.from('events').select('minors_disabled').eq('id', event.id).maybeSingle();
    setMinorsDisabled(mdRow?.minors_disabled ?? false);
    // Contrat vivant + rattachement courant : c'est ce qui permet de proposer une
    // collab APRÈS coup (rouvrir la soirée et choisir un partenaire) tout en
    // verrouillant l'édition dès qu'un contrat est engagé.
    setLiveContract(await fetchLiveEventContract(event.id));
    if (!isOrganizerScope) {
      const { data: ev } = await supabase
        .from('events')
        .select('partner_organizer_id, event_mode, collab_responsibilities')
        .eq('id', event.id)
        .maybeSingle();
      const partner = (ev as { partner_organizer_id?: string | null } | null)?.partner_organizer_id || '';
      setPartnerOrganizerId(partner);
      const m = ((ev as { event_mode?: string | null } | null)?.event_mode) || '';
      setCollabMode(!partner ? 'solo' : m === 'venue_rental' ? 'venue_rental' : m === 'org_hosted' ? 'hosted_by_venue' : 'co_event');
      setCollabResponsibilities(normalizeResponsibilities(ev?.collab_responsibilities, m || 'co_event'));
    }
    if (isOrganizerScope) {
      const { data: ev } = await supabase
        .from('events')
        .select('event_kind, partner_venue_id, event_mode, collab_responsibilities, location_name, location_city, location_address, location_logo_url, location_is_secret')
        .eq('id', event.id)
        .maybeSingle();
      if (ev) {
        setCollabResponsibilities(normalizeResponsibilities(ev.collab_responsibilities, (ev.event_mode as string) || 'co_event'));
        setEventKind((ev.event_kind as string) === 'private_event' ? 'private_event' : 'public_event');
        setPartnerVenueId(ev.partner_venue_id || '');
        if (ev.partner_venue_id) {
          const m = (ev.event_mode as string) || '';
          setCollabMode(m === 'venue_rental' ? 'venue_rental' : (m === 'org_hosted' || m === 'hosted_by_venue') ? 'hosted_by_venue' : 'co_event');
        } else {
          setCollabMode('solo');
        }
        setLocationName(ev.location_name || '');
        setLocationCity(ev.location_city || '');
        setLocationAddress(ev.location_address || '');
        setLocationLogoPreview(ev.location_logo_url || '');
        setLocationIsSecret(!!ev.location_is_secret);
        // reveal_address_in_email n'est pas dans le select : undefined → true (comportement historique conservé).
        setRevealAddressInEmail((ev as Partial<Tables<'events'>>).reveal_address_in_email !== false);
      }
    }
    setIsDialogOpen(true);
  };

  const resetForm = () => {
    setEditingEvent(null); setPosterFile(null); setPosterPreview(''); setPosterPosition(null); orgPoster.reset(); video.reset(); setVideoRemoved(false); setLineupEntries([]); setInitialLineupEntries([]); setGuestArtists([]);
    setFormData({ title: '', description: '', posterUrl: '', videoUrl: '', startAt: '', endAt: '', isActive: true, musicGenres: ['Open Format'], eventType: 'club', timezone: venueTimezone });
    setEventKind('public_event'); setCollabMode('solo'); setPartnerVenueId(''); setPartnerOrganizerId('');
    setCollabResponsibilities(defaultResponsibilities('co_event')); setLiveContract(null);
    setLocationName(''); setLocationCity(''); setLocationAddress(''); locationLogo.reset(); setLocationLogoPreview(''); setLocationIsSecret(false); setRevealAddressInEmail(true); setMinorsDisabled(false);
  };

  const handlePosterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPosterFile(file);
      // Chez un organisateur l'affiche part telle quelle : son envoi peut
      // démarrer tout de suite. Chez un club elle attend le recadrage.
      if (isOrganizerScope) orgPoster.pick(file);
      const reader = new FileReader();
      reader.onloadend = () => setPosterPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const upcomingEvents = events.filter(e => toParisTime(e.endAt) >= nowInParis());
  const pastEvents = events.filter(e => toParisTime(e.endAt) < nowInParis());

  // Group upcoming events by their Paris-time calendar day so a busy dashboard
  // reads day-by-day (Today → Tomorrow → later) instead of one long flat run.
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const upcomingByDay: { key: string; date: Date; events: Event[] }[] = (() => {
    const map = new Map<string, Event[]>();
    for (const ev of upcomingEvents) {
      const key = formatInTimeZone(new Date(ev.startAt), PARIS_TIMEZONE, 'yyyy-MM-dd');
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ev);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b)) // soonest day first
      .map(([key, evs]) => ({
        key,
        date: new Date(evs[0].startAt),
        events: [...evs].sort((x, y) => new Date(x.startAt).getTime() - new Date(y.startAt).getTime()),
      }));
  })();
  const todayKey = formatInTimeZone(new Date(), PARIS_TIMEZONE, 'yyyy-MM-dd');
  const tomorrowKey = formatInTimeZone(new Date(Date.now() + 86_400_000), PARIS_TIMEZONE, 'yyyy-MM-dd');
  const currentYear = formatInTimeZone(new Date(), PARIS_TIMEZONE, 'yyyy');
  const dayHeaderLabel = (key: string, date: Date): string => {
    if (key === todayKey) return t('owner.today');
    if (key === tomorrowKey) return t('owner.tomorrow');
    const fmt = formatInTimeZone(date, PARIS_TIMEZONE, 'yyyy') === currentYear ? 'EEEE d MMMM' : 'EEEE d MMMM yyyy';
    const s = formatInTimeZone(date, PARIS_TIMEZONE, fmt, { locale: dateLocale });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  if (loading || venueLoading) return <OwnerPageSkeleton />;

  return (
    <div className={isOrganizerScope ? 'pb-28' : 'min-h-screen pb-28'} style={isOrganizerScope ? undefined : { background: 'var(--sf-000000)' }}>
      {!isOrganizerScope && (
        <div className="fixed inset-0 pointer-events-none z-0"
          style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgb(var(--ink)/.025),transparent 55%)' }} />
      )}

      {!isOrganizerScope && <OwnerHeader title={t('owner.eventsTitle')} />}

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 pt-2 space-y-4">
        {isOrganizerScope && (
          <h1 style={{ color: T1, fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em', marginTop: 4 }}>{t('owner.eventsTitle')}</h1>
        )}
        {collabReadOnly && <CollabActivateBanner />}
        {collabReadOnly && <CollabReadOnlyBanner action={t('collab.action.createEvent')} />}

        {/* Bandeau informatif : la soirée et sa guest list peuvent partir en ligne
            dès maintenant. Seuls les piliers payants attendent Stripe — d'où le
            ton neutre plutôt que l'alerte rouge d'un blocage. */}
        {orgSellingBlocked && (
          <div
            className="flex items-center gap-3 rounded-xl px-4 py-3"
            style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.26)' }}
          >
            <Lock className="w-4 h-4 shrink-0" style={{ color: 'var(--acc-f59e0b)' }} />
            <p className="text-[12.5px] flex-1" style={{ color: T1 }}>
              {stripeStatus === 'pending'
                ? t('owner.ev.stripePendingBanner')
                : t('owner.ev.stripeNotConfiguredBanner')}
            </p>
            <button
              onClick={() => navigate(`${basePath}/payments`)}
              className="text-[12.5px] font-medium px-3 py-1.5 rounded-lg cursor-pointer shrink-0"
              style={{ background: 'rgba(245,158,11,0.16)', border: '1px solid rgba(245,158,11,0.32)', color: 'rgb(var(--ink))' }}
            >
              {t('owner.ev.configure')}
            </button>
          </div>
        )}

        {/* View switcher: events / recurring (recurring works for both venues and organizers) */}
        <div className="inline-flex p-1 rounded-xl" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
          {([['events', t('owner.ev.tabEvents'), Calendar], ['recurring', t('owner.ev.tabRecurring'), RefreshCw]] as const).map(([key, label, Icon]) => {
            const active = view === key;
            return (
              <button
                key={key}
                onClick={() => setView(key)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12.5px] font-medium cursor-pointer transition-all duration-150"
                style={active
                  ? { background: 'rgba(232,25,44,0.14)', border: '1px solid rgba(232,25,44,0.32)', color: 'rgb(var(--ink))' }
                  : { background: 'transparent', border: '1px solid transparent', color: T3 }}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            );
          })}
        </div>

        {view === 'recurring' && (
          <RecurringEventsManager
            venueId={isOrganizerScope ? null : venueId}
            organizerUserId={isOrganizerScope ? organizerUserId : null}
            onEventsChanged={fetchEvents}
          />
        )}

        {view === 'events' && (<>
        {/* Header row */}
        <div className="flex items-center justify-between">
          <div>
            <h2 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>{t('owner.ev.myEvents')}</h2>
            <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>
              {t('owner.ev.eventCounts')
                .replace('{upcoming}', String(upcomingEvents.length))
                .replace('{past}', String(pastEvents.length))}
            </p>
          </div>
          {collabReadOnly ? (
            <button
              onClick={() => toast.info(t('owner.ev.collabDemoToast'))}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium cursor-not-allowed opacity-60"
              style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}
            >
              <Lock className="w-3.5 h-3.5" />
              {t('owner.newEvent')}
            </button>
          ) : (
            <button
              onClick={() => setIsDialogOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold cursor-pointer transition-all duration-150"
              style={{ background: RED, color: '#fff', boxShadow: `0 0 20px -6px ${RED}88` }}
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">{t('owner.newEvent')}</span>
            </button>
          )}
        </div>

        {/* Empty state */}
        {upcomingEvents.length === 0 && pastEvents.length === 0 && (
          <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW }}>
            <div className="text-center py-16 px-4">
              <Calendar className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgb(var(--ink)/0.12)' }} />
              <p style={{ color: T3, fontSize: 13 }}>{t('owner.noEventsOwner')}</p>
            </div>
          </div>
        )}

        {/* Upcoming events — grouped by day for readability */}
        {upcomingEvents.length > 0 && (
          <div className="space-y-5">
            <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{t('owner.ev.upcoming')}</p>
            {upcomingByDay.map((group) => (
              <div key={group.key} className="space-y-3">
                {/* Day header */}
                <div className="flex items-center gap-3">
                  <span style={{ color: T2, fontSize: 12.5, fontWeight: 600, letterSpacing: '-0.01em' }}>
                    {dayHeaderLabel(group.key, group.date)}
                  </span>
                  <span style={{ flex: 1, height: 1, background: F_BORDER }} />
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold"
                    style={{ background: C_FAINT, color: T3 }}>
                    {group.events.length}
                  </span>
                </div>
                {group.events.map((event, i) => (
                  <motion.div
                    key={event.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                  >
                    <EventCard
                      event={event}
                      onEdit={() => handleEdit(event)}
                      onDelete={() => handleDelete(event.id)}
                      onToggle={() => handleToggleActive(event)}
                      onToggleTicketing={() => handleToggleTicketing(event)}
                      onToggleTables={() => handleToggleTables(event)}
                      onToggleGuestList={() => handleToggleGuestList(event)}
                      onToggleSoldOut={(pillar) => handleToggleSoldOut(event, pillar)}
                      onApplyPreset={(preset) => handleApplyPresetAndPublish(event, preset)}
                      onApplyGuestListPreset={(tpl) => handleApplyGuestListPresetAndPublish(event, tpl)}
                      presets={presets}
                      guestPresets={guestPresets}
                      onNavigate={navigate}
                      onDetails={isOrganizerScope ? () => navigate(`${basePath}/events/${event.id}`) : undefined}
                      basePath={basePath}
                      t={t}
                      ownerKind={isOrganizerScope ? 'organizer' : 'venue'}
                      venueId={isOrganizerScope ? null : venueId}
                      organizerUserId={isOrganizerScope ? organizerUserId : null}
                    />
                  </motion.div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Past events */}
        {pastEvents.length > 0 && (
          <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, overflow: 'hidden' }}>
            <button
              className="w-full flex items-center justify-between px-5 py-4 cursor-pointer transition-colors duration-150"
              onClick={() => setShowArchivedEvents(!showArchivedEvents)}
              style={{ background: 'transparent' }}
            >
              <div className="flex items-center gap-2.5">
                <Archive className="w-4 h-4" style={{ color: T3 }} />
                <span style={{ color: T2, fontSize: 13.5, fontWeight: 560 }}>{t('owner.pastEvents')}</span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold"
                  style={{ background: C_FAINT, color: T3 }}>
                  {pastEvents.length}
                </span>
              </div>
              {showArchivedEvents
                ? <ChevronUp className="w-4 h-4" style={{ color: T3 }} />
                : <ChevronDown className="w-4 h-4" style={{ color: T3 }} />
              }
            </button>
            <AnimatePresence>
              {showArchivedEvents && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="px-4 pb-4 space-y-2 overflow-hidden"
                  style={{ borderTop: `1px solid ${F_BORDER}` }}
                >
                  {pastEvents.map((event) => (
                    <div key={event.id} className="flex items-center gap-3 py-2.5 opacity-50">
                      {event.posterUrl && (
                        <img src={event.posterUrl} alt={event.title} className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p style={{ color: T1, fontSize: 13, fontWeight: 560 }} className="truncate">{event.title}</p>
                        <p style={{ color: T3, fontSize: 11.5 }}>
                          {formatInTimeZone(new Date(event.startAt), PARIS_TIMEZONE, 'dd MMM yyyy', { locale: fr })}
                        </p>
                      </div>
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
        </>)}
      </div>

      {/* Create/Edit dialog */}
      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          // Tant que l'écriture est en cours, Échap et le clic extérieur ne
          // ferment rien. Une fois la cinquième étape passée, on rend la main :
          // laisser quelqu'un coincé devant une carte de fin serait pire que
          // de le laisser sortir.
          if (publishOpen && publishStage < 5) return;
          if (!open) { setPublishOpen(false); setIsDialogOpen(false); resetForm(); } else setIsDialogOpen(true);
        }}
      >
        {/* Le dialogue ne défile plus lui-même : c'est son contenu qui défile,
            pour que l'écran de publication (`position: absolute; inset: 0`)
            recouvre exactement la carte visible et non toute la hauteur du
            formulaire déroulé. */}
        <DialogContent className="border-0 p-0 max-h-[90vh]"
          data-action-busy={publishOpen && publishStage < 5 ? '1' : undefined}
          style={{ background: 'var(--sf-0a0a0c)', border: `1px solid ${BORDER}`, borderRadius: 18, maxWidth: 600,
                   display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="flex-1 min-h-0 overflow-y-auto" style={{
          transition: 'filter .6s cubic-bezier(.16,1,.3,1), transform .6s cubic-bezier(.16,1,.3,1), opacity .5s ease',
          filter: publishOpen ? 'blur(10px)' : 'none',
          transform: publishOpen ? 'scale(.98)' : 'none',
          opacity: publishOpen ? 0.4 : 1,
        }}>
          <DialogHeader className="px-6 pt-6 pb-0">
            <DialogTitle style={{ color: T1, fontSize: 15.5, fontWeight: 600 }}>
              {editingEvent ? t('owner.editEvent') : t('owner.createEvent')}
            </DialogTitle>
            <DialogDescription className="sr-only">{editingEvent ? t('owner.editEvent') : t('owner.createEvent')}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {/* Title */}
            <div>
              <FieldLabel>{t('owner.eventTitleLabel')}</FieldLabel>
              <DarkInput value={formData.title} onChange={v => setFormData({ ...formData, title: v })} placeholder={t('owner.eventTitlePlaceholder')} required />
            </div>

            {/* Description */}
            <div>
              <FieldLabel>{t('owner.descriptionLabel')}</FieldLabel>
              <DarkTextarea value={formData.description} onChange={v => setFormData({ ...formData, description: v })} placeholder={t('owner.descriptionPlaceholder')} rows={3} />
            </div>

            {/* Poster — single 1:1 square photo */}
            <div>
              <FieldLabel>{t('owner.eventPosterLabel')}</FieldLabel>
              <p style={{ color: T3, fontSize: 11.5, marginBottom: 8 }}>{t('owner.eventPosterDesc')}</p>
              {posterPreview ? (
                <PosterCropper
                  imageUrl={posterPreview}
                  initialPosition={posterPosition || undefined}
                  onPositionChange={setPosterPosition}
                  onRemove={() => { setPosterFile(null); orgPoster.pick(null); setPosterPreview(''); setPosterPosition(null); setFormData({ ...formData, posterUrl: '' }); }}
                />
              ) : (
                <div className="space-y-2">
                  <div className="flex items-start gap-2 p-3 rounded-xl" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                    <Info className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: T3 }} />
                    <div>
                      <p style={{ color: T1, fontSize: 12, fontWeight: 560, marginBottom: 2 }}>{t('posterCropper.format')}</p>
                      <p style={{ color: T3, fontSize: 11.5 }}>{t('owner.ev.recommendedLabel')} <span style={{ color: T2 }}>1080 × 1080 px</span></p>
                    </div>
                  </div>
                  <input id="poster" type="file" accept="image/*" onChange={handlePosterChange} className="hidden" />
                  <button
                    type="button"
                    onClick={() => document.getElementById('poster')?.click()}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-medium cursor-pointer transition-all duration-150"
                    style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}
                  >
                    <Upload className="w-4 h-4" />
                    {t('owner.addPoster')}
                  </button>
                </div>
              )}
            </div>

            {/* Vidéo 9:16 — page de la soirée uniquement, l'affiche reste partout ailleurs */}
            <EventVideoField
              existingUrl={videoRemoved ? '' : formData.videoUrl}
              file={video.file}
              uploading={video.uploading}
              onFileChange={(f) => { video.pick(f); if (f) setVideoRemoved(false); }}
              onRemoveExisting={() => setVideoRemoved(true)}
            />

            {/* Music genres */}
            <EventGenrePicker
              selectedGenres={formData.musicGenres}
              onToggleGenre={(g) => {
                const selected = formData.musicGenres.includes(g);
                const newGenres = selected ? formData.musicGenres.filter(x => x !== g) : [...formData.musicGenres, g];
                setFormData({ ...formData, musicGenres: newGenres.length > 0 ? newGenres : [g] });
              }}
            />

            {/* Event type */}
            <div>
              <FieldLabel>
                <Tag className="w-3 h-3 inline mr-1" />
                {t('owner.eventType')}
              </FieldLabel>
              <div className="relative">
                <select
                  value={formData.eventType}
                  onChange={e => setFormData({ ...formData, eventType: e.target.value })}
                  className="w-full appearance-none px-3 py-2.5 rounded-xl text-[13px] cursor-pointer"
                  style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, outline: 'none' }}
                >
                  <option value="club" style={{ background: 'var(--sf-0a0a0c)' }}>Club</option>
                  <option value="after_party" style={{ background: 'var(--sf-0a0a0c)' }}>After Party</option>
                  <option value="beach_club" style={{ background: 'var(--sf-0a0a0c)' }}>Beach Club</option>
                  <option value="open_air" style={{ background: 'var(--sf-0a0a0c)' }}>Open Air</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: T3 }} />
              </div>
            </div>

            {/* DJ Lineup */}
            <DJLineupSelector
              eventId={editingEvent?.id}
              entries={lineupEntries}
              onChange={setLineupEntries}
              defaultStart={formData.startAt ? formData.startAt.slice(11, 16) : undefined}
              defaultEnd={formData.endAt ? formData.endAt.slice(11, 16) : undefined}
              eventLocalDate={formData.startAt ? formData.startAt.slice(0, 10) : undefined}
              guestArtists={guestArtists}
              onGuestArtistsChange={setGuestArtists}
            />

            {/* Dates */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel>{t('owner.startDateTime')}</FieldLabel>
                <DarkInput id="startAt" type="datetime-local" value={formData.startAt} onChange={v => setFormData({ ...formData, startAt: v })} />
              </div>
              <div>
                <FieldLabel>{t('owner.endDateTime')}</FieldLabel>
                <DarkInput id="endAt" type="datetime-local" value={formData.endAt} onChange={v => setFormData({ ...formData, endAt: v })} />
              </div>
            </div>

            {/* Fuseau horaire — les heures saisies ci-dessus sont interprétées et
                affichées dans ce fuseau (clients + notifications). Défaut = ville du compte. */}
            <div>
              <FieldLabel>
                <Clock className="w-3 h-3 inline mr-1" />
                {t('owner.ev.timezone')}
              </FieldLabel>
              <div className="relative">
                <select
                  value={formData.timezone}
                  onChange={e => setFormData({ ...formData, timezone: e.target.value })}
                  className="w-full appearance-none px-3 py-2.5 rounded-xl text-[13px] cursor-pointer"
                  style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, outline: 'none' }}
                >
                  {(SUPPORTED_TIMEZONES.some(z => z.id === formData.timezone)
                    ? SUPPORTED_TIMEZONES
                    : [{ id: formData.timezone, city: formData.timezone }, ...SUPPORTED_TIMEZONES]
                  ).map(z => (
                    <option key={z.id} value={z.id} style={{ background: 'var(--sf-0a0a0c)' }}>
                      {z.city} · {tzOffsetLabel(z.id)}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: T3 }} />
              </div>
              <p className="text-[11px] mt-1.5" style={{ color: T3 }}>{t('owner.ev.timezoneHint')}</p>
            </div>

            {/* ── Organizer-only: visibility / collaboration / partner club / secret venue ── */}
            {isOrganizerScope && (
              <div className="rounded-xl p-4" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                <FieldLabel>{t('owner.ev.fldVisibility')}</FieldLabel>
                <div className="space-y-2">
                  <EventSelectCard selected={eventKind === 'public_event'} onClick={() => setEventKind('public_event')} icon={Eye}
                    title={t('owner.ev.publicTitle')} description={t('owner.ev.publicDesc')} />
                  <EventSelectCard selected={eventKind === 'private_event'} onClick={() => setEventKind('private_event')} icon={Lock}
                    title={t('owner.ev.privateTitle')} description={t('owner.ev.privateDesc')} />
                </div>
              </div>
            )}

            {/* Co-organisation — disponible dans les DEUX sens et aux DEUX moments.
                Créer la soirée avec un partenaire, ou rouvrir une soirée solo pour
                lui en ajouter un : c'est le même bloc. Un contrat déjà engagé le
                verrouille (le partenaire a signé ou est en train de signer). */}
            {eventKind === 'public_event' && !collabReadOnly && (
              <div className="rounded-xl p-4" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                <FieldLabel>{t('owner.ev.collabMode')}</FieldLabel>
                {liveContract ? (
                  <div className="flex items-start gap-2 p-3 rounded-lg" style={{ background: 'rgba(52,211,153,0.07)', border: '1px solid rgba(52,211,153,0.2)' }}>
                    <Check className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--acc-34d399)' }} />
                    <div>
                      <p style={{ color: T1, fontSize: 12.5, fontWeight: 560 }}>
                        {liveContract.status === 'pending_signatures'
                          ? tl('Demande de collaboration envoyée', 'Collaboration request sent', 'Solicitud de colaboración enviada')
                          : tl('Collaboration active', 'Collaboration active', 'Colaboración activa')}
                      </p>
                      <p style={{ color: T3, fontSize: 11.5, marginTop: 2, lineHeight: 1.45 }}>
                        {liveContract.status === 'pending_signatures'
                          ? tl(
                              'Le partenaire doit signer le contrat avant que la billetterie ouvre. Pour changer de partenaire, il faut d\'abord annuler la demande.',
                              'Your partner must sign the contract before ticketing opens. To change partner, cancel the request first.',
                              'Tu socio debe firmar el contrato antes de abrir la venta. Para cambiar de socio, cancela antes la solicitud.',
                            )
                          : tl(
                              'Le partage et le mode sont engagés par le contrat signé. Ils se gèrent depuis la fiche de collaboration.',
                              'The split and mode are bound by the signed contract. Manage them from the collaboration page.',
                              'El reparto y el modo están fijados por el contrato firmado. Gestiónalos desde la página de colaboración.',
                            )}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <EventSelectCard selected={collabMode === 'solo'} onClick={() => setCollabMode('solo')} icon={Sparkles}
                      title={t('owner.ev.soloTitle')} description={t('owner.ev.soloDesc')} />
                    <EventSelectCard selected={collabMode === 'co_event'} onClick={() => setCollabMode('co_event')} icon={Users}
                      title={t('owner.ev.coEventTitle')} description={t('owner.ev.coEventDesc')} />
                    <EventSelectCard selected={collabMode === 'venue_rental'} onClick={() => setCollabMode('venue_rental')} icon={Building2}
                      title={t('owner.ev.venueRentalTitle')} description={t('owner.ev.venueRentalDesc')} />
                    <EventSelectCard selected={collabMode === 'hosted_by_venue'} onClick={() => setCollabMode('hosted_by_venue')} icon={Building2}
                      title={isOrganizerScope ? t('owner.ev.hostedByVenueTitle') : tl('Soirée de l\'organisateur', 'Organizer-hosted night', 'Noche del organizador')}
                      description={isOrganizerScope ? t('owner.ev.hostedByVenueDesc') : tl(
                        'L\'organisateur pilote la soirée, ton club accueille.',
                        'The organizer runs the night, your club hosts it.',
                        'El organizador dirige la noche, tu club la acoge.',
                      )} />
                  </div>
                )}
              </div>
            )}

            {requiresPartner && !liveContract && (
              <div className="rounded-xl p-4 space-y-3" style={{ background: 'rgba(232,25,44,0.05)', border: '1px solid rgba(232,25,44,0.25)' }}>
                <div>
                  <FieldLabel>
                    {isOrganizerScope
                      ? t('owner.ev.partnerClub')
                      : tl('Organisateur partenaire', 'Partner organizer', 'Organizador socio')}
                  </FieldLabel>
                  {(isOrganizerScope ? activePartnerships.length : activeOrgPartners.length) === 0 ? (
                    <p style={{ color: T3, fontSize: 12.5 }}>
                      {isOrganizerScope ? t('owner.ev.noPartnerships') : tl(
                        'Aucun organisateur partenaire actif. Invite-le depuis Collaborations → Inviter.',
                        'No active partner organizer yet. Invite one from Collaborations → Invite.',
                        'Aún no hay organizador socio activo. Invítalo desde Colaboraciones → Invitar.',
                      )}
                    </p>
                  ) : (
                    <div className="relative">
                      <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}
                        className="w-full appearance-none px-3 py-2.5 rounded-xl text-[13px] cursor-pointer"
                        style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: partnerId ? T1 : T3, outline: 'none' }}>
                        <option value="" style={{ background: 'var(--sf-0a0a0c)' }}>
                          {isOrganizerScope ? t('owner.ev.selectClub') : tl('Choisir un organisateur', 'Pick an organizer', 'Elegir un organizador')}
                        </option>
                        {isOrganizerScope
                          ? activePartnerships.map((p) => (
                              <option key={p.id} value={p.venue_id} style={{ background: 'var(--sf-0a0a0c)' }}>
                                {p.venue?.name ?? p.venue_id}{p.venue?.city ? ` · ${p.venue.city}` : ''}
                              </option>
                            ))
                          : activeOrgPartners.map((p) => (
                              <option key={p.id} value={p.organizer_user_id} style={{ background: 'var(--sf-0a0a0c)' }}>
                                {p.organizer?.organization_name ?? tl('Organisateur', 'Organizer', 'Organizador')}
                              </option>
                            ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: T3 }} />
                    </div>
                  )}
                </div>

                {/* Axe responsabilités — qui fait quoi, indépendant du partage des recettes. */}
                {partnerId && (
                  <ResponsibilitiesPicker
                    value={collabResponsibilities}
                    onChange={setCollabResponsibilities}
                  />
                )}

                {partnerId && (
                  <p style={{ color: T3, fontSize: 11.5, lineHeight: 1.45 }}>
                    {tl(
                      'En enregistrant, la demande part au partenaire avec un contrat à signer. La billetterie de cette soirée reste fermée tant qu\'il n\'a pas signé.',
                      'On save, the request goes out with a contract to sign. Ticketing for this night stays closed until they sign.',
                      'Al guardar, la solicitud se envía con un contrato para firmar. La venta de esta noche queda cerrada hasta que firme.',
                    )}
                  </p>
                )}
              </div>
            )}

            {isOrganizerScope && !requiresPartner && (
              <button type="button" onClick={() => setLocationIsSecret(!locationIsSecret)}
                className="w-full text-left rounded-xl p-4 transition-all duration-150"
                style={{ background: 'rgba(232,25,44,0.05)', border: '1px solid rgba(232,25,44,0.25)' }}>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 h-5 w-5 rounded-md flex items-center justify-center flex-shrink-0 transition-all"
                    style={locationIsSecret ? { background: RED, border: `1px solid ${RED}` } : { background: INNER_BG, border: `1px solid ${BORDER}` }}>
                    {locationIsSecret && <Check className="h-3.5 w-3.5 text-snow" />}
                  </span>
                  <div className="flex-1">
                    <p style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{t('owner.ev.secretVenue')}</p>
                    <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>{t('owner.ev.secretVenueDesc')}</p>
                  </div>
                </div>
              </button>
            )}

            {/* How the exact address reaches confirmed attendees (secret events only) */}
            {isOrganizerScope && !requiresPartner && locationIsSecret && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  { val: true, title: t('owner.ev.revealConfirmTitle'), desc: t('owner.ev.revealConfirmDesc') },
                  { val: false, title: t('owner.ev.revealManualTitle'), desc: t('owner.ev.revealManualDesc') },
                ].map((opt) => {
                  const active = revealAddressInEmail === opt.val;
                  return (
                    <button key={String(opt.val)} type="button" onClick={() => setRevealAddressInEmail(opt.val)}
                      className="text-left rounded-xl p-3 transition-all duration-150"
                      style={{ background: active ? 'rgba(232,25,44,0.08)' : INNER_BG, border: `1px solid ${active ? RED : BORDER}` }}>
                      <p style={{ color: T1, fontSize: 12.5, fontWeight: 560 }}>{opt.title}</p>
                      <p style={{ color: T3, fontSize: 11, marginTop: 2, lineHeight: 1.4 }}>{opt.desc}</p>
                    </button>
                  );
                })}
              </div>
            )}

            {isOrganizerScope && (() => {
              const selectedPartner = activePartnerships.find((p) => p.venue_id === partnerVenueId);
              const lockedToPartner = requiresPartner && !!selectedPartner;
              const displayName = lockedToPartner ? (selectedPartner!.venue?.name ?? '') : locationName;
              const displayCity = lockedToPartner ? (selectedPartner!.venue?.city ?? '') : locationCity;
              const inputStyle = { background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, outline: 'none' } as React.CSSProperties;
              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {lockedToPartner && (
                    <p className="sm:col-span-2" style={{ color: T3, fontSize: 11.5, fontStyle: 'italic', marginBottom: -4 }}>
                      {t('owner.ev.locationAutoFilled')}
                    </p>
                  )}
                  <div>
                    <FieldLabel>{t('owner.ev.venue')}{!lockedToPartner ? ' *' : ''}</FieldLabel>
                    <input value={displayName} onChange={(e) => setLocationName(e.target.value)} disabled={lockedToPartner} placeholder={t('owner.ev.venuePlaceholder')}
                      className="w-full px-3 py-2.5 rounded-xl text-[13px] disabled:opacity-50" style={inputStyle} />
                  </div>
                  <div>
                    <FieldLabel>{t('owner.ev.city')}{!lockedToPartner ? ' *' : ''}</FieldLabel>
                    <input value={displayCity} onChange={(e) => setLocationCity(e.target.value)} disabled={lockedToPartner} placeholder={t('owner.ev.cityPlaceholder')}
                      className="w-full px-3 py-2.5 rounded-xl text-[13px] disabled:opacity-50" style={inputStyle} />
                  </div>
                  <div className="sm:col-span-2">
                    <FieldLabel>{t('owner.ev.address')}{!lockedToPartner ? ' *' : ''}</FieldLabel>
                    <AddressAutocomplete
                      value={locationAddress}
                      onChange={setLocationAddress}
                      onPick={(pick) => {
                        setLocationAddress(pick.address);
                        // L'adresse choisie fait foi : elle recale la ville.
                        if (pick.city) setLocationCity(pick.city);
                      }}
                      city={displayCity}
                      placeholder={t('owner.ev.addressPlaceholder')}
                      disabled={lockedToPartner}
                      inputClassName="w-full pl-3 pr-9 py-2.5 rounded-xl text-[13px] disabled:opacity-50"
                      inputStyle={inputStyle}
                    />
                  </div>
                  {/* Logo du lieu — seulement pour un lieu en texte libre : quand la
                      soirée se tient chez un club partenaire, c'est SON logo qui fait foi. */}
                  {!lockedToPartner && (
                    <div className="sm:col-span-2">
                      <FieldLabel>{t('owner.ev.venueLogo')}</FieldLabel>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center shrink-0 overflow-hidden"
                          style={{ width: 48, height: 48, borderRadius: 10, border: `1px solid ${BORDER}`, background: INNER_BG }}>
                          {locationLogoPreview
                            ? <img src={locationLogoPreview} alt="" className="h-full w-full object-cover" />
                            : <Building2 className="w-4 h-4" style={{ color: T3 }} />}
                        </div>
                        <input id="owner-loc-logo" type="file" accept="image/*" className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            locationLogo.pick(file);
                            setLocationLogoPreview(URL.createObjectURL(file));
                          }} />
                        <button type="button" onClick={() => document.getElementById('owner-loc-logo')?.click()}
                          className="inline-flex items-center gap-2 text-[12px]" style={{ color: T3 }}>
                          <Upload className="w-4 h-4" />
                          {locationLogoPreview ? t('owner.ev.venueLogoChange') : t('owner.ev.venueLogoAdd')}
                        </button>
                        {locationLogoPreview && (
                          <button type="button" className="text-[12px]" style={{ color: T3 }}
                            onClick={() => { locationLogo.pick(null); setLocationLogoPreview(''); }}>
                            {t('owner.ev.venueLogoRemove')}
                          </button>
                        )}
                      </div>
                      <p className="text-[11px] mt-1.5" style={{ color: T3 }}>{t('owner.ev.venueLogoHint')}</p>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Active toggle — publier une soirée n'encaisse rien : jamais gaté par
                Stripe. Sans compte connecté, la soirée vit en ligne avec sa guest
                list (gratuite) ; seuls billets, tables et boissons restent fermés. */}
            <div
              className="flex items-center justify-between p-4 rounded-xl"
              style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}
            >
              <div>
                <p style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{t('owner.activeEvent')}</p>
                {orgSellingBlocked ? (
                  <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>
                    {t('owner.ev.stripeRequiredForLive')}
                  </p>
                ) : (
                  <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>{t('owner.ev.visibleInApp')}</p>
                )}
              </div>
              <Switch
                id="isActive"
                checked={formData.isActive}
                onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
              />
            </div>

            {/* Minors / alcohol-free per-event opt-out (only when the global is on) */}
            {globalMinorsAllowed && (
              <div className="flex items-center justify-between p-4 rounded-xl" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                <div>
                  <p style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{t('owner.minorsDisabledLabel')}</p>
                  <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>{t('owner.minorsDisabledHint')}</p>
                </div>
                <Switch
                  id="minorsDisabled"
                  checked={minorsDisabled}
                  onCheckedChange={setMinorsDisabled}
                />
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <button
                type="submit"
                disabled={isSaving}
                className="flex-1 py-3 rounded-xl text-[13.5px] font-semibold cursor-pointer transition-all duration-150"
                style={{ background: isSaving ? 'rgba(232,25,44,0.5)' : RED, color: '#fff', boxShadow: isSaving ? 'none' : `0 0 20px -6px ${RED}88` }}
              >
                {isSaving ? '…' : (editingEvent ? t('owner.update') : t('owner.create'))}
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={() => { setIsDialogOpen(false); resetForm(); }}
                className="px-5 py-3 rounded-xl text-[13.5px] font-medium cursor-pointer transition-all duration-150"
                style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}
              >
                {t('common.cancel')}
              </button>
            </div>
          </form>
        </div>
        <PublishingOverlay
          open={publishOpen}
          stage={publishStage}
          event={publishedEvent}
          onViewEvent={() => {
            const id = publishedIdRef.current;
            // Nouvel onglet, pas une navigation : le pro vient de publier et
            // enchaîne presque toujours sur la billetterie ou les tables —
            // l'envoyer sur la page publique dans le même onglet lui ferait
            // perdre son tableau de bord. `openExternal` donne le navigateur
            // in-app en natif au lieu d'éjecter vers Safari, et l'ouverture
            // se fait AVANT les changements d'état, dans le geste du clic,
            // sinon Safari la bloque.
            //
            // `/event/<uuid>` est la seule forme toujours résolue — la forme
            // `/events/<venue_id>/<slug>` échoue pour une soirée d'organisateur.
            if (id) openExternal(publicUrl(`/event/${id}`));
            setPublishOpen(false);
            setIsDialogOpen(false);
            resetForm();
          }}
          onClose={() => { setPublishOpen(false); setIsDialogOpen(false); resetForm(); }}
        />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Event Card ────────────────────────────────────────────────────────────────
const RED_C = '#E8192C';
const GUEST_C = 'var(--acc-34d399)';
const T1_C  = 'rgb(var(--ink)/var(--ink-a96,0.96))';
const T2_C  = 'rgb(var(--ink)/var(--ink-a58,0.58))';
const T3_C  = 'rgb(var(--ink)/var(--ink-a36,0.36))';
const C_FAINT_C = 'rgb(var(--ink)/0.06)';
const BORDER_C  = 'rgb(var(--ink)/0.085)';
const CARD_BG_C = 'linear-gradient(180deg,rgb(var(--sheen)/.045) 0%,rgb(var(--sheen)/.008) 100%),var(--sf-0a0a0c)';
const CARD_SHADOW_C = '0 1px 0 rgb(var(--sheen)/.05) inset,0 18px 40px -28px rgb(0 0 0/calc(.9*var(--pro-shadow-a)))';

/** Suffixe « · Bientôt » du bouton Booster, calé sur ce que le compte voit vraiment (pas la constante seule). */
function BoostSoonSuffix({ t }: { t: (key: string) => string }) {
  const live = useMetaIntegrationLive();
  return live ? null : <>{` · ${t('integ.buildingBadge')}`}</>;
}

function EventCard({ event, onEdit, onDelete, onToggle, onToggleTicketing, onToggleTables, onToggleGuestList, onToggleSoldOut, onApplyPreset, onApplyGuestListPreset, presets, guestPresets, onNavigate, onDetails, basePath, t, ownerKind, venueId, organizerUserId }: {
  event: OwnerEventRow;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onToggleTicketing: () => Promise<boolean>;
  onToggleTables: () => Promise<boolean>;
  onToggleGuestList: () => Promise<boolean>;
  onToggleSoldOut: (pillar: 'tickets' | 'tables' | 'guestList') => Promise<void>;
  onApplyPreset: (preset: VenuePreset) => void;
  onApplyGuestListPreset: (tpl: GuestPreset) => void;
  presets: VenuePreset[];
  guestPresets: GuestPreset[];
  onNavigate: (path: string) => void;
  onDetails?: () => void;
  basePath: string;
  t: (k: string) => string;
  ownerKind: TrackedOwnerKind;
  venueId: string | null;
  organizerUserId: string | null;
}) {
  const [showPresetPanel, setShowPresetPanel] = useState(false);
  const [showLinks, setShowLinks] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [showGuestListPanel, setShowGuestListPanel] = useState(false);
  const [selectedGuestPresetId, setSelectedGuestPresetId] = useState('');
  const isPast = toParisTime(event.endAt) < nowInParis();

  const handleTicketingClick = async () => {
    const handled = await onToggleTicketing();
    if (!handled) setShowPresetPanel(true); // needs a preset first
  };

  const handleGuestListClick = async () => {
    const handled = await onToggleGuestList();
    if (!handled) {
      // No list created yet → open the picker, pre-selecting the default template.
      const def = guestPresets.find(p => p.is_default) ?? guestPresets[0];
      setSelectedGuestPresetId(def?.id ?? '');
      setShowGuestListPanel(true);
    }
  };

  const handleTablesClick = async () => {
    const handled = await onToggleTables();
    if (!handled) {
      // No bookable table inventory yet → send the user to set up the plan.
      toast.info(t('owner.ev.tablesNeedSetup'));
      if (onDetails) onDetails();
      else onNavigate(`${basePath}/tables`);
    }
  };

  const copyPrivateLink = () => {
    const url = publicUrl(`/event/${event.id}`);
    navigator.clipboard.writeText(url).then(
      () => toast.success(t('owner.ev.privateLinkCopied')),
      () => toast.error(t('owner.ev.copyLinkFailed')),
    );
  };

  const standardPresets = presets.filter(p => p.ticket_type !== 'vip');

  return (
    <div
      style={{
        background: CARD_BG_C,
        border: `1px solid ${BORDER_C}`,
        borderRadius: 18,
        boxShadow: CARD_SHADOW_C,
        overflow: 'hidden',
      }}
    >
      <div className="flex items-start gap-4 p-5">
        {/* Poster */}
        {event.posterUrl && (
          <img
            src={event.posterUrl}
            alt={event.title}
            className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl object-cover flex-shrink-0"
          />
        )}
        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 style={{ color: T1_C, fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }} className="truncate">
              {event.title}
            </h3>
            {event.isActive && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
                style={{ background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.25)', color: 'var(--acc-34d399)' }}>
                <span className="w-1.5 h-1.5 rounded-full bg-[#34D399] inline-block" />
                {t('owner.active')}
              </span>
            )}
            {event.isPartnerHosted && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
                style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)', color: 'var(--acc-fcd34d)' }}>
                {t('owner.ev.coHosted')}
              </span>
            )}
          </div>
          {event.description && (
            <p style={{ color: T3_C, fontSize: 12 }} className="line-clamp-2 mb-2">{event.description}</p>
          )}
          <div className="flex items-center gap-1" style={{ color: T3_C, fontSize: 12 }}>
            <Clock className="w-3.5 h-3.5" />
            <span>{formatInTimeZone(new Date(event.startAt), PARIS_TIMEZONE, 'dd MMM yyyy', { locale: fr })}</span>
            <span style={{ color: 'rgb(var(--ink)/var(--ink-a20,0.2))' }}>·</span>
            <span>{formatInTimeZone(new Date(event.startAt), PARIS_TIMEZONE, 'HH:mm')} – {formatInTimeZone(new Date(event.endAt), PARIS_TIMEZONE, 'HH:mm')}</span>
          </div>
        </div>
      </div>

      {/* Private events: surface the shareable direct link right on the card (it lives nowhere else) */}
      {event.isPrivate && (
        <div className="px-5 pb-1">
          <button
            type="button"
            onClick={copyPrivateLink}
            className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-150"
            style={{ background: 'rgba(232,25,44,0.06)', border: '1px solid rgba(232,25,44,0.22)' }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Lock className="w-3.5 h-3.5 flex-shrink-0" style={{ color: RED_C }} />
              <div className="min-w-0 text-left">
                <p style={{ color: T1_C, fontSize: 12.5, fontWeight: 560 }} className="truncate">{t('owner.ev.privateLink')}</p>
                <p style={{ color: T3_C, fontSize: 10.5 }} className="truncate">{publicUrl(`/event/${event.id}`)}</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg flex-shrink-0"
              style={{ background: RED_C, color: '#fff', fontSize: 11.5, fontWeight: 600 }}>
              <Link2 className="w-3.5 h-3.5" />{t('common.copy')}
            </span>
          </button>
        </div>
      )}

      {/* Quick publishing — tickets, tables & guest list online, no tab navigation needed */}
      {!event.isPartnerHosted && !isPast && (
        <div className="px-5 pb-1">
          <div className="grid grid-cols-3 gap-2.5">
            {/* Ticketing */}
            <div className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl"
              style={{ background: event.ticketingEnabled ? 'rgba(232,25,44,0.08)' : C_FAINT_C, border: `1px solid ${event.ticketingEnabled ? 'rgba(232,25,44,0.22)' : BORDER_C}` }}>
              <div className="flex items-center gap-2 min-w-0">
                <Ticket className="w-4 h-4 flex-shrink-0" style={{ color: event.ticketingEnabled ? 'var(--acc-ff7a82)' : T3_C }} />
                <div className="min-w-0">
                  <p style={{ color: T1_C, fontSize: 12.5, fontWeight: 560 }} className="truncate">{t('owner.ev.ticketing')}</p>
                  <p style={{ color: T3_C, fontSize: 10.5 }} className="truncate">
                    {event.ticketingEnabled ? t('owner.ev.online') : (event.roundsCount ? t('owner.ev.ready') : t('owner.ev.toConfigure'))}
                  </p>
                </div>
              </div>
              <Switch checked={!!event.ticketingEnabled} onCheckedChange={handleTicketingClick} />
            </div>
            {/* Tables */}
            <div className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl"
              style={{ background: event.tablesEnabled ? 'rgba(252,211,77,0.08)' : C_FAINT_C, border: `1px solid ${event.tablesEnabled ? 'rgba(252,211,77,0.22)' : BORDER_C}` }}>
              <div className="flex items-center gap-2 min-w-0">
                <Crown className="w-4 h-4 flex-shrink-0" style={{ color: event.tablesEnabled ? 'var(--acc-fcd34d)' : T3_C }} />
                <div className="min-w-0">
                  <p style={{ color: T1_C, fontSize: 12.5, fontWeight: 560 }} className="truncate">{t('owner.ev.tablesVip')}</p>
                  <p style={{ color: T3_C, fontSize: 10.5 }} className="truncate">{event.tablesEnabled ? t('owner.ev.online') : t('owner.ev.offline')}</p>
                </div>
              </div>
              <Switch checked={!!event.tablesEnabled} onCheckedChange={handleTablesClick} />
            </div>
            {/* Guest list — publish the club list in 2s (from the default preset) */}
            <div className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl"
              style={{ background: event.guestListEnabled ? 'rgba(52,211,153,0.08)' : C_FAINT_C, border: `1px solid ${event.guestListEnabled ? 'rgba(52,211,153,0.22)' : BORDER_C}` }}>
              <div className="flex items-center gap-2 min-w-0">
                <Users className="w-4 h-4 flex-shrink-0" style={{ color: event.guestListEnabled ? 'var(--acc-34d399)' : T3_C }} />
                <div className="min-w-0">
                  <p style={{ color: T1_C, fontSize: 12.5, fontWeight: 560 }} className="truncate">{t('owner.ev.guestList')}</p>
                  <p style={{ color: T3_C, fontSize: 10.5 }} className="truncate">{event.guestListEnabled ? t('owner.ev.online') : t('owner.ev.offline')}</p>
                </div>
              </div>
              <Switch checked={!!event.guestListEnabled} onCheckedChange={handleGuestListClick} />
            </div>
          </div>

          {/* « Complet » — même endroit que la mise en ligne, parce que c'est le
              même geste un soir de rush : fermer un pilier sans dépublier la
              soirée. La page publique continue d'afficher l'offre, marquée
              complète. Le réglage fin (formule par formule, part par part) vit
              dans les pages Tables VIP et Guest list. */}
          {(event.ticketingEnabled || event.tablesEnabled || event.guestListEnabled || event.hasGuestList) && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1" style={{ color: T3_C, fontSize: 11 }}>
                <Ban className="w-3 h-3" />{t('soldOut.markAs')}
              </span>
              {([
                { key: 'tickets' as const, on: !!event.ticketingEnabled, out: !!event.ticketsSoldOut, label: t('owner.ev.ticketing') },
                { key: 'tables' as const, on: !!event.tablesEnabled, out: !!event.tablesSoldOut, label: t('owner.ev.tablesVip') },
                { key: 'guestList' as const, on: !!event.guestListEnabled || !!event.hasGuestList, out: !!event.guestListSoldOut, label: t('owner.ev.guestList') },
              ]).filter(p => p.on).map(p => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => onToggleSoldOut(p.key)}
                  title={p.out ? t('soldOut.reopenHint') : t('soldOut.closeHint')}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg cursor-pointer transition-all duration-150"
                  style={{
                    background: p.out ? 'rgba(232,25,44,0.14)' : C_FAINT_C,
                    border: `1px solid ${p.out ? 'rgba(232,25,44,0.45)' : BORDER_C}`,
                    color: p.out ? 'var(--acc-ff7a82)' : T3_C,
                    fontSize: 11.5,
                    fontWeight: 600,
                  }}
                >
                  {p.out && <Check className="w-3 h-3" />}
                  {p.label}
                </button>
              ))}
            </div>
          )}

          {/* Booster : une pub Instagram / Facebook pour cette soirée, créée et
              suivie depuis Yuno (page Publicité). */}
          <div className="mt-2">
            <button
              type="button"
              onClick={() => onNavigate(`${basePath}/ads?event=${event.id}`)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg cursor-pointer transition-all duration-150"
              style={{ background: C_FAINT_C, border: `1px solid ${BORDER_C}`, color: T3_C, fontSize: 11.5, fontWeight: 600 }}
            >
              <Rocket className="w-3 h-3" />{t('ads.boostEvent')}<BoostSoonSuffix t={t} />
            </button>
          </div>

          {/* Inline preset picker — appears when publishing tickets with no rounds yet */}
          <AnimatePresence>
            {showPresetPanel && (
              <motion.div
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }} className="overflow-hidden">
                <div className="mt-2.5 p-3 rounded-xl" style={{ background: INNER_BG, border: `1px solid ${BORDER_C}` }}>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Sparkles className="w-3.5 h-3.5" style={{ color: RED_C }} />
                    <p style={{ color: T1_C, fontSize: 12, fontWeight: 600 }}>{t('owner.ev.publishTicketing')}</p>
                  </div>
                  {standardPresets.length > 0 ? (
                    <>
                      <p style={{ color: T3_C, fontSize: 11, marginBottom: 8 }}>{t('owner.ev.selectPresetToApply')}</p>
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <select value={selectedPresetId} onChange={e => setSelectedPresetId(e.target.value)}
                            className="w-full appearance-none px-3 py-2 rounded-lg text-[12.5px] cursor-pointer"
                            style={{ background: 'var(--sf-0a0a0c)', border: `1px solid ${BORDER_C}`, color: T1_C, outline: 'none' }}>
                            <option value="">{t('owner.ev.selectPresetOption')}</option>
                            {standardPresets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: T3_C }} />
                        </div>
                        <button
                          disabled={!selectedPresetId}
                          onClick={() => {
                            const preset = standardPresets.find(p => p.id === selectedPresetId);
                            if (preset) { onApplyPreset(preset); setShowPresetPanel(false); setSelectedPresetId(''); }
                          }}
                          className="px-3 py-2 rounded-lg text-[12px] font-semibold cursor-pointer transition-all duration-150"
                          style={{ background: selectedPresetId ? RED_C : 'rgba(232,25,44,0.35)', color: '#fff' }}>
                          {t('owner.ev.publish')}
                        </button>
                      </div>
                      <button onClick={() => onNavigate(`${basePath}/ticketing?eventId=${event.id}`)}
                        className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium cursor-pointer"
                        style={{ color: T3_C }}>
                        <ExternalLink className="w-3 h-3" />{t('owner.ev.advancedConfig')}
                      </button>
                    </>
                  ) : (
                    <div>
                      <p style={{ color: T2_C, fontSize: 11.5, marginBottom: 8 }}>
                        {t('owner.ev.noPresetsExist')}
                      </p>
                      <button onClick={() => onNavigate(`${basePath}/ticketing?eventId=${event.id}`)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold cursor-pointer"
                        style={{ background: RED_C, color: '#fff' }}>
                        <ExternalLink className="w-3.5 h-3.5" />{t('owner.ev.configureTicketing')}
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Inline guest-list picker — appears when publishing the list with none created yet */}
          <AnimatePresence>
            {showGuestListPanel && (
              <motion.div
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }} className="overflow-hidden">
                <div className="mt-2.5 p-3 rounded-xl" style={{ background: INNER_BG, border: `1px solid ${BORDER_C}` }}>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Users className="w-3.5 h-3.5" style={{ color: GUEST_C }} />
                    <p style={{ color: T1_C, fontSize: 12, fontWeight: 600 }}>{t('owner.ev.publishGuestList')}</p>
                  </div>
                  {guestPresets.length > 0 ? (
                    <>
                      <p style={{ color: T3_C, fontSize: 11, marginBottom: 8 }}>{t('owner.ev.selectGuestPresetToApply')}</p>
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <select value={selectedGuestPresetId} onChange={e => setSelectedGuestPresetId(e.target.value)}
                            className="w-full appearance-none px-3 py-2 rounded-lg text-[12.5px] cursor-pointer"
                            style={{ background: 'var(--sf-0a0a0c)', border: `1px solid ${BORDER_C}`, color: T1_C, outline: 'none' }}>
                            <option value="">{t('owner.ev.selectGuestPresetOption')}</option>
                            {guestPresets.map(p => <option key={p.id} value={p.id}>{p.is_default ? `★ ${p.name}` : p.name}</option>)}
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: T3_C }} />
                        </div>
                        <button
                          disabled={!selectedGuestPresetId}
                          onClick={() => {
                            const tpl = guestPresets.find(p => p.id === selectedGuestPresetId);
                            if (tpl) { onApplyGuestListPreset(tpl); setShowGuestListPanel(false); setSelectedGuestPresetId(''); }
                          }}
                          className="px-3 py-2 rounded-lg text-[12px] font-semibold cursor-pointer transition-all duration-150"
                          style={{ background: selectedGuestPresetId ? GUEST_C : 'rgba(52,211,153,0.35)', color: '#04150d' }}>
                          {t('owner.ev.publish')}
                        </button>
                      </div>
                      <button onClick={() => onNavigate(`${basePath}/guest-list`)}
                        className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium cursor-pointer"
                        style={{ color: T3_C }}>
                        <ExternalLink className="w-3 h-3" />{t('owner.ev.advancedConfig')}
                      </button>
                    </>
                  ) : (
                    <div>
                      <p style={{ color: T2_C, fontSize: 11.5, marginBottom: 8 }}>
                        {t('owner.ev.noGuestPresetsExist')}
                      </p>
                      <button onClick={() => onNavigate(`${basePath}/guest-list`)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold cursor-pointer"
                        style={{ background: GUEST_C, color: '#04150d' }}>
                        <ExternalLink className="w-3.5 h-3.5" />{t('owner.ev.configureGuestList')}
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 px-5 pb-4 flex-wrap" style={{ borderTop: `1px solid rgb(var(--ink)/0.04)`, paddingTop: 12, marginTop: 12 }}>
        {event.isPartnerHosted ? (
          <>
            <a href={`/owner/ticketing?eventId=${event.id}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer transition-all duration-150"
              style={{ background: C_FAINT_C, border: `1px solid ${BORDER_C}`, color: T2_C }}>
              {t('owner.ev.ticketing')}
            </a>
            <a href={`/owner/tables?eventId=${event.id}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer transition-all duration-150"
              style={{ background: C_FAINT_C, border: `1px solid ${BORDER_C}`, color: T2_C }}>
              {t('owner.ev.tables')}
            </a>
            <a href={`/event/${event.id}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer transition-all duration-150 ml-auto"
              style={{ color: T3_C }}>
              {t('owner.ev.viewDetails')}
            </a>
          </>
        ) : (
          <>
            <button
              onClick={onEdit}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer transition-all duration-150"
              style={{ background: C_FAINT_C, border: `1px solid ${BORDER_C}`, color: T2_C }}
            >
              <Pencil className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t('owner.edit')}</span>
            </button>
            <button
              onClick={onToggle}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer transition-all duration-150"
              style={{ background: C_FAINT_C, border: `1px solid ${BORDER_C}`, color: event.isActive ? 'var(--acc-34d399)' : T2_C }}
            >
              {event.isActive ? t('owner.deactivate') : t('owner.activate')}
            </button>
            <button
              onClick={onDelete}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer transition-all duration-150"
              style={{ background: 'rgba(232,25,44,0.08)', border: '1px solid rgba(232,25,44,0.2)', color: 'var(--acc-ff5c63)' }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t('owner.deleteEvent')}</span>
            </button>
            {onDetails && (
              <button
                onClick={onDetails}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer transition-all duration-150 ml-auto"
                style={{ background: C_FAINT_C, border: `1px solid ${BORDER_C}`, color: T2_C }}
              >
                <Settings2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{t('owner.ev.details')}</span>
              </button>
            )}
          </>
        )}
      </div>

      {/* Tracked links — per-channel links + click/conversion/revenue attribution */}
      {!isPast && (
        <div className="px-5 pb-5">
          <button
            type="button"
            onClick={() => setShowLinks((v) => !v)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-150"
            style={{ background: C_FAINT_C, border: `1px solid ${BORDER_C}` }}
          >
            <div className="flex items-center gap-2">
              <Link2 className="w-3.5 h-3.5" style={{ color: T3_C }} />
              <span style={{ color: T1_C, fontSize: 12.5, fontWeight: 560 }}>{t('tlink.title')}</span>
            </div>
            {showLinks ? <ChevronUp className="w-4 h-4" style={{ color: T3_C }} /> : <ChevronDown className="w-4 h-4" style={{ color: T3_C }} />}
          </button>
          <AnimatePresence>
            {showLinks && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden pt-3"
              >
                <TrackedLinksManager
                  ownerKind={ownerKind}
                  venueId={venueId}
                  organizerUserId={organizerUserId}
                  targetKind="event"
                  eventId={event.id}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

// Radio-style selector card used by the organizer event form (visibility / collab mode).
function EventSelectCard({ selected, onClick, icon: Icon, title, description }: {
  selected: boolean; onClick: () => void; icon: LucideIcon; title: string; description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-all duration-150"
      style={selected
        ? { background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.35)' }
        : { background: 'rgb(var(--ink)/0.018)', border: `1px solid ${BORDER_C}` }}
    >
      <span className="mt-0.5 h-4 w-4 rounded-full flex items-center justify-center flex-shrink-0 transition-all"
        style={selected ? { border: `1px solid ${RED_C}` } : { border: '1px solid rgb(var(--ink)/var(--ink-a25,0.25))' }}>
        {selected && <span className="h-2 w-2 rounded-full" style={{ background: RED_C }} />}
      </span>
      <div className="flex-1">
        <div className="flex items-center gap-2" style={{ color: T1_C, fontSize: 13, fontWeight: 560 }}>
          <Icon className="h-4 w-4" style={{ color: selected ? RED_C : T3_C }} />
          {title}
        </div>
        <p style={{ color: T3_C, fontSize: 11.5, marginTop: 2 }}>{description}</p>
      </div>
    </button>
  );
}
