import { type Dispatch, type SetStateAction, type FormEvent } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Wine } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Event } from '@/types';
import { TicketRound, TicketSellingMode } from '@/types/ticketing';
import { RED, T1, T3, C_FAINT, BORDER, TILE_BG, DIALOG_SURFACE, DIALOG_TITLE, HINT } from './ticketing-ui';
import type { RoundFormData } from './ticketing-types';

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

              {!(selectedEvent && ['timed_entry', 'simple'].includes(events.find(e => e.id === selectedEvent.id)?.ticketSellingMode || '')) && (
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

              {/* Free Drink Options */}
              <div className="space-y-3 pt-3" style={{ borderTop: `1px solid ${BORDER}` }}>
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="includesDrink">{t('tickets.includesDrink')}</Label>
                    <p style={HINT}>{t('tickets.includesDrinkDesc')}</p>
                  </div>
                  <Switch
                    id="includesDrink"
                    checked={roundFormData.includesDrink}
                    onCheckedChange={(checked) => setRoundFormData({ ...roundFormData, includesDrink: checked })}
                  />
                </div>

                {roundFormData.includesDrink && (
                  <div className="space-y-3 pl-4" style={{ borderLeft: `2px solid rgba(232,25,44,0.3)` }}>
                    <div>
                      <Label>{t('tickets.drinkDeadlineType')}</Label>
                      <Select
                        value={roundFormData.drinkDeadlineType}
                        onValueChange={(value: 'hours_after_start' | 'fixed_time' | 'none') =>
                          setRoundFormData({ ...roundFormData, drinkDeadlineType: value })
                        }
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t('tickets.drinkDeadlineNone')}</SelectItem>
                          <SelectItem value="hours_after_start">{t('tickets.hoursAfterStart')}</SelectItem>
                          <SelectItem value="fixed_time">{t('tickets.fixedTime')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {roundFormData.drinkDeadlineType === 'hours_after_start' && (
                      <div>
                        <Label htmlFor="drinkDeadlineHours">{t('tickets.drinkDeadlineHours')}</Label>
                        <p style={{ ...HINT, marginBottom: 4 }}>{t('tickets.drinkDeadlineHoursDesc')}</p>
                        <Input
                          id="drinkDeadlineHours"
                          type="number"
                          min="1"
                          max="12"
                          value={roundFormData.drinkDeadlineHours}
                          onChange={(e) => setRoundFormData({ ...roundFormData, drinkDeadlineHours: e.target.value })}
                          placeholder="2"
                        />
                      </div>
                    )}

                    {roundFormData.drinkDeadlineType === 'fixed_time' && (
                      <div>
                        <Label htmlFor="drinkCutoffTime">{t('tickets.drinkCutoffTime')}</Label>
                        <p style={{ ...HINT, marginBottom: 4 }}>{t('tickets.drinkCutoffTimeDesc')}</p>
                        <Input
                          id="drinkCutoffTime"
                          type="time"
                          value={roundFormData.drinkCutoffTime}
                          onChange={(e) => setRoundFormData({ ...roundFormData, drinkCutoffTime: e.target.value })}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Free Drink Mode - venue-level setting */}
              {roundFormData.includesDrink && (
                <div className="space-y-3 pt-3" style={{ borderTop: `1px solid ${BORDER}` }}>
                  <div>
                    <Label className="flex items-center gap-2 mb-1">
                      <Wine className="h-4 w-4" style={{ color: RED }} />
                      {t('tickets.freeDrinkMode')}
                    </Label>
                    <p className="mb-3" style={HINT}>{t('tickets.freeDrinkModeDesc')}</p>
                    <div className="space-y-2">
                      {([
                        { key: 'credits' as const, title: t('tickets.freeDrinkModeCredits'), desc: t('tickets.freeDrinkModeCreditsDesc') },
                        { key: 'bouncer_notify' as const, title: t('tickets.freeDrinkModeBouncer'), desc: t('tickets.freeDrinkModeBouncerDesc') },
                      ]).map((opt) => {
                        const sel = freeDrinkMode === opt.key;
                        return (
                          <label
                            key={opt.key}
                            className="flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-all duration-150"
                            style={sel
                              ? { border: '1px solid rgba(232,25,44,0.4)', background: 'rgba(232,25,44,0.08)' }
                              : { border: `1px solid ${BORDER}`, background: TILE_BG }}
                            onClick={async () => {
                              setFreeDrinkMode(opt.key);
                              if (venueId) await supabase.from('venues').update({ free_drink_mode: opt.key } as any).eq('id', venueId);
                            }}
                          >
                            <div className="mt-0.5 h-4 w-4 rounded-full border-2 flex items-center justify-center flex-none" style={{ borderColor: sel ? RED : T3 }}>
                              {sel && <div className="h-2 w-2 rounded-full" style={{ background: RED }} />}
                            </div>
                            <div className="flex-1">
                              <span style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{opt.title}</span>
                              <p style={HINT}>{opt.desc}</p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

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
