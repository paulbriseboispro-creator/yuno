import { type Dispatch, type SetStateAction, type FormEvent } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Ticket, Save, Zap, Crown, Wine, Clock } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { TicketType, PresetSellingMode } from '@/types/ticketing';
import { RED, POS, GOLD, T1, T2, T3, C_FAINT, BORDER, TILE, DIALOG_SURFACE, DIALOG_TITLE, HINT } from './ticketing-ui';
import type { PresetFormData, TicketPreset } from './ticketing-types';

interface PresetDialogProps {
  isPresetDialogOpen: boolean;
  setIsPresetDialogOpen: (open: boolean) => void;
  setEditingPreset: (p: TicketPreset | null) => void;
  presetTicketType: TicketType;
  editingPreset: TicketPreset | null;
  presetSellingMode: PresetSellingMode;
  presetFormData: PresetFormData;
  setPresetFormData: Dispatch<SetStateAction<PresetFormData>>;
  handleSavePreset: (e: FormEvent) => void;
  getRemainingCapacity: () => number | null;
  getCurrentRoundsTotal: () => number;
  addPresetRound: () => void;
  removePresetRound: (index: number) => void;
  updatePresetRound: (index: number, field: string, value: string) => void;
  defaultRoundPlaceholders: { name: string; price: string; maxTickets: string }[];
}

