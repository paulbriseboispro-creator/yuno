import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TicketRound } from '@/types/ticketing';
import type { TicketGroup } from '@/lib/ticketGroups';
import { formatMoneyAuto } from '@/lib/money';
import { RED, T1, T2, T3, C_FAINT, BORDER, DIALOG_SURFACE, DIALOG_TITLE, HINT } from './ticketing-ui';

interface AddExistingTicketsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Le pack qui reçoit les billets. */
  group: TicketGroup | null;
  /** Tous les billets de la soirée. */
  tickets: TicketRound[];
  groups: TicketGroup[];
  onConfirm: (ticketIds: string[]) => Promise<void> | void;
}

// Ranger des billets déjà créés dans un pack : la liste propose d'abord ceux
// qui n'ont pas de pack, puis ceux d'un autre pack (ils changent de pack).
export function AddExistingTicketsDialog({ open, onOpenChange, group, tickets, groups, onConfirm }: AddExistingTicketsDialogProps) {
  const { t } = useLanguage();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) setSelected(new Set()); }, [open, group?.id]);

  const known = new Map(groups.map(g => [g.id, g]));
  const candidates = tickets.filter(r => r.groupId !== group?.id);
  const loose = candidates.filter(r => !r.groupId || !known.has(r.groupId));
  const elsewhere = candidates.filter(r => r.groupId && known.has(r.groupId));

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const submit = async () => {
    if (!selected.size) return;
    setSaving(true);
    try { await onConfirm([...selected]); } finally { setSaving(false); }
  };

  const row = (r: TicketRound) => {
    const from = r.groupId ? known.get(r.groupId) : null;
    return (
      <label key={r.id} className="flex items-center gap-3 rounded-lg px-3 py-2.5 cursor-pointer hover:bg-white/[0.04]" style={{ border: `1px solid ${BORDER}`, background: C_FAINT }}>
        <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} />
        <span className="flex-1 min-w-0">
          <span className="block truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{r.name}</span>
          <span className="block tabular-nums" style={{ color: T3, fontSize: 12 }}>
            {formatMoneyAuto(r.price)}
            {from && <> · {t('tickets.packs.currentlyIn').replace('{name}', from.name)}</>}
          </span>
        </span>
      </label>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" style={DIALOG_SURFACE}>
        <DialogHeader>
          <DialogTitle style={DIALOG_TITLE}>{t('tickets.packs.addExistingTitle').replace('{name}', group?.name ?? '')}</DialogTitle>
          <DialogDescription style={HINT}>{t('tickets.packs.addExistingHint')}</DialogDescription>
        </DialogHeader>

        {candidates.length === 0 ? (
          <p style={{ color: T2, fontSize: 13 }}>{t('tickets.packs.addExistingNone')}</p>
        ) : (
          <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
            {loose.map(row)}
            {elsewhere.length > 0 && loose.length > 0 && <div className="pt-1" style={{ color: T3, fontSize: 11 }}>{t('tickets.packs.addExistingOther')}</div>}
            {elsewhere.map(row)}
          </div>
        )}

        <div className="flex gap-2">
          <Button type="button" className="flex-1" disabled={saving || selected.size === 0} onClick={submit} style={{ background: RED, color: '#fff' }}>
            {selected.size > 0 ? t('tickets.packs.addExistingConfirm').replace('{n}', String(selected.size)) : t('tickets.packs.addExistingPick')}
          </Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T1 }}>
            {t('common.cancel')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
