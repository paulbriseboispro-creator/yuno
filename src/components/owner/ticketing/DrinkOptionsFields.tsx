import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Wine } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { RED, T1, T3, BORDER, TILE_BG, HINT } from './ticketing-ui';
import { DRINKS_PILLAR_LIVE } from '@/lib/drinksPillar';

export interface DrinkOptionsValue {
  includesDrink: boolean;
  drinkDeadlineType: 'hours_after_start' | 'fixed_time' | 'none';
  drinkDeadlineHours: string;
  drinkCutoffTime: string;
}

interface DrinkOptionsFieldsProps {
  value: DrinkOptionsValue;
  onChange: (patch: Partial<DrinkOptionsValue>) => void;
  freeDrinkMode: 'credits' | 'bouncer_notify';
  setFreeDrinkMode: (mode: 'credits' | 'bouncer_notify') => void;
  venueId?: string | null;
}

// Boisson offerte avec le billet : même bloc pour un palier (RoundDialog) et
// un billet libre (FreeTicketDialog). Le mode de remise (crédits / videur) est
// un réglage du CLUB, écrit sur venues.free_drink_mode.
export function DrinkOptionsFields({ value, onChange, freeDrinkMode, setFreeDrinkMode, venueId }: DrinkOptionsFieldsProps) {
  const { t } = useLanguage();
  return (
    <>
              {/* Free Drink Options */}
              <div className="space-y-3 pt-3" style={{ borderTop: `1px solid ${BORDER}` }}>
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="includesDrink">{t('tickets.includesDrink')}</Label>
                    <p style={HINT}>{t('tickets.includesDrinkDesc')}</p>
                  </div>
                  <Switch
                    id="includesDrink"
                    checked={value.includesDrink}
                    onCheckedChange={(checked) => onChange({ includesDrink: checked })}
                  />
                </div>

                {value.includesDrink && (
                  <div className="space-y-3 pl-4" style={{ borderLeft: `2px solid rgba(232,25,44,0.3)` }}>
                    <div>
                      <Label>{t('tickets.drinkDeadlineType')}</Label>
                      <Select
                        value={value.drinkDeadlineType}
                        onValueChange={(v: 'hours_after_start' | 'fixed_time' | 'none') =>
                          onChange({ drinkDeadlineType: v })
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

                    {value.drinkDeadlineType === 'hours_after_start' && (
                      <div>
                        <Label htmlFor="drinkDeadlineHours">{t('tickets.drinkDeadlineHours')}</Label>
                        <p style={{ ...HINT, marginBottom: 4 }}>{t('tickets.drinkDeadlineHoursDesc')}</p>
                        <Input
                          id="drinkDeadlineHours"
                          type="number"
                          min="1"
                          max="12"
                          value={value.drinkDeadlineHours}
                          onChange={(e) => onChange({ drinkDeadlineHours: e.target.value })}
                          placeholder="2"
                        />
                      </div>
                    )}

                    {value.drinkDeadlineType === 'fixed_time' && (
                      <div>
                        <Label htmlFor="drinkCutoffTime">{t('tickets.drinkCutoffTime')}</Label>
                        <p style={{ ...HINT, marginBottom: 4 }}>{t('tickets.drinkCutoffTimeDesc')}</p>
                        <Input
                          id="drinkCutoffTime"
                          type="time"
                          value={value.drinkCutoffTime}
                          onChange={(e) => onChange({ drinkCutoffTime: e.target.value })}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Free Drink Mode - venue-level setting. Pilier boissons en pause
                  (src/lib/drinksPillar.ts) : la boisson offerte se gère à la porte,
                  le mode « crédits au bar » n'est plus proposé. */}
              {DRINKS_PILLAR_LIVE && value.includesDrink && (
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
                              if (venueId) await supabase.from('venues').update({ free_drink_mode: opt.key }).eq('id', venueId);
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
    </>
  );
}
