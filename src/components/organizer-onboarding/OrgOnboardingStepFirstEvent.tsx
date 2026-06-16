import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { CalendarDays, Plus, Clock, Megaphone, Check, ArrowRight, SkipForward, type LucideIcon } from 'lucide-react';
import { OrgEventFormDialog } from '@/components/organizer-app/OrgEventFormDialog';
import { StepHeader, PrimaryButton, GhostButton, InnerCard, DoneRow, RED, POS, T1, T3 } from '@/components/onboarding/onboardingUI';

interface Props {
  userId: string;
  onComplete: () => void;
  onSkip: () => void;
}

export function OrgOnboardingStepFirstEvent({ userId, onComplete, onSkip }: Props) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [created, setCreated] = useState(false);

  return (
    <div className="space-y-6">
      <StepHeader
        icon={CalendarDays}
        title={tt('Votre premier événement', 'Your first event')}
        subtitle={tt(
          'Créez un événement pour ouvrir votre billetterie. Modifiable ensuite, public ou privé.',
          'Create an event to open ticket sales. Editable later, public or private.',
        )}
      />

      {created ? (
        <DoneRow>
          <Check className="w-5 h-5 flex-none" style={{ color: POS }} />
          <div>
            <p style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{tt('Événement créé', 'Event created')}</p>
            <p style={{ color: T3, fontSize: 12, marginTop: 1 }}>{tt('Retrouvez-le et modifiez-le dans « Mes événements ».', 'Find and edit it under "My events".')}</p>
          </div>
        </DoneRow>
      ) : (
        <InnerCard>
          <div className="space-y-3.5">
            <Item icon={Clock} title={tt('5 minutes pour démarrer', '5 minutes to launch')} desc={tt("Titre, date, billetterie, c'est en ligne.", "Title, date, tickets, you're live.")} />
            <Item icon={Megaphone} title={tt('Public ou privé', 'Public or private')} desc={tt('Visible dans Explore ou accessible par lien direct.', 'Listed in Explore or shared via direct link.')} />
            <Item icon={CalendarDays} title={tt('Autant que vous voulez', 'As many as you want')} desc={tt('Créez d\'autres événements depuis votre dashboard.', 'Create more events from your dashboard.')} />
          </div>
        </InnerCard>
      )}

      <div className="flex gap-2.5">
        {created ? (
          <PrimaryButton fullWidth icon={ArrowRight} onClick={onComplete}>
            {tt('Continuer', 'Continue')}
          </PrimaryButton>
        ) : (
          <>
            <PrimaryButton fullWidth icon={Plus} onClick={() => setDialogOpen(true)}>
              {tt('Créer mon premier événement', 'Create my first event')}
            </PrimaryButton>
            <GhostButton icon={SkipForward} onClick={onSkip}>
              {tt('Plus tard', 'Later')}
            </GhostButton>
          </>
        )}
      </div>

      <OrgEventFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        organizerUserId={userId}
        eventId={null}
        onSaved={() => setCreated(true)}
      />
    </div>
  );
}

function Item({ icon: Icon, title, desc }: { icon: LucideIcon; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-none" style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}>
        <Icon className="w-4 h-4" style={{ color: RED }} />
      </div>
      <div>
        <div style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{title}</div>
        <div style={{ color: T3, fontSize: 12, marginTop: 1 }}>{desc}</div>
      </div>
    </div>
  );
}
