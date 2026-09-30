/**
 * « Programmer l'annonce » d'une soirée (Shotgun : caler l'annonce sur son
 * post Instagram). L'annonce reste envoyée par Yuno, à ses abonnés, anciens
 * clients et fans des DJ ; seule l'HEURE de départ se choisit ici. Réservé aux
 * parties principales de la soirée (`set_event_announce_at` le revérifie).
 */
import { useEffect, useState } from 'react';
import { CalendarClock, Loader2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { KIT } from '@/components/analytics/kitFormat';
import { INNER_BG } from '@/components/event-report/tokens';
import { announceBounds, fromLocalInput, toLocalInput, type PushCenterEvent } from '@/lib/pushEngine';

export default function AnnounceScheduleDialog({ event, open, onOpenChange, onSaved }: {
  event: PushCenterEvent | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useLanguage();
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && event) setValue(toLocalInput(event.announceAt));
  }, [open, event]);

  if (!event) return null;
  const bounds = announceBounds(event.startAt);

  const save = async (at: string | null) => {
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('set_event_announce_at' as never, {
        p_event_id: event.id, p_at: at,
      } as never);
      if (error) throw error;
      const res = data as unknown as { ok: boolean; reason?: string } | null;
      if (!res?.ok) {
        const reason = res?.reason ?? 'error';
        toast.error(t(`pe.announce.err.${reason}`) === `pe.announce.err.${reason}` ? t('pe.announce.err.error') : t(`pe.announce.err.${reason}`));
        return;
      }
      toast.success(at ? t('pe.announce.savedAt') : t('pe.announce.savedAuto'));
      onOpenChange(false);
      onSaved();
    } catch {
      toast.error(t('pe.announce.err.error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarClock className="h-4 w-4" />{t('pe.announce.title')}</DialogTitle>
          <DialogDescription>{t('pe.announce.desc').replace('{event}', event.title)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block" style={{ color: KIT.T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
            {t('pe.announce.when')}
          </label>
          <input
            type="datetime-local"
            value={value}
            min={bounds.min}
            max={bounds.max}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-[10px] px-3 py-2.5 text-[13px] outline-none"
            style={{ background: INNER_BG, border: `1px solid ${KIT.BORDER}`, color: KIT.T1, colorScheme: 'dark' }}
          />
          <p style={{ color: KIT.T3, fontSize: 12, lineHeight: 1.5 }}>{t('pe.announce.help')}</p>
        </div>
        <div className="flex flex-wrap justify-between gap-2 pt-2">
          <Button variant="outline" onClick={() => save(null)} disabled={saving}>
            <Zap className="mr-2 h-4 w-4" />{t('pe.announce.auto')}
          </Button>
          <Button onClick={() => save(fromLocalInput(value))} disabled={saving || !fromLocalInput(value)}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarClock className="mr-2 h-4 w-4" />}
            {t('pe.announce.save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
