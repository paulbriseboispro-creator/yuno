import { useState, useEffect } from 'react';
import { KeyRound, Save, Music, Image as ImageIcon, Trash2, ArrowLeft, ArrowRight, Plus, Euro } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { makeDjT } from '@/i18n/djTranslate';
import { useDJData } from '@/contexts/DJDataContext';
import { ChangePinFlow } from '@/components/ChangePinFlow';
import { ProfilePhotoUpload } from '@/components/ProfilePhotoUpload';
import { DJShareCard } from '@/components/dj/DJShareCard';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  DJPage, DJHeading, PCard, FieldLabel,
  RED, T1, T2, T3, WARN, C_FAINT, BORDER, INNER_BG,
} from '@/components/dj/dj-ui';

const YUNO_MUSIC_GENRES = [
  'House', 'Techno', 'Rap / Hip-Hop', 'Afro / Shatta',
  'Reggaeton / Latino', 'Commercial / Hits', 'Electro / EDM', 'Open Format',
];

export default function DJProfile() {
  const { t, language } = useLanguage();
  const tt = makeDjT(language);
  const { dj, isProfileIncomplete, refetchProfiles, handle } = useDJData();

  const [saving, setSaving] = useState(false);

  // Booking rate card (per person, table dj_rate_card). Drives the marketplace price
  // filter + the rate shown to bookers. Money/commission is handled elsewhere.
  const [rateForm, setRateForm] = useState({ minFee: '', maxFee: '', currency: 'EUR', note: '', isPublic: true });
  const [rateBusy, setRateBusy] = useState(false);
  const [showChangePinFlow, setShowChangePinFlow] = useState(false);
  const [editForm, setEditForm] = useState({
    firstName: '', lastName: '', stageName: '', genres: '', whatsapp: '',
    instagram: '', tiktok: '', bio: '', soundcloud: '', spotify: '', youtube: '',
    city: '', country: '', description: '',
  });

  // Featured track (single audio file, played natively on the public page) — kept
  // separate from the main form because the audio uploads + persists immediately
  // (synced across all venue profiles by user_id), like the cover/profile photos.
  const [trackUrl, setTrackUrl] = useState<string | null>(null);
  const [trackTitle, setTrackTitle] = useState('');
  const [trackBusy, setTrackBusy] = useState(false);

  // Photo gallery (per person, table dj_photos).
  const [photos, setPhotos] = useState<{ id: string; url: string; sort_order: number }[]>([]);
  const [galleryBusy, setGalleryBusy] = useState(false);

  useEffect(() => {
    if (!dj) return;
    setEditForm({
      firstName: dj.first_name || '',
      lastName: dj.last_name || '',
      stageName: dj.stage_name || '',
      genres: (dj.music_genres || []).join(', '),
      whatsapp: dj.whatsapp_number || '',
      instagram: dj.instagram_url || '',
      tiktok: dj.tiktok_url || '',
      bio: dj.bio || '',
      soundcloud: dj.soundcloud_url || '',
      spotify: dj.spotify_url || '',
      youtube: dj.youtube_url || '',
      city: dj.city || '',
      country: dj.country || '',
      description: dj.description || '',
    });
    setTrackUrl(dj.featured_track_url || null);
    setTrackTitle(dj.featured_track_title || '');
    // Repopulate the form only when the active profile (venue) changes, not on
    // every dj object identity change — otherwise it would clobber in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dj?.id]);

  // Gallery is per person (user_id), independent of the active venue profile.
  useEffect(() => {
    if (dj?.user_id) loadPhotos(dj.user_id);
  }, [dj?.user_id]);

  // Rate card is per person (user_id).
  useEffect(() => {
    if (!dj?.user_id) return;
    (async () => {
      const { data } = await supabase
        .from('dj_rate_card')
        .select('min_fee, max_fee, currency, rate_note, is_public')
        .eq('user_id', dj.user_id)
        .maybeSingle();
      if (data) {
        setRateForm({
          minFee: data.min_fee != null ? String(data.min_fee) : '',
          maxFee: data.max_fee != null ? String(data.max_fee) : '',
          currency: data.currency || 'EUR',
          note: data.rate_note || '',
          isPublic: data.is_public ?? true,
        });
      }
    })();
  }, [dj?.user_id]);

  const loadPhotos = async (userId: string) => {
    const { data } = await supabase
      .from('dj_photos')
      .select('id, url, sort_order')
      .eq('user_id', userId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    setPhotos(data || []);
  };

  if (!dj) return null;
  const displayName = dj.stage_name || `${dj.first_name} ${dj.last_name}`;
  const BASE_URL = (import.meta.env.VITE_APP_BASE_URL as string | undefined) || 'https://yunoapp.eu';
  const publicSlug = handle || dj.slug;
  const epkUrl = publicSlug ? `${BASE_URL}/dj/${publicSlug}/epk` : undefined;

  const handleSave = async () => {
    if (!editForm.firstName || !editForm.lastName) {
      toast.error(t('dj.firstLastRequired'));
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('djs')
        .update({
          first_name: editForm.firstName,
          last_name: editForm.lastName,
          stage_name: editForm.stageName || null,
          music_genres: editForm.genres ? editForm.genres.split(',').map(g => g.trim()).filter(Boolean) : [],
          whatsapp_number: editForm.whatsapp || null,
          instagram_url: editForm.instagram || null,
          tiktok_url: editForm.tiktok || null,
          bio: editForm.bio || null,
          soundcloud_url: editForm.soundcloud || null,
          spotify_url: editForm.spotify || null,
          youtube_url: editForm.youtube || null,
          city: editForm.city || null,
          country: editForm.country || null,
          description: editForm.description || null,
          is_active: true,
        })
        .eq('id', dj.id);
      if (error) throw error;
      toast.success(t('dj.profileUpdated'));
      refetchProfiles();
    } catch (error) {
      console.error('Error saving:', error);
      toast.error(t('dj.saveError'));
    } finally {
      setSaving(false);
    }
  };

  // Track + gallery write by user_id so they show on ALL of the person's profiles.
  const persistTrack = async (url: string | null, title: string | null) => {
    const { error } = await supabase
      .from('djs')
      .update({ featured_track_url: url, featured_track_title: title })
      .eq('user_id', dj.user_id);
    if (error) { toast.error(t('dj.saveError')); return false; }
    refetchProfiles();
    return true;
  };

  const handleTrackUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('audio/')) { toast.error(t('dj.trackTypeError')); return; }
    if (file.size > 20 * 1024 * 1024) { toast.error(t('dj.trackSizeError')); return; }
    setTrackBusy(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `${dj.user_id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('dj-tracks').upload(path, file);
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from('dj-tracks').getPublicUrl(path);
      const title = trackTitle.trim() || file.name.replace(/\.[^.]+$/, '');
      setTrackUrl(publicUrl);
      setTrackTitle(title);
      await persistTrack(publicUrl, title || null);
      toast.success(t('dj.trackSaved'));
    } catch (err) {
      console.error('Track upload error:', err);
      toast.error(t('dj.saveError'));
    } finally {
      setTrackBusy(false);
    }
  };

  const removeTrack = async () => {
    setTrackUrl(null);
    setTrackTitle('');
    await persistTrack(null, null);
  };

  const saveRate = async () => {
    if (!dj) return;
    const min = rateForm.minFee ? Number(rateForm.minFee) : null;
    const max = rateForm.maxFee ? Number(rateForm.maxFee) : null;
    if (min != null && max != null && max < min) {
      toast.error(tt('Le max doit être ≥ au min', 'Max must be ≥ min', 'El máx debe ser ≥ al mín'));
      return;
    }
    setRateBusy(true);
    try {
      const { error } = await supabase.from('dj_rate_card').upsert({
        user_id: dj.user_id,
        min_fee: min,
        max_fee: max,
        currency: rateForm.currency || 'EUR',
        rate_note: rateForm.note || null,
        is_public: rateForm.isPublic,
      });
      if (error) throw error;
      toast.success(t('dj.profileUpdated'));
    } catch (error) {
      console.error('Error saving rate:', error);
      toast.error(t('dj.saveError'));
    } finally {
      setRateBusy(false);
    }
  };

  const addPhotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    setGalleryBusy(true);
    try {
      let order = photos.length;
      for (const file of files) {
        if (!file.type.startsWith('image/')) { toast.error(t('dj.photoTypeError')); continue; }
        if (file.size > 5 * 1024 * 1024) { toast.error(t('dj.photoSizeError')); continue; }
        const ext = file.name.split('.').pop();
        const path = `dj-gallery/${dj.user_id}/${Date.now()}-${order}.${ext}`;
        const { error: upErr } = await supabase.storage.from('profile-photos').upload(path, file);
        if (upErr) { console.error(upErr); continue; }
        const { data: { publicUrl } } = supabase.storage.from('profile-photos').getPublicUrl(path);
        await supabase.from('dj_photos').insert({ user_id: dj.user_id, url: publicUrl, sort_order: order });
        order += 1;
      }
      await loadPhotos(dj.user_id);
    } catch (err) {
      console.error('Gallery upload error:', err);
      toast.error(t('dj.saveError'));
    } finally {
      setGalleryBusy(false);
    }
  };

  const removePhoto = async (id: string) => {
    const { error } = await supabase.from('dj_photos').delete().eq('id', id);
    if (error) { toast.error(t('dj.saveError')); return; }
    await loadPhotos(dj.user_id);
  };

  const movePhoto = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= photos.length) return;
    const next = [...photos];
    [next[index], next[target]] = [next[target], next[index]];
    setPhotos(next); // optimistic
    await Promise.all(next.map((p, i) => supabase.from('dj_photos').update({ sort_order: i }).eq('id', p.id)));
    await loadPhotos(dj.user_id);
  };

  return (
    <DJPage>
      <DJHeading title={t('dj.myProfile')} subtitle={dj.venue?.name} />

      {showChangePinFlow ? (
        <PCard>
          <ChangePinFlow onClose={() => setShowChangePinFlow(false)} hasExistingPin={true} />
        </PCard>
      ) : (
        <>
          {/* Security / PIN */}
          <PCard>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl"
                  style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}>
                  <KeyRound className="h-5 w-5" style={{ color: RED }} />
                </div>
                <div className="min-w-0">
                  <p className="font-[560] text-sm" style={{ color: T1 }}>{t('dj.pinCode')}</p>
                  <p className="text-xs truncate" style={{ color: T3 }}>{t('dj.pinSubtitle')}</p>
                </div>
              </div>
              <button
                onClick={() => setShowChangePinFlow(true)}
                className="flex-none rounded-xl px-3.5 py-2 text-[13px] font-semibold cursor-pointer transition-all duration-150 hover:bg-white/[0.06]"
                style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDER}`, color: T1 }}
              >
                {t('dj.modify')}
              </button>
            </div>
          </PCard>

          {/* B2 — shareable press kit (EPK) for bookers */}
          {epkUrl && (
            <DJShareCard
              shareUrl={epkUrl}
              stageName={displayName}
              title={t('dj.epk.shareTitle')}
              subtitle={t('dj.epk.shareSubtitle')}
            />
          )}

          <PCard className="space-y-6">
            {/* Cover image */}
            <div>
              <FieldLabel>{t('dj.coverImage')}</FieldLabel>
              <div className="relative aspect-video rounded-xl overflow-hidden mt-2"
                style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                {dj.cover_image_url ? (
                  <img src={dj.cover_image_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center"
                    style={{ background: 'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(232,25,44,0.10) 0%, transparent 60%)' }}>
                    <span className="text-sm" style={{ color: T3 }}>{t('dj.noCover')}</span>
                  </div>
                )}
                <input
                  id="cover-upload"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const fileExt = file.name.split('.').pop();
                    const filePath = `dj-covers/${dj.id}-${Date.now()}.${fileExt}`;
                    const { error: uploadError } = await supabase.storage.from('profile-photos').upload(filePath, file);
                    if (uploadError) { toast.error('Upload error'); return; }
                    const { data: { publicUrl } } = supabase.storage.from('profile-photos').getPublicUrl(filePath);
                    // Sync across all of this DJ's scoped records (venue + org rosters) by user_id,
                    // so their real uploaded cover shows everywhere, not just on this one row.
                    await supabase.from('djs').update({ cover_image_url: publicUrl }).eq('user_id', dj.user_id);
                    refetchProfiles();
                  }}
                />
                <button
                  onClick={() => document.getElementById('cover-upload')?.click()}
                  className="absolute bottom-2 right-2 rounded-lg px-3 py-1.5 text-xs font-semibold cursor-pointer transition-all duration-150"
                  style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)', border: `1px solid ${BORDER}`, color: T1 }}
                >
                  {t('dj.change')}
                </button>
              </div>
            </div>

            {/* Profile photo + name */}
            <div className="flex items-start gap-4">
              <ProfilePhotoUpload
                currentImageUrl={dj.profile_image_url}
                onUpload={async (url) => {
                  // Sync to all of this DJ's scoped records (venue + org rosters) by user_id.
                  const { error } = await supabase.from('djs').update({ profile_image_url: url }).eq('user_id', dj.user_id);
                  if (!error) refetchProfiles();
                }}
                size="lg"
                fallback={dj.stage_name?.[0] || dj.first_name?.[0] || 'DJ'}
              />
              <div className="min-w-0">
                <h2 className="text-xl font-[640]" style={{ color: T1, letterSpacing: '-0.02em' }}>{displayName}</h2>
                <p className="text-sm" style={{ color: T2 }}>{dj.first_name} {dj.last_name}</p>
                {publicSlug && <p className="text-xs font-mono mt-1" style={{ color: RED }}>yunoapp.eu/dj/{publicSlug}</p>}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {dj.music_genres.map((genre, i) => (
                    <span key={i} className="rounded-full px-2.5 py-1 text-[11px] font-medium"
                      style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}>
                      {genre}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Form */}
            <div className="space-y-4">
              {isProfileIncomplete && (
                <div className="rounded-xl p-3.5 text-sm"
                  style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.25)', color: WARN }}>
                  {t('dj.completeProfile')}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FieldLabel>{t('dj.firstName')} *</FieldLabel>
                  <Input className="mt-1.5" value={editForm.firstName} onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })} />
                </div>
                <div>
                  <FieldLabel>{t('dj.lastName')} *</FieldLabel>
                  <Input className="mt-1.5" value={editForm.lastName} onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })} />
                </div>
              </div>

              <div>
                <FieldLabel>{t('dj.stageName')}</FieldLabel>
                <Input className="mt-1.5" value={editForm.stageName} onChange={(e) => setEditForm({ ...editForm, stageName: e.target.value })} />
              </div>

              <div>
                <FieldLabel>{t('dj.musicGenres')} <span style={{ color: T3 }}>(max 3)</span></FieldLabel>
                <div className="flex flex-wrap gap-2 mt-2">
                  {YUNO_MUSIC_GENRES.map(genre => {
                    const currentGenres = editForm.genres.split(',').map(g => g.trim()).filter(Boolean);
                    const selected = currentGenres.includes(genre);
                    const atMax = currentGenres.length >= 3 && !selected;
                    return (
                      <button
                        key={genre}
                        type="button"
                        disabled={atMax}
                        onClick={() => {
                          if (selected) setEditForm({ ...editForm, genres: currentGenres.filter(g => g !== genre).join(', ') });
                          else setEditForm({ ...editForm, genres: [...currentGenres, genre].join(', ') });
                        }}
                        className="rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-150 cursor-pointer disabled:cursor-not-allowed"
                        style={selected
                          ? { background: RED, border: `1px solid ${RED}`, color: '#fff', boxShadow: `0 0 14px -4px ${RED}88` }
                          : atMax
                            ? { background: C_FAINT, border: `1px solid ${BORDER}`, color: T3, opacity: 0.5 }
                            : { background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}
                      >
                        {genre}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FieldLabel>WhatsApp</FieldLabel>
                  <Input className="mt-1.5" value={editForm.whatsapp} onChange={(e) => setEditForm({ ...editForm, whatsapp: e.target.value })} placeholder="+33 6 12 34 56 78" />
                </div>
                <div>
                  <FieldLabel>Instagram</FieldLabel>
                  <Input className="mt-1.5" value={editForm.instagram} onChange={(e) => setEditForm({ ...editForm, instagram: e.target.value })} placeholder="https://instagram.com/..." />
                </div>
              </div>

              <div>
                <FieldLabel>TikTok</FieldLabel>
                <Input className="mt-1.5" value={editForm.tiktok} onChange={(e) => setEditForm({ ...editForm, tiktok: e.target.value })} placeholder="https://tiktok.com/@..." />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FieldLabel>SoundCloud</FieldLabel>
                  <Input className="mt-1.5" value={editForm.soundcloud} onChange={(e) => setEditForm({ ...editForm, soundcloud: e.target.value })} placeholder="https://soundcloud.com/..." />
                </div>
                <div>
                  <FieldLabel>Spotify</FieldLabel>
                  <Input className="mt-1.5" value={editForm.spotify} onChange={(e) => setEditForm({ ...editForm, spotify: e.target.value })} placeholder="https://open.spotify.com/..." />
                </div>
              </div>

              <div>
                <FieldLabel>YouTube</FieldLabel>
                <Input className="mt-1.5" value={editForm.youtube} onChange={(e) => setEditForm({ ...editForm, youtube: e.target.value })} placeholder="https://youtube.com/@..." />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FieldLabel>{t('dj.city')}</FieldLabel>
                  <Input className="mt-1.5" value={editForm.city} onChange={(e) => setEditForm({ ...editForm, city: e.target.value })} placeholder="Paris" />
                </div>
                <div>
                  <FieldLabel>{t('dj.country')}</FieldLabel>
                  <Input className="mt-1.5" value={editForm.country} onChange={(e) => setEditForm({ ...editForm, country: e.target.value })} placeholder="France" />
                </div>
              </div>

              <div>
                <FieldLabel>{t('dj.publicDescription')}</FieldLabel>
                <Textarea
                  className="mt-1.5"
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value.slice(0, 1000) })}
                  rows={4}
                  maxLength={1000}
                  placeholder={t('dj.publicDescPlaceholder')}
                />
                <p className="text-xs mt-1 tabular-nums" style={{ color: T3 }}>{editForm.description.length}/1000</p>
              </div>

              <div>
                <FieldLabel>{t('dj.bioInternal')}</FieldLabel>
                <Textarea
                  className="mt-1.5"
                  value={editForm.bio}
                  onChange={(e) => setEditForm({ ...editForm, bio: e.target.value })}
                  rows={4}
                  placeholder={t('dj.bioPlaceholder')}
                />
              </div>

              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold cursor-pointer transition-all duration-150 disabled:opacity-50"
                style={{ background: RED, color: '#fff', boxShadow: `0 0 22px -6px ${RED}99` }}
              >
                {saving ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    {t('dj.saving')}
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    {t('dj.save')}
                  </>
                )}
              </button>
            </div>
          </PCard>

          {/* Featured track — single audio file, played natively on the public page */}
          <PCard className="space-y-4">
            <div>
              <FieldLabel>{t('dj.featuredTrack')}</FieldLabel>
              <p className="text-xs mt-1" style={{ color: T3 }}>{t('dj.featuredTrackHint')}</p>
            </div>

            {trackUrl && (
              <div className="rounded-xl p-3 flex items-center gap-3"
                style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg"
                  style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}>
                  <Music className="h-4 w-4" style={{ color: RED }} />
                </div>
                <audio src={trackUrl} controls preload="none" className="flex-1 min-w-0" style={{ height: 36 }} />
                <button
                  onClick={removeTrack}
                  aria-label={t('dj.remove')}
                  className="flex-none flex h-9 w-9 items-center justify-center rounded-lg cursor-pointer transition-all hover:bg-white/[0.06]"
                  style={{ border: `1px solid ${BORDER}`, color: T2 }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            )}

            <div>
              <FieldLabel>{t('dj.trackTitle')}</FieldLabel>
              <Input
                className="mt-1.5"
                value={trackTitle}
                onChange={(e) => setTrackTitle(e.target.value)}
                onBlur={() => { if (trackUrl) persistTrack(trackUrl, trackTitle.trim() || null); }}
                placeholder={t('dj.trackTitlePlaceholder')}
              />
            </div>

            <input id="track-upload" type="file" accept="audio/*" className="hidden" onChange={handleTrackUpload} />
            <button
              onClick={() => document.getElementById('track-upload')?.click()}
              disabled={trackBusy}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl py-2.5 text-[13px] font-semibold cursor-pointer transition-all duration-150 disabled:opacity-50"
              style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDER}`, color: T1 }}
            >
              {trackBusy ? (
                <><div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />{t('dj.saving')}</>
              ) : (
                <><Plus className="h-4 w-4" />{trackUrl ? t('dj.replaceTrack') : t('dj.addTrack')}</>
              )}
            </button>
          </PCard>

          {/* Booking & rate — drives the marketplace price filter + booker view */}
          <PCard className="space-y-4">
            <div>
              <FieldLabel>{tt('Booking & tarif', 'Booking & rate', 'Reservas y tarifa')}</FieldLabel>
              <p className="text-xs mt-1" style={{ color: T3 }}>
                {tt(
                  'Indique ta fourchette de cachet. Visible par les clubs/orgas qui cherchent un DJ.',
                  'Set your fee range. Shown to clubs/organizers searching for a DJ.',
                  'Indica tu rango de caché. Visible para clubs/organizadores que buscan un DJ.',
                )}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldLabel>{tt('Cachet min', 'Min fee', 'Caché mín')}</FieldLabel>
                <Input className="mt-1.5" type="number" min={0} value={rateForm.minFee}
                  onChange={(e) => setRateForm({ ...rateForm, minFee: e.target.value })} placeholder="500" />
              </div>
              <div>
                <FieldLabel>{tt('Cachet max', 'Max fee', 'Caché máx')}</FieldLabel>
                <Input className="mt-1.5" type="number" min={0} value={rateForm.maxFee}
                  onChange={(e) => setRateForm({ ...rateForm, maxFee: e.target.value })} placeholder="1500" />
              </div>
            </div>

            <div>
              <FieldLabel>{tt('Précision tarif', 'Rate note', 'Nota de tarifa')}</FieldLabel>
              <Input className="mt-1.5" value={rateForm.note}
                onChange={(e) => setRateForm({ ...rateForm, note: e.target.value })}
                placeholder={tt('ex. par set de 2h, déplacement non inclus', 'e.g. per 2h set, travel not included', 'ej. por set de 2h, viaje no incluido')} />
            </div>

            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input type="checkbox" checked={rateForm.isPublic}
                onChange={(e) => setRateForm({ ...rateForm, isPublic: e.target.checked })}
                style={{ width: 16, height: 16, accentColor: RED }} />
              <span className="text-[13px]" style={{ color: T2 }}>
                {tt('Afficher ma fourchette aux bookers', 'Show my range to bookers', 'Mostrar mi rango a los bookers')}
              </span>
            </label>

            <button
              onClick={saveRate}
              disabled={rateBusy}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl py-2.5 text-[13px] font-semibold cursor-pointer transition-all duration-150 disabled:opacity-50"
              style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDER}`, color: T1 }}
            >
              {rateBusy ? (
                <><div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />{t('dj.saving')}</>
              ) : (
                <><Euro className="h-4 w-4" />{tt('Enregistrer le tarif', 'Save rate', 'Guardar tarifa')}</>
              )}
            </button>
          </PCard>

          {/* Photo gallery — slider on the public page */}
          <PCard className="space-y-4">
            <div>
              <FieldLabel>{t('dj.gallery')}</FieldLabel>
              <p className="text-xs mt-1" style={{ color: T3 }}>{t('dj.galleryHint')}</p>
            </div>

            {photos.length > 0 && (
              <div className="grid grid-cols-3 gap-2.5">
                {photos.map((p, i) => (
                  <div key={p.id} className="relative rounded-xl overflow-hidden"
                    style={{ aspectRatio: '3 / 4', border: `1px solid ${BORDER}`, background: INNER_BG }}>
                    <img src={p.url} alt="" className="w-full h-full object-cover" />
                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between p-1.5"
                      style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.75), transparent)' }}>
                      <div className="flex gap-1">
                        <button onClick={() => movePhoto(i, -1)} disabled={i === 0}
                          aria-label="←"
                          className="flex h-6 w-6 items-center justify-center rounded-md cursor-pointer disabled:opacity-30"
                          style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}>
                          <ArrowLeft className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => movePhoto(i, 1)} disabled={i === photos.length - 1}
                          aria-label="→"
                          className="flex h-6 w-6 items-center justify-center rounded-md cursor-pointer disabled:opacity-30"
                          style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}>
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <button onClick={() => removePhoto(p.id)}
                        aria-label={t('dj.remove')}
                        className="flex h-6 w-6 items-center justify-center rounded-md cursor-pointer"
                        style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <input id="gallery-upload" type="file" accept="image/*" multiple className="hidden" onChange={addPhotos} />
            <button
              onClick={() => document.getElementById('gallery-upload')?.click()}
              disabled={galleryBusy}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl py-2.5 text-[13px] font-semibold cursor-pointer transition-all duration-150 disabled:opacity-50"
              style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDER}`, color: T1 }}
            >
              {galleryBusy ? (
                <><div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />{t('dj.saving')}</>
              ) : (
                <><ImageIcon className="h-4 w-4" />{t('dj.addPhotos')}</>
              )}
            </button>
          </PCard>
        </>
      )}
    </DJPage>
  );
}
