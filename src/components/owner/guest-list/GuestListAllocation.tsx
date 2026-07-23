import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { toast } from 'sonner';
import { Send, Clock, XCircle, Plus } from 'lucide-react';
import { RED, T1, T2, T3, BORDER, INNER_BG, CARD_BG, CARD_SHADOW } from './ui';

type Req = {
  id: string;
  requested_quota: number;
  requested_quota_normal: number;
  requested_quota_drink: number;
  requested_quota_table: number;
  requested_quota_female: number | null;
  requested_quota_male: number | null;
  status: 'pending' | 'approved' | 'denied' | 'cancelled' | string;
  granted_quota: number | null;
  decision_note: string | null;
  created_at: string;
};

// RPC absentes des types générés — on borne l'appel sur `supabase` (jamais détaché).
const rpc = (name: string, args: Record<string, unknown>) =>
  supabase.rpc(name as never, args as never);

/**
 * Côté ORGANISATEUR, sur une co-soirée dont le club tient l'opérationnel :
 * l'orga ne s'auto-alloue pas des places, il en DEMANDE. Le club approuve (en
 * ajustant s'il veut) ou refuse — c'est sa capacité de porte.
 *
 * Affiche l'état courant de la demande (en attente / refusée) et le bouton qui
 * ouvre le formulaire. Une nouvelle demande remplace la précédente en attente.
 */
