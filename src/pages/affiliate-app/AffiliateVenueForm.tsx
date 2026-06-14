import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Lock, Building2, ImageIcon, Sliders, LinkIcon } from 'lucide-react';
import { AffiliateImageUploader } from '@/components/affiliate/AffiliateImageUploader';
import { AffiliateDraggableGallery } from '@/components/affiliate/AffiliateDraggableGallery';
import { AffiliateAddressSearch } from '@/components/affiliate/AffiliateAddressSearch';
import {
  AffPage, AffBackHeader, AffCard, AffCardHeader, AffButton, ChoiceChip, AffSpinner,
  FieldLabel, DarkInput, DarkTextarea,
  T1, T2, T3, BORDER, TILE_BG, F_BORDER,
} from '@/components/affiliate/affiliate-ui';

const GENRES = ['House', 'Techno', 'Reggaeton', 'Open Format', 'Latin', 'Afrobeats', 'R&B', 'Drum & Bass', 'Hip-Hop', 'Electronic'];

function slugify(text: string) {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

type FormData = {
  name: string;
  slug: string;
  short_description: string;
  description: string;
  logo_url: string | null;
  cover_image_url: string | null;
  gallery_urls: string[];
  instagram: string;
  tiktok: string;
  website: string;
  external_booking_url: string;
  genres: string[];
  min_age: string;
  dress_code: string;
  address: string;
  lat: number | null;
  lng: number | null;
};

const EMPTY: FormData = {
  name: '', slug: '', short_description: '', description: '',
  logo_url: null, cover_image_url: null, gallery_urls: [],
  instagram: '', tiktok: '', website: '',
  external_booking_url: '', genres: [], min_age: '', dress_code: '',
  address: '', lat: null, lng: null,
};

export default function AffiliateVenueForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const isEdit = Boolean(id);

  const [affiliateId, setAffiliateId] = useState<string | null>(null);
  const [affiliateCity, setAffiliateCity] = useState<string>('');
  const [form, setForm] = useState<FormData>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (user) init();
  }, [user, id]);

  const init = async () => {
    if (!user) return;
    const { data: aff } = await supabase
      .from('affiliates')
      .select('id, city')
      .eq('user_id', user.id)
      .single();

    if (!aff) { setLoadingData(false); return; }
    setAffiliateId(aff.id);
    setAffiliateCity(aff.city ?? '');

    if (isEdit && id) {
      const { data } = await supabase
        .from('affiliate_venues')
        .select('*')
        .eq('id', id)
        .eq('affiliate_id', aff.id)
        .single();
      if (data) {
        setForm({
          name: data.name ?? '',
          slug: data.slug ?? '',
          short_description: (data as any).short_description ?? '',
          description: data.description ?? '',
          logo_url: (data as any).logo_url ?? null,
          cover_image_url: data.cover_image_url ?? null,
          gallery_urls: data.gallery_urls ?? [],
          instagram: data.instagram ?? '',
          tiktok: data.tiktok ?? '',
          website: data.website ?? '',
          external_booking_url: data.external_booking_url ?? '',
          genres: data.genres ?? [],
          min_age: data.min_age?.toString() ?? '',
          dress_code: data.dress_code ?? '',
          address: data.address ?? '',
          lat: data.lat ? Number(data.lat) : null,
          lng: data.lng ? Number(data.lng) : null,
        });
      }
    }
    setLoadingData(false);
  };

  const set = <K extends keyof FormData>(field: K, value: FormData[K]) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const toggleGenre = (g: string) =>
    set('genres', form.genres.includes(g) ? form.genres.filter((x) => x !== g) : [...form.genres, g]);

  const resolveUniqueSlug = async (baseSlug: string, excludeId?: string): Promise<string> => {
    let candidate = baseSlug;
    let suffix = 1;
    while (true) {
      let query = supabase.from('affiliate_venues').select('id').eq('slug', candidate);
      if (excludeId) query = query.neq('id', excludeId);
      const { data } = await query.limit(1);
      if (!data || data.length === 0) return candidate;
      candidate = `${baseSlug}-${suffix++}`;
    }
  };

  const handleSave = async () => {
    if (!affiliateId || !form.name) {
      toast({ title: 'Nom requis', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const baseSlug = form.slug || slugify(form.name);
      const slug = await resolveUniqueSlug(baseSlug, isEdit && id ? id : undefined);

      const payload = {
        affiliate_id: affiliateId,
        name: form.name,
        slug,
        city: affiliateCity || null,
        short_description: form.short_description || null,
        description: form.description || null,
        logo_url: form.logo_url,
        cover_image_url: form.cover_image_url,
        gallery_urls: form.gallery_urls,
        instagram: form.instagram || null,
        tiktok: form.tiktok || null,
        website: form.website || null,
        external_booking_url: form.external_booking_url || null,
        genres: form.genres,
        min_age: form.min_age ? parseInt(form.min_age) : null,
        dress_code: form.dress_code || null,
        address: form.address || null,
        lat: form.lat,
        lng: form.lng,
      };

      if (isEdit && id) {
        const { error } = await supabase.from('affiliate_venues').update(payload).eq('id', id).select().single();
        if (error) throw error;
        toast({ title: 'Club mis à jour' });
      } else {
        const { error } = await supabase.from('affiliate_venues').insert(payload).select().single();
        if (error) throw error;
        toast({ title: 'Club créé' });
      }

      navigate('/affiliate/venues');
    } catch (err) {
      const msg = (err as any)?.message ?? (err instanceof Error ? err.message : 'Erreur inconnue');
      const hint = (err as any)?.hint ?? (err as any)?.details ?? '';
      toast({ title: 'Erreur', description: hint ? `${msg} — ${hint}` : msg, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (loadingData) return <AffSpinner />;

  if (!affiliateId) {
    return <AffPage maxWidth={760}><p style={{ color: T2 }}>Profil affilié introuvable.</p></AffPage>;
  }

  return (
    <AffPage maxWidth={760}>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <AffBackHeader title={isEdit ? 'Modifier le club' : 'Nouveau club'} onBack={() => navigate('/affiliate/venues')} />
      </motion.div>

      {/* Identité */}
      <AffCard padding={20}>
        <AffCardHeader icon={Building2} title="Identité" />
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel>Nom du club *</FieldLabel>
              <DarkInput value={form.name} onChange={(v) => { set('name', v); if (!isEdit) set('slug', slugify(v)); }} placeholder="Fabrik Madrid" />
            </div>
            <div>
              <FieldLabel>Slug (URL)</FieldLabel>
              <DarkInput value={form.slug} onChange={(v) => set('slug', v)} placeholder="fabrik-madrid" />
            </div>
          </div>

          {/* Ville verrouillée */}
          <div>
            <FieldLabel><span className="inline-flex items-center gap-1.5"><Lock className="h-3 w-3" /> Ville</span></FieldLabel>
            <div className="flex items-center gap-2 px-3" style={{ height: 40, borderRadius: 10, background: TILE_BG, border: `1px solid ${F_BORDER}` }}>
              <span style={{ color: T1, fontSize: 13 }}>{affiliateCity || '—'}</span>
              <span style={{ color: T3, fontSize: 11, marginLeft: 'auto' }}>Assignée par l'admin Yuno</span>
            </div>
          </div>

          <AffiliateAddressSearch
            address={form.address}
            lat={form.lat}
            lng={form.lng}
            onSelect={(address, lat, lng) => setForm((prev) => ({ ...prev, address, lat, lng }))}
            onClear={() => setForm((prev) => ({ ...prev, address: '', lat: null, lng: null }))}
          />

          <div>
            <FieldLabel hint="(accroche affichée sous le nom)">Bio courte</FieldLabel>
            <DarkTextarea value={form.short_description} onChange={(v) => set('short_description', v.slice(0, 160))} placeholder="Une phrase courte et percutante…" rows={2} />
            <p style={{ color: T3, fontSize: 11, textAlign: 'right', marginTop: 4 }}>{form.short_description.length}/160</p>
          </div>

          <div>
            <FieldLabel>Description complète</FieldLabel>
            <DarkTextarea value={form.description} onChange={(v) => set('description', v)} placeholder="Description complète du club…" rows={4} />
          </div>
        </div>
      </AffCard>

      {/* Médias */}
      <AffCard padding={20}>
        <AffCardHeader icon={ImageIcon} title="Photos" />
        <div className="space-y-6">
          <AffiliateImageUploader affiliateId={affiliateId} value={form.logo_url} onChange={(url) => set('logo_url', url)}
            folder="venues/logos" label="Logo du club" hint="Image carrée recommandée" shape="circle" />
          <AffiliateImageUploader affiliateId={affiliateId} value={form.cover_image_url} onChange={(url) => set('cover_image_url', url)}
            folder="venues/covers" label="Photo principale (bannière)" hint="Format paysage 16:9 recommandé · 1400px max" />
          <AffiliateDraggableGallery affiliateId={affiliateId} folder="venues/gallery" urls={form.gallery_urls}
            onChange={(urls) => set('gallery_urls', urls)} label="Galerie photos" maxFiles={15} />
        </div>
      </AffCard>

      {/* Caractéristiques */}
      <AffCard padding={20}>
        <AffCardHeader icon={Sliders} title="Caractéristiques" />
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel>Âge minimum</FieldLabel>
              <DarkInput type="number" value={form.min_age} onChange={(v) => set('min_age', v)} placeholder="18" />
            </div>
            <div>
              <FieldLabel>Dress code</FieldLabel>
              <DarkInput value={form.dress_code} onChange={(v) => set('dress_code', v)} placeholder="Smart casual" />
            </div>
          </div>

          <div>
            <FieldLabel>Genres musicaux</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {GENRES.map((g) => <ChoiceChip key={g} active={form.genres.includes(g)} onClick={() => toggleGenre(g)}>{g}</ChoiceChip>)}
            </div>
          </div>
        </div>
      </AffCard>

      {/* Social + billetterie */}
      <AffCard padding={20}>
        <AffCardHeader icon={LinkIcon} title="Liens" />
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <FieldLabel>Instagram</FieldLabel>
              <DarkInput value={form.instagram} onChange={(v) => set('instagram', v)} placeholder="@fabrikmadrid" />
            </div>
            <div>
              <FieldLabel>TikTok</FieldLabel>
              <DarkInput value={form.tiktok} onChange={(v) => set('tiktok', v)} placeholder="@fabrikmadrid" />
            </div>
            <div>
              <FieldLabel>Site web</FieldLabel>
              <DarkInput value={form.website} onChange={(v) => set('website', v)} placeholder="https://…" />
            </div>
          </div>

          <div>
            <FieldLabel>Lien billetterie du club (Shotgun, RA, site officiel…)</FieldLabel>
            <DarkInput value={form.external_booking_url} onChange={(v) => set('external_booking_url', v)} placeholder="https://ra.co/clubs/fabrik" />
            <p style={{ color: T3, fontSize: 11, marginTop: 6 }}>Page principale du club sur la billetterie. Différent du lien soirée.</p>
          </div>
        </div>
      </AffCard>

      <div className="flex gap-3 pb-8">
        <AffButton onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {isEdit ? 'Enregistrer' : 'Créer le club'}
        </AffButton>
        <AffButton variant="ghost" onClick={() => navigate('/affiliate/venues')}>Annuler</AffButton>
      </div>
    </AffPage>
  );
}
