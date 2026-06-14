import { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Camera, Copy, Check, ExternalLink, QrCode, User, Link2, Share2 } from 'lucide-react';
import AffiliateQRSection from '@/components/affiliate/AffiliateQRSection';
import AvatarCropModal from '@/components/AvatarCropModal';
import {
  AffPage, AffHeading, AffCard, AffCardHeader, AffButton, AffSpinner,
  FieldLabel, DarkInput,
  RED, POS, T1, T2, T3, BORDER, INNER_BG, TILE_BG, F_BORDER,
} from '@/components/affiliate/affiliate-ui';

type MemberProfile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  linktree_slug: string | null;
  avatar_url: string | null;
  instagram: string | null;
  tiktok: string | null;
  whatsapp: string | null;
  website: string | null;
  affiliate: { name: string; city: string | null } | null;
};

type FormState = {
  first_name: string;
  last_name: string;
  linktree_slug: string;
  instagram: string;
  tiktok: string;
  whatsapp: string;
  website: string;
};

function toSlug(first: string, last: string): string {
  return `${first} ${last}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function AffiliatePromoterSettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [copied, setCopied] = useState(false);
  const [slugAutoSynced, setSlugAutoSynced] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);

  const [form, setForm] = useState<FormState>({
    first_name: '', last_name: '', linktree_slug: '', instagram: '', tiktok: '', whatsapp: '', website: '',
  });

  useEffect(() => {
    if (user) fetchProfile();
  }, [user]);

  const fetchProfile = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('affiliate_members')
      .select('id, first_name, last_name, linktree_slug, avatar_url, instagram, tiktok, whatsapp, website, affiliates(name, city)')
      .eq('user_id', user!.id)
      .eq('is_active', true)
      .maybeSingle();

    if (data) {
      const affiliate = Array.isArray((data as any).affiliates)
        ? (data as any).affiliates[0] ?? null
        : (data as any).affiliates ?? null;

      const p: MemberProfile = {
        id: data.id,
        first_name: (data as any).first_name ?? null,
        last_name: (data as any).last_name ?? null,
        linktree_slug: (data as any).linktree_slug ?? null,
        avatar_url: (data as any).avatar_url ?? null,
        instagram: (data as any).instagram ?? null,
        tiktok: (data as any).tiktok ?? null,
        whatsapp: (data as any).whatsapp ?? null,
        website: (data as any).website ?? null,
        affiliate,
      };
      setProfile(p);
      setForm({
        first_name: p.first_name ?? '',
        last_name: p.last_name ?? '',
        linktree_slug: p.linktree_slug ?? '',
        instagram: p.instagram ?? '',
        tiktok: p.tiktok ?? '',
        whatsapp: p.whatsapp ?? '',
        website: p.website ?? '',
      });
      setSlugAutoSynced(!p.linktree_slug);
    }
    setLoading(false);
  };

  const handleNameChange = (field: 'first_name' | 'last_name', value: string) => {
    setForm(f => {
      const next = { ...f, [field]: value };
      if (slugAutoSynced && next.first_name && next.last_name) {
        next.linktree_slug = toSlug(next.first_name, next.last_name);
      }
      return next;
    });
  };

  const handleSlugChange = (value: string) => {
    const clean = value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    setSlugAutoSynced(false);
    setForm(f => ({ ...f, linktree_slug: clean }));
  };

  const handleSave = async () => {
    if (!profile) return;
    if (!form.first_name.trim() || !form.last_name.trim()) {
      toast({ title: 'Champs requis', description: 'Prénom et nom sont obligatoires.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('affiliate_members')
        .update({
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          linktree_slug: form.linktree_slug.trim() || null,
          instagram: form.instagram.trim() || null,
          tiktok: form.tiktok.trim() || null,
          whatsapp: form.whatsapp.trim() || null,
          website: form.website.trim() || null,
        })
        .eq('id', profile.id);

      if (error) throw error;
      toast({ title: 'Profil mis à jour', description: 'Vos informations ont été sauvegardées.' });
      fetchProfile();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur inconnue';
      toast({ title: 'Erreur', description: msg, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setCropFile(file);
    e.target.value = '';
  };

  const handleCropConfirm = async (blob: Blob) => {
    setCropFile(null);
    if (!profile || !user) return;
    setUploadingAvatar(true);
    try {
      const path = `${user.id}/member-avatar.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('profile-photos')
        .upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('profile-photos').getPublicUrl(path);
      const avatarUrl = `${urlData.publicUrl}?t=${Date.now()}`;
      const { error: updateError } = await supabase
        .from('affiliate_members')
        .update({ avatar_url: avatarUrl })
        .eq('id', profile.id);
      if (updateError) throw updateError;

      setProfile(p => p ? { ...p, avatar_url: avatarUrl } : p);
      toast({ title: 'Photo mise à jour' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur upload';
      toast({ title: 'Erreur', description: msg, variant: 'destructive' });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const copyLinktreeUrl = () => {
    if (!form.linktree_slug) return;
    const url = `${window.location.origin}/promo/${form.linktree_slug}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) return <AffSpinner />;

  const displayName = form.first_name || form.last_name
    ? `${form.first_name} ${form.last_name}`.trim()
    : '—';

  return (
    <>
      {cropFile && <AvatarCropModal file={cropFile} onConfirm={handleCropConfirm} onCancel={() => setCropFile(null)} />}
      <AffPage maxWidth={760}>
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <AffHeading title="Mon profil" subtitle="Gérez votre identité et votre page publique" />
        </motion.div>

        {/* Avatar + identity preview */}
        <AffCard padding={20}>
          <div className="flex items-center gap-5">
            <div className="relative flex-none">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="Avatar" className="w-20 h-20 rounded-full object-cover" style={{ border: '2px solid rgba(232,25,44,0.25)' }} />
              ) : (
                <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ background: 'rgba(232,25,44,0.12)', border: '2px solid rgba(232,25,44,0.22)' }}>
                  <span style={{ color: RED, fontSize: 28, fontWeight: 700 }}>{form.first_name?.[0]?.toUpperCase() ?? '?'}</span>
                </div>
              )}
              {uploadingAvatar && (
                <div className="absolute inset-0 rounded-full flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}>
                  <div className="h-5 w-5 animate-spin rounded-full border-2" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
                </div>
              )}
              <button onClick={() => fileInputRef.current?.click()} disabled={uploadingAvatar}
                className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full flex items-center justify-center transition-colors"
                style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                <Camera className="h-3 w-3" style={{ color: T2 }} />
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
            </div>
            <div>
              <p style={{ color: T1, fontSize: 16, fontWeight: 600 }}>{displayName}</p>
              {profile?.affiliate && (
                <p style={{ color: T3, fontSize: 13, marginTop: 2 }}>
                  {profile.affiliate.name}{profile.affiliate.city && ` · ${profile.affiliate.city}`}
                </p>
              )}
            </div>
          </div>
        </AffCard>

        {/* Profil */}
        <AffCard padding={20}>
          <AffCardHeader icon={User} title="Profil" />
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldLabel>Prénom *</FieldLabel>
                <DarkInput value={form.first_name} onChange={(v) => handleNameChange('first_name', v)} placeholder="Jean" />
              </div>
              <div>
                <FieldLabel>Nom *</FieldLabel>
                <DarkInput value={form.last_name} onChange={(v) => handleNameChange('last_name', v)} placeholder="Dupont" />
              </div>
            </div>

            {profile?.affiliate && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FieldLabel>Agence</FieldLabel>
                  <div className="flex items-center px-3" style={{ height: 40, borderRadius: 10, background: TILE_BG, border: `1px solid ${F_BORDER}`, color: T2, fontSize: 13 }}>
                    {profile.affiliate.name}
                  </div>
                </div>
                {profile.affiliate.city && (
                  <div>
                    <FieldLabel>Ville</FieldLabel>
                    <div className="flex items-center px-3" style={{ height: 40, borderRadius: 10, background: TILE_BG, border: `1px solid ${F_BORDER}`, color: T2, fontSize: 13 }}>
                      {profile.affiliate.city}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </AffCard>

        {/* Linktree / Page publique */}
        <AffCard padding={20}>
          <AffCardHeader icon={Link2} title="Page publique" subtitle="Votre lien partageable, généré depuis votre nom" accent />
          <div className="space-y-4">
            <div>
              <FieldLabel>Identifiant URL</FieldLabel>
              <div className="flex items-stretch">
                <div className="flex items-center px-3 flex-none whitespace-nowrap"
                  style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${BORDER}`, borderRight: 'none', borderRadius: '10px 0 0 10px', color: T3, fontSize: 12.5 }}>
                  /promo/
                </div>
                <input value={form.linktree_slug} onChange={(e) => handleSlugChange(e.target.value)} placeholder="jean-dupont"
                  className="flex-1 outline-none"
                  style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: '0 10px 10px 0', padding: '9px 12px', color: T1, fontSize: 13.5 }}
                  onFocus={(e) => (e.target.style.borderColor = 'rgba(232,25,44,0.55)')} onBlur={(e) => (e.target.style.borderColor = BORDER)} />
              </div>
              <p style={{ color: T3, fontSize: 11, marginTop: 6 }}>Lettres minuscules, chiffres et tirets uniquement.</p>
            </div>

            {form.linktree_slug && (
              <div className="flex items-center gap-2">
                <AffButton variant="secondary" size="sm" onClick={copyLinktreeUrl}>
                  {copied ? <Check className="h-3.5 w-3.5" style={{ color: POS }} /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'Copié !' : 'Copier le lien'}
                </AffButton>
                <a href={`/promo/${form.linktree_slug}`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors"
                  style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, fontSize: 12.5, fontWeight: 600 }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = T1)} onMouseLeave={(e) => (e.currentTarget.style.color = T2)}>
                  <ExternalLink className="h-3.5 w-3.5" /> Voir la page
                </a>
              </div>
            )}
          </div>
        </AffCard>

        {/* QR codes */}
        {form.linktree_slug && (
          <AffCard padding={20}>
            <AffCardHeader icon={QrCode} title="Mon QR Code" subtitle='Scans trackés comme source "QR" dans tes stats' />
            <AffiliateQRSection
              items={[{
                label: 'Mon Linktree',
                description: 'Redirige vers ton linktree personnel',
                url: `${window.location.origin}/promo/${form.linktree_slug}?utm_medium=qr&utm_source=print`,
              }]}
            />
          </AffCard>
        )}

        {/* Réseaux sociaux */}
        <AffCard padding={20}>
          <AffCardHeader icon={Share2} title="Réseaux sociaux" />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel>Instagram</FieldLabel>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: T3, fontSize: 13 }}>@</span>
                <input value={form.instagram} onChange={(e) => setForm(f => ({ ...f, instagram: e.target.value }))} placeholder="moncompte"
                  className="w-full outline-none" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '9px 12px 9px 26px', color: T1, fontSize: 13.5 }}
                  onFocus={(e) => (e.target.style.borderColor = 'rgba(232,25,44,0.55)')} onBlur={(e) => (e.target.style.borderColor = BORDER)} />
              </div>
            </div>
            <div>
              <FieldLabel>TikTok</FieldLabel>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: T3, fontSize: 13 }}>@</span>
                <input value={form.tiktok} onChange={(e) => setForm(f => ({ ...f, tiktok: e.target.value }))} placeholder="moncompte"
                  className="w-full outline-none" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '9px 12px 9px 26px', color: T1, fontSize: 13.5 }}
                  onFocus={(e) => (e.target.style.borderColor = 'rgba(232,25,44,0.55)')} onBlur={(e) => (e.target.style.borderColor = BORDER)} />
              </div>
            </div>
            <div>
              <FieldLabel>WhatsApp</FieldLabel>
              <DarkInput value={form.whatsapp} onChange={(v) => setForm(f => ({ ...f, whatsapp: v }))} placeholder="+34 600 000 000" />
            </div>
            <div>
              <FieldLabel>Site web</FieldLabel>
              <DarkInput value={form.website} onChange={(v) => setForm(f => ({ ...f, website: v }))} placeholder="https://monsite.com" />
            </div>
          </div>
        </AffCard>

        <AffButton onClick={handleSave} disabled={saving}>
          {saving ? 'Sauvegarde…' : 'Sauvegarder'}
        </AffButton>
      </AffPage>
    </>
  );
}
