import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { fr, enUS, es } from 'date-fns/locale';
import { Check, Loader2, X } from 'lucide-react';
import { OrgCard, OrgButton, OrgSectionLabel, T1, T2, T3, INNER_BG } from '@/components/org-ui';
import {
  getMyCohostInvitations, respondCohostInvitation, coorgErrorCode,
  type CoorgScope, type CohostInvite,
} from '@/lib/coorg';
import { capturePosthog } from '@/lib/posthog';
import { useCoorgT, useCoorgErrorText } from './coorgUi';
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
      const principal = inv.role === 'principal';
      toast.success(!accept
        ? t('Invitation déclinée', 'Invitation declined', 'Invitación rechazada')
        : principal
          ? t('Tu fais la soirée ensemble', 'You now run the event together', 'Ahora hacéis el evento juntos')
          : t('Tu co-organises la soirée', 'You now co-organize the event', 'Ahora coorganizas el evento'));
      // Le lieu / l'organisateur devient une partie principale : la page de la collaboration.
      if (accept) navigate(principal
        ? (basePath === '/owner' ? `/owner/collab/event/${inv.event_id}` : `/organizer-app/events/${inv.event_id}`)
        : `${basePath}/coorg/${inv.event_id}`);
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
      <OrgSectionLabel>{t('On t’invite sur une soirée', 'You are invited to an event', 'Te invitan a un evento')}</OrgSectionLabel>
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
                  {' · '}{inv.role === 'principal'
                    ? (basePath === '/owner'
                      ? t('lieu : ton club accueille la soirée', 'venue: your club hosts the event', 'lugar: tu club acoge el evento')
                      : t('organisateur : tu organises la soirée avec le club', 'organizer: you run the event with the club', 'organizador: organizas el evento con el club'))
                      + ' · ' + (inv.terms?.agreement === 'yuno'
                        ? t('contrat Yuno à signer ensuite', 'Yuno contract to sign next', 'contrato Yuno por firmar después')
                        : t('argent réglé entre vous', 'money settled between you', 'dinero arreglado entre vosotros'))
                    : inv.access === 'editor'
                      ? t('co-gestion : tu gères aussi billets, tables et guest list', 'co-manager: you also run tickets, tables and guest list', 'cogestión: también gestionas entradas, mesas y lista')
                      : t('partenaire : tes liens, tes ventes, tes emails', 'partner: your links, your sales, your emails', 'socio: tus enlaces, tus ventas, tus emails')}
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
