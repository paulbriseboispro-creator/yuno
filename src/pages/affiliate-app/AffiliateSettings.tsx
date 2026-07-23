import { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import type { TablesUpdate } from '@/integrations/supabase/types';
import { useAuth } from '@/hooks/useAuth';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useUnsavedGuard } from '@/hooks/useUnsavedGuard';
import {
  Camera, Copy, Check, ExternalLink, Plus, Trash2, GripVertical, QrCode,
  User, Share2, ShieldCheck, Globe, ListOrdered,
} from 'lucide-react';
import AffiliateQRSection from '@/components/affiliate/AffiliateQRSection';
import {
  AffPage, AffSpinner,
  RED, POS, T1, T2, T3, C_FAINT, BORDER, CARD_BG, INNER_BG, TILE_BG, CARD_SHADOW,
} from '@/components/affiliate/affiliate-ui';

// Inputs (dark premium) ────────────────────────────────────────────────────────
const fieldStyle: React.CSSProperties = { background: INNER_BG, border: `1px solid ${BORDER}`, color: T1 };
const fieldClass = 'h-10 rounded-lg text-[14px] placeholder:text-white/25 focus-visible:ring-1 focus-visible:ring-white/20 focus-visible:ring-offset-0';
const adornStyle: React.CSSProperties = { background: TILE_BG, border: `1px solid ${BORDER}`, borderRight: 'none', color: T3 };

type SaveState = 'idle' | 'saving' | 'saved';

