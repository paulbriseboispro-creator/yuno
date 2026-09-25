import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Link2, ExternalLink, Share2, Settings, Plus, X, ChevronUp, ChevronDown,
  Search, Sparkles, CalendarDays, ListChecks, RotateCcw,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAffiliateShell } from '@/contexts/AffiliateShellContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { shareContent } from '@/lib/share';
import {
  T1, T2, T3, RED, POS, BORDER, F_BORDER, INNER_BG, C_FAINT,
  PromoCard, PromoButton, PromoPill, SectionLabel, CopyField, DarkInput, PromoEmpty,
} from '@/components/promoter/promoter-ui';
import { currentNightDate } from '@/lib/affiliateEventTime';

/**
 * « Mon linktree » — le chef d'agence choisit les soirées de SON /p/:slug.
 *
 * Deux sources dans une seule liste : les soirées externes publiées
 * (`affiliate_events`) et les soirées Yuno des clubs / orgas sous contrat
 * actif. La sélection s'écrit en entier par `set_agency_linktree_events`
 * (ordre = ordre de la liste, chaque soirée revérifiée côté serveur).
 * Sélection vide = linktree automatique, comme avant.
 */

type SortMode = 'by_day' | 'by_genre' | 'by_price' | 'custom';
type Kind = 'external' | 'yuno';

type Item = {
  key: string;
  kind: Kind;
  id: string;
  name: string;
  /** YYYY-MM-DD, heure locale de la soirée. */
  date: string;
  time: string | null;
  flyer: string | null;
  venue: string | null;
};

type YunoRow = {
  event_id: string;
  title: string;
  start_at: string;
  venue_name: string | null;
  poster_url: string | null;
};

const MAX_ITEMS = 60;
const PAGE = 40;

const keyOf = (kind: Kind, id: string) => `${kind}:${id}`;

// RPC de la migration 20260925160000, absentes des types générés.
type RpcResult<T> = { data: T | null; error: { message: string } | null };
function rpc<T>(fn: string, args: Record<string, unknown>): Promise<RpcResult<T>> {
  return (supabase as unknown as { rpc: (f: string, a: Record<string, unknown>) => Promise<RpcResult<T>> }).rpc(fn, args);
}

function fromYuno(row: YunoRow): Item {
  const when = new Date(row.start_at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    key: keyOf('yuno', row.event_id),
    kind: 'yuno',
    id: row.event_id,
    name: row.title,
    date: `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`,
    time: `${pad(when.getHours())}:${pad(when.getMinutes())}`,
    flyer: row.poster_url,
    venue: row.venue_name,
  };
}

