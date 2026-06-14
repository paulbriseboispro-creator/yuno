import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { Button } from '@/components/ui/button';
import { CalendarDays, Plus, Clock, Megaphone, CheckCircle2 } from 'lucide-react';
import { OrgEventFormDialog } from '@/components/organizer-app/OrgEventFormDialog';

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
    <div className="space-y-6 max-w-xl">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <CalendarDays className="h-6 w-6 text-primary" />
          {tt('Votre premier événement', 'Your first event')}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          {tt(
            "Créez un événement pour ouvrir votre billetterie. Vous pourrez le modifier ensuite et le rendre public ou privé.",
            'Create an event to open ticket sales. You can edit it later and make it public or private.'
          )}
        </p>
      </div>

      {created ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5 flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">{tt('Événement créé 🎉', 'Event created 🎉')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {tt(
                'Vous pourrez le retrouver et le modifier depuis « Mes événements ».',
                'You can find and edit it anytime under "My events".'
              )}
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-3">
          <Item icon={Clock} title={tt('5 minutes pour démarrer', '5 minutes to launch')} desc={tt('Titre, date, billetterie, c\'est en ligne.', 'Title, date, tickets, you\'re live.')} />
          <Item icon={Megaphone} title={tt('Public ou privé', 'Public or private')} desc={tt('Visible dans Explore ou accessible par lien direct uniquement.', 'Listed in Explore or shared via direct link only.')} />
          <Item icon={CalendarDays} title={tt('Multiples événements', 'Multiple events')} desc={tt('Créez autant d\'événements que vous voulez depuis votre dashboard.', 'Create as many events as you want from your dashboard.')} />
        </div>
      )}

      <div className="flex gap-2">
        {created ? (
          <Button onClick={onComplete} className="flex-1" size="lg">
            {tt('Continuer', 'Continue')}
          </Button>
        ) : (
          <>
            <Button onClick={() => setDialogOpen(true)} className="flex-1" size="lg">
              <Plus className="h-4 w-4 mr-2" />
              {tt('Créer mon premier événement', 'Create my first event')}
            </Button>
            <Button onClick={onSkip} variant="ghost" size="lg">
              {tt('Plus tard', 'Later')}
            </Button>
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

function Item({ icon: Icon, title, desc }: { icon: any; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
      </div>
    </div>
  );
}
