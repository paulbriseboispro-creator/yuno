import { useState, useEffect } from 'react';
import { KeyRound, Save } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
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
  const { t } = useLanguage();
  const { dj, isProfileIncomplete, refetchProfiles } = useDJData();

  const [saving, setSaving] = useState(false);
  const [showChangePinFlow, setShowChangePinFlow] = useState(false);
  const [editForm, setEditForm] = useState({
    firstName: '', lastName: '', stageName: '', genres: '', whatsapp: '',
    instagram: '', tiktok: '', bio: '', soundcloud: '', spotify: '', youtube: '',
    city: '', country: '', description: '',
  });

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
    // Repopulate the form only when the active profile (venue) changes, not on
    // every dj object identity change — otherwise it would clobber in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dj?.id]);

  if (!dj) return null;
  const displayName = dj.stage_name || `${dj.first_name} ${dj.last_name}`;
  const BASE_URL = (import.meta.env.VITE_APP_BASE_URL as string | undefined) || 'https://yunoapp.eu';
  const epkUrl = dj.slug ? `${BASE_URL}/dj/${dj.slug}/epk` : undefined;

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
                {dj.slug && <p className="text-xs font-mono mt-1" style={{ color: RED }}>yunoapp.eu/dj/{dj.slug}</p>}
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
        </>
      )}
    </DJPage>
  );
}