export default function AgencyLinktree() {
  const shell = useAffiliateShell();
  const affiliateId = shell?.affiliateId ?? null;
  const { t, language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const navigate = useNavigate();
  const locale = language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB';

  const [loading, setLoading] = useState(true);
  const [slug, setSlug] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('by_day');
  const [catalog, setCatalog] = useState<Item[]>([]);
  const [selection, setSelection] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [source, setSource] = useState<'all' | Kind>('all');
  const [shown, setShown] = useState(PAGE);
  const saveSeq = useRef(0);

  const load = useCallback(async () => {
    if (!affiliateId) return;
    setLoading(true);
    const today = currentNightDate();
    const [aff, ext, editor] = await Promise.all([
      supabase.from('affiliates').select('linktree_slug, linktree_sort_mode').eq('id', affiliateId).maybeSingle(),
      supabase
        .from('affiliate_events')
        .select('id, name, event_date, start_time, flyer_url, affiliate_venues(name)')
        .eq('affiliate_id', affiliateId)
        .in('status', ['published', 'featured'])
        .gte('event_date', today)
        .order('event_date', { ascending: true })
        .order('start_time', { ascending: true })
        .limit(300),
      rpc<{ selection: { kind: Kind; id: string }[]; yuno: YunoRow[] }>('get_agency_linktree_editor', { p_affiliate_id: affiliateId }),
    ]);

    setSlug(aff.data?.linktree_slug ?? null);
    setSortMode(((aff.data as { linktree_sort_mode?: SortMode } | null)?.linktree_sort_mode ?? 'by_day') as SortMode);

    const external: Item[] = (ext.data ?? []).map((e) => {
      const venue = Array.isArray(e.affiliate_venues) ? e.affiliate_venues[0] : e.affiliate_venues;
      return {
        key: keyOf('external', e.id),
        kind: 'external' as const,
        id: e.id,
        name: e.name,
        date: e.event_date,
        time: e.start_time ? e.start_time.slice(0, 5) : null,
        flyer: e.flyer_url,
        venue: (venue as { name?: string } | null)?.name ?? null,
      };
    });
    const yuno: Item[] = (editor.data?.yuno ?? []).map(fromYuno);
    const all = [...external, ...yuno].sort((a, b) =>
      a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''));
    setCatalog(all);

    if (editor.error) {
      toast.error(tt('Impossible de charger votre sélection.', 'Could not load your selection.', 'No se pudo cargar tu selección.'));
    }
    // Une soirée choisie qui est passée ou dépubliée n'a plus de ligne au
    // catalogue : elle sort de la liste et partira au prochain enregistrement.
    const known = new Set(all.map(i => i.key));
    const sel = (editor.data?.selection ?? [])
      .map(s => keyOf(s.kind, s.id))
      .filter(k => known.has(k));
    setSelection(sel);
    setLoading(false);
  }, [affiliateId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const byKey = useMemo(() => new Map(catalog.map(i => [i.key, i])), [catalog]);
  const selectedSet = useMemo(() => new Set(selection), [selection]);

  const persist = async (next: string[], previous: string[]) => {
    if (!affiliateId) return;
    const seq = ++saveSeq.current;
    setSelection(next);
    setSaving(true);
    const items = next.map(k => {
      const it = byKey.get(k)!;
      return { kind: it.kind, id: it.id };
    });
    const { error } = await rpc<number>('set_agency_linktree_events', {
      p_affiliate_id: affiliateId,
      p_items: items,
    });
    if (seq !== saveSeq.current) return; // une sauvegarde plus récente est partie
    setSaving(false);
    if (error) {
      setSelection(previous);
      toast.error(tt("La sélection n'a pas été enregistrée.", 'Your selection was not saved.', 'La selección no se guardó.'));
    }
  };

  const add = (key: string) => {
    if (selectedSet.has(key)) return;
    if (selection.length >= MAX_ITEMS) {
      toast.error(tt(`${MAX_ITEMS} soirées maximum sur le linktree.`, `${MAX_ITEMS} events max on the linktree.`, `${MAX_ITEMS} fiestas como máximo en el linktree.`));
      return;
    }
    persist([...selection, key], selection);
  };

  const remove = (key: string) => persist(selection.filter(k => k !== key), selection);

  const move = (key: string, dir: -1 | 1) => {
    const i = selection.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= selection.length) return;
    const next = [...selection];
    [next[i], next[j]] = [next[j], next[i]];
    persist(next, selection);
  };

  const resetToAuto = () => {
    const previous = selection;
    persist([], previous);
    toast(tt('Linktree repassé en automatique.', 'Linktree switched back to automatic.', 'Linktree vuelto a automático.'), {
      action: { label: tt('Annuler', 'Undo', 'Deshacer'), onClick: () => persist(previous, []) },
    });
  };

  const changeSort = async (mode: SortMode) => {
    if (!affiliateId || mode === sortMode) return;
    const prev = sortMode;
    setSortMode(mode);
    const { error } = await supabase.from('affiliates').update({ linktree_sort_mode: mode }).eq('id', affiliateId);
    if (error) {
      setSortMode(prev);
      toast.error(t('common.error'));
    }
  };

  const fmtDate = (d: string) => {
    const [y, m, day] = d.split('-').map(Number);
    return new Date(y, m - 1, day).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  };

  const hasYuno = catalog.some(i => i.kind === 'yuno');
  const hasExternal = catalog.some(i => i.kind === 'external');

  const available = useMemo(() => {
    const q = search.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
    return catalog.filter(i => {
      if (selectedSet.has(i.key)) return false;
      if (source !== 'all' && i.kind !== source) return false;
      if (!q) return true;
      const hay = `${i.name} ${i.venue ?? ''}`.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
      return hay.includes(q);
    });
  }, [catalog, selectedSet, source, search]);

  // Affichage de la sélection : l'ordre de la liste ne compte qu'en « Manuel »,
  // sinon le linktree range lui-même — on montre alors par date.
  const selectedItems = useMemo(() => {
    const items = selection.map(k => byKey.get(k)).filter(Boolean) as Item[];
    return sortMode === 'custom'
      ? items
      : [...items].sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''));
  }, [selection, byKey, sortMode]);

  const url = slug ? `${window.location.origin}/p/${slug}` : null;
  const isCurated = selection.length > 0;

  const sortOptions: { value: SortMode; label: string }[] = [
    { value: 'by_day', label: t('aff.settings.sortByDay') },
    { value: 'by_genre', label: t('aff.settings.sortByGenre') },
    { value: 'by_price', label: t('aff.settings.sortByPrice') },
    { value: 'custom', label: t('aff.settings.sortCustom') },
  ];

  if (!affiliateId || loading) {
    return (
      <div className="py-16 flex justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2"
          style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
      </div>
    );
  }

  return (
    <div className="py-4 space-y-4">
      {/* En-tête */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center flex-none"
          style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.22)' }}>
          <ListChecks className="h-4.5 w-4.5" style={{ color: RED }} />
        </div>
        <div className="min-w-0">
          <h1 style={{ color: T1, fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>
            {tt('Mon linktree', 'My linktree', 'Mi linktree')}
          </h1>
          <p style={{ color: T3, fontSize: 12 }}>
            {tt('Choisissez les soirées de votre lien de bio, puis collez le lien sur Instagram.',
                'Pick the events on your bio link, then paste the link on Instagram.',
                'Elige las fiestas de tu enlace de bio y pega el enlace en Instagram.')}
          </p>
        </div>
      </div>

      {/* Le lien à coller dans la bio */}
      {url ? (
        <PromoCard>
          <div className="flex items-center justify-between mb-3 gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Link2 className="h-4 w-4 flex-none" style={{ color: RED }} />
              <p style={{ color: T1, fontSize: 14, fontWeight: 650 }}>
                {tt('Votre lien de bio', 'Your bio link', 'Tu enlace de bio')}
              </p>
            </div>
            <PromoPill tone={isCurated ? 'success' : 'muted'}>
              {isCurated
                ? tt(`Votre sélection · ${selection.length}`, `Your selection · ${selection.length}`, `Tu selección · ${selection.length}`)
                : tt('Automatique', 'Automatic', 'Automático')}
            </PromoPill>
          </div>
          <CopyField label="URL" value={url} mono={false} onCopy={() => toast.success(tt('Lien copié', 'Link copied', 'Enlace copiado'))} />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <PromoButton size="sm" variant="secondary" onClick={() => window.open(`/p/${slug}`, '_blank')}>
              <ExternalLink className="h-4 w-4" /> {tt('Voir mon linktree', 'View my linktree', 'Ver mi linktree')}
            </PromoButton>
            <PromoButton size="sm" variant="secondary" onClick={async () => {
              const outcome = await shareContent({ url });
              if (outcome === 'copied') toast.success(tt('Lien copié', 'Link copied', 'Enlace copiado'));
            }}>
              <Share2 className="h-4 w-4" /> {tt('Partager', 'Share', 'Compartir')}
            </PromoButton>
          </div>
          <p style={{ color: T3, fontSize: 12, marginTop: 10, lineHeight: 1.55 }}>
            {tt('Instagram : Modifier le profil → Liens → Ajouter un lien externe → collez l\'URL. Le lien ne change jamais : vos choix ci-dessous s\'y appliquent tout de suite.',
                'Instagram: Edit profile → Links → Add external link → paste the URL. The link never changes: your choices below apply to it instantly.',
                'Instagram: Editar perfil → Enlaces → Añadir enlace externo → pega la URL. El enlace no cambia nunca: tus elecciones de abajo se aplican al instante.')}
          </p>
        </PromoCard>
      ) : (
        <PromoCard>
          <div className="flex items-start gap-3">
            <Sparkles className="h-5 w-5 flex-none mt-0.5" style={{ color: RED }} />
            <div>
              <p style={{ color: T1, fontSize: 14, fontWeight: 650 }}>
                {tt('Choisissez d\'abord votre adresse publique', 'First, choose your public address', 'Primero elige tu dirección pública')}
              </p>
              <p style={{ color: T3, fontSize: 12.5, marginTop: 4, lineHeight: 1.55 }}>
                {tt('Votre linktree vivra sur yunoapp.eu/p/votre-nom. Vous pouvez déjà choisir vos soirées ci-dessous.',
                    'Your linktree will live at yunoapp.eu/p/your-name. You can already pick your events below.',
                    'Tu linktree vivirá en yunoapp.eu/p/tu-nombre. Ya puedes elegir tus fiestas abajo.')}
              </p>
              <div className="mt-3">
                <PromoButton size="sm" onClick={() => navigate('/affiliate/settings')}>
                  <Settings className="h-4 w-4" /> {tt("Choisir l'adresse", 'Choose address', 'Elegir la dirección')}
                </PromoButton>
              </div>
            </div>
          </div>
        </PromoCard>
      )}

      {/* Classement */}
      <SectionLabel>{tt('Classement sur le linktree', 'Order on the linktree', 'Orden en el linktree')}</SectionLabel>
      <div className="flex flex-wrap gap-2">
        {sortOptions.map(opt => {
          const active = sortMode === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => changeSort(opt.value)}
              className="cursor-pointer transition-colors"
              style={{
                padding: '6px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit',
                background: active ? 'rgba(232,25,44,0.10)' : INNER_BG,
                border: `1px solid ${active ? 'rgba(232,25,44,0.3)' : BORDER}`,
                color: active ? RED : T2,
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Sélection */}
      <SectionLabel
        action={
          <span style={{ color: saving ? T3 : POS, fontSize: 11.5, fontWeight: 600 }}>
            {saving ? tt('Enregistrement…', 'Saving…', 'Guardando…') : isCurated ? tt('Enregistré', 'Saved', 'Guardado') : ''}
          </span>
        }
      >
        {tt('Sur votre linktree', 'On your linktree', 'En tu linktree')}
      </SectionLabel>

      {isCurated ? (
        <PromoCard style={{ padding: 8 }}>
          {selectedItems.map((item, i) => (
            <EventRow
              key={item.key}
              item={item}
              dateLabel={fmtDate(item.date)}
              yunoLabel="Yuno"
              externalLabel={tt('Externe', 'External', 'Externa')}
              last={i === selectedItems.length - 1}
              right={
                <div className="flex items-center gap-1 flex-none">
                  {sortMode === 'custom' && (
                    <>
                      <IconBtn label={tt('Monter', 'Move up', 'Subir')} disabled={i === 0} onClick={() => move(item.key, -1)}>
                        <ChevronUp className="h-4 w-4" />
                      </IconBtn>
                      <IconBtn label={tt('Descendre', 'Move down', 'Bajar')} disabled={i === selectedItems.length - 1} onClick={() => move(item.key, 1)}>
                        <ChevronDown className="h-4 w-4" />
                      </IconBtn>
                    </>
                  )}
                  <IconBtn label={tt('Retirer', 'Remove', 'Quitar')} onClick={() => remove(item.key)}>
                    <X className="h-4 w-4" />
                  </IconBtn>
                </div>
              }
            />
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2" style={{ padding: '10px 8px 4px' }}>
            <p style={{ color: T3, fontSize: 11.5, lineHeight: 1.5, flex: '1 1 240px' }}>
              {sortMode === 'custom'
                ? tt('Le linktree suit cet ordre. Seules ces soirées y apparaissent ; une fois toutes passées, il repasse en automatique.',
                     'The linktree follows this order. Only these events appear; once they have all passed, it goes back to automatic.',
                     'El linktree sigue este orden. Solo aparecen estas fiestas; cuando hayan pasado todas, vuelve a automático.')
                : tt(`Seules ces soirées apparaissent sur le linktree, rangées selon le classement choisi. Choisissez « ${t('aff.settings.sortCustom')} » pour imposer votre ordre.`,
                     `Only these events appear on the linktree, arranged by the chosen order. Pick “${t('aff.settings.sortCustom')}” to set your own order.`,
                     `Solo estas fiestas aparecen en el linktree, según el orden elegido. Elige «${t('aff.settings.sortCustom')}» para imponer tu orden.`)}
            </p>
            <PromoButton size="sm" variant="ghost" onClick={resetToAuto}>
              <RotateCcw className="h-3.5 w-3.5" /> {tt('Revenir en automatique', 'Back to automatic', 'Volver a automático')}
            </PromoButton>
          </div>
        </PromoCard>
      ) : (
        <PromoCard>
          <p style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>
            {tt('Mode automatique', 'Automatic mode', 'Modo automático')}
          </p>
          <p style={{ color: T3, fontSize: 12.5, marginTop: 4, lineHeight: 1.55 }}>
            {tt('Votre linktree affiche aujourd\'hui vos 8 prochaines soirées externes et toutes les soirées Yuno de vos clubs sous contrat. Ajoutez une soirée ci-dessous pour choisir vous-même : seules vos soirées choisies s\'afficheront.',
                'Your linktree currently shows your next 8 external events and every Yuno event of your contracted clubs. Add an event below to choose yourself: only your chosen events will show.',
                'Tu linktree muestra ahora tus 8 próximas fiestas externas y todas las fiestas Yuno de tus clubs con contrato. Añade una fiesta abajo para elegir tú: solo se mostrarán las fiestas elegidas.')}
          </p>
        </PromoCard>
      )}

      {/* Catalogue */}
      <SectionLabel action={<span style={{ color: T3, fontSize: 11.5 }}>{available.length}</span>}>
        {tt('Ajouter des soirées', 'Add events', 'Añadir fiestas')}
      </SectionLabel>

      {catalog.length === 0 ? (
        <PromoEmpty
          icon={CalendarDays}
          title={tt('Aucune soirée à venir', 'No upcoming events', 'Ninguna fiesta próxima')}
          description={tt('Publiez une soirée externe ou signez un contrat avec un club Yuno : elle apparaîtra ici.',
                          'Publish an external event or sign a contract with a Yuno club: it will show up here.',
                          'Publica una fiesta externa o firma un contrato con un club Yuno: aparecerá aquí.')}
          action={
            <PromoButton size="sm" onClick={() => navigate('/affiliate/events')}>
              <Plus className="h-4 w-4" /> {tt('Soirées externes', 'External events', 'Fiestas externas')}
            </PromoButton>
          }
        />
      ) : (
        <PromoCard style={{ padding: 8 }}>
          <div className="flex flex-wrap gap-2" style={{ padding: 4, paddingBottom: 8 }}>
            <div style={{ flex: '1 1 220px' }}>
              <DarkInput
                value={search}
                onChange={(v) => { setSearch(v); setShown(PAGE); }}
                icon={Search}
                placeholder={tt('Rechercher une soirée ou un club', 'Search an event or club', 'Buscar una fiesta o un club')}
              />
            </div>
            {hasYuno && hasExternal && (
              <div className="flex gap-1.5">
                {([
                  ['all', tt('Toutes', 'All', 'Todas')],
                  ['yuno', 'Yuno'],
                  ['external', tt('Externes', 'External', 'Externas')],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => { setSource(value); setShown(PAGE); }}
                    className="cursor-pointer"
                    style={{
                      padding: '0 12px', borderRadius: 10, fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit',
                      background: source === value ? C_FAINT : 'transparent',
                      border: `1px solid ${source === value ? BORDER : F_BORDER}`,
                      color: source === value ? T1 : T3,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {available.length === 0 ? (
            <p style={{ color: T3, fontSize: 12.5, padding: '14px 8px' }}>
              {search
                ? tt('Aucune soirée ne correspond.', 'No event matches.', 'Ninguna fiesta coincide.')
                : tt('Toutes vos soirées à venir sont déjà sur le linktree.', 'All your upcoming events are already on the linktree.', 'Todas tus próximas fiestas ya están en el linktree.')}
            </p>
          ) : (
            available.slice(0, shown).map((item, i, arr) => (
              <EventRow
                key={item.key}
                item={item}
                dateLabel={fmtDate(item.date)}
                yunoLabel="Yuno"
                externalLabel={tt('Externe', 'External', 'Externa')}
                last={i === arr.length - 1}
                onClick={() => add(item.key)}
                right={
                  <span className="flex items-center gap-1 flex-none" style={{ color: RED, fontSize: 12.5, fontWeight: 650 }}>
                    <Plus className="h-4 w-4" /> <span className="hidden sm:inline">{tt('Ajouter', 'Add', 'Añadir')}</span>
                  </span>
                }
              />
            ))
          )}

          {available.length > shown && (
            <div style={{ padding: '8px 4px 4px' }}>
              <PromoButton size="sm" variant="ghost" full onClick={() => setShown(s => s + PAGE)}>
                {tt(`Afficher plus (${available.length - shown})`, `Show more (${available.length - shown})`, `Mostrar más (${available.length - shown})`)}
              </PromoButton>
            </div>
          )}
          <p style={{ color: T3, fontSize: 11.5, padding: '8px 8px 4px', lineHeight: 1.5 }}>
            {tt('Une soirée externe sans lien billetterie reste en brouillon : elle apparaît ici dès qu\'elle est publiée.',
                'An external event without a ticket link stays a draft: it shows up here once published.',
                'Una fiesta externa sin enlace de venta queda en borrador: aparece aquí en cuanto se publica.')}
          </p>
        </PromoCard>
      )}
    </div>
  );
}

function IconBtn({ children, onClick, label, disabled }: {
  children: React.ReactNode; onClick: () => void; label: string; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex items-center justify-center transition-colors"
      style={{
        width: 30, height: 30, borderRadius: 8, background: INNER_BG, border: `1px solid ${F_BORDER}`,
        color: T2, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.35 : 1,
      }}
    >
      {children}
    </button>
  );
}

function EventRow({ item, dateLabel, yunoLabel, externalLabel, right, last, onClick }: {
  item: Item; dateLabel: string; yunoLabel: string; externalLabel: string;
  right: React.ReactNode; last: boolean; onClick?: () => void;
}) {
  const body = (
    <>
      <div className="flex-none overflow-hidden" style={{ width: 40, height: 50, borderRadius: 8, background: C_FAINT, border: `1px solid ${F_BORDER}` }}>
        {item.flyer && <img src={item.flyer} alt="" loading="lazy" className="w-full h-full object-cover" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 620 }}>{item.name}</p>
        <p className="truncate" style={{ color: T3, fontSize: 12, marginTop: 2 }}>
          <span style={{ textTransform: 'capitalize' }}>{dateLabel}</span>
          {item.time ? ` · ${item.time}` : ''}
          {item.venue ? ` · ${item.venue}` : ''}
        </p>
      </div>
      <PromoPill tone={item.kind === 'yuno' ? 'red' : 'muted'}>{item.kind === 'yuno' ? yunoLabel : externalLabel}</PromoPill>
      {right}
    </>
  );
  const style: React.CSSProperties = {
    padding: '8px', gap: 12,
    borderBottom: last ? undefined : '1px solid rgb(var(--ink)/0.05)',
  };
  return onClick ? (
    <button type="button" onClick={onClick} className="flex w-full items-center text-left cursor-pointer rounded-lg transition-colors hover:bg-[rgb(var(--ink)/0.03)]"
      style={{ ...style, background: 'none', border: 'none', borderBottom: style.borderBottom, fontFamily: 'inherit' }}>
      {body}
    </button>
  ) : (
    <div className="flex items-center" style={style}>{body}</div>
  );
}
