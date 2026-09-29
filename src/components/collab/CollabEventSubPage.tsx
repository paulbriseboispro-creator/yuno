import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { OwnerHeader } from '@/components/OwnerHeader';
import { OrgCard, OrgPage, T1, T3, BORDER, INNER_BG } from '@/components/org-ui';
import { CollabBreadcrumb } from '@/components/collab/CollabTrail';
import { collabEventHref, sideOfPath, type CollabSide } from '@/lib/collabTrail';

export interface SubPageEvent {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  collab_responsibilities: unknown;
  event_mode: string | null;
}

/**
 * Coquille des pages filles d'une soirée à plusieurs (Ventes de la soirée, Qui
 * fait vendre ?) : même chrome que la page de la soirée (en-tête club / page
 * organisateur), pleine largeur, fil d'Ariane « Collaborations › Soirée ›
 * page » et un retour d'un clic. Le titre de la page EST la question.
 */
export function CollabEventSubPage({ title, question, sub, children }: {
  /** Nom court de la page, dans le fil d'Ariane et l'en-tête club. */
  title: string;
  /** Titre affiché : la question à laquelle la page répond. */
  question: string;
  sub: string;
  children: (event: SubPageEvent, side: CollabSide) => ReactNode;
}) {
  const { eventId } = useParams<{ eventId: string }>();
  const { pathname } = useLocation();
  const side = sideOfPath(pathname);
  const { language } = useLanguage();
  const t = (fr: string, en: string, es: string) => translate(language, fr, en, es);
  const [event, setEvent] = useState<SubPageEvent | null | undefined>(undefined);

  useEffect(() => {
    if (!eventId) return;
    let alive = true;
    supabase.from('events')
      .select('id, title, start_at, end_at, collab_responsibilities, event_mode')
      .eq('id', eventId).maybeSingle()
      .then(({ data }) => { if (alive) setEvent((data as SubPageEvent | null) ?? null); });
    return () => { alive = false; };
  }, [eventId]);

  const body = (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CollabBreadcrumb side={side} eventId={eventId ?? ''} title={event?.title ?? ''} current={title} />
        {eventId && (
          <Link to={collabEventHref(side, eventId)} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all duration-150 hover:opacity-90"
            style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, fontSize: 12.5, fontWeight: 600, textDecoration: 'none' }}>
            <ArrowLeft className="h-3.5 w-3.5" /> {t('Retour à la soirée', 'Back to the event', 'Volver al evento')}
          </Link>
        )}
      </div>
      <div>
        <h1 style={{ color: T1, fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>{question}</h1>
        <p className="mt-1" style={{ color: T3, fontSize: 13 }}>{sub}</p>
      </div>
      {event === undefined ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" style={{ color: T3 }} /></div>
      ) : event === null ? (
        <OrgCard><p className="p-8 text-center" style={{ color: T3, fontSize: 13 }}>{t('Soirée introuvable.', 'Event not found.', 'Evento no encontrado.')}</p></OrgCard>
      ) : children(event, side)}
    </div>
  );

  if (side === 'venue') {
    return (
      <div className="min-h-screen dashboard-gradient-bg">
        <OwnerHeader title={title} />
        <div className="mx-auto w-full max-w-[1680px] px-3 py-4 sm:px-6 sm:py-6 lg:px-8">{body}</div>
      </div>
    );
  }
  return <OrgPage className="mx-auto w-full max-w-[1680px] pt-4 sm:px-6 lg:px-8">{body}</OrgPage>;
}
