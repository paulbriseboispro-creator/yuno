import { FileText, Ticket, UserPlus, Wine, GlassWater, type LucideIcon } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { useTabParam } from '@/hooks/useTabParam';
import { OrgCard, RED, T1, T3, F_BORDER } from '@/components/org-ui';
import { CollabEventSubPage } from '@/components/collab/CollabEventSubPage';
import { EventGuestListModule } from '@/components/owner/co-event/EventGuestListModule';
import { EventInvoicesModule } from '@/components/owner/co-event/EventInvoicesModule';
import { OwnerTicketOrders } from '@/components/owner/OwnerTicketOrders';
import { OwnerVipOrders } from '@/components/owner/OwnerVipOrders';
import { OwnerDrinkOrders } from '@/components/owner/OwnerDrinkOrders';
import { canSideEdit } from '@/utils/collabResponsibilities';
import { DRINKS_PILLAR_LIVE } from '@/lib/drinksPillar';

type SalesTab = 'tickets' | 'tables' | 'guestlist' | 'drinks' | 'invoices';
const TABS: readonly SalesTab[] = ['tickets', 'tables', 'guestlist', 'drinks', 'invoices'];

/**
 * « Ventes de la soirée » — `/owner/collab/event/:id/sales` et
 * `/organizer-app/events/:id/sales`. Les listes qui s'empilaient dans le déplié
 * « Détails de gestion » de la page de la soirée, une par onglet (`?tab=`) : seul
 * l'onglet ouvert charge ses lignes. Le bar est au club : l'onglet Boissons
 * n'existe que côté club.
 */
export default function CollabEventSales() {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es: string) => translate(language, fr, en, es);
  const [tab, setTab] = useTabParam<SalesTab>('tickets', TABS);

  return (
    <CollabEventSubPage
      title={t('Ventes de la soirée', 'Night sales', 'Ventas de la noche')}
      question={t('Qu’est-ce qui s’est vendu ?', 'What has sold?', '¿Qué se ha vendido?')}
      sub={t('Chaque commande de la soirée, pilier par pilier, et ses factures.', 'Every order of the night, pillar by pillar, and its invoices.', 'Cada pedido de la noche, pilar por pilar, y sus facturas.')}
    >
      {(event, side) => {
        const isVenue = side === 'venue';
        const guestReadOnly = !canSideEdit(event.collab_responsibilities, event.event_mode, 'operations', side);
        const tabs: { value: SalesTab; label: string; Icon: LucideIcon }[] = [
          { value: 'tickets', label: t('Billets', 'Tickets', 'Entradas'), Icon: Ticket },
          { value: 'tables', label: t('Tables VIP', 'VIP tables', 'Mesas VIP'), Icon: Wine },
          { value: 'guestlist', label: t('Guest list', 'Guest list', 'Guest list'), Icon: UserPlus },
          // Pilier boissons en pause : l'onglet dort (src/lib/drinksPillar.ts).
          ...(isVenue && DRINKS_PILLAR_LIVE ? [{ value: 'drinks' as const, label: t('Boissons', 'Drinks', 'Bebidas'), Icon: GlassWater }] : []),
          { value: 'invoices', label: t('Factures', 'Invoices', 'Facturas'), Icon: FileText },
        ];
        const active = tab === 'drinks' && !(isVenue && DRINKS_PILLAR_LIVE) ? 'tickets' : tab;
        return (
          <div className="space-y-4">
            <div className="flex overflow-x-auto" style={{ borderBottom: `1px solid ${F_BORDER}` }} role="tablist">
              {tabs.map(({ value, label, Icon }) => {
                const on = active === value;
                return (
                  <button key={value} type="button" role="tab" aria-selected={on} onClick={() => setTab(value)}
                    className="relative flex flex-none cursor-pointer items-center gap-1.5 transition-colors duration-150"
                    style={{ padding: '10px 16px', color: on ? T1 : T3, fontSize: 13.5, fontWeight: on ? 640 : 500, background: 'transparent', border: 'none', marginBottom: -1 }}>
                    <Icon className="h-3.5 w-3.5" /> {label}
                    {on && <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full" style={{ background: RED }} />}
                  </button>
                );
              })}
            </div>
            {/* Les factures portent déjà leur propre carte. */}
            {active === 'invoices' ? <EventInvoicesModule eventId={event.id} /> : (
              <OrgCard>
                <div className="p-4 sm:p-5">
                  {active === 'tickets' && (isVenue ? <OwnerTicketOrders eventId={event.id} /> : <OwnerTicketOrders eventIds={[event.id]} />)}
                  {active === 'tables' && (isVenue ? <OwnerVipOrders eventId={event.id} /> : <OwnerVipOrders eventIds={[event.id]} />)}
                  {active === 'guestlist' && <EventGuestListModule eventId={event.id} readOnly={guestReadOnly} />}
                  {active === 'drinks' && <OwnerDrinkOrders eventId={event.id} />}
                </div>
              </OrgCard>
            )}
          </div>
        );
      }}
    </CollabEventSubPage>
  );
}
