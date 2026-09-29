import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { fr, enUS, es } from 'date-fns/locale';
import { Check, Loader2, Repeat, Users, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { OrgCard, OrgButton, OrgSectionLabel, T1, T2, T3, BORDER, INNER_BG } from '@/components/org-ui';
import {
  getMyCohostInvitations, getMyCoorgPartners, respondCohostInvitation, coorgErrorCode,
  orgOwnEventsOr, venueOwnEventsOr,
  type CoorgScope, type CohostInvite, type CoorgPartnerRow, type CoorgPartnerCandidate,
} from '@/lib/coorg';
import { capturePosthog } from '@/lib/posthog';
import { PartyAvatar, useCoorgT, useCoorgErrorText } from './coorgUi';
import { CoorgInviteDialog } from './CoorgInviteDialog';
import { formatInTimeZone } from 'date-fns-tz';
import { PARIS_TIMEZONE } from '@/lib/timezone';

const dfLocale = (l: string) => (l === 'fr' ? fr : l === 'es' ? es : enUS);

/**
 * Briques de la co-organisation rangées dans le hub Collaborations unique
 * (plan `docs/designs/COLLAB_SIMPLIFICATION_PLAN.md`). Il n'y a plus d'onglet
 * « Co-organisation » : ses soirées rejoignent la liste des soirées à plusieurs
 * (`useCollabNights`), ses invitations la section « À traiter »
 * (`CoorgInvitesInbox`), son carnet l'onglet Partenaires
 * (`CoorgPartnersSection`), et « Co-organiser une soirée » le choix de
 * « Nouvelle collaboration » (`EventPickerThenInvite`).
 */

/** Invitations de co-organisation à trancher. Se tait quand il n'y en a pas. */
export function CoorgInvitesInbox({ scope, basePath, onChanged }: {
  scope: CoorgScope; basePath: string; onChanged?: () => void;
}) {
  const { t, language } = useCoorgT();
  const errText = useCoorgErrorText();
  const navigate = useNavigate();
  const [invites, setInvites] = useState<CohostInvite[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const scopeKey = scope.venueId ?? scope.organizerUserId ?? '';

  const load = useCallback(async () => {
    setInvites((await getMyCohostInvitations(scope).catch(() => [])) ?? []);
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
      else { await load(); onChanged?.(); }
    } catch (err) {
      toast.error(errText(coorgErrorCode(err)));
    } finally {
      setBusy(null);
    }
  };

  if (invites.length === 0) return null;
  const fmtDate = (d: string) => formatInTimeZone(new Date(d), PARIS_TIMEZONE, 'EEE d MMM · HH:mm', { locale: dfLocale(language) });

  return (
    <div>
      <OrgSectionLabel>{t('On t’invite à co-organiser', 'You are invited to co-organize', 'Te invitan a coorganizar')}</OrgSectionLabel>
      <div className="mt-2 grid gap-2 lg:grid-cols-2 2xl:grid-cols-3">
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
                  {' · '}{inv.access === 'editor'
                    ? t('tu pourras modifier la soirée', 'you can edit the event', 'podrás editar el evento')
                    : t('tu verras la soirée sans la modifier', 'view only', 'solo lectura')}
                  {inv.share_crm ? ` · ${t('ses acheteurs rejoignent aussi ta base', 'buyers join your list too', 'los compradores se suman también a tu base')}` : ''}
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
  );
}

/**
 * Le carnet de co-organisation : les organisateurs et clubs avec qui on a déjà
 * fait une soirée à plusieurs, et « Refaire une soirée » en deux clics. Les
 * partenaires déjà listés comme partenariat (club × orga) sont écartés : une
 * personne, une ligne.
 */
export function CoorgPartnersSection({ scope, basePath, excludeKeys }: {
  scope: CoorgScope; basePath: string; excludeKeys?: Set<string>;
}) {
  const { t } = useCoorgT();
  const [partners, setPartners] = useState<CoorgPartnerRow[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [prefill, setPrefill] = useState<CoorgPartnerCandidate | null>(null);
  const scopeKey = scope.venueId ?? scope.organizerUserId ?? '';

  useEffect(() => {
    let alive = true;
    getMyCoorgPartners(scope).catch(() => []).then((pa) => { if (alive) setPartners(pa ?? []); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  const shown = partners.filter((p) => !excludeKeys?.has(p.key));
  if (shown.length === 0) return null;

  return (
    <section>
      <OrgSectionLabel>{t('Déjà co-organisé avec', 'Co-organized with', 'Ya coorganizado con')} ({shown.length})</OrgSectionLabel>
      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
        {shown.map((p) => (
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
      <EventPickerThenInvite open={pickerOpen} onOpenChange={setPickerOpen} scope={scope} basePath={basePath} prefill={prefill} />
    </section>
  );
}

/** Choisir une de SES soirées à venir, puis inviter (partenaire pré-rempli ou recherche). */
export function EventPickerThenInvite({ open, onOpenChange, scope, basePath, prefill }: {
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
