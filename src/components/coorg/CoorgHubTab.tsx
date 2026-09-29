import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { fr, enUS, es } from 'date-fns/locale';
import { ArrowRight, CalendarPlus, Check, Handshake, Loader2, Network, Repeat, Users, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { OrgCard, OrgButton, OrgPill, OrgSectionLabel, OrgEmptyState, T1, T2, T3, BORDER, INNER_BG, RED } from '@/components/org-ui';
import {
  getMyCohostInvitations, getMyCoorgEvents, getMyCoorgPartners, respondCohostInvitation, coorgErrorCode,
  orgOwnEventsOr, venueOwnEventsOr,
  type CoorgScope, type CohostInvite, type CoorgEventRow, type CoorgPartnerRow, type CoorgPartnerCandidate,
} from '@/lib/coorg';
import { capturePosthog } from '@/lib/posthog';
import { PartyAvatar, useCoorgT, useCoorgErrorText } from './coorgUi';
import { CoorgInviteDialog } from './CoorgInviteDialog';

const dfLocale = (l: string) => (l === 'fr' ? fr : l === 'es' ? es : enUS);

/**
 * Onglet « Co-organisation » des hubs Collaborations (club ET organisateur).
 * Trois blocs : les invitations reçues à trancher, les soirées à plusieurs,
 * et le carnet des partenaires — c'est lui qui fait revenir : « on refait une
 * soirée ensemble » en deux clics, avec ce que la dernière a vendu.
 */
export function CoorgHubTab({ scope, basePath }: { scope: CoorgScope; basePath: string }) {
  const { t, language } = useCoorgT();
  const errText = useCoorgErrorText();
  const navigate = useNavigate();
  const [invites, setInvites] = useState<CohostInvite[]>([]);
  const [events, setEvents] = useState<CoorgEventRow[]>([]);
  const [partners, setPartners] = useState<CoorgPartnerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [prefill, setPrefill] = useState<CoorgPartnerCandidate | null>(null);

  const scopeKey = scope.venueId ?? scope.organizerUserId ?? '';

  const load = useCallback(async () => {
    try {
      const [inv, ev, pa] = await Promise.all([
        getMyCohostInvitations(scope).catch(() => []),
        getMyCoorgEvents(scope).catch(() => []),
        getMyCoorgPartners(scope).catch(() => []),
      ]);
      setInvites(inv ?? []);
      setEvents(ev ?? []);
      setPartners(pa ?? []);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  useEffect(() => { void load(); }, [load]);

  const respond = async (inv: CohostInvite, accept: boolean) => {
    setBusy(inv.id);
    try {
      await respondCohostInvitation(inv.id, accept);
      capturePosthog('coorg_cohost_responded', { event_id: inv.event_id, accepted: accept });
      toast.success(accept
        ? t('Tu co-organises la soirée', 'You now co-organize the event', 'Ahora coorganizas el evento')
        : t('Invitation déclinée', 'Invitation declined', 'Invitación rechazada'));
      if (accept) navigate(`${basePath}/coorg/${inv.event_id}`);
      else await load();
    } catch (err) {
      toast.error(errText(coorgErrorCode(err)));
    } finally {
      setBusy(null);
    }
  };

  const fmtDate = (d: string) => format(new Date(d), 'EEE d MMM · HH:mm', { locale: dfLocale(language) });
  const now = Date.now();
  const upcoming = events.filter((e) => new Date(e.end_at).getTime() > now);
  const past = events.filter((e) => new Date(e.end_at).getTime() <= now);

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin" style={{ color: T3 }} /></div>;
  }

  return (
    <div className="space-y-5">
      {/* Le principe, en une carte */}
      <OrgCard className="p-5">
        <div className="flex flex-wrap items-start gap-4">
          <Network className="h-6 w-6 flex-none" style={{ color: RED }} />
          <div className="min-w-0 flex-1">
            <p style={{ color: T1, fontSize: 15, fontWeight: 650 }}>
              {t('Organisez à plusieurs, comme une seule équipe', 'Organize together, as one team', 'Organizad juntos, como un solo equipo')}
            </p>
            <p style={{ color: T2, fontSize: 12.5, marginTop: 4, lineHeight: 1.55, maxWidth: 720 }}>
              {t(
                'Invitez d’autres organisateurs ou clubs sur une soirée : chacun la gère depuis sa Console, ses acheteurs entrent dans la base de chaque hôte qu’ils ont accepté, et la soirée est annoncée à toutes vos communautés. Les parts se fixent dans un accord facultatif, réglé par virement après un décompte validé par tous.',
                'Invite other organizers or clubs to an event: each one runs it from its Console, buyers join the list of every host they accepted, and the event is announced to all your communities. Shares are set in an optional agreement, paid by transfer after a statement everyone approves.',
                'Invitad a otros organizadores o clubes a un evento: cada uno lo gestiona desde su Consola, los compradores entran en la base de cada anfitrión que aceptaron y el evento se anuncia a todas vuestras comunidades. Las partes se fijan en un acuerdo opcional, pagado por transferencia tras una liquidación validada por todos.',
              )}
            </p>
          </div>
          <OrgButton variant="primary" onClick={() => { setPrefill(null); setPickerOpen(true); }}>
            <CalendarPlus className="h-4 w-4" /> {t('Co-organiser une soirée', 'Co-organize an event', 'Coorganizar un evento')}
          </OrgButton>
        </div>
      </OrgCard>

      {/* Invitations reçues */}
      {invites.length > 0 && (
        <div>
          <OrgSectionLabel>{t('Invitations reçues', 'Invitations received', 'Invitaciones recibidas')}</OrgSectionLabel>
          <div className="mt-2 space-y-2">
            {invites.map((inv) => (
              <OrgCard key={inv.id} className="p-4" style={{ borderColor: 'rgba(232,25,44,0.3)' }}>
                <div className="flex flex-wrap items-center gap-3">
                  {inv.poster_url
                    ? <img src={inv.poster_url} alt="" className="h-14 w-11 flex-none rounded-lg object-cover" />
                    : <div className="h-14 w-11 flex-none rounded-lg" style={{ background: INNER_BG }} />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate" style={{ color: T1, fontSize: 14, fontWeight: 650 }}>{inv.event_title}</p>
                    <p style={{ color: T3, fontSize: 12 }}>
                      {fmtDate(inv.start_at)}{inv.location ? ` · ${inv.location}` : ''}
                    </p>
                    <p style={{ color: T2, fontSize: 12, marginTop: 2 }}>
                      {t('Invitation de', 'Invited by', 'Invitación de')} <b>{inv.invited_by_name}</b>
                      {' · '}{inv.access === 'editor' ? t('édition', 'editor', 'edición') : t('lecture', 'viewer', 'lectura')}
                      {inv.share_crm ? ` · ${t('CRM partagé', 'shared CRM', 'CRM compartido')}` : ''}
                    </p>
                    {inv.message && <p style={{ color: T2, fontSize: 12, fontStyle: 'italic', marginTop: 2 }}>« {inv.message} »</p>}
                  </div>
                  <div className="flex gap-2">
                    <OrgButton size="sm" variant="ghost" disabled={busy === inv.id} onClick={() => respond(inv, false)}>
                      <X className="h-3.5 w-3.5" /> {t('Décliner', 'Decline', 'Rechazar')}
                    </OrgButton>
                    <OrgButton size="sm" variant="primary" disabled={busy === inv.id} onClick={() => respond(inv, true)}>
                      {busy === inv.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      {t('Accepter', 'Accept', 'Aceptar')}
                    </OrgButton>
                  </div>
                </div>
              </OrgCard>
            ))}
          </div>
        </div>
      )}

      {/* Soirées à plusieurs */}
      <div>
        <OrgSectionLabel>{t('Soirées co-organisées', 'Co-organized events', 'Eventos coorganizados')}</OrgSectionLabel>
        <div className="mt-2 space-y-2">
          {upcoming.length === 0 && past.length === 0 && (
            <OrgEmptyState
              icon={Handshake}
              title={t('Aucune soirée à plusieurs pour l’instant', 'No shared event yet', 'Aún no hay eventos compartidos')}
              description={t('Choisis une soirée et invite un organisateur ou un club.', 'Pick an event and invite an organizer or a club.', 'Elige un evento e invita a un organizador o club.')}
            />
          )}
          {[...upcoming, ...past].map((e) => (
            <OrgCard key={e.event_id} className="cursor-pointer p-4" onClick={() => navigate(`${basePath}/coorg/${e.event_id}`)}>
              <div className="flex flex-wrap items-center gap-3">
                {e.poster_url
                  ? <img src={e.poster_url} alt="" className="h-12 w-10 flex-none rounded-lg object-cover" />
                  : <div className="h-12 w-10 flex-none rounded-lg" style={{ background: INNER_BG }} />}
                <div className="min-w-0 flex-1">
                  <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 650 }}>{e.title}</p>
                  <p style={{ color: T3, fontSize: 11.5 }}>{fmtDate(e.start_at)}</p>
                  <div className="mt-1 flex -space-x-1.5">
                    {e.parties.slice(0, 6).map((p) => (
                      <PartyAvatar key={p.key} name={p.name} url={p.avatar_url} kind={p.kind} size={22} />
                    ))}
                    <span className="pl-3" style={{ color: T3, fontSize: 11.5 }}>
                      {e.parties.map((p) => p.name).join(' × ')}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {e.pending_invites > 0 && <OrgPill tone="warn">{e.pending_invites} {t('en attente', 'pending', 'pendientes')}</OrgPill>}
                  {e.deal_status === 'active' && <OrgPill tone="success">{t('Accord actif', 'Agreement active', 'Acuerdo activo')}</OrgPill>}
                  {e.deal_status === 'pending' && <OrgPill tone="warn">{t('Accord à valider', 'Agreement to approve', 'Acuerdo por validar')}</OrgPill>}
                  {e.settlement_status === 'approved' && <OrgPill tone="info">{t('Virements en cours', 'Transfers in progress', 'Transferencias en curso')}</OrgPill>}
                  {e.settlement_status === 'settled' && <OrgPill tone="success">{t('Soldé', 'Settled', 'Liquidado')}</OrgPill>}
                  <ArrowRight className="h-4 w-4" style={{ color: T3 }} />
                </div>
              </div>
            </OrgCard>
          ))}
        </div>
      </div>

      {/* Carnet des partenaires */}
      {partners.length > 0 && (
        <div>
          <OrgSectionLabel>{t('Vos partenaires', 'Your partners', 'Tus socios')}</OrgSectionLabel>
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
            {partners.map((p) => (
              <OrgCard key={p.key} className="p-4">
                <div className="flex items-center gap-3">
                  <PartyAvatar name={p.name} url={p.avatar_url} kind={p.kind} size={38} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 650 }}>{p.name}</p>
                    <p style={{ color: T3, fontSize: 11.5 }}>
                      <Users className="mr-1 inline h-3 w-3" />
                      {p.events} {p.events > 1 ? t('soirées ensemble', 'events together', 'eventos juntos') : t('soirée ensemble', 'event together', 'evento juntos')}
                      {p.tickets > 0 ? ` · ${p.tickets} ${t('billets', 'tickets', 'entradas')}` : ''}
                    </p>
                  </div>
                  <OrgButton size="sm" variant="secondary" onClick={() => {
                    setPrefill({
                      kind: p.kind, id: (p.kind === 'venue' ? p.venue_id : p.organizer_user_id) ?? '',
                      name: p.name, slug: p.slug, avatar_url: p.avatar_url, city: p.city, followers: 0,
                    });
                    setPickerOpen(true);
                  }}>
                    <Repeat className="h-3.5 w-3.5" /> {t('Refaire une soirée', 'Do another', 'Repetir')}
                  </OrgButton>
                </div>
              </OrgCard>
            ))}
          </div>
        </div>
      )}

      <EventPickerThenInvite
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        scope={scope}
        basePath={basePath}
        prefill={prefill}
      />
    </div>
  );
}

/** Choisir une de SES soirées à venir, puis inviter (partenaire pré-rempli ou recherche). */
function EventPickerThenInvite({ open, onOpenChange, scope, basePath, prefill }: {
  open: boolean; onOpenChange: (v: boolean) => void; scope: CoorgScope; basePath: string; prefill: CoorgPartnerCandidate | null;
}) {
  const { t, language } = useCoorgT();
  const navigate = useNavigate();
  const [events, setEvents] = useState<{ id: string; title: string; start_at: string }[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    if (!open) { setPicked(null); return; }
    (async () => {
      // Seules les soirées que la portée MÈNE ou dont elle est partenaire : un
      // co-hôte n'invite pas (la RPC le refuserait de toute façon).
      const base = supabase.from('events').select('id, title, start_at')
        .gt('end_at', new Date().toISOString()).is('cancelled_at', null).order('start_at', { ascending: true }).limit(40);
      const orFilter = scope.venueId ? venueOwnEventsOr(scope.venueId) : orgOwnEventsOr(scope.organizerUserId!);
      const { data } = await base.or(orFilter);
      setEvents((data ?? []) as { id: string; title: string; start_at: string }[]);
    })();
  }, [open, scope.venueId, scope.organizerUserId]);

  if (picked) {
    return (
      <CoorgInviteDialog
        open={open}
        onOpenChange={(v) => { if (!v) setPicked(null); onOpenChange(v); }}
        eventId={picked}
        prefill={prefill}
        onInvited={() => navigate(`${basePath}/coorg/${picked}`)}
      />
    );
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => onOpenChange(false)}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md">
        <OrgCard className="p-5">
          <p style={{ color: T1, fontSize: 15, fontWeight: 650 }}>
            {prefill
              ? t(`Quelle soirée avec ${prefill.name} ?`, `Which event with ${prefill.name}?`, `¿Qué evento con ${prefill.name}?`)
              : t('Quelle soirée co-organiser ?', 'Which event to co-organize?', '¿Qué evento coorganizar?')}
          </p>
          <div className="mt-3 max-h-80 space-y-1.5 overflow-y-auto">
            {events === null && <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin" style={{ color: T3 }} /></div>}
            {events?.length === 0 && (
              <p className="py-6 text-center" style={{ color: T3, fontSize: 12.5 }}>
                {t('Aucune soirée à venir. Crée d’abord la soirée, puis invite tes co-hôtes.', 'No upcoming event. Create the event first, then invite your co-hosts.', 'Ningún evento próximo. Crea primero el evento y luego invita a tus coanfitriones.')}
              </p>
            )}
            {events?.map((e) => (
              <button key={e.id} type="button" onClick={() => setPicked(e.id)}
                className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left hover:bg-[rgb(var(--ink)/0.05)]"
                style={{ border: `1px solid ${BORDER}` }}>
                <span className="min-w-0 truncate" style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{e.title}</span>
                <span className="flex-none pl-2" style={{ color: T3, fontSize: 11.5 }}>
                  {format(new Date(e.start_at), 'd MMM', { locale: dfLocale(language) })}
                </span>
              </button>
            ))}
          </div>
          <div className="mt-3 flex justify-end">
            <OrgButton variant="ghost" onClick={() => onOpenChange(false)}>{t('Fermer', 'Close', 'Cerrar')}</OrgButton>
          </div>
        </OrgCard>
      </div>
    </div>
  );
}
