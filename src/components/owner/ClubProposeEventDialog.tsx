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

type CollabMode = 'co_event' | 'venue_rental' | 'org_hosted';

interface DraftEvent {
  id: string;
  title: string;
  description: string | null;
  poster_url: string | null;
  start_at: string;
  end_at: string;
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
 * Lets a venue owner propose one of its existing DRAFT nights to an active
 * organizer partner. The owner first creates a night (left unpublished) so the
 * partner has something concrete to review — image, title, description, schedule.
 *
 * Proposing links the draft to the partner: `partner_organizer_id = orga`,
 * `event_mode = chosen`, while `is_active` stays false until the organizer
 * accepts and publishes it from their dashboard.
 */
export function ClubProposeEventDialog({ open, onOpenChange, venueId, preselectedOrganizerId, onCreated }: Props) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { partnerships } = useVenuePartnerships(venueId);
  const activePartners = partnerships.filter((p) => p.status === 'active');

  const [organizerId, setOrganizerId] = useState<string>(preselectedOrganizerId || '');
  const [mode, setMode] = useState<CollabMode>('co_event');
  const [eventId, setEventId] = useState<string>('');
  const [drafts, setDrafts] = useState<DraftEvent[]>([]);
  const [loadingDrafts, setLoadingDrafts] = useState(true);
  const [saving, setSaving] = useState(false);

  // Keep the pre-selected partner in sync when (re)opening from a card.
  useEffect(() => {
    if (open) setOrganizerId(preselectedOrganizerId || '');
  }, [open, preselectedOrganizerId]);

  // Load the owner's draft nights that aren't linked to a partner yet.
  useEffect(() => {
    if (!open || !venueId) return;
    let cancelled = false;
    setLoadingDrafts(true);
    setEventId('');
    (async () => {
      const { data } = await supabase
        .from('events')
        .select('id, title, description, poster_url, start_at, end_at')
        .eq('venue_id', venueId)
        .eq('is_active', false)
        .is('partner_organizer_id', null)
        .order('start_at', { ascending: true });
      if (cancelled) return;
      setDrafts((data || []) as DraftEvent[]);
      setLoadingDrafts(false);
    })();
    return () => { cancelled = true; };
  }, [open, venueId]);

  const selectedDraft = drafts.find((d) => d.id === eventId) || null;
  const hasDrafts = drafts.length > 0;

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
      // Link the existing draft to the partner. is_active stays false until the
      // organizer accepts and publishes it from their dashboard.
      const { error } = await supabase
        .from('events')
        .update({
          partner_organizer_id: organizerId,
          event_mode: mode,
        })
        .eq('id', eventId)
        .eq('venue_id', venueId);
      if (error) throw error;

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

          {/* Draft event selection */}
          <div className="space-y-1.5">
            <Label>{t('proposeEvent.linkedEvent')}</Label>
            {loadingDrafts ? (
              <div className="rounded-md bg-muted/40 border border-border p-3 text-xs text-muted-foreground">
                {t('collab.loading')}
              </div>
            ) : !hasDrafts ? (
              <div className="rounded-md bg-muted/40 border border-border p-3 space-y-2.5">
                <p className="text-xs text-muted-foreground">{t('proposeEvent.noDrafts')}</p>
                <Button size="sm" variant="outline" onClick={goCreateDraft}>
                  <Sparkles className="h-4 w-4 mr-2" />
                  {t('proposeEvent.createDraftCta')}
                </Button>
              </div>
            ) : (
              <Select value={eventId} onValueChange={setEventId}>
                <SelectTrigger><SelectValue placeholder={t('proposeEvent.chooseEvent')} /></SelectTrigger>
                <SelectContent>
                  {drafts.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.title || t('proposeEvent.untitledEvent')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Draft preview — what the partner will see */}
          {selectedDraft && (
            <div className="rounded-lg border border-border bg-card/40 p-3 flex gap-3">
              {selectedDraft.poster_url ? (
                <img src={selectedDraft.poster_url} alt="" className="w-16 h-20 rounded-md object-cover flex-none border border-border" />
              ) : (
                <div className="w-16 h-20 rounded-md bg-muted flex items-center justify-center flex-none">
                  <ImageIcon className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0 flex-1 space-y-1.5">
                <span className="inline-block rounded bg-primary/10 border border-primary/25 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                  {t('proposeEvent.draftBadge')}
                </span>
                <p className="font-semibold text-sm truncate">{selectedDraft.title || t('proposeEvent.untitledEvent')}</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Clock className="h-3 w-3 flex-none" />
                  {formatInTimeZone(new Date(selectedDraft.start_at), PARIS_TIMEZONE, 'dd MMM · HH:mm', { locale: fr })}
                  {' → '}
                  {formatInTimeZone(new Date(selectedDraft.end_at), PARIS_TIMEZONE, 'HH:mm', { locale: fr })}
                </p>
                {selectedDraft.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{selectedDraft.description}</p>
                )}
              </div>
            </div>
          )}

          {/* Collaboration mode */}
          <div className="space-y-2">
            <Label>{t('proposeEvent.collabMode')}</Label>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as CollabMode)} className="space-y-2">
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

          <div className="rounded-md bg-primary/5 border border-primary/20 p-3 text-xs text-muted-foreground">
            {t('proposeEvent.footerNote')}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>{t('common.cancel')}</Button>
          <Button onClick={handleSubmit} disabled={saving || !hasDrafts || !organizerId || !eventId}>
            <Send className="h-4 w-4 mr-2" />
            {saving ? t('proposeEvent.sending') : t('proposeEvent.sendProposal')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
