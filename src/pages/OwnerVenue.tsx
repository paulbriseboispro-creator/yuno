import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Upload, X, MapPin, Loader2, Plus, Trash2, MessageCircle,
  EyeOff, Wine, Bell, Coins, Image, Settings, Building2, Share2, FileText, Receipt,
  Copy, Check, ExternalLink,
} from 'lucide-react';

const Instagram = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
  </svg>
);
const Facebook = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>
  </svg>
);
const Twitter = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
  </svg>
);
const TikTokIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/>
  </svg>
);

import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { OwnerHeader } from '@/components/OwnerHeader';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { useVenueContext } from '@/hooks/useVenueContext';
import { useUnsavedGuard } from '@/hooks/useUnsavedGuard';
import { Switch } from '@/components/ui/switch';
import { BarConfigSection } from '@/components/owner/BarConfigSection';
import TrackedLinksManager from '@/components/tracking/TrackedLinksManager';
// Libellés RÉELS du filtre public — une seule liste pour toute l'app.
import { MUSIC_GENRES } from '@/lib/musicGenres';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED      = '#E8192C';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const F_BORDER = 'rgba(255,255,255,0.055)';
const CARD_BG  = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const INNER_BG = 'rgba(255,255,255,0.032)';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

// Lien public partagé (bio) — toujours le domaine de prod, jamais localhost.
const BASE_URL = (import.meta.env.VITE_APP_BASE_URL as string | undefined) || 'https://yunoapp.eu';

// ─── Shared UI atoms ──────────────────────────────────────────────────────────
function DarkInput({ id, value, onChange, placeholder, type = 'text', maxLength }: {
  id?: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; maxLength?: number;
}) {
  return (
    <input id={id} type={type} value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder} maxLength={maxLength}
      className="w-full px-3 py-2.5 rounded-xl text-[13px] transition-all duration-150"
      style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, outline: 'none' }}
      onFocus={e => (e.target.style.borderColor = 'rgba(255,255,255,0.18)')}
      onBlur={e => (e.target.style.borderColor = BORDER)}
    />
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 6 }}>
      {children}
    </p>
  );
}

function SectionCard({ title, description, children }: { title?: string; description?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 24 }}
      className="space-y-4">
      {(title || description) && (
        <div>
          {title && <p style={{ color: T1, fontSize: 14.5, fontWeight: 600 }}>{title}</p>}
          {description && <p style={{ color: T3, fontSize: 12.5, marginTop: 2 }}>{description}</p>}
        </div>
      )}
      {children}
    </div>
  );
}

// Lien général vers la page club (pour la bio Insta/TikTok). Affichage + copie, non tracké.
function ClubPageLink({ url }: { url: string }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const display = url.replace(/^https?:\/\//, '');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(t('tlink.copied'));
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t('tlink.copyError'));
    }
  };
  return (
    <div className="flex items-center gap-2 rounded-xl px-4 py-3"
      style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
      <Share2 className="h-4 w-4 flex-shrink-0" style={{ color: RED }} />
      <code className="flex-1 truncate text-[13px]" style={{ color: T1 }}>{display}</code>
      <button type="button" onClick={copy} title={t('tlink.copy')}
        className="rounded-md p-1.5 transition-colors hover:bg-white/10" style={{ color: T2 }}>
        {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
      </button>
      <a href={url} target="_blank" rel="noreferrer" title={t('tlink.open')}
        className="rounded-md p-1.5 transition-colors hover:bg-white/10" style={{ color: T2 }}>
        <ExternalLink className="h-4 w-4" />
      </a>
    </div>
  );
}

function SaveButton({ onClick, loading, label, loadingLabel }: {
  onClick: () => void; loading?: boolean; label: string; loadingLabel?: string;
}) {
  return (
    <button onClick={onClick} disabled={loading}
      className="px-5 py-2.5 rounded-xl text-[13px] font-semibold cursor-pointer transition-all duration-150 disabled:opacity-50 flex items-center gap-2"
      style={{ background: RED, color: '#fff', boxShadow: `0 0 18px -6px ${RED}88` }}>
      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
      {loading ? (loadingLabel || label) : label}
    </button>
  );
}

