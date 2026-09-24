/**
 * L'écran de mise en ligne d'une soirée — la déclinaison « publication » de
 * l'écran d'action commun (voir `components/action/ActionOverlay.tsx` pour la
 * mécanique et pour les trois règles qui garantissent qu'il ne ment jamais).
 *
 * Ses cinq lignes sont les cinq VRAIES étapes de `handleSubmit` : validation,
 * visuels, écriture de la ligne `events`, line-up ‖ partenaires, liste
 * rafraîchie. `PublishStage` compte celles que le serveur a terminées.
 */
import { useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { ActionNote, ActionOverlay, ActionResultCard, type ActionStep } from '@/components/action/ActionOverlay';

/** Nombre d'étapes RÉELLES déjà terminées — 0 au départ, 5 quand tout est écrit. */
export type PublishStage = 0 | 1 | 2 | 3 | 4 | 5;

export type PublishedEvent = {
  title: string;
  /** « Toulouse · sam. 26 sept. · 23:00 » — déjà formaté par l'appelant. */
  meta: string;
};

/** Rythme repris du prototype, ramené à ~3,6 s au total. */
const SECONDS = [0.6, 0.8, 0.75, 0.64, 0.86];

export function PublishingOverlay({
  open,
  stage,
  event,
  onViewEvent,
  onClose,
}: {
  open: boolean;
  stage: PublishStage;
  /** Renseigné seulement quand les cinq étapes sont passées. */
  event: PublishedEvent | null;
  /**
   * Absent = pas de bouton « Voir la page », et « Fermer » prend toute la
   * largeur. C'est le cas de l'onboarding : y envoyer quelqu'un sur la page
   * publique le sortirait de son parcours en cours.
   */
  onViewEvent?: () => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();

  const steps = useMemo<ActionStep[]>(
    () => SECONDS.map((seconds, i) => ({
      key: `s${i + 1}`,
      label: t(`owner.publish.s${i + 1}`),
      seconds,
    })),
    [t],
  );

  return (
    <ActionOverlay
      open={open}
      stage={stage}
      steps={steps}
      kicker={[t('owner.publish.kicker'), t('owner.publish.kickerDone')]}
      title={[t('owner.publish.title'), t('owner.publish.titleDone')]}
      finalWord={t('owner.publish.live')}
      primaryLabel={onViewEvent ? t('owner.publish.viewEvent') : undefined}
      onPrimary={onViewEvent}
      onClose={onClose}
      done={event ? (
        <ActionResultCard kicker={t('owner.publish.onMarketplace')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{
              fontSize: 'clamp(17px, 4vw, 20px)', fontWeight: 600, lineHeight: 1.2,
              letterSpacing: '-0.015em', color: 'rgba(255,255,255,0.96)', overflowWrap: 'anywhere',
            }}>{event.title}</div>
            {event.meta && <ActionNote>{event.meta}</ActionNote>}
          </div>
        </ActionResultCard>
      ) : null}
    />
  );
}