// ─── Presentational helpers (no logic) ────────────────────────────────────────
function SectionCard({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
      style={{
        background: CARD_BG,
        border: `1px solid ${BORDER}`,
        borderRadius: 18,
        boxShadow: CARD_SHADOW,
        padding: 22,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {children}
    </motion.div>
  );
}

function SectionHead({ icon: Icon, title, subtitle, right }: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 mb-5">
      <div className="flex items-center gap-3">
        <div
          className="w-8 h-8 flex items-center justify-center rounded-xl flex-none"
          style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}
        >
          <Icon className="w-4 h-4" />
        </div>
        <div>
          <h2 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>
            {title}
          </h2>
          {subtitle && <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}

const fieldLabel: React.CSSProperties = { color: T2, fontSize: 12, fontWeight: 500 };

// Saved/saving indicator for autosaved (non-text) controls.
function SavedIndicator({ state }: { state: SaveState | undefined }) {
  if (!state || state === 'idle') return null;
  return (
    <span
      className="shrink-0 flex items-center gap-1.5 text-xs font-medium"
      style={{ color: state === 'saved' ? POS : T3 }}
    >
      {state === 'saving' ? (
        <><div className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />Enregistrement…</>
      ) : (
        <><Check className="h-3 w-3" />Enregistré</>
      )}
    </span>
  );
}

// Explicit save button for text sections, placed at the bottom of each card.
function SaveButton({ state, onClick, label = 'Enregistrer' }: {
  state: SaveState | undefined;
  onClick: () => void;
  label?: string;
}) {
  const saving = state === 'saving';
  const saved = state === 'saved';
  return (
    <button
      onClick={onClick}
      disabled={saving}
      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-all duration-150 disabled:opacity-50"
      style={{
        background: saved ? 'rgba(52,211,153,0.12)' : 'rgba(232,25,44,0.10)',
        border: `1px solid ${saved ? 'rgba(52,211,153,0.30)' : 'rgba(232,25,44,0.25)'}`,
        color: saved ? POS : RED,
      }}
    >
      {saving ? (
        <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : saved ? (
        <Check className="h-3.5 w-3.5" />
      ) : null}
      {saving ? 'Enregistrement…' : saved ? 'Enregistré !' : label}
    </button>
  );
}

type TrustStat = { value: string; label: string };

type AffiliateProfile = {
  id: string;
  name: string;
  city: string | null;
  type: string;
  linktree_slug: string | null;
  bio: string | null;
  avatar_url: string | null;
  instagram: string | null;
  tiktok: string | null;
  website: string | null;
  whatsapp: string | null;
  trust_stats: TrustStat[];
  promoter_social_mode: 'promoter' | 'agency';
  linktree_sort_mode: 'by_day' | 'by_genre' | 'by_price' | 'custom';
  allow_promoter_sort: boolean;
};

export default function AffiliateSettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [profile, setProfile] = useState<AffiliateProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const profileIdRef = useRef<string | null>(null);

  const [form, setForm] = useState({
    name: '',
    city: '',
    bio: '',
    linktree_slug: '',
    instagram: '',
    tiktok: '',
    website: '',
    whatsapp: '',
    promoter_social_mode: 'promoter' as 'promoter' | 'agency',
    linktree_sort_mode: 'by_day' as 'by_day' | 'by_genre' | 'by_price' | 'custom',
    allow_promoter_sort: false,
  });

  const [trustStats, setTrustStats] = useState<TrustStat[]>([]);

  useEffect(() => {
    if (user) fetchProfile();
  }, [user?.id]);

  const fetchProfile = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('affiliates')
      .select('id, name, city, type, linktree_slug, bio, avatar_url, instagram, tiktok, website, whatsapp, trust_stats, promoter_social_mode, linktree_sort_mode, allow_promoter_sort')
      .eq('user_id', user!.id)
      .single();

    if (data) {
      const p = data as unknown as AffiliateProfile;
      profileIdRef.current = p.id;
      setProfile(p);
      setForm({
        name: p.name ?? '',
        city: p.city ?? '',
        bio: p.bio ?? '',
        linktree_slug: p.linktree_slug ?? '',
        instagram: p.instagram ?? '',
        tiktok: p.tiktok ?? '',
        website: p.website ?? '',
        whatsapp: p.whatsapp ?? '',
        promoter_social_mode: p.promoter_social_mode ?? 'promoter',
        linktree_sort_mode: (p as any).linktree_sort_mode ?? 'by_day',
        allow_promoter_sort: (p as any).allow_promoter_sort ?? false,
      });
      setTrustStats(Array.isArray(p.trust_stats) ? p.trust_stats : []);
    }
    setLoading(false);
  };

  const setSaveState = (key: string, state: SaveState) =>
    setSaveStates(prev => ({ ...prev, [key]: state }));

  // Single partial-update runner shared by every save (autosave + explicit button).
  const runSave = async (key: string, fields: Record<string, unknown>): Promise<boolean> => {
    const id = profileIdRef.current;
    if (!id) return false;
    setSaveState(key, 'saving');
    try {
      const { error } = await supabase.from('affiliates').update(fields as TablesUpdate<'affiliates'>).eq('id', id);
      if (error) throw error;
      setProfile(p => (p ? { ...p, ...(fields as Partial<AffiliateProfile>) } : p));
      setSaveState(key, 'saved');
      setTimeout(() => setSaveState(key, 'idle'), 2000);
      return true;
    } catch (err) {
      setSaveState(key, 'idle');
      const msg = err instanceof Error ? err.message : 'Erreur inconnue';
      toast({ title: 'Erreur', description: msg, variant: 'destructive' });
      return false;
    }
  };

  // ─── Autosave handlers (non-text controls) ─────────────────────────────────
  const handleSocialModeChange = (value: 'promoter' | 'agency') => {
    setForm(f => ({ ...f, promoter_social_mode: value }));
    runSave('social_mode', { promoter_social_mode: value });
  };

  const handleSortModeChange = (value: AffiliateProfile['linktree_sort_mode']) => {
    setForm(f => ({ ...f, linktree_sort_mode: value }));
    runSave('sort', { linktree_sort_mode: value });
  };

  const handleAllowPromoterSortToggle = () => {
    const next = !form.allow_promoter_sort;
    setForm(f => ({ ...f, allow_promoter_sort: next }));
    runSave('sort', { allow_promoter_sort: next });
  };

  // ─── Explicit saves (text sections) ────────────────────────────────────────
  // Chaque section a son propre bouton — donc sa propre garde : la barre
  // « modifications non enregistrées » nomme celle(s) qui reste(nt) en attente.
  const saveIdentity = async (): Promise<boolean> => {
    if (!form.name.trim()) {
      toast({ title: 'Nom requis', description: "Le nom de l'entité est obligatoire.", variant: 'destructive' });
      return false;
    }
    const next = { name: form.name.trim(), city: form.city.trim(), bio: form.bio.trim() };
    const ok = await runSave('identity', {
      name: next.name,
      city: next.city || null,
      bio: next.bio || null,
    });
    if (ok) { setForm(f => ({ ...f, ...next })); identityGuard.markSaved(next); }
    return ok;
  };

  const saveSocialLinks = async (): Promise<boolean> => {
    const next = {
      instagram: form.instagram.trim(), tiktok: form.tiktok.trim(),
      website: form.website.trim(), whatsapp: form.whatsapp.trim(),
    };
    const ok = await runSave('links', {
      instagram: next.instagram || null,
      tiktok: next.tiktok || null,
      website: next.website || null,
      whatsapp: next.whatsapp || null,
    });
    if (ok) { setForm(f => ({ ...f, ...next })); linksGuard.markSaved(next); }
    return ok;
  };

  const saveTrustStats = async (): Promise<boolean> => {
    const next = trustStats.filter(s => s.value.trim() && s.label.trim());
    const ok = await runSave('trust', { trust_stats: next });
    if (ok) { setTrustStats(next); trustGuard.markSaved({ trustStats: next }); }
    return ok;
  };

  const saveSlug = async (): Promise<boolean> => {
    const next = form.linktree_slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    const ok = await runSave('slug', { linktree_slug: next || null });
    if (ok) { setForm(f => ({ ...f, linktree_slug: next })); slugGuard.markSaved({ linktree_slug: next }); }
    return ok;
  };

  const guardReady = !loading && Boolean(profile);

  const identityGuard = useUnsavedGuard({
    scope: 'affiliate-settings:identity',
    label: 'Identité',
    ready: guardReady,
    value: { name: form.name, city: form.city, bio: form.bio },
    onRestore: (v) => setForm(f => ({ ...f, ...v })),
    onSave: saveIdentity,
  });

  const linksGuard = useUnsavedGuard({
    scope: 'affiliate-settings:links',
    label: 'Liens & réseaux',
    ready: guardReady,
    value: { instagram: form.instagram, tiktok: form.tiktok, website: form.website, whatsapp: form.whatsapp },
    onRestore: (v) => setForm(f => ({ ...f, ...v })),
    onSave: saveSocialLinks,
  });

  const trustGuard = useUnsavedGuard({
    scope: 'affiliate-settings:trust',
    label: 'Chiffres de confiance',
    ready: guardReady,
    value: { trustStats },
    onRestore: (v) => setTrustStats(v.trustStats),
    onSave: saveTrustStats,
  });

  const slugGuard = useUnsavedGuard({
    scope: 'affiliate-settings:slug',
    label: 'Lien public',
    ready: guardReady,
    value: { linktree_slug: form.linktree_slug },
    onRestore: (v) => setForm(f => ({ ...f, ...v })),
    onSave: saveSlug,
  });

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile) return;
    setUploadingAvatar(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `${profile.id}/avatar/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('affiliate-media')
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('affiliate-media').getPublicUrl(path);
      const { error: updateError } = await supabase
        .from('affiliates')
        .update({ avatar_url: urlData.publicUrl })
        .eq('id', profile.id);
      if (updateError) throw updateError;

      setProfile(p => p ? { ...p, avatar_url: urlData.publicUrl } : p);
      toast({ title: 'Avatar mis à jour' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur upload';
      toast({ title: 'Erreur', description: msg, variant: 'destructive' });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const copyLinktreeUrl = () => {
    if (!form.linktree_slug) return;
    const url = `${window.location.origin}/p/${form.linktree_slug}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const [previewActive, setPreviewActive] = useState(0);
  useEffect(() => {
    const valid = trustStats.filter(s => s.value.trim() && s.label.trim());
    if (valid.length <= 1) return;
    const id = setInterval(() => setPreviewActive(p => (p + 1) % valid.length), 3000);
    return () => clearInterval(id);
  }, [trustStats]);

  const addTrustStat = () => {
    setTrustStats(s => [...s, { value: '', label: '' }]);
  };

  const removeTrustStat = (i: number) => {
    setTrustStats(s => s.filter((_, idx) => idx !== i));
  };

  const updateTrustStat = (i: number, field: 'value' | 'label', val: string) => {
    setTrustStats(s => s.map((stat, idx) => idx === i ? { ...stat, [field]: val } : stat));
  };

  if (loading) return <AffSpinner />;

  const TYPE_LABELS: Record<string, string> = {
    yuno_internal: 'Yuno Interne',
    city_agency: 'Agence Ville',
    independent: 'Indépendant',
  };

  const isYunoInternal = profile?.type === 'yuno_internal';

  return (
    <AffPage maxWidth={720}>
      <style>{`@keyframes fadeSlide { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }`}</style>

      <div className="space-y-4">
        {/* Page header */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <h1 style={{ color: T1, fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>
            Paramètres
          </h1>
          <p style={{ color: T3, fontSize: 13, marginTop: 4 }}>Gérez votre profil et votre page publique</p>
        </motion.div>

        {/* Avatar */}
        <SectionCard delay={0.04}>
          <div className="flex items-center gap-5">
            <div className="relative">
              {profile?.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt="Avatar"
                  className="w-20 h-20 rounded-2xl object-cover"
                  style={{ border: `1px solid ${BORDER}` }}
                />
              ) : (
                <div
                  className="w-20 h-20 rounded-2xl flex items-center justify-center"
                  style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}
                >
                  <span style={{ color: T2, fontSize: 26, fontWeight: 700 }}>{form.name[0]?.toUpperCase()}</span>
                </div>
              )}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingAvatar}
                className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-full flex items-center justify-center cursor-pointer transition-colors"
                style={{ background: RED, boxShadow: `0 0 14px -4px ${RED}88` }}
              >
                {uploadingAvatar
                  ? <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  : <Camera className="h-3.5 w-3.5 text-white" />
                }
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarUpload}
              />
            </div>
            <div>
              <p style={{ color: T1, fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>{form.name || '—'}</p>
              <div
                className="inline-flex items-center mt-1.5 px-2.5 py-1 rounded-full"
                style={{ background: C_FAINT, border: `1px solid ${BORDER}` }}
              >
                <span style={{ color: T2, fontSize: 11, fontWeight: 600 }}>
                  {TYPE_LABELS[profile?.type ?? ''] ?? profile?.type}
                </span>
              </div>
              {profile?.city && <p style={{ color: T3, fontSize: 12.5, marginTop: 6 }}>{profile.city}</p>}
            </div>
          </div>
        </SectionCard>

        {/* Identité */}
        <SectionCard delay={0.08}>
          <SectionHead icon={User} title="Identité" />

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label style={fieldLabel}>Nom de l'entité *</Label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Agence Nightlife Madrid"
                className={fieldClass}
                style={fieldStyle}
              />
            </div>
            <div className="space-y-1.5">
              <Label style={fieldLabel}>Ville</Label>
              <Input
                value={form.city}
                onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                placeholder="Madrid"
                className={fieldClass}
                style={fieldStyle}
              />
            </div>
          </div>

          <div className="space-y-1.5 mt-4">
            <Label style={fieldLabel}>Bio</Label>
            <Textarea
              value={form.bio}
              onChange={e => setForm(f => ({ ...f, bio: e.target.value }))}
              placeholder="Décrivez votre organisation en quelques mots..."
              rows={3}
              className="rounded-lg text-[14px] placeholder:text-white/25 resize-none focus-visible:ring-1 focus-visible:ring-white/20 focus-visible:ring-offset-0"
              style={fieldStyle}
            />
          </div>

          <div className="flex justify-end mt-4">
            <SaveButton state={saveStates.identity} onClick={saveIdentity} />
          </div>
        </SectionCard>

        {/* Liens sociaux */}
        <SectionCard delay={0.12}>
          <SectionHead
            icon={Share2}
            title="Liens sociaux"
            subtitle={isYunoInternal
              ? 'Ces liens apparaissent dans le header YUNO de vos promoteurs.'
              : 'Ces liens remplacent le header YUNO sur les linktrees de vos promoteurs.'}
          />

          {/* Toggle : liens du promoteur vs liens de l'agence (autosave) */}
          <div
            className="rounded-xl p-4 space-y-3"
            style={{ background: TILE_BG, border: `1px solid ${BORDER}` }}
          >
            <div className="flex items-center justify-between gap-3">
              <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                Liens dans le profil promoteur
              </p>
              <SavedIndicator state={saveStates.social_mode} />
            </div>
            <div className="space-y-2">
              {(
                [
                  {
                    value: 'promoter',
                    title: 'Liens personnels du promoteur',
                    desc: 'Chaque promoteur configure ses propres réseaux (Instagram, TikTok…) depuis son profil.',
                  },
                  {
                    value: 'agency',
                    title: "Liens imposés par l'agence",
                    desc: "Vos liens ci-dessous s'affichent à la place des liens personnels sur tous les linktrees.",
                  },
                ] as const
              ).map((opt) => {
                const active = form.promoter_social_mode === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => handleSocialModeChange(opt.value)}
                    className="w-full text-left flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-all duration-150"
                    style={{
                      background: active ? 'rgba(232,25,44,0.09)' : 'transparent',
                      border: `1px solid ${active ? 'rgba(232,25,44,0.22)' : BORDER}`,
                    }}
                  >
                    <div
                      className="mt-0.5 shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center"
                      style={{ borderColor: active ? RED : 'rgba(255,255,255,0.22)' }}
                    >
                      {active && <div className="w-2 h-2 rounded-full" style={{ background: RED }} />}
                    </div>
                    <div>
                      <p style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{opt.title}</p>
                      <p style={{ color: T3, fontSize: 12, marginTop: 2 }}>{opt.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mt-4">
            <div className="space-y-1.5">
              <Label style={fieldLabel}>Instagram</Label>
              <div className="flex items-center">
                <span className="flex items-center px-3 h-10 rounded-l-lg text-sm shrink-0" style={adornStyle}>
                  @
                </span>
                <Input
                  value={form.instagram.replace('@', '')}
                  onChange={e => setForm(f => ({ ...f, instagram: e.target.value }))}
                  placeholder="yunoapp"
                  className={`${fieldClass} rounded-l-none`}
                  style={fieldStyle}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label style={fieldLabel}>TikTok</Label>
              <div className="flex items-center">
                <span className="flex items-center px-3 h-10 rounded-l-lg text-sm shrink-0" style={adornStyle}>
                  @
                </span>
                <Input
                  value={form.tiktok.replace('@', '')}
                  onChange={e => setForm(f => ({ ...f, tiktok: e.target.value }))}
                  placeholder="yunoapp"
                  className={`${fieldClass} rounded-l-none`}
                  style={fieldStyle}
                />
              </div>
            </div>
          </div>

          <div className="space-y-1.5 mt-4">
            <Label style={fieldLabel}>Site web</Label>
            <Input
              value={form.website}
              onChange={e => setForm(f => ({ ...f, website: e.target.value }))}
              placeholder="https://yunoapp.eu"
              className={fieldClass}
              style={fieldStyle}
            />
          </div>

          <div className="space-y-1.5 mt-4">
            <Label style={fieldLabel}>WhatsApp — groupe communauté</Label>
            <Input
              value={form.whatsapp}
              onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))}
              placeholder="https://chat.whatsapp.com/..."
              className={fieldClass}
              style={fieldStyle}
            />
            <p style={{ color: T3, fontSize: 11.5 }}>Lien d'invitation vers le groupe WhatsApp.</p>
          </div>

          <div className="flex justify-end mt-4">
            <SaveButton state={saveStates.links} onClick={saveSocialLinks} />
          </div>
        </SectionCard>

        {/* Trust stats */}
        <SectionCard delay={0.16}>
          <SectionHead
            icon={ShieldCheck}
            title="Élément de confiance"
            subtitle="S'affiche sur les linktrees de tous vos promoteurs sous forme de statistiques rotatives. Laissez vide pour masquer l'élément."
          />

          {/* Preview — slider animé identique au vrai composant */}
          {(() => {
            const valid = trustStats.filter(s => s.value.trim() && s.label.trim());
            if (valid.length === 0) return null;
            const idx = previewActive % valid.length;
            const stat = valid[idx];
            return (
              <div
                className="rounded-xl text-center"
                style={{
                  background: 'linear-gradient(135deg,rgba(232,25,44,0.14),rgba(232,25,44,0.04))',
                  border: '1px solid rgba(232,25,44,0.22)',
                  padding: '16px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <p style={{ color: T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 4 }}>Aperçu</p>
                <div
                  key={idx}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', animation: 'fadeSlide 0.4s ease' }}
                >
                  <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '30px', fontWeight: 700, color: RED, letterSpacing: '-0.02em', lineHeight: 1 }}>
                    {stat.value}
                  </span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '12px', letterSpacing: '0.12em', color: T2, textTransform: 'uppercase' }}>
                    {stat.label}
                  </span>
                </div>
                {valid.length > 1 && (
                  <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                    {valid.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setPreviewActive(i)}
                        style={{
                          width: i === idx ? '18px' : '6px',
                          height: '6px',
                          borderRadius: '999px',
                          background: i === idx ? RED : 'rgba(255,255,255,0.15)',
                          border: 'none',
                          padding: 0,
                          cursor: 'pointer',
                          transition: 'width 300ms ease, background 300ms ease',
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Liste des stats */}
          <div className="space-y-2 mt-4">
            {trustStats.map((stat, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="cursor-grab shrink-0" style={{ color: T3 }}>
                  <GripVertical className="h-4 w-4" />
                </div>
                <Input
                  value={stat.value}
                  onChange={e => updateTrustStat(i, 'value', e.target.value)}
                  placeholder="+250"
                  className={`${fieldClass} w-24 shrink-0 tabular-nums text-center`}
                  style={fieldStyle}
                  maxLength={10}
                />
                <Input
                  value={stat.label}
                  onChange={e => updateTrustStat(i, 'label', e.target.value)}
                  placeholder="Clients satisfaits"
                  className={`${fieldClass} flex-1`}
                  style={fieldStyle}
                  maxLength={40}
                />
                <button
                  onClick={() => removeTrustStat(i)}
                  className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg cursor-pointer transition-colors hover:bg-white/5"
                  style={{ color: T3 }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={addTrustStat}
            disabled={trustStats.length >= 6}
            className="flex items-center gap-2 px-3 py-2 mt-3 rounded-lg text-sm cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:text-white"
            style={{ background: TILE_BG, border: `1px solid ${BORDER}`, color: T2 }}
          >
            <Plus className="h-3.5 w-3.5" />
            Ajouter une statistique
            {trustStats.length > 0 && (
              <span style={{ color: T3, fontSize: 12 }}>({trustStats.length}/6)</span>
            )}
          </button>

          <div className="flex justify-end mt-4">
            <SaveButton state={saveStates.trust} onClick={saveTrustStats} />
          </div>
        </SectionCard>

        {/* Linktree slug */}
        <SectionCard delay={0.2}>
          <SectionHead
            icon={Globe}
            title="Page publique (Linktree agence)"
            subtitle="Choisissez un identifiant pour votre page publique partageable sur les réseaux."
          />

          <div className="space-y-1.5">
            <Label style={fieldLabel}>Identifiant URL</Label>
            <div className="flex items-center gap-0">
              <div className="flex items-center px-3 h-10 rounded-l-lg text-sm shrink-0 whitespace-nowrap" style={adornStyle}>
                {window.location.origin}/p/
              </div>
              <Input
                value={form.linktree_slug}
                onChange={e => setForm(f => ({
                  ...f,
                  linktree_slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')
                }))}
                placeholder="mon-agence"
                className={`${fieldClass} rounded-l-none`}
                style={fieldStyle}
              />
            </div>
            <p style={{ color: T3, fontSize: 11.5 }}>Uniquement des lettres minuscules, chiffres et tirets.</p>
          </div>

          {form.linktree_slug && (
            <div className="flex items-center gap-2 flex-wrap mt-4">
              <button
                onClick={copyLinktreeUrl}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors hover:text-white"
                style={{ background: TILE_BG, border: `1px solid ${BORDER}`, color: T2 }}
              >
                {copied ? <Check className="h-3.5 w-3.5" style={{ color: POS }} /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copié !' : 'Copier le lien'}
              </button>
              <a
                href={`/p/${form.linktree_slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors hover:text-white"
                style={{ background: TILE_BG, border: `1px solid ${BORDER}`, color: T2 }}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Voir la page agence
              </a>
            </div>
          )}

          <div className="flex justify-end mt-4">
            <SaveButton state={saveStates.slug} onClick={saveSlug} />
          </div>
        </SectionCard>

        {/* Classement du linktree (autosave) */}
        <SectionCard delay={0.24}>
          <SectionHead
            icon={ListOrdered}
            title="Classement du linktree"
            subtitle="Choisissez comment les soirées sont triées sur votre page publique et sur les linktrees de vos promoteurs."
            right={<SavedIndicator state={saveStates.sort} />}
          />

          <div className="space-y-2">
            {(
              [
                { value: 'by_day', label: 'Par jour', desc: 'Les soirées sont groupées par date (défaut)' },
                { value: 'by_genre', label: 'Par genre musical', desc: 'Groupées par premier genre (House, Techno, R&B…)' },
                { value: 'by_price', label: 'Par prix', desc: 'Du moins cher au plus cher, gratuit en premier' },
                { value: 'custom', label: 'Ordre personnalisé', desc: "L'ordre drag-and-drop défini dans l'éditeur linktree" },
              ] as const
            ).map((opt) => {
              const active = form.linktree_sort_mode === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => handleSortModeChange(opt.value)}
                  className="w-full text-left flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-all duration-150"
                  style={{
                    background: active ? 'rgba(232,25,44,0.09)' : 'transparent',
                    border: `1px solid ${active ? 'rgba(232,25,44,0.22)' : BORDER}`,
                  }}
                >
                  <div
                    className="mt-0.5 shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center"
                    style={{ borderColor: active ? RED : 'rgba(255,255,255,0.22)' }}
                  >
                    {active && <div className="w-2 h-2 rounded-full" style={{ background: RED }} />}
                  </div>
                  <div>
                    <p style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{opt.label}</p>
                    <p style={{ color: T3, fontSize: 12, marginTop: 2 }}>{opt.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>

          <div
            className="flex items-center justify-between p-3 rounded-xl mt-3"
            style={{ background: TILE_BG, border: `1px solid ${BORDER}` }}
          >
            <div>
              <p style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>Laisser les promoteurs choisir</p>
              <p style={{ color: T3, fontSize: 12, marginTop: 2 }}>
                Si activé, chaque promoteur peut sélectionner son propre mode de tri depuis son éditeur linktree.
              </p>
            </div>
            <button
              onClick={handleAllowPromoterSortToggle}
              className="shrink-0 ml-4 w-11 h-6 rounded-full cursor-pointer transition-colors"
              style={{
                background: form.allow_promoter_sort ? RED : 'rgba(255,255,255,0.10)',
                boxShadow: form.allow_promoter_sort ? `0 0 14px -4px ${RED}88` : 'none',
              }}
            >
              <div
                className="w-4 h-4 rounded-full bg-white mx-1 transition-transform"
                style={{ transform: form.allow_promoter_sort ? 'translateX(18px)' : 'translateX(0)' }}
              />
            </button>
          </div>
        </SectionCard>

        {/* QR codes */}
        {form.linktree_slug && (
          <SectionCard delay={0.28}>
            <SectionHead
              icon={QrCode}
              title="QR Codes"
              subtitle="Imprimez ou partagez ces QR codes. Les scans sont trackés séparément (source « QR ») dans vos analytics."
            />
            <AffiliateQRSection
              items={[
                {
                  label: 'Page Agence',
                  description: 'Redirige vers votre linktree agence',
                  url: `${window.location.origin}/p/${form.linktree_slug}?utm_medium=qr&utm_source=print`,
                },
                {
                  label: `Toutes les soirées · ${form.city ?? 'Ville'}`,
                  description: 'Redirige vers l\'Explore Yuno filtré sur votre ville',
                  url: `${window.location.origin}/explore?city=${encodeURIComponent(form.city ?? '')}&utm_medium=qr&utm_source=print`,
                },
              ]}
            />
          </SectionCard>
        )}
      </div>
    </AffPage>
  );
}
