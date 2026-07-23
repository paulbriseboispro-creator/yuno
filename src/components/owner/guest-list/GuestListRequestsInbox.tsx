import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { toast } from 'sonner';
import { Inbox, Check, X } from 'lucide-react';
import { RED, T1, T2, T3, BORDER, INNER_BG, CARD_BG, CARD_SHADOW } from './ui';

type Req = {
  id: string;
  requester_user_id: string;
  requested_quota: number;
  note: string | null;
  created_at: string;
};

const rpc = (name: string, args: Record<string, unknown>) =>
  supabase.rpc(name as never, args as never);

/**
 * Côté DÉTENTEUR DE L'OPÉRATIONNEL (le club en général) : la file des demandes
 * d'allocation guest list déposées par l'organisateur. On accorde (en ajustant
 * le nombre de places si besoin) ou on refuse. À l'accord, la part de l'orga est
 * créée/redimensionnée côté serveur.
 *
 * Rien ne s'affiche s'il n'y a aucune demande en attente — la RLS ne remonte que
 * les demandes des soirées dont on tient l'opérationnel.
 */
export function GuestListRequestsInbox({ eventId, onDecided }: { eventId: string; onDecided: () => void }) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [grant, setGrant] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Table absente des types générés → appel borné (cf. useEventCollabContract).
    const { data } = await supabase
      .from('guest_list_allocation_requests' as never)
      .select('*')
      .eq('event_id', eventId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    const list = (data as unknown as Req[] | null) ?? [];
    setReqs(list);
    setGrant(Object.fromEntries(list.map(r => [r.id, r.requested_quota])));

    const ids = [...new Set(list.map(r => r.requester_user_id))];
    if (ids.length) {
      const { data: profs } = await supabase
        .from('organizer_profiles')
        .select('user_id, display_name')
        .in('user_id', ids);
      setNames(Object.fromEntries(((profs as { user_id: string; display_name: string | null }[] | null) ?? [])
        .map(p => [p.user_id, p.display_name || ''])));
    }
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  const decide = async (id: string, approve: boolean) => {
    setBusy(id);
    const { error } = await rpc('decide_guest_list_allocation_request', {
      p_request_id: id,
      p_approve: approve,
      p_granted_quota: approve ? (grant[id] ?? null) : null,
    });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(approve
      ? tt('Allocation accordée.', 'Allocation granted.', 'Asignación concedida.')
      : tt('Demande refusée.', 'Request declined.', 'Solicitud rechazada.'));
    load();
    onDecided();
  };

  if (!reqs.length) return null;

  const inputStyle: React.CSSProperties = {
    width: 78, background: INNER_BG, border: `1px solid ${BORDER}`, color: T1,
    outline: 'none', borderRadius: 9, padding: '7px 9px', fontSize: 13, textAlign: 'center',
  };

  return (
    <div style={{ padding: '14px 16px', borderRadius: 14, background: CARD_BG, border: '1px solid rgba(232,25,44,0.28)', boxShadow: CARD_SHADOW }}>
      <div className="mb-3 flex items-center gap-2">
        <Inbox className="h-4 w-4" style={{ color: RED }} />
        <p style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>
          {tt('Demandes de guest list', 'Guest list requests', 'Solicitudes de guest list')}
        </p>
        <span className="rounded-full px-2 py-0.5" style={{ background: 'rgba(232,25,44,0.14)', color: RED, fontSize: 11, fontWeight: 700 }}>
          {reqs.length}
        </span>
      </div>

      <div className="space-y-2.5">
        {reqs.map(r => (
          <div key={r.id} className="rounded-xl px-3 py-2.5" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
            <p style={{ color: T1, fontSize: 13, fontWeight: 560 }}>
              {names[r.requester_user_id] || tt('Organisateur', 'Organizer', 'Organizador')}
            </p>
            <p className="mt-0.5" style={{ color: T3, fontSize: 12 }}>
              {tt(
                `Demande ${r.requested_quota} places`,
                `Requests ${r.requested_quota} spots`,
                `Solicita ${r.requested_quota} plazas`,
              )}
            </p>
            {r.note && <p className="mt-1" style={{ color: T2, fontSize: 12, fontStyle: 'italic' }}>« {r.note} »</p>}

            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <span style={{ color: T3, fontSize: 11.5 }}>{tt('Accorder', 'Grant', 'Conceder')}</span>
              <input type="number" min={1} max={10000} value={grant[r.id] ?? r.requested_quota}
                onChange={e => setGrant(g => ({ ...g, [r.id]: Math.max(1, Number(e.target.value)) }))}
                style={inputStyle} />
              <button type="button" disabled={busy === r.id} onClick={() => decide(r.id, true)}
                className="flex items-center gap-1.5 cursor-pointer"
                style={{ padding: '8px 12px', borderRadius: 9, background: RED, border: 'none', color: '#fff', fontSize: 12.5, fontWeight: 600, opacity: busy === r.id ? 0.6 : 1 }}>
                <Check className="h-3.5 w-3.5" />{tt('Valider', 'Approve', 'Validar')}
              </button>
              <button type="button" disabled={busy === r.id} onClick={() => decide(r.id, false)}
                className="flex items-center gap-1.5 cursor-pointer"
                style={{ padding: '8px 12px', borderRadius: 9, background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, fontSize: 12.5 }}>
                <X className="h-3.5 w-3.5" />{tt('Refuser', 'Decline', 'Rechazar')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default GuestListRequestsInbox;
