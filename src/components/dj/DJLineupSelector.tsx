import { useState, useEffect } from 'react';
import { X, Search, Music, Clock, Euro, Hourglass } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useVenueContext } from '@/hooks/useVenueContext';
import { makeDjT } from '@/i18n/djTranslate';
import { djDisplayName, type LineupEntry } from '@/lib/djLineup';

interface DJ {
  id: string;
  user_id: string | null;
  stage_name: string | null;
  first_name: string;
  last_name: string;
  profile_image_url: string | null;
}

interface DJLineupSelectorProps {
  eventId?: string;
  entries: LineupEntry[];
  onChange: (entries: LineupEntry[]) => void;
  /** Heures de la soirée (HH:MM) — préremplissent le brief de la demande. */
  defaultStart?: string;
  defaultEnd?: string;
  /** Date locale de la soirée ('yyyy-MM-dd') — sert au contrôle de disponibilité. */
  eventLocalDate?: string;
}

/**
 * Scope-aware DJ selector.
 * - Owner / manager (venue scope): can search any active DJ on the platform.
 * - Organizer scope: restricted to DJs explicitly linked to the organizer's roster
 *   (djs.organizer_user_id = current user). Prevents organizers from poaching
 *   DJs they have not invited.
 *
 * Handshake booking : un DJ qui a un compte Yuno passe par une demande de
 * booking (horaires, cachet, message) au lieu d'un ajout direct — le mini-dialog
 * collecte le brief et l'entrée reste « en attente » jusqu'à sa validation
 * dans l'app DJ. Un profil roster sans compte est ajouté directement.
 */
