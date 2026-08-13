import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { useUnsavedGuard } from '@/hooks/useUnsavedGuard';
import { Loader2, Zap, RefreshCw, Sparkles, ImageIcon, CopyCheck } from 'lucide-react';
import { AffiliateImageUploader } from '@/components/affiliate/AffiliateImageUploader';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  AffPage, AffBackHeader, AffCard, AffCardHeader, AffButton, ChoiceChip, CheckBox, Toggle, AffSpinner,
  FieldLabel, DarkInput, DarkSelect,
  RED, POS, WARN, T1, T2, T3, BORDER, INNER_BG, TILE_BG, F_BORDER,
} from '@/components/affiliate/affiliate-ui';
import { MUSIC_GENRES, canonicalGenres } from '@/lib/musicGenres';

// DAYS reste en français : ces libellés sont ÉCRITS EN BASE (nom + slug des
// templates créés en mode groupé). Les traduire ferait dériver les données
// selon la langue d'affichage (et casserait les slugs avec les accents es).
// L'affichage passe par les clés i18n via DAY_KEYS.
const DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const BULK_DAYS = [1, 2, 3, 4, 5, 6, 0]; // Lun → Dim

const GENRES = MUSIC_GENRES;

function slugify(text: string) {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const timeInputStyle: React.CSSProperties = {
  background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10,
  padding: '9px 12px', color: 'rgba(255,255,255,0.96)', fontSize: 13.5, fontFamily: 'inherit', width: '100%',
  colorScheme: 'dark',
};

// Occurrences à venir de ce jour de semaine, depuis aujourd'hui inclus (aligné
// sur le générateur create-affiliate-recurring-events). Jusqu'à 10 d'avance :
// le RP publie le lien de chaque date quand il veut, pas forcément semaine
// après semaine.
function getNextOccurrences(dayOfWeek: number, count = 10): Date[] {
  const dates: Date[] = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + ((dayOfWeek - d.getDay() + 7) % 7)); // 1re occurrence >= aujourd'hui
  while (dates.length < count) {
    dates.push(new Date(d));
    d.setDate(d.getDate() + 7);
  }
  return dates;
}

// Date locale en 'yyyy-mm-dd' (pas toISOString, qui décale d'un jour selon le
// fuseau) : c'est la clé exacte d'une occurrence dans affiliate_events.
function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

type OccEvent = { id: string; external_ticket_url: string | null; status: string; is_sold_out: boolean; event_date: string };

type TplSnapshot = {
  name: string; affiliate_venue_id: string; start_time: string; end_time: string;
  price_from: string; is_free: boolean; genres: string[]; flyer_url: string | null;
  has_tables: boolean; tables_only: boolean; has_guest_list: boolean; guest_list_type: string;
};

// --- Report d'une modif du modèle sur les soirées déjà créées ---------------
//
// Le générateur ne copie ces champs qu'à la CRÉATION d'une occurrence : changer
// le prix ou la guest list sur le modèle laissait les 10 brouillons d'avance sur
// les anciennes valeurs, à corriger un par un. Après chaque enregistrement, on
// compare le modèle à son état d'avant et on propose de reporter ce qui a bougé.
//
// Sont volontairement HORS de cette liste : le jour de semaine (il déplace les
// dates, ce n'est pas une valeur qu'on recopie), l'horizon, l'activation, et
// toute la mécanique de lien billetterie — le lien et le statut d'une soirée
// gardent leurs propres règles (verrou link_gate + ticket_url_overridden).
// Le flyer en est aussi absent : le générateur le resynchronise déjà seul à
// chaque passage, poser la question n'aurait aucun sens.
const PROPAGATABLE = [
  'name', 'affiliate_venue_id', 'start_time', 'end_time',
  'price_from', 'is_free', 'genres',
  'has_tables', 'tables_only', 'has_guest_list', 'guest_list_type',
] as const;
type PropField = typeof PROPAGATABLE[number];

