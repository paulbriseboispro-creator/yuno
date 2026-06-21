import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { notifyDjLineup } from '@/lib/djNotify';
import type { TablesUpdate } from '@/integrations/supabase/types';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { useOrganizerPartnerships } from '@/hooks/useOrganizerPartnerships';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  Upload,
  Music,
  Tag,
  Eye,
  Lock,
  Building2,
  Users,
  Sparkles,
  Loader2,
  ChevronDown,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { PosterCropper, PosterPosition } from '@/components/PosterCropper';
import { DJLineupSelector } from '@/components/dj/DJLineupSelector';
import { fromParisTime } from '@/lib/timezone';
import { formatInTimeZone } from 'date-fns-tz';
import { PARIS_TIMEZONE } from '@/lib/timezone';

// ─── Yuno Design Tokens (aligned with the Owner dashboard DA) ──────────────────
const RED      = '#E8192C';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';

type EventKind = 'public_event' | 'private_event';
type CollabMode = 'solo' | 'co_event' | 'venue_rental' | 'hosted_by_venue';

const MUSIC_GENRES = [
  'House',
  'Techno',
  'Rap / Hip-Hop',
  'Afro / Shatta',
  'Reggaeton / Latino',
  'Commercial / Hits',
  'Electro / EDM',
  'Open Format',
];

const EVENT_TYPES = [
  { value: 'club', label: 'Club' },
  { value: 'after_party', label: 'After Party' },
  { value: 'beach_club', label: 'Beach Club' },
  { value: 'open_air', label: 'Open Air' },
  { value: 'private_party', label: 'Soirée privée' },
];

// ─── Styled primitives ─────────────────────────────────────────────────────────
function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 6 }}>
      {children}
    </p>
  );
}

function DarkInput({
  id, value, onChange, placeholder, type = 'text', required, disabled,
}: {
  id?: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; required?: boolean; disabled?: boolean;
}) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      required={required}
      disabled={disabled}
      className="w-full px-3 py-2.5 rounded-xl text-[13px] transition-all duration-150 disabled:opacity-50"
      style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, outline: 'none' }}
      onFocus={(e) => { if (!disabled) e.target.style.borderColor = 'rgba(255,255,255,0.18)'; }}
      onBlur={(e) => (e.target.style.borderColor = BORDER)}
    />
  );
}

function DarkTextarea({
  id, value, onChange, placeholder, rows = 3,
}: {
  id?: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number;
}) {
  return (
    <textarea
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full px-3 py-2.5 rounded-xl text-[13px] resize-none transition-all duration-150"
      style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, outline: 'none' }}
      onFocus={(e) => (e.target.style.borderColor = 'rgba(255,255,255,0.18)')}
      onBlur={(e) => (e.target.style.borderColor = BORDER)}
    />
  );
}

function DarkSelect({
  id, value, onChange, children, placeholder,
}: {
  id?: string; value: string; onChange: (v: string) => void; children: React.ReactNode; placeholder?: string;
}) {
  return (
    <div className="relative">
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none px-3 py-2.5 rounded-xl text-[13px] cursor-pointer"
        style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: value ? T1 : T3, outline: 'none' }}
      >
        {placeholder && <option value="" disabled style={{ background: '#0a0a0c' }}>{placeholder}</option>}
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: T3 }} />
    </div>
  );
}

interface OrgEventFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizerUserId: string;
  eventId?: string | null;
  onSaved?: () => void;
}

