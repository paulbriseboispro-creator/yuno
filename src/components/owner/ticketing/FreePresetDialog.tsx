import { useEffect, useState, type FormEvent } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Wine, ChevronUp, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import type { DisplayChoice, FreePresetTicket, RelativeTime, SaleChoice } from '@/lib/freeTicketing';
import { RED, POS, T1, T3, C_FAINT, BORDER, TILE, LABEL, DIALOG_SURFACE, DIALOG_TITLE, HINT } from './ticketing-ui';
import { Choice } from './FreeChoice';

export interface FreePresetDraft {
  name: string;
  /** Jauge totale de la soirée, 0 = aucune. */
  totalCapacity: number;
  tickets: FreePresetTicket[];
}

interface FreePresetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Titre : création, modification, ou « Enregistrer comme modèle » depuis une soirée. */
  title: string;
  initial: FreePresetDraft;
  onSave: (draft: FreePresetDraft) => Promise<void> | void;
}

const DEFAULT_REL: RelativeTime = { daysBefore: 7, time: '20:00' };

/** « J-[n] à [HH:MM] » : une date comptée en jours avant le jour de la soirée. */
function RelativeInput({ value, onChange }: { value: RelativeTime; onChange: (v: RelativeTime) => void }) {
  const { t } = useLanguage();
  return (
    <div className="flex items-center gap-2" style={{ color: T3, fontSize: 12.5 }}>
      <span>J-</span>
      <Input
        type="number"
        min="0"
        max="365"
        className="h-8 w-16"
        value={value.daysBefore}
        onChange={(e) => onChange({ ...value, daysBefore: Math.max(0, parseInt(e.target.value, 10) || 0) })}
        aria-label={t('tickets.free.relDays')}
      />
      <span>{t('tickets.free.relAt')}</span>
      <Input type="time" className="h-8 w-28" value={value.time} onChange={(e) => onChange({ ...value, time: e.target.value })} />
    </div>
  );
}

const emptyTicket = (): FreePresetTicket => ({ name: '', price: 0, maxTickets: null, includesDrink: false, display: 'now', sale: 'now' });

