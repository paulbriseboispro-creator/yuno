import { useEffect, useState } from 'react';
import { Check, Edit, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/contexts/LanguageContext';
import { setGuestCount } from '@/lib/vipTableApi';
import { fillParams, guestCountValid } from '@/lib/vipManualRules';

interface GuestCountEditorProps {
  reservationId: string;
  /** Valeur vue à l'écran : le serveur refuse si un collègue l'a changée entre-temps (YU014). */
  guestCount: number;
  /** Faux pour une réservation terminée, annulée ou refusée. */
  editable: boolean;
  onChanged?: () => void;
}

/**
 * Nombre de convives d'une table, modifiable par la gestion de la soirée (vip_set_table_guest_count).
 * Les bornes (convives déjà entrés, capacité de la formule) sont jugées par le serveur et traduites par code.
 */
export function GuestCountEditor({ reservationId, guestCount, editable, onChanged }: GuestCountEditorProps) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(guestCount));
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!editing) setValue(String(guestCount)); }, [guestCount, editing]);

  const save = async () => {
    const n = parseInt(value, 10);
    if (!guestCountValid(n, 1, 50)) { toast.error(fillParams(t('tblm.guests.errRange'), { min: 1, max: 50 })); return; }
    if (n === guestCount) { setEditing(false); return; }
    setSaving(true);
    const res = await setGuestCount(reservationId, n, guestCount);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error ? fillParams(t(res.error.key), res.error.params) : t('tblm.err.generic'));
      if (res.error?.refresh) { setEditing(false); onChanged?.(); }
      return;
    }
    toast.success(t('tblm.guests.saved'));
    setEditing(false);
    onChanged?.();
  };

  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{t('tblm.guests.label')}</span>
      {editing ? (
        <div className="flex items-center gap-1.5">
          <Input
            type="number" min="1" max="50" step="1" inputMode="numeric"
            value={value} onChange={(e) => setValue(e.target.value)}
            className="h-8 w-20 text-right text-sm" disabled={saving}
            aria-label={t('tblm.guests.label')}
          />
          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={saving} onClick={save}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5 text-emerald-500" />}
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={saving} onClick={() => setEditing(false)}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="font-semibold tabular-nums">{guestCount}</span>
          {editable && (
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditing(true)} aria-label={t('tblm.guests.edit')}>
              <Edit className="w-3 h-3" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
