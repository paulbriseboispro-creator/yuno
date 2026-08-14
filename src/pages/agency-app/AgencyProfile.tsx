import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAgency } from '@/hooks/useAgency';
import { useAffiliateShell } from '@/contexts/AffiliateShellContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { toast } from 'sonner';
import { errorToast } from '@/lib/errorToast';
import { Building2, Camera, ExternalLink, Globe, Store, Image as ImageIcon, Trash2 } from 'lucide-react';
import {
  T1, T2, T3, RED, F_BORDER, BORDER, INNER_BG, C_FAINT,
  PromoButton, PromoCard, DarkInput, FieldLabel, CopyField,
} from '@/components/promoter/promoter-ui';
import RenameConfirmDialog from '@/components/RenameConfirmDialog';
import { DeleteAccountAction } from '@/components/account/DeleteAccountAction';
import { ImageCropperDialog } from '@/components/ImageCropperDialog';
import { nextRenameAt, parseRenameCooldownError, slugifyName } from '@/lib/renameGuard';

/**
 * Profil de l'agence — l'identité maître, et le SEUL endroit où elle s'édite.
 * Nom, ville, bio, logo et réseaux sont synchronisés vers le bras externe
 * (ligne `affiliates`) par trigger : la page RP publique (/rp/:slug) et le
 * linktree (/p/:slug) suivent automatiquement chaque enregistrement.
 */
