import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar, Plus, Pencil, Trash2, Clock, Upload, X, Archive, ChevronDown, ChevronUp, Info, Tag, Lock, Users, Ticket, Crown, RefreshCw, Sparkles, ExternalLink, Eye, Building2, Check, Settings2, Link2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import type { TablesUpdate } from '@/integrations/supabase/types';
import { Event } from '@/types';
import { formatInTimeZone } from 'date-fns-tz';
import { fr, es, enUS } from 'date-fns/locale';
import { toast } from 'sonner';
import { PARIS_TIMEZONE, toParisTime, fromParisTime, nowInParis } from '@/lib/timezone';
import { notifyDjLineup } from '@/lib/djNotify';
import { useLanguage } from '@/contexts/LanguageContext';
import { useVenueContext } from '@/hooks/useVenueContext';
import { useDashboardMode } from '@/contexts/DashboardModeContext';
import { OwnerHeader } from '@/components/OwnerHeader';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { PosterCropper, PosterPosition } from '@/components/PosterCropper';
import { DJLineupSelector } from '@/components/dj/DJLineupSelector';
import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';
import { isCollabPlan } from '@/lib/planFeatures';
import { useOrganizerPartnerships } from '@/hooks/useOrganizerPartnerships';
import { useOrganizerStripe } from '@/hooks/useOrganizerStripe';
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
import { EventGenrePicker } from '@/components/owner/events/EventGenrePicker';

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
  const orgSellingBlocked = isOrganizerScope && !stripeLoading && !canSell;
  // Partner clubs the organizer has an active partnership with (used by collab/co-event modes).
  const { partnerships } = useOrganizerPartnerships();
  const activePartnerships = partnerships.filter((p) => p.status === 'active');
  const [events, setEvents] = useState<OwnerEventRow[]>([]);
  const [view, setView] = useState<'events' | 'recurring'>('events');
  const [presets, setPresets] = useState<VenuePreset[]>([]);
  const [guestPresets, setGuestPresets] = useState<GuestPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [posterFile, setPosterFile] = useState<File | null>(null);
  const [posterPreview, setPosterPreview] = useState<string>('');
  const [posterPosition, setPosterPosition] = useState<PosterPosition | null>(null);
  const [showArchivedEvents, setShowArchivedEvents] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lineupDJIds, setLineupDJIds] = useState<string[]>([]);
  const [formData, setFormData] = useState({
    title: '', description: '', posterUrl: '', startAt: '', endAt: '',
    isActive: true, musicGenres: ['Open Format'] as string[], eventType: 'club',
  });

  // ─── Organizer-only event fields (visibility / collab / secret venue) ──
  const [eventKind, setEventKind] = useState<EventKind>('public_event');
  const [collabMode, setCollabMode] = useState<CollabMode>('solo');
  const [partnerVenueId, setPartnerVenueId] = useState<string>('');
  const [locationName, setLocationName] = useState('');
  const [locationCity, setLocationCity] = useState('');
  const [locationAddress, setLocationAddress] = useState('');
  const [locationIsSecret, setLocationIsSecret] = useState(false);
  // Secret-location reveal: true = address in the booking confirmation email,
  // false = the organizer reveals it via their own scheduled/manual email.
  const [revealAddressInEmail, setRevealAddressInEmail] = useState(true);
  // Minors / alcohol-free: global lives on the venue (owner) or organizer profile.
  // Per-event opt-out is only offered when the global is on.
  const [globalMinorsAllowed, setGlobalMinorsAllowed] = useState(false);
  const [minorsDisabled, setMinorsDisabled] = useState(false);
  const requiresPartner = isOrganizerScope && eventKind === 'public_event' && collabMode !== 'solo';

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
        const { data } = await supabase.from('organizer_profiles').select('minors_allowed').eq('user_id', organizerUserId!).maybeSingle();
        setGlobalMinorsAllowed((data as any)?.minors_allowed ?? false);
      } else {
        const { data } = await supabase.from('venues').select('minors_allowed').eq('id', venueId!).maybeSingle();
        setGlobalMinorsAllowed((data as any)?.minors_allowed ?? false);
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
        id: event.id, venueId: event.venue_id, title: event.title,
        description: event.description || undefined,
        posterUrl: event.poster_url || undefined,
        posterPosition: event.poster_position as unknown as PosterPosition | undefined,
        startAt: event.start_at, endAt: event.end_at, isActive: event.is_active,
        createdAt: event.created_at, updatedAt: event.updated_at,
        musicGenres: (event as any).music_genres || [(event as any).music_genre || 'Open Format'],
        eventType: (event as any).event_type || 'club',
        isPartnerHosted: isOrganizerScope ? false : (event.partner_venue_id === venueId && event.venue_id !== venueId && !!event.organizer_user_id),
        isPrivate: isOrganizerScope && ((event as any).event_kind === 'private_event' || (event as any).visibility === 'private'),
        organizerUserId: (event as any).organizer_user_id ?? null,
        ticketingEnabled: (event as any).ticketing_enabled ?? false,
        tablesEnabled: (event as any).tables_enabled ?? false,
        guestListEnabled: false,
        ticketSellingMode: (event as any).ticket_selling_mode || 'rounds',
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
        const { data: glData } = await supabase
          .from('guest_lists')
          .select('event_id, is_active')
          .eq('holder_type', 'club')
          .in('event_id', eventIds);
        const glMap: Record<string, boolean> = {};
        (glData || []).forEach(gl => { glMap[gl.event_id] = gl.is_active; });
        mappedEvents.forEach(e => { e.guestListEnabled = glMap[e.id] ?? false; });
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

  // Upload an organizer event photo (single 1:1 square poster) to the 'event-posters' bucket.
  const uploadOrgImage = async (file: File): Promise<string | null> => {
    const bucket = 'event-posters';
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const path = `${organizerUserId}/${Date.now()}-poster.${ext}`;
    const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: false, contentType: file.type });
    if (error) { toast.error(error.message || t('owner.toastPosterUploadError')); return null; }
    return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  };

  // Organizer event save — visibility (public/private), collab mode, partner club, secret venue, 1:1 poster.
  const saveOrganizerEvent = async ({ startAtUTC, endAtUTC }: { startAtUTC: string; endAtUTC: string }) => {
    const sanitize = (url: string) => (url && (url.startsWith('blob:') || url.startsWith('data:')) ? '' : url);
    let posterUrl = sanitize(posterPreview);
    if (posterFile) { const u = await uploadOrgImage(posterFile); if (u) posterUrl = u; else throw new Error('poster upload failed'); }

    const visibility = eventKind === 'private_event' ? 'private' : 'public';
    const payload: Record<string, any> = {
      organizer_user_id: organizerUserId,
      title: formData.title.trim(),
      description: formData.description.trim() || null,
      poster_url: posterUrl || null,
      poster_position: posterPosition ? { x: posterPosition.x, y: posterPosition.y, scale: posterPosition.scale } : null,
      start_at: startAtUTC, end_at: endAtUTC,
      location_name: locationName.trim() || null,
      location_city: locationCity.trim() || null,
      location_address: locationAddress.trim() || null,
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
      const { data, error } = await supabase.from('events').insert(payload as any).select('id').single();
      if (error) throw error;
      savedId = data.id;
    }
    if (savedId) {
      await supabase.from('event_djs').delete().eq('event_id', savedId);
      if (lineupDJIds.length > 0) {
        await supabase.from('event_djs').insert(lineupDJIds.map((djId) => ({ event_id: savedId!, dj_id: djId })));
        notifyDjLineup(savedId, lineupDJIds);
      }
    }
    toast.success(editingEvent ? t('owner.toastEventUpdated') : t('owner.toastEventCreated'));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    if (!formData.title || !formData.startAt || !formData.endAt) { toast.error(t('owner.toastFieldsRequired')); return; }
    const parsedStart = new Date(formData.startAt), parsedEnd = new Date(formData.endAt);
    if (isNaN(parsedStart.getTime()) || isNaN(parsedEnd.getTime())) { toast.error(t('owner.toastFieldsRequired')); return; }
    if (parsedEnd <= parsedStart) { toast.error(t('owner.toastEndAfterStart')); return; }
    if (!scopeReady) { toast.error(t('owner.toastVenueNotFound')); return; }
    if (requiresPartner && !partnerVenueId) { toast.error(t('owner.ev.selectPartnerClub')); return; }
    // Organizer events that define their own location must be placeable in a city
    // (kept even when the location is secret — the city is what filters the event).
    if (isOrganizerScope && !requiresPartner && (!locationName.trim() || !locationCity.trim() || !locationAddress.trim())) {
      toast.error(t('owner.ev.locationRequired')); return;
    }
    setIsSaving(true);
    try {
      // ── Organizer scope: visibility / collab / secret venue (mirrors the org event flow) ──
      if (isOrganizerScope) {
        await saveOrganizerEvent({ startAtUTC: fromParisTime(formData.startAt).toISOString(), endAtUTC: fromParisTime(formData.endAt).toISOString() });
        setIsDialogOpen(false);
        resetForm();
        fetchEvents();
        return;
      }
      let posterUrl = formData.posterUrl;
      if (posterFile && posterPreview) {
        try {
          const croppedBlob = await cropToSquare(posterPreview, posterPosition);
          const filePath = `events/${Date.now()}-poster.jpg`;
          const { error: uploadError } = await supabase.storage.from('event-images').upload(filePath, croppedBlob, { contentType: 'image/jpeg' });
          if (uploadError) { toast.error(t('owner.toastPosterUploadError')); }
          else { posterUrl = supabase.storage.from('event-images').getPublicUrl(filePath).data.publicUrl; }
        } catch (err) { console.error('Poster upload exception:', err); }
      }
      const startAtUTC = fromParisTime(formData.startAt).toISOString();
      const endAtUTC = fromParisTime(formData.endAt).toISOString();
      if (editingEvent) {
        const { error } = await supabase.from('events').update({
          title: formData.title, description: formData.description || null,
          poster_url: posterUrl || null,
          poster_position: posterPosition ? { x: posterPosition.x, y: posterPosition.y, scale: posterPosition.scale } : null,
          start_at: startAtUTC, end_at: endAtUTC, is_active: formData.isActive,
          venue_id: venueId, minors_disabled: minorsDisabled, music_genres: formData.musicGenres, event_type: formData.eventType,
        }).eq('id', editingEvent.id);
        if (error) throw error;
        const { data: oldDjs } = await supabase.from('event_djs').select('dj_id').eq('event_id', editingEvent.id);
        const oldDjIds = (oldDjs || []).map(d => d.dj_id).sort();
        await supabase.from('event_djs').delete().eq('event_id', editingEvent.id);
        if (lineupDJIds.length > 0) await supabase.from('event_djs').insert(lineupDJIds.map(djId => ({ event_id: editingEvent.id, dj_id: djId })));
        // Notify followers only for DJs newly added to this line-up (not on every edit).
        const addedDjIds = lineupDJIds.filter(id => !oldDjIds.includes(id));
        if (addedDjIds.length > 0) notifyDjLineup(editingEvent.id, addedDjIds);
        const newDjIdsSorted = [...lineupDJIds].sort();
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
          poster_position: posterPosition ? { x: posterPosition.x, y: posterPosition.y, scale: posterPosition.scale } : null,
          start_at: startAtUTC, end_at: endAtUTC, is_active: formData.isActive,
          venue_id: venueId, minors_disabled: minorsDisabled, music_genres: formData.musicGenres, event_type: formData.eventType,
        }).select('id').single();
        if (error) throw error;
        if (newEvent && lineupDJIds.length > 0) {
          await supabase.from('event_djs').insert(lineupDJIds.map(djId => ({ event_id: newEvent.id, dj_id: djId })));
          notifyDjLineup(newEvent.id, lineupDJIds);
        }
        toast.success(t('owner.toastEventCreated'));
      }
      setIsDialogOpen(false);
      resetForm();
      fetchEvents();
    } catch (error) {
      console.error('Error saving event:', error);
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
          venue_id: isOrganizerScope ? (event.venueId ?? null) : venueId,
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
      const rounds = (preset.rounds as any[]) || [];
      if (rounds.length === 0) { toast.error(t('owner.ev.presetNoRounds')); return; }

      // Fresh start: remove any existing rounds of this ticket type.
      const { data: existing } = await supabase.from('ticket_rounds').select('id, ticket_type').eq('event_id', event.id);
      const toDelete = (existing || []).filter(r => (r.ticket_type || 'standard') === preset.ticket_type).map(r => r.id);
      if (toDelete.length > 0) await supabase.from('ticket_rounds').delete().in('id', toDelete);

      const toInsert = rounds.map((r: any, index: number) => ({
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

  const handleEdit = async (event: Event & { posterPosition?: PosterPosition }) => {
    setEditingEvent(event);
    setPosterPreview(event.posterUrl || '');
    setPosterPosition(event.posterPosition || null);
    setFormData({
      title: event.title, description: event.description || '', posterUrl: event.posterUrl || '',
      startAt: formatInTimeZone(new Date(event.startAt), PARIS_TIMEZONE, "yyyy-MM-dd'T'HH:mm"),
      endAt: formatInTimeZone(new Date(event.endAt), PARIS_TIMEZONE, "yyyy-MM-dd'T'HH:mm"),
      isActive: event.isActive,
      musicGenres: (event as any).musicGenres || ['Open Format'],
      eventType: (event as any).eventType || 'club',
    });
    const { data: eventDjs } = await supabase.from('event_djs').select('dj_id').eq('event_id', event.id);
    setLineupDJIds((eventDjs || []).map(ed => ed.dj_id));
    const { data: mdRow } = await supabase.from('events').select('minors_disabled').eq('id', event.id).maybeSingle();
    setMinorsDisabled((mdRow as any)?.minors_disabled ?? false);
    if (isOrganizerScope) {
      const { data: ev } = await supabase
        .from('events')
        .select('event_kind, partner_venue_id, event_mode, location_name, location_city, location_address, location_is_secret')
        .eq('id', event.id)
        .maybeSingle();
      if (ev) {
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
        setLocationIsSecret(!!(ev as any).location_is_secret);
        setRevealAddressInEmail((ev as any).reveal_address_in_email !== false);
      }
    }
    setIsDialogOpen(true);
  };

  const resetForm = () => {
    setEditingEvent(null); setPosterFile(null); setPosterPreview(''); setPosterPosition(null); setLineupDJIds([]);
    setFormData({ title: '', description: '', posterUrl: '', startAt: '', endAt: '', isActive: true, musicGenres: ['Open Format'], eventType: 'club' });
    setEventKind('public_event'); setCollabMode('solo'); setPartnerVenueId('');
    setLocationName(''); setLocationCity(''); setLocationAddress(''); setLocationIsSecret(false); setRevealAddressInEmail(true); setMinorsDisabled(false);
  };

  const handlePosterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPosterFile(file);
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
    <div className={isOrganizerScope ? 'pb-28' : 'min-h-screen pb-28'} style={isOrganizerScope ? undefined : { background: '#000' }}>
      {!isOrganizerScope && (
        <div className="fixed inset-0 pointer-events-none z-0"
          style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.025),transparent 55%)' }} />
      )}

      {!isOrganizerScope && <OwnerHeader title={t('owner.eventsTitle')} />}

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 pt-2 space-y-4">
        {isOrganizerScope && (
          <h1 style={{ color: T1, fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em', marginTop: 4 }}>{t('owner.eventsTitle')}</h1>
        )}
        {collabReadOnly && <CollabActivateBanner />}
        {collabReadOnly && <CollabReadOnlyBanner action={t('collab.action.createEvent')} />}

        {orgSellingBlocked && (
          <div
            className="flex items-center gap-3 rounded-xl px-4 py-3"
            style={{ background: 'rgba(232,25,44,0.10)', border: '1px solid rgba(232,25,44,0.30)' }}
          >
            <Lock className="w-4 h-4 shrink-0" style={{ color: '#E8192C' }} />
            <p className="text-[12.5px] flex-1" style={{ color: T1 }}>
              {stripeStatus === 'pending'
                ? t('owner.ev.stripePendingBanner')
                : t('owner.ev.stripeNotConfiguredBanner')}
            </p>
            <button
              onClick={() => navigate(`${basePath}/payments`)}
              className="text-[12.5px] font-medium px-3 py-1.5 rounded-lg cursor-pointer shrink-0"
              style={{ background: 'rgba(232,25,44,0.16)', border: '1px solid rgba(232,25,44,0.32)', color: '#fff' }}
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
                  ? { background: 'rgba(232,25,44,0.14)', border: '1px solid rgba(232,25,44,0.32)', color: '#fff' }
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
              <Calendar className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.12)' }} />
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
      <Dialog open={isDialogOpen} onOpenChange={(open) => { if (!open) { setIsDialogOpen(false); resetForm(); } else setIsDialogOpen(true); }}>
        <DialogContent className="border-0 p-0 overflow-hidden max-h-[90vh] overflow-y-auto"
          style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 18, maxWidth: 600 }}>
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
                  onRemove={() => { setPosterFile(null); setPosterPreview(''); setPosterPosition(null); setFormData({ ...formData, posterUrl: '' }); }}
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
                  <option value="club" style={{ background: '#0a0a0c' }}>Club</option>
                  <option value="after_party" style={{ background: '#0a0a0c' }}>After Party</option>
                  <option value="beach_club" style={{ background: '#0a0a0c' }}>Beach Club</option>
                  <option value="open_air" style={{ background: '#0a0a0c' }}>Open Air</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: T3 }} />
              </div>
            </div>

            {/* DJ Lineup */}
            <DJLineupSelector eventId={editingEvent?.id} selectedDJIds={lineupDJIds} onChange={setLineupDJIds} />

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

            {isOrganizerScope && eventKind === 'public_event' && (
              <div className="rounded-xl p-4" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                <FieldLabel>{t('owner.ev.collabMode')}</FieldLabel>
                <div className="space-y-2">
                  <EventSelectCard selected={collabMode === 'solo'} onClick={() => setCollabMode('solo')} icon={Sparkles}
                    title={t('owner.ev.soloTitle')} description={t('owner.ev.soloDesc')} />
                  <EventSelectCard selected={collabMode === 'co_event'} onClick={() => setCollabMode('co_event')} icon={Users}
                    title={t('owner.ev.coEventTitle')} description={t('owner.ev.coEventDesc')} />
                  <EventSelectCard selected={collabMode === 'venue_rental'} onClick={() => setCollabMode('venue_rental')} icon={Building2}
                    title={t('owner.ev.venueRentalTitle')} description={t('owner.ev.venueRentalDesc')} />
                  <EventSelectCard selected={collabMode === 'hosted_by_venue'} onClick={() => setCollabMode('hosted_by_venue')} icon={Building2}
                    title={t('owner.ev.hostedByVenueTitle')} description={t('owner.ev.hostedByVenueDesc')} />
                </div>
              </div>
            )}

            {requiresPartner && (
              <div className="rounded-xl p-4" style={{ background: 'rgba(232,25,44,0.05)', border: '1px solid rgba(232,25,44,0.25)' }}>
                <FieldLabel>{t('owner.ev.partnerClub')}</FieldLabel>
                {activePartnerships.length === 0 ? (
                  <p style={{ color: T3, fontSize: 12.5 }}>{t('owner.ev.noPartnerships')}</p>
                ) : (
                  <div className="relative">
                    <select value={partnerVenueId} onChange={(e) => setPartnerVenueId(e.target.value)}
                      className="w-full appearance-none px-3 py-2.5 rounded-xl text-[13px] cursor-pointer"
                      style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: partnerVenueId ? T1 : T3, outline: 'none' }}>
                      <option value="" style={{ background: '#0a0a0c' }}>{t('owner.ev.selectClub')}</option>
                      {activePartnerships.map((p) => (
                        <option key={p.id} value={p.venue_id} style={{ background: '#0a0a0c' }}>
                          {p.venue?.name ?? p.venue_id}{p.venue?.city ? ` · ${p.venue.city}` : ''}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: T3 }} />
                  </div>
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
                    {locationIsSecret && <Check className="h-3.5 w-3.5 text-white" />}
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
                    <input value={locationAddress} onChange={(e) => setLocationAddress(e.target.value)} disabled={lockedToPartner} placeholder={t('owner.ev.addressPlaceholder')}
                      className="w-full px-3 py-2.5 rounded-xl text-[13px] disabled:opacity-50" style={inputStyle} />
                  </div>
                </div>
              );
            })()}

            {/* Active toggle — blocked for organizers who haven't connected Stripe */}
            <div
              className="flex items-center justify-between p-4 rounded-xl"
              style={{
                background: INNER_BG,
                border: `1px solid ${orgSellingBlocked ? 'rgba(232,25,44,0.18)' : BORDER}`,
                opacity: orgSellingBlocked ? 0.75 : 1,
              }}
            >
              <div>
                <p style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{t('owner.activeEvent')}</p>
                {orgSellingBlocked ? (
                  <p style={{ color: '#E8192C', fontSize: 11.5, marginTop: 2 }}>
                    {t('owner.ev.stripeRequiredForLive')}
                  </p>
                ) : (
                  <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>{t('owner.ev.visibleInApp')}</p>
                )}
              </div>
              <Switch
                id="isActive"
                checked={orgSellingBlocked ? false : formData.isActive}
                disabled={orgSellingBlocked}
                onCheckedChange={(checked) => {
                  if (orgSellingBlocked) return;
                  setFormData({ ...formData, isActive: checked });
                }}
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
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Event Card ────────────────────────────────────────────────────────────────
const RED_C = '#E8192C';
const GUEST_C = '#34D399';
const T1_C  = 'rgba(255,255,255,0.96)';
const T2_C  = 'rgba(255,255,255,0.58)';
const T3_C  = 'rgba(255,255,255,0.36)';
const C_FAINT_C = 'rgba(255,255,255,0.06)';
const BORDER_C  = 'rgba(255,255,255,0.085)';
const CARD_BG_C = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW_C = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

