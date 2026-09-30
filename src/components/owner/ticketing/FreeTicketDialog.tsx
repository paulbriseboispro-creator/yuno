import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Eye, ShoppingBag } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { TicketRound } from '@/types/ticketing';
import {
  UNLIMITED_TICKETS, displayChoiceOf, normalizeEntryDeadline, saleChoiceOf, scheduleColumns,
  type DisplayChoice, type SaleChoice,
} from '@/lib/freeTicketing';
import { RED, T1, C_FAINT, BORDER, DIALOG_SURFACE, DIALOG_TITLE, HINT } from './ticketing-ui';
import { toDateTimeLocalInput, toUtcIsoOrNull } from './ticketing-utils';
import { DrinkOptionsFields, type DrinkOptionsValue } from './DrinkOptionsFields';
import { Choice } from './FreeChoice';

/** Colonnes ticket_rounds écrites par le formulaire (hors event_id / position). */
export interface FreeTicketPatch {
  name: string;
  price: number;
  max_tickets: number;
  manually_sold_out: boolean;
  entry_deadline: string | null;
  includes_drink: boolean;
  drink_deadline_type: string | null;
  drink_deadline_hours: number | null;
  drink_cutoff_time: string | null;
  hidden: boolean;
  visible_from: string | null;
  is_active: boolean;
  sale_starts_at: string | null;
  sale_ends_at: string | null;
}

interface FreeTicketDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = nouveau billet. */
  ticket: TicketRound | null;
  onSave: (patch: FreeTicketPatch) => Promise<void> | void;
  freeDrinkMode: 'credits' | 'bouncer_notify';
  setFreeDrinkMode: (mode: 'credits' | 'bouncer_notify') => void;
  venueId?: string | null;
}

interface FormState extends DrinkOptionsValue {
  name: string;
  price: string;
  maxTickets: string;
  entryDeadline: string;
  manuallySoldOut: boolean;
  display: DisplayChoice;
  visibleFrom: string;
  sale: SaleChoice;
  saleStartsAt: string;
  saleEndsAt: string;
}

function initialState(ticket: TicketRound | null): FormState {
  const schedule = {
    isActive: ticket?.manuallySoldOut ? true : ticket?.isActive ?? true,
    hidden: ticket?.hidden,
    visibleFrom: ticket?.visibleFrom,
    saleStartsAt: ticket?.saleStartsAt,
  };
  return {
    name: ticket?.name ?? '',
    price: ticket ? String(ticket.price) : '',
    maxTickets: ticket && ticket.maxTickets < UNLIMITED_TICKETS ? String(ticket.maxTickets) : '',
    entryDeadline: normalizeEntryDeadline(ticket?.entryDeadline) ?? '',
    manuallySoldOut: ticket?.manuallySoldOut ?? false,
    includesDrink: ticket?.includesDrink ?? false,
    drinkDeadlineType: ticket?.drinkDeadlineType ?? 'none',
    drinkDeadlineHours: String(ticket?.drinkDeadlineHours ?? 2),
    drinkCutoffTime: ticket?.drinkCutoffTime ?? '02:00',
    display: ticket ? displayChoiceOf(schedule) : 'now',
    visibleFrom: toDateTimeLocalInput(ticket?.visibleFrom ?? undefined),
    sale: ticket ? saleChoiceOf(schedule) : 'now',
    saleStartsAt: toDateTimeLocalInput(ticket?.saleStartsAt ?? undefined),
    saleEndsAt: toDateTimeLocalInput(ticket?.saleEndsAt ?? undefined),
  };
}

function Question({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="space-y-2 pt-3" style={{ borderTop: `1px solid ${BORDER}` }}>
      <Label className="flex items-center gap-2">{icon}{title}</Label>
      {children}
    </div>
  );
}

