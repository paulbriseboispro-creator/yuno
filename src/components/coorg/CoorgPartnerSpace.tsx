import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Crown, ExternalLink, Mail, Ticket, Users } from 'lucide-react';
import { OrgButton, OrgCard, OrgPill, OrgSectionLabel, T1, T2, T3, BORDER, INNER_BG } from '@/components/org-ui';
import TrackedLinksManager from '@/components/tracking/TrackedLinksManager';
import { useDashboardMode } from '@/contexts/DashboardModeContext';
import { eventReportHref } from '@/lib/analyticsNav';
import { fetchPartyBreakdown, type PartyBreakdown } from '@/lib/collabPartyBreakdown';
import { useNumberFormat } from '@/components/analytics/kitFormat';
import { ensureEventPartyLink, type CoorgState, type PartnerVisibility } from '@/lib/coorg';
import { useCoorgT } from './coorgUi';

/**
 * L'espace de CHAQUE partie sur une soirée à plusieurs, en tête de la page
 * co-organisation. Trois questions, dans cet ordre :
 *   1. Quel est mon rôle, et qui mène ?
 *   2. Où en est la soirée — et où en sont MES ventes ?
 *   3. Comment je fais vendre : MES liens (direct, Instagram, TikTok, WhatsApp,
 *      Newsletter), MES emails à MA base, l'analyse.
 *
 * Un partenaire (co-hôte « lecture ») ne gère ni billets, ni tables, ni guest
 * list : c'est le principal. Mais il a tout ce qu'il faut pour vendre et suivre
 * son propre marketing — ses liens sont à son nom, ses emails partent sur ses
 * liens, et « Qui fait vendre ? » lui rend ce qu'il a amené.
 */
