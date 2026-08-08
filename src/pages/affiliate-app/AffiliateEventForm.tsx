import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { useUnsavedGuard } from '@/hooks/useUnsavedGuard';
import { ExternalLink, Loader2, CalendarDays, Ticket, ImageIcon, ListMusic } from 'lucide-react';
import { AffiliateImageUploader } from '@/components/affiliate/AffiliateImageUploader';
import { AffiliateDraggableGallery } from '@/components/affiliate/AffiliateDraggableGallery';
import {
  AffPage, AffBackHeader, AffCard, AffCardHeader, AffButton, ChoiceChip, CheckBox, AffSpinner,
  FieldLabel, DarkInput, DarkSelect, DarkTextarea,
  RED, T2, T3, BORDER, INNER_BG,
} from '@/components/affiliate/affiliate-ui';
import { MUSIC_GENRES, canonicalGenres } from '@/lib/musicGenres';

const GENRES = MUSIC_GENRES;

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
  has_tables: boolean;
  tables_only: boolean;
  has_guest_list: boolean;
  guest_list_type: 'mixed' | 'women';
};

const EMPTY: FormData = {
  affiliate_venue_id: '', name: '', slug: '', event_date: '', start_time: '',
  end_time: '', flyer_url: null, gallery_urls: [], description: '', genres: [], dj_names: '',
  external_ticket_url: '', price_from: '', is_free: false, is_sold_out: false, status: 'draft',
  has_tables: false, tables_only: false, has_guest_list: false, guest_list_type: 'mixed',
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
  const { t } = useLanguage();
  const isEdit = Boolean(id);

  const [affiliateId, setAffiliateId] = useState<string | null>(null);
  const [venues, setVenues] = useState<VenueOption[]>([]);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (user) init();
  }, [user?.id, id]);

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
          // Anciens libellés (« Afrobeats », « open-format »…) ramenés sur les
          // puces réelles, sinon la soirée repart sans genre au prochain save.
          genres: canonicalGenres(data.genres),
          dj_names: (data.dj_names ?? []).join(', '),
          external_ticket_url: data.external_ticket_url ?? '',
          price_from: data.price_from?.toString() ?? '',
          is_free: data.is_free ?? false,
          is_sold_out: data.is_sold_out ?? false,
          status: (data.status ?? 'draft') as 'draft' | 'published' | 'featured',
          has_tables: (data as any).has_tables ?? false,
          tables_only: (data as any).tables_only ?? false,
          has_guest_list: (data as any).has_guest_list ?? false,
          guest_list_type: ((data as any).guest_list_type === 'women' ? 'women' : 'mixed'),
        });
      }
    }
    setLoadingData(false);
  };

  const set = <K extends keyof FormData>(field: K, value: FormData[K]) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const toggleGenre = (g: string) =>
    set('genres', form.genres.includes(g) ? form.genres.filter((x) => x !== g) : [...form.genres, g]);

  const handleSave = async (): Promise<boolean> => {
    if (!affiliateId || !form.name || !form.event_date) {
      toast({ title: t('aff.eventForm.requiredTitle'), description: t('aff.eventForm.requiredDesc'), variant: 'destructive' });
      return false;
    }

    setSaving(true);
    try {
      const djNames = form.dj_names.split(',').map((d) => d.trim()).filter(Boolean);
      const slug = form.slug || slugify(`${form.name}-${form.event_date}`);

      const payload = {
        affiliate_id: affiliateId,
        affiliate_venue_id: form.affiliate_venue_id || null,
        name: form.name,
        slug,
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
        // Sans lien : brouillon d'office (le trigger DB l'impose de toute façon).
        status: form.external_ticket_url ? form.status : 'draft',
        has_tables: form.has_tables || form.tables_only,
        tables_only: form.tables_only,
        has_guest_list: form.has_guest_list,
        guest_list_type: form.guest_list_type,
      };

      const saved: FormData = { ...form, slug };

      if (isEdit && id) {
        const { error } = await supabase.from('affiliate_events').update(payload).eq('id', id);
        if (error) throw error;
        setForm(saved);
        markSaved(saved);
        toast({ title: t('aff.eventForm.updatedToast') });
        // On RESTE sur la soirée après une modification.
      } else {
        const { data, error } = await supabase.from('affiliate_events').insert(payload).select('id').single();
        if (error) throw error;
        setForm(saved);
        markSaved(saved);
        toast({ title: t('aff.eventForm.createdToast') });
        // Bascule en édition sur place : un second « Enregistrer » met à jour.
        if (data?.id) navigate(`/affiliate/events/${data.id}/edit`, { replace: true });
      }
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('aff.eventForm.errorTitle');
      toast({ title: t('aff.eventForm.errorTitle'), description: msg, variant: 'destructive' });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const { markSaved, guardedNavigate } = useUnsavedGuard({
    scope: `affiliate-event:${id ?? 'new'}`,
    label: isEdit ? t('aff.eventForm.guardEdit') : t('aff.eventForm.guardNew'),
    ready: !loadingData && Boolean(affiliateId),
    value: form,
    onRestore: setForm,
    onSave: handleSave,
  });

  if (loadingData) return <AffSpinner />;

  if (!affiliateId) {
    return <AffPage maxWidth={760}><p style={{ color: T2 }}>{t('aff.eventForm.profileNotFound')}</p></AffPage>;
  }

  return (
    <AffPage maxWidth={760}>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <AffBackHeader title={isEdit ? t('aff.eventForm.editTitle') : t('aff.eventForm.newTitle')} onBack={() => guardedNavigate('/affiliate/events')} />
      </motion.div>

      {/* Infos de base */}
      <AffCard padding={20}>
        <AffCardHeader icon={CalendarDays} title={t('aff.eventForm.basicInfo')} />
        <div className="space-y-4">
          <div>
            <FieldLabel>{t('aff.eventForm.venueLabel')}</FieldLabel>
            <DarkSelect value={form.affiliate_venue_id} onChange={(v) => set('affiliate_venue_id', v)}>
              <option value="">{t('aff.eventForm.selectVenue')}</option>
              {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </DarkSelect>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel>{t('aff.eventForm.nameLabel')}</FieldLabel>
              <DarkInput value={form.name} onChange={(v) => { set('name', v); if (!isEdit) set('slug', slugify(`${v}-${form.event_date}`)); }} placeholder="Club de los Viernes" />
            </div>
            <div>
              <FieldLabel>{t('aff.eventForm.statusLabel')}</FieldLabel>
              {/* Règle plateforme (verrouillée en base) : sans lien billetterie la
                  soirée reste en brouillon ; le sélecteur reflète cette vérité. */}
              <DarkSelect value={form.external_ticket_url ? form.status : 'draft'} onChange={(v) => set('status', v as FormData['status'])}>
                <option value="draft">{t('aff.eventForm.statusDraft')}</option>
                <option value="published" disabled={!form.external_ticket_url}>{t('aff.eventForm.statusPublished')}</option>
                <option value="featured" disabled={!form.external_ticket_url}>{t('aff.eventForm.statusFeatured')}</option>
              </DarkSelect>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <FieldLabel>{t('aff.eventForm.dateLabel')}</FieldLabel>
              <input type="date" value={form.event_date} onChange={(e) => set('event_date', e.target.value)} style={dateInputStyle} />
            </div>
            <div>
              <FieldLabel>{t('aff.eventForm.openLabel')}</FieldLabel>
              <input type="time" value={form.start_time} onChange={(e) => set('start_time', e.target.value)} style={dateInputStyle} />
            </div>
            <div>
              <FieldLabel>{t('aff.eventForm.closeLabel')}</FieldLabel>
              <input type="time" value={form.end_time} onChange={(e) => set('end_time', e.target.value)} style={dateInputStyle} />
            </div>
          </div>
        </div>
      </AffCard>

      {/* Billetterie */}
      <AffCard padding={20}>
        <AffCardHeader icon={Ticket} title={t('aff.eventForm.ticketing')} accent />
        <div className="space-y-4">
          <div>
            <FieldLabel><span className="inline-flex items-center gap-1.5"><ExternalLink className="h-3.5 w-3.5" style={{ color: RED }} /> {t('aff.eventForm.ticketUrlLabel')}</span></FieldLabel>
            <DarkInput value={form.external_ticket_url} onChange={(v) => { set('external_ticket_url', v); if (v && form.status === 'draft') set('status', 'published'); if (!v && form.status !== 'draft') set('status', 'draft'); }} placeholder={t('aff.eventForm.ticketUrlPlaceholder')} />
            <p style={{ color: T3, fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>
              {t('aff.eventForm.ticketUrlHelp')}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-4 items-end">
            <div>
              <FieldLabel>{t('aff.eventForm.priceFromLabel')}</FieldLabel>
              <DarkInput type="number" value={form.price_from} onChange={(v) => set('price_from', v)} placeholder="10" />
            </div>
            <div className="pb-2.5"><CheckBox checked={form.is_free} onChange={(v) => set('is_free', v)} label={t('aff.eventForm.freeEntry')} /></div>
            <div className="pb-2.5"><CheckBox checked={form.is_sold_out} onChange={(v) => set('is_sold_out', v)} label={t('aff.eventForm.soldOut')} /></div>
          </div>

          {/* Offre de la soirée : tables VIP / guest list (badges publics). */}
          <div className="mt-4">
            <FieldLabel>{t('aff.offer.title')}</FieldLabel>
            <div className="space-y-2 mt-1">
              <CheckBox checked={form.has_tables || form.tables_only} onChange={(v) => { set('has_tables', v); if (!v) set('tables_only', false); }} label={t('aff.offer.tables')} />
              <CheckBox checked={form.tables_only} onChange={(v) => { set('tables_only', v); if (v) set('has_tables', true); }} label={t('aff.offer.tablesOnly')} />
              <CheckBox checked={form.has_guest_list} onChange={(v) => set('has_guest_list', v)} label={t('aff.offer.guestList')} />
            </div>
            {form.has_guest_list && (
              <div className="mt-3">
                <FieldLabel>{t('aff.offer.guestListType')}</FieldLabel>
                <DarkSelect value={form.guest_list_type} onChange={(v) => set('guest_list_type', v as FormData['guest_list_type'])}>
                  <option value="mixed">{t('aff.offer.glMixed')}</option>
                  <option value="women">{t('aff.offer.glWomen')}</option>
                </DarkSelect>
              </div>
            )}
          </div>
        </div>
      </AffCard>

      {/* Médias */}
      <AffCard padding={20}>
        <AffCardHeader icon={ImageIcon} title={t('aff.eventForm.media')} />
        <div className="space-y-6">
          <AffiliateImageUploader affiliateId={affiliateId} value={form.flyer_url} onChange={(url) => set('flyer_url', url)}
            folder="events/flyers" label={t('aff.eventForm.flyerLabel')} hint={t('aff.eventForm.flyerHint')} />
          <AffiliateDraggableGallery affiliateId={affiliateId} folder="events/gallery" urls={form.gallery_urls}
            onChange={(urls) => set('gallery_urls', urls)} label={t('aff.eventForm.galleryLabel')} maxFiles={10} />
        </div>
      </AffCard>

      {/* Détails */}
      <AffCard padding={20}>
        <AffCardHeader icon={ListMusic} title={t('aff.eventForm.details')} />
        <div className="space-y-4">
          <div>
            <FieldLabel hint={t('aff.eventForm.djsHint')}>{t('aff.eventForm.djsLabel')}</FieldLabel>
            <DarkInput value={form.dj_names} onChange={(v) => set('dj_names', v)} placeholder="Ricardo Villalobos, Len Faki, Marcel Dettmann" />
          </div>
          <div>
            <FieldLabel>{t('aff.eventForm.descriptionLabel')}</FieldLabel>
            <DarkTextarea value={form.description} onChange={(v) => set('description', v)} placeholder={t('aff.eventForm.descriptionPlaceholder')} rows={3} />
          </div>
          <div>
            <FieldLabel>{t('aff.eventForm.genresLabel')}</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {GENRES.map((g) => <ChoiceChip key={g} active={form.genres.includes(g)} onClick={() => toggleGenre(g)}>{g}</ChoiceChip>)}
            </div>
          </div>
        </div>
      </AffCard>

      <div className="flex gap-3 pb-8">
        <AffButton onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {isEdit ? t('aff.eventForm.save') : t('aff.eventForm.create')}
        </AffButton>
        <AffButton variant="ghost" onClick={() => guardedNavigate('/affiliate/events')}>{t('aff.eventForm.cancel')}</AffButton>
      </div>
    </AffPage>
  );
}
