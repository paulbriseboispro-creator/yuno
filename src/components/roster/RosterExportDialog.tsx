// Dialogue « Imprimer / Exporter » — partagé par la guest list, les tables VIP
// et la billetterie.
//
// Trois formats, et le choix est guidé par le rôle : un videur ne veut pas d'un
// tableur, un organisateur ne veut pas d'une liste de noms sans montants. Les
// formats non pertinents ne sont pas grisés, ils ne sont pas proposés — c'est
// l'appelant qui décide via `formats`.
//
// Le CSV n'est PAS derrière le drapeau de plan `exports_csv` : ce drapeau garde
// l'extraction analytique (clients, CA), pas la feuille de porte d'une soirée.
// Une liste d'invités imprimée est un besoin d'exploitation, pas de la donnée
// qu'on siphonne.

import { useState } from 'react';
import { Printer, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { deliverRoster, type RosterDoc, type RosterFormat } from '@/lib/rosterExport';

export interface RosterEventChoice {
  id: string;
  label: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /**
   * Construit le document au moment du clic (données fraîches, pas au montage).
   * `eventId` est celui choisi dans le sélecteur quand la surface est
   * multi-soirées (page Commandes d'un club) ; absent sinon.
   */
  build: (format: RosterFormat, eventId?: string) => Promise<RosterDoc> | RosterDoc;
  /** Formats proposés, dans l'ordre. Défaut : les trois. */
  formats?: RosterFormat[];
  /** Titre du dialogue (« Imprimer la guest list »). */
  title?: string;
  /**
   * Soirées sélectionnables. Une seule (ou aucune) → pas de sélecteur : on
   * n'impose pas un choix qui n'en est pas un.
   */
  eventChoices?: RosterEventChoice[];
}

const META: Record<RosterFormat, { icon: typeof Printer; titleKey: string; descKey: string }> = {
  door:   { icon: Printer,         titleKey: 'roster.fmt.door',   descKey: 'roster.fmt.doorDesc' },
  detail: { icon: FileText,        titleKey: 'roster.fmt.detail', descKey: 'roster.fmt.detailDesc' },
  csv:    { icon: FileSpreadsheet, titleKey: 'roster.fmt.csv',    descKey: 'roster.fmt.csvDesc' },
  xlsx:   { icon: FileSpreadsheet, titleKey: 'roster.fmt.xlsx',   descKey: 'roster.fmt.xlsxDesc' },
};

export function RosterExportDialog({ open, onClose, build, formats, title, eventChoices }: Props) {
  const { t, language } = useLanguage();
  const [busy, setBusy] = useState<RosterFormat | null>(null);
  const [eventId, setEventId] = useState<string>(eventChoices?.[0]?.id ?? '');
  // Par défaut le tableur est un vrai .xlsx (Excel l'ouvre proprement, sans
  // assistant d'import) ; le CSV reste disponible pour qui le demande.
  const list = formats ?? (['door', 'detail', 'xlsx'] as RosterFormat[]);
  const needsPicker = (eventChoices?.length ?? 0) > 1;

  const run = async (format: RosterFormat) => {
    if (busy) return;
    setBusy(format);
    try {
      const doc = await build(format, needsPicker ? eventId : eventChoices?.[0]?.id);
      const printedAt = new Intl.DateTimeFormat(
        language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB',
        { dateStyle: 'short', timeStyle: 'short' },
      ).format(new Date());
      const outcome = await deliverRoster(doc, format, printedAt);
      if (outcome === 'downloaded') toast.success(t('roster.done'));
      else if (outcome === 'shared') toast.success(t('roster.shared'));
      else if (outcome === 'failed') toast.error(t('roster.failed'));
      if (outcome !== 'dismissed') onClose();
    } catch (err) {
      console.error('[roster] export failed', err);
      toast.error(t('roster.failed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title ?? t('roster.title')}</DialogTitle>
          <DialogDescription>{t('roster.subtitle')}</DialogDescription>
        </DialogHeader>

        {needsPicker && (
          <div>
            <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">
              {t('roster.pickEvent')}
            </label>
            <select
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
              disabled={!!busy}
              className="w-full rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm outline-none"
            >
              {eventChoices!.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>
        )}

        <div className="space-y-2">
          {list.map((f) => {
            const m = META[f];
            const Icon = m.icon;
            const active = busy === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => run(f)}
                disabled={!!busy}
                className={cn(
                  'w-full flex items-start gap-3 rounded-xl border p-3 text-left transition',
                  active ? 'border-primary/50 bg-primary/[0.07]' : 'border-border bg-muted/20 hover:bg-muted/40',
                  busy && !active && 'opacity-50',
                )}
              >
                <div className="mt-0.5 shrink-0">
                  {active ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : <Icon className="h-4 w-4 text-primary" />}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{t(m.titleKey)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t(m.descKey)}</p>
                </div>
              </button>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={!!busy}>{t('common.cancel')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
