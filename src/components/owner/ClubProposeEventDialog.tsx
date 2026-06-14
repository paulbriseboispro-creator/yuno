import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useVenuePartnerships } from '@/hooks/useOrganizerPartnerships';
import { fromParisTime } from '@/lib/timezone';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { Send, Building2, Users, Sparkles } from 'lucide-react';

type CollabMode = 'co_event' | 'venue_rental' | 'org_hosted';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  venueId: string;
  /** Pre-select an organizer (when launched from a partnership card). */
  preselectedOrganizerId?: string | null;
  onCreated?: () => void;
}

/**
 * Allows a venue owner to propose a new event night to one of its active
 * organizer partners. The event is created with `is_active=false` (pending),
 * `venue_id=mon_club`, `partner_organizer_id=orga`, and the chosen `event_mode`.
 *
 * The partner organizer sees it in their dashboard and activates it.
 */
export function ClubProposeEventDialog({ open, onOpenChange, venueId, preselectedOrganizerId, onCreated }: Props) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { partnerships } = useVenuePartnerships(venueId);
  const activePartners = partnerships.filter((p) => p.status === 'active');

  const [organizerId, setOrganizerId] = useState<string>(preselectedOrganizerId || '');
  const [mode, setMode] = useState<CollabMode>('co_event');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setOrganizerId(preselectedOrganizerId || '');
    setMode('co_event');
    setTitle('');
    setDescription('');
    setStartAt('');
    setEndAt('');
  };

  const handleSubmit = async () => {
    if (!user) return;
    if (!organizerId) {
      toast.error(t('proposeEvent.selectPartnerError'));
      return;
    }
    if (!title || !startAt || !endAt) {
      toast.error(t('proposeEvent.requiredFieldsError'));
      return;
    }
    if (new Date(endAt) <= new Date(startAt)) {
      toast.error(t('proposeEvent.endAfterStartError'));
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.from('events').insert({
        title,
        description: description || null,
        venue_id: venueId,
        partner_organizer_id: organizerId,
        event_mode: mode === 'co_event' ? 'co_event' : mode === 'venue_rental' ? 'venue_rental' : 'org_hosted',
        event_kind: 'public_event',
        start_at: fromParisTime(startAt).toISOString(),
        end_at: fromParisTime(endAt).toISOString(),
        is_active: false, // awaiting organizer acceptance
        music_genres: ['Open Format'],
        event_type: 'club',
      });
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
                  {activePartners.map((p) => {
                    const name = p.organizer?.organization_name
                      ?? `${p.organizer?.first_name ?? ''} ${p.organizer?.last_name ?? ''}`.trim()
                      ?? 'Organisateur';
                    return (
                      <SelectItem key={p.organizer_user_id} value={p.organizer_user_id}>
                        {name}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            )}
          </div>

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

          {/* Event details */}
          <div className="space-y-1.5">
            <Label>{t('proposeEvent.eventTitle')}</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Red Night vol. V" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('proposeEvent.start')}</Label>
              <Input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('proposeEvent.end')}</Label>
              <Input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t('proposeEvent.descLabel')}</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('proposeEvent.descPlaceholder')}
              rows={4}
            />
          </div>

          <div className="rounded-md bg-primary/5 border border-primary/20 p-3 text-xs text-muted-foreground">
            {t('proposeEvent.footerNote')}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>{t('common.cancel')}</Button>
          <Button onClick={handleSubmit} disabled={saving || activePartners.length === 0}>
            <Send className="h-4 w-4 mr-2" />
            {saving ? t('proposeEvent.sending') : t('proposeEvent.sendProposal')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
