import { type Dispatch, type SetStateAction } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Ticket, Zap, Crown, Wine, Clock, Check, ArrowRight, ArrowLeft, Sparkles, FolderOpen } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { TicketSellingMode } from '@/types/ticketing';
import { RED, POS, GOLD, T1, T2, T3, C_FAINT, BORDER, TILE_BG, TILE, LABEL, DIALOG_SURFACE, DIALOG_TITLE, HINT } from './ticketing-ui';
import type { SalesDraft, TicketSalesMode, TicketPreset, WizardCustomRound } from './ticketing-types';

interface ActivationWizardDialogProps {
  isActivationWizardOpen: boolean;
  setIsActivationWizardOpen: (open: boolean) => void;
  wizardModeChange: boolean;
  setWizardModeChange: (v: boolean) => void;
  wizardStep: 1 | 2 | 2.5 | 3;
  setWizardStep: Dispatch<SetStateAction<1 | 2 | 2.5 | 3>>;
  wizardSellingMode: TicketSellingMode | null;
  setWizardSellingMode: Dispatch<SetStateAction<TicketSellingMode | null>>;
  wizardSelectedPresets: { standard?: string; vip?: string };
  setWizardSelectedPresets: Dispatch<SetStateAction<{ standard?: string; vip?: string }>>;
  wizardCustomRounds: WizardCustomRound[];
  setWizardCustomRounds: Dispatch<SetStateAction<WizardCustomRound[]>>;
  wizardSalesDraft: SalesDraft;
  setWizardSalesDraft: Dispatch<SetStateAction<SalesDraft>>;
  presets: TicketPreset[];
  handleWizardApplyModeChange: () => void;
  handleWizardPublish: () => void;
}

