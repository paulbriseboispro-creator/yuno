import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertTriangle, ArrowRight, Link2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { RENAME_COOLDOWN_DAYS } from '@/lib/renameGuard';

interface RenameLinkPreview {
  from: string;
  to: string;
}

interface RenameConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentName: string;
  newName: string;
  /** Liens publics impactés (aperçu ancien → nouveau). */
  links?: RenameLinkPreview[];
  onConfirm: () => void | Promise<void>;
  confirming?: boolean;
}

/**
 * Double vérification avant un renommage de profil public (agence, club,
 * orga, DJ, promoteur). Étape 1 : conséquences (les liens publics changent,
 * les anciens redirigent, verrou de 30 jours). Étape 2 : retaper le nouveau
 * nom pour confirmer. i18n inline 3 langues — composant autonome, utilisable
 * depuis n'importe quelle surface pro.
 */
export default function RenameConfirmDialog({
  open, onOpenChange, currentName, newName, links, onConfirm, confirming,
}: RenameConfirmDialogProps) {
  const { language } = useLanguage();
  const tr = (fr: string, en: string, es: string) =>
    language === 'fr' ? fr : language === 'es' ? es : en;

  const [step, setStep] = useState<1 | 2>(1);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (open) { setStep(1); setTyped(''); }
  }, [open]);

  const typedMatches = typed.trim() === newName.trim();

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!confirming) onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            {step === 1
              ? tr('Changer de nom ?', 'Change name?', '¿Cambiar el nombre?')
              : tr('Confirmation finale', 'Final confirmation', 'Confirmación final')}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-3 pt-1 text-sm text-left">
              <div className="flex items-center gap-2 font-medium text-foreground">
                <span className="truncate">{currentName}</span>
                <ArrowRight className="h-3.5 w-3.5 flex-none opacity-60" />
                <span className="truncate">{newName}</span>
              </div>
              {step === 1 ? (
                <>
                  <ul className="list-disc pl-4 space-y-1.5">
                    <li>
                      {tr(
                        'Vos liens publics changent immédiatement pour suivre le nouveau nom.',
                        'Your public links change immediately to match the new name.',
                        'Tus enlaces públicos cambian de inmediato para seguir el nuevo nombre.',
                      )}
                    </li>
                    <li>
                      {tr(
                        'Les anciens liens continuent de fonctionner : ils redirigent automatiquement.',
                        'Old links keep working: they redirect automatically.',
                        'Los enlaces antiguos siguen funcionando: redirigen automáticamente.',
                      )}
                    </li>
                    <li>
                      {tr(
                        `Prochain changement de nom possible dans ${RENAME_COOLDOWN_DAYS} jours.`,
                        `Next name change possible in ${RENAME_COOLDOWN_DAYS} days.`,
                        `Próximo cambio de nombre posible en ${RENAME_COOLDOWN_DAYS} días.`,
                      )}
                    </li>
                  </ul>
                  {links && links.length > 0 && (
                    <div className="rounded-lg border bg-muted/40 p-2.5 space-y-1.5">
                      {links.map((l) => (
                        <div key={l.from} className="flex items-center gap-1.5 text-xs font-mono">
                          <Link2 className="h-3 w-3 flex-none opacity-60" />
                          <span className="truncate line-through opacity-60">{l.from}</span>
                          <ArrowRight className="h-3 w-3 flex-none opacity-60" />
                          <span className="truncate">{l.to}</span>
                        </div>
                      ))}
                      <p className="text-[11px] leading-snug opacity-70 font-sans">
                        {tr(
                          'Aperçu — en cas de nom déjà pris, un suffixe (-2, -3…) est ajouté.',
                          'Preview — if the name is already taken, a suffix (-2, -3…) is added.',
                          'Vista previa: si el nombre ya está en uso, se añade un sufijo (-2, -3…).',
                        )}
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <p>
                    {tr(
                      'Pour confirmer, retapez exactement le nouveau nom :',
                      'To confirm, retype the new name exactly:',
                      'Para confirmar, vuelve a escribir el nuevo nombre exactamente:',
                    )}
                  </p>
                  <Input
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    placeholder={newName}
                    autoFocus
                    autoComplete="off"
                  />
                </>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={confirming}>
            {tr('Annuler', 'Cancel', 'Cancelar')}
          </Button>
          {step === 1 ? (
            <Button onClick={() => setStep(2)}>
              {tr('Continuer', 'Continue', 'Continuar')}
            </Button>
          ) : (
            <Button onClick={() => void onConfirm()} disabled={!typedMatches || confirming}>
              {confirming
                ? tr('Changement…', 'Changing…', 'Cambiando…')
                : tr('Confirmer le changement', 'Confirm the change', 'Confirmar el cambio')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
