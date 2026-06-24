import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { toast } from 'sonner';
import { Pause, Play, Trash2, Check, X, Clock, Loader2, AlertTriangle } from 'lucide-react';
import { T1, T2, T3, BORDER, INNER_BG } from '@/components/org-ui';

const AMBER = '#F5A623';
const NEG = '#FF5C63';

type Role = 'venue' | 'organizer';
type Action = 'pause' | 'delete';

interface ActionRequest {
  id: string;
  action: Action;
  status: 'pending' | 'scheduled' | 'executed' | 'cancelled' | 'rejected';
  requested_by_role: Role;
  venue_approved: boolean;
  organizer_approved: boolean;
  scheduled_for: string | null;
}

/**
 * Pause / delete a co-event under DOUBLE CONSENT. Either party requests; the
 * other must approve before anything happens. When both agree, the server
 * applies it now — or, if the night is currently live, schedules it for after
 * the event ends (cron). Resume stays unilateral. This one component drives both
 * the club collab hub and the organizer collaborations page, so the consent
 * state (waiting / to-approve / scheduled) reads identically on both sides.
 */
export function CollabActionControls({
  eventId, myRole, isPaused, onChanged,
}: {
  eventId: string;
  myRole: Role;
  isPaused: boolean;
  onChanged?: () => void;
}) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [req, setReq] = useState<ActionRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('event_collab_action_requests' as never)
      .select('id, action, status, requested_by_role, venue_approved, organizer_approved, scheduled_for')
      .eq('event_id' as never, eventId as never)
      .in('status' as never, ['pending', 'scheduled'] as never)
      .order('created_at' as never, { ascending: false } as never)
      .limit(1);
    setReq(((data as unknown as ActionRequest[]) || [])[0] ?? null);
  }, [eventId]);

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`collab-action-${eventId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_collab_action_requests', filter: `event_id=eq.${eventId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [eventId, load]);

  const actionLabel = (a: Action) =>
    a === 'pause' ? tt('la mise en pause', 'the pause', 'la pausa') : tt('la suppression', 'the deletion', 'la eliminación');

  const run = async (fn: () => PromiseLike<{ error: unknown }>, okMsg: string) => {
    setBusy(true);
    try {
      const { error } = await fn();
      if (error) throw error;
      toast.success(okMsg);
      await load();
      onChanged?.();
    } catch (e) {
      const msg = String((e as { message?: string })?.message ?? '');
      toast.error(
        msg.includes('COLLAB_ACTION_PENDING') ? tt('Une demande est déjà en cours.', 'A request is already in progress.', 'Ya hay una solicitud en curso.')
          : msg.includes('COLLAB_ACTION_RESOLVED') ? tt('Cette demande est déjà traitée.', 'This request was already handled.', 'Esta solicitud ya fue tratada.')
            : (msg || tt('Erreur', 'Error', 'Error')),
      );
    } finally { setBusy(false); }
  };

  const requestAction = (action: Action) =>
    run(
      () => supabase.rpc('request_event_collab_action' as never, { p_event_id: eventId, p_action: action } as never),
      action === 'pause'
        ? tt("Demande de pause envoyée à l'autre partie.", 'Pause request sent to the other party.', 'Solicitud de pausa enviada a la otra parte.')
        : tt("Demande de suppression envoyée à l'autre partie.", 'Deletion request sent to the other party.', 'Solicitud de eliminación enviada a la otra parte.'),
    );

  const respond = (approve: boolean) =>
    run(
      () => supabase.rpc('respond_event_collab_action' as never, { p_request_id: req!.id, p_approve: approve } as never),
      approve ? tt('Réponse enregistrée.', 'Response recorded.', 'Respuesta registrada.') : tt('Demande annulée.', 'Request cancelled.', 'Solicitud cancelada.'),
    );

  const resume = () =>
    run(
      () => supabase.rpc('manage_event_collaboration', { p_event_id: eventId, p_action: 'resume' }),
      tt('Co-soirée réactivée.', 'Co-event resumed.', 'Coevento reactivado.'),
    );

  const btn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 9, background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, fontSize: 11.5, fontWeight: 560, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 };
  const banner: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '9px 11px', borderRadius: 11 };

  // ── Active request: scheduled (deferred to after the live event) ─────────────
  if (req && req.status === 'scheduled') {
    return (
      <div style={{ ...banner, background: 'rgba(245,166,35,0.08)', border: `1px solid ${AMBER}40` }}>
        <Clock className="h-3.5 w-3.5 flex-none" style={{ color: AMBER }} />
        <span style={{ color: T2, fontSize: 11.5, flex: 1, minWidth: 180 }}>
          {req.action === 'pause'
            ? tt('Mise en pause programmée — elle s’appliquera à la fin de la soirée en cours.', 'Pause scheduled — it will apply once the live event ends.', 'Pausa programada — se aplicará al terminar el evento en curso.')
            : tt('Suppression programmée — elle s’appliquera à la fin de la soirée en cours.', 'Deletion scheduled — it will apply once the live event ends.', 'Eliminación programada — se aplicará al terminar el evento en curso.')}
        </span>
        <button onClick={() => respond(false)} disabled={busy} style={btn}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />} {tt('Annuler', 'Cancel', 'Cancelar')}
        </button>
      </div>
    );
  }

  // ── Active request: pending ──────────────────────────────────────────────────
  if (req && req.status === 'pending') {
    const myApproved = myRole === 'venue' ? req.venue_approved : req.organizer_approved;
    if (!myApproved) {
      // I'm the party whose consent is required.
      return (
        <div style={{ ...banner, background: 'rgba(232,25,44,0.06)', border: '1px solid rgba(232,25,44,0.22)' }}>
          <AlertTriangle className="h-3.5 w-3.5 flex-none" style={{ color: NEG }} />
          <span style={{ color: T1, fontSize: 11.5, fontWeight: 560, flex: 1, minWidth: 180 }}>
            {tt(`L’autre partie demande ${actionLabel(req.action)} de cette soirée.`, `The other party requests ${actionLabel(req.action)} of this event.`, `La otra parte solicita ${actionLabel(req.action)} de este evento.`)}
          </span>
          <button onClick={() => respond(true)} disabled={busy} style={{ ...btn, color: NEG, background: 'rgba(255,92,99,0.10)', border: '1px solid rgba(255,92,99,0.25)' }}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {tt('Approuver', 'Approve', 'Aprobar')}
          </button>
          <button onClick={() => respond(false)} disabled={busy} style={btn}>
            <X className="h-3.5 w-3.5" /> {tt('Refuser', 'Decline', 'Rechazar')}
          </button>
        </div>
      );
    }
    // I requested / already approved — waiting on the other party.
    return (
      <div style={{ ...banner, background: INNER_BG, border: `1px solid ${BORDER}` }}>
        <Clock className="h-3.5 w-3.5 flex-none" style={{ color: T3 }} />
        <span style={{ color: T2, fontSize: 11.5, flex: 1, minWidth: 180 }}>
          {tt(`En attente de l’accord de l’autre partie pour ${actionLabel(req.action)}.`, `Waiting for the other party to approve ${actionLabel(req.action)}.`, `Esperando la aprobación de la otra parte para ${actionLabel(req.action)}.`)}
        </span>
        <button onClick={() => respond(false)} disabled={busy} style={btn}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />} {tt('Annuler la demande', 'Cancel request', 'Cancelar solicitud')}
        </button>
      </div>
    );
  }

  // ── No active request: default controls ──────────────────────────────────────
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {isPaused ? (
        <button onClick={resume} disabled={busy} style={btn}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} {tt('Reprendre', 'Resume', 'Reanudar')}
        </button>
      ) : (
        <button onClick={() => requestAction('pause')} disabled={busy} style={btn}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pause className="h-3.5 w-3.5" />} {tt('Mettre en pause', 'Pause', 'Pausar')}
        </button>
      )}
      <div className="flex-1" />
      {confirmDelete ? (
        <>
          <span style={{ color: T3, fontSize: 11 }}>{tt('Demander la suppression ?', 'Request deletion?', '¿Solicitar eliminación?')}</span>
          <button onClick={() => { setConfirmDelete(false); requestAction('delete'); }} disabled={busy} style={{ ...btn, color: NEG, background: 'rgba(255,92,99,0.10)', border: '1px solid rgba(255,92,99,0.25)' }}>
            {tt('Oui', 'Yes', 'Sí')}
          </button>
          <button onClick={() => setConfirmDelete(false)} disabled={busy} style={btn}>{tt('Non', 'No', 'No')}</button>
        </>
      ) : (
        <button onClick={() => setConfirmDelete(true)} disabled={busy} style={{ ...btn, color: NEG }}>
          <Trash2 className="h-3.5 w-3.5" /> {tt('Supprimer', 'Delete', 'Eliminar')}
        </button>
      )}
    </div>
  );
}