export function ActivationWizardDialog({
  isActivationWizardOpen,
  setIsActivationWizardOpen,
  wizardModeChange,
  setWizardModeChange,
  wizardStep,
  setWizardStep,
  wizardSellingMode,
  setWizardSellingMode,
  wizardSelectedPresets,
  setWizardSelectedPresets,
  wizardCustomRounds,
  setWizardCustomRounds,
  wizardSalesDraft,
  setWizardSalesDraft,
  presets,
  handleWizardApplyModeChange,
  handleWizardPublish,
}: ActivationWizardDialogProps) {
  const { t } = useLanguage();
  return (
        <Dialog open={isActivationWizardOpen} onOpenChange={(open) => { setIsActivationWizardOpen(open); if (!open) setWizardModeChange(false); }}>
          <DialogContent className="max-w-lg" style={DIALOG_SURFACE}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2" style={DIALOG_TITLE}>
                <Sparkles className="h-5 w-5" style={{ color: RED }} />
                {wizardModeChange ? t('tickets.changeModeTitle') : t('tickets.activationWizardTitle')}
              </DialogTitle>
              <DialogDescription style={HINT}>
                {wizardModeChange
                  ? t('tickets.changeModeDesc')
                  : t('tickets.wizardStepOf').replace('{step}', wizardStep.toString())}
              </DialogDescription>
            </DialogHeader>

            {/* Step indicators */}
            {!wizardModeChange && (
              <div className="flex items-center gap-2 pb-2">
                {[1, 2, 3].map((step) => (
                  <div key={step} className="flex items-center gap-2 flex-1">
                    <div
                      className="h-8 w-8 rounded-full flex items-center justify-center text-sm font-medium tabular-nums transition-colors flex-none"
                      style={
                        wizardStep === step ? { background: RED, color: '#fff' }
                        : wizardStep > step ? { background: 'rgba(232,25,44,0.15)', color: RED }
                        : { background: C_FAINT, color: T3 }
                      }
                    >
                      {wizardStep > step ? <Check className="h-4 w-4" /> : step}
                    </div>
                    {step < 3 && <div className="flex-1 h-0.5 rounded-full" style={{ background: wizardStep > step ? RED : C_FAINT }} />}
                  </div>
                ))}
              </div>
            )}

            {/* Step 1: Select Selling Mode */}
            {wizardStep === 1 && (
              <div className="space-y-4">
                <p style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{t('tickets.step1SelectMode')}</p>
                <div className="grid grid-cols-3 gap-3">
                  {([
                    { mode: 'simple' as TicketSellingMode, icon: <Ticket className="h-6 w-6" />, label: t('tickets.presetModeSimple'), desc: t('tickets.presetModeSimpleDesc') },
                    { mode: 'rounds' as TicketSellingMode, icon: <Zap className="h-6 w-6" />, label: t('tickets.presetModeRounds'), desc: t('tickets.presetModeRoundsDesc') },
                    { mode: 'timed_entry' as TicketSellingMode, icon: <Clock className="h-6 w-6" />, label: t('tickets.presetModeTimed'), desc: t('tickets.presetModeTimedDesc') },
                  ]).map(({ mode, icon, label, desc }) => {
                    const sel = wizardSellingMode === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => {
                          setWizardSellingMode(mode);
                          setWizardSelectedPresets({});
                        }}
                        className="flex flex-col items-center gap-3 p-4 rounded-xl transition-all duration-150 cursor-pointer"
                        style={sel
                          ? { border: '1px solid rgba(232,25,44,0.4)', background: 'rgba(232,25,44,0.07)' }
                          : { border: `1px solid ${BORDER}`, background: TILE_BG }}
                      >
                        <div className="h-12 w-12 rounded-full flex items-center justify-center transition-colors" style={sel ? { background: 'rgba(232,25,44,0.12)', color: RED } : { background: C_FAINT, color: T2 }}>
                          {icon}
                        </div>
                        <div className="text-center">
                          <div style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{label}</div>
                          <div style={HINT}>{desc}</div>
                        </div>
                        {sel && <Check className="h-4 w-4" style={{ color: RED }} />}
                      </button>
                    );
                  })}
                </div>
                <Button className="w-full" onClick={() => setWizardStep(2)} disabled={!wizardSellingMode} style={{ background: RED, color: '#fff' }}>
                  {t('common.next')} <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            )}

            {/* Step 2: Select Preset */}
            {wizardStep === 2 && (
              <div className="space-y-4">
                <p style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{t('tickets.step2SelectPreset')}</p>
                <p style={HINT}>{t('tickets.step2SelectPresetDesc')}</p>

                {/* Standard presets for this mode */}
                {(() => {
                  const modePresets = presets.filter(p => p.sellingMode === wizardSellingMode);
                  const standardPresets = modePresets.filter(p => p.ticketType === 'standard');
                  const vipPresets = modePresets.filter(p => p.ticketType === 'vip');

                  if (modePresets.length === 0) {
                    return (
                      <div className="text-center py-6">
                        <FolderOpen className="mx-auto h-10 w-10 mb-2" style={{ color: 'rgba(255,255,255,0.12)' }} />
                        <p style={{ color: T2, fontSize: 13 }}>{t('tickets.noPresetsForMode')}</p>
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-4 max-h-[300px] overflow-y-auto">
                      {standardPresets.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2" style={{ ...LABEL, fontSize: 11, color: T3 }}>
                            <Ticket className="h-3.5 w-3.5" />
                            {t('tickets.standardPresets')}
                          </div>
                          {standardPresets.map((preset) => {
                            const sel = wizardSelectedPresets.standard === preset.id;
                            return (
                              <div
                                key={preset.id}
                                className="cursor-pointer transition-all duration-150 p-3"
                                style={sel
                                  ? { borderRadius: 12, border: '1px solid rgba(232,25,44,0.5)', background: 'rgba(232,25,44,0.06)', boxShadow: '0 0 0 3px rgba(232,25,44,0.12)' }
                                  : { ...TILE }}
                                onClick={() => setWizardSelectedPresets(prev => ({
                                  ...prev,
                                  standard: prev.standard === preset.id ? undefined : preset.id,
                                }))}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="min-w-0">
                                    <span style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{preset.name}</span>
                                    <div style={HINT}>
                                      {preset.rounds.map(r => `${r.name} (${r.price}€)`).join(' · ')}
                                    </div>
                                  </div>
                                  {sel && (
                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-[11px] font-semibold flex-none" style={{ background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.3)', color: RED }}>
                                      <Check className="h-3 w-3 mr-1" />{t('tickets.selectedTemplate')}
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {vipPresets.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2" style={{ ...LABEL, fontSize: 11, color: GOLD }}>
                            <Crown className="h-3.5 w-3.5" />
                            {t('tickets.vipPresets')}
                          </div>
                          {vipPresets.map((preset) => {
                            const sel = wizardSelectedPresets.vip === preset.id;
                            return (
                              <div
                                key={preset.id}
                                className="cursor-pointer transition-all duration-150 p-3"
                                style={{
                                  borderRadius: 12,
                                  background: 'rgba(252,211,153,0.05)',
                                  border: sel ? '1px solid rgba(252,211,153,0.55)' : '1px solid rgba(252,211,153,0.18)',
                                  boxShadow: sel ? '0 0 0 3px rgba(252,211,153,0.15)' : undefined,
                                }}
                                onClick={() => setWizardSelectedPresets(prev => ({
                                  ...prev,
                                  vip: prev.vip === preset.id ? undefined : preset.id,
                                }))}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{preset.name}</span>
                                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold" style={{ background: 'rgba(252,211,153,0.12)', border: '1px solid rgba(252,211,153,0.3)', color: GOLD }}>VIP</span>
                                    </div>
                                    <div style={HINT}>
                                      {preset.rounds.map(r => `${r.name} (${r.price}€)`).join(' · ')}
                                    </div>
                                  </div>
                                  {sel && (
                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-[11px] font-semibold flex-none" style={{ background: 'rgba(252,211,153,0.14)', border: '1px solid rgba(252,211,153,0.3)', color: GOLD }}>
                                      <Check className="h-3 w-3 mr-1" />{t('tickets.selectedTemplate')}
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div className="flex gap-2 pt-2">
                  {!wizardModeChange && (
                    <Button variant="outline" onClick={() => setWizardStep(1)} style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T1 }}>
                      <ArrowLeft className="h-4 w-4 mr-2" /> {t('common.back')}
                    </Button>
                  )}
                  {wizardModeChange ? (
                    <>
                      <Button variant="outline" onClick={() => { setIsActivationWizardOpen(false); setWizardModeChange(false); }} style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T1 }}>
                        {t('common.cancel')}
                      </Button>
                      {(wizardSelectedPresets.standard || wizardSelectedPresets.vip) && (
                        <Button className="flex-1" onClick={handleWizardApplyModeChange} style={{ background: RED, color: '#fff' }}>
                          <Sparkles className="h-4 w-4 mr-2" />
                          {t('tickets.applyModeChange')}
                        </Button>
                      )}
                    </>
                  ) : (
                    <>
                      <Button variant="ghost" className="flex-1" style={{ color: T2 }} onClick={() => {
                        setWizardSelectedPresets({});
                        // Initialize a sensible default round draft for the guided builder
                        if (wizardCustomRounds.length === 0) {
                          if (wizardSellingMode === 'simple') {
                            setWizardCustomRounds([
                              { name: 'Standard', price: '', maxTickets: '', ticketType: 'standard', includesDrink: false },
                            ]);
                          } else {
                            setWizardCustomRounds([
                              { name: 'Early Birds', price: '', maxTickets: '', ticketType: 'standard', includesDrink: false },
                              { name: 'First Release', price: '', maxTickets: '', ticketType: 'standard', includesDrink: false },
                            ]);
                          }
                        }
                        setWizardStep(2.5);
                      }}>
                        {t('tickets.skipPreset')}
                      </Button>
                      {(wizardSelectedPresets.standard || wizardSelectedPresets.vip) && (
                        <Button className="flex-1" onClick={() => setWizardStep(3)} style={{ background: RED, color: '#fff' }}>
                          {t('common.next')} <ArrowRight className="h-4 w-4 ml-2" />
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Step 2.5: Guided Rounds Builder (when no preset selected) */}
            {wizardStep === 2.5 && (
              <div className="space-y-4">
                <div>
                  <p style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{t('owner.actw.buildTiers')}</p>
                  <p style={HINT}>
                    {wizardSellingMode === 'simple'
                      ? t('owner.actw.simpleDesc')
                      : wizardSellingMode === 'timed_entry'
                      ? t('owner.actw.timedDesc')
                      : t('owner.actw.roundsDesc')}
                  </p>
                </div>

                <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                  {wizardCustomRounds.map((round, idx) => (
                    <div key={idx} className="p-3 space-y-2" style={TILE}>
                        <div className="flex items-center justify-between">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}>
                            {wizardSellingMode === 'timed_entry'
                              ? t('owner.actw.slotLabel').replace('{idx}', String(idx + 1))
                              : t('owner.actw.tierLabel').replace('{idx}', String(idx + 1))}
                          </span>
                          {wizardCustomRounds.length > 1 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => setWizardCustomRounds(prev => prev.filter((_, i) => i !== idx))}
                              style={{ color: RED }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div className="col-span-2">
                            <Label className="text-xs">{t('owner.actw.nameLabel')}</Label>
                            <Input
                              className="mt-1 h-9"
                              value={round.name}
                              placeholder="Ex: Early Birds"
                              onChange={(e) => {
                                const v = e.target.value;
                                setWizardCustomRounds(prev => prev.map((r, i) => i === idx ? { ...r, name: v } : r));
                              }}
                            />
                          </div>
                          <div>
                            <Label className="text-xs">{t('owner.actw.priceLabel')}</Label>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              className="mt-1 h-9"
                              value={round.price}
                              placeholder="10"
                              onChange={(e) => {
                                const v = e.target.value;
                                setWizardCustomRounds(prev => prev.map((r, i) => i === idx ? { ...r, price: v } : r));
                              }}
                            />
                          </div>
                          {wizardSellingMode !== 'simple' && (
                            <div>
                              <Label className="text-xs">{t('owner.actw.quotaLabel')}</Label>
                              <Input
                                type="number"
                                min="1"
                                className="mt-1 h-9"
                                value={round.maxTickets}
                                placeholder="50"
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setWizardCustomRounds(prev => prev.map((r, i) => i === idx ? { ...r, maxTickets: v } : r));
                                }}
                              />
                            </div>
                          )}
                          {wizardSellingMode === 'timed_entry' && (
                            <div className="col-span-2">
                              <Label className="text-xs">{t('owner.actw.entryDeadlineLabel')}</Label>
                              <Input
                                type="datetime-local"
                                className="mt-1 h-9"
                                value={round.entryDeadline || ''}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setWizardCustomRounds(prev => prev.map((r, i) => i === idx ? { ...r, entryDeadline: v } : r));
                                }}
                              />
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-between pt-1">
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={round.ticketType === 'vip'}
                              onCheckedChange={(checked) => {
                                setWizardCustomRounds(prev => prev.map((r, i) => i === idx ? { ...r, ticketType: checked ? 'vip' : 'standard' } : r));
                              }}
                            />
                            <Label className="text-xs flex items-center gap-1">
                              {round.ticketType === 'vip' ? <Crown className="h-3 w-3" style={{ color: GOLD }} /> : <Ticket className="h-3 w-3" />}
                              {round.ticketType === 'vip' ? 'VIP' : 'Standard'}
                            </Label>
                          </div>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={round.includesDrink}
                              onCheckedChange={(checked) => {
                                setWizardCustomRounds(prev => prev.map((r, i) => i === idx ? { ...r, includesDrink: checked } : r));
                              }}
                            />
                            <Label className="text-xs flex items-center gap-1">
                              <Wine className="h-3 w-3" style={{ color: POS }} /> {t('owner.actw.includesDrink')}
                            </Label>
                          </div>
                        </div>
                    </div>
                  ))}
                </div>

                {wizardSellingMode !== 'simple' && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      setWizardCustomRounds(prev => [
                        ...prev,
                        { name: '', price: '', maxTickets: '', ticketType: 'standard', includesDrink: false },
                      ]);
                    }}
                    style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T1 }}
                  >
                    <Plus className="h-4 w-4 mr-2" /> {t('owner.actw.addTier')}
                  </Button>
                )}

                <div className="flex gap-2 pt-2">
                  <Button variant="outline" onClick={() => setWizardStep(2)} style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T1 }}>
                    <ArrowLeft className="h-4 w-4 mr-2" /> {t('common.back')}
                  </Button>
                  <Button
                    className="flex-1"
                    disabled={!wizardCustomRounds.some(r => r.name.trim() && r.price.trim() && (wizardSellingMode === 'simple' || r.maxTickets.trim()))}
                    onClick={() => setWizardStep(3)}
                    style={{ background: RED, color: '#fff' }}
                  >
                    {t('common.next')} <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step 3: Configure Sales Mode */}
            {wizardStep === 3 && (
              <div className="space-y-4">
                <p style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{t('tickets.step3ConfigureSales')}</p>
                <p style={HINT}>{t('tickets.step3ConfigureSalesDesc')}</p>


                <Select
                  value={wizardSalesDraft.mode}
                  onValueChange={(value) => {
                    const mode = value as TicketSalesMode;
                    setWizardSalesDraft(prev => ({
                      ...prev,
                      mode,
                      waitlistEnabled: mode !== 'normal',
                      presaleStartAt: mode === 'normal' ? '' : prev.presaleStartAt,
                      publicSaleStartAt: mode === 'normal' ? '' : prev.publicSaleStartAt,
                    }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="private">{t('tickets.salesMode.private')}</SelectItem>
                    <SelectItem value="presale">{t('tickets.salesMode.presale')}</SelectItem>
                    <SelectItem value="normal">{t('tickets.salesMode.normal')}</SelectItem>
                  </SelectContent>
                </Select>

                {wizardSalesDraft.mode === 'private' && (
                  <p style={HINT}>{t('tickets.privateModeHint')}</p>
                )}

                {wizardSalesDraft.mode === 'normal' && (
                  <p style={HINT}>{t('tickets.normalModeHint')}</p>
                )}

                {wizardSalesDraft.mode === 'presale' && (
                  <div className="space-y-3">
                    <p style={HINT}>{t('tickets.presaleModeHint')}</p>
                    <div>
                      <Label className="text-xs">{t('tickets.presaleMembersStart')}</Label>
                      <Input
                        type="datetime-local"
                        className="mt-1"
                        value={wizardSalesDraft.presaleStartAt}
                        onChange={(e) => setWizardSalesDraft(prev => ({ ...prev, presaleStartAt: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">{t('tickets.publicSaleStart')}</Label>
                      <Input
                        type="datetime-local"
                        className="mt-1"
                        value={wizardSalesDraft.publicSaleStartAt}
                        onChange={(e) => setWizardSalesDraft(prev => ({ ...prev, publicSaleStartAt: e.target.value }))}
                      />
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setWizardStep(wizardCustomRounds.length > 0 && !wizardSelectedPresets.standard && !wizardSelectedPresets.vip ? 2.5 : 2)} style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T1 }}>
                    <ArrowLeft className="h-4 w-4 mr-2" /> {t('common.back')}
                  </Button>
                  <Button className="flex-1" onClick={handleWizardPublish} style={{ background: RED, color: '#fff' }}>
                    <Sparkles className="h-4 w-4 mr-2" />
                    {t('tickets.publishTickets')}
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
  );
}