const PROP_FIELD_KEY: Record<PropField, string> = {
  name: 'aff.recurringForm.propField.name',
  affiliate_venue_id: 'aff.recurringForm.propField.venue',
  start_time: 'aff.recurringForm.propField.startTime',
  end_time: 'aff.recurringForm.propField.endTime',
  price_from: 'aff.recurringForm.propField.price',
  is_free: 'aff.recurringForm.propField.free',
  genres: 'aff.recurringForm.propField.genres',
  has_tables: 'aff.recurringForm.propField.tables',
  tables_only: 'aff.recurringForm.propField.tablesOnly',
  has_guest_list: 'aff.recurringForm.propField.guestList',
  guest_list_type: 'aff.recurringForm.propField.guestListType',
};

// Le formulaire tient des chaînes ; affiliate_events tient des colonnes typées.
// On traduit ici une fois pour toutes — c'est la valeur comparée ET la valeur
// écrite, donc les deux ne peuvent pas diverger.
type OccValues = {
  name: string;
  affiliate_venue_id: string | null;
  start_time: string | null;
  end_time: string | null;
  price_from: number | null;
  is_free: boolean;
  genres: string[];
  has_tables: boolean;
  tables_only: boolean;
  has_guest_list: boolean;
  guest_list_type: string;
};

function occurrenceValues(f: FormData): OccValues {
  return {
    name: f.name,
    affiliate_venue_id: f.affiliate_venue_id || null,
    start_time: f.start_time || null,
    end_time: f.end_time || null,
    price_from: f.price_from ? parseFloat(f.price_from) : null,
    is_free: f.is_free,
    genres: f.genres,
    // Même normalisation que le payload du modèle : « uniquement des tables »
    // implique « des tables ».
    has_tables: f.has_tables || f.tables_only,
    tables_only: f.tables_only,
    has_guest_list: f.has_guest_list,
    guest_list_type: f.guest_list_type,
  };
}

function changedFields(before: OccValues, after: OccValues): PropField[] {
  return PROPAGATABLE.filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null));
}

// Sous-ensemble des champs qui ont bougé — le reste de l'occurrence, y compris
// ce qu'on y a personnalisé à la main, n'est pas touché.
function pickFields(values: OccValues, fields: PropField[]): Partial<OccValues> {
  const out: Partial<OccValues> = {};
  for (const k of fields) (out as Record<string, unknown>)[k] = values[k];
  return out;
}

type PropagatePrompt = {
  fields: PropField[];
  values: Partial<OccValues>;
  ids: string[];
  drafts: number;
  live: number;
};