function EventCard({ event, onEdit, onDelete, onToggle, onToggleTicketing, onToggleTables, onToggleGuestList, onApplyPreset, onApplyGuestListPreset, presets, guestPresets, onNavigate, onDetails, basePath, t, ownerKind, venueId, organizerUserId }: {
  event: OwnerEventRow;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onToggleTicketing: () => Promise<boolean>;
  onToggleTables: () => Promise<boolean>;
  onToggleGuestList: () => Promise<boolean>;
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
    const url = `${window.location.origin}/event/${event.id}`;
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
                style={{ background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.25)', color: '#34D399' }}>
                <span className="w-1.5 h-1.5 rounded-full bg-[#34D399] inline-block" />
                {t('owner.active')}
              </span>
            )}
            {event.isPartnerHosted && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
                style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)', color: '#FCD34D' }}>
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
            <span style={{ color: 'rgba(255,255,255,0.2)' }}>·</span>
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
                <p style={{ color: T3_C, fontSize: 10.5 }} className="truncate">{`${window.location.origin}/event/${event.id}`}</p>
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
                <Ticket className="w-4 h-4 flex-shrink-0" style={{ color: event.ticketingEnabled ? '#FF7A82' : T3_C }} />
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
                <Crown className="w-4 h-4 flex-shrink-0" style={{ color: event.tablesEnabled ? '#FCD34D' : T3_C }} />
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
                <Users className="w-4 h-4 flex-shrink-0" style={{ color: event.guestListEnabled ? '#34D399' : T3_C }} />
                <div className="min-w-0">
                  <p style={{ color: T1_C, fontSize: 12.5, fontWeight: 560 }} className="truncate">{t('owner.ev.guestList')}</p>
                  <p style={{ color: T3_C, fontSize: 10.5 }} className="truncate">{event.guestListEnabled ? t('owner.ev.online') : t('owner.ev.offline')}</p>
                </div>
              </div>
              <Switch checked={!!event.guestListEnabled} onCheckedChange={handleGuestListClick} />
            </div>
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
                            style={{ background: '#0a0a0c', border: `1px solid ${BORDER_C}`, color: T1_C, outline: 'none' }}>
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
                            style={{ background: '#0a0a0c', border: `1px solid ${BORDER_C}`, color: T1_C, outline: 'none' }}>
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
      <div className="flex items-center gap-2 px-5 pb-4 flex-wrap" style={{ borderTop: `1px solid rgba(255,255,255,0.04)`, paddingTop: 12, marginTop: 12 }}>
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
              style={{ background: C_FAINT_C, border: `1px solid ${BORDER_C}`, color: event.isActive ? '#34D399' : T2_C }}
            >
              {event.isActive ? t('owner.deactivate') : t('owner.activate')}
            </button>
            <button
              onClick={onDelete}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer transition-all duration-150"
              style={{ background: 'rgba(232,25,44,0.08)', border: '1px solid rgba(232,25,44,0.2)', color: '#FF5C63' }}
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
  selected: boolean; onClick: () => void; icon: any; title: string; description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-all duration-150"
      style={selected
        ? { background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.35)' }
        : { background: 'rgba(255,255,255,0.018)', border: `1px solid ${BORDER_C}` }}
    >
      <span className="mt-0.5 h-4 w-4 rounded-full flex items-center justify-center flex-shrink-0 transition-all"
        style={selected ? { border: `1px solid ${RED_C}` } : { border: '1px solid rgba(255,255,255,0.25)' }}>
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
