import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BookUser, Calendar, ChevronDown, Clock, Handshake, Loader2, Plus } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { OrgButton, OrgEmptyState, OrgSectionLabel, RED, T1, T2, T3, BORDER, F_BORDER, INNER_BG } from '@/components/org-ui';
import { resolveCollabHubTab, type CollabHubTab } from '@/lib/collabHubNav';
import type { CoorgScope } from '@/lib/coorg';
import { useCollabNights } from './useCollabNights';
import { CollabNightCard } from './CollabNightCard';
import { CollabDirectory } from './CollabDirectory';
import { NewCollabDialog, type CollabPreselect } from './NewCollabDialog';

type Side = 'venue' | 'organizer';

/**
 * Le hub Collaborations, club ET organisateur (plans
 * `docs/designs/COLLAB_SIMPLIFICATION_PLAN.md` puis
 * `docs/designs/COLLAB_OPEN_INVITE_PLAN.md`). Deux onglets — Soirées,
 * Annuaire — et UNE action, « Nouvelle collaboration » : choisir la soirée,
 * puis inviter qui on veut depuis « Avec qui ? ». Plus de partenariat
 * préalable, plus de proposition à part.
 *
 * Adresse : `?tab=nights|partners` (`partners` = l'Annuaire). Les anciennes
 * adresses restent valables : `&propose=<id>` et `&invite=1` ouvrent le
 * dialogue, les anciens onglets sont traduits par `resolveCollabHubTab`.
 */
