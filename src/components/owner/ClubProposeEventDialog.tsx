import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useVenuePartnerships, type VenueOrganizerPartnership } from '@/hooks/useOrganizerPartnerships';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatInTimeZone } from 'date-fns-tz';
import { PARIS_TIMEZONE } from '@/lib/timezone';
import { fr } from 'date-fns/locale';
import { Send, Building2, Users, Sparkles, Clock, Image as ImageIcon, User } from 'lucide-react';
import { ResponsibilitiesPicker } from '@/components/collab/ResponsibilitiesPicker';
import {
  defaultResponsibilities, normalizeResponsibilities, sameResponsibilities,
  type CollabResponsibilities,
} from '@/utils/collabResponsibilities';

type CollabMode = 'co_event' | 'venue_rental' | 'org_hosted';

interface ProposableEvent {
  id: string;
  title: string;
  description: string | null;
  poster_url: string | null;
  start_at: string;
  end_at: string;
  is_active: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  venueId: string;
  /** Pre-select an organizer (when launched from a partnership card). */
  preselectedOrganizerId?: string | null;
  onCreated?: () => void;
}

/**
 * Lets a venue owner propose one of its existing nights to an active organizer
 * partner — either an already-created event (published or draft) or, if none
 * fits, a freshly created draft — so the partner has something concrete to
 * review: image, title, description, schedule.
 *
 * Proposing links the chosen night to the partner: `partner_organizer_id = orga`
 * and `event_mode = chosen`. Publish state is left untouched (a draft stays a
 * draft until the organizer accepts; a live event keeps selling).
 */
