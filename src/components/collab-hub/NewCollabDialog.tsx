import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatInTimeZone } from 'date-fns-tz';
import { enUS, es, fr } from 'date-fns/locale';
import { CalendarPlus, CalendarRange, ChevronRight, Loader2, Lock, type LucideIcon } from 'lucide-react';
import { InviteToEventStep } from './InviteToEventStep';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { PARIS_TIMEZONE } from '@/lib/timezone';
import { RED, T1, T2, T3, BORDER, INNER_BG } from '@/components/org-ui';
import type { CoorgScope } from '@/lib/coorg';

export interface CollabPreselect {
  /** `venue:<id>` ou `org:<uuid>` — quelqu'un de l'annuaire à inviter. */
  key: string;
  name: string;
}

/**
 * « Nouvelle collaboration » — la seule porte d'entrée du hub (plan
 * `docs/designs/COLLAB_OPEN_INVITE_PLAN.md`). Une collaboration, c'est une
 * soirée où l'on invite des clubs et des organisations : la seule question
 * est donc « quelle soirée ? ». Les deux chemins ouvrent le formulaire de la
 * soirée sur « Avec qui ? », là où l'on choisit qui inviter et avec quel rôle.
 * Aucun partenariat préalable : n'importe quel club ou organisation, sur Yuno
 * ou par email.
 */