export function CollabHub({
  side, scope, basePath, subtitle, showTitle, canStart, canCreate, todo, directoryExtra,
}: {
  side: Side;
  scope: CoorgScope | null;
  basePath: string;
  subtitle: string;
  /** Le club a déjà son titre dans `OwnerHeader` : un seul titre par page. */
  showTitle: boolean;
  /** Un éditeur d'équipe voit tout, mais n'engage pas l'organisation. */
  canStart: boolean;
  /** Faux pour un club au plan Collaboration : il reçoit des soirées, il n'en crée pas. */
  canCreate: boolean;
  /** Ce qui attend une réponse ; reçoit `reload` pour rafraîchir la liste après une signature. */
  todo: (reload: () => void) => ReactNode;
  /** Sous l'annuaire : les contrats-cadres des séries récurrentes (se taisent vides). */
  directoryExtra?: ReactNode;
}) {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es: string) => translate(language, fr, en, es);
  const [params, setParams] = useSearchParams();
  const route = resolveCollabHubTab(params.get('tab'));
  const tab = route.tab;

  const [chooserOpen, setChooserOpen] = useState(false);
  const [preselect, setPreselect] = useState<CollabPreselect | null>(null);
  const [showPast, setShowPast] = useState(false);

  const { nights, loading, reload } = useCollabNights(side, scope);

  // Adresse canonique + ouvertures demandées par l'URL, puis nettoyage.
  const proposeParam = params.get('propose');
  const inviteParam = params.get('invite');
  useEffect(() => {
    const openInvite = route.openInvite || inviteParam === '1';
    if (!route.rewrite && !proposeParam && !openInvite && !params.has('request')) return;
    if ((openInvite || proposeParam) && canStart) {
      // `?propose=<id>` venait de la carte d'un partenaire : l'autre côté du couple club × orga.
      setPreselect(proposeParam ? { key: `${side === 'venue' ? 'org' : 'venue'}:${proposeParam}`, name: '' } : null);
      setChooserOpen(true);
    }
    const next = new URLSearchParams(params);
    next.set('tab', tab);
    next.delete('propose');
    next.delete('invite');
    next.delete('request');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.rewrite, route.openInvite, proposeParam, inviteParam, canStart]);

  const setTab = (v: CollabHubTab) => setParams({ tab: v });
  const openChooser = (p: CollabPreselect | null = null) => { setPreselect(p); setChooserOpen(true); };

  const now = Date.now();
  const upcoming = nights.filter((n) => new Date(n.endAt).getTime() >= now);
  const past = nights.filter((n) => new Date(n.endAt).getTime() < now);

  const TABS: { value: CollabHubTab; label: string; Icon: typeof Calendar }[] = [
    { value: 'nights', label: t('Soirées', 'Events', 'Eventos'), Icon: Calendar },
    { value: 'partners', label: t('Annuaire', 'Directory', 'Directorio'), Icon: BookUser },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {showTitle && (
            <h1 className="flex items-center gap-2" style={{ color: T1, fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>
              <Handshake className="h-5 w-5 flex-none" style={{ color: RED }} />
              {t('Collaborations', 'Collaborations', 'Colaboraciones')}
            </h1>
          )}
          <p style={{ color: T3, fontSize: 13, marginTop: showTitle ? 4 : 0 }}>{subtitle}</p>
        </div>
        {canStart && (
          <OrgButton variant="primary" size="sm" onClick={() => openChooser()}>
            <Plus className="h-4 w-4" /> {t('Nouvelle collaboration', 'New collaboration', 'Nueva colaboración')}
          </OrgButton>
        )}
      </div>

      <div className="flex" style={{ borderBottom: `1px solid ${F_BORDER}` }}>
        {TABS.map(({ value, label, Icon }) => {
          const active = tab === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className="relative flex cursor-pointer items-center gap-1.5 transition-colors duration-150"
              style={{ padding: '10px 16px', color: active ? T1 : T3, fontSize: 13.5, fontWeight: active ? 640 : 500, background: 'transparent', border: 'none', marginBottom: -1 }}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              {active && <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full" style={{ background: RED }} />}
            </button>
          );
        })}
      </div>

      {tab === 'nights' ? (
        <div className="space-y-5">
          {/* Ce qui attend une réponse : propositions, avenants, invitations de
              co-organisation. Chaque boîte se tait quand elle est vide. */}
          {todo(() => { void reload(); })}

          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" style={{ color: T3 }} /></div>
          ) : nights.length === 0 ? (
            <OrgEmptyState
              icon={Handshake}
              title={t('Aucune soirée à plusieurs pour l’instant', 'No shared event yet', 'Aún no hay eventos compartidos')}
              description={t(
                'Avec un club, un organisateur ou plusieurs : tout commence par « Nouvelle collaboration ».',
                'With a club, an organizer or several: it all starts with “New collaboration”.',
                'Con un club, un organizador o varios: todo empieza con «Nueva colaboración».',
              )}
              action={canStart ? (
                <OrgButton variant="primary" size="sm" onClick={() => openChooser()}>
                  <Plus className="h-4 w-4" /> {t('Nouvelle collaboration', 'New collaboration', 'Nueva colaboración')}
                </OrgButton>
              ) : undefined}
            />
          ) : (
            <>
              <section>
                <div className="mb-2"><OrgSectionLabel>{t('À venir', 'Upcoming', 'Próximos')} ({upcoming.length})</OrgSectionLabel></div>
                {upcoming.length === 0 ? (
                  <p style={{ color: T3, fontSize: 12.5 }}>{t('Aucune soirée à venir.', 'No upcoming event.', 'Ningún evento próximo.')}</p>
                ) : (
                  <div className="grid gap-2.5 xl:grid-cols-2">
                    {upcoming.map((n) => <CollabNightCard key={n.eventId} night={n} side={side} onChanged={reload} />)}
                  </div>
                )}
              </section>
              {past.length > 0 && (
                <section>
                  <button
                    type="button"
                    onClick={() => setShowPast((v) => !v)}
                    className="flex w-full cursor-pointer items-center justify-between transition-all duration-150"
                    style={{ padding: '10px 16px', borderRadius: 12, background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, fontSize: 13 }}
                  >
                    <span className="flex items-center gap-2">
                      <Clock className="h-4 w-4" style={{ color: T3 }} />
                      {t('Soirées passées', 'Past events', 'Eventos pasados')}
                      <span className="tabular-nums" style={{ color: T3, fontSize: 11.5 }}>{past.length}</span>
                    </span>
                    <ChevronDown className={`h-4 w-4 transition-transform ${showPast ? 'rotate-180' : ''}`} style={{ color: T3 }} />
                  </button>
                  {showPast && (
                    <div className="mt-2.5 grid gap-2.5 xl:grid-cols-2">
                      {past.map((n) => <CollabNightCard key={n.eventId} night={n} side={side} onChanged={reload} />)}
                    </div>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          <CollabDirectory scope={scope} canInvite={canStart && canCreate} onInvite={(p) => openChooser(p)} />
          {directoryExtra}
        </div>
      )}

      <NewCollabDialog
        open={chooserOpen}
        onOpenChange={(v) => { setChooserOpen(v); if (!v) setPreselect(null); }}
        scope={scope}
        basePath={basePath}
        canCreate={canCreate}
        preselect={preselect}
      />
    </div>
  );
}