export function ClubProposeEventDialog({ open, onOpenChange, venueId, preselectedOrganizerId, onCreated }: Props) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { partnerships } = useVenuePartnerships(venueId);
  const activePartners = partnerships.filter((p) => p.status === 'active');

  const [organizerId, setOrganizerId] = useState<string>(preselectedOrganizerId || '');
  const [mode, setMode] = useState<CollabMode>('co_event');
  // Axe RESPONSABILITES, independant du mode et des %. Voir collabResponsibilities.ts.
  const [responsibilities, setResponsibilities] = useState<CollabResponsibilities>(
    () => defaultResponsibilities('co_event'));
  // Choisir un organisateur applique la répartition convenue par défaut AVEC LUI
  // (venue_organizer_partnerships.default_responsibilities) — même logique que
  // les conditions financières, qui se pré-remplissent déjà depuis le partenariat.
  useEffect(() => {
    if (!organizerId) return;
    const p = activePartners.find(x => x.organizer_user_id === organizerId);
    const raw = (p as { default_responsibilities?: unknown } | undefined)?.default_responsibilities;
    if (raw) setResponsibilities(normalizeResponsibilities(raw, mode));
  }, [organizerId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [eventId, setEventId] = useState<string>('');
  const [options, setOptions] = useState<ProposableEvent[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [saving, setSaving] = useState(false);

  // Keep the pre-selected partner in sync when (re)opening from a card.
  useEffect(() => {
    if (open) setOrganizerId(preselectedOrganizerId || '');
  }, [open, preselectedOrganizerId]);

  // Load the owner's upcoming nights not yet linked to a partner — published
  // OR draft. Recurring co-events already carry a partner so they're excluded.
  useEffect(() => {
    if (!open || !venueId) return;
    let cancelled = false;
    setLoadingOptions(true);
    setEventId('');
    (async () => {
      const { data } = await supabase
        .from('events')
        .select('id, title, description, poster_url, start_at, end_at, is_active')
        .eq('venue_id', venueId)
        .is('partner_organizer_id', null)
        .gte('end_at', new Date().toISOString())
        .order('start_at', { ascending: true });
      if (cancelled) return;
      setOptions((data || []) as ProposableEvent[]);
      setLoadingOptions(false);
    })();
    return () => { cancelled = true; };
  }, [open, venueId]);

  const selectedEvent = options.find((d) => d.id === eventId) || null;
  const hasOptions = options.length > 0;

  const reset = () => {
    setOrganizerId(preselectedOrganizerId || '');
    setMode('co_event');
    setEventId('');
  };

  const goCreateDraft = () => {
    onOpenChange(false);
    navigate('/owner/events');
  };

  const handleSubmit = async () => {
    if (!user) return;
    if (!organizerId) {
      toast.error(t('proposeEvent.selectPartnerError'));
      return;
    }
    if (!eventId) {
      toast.error(t('proposeEvent.selectEventError'));
      return;
    }

    setSaving(true);
    try {
      // 1. Link the chosen night to the partner. Publish state stays as-is.
      const { error } = await supabase
        .from('events')
        .update({
          partner_organizer_id: organizerId,
          event_mode: mode,
          collab_responsibilities: responsibilities,
        })
        .eq('id', eventId)
        .eq('venue_id', venueId);
      if (error) throw error;

      // 2. Open a PENDING collaboration contract. create_event_collab_contract
      // pre-signs whichever side calls it — here the proposing club — and leaves
      // the contract in 'pending_signatures'. This is what makes "propose" a real
      // request: the partner must accept (sign) before the co-event can sell, and
      // sales stay blocked by the CONTRACT GUARD until they do. No more silent
      // auto-accept. Split defaults to the partnership's terms (NULL payload).
      // Called bound on `supabase` (never detach .rpc — see rpc-unbound gotcha).
      const { error: contractErr } = await supabase.rpc(
        'create_event_collab_contract' as never,
        {
          p_event_id: eventId,
          p_cancellation_policy: 'pro_rata_refund',
          p_responsibilities: responsibilities,
        } as never,
      );
      if (contractErr) {
        // Roll back the link so we never leave a half-formed co-event with no
        // contract (which would render as a misleading "active" partnership).
        await supabase.from('events')
          .update({ partner_organizer_id: null, event_mode: null, collab_responsibilities: null })
          .eq('id', eventId).eq('venue_id', venueId);
        throw contractErr;
      }

      // 3. Tell the organizer a proposal awaits review (email + web push).
      // Best-effort: the contract is the source of truth, so a failed notice
      // never blocks the proposal.
      try {
        await supabase.functions.invoke('notify-split-proposal', {
          body: { kind: 'event', id: eventId, action: 'proposed', proposer_side: 'venue' },
        });
      } catch (e) { console.warn('Propose notify failed:', e); }

      toast.success(t('proposeEvent.sentSuccess'), {
        description: t('proposeEvent.sentSuccessDesc'),
      });
      onCreated?.();
      reset();
      onOpenChange(false);
    } catch (err: any) {
      console.error('Propose event error:', err);
      toast.error(err.message || t('proposeEvent.createError'));
    } finally {
      setSaving(false);
    }
  };

  const orgLabel = (p: VenueOrganizerPartnership) =>
    (p.organizer?.organization_name
      ?? `${p.organizer?.first_name ?? ''} ${p.organizer?.last_name ?? ''}`.trim())
    || t('collab.organizer');

  const StatusBadge = ({ live }: { live: boolean }) => (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
      live
        ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-400'
        : 'bg-primary/10 border border-primary/25 text-primary'
    }`}>
      {live ? t('proposeEvent.liveBadge') : t('proposeEvent.draftBadge')}
    </span>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5 text-primary" />
            {t('proposeEvent.title')}
          </DialogTitle>
          <DialogDescription>
            {t('proposeEvent.subtitle')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Organizer selection */}
          <div className="space-y-1.5">
            <Label>{t('proposeEvent.partnerOrganizer')}</Label>
            {activePartners.length === 0 ? (
              <div className="rounded-md bg-muted/40 border border-border p-3 text-xs text-muted-foreground">
                {t('proposeEvent.noActivePartners')}
              </div>
            ) : (
              <Select value={organizerId} onValueChange={setOrganizerId}>
                <SelectTrigger><SelectValue placeholder={t('proposeEvent.chooseOrganizer')} /></SelectTrigger>
                <SelectContent>
                  {activePartners.map((p) => (
                    <SelectItem key={p.organizer_user_id} value={p.organizer_user_id}>
                      <span className="flex items-center gap-2">
                        {p.organizer?.avatar_url ? (
                          <img src={p.organizer.avatar_url} alt="" className="h-5 w-5 rounded-full object-cover" />
                        ) : (
                          <span className="h-5 w-5 rounded-full bg-muted flex items-center justify-center">
                            <User className="h-3 w-3 text-muted-foreground" />
                          </span>
                        )}
                        {orgLabel(p)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Event selection — pick an existing night or create a draft */}
          <div className="space-y-1.5">
            <Label>{t('proposeEvent.linkedEvent')}</Label>
            {loadingOptions ? (
              <div className="rounded-md bg-muted/40 border border-border p-3 text-xs text-muted-foreground">
                {t('collab.loading')}
              </div>
            ) : !hasOptions ? (
              <div className="rounded-md bg-muted/40 border border-border p-3 space-y-2.5">
                <p className="text-xs text-muted-foreground">{t('proposeEvent.noDrafts')}</p>
                <Button size="sm" variant="outline" onClick={goCreateDraft}>
                  <Sparkles className="h-4 w-4 mr-2" />
                  {t('proposeEvent.createDraftCta')}
                </Button>
              </div>
            ) : (
              <>
                <Select value={eventId} onValueChange={setEventId}>
                  <SelectTrigger><SelectValue placeholder={t('proposeEvent.chooseEvent')} /></SelectTrigger>
                  <SelectContent>
                    {options.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        <span className="flex items-center gap-2">
                          <span className="truncate">{d.title || t('proposeEvent.untitledEvent')}</span>
                          <span className="text-muted-foreground text-xs">
                            · {formatInTimeZone(new Date(d.start_at), PARIS_TIMEZONE, 'dd MMM', { locale: fr })}
                          </span>
                          <StatusBadge live={d.is_active} />
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  onClick={goCreateDraft}
                  className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                >
                  {t('proposeEvent.orCreateDraft')}
                </button>
              </>
            )}
          </div>

          {/* Preview — what the partner will see */}
          {selectedEvent && (
            <div className="rounded-lg border border-border bg-card/40 p-3 flex gap-3">
              {selectedEvent.poster_url ? (
                <img src={selectedEvent.poster_url} alt="" className="w-16 h-20 rounded-md object-cover flex-none border border-border" />
              ) : (
                <div className="w-16 h-20 rounded-md bg-muted flex items-center justify-center flex-none">
                  <ImageIcon className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0 flex-1 space-y-1.5">
                <StatusBadge live={selectedEvent.is_active} />
                <p className="font-semibold text-sm truncate">{selectedEvent.title || t('proposeEvent.untitledEvent')}</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Clock className="h-3 w-3 flex-none" />
                  {formatInTimeZone(new Date(selectedEvent.start_at), PARIS_TIMEZONE, 'dd MMM · HH:mm', { locale: fr })}
                  {' → '}
                  {formatInTimeZone(new Date(selectedEvent.end_at), PARIS_TIMEZONE, 'HH:mm', { locale: fr })}
                </p>
                {selectedEvent.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{selectedEvent.description}</p>
                )}
              </div>
            </div>
          )}

          {/* Collaboration mode */}
          <div className="space-y-2">
            <Label>{t('proposeEvent.collabMode')}</Label>
            <RadioGroup value={mode} onValueChange={(v) => {
              const next = v as CollabMode;
              // Changer de mode reamorce la repartition sur le prereglage du
              // nouveau mode, SAUF si elle a ete reglee a la main.
              setResponsibilities(prev =>
                sameResponsibilities(prev, defaultResponsibilities(mode))
                  ? defaultResponsibilities(next) : prev);
              setMode(next);
            }} className="space-y-2">
              <Label className="flex items-start gap-3 rounded-lg border border-border p-3 cursor-pointer hover:bg-card/40 has-[input:checked]:border-primary has-[input:checked]:bg-primary/5">
                <RadioGroupItem value="co_event" className="mt-1" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 font-medium text-sm">
                    <Sparkles className="h-4 w-4 text-primary" />
                    {t('coInv.modeCoEvent')}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t('proposeEvent.coEventDesc')}
                  </p>
                </div>
              </Label>
              <Label className="flex items-start gap-3 rounded-lg border border-border p-3 cursor-pointer hover:bg-card/40 has-[input:checked]:border-primary has-[input:checked]:bg-primary/5">
                <RadioGroupItem value="venue_rental" className="mt-1" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 font-medium text-sm">
                    <Building2 className="h-4 w-4 text-primary" />
                    {t('coInv.modeRental')}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t('proposeEvent.venueRentalDesc')}
                  </p>
                </div>
              </Label>
              <Label className="flex items-start gap-3 rounded-lg border border-border p-3 cursor-pointer hover:bg-card/40 has-[input:checked]:border-primary has-[input:checked]:bg-primary/5">
                <RadioGroupItem value="org_hosted" className="mt-1" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 font-medium text-sm">
                    <Users className="h-4 w-4 text-primary" />
                    {t('proposeEvent.orgHosted')}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t('proposeEvent.orgHostedDesc')}
                  </p>
                </div>
              </Label>
            </RadioGroup>
          </div>

          {/* Qui fait quoi — axe distinct du mode et du partage des revenus.
              C'est ici qu'on dit « le club tient l'operationnel, l'orga tient le
              design », ce que le mode seul ne savait pas exprimer. */}
          <ResponsibilitiesPicker
            value={responsibilities}
            onChange={setResponsibilities}
            partnerName={(() => {
              const p = activePartners.find(x => x.organizer_user_id === organizerId);
              return p ? orgLabel(p) : null;
            })()}
          />

          <div className="rounded-md bg-primary/5 border border-primary/20 p-3 text-xs text-muted-foreground">
            {t('proposeEvent.footerNote')}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>{t('common.cancel')}</Button>
          <Button onClick={handleSubmit} disabled={saving || !organizerId || !eventId}>
            <Send className="h-4 w-4 mr-2" />
            {saving ? t('proposeEvent.sending') : t('proposeEvent.sendProposal')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