export function GuestListAllocation({ eventId, hasAllocation, onChanged }: {
  eventId: string;
  /** L'orga a déjà une part d'allocation accordée. */
  hasAllocation: boolean;
  onChanged: () => void;
}) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  /** « 10 standard · 5 avec boisson · 2 table » — on n'affiche que ce qui est demandé. */
  const breakdown = (n: number, d: number, t: number) => [
    n > 0 ? `${n} ${tt('standard', 'standard', 'estándar')}` : null,
    d > 0 ? `${d} ${tt('avec boisson', 'with drink', 'con bebida')}` : null,
    t > 0 ? `${t} ${tt('table', 'table', 'mesa')}` : null,
  ].filter(Boolean).join(' · ');
  const [req, setReq] = useState<Req | null>(null);
  const [open, setOpen] = useState(false);
  // Une allocation se demande PAR TYPE d'entrée, comme les parts déléguées :
  // le total est la somme, includes_drink se déduit de « avec boisson » > 0.
  const [qNormal, setQNormal] = useState(20);
  const [qDrink, setQDrink] = useState(0);
  const [qTable, setQTable] = useState(0);
  const [genderSplit, setGenderSplit] = useState(false);
  const [qFemale, setQFemale] = useState(0);
  const [qMale, setQMale] = useState(0);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const total = qNormal + qDrink + qTable;

  const load = useCallback(async () => {
    // Table absente des types générés → on borne l'appel comme les autres
    // tables non typées (cf. useEventCollabContract).
    const { data } = await supabase
      .from('guest_list_allocation_requests' as never)
      .select('*')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false })
      .limit(1);
    setReq(((data as unknown as Req[] | null) ?? [])[0] ?? null);
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (total <= 0) { toast.error(tt('Demande au moins une place.', 'Request at least one spot.', 'Solicita al menos una plaza.')); return; }
    if (genderSplit && qFemale + qMale > total) {
      toast.error(tt('La répartition F/H dépasse le total.', 'The F/M split exceeds the total.', 'El reparto M/H supera el total.'));
      return;
    }
    setSaving(true);
    const { error } = await rpc('request_guest_list_allocation', {
      p_event_id: eventId,
      p_quota_normal: qNormal,
      p_quota_drink: qDrink,
      p_quota_table: qTable,
      p_quota_female: genderSplit ? qFemale : null,
      p_quota_male: genderSplit ? qMale : null,
      p_note: note.trim() || null,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(tt('Demande envoyée au club.', 'Request sent to the club.', 'Solicitud enviada al club.'));
    setOpen(false);
    setNote('');
    load();
    onChanged();
  };

  const pending = req?.status === 'pending';
  const denied = req?.status === 'denied';

  const card: React.CSSProperties = {
    padding: '14px 16px', borderRadius: 14, background: CARD_BG,
    border: `1px solid ${BORDER}`, boxShadow: CARD_SHADOW,
  };
  const inputStyle: React.CSSProperties = {
    width: '100%', background: INNER_BG, border: `1px solid ${BORDER}`, color: T1,
    outline: 'none', borderRadius: 10, padding: '9px 11px', fontSize: 13,
  };

  return (
    <div style={card}>
      {pending ? (
        <div className="flex items-start gap-2.5">
          <Clock className="mt-0.5 h-4 w-4 shrink-0" style={{ color: '#E8A019' }} />
          <div className="min-w-0 flex-1">
            <p style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>
              {tt('Demande en attente', 'Request pending', 'Solicitud pendiente')}
            </p>
            <p className="mt-0.5" style={{ color: T3, fontSize: 12 }}>
              {tt(
                `${req!.requested_quota} places demandées — le club doit valider.`,
                `${req!.requested_quota} spots requested — waiting for the club.`,
                `${req!.requested_quota} plazas solicitadas — el club debe validar.`,
              )}
            </p>
            <p style={{ color: T2, fontSize: 11.5 }}>
              {breakdown(req!.requested_quota_normal, req!.requested_quota_drink, req!.requested_quota_table)}
            </p>
            <button type="button" onClick={() => {
              setQNormal(req!.requested_quota_normal);
              setQDrink(req!.requested_quota_drink);
              setQTable(req!.requested_quota_table);
              setGenderSplit(req!.requested_quota_female !== null || req!.requested_quota_male !== null);
              setQFemale(req!.requested_quota_female ?? 0);
              setQMale(req!.requested_quota_male ?? 0);
              setOpen(true);
            }}
              className="mt-2 cursor-pointer" style={{ background: 'transparent', border: 'none', color: RED, fontSize: 12, fontWeight: 600, padding: 0 }}>
              {tt('Modifier la demande', 'Edit request', 'Modificar solicitud')}
            </button>
          </div>
        </div>
      ) : (
        <>
          {denied && (
            <div className="mb-3 flex items-start gap-2.5">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: '#FF5C63' }} />
              <div className="min-w-0">
                <p style={{ color: T1, fontSize: 13, fontWeight: 600 }}>
                  {tt('Demande refusée', 'Request declined', 'Solicitud rechazada')}
                </p>
                {req?.decision_note && <p className="mt-0.5" style={{ color: T3, fontSize: 12 }}>{req.decision_note}</p>}
              </div>
            </div>
          )}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>
                {hasAllocation
                  ? tt('Besoin de plus de places ?', 'Need more spots?', '¿Necesitas más plazas?')
                  : tt('Aucune allocation', 'No allocation yet', 'Sin asignación')}
              </p>
              <p className="mt-0.5" style={{ color: T3, fontSize: 12, lineHeight: 1.45 }}>
                {tt(
                  "Sur cette soirée, c'est le club qui tient la porte : il t'accorde tes places.",
                  'The club runs the door for this event: it grants you your spots.',
                  'En esta noche el club lleva la puerta: él te concede tus plazas.',
                )}
              </p>
            </div>
            <button type="button" onClick={() => setOpen(true)}
              className="flex shrink-0 items-center gap-1.5 cursor-pointer"
              style={{ padding: '9px 13px', borderRadius: 10, background: 'rgba(232,25,44,0.10)', border: '1px solid rgba(232,25,44,0.35)', color: '#ff5d68', fontSize: 12.5, fontWeight: 600 }}>
              <Plus className="h-3.5 w-3.5" />
              {hasAllocation
                ? tt('Demander plus', 'Request more', 'Pedir más')
                : tt('Demander une allocation', 'Request an allocation', 'Solicitar asignación')}
            </button>
          </div>
        </>
      )}

      {open && (
        <div className="mt-4 space-y-3" style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 14 }}>
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <p style={{ color: T2, fontSize: 12.5, fontWeight: 500 }}>
                {tt('Places par type', 'Spots per type', 'Plazas por tipo')}
              </p>
              <p style={{ color: total > 0 ? T1 : T3, fontSize: 12 }}>
                {tt(`Total : ${total}`, `Total: ${total}`, `Total: ${total}`)}
              </p>
            </div>
            <div className="space-y-2">
              {([
                { label: tt('Standard', 'Standard', 'Estándar'), v: qNormal, set: setQNormal },
                { label: tt('Avec boisson', 'With drink', 'Con bebida'), v: qDrink, set: setQDrink },
                { label: tt('Table', 'Table', 'Mesa'), v: qTable, set: setQTable },
              ]).map(row => (
                <div key={row.label} className="flex items-center justify-between gap-3">
                  <span style={{ color: T2, fontSize: 12.5 }}>{row.label}</span>
                  <input type="number" min={0} max={10000} value={row.v}
                    onChange={e => row.set(Math.max(0, Number(e.target.value)))}
                    style={{ ...inputStyle, width: 96, textAlign: 'center' }} />
                </div>
              ))}
            </div>
          </div>

          <div>
            <button type="button" onClick={() => setGenderSplit(v => !v)}
              className="flex w-full items-center justify-between cursor-pointer"
              style={{ background: 'transparent', border: 'none', padding: 0, color: T2, fontSize: 12.5 }}>
              {tt('Répartition femmes / hommes', 'Women / men split', 'Reparto mujeres / hombres')}
              <span style={{ color: genderSplit ? RED : T3, fontSize: 12, fontWeight: 600 }}>
                {genderSplit ? tt('Activée', 'On', 'Activado') : tt('Non', 'Off', 'No')}
              </span>
            </button>
            {genderSplit && (
              <div className="mt-2 flex items-center gap-3">
                <div className="flex flex-1 items-center justify-between gap-2">
                  <span style={{ color: T3, fontSize: 12 }}>♀</span>
                  <input type="number" min={0} max={total} value={qFemale}
                    onChange={e => setQFemale(Math.max(0, Number(e.target.value)))}
                    style={{ ...inputStyle, width: 88, textAlign: 'center' }} />
                </div>
                <div className="flex flex-1 items-center justify-between gap-2">
                  <span style={{ color: T3, fontSize: 12 }}>♂</span>
                  <input type="number" min={0} max={total} value={qMale}
                    onChange={e => setQMale(Math.max(0, Number(e.target.value)))}
                    style={{ ...inputStyle, width: 88, textAlign: 'center' }} />
                </div>
              </div>
            )}
          </div>
          <div>
            <p style={{ color: T2, fontSize: 12.5, fontWeight: 500, marginBottom: 6 }}>
              {tt('Message au club (facultatif)', 'Message to the club (optional)', 'Mensaje al club (opcional)')}
            </p>
            <textarea rows={2} value={note} onChange={e => setNote(e.target.value)}
              placeholder={tt('Ex : je ramène une grosse commu ce soir-là.', 'e.g. I bring a big crowd that night.', 'Ej: traigo mucha gente esa noche.')}
              style={{ ...inputStyle, resize: 'none' }} />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={submit} disabled={saving}
              className="flex items-center gap-1.5 cursor-pointer"
              style={{ padding: '10px 14px', borderRadius: 10, background: RED, border: 'none', color: '#fff', fontSize: 13, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
              <Send className="h-3.5 w-3.5" />
              {saving ? tt('Envoi…', 'Sending…', 'Enviando…') : tt('Envoyer la demande', 'Send request', 'Enviar solicitud')}
            </button>
            <button type="button" onClick={() => setOpen(false)} disabled={saving}
              className="cursor-pointer"
              style={{ padding: '10px 14px', borderRadius: 10, background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, fontSize: 13 }}>
              {tt('Annuler', 'Cancel', 'Cancelar')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default GuestListAllocation;