function GroupHeader({ icon: Icon, title, description }: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex items-start gap-3 pt-4">
      <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ background: 'rgba(232,25,44,0.08)', border: '1px solid rgba(232,25,44,0.18)' }}>
        <Icon className="w-3.5 h-3.5" style={{ color: RED }} />
      </div>
      <div>
        <p style={{ color: T1, fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>{title}</p>
        {description && <p style={{ color: T3, fontSize: 12, marginTop: 2 }}>{description}</p>}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function OwnerVenue() {
  const { t } = useLanguage();
  const { venueId } = useVenueContext();
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const stripeParam = searchParams.get('stripe');
    if (stripeParam === 'success') { toast.success(t('plan.stripeOnboardingSuccess')); searchParams.delete('stripe'); setSearchParams(searchParams, { replace: true }); }
    else if (stripeParam === 'refresh') { toast.error(t('plan.stripeOnboardingIncomplete')); searchParams.delete('stripe'); setSearchParams(searchParams, { replace: true }); }
    const subParam = searchParams.get('subscription');
    if (subParam === 'success') { toast.success(t('plan.subscriptionActivated')); searchParams.delete('subscription'); setSearchParams(searchParams, { replace: true }); }
    else if (subParam === 'canceled') { toast.info(t('plan.subscriptionCanceled')); searchParams.delete('subscription'); setSearchParams(searchParams, { replace: true }); }
  }, [searchParams, setSearchParams]);

  const [loading, setLoading] = useState(true);
  const [geocoding, setGeocoding] = useState(false);

  // Images
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState('');
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState('');
  const [currentLogoUrl, setCurrentLogoUrl] = useState('');
  const [currentCoverUrl, setCurrentCoverUrl] = useState('');
  const [coverPosition, setCoverPosition] = useState({ x: 50, y: 50 });
  const [isDragging, setIsDragging] = useState(false);
  const [galleryImages, setGalleryImages] = useState<string[]>([]);
  const [uploadingGallery, setUploadingGallery] = useState(false);

  // Venue info
  const [venueName, setVenueName] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [coordinates, setCoordinates] = useState<{ lat: number | null; lng: number | null }>({ lat: null, lng: null });
  const [venueDescription, setVenueDescription] = useState('');
  const [shortDescription, setShortDescription] = useState('');
  const [musicGenre, setMusicGenre] = useState('');
  const [minAge, setMinAge] = useState<number | ''>('');
  const [minorsAllowed, setMinorsAllowed] = useState(false);
  const [minorAuthDoc, setMinorAuthDoc] = useState<{ url: string; name: string } | null>(null);
  const [uploadingMinorDoc, setUploadingMinorDoc] = useState(false);

  // Social media
  const [instagramUrl, setInstagramUrl] = useState('');
  const [facebookUrl, setFacebookUrl] = useState('');
  const [tiktokUrl, setTiktokUrl] = useState('');
  const [twitterUrl, setTwitterUrl] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [savingSocial, setSavingSocial] = useState(false);

  // Visibility
  const [hiddenFromMap, setHiddenFromMap] = useState(false);

  // Bar & menu
  const [menuEnabled, setMenuEnabled] = useState(true);
  const [freeDrinkMode, setFreeDrinkMode] = useState<'credits' | 'bouncer_notify'>('credits');
  // Fee absorption: when true the club absorbs the Yuno commission (fan pays item price only).
  const [absorbFees, setAbsorbFees] = useState(false);

  // Access documents (venue-level, attached to every ticket confirmation)
  type AccessDoc = { id: string; label: string; fileUrl: string; fileName: string };
  const [accessDocs, setAccessDocs] = useState<AccessDoc[]>([]);
  const [uploadingDoc, setUploadingDoc] = useState(false);

  // Legal
  const [legalName, setLegalName] = useState('');
  const [siret, setSiret] = useState('');
  const [vatNumber, setVatNumber] = useState('');
  const [legalAddress, setLegalAddress] = useState('');
  const [invoicePrefix, setInvoicePrefix] = useState('');
  const [savingLegal, setSavingLegal] = useState(false);

  useEffect(() => { if (venueId) { fetchVenue(); fetchAccessDocs(); } }, [venueId]);

  const fetchAccessDocs = async () => {
    if (!venueId) return;
    const { data } = await supabase
      .from('venue_access_documents')
      .select('id, label, file_url, file_name')
      .eq('venue_id', venueId)
      .eq('is_active', true)
      .order('position', { ascending: true });
    if (data) setAccessDocs(data.map(d => ({ id: d.id, label: d.label, fileUrl: d.file_url, fileName: d.file_name })));
  };

  const fetchVenue = async () => {
    if (!venueId) return;
    try {
      const { data, error } = await supabase.from('venues').select('*').eq('id', venueId).single();
      if (error) throw error;
      if (data.logo_url) { setCurrentLogoUrl(data.logo_url); setLogoPreview(data.logo_url); }
      if (data.cover_url) { setCurrentCoverUrl(data.cover_url); setCoverPreview(data.cover_url); }
      if (data.cover_position) setCoverPosition(data.cover_position as { x: number; y: number });
      setVenueName(data.name || '');
      setCity(data.city || '');
      setAddress(data.address || '');
      setCoordinates({ lat: data.latitude, lng: data.longitude });
      setGalleryImages((data.gallery_images as string[]) || []);
      setInstagramUrl(data.instagram_url || '');
      setFacebookUrl(data.facebook_url || '');
      setTiktokUrl(data.tiktok_url || '');
      setTwitterUrl(data.twitter_url || '');
      setWhatsappNumber(data.whatsapp_number || '');
      setHiddenFromMap(data.hidden_from_map || false);
      setVenueDescription(data.description || '');
      setShortDescription(data.short_description || '');
      setMusicGenre(data.music_genre || '');
      setMinAge(data.min_age || '');
      setMinorsAllowed(data.minors_allowed ?? false);
      setMinorAuthDoc(data.minor_auth_doc_url ? { url: data.minor_auth_doc_url, name: data.minor_auth_doc_name || 'Document' } : null);
      setMenuEnabled(data.menu_enabled !== false);
      setFreeDrinkMode((data.free_drink_mode as 'credits' | 'bouncer_notify' | null) || 'credits');
      setAbsorbFees(data.absorb_yuno_fees === true);
      setLegalName(data.legal_name || '');
      setSiret(data.siret || '');
      setVatNumber(data.vat_number || '');
      setLegalAddress(data.legal_address || '');
      setInvoicePrefix(data.invoice_prefix || 'FAC');
    } catch { toast.error(t('owner.errorLoadingVenue')); }
    finally { setLoading(false); }
  };

  const geocodeAddress = useCallback(async (addr: string) => {
    if (!addr || addr.length < 5) return null;
    setGeocoding(true);
    try {
      const { data, error } = await supabase.functions.invoke('geocode-address', { body: { address: addr } });
      if (error) throw error;
      if (data?.latitude && data?.longitude) { setCoordinates({ lat: data.latitude, lng: data.longitude }); return { lat: data.latitude, lng: data.longitude }; }
    } catch { /* géocodage best-effort : retourne null plus bas */ }
    finally { setGeocoding(false); }
    return null;
  }, []);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setLogoPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleCoverChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCoverFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setCoverPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSaveLogo = async () => {
    if (!logoFile) { toast.error(t('owner.selectImage')); return; }
    try {
      const filePath = `logos/logo-${Date.now()}.${logoFile.name.split('.').pop()}`;
      const { error: uploadError } = await supabase.storage.from('venue-assets').upload(filePath, logoFile);
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('venue-assets').getPublicUrl(filePath);
      const { error } = await supabase.from('venues').update({ logo_url: publicUrl }).eq('id', venueId);
      if (error) throw error;
      setCurrentLogoUrl(publicUrl); setLogoFile(null);
      toast.success(t('owner.logoUpdated'));
    } catch { toast.error(t('owner.errorSaving')); }
  };

  const handleSaveCover = async () => {
    if (!coverFile) { toast.error(t('owner.selectImage')); return; }
    try {
      const filePath = `covers/cover-${Date.now()}.${coverFile.name.split('.').pop()}`;
      const { error: uploadError } = await supabase.storage.from('venue-assets').upload(filePath, coverFile);
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('venue-assets').getPublicUrl(filePath);
      const { error } = await supabase.from('venues').update({ cover_url: publicUrl, cover_position: coverPosition }).eq('id', venueId);
      if (error) throw error;
      setCurrentCoverUrl(publicUrl); setCoverFile(null);
      toast.success(t('owner.bannerUpdated'));
    } catch { toast.error(t('owner.errorSaving')); }
  };

  const handleSaveCoverPosition = async () => {
    try {
      const { error } = await supabase.from('venues').update({ cover_position: coverPosition }).eq('id', venueId);
      if (error) throw error;
      toast.success(t('owner.bannerPositionUpdated'));
    } catch { toast.error(t('owner.errorSaving')); }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => { if (!coverPreview) return; setIsDragging(true); handleMouseMove(e); };
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging && e.type === 'mousemove') return;
    const rect = e.currentTarget.getBoundingClientRect();
    setCoverPosition({ x: Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)), y: Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100)) });
  };
  const handleMouseUp = () => setIsDragging(false);

  const handleSaveVenueInfo = async (): Promise<boolean> => {
    try {
      let lat = coordinates.lat, lng = coordinates.lng;
      if (address && address.length >= 5) { const coords = await geocodeAddress(address); if (coords) { lat = coords.lat; lng = coords.lng; } }
      const { error } = await supabase.from('venues').update({
        city, address, latitude: lat, longitude: lng,
        description: venueDescription || null,
        short_description: shortDescription || null,
        music_genre: musicGenre || null,
        min_age: minAge !== '' ? Number(minAge) : null,
        minors_allowed: minorsAllowed,
      }).eq('id', venueId);
      if (error) throw error;
      // Le géocodage a pu écrire de nouvelles coordonnées : la référence doit
      // intégrer CE qui est parti en base, pas ce qui était à l'écran avant.
      setCoordinates({ lat, lng });
      infoGuard.markSaved({ city, address, coordinates: { lat, lng }, venueDescription, shortDescription, musicGenre, minAge, minorsAllowed });
      toast.success(lat && lng ? t('owner.infoGpsUpdated') : t('owner.infoUpdated'));
      return true;
    } catch { toast.error(t('owner.errorSaving')); return false; }
  };

  const handleSaveSocialMedia = async (): Promise<boolean> => {
    setSavingSocial(true);
    try {
      const { error } = await supabase.from('venues').update({
        instagram_url: instagramUrl || null, facebook_url: facebookUrl || null,
        tiktok_url: tiktokUrl || null, twitter_url: twitterUrl || null,
        whatsapp_number: whatsappNumber || null,
      }).eq('id', venueId);
      if (error) throw error;
      socialGuard.markSaved({ instagramUrl, facebookUrl, tiktokUrl, twitterUrl, whatsappNumber });
      toast.success(t('owner.socialMediaSaved'));
      return true;
    } catch { toast.error(t('owner.errorSaving')); return false; }
    finally { setSavingSocial(false); }
  };

  const handleSaveLegalInfo = async (): Promise<boolean> => {
    setSavingLegal(true);
    try {
      const { error } = await supabase.from('venues').update({
        legal_name: legalName || null, siret: siret || null, vat_number: vatNumber || null,
        legal_address: legalAddress || null, invoice_prefix: invoicePrefix || 'FAC',
      }).eq('id', venueId);
      if (error) throw error;
      legalGuard.markSaved({ legalName, siret, vatNumber, legalAddress, invoicePrefix });
      toast.success(t('owner.legalInfoSaved'));
      return true;
    } catch { toast.error(t('owner.errorSaving')); return false; }
    finally { setSavingLegal(false); }
  };

  // ─── Garde « modifications non enregistrées » ──────────────────────────────
  // Une garde par section, parce que la page enregistre section par section :
  // la barre nomme exactement ce qui reste en attente, et « Enregistrer » ne
  // pousse que les sections réellement modifiées.
  const guardReady = !loading && Boolean(venueId);

  const infoGuard = useUnsavedGuard({
    scope: `owner-venue-info:${venueId ?? 'none'}`,
    label: t('owner.venueInfo'),
    ready: guardReady,
    value: { city, address, coordinates, venueDescription, shortDescription, musicGenre, minAge, minorsAllowed },
    onRestore: (v) => {
      setCity(v.city); setAddress(v.address); setCoordinates(v.coordinates);
      setVenueDescription(v.venueDescription); setShortDescription(v.shortDescription);
      setMusicGenre(v.musicGenre); setMinAge(v.minAge); setMinorsAllowed(v.minorsAllowed);
    },
    onSave: handleSaveVenueInfo,
  });

  const socialGuard = useUnsavedGuard({
    scope: `owner-venue-social:${venueId ?? 'none'}`,
    label: t('owner.socialMedia'),
    ready: guardReady,
    value: { instagramUrl, facebookUrl, tiktokUrl, twitterUrl, whatsappNumber },
    onRestore: (v) => {
      setInstagramUrl(v.instagramUrl); setFacebookUrl(v.facebookUrl); setTiktokUrl(v.tiktokUrl);
      setTwitterUrl(v.twitterUrl); setWhatsappNumber(v.whatsappNumber);
    },
    onSave: handleSaveSocialMedia,
  });

  const legalGuard = useUnsavedGuard({
    scope: `owner-venue-legal:${venueId ?? 'none'}`,
    label: t('owner.legalInfoTitle'),
    ready: guardReady,
    value: { legalName, siret, vatNumber, legalAddress, invoicePrefix },
    onRestore: (v) => {
      setLegalName(v.legalName); setSiret(v.siret); setVatNumber(v.vatNumber);
      setLegalAddress(v.legalAddress); setInvoicePrefix(v.invoicePrefix);
    },
    onSave: handleSaveLegalInfo,
  });

  const handleGalleryUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (galleryImages.length >= 8) { toast.error(t('owner.galleryMaxImages')); return; }
    setUploadingGallery(true);
    try {
      const filePath = `gallery/${venueId}/gallery-${Date.now()}.${file.name.split('.').pop()}`;
      const { error: uploadError } = await supabase.storage.from('venue-assets').upload(filePath, file);
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('venue-assets').getPublicUrl(filePath);
      const newImages = [...galleryImages, publicUrl];
      const { error } = await supabase.from('venues').update({ gallery_images: newImages }).eq('id', venueId);
      if (error) throw error;
      setGalleryImages(newImages);
      toast.success(t('owner.galleryImageAdded'));
    } catch { toast.error(t('owner.errorSaving')); }
    finally { setUploadingGallery(false); }
  };

  const handleRemoveGalleryImage = async (imageUrl: string) => {
    try {
      const newImages = galleryImages.filter(img => img !== imageUrl);
      const { error } = await supabase.from('venues').update({ gallery_images: newImages }).eq('id', venueId);
      if (error) throw error;
      setGalleryImages(newImages);
      toast.success(t('owner.galleryImageRemoved'));
    } catch { toast.error(t('owner.errorSaving')); }
  };

  const handleMinorDocUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !venueId) return;
    const isTxt = file.type === 'text/plain' || /\.txt$/i.test(file.name);
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!isPdf && !isTxt) { toast.error(t('owner.minorDocFormat')); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error(t('owner.accessDocsTooLarge')); return; }
    setUploadingMinorDoc(true);
    try {
      const ext = isTxt ? 'txt' : 'pdf';
      const filePath = `access-docs/${venueId}/minor-auth-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('venue-assets').upload(filePath, file, { contentType: file.type || (isTxt ? 'text/plain' : 'application/pdf') });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('venue-assets').getPublicUrl(filePath);
      const { error } = await supabase.from('venues').update({ minor_auth_doc_url: publicUrl, minor_auth_doc_name: file.name }).eq('id', venueId);
      if (error) throw error;
      setMinorAuthDoc({ url: publicUrl, name: file.name });
      toast.success(t('owner.accessDocsAdded'));
    } catch { toast.error(t('owner.errorSaving')); }
    finally { setUploadingMinorDoc(false); }
  };

  const handleRemoveMinorDoc = async () => {
    try {
      const { error } = await supabase.from('venues').update({ minor_auth_doc_url: null, minor_auth_doc_name: null }).eq('id', venueId);
      if (error) throw error;
      setMinorAuthDoc(null);
      toast.success(t('owner.accessDocsRemoved'));
    } catch { toast.error(t('owner.errorSaving')); }
  };

  const handleAccessDocUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !venueId) return;
    if (file.type !== 'application/pdf') { toast.error(t('owner.accessDocsPdfOnly')); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error(t('owner.accessDocsTooLarge')); return; }
    if (accessDocs.length >= 5) { toast.error(t('owner.accessDocsMax')); return; }
    setUploadingDoc(true);
    try {
      const filePath = `access-docs/${venueId}/doc-${Date.now()}.pdf`;
      const { error: uploadError } = await supabase.storage.from('venue-assets').upload(filePath, file, { contentType: 'application/pdf' });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('venue-assets').getPublicUrl(filePath);
      const label = file.name.replace(/\.pdf$/i, '').slice(0, 80) || t('owner.accessDocsDefaultLabel');
      const { data: inserted, error } = await supabase.from('venue_access_documents').insert({
        venue_id: venueId, label, file_url: publicUrl, file_name: file.name, position: accessDocs.length,
      }).select('id, label, file_url, file_name').single();
      if (error) throw error;
      setAccessDocs([...accessDocs, { id: inserted.id, label: inserted.label, fileUrl: inserted.file_url, fileName: inserted.file_name }]);
      toast.success(t('owner.accessDocsAdded'));
    } catch { toast.error(t('owner.errorSaving')); }
    finally { setUploadingDoc(false); }
  };

  const handleRenameAccessDoc = async (id: string, label: string) => {
    setAccessDocs(docs => docs.map(d => d.id === id ? { ...d, label } : d));
    await supabase.from('venue_access_documents').update({ label: label || t('owner.accessDocsDefaultLabel') }).eq('id', id);
  };

  const handleRemoveAccessDoc = async (id: string) => {
    try {
      const { error } = await supabase.from('venue_access_documents').delete().eq('id', id);
      if (error) throw error;
      setAccessDocs(docs => docs.filter(d => d.id !== id));
      toast.success(t('owner.accessDocsRemoved'));
    } catch { toast.error(t('owner.errorSaving')); }
  };

  if (loading) return <OwnerPageSkeleton />;

  return (
    <div className="min-h-screen pb-28" style={{ background: '#000' }}>
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.025),transparent 55%)' }} />

      <OwnerHeader title={t('owner.venueCustomization')} />

      <div className="relative z-10 mx-auto max-w-[900px] px-4 sm:px-6 pt-2 pb-4 space-y-4">

        {/* ═══════════════════════════════════════════════════════════
            1. APPARENCE — Identité visuelle côté client
        ════════════════════════════════════════════════════════════ */}
        <GroupHeader icon={Image} title={t('owner.sectionAppearance')} description={t('owner.sectionAppearanceDesc')} />

        {/* Aperçu de la page client */}
        <SectionCard title={t('owner.clientPagePreview')}>
          <div className="relative h-52 rounded-xl overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
            <div className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url(${coverPreview || 'https://images.unsplash.com/photo-1514933651103-005eec06c04b'})`, backgroundPosition: `${coverPosition.x}% ${coverPosition.y}%` }} />
            <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, transparent 30%, rgba(0,0,0,0.7) 100%)' }} />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              {logoPreview ? (
                <img src={logoPreview} alt={venueName} className="h-16 w-16 rounded-full object-cover" style={{ border: '2px solid rgba(255,255,255,0.2)' }} />
              ) : (
                <div className="h-16 w-16 rounded-full flex items-center justify-center" style={{ background: RED }}>
                  <span style={{ color: '#fff', fontSize: 24, fontWeight: 800 }}>{venueName.charAt(0) || 'C'}</span>
                </div>
              )}
              <h2 style={{ color: 'rgba(255,255,255,0.96)', fontSize: 20, fontWeight: 700 }}>{venueName}</h2>
              <p className="flex items-center gap-1" style={{ color: 'rgba(255,255,255,0.58)', fontSize: 12 }}>
                <MapPin className="h-3.5 w-3.5" />{city || 'Paris'}
              </p>
            </div>
          </div>
        </SectionCard>

        {/* Lien général vers la page club — pour la bio (Insta/TikTok) */}
        {venueId && (
          <SectionCard title={t('tlink.bioTitle')} description={t('tlink.bioDesc')}>
            <ClubPageLink url={`${BASE_URL}/club/${venueId}`} />
          </SectionCard>
        )}

        {/* Liens trackés permanents — attribuent tout achat futur fait via ce lien */}
        {venueId && (
          <SectionCard title={t('tlink.venueTitle')}>
            <p className="mb-3 text-xs text-white/45">{t('tlink.venueDesc')}</p>
            <TrackedLinksManager
              ownerKind="venue"
              venueId={venueId}
              targetKind="venue"
              targetVenueId={venueId}
            />
          </SectionCard>
        )}

        {/* Logo + Bannière */}
        <div className="grid gap-4 md:grid-cols-2">
          <SectionCard title={t('owner.roundLogo')}>
            {logoPreview && (
              <div className="relative w-24 h-24 mx-auto rounded-full overflow-hidden" style={{ border: `2px solid ${BORDER}` }}>
                <img src={logoPreview} alt="Logo" className="w-full h-full object-cover" />
                {logoFile && (
                  <button type="button"
                    className="absolute top-0 right-0 w-6 h-6 rounded-full flex items-center justify-center cursor-pointer"
                    style={{ background: RED, color: '#fff' }}
                    onClick={() => { setLogoFile(null); setLogoPreview(currentLogoUrl); }}>
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}
            <input id="logo" type="file" accept="image/*" onChange={handleLogoChange} className="hidden" />
            <button type="button" onClick={() => document.getElementById('logo')?.click()}
              className="w-full py-2.5 rounded-xl text-[13px] font-medium cursor-pointer flex items-center justify-center gap-2 transition-all duration-150"
              style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>
              <Upload className="w-4 h-4" />{logoPreview ? t('owner.changeLogo') : t('owner.addLogo')}
            </button>
            {logoFile && <SaveButton onClick={handleSaveLogo} label={t('owner.saveLogo')} />}
          </SectionCard>

          <SectionCard title={t('owner.banner')}>
            {coverPreview && (
              <div className="space-y-3">
                <p style={{ color: T3, fontSize: 11.5 }}>{t('owner.bannerPositionDesc')}</p>
                <div className="relative w-full h-40 rounded-xl overflow-hidden cursor-crosshair"
                  style={{ border: `1px solid ${BORDER}` }}
                  onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
                  <div className="absolute inset-0 bg-cover"
                    style={{ backgroundImage: `url(${coverPreview})`, backgroundPosition: `${coverPosition.x}% ${coverPosition.y}%` }} />
                  <div className="absolute inset-0"
                    style={{ background: 'linear-gradient(to bottom, transparent 50%, rgba(0,0,0,0.5) 100%)' }} />
                  <div className="absolute w-4 h-4 rounded-full border-2 border-white pointer-events-none transform -translate-x-1/2 -translate-y-1/2"
                    style={{ left: `${coverPosition.x}%`, top: `${coverPosition.y}%`, background: RED }} />
                  {coverFile && (
                    <button type="button"
                      className="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center cursor-pointer"
                      style={{ background: RED, color: '#fff' }}
                      onClick={() => { setCoverFile(null); setCoverPreview(currentCoverUrl); }}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {!coverFile && currentCoverUrl && (
                  <button onClick={handleSaveCoverPosition}
                    className="w-full py-2 rounded-xl text-[12px] font-medium cursor-pointer transition-all duration-150"
                    style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>
                    {t('owner.savePosition')}
                  </button>
                )}
              </div>
            )}
            <input id="cover" type="file" accept="image/*" onChange={handleCoverChange} className="hidden" />
            <button type="button" onClick={() => document.getElementById('cover')?.click()}
              className="w-full py-2.5 rounded-xl text-[13px] font-medium cursor-pointer flex items-center justify-center gap-2 transition-all duration-150"
              style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>
              <Upload className="w-4 h-4" />{coverPreview ? t('owner.changeBanner') : t('owner.addBanner')}
            </button>
            {coverFile && <SaveButton onClick={handleSaveCover} label={t('owner.saveBanner')} />}
          </SectionCard>
        </div>

        {/* Galerie de photos */}
        <SectionCard title={t('owner.galleryImages')} description={t('owner.galleryImagesDesc')}>
          {galleryImages.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {galleryImages.map((imageUrl, i) => (
                <div key={i} className="relative group aspect-[4/3] rounded-xl overflow-hidden"
                  style={{ border: `1px solid ${BORDER}` }}>
                  <img src={imageUrl} alt={`Gallery ${i + 1}`} className="w-full h-full object-cover" />
                  <button onClick={() => handleRemoveGalleryImage(imageUrl)}
                    className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: 'rgba(232,25,44,0.9)' }}>
                    <Trash2 className="w-3 h-3" style={{ color: '#fff' }} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8" style={{ color: T3, fontSize: 13 }}>
              {t('owner.noGalleryImages')}
            </div>
          )}
          <div>
            <input id="gallery" type="file" accept="image/*" onChange={handleGalleryUpload} className="hidden"
              disabled={uploadingGallery || galleryImages.length >= 8} />
            <button type="button" onClick={() => document.getElementById('gallery')?.click()}
              disabled={uploadingGallery || galleryImages.length >= 8}
              className="w-full py-2.5 rounded-xl text-[13px] font-medium cursor-pointer flex items-center justify-center gap-2 transition-all duration-150 disabled:opacity-40"
              style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>
              {uploadingGallery
                ? <><Loader2 className="w-4 h-4 animate-spin" />{t('owner.uploading')}...</>
                : <><Plus className="w-4 h-4" />{t('owner.addGalleryImage')}</>}
            </button>
            <p style={{ color: T3, fontSize: 11.5, textAlign: 'center', marginTop: 6 }}>
              {galleryImages.length}/8 {t('owner.imagesUploaded')}
            </p>
          </div>
        </SectionCard>

        {/* ═══════════════════════════════════════════════════════════
            2. PROFIL — Informations du lieu
        ════════════════════════════════════════════════════════════ */}
        <GroupHeader icon={Building2} title={t('owner.sectionProfile')} description={t('owner.sectionProfileDesc')} />

        <SectionCard title={t('owner.venueInfo')}>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <FieldLabel>{t('owner.cityLabel')}</FieldLabel>
              <DarkInput value={city} onChange={setCity} placeholder={t('owner.cityPlaceholder')} />
            </div>
            <div>
              <FieldLabel>{t('owner.addressLabel')}</FieldLabel>
              <DarkInput value={address} onChange={setAddress} placeholder={t('owner.addressPlaceholder')} />
            </div>
          </div>

          <div>
            <FieldLabel>
              {t('owner.shortBioLabel')}{' '}
              <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{t('owner.shortBioSub')}</span>
            </FieldLabel>
            <textarea value={shortDescription} onChange={e => setShortDescription(e.target.value)}
              placeholder={t('owner.shortBioPlaceholder')} rows={2} maxLength={160}
              className="w-full px-3 py-2.5 rounded-xl text-[13px] resize-none transition-all duration-150"
              style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, outline: 'none' }}
              onFocus={e => (e.target.style.borderColor = 'rgba(255,255,255,0.18)')}
              onBlur={e => (e.target.style.borderColor = BORDER)} />
            <p style={{ color: T3, fontSize: 11, textAlign: 'right', marginTop: 2 }}>{shortDescription.length}/160</p>
          </div>

          <div>
            <FieldLabel>
              {t('owner.venueDescLabel')}{' '}
              <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{t('owner.venueDescSub')}</span>
            </FieldLabel>
            <textarea value={venueDescription} onChange={e => setVenueDescription(e.target.value)}
              placeholder={t('owner.venueDescPlaceholder')} rows={4} maxLength={500}
              className="w-full px-3 py-2.5 rounded-xl text-[13px] resize-none transition-all duration-150"
              style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, outline: 'none' }}
              onFocus={e => (e.target.style.borderColor = 'rgba(255,255,255,0.18)')}
              onBlur={e => (e.target.style.borderColor = BORDER)} />
            <p style={{ color: T3, fontSize: 11, textAlign: 'right', marginTop: 2 }}>{venueDescription.length}/500</p>
          </div>

          <div>
            <FieldLabel>{t('owner.musicGenre')}</FieldLabel>
            <div className="flex flex-wrap gap-2 mb-3">
              {MUSIC_GENRES.map(genre => (
                <button key={genre} type="button" onClick={() => setMusicGenre(musicGenre === genre ? '' : genre)}
                  className="px-3 py-1 rounded-full text-[12px] font-medium cursor-pointer transition-all duration-150"
                  style={{
                    background: musicGenre === genre ? 'rgba(232,25,44,0.1)' : INNER_BG,
                    border: `1px solid ${musicGenre === genre ? RED : BORDER}`,
                    color: musicGenre === genre ? RED : T2,
                  }}>
                  {genre}
                </button>
              ))}
            </div>
            <DarkInput value={musicGenre} onChange={setMusicGenre} placeholder={t('owner.musicGenrePlaceholder')} maxLength={40} />
          </div>

          <div>
            <FieldLabel>{t('owner.minAgeLabel')}</FieldLabel>
            <div className="flex gap-2 flex-wrap">
              {[18, 20, 21, 23, 25].map(age => (
                <button key={age} type="button" onClick={() => setMinAge(minAge === age ? '' : age)}
                  className="px-3 py-1.5 rounded-full text-[13px] font-medium cursor-pointer transition-all duration-150"
                  style={{
                    background: minAge === age ? 'rgba(232,25,44,0.1)' : INNER_BG,
                    border: `1px solid ${minAge === age ? RED : BORDER}`,
                    color: minAge === age ? RED : T2,
                  }}>
                  {age}+
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl p-3 space-y-3" style={{ background: INNER_BG, border: `1px solid ${F_BORDER}` }}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <FieldLabel>{t('owner.minorsAllowedLabel')}</FieldLabel>
                <p style={{ color: T3, fontSize: 12 }}>{t('owner.minorsAllowedHint')}</p>
              </div>
              <Switch checked={minorsAllowed} onCheckedChange={setMinorsAllowed} />
            </div>

            {minorsAllowed && (
              <div className="pt-3" style={{ borderTop: `1px solid ${F_BORDER}` }}>
                <FieldLabel>{t('owner.minorDocLabel')}</FieldLabel>
                <p style={{ color: T3, fontSize: 12, marginBottom: 8 }}>{t('owner.minorDocHint')}</p>
                {minorAuthDoc ? (
                  <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: CARD_BG, border: `1px solid ${BORDER}` }}>
                    <FileText className="h-5 w-5 flex-none" style={{ color: RED }} />
                    <a href={minorAuthDoc.url} target="_blank" rel="noopener noreferrer" className="flex-1 truncate" style={{ color: T1, fontSize: 13 }}>{minorAuthDoc.name}</a>
                    <button type="button" onClick={handleRemoveMinorDoc} className="flex-none p-2 rounded-lg" style={{ color: T2 }}
                      onMouseEnter={e => (e.currentTarget.style.color = RED)} onMouseLeave={e => (e.currentTarget.style.color = T2)}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <label className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl cursor-pointer"
                    style={{ background: CARD_BG, border: `1px dashed ${BORDER}`, color: uploadingMinorDoc ? T3 : T1, fontSize: 13, fontWeight: 560 }}>
                    {uploadingMinorDoc
                      ? <><Loader2 className="h-4 w-4 animate-spin" />{t('owner.uploading')}...</>
                      : <><Upload className="h-4 w-4" />{t('owner.minorDocUpload')}</>}
                    <input type="file" accept="application/pdf,.pdf,text/plain,.txt" className="hidden" disabled={uploadingMinorDoc} onChange={handleMinorDocUpload} />
                  </label>
                )}
              </div>
            )}
          </div>

          {(coordinates.lat || coordinates.lng) && (
            <div className="flex items-center gap-2 p-3 rounded-xl" style={{ background: INNER_BG, border: `1px solid ${F_BORDER}` }}>
              <MapPin className="w-4 h-4 flex-shrink-0" style={{ color: T3 }} />
              <span style={{ color: T3, fontSize: 12 }}>GPS: {coordinates.lat?.toFixed(4)}, {coordinates.lng?.toFixed(4)}</span>
            </div>
          )}

          <div className="space-y-1">
            <SaveButton onClick={handleSaveVenueInfo} loading={geocoding} label={t('owner.saveInfo')} loadingLabel={t('owner.geocoding')} />
            <p style={{ color: T3, fontSize: 11 }}>{t('owner.gpsAutoCalc')}</p>
          </div>
        </SectionCard>

        {/* ═══════════════════════════════════════════════════════════
            3. RÉSEAUX SOCIAUX
        ════════════════════════════════════════════════════════════ */}
        <GroupHeader icon={Share2} title={t('owner.socialMedia')} description={t('owner.sectionSocialDesc')} />

        <SectionCard title={t('owner.socialMedia')} description={t('owner.socialMediaDesc')}>
          <div className="grid gap-4 md:grid-cols-2">
            {[
              { id: 'instagram', Icon: Instagram, label: 'Instagram', value: instagramUrl, set: setInstagramUrl, placeholder: 'https://instagram.com/your_club' },
              { id: 'facebook',  Icon: Facebook,  label: 'Facebook',  value: facebookUrl,  set: setFacebookUrl,  placeholder: 'https://facebook.com/your_club' },
              { id: 'tiktok',    Icon: TikTokIcon, label: 'TikTok',   value: tiktokUrl,    set: setTiktokUrl,    placeholder: 'https://tiktok.com/@your_club' },
              { id: 'twitter',   Icon: Twitter,   label: 'X (Twitter)', value: twitterUrl, set: setTwitterUrl,   placeholder: 'https://x.com/your_club' },
            ].map(({ id, Icon, label, value, set, placeholder }) => (
              <div key={id}>
                <FieldLabel><Icon className="w-3 h-3 inline mr-1" />{label}</FieldLabel>
                <DarkInput value={value} onChange={set} placeholder={placeholder} />
              </div>
            ))}
          </div>
          <div style={{ borderTop: `1px solid ${F_BORDER}`, paddingTop: 16 }}>
            <FieldLabel>
              <MessageCircle className="w-3 h-3 inline mr-1" style={{ color: '#25D366' }} />
              WhatsApp ({t('owner.optional')})
            </FieldLabel>
            <DarkInput value={whatsappNumber} onChange={setWhatsappNumber} placeholder="+33 6 12 34 56 78" />
            <p style={{ color: T3, fontSize: 11.5, marginTop: 4 }}>{t('owner.whatsappDesc')}</p>
          </div>
          <SaveButton onClick={handleSaveSocialMedia} loading={savingSocial} label={t('owner.saveSocialMedia')} />
        </SectionCard>

        {/* ═══════════════════════════════════════════════════════════
            4. VISIBILITÉ
        ════════════════════════════════════════════════════════════ */}
        <GroupHeader icon={EyeOff} title={t('owner.sectionVisibility')} description={t('owner.sectionVisibilityDesc')} />

        <SectionCard>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <EyeOff className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: T3 }} />
              <div>
                <p style={{ color: T1, fontSize: 13.5, fontWeight: 500 }}>{t('owner.hiddenFromMapTitle')}</p>
                <p style={{ color: T3, fontSize: 12, marginTop: 2 }}>{t('owner.hiddenFromMapDescription')}</p>
              </div>
            </div>
            <Switch checked={hiddenFromMap} onCheckedChange={async checked => {
              setHiddenFromMap(checked);
              const { error } = await supabase.from('venues').update({ hidden_from_map: checked }).eq('id', venueId);
              if (error) { setHiddenFromMap(!checked); toast.error(t('owner.errorSaving')); }
              else { toast.success(checked ? t('owner.venueHidden') : t('owner.venueVisible')); }
            }} />
          </div>
        </SectionCard>

        {/* ═══════════════════════════════════════════════════════════
            5. CONFIGURATION BAR & MENU
        ════════════════════════════════════════════════════════════ */}
        <GroupHeader icon={Wine} title={t('owner.sectionBarMenu')} description={t('owner.sectionBarMenuDesc')} />

        {/* Menu activé */}
        <SectionCard>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <Wine className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: T3 }} />
              <div>
                <p style={{ color: T1, fontSize: 13.5, fontWeight: 500 }}>{t('owner.menuEnabledTitle')}</p>
                <p style={{ color: T3, fontSize: 12, marginTop: 2 }}>{t('owner.menuEnabledDescription')}</p>
              </div>
            </div>
            <Switch checked={menuEnabled} onCheckedChange={async checked => {
              setMenuEnabled(checked);
              const { error } = await supabase.from('venues').update({ menu_enabled: checked }).eq('id', venueId);
              if (error) { setMenuEnabled(!checked); toast.error(t('owner.barConfigError')); }
              else { toast.success(checked ? t('owner.menuActivated') : t('owner.menuDeactivated')); }
            }} />
          </div>
        </SectionCard>

        {/* Absorption des frais Yuno */}
        <SectionCard>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <Receipt className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: T3 }} />
              <div>
                <p style={{ color: T1, fontSize: 13.5, fontWeight: 500 }}>{t('owner.absorbFeesTitle')}</p>
                <p style={{ color: T3, fontSize: 12, marginTop: 2 }}>{t('owner.absorbFeesDescription')}</p>
              </div>
            </div>
            <Switch checked={absorbFees} onCheckedChange={async checked => {
              setAbsorbFees(checked);
              const { error } = await supabase.from('venues').update({ absorb_yuno_fees: checked }).eq('id', venueId);
              if (error) { setAbsorbFees(!checked); toast.error(t('owner.errorSaving')); }
              else { toast.success(checked ? t('owner.absorbFeesOn') : t('owner.absorbFeesOff')); }
            }} />
          </div>
        </SectionCard>

        {/* Mode boisson offerte */}
        <div style={{ opacity: menuEnabled ? 1 : 0.4, pointerEvents: menuEnabled ? 'auto' : 'none' }}>
          <SectionCard title={t('tickets.freeDrinkMode')} description={t('tickets.freeDrinkModeDesc')}>
            <div className="space-y-2">
              {([
                { val: 'credits' as const, Icon: Coins, label: t('tickets.freeDrinkModeCredits'), desc: t('tickets.freeDrinkModeCreditsDesc') },
                { val: 'bouncer_notify' as const, Icon: Bell, label: t('tickets.freeDrinkModeBouncer'), desc: t('tickets.freeDrinkModeBouncerDesc') },
              ]).map(({ val, Icon, label, desc }) => (
                <label key={val}
                  className="flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-all duration-150"
                  style={{
                    background: freeDrinkMode === val ? 'rgba(232,25,44,0.06)' : INNER_BG,
                    border: `1px solid ${freeDrinkMode === val ? 'rgba(232,25,44,0.2)' : BORDER}`,
                  }}
                  onClick={async () => {
                    if (!menuEnabled) return;
                    setFreeDrinkMode(val);
                    if (venueId) await supabase.from('venues').update({ free_drink_mode: val }).eq('id', venueId);
                  }}>
                  <div className="mt-0.5 h-4 w-4 rounded-full border-2 flex items-center justify-center flex-shrink-0"
                    style={{ borderColor: freeDrinkMode === val ? RED : T3 }}>
                    {freeDrinkMode === val && <div className="h-2 w-2 rounded-full" style={{ background: RED }} />}
                  </div>
                  <div className="flex-1">
                    <span className="flex items-center gap-2 text-[13px] font-medium" style={{ color: T1 }}>
                      <Icon className="w-3.5 h-3.5" style={{ color: T3 }} />{label}
                    </span>
                    <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>{desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </SectionCard>
        </div>

        {/* Configuration des bars */}
        <div style={{ opacity: menuEnabled ? 1 : 0.4, pointerEvents: menuEnabled ? 'auto' : 'none' }}>
          <SectionCard>
            <BarConfigSection venueId={venueId} />
          </SectionCard>
        </div>

        {/* ═══════════════════════════════════════════════════════════
            DOCUMENTS D'ACCÈS — joints à chaque confirmation de billet
        ════════════════════════════════════════════════════════════ */}
        <GroupHeader icon={FileText} title={t('owner.sectionAccessDocs')} description={t('owner.sectionAccessDocsDesc')} />

        <SectionCard title={t('owner.accessDocsTitle')} description={t('owner.accessDocsDescription')}>
          {accessDocs.length > 0 && (
            <div className="space-y-2">
              {accessDocs.map(doc => (
                <div key={doc.id} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                  <FileText className="h-5 w-5 flex-none" style={{ color: RED }} />
                  <div className="flex-1 min-w-0">
                    <DarkInput value={doc.label} onChange={(v) => handleRenameAccessDoc(doc.id, v)} placeholder={t('owner.accessDocsLabelPlaceholder')} />
                    <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer"
                      className="block truncate mt-1" style={{ color: T3, fontSize: 11 }}>{doc.fileName}</a>
                  </div>
                  <button type="button" onClick={() => handleRemoveAccessDoc(doc.id)}
                    className="flex-none p-2 rounded-lg transition-colors" style={{ color: T2 }}
                    onMouseEnter={e => (e.currentTarget.style.color = RED)} onMouseLeave={e => (e.currentTarget.style.color = T2)}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {accessDocs.length < 5 && (
            <label className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl cursor-pointer transition-all duration-150"
              style={{ background: INNER_BG, border: `1px dashed ${BORDER}`, color: uploadingDoc ? T3 : T1, fontSize: 13, fontWeight: 560 }}>
              {uploadingDoc
                ? <><Loader2 className="h-4 w-4 animate-spin" />{t('owner.uploading')}...</>
                : <><Upload className="h-4 w-4" />{t('owner.accessDocsUpload')}</>}
              <input type="file" accept="application/pdf,.pdf" className="hidden" disabled={uploadingDoc} onChange={handleAccessDocUpload} />
            </label>
          )}
          <p style={{ color: T3, fontSize: 11 }}>{t('owner.accessDocsHint')}</p>
        </SectionCard>

        {/* ═══════════════════════════════════════════════════════════
            6. INFORMATIONS LÉGALES
        ════════════════════════════════════════════════════════════ */}
        <GroupHeader icon={Settings} title={t('owner.sectionLegal')} description={t('owner.sectionLegalDesc')} />

        <SectionCard title={t('owner.legalInfoTitle')} description={t('owner.legalInfoDescription')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel>{t('owner.legalName')}</FieldLabel>
              <DarkInput value={legalName} onChange={setLegalName} placeholder={t('owner.legalNamePlaceholder')} />
            </div>
            <div>
              <FieldLabel>{t('owner.siret')}</FieldLabel>
              <DarkInput value={siret} onChange={setSiret} placeholder={t('owner.siretPlaceholder')} />
            </div>
            <div>
              <FieldLabel>{t('owner.vatNumber')}</FieldLabel>
              <DarkInput value={vatNumber} onChange={setVatNumber} placeholder={t('owner.vatPlaceholder')} />
              <p style={{ color: T3, fontSize: 11, marginTop: 4 }}>{t('owner.vatHint')}</p>
            </div>
            <div>
              <FieldLabel>{t('owner.invoicePrefix')}</FieldLabel>
              <DarkInput value={invoicePrefix} onChange={v => setInvoicePrefix(v.toUpperCase())} placeholder={t('owner.invoicePrefixPlaceholder')} maxLength={5} />
              <p style={{ color: T3, fontSize: 11, marginTop: 4 }}>{t('owner.invoicePrefixHint')}</p>
            </div>
          </div>
          <div>
            <FieldLabel>{t('owner.legalAddress')}</FieldLabel>
            <DarkInput value={legalAddress} onChange={setLegalAddress} placeholder={t('owner.legalAddressPlaceholder')} />
          </div>
          <SaveButton onClick={handleSaveLegalInfo} loading={savingLegal} label={t('owner.saveLegalInfo')} loadingLabel={t('owner.savingLegalInfo')} />
        </SectionCard>

      </div>
    </div>
  );
}