// Aperçu lecture seule (mode création) : le modèle n'existe pas encore, on
// montre juste les 10 prochaines dates + l'invite à enregistrer d'abord.
function NextOccurrencesPreview({ dayOfWeek }: { dayOfWeek: number }) {
  const { t, language } = useLanguage();
  const localeTag = language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-US';
  const dates = getNextOccurrences(dayOfWeek);
  return (
    <AffCard padding={18}>
      <AffCardHeader icon={Sparkles} title={t('aff.recurringForm.nextOccurrences')} subtitle={t('aff.recurringForm.nextOccurrencesSub')} accent />
      <div className="rounded-lg p-3 mb-3" style={{ background: 'rgba(232,25,44,0.06)', border: '1px solid rgba(232,25,44,0.2)' }}>
        <p style={{ color: T2, fontSize: 11.5, lineHeight: 1.5 }}>{t('aff.recurringForm.occSaveFirst')}</p>
      </div>
      <ul className="space-y-1.5">
        {dates.map((d, i) => (
          <li key={i} className="flex items-center gap-2 py-1" style={{ borderBottom: i < dates.length - 1 ? `1px solid ${F_BORDER}` : 'none' }}>
            <span className="capitalize" style={{ color: T1, fontSize: 12.5, fontWeight: 540 }}>
              {d.toLocaleDateString(localeTag, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          </li>
        ))}
      </ul>
    </AffCard>
  );
}

// Publieur par jour (mode édition) : chaque prochaine soirée sur sa propre
// carte, avec son lien billetterie propre. Poser un lien crée/publie
// l'occurrence (ticket_url_overridden = le générateur ne la touche plus, le
// lien n'expire jamais) ; vider le lien rend la main au modèle.
function NextOccurrencesPublisher({ templateId, dayOfWeek, affiliateId, tpl }: {
  templateId: string; dayOfWeek: number; affiliateId: string; tpl: TplSnapshot;
}) {
  const { t, language } = useLanguage();
  const { toast } = useToast();
  const localeTag = language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-US';
  const dates = getNextOccurrences(dayOfWeek, 10);
  const dateStrs = dates.map(toDateStr);

  const [loading, setLoading] = useState(true);
  const [byDate, setByDate] = useState<Record<string, OccEvent>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingDate, setSavingDate] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('affiliate_events')
        .select('id, external_ticket_url, status, is_sold_out, event_date')
        .eq('recurring_template_id', templateId)
        .in('event_date', dateStrs);
      if (cancelled) return;
      const map: Record<string, OccEvent> = {};
      const init: Record<string, string> = {};
      for (const ev of (data ?? []) as OccEvent[]) {
        map[ev.event_date] = ev;
        init[ev.event_date] = ev.external_ticket_url ?? '';
      }
      setByDate(map);
      setDrafts((prev) => ({ ...prev, ...init }));
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // dateStrs est dérivé de dayOfWeek ; on resynchronise si le jour change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, dayOfWeek]);

  const reload = async () => {
    const { data } = await supabase
      .from('affiliate_events')
      .select('id, external_ticket_url, status, is_sold_out, event_date')
      .eq('recurring_template_id', templateId)
      .in('event_date', dateStrs);
    const map: Record<string, OccEvent> = {};
    const fresh: Record<string, string> = {};
    for (const ev of (data ?? []) as OccEvent[]) {
      map[ev.event_date] = ev;
      fresh[ev.event_date] = ev.external_ticket_url ?? '';
    }
    setByDate(map);
    setDrafts((prev) => ({ ...prev, ...fresh }));
  };

  const publish = async (dateStr: string) => {
    const url = (drafts[dateStr] ?? '').trim() || null;
    setSavingDate(dateStr);
    try {
      // Ré-vérifier l'existence par (modèle, date) juste avant d'écrire :
      // le cron a pu créer un brouillon depuis le chargement. Évite un doublon.
      const { data: existing } = await supabase
        .from('affiliate_events')
        .select('id')
        .eq('recurring_template_id', templateId)
        .eq('event_date', dateStr)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from('affiliate_events')
          .update({ external_ticket_url: url })
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        if (!url) { setSavingDate(null); return; } // rien à publier
        // Slug unique (même base que le générateur), résolution de conflit.
        const base = slugify(`${tpl.name} ${dateStr}`);
        let slug = base;
        let attempt = 0;
        while (attempt < 6) {
          const { data: conflict } = await supabase.from('affiliate_events').select('id').eq('slug', slug).maybeSingle();
          if (!conflict) break;
          attempt++;
          slug = `${base}-${attempt}`;
        }
        const { error } = await supabase.from('affiliate_events').insert({
          affiliate_id: affiliateId,
          affiliate_venue_id: tpl.affiliate_venue_id || null,
          name: tpl.name,
          slug,
          event_date: dateStr,
          start_time: tpl.start_time || null,
          end_time: tpl.end_time || null,
          price_from: tpl.price_from ? parseFloat(tpl.price_from) : null,
          is_free: tpl.is_free,
          genres: tpl.genres,
          flyer_url: tpl.flyer_url,
          external_ticket_url: url,
          status: 'published', // le trigger link_gate l'impose de toute façon
          recurring_template_id: templateId,
          // Le trigger d'override ne se déclenche pas à l'INSERT : on marque
          // explicitement pour que le générateur respecte ce lien à jamais.
          ticket_url_overridden: true,
          has_tables: tpl.has_tables || tpl.tables_only,
          tables_only: tpl.tables_only,
          has_guest_list: tpl.has_guest_list,
          guest_list_type: tpl.guest_list_type,
        });
        if (error) throw error;
      }
      await reload();
      toast({ title: url ? t('aff.recurringForm.occSavedToast') : t('aff.recurringForm.occClearedToast') });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('aff.recurringForm.occErrorToast');
      toast({ title: t('aff.recurringForm.occErrorToast'), description: msg, variant: 'destructive' });
    } finally {
      setSavingDate(null);
    }
  };

  const rowStatus = (dateStr: string): { key: string; color: string } => {
    const ev = byDate[dateStr];
    if (!ev) return { key: 'aff.recurringForm.occToPublish', color: T3 };
    if (ev.is_sold_out) return { key: 'aff.recurringForm.occSoldOut', color: RED };
    if (ev.external_ticket_url && (ev.status === 'published' || ev.status === 'featured')) return { key: 'aff.recurringForm.occLive', color: POS };
    return { key: 'aff.recurringForm.occDraft', color: WARN };
  };

  return (
    <AffCard padding={18}>
      <AffCardHeader icon={Sparkles} title={t('aff.recurringForm.nextOccurrences')} subtitle={t('aff.recurringForm.nextOccurrencesSub')} accent />
      {loading ? (
        <p style={{ color: T3, fontSize: 12 }}>{t('aff.recurringForm.occLoading')}</p>
      ) : (
        <div className="space-y-2.5">
          {dates.map((d, i) => {
            const dateStr = dateStrs[i];
            const st = rowStatus(dateStr);
            const ev = byDate[dateStr];
            const dirty = (drafts[dateStr] ?? '') !== (ev?.external_ticket_url ?? '');
            return (
              <div key={dateStr} className="rounded-xl p-3" style={{ background: TILE_BG, border: `1px solid ${F_BORDER}`, borderLeft: `3px solid ${st.color}` }}>
                <div className="flex items-center gap-3">
                  <div className="flex flex-col items-center justify-center w-11 h-11 rounded-lg flex-none" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                    <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: T3 }}>{d.toLocaleDateString(localeTag, { weekday: 'short' })}</span>
                    <span className="tabular-nums" style={{ fontSize: 15, fontWeight: 700, color: T1, lineHeight: 1 }}>{d.getDate()}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="capitalize truncate" style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{d.toLocaleDateString(localeTag, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: st.color, display: 'inline-block' }} />
                      <span style={{ fontSize: 11, color: T3 }}>{t(st.key)}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-2.5">
                  <div className="flex-1 min-w-0">
                    <DarkInput type="url" value={drafts[dateStr] ?? ''} onChange={(v) => setDrafts((prev) => ({ ...prev, [dateStr]: v }))} placeholder={t('aff.recurringForm.occPlaceholder')} />
                  </div>
                  <AffButton size="sm" onClick={() => publish(dateStr)} disabled={savingDate === dateStr || !dirty}>
                    {savingDate === dateStr ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : (ev?.external_ticket_url ? t('aff.recurringForm.occUpdate') : t('aff.recurringForm.occPublish'))}
                  </AffButton>
                </div>
              </div>
            );
          })}
        </div>
      )}
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
  publication_url_is_permanent: boolean;
  has_tables: boolean;
  tables_only: boolean;
  has_guest_list: boolean;
  guest_list_type: 'mixed' | 'women';
};

