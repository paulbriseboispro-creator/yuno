import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { ExternalLink, Loader2, CalendarDays, Ticket, ImageIcon, ListMusic } from 'lucide-react';
import { AffiliateImageUploader } from '@/components/affiliate/AffiliateImageUploader';
import { AffiliateDraggableGallery } from '@/components/affiliate/AffiliateDraggableGallery';
import {
  AffPage, AffBackHeader, AffCard, AffCardHeader, AffButton, ChoiceChip, CheckBox, AffSpinner,
  FieldLabel, DarkInput, DarkSelect, DarkTextarea,
  RED, T2, T3, BORDER, INNER_BG,
} from '@/components/affiliate/affiliate-ui';

const GENRES = ['House', 'Techno', 'Reggaeton', 'Open Format', 'Latin', 'Afrobeats', 'R&B', 'Drum & Bass', 'Hip-Hop', 'Electronic'];

function slugify(text: string) {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

type VenueOption = { id: string; name: string };

type FormData = {
  affiliate_venue_id: string;
  name: string;
  slug: string;
  event_date: string;
  start_time: string;
  end_time: string;
  flyer_url: string | null;
  gallery_urls: string[];
  description: string;
  genres: string[];
  dj_names: string;
  external_ticket_url: string;
  price_from: string;
  is_free: boolean;
  is_sold_out: boolean;
  status: 'draft' | 'published' | 'featured';
};

const EMPTY: FormData = {
  affiliate_venue_id: '', name: '', slug: '', event_date: '', start_time: '',
  end_time: '', flyer_url: null, gallery_urls: [], description: '', genres: [], dj_names: '',
  external_ticket_url: '', price_from: '', is_free: false, is_sold_out: false, status: 'draft',
};

// Native date/time inputs styled to DA tokens.
const dateInputStyle: React.CSSProperties = {
  background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10,
  padding: '9px 12px', color: 'rgba(255,255,255,0.96)', fontSize: 13.5, fontFamily: 'inherit', width: '100%',
  colorScheme: 'dark',
};

export default function AffiliateEventForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const isEdit = Boolean(id);

  const [affiliateId, setAffiliateId] = useState<string | null>(null);
  const [venues, setVenues] = useState<VenueOption[]>([]);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (user) init();
  }, [user, id]);

  const init = async () => {
    if (!user) return;
    const { data: aff } = await supabase.from('affiliates').select('id').eq('user_id', user.id).single();
    if (!aff) { setLoadingData(false); return; }
    setAffiliateId(aff.id);

    const { data: venueData } = await supabase
      .from('affiliate_venues')
      .select('id, name')
      .eq('affiliate_id', aff.id)
      .eq('is_active', true)
      .order('name');
    setVenues(venueData ?? []);

    if (isEdit && id) {
      const { data } = await supabase
        .from('affiliate_events')
        .select('*')
        .eq('id', id)
        .eq('affiliate_id', aff.id)
        .single();
      if (data) {
        setForm({
          affiliate_venue_id: data.affiliate_venue_id ?? '',
          name: data.name ?? '',
          slug: data.slug ?? '',
          event_date: data.event_date ?? '',
          start_time: data.start_time ?? '',
          end_time: data.end_time ?? '',
          flyer_url: data.flyer_url ?? null,
          gallery_urls: data.gallery_urls ?? [],
          description: data.description ?? '',
          genres: data.genres ?? [],
          dj_names: (data.dj_names ?? []).join(', '),
          external_ticket_url: data.external_ticket_url ?? '',
          price_from: data.price_from?.toString() ?? '',
          is_free: data.is_free ?? false,
          is_sold_out: data.is_sold_out ?? false,
          status: (data.status ?? 'draft') as 'draft' | 'published' | 'featured',
        });
      }
    }
    setLoadingData(false);
  };

  const set = <K extends keyof FormData>(field: K, value: FormData[K]) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const toggleGenre = (g: string) =>
    set('genres', form.genres.includes(g) ? form.genres.filter((x) => x !== g) : [...form.genres, g]);

  const handleSave = async () => {
    if (!affiliateId || !form.name || !form.event_date) {
      toast({ title: 'Champs requis', description: 'Nom et date sont obligatoires.', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const djNames = form.dj_names.split(',').map((d) => d.trim()).filter(Boolean);

      const payload = {
        affiliate_id: affiliateId,
        affiliate_venue_id: form.affiliate_venue_id || null,
        name: form.name,
        slug: form.slug || slugify(`${form.name}-${form.event_date}`),
        event_date: form.event_date,
        start_time: form.start_time || null,
        end_time: form.end_time || null,
        flyer_url: form.flyer_url,
        gallery_urls: form.gallery_urls,
        description: form.description || null,
        genres: form.genres,
        dj_names: djNames,
        external_ticket_url: form.external_ticket_url || null,
        price_from: form.price_from ? parseFloat(form.price_from) : null,
        is_free: form.is_free,
        is_sold_out: form.is_sold_out,
        status: form.status,
      };

      if (isEdit && id) {
        const { error } = await supabase.from('affiliate_events').update(payload).eq('id', id);
        if (error) throw error;
        toast({ title: 'Soirée mise à jour' });
      } else {
        const { error } = await supabase.from('affiliate_events').insert(payload);
        if (error) throw error;
        toast({ title: 'Soirée créée' });
      }

      navigate('/affiliate/events');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur';
      toast({ title: 'Erreur', description: msg, variant: 'destructive' });
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
        <AffBackHeader title={isEdit ? 'Modifier la soirée' : 'Nouvelle soirée'} onBack={() => navigate('/affiliate/events')} />
      </motion.div>

      {/* Infos de base */}
      <AffCard padding={20}>
        <AffCardHeader icon={CalendarDays} title="Infos de base" />
        <div className="space-y-4">
          <div>
            <FieldLabel>Club partenaire</FieldLabel>
            <DarkSelect value={form.affiliate_venue_id} onChange={(v) => set('affiliate_venue_id', v)}>
              <option value="">Sélectionner un club…</option>
              {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </DarkSelect>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel>Nom de la soirée *</FieldLabel>
              <DarkInput value={form.name} onChange={(v) => { set('name', v); if (!isEdit) set('slug', slugify(`${v}-${form.event_date}`)); }} placeholder="Club de los Viernes" />
            </div>
            <div>
              <FieldLabel>Statut</FieldLabel>
              <DarkSelect value={form.status} onChange={(v) => set('status', v as FormData['status'])}>
                <option value="draft">Brouillon</option>
                <option value="published">Publié</option>
                <option value="featured">À la une</option>
              </DarkSelect>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <FieldLabel>Date *</FieldLabel>
              <input type="date" value={form.event_date} onChange={(e) => set('event_date', e.target.value)} style={dateInputStyle} />
            </div>
            <div>
              <FieldLabel>Ouverture</FieldLabel>
              <input type="time" value={form.start_time} onChange={(e) => set('start_time', e.target.value)} style={dateInputStyle} />
            </div>
            <div>
              <FieldLabel>Fermeture</FieldLabel>
              <input type="time" value={form.end_time} onChange={(e) => set('end_time', e.target.value)} style={dateInputStyle} />
            </div>
          </div>
        </div>
      </AffCard>

      {/* Billetterie */}
      <AffCard padding={20}>
        <AffCardHeader icon={Ticket} title="Billetterie" accent />
        <div className="space-y-4">
          <div>
            <FieldLabel><span className="inline-flex items-center gap-1.5"><ExternalLink className="h-3.5 w-3.5" style={{ color: RED }} /> Lien billetterie (Shotgun, RA, site club…)</span></FieldLabel>
            <DarkInput value={form.external_ticket_url} onChange={(v) => set('external_ticket_url', v)} placeholder="https://shotgun.live/…  ou  https://ra.co/events/…" />
            <p style={{ color: T3, fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>
              Yuno tracke le clic avant de rediriger vers la billetterie externe. Sans ce lien, la soirée ne sera pas visible du public.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-4 items-end">
            <div>
              <FieldLabel>Prix à partir de (€)</FieldLabel>
              <DarkInput type="number" value={form.price_from} onChange={(v) => set('price_from', v)} placeholder="10" />
            </div>
            <div className="pb-2.5"><CheckBox checked={form.is_free} onChange={(v) => set('is_free', v)} label="Entrée gratuite" /></div>
            <div className="pb-2.5"><CheckBox checked={form.is_sold_out} onChange={(v) => set('is_sold_out', v)} label="Complet" /></div>
          </div>
        </div>
      </AffCard>

      {/* Médias */}
      <AffCard padding={20}>
        <AffCardHeader icon={ImageIcon} title="Médias" />
        <div className="space-y-6">
          <AffiliateImageUploader affiliateId={affiliateId} value={form.flyer_url} onChange={(url) => set('flyer_url', url)}
            folder="events/flyers" label="Flyer / Poster de la soirée" hint="Format portrait recommandé · PNG, JPG, WEBP" />
          <AffiliateDraggableGallery affiliateId={affiliateId} folder="events/gallery" urls={form.gallery_urls}
            onChange={(urls) => set('gallery_urls', urls)} label="Galerie photos (after, ambiance…)" maxFiles={10} />
        </div>
      </AffCard>

      {/* Détails */}
      <AffCard padding={20}>
        <AffCardHeader icon={ListMusic} title="Détails" />
        <div className="space-y-4">
          <div>
            <FieldLabel hint="(séparés par des virgules)">DJs / Artistes</FieldLabel>
            <DarkInput value={form.dj_names} onChange={(v) => set('dj_names', v)} placeholder="Ricardo Villalobos, Len Faki, Marcel Dettmann" />
          </div>
          <div>
            <FieldLabel>Description</FieldLabel>
            <DarkTextarea value={form.description} onChange={(v) => set('description', v)} placeholder="Description de la soirée…" rows={3} />
          </div>
          <div>
            <FieldLabel>Genres</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {GENRES.map((g) => <ChoiceChip key={g} active={form.genres.includes(g)} onClick={() => toggleGenre(g)}>{g}</ChoiceChip>)}
            </div>
          </div>
        </div>
      </AffCard>

      <div className="flex gap-3 pb-8">
        <AffButton onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {isEdit ? 'Enregistrer' : 'Créer la soirée'}
        </AffButton>
        <AffButton variant="ghost" onClick={() => navigate('/affiliate/events')}>Annuler</AffButton>
      </div>
    </AffPage>
  );
}
