import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { ResponsibilitiesPicker } from './ResponsibilitiesPicker';
import { normalizeResponsibilities, type CollabResponsibilities } from '@/utils/collabResponsibilities';

/**
 * Répartition « Qui fait quoi » PAR DÉFAUT pour un partenariat.
 *
 * Symétrique de `default_split_rules` : le partenariat porte déjà les conditions
 * financières par défaut, pré-remplies à chaque nouvelle collaboration. Un club
 * qui travaille toujours de la même façon avec un organisateur règle ainsi la
 * question une fois, au niveau de la RELATION, au lieu de la reprendre à chaque
 * soirée et à chaque série.
 *
 * Contrairement à l'argent, pas de flux de proposition / acceptation : ce défaut
 * n'engage personne. Il alimente la proposition, et c'est la SIGNATURE du
 * contrat qui engage. Changer une préférence de pré-remplissage ne touche à
 * aucun contrat déjà signé — le dialogue le dit explicitement, sinon on laisse
 * croire à un pouvoir qu'elle n'a pas.
 */
export function PartnershipResponsibilitiesDialog({
  open, onOpenChange, current, partnerName, onSave, isPending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  current: unknown;
  partnerName?: string | null;
  onSave: (next: CollabResponsibilities) => Promise<void> | void;
  isPending?: boolean;
}) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [value, setValue] = useState<CollabResponsibilities>(() => normalizeResponsibilities(current, 'co_event'));

  useEffect(() => {
    if (open) setValue(normalizeResponsibilities(current, 'co_event'));
  }, [open, current]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tt('Répartition par défaut', 'Default allocation', 'Reparto por defecto')}</DialogTitle>
          <DialogDescription>
            {partnerName
              ? tt(`Avec ${partnerName}`, `With ${partnerName}`, `Con ${partnerName}`)
              : tt('Pour ce partenariat', 'For this partnership', 'Para esta asociación')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <p className="rounded-lg border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
            {tt(
              "Ce réglage pré-remplit chaque nouvelle soirée et chaque nouvelle série montée avec ce partenaire. Il n'engage rien : seule la signature du contrat engage. Les collaborations déjà signées ne changent pas.",
              'This setting pre-fills every new event and series set up with this partner. It binds nothing: only signing the contract binds. Collaborations already signed do not change.',
              'Este ajuste prerrellena cada nueva noche y cada nueva serie con este socio. No vincula nada: solo la firma del contrato vincula. Las colaboraciones ya firmadas no cambian.',
            )}
          </p>

          <ResponsibilitiesPicker value={value} onChange={setValue} partnerName={partnerName} />
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            {tt('Annuler', 'Cancel', 'Cancelar')}
          </Button>
          <Button onClick={() => onSave(value)} disabled={isPending}>
            {isPending
              ? tt('Enregistrement…', 'Saving…', 'Guardando…')
              : tt('Enregistrer', 'Save', 'Guardar')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default PartnershipResponsibilitiesDialog;