// Modèle d'une billetterie LIBRE : les mêmes deux questions que sur une
// soirée, mais les dates sont RELATIVES (J-N à HH:MM, fuseau de la soirée)
// pour se rejouer sur n'importe quelle date (lib/freeTicketing).
export function FreePresetDialog({ open, onOpenChange, title, initial, onSave }: FreePresetDialogProps) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState<FreePresetDraft>(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setDraft(initial.tickets.length ? initial : { ...initial, tickets: [emptyTicket()] });
  }, [open, initial]);

  const setTicket = (i: number, p: Partial<FreePresetTicket>) =>
    setDraft((d) => ({ ...d, tickets: d.tickets.map((tk, j) => (j === i ? { ...tk, ...p } : tk)) }));
  const move = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      const list = [...d.tickets];
      const j = i + dir;
      if (j < 0 || j >= list.length) return d;
      [list[i], list[j]] = [list[j], list[i]];
      return { ...d, tickets: list };
    });

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const tickets = draft.tickets.filter((tk) => tk.name.trim());
    if (!draft.name.trim() || tickets.length === 0) {
      toast.error(t('tickets.fillRequired'));
      return;
    }
    setSaving(true);
    try {
      await onSave({
        ...draft,
        name: draft.name.trim(),
        tickets: tickets.map((tk) => ({
          ...tk,
          name: tk.name.trim(),
          visibleAt: tk.display === 'at' ? tk.visibleAt ?? DEFAULT_REL : null,
          saleStartAt: tk.sale === 'at' ? tk.saleStartAt ?? DEFAULT_REL : null,
        })),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" style={DIALOG_SURFACE}>
        <DialogHeader>
          <DialogTitle style={DIALOG_TITLE}>{title}</DialogTitle>
          <DialogDescription style={HINT}>{t('tickets.free.presetDesc')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Label htmlFor="freePresetName">{t('tickets.free.presetName')}</Label>
              <Input id="freePresetName" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder={t('tickets.free.presetNamePlaceholder')} />
            </div>
            <div>
              <Label htmlFor="freePresetCap">{t('tickets.globalCapacity')}</Label>
              <Input
                id="freePresetCap"
                type="number"
                min="0"
                value={draft.totalCapacity || ''}
                placeholder={t('tickets.free.quantityUnlimited')}
                onChange={(e) => setDraft((d) => ({ ...d, totalCapacity: Math.max(0, parseInt(e.target.value, 10) || 0) }))}
              />
            </div>
          </div>
          <p style={HINT}>{t('tickets.free.relHint')}</p>

          <div className="space-y-3">
            {draft.tickets.map((tk, i) => (
              <div key={i} className="p-3 space-y-3" style={TILE}>
                <div className="flex items-center gap-2">
                  <div className="flex flex-col flex-none">
                    <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('tickets.free.moveUp')} className="disabled:opacity-20" style={{ color: T3 }}><ChevronUp className="h-3.5 w-3.5" /></button>
                    <button type="button" disabled={i === draft.tickets.length - 1} onClick={() => move(i, 1)} aria-label={t('tickets.free.moveDown')} className="disabled:opacity-20" style={{ color: T3 }}><ChevronDown className="h-3.5 w-3.5" /></button>
                  </div>
                  <Input className="h-9 flex-1" value={tk.name} placeholder={t('tickets.free.namePlaceholder')} onChange={(e) => setTicket(i, { name: e.target.value })} aria-label={t('tickets.free.name')} />
                  <Input className="h-9 w-20" type="number" step="0.01" min="0" value={tk.price || ''} placeholder="€" onChange={(e) => setTicket(i, { price: parseFloat(e.target.value) || 0 })} aria-label={t('tickets.priceEuro')} />
                  <Input className="h-9 w-24" type="number" min="1" value={tk.maxTickets ?? ''} placeholder={t('tickets.free.quantityUnlimited')} onChange={(e) => { const n = parseInt(e.target.value, 10); setTicket(i, { maxTickets: n > 0 ? n : null }); }} aria-label={t('tickets.free.quantity')} />
                  {draft.tickets.length > 1 && (
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => setDraft((d) => ({ ...d, tickets: d.tickets.filter((_, j) => j !== i) }))} style={{ color: RED }}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                <div className="space-y-1.5">
                  <p style={{ ...LABEL, fontSize: 10.5 }}>{t('tickets.free.displayQ')}</p>
                  <Choice<DisplayChoice>
                    value={tk.display}
                    onChange={(display) => setTicket(i, { display, visibleAt: display === 'at' ? tk.visibleAt ?? DEFAULT_REL : tk.visibleAt })}
                    options={[
                      { value: 'now', label: t('tickets.free.display.now') },
                      { value: 'at', label: t('tickets.free.display.at') },
                      { value: 'hidden', label: t('tickets.free.display.hidden') },
                    ]}
                  />
                  {tk.display === 'at' && <RelativeInput value={tk.visibleAt ?? DEFAULT_REL} onChange={(visibleAt) => setTicket(i, { visibleAt })} />}
                </div>

                <div className="space-y-1.5">
                  <p style={{ ...LABEL, fontSize: 10.5 }}>{t('tickets.free.saleQ')}</p>
                  <Choice<SaleChoice>
                    value={tk.sale}
                    onChange={(sale) => setTicket(i, { sale, saleStartAt: sale === 'at' ? tk.saleStartAt ?? DEFAULT_REL : tk.saleStartAt })}
                    options={[
                      { value: 'now', label: t('tickets.free.sale.now') },
                      { value: 'at', label: t('tickets.free.sale.at') },
                      { value: 'manual', label: t('tickets.free.sale.manual') },
                    ]}
                  />
                  {tk.sale === 'at' && <RelativeInput value={tk.saleStartAt ?? DEFAULT_REL} onChange={(saleStartAt) => setTicket(i, { saleStartAt })} />}
                  <div className="flex items-center gap-2 pt-1">
                    <Switch checked={!!tk.saleEndAt} onCheckedChange={(on) => setTicket(i, { saleEndAt: on ? { daysBefore: 1, time: '23:59' } : null })} />
                    <span style={{ color: T1, fontSize: 12.5 }}>{t('tickets.free.saleEnd')}</span>
                  </div>
                  {tk.saleEndAt && <RelativeInput value={tk.saleEndAt} onChange={(saleEndAt) => setTicket(i, { saleEndAt })} />}
                </div>

                <div className="flex items-center gap-2">
                  <Switch
                    checked={tk.includesDrink}
                    onCheckedChange={(on) => setTicket(i, { includesDrink: on, drinkDeadlineType: on ? tk.drinkDeadlineType ?? 'none' : null })}
                  />
                  <span className="inline-flex items-center gap-1" style={{ color: T1, fontSize: 12.5 }}>
                    <Wine className="h-3.5 w-3.5" style={{ color: POS }} />{t('tickets.includesDrink')}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => setDraft((d) => ({ ...d, tickets: [...d.tickets, emptyTicket()] }))}
            style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T1 }}
          >
            <Plus className="h-4 w-4 mr-2" />{t('tickets.free.add')}
          </Button>

          <div className="flex gap-2">
            <Button type="submit" className="flex-1" disabled={saving} style={{ background: RED, color: '#fff' }}>
              {t('common.save')}
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T1 }}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