export default function AgencyProfile() {
  const { agency, loading, refetch } = useAgency();
  const shell = useAffiliateShell();
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [bio, setBio] = useState('');
  const [instagram, setInstagram] = useState('');
  const [tiktok, setTiktok] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [website, setWebsite] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [slug, setSlug] = useState<string | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [bannerBusy, setBannerBusy] = useState(false);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  // Recadrage : le fichier choisi passe par l'ImageCropperDialog (glisser +
  // zoom, cadre carré = rendu final) avant l'upload.
  const [cropTarget, setCropTarget] = useState<'logo' | 'banner' | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  useEffect(() => {
    if (!agency) return;
    setName(agency.name ?? '');
    setCity(agency.city ?? '');
    setBio(agency.bio ?? '');
    setInstagram(agency.instagram_url ?? '');
    setTiktok(agency.tiktok_url ?? '');
    setWhatsapp(agency.whatsapp_number ?? '');
    setWebsite(agency.website_url ?? '');
    setEmail(agency.contact_email ?? '');
  }, [agency?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Le slug public vit sur le bras externe (affiliates.linktree_slug) : c'est
  // lui qui sert /rp/:slug ET /p/:slug. La bannière de la page RP vit là aussi
  // (hors synchro maître — cast any : pas encore dans les types générés).
  useEffect(() => {
    const affiliateId = shell?.affiliateId;
    if (!affiliateId) return;
    let active = true;
    (async () => {
      const { data } = await (supabase as any)
        .from('affiliates')
        .select('linktree_slug, banner_url')
        .eq('id', affiliateId)
        .maybeSingle();
      if (active) {
        setSlug(data?.linktree_slug ?? null);
        setBannerUrl(data?.banner_url ?? null);
      }
    })();
    return () => { active = false; };
  }, [shell?.affiliateId]);

  // Renommage = les liens publics suivent (trigger SQL) + verrou de 30 jours.
  const isRenaming = !!agency && name.trim() !== '' && name.trim() !== (agency.name ?? '').trim();
  const renameLockedUntil = nextRenameAt((agency as { name_changed_at?: string | null } | null)?.name_changed_at);
  const [renameOpen, setRenameOpen] = useState(false);

  const handleSave = async () => {
    if (!agency) return;
    if (!name.trim()) { toast.error(tt('Le nom est requis', 'Name is required', 'El nombre es obligatorio')); return; }
    if (isRenaming && renameLockedUntil) {
      toast.error(tt(
        `Nom déjà changé récemment — prochain changement possible le ${renameLockedUntil.toLocaleDateString(language)}`,
        `Name changed recently — next change possible on ${renameLockedUntil.toLocaleDateString(language)}`,
        `Nombre cambiado hace poco — próximo cambio posible el ${renameLockedUntil.toLocaleDateString(language)}`,
      ));
      return;
    }
    // Double vérification avant tout renommage : le dialogue rappelle que les
    // liens publics changent et que le nom est ensuite verrouillé 30 jours.
    if (isRenaming && !renameOpen) { setRenameOpen(true); return; }
    setSaving(true);
    const { error } = await (supabase as any).rpc('update_agency_profile', {
      p_agency_id:        agency.id,
      p_name:             name.trim() || null,
      p_city:             city.trim() || null,
      p_bio:              bio.trim() || null,
      p_instagram_url:    instagram.trim() || null,
      p_tiktok_url:       tiktok.trim() || null,
      p_whatsapp_number:  whatsapp.trim() || null,
      p_website_url:      website.trim() || null,
      p_contact_email:    email.trim() || null,
    });
    setSaving(false);
    setRenameOpen(false);
    if (error) {
      const lockedUntil = parseRenameCooldownError(error);
      if (lockedUntil) {
        toast.error(tt(
          `Nom déjà changé récemment — prochain changement possible le ${lockedUntil.toLocaleDateString(language)}`,
          `Name changed recently — next change possible on ${lockedUntil.toLocaleDateString(language)}`,
          `Nombre cambiado hace poco — próximo cambio posible el ${lockedUntil.toLocaleDateString(language)}`,
        ));
        return;
      }
      errorToast(error);
      return;
    }
    toast.success(tt('Profil enregistré — vos pages publiques sont à jour', 'Profile saved — your public pages are up to date', 'Perfil guardado: tus páginas públicas están al día'));
    refetch();
  };

  // Sélection → recadrage → upload. Le cropper sort déjà un JPEG carré à la
  // bonne taille : pas de recompression derrière.
  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setPendingFile(file); setCropTarget('logo'); }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const uploadLogo = async (cropped: File) => {
    const affiliateId = shell?.affiliateId;
    if (!agency || !affiliateId) return;
    setUploadingLogo(true);
    try {
      // Le bucket exige un chemin préfixé par l'id du bras externe possédé.
      const path = `${affiliateId}/agency-logo/${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('affiliate-media')
        .upload(path, cropped, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from('affiliate-media').getPublicUrl(path);
      const { error: rpcError } = await (supabase as any).rpc('update_agency_profile', {
        p_agency_id: agency.id,
        p_logo_url:  urlData.publicUrl,
      });
      if (rpcError) throw rpcError;
      toast.success(tt('Logo mis à jour', 'Logo updated', 'Logo actualizado'));
      refetch();
    } catch (err) {
      errorToast(err);
    } finally {
      setUploadingLogo(false);
    }
  };

  // Bannière 1:1 de la page RP — écrite directement sur le bras externe
  // (policy UPDATE user_id = chef d'agence), jamais écrasée par la synchro.
  const handleBannerSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setPendingFile(file); setCropTarget('banner'); }
    if (bannerInputRef.current) bannerInputRef.current.value = '';
  };

  const uploadBanner = async (cropped: File) => {
    const affiliateId = shell?.affiliateId;
    if (!affiliateId) return;
    setBannerBusy(true);
    try {
      const path = `${affiliateId}/agency-banner/${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('affiliate-media')
        .upload(path, cropped, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from('affiliate-media').getPublicUrl(path);
      const { error: updateError } = await (supabase as any)
        .from('affiliates')
        .update({ banner_url: urlData.publicUrl })
        .eq('id', affiliateId);
      if (updateError) throw updateError;
      setBannerUrl(urlData.publicUrl);
      toast.success(tt('Bannière mise à jour', 'Banner updated', 'Banner actualizado'));
    } catch (err) {
      errorToast(err);
    } finally {
      setBannerBusy(false);
    }
  };

  const handleBannerRemove = async () => {
    const affiliateId = shell?.affiliateId;
    if (!affiliateId) return;
    setBannerBusy(true);
    const { error } = await (supabase as any)
      .from('affiliates')
      .update({ banner_url: null })
      .eq('id', affiliateId);
    setBannerBusy(false);
    if (error) { errorToast(error); return; }
    setBannerUrl(null);
    toast.success(tt('Bannière retirée — retour à l\'affiche automatique', 'Banner removed — back to the automatic flyer', 'Banner quitado: vuelta al cartel automático'));
  };

  if (loading || !agency) return null;

  const origin = window.location.origin;

  return (
    <div className="py-4 space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center flex-none"
          style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.22)' }}>
          <Building2 className="h-4.5 w-4.5" style={{ color: RED }} />
        </div>
        <div>
          <h1 style={{ color: T1, fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>
            {tt("Profil de l'agence", 'Agency profile', 'Perfil de la agencia')}
          </h1>
          <p style={{ color: T3, fontSize: 12 }}>
            {tt('Votre identité maître — la page RP et le linktree publics suivent automatiquement.',
                'Your master identity — the public RP page and linktree follow automatically.',
                'Tu identidad maestra: la página RP y el linktree públicos se actualizan solos.')}
          </p>
        </div>
      </div>

      {/* Logo — synchronisé vers l'avatar public des deux pages */}
      <PromoCard>
        <div className="flex items-center gap-5">
          <div className="relative flex-none">
            {agency.logo_url ? (
              <img src={agency.logo_url} alt={agency.name}
                className="w-20 h-20 rounded-2xl object-cover"
                style={{ border: `1px solid ${BORDER}` }} />
            ) : (
              <div className="w-20 h-20 rounded-2xl flex items-center justify-center"
                style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                <span style={{ color: T2, fontSize: 26, fontWeight: 700 }}>{(agency.name || '?')[0]?.toUpperCase()}</span>
              </div>
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingLogo}
              className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-full flex items-center justify-center cursor-pointer"
              style={{ background: RED, boxShadow: `0 0 14px -4px ${RED}88` }}
            >
              {uploadingLogo
                ? <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                : <Camera className="h-3.5 w-3.5 text-white" />}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoSelect} />
          </div>
          <div className="min-w-0">
            <p style={{ color: T1, fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>{agency.name}</p>
            <p style={{ color: T3, fontSize: 12, marginTop: 4 }}>
              {tt('Ce logo est votre visage public : page RP, linktree, cartes « RP » sur les fiches soirée.',
                  'This logo is your public face: RP page, linktree, “RP” cards on event pages.',
                  'Este logo es tu cara pública: página RP, linktree y tarjetas «RP» en las fichas de fiesta.')}
            </p>
          </div>
        </div>
      </PromoCard>

      {/* Bannière 1:1 de la page RP */}
      <PromoCard>
        <div className="flex items-center gap-2 mb-1.5">
          <ImageIcon className="h-4 w-4" style={{ color: RED }} />
          <p style={{ color: T1, fontSize: 14, fontWeight: 650 }}>
            {tt('Bannière de la page RP', 'RP page banner', 'Banner de la página RP')}
          </p>
        </div>
        <p style={{ color: T3, fontSize: 12, marginBottom: 12 }}>
          {tt('Votre photo, en format carré 1:1, affichée en tête de votre page RP. Sans bannière, l\'affiche de votre prochaine soirée est utilisée automatiquement.',
              'Your photo, in square 1:1 format, shown at the top of your RP page. Without a banner, your next event\'s flyer is used automatically.',
              'Tu foto, en formato cuadrado 1:1, mostrada en la cabecera de tu página RP. Sin banner, se usa automáticamente el cartel de tu próxima fiesta.')}
        </p>
        <div className="flex items-start gap-4 flex-wrap">
          <div className="relative flex-none" style={{ width: 180 }}>
            <div className="overflow-hidden" style={{ aspectRatio: '1 / 1', borderRadius: 14, border: `1px solid ${BORDER}`, background: INNER_BG }}>
              {bannerUrl ? (
                <img src={bannerUrl} alt={tt('Bannière', 'Banner', 'Banner')} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                  <ImageIcon className="h-6 w-6" style={{ color: T3 }} />
                  <span style={{ color: T3, fontSize: 11 }}>1:1</span>
                </div>
              )}
            </div>
            <button
              onClick={() => bannerInputRef.current?.click()}
              disabled={bannerBusy}
              className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-full flex items-center justify-center cursor-pointer"
              style={{ background: RED, boxShadow: `0 0 14px -4px ${RED}88` }}
            >
              {bannerBusy
                ? <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                : <Camera className="h-3.5 w-3.5 text-white" />}
            </button>
            <input ref={bannerInputRef} type="file" accept="image/*" className="hidden" onChange={handleBannerSelect} />
          </div>
          <div className="min-w-0 flex-1" style={{ minWidth: 180 }}>
            <div className="flex flex-wrap gap-2">
              <PromoButton size="sm" variant="secondary" onClick={() => bannerInputRef.current?.click()} disabled={bannerBusy}>
                <Camera className="h-4 w-4" />
                {bannerUrl
                  ? tt('Changer la bannière', 'Change banner', 'Cambiar el banner')
                  : tt('Ajouter ma bannière', 'Upload my banner', 'Subir mi banner')}
              </PromoButton>
              {bannerUrl && (
                <PromoButton size="sm" variant="secondary" onClick={handleBannerRemove} disabled={bannerBusy}>
                  <Trash2 className="h-4 w-4" />
                  {tt('Retirer', 'Remove', 'Quitar')}
                </PromoButton>
              )}
            </div>
            <p style={{ color: T3, fontSize: 11.5, marginTop: 10 }}>
              {tt('Conseil : une photo d\'ambiance de vos soirées (foule, lumières) fonctionne mieux qu\'un logo.',
                  'Tip: an atmosphere shot from your events (crowd, lights) works better than a logo.',
                  'Consejo: una foto de ambiente de tus fiestas (público, luces) funciona mejor que un logo.')}
            </p>
          </div>
        </div>
      </PromoCard>

      {/* Identité + réseaux */}
      <PromoCard>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <FieldLabel>{tt('Nom', 'Name', 'Nombre')} *</FieldLabel>
            <DarkInput value={name} onChange={setName} placeholder={tt("Nom de l'agence", 'Agency name', 'Nombre de la agencia')} />
            {isRenaming && (
              <p style={{ color: T3, fontSize: 11, marginTop: 4 }}>
                {renameLockedUntil
                  ? tt(
                      `Prochain changement de nom possible le ${renameLockedUntil.toLocaleDateString(language)}.`,
                      `Next name change possible on ${renameLockedUntil.toLocaleDateString(language)}.`,
                      `Próximo cambio de nombre posible el ${renameLockedUntil.toLocaleDateString(language)}.`,
                    )
                  : tt(
                      'Renommer met à jour vos liens publics (les anciens redirigent) — 1 changement max tous les 30 jours.',
                      'Renaming updates your public links (old ones redirect) — max 1 change every 30 days.',
                      'Renombrar actualiza tus enlaces públicos (los antiguos redirigen): máx. 1 cambio cada 30 días.',
                    )}
              </p>
            )}
          </div>
          <div>
            <FieldLabel>{tt('Ville', 'City', 'Ciudad')}</FieldLabel>
            <DarkInput value={city} onChange={setCity} placeholder="Madrid" />
          </div>
          <div className="sm:col-span-2">
            <FieldLabel>{tt('Bio', 'Bio', 'Bio')}</FieldLabel>
            <DarkInput value={bio} onChange={setBio} placeholder={tt('Courte description…', 'Short description…', 'Descripción corta…')} />
          </div>
          <div>
            <FieldLabel>Instagram</FieldLabel>
            <DarkInput value={instagram} onChange={setInstagram} placeholder="https://instagram.com/…" />
          </div>
          <div>
            <FieldLabel>TikTok</FieldLabel>
            <DarkInput value={tiktok} onChange={setTiktok} placeholder="https://tiktok.com/@…" />
          </div>
          <div>
            <FieldLabel>WhatsApp</FieldLabel>
            <DarkInput value={whatsapp} onChange={setWhatsapp} placeholder="+34 6 …" />
          </div>
          <div>
            <FieldLabel>{tt('Site web', 'Website', 'Sitio web')}</FieldLabel>
            <DarkInput value={website} onChange={setWebsite} placeholder="https://…" />
          </div>
          <div>
            <FieldLabel>{tt('Email de contact', 'Contact email', 'Email de contacto')}</FieldLabel>
            <DarkInput value={email} onChange={setEmail} placeholder="contact@agence.es" type="email" />
          </div>
        </div>
        <p style={{ color: T3, fontSize: 11.5, marginTop: 10 }}>
          {tt("Nom, ville, bio et réseaux apparaissent sur vos deux pages publiques. L'email de contact reste privé (relances Finance).",
              'Name, city, bio and socials show on both public pages. The contact email stays private (Finance reminders).',
              'Nombre, ciudad, bio y redes aparecen en tus dos páginas públicas. El email de contacto es privado (recordatorios de Finanzas).')}
        </p>
        <div className="mt-4" style={{ borderTop: `1px solid ${F_BORDER}`, paddingTop: 14 }}>
          <PromoButton onClick={handleSave} disabled={saving} full>
            {saving ? tt('Enregistrement…', 'Saving…', 'Guardando…') : tt('Enregistrer', 'Save', 'Guardar')}
          </PromoButton>
        </div>
      </PromoCard>

      {/* Pages publiques — où cette identité vit */}
      <PromoCard>
        <div className="flex items-center gap-2 mb-3">
          <Globe className="h-4 w-4" style={{ color: RED }} />
          <p style={{ color: T1, fontSize: 14, fontWeight: 650 }}>
            {tt('Vos pages publiques', 'Your public pages', 'Tus páginas públicas')}
          </p>
        </div>
        {slug ? (
          <div className="space-y-2.5">
            <CopyField label={tt('Page RP (marketplace Yuno)', 'RP page (Yuno marketplace)', 'Página RP (marketplace Yuno)')}
              value={`${origin}/rp/${slug}`} mono={false} />
            <CopyField label={tt('Linktree (bio Instagram / QR)', 'Linktree (Instagram bio / QR)', 'Linktree (bio de Instagram / QR)')}
              value={`${origin}/p/${slug}`} mono={false} />
            <div className="flex flex-wrap gap-2 pt-1">
              <PromoButton size="sm" variant="secondary" onClick={() => window.open(`/rp/${slug}`, '_blank')}>
                <ExternalLink className="h-4 w-4" /> {tt('Voir la page RP', 'View RP page', 'Ver la página RP')}
              </PromoButton>
              <PromoButton size="sm" variant="secondary" onClick={() => window.open(`/p/${slug}`, '_blank')}>
                <ExternalLink className="h-4 w-4" /> {tt('Voir le linktree', 'View linktree', 'Ver el linktree')}
              </PromoButton>
            </div>
          </div>
        ) : (
          <div className="rounded-xl p-3.5" style={{ background: C_FAINT, border: `1px solid ${BORDER}` }}>
            <p style={{ color: T2, fontSize: 12.5 }}>
              {tt("Choisissez d'abord votre adresse publique (le « slug ») dans Linktree & externe — elle sert aux deux pages.",
                  'First choose your public address (the “slug”) in Linktree & external — it powers both pages.',
                  'Elige primero tu dirección pública (el «slug») en Linktree y externo: alimenta ambas páginas.')}
            </p>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Link to="/agency-app/vitrine">
            <PromoButton size="sm">
              <Store className="h-4 w-4" /> {tt('Ouvrir Ma vitrine', 'Open My showcase', 'Abrir Mi vitrina')}
            </PromoButton>
          </Link>
          <Link to="/affiliate/settings">
            <PromoButton size="sm" variant="secondary">
              {tt('Réglages linktree (adresse, tri, QR)', 'Linktree settings (address, sort, QR)', 'Ajustes del linktree (dirección, orden, QR)')}
            </PromoButton>
          </Link>
        </div>
      </PromoCard>

      {/* Recadrage logo/bannière — cadre carré (rect) pour que l'aperçu
          corresponde au rendu final (les deux s'affichent en carré arrondi). */}
      <ImageCropperDialog
        open={cropTarget !== null}
        onOpenChange={(o) => { if (!o) { setCropTarget(null); setPendingFile(null); } }}
        imageFile={pendingFile}
        aspectRatio={1}
        shape="rect"
        outputSize={cropTarget === 'logo' ? 512 : 1600}
        title={cropTarget === 'logo'
          ? tt('Cadrer le logo', 'Crop the logo', 'Encuadrar el logo')
          : tt('Cadrer la bannière', 'Crop the banner', 'Encuadrar el banner')}
        helperText={tt('Glissez pour déplacer · utilisez le curseur pour zoomer',
                       'Drag to move · use the slider to zoom',
                       'Arrastra para mover · usa el control para hacer zoom')}
        onCrop={(cropped) => {
          const target = cropTarget;
          setCropTarget(null);
          setPendingFile(null);
          if (target === 'logo') uploadLogo(cropped);
          else if (target === 'banner') uploadBanner(cropped);
        }}
      />

      {/* Compte — App Store 5.1.1(v). Un compte propriétaire d'agence ne peut pas
          s'effacer seul : la fonction répond `owns_agency` et le message dirige
          vers le support, plutôt que de laisser l'agence et ses promoteurs sans
          propriétaire. */}
      <DeleteAccountAction variant="row" pro redirectTo="/auth" />

      <RenameConfirmDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        currentName={agency.name ?? ''}
        newName={name.trim()}
        links={slug ? [
          { from: `${origin}/p/${slug}`, to: `${origin}/p/${slugifyName(name)}` },
          { from: `${origin}/rp/${slug}`, to: `${origin}/rp/${slugifyName(name)}` },
        ] : undefined}
        onConfirm={handleSave}
        confirming={saving}
      />
    </div>
  );
}