const EMPTY: FormData = {
  name: '', slug: '', affiliate_venue_id: '', day_of_week: 5,
  advance_days: 7, start_time: '23:00', end_time: '06:00',
  price_from: '', is_free: false, is_active: true, flyer_url: null, genres: [],
  publication_url: '', publication_url_is_permanent: false,
  has_tables: false, tables_only: false, has_guest_list: false, guest_list_type: 'mixed',
};

export default function AffiliateRecurringForm() {
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

  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelectedDays, setBulkSelectedDays] = useState<number[]>([1, 2, 3, 4, 5, 6]);

  // État du modèle tel qu'il est EN BASE, pour savoir ce qui a bougé au save.
  // Remis à jour après chaque enregistrement (report accepté ou non) : on ne
  // repropose jamais deux fois le même changement.
  const savedOccValues = useRef<OccValues | null>(null);
  const [propagate, setPropagate] = useState<PropagatePrompt | null>(null);
  const [propagating, setPropagating] = useState(false);

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
        .from('affiliate_recurring_templates')
        .select('*')
        .eq('id', id)
        .eq('affiliate_id', aff.id)
        .single();
      if (data) {
        const loaded: FormData = {
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
          // Anciens libellés ramenés sur les puces réelles (cf. musicGenres.ts).
          genres: canonicalGenres(data.genres),
          publication_url: (data as any).publication_url ?? '',
          publication_url_is_permanent: (data as any).publication_url_is_permanent ?? false,
          has_tables: (data as any).has_tables ?? false,
          tables_only: (data as any).tables_only ?? false,
          has_guest_list: (data as any).has_guest_list ?? false,
          guest_list_type: ((data as any).guest_list_type === 'women' ? 'women' : 'mixed'),
        };
        setForm(loaded);
        savedOccValues.current = occurrenceValues(loaded);
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

  // `askPropagate` n'est vrai que depuis le bouton Enregistrer : quand le garde
  // des modifications non enregistrées sauvegarde en partant, on ne va pas
  // ouvrir une question sur une page qu'on quitte.
  const handleSave = async ({ askPropagate = false }: { askPropagate?: boolean } = {}): Promise<boolean> => {
    if (!affiliateId) return false;

    if (bulkMode && !isEdit) {
      if (!form.affiliate_venue_id) { toast({ title: t('aff.recurringForm.selectVenueToast'), variant: 'destructive' }); return false; }
      if (bulkSelectedDays.length === 0) { toast({ title: t('aff.recurringForm.selectDayToast'), variant: 'destructive' }); return false; }
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
          publication_url_is_permanent: form.publication_url_is_permanent,
          has_tables: form.has_tables || form.tables_only,
          tables_only: form.tables_only,
          has_guest_list: form.has_guest_list,
          guest_list_type: form.guest_list_type,
        };
        const { error } = await supabase.from('affiliate_recurring_templates').insert(payload);
        if (error) errors.push(`${dayName}: ${error.message}`);
      }
      setSaving(false);
      if (errors.length > 0) {
        toast({ title: t('aff.recurringForm.errorsTitle'), description: errors.join(' · '), variant: 'destructive' });
        return false;
      }
      await supabase.functions.invoke('create-affiliate-recurring-events');
      markSaved();
      toast({ title: t('aff.recurringForm.bulkCreatedToast').replace('{count}', String(bulkSelectedDays.length)) });
      // Le mode groupé crée PLUSIEURS templates d'un coup : il n'y a pas de
      // « la » fiche sur laquelle rester, la liste est la bonne destination.
      navigate('/affiliate/recurring');
      return true;
    }

    if (!form.name) { toast({ title: t('aff.recurringForm.nameRequired'), variant: 'destructive' }); return false; }
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
        publication_url_is_permanent: form.publication_url_is_permanent,
        has_tables: form.has_tables || form.tables_only,
        tables_only: form.tables_only,
        has_guest_list: form.has_guest_list,
        guest_list_type: form.guest_list_type,
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

      // Ce qui a changé sur le modèle depuis la dernière écriture en base. La
      // référence est remise à jour tout de suite : que le report soit accepté
      // ou refusé, ce changement est traité, on ne le repropose plus.
      const after = occurrenceValues(saved);
      const changed = isEdit && savedOccValues.current ? changedFields(savedOccValues.current, after) : [];
      savedOccValues.current = after;

      setForm(saved);
      markSaved({ form: saved, bulkMode, bulkSelectedDays });
      toast({ title: isEdit ? t('aff.recurringForm.updatedToast') : t('aff.recurringForm.createdToast') });

      // Le générateur vient de tourner : les soirées relues ici incluent celles
      // qu'il vient de créer (déjà à jour — les réécrire ne coûte rien).
      if (askPropagate && isEdit && id && changed.length > 0) {
        const { data: occ } = await supabase
          .from('affiliate_events')
          .select('id, status')
          .eq('recurring_template_id', id)
          .gte('event_date', toDateStr(new Date()));
        const rows = occ ?? [];
        if (rows.length > 0) {
          setPropagate({
            fields: changed,
            values: pickFields(after, changed),
            ids: rows.map((r) => r.id),
            drafts: rows.filter((r) => r.status === 'draft').length,
            live: rows.filter((r) => r.status !== 'draft').length,
          });
        }
      }
      // On RESTE sur le template : après édition rien ne bouge, après création
      // on bascule en mode édition sur place.
      if (createdId) navigate(`/affiliate/recurring/${createdId}/edit`, { replace: true });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('aff.recurringForm.errorTitle');
      toast({ title: t('aff.recurringForm.errorTitle'), description: msg, variant: 'destructive' });
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Report du changement sur les soirées déjà créées. On n'écrit QUE les champs
  // qui ont bougé : une soirée personnalisée à la main garde tout le reste. Le
  // lien billetterie et le statut ne sont jamais dans le lot, donc le verrou
  // link_gate ne rebascule rien et une soirée en ligne le reste.
  const applyPropagation = async () => {
    if (!propagate) return;
    setPropagating(true);
    try {
      const { error } = await supabase
        .from('affiliate_events')
        .update(propagate.values)
        .in('id', propagate.ids);
      if (error) throw error;
      toast({ title: t('aff.recurringForm.propDoneToast').replace('{count}', String(propagate.ids.length)) });
      setPropagate(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('aff.recurringForm.propErrorToast');
      toast({ title: t('aff.recurringForm.propErrorToast'), description: msg, variant: 'destructive' });
    } finally {
      setPropagating(false);
    }
  };

  // Le mode groupé fait partie de l'état à protéger : le jour sélectionné et le
  // club choisi disparaissaient avec le reste au moindre changement d'onglet.
  const guardValue = { form, bulkMode, bulkSelectedDays };
  const { markSaved, guardedNavigate } = useUnsavedGuard({
    scope: `affiliate-recurring:${id ?? 'new'}`,
    label: isEdit ? t('aff.recurringForm.guardEdit') : t('aff.recurringForm.guardNew'),
    ready: !loadingData && Boolean(affiliateId),
    value: guardValue,
    onRestore: (v) => { setForm(v.form); setBulkMode(v.bulkMode); setBulkSelectedDays(v.bulkSelectedDays); },
    onSave: () => handleSave(),
  });

  if (loadingData) return <AffSpinner />;

  if (!affiliateId) {
    return <AffPage maxWidth={760}><p style={{ color: T2 }}>{t('aff.recurringForm.profileNotFound')}</p></AffPage>;
  }

  return (
    <AffPage maxWidth={760}>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <AffBackHeader title={isEdit ? t('aff.recurringForm.editTitle') : t('aff.recurringForm.newTitle')} onBack={() => guardedNavigate('/affiliate/recurring')} />
      </motion.div>

      {/* Bulk mode toggle — création uniquement */}
      {!isEdit && (
        <AffCard padding={16}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-none" style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}>
              <Zap className="w-4 h-4" style={{ color: RED }} />
            </div>
            <div className="flex-1 min-w-0">
              <p style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{t('aff.recurringForm.bulkTitle')}</p>
              <p style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>{t('aff.recurringForm.bulkDesc')} <em>{t('aff.recurringForm.bulkDescPattern')}</em></p>
            </div>
            <Toggle checked={bulkMode} onChange={() => setBulkMode(!bulkMode)} />
          </div>
        </AffCard>
      )}

      {/* Template info */}
      <AffCard padding={20}>
        <AffCardHeader icon={RefreshCw} title={t('aff.recurringForm.templateCard')} />
        <div className="space-y-4">
          <div>
            <FieldLabel>{t('aff.recurringForm.clubLabel')} {bulkMode && !isEdit ? '*' : ''}</FieldLabel>
            <DarkSelect value={form.affiliate_venue_id} onChange={(v) => set('affiliate_venue_id', v)}>
              <option value="">{t('aff.recurringForm.selectVenue')}</option>
              {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </DarkSelect>
          </div>

          {bulkMode && !isEdit ? (
            <div>
              <FieldLabel>{t('aff.recurringForm.daysToCreate')}</FieldLabel>
              <div className="flex flex-wrap gap-2">
                {BULK_DAYS.map((dayIdx) => (
                  <ChoiceChip key={dayIdx} active={bulkSelectedDays.includes(dayIdx)} onClick={() => toggleBulkDay(dayIdx)}>
                    {t(`aff.recurringForm.dayShort.${DAY_KEYS[dayIdx]}`)}
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
                  <FieldLabel>{t('aff.recurringForm.nameLabel')}</FieldLabel>
                  <DarkInput value={form.name} onChange={(v) => { set('name', v); if (!isEdit) set('slug', slugify(v)); }} placeholder="Club de los Viernes" />
                </div>
                <div>
                  <FieldLabel>{t('aff.recurringForm.slugLabel')}</FieldLabel>
                  <DarkInput value={form.slug} onChange={(v) => set('slug', v)} placeholder="club-viernes" />
                </div>
              </div>
              <div>
                <FieldLabel>{t('aff.recurringForm.dayOfWeekLabel')}</FieldLabel>
                <DarkSelect value={String(form.day_of_week)} onChange={(v) => set('day_of_week', parseInt(v))}>
                  {DAY_KEYS.map((k, i) => <option key={i} value={i}>{t(`aff.recurringForm.dayFull.${k}`)}</option>)}
                </DarkSelect>
              </div>
            </>
          )}

          {/* Horaires */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel>{t('aff.recurringForm.openLabel')}</FieldLabel>
              <input type="time" value={form.start_time} onChange={(e) => set('start_time', e.target.value)} style={timeInputStyle} />
            </div>
            <div>
              <FieldLabel>{t('aff.recurringForm.closeLabel')}</FieldLabel>
              <input type="time" value={form.end_time} onChange={(e) => set('end_time', e.target.value)} style={timeInputStyle} />
            </div>
          </div>

          {/* Prix */}
          <div className="grid grid-cols-3 gap-4 items-end">
            <div>
              <FieldLabel>{t('aff.recurringForm.priceFromLabel')}</FieldLabel>
              <DarkInput type="number" value={form.price_from} onChange={(v) => set('price_from', v)} placeholder="10" />
            </div>
            <div className="pb-2.5"><CheckBox checked={form.is_free} onChange={(v) => set('is_free', v)} label={t('aff.recurringForm.free')} /></div>
            <div>
              <FieldLabel>{t('aff.recurringForm.advanceDaysLabel')}</FieldLabel>
              <DarkInput type="number" value={String(form.advance_days)} onChange={(v) => set('advance_days', parseInt(v) || 7)} />
            </div>
          </div>

          {/* Lien de publication */}
          <div>
            <FieldLabel>{t('aff.recurringForm.publicationUrlLabel')}</FieldLabel>
            <DarkInput type="url" value={form.publication_url} onChange={(v) => set('publication_url', v)} placeholder="https://shotgun.live/events/ma-soiree" />
            <p style={{ color: T3, fontSize: 11, marginTop: 6 }}>{t('aff.recurringForm.publicationUrlHelp')}</p>
            <div className="mt-3"><CheckBox checked={form.publication_url_is_permanent} onChange={(v) => set('publication_url_is_permanent', v)} label={t('aff.recurringForm.permanentLinkLabel')} /></div>
            <p style={{ color: T3, fontSize: 11, marginTop: 6 }}>{t('aff.recurringForm.permanentLinkHelp')}</p>

            {/* Offre de la soirée : tables VIP / guest list — copiée sur chaque
                occurrence générée, ajustable ensuite soirée par soirée. */}
            <div className="mt-5">
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
              <p style={{ color: T3, fontSize: 11, marginTop: 6 }}>{t('aff.offer.help')}</p>
            </div>
          </div>

          {/* is_active toggle */}
          <div className="flex items-center gap-3">
            <Toggle checked={form.is_active} onChange={() => set('is_active', !form.is_active)} />
            <span style={{ color: T2, fontSize: 13 }}>{form.is_active ? t('aff.recurringForm.activeOn') : t('aff.recurringForm.activeOff')}</span>
          </div>
        </div>
      </AffCard>

      {/* Genres */}
      <AffCard padding={20}>
        <AffCardHeader title={t('aff.recurringForm.genresLabel')} />
        <div className="flex flex-wrap gap-2">
          {GENRES.map((g) => <ChoiceChip key={g} active={form.genres.includes(g)} onClick={() => toggleGenre(g)}>{g}</ChoiceChip>)}
        </div>
      </AffCard>

      {/* Flyer par défaut */}
      <AffCard padding={20}>
        <AffCardHeader icon={ImageIcon} title={t('aff.recurringForm.defaultFlyer')} subtitle={t('aff.recurringForm.defaultFlyerSub')} />
        <AffiliateImageUploader affiliateId={affiliateId} value={form.flyer_url} onChange={(url) => set('flyer_url', url)}
          folder="recurring/flyers" hint={t('aff.recurringForm.flyerHint')} />
      </AffCard>

      {/* Prochaines soirées — mode single uniquement.
          Édition : publieur par jour (lien propre à chaque date, posé quand on veut).
          Création : aperçu des dates + invite à enregistrer le modèle d'abord. */}
      {!bulkMode && (
        isEdit && id ? (
          <NextOccurrencesPublisher
            templateId={id}
            dayOfWeek={form.day_of_week}
            affiliateId={affiliateId}
            tpl={{
              name: form.name,
              affiliate_venue_id: form.affiliate_venue_id,
              start_time: form.start_time,
              end_time: form.end_time,
              price_from: form.price_from,
              is_free: form.is_free,
              genres: form.genres,
              flyer_url: form.flyer_url,
              has_tables: form.has_tables,
              tables_only: form.tables_only,
              has_guest_list: form.has_guest_list,
              guest_list_type: form.guest_list_type,
            }}
          />
        ) : (
          <NextOccurrencesPreview dayOfWeek={form.day_of_week} />
        )
      )}

      <div className="flex gap-3 pb-8">
        <AffButton onClick={() => handleSave({ askPropagate: true })} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {saving
            ? (bulkMode && !isEdit ? t('aff.recurringForm.bulkCreating').replace('{count}', String(bulkSelectedDays.length)) : t('aff.recurringForm.savingLabel'))
            : isEdit
              ? t('aff.recurringForm.save')
              : bulkMode
                ? (bulkSelectedDays.length !== 1 ? t('aff.recurringForm.bulkCreateMany') : t('aff.recurringForm.bulkCreateOne')).replace('{count}', String(bulkSelectedDays.length))
                : t('aff.recurringForm.create')}
        </AffButton>
        <AffButton variant="ghost" onClick={() => guardedNavigate('/affiliate/recurring')}>{t('aff.recurringForm.cancel')}</AffButton>
      </div>

      {/* Report sur les soirées déjà créées. Ouverte seulement après un
          enregistrement qui a vraiment changé quelque chose de recopiable, et
          seulement s'il existe au moins une soirée à venir issue du modèle. */}
      <Dialog open={Boolean(propagate)} onOpenChange={(open) => { if (!open && !propagating) setPropagate(null); }}>
        <DialogContent className="max-w-md border-0 text-white" style={{ background: '#0a0a0c', border: `1px solid ${BORDER}` }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2" style={{ color: T1 }}>
              <CopyCheck className="h-5 w-5" style={{ color: RED }} />
              {t('aff.recurringForm.propTitle')}
            </DialogTitle>
          </DialogHeader>

          {propagate && (
            <div className="space-y-3 py-1">
              <p style={{ color: T2, fontSize: 12.5, lineHeight: 1.55 }}>{t('aff.recurringForm.propIntro')}</p>

              <div className="rounded-lg p-3 space-y-1" style={{ background: TILE_BG, border: `1px solid ${F_BORDER}` }}>
                <p style={{ color: T1, fontSize: 12, fontWeight: 600 }}>{t('aff.recurringForm.propChanged')}</p>
                {propagate.fields.map((f) => (
                  <p key={f} style={{ color: T3, fontSize: 11.5 }}>• {t(PROP_FIELD_KEY[f])}</p>
                ))}
              </div>

              <div className="rounded-lg p-3" style={{ background: 'rgba(232,25,44,0.06)', border: '1px solid rgba(232,25,44,0.2)' }}>
                <p style={{ color: T1, fontSize: 12, fontWeight: 560 }}>
                  {propagate.ids.length === 1
                    ? t('aff.recurringForm.propScopeOne')
                    : t('aff.recurringForm.propScope').replace('{count}', String(propagate.ids.length))}
                </p>
                <p style={{ color: T3, fontSize: 11.5, marginTop: 3 }}>
                  {t('aff.recurringForm.propBreakdown')
                    .replace('{drafts}', String(propagate.drafts))
                    .replace('{live}', String(propagate.live))}
                </p>
                <p style={{ color: T3, fontSize: 11.5, marginTop: 6 }}>{t('aff.recurringForm.propKeepsLinks')}</p>
              </div>
            </div>
          )}

          <DialogFooter>
            <AffButton variant="ghost" size="sm" onClick={() => setPropagate(null)} disabled={propagating}>
              {t('aff.recurringForm.propSkip')}
            </AffButton>
            <AffButton size="sm" onClick={applyPropagation} disabled={propagating}>
              {propagating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {propagating
                ? t('aff.recurringForm.propApplying')
                : propagate?.ids.length === 1
                  ? t('aff.recurringForm.propApplyOne')
                  : t('aff.recurringForm.propApply').replace('{count}', String(propagate?.ids.length ?? 0))}
            </AffButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AffPage>
  );
}
