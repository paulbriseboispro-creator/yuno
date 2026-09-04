import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { Search, Eye, ClipboardList, ChevronDown, Printer, Wine, Crown, UserCheck } from 'lucide-react';
import { RosterExportDialog } from '@/components/roster/RosterExportDialog';
import { buildGuestListRoster } from '@/lib/rosterBuilders';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED     = '#E8192C';
const POS     = '#34D399';
const T1      = 'rgba(255,255,255,0.96)';
const T2      = 'rgba(255,255,255,0.58)';
const T3      = 'rgba(255,255,255,0.36)';
const C_FAINT = 'rgba(255,255,255,0.06)';
const BORDER  = 'rgba(255,255,255,0.085)';
const F_BORDER= 'rgba(255,255,255,0.055)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const INNER_BG = 'rgba(255,255,255,0.032)';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

// Entête et lignes partagent la même grille : un `gap` réel (les colonnes se
// touchaient) et des colonnes assez larges pour que le titre d'une soirée
// s'écrête proprement au lieu de mordre sur la colonne voisine.
const GRID_COLS = 'minmax(0,1fr) minmax(0,150px) minmax(0,120px) 92px 32px';

/**
 * Une inscription guest list n'a pas de statut « payé » : elle vaut une place à
 * la porte. L'état qui compte pour le club, c'est « inscrit / entré / annulé »,
 * et il se lit sur deux colonnes (status + entry_scanned), pas sur une seule.
 */
type EntryState = 'registered' | 'entered' | 'cancelled';

const STATE_STYLE: Record<EntryState, { bg: string; color: string }> = {
  entered:    { bg: 'rgba(52,211,153,0.12)',  color: POS },
  cancelled:  { bg: 'rgba(232,25,44,0.12)',   color: '#FF5C63' },
  registered: { bg: 'rgba(255,255,255,0.06)', color: T2 },
};

const STATE_KEY: Record<EntryState, string> = {
  entered: 'owner.gl.st.entered',
  cancelled: 'owner.gl.st.cancelled',
  registered: 'owner.gl.st.registered',
};

const TYPE_KEY: Record<string, string> = {
  normal: 'owner.gl.type.normal',
  drink: 'owner.gl.type.drink',
  table: 'owner.gl.type.table',
};

interface GuestEntry {
  id: string;
  eventId: string;
  eventTitle: string;
  eventStartAt: string;
  eventTimezone: string | null;
  venueName: string | null;
  partLabel: string;
  fullName: string;
  email: string;
  phone: string | null;
  gender: string | null;
  entryType: string;
  state: EntryState;
  scannedAt: string | null;
  createdAt: string;
  reservationCode: string | null;
}

interface OwnerGuestListOrdersProps {
  venueId?: string;
  /** Aggregate guest-list sign-ups across a set of events (organizer scope). */
  eventIds?: string[];
  /** When set, auto-open the detail dialog for this entry id (notification deep-link). */
  focusOrderId?: string;
}

function DarkSelect({ value, onChange, options }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="appearance-none pr-8 pl-3 py-2 rounded-lg text-[13px] cursor-pointer w-full"
        style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, outline: 'none' }}
      >
        {options.map(o => (
          <option key={o.value} value={o.value} style={{ background: '#0a0a0c' }}>{o.label}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: T3 }} />
    </div>
  );
}

