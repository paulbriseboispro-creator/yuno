import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Ticket, Zap, Crown, Clock, ArrowLeft } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { TicketType, PresetSellingMode } from '@/types/ticketing';
import { T2, DIALOG_SURFACE, DIALOG_TITLE, HINT } from './ticketing-ui';

interface PresetTypeDialogProps {
  isPresetTypeDialogOpen: boolean;
  setIsPresetTypeDialogOpen: (open: boolean) => void;
  presetTypeStep: 'mode' | 'type';
  setPresetTypeStep: (step: 'mode' | 'type') => void;
  presetSellingMode: PresetSellingMode;
  handleSelectPresetMode: (mode: PresetSellingMode) => void;
  handleSelectPresetType: (ticketType: TicketType) => void;
}

export function PresetTypeDialog({
  isPresetTypeDialogOpen,
  setIsPresetTypeDialogOpen,
  presetTypeStep,
  setPresetTypeStep,
  presetSellingMode,
  handleSelectPresetMode,
  handleSelectPresetType,
}: PresetTypeDialogProps) {
  const { t } = useLanguage();
  return (
        <Dialog open={isPresetTypeDialogOpen} onOpenChange={(open) => {
          setIsPresetTypeDialogOpen(open);
          if (!open) setPresetTypeStep('mode');
        }}>
          <DialogContent className="max-w-sm" style={DIALOG_SURFACE}>
            {presetTypeStep === 'mode' ? (
              <>
                <DialogHeader>
                  <DialogTitle style={DIALOG_TITLE}>{t('tickets.selectPresetMode')}</DialogTitle>
                  <DialogDescription style={HINT}>{t('tickets.selectPresetModeDesc')}</DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-3 gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => handleSelectPresetMode('simple')}
                    className="flex flex-col items-center gap-3 p-4 rounded-xl border border-border hover:border-primary hover:bg-primary/5 transition-all group"
                  >
                    <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center group-hover:bg-primary/10 transition-colors">
                      <Ticket className="h-6 w-6 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                    <div className="text-center">
                      <div className="font-semibold text-sm">{t('tickets.presetModeSimple')}</div>
                      <div style={HINT}>{t('tickets.presetModeSimpleDesc')}</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectPresetMode('rounds')}
                    className="flex flex-col items-center gap-3 p-4 rounded-xl border border-border hover:border-primary hover:bg-primary/5 transition-all group"
                  >
                    <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center group-hover:bg-primary/10 transition-colors">
                      <Zap className="h-6 w-6 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                    <div className="text-center">
                      <div className="font-semibold text-sm">{t('tickets.presetModeRounds')}</div>
                      <div style={HINT}>{t('tickets.presetModeRoundsDesc')}</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectPresetMode('timed_entry')}
                    className="flex flex-col items-center gap-3 p-4 rounded-xl border border-border hover:border-primary hover:bg-primary/5 transition-all group"
                  >
                    <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center group-hover:bg-primary/10 transition-colors">
                      <Clock className="h-6 w-6 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                    <div className="text-center">
                      <div className="font-semibold text-sm">{t('tickets.presetModeTimed')}</div>
                      <div style={HINT}>{t('tickets.presetModeTimedDesc')}</div>
                    </div>
                  </button>
                </div>
              </>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle style={DIALOG_TITLE}>{t('tickets.selectPresetType')}</DialogTitle>
                  <DialogDescription style={HINT}>
                    {t('tickets.selectPresetTypeDesc')} — {presetSellingMode === 'simple' ? t('tickets.presetModeSimple') : presetSellingMode === 'timed_entry' ? t('tickets.presetModeTimed') : t('tickets.presetModeRounds')}
                  </DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-4 pt-2">
                  <button
                    type="button"
                    onClick={() => handleSelectPresetType('standard')}
                    className="flex flex-col items-center gap-3 p-6 rounded-xl border border-border hover:border-primary hover:bg-primary/5 transition-all group"
                  >
                    <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center group-hover:bg-primary/10 transition-colors">
                      <Ticket className="h-7 w-7 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                    <div className="text-center">
                      <div className="font-semibold">{t('tickets.standard')}</div>
                      <div style={HINT}>{t('tickets.standardDesc')}</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectPresetType('vip')}
                    className="flex flex-col items-center gap-3 p-6 rounded-xl border border-amber-500/30 hover:border-amber-500 hover:bg-amber-500/5 transition-all group"
                  >
                    <div className="h-14 w-14 rounded-full bg-amber-500/10 flex items-center justify-center group-hover:bg-amber-500/20 transition-colors">
                      <Crown className="h-7 w-7 text-amber-500" />
                    </div>
                    <div className="text-center">
                      <div className="font-semibold text-amber-500">VIP</div>
                      <div style={HINT}>{t('tickets.vipDesc')}</div>
                    </div>
                  </button>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setPresetTypeStep('mode')} className="mt-2 gap-1.5" style={{ color: T2 }}>
                  <ArrowLeft className="h-3.5 w-3.5" />
                  {t('common.back')}
                </Button>
              </>
            )}
          </DialogContent>
        </Dialog>
  );
}