export function CoorgPartnerSpace({ eventId, state, partnerVisibility = 'full' }: {
  eventId: string;
  state: CoorgState;
  /** Réglé par l'organisateur principal : « Tout » (défaut) ou « Volumes seulement ». */
  partnerVisibility?: PartnerVisibility;
}) {
  const { t } = useCoorgT();
  const { n, eur } = useNumberFormat();
  const { basePath } = useDashboardMode();
  const [bd, setBd] = useState<PartyBreakdown | null>(null);
  // Le lien DIRECT de ma partie existe avant d'afficher mes liens (idempotent).
  const [linksReady, setLinksReady] = useState(false);
  const myKey = state.me?.party ?? null;
  const ended = state.event.ended;

  useEffect(() => {
    let cancelled = false;
    fetchPartyBreakdown(eventId)
      .then((r) => { if (!cancelled) setBd(r?.ok ? r : null); })
      .catch(() => { if (!cancelled) setBd(null); });
    return () => { cancelled = true; };
  }, [eventId]);

  useEffect(() => {
    if (!myKey || ended) return;
    let cancelled = false;
    ensureEventPartyLink(eventId, myKey)
      .catch(() => null)
      .finally(() => { if (!cancelled) setLinksReady(true); });
    return () => { cancelled = true; };
  }, [eventId, myKey, ended]);

  const me = state.me;
  if (!me) return null;
  const isPrincipal = me.role === 'lead' || me.role === 'partner';
  const lead = state.parties.find((p) => p.role === 'lead');
  const myParty = state.parties.find((p) => p.key === me.party);
  const [kind, id] = me.party.split(':') as ['venue' | 'org', string];
  const runsSales = isPrincipal || me.access === 'editor';
  const mine = bd?.parties.find((p) => p.mine);
  const totals = bd?.totals;

  const roleLabel = me.role === 'lead'
    ? t('Organisateur principal', 'Main organizer', 'Organizador principal')
    : me.role === 'partner'
      ? t('Partenaire du contrat', 'Contract partner', 'Socio del contrato')
      : me.access === 'editor'
        ? t('Co-gestion', 'Co-manager', 'Cogestión')
        : t('Partenaire', 'Partner', 'Socio');

  const tiles: { label: string; value: string }[] = totals ? [
    { label: t('Billets', 'Tickets', 'Entradas'), value: n(totals.tickets) },
    { label: t('Tables', 'Tables', 'Mesas'), value: n(totals.tables) },
    { label: t('Guest list', 'Guest list', 'Lista'), value: n(totals.guests) },
    ...(state.event.ended || totals.entered > 0 ? [{ label: t('Entrées', 'Entries', 'Entradas en puerta'), value: n(totals.entered) }] : []),
    ...(bd?.money && totals.revenue != null ? [{ label: t('CA club', 'Club revenue', 'Ingresos club'), value: eur(totals.revenue) }] : []),
  ] : [];

  // « 1 clic », jamais « 1 clics » : Yuno a de très petits nombres.
  const cnt = (v: number, one: [string, string, string], many: [string, string, string]) =>
    `${n(v)} ${v === 1 ? t(...one) : t(...many)}`;
  const mineLine = mine ? [
    cnt(mine.clicks, ['clic', 'click', 'clic'], ['clics', 'clicks', 'clics']),
    cnt(mine.tickets, ['billet', 'ticket', 'entrada'], ['billets', 'tickets', 'entradas']),
    cnt(mine.tables, ['table', 'table', 'mesa'], ['tables', 'tables', 'mesas']),
    cnt(mine.guests, ['inscrit', 'sign-up', 'inscrito'], ['inscrits', 'sign-ups', 'inscritos']),
    ...(bd?.money && mine.revenue != null ? [eur(mine.revenue)] : []),
  ].join(' · ') : null;

  return (
    <>
      <OrgCard className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <OrgPill tone={isPrincipal ? 'info' : 'muted'}>{roleLabel}</OrgPill>
            <p className="mt-2" style={{ color: T1, fontSize: 15, fontWeight: 650 }}>
              {isPrincipal
                ? t('Tu mènes cette soirée', 'You run this event', 'Tú diriges este evento')
                : t(`Soirée menée par ${lead?.name ?? 'l’organisateur principal'}`, `Event run by ${lead?.name ?? 'the main organizer'}`, `Evento dirigido por ${lead?.name ?? 'el organizador principal'}`)}
            </p>
            <p style={{ color: T2, fontSize: 12.5, marginTop: 2, lineHeight: 1.5, maxWidth: 640 }}>
              {isPrincipal
                ? t(
                  'Tu gardes billets, tables et guest list. Tes partenaires suivent les ventes et font vendre avec leurs propres liens et leurs emails.',
                  'You keep tickets, tables and guest list. Your partners follow sales and sell with their own links and emails.',
                  'Tú llevas entradas, mesas y lista. Tus socios siguen las ventas y venden con sus propios enlaces y emails.',
                )
                : me.access === 'editor'
                  ? t(
                    'Tu co-gères la vente (billets, tables, guest list) et tu fais vendre avec TES liens et TES emails. Les parties et l’argent restent au principal.',
                    'You co-manage sales (tickets, tables, guest list) and sell with YOUR links and YOUR emails. Parties and money stay with the main organizer.',
                    'Cogestionas la venta (entradas, mesas, lista) y vendes con TUS enlaces y TUS emails. Las partes y el dinero siguen con el principal.',
                  )
                  : t(
                    'Tu suis les ventes et tu fais vendre avec TES liens et TES emails : tout ce que tu amènes t’est attribué. Billets, tables et guest list sont gérés par l’organisateur principal.',
                    'You follow sales and sell with YOUR links and YOUR emails: everything you bring is credited to you. Tickets, tables and guest list are run by the main organizer.',
                    'Sigues las ventas y vendes con TUS enlaces y TUS emails: todo lo que traes se te atribuye. Entradas, mesas y lista las gestiona el organizador principal.',
                  )}
            </p>
          </div>
        </div>

        {tiles.length > 0 && (
          <div className="mt-4">
            <OrgSectionLabel>{t('Où en est la soirée', 'Where the event stands', 'Cómo va el evento')}</OrgSectionLabel>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {tiles.map((tile) => (
                <div key={tile.label} className="rounded-xl px-3 py-2.5" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                  <p style={{ color: T3, fontSize: 11 }}>{tile.label}</p>
                  <p style={{ color: T1, fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>{tile.value}</p>
                </div>
              ))}
            </div>
            {mineLine && (
              <p className="mt-2.5" style={{ color: T2, fontSize: 12.5 }}>
                <span style={{ color: T1, fontWeight: 600 }}>{t('Tes ventes', 'Your sales', 'Tus ventas')} ({myParty?.name ?? ''})</span> · {mineLine}
              </p>
            )}
            {/* Pas de montant à l'écran : on dit POURQUOI, jamais un « 0 € » muet. */}
            {bd && !bd.money && me.role === 'cohost' && (
              <p className="mt-1.5" style={{ color: T3, fontSize: 11.5, lineHeight: 1.45 }}>
                {partnerVisibility === 'volumes'
                  ? t('L’organisateur principal partage les ventes, pas les montants.', 'The main organizer shares sales, not amounts.', 'El organizador principal comparte las ventas, no los importes.')
                  : t('Les montants sont visibles du fondateur et des accès finances de ton organisation.', 'Amounts are visible to your organization’s founder and finance access.', 'Los importes son visibles para el fundador y los accesos de finanzas de tu organización.')}
              </p>
            )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Link to={`${basePath}/campaigns/new?event=${eventId}`}>
            <OrgButton size="sm" variant="primary"><Mail className="h-3.5 w-3.5" /> {t('Écrire à ma base', 'Email my list', 'Escribir a mi base')}</OrgButton>
          </Link>
          <Link to={eventReportHref(`${basePath}/analytics`, eventId)}>
            <OrgButton size="sm" variant="secondary"><BarChart3 className="h-3.5 w-3.5" /> {t('Analyse de la soirée', 'Event analytics', 'Análisis del evento')}</OrgButton>
          </Link>
          {runsSales && (
            <>
              <Link to={`${basePath}/ticketing?event=${eventId}`}>
                <OrgButton size="sm" variant="secondary"><Ticket className="h-3.5 w-3.5" /> {t('Billetterie', 'Ticketing', 'Taquilla')}</OrgButton>
              </Link>
              <Link to={`${basePath}/guest-list?event=${eventId}`}>
                <OrgButton size="sm" variant="secondary"><Users className="h-3.5 w-3.5" /> {t('Guest list', 'Guest list', 'Lista')}</OrgButton>
              </Link>
            </>
          )}
          <a href={`/event/${eventId}`} target="_blank" rel="noreferrer">
            <OrgButton size="sm" variant="ghost"><ExternalLink className="h-3.5 w-3.5" /> {t('Page publique', 'Public page', 'Página pública')}</OrgButton>
          </a>
        </div>
      </OrgCard>

      {/* MES liens de la soirée : lien direct + un lien par canal, à mon nom. */}
      {!state.event.ended && (
        <OrgCard className="p-5">
          <div className="mb-3">
            <OrgSectionLabel>
              <span className="inline-flex items-center gap-1.5"><Crown className="h-3.5 w-3.5" /> {t('Tes liens de la soirée', 'Your links for the event', 'Tus enlaces del evento')}</span>
            </OrgSectionLabel>
            <p style={{ color: T3, fontSize: 12, marginTop: 2, lineHeight: 1.45 }}>
              {t(
                'À ton nom : chaque clic, billet, table ou inscription passé par ces liens t’est attribué. Un lien par canal (bio Instagram, story, WhatsApp…) pour savoir ce qui marche. Tes emails de campagne partent aussi sur tes liens.',
                'In your name: every click, ticket, table or sign-up through these links is credited to you. One link per channel (Instagram bio, story, WhatsApp…) to see what works. Your campaign emails also use your links.',
                'A tu nombre: cada clic, entrada, mesa o inscripción por estos enlaces se te atribuye. Un enlace por canal (bio de Instagram, story, WhatsApp…) para ver qué funciona. Tus emails de campaña también usan tus enlaces.',
              )}
            </p>
          </div>
          {linksReady && <TrackedLinksManager
            ownerKind={kind === 'venue' ? 'venue' : 'organizer'}
            venueId={kind === 'venue' ? id : null}
            organizerUserId={kind === 'org' ? id : null}
            targetKind="event"
            eventId={eventId}
          />}
        </OrgCard>
      )}
    </>
  );
}