export function NewCollabDialog({ open, onOpenChange, scope, basePath, canCreate, preselect, onInvited }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  scope: CoorgScope | null;
  basePath: string;
  /** Faux pour un club au plan Collaboration : il reçoit des soirées, il n'en crée pas. */
  canCreate: boolean;
  preselect?: CollabPreselect | null;
  onInvited?: () => void;
}) {
  const { language } = useLanguage();
  const t = (frS: string, en: string, esS: string) => translate(language, frS, en, esS);
  const navigate = useNavigate();
  const [pickEvent, setPickEvent] = useState(false);
  const [inviteEventId, setInviteEventId] = useState<string | null>(null);
  const [events, setEvents] = useState<{ id: string; title: string; start_at: string }[] | null>(null);

  useEffect(() => { if (!open) { setPickEvent(false); setEvents(null); setInviteEventId(null); } }, [open]);

  useEffect(() => {
    if (!pickEvent || events || !scope) return;
    let active = true;
    // Les soirées que JE mène : c'est le lead qui invite le lieu / l'organisateur.
    const q = supabase.from('events').select('id, title, start_at')
      .is('cancelled_at', null).gte('end_at', new Date().toISOString())
      .order('start_at', { ascending: true }).limit(40);
    (scope.venueId ? q.eq('venue_id', scope.venueId) : q.eq('organizer_user_id', scope.organizerUserId!))
      .then(({ data }) => { if (active) setEvents((data ?? []) as { id: string; title: string; start_at: string }[]); });
    return () => { active = false; };
  }, [pickEvent, events, scope]);

  const withParam = preselect ? `&with=${encodeURIComponent(preselect.key)}` : '';
  const go = (path: string) => { onOpenChange(false); navigate(path); };
  const dfLocale = language === 'en' ? enUS : language === 'es' ? es : fr;
  const blocked = canCreate ? null : t('Non inclus dans ton offre actuelle.', 'Not included in your current plan.', 'No incluido en tu plan actual.');

  const Choice = ({ icon: Icon, title, body, onClick, expanded }: { icon: LucideIcon; title: string; body: string; onClick: () => void; expanded?: boolean }) => (
    <button
      type="button"
      disabled={!!blocked}
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-2xl p-4 text-left transition-all duration-150 enabled:cursor-pointer enabled:hover:bg-[rgb(var(--ink)/0.05)]"
      style={{ background: INNER_BG, border: `1px solid ${BORDER}`, opacity: blocked ? 0.55 : 1 }}
    >
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl" style={{ background: 'rgba(232,25,44,0.10)', border: '1px solid rgba(232,25,44,0.22)' }}>
        {blocked ? <Lock className="h-4 w-4" style={{ color: T3 }} /> : <Icon className="h-4 w-4" style={{ color: RED }} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block" style={{ color: T1, fontSize: 13.5, fontWeight: 620 }}>{title}</span>
        <span className="mt-0.5 block" style={{ color: T2, fontSize: 12, lineHeight: 1.5 }}>{blocked ?? body}</span>
      </span>
      {!blocked && <ChevronRight className="mt-2 h-4 w-4 flex-none transition-transform duration-200" style={{ color: T3, transform: expanded ? 'rotate(90deg)' : undefined }} />}
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-0 p-0" style={{ background: 'var(--sf-0a0a0c)', border: `1px solid ${BORDER}`, borderRadius: 18, maxWidth: 560 }}>
        <div className="p-6">
          {inviteEventId && scope ? (
            <>
              <DialogHeader>
                <DialogTitle style={{ color: T1, fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em' }}>
                  {t('Inviter sur cette soirée', 'Invite to this event', 'Invitar a este evento')}
                </DialogTitle>
                <DialogDescription className="sr-only">{t('Ajouter des participants', 'Add participants', 'Añadir participantes')}</DialogDescription>
              </DialogHeader>
              <div className="mt-4">
                <InviteToEventStep
                  eventId={inviteEventId} scope={scope}
                  settingsHref={`${basePath}/events?edit=${inviteEventId}&focus=partners${withParam}`}
                  onBack={() => setInviteEventId(null)}
                  onDone={() => { onOpenChange(false); onInvited?.(); }}
                />
              </div>
            </>
          ) : (<>
          <DialogHeader>
            <DialogTitle style={{ color: T1, fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em' }}>
              {preselect?.name
                ? t(`Inviter ${preselect.name} sur une soirée`, `Invite ${preselect.name} to an event`, `Invitar a ${preselect.name} a un evento`)
                : t('Nouvelle collaboration', 'New collaboration', 'Nueva colaboración')}
            </DialogTitle>
            <DialogDescription style={{ color: T3, fontSize: 12.5, lineHeight: 1.5 }}>
              {t(
                'Clubs et organisations, sur Yuno ou pas, autant que tu veux. Chacun reçoit une invitation et rejoint la soirée en l’acceptant.',
                'Clubs and organizations, on Yuno or not, as many as you like. Each gets an invitation and joins the event by accepting it.',
                'Clubes y organizaciones, en Yuno o no, tantos como quieras. Cada uno recibe una invitación y se une al evento al aceptarla.',
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-2">
            <Choice
              icon={CalendarPlus}
              title={t('Une nouvelle soirée', 'A new event', 'Un evento nuevo')}
              body={t('Tu crées la soirée et tu choisis avec qui tu la fais, au même endroit.', 'Create the event and pick who you run it with, in the same place.', 'Creas el evento y eliges con quién lo haces, en el mismo sitio.')}
              onClick={() => go(`${basePath}/events?new=1${withParam}`)}
            />
            <Choice
              icon={CalendarRange}
              title={t('Une soirée déjà créée', 'An existing event', 'Un evento ya creado')}
              body={t('Ajoute des clubs et des organisations à une de tes soirées à venir.', 'Add clubs and organizations to one of your upcoming events.', 'Añade clubes y organizaciones a uno de tus próximos eventos.')}
              expanded={pickEvent}
              onClick={() => setPickEvent((v) => !v)}
            />
            <div className="grid transition-[grid-template-rows] duration-200 ease-out" style={{ gridTemplateRows: pickEvent ? '1fr' : '0fr' }}>
              <div className="overflow-hidden">
              {pickEvent && (
              <div className="space-y-1.5 pl-2 pt-1">
                {events === null ? (
                  <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin" style={{ color: T3 }} /></div>
                ) : events.length === 0 ? (
                  <p className="px-2 py-2" style={{ color: T3, fontSize: 12 }}>
                    {t('Aucune soirée à venir que tu mènes.', 'No upcoming event that you run.', 'Ningún evento próximo que lleves tú.')}
                  </p>
                ) : events.map((e) => (
                  <button key={e.id} type="button"
                    onClick={() => setInviteEventId(e.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-[rgb(var(--ink)/0.05)]"
                    style={{ border: `1px solid ${BORDER}` }}>
                    <span className="min-w-0">
                      <span className="block truncate" style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{e.title}</span>
                      <span className="block" style={{ color: T3, fontSize: 11.5 }}>
                        {formatInTimeZone(new Date(e.start_at), PARIS_TIMEZONE, 'EEE d MMM · HH:mm', { locale: dfLocale })}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 flex-none" style={{ color: T3 }} />
                  </button>
                ))}
              </div>
              )}
              </div>
            </div>
          </div>
          </>)}
        </div>
      </DialogContent>
    </Dialog>
  );
}
