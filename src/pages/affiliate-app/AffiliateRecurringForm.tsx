import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useUnsavedGuard } from '@/hooks/useUnsavedGuard';
import { Loader2, Zap, RefreshCw, Sparkles, ImageIcon } from 'lucide-react';
import { AffiliateImageUploader } from '@/components/affiliate/AffiliateImageUploader';
import {
  AffPage, AffBackHeader, AffCard, AffCardHeader, AffButton, ChoiceChip, CheckBox, Toggle, AffSpinner,
  FieldLabel, DarkInput, DarkSelect,
  RED, T1, T2, T3, BORDER, INNER_BG, TILE_BG, F_BORDER,
} from '@/components/affiliate/affiliate-ui';

const DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const BULK_DAYS = [1, 2, 3, 4, 5, 6, 0]; // Lun → Dim

const GENRES = ['House', 'Techno', 'Reggaeton', 'Open Format', 'Latin', 'Afrobeats', 'R&B', 'Drum & Bass', 'Hip-Hop', 'Electronic'];

function slugify(text: string) {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const timeInputStyle: React.CSSProperties = {
  background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10,
  padding: '9px 12px', color: 'rgba(255,255,255,0.96)', fontSize: 13.5, fontFamily: 'inherit', width: '100%',
  colorScheme: 'dark',
};

function getNextOccurrences(dayOfWeek: number, count = 5): Date[] {
  const dates: Date[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let d = new Date(today);
  while (dates.length < count) {
    d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
    if (d.getDay() === dayOfWeek) dates.push(new Date(d));
  }
  return dates;
}

function NextOccurrencesPreview({ dayOfWeek, advanceDays }: { dayOfWeek: number; advanceDays: number }) {
  const dates = getNextOccurrences(dayOfWeek);
  return (
    <AffCard padding={18}>
      <AffCardHeader icon={Sparkles} title="5 prochaines occurrences" subtitle="Aperçu de la génération automatique" accent />
      <ul className="space-y-2">
        {dates.map((d, i) => {
          const createdOn = new Date(d.getTime() - advanceDays * 24 * 60 * 60 * 1000);
          const dateLabel = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
          const createdLabel = createdOn.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
          return (
            <li key={i} className="flex items-center justify-between gap-4 py-1.5" style={{ borderBottom: i < dates.length - 1 ? `1px solid ${F_BORDER}` : 'none' }}>
              <span style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{dateLabel}</span>
              <span style={{ color: T3, fontSize: 11 }}>créé {advanceDays}j avant · {createdLabel}</span>
            </li>
          );
        })}
      </ul>
    </AffCard>
  );
}

type VenueOption = { id: string; name: string };

type FormData = {
  name: string;
  slug: string;
  affiliate_venue_id: string;
  day_of_week: number;
  advance_days: number;
  start_time: string;
  end_time: string;
  price_from: string;
  is_free: boolean;
  is_active: boolean;
  flyer_url: string | null;
  genres: string[];
  publication_url: string;
};

const EMPTY: FormData = {
  name: '', slug: '', affiliate_venue_id: '', day_of_week: 5,
  advance_days: 7, start_time: '23:00', end_time: '06:00',
  price_from: '', is_free: false, is_active: true, flyer_url: null, genres: [],
  publication_url: '',
};

export default function AffiliateRecurringForm() {
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

  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelectedDays, setBulkSelectedDays] = useState<number[]>([1, 2, 3, 4, 5, 6]);

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
        .from('affiliate_recurring_templates')
        .select('*')
        .eq('id', id)
        .eq('affiliate_id', aff.id)
        .single();
      if (data) {
        setForm({
          name: data.name ?? '',
          slug: (data as any).slug ?? '',
          affiliate_venue_id: data.affiliate_venue_id ?? '',
          day_of_week: data.day_of_week ?? 5,
          advance_days: data.advance_days ?? 7,
          start_time: data.start_time ?? '23:00',
          end_time: data.end_time ?? '06:00',
          price_from: data.price_from?.toString() ?? '',
          is_free: data.is_free ?? false,
          is_active: data.is_active ?? true,
          flyer_url: (data as any).flyer_url ?? null,
          genres: data.genres ?? [],
          publication_url: (data as any).publication_url ?? '',
        });
      }
    }
    setLoadingData(false);
  };

  const set = <K extends keyof FormData>(field: K, value: FormData[K]) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const toggleGenre = (g: string) =>
    set('genres', form.genres.includes(g) ? form.genres.filter((x) => x !== g) : [...form.genres, g]);

  const toggleBulkDay = (day: number) =>
    setBulkSelectedDays((prev) => prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]);

  const handleSave = async (): Promise<boolean> => {
    if (!affiliateId) return false;

    if (bulkMode && !isEdit) {
      if (!form.affiliate_venue_id) { toast({ title: 'Sélectionne un club', variant: 'destructive' }); return false; }
      if (bulkSelectedDays.length === 0) { toast({ title: 'Sélectionne au moins un jour', variant: 'destructive' }); return false; }
      setSaving(true);
      const clubName = venues.find((v) => v.id === form.affiliate_venue_id)?.name ?? 'Club';
      const errors: string[] = [];
      for (const day of bulkSelectedDays) {
        const dayName = DAYS[day];
        const payload = {
          affiliate_id: affiliateId,
          affiliate_venue_id: form.affiliate_venue_id,
          name: `${clubName} ${dayName}`,
          slug: `${slugify(clubName)}-${dayName.toLowerCase()}`,
          day_of_week: day,
          advance_days: form.advance_days,
          start_time: form.start_time || null,
          end_time: form.end_time || null,
          price_from: form.price_from ? parseFloat(form.price_from) : null,
          is_free: form.is_free,
          is_active: form.is_active,
          flyer_url: form.flyer_url,
          genres: form.genres,
          publication_url: form.publication_url || null,
        };
        const { error } = await supabase.from('affiliate_recurring_templates').insert(payload);
        if (error) errors.push(`${dayName}: ${error.message}`);
      }
      setSaving(false);
      if (errors.length > 0) {
        toast({ title: 'Erreurs', description: errors.join(' · '), variant: 'destructive' });
        return false;
      }
      await supabase.functions.invoke('create-affiliate-recurring-events');
      markSaved();
      toast({ title: `${bulkSelectedDays.length} template(s) créé(s) — soirées publiées` });
      // Le mode groupé crée PLUSIEURS templates d'un coup : il n'y a pas de
      // « la » fiche sur laquelle rester, la liste est la bonne destination.
      navigate('/affiliate/recurring');
      return true;
    }

    if (!form.name) { toast({ title: 'Nom requis', variant: 'destructive' }); return false; }
    setSaving(true);
    try {
      const slug = form.slug || slugify(form.name);
      const payload = {
        affiliate_id: affiliateId,
        affiliate_venue_id: form.affiliate_venue_id || null,
        name: form.name,
        slug,
        day_of_week: form.day_of_week,
        advance_days: form.advance_days,
        start_time: form.start_time || null,
        end_time: form.end_time || null,
        price_from: form.price_from ? parseFloat(form.price_from) : null,
        is_free: form.is_free,
        is_active: form.is_active,
        flyer_url: form.flyer_url,
        genres: form.genres,
        publication_url: form.publication_url || null,
      };

      const saved: FormData = { ...form, slug };
      let createdId: string | null = null;

      if (isEdit && id) {
        const { error } = await supabase.from('affiliate_recurring_templates').update(payload).eq('id', id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('affiliate_recurring_templates').insert(payload).select('id').single();
        if (error) throw error;
        createdId = data?.id ?? null;
      }

      await supabase.functions.invoke('create-affiliate-recurring-events');

      setForm(saved);
      markSaved({ form: saved, bulkMode, bulkSelectedDays });
      toast({ title: isEdit ? 'Template mis à jour — soirées synchronisées' : 'Template créé — soirées publiées' });
      // On RESTE sur le template : après édition rien ne bouge, après création
      // on bascule en mode édition sur place.
      if (createdId) navigate(`/affiliate/recurring/${createdId}/edit`, { replace: true });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur';
      toast({ title: 'Erreur', description: msg, variant: 'destructive' });
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Le mode groupé fait partie de l'état à protéger : le jour sélectionné et le
  // club choisi disparaissaient avec le reste au moindre changement d'onglet.
  const guardValue = { form, bulkMode, bulkSelectedDays };
  const { markSaved, guardedNavigate } = useUnsavedGuard({
    scope: `affiliate-recurring:${id ?? 'new'}`,
    label: isEdit ? 'Template récurrent' : 'Nouveau template',
    ready: !loadingData && Boolean(affiliateId),
    value: guardValue,
    onRestore: (v) => { setForm(v.form); setBulkMode(v.bulkMode); setBulkSelectedDays(v.bulkSelectedDays); },
    onSave: handleSave,
  });

  if (loadingData) return <AffSpinner />;

  if (!affiliateId) {
    return <AffPage maxWidth={760}><p style={{ color: T2 }}>Profil affilié introuvable.</p></AffPage>;
  }

  return (
    <AffPage maxWidth={760}>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <AffBackHeader title={isEdit ? 'Modifier le template' : 'Nouveau template récurrent'} onBack={() => guardedNavigate('/affiliate/recurring')} />
      </motion.div>

      {/* Bulk mode toggle — création uniquement */}
      {!isEdit && (
        <AffCard padding={16}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-none" style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}>
              <Zap className="w-4 h-4" style={{ color: RED }} />
            </div>
            <div className="flex-1 min-w-0">
              <p style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>Créer pour plusieurs jours à la fois</p>
              <p style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>Génère un template par jour sélectionné : <em>Nom du club + Jour</em></p>
            </div>
            <Toggle checked={bulkMode} onChange={() => setBulkMode(!bulkMode)} />
          </div>
        </AffCard>
      )}

      {/* Template info */}
      <AffCard padding={20}>
        <AffCardHeader icon={RefreshCw} title="Template" />
        <div className="space-y-4">
          <div>
            <FieldLabel>Club {bulkMode && !isEdit ? '*' : ''}</FieldLabel>
            <DarkSelect value={form.affiliate_venue_id} onChange={(v) => set('affiliate_venue_id', v)}>
              <option value="">— Sélectionner un club —</option>
              {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </DarkSelect>
          </div>

          {bulkMode && !isEdit ? (
            <div>
              <FieldLabel>Jours à créer</FieldLabel>
              <div className="flex flex-wrap gap-2">
                {BULK_DAYS.map((dayIdx) => (
                  <ChoiceChip key={dayIdx} active={bulkSelectedDays.includes(dayIdx)} onClick={() => toggleBulkDay(dayIdx)}>
                    {DAYS[dayIdx].slice(0, 3)}
                  </ChoiceChip>
                ))}
              </div>
              {form.affiliate_venue_id && bulkSelectedDays.length > 0 && (
                <div className="mt-3 space-y-1 rounded-lg p-3" style={{ background: TILE_BG, border: `1px solid ${F_BORDER}` }}>
                  {[...bulkSelectedDays].sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b)).map((dayIdx) => {
                    const clubName = venues.find((v) => v.id === form.affiliate_venue_id)?.name ?? 'Club';
                    return <p key={dayIdx} style={{ color: T3, fontSize: 11.5 }}>→ {clubName} {DAYS[dayIdx]}</p>;
                  })}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FieldLabel>Nom *</FieldLabel>
                  <DarkInput value={form.name} onChange={(v) => { set('name', v); if (!isEdit) set('slug', slugify(v)); }} placeholder="Club de los Viernes" />
                </div>
                <div>
                  <FieldLabel>Slug</FieldLabel>
                  <DarkInput value={form.slug} onChange={(v) => set('slug', v)} placeholder="club-viernes" />
                </div>
              </div>
              <div>
                <FieldLabel>Jour de la semaine</FieldLabel>
                <DarkSelect value={String(form.day_of_week)} onChange={(v) => set('day_of_week', parseInt(v))}>
                  {DAYS.map((day, i) => <option key={i} value={i}>{day}</option>)}
                </DarkSelect>
              </div>
            </>
          )}

          {/* Horaires */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel>Ouverture</FieldLabel>
              <input type="time" value={form.start_time} onChange={(e) => set('start_time', e.target.value)} style={timeInputStyle} />
            </div>
            <div>
              <FieldLabel>Fermeture</FieldLabel>
              <input type="time" value={form.end_time} onChange={(e) => set('end_time', e.target.value)} style={timeInputStyle} />
            </div>
          </div>

          {/* Prix */}
          <div className="grid grid-cols-3 gap-4 items-end">
            <div>
              <FieldLabel>Prix à partir de (€)</FieldLabel>
              <DarkInput type="number" value={form.price_from} onChange={(v) => set('price_from', v)} placeholder="10" />
            </div>
            <div className="pb-2.5"><CheckBox checked={form.is_free} onChange={(v) => set('is_free', v)} label="Gratuit" /></div>
            <div>
              <FieldLabel>Générer X jours avant</FieldLabel>
              <DarkInput type="number" value={String(form.advance_days)} onChange={(v) => set('advance_days', parseInt(v) || 7)} />
            </div>
          </div>

          {/* Lien de publication */}
          <div>
            <FieldLabel>Lien de publication (billetterie / page événement)</FieldLabel>
            <DarkInput type="url" value={form.publication_url} onChange={(v) => set('publication_url', v)} placeholder="https://shotgun.live/events/ma-soiree" />
            <p style={{ color: T3, fontSize: 11, marginTop: 6 }}>Sera ajouté automatiquement à chaque soirée générée. Modifiable sur chaque occurrence.</p>
          </div>

          {/* is_active toggle */}
          <div className="flex items-center gap-3">
            <Toggle checked={form.is_active} onChange={() => set('is_active', !form.is_active)} />
            <span style={{ color: T2, fontSize: 13 }}>{form.is_active ? 'Actif — génère des soirées automatiquement' : 'Inactif — aucune génération'}</span>
          </div>
        </div>
      </AffCard>

      {/* Genres */}
      <AffCard padding={20}>
        <AffCardHeader title="Genres" />
        <div className="flex flex-wrap gap-2">
          {GENRES.map((g) => <ChoiceChip key={g} active={form.genres.includes(g)} onClick={() => toggleGenre(g)}>{g}</ChoiceChip>)}
        </div>
      </AffCard>

      {/* Flyer par défaut */}
      <AffCard padding={20}>
        <AffCardHeader icon={ImageIcon} title="Flyer par défaut" subtitle="Utilisé pour chaque occurrence générée" />
        <AffiliateImageUploader affiliateId={affiliateId} value={form.flyer_url} onChange={(url) => set('flyer_url', url)}
          folder="recurring/flyers" hint="Format portrait recommandé" />
      </AffCard>

      {/* Preview occurrences — mode single uniquement */}
      {(!bulkMode || isEdit) && <NextOccurrencesPreview dayOfWeek={form.day_of_week} advanceDays={form.advance_days} />}

      <div className="flex gap-3 pb-8">
        <AffButton onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {saving
            ? (bulkMode && !isEdit ? `Création de ${bulkSelectedDays.length} templates…` : 'Enregistrement…')
            : isEdit
              ? 'Enregistrer'
              : bulkMode
                ? `Créer ${bulkSelectedDays.length} template${bulkSelectedDays.length !== 1 ? 's' : ''}`
                : 'Créer le template'}
        </AffButton>
        <AffButton variant="ghost" onClick={() => guardedNavigate('/affiliate/recurring')}>Annuler</AffButton>
      </div>
    </AffPage>
  );
}
