import { useEffect, useState, type FormEvent } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  TICKET_GROUP_DESCRIPTION_MAX, TICKET_GROUP_NAME_MAX, normalizeTicketGroupDescription, normalizeTicketGroupName,
  type TicketGroup,
} from '@/lib/ticketGroups';
import { RED, T1, C_FAINT, BORDER, DIALOG_SURFACE, DIALOG_TITLE, HINT } from './ticketing-ui';

interface TicketGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = nouveau pack. */
  group: TicketGroup | null;
  onSave: (values: { name: string; description: string | null }) => Promise<void> | void;
}

// Un pack de billets : un nom (en capitales sur la page de choix) et une phrase
// facultative qui dit ce qu'il donne. Les billets s'y rangent ensuite.
export function TicketGroupDialog({ open, onOpenChange, group, onSave }: TicketGroupDialogProps) {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(group?.name ?? '');
      setDescription(group?.description ?? '');
    }
  }, [open, group]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const cleanName = normalizeTicketGroupName(name);
    if (!cleanName) {
      toast.error(t('tickets.packs.nameRequired'));
      return;
    }
    setSaving(true);
    try {
      await onSave({ name: cleanName, description: normalizeTicketGroupDescription(description) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" style={DIALOG_SURFACE}>
        <DialogHeader>
          <DialogTitle style={DIALOG_TITLE}>{group ? t('tickets.packs.editTitle') : t('tickets.packs.createTitle')}</DialogTitle>
          <DialogDescription style={HINT}>{t('tickets.packs.dialogHint')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="packName">{t('tickets.packs.name')}</Label>
            <Input
              id="packName"
              value={name}
              maxLength={TICKET_GROUP_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('tickets.packs.namePlaceholder')}
              autoFocus
            />
          </div>
          <div>
            <div className="flex items-baseline justify-between">
              <Label htmlFor="packDescription">{t('tickets.packs.description')}</Label>
              <span className="tabular-nums" style={HINT}>{description.trim().length}/{TICKET_GROUP_DESCRIPTION_MAX}</span>
            </div>
            <Textarea
              id="packDescription"
              rows={2}
              value={description}
              maxLength={TICKET_GROUP_DESCRIPTION_MAX}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('tickets.packs.descriptionPlaceholder')}
            />
            <p style={{ ...HINT, marginTop: 4 }}>{t('tickets.packs.descriptionHint')}</p>
          </div>
          <div className="flex gap-2">
            <Button type="submit" className="flex-1" disabled={saving} style={{ background: RED, color: '#fff' }}>
              {group ? t('owner.update') : t('owner.create')}
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