export function OwnerGuestListOrders({ venueId, eventIds, focusOrderId }: OwnerGuestListOrdersProps) {
  const { t, language } = useLanguage();
  // `eventIds` defined (even empty) means organizer scope: filter by this event set.
  const orgScope = eventIds !== undefined;
  const [entries, setEntries] = useState<GuestEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [stateFilter, setStateFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selected, setSelected] = useState<GuestEntry | null>(null);
  const [sortBy, setSortBy] = useState<'date' | 'name'>('date');
  const [exportOpen, setExportOpen] = useState(false);

  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const stateLabel = (s: EntryState) => t(STATE_KEY[s]);
  const typeLabel = (ty: string) => (TYPE_KEY[ty] ? t(TYPE_KEY[ty]) : ty);

  useEffect(() => {
    if (!venueId && !orgScope) return;
    fetchEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId, eventIds?.join(',')]);

  // Notification deep-link: open the matching entry's detail dialog once it loads.
  const lastFocusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusOrderId || lastFocusRef.current === focusOrderId) return;
    const match = entries.find((e) => e.id === focusOrderId);
    if (match) { setSelected(match); lastFocusRef.current = focusOrderId; }
  }, [focusOrderId, entries]);

  const fetchEntries = async () => {
    try {
      setLoading(true);
      // Organizer with no events yet → nothing to show (avoids an unfiltered query).
      if (orgScope && eventIds!.length === 0) { setEntries([]); return; }

      // 1. Les soirées du périmètre. Côté club : inclure les co-soirées org-led
      //    où le club vit dans partner_venue_id (events.venue_id est NULL) —
      //    même élargissement que la billetterie et OwnerGuestList.
      let evQuery = supabase.from('events').select('id, title, start_at, timezone, venues!events_venue_id_fkey(name)');
      evQuery = orgScope
        ? evQuery.in('id', eventIds!)
        : evQuery.or(`venue_id.eq.${venueId},partner_venue_id.eq.${venueId}`);
      const { data: events, error: evError } = await evQuery;
      if (evError) throw evError;
      const eventMap = new Map((events ?? []).map((e) => [e.id, e]));
      if (eventMap.size === 0) { setEntries([]); return; }

      // 2. Les parts de guest list de ces soirées (club, DJ, promoteur, agence…).
      const { data: parts, error: partError } = await supabase
        .from('guest_lists')
        .select('id, event_id, holder_type, holder_label, dj_id, promoter_id')
        .in('event_id', [...eventMap.keys()]);
      if (partError) throw partError;
      if (!parts?.length) { setEntries([]); return; }

      // 3. Nom affichable de la part : le porteur est une personne, pas un uuid.
      const djIds = [...new Set(parts.filter((p) => p.holder_type === 'dj' && p.dj_id).map((p) => p.dj_id!))];
      const promoterIds = [...new Set(parts.filter((p) => p.holder_type === 'promoter' && p.promoter_id).map((p) => p.promoter_id!))];
      const djNames = new Map<string, string>();
      if (djIds.length) {
        const { data: djRows } = await supabase.from('djs').select('id, stage_name, first_name, last_name').in('id', djIds);
        (djRows ?? []).forEach((d) => {
          djNames.set(d.id, d.stage_name || `${d.first_name ?? ''} ${d.last_name ?? ''}`.trim() || 'DJ');
        });
      }
      const promoterNames = new Map<string, string>();
      if (promoterIds.length) {
        const { data: promoRows } = await supabase.from('promoters').select('id, user_id').in('id', promoterIds);
        const userIds = (promoRows ?? []).map((p) => p.user_id).filter(Boolean);
        const profileNames = new Map<string, string>();
        if (userIds.length) {
          const { data: profiles } = await supabase.from('profiles').select('id, first_name, last_name').in('id', userIds);
          (profiles ?? []).forEach((p) => profileNames.set(p.id, `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()));
        }
        (promoRows ?? []).forEach((p) => { promoterNames.set(p.id, profileNames.get(p.user_id) || ''); });
      }
      const partInfo = new Map(parts.map((p) => {
        const resolved =
          p.holder_type === 'dj' ? (p.dj_id ? djNames.get(p.dj_id) : '')
          : p.holder_type === 'promoter' ? (p.promoter_id ? promoterNames.get(p.promoter_id) : '')
          : '';
        const label = p.holder_label || resolved || t(`guestList.holderType.${p.holder_type}`);
        return [p.id, { eventId: p.event_id, label }] as const;
      }));

      // 4. Les inscrits.
      const { data: rows, error: entryError } = await supabase
        .from('guest_list_entries')
        .select('id, guest_list_id, full_name, email, phone, gender, entry_type, status, entry_scanned, entry_scanned_at, reservation_code, created_at')
        .in('guest_list_id', [...partInfo.keys()])
        .order('created_at', { ascending: false });
      if (entryError) throw entryError;

      const mapped: GuestEntry[] = (rows ?? []).flatMap((r) => {
        const part = partInfo.get(r.guest_list_id);
        const ev = part ? eventMap.get(part.eventId) : undefined;
        if (!part || !ev) return [];
        return [{
          id: r.id,
          eventId: part.eventId,
          eventTitle: ev.title,
          eventStartAt: ev.start_at,
          eventTimezone: ev.timezone ?? null,
          venueName: ev.venues?.name ?? null,
          partLabel: part.label,
          fullName: r.full_name,
          email: r.email,
          phone: r.phone ?? null,
          gender: r.gender ?? null,
          entryType: r.entry_type ?? 'normal',
          state: (r.status === 'cancelled' ? 'cancelled' : r.entry_scanned ? 'entered' : 'registered') as EntryState,
          scannedAt: r.entry_scanned_at ?? null,
          createdAt: r.created_at,
          reservationCode: r.reservation_code ?? null,
        }];
      });
      setEntries(mapped);
    } catch (error) {
      console.error('Error fetching guest list entries:', error);
    } finally {
      setLoading(false);
    }
  };

  const q = searchQuery.toLowerCase();
  const filtered = entries
    .filter((e) => stateFilter === 'all' || e.state === stateFilter)
    .filter((e) => typeFilter === 'all' || e.entryType === typeFilter)
    .filter((e) => !q
      || e.fullName.toLowerCase().includes(q)
      || e.email.toLowerCase().includes(q)
      || e.eventTitle.toLowerCase().includes(q)
      || e.partLabel.toLowerCase().includes(q)
    )
    .sort((a, b) => sortBy === 'date'
      ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      : a.fullName.localeCompare(b.fullName, language)
    );

  // Une annulation n'a jamais franchi la porte : elle ne compte ni au numérateur
  // ni au dénominateur du taux d'entrée.
  const expected = filtered.filter((e) => e.state !== 'cancelled').length;
  const checkedIn = filtered.filter((e) => e.state === 'entered').length;
  const showRate = expected > 0 ? Math.round((checkedIn / expected) * 100) : 0;

  // Une liste de porte se tire pour UNE soirée : les soirées présentes dans le
  // jeu chargé deviennent le sélecteur du dialogue d'export.
  const eventChoices = Array.from(new Map(entries.map((e) => [e.eventId, e])).values())
    .sort((a, b) => new Date(b.eventStartAt).getTime() - new Date(a.eventStartAt).getTime())
    .map((e) => ({
      id: e.eventId,
      label: `${e.eventTitle} — ${format(new Date(e.eventStartAt), 'dd/MM/yyyy', { locale: dateLocale })}`,
    }));

  const TypeIcon = ({ ty }: { ty: string }) =>
    ty === 'drink' ? <Wine className="w-3 h-3 inline" />
    : ty === 'table' ? <Crown className="w-3 h-3 inline" />
    : <ClipboardList className="w-3 h-3 inline" />;

  return (
    <>
      {/* Stats */}
      <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '16px 22px', marginBottom: 16 }}>
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: t('owner.gl.signups'), value: filtered.length.toString() },
            { label: t('owner.gl.checkedIn'), value: checkedIn.toString() },
            { label: t('owner.gl.showRate'), value: `${showRate}%` },
          ].map(({ label, value }) => (
            <div key={label} className="text-center">
              <div style={{ color: T3, fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
              <div style={{ color: T1, fontSize: 22, fontWeight: 640, letterSpacing: '-0.02em' }} className="tabular-nums leading-none">{value}</div>
            </div>
          ))}
        </div>
        {/* Liste des invités — papier pour la porte, tableur pour le bureau. */}
        {eventChoices.length > 0 && (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={() => setExportOpen(true)}
              className="inline-flex items-center gap-1.5 cursor-pointer"
              style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '8px 12px', color: T2, fontSize: 12.5, fontWeight: 560 }}
            >
              <Printer className="w-3.5 h-3.5" />
              {t('roster.cta')}
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '16px 20px', marginBottom: 16 }}>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: T3 }} />
            <input
              placeholder={t('owner.gl.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg text-[13px]"
              style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, outline: 'none' }}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <DarkSelect value={stateFilter} onChange={setStateFilter} options={[
              { value: 'all', label: t('owner.allStatuses') },
              { value: 'registered', label: t('owner.gl.st.registered') },
              { value: 'entered', label: t('owner.gl.st.entered') },
              { value: 'cancelled', label: t('owner.gl.st.cancelled') },
            ]} />
            <DarkSelect value={typeFilter} onChange={setTypeFilter} options={[
              { value: 'all', label: t('owner.gl.allTypes') },
              { value: 'normal', label: t('owner.gl.type.normal') },
              { value: 'drink', label: t('owner.gl.type.drink') },
              { value: 'table', label: t('owner.gl.type.table') },
            ]} />
            <DarkSelect value={sortBy} onChange={(v) => setSortBy(v as 'date' | 'name')} options={[
              { value: 'date', label: t('owner.sortByDate') },
              { value: 'name', label: t('owner.gl.sortByName') },
            ]} />
          </div>
        </div>
      </div>

      {/* Table */}
      <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, overflow: 'hidden' }}>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-2" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 px-4">
            <ClipboardList className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.12)' }} />
            <p style={{ color: T3, fontSize: 13 }}>{t('owner.gl.empty')}</p>
          </div>
        ) : (
          <div>
            <div className="grid items-center gap-3 px-5 py-3" style={{ gridTemplateColumns: GRID_COLS, borderBottom: `1px solid ${F_BORDER}` }}>
              {[t('owner.th.client'), t('owner.th.event'), t('owner.gl.th.list'), t('owner.th.status'), ''].map((h, idx) => (
                <span key={idx} className="truncate" style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{h}</span>
              ))}
            </div>
            {filtered.map((entry, i) => {
              const st = STATE_STYLE[entry.state];
              return (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(i, 20) * 0.025 }}
                  className="grid items-center gap-3 px-5 py-3.5 cursor-pointer transition-colors duration-150"
                  style={{ gridTemplateColumns: GRID_COLS, borderBottom: i < filtered.length - 1 ? `1px solid ${F_BORDER}` : 'none' }}
                  onClick={() => setSelected(entry)}
                >
                  <div className="min-w-0">
                    <div style={{ color: T1, fontSize: 13, fontWeight: 560 }} className="truncate">{entry.fullName}</div>
                    <div style={{ color: T3, fontSize: 11.5, marginTop: 1 }} className="truncate">{entry.email}</div>
                  </div>
                  <div className="min-w-0">
                    <div style={{ color: T2, fontSize: 12 }} className="truncate" title={entry.eventTitle}>{entry.eventTitle}</div>
                    <div style={{ color: T3, fontSize: 11, marginTop: 1 }} className="truncate">{format(new Date(entry.createdAt), 'dd/MM HH:mm', { locale: dateLocale })}</div>
                  </div>
                  <div className="min-w-0">
                    <div style={{ color: T2, fontSize: 12 }} className="truncate" title={entry.partLabel}>{entry.partLabel}</div>
                    <div style={{ color: T3, fontSize: 11, marginTop: 1 }} className="flex items-center gap-1 truncate">
                      <TypeIcon ty={entry.entryType} />
                      <span className="truncate">{typeLabel(entry.entryType)}</span>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold w-fit" style={{ background: st.bg, color: st.color }}>
                    {entry.state === 'entered' && <UserCheck className="w-3 h-3" />}
                    {stateLabel(entry.state)}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setSelected(entry); }}
                    className="w-8 h-8 flex items-center justify-center rounded-lg cursor-pointer transition-all duration-150"
                    style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* Detail Dialog */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="border-0 p-0 overflow-hidden" style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 18, maxWidth: 440 }}>
          <DialogHeader className="px-6 pt-6 pb-0">
            <DialogTitle style={{ color: T1, fontSize: 15.5, fontWeight: 600 }}>{t('owner.gl.details')}</DialogTitle>
            <DialogDescription className="sr-only">{t('owner.gl.details')}</DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between p-4 rounded-xl" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold"
                  style={{ background: STATE_STYLE[selected.state].bg, color: STATE_STYLE[selected.state].color }}>
                  {selected.state === 'entered' && <UserCheck className="w-3.5 h-3.5" />}
                  {stateLabel(selected.state)}
                </span>
                <span style={{ color: T1, fontSize: 13, fontWeight: 620 }} className="inline-flex items-center gap-1.5">
                  <TypeIcon ty={selected.entryType} />
                  {typeLabel(selected.entryType)}
                </span>
              </div>

              <div className="p-4 rounded-xl space-y-1.5" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                <p style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{selected.eventTitle}</p>
                <p style={{ color: T3, fontSize: 12 }}>{t('owner.eventDate')}: {format(new Date(selected.eventStartAt), 'dd/MM/yyyy HH:mm', { locale: dateLocale })}</p>
                <p style={{ color: T3, fontSize: 12 }}>{t('owner.gl.th.list')}: {selected.partLabel}</p>
                <p style={{ color: T3, fontSize: 12 }}>{t('owner.createdOn')} {format(new Date(selected.createdAt), 'dd/MM/yyyy HH:mm', { locale: dateLocale })}</p>
                {selected.scannedAt && (
                  <p style={{ color: POS, fontSize: 12 }}>
                    {t('owner.gl.enteredAt')} {format(new Date(selected.scannedAt), 'dd/MM/yyyy HH:mm', { locale: dateLocale })}
                  </p>
                )}
              </div>

              <div className="p-4 rounded-xl space-y-1.5" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 6 }}>{t('owner.customerInfo')}</p>
                <p style={{ color: T1, fontSize: 13 }}>{selected.fullName}</p>
                <p style={{ color: T2, fontSize: 13 }}>{selected.email}</p>
                {selected.phone && <p style={{ color: T2, fontSize: 13 }}>{selected.phone}</p>}
                {selected.gender && (
                  <p style={{ color: T3, fontSize: 12 }}>
                    {t(selected.gender === 'female' ? 'guestList.female' : 'guestList.male')}
                  </p>
                )}
                {selected.reservationCode && (
                  <p style={{ color: T3, fontSize: 12 }}>{t('owner.gl.code')}: <span className="tabular-nums" style={{ color: T2 }}>{selected.reservationCode}</span></p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {exportOpen && (
        <RosterExportDialog
          open
          onClose={() => setExportOpen(false)}
          title={t('roster.guestListTitle')}
          eventChoices={eventChoices}
          build={(_format, pickedId) => {
            const target = entries.find((e) => e.eventId === (pickedId ?? eventChoices[0]?.id));
            // Idem billetterie : la liste peut se vider pendant que le dialogue est ouvert.
            if (!target) throw new Error('event_no_longer_loaded');
            return buildGuestListRoster(
              {
                id: target.eventId,
                title: target.eventTitle,
                start_at: target.eventStartAt,
                timezone: target.eventTimezone,
                venueName: target.venueName,
              },
              language,
            );
          }}
        />
      )}
    </>
  );
}
