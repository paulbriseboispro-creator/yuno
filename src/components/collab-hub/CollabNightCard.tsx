import { useNavigate } from 'react-router-dom';
import { ChevronRight, Handshake } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useNightStepLabel } from './useNightStepLabel';
import { translate } from '@/i18n/orgTranslate';
import { OrgCard, OrgPill, T1, T2, T3, BORDER, INNER_BG } from '@/components/org-ui';
import { CollabActionControls } from '@/components/collab/CollabActionControls';
import {
  collabNightStep, collabNightHref, NIGHT_STEP_TONE, type CollabNight,
} from '@/lib/collabHubNav';

type Side = 'venue' | 'organizer';

const PILL_TONE = { todo: 'default', waiting: 'muted', done: 'success', muted: 'muted' } as const;

/**
 * Une soirée à plusieurs, en une ligne : affiche, titre, date, avec qui, et UNE
 * pastille qui dit l'étape. Toute la carte ouvre la page qui répond (contrat ou
 * co-organisation). Les outils, les chiffres et la gestion (pause, suppression)
 * vivent sur cette page ; la carte ne remonte qu'une DEMANDE en cours de
 * l'autre partie, pour qu'elle ne se perde pas.
 */
export function CollabNightCard({ night, side, onChanged }: { night: CollabNight; side: Side; onChanged?: () => void }) {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const t = (fr: string, en: string, es: string) => translate(language, fr, en, es);
  const stepLabel = useNightStepLabel();
  const step = collabNightStep(night);
  const tone = step === 'paused' ? 'warn' : PILL_TONE[NIGHT_STEP_TONE[step]];
  const locale = language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB';
  const when = new Intl.DateTimeFormat(locale, {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris',
  }).format(new Date(night.startAt));
  const partners = night.partners.join(' · ');

  return (
    <OrgCard className="overflow-hidden">
      <button
        type="button"
        onClick={() => navigate(collabNightHref(night, side))}
        className="flex w-full cursor-pointer items-center gap-3 p-4 text-left transition-all duration-150 hover:bg-[rgb(var(--ink)/0.02)]"
      >
        {night.posterUrl ? (
          <img src={night.posterUrl} alt="" className="h-16 w-12 flex-none rounded-lg object-cover" style={{ border: `1px solid ${BORDER}` }} />
        ) : (
          <div className="flex h-16 w-12 flex-none items-center justify-center rounded-lg" style={{ background: INNER_BG }}>
            <Handshake className="h-5 w-5" style={{ color: T3 }} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate" style={{ color: T1, fontSize: 14.5, fontWeight: 650, letterSpacing: '-0.01em' }}>{night.title}</p>
          <p className="mt-0.5 capitalize" style={{ color: T3, fontSize: 11.5 }}>{when}</p>
          {partners && (
            <p className="mt-0.5 truncate" style={{ color: T2, fontSize: 12 }}>{t('Avec', 'With', 'Con')} {partners}</p>
          )}
        </div>
        <div className="flex flex-none items-center gap-2">
          <OrgPill tone={tone}>{stepLabel(step, night.partners[0] ?? '')}</OrgPill>
          <ChevronRight className="h-4 w-4" style={{ color: T3 }} />
        </div>
      </button>
      {night.collab && (
        // Demande de pause / suppression de l'autre partie : visible ici, sinon perdue.
        <CollabRequestSlot eventId={night.eventId} side={side} paused={night.collab.paused} onChanged={onChanged} />
      )}
    </OrgCard>
  );
}

function CollabRequestSlot({ eventId, side, paused, onChanged }: { eventId: string; side: Side; paused: boolean; onChanged?: () => void }) {
  return (
    // `empty:hidden` : sans demande en cours le composant ne rend rien, la marge disparaît.
    <div className="px-4 pb-3 empty:hidden">
      <CollabActionControls eventId={eventId} myRole={side} isPaused={paused} onChanged={onChanged} requestsOnly />
    </div>
  );
}
