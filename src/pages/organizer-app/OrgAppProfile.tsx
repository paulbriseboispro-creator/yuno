import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { ExternalLink, Loader2, Upload, Globe, Image as ImageIcon, User, Building2, FileText, Trash2, MapPin } from 'lucide-react';
import { Instagram } from '@/components/icons/Instagram';
import { ImageCropperDialog } from '@/components/ImageCropperDialog';
import {
  OrgPage, OrgPageHeader, OrgCard, OrgButton,
  FieldLabel, DarkInput, DarkTextarea,
  RED, T1, T3, BORDER, INNER_BG,
} from '@/components/org-ui';

interface OrgProfile {
  user_id: string;
  display_name: string;
  slug: string | null;
  bio: string | null;
  city: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  instagram_url: string | null;
  website_url: string | null;
  is_public: boolean;
  legal_name: string | null;
  legal_address: string | null;
  siret: string | null;
  vat_number: string | null;
  billing_email: string | null;
  minors_allowed: boolean;
  minor_auth_doc_url: string | null;
  minor_auth_doc_name: string | null;
  absorb_yuno_fees: boolean;
}

export default function OrgAppProfile() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [cropperType, setCropperType] = useState<'avatar' | 'cover' | null>(null);

  const [profile, setProfile] = useState<OrgProfile>({
    user_id: '', display_name: '', slug: null, bio: '', city: '', avatar_url: '', cover_url: '',
    instagram_url: '', website_url: '', is_public: true,
    legal_name: '', legal_address: '', siret: '', vat_number: '', billing_email: '', minors_allowed: false,
    minor_auth_doc_url: null, minor_auth_doc_name: null, absorb_yuno_fees: false,
  });

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from('organizer_profiles')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (data) {
        setProfile({
          user_id: data.user_id,
          display_name: data.display_name || '',
          slug: data.slug,
          bio: data.bio || '',
          city: data.city || '',
          avatar_url: data.avatar_url || '',
          cover_url: data.cover_url || '',
          instagram_url: data.instagram_url || '',
          website_url: data.website_url || '',
          is_public: data.is_public ?? true,
          legal_name: (data as any).legal_name || '',
          legal_address: (data as any).legal_address || '',
          siret: (data as any).siret || '',
          vat_number: (data as any).vat_number || '',
          billing_email: (data as any).billing_email || '',
          minors_allowed: (data as any).minors_allowed ?? false,
          minor_auth_doc_url: (data as any).minor_auth_doc_url ?? null,
          minor_auth_doc_name: (data as any).minor_auth_doc_name ?? null,
          absorb_yuno_fees: (data as any).absorb_yuno_fees ?? false,
        });
      } else {
        const { data: prof } = await supabase
          .from('profiles')
          .select('organization_name, organization_logo_url')
          .eq('id', user.id)
          .maybeSingle();
        setProfile((p) => ({
          ...p,
          user_id: user.id,
          display_name: prof?.organization_name || '',
          avatar_url: prof?.organization_logo_url || '',
        }));
      }
      setLoading(false);
    })();
  }, [user]);

  const uploadImage = async (file: File, type: 'avatar' | 'cover'): Promise<string | null> => {
    if (!user) return null;
    if (!file.type.startsWith('image/')) {
      toast.error(t('Format non supporté', 'Unsupported format'));
      return null;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error(t('Image trop lourde (max 8 Mo)', 'Image too heavy (max 8 MB)'));
      return null;
    }
    const setter = type === 'avatar' ? setUploadingAvatar : setUploadingCover;
    setter(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `${user.id}/org-${type}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from('profile-photos')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      const { data } = supabase.storage.from('profile-photos').getPublicUrl(path);
      // The path already carries a unique Date.now() segment, so the public URL
      // is distinct per upload — no query-string cache-buster needed. A ?t= here
      // would get baked into the stored URL and break getOptimizedImageUrl's
      // transform params on the public profile (malformed ?t=123?width=...).
      return data.publicUrl;
    } catch (e: any) {
      toast.error(e.message || t('Erreur upload', 'Upload error'));
      return null;
    } finally {
      setter(false);
    }
  };

  const [uploadingMinorDoc, setUploadingMinorDoc] = useState(false);
  const handleMinorDocUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !user) return;
    const isTxt = file.type === 'text/plain' || /\.txt$/i.test(file.name);
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!isPdf && !isTxt) { toast.error(t('Fichiers PDF ou TXT uniquement', 'PDF or TXT files only')); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error(t('Fichier trop volumineux (max 10 Mo)', 'File too large (max 10 MB)')); return; }
    setUploadingMinorDoc(true);
    try {
      const ext = isTxt ? 'txt' : 'pdf';
      const path = `${user.id}/minor-auth-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('profile-photos').upload(path, file, { upsert: true, contentType: file.type || (isTxt ? 'text/plain' : 'application/pdf') });
      if (error) throw error;
      const { data } = supabase.storage.from('profile-photos').getPublicUrl(path);
      setProfile((p) => ({ ...p, minor_auth_doc_url: data.publicUrl, minor_auth_doc_name: file.name }));
      toast.success(t('Document ajouté — pensez à enregistrer', 'Document added — remember to save'));
    } catch (err: any) {
      toast.error(err.message || t('Erreur upload', 'Upload error'));
    } finally {
      setUploadingMinorDoc(false);
    }
  };

  const save = async () => {
    if (!user) return;
    if (!profile.display_name.trim()) {
      toast.error(t('Nom requis', 'Name required'));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        user_id: user.id,
        display_name: profile.display_name.trim(),
        bio: profile.bio?.trim() || null,
        city: profile.city?.trim() || null,
        avatar_url: profile.avatar_url || null,
        cover_url: profile.cover_url || null,
        instagram_url: profile.instagram_url?.trim() || null,
        website_url: profile.website_url?.trim() || null,
        is_public: profile.is_public,
        legal_name: profile.legal_name?.trim() || null,
        legal_address: profile.legal_address?.trim() || null,
        siret: profile.siret?.trim() || null,
        vat_number: profile.vat_number?.trim() || null,
        billing_email: profile.billing_email?.trim() || null,
        minors_allowed: profile.minors_allowed,
        minor_auth_doc_url: profile.minor_auth_doc_url,
        minor_auth_doc_name: profile.minor_auth_doc_name,
        absorb_yuno_fees: profile.absorb_yuno_fees,
      };
      const { error } = await supabase
        .from('organizer_profiles')
        .upsert(payload, { onConflict: 'user_id' });
      if (error) throw error;

      const { error: profErr } = await supabase
        .from('profiles')
        .update({ organization_name: payload.display_name, organization_logo_url: payload.avatar_url })
        .eq('id', user.id);
      if (profErr) throw profErr;

      toast.success(t('Profil enregistré', 'Profile saved'));

      const { data: refreshed } = await supabase
        .from('organizer_profiles')
        .select('slug')
        .eq('user_id', user.id)
        .maybeSingle();
      if (refreshed?.slug) setProfile((p) => ({ ...p, slug: refreshed.slug }));
    } catch (e: any) {
      toast.error(e.message || t('Erreur', 'Error'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin" style={{ color: T3 }} /></div>;
  }

  const publicUrl = profile.slug ? `/o/${profile.slug}` : null;

  return (
    <OrgPage className="mx-auto max-w-3xl">
      <OrgPageHeader
        title={t('Profil public', 'Public profile')}
        subtitle={t("Votre vitrine sur Yuno. Visible par tous quand l'option est activée.", 'Your storefront on Yuno. Visible to everyone when enabled.')}
        actions={publicUrl ? (
          <OrgButton variant="secondary" size="sm" href={publicUrl}>
            <ExternalLink className="h-4 w-4" />{t('Voir le profil public', 'View public profile')}
          </OrgButton>
        ) : undefined}
      />

      <OrgCard>
        <div className="space-y-5 p-6">
          {/* Cover */}
          <div>
            <FieldLabel><ImageIcon className="mr-1 inline h-3 w-3" /> {t('Bannière de couverture', 'Cover banner')}</FieldLabel>
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
              {profile.cover_url ? (
                <img src={profile.cover_url} alt="cover" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center" style={{ color: 'rgba(255,255,255,0.18)' }}><ImageIcon className="h-10 w-10" /></div>
              )}
              {uploadingCover && (
                <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}><Loader2 className="h-6 w-6 animate-spin" style={{ color: T1 }} /></div>
              )}
            </div>
            <input id="cover-upload" type="file" accept="image/*" className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (!f.type.startsWith('image/')) { toast.error(t('Format non supporté', 'Unsupported format')); e.target.value = ''; return; }
                setPendingFile(f); setCropperType('cover'); e.target.value = '';
              }}
            />
            <div className="mt-2">
              <OrgButton size="sm" variant="secondary" onClick={() => document.getElementById('cover-upload')?.click()} disabled={uploadingCover}>
                <Upload className="h-3.5 w-3.5" />
                {profile.cover_url ? t('Remplacer la couverture', 'Replace cover') : t('Ajouter une couverture', 'Add cover')}
              </OrgButton>
            </div>
          </div>

          {/* Avatar + name */}
          <div className="flex items-start gap-4">
            <div className="relative">
              <div className="h-20 w-20 overflow-hidden rounded-2xl" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                {profile.avatar_url ? (
                  <img src={profile.avatar_url} alt="avatar" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center" style={{ color: 'rgba(255,255,255,0.18)' }}><User className="h-8 w-8" /></div>
                )}
              </div>
              {uploadingAvatar && (
                <div className="absolute inset-0 flex items-center justify-center rounded-2xl" style={{ background: 'rgba(0,0,0,0.6)' }}><Loader2 className="h-5 w-5 animate-spin" style={{ color: T1 }} /></div>
              )}
              <input id="avatar-upload" type="file" accept="image/*" className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (!f.type.startsWith('image/')) { toast.error(t('Format non supporté', 'Unsupported format')); e.target.value = ''; return; }
                  setPendingFile(f); setCropperType('avatar'); e.target.value = '';
                }}
              />
              <button type="button" onClick={() => document.getElementById('avatar-upload')?.click()}
                className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full shadow-lg"
                style={{ background: RED, color: '#fff' }} aria-label="Change avatar">
                <Upload className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex-1 space-y-3">
              <div>
                <FieldLabel>{t("Nom de l'organisation", 'Organization name')} *</FieldLabel>
                <DarkInput value={profile.display_name} onChange={(v) => setProfile((p) => ({ ...p, display_name: v }))} placeholder="Ex: VIDA EVENTS" />
              </div>
              {profile.slug && (
                <p style={{ color: T3, fontSize: 11.5 }}>
                  {t('URL publique :', 'Public URL:')}{' '}
                  <span className="font-mono" style={{ color: RED }}>/o/{profile.slug}</span>
                </p>
              )}
            </div>
          </div>

          {/* Bio */}
          <div>
            <FieldLabel>{t('Bio', 'Bio')}</FieldLabel>
            <DarkTextarea value={profile.bio || ''} onChange={(v) => setProfile((p) => ({ ...p, bio: v }))} rows={3} placeholder={t('Présentez votre collectif en quelques mots…', 'Introduce your collective in a few words…')} />
          </div>

          {/* City — shown on your public profile and on followers' favorites cards */}
          <div>
            <FieldLabel><MapPin className="mr-1 inline h-3 w-3" /> {t('Ville', 'City', 'Ciudad')}</FieldLabel>
            <DarkInput value={profile.city || ''} onChange={(v) => setProfile((p) => ({ ...p, city: v }))} placeholder={t('Ex : Paris', 'e.g. Paris', 'Ej: Madrid')} />
          </div>

          {/* Social */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel><Instagram className="mr-1 inline h-3 w-3" /> Instagram</FieldLabel>
              <DarkInput value={profile.instagram_url || ''} onChange={(v) => setProfile((p) => ({ ...p, instagram_url: v }))} placeholder="https://instagram.com/votre-orga" />
            </div>
            <div>
              <FieldLabel><Globe className="mr-1 inline h-3 w-3" /> {t('Site web', 'Website')}</FieldLabel>
              <DarkInput value={profile.website_url || ''} onChange={(v) => setProfile((p) => ({ ...p, website_url: v }))} placeholder="https://…" />
            </div>
          </div>

          {/* Visibility */}
          <div className="flex items-center justify-between rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
            <div>
              <p style={{ color: T1, fontSize: 13, fontWeight: 540 }}>{t('Profil public', 'Public profile')}</p>
              <p className="mt-0.5" style={{ color: T3, fontSize: 11.5 }}>
                {t('Quand activé, votre profil est visible par tous les utilisateurs.', 'When enabled, your profile is visible to all users.')}
              </p>
            </div>
            <Switch checked={profile.is_public} onCheckedChange={(v) => setProfile((p) => ({ ...p, is_public: v }))} />
          </div>

          {/* Cover the Yuno commission (fee absorption) */}
          <div className="flex items-center justify-between rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
            <div>
              <p style={{ color: T1, fontSize: 13, fontWeight: 540 }}>{t('Prendre en charge la commission Yuno', 'Cover the Yuno commission', 'Asumir la comisión de Yuno')}</p>
              <p className="mt-0.5" style={{ color: T3, fontSize: 11.5 }}>
                {t('Sur vos événements sans club, vos clients ne paient que les frais de transaction au lieu de la commission Yuno : des frais réduits pour eux, à votre charge.', 'On your venue-less events, your customers only pay the transaction fee instead of the Yuno commission — lower fees for them, at your expense.', 'En tus eventos sin club, tus clientes solo pagan los gastos de transacción en lugar de la comisión de Yuno: tarifas más bajas para ellos, a tu cargo.')}
              </p>
            </div>
            <Switch checked={profile.absorb_yuno_fees} onCheckedChange={(v) => setProfile((p) => ({ ...p, absorb_yuno_fees: v }))} />
          </div>

          {/* Minors allowed (alcohol-free) */}
          <div className="rounded-xl p-3 space-y-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
            <div className="flex items-center justify-between">
              <div>
                <p style={{ color: T1, fontSize: 13, fontWeight: 540 }}>{t('Autoriser les mineurs (sans alcool)', 'Allow minors (alcohol-free)')}</p>
                <p className="mt-0.5" style={{ color: T3, fontSize: 11.5 }}>
                  {t('Quand activé, toutes vos soirées acceptent les mineurs et sont signalées sans alcool. Désactivable par soirée à la création.', 'When enabled, all your events allow minors and are flagged alcohol-free. Can be disabled per event at creation.')}
                </p>
              </div>
              <Switch checked={profile.minors_allowed} onCheckedChange={(v) => setProfile((p) => ({ ...p, minors_allowed: v }))} />
            </div>

            {profile.minors_allowed && (
              <div className="pt-3" style={{ borderTop: `1px solid ${BORDER}` }}>
                <p style={{ color: T1, fontSize: 12.5, fontWeight: 540 }}>{t("Document d'autorisation (mineurs)", 'Authorization document (minors)')}</p>
                <p className="mt-0.5 mb-2" style={{ color: T3, fontSize: 11.5 }}>
                  {t("Optionnel : un PDF à faire signer aux mineurs (autorisation parentale, décharge...). Joint au récap de commande des soirées sans alcool.", 'Optional: a PDF for minors to sign (parental consent, waiver...). Shared on the order summary for alcohol-free events.')}
                </p>
                {profile.minor_auth_doc_url ? (
                  <div className="flex items-center gap-3 rounded-xl p-3" style={{ background: '#0d0d0f', border: `1px solid ${BORDER}` }}>
                    <FileText className="h-5 w-5 flex-none" style={{ color: RED }} />
                    <a href={profile.minor_auth_doc_url} target="_blank" rel="noopener noreferrer" className="flex-1 truncate" style={{ color: T1, fontSize: 13 }}>{profile.minor_auth_doc_name || 'Document'}</a>
                    <button type="button" onClick={() => {
                        if (!confirm(t(
                          'Supprimer le document d’autorisation ? Cette action est définitive.',
                          'Delete the authorization document? This action is permanent.'
                        ))) return;
                        setProfile((p) => ({ ...p, minor_auth_doc_url: null, minor_auth_doc_name: null }));
                      }}
                      className="flex-none p-2 rounded-lg" style={{ color: T3 }}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <label className="flex items-center justify-center gap-2 rounded-xl px-4 py-3 cursor-pointer"
                    style={{ background: '#0d0d0f', border: `1px dashed ${BORDER}`, color: uploadingMinorDoc ? T3 : T1, fontSize: 13, fontWeight: 540 }}>
                    {uploadingMinorDoc
                      ? <><Loader2 className="h-4 w-4 animate-spin" />{t('Envoi...', 'Uploading...')}</>
                      : <><Upload className="h-4 w-4" />{t('Uploader un PDF ou TXT', 'Upload a PDF or TXT')}</>}
                    <input type="file" accept="application/pdf,.pdf,text/plain,.txt" className="hidden" disabled={uploadingMinorDoc} onChange={handleMinorDocUpload} />
                  </label>
                )}
              </div>
            )}
          </div>

          {/* Billing info */}
          <div className="rounded-xl p-4" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4" style={{ color: RED }} />
              <span style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{t('Informations de facturation', 'Billing information')}</span>
            </div>
            <p className="mt-1" style={{ color: T3, fontSize: 11.5 }}>
              {t('Ces informations apparaîtront sur les factures émises pour vos soirées.', 'These details appear on invoices issued for your events.')}
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><FieldLabel>{t('Raison sociale', 'Legal name')}</FieldLabel><DarkInput value={profile.legal_name || ''} onChange={(v) => setProfile((p) => ({ ...p, legal_name: v }))} placeholder="Ex: VIDA EVENTS SAS" /></div>
              <div className="sm:col-span-2"><FieldLabel>{t('Adresse complète', 'Full address')}</FieldLabel><DarkTextarea rows={2} value={profile.legal_address || ''} onChange={(v) => setProfile((p) => ({ ...p, legal_address: v }))} placeholder="12 rue Exemple, 75001 Paris, France" /></div>
              <div><FieldLabel>SIRET</FieldLabel><DarkInput value={profile.siret || ''} onChange={(v) => setProfile((p) => ({ ...p, siret: v }))} placeholder="123 456 789 00010" /></div>
              <div><FieldLabel>{t('N° TVA', 'VAT number')}</FieldLabel><DarkInput value={profile.vat_number || ''} onChange={(v) => setProfile((p) => ({ ...p, vat_number: v }))} placeholder="FR12345678901" /></div>
              <div className="sm:col-span-2"><FieldLabel>{t('Email de facturation', 'Billing email')}</FieldLabel><DarkInput type="email" value={profile.billing_email || ''} onChange={(v) => setProfile((p) => ({ ...p, billing_email: v }))} placeholder="billing@votre-orga.com" /></div>
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <OrgButton variant="primary" onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('Enregistrer', 'Save')}
            </OrgButton>
          </div>
        </div>
      </OrgCard>

      <ImageCropperDialog
        open={cropperType !== null}
        onOpenChange={(o) => { if (!o) { setCropperType(null); setPendingFile(null); } }}
        imageFile={pendingFile}
        aspectRatio={cropperType === 'cover' ? 4 / 3 : 1}
        shape={cropperType === 'avatar' ? 'circle' : 'rect'}
        outputSize={cropperType === 'avatar' ? 512 : 1500}
        title={cropperType === 'avatar' ? t('Cadrer le logo', 'Crop logo') : t('Cadrer la bannière', 'Crop banner')}
        helperText={t('Glissez pour déplacer · pincez ou utilisez le curseur pour zoomer', 'Drag to move · pinch or use slider to zoom')}
        onCrop={async (cropped) => {
          const type = cropperType;
          setCropperType(null);
          setPendingFile(null);
          if (!type) return;
          const url = await uploadImage(cropped, type);
          if (url) setProfile((p) => (type === 'avatar' ? { ...p, avatar_url: url } : { ...p, cover_url: url }));
        }}
      />
    </OrgPage>
  );
}