export function DJLineupSelector({ entries, onChange, defaultStart, defaultEnd, eventLocalDate }: DJLineupSelectorProps) {
  const { t, language } = useLanguage();
  const tt = makeDjT(language);
  const { scope, organizerUserId } = useVenueContext();
  const isOrganizerScope = scope === 'organizer';
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DJ[]>([]);
  const [orgRoster, setOrgRoster] = useState<DJ[] | null>(null);

  // Mini-dialog du brief de booking (DJ avec compte).
  const [briefDj, setBriefDj] = useState<DJ | null>(null);
  const [briefStart, setBriefStart] = useState('22:00');
  const [briefEnd, setBriefEnd] = useState('04:00');
  const [briefFee, setBriefFee] = useState('');
  const [briefNote, setBriefNote] = useState('');
  const [briefBusy, setBriefBusy] = useState(false);

  // For organizer scope, prefetch the entire roster (small list, no search needed)
  useEffect(() => {
    if (!isOrganizerScope || !organizerUserId) return;
    (async () => {
      const { data } = await supabase
        .from('djs')
        .select('id, user_id, stage_name, first_name, last_name, profile_image_url')
        .eq('organizer_user_id', organizerUserId)
        .eq('is_active', true)
        .order('stage_name', { ascending: true });
      setOrgRoster(data || []);
    })();
  }, [isOrganizerScope, organizerUserId]);

  useEffect(() => {
    if (query.length < 2 && !isOrganizerScope) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => searchDJs(query), 300);
    return () => clearTimeout(timer);
  }, [query, isOrganizerScope, orgRoster]);

  // Une personne déjà présente (confirmée, en attente ou en brouillon) ne doit
  // pas être proposée à nouveau — dédup par ligne djs ET par compte.
  const isAlreadyIn = (dj: DJ) =>
    entries.some((e) => e.djId === dj.id || (dj.user_id != null && e.djUserId === dj.user_id));

  const searchDJs = async (q: string) => {
    if (isOrganizerScope) {
      // Filter the cached roster locally — no remote search.
      const roster = orgRoster ?? [];
      const lc = q.trim().toLowerCase();
      const filtered = roster.filter((d) => {
        if (isAlreadyIn(d)) return false;
        if (!lc) return true;
        return (
          (d.stage_name || '').toLowerCase().includes(lc) ||
          d.first_name.toLowerCase().includes(lc) ||
          d.last_name.toLowerCase().includes(lc)
        );
      });
      setResults(filtered.slice(0, 20));
      return;
    }
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const searchTerm = `%${q}%`;
    const { data } = await supabase
      .from('djs')
      .select('id, user_id, stage_name, first_name, last_name, profile_image_url')
      .eq('is_active', true)
      .or(`stage_name.ilike.${searchTerm},first_name.ilike.${searchTerm},last_name.ilike.${searchTerm}`)
      .limit(10);

    setResults((data || []).filter((d) => !isAlreadyIn(d)));
  };

  const pickDJ = async (dj: DJ) => {
    setQuery('');
    setResults([]);
    if (!dj.user_id) {
      // Profil roster sans compte : personne pour valider, ajout direct.
      onChange([...entries, {
        djId: dj.id,
        djUserId: null,
        name: djDisplayName(dj),
        imageUrl: dj.profile_image_url,
        status: 'draft_direct',
      }]);
      return;
    }
    setBriefStart(defaultStart || '22:00');
    setBriefEnd(defaultEnd || '04:00');
    setBriefFee('');
    setBriefNote('');
    setBriefBusy(false);
    setBriefDj(dj);
    // Signale (sans bloquer) si le DJ est déjà pris ce soir-là.
    if (eventLocalDate) {
      const { data } = await supabase.rpc('get_dj_availability', {
        p_user_id: dj.user_id, p_from: eventLocalDate, p_to: eventLocalDate,
      });
      if ((data || []).length > 0) setBriefBusy(true);
    }
  };

  const confirmBrief = () => {
    if (!briefDj) return;
    onChange([...entries, {
      djId: briefDj.id,
      djUserId: briefDj.user_id,
      name: djDisplayName(briefDj),
      imageUrl: briefDj.profile_image_url,
      status: 'draft_request',
      startTime: briefStart,
      endTime: briefEnd,
      fee: briefFee ? Number(briefFee) : null,
      note: briefNote.trim() || undefined,
    }]);
    setBriefDj(null);
  };

  const removeEntry = (entry: LineupEntry) => {
    onChange(entries.filter((e) => e !== entry));
  };

  const isWaiting = (s: LineupEntry['status']) => s === 'draft_request' || s === 'pending';

  return (
    <div className="space-y-2">
      <Label className="text-sm flex items-center gap-1">
        <Music className="h-3 w-3" /> {t('owner.djLineup')}
      </Label>

      {/* Selected DJs chips */}
      {entries.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {entries.map((e, i) => (
            <Badge
              key={e.requestId || `${e.djId}-${i}`}
              variant={isWaiting(e.status) ? 'outline' : 'secondary'}
              className={`flex items-center gap-1 pr-1 ${isWaiting(e.status) ? 'border-amber-500/60 text-amber-600 dark:text-amber-400' : ''}`}
            >
              {e.imageUrl && (
                <img src={e.imageUrl} alt="" className="h-4 w-4 rounded-full object-cover" />
              )}
              <span className="text-xs">{e.name}</span>
              {isWaiting(e.status) && (
                <span className="flex items-center gap-0.5 text-[10px] uppercase tracking-wide">
                  <Hourglass className="h-2.5 w-2.5" />
                  {e.status === 'pending'
                    ? tt('En attente', 'Awaiting reply', 'En espera')
                    : tt('Demande à l\'enregistrement', 'Request on save', 'Solicitud al guardar')}
                </span>
              )}
              <button
                type="button"
                onClick={() => removeEntry(e)}
                className="ml-0.5 p-0.5 rounded-full hover:bg-destructive/20"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {isOrganizerScope && orgRoster !== null && orgRoster.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          {tt('Aucun DJ dans ton roster. Va dans l\'onglet DJs pour en inviter.',
              'No DJ in your roster yet. Open the DJs tab to invite one.',
              'Ningún DJ en tu roster. Abre la pestaña DJs para invitar a uno.')}
        </p>
      ) : (
        <>
          {/* Search input */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                isOrganizerScope
                  ? tt('Rechercher dans ton roster…', 'Search your roster…', 'Buscar en tu roster…')
                  : t('owner.searchDJPlaceholder')
              }
              className="pl-8 text-sm"
              onFocus={() => {
                if (isOrganizerScope) searchDJs(query);
              }}
            />
          </div>

          {/* Results dropdown */}
          {results.length > 0 && (
            <div className="border border-border rounded-lg bg-card max-h-48 overflow-y-auto">
              {results.map(dj => (
                <button
                  key={dj.id}
                  type="button"
                  onClick={() => pickDJ(dj)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                >
                  <div className="h-8 w-8 shrink-0 rounded-full overflow-hidden bg-muted">
                    {dj.profile_image_url ? (
                      <img src={dj.profile_image_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center">
                        <Music className="h-3 w-3 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <span className="text-sm font-medium flex-1">{djDisplayName(dj)}</span>
                  {dj.user_id && (
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                      {tt('Validation requise', 'Needs approval', 'Requiere validación')}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* Brief de booking — DJ avec compte : horaires, cachet, message */}
      <Dialog open={briefDj !== null} onOpenChange={(o) => { if (!o) setBriefDj(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {briefDj ? tt(`Proposer à ${djDisplayName(briefDj)}`, `Invite ${djDisplayName(briefDj)}`, `Proponer a ${djDisplayName(briefDj)}`) : ''}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              {tt('Ce DJ a un compte Yuno : il recevra une demande de booking et rejoindra l\'affiche quand il aura accepté.',
                  'This DJ has a Yuno account: they will receive a booking request and join the line-up once they accept.',
                  'Este DJ tiene cuenta Yuno: recibirá una solicitud de booking y se unirá al cartel cuando acepte.')}
            </p>
            {briefBusy && (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                {tt('Ce DJ semble déjà pris ce soir-là — il pourra quand même répondre.',
                    'This DJ looks busy that night — they can still reply.',
                    'Este DJ parece ocupado esa noche — aun así podrá responder.')}
              </p>
            )}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
                <Clock size={13} />{tt('Horaires du set', 'Set times', 'Horario del set')}
              </label>
              <div className="flex items-center gap-2">
                <Input type="time" value={briefStart} onChange={(e) => setBriefStart(e.target.value)} className="flex-1" />
                <span className="text-muted-foreground">→</span>
                <Input type="time" value={briefEnd} onChange={(e) => setBriefEnd(e.target.value)} className="flex-1" />
              </div>
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
                <Euro size={13} />{tt('Cachet proposé (€)', 'Proposed fee (€)', 'Caché propuesto (€)')}
              </label>
              <Input
                type="number" min={0} value={briefFee}
                onChange={(e) => setBriefFee(e.target.value)}
                placeholder={tt('Optionnel', 'Optional', 'Opcional')}
              />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
                {tt('Message (style attendu, ambiance…)', 'Message (expected style, vibe…)', 'Mensaje (estilo esperado, ambiente…)')}
              </label>
              <Textarea
                value={briefNote} onChange={(e) => setBriefNote(e.target.value)} rows={2}
                placeholder={tt('Optionnel — précise le style de musique souhaité', 'Optional — describe the music style you want', 'Opcional — describe el estilo musical deseado')}
              />
            </div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={confirmBrief}
                className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
              >
                {tt('Ajouter avec demande de validation', 'Add with approval request', 'Añadir con solicitud de validación')}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!briefDj) return;
                  onChange([...entries, {
                    djId: briefDj.id,
                    djUserId: briefDj.user_id,
                    name: djDisplayName(briefDj),
                    imageUrl: briefDj.profile_image_url,
                    status: 'draft_direct',
                  }]);
                  setBriefDj(null);
                }}
                className="w-full rounded-xl border border-border px-4 py-2 text-xs text-muted-foreground"
              >
                {tt('Ajouter sans validation (déjà convenu ensemble)', 'Add without approval (already agreed)', 'Añadir sin validación (ya acordado)')}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