// Billet de la billetterie LIBRE : aucune règle imposée, deux questions
// (quand on le voit, quand on l'achète). Règle de lecture : lib/freeTicketing.
export function FreeTicketDialog({ open, onOpenChange, ticket, onSave, freeDrinkMode, setFreeDrinkMode, venueId }: FreeTicketDialogProps) {
  const { t } = useLanguage();
  const [form, setForm] = useState<FormState>(() => initialState(ticket));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm(initialState(ticket));
  }, [open, ticket]);

  const patch = (p: Partial<FormState>) => setForm((prev) => ({ ...prev, ...p }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const price = parseFloat(form.price);
    if (!form.name.trim() || !Number.isFinite(price) || price < 0) {
      toast.error(t('tickets.fillRequired'));
      return;
    }
    const visibleFrom = form.display === 'at' ? toUtcIsoOrNull(form.visibleFrom) : null;
    const saleStartsAt = form.sale === 'at' ? toUtcIsoOrNull(form.saleStartsAt) : null;
    const saleEndsAt = toUtcIsoOrNull(form.saleEndsAt);
    if ((form.display === 'at' && !visibleFrom) || (form.sale === 'at' && !saleStartsAt)) {
      toast.error(t('tickets.free.dateRequired'));
      return;
    }
    if (saleStartsAt && saleEndsAt && Date.parse(saleEndsAt) <= Date.parse(saleStartsAt)) {
      toast.error(t('tickets.free.endBeforeStart'));
      return;
    }
    const qty = parseInt(form.maxTickets, 10);
    const schedule = scheduleColumns({ display: form.display, visibleFrom, sale: form.sale, saleStartsAt, saleEndsAt });
    setSaving(true);
    try {
      await onSave({
        name: form.name.trim(),
        price,
        max_tickets: Number.isFinite(qty) && qty > 0 ? qty : UNLIMITED_TICKETS,
        manually_sold_out: form.manuallySoldOut,
        entry_deadline: normalizeEntryDeadline(form.entryDeadline) ? `${normalizeEntryDeadline(form.entryDeadline)}:00` : null,
        includes_drink: form.includesDrink,
        drink_deadline_type: form.includesDrink ? form.drinkDeadlineType : null,
        drink_deadline_hours: form.includesDrink && form.drinkDeadlineType === 'hours_after_start' ? parseInt(form.drinkDeadlineHours, 10) || 2 : null,
        drink_cutoff_time: form.includesDrink && form.drinkDeadlineType === 'fixed_time' ? form.drinkCutoffTime : null,
        ...schedule,
        // Invariant du trigger SQL : un billet « Complet » n'est jamais actif.
        is_active: form.manuallySoldOut ? false : schedule.is_active,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto" style={DIALOG_SURFACE}>
        <DialogHeader>
          <DialogTitle style={DIALOG_TITLE}>{ticket ? t('tickets.free.editTitle') : t('tickets.free.createTitle')}</DialogTitle>
          <DialogDescription style={HINT}>{t('tickets.sellingModeFreeDesc')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="freeName">{t('tickets.free.name')}</Label>
            <Input id="freeName" value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder={t('tickets.free.namePlaceholder')} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="freePrice">{t('tickets.priceEuro')}</Label>
              <Input id="freePrice" type="number" step="0.01" min="0" value={form.price} onChange={(e) => patch({ price: e.target.value })} placeholder="10" />
            </div>
            <div>
              <Label htmlFor="freeQty">{t('tickets.free.quantity')}</Label>
              <Input id="freeQty" type="number" min="1" value={form.maxTickets} onChange={(e) => patch({ maxTickets: e.target.value })} placeholder={t('tickets.free.quantityUnlimited')} />
            </div>
          </div>

          {/* Heure limite d'entrée : la même règle que le mode Créneaux, appliquée
              à la porte (un billet arrivé après passe par « Accepter / Refuser »). */}
          <div>
            <Label htmlFor="freeEntry">{t('tickets.free.entryDeadline')}</Label>
            <div className="flex items-center gap-2 mt-1">
              <Input id="freeEntry" type="time" className="w-32" value={form.entryDeadline} onChange={(e) => patch({ entryDeadline: e.target.value })} />
              {form.entryDeadline && (
                <Button type="button" variant="ghost" size="sm" onClick={() => patch({ entryDeadline: '' })} style={{ color: T1 }}>
                  {t('tickets.free.entryDeadlineClear')}
                </Button>
              )}
            </div>
            <p style={{ ...HINT, marginTop: 4 }}>{t('tickets.free.entryDeadlineHint')}</p>
          </div>

          <Question icon={<Eye className="h-4 w-4" style={{ color: RED }} />} title={t('tickets.free.displayQ')}>
            <Choice<DisplayChoice>
              value={form.display}
              onChange={(display) => patch({ display })}
              options={[
                { value: 'now', label: t('tickets.free.display.now') },
                { value: 'at', label: t('tickets.free.display.at') },
                { value: 'hidden', label: t('tickets.free.display.hidden') },
              ]}
            />
            {form.display === 'at' && (
              <Input type="datetime-local" value={form.visibleFrom} onChange={(e) => patch({ visibleFrom: e.target.value })} aria-label={t('tickets.free.display.at')} />
            )}
            {form.display === 'hidden' && <p style={HINT}>{t('tickets.free.display.hiddenHint')}</p>}
          </Question>

          <Question icon={<ShoppingBag className="h-4 w-4" style={{ color: RED }} />} title={t('tickets.free.saleQ')}>
            <Choice<SaleChoice>
              value={form.sale}
              onChange={(sale) => patch({ sale })}
              options={[
                { value: 'now', label: t('tickets.free.sale.now') },
                { value: 'at', label: t('tickets.free.sale.at') },
                { value: 'manual', label: t('tickets.free.sale.manual') },
              ]}
            />
            {form.sale === 'at' && (
              <>
                <Input type="datetime-local" value={form.saleStartsAt} onChange={(e) => patch({ saleStartsAt: e.target.value })} aria-label={t('tickets.free.sale.at')} />
                <p style={HINT}>{t('tickets.free.sale.atHint')}</p>
              </>
            )}
            {form.sale === 'manual' && <p style={HINT}>{t('tickets.free.sale.manualHint')}</p>}
            <div className="pt-1">
              <Label htmlFor="freeEnd" style={{ fontSize: 12.5 }}>{t('tickets.free.saleEnd')}</Label>
              <Input id="freeEnd" type="datetime-local" className="mt-1" value={form.saleEndsAt} onChange={(e) => patch({ saleEndsAt: e.target.value })} />
              <p style={{ ...HINT, marginTop: 4 }}>{t('tickets.free.saleEndHint')}</p>
            </div>
          </Question>

          <DrinkOptionsFields
            value={form}
            onChange={(p) => patch(p)}
            freeDrinkMode={freeDrinkMode}
            setFreeDrinkMode={setFreeDrinkMode}
            venueId={venueId}
          />

          <div className="flex items-center justify-between pt-3" style={{ borderTop: `1px solid ${BORDER}` }}>
            <div className="pr-3">
              <Label htmlFor="freeSoldOut">{t('tickets.markSoldOut')}</Label>
              <p style={HINT}>{t('tickets.markSoldOutDesc')}</p>
            </div>
            <Switch id="freeSoldOut" checked={form.manuallySoldOut} onCheckedChange={(checked) => patch({ manuallySoldOut: checked })} />
          </div>

          <div className="flex gap-2">
            <Button type="submit" className="flex-1" disabled={saving} style={{ background: RED, color: '#fff' }}>
              {ticket ? t('owner.update') : t('owner.create')}
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