export function OrgEventFormDialog({
  open,
  onOpenChange,
  organizerUserId,
  eventId,
  onSaved,
}: OrgEventFormDialogProps) {
  const { language } = useLanguage();
  const { partnerships } = useOrganizerPartnerships();
  const activePartnerships = partnerships.filter((p) => p.status === 'active');
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Core fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [locationName, setLocationName] = useState('');
  const [locationCity, setLocationCity] = useState('');
  const [locationAddress, setLocationAddress] = useState('');
  /** Private events only: hide the exact venue / city / address from the public page. */
  const [locationIsSecret, setLocationIsSecret] = useState(false);
  /** Private events only: hide the top "back to Yuno" button so visitors stay on the event page. */
  const [hideYunoNavigation, setHideYunoNavigation] = useState(false);
  const [isActive, setIsActive] = useState(true);

  // Metadata (Yuno standard)
  const [musicGenres, setMusicGenres] = useState<string[]>(['Open Format']);
  const [eventType, setEventType] = useState<string>('club');
  const [lineupDJIds, setLineupDJIds] = useState<string[]>([]);

  // Org-specific
  const [eventKind, setEventKind] = useState<EventKind>('public_event');
  const [collabMode, setCollabMode] = useState<CollabMode>('solo');
  const [partnerVenueId, setPartnerVenueId] = useState<string>('');

  // Visuals — events use a single 1:1 square photo (poster)
  const [posterFile, setPosterFile] = useState<File | null>(null);
  const [posterPreview, setPosterPreview] = useState<string>('');
  const [posterPosition, setPosterPosition] = useState<PosterPosition | null>(null);

  const isEdit = !!eventId;
  const requiresPartner = eventKind === 'public_event' && collabMode !== 'solo';

  // Reset on open
  useEffect(() => {
    if (!open) return;
    if (!eventId) {
      // Reset all fields for create
      setTitle('');
      setDescription('');
      setStartAt('');
      setEndAt('');
      setLocationName('');
      setLocationCity('');
      setLocationAddress('');
      setLocationIsSecret(false);
      setHideYunoNavigation(false);
      setIsActive(true);
      setMusicGenres(['Open Format']);
      setEventType('club');
      setLineupDJIds([]);
      setEventKind('public_event');
      setCollabMode('solo');
      setPartnerVenueId('');
      setPosterFile(null);
      setPosterPreview('');
      setPosterPosition(null);
      return;
    }
    // Load existing event
    (async () => {
      setLoading(true);
      const { data: ev } = await supabase
        .from('events')
        .select('*')
        .eq('id', eventId)
        .maybeSingle();
      if (ev) {
        setTitle(ev.title || '');
        setDescription(ev.description || '');
        setStartAt(formatInTimeZone(ev.start_at, PARIS_TIMEZONE, "yyyy-MM-dd'T'HH:mm"));
        setEndAt(formatInTimeZone(ev.end_at, PARIS_TIMEZONE, "yyyy-MM-dd'T'HH:mm"));
        setLocationName(ev.location_name || '');
        setLocationCity(ev.location_city || '');
        setLocationAddress(ev.location_address || '');
        setLocationIsSecret(!!(ev as any).location_is_secret);
        setHideYunoNavigation(!!(ev as any).hide_yuno_navigation);
        setIsActive(ev.is_active);
        setMusicGenres(
          (ev as any).music_genres?.length ? (ev as any).music_genres : [(ev as any).music_genre || 'Open Format']
        );
        setEventType((ev as any).event_type || 'club');
        const evKind = (ev.event_kind as string) || 'public_event';
        setEventKind(evKind === 'private_event' ? 'private_event' : 'public_event');
        setPartnerVenueId(ev.partner_venue_id || '');
        if (ev.partner_venue_id) {
          // Best-effort infer collab mode from event_mode
          const evMode = (ev.event_mode as string) || '';
          if (evMode === 'co_event') setCollabMode('co_event');
          else if (evMode === 'venue_rental') setCollabMode('venue_rental');
          else if (evMode === 'hosted_by_venue' || evMode === 'org_hosted') setCollabMode('hosted_by_venue');
          else setCollabMode('co_event');
        } else {
          setCollabMode('solo');
        }
        setPosterPreview(ev.poster_url || '');
        setPosterPosition((ev.poster_position as any) || null);

        // DJ lineup
        const { data: djs } = await supabase
          .from('event_djs')
          .select('dj_id')
          .eq('event_id', eventId);
        setLineupDJIds((djs || []).map((d) => d.dj_id));
      }
      setLoading(false);
    })();
  }, [open, eventId]);

  const handlePosterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPosterFile(file);
    setPosterPreview(URL.createObjectURL(file));
    setPosterPosition(null);
  };

  const uploadImage = async (file: File): Promise<string | null> => {
    // Events use a single 1:1 square photo, stored in the 'event-posters' bucket.
    // Path is scoped to the organizer's user id so RLS allows the upload.
    const bucket = 'event-posters';
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const path = `${organizerUserId}/${Date.now()}-poster.${ext}`;
    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, file, { upsert: false, contentType: file.type });
    if (error) {
      console.error('Upload error:', error);
      toast.error(error.message || t('Erreur upload image', 'Image upload error'));
      return null;
    }
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !startAt || !endAt) {
      toast.error(t('Titre et dates requis', 'Title and dates required'));
      return;
    }
    if (musicGenres.length === 0) {
      toast.error(t('Sélectionne au moins un genre musical', 'Select at least one music genre'));
      return;
    }
    if (requiresPartner && !partnerVenueId) {
      toast.error(t('Sélectionne un club partenaire', 'Select a partner club'));
      return;
    }

    const parsedStart = new Date(startAt);
    const parsedEnd = new Date(endAt);
    if (parsedEnd <= parsedStart) {
      toast.error(t('La fin doit être après le début', 'End must be after start'));
      return;
    }

    setSaving(true);
    try {
      // Sanitize previews: never persist blob: or data: URLs (they're local-only and break on reload)
      const sanitize = (url: string) => (url && (url.startsWith('blob:') || url.startsWith('data:')) ? '' : url);
      let posterUrl = sanitize(posterPreview);

      if (posterFile) {
        const url = await uploadImage(posterFile);
        if (url) posterUrl = url;
        else {
          setSaving(false);
          return; // upload failed, abort save to avoid persisting blob URL
        }
      }

      const startAtUTC = fromParisTime(startAt).toISOString();
      const endAtUTC = fromParisTime(endAt).toISOString();

      const visibility = eventKind === 'private_event' ? 'private' : 'public';
      // The DB trigger evaluate_event_discoverability() recomputes is_discoverable / discovery_status
      // server-side based on quality criteria (poster + title + description + future date + active).
      // We optimistically mark public events as approved so they appear immediately in Explore once the trigger validates them.
      const isDiscoverable = eventKind === 'public_event';
      const discoveryStatus = eventKind === 'public_event' ? 'approved' : 'approved';

      const payload: Record<string, any> = {
        organizer_user_id: organizerUserId,
        title: title.trim(),
        description: description.trim() || null,
        poster_url: posterUrl || null,
        poster_position: posterPosition
          ? { x: posterPosition.x, y: posterPosition.y, scale: posterPosition.scale }
          : null,
        start_at: startAtUTC,
        end_at: endAtUTC,
        location_name: locationName.trim() || null,
        location_city: locationCity.trim() || null,
        location_address: locationAddress.trim() || null,
        location_is_secret: eventKind === 'private_event' ? locationIsSecret : false,
        hide_yuno_navigation: eventKind === 'private_event' ? hideYunoNavigation : false,
        is_active: isActive,
        music_genres: musicGenres,
        event_type: eventType,
        event_kind: eventKind,
        visibility,
        is_discoverable: isDiscoverable,
        discovery_status: discoveryStatus,
      };

      if (requiresPartner) {
        payload.partner_venue_id = partnerVenueId;
        payload.event_mode =
          collabMode === 'co_event'
            ? 'co_event'
            : collabMode === 'venue_rental'
            ? 'venue_rental'
            : 'org_hosted';
      } else {
        payload.partner_venue_id = null;
        payload.event_mode = 'solo_organizer';
      }

      let savedId = eventId;
      if (isEdit && eventId) {
        const { error } = await supabase.from('events').update(payload as TablesUpdate<'events'>).eq('id', eventId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('events')
          .insert(payload as any)
          .select('id')
          .single();
        if (error) throw error;
        savedId = data.id;
      }

      // Sync DJ lineup
      if (savedId) {
        await supabase.from('event_djs').delete().eq('event_id', savedId);
        if (lineupDJIds.length > 0) {
          await supabase
            .from('event_djs')
            .insert(lineupDJIds.map((djId) => ({ event_id: savedId!, dj_id: djId })));
          notifyDjLineup(savedId, lineupDJIds);
        }
      }

      toast.success(isEdit ? t('Événement mis à jour', 'Event updated') : t('Événement créé', 'Event created'));
      onOpenChange(false);
      onSaved?.();
    } catch (err: any) {
      console.error('Save event error:', err, { code: err?.code, details: err?.details, hint: err?.hint });
      const detail = err?.message || err?.error_description || err?.details || t('Erreur inconnue', 'Unknown error');
      toast.error(t("Impossible de créer l'événement", 'Could not create event'), {
        description: detail,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="border-0 p-0 overflow-hidden max-h-[90vh] overflow-y-auto"
        style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 18, maxWidth: 600 }}
      >
        <DialogHeader className="px-6 pt-6 pb-0">
          <DialogTitle style={{ color: T1, fontSize: 15.5, fontWeight: 600 }}>
            {isEdit ? t("Modifier l'événement", 'Edit event') : t('Créer un événement', 'Create event')}
          </DialogTitle>
          <DialogDescription style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>
            {t(
              'Photo carrée, métadonnées musicales et créneau Paris.',
              'Square photo, music metadata and Paris timezone.'
            )}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-16 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin" style={{ color: T3 }} />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {/* Poster — single 1:1 square photo */}
            <div>
              <FieldLabel>{t('Photo (1:1)', 'Photo (1:1)')}</FieldLabel>
              {posterPreview ? (
                <PosterCropper
                  imageUrl={posterPreview}
                  initialPosition={posterPosition || undefined}
                  onPositionChange={setPosterPosition}
                  onRemove={() => {
                    setPosterFile(null);
                    setPosterPreview('');
                    setPosterPosition(null);
                  }}
                />
              ) : (
                <div className="space-y-2">
                  <input id="poster-input" type="file" accept="image/*" onChange={handlePosterChange} className="hidden" />
                  <button
                    type="button"
                    onClick={() => document.getElementById('poster-input')?.click()}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-medium cursor-pointer transition-all duration-150"
                    style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}
                  >
                    <Upload className="w-4 h-4" />
                    {t('Ajouter une affiche', 'Add poster')}
                  </button>
                </div>
              )}
            </div>

            {/* Title */}
            <div>
              <FieldLabel>{t("Titre de l'événement", 'Event title')} *</FieldLabel>
              <DarkInput value={title} onChange={setTitle} placeholder={t('Ex: Closing Party', 'Ex: Closing Party')} required />
            </div>

            {/* Description */}
            <div>
              <FieldLabel>{t('Description', 'Description')}</FieldLabel>
              <DarkTextarea value={description} onChange={setDescription} rows={3} />
            </div>

            {/* Music genres */}
            <div>
              <FieldLabel>
                <Music className="w-3 h-3 inline mr-1" />
                {t('Genres musicaux', 'Music genres')} *
              </FieldLabel>
              <div className="flex flex-wrap gap-2">
                {MUSIC_GENRES.map((g) => {
                  const selected = musicGenres.includes(g);
                  return (
                    <button
                      key={g}
                      type="button"
                      onClick={() => {
                        const next = selected ? musicGenres.filter((x) => x !== g) : [...musicGenres, g];
                        setMusicGenres(next.length > 0 ? next : [g]);
                      }}
                      className="rounded-full px-3 py-1.5 text-[12px] font-medium cursor-pointer transition-all duration-150"
                      style={selected
                        ? { background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.3)', color: RED }
                        : { background: INNER_BG, border: `1px solid ${BORDER}`, color: T3 }
                      }
                    >
                      {g}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Event type */}
            <div>
              <FieldLabel>
                <Tag className="w-3 h-3 inline mr-1" />
                {t("Type d'événement", 'Event type')} *
              </FieldLabel>
              <DarkSelect value={eventType} onChange={setEventType}>
                {EVENT_TYPES.map((opt) => (
                  <option key={opt.value} value={opt.value} style={{ background: '#0a0a0c' }}>
                    {opt.label}
                  </option>
                ))}
              </DarkSelect>
            </div>

            {/* DJ lineup */}
            <DJLineupSelector
              eventId={eventId || undefined}
              selectedDJIds={lineupDJIds}
              onChange={setLineupDJIds}
            />

            {/* Dates */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <FieldLabel>{t('Début (heure de Paris)', 'Start (Paris time)')} *</FieldLabel>
                <DarkInput id="start" type="datetime-local" value={startAt} onChange={setStartAt} required />
              </div>
              <div>
                <FieldLabel>{t('Fin (heure de Paris)', 'End (Paris time)')} *</FieldLabel>
                <DarkInput id="end" type="datetime-local" value={endAt} onChange={setEndAt} required />
              </div>
            </div>

            {/* Event kind */}
            <div className="rounded-xl p-4" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
              <FieldLabel>{t("Visibilité de l'événement", 'Event visibility')} *</FieldLabel>
              <div className="space-y-2">
                <SelectCard
                  selected={eventKind === 'public_event'}
                  onClick={() => setEventKind('public_event')}
                  icon={Eye}
                  title={t('Public', 'Public')}
                  description={t(
                    'Ouvert à tous, peut apparaître dans Yuno Explore.',
                    'Open to all, may appear in Yuno Explore.'
                  )}
                />
                <SelectCard
                  selected={eventKind === 'private_event'}
                  onClick={() => setEventKind('private_event')}
                  icon={Lock}
                  title={t('Privé', 'Private')}
                  description={t(
                    'Accessible uniquement par lien direct, non listé dans Yuno Explore.',
                    'Accessible by direct link only, not listed in Yuno Explore.'
                  )}
                />
              </div>
            </div>

            {/* Collab mode */}
            {eventKind === 'public_event' && (
              <div className="rounded-xl p-4" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                <FieldLabel>{t('Mode de collaboration', 'Collaboration mode')} *</FieldLabel>
                <div className="space-y-2">
                  <SelectCard
                    selected={collabMode === 'solo'}
                    onClick={() => setCollabMode('solo')}
                    icon={Sparkles}
                    title={t('Solo orga', 'Solo organizer')}
                    description={t(
                      "Tu portes l'événement seul·e (lieu loué hors Yuno).",
                      'You run the event on your own (off-platform venue).'
                    )}
                  />
                  <SelectCard
                    selected={collabMode === 'co_event'}
                    onClick={() => setCollabMode('co_event')}
                    icon={Users}
                    title={t('Co-event avec un club', 'Co-event with a club')}
                    description={t(
                      'Co-organisé avec un club partenaire — split revenu personnalisable.',
                      'Co-organized with a partner club — customizable revenue split.'
                    )}
                  />
                  <SelectCard
                    selected={collabMode === 'venue_rental'}
                    onClick={() => setCollabMode('venue_rental')}
                    icon={Building2}
                    title={t('Location de salle', 'Venue rental')}
                    description={t(
                      'Tu loues le club, tu encaisses tout (sauf boissons).',
                      'You rent the club venue and keep all revenue (except drinks).'
                    )}
                  />
                  <SelectCard
                    selected={collabMode === 'hosted_by_venue'}
                    onClick={() => setCollabMode('hosted_by_venue')}
                    icon={Building2}
                    title={t('Hébergé par le club', 'Hosted by the club')}
                    description={t(
                      'Le club gère la billetterie, tu apportes la programmation.',
                      'The club runs ticketing, you bring the programming.'
                    )}
                  />
                </div>
              </div>
            )}

            {/* Partner venue */}
            {requiresPartner && (
              <div className="rounded-xl p-4" style={{ background: 'rgba(232,25,44,0.05)', border: '1px solid rgba(232,25,44,0.25)' }}>
                <FieldLabel>{t('Club partenaire', 'Partner club')} *</FieldLabel>
                {activePartnerships.length === 0 ? (
                  <p style={{ color: T3, fontSize: 12.5 }}>
                    {t(
                      "Aucun partenariat actif. Va dans 'Clubs partenaires' pour en créer un.",
                      "No active partnership. Go to 'Partner clubs' to create one."
                    )}
                  </p>
                ) : (
                  <DarkSelect
                    value={partnerVenueId}
                    onChange={setPartnerVenueId}
                    placeholder={t('Sélectionne un club', 'Select a club')}
                  >
                    {activePartnerships.map((p) => (
                      <option key={p.id} value={p.venue_id} style={{ background: '#0a0a0c' }}>
                        {p.venue?.name ?? p.venue_id}
                        {p.venue?.city ? ` · ${p.venue.city}` : ''}
                      </option>
                    ))}
                  </DarkSelect>
                )}
              </div>
            )}

            {/* Secret location toggle (private events only) */}
            {eventKind === 'private_event' && (
              <button
                type="button"
                onClick={() => setLocationIsSecret(!locationIsSecret)}
                className="w-full text-left rounded-xl p-4 transition-all duration-150"
                style={{ background: 'rgba(232,25,44,0.05)', border: '1px solid rgba(232,25,44,0.25)' }}
              >
                <div className="flex items-start gap-3">
                  <span
                    className="mt-0.5 h-5 w-5 rounded-md flex items-center justify-center flex-shrink-0 transition-all"
                    style={locationIsSecret
                      ? { background: RED, border: `1px solid ${RED}` }
                      : { background: INNER_BG, border: `1px solid ${BORDER}` }
                    }
                  >
                    {locationIsSecret && <Check className="h-3.5 w-3.5 text-white" />}
                  </span>
                  <div className="flex-1">
                    <p style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{t('Lieu secret', 'Secret location')}</p>
                    <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>
                      {t(
                        "Cache le nom du lieu, la ville et l'adresse sur la page publique. Révélés uniquement aux participants confirmés (e-mail / push).",
                        'Hide the venue name, city and address on the public page. Revealed only to confirmed attendees (email / push).'
                      )}
                    </p>
                  </div>
                </div>
              </button>
            )}

            {/* Lock visitors to the event page (private events only) */}
            {eventKind === 'private_event' && (
              <button
                type="button"
                onClick={() => setHideYunoNavigation(!hideYunoNavigation)}
                className="w-full text-left rounded-xl p-4 transition-all duration-150"
                style={{ background: 'rgba(232,25,44,0.05)', border: '1px solid rgba(232,25,44,0.25)' }}
              >
                <div className="flex items-start gap-3">
                  <span
                    className="mt-0.5 h-5 w-5 rounded-md flex items-center justify-center flex-shrink-0 transition-all"
                    style={hideYunoNavigation
                      ? { background: RED, border: `1px solid ${RED}` }
                      : { background: INNER_BG, border: `1px solid ${BORDER}` }
                    }
                  >
                    {hideYunoNavigation && <Check className="h-3.5 w-3.5 text-white" />}
                  </span>
                  <div className="flex-1">
                    <p style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{t('Garder les visiteurs sur la page', 'Keep visitors on the page')}</p>
                    <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>
                      {t(
                        "Masque le bouton de retour en haut de la page : les visiteurs restent sur l'événement et ne peuvent pas naviguer vers l'accueil Yuno.",
                        'Hide the back button at the top of the page: visitors stay on the event and can\'t navigate out to the Yuno homepage.'
                      )}
                    </p>
                  </div>
                </div>
              </button>
            )}

            {/* Location — auto-filled & locked when a partner venue is selected */}
            {(() => {
              const selectedPartner = activePartnerships.find((p) => p.venue_id === partnerVenueId);
              const lockedToPartner = requiresPartner && !!selectedPartner;
              const displayName = lockedToPartner ? (selectedPartner!.venue?.name ?? '') : locationName;
              const displayCity = lockedToPartner ? (selectedPartner!.venue?.city ?? '') : locationCity;
              const displayAddress = lockedToPartner ? (locationAddress || '') : locationAddress;
              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {lockedToPartner && (
                    <p className="sm:col-span-2" style={{ color: T3, fontSize: 11.5, fontStyle: 'italic', marginBottom: -4 }}>
                      {t(
                        'Lieu et adresse récupérés automatiquement depuis le club partenaire.',
                        'Venue and address are automatically pulled from the partner club.'
                      )}
                    </p>
                  )}
                  <div>
                    <FieldLabel>{t('Lieu', 'Venue')}</FieldLabel>
                    <DarkInput
                      id="loc-name"
                      value={displayName}
                      onChange={setLocationName}
                      placeholder={t('Ex: Salle des fêtes', 'Ex: Main hall')}
                      disabled={lockedToPartner}
                    />
                  </div>
                  <div>
                    <FieldLabel>{t('Ville', 'City')}</FieldLabel>
                    <DarkInput
                      id="loc-city"
                      value={displayCity}
                      onChange={setLocationCity}
                      placeholder="Paris"
                      disabled={lockedToPartner}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <FieldLabel>{t('Adresse', 'Address')}</FieldLabel>
                    <DarkInput
                      id="loc-addr"
                      value={displayAddress}
                      onChange={setLocationAddress}
                      placeholder="12 rue de Rivoli"
                      disabled={lockedToPartner}
                    />
                  </div>
                </div>
              );
            })()}

            {/* Active toggle */}
            <button
              type="button"
              onClick={() => setIsActive(!isActive)}
              className="w-full flex items-center justify-between p-4 rounded-xl transition-all duration-150"
              style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}
            >
              <div className="text-left">
                <p style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{t('Événement actif', 'Event active')}</p>
                <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>{t('Visible par les clients dans l\'app', 'Visible to customers in the app')}</p>
              </div>
              <span
                className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0"
                style={{ background: isActive ? RED : 'rgba(255,255,255,0.12)' }}
              >
                <span
                  className="inline-block h-5 w-5 transform rounded-full bg-white transition-transform"
                  style={{ transform: isActive ? 'translateX(22px)' : 'translateX(2px)' }}
                />
              </span>
            </button>

            {/* Discoverability warning — mirrors the server trigger that gates is_discoverable.
                Public events silently stay out of Explore unless they have a poster + a
                description of >= 30 chars. Without this notice the organizer toggles the
                event live, sees "Actif", and never learns why it isn't surfacing publicly. */}
            {eventKind === 'public_event' && (description.trim().length < 30 || !posterPreview) && (
              <div style={{ background: 'rgba(232,160,25,0.08)', border: '1px solid rgba(232,160,25,0.28)', borderRadius: 12, padding: '12px 14px' }}>
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: '#E8A019', marginTop: 1 }} />
                  <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                    <p style={{ color: T1, fontWeight: 600, marginBottom: 4 }}>
                      {t(
                        "Cet événement n'apparaîtra pas dans la découverte publique",
                        "This event won't appear in public discovery",
                        'Este evento no aparecerá en el descubrimiento público',
                      )}
                    </p>
                    <p style={{ color: T2, marginBottom: 6 }}>
                      {t('Pour être listé dans Explore, il manque :', 'To be listed in Explore, it still needs:', 'Para aparecer en Explore, todavía falta:')}
                    </p>
                    <ul style={{ color: T2, paddingLeft: 16, listStyleType: 'disc' }}>
                      {!posterPreview && <li>{t('une affiche', 'a poster', 'un cartel')}</li>}
                      {description.trim().length < 30 && (
                        <li>
                          {t(
                            `une description d'au moins 30 caractères (actuellement ${description.trim().length})`,
                            `a description of at least 30 characters (currently ${description.trim().length})`,
                            `una descripción de al menos 30 caracteres (actualmente ${description.trim().length})`,
                          )}
                        </li>
                      )}
                    </ul>
                    <p style={{ color: T3, marginTop: 6 }}>
                      {t(
                        'Il restera accessible via son lien direct, mais pas dans Explore.',
                        'It stays reachable via its direct link, but not in Explore.',
                        'Seguirá accesible por su enlace directo, pero no en Explore.',
                      )}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <button
                type="submit"
                disabled={saving}
                className="flex-1 py-3 rounded-xl text-[13.5px] font-semibold cursor-pointer transition-all duration-150 flex items-center justify-center gap-2"
                style={{ background: saving ? 'rgba(232,25,44,0.5)' : RED, color: '#fff', boxShadow: saving ? 'none' : `0 0 20px -6px ${RED}88` }}
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {isEdit ? t('Mettre à jour', 'Update') : t("Créer l'événement", 'Create event')}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => onOpenChange(false)}
                className="px-5 py-3 rounded-xl text-[13.5px] font-medium cursor-pointer transition-all duration-150"
                style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}
              >
                {t('Annuler', 'Cancel')}
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SelectCard({
  selected,
  onClick,
  icon: Icon,
  title,
  description,
}: {
  selected: boolean;
  onClick: () => void;
  icon: any;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-all duration-150"
      style={selected
        ? { background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.35)' }
        : { background: 'rgba(255,255,255,0.018)', border: `1px solid ${BORDER}` }
      }
    >
      <span
        className="mt-0.5 h-4 w-4 rounded-full flex items-center justify-center flex-shrink-0 transition-all"
        style={selected
          ? { border: `1px solid ${RED}` }
          : { border: '1px solid rgba(255,255,255,0.25)' }
        }
      >
        {selected && <span className="h-2 w-2 rounded-full" style={{ background: RED }} />}
      </span>
      <div className="flex-1">
        <div className="flex items-center gap-2" style={{ color: T1, fontSize: 13, fontWeight: 560 }}>
          <Icon className="h-4 w-4" style={{ color: selected ? RED : T3 }} />
          {title}
        </div>
        <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>{description}</p>
      </div>
    </button>
  );
}
