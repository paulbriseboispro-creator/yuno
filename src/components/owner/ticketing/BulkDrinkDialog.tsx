import { type Dispatch, type SetStateAction } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Wine, Ticket, Crown } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { RED, POS, GOLD, T1, C_FAINT, BORDER, DIALOG_SURFACE, DIALOG_TITLE, HINT } from './ticketing-ui';
import type { BulkDrinkFormData } from './ticketing-types';

interface BulkDrinkDialogProps {
  isBulkDrinkDialogOpen: boolean;
  setIsBulkDrinkDialogOpen: (open: boolean) => void;
  bulkDrinkFormData: BulkDrinkFormData;
  setBulkDrinkFormData: Dispatch<SetStateAction<BulkDrinkFormData>>;
  handleBulkAddDrink: () => void;
}

export function BulkDrinkDialog({
  isBulkDrinkDialogOpen,
  setIsBulkDrinkDialogOpen,
  bulkDrinkFormData,
  setBulkDrinkFormData,
  handleBulkAddDrink,
}: BulkDrinkDialogProps) {
  const { t } = useLanguage();
  return (
        <Dialog open={isBulkDrinkDialogOpen} onOpenChange={setIsBulkDrinkDialogOpen}>
          <DialogContent className="max-w-md" style={DIALOG_SURFACE}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2" style={DIALOG_TITLE}>
                <Wine className="h-5 w-5" style={{ color: POS }} />
                {t('tickets.bulkDrinkTitle')}
              </DialogTitle>
              <DialogDescription style={HINT}>{t('tickets.bulkDrinkDesc')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {/* Apply to which ticket types */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-2">
                    <Ticket className="h-4 w-4" />
                    {t('tickets.applyToStandard')}
                  </Label>
                  <Switch
                    checked={bulkDrinkFormData.applyToStandard}
                    onCheckedChange={(checked) => setBulkDrinkFormData({ ...bulkDrinkFormData, applyToStandard: checked })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-2">
                    <Crown className="h-4 w-4" style={{ color: GOLD }} />
                    {t('tickets.applyToVip')}
                  </Label>
                  <Switch
                    checked={bulkDrinkFormData.applyToVip}
                    onCheckedChange={(checked) => setBulkDrinkFormData({ ...bulkDrinkFormData, applyToVip: checked })}
                  />
                </div>
              </div>

              {/* Drink settings */}
              <div className="space-y-3 pt-3" style={{ borderTop: `1px solid ${BORDER}` }}>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>{t('tickets.includesDrink')}</Label>
                    <p style={HINT}>{t('tickets.includesDrinkDesc')}</p>
                  </div>
                  <Switch
                    checked={bulkDrinkFormData.includesDrink}
                    onCheckedChange={(checked) => setBulkDrinkFormData({ ...bulkDrinkFormData, includesDrink: checked })}
                  />
                </div>

                {bulkDrinkFormData.includesDrink && (
                  <div className="space-y-3 pl-4" style={{ borderLeft: '2px solid rgba(52,211,153,0.3)' }}>
                    <div>
                      <Label>{t('tickets.drinkDeadlineType')}</Label>
                      <Select
                        value={bulkDrinkFormData.drinkDeadlineType}
                        onValueChange={(value: 'hours_after_start' | 'fixed_time' | 'none') =>
                          setBulkDrinkFormData({ ...bulkDrinkFormData, drinkDeadlineType: value })
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

                    {bulkDrinkFormData.drinkDeadlineType === 'hours_after_start' && (
                      <div>
                        <Label>{t('tickets.drinkDeadlineHours')}</Label>
                        <Input
                          type="number"
                          min="1"
                          max="12"
                          value={bulkDrinkFormData.drinkDeadlineHours}
                          onChange={(e) => setBulkDrinkFormData({ ...bulkDrinkFormData, drinkDeadlineHours: e.target.value })}
                          placeholder="2"
                        />
                      </div>
                    )}

                    {bulkDrinkFormData.drinkDeadlineType === 'fixed_time' && (
                      <div>
                        <Label>{t('tickets.drinkCutoffTime')}</Label>
                        <p style={{ ...HINT, marginBottom: 4 }}>{t('tickets.drinkCutoffTimeDesc')}</p>
                        <Input
                          type="time"
                          value={bulkDrinkFormData.drinkCutoffTime}
                          onChange={(e) => setBulkDrinkFormData({ ...bulkDrinkFormData, drinkCutoffTime: e.target.value })}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Button onClick={handleBulkAddDrink} className="flex-1" style={{ background: RED, color: '#fff' }}>
                  <Wine className="h-4 w-4 mr-2" />
                  {t('owner.apply')}
                </Button>
                <Button variant="outline" onClick={() => setIsBulkDrinkDialogOpen(false)} style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T1 }}>
                  {t('common.cancel')}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
  );
}
