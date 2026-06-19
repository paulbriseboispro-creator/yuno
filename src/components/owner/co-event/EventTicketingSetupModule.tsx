import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Pencil, Trash2, Ticket, Crown, Wine, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * Configuration de la billetterie au niveau d'un event.
 *
 * Permet de créer/modifier/supprimer les rounds (paliers de billets) avec
 * type Standard ou VIP, prix, quota, et options d'inclusion d'une boisson.
 *
 * Utilisé côté co-event dashboard, partagé entre l'orga lead et le club partenaire.
 * RLS "Ticket rounds manageable by event managers" autorise les deux côtés.
 */

interface Props {
  eventId: string;
  readOnly?: boolean;
}

interface Round {
  id: string;
  event_id: string;
  name: string;
  price: number;
  max_tickets: number;
  tickets_sold: number;
  position: number;
  is_active: boolean;
  ticket_type: 'standard' | 'vip';
  includes_drink: boolean;
  drink_deadline_type: string | null;
  drink_deadline_hours: number | null;
  drink_cutoff_time: string | null;
}

export function EventTicketingSetupModule({ eventId, readOnly = false }: Props) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [ticketingEnabled, setTicketingEnabled] = useState(false);
  const [rounds, setRounds] = useState<Round[]>([]);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Round | null>(null);
  const [form, setForm] = useState({
    name: '',
    price: '',
    max_tickets: '50',
    is_active: true,
    ticket_type: 'standard' as 'standard' | 'vip',
    includes_drink: false,
    drink_deadline_type: 'fixed_time' as 'hours_after_start' | 'fixed_time' | 'none',
    drink_deadline_hours: '2',
    drink_cutoff_time: '02:00',
  });

  useEffect(() => { loadAll(); }, [eventId]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [{ data: ev }, { data: rs }] = await Promise.all([
        supabase.from('events').select('ticketing_enabled').eq('id', eventId).maybeSingle(),
        supabase.from('ticket_rounds').select('*').eq('event_id', eventId).order('position', { ascending: true }),
      ]);
      setTicketingEnabled(!!ev?.ticketing_enabled);
      setRounds((rs ?? []) as Round[]);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const enableTicketing = async () => {
    const { error } = await supabase.from('events').update({ ticketing_enabled: true }).eq('id', eventId);
    if (error) { toast.error(error.message); return; }
    toast.success(t('coEvent.ticketingEnabled'));
    loadAll();
  };

  const disableTicketing = async () => {
    if (!confirm(t('coEvent.confirmDisableTicketing'))) return;
    const { error } = await supabase.from('events').update({ ticketing_enabled: false }).eq('id', eventId);
    if (error) { toast.error(error.message); return; }
    toast.success(t('coEvent.ticketingDisabled'));
    loadAll();
  };

  const openDialog = (r: Round | null) => {
    setEditing(r);
    setForm(
      r
        ? {
            name: r.name,
            price: String(r.price),
            max_tickets: String(r.max_tickets),
            is_active: r.is_active,
            ticket_type: r.ticket_type,
            includes_drink: r.includes_drink ?? false,
            drink_deadline_type: (r.drink_deadline_type as any) ?? 'fixed_time',
            drink_deadline_hours: String(r.drink_deadline_hours ?? 2),
            drink_cutoff_time: r.drink_cutoff_time ?? '02:00',
          }
        : {
            name: '',
            price: '',
            max_tickets: '50',
            is_active: true,
            ticket_type: 'standard',
            includes_drink: false,
            drink_deadline_type: 'fixed_time',
            drink_deadline_hours: '2',
            drink_cutoff_time: '02:00',
          },
    );
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim() || !form.price) {
      toast.error(t('coEvent.nameAndPriceRequired'));
      return;
    }
    const payload: any = {
      event_id: eventId,
      name: form.name.trim(),
      price: parseFloat(form.price),
      max_tickets: parseInt(form.max_tickets) || 1,
      is_active: form.is_active,
      ticket_type: form.ticket_type,
      includes_drink: form.includes_drink,
      drink_deadline_type: form.includes_drink ? form.drink_deadline_type : 'none',
      drink_deadline_hours: form.includes_drink ? parseInt(form.drink_deadline_hours) : null,
      drink_cutoff_time: form.includes_drink && form.drink_deadline_type === 'fixed_time' ? form.drink_cutoff_time : null,
      auto_activate: true,
      last_tickets_threshold: 20,
      position: editing?.position ?? rounds.length,
    };
    const { error } = editing
      ? await supabase.from('ticket_rounds').update(payload).eq('id', editing.id)
      : await supabase.from('ticket_rounds').insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success(editing ? t('coEvent.roundUpdated') : t('coEvent.roundCreated'));
    setOpen(false);
    loadAll();
  };

  const remove = async (id: string) => {
    if (!confirm(t('owner.coev.confirmDeleteRound'))) return;
    const { error } = await supabase.from('ticket_rounds').delete().eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success(t('coEvent.roundDeleted')); loadAll(); }
  };

  if (loading) return <Card className="p-6 text-sm text-muted-foreground">{t('owner.coev.loading')}</Card>;

  if (!ticketingEnabled) {
    return (
      <Card className="p-6 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-semibold text-lg flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" /> {t('coEvent.ticketing')}
            </h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">
              {t('coEvent.ticketingDescFull')}
            </p>
          </div>
          {!readOnly && (
            <Button onClick={enableTicketing} size="sm">{t('coEvent.enableTicketing')}</Button>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold text-lg flex items-center gap-2">
            <Ticket className="h-5 w-5 text-primary" /> {t('coEvent.ticketingConfig')}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t('coEvent.sharedRoundsNote')}
          </p>
        </div>
        {!readOnly && (
          <Button variant="ghost" size="sm" onClick={disableTicketing}>{t('coEvent.disable')}</Button>
        )}
      </div>

      {!readOnly && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => openDialog(null)}>
            <Plus className="h-4 w-4 mr-1" /> {t('coEvent.newRound')}
          </Button>
        </div>
      )}

      {rounds.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          {t('coEvent.noRounds')}
        </p>
      ) : (
        <div className="space-y-2">
          {rounds.map((r) => (
            <div key={r.id} className="flex items-center justify-between p-3 rounded-lg border">
              <div className="flex items-start gap-3 min-w-0">
                {r.ticket_type === 'vip' ? (
                  <Crown className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
                ) : (
                  <Ticket className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                )}
                <div className="min-w-0">
                  <div className="font-medium text-sm flex flex-wrap items-center gap-1.5">
                    {r.name}
                    <span className="text-muted-foreground">— {Number(r.price).toFixed(2)}€</span>
                    {!r.is_active && <Badge variant="secondary" className="text-[10px]">{t('coEvent.inactive')}</Badge>}
                    {r.includes_drink && (
                      <Badge variant="outline" className="text-[10px] gap-0.5"><Wine className="h-2.5 w-2.5" /> {t('coEvent.plusDrink')}</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {r.tickets_sold}/{r.max_tickets} {t('coEvent.soldWord')} · {t('coEvent.typeWord')} {r.ticket_type}
                  </div>
                </div>
              </div>
              {!readOnly && (
                <div className="flex gap-1 flex-shrink-0">
                  <Button variant="ghost" size="icon" onClick={() => openDialog(r)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? t('coEvent.editRound') : t('coEvent.newRound')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t('common.name')}</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Early Birds" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t('coEvent.priceEur')}</Label>
                <Input type="number" min={0} step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
              </div>
              <div>
                <Label>{t('coEvent.quota')}</Label>
                <Input type="number" min={1} value={form.max_tickets} onChange={(e) => setForm({ ...form, max_tickets: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>{t('coEvent.type')}</Label>
              <select
                className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                value={form.ticket_type}
                onChange={(e) => setForm({ ...form, ticket_type: e.target.value as 'standard' | 'vip' })}
              >
                <option value="standard">Standard</option>
                <option value="vip">VIP</option>
              </select>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <div className="text-sm font-medium flex items-center gap-1.5">
                  <Wine className="h-4 w-4" /> {t('coEvent.includesDrink')}
                </div>
                <div className="text-xs text-muted-foreground">{t('coEvent.includesDrinkDesc')}</div>
              </div>
              <Switch checked={form.includes_drink} onCheckedChange={(v) => setForm({ ...form, includes_drink: v })} />
            </div>
            {form.includes_drink && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t('coEvent.deadlineType')}</Label>
                  <select
                    className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                    value={form.drink_deadline_type}
                    onChange={(e) => setForm({ ...form, drink_deadline_type: e.target.value as any })}
                  >
                    <option value="fixed_time">{t('coEvent.fixedTime')}</option>
                    <option value="hours_after_start">{t('coEvent.hoursAfterStart')}</option>
                    <option value="none">{t('coEvent.none')}</option>
                  </select>
                </div>
                {form.drink_deadline_type === 'fixed_time' ? (
                  <div>
                    <Label>{t('coEvent.before')}</Label>
                    <Input type="time" value={form.drink_cutoff_time} onChange={(e) => setForm({ ...form, drink_cutoff_time: e.target.value })} />
                  </div>
                ) : form.drink_deadline_type === 'hours_after_start' ? (
                  <div>
                    <Label>{t('coEvent.hours')}</Label>
                    <Input type="number" min={1} value={form.drink_deadline_hours} onChange={(e) => setForm({ ...form, drink_deadline_hours: e.target.value })} />
                  </div>
                ) : null}
              </div>
            )}
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="text-sm font-medium">{t('coEvent.roundActive')}</div>
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={save}>{editing ? t('common.save') : t('common.create')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