export function PresetDialog({
  isPresetDialogOpen,
  setIsPresetDialogOpen,
  setEditingPreset,
  presetTicketType,
  editingPreset,
  presetSellingMode,
  presetFormData,
  setPresetFormData,
  handleSavePreset,
  getRemainingCapacity,
  getCurrentRoundsTotal,
  addPresetRound,
  removePresetRound,
  updatePresetRound,
  defaultRoundPlaceholders,
}: PresetDialogProps) {
  const { t } = useLanguage();
  return (
        <Dialog open={isPresetDialogOpen} onOpenChange={(open) => {
          setIsPresetDialogOpen(open);
          if (!open) setEditingPreset(null);
        }}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" style={DIALOG_SURFACE}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2" style={DIALOG_TITLE}>
                {presetTicketType === 'vip' && <Crown className="h-5 w-5" style={{ color: GOLD }} />}
                {editingPreset ? t('tickets.editPreset') : t('tickets.createPreset')}
                {presetTicketType === 'vip' && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold" style={{ background: 'rgba(252,211,153,0.12)', border: '1px solid rgba(252,211,153,0.3)', color: GOLD }}>VIP</span>}
              </DialogTitle>
              <DialogDescription style={HINT}>{editingPreset ? t('tickets.editPresetDesc') : t('tickets.createPresetDesc')}</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSavePreset} className="space-y-4">
              {/* Preset type & mode indicator */}
              <div className="p-3 rounded-xl" style={presetTicketType === 'vip' ? { background: 'rgba(252,211,153,0.06)', border: '1px solid rgba(252,211,153,0.22)' } : TILE}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {presetTicketType === 'vip' ? (
                      <>
                        <Crown className="h-4 w-4" style={{ color: GOLD }} />
                        <span style={{ color: GOLD, fontSize: 13.5, fontWeight: 560 }}>{t('tickets.vipPreset')}</span>
                      </>
                    ) : (
                      <>
                        <Ticket className="h-4 w-4" style={{ color: T3 }} />
                        <span style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{t('tickets.standardPreset')}</span>
                      </>
                    )}
                  </div>
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}>
                    {presetSellingMode === 'simple' ? (
                      <><Ticket className="h-3 w-3 mr-1" />{t('tickets.presetModeSimple')}</>
                    ) : presetSellingMode === 'timed_entry' ? (
                      <><Clock className="h-3 w-3 mr-1" />{t('tickets.presetModeTimed')}</>
                    ) : (
                      <><Zap className="h-3 w-3 mr-1" />{t('tickets.presetModeRounds')}</>
                    )}
                  </span>
                </div>
              </div>

              <div>
                <Label htmlFor="presetName">{t('tickets.presetName')}</Label>
                <Input
                  id="presetName"
                  value={presetFormData.name}
                  onChange={(e) => setPresetFormData({ ...presetFormData, name: e.target.value })}
                  placeholder={t('tickets.presetNamePlaceholder')}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="totalCapacity">{t('tickets.totalCapacity')}</Label>
                  <Input
                    id="totalCapacity"
                    type="number"
                    min="1"
                    value={presetFormData.totalCapacity}
                    onChange={(e) => setPresetFormData({ ...presetFormData, totalCapacity: e.target.value })}
                    placeholder="200"
                  />
                </div>
                <div>
                  <Label htmlFor="lastTicketsThreshold">{t('tickets.urgencyThreshold')}</Label>
                  <p style={{ ...HINT, marginBottom: 4 }}>{t('tickets.urgencyThresholdDesc')}</p>
                  <Input
                    id="lastTicketsThreshold"
                    type="number"
                    min="1"
                    max="50"
                    value={presetFormData.lastTicketsThreshold}
                    onChange={(e) => setPresetFormData({ ...presetFormData, lastTicketsThreshold: e.target.value })}
                    placeholder="20"
                  />
                </div>
              </div>

              {presetFormData.totalCapacity && (
                <div className="p-3" style={TILE}>
                  <div className="flex justify-between text-sm tabular-nums">
                    <span style={{ color: T2 }}>{t('tickets.allocated')}</span>
                    <span style={{ color: getRemainingCapacity() !== null && getRemainingCapacity()! < 0 ? RED : T1, fontWeight: 560 }}>
                      {getCurrentRoundsTotal()} / {presetFormData.totalCapacity}
                    </span>
                  </div>
                  {getRemainingCapacity() !== null && (
                    <div className="flex justify-between text-sm mt-1 tabular-nums" style={{ color: T3 }}>
                      <span>{t('tickets.remaining')}</span>
                      <span>{Math.max(0, getRemainingCapacity()!)}</span>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>{t('tickets.rounds')}</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addPresetRound}>
                    <Plus className="h-3 w-3 mr-1" />
                    {t('tickets.addRound')}
                  </Button>
                </div>

                {presetFormData.rounds.map((round, index) => {
                  const timedPlaceholders = [
                    { name: 'Early — avant 00h', price: '8', maxTickets: '20' },
                    { name: 'Main — avant 2h', price: '12', maxTickets: '80' },
                    { name: 'Late — avant 4h', price: '15', maxTickets: '100' },
                  ];
                  const placeholder = presetSellingMode === 'timed_entry'
                    ? (timedPlaceholders[index] || { name: `Slot ${index + 1}`, price: '10', maxTickets: '50' })
                    : (defaultRoundPlaceholders[index] || { name: `Round ${index + 1}`, price: '10', maxTickets: '50' });
                  return (
                    <div key={index} className="p-3 space-y-2" style={TILE}>
                      <div className="flex items-center justify-between">
                        <span style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>
                          {presetSellingMode === 'simple' ? `${t('tickets.options')} ${index + 1}` : presetSellingMode === 'timed_entry' ? `${t('tickets.slot')} ${index + 1}` : `Round ${index + 1}`}
                        </span>
                        {presetFormData.rounds.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => removePresetRound(index)}
                            style={{ color: RED }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                      <div className={`grid gap-2 ${presetSellingMode === 'simple' ? 'grid-cols-2' : presetSellingMode === 'timed_entry' ? 'grid-cols-2' : 'grid-cols-3'}`}>
                        <div>
                          <Label style={HINT}>{t('tickets.name')}</Label>
                          <Input
                            placeholder={placeholder.name}
                            value={round.name}
                            onChange={(e) => updatePresetRound(index, 'name', e.target.value)}
                          />
                        </div>
                        <div>
                          <Label style={HINT}>{t('tickets.priceLabel')}</Label>
                          <Input
                            type="number"
                            placeholder={placeholder.price + '€'}
                            value={round.price}
                            onChange={(e) => updatePresetRound(index, 'price', e.target.value)}
                          />
                        </div>
                        {presetSellingMode !== 'simple' && (
                          <div>
                            <Label style={HINT}>{t('tickets.placesLabel')}</Label>
                            <Input
                              type="number"
                              placeholder={placeholder.maxTickets}
                              value={round.maxTickets}
                              onChange={(e) => updatePresetRound(index, 'maxTickets', e.target.value)}
                            />
                          </div>
                        )}
                        {presetSellingMode === 'timed_entry' && (
                          <div>
                            <Label style={HINT}>{t('tickets.entryDeadline')}</Label>
                            <Input
                              type="time"
                              value={round.entryDeadline}
                              onChange={(e) => updatePresetRound(index, 'entryDeadline', e.target.value)}
                            />
                          </div>
                        )}
                      </div>
                      {/* Per-option drink toggle */}
                      <div className="flex items-center justify-between pt-1">
                        <Label className="text-xs flex items-center gap-1.5">
                          <Wine className="h-3 w-3" style={{ color: POS }} />
                          {t('tickets.includesDrink')}
                        </Label>
                        <Switch
                          checked={round.includesDrink}
                          onCheckedChange={(checked) => {
                            const newRounds = [...presetFormData.rounds];
                            newRounds[index] = { ...newRounds[index], includesDrink: checked };
                            setPresetFormData({ ...presetFormData, rounds: newRounds });
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Free Drink Settings for Preset */}
              <div className="space-y-3 pt-3" style={{ borderTop: `1px solid ${BORDER}` }}>
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="flex items-center gap-2">
                      <Wine className="h-4 w-4" style={{ color: POS }} />
                      {t('tickets.drinkSettingsPreset')}
                    </Label>
                    <p style={HINT}>{t('tickets.drinkSettingsPresetDesc')}</p>
                  </div>
                  <Switch
                    checked={presetFormData.includesDrink}
                    onCheckedChange={(checked) => setPresetFormData({ ...presetFormData, includesDrink: checked })}
                  />
                </div>

                {presetFormData.includesDrink && (
                  <div className="space-y-3 pl-4" style={{ borderLeft: '2px solid rgba(52,211,153,0.3)' }}>
                    <div>
                      <Label>{t('tickets.drinkDeadlineType')}</Label>
                      <Select
                        value={presetFormData.drinkDeadlineType}
                        onValueChange={(value: 'hours_after_start' | 'fixed_time' | 'none') =>
                          setPresetFormData({ ...presetFormData, drinkDeadlineType: value })
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

                    {presetFormData.drinkDeadlineType === 'hours_after_start' && (
                      <div>
                        <Label>{t('tickets.drinkDeadlineHours')}</Label>
                        <Input
                          type="number"
                          min="1"
                          max="12"
                          value={presetFormData.drinkDeadlineHours}
                          onChange={(e) => setPresetFormData({ ...presetFormData, drinkDeadlineHours: e.target.value })}
                          placeholder="2"
                        />
                      </div>
                    )}

                    {presetFormData.drinkDeadlineType === 'fixed_time' && (
                      <div>
                        <Label>{t('tickets.drinkCutoffTime')}</Label>
                        <p style={{ ...HINT, marginBottom: 4 }}>{t('tickets.drinkCutoffTimeDesc')}</p>
                        <Input
                          type="time"
                          value={presetFormData.drinkCutoffTime}
                          onChange={(e) => setPresetFormData({ ...presetFormData, drinkCutoffTime: e.target.value })}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Button type="submit" className="flex-1" style={{ background: RED, color: '#fff' }}>
                  <Save className="h-4 w-4 mr-2" />
                  {t('tickets.savePreset')}
                </Button>
                <Button type="button" variant="outline" onClick={() => setIsPresetDialogOpen(false)} style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T1 }}>
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
  );
}
