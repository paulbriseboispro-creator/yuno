import { type Dispatch, type SetStateAction, type FormEvent } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Users } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Event } from '@/types';
import { TicketRound, TicketSellingMode, type TicketAudience } from '@/types/ticketing';
import { RED, T1, C_FAINT, BORDER, DIALOG_SURFACE, DIALOG_TITLE, HINT } from './ticketing-ui';
import type { RoundFormData } from './ticketing-types';
import { DrinkOptionsFields } from './DrinkOptionsFields';

interface RoundDialogProps {
  isRoundDialogOpen: boolean;
  setIsRoundDialogOpen: (open: boolean) => void;
  editingRound: TicketRound | null;
  roundFormData: RoundFormData;
  setRoundFormData: Dispatch<SetStateAction<RoundFormData>>;
  selectedEvent: Event | null;
  events: { id: string; ticketSellingMode?: TicketSellingMode }[];
  freeDrinkMode: 'credits' | 'bouncer_notify';
  setFreeDrinkMode: (mode: 'credits' | 'bouncer_notify') => void;
  venueId?: string | null;
  handleSaveRound: (e: FormEvent) => void;
}

export function RoundDialog({
  isRoundDialogOpen,
  setIsRoundDialogOpen,
  editingRound,
  roundFormData,
  setRoundFormData,
  selectedEvent,
  events,
  freeDrinkMode,
  setFreeDrinkMode,
  venueId,
  handleSaveRound,
}: RoundDialogProps) {
  const { t } = useLanguage();
  return (
        <Dialog open={isRoundDialogOpen} onOpenChange={setIsRoundDialogOpen}>
          <DialogContent className="max-w-md" style={DIALOG_SURFACE}>
            <DialogHeader>
              <DialogTitle style={DIALOG_TITLE}>
                {editingRound ? t('tickets.editRound') : t('tickets.createRound')}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {editingRound ? t('tickets.editRound') : t('tickets.createRound')}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSaveRound} className="space-y-4">
              <div>
                <Label htmlFor="roundName">{t('tickets.roundName')}</Label>
                <Input
                  id="roundName"
                  value={roundFormData.name}
                  onChange={(e) => setRoundFormData({ ...roundFormData, name: e.target.value })}
                  placeholder="Early Birds, First Release..."
                />
              </div>

              <div className={`grid gap-4 ${selectedEvent && events.find(e => e.id === selectedEvent.id)?.ticketSellingMode === 'simple' ? 'grid-cols-1' : 'grid-cols-2'}`}>
                <div>
                  <Label htmlFor="roundPrice">{t('tickets.priceEuro')}</Label>
                  <Input
                    id="roundPrice"
                    type="number"
                    step="0.01"
                    min="0"
                    value={roundFormData.price}
                    onChange={(e) => setRoundFormData({ ...roundFormData, price: e.target.value })}
                    placeholder="10"
                  />
                </div>
                {!(selectedEvent && events.find(e => e.id === selectedEvent.id)?.ticketSellingMode === 'simple') && (
                  <div>
                    <Label htmlFor="roundMax">{t('tickets.maxTicketsRound')}</Label>
                    <Input
                      id="roundMax"
                      type="number"
                      min="1"
                      value={roundFormData.maxTickets}
                      onChange={(e) => setRoundFormData({ ...roundFormData, maxTickets: e.target.value })}
                      placeholder="100"
                    />
                  </div>
                )}
              </div>

              {/* Entry deadline (timed_entry mode only, not simple) */}
              {selectedEvent && events.find(e => e.id === selectedEvent.id)?.ticketSellingMode === 'timed_entry' && (
                <div>
                  <Label htmlFor="entryDeadline">{t('tickets.entryDeadline')}</Label>
                  <p style={{ ...HINT, marginBottom: 4 }}>{t('tickets.sellingModeTimedDesc')}</p>
                  <Input
                    id="entryDeadline"
                    type="time"
                    value={roundFormData.entryDeadline}
                    onChange={(e) => setRoundFormData({ ...roundFormData, entryDeadline: e.target.value })}
                  />
                </div>
              )}

              {!(selectedEvent && ['timed_entry', 'simple'].includes(events.find(e => e.id === selectedEvent.id)?.ticketSellingMode || '')) && roundFormData.audience === 'everyone' && (
                <>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="roundActive">{t('tickets.roundActive')}</Label>
                    <Switch
                      id="roundActive"
                      checked={roundFormData.isActive}
                      onCheckedChange={(checked) => setRoundFormData({ ...roundFormData, isActive: checked })}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="autoActivate">{t('tickets.autoActivate')}</Label>
                      <p style={HINT}>{t('tickets.autoActivateDesc')}</p>
                    </div>
                    <Switch
                      id="autoActivate"
                      checked={roundFormData.autoActivate}
                      onCheckedChange={(checked) => setRoundFormData({ ...roundFormData, autoActivate: checked })}
                    />
                  </div>
                </>
              )}

              {/* Marquer comme épuisé (manuel) — disponible dans tous les modes.
                  En mode rounds, si auto-activate est ON, marquer épuisé ouvre le round suivant. */}
              <div className="flex items-center justify-between pt-3" style={{ borderTop: `1px solid ${BORDER}` }}>
                <div className="pr-3">
                  <Label htmlFor="manuallySoldOut">{t('tickets.markSoldOut')}</Label>
                  <p style={HINT}>
                    {(() => {
                      const mode = selectedEvent ? events.find(e => e.id === selectedEvent.id)?.ticketSellingMode : undefined;
                      const isRounds = !mode || mode === 'rounds';
                      return isRounds && roundFormData.autoActivate
                        ? t('tickets.markSoldOutDescRounds')
                        : t('tickets.markSoldOutDesc');
                    })()}
                  </p>
                </div>
                <Switch
                  id="manuallySoldOut"
                  checked={roundFormData.manuallySoldOut}
                  onCheckedChange={(checked) => setRoundFormData({ ...roundFormData, manuallySoldOut: checked })}
                />
              </div>

              {/* Billet communauté : réservé aux abonnés du profil / de la newsletter.
                  La porte est serveur ; l'appel à l'action (suivre, s'abonner) est
                  généré automatiquement sous le tarif verrouillé côté client. */}
              <div className="space-y-2 pt-3" style={{ borderTop: `1px solid ${BORDER}` }}>
                <Label htmlFor="roundAudience" className="flex items-center gap-2">
                  <Users className="h-4 w-4" style={{ color: RED }} />
                  {t('tickets.audience')}
                </Label>
                <p style={HINT}>{t('tickets.audienceDesc')}</p>
                <Select
                  value={roundFormData.audience}
                  onValueChange={(value: TicketAudience) => setRoundFormData({ ...roundFormData, audience: value })}
                >
                  <SelectTrigger id="roundAudience" className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="everyone">{t('tickets.audienceEveryone')}</SelectItem>
                    <SelectItem value="followers">{t('tickets.audienceFollowers')}</SelectItem>
                    <SelectItem value="newsletter">{t('tickets.audienceNewsletter')}</SelectItem>
                    <SelectItem value="community">{t('tickets.audienceCommunity')}</SelectItem>
                  </SelectContent>
                </Select>
                {roundFormData.audience !== 'everyone' && (
                  <>
                    <p style={HINT}>{t('tickets.audienceCtaHint')}</p>
                    <p style={HINT}>{t('tickets.audienceSequenceHint')}</p>
                  </>
                )}
              </div>

              <div>
                <Label htmlFor="lastTicketsThreshold">{t('tickets.lastTicketsThreshold')}</Label>
                <p style={{ ...HINT, marginBottom: 8 }}>{t('tickets.lastTicketsThresholdDesc')}</p>
                <Input
                  id="lastTicketsThreshold"
                  type="number"
                  min="1"
                  max="50"
                  value={roundFormData.lastTicketsThreshold}
                  onChange={(e) => setRoundFormData({ ...roundFormData, lastTicketsThreshold: e.target.value })}
                  placeholder="20"
                />
              </div>

              <DrinkOptionsFields
                value={roundFormData}
                onChange={(patch) => setRoundFormData({ ...roundFormData, ...patch })}
                freeDrinkMode={freeDrinkMode}
                setFreeDrinkMode={setFreeDrinkMode}
                venueId={venueId}
              />

              <div className="flex gap-2">
                <Button type="submit" className="flex-1" style={{ background: RED, color: '#fff' }}>
                  {editingRound ? t('owner.update') : t('owner.create')}
                </Button>
                <Button type="button" variant="outline" onClick={() => setIsRoundDialogOpen(false)} style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T1 }}>
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
  );
}
