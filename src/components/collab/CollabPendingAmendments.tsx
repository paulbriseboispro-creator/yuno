import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { FileSignature, ArrowRight, Clock } from 'lucide-react';
import { COLLAB_DOMAINS, normalizeResponsibilities, type CollabDomain, type DomainHolder } from '@/utils/collabResponsibilities';
import { normalizeSplitRules } from '@/lib/splitRules';
import { COLLAB_TERMS_VERSION } from '@/lib/collabContractTerms';

const T1 = 'rgba(255,255,255,0.96)';
const T3 = 'rgba(255,255,255,0.36)';
const RED = '#E8192C';
const BORDER = 'rgba(255,255,255,0.085)';
const CARD_BG = 'rgba(255,255,255,0.022)';
const INNER_BG = 'rgba(255,255,255,0.032)';

type AmendmentRow = {
  id: string;
  contract_id: string | null;
  series_contract_id: string | null;
  venue_id: string;
  organizer_user_id: string;
  responsibilities: Record<string, string> | null;
  split_rules: Record<string, unknown> | null;
  prev_responsibilities: Record<string, string> | null;
  prev_split_rules: Record<string, unknown> | null;
  reason: string | null;
  proposed_by: string;
  venue_signed_at: string | null;
  org_signed_at: string | null;
  created_at: string;
};

/**
 * Avenants en attente de MA signature.
 *
 * Le pendant du dialogue de proposition : l'avenant ne prend effet qu'ici, quand
 * l'autre partie contresigne. Tant que cette carte est affichée, les conditions
 * d'origine s'appliquent — on montre donc le DELTA (avant → après), pas l'état
 * final : ce qu'on signe, c'est le changement.
 */
export function CollabPendingAmendments({
  role, venueId, onChanged,
}: {
  role: 'venue' | 'organizer';
  venueId?: string | null;
  onChanged?: () => void;
}) {
  const { user } = useAuth();
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [rows, setRows] = useState<AmendmentRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user || (role === 'venue' && !venueId)) { setRows([]); return; }
    let q = supabase
      .from('event_collab_amendments' as never)
      .select('*')
      .eq('status' as never, 'pending_signatures' as never);
    q = role === 'organizer'
      ? q.eq('organizer_user_id' as never, user.id as never)
      : q.eq('venue_id' as never, venueId as never);
    const { data, error } = await q;
    if (error) { setRows([]); return; }
    const all = ((data as unknown as AmendmentRow[]) || []);
    // N'afficher que ce qui attend VRAIMENT ma signature. Un avenant que j'ai
    // proposé porte déjà la mienne : il attend l'autre, pas moi.
    setRows(all.filter(a => (role === 'venue' ? !a.venue_signed_at : !a.org_signed_at)));
  }, [user, role, venueId]);

  useEffect(() => { load(); }, [load]);

  const sign = async (a: AmendmentRow) => {
    setBusyId(a.id);
    try {
      const { error } = await supabase.rpc('sign_collab_amendment' as never, {
        p_amendment_id: a.id,
        p_user_agent: navigator.userAgent,
        p_terms_version: COLLAB_TERMS_VERSION,
      } as never);
      if (error) throw error;
      toast.success(tt('Avenant signé', 'Amendment signed', 'Adenda firmada'), {
        description: tt(
          'Les nouvelles conditions sont en vigueur.',
          'The new terms are now in force.',
          'Las nuevas condiciones están en vigor.',
        ),
      });
      setRows(prev => prev.filter(x => x.id !== a.id));
      onChanged?.();
    } catch (e) {
      toast.error((e as { message?: string }).message || tt('Erreur', 'Error', 'Error'));
    } finally { setBusyId(null); }
  };

  const refuse = async (a: AmendmentRow) => {
    if (!confirm(tt(
      "Refuser cet avenant ? Les conditions actuelles restent en vigueur.",
      'Refuse this amendment? The current terms stay in force.',
      '¿Rechazar esta adenda? Las condiciones actuales siguen vigentes.',
    ))) return;
    setBusyId(a.id);
    try {
      const { error } = await supabase.rpc('cancel_collab_amendment' as never, { p_amendment_id: a.id } as never);
      if (error) throw error;
      toast.success(tt('Avenant refusé', 'Amendment refused', 'Adenda rechazada'));
      setRows(prev => prev.filter(x => x.id !== a.id));
      onChanged?.();
    } catch (e) {
      toast.error((e as { message?: string }).message || tt('Erreur', 'Error', 'Error'));
    } finally { setBusyId(null); }
  };

  if (!rows.length) return null;

  const domainLabel = (d: CollabDomain) => tt(
    d === 'creative' ? 'Création' : d === 'ticketing' ? 'Billetterie' : d === 'operations' ? 'Opérations' : 'Promotion',
    d === 'creative' ? 'Creative' : d === 'ticketing' ? 'Ticketing' : d === 'operations' ? 'Operations' : 'Promotion',
    d === 'creative' ? 'Creación' : d === 'ticketing' ? 'Entradas' : d === 'operations' ? 'Operaciones' : 'Promoción',
  );
  const holderLabel = (h: DomainHolder) => tt(
    h === 'venue' ? 'Club' : h === 'organizer' ? 'Organisateur' : 'Les deux',
    h === 'venue' ? 'Club' : h === 'organizer' ? 'Organizer' : 'Both',
    h === 'venue' ? 'Club' : h === 'organizer' ? 'Organizador' : 'Ambos',
  );

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, overflow: 'hidden' }}>
      <div className="flex items-center gap-2 px-5 pb-1 pt-4">
        <FileSignature className="h-4 w-4" style={{ color: RED }} />
        <h2 style={{ color: T1, fontSize: 14, fontWeight: 600 }}>
          {tt('Avenants à signer', 'Amendments to sign', 'Adendas por firmar')}
        </h2>
      </div>
      <p className="px-5" style={{ color: T3, fontSize: 11.5 }}>
        {tt(
          "Tant que vous n'avez pas signé, les conditions actuelles s'appliquent.",
          'Until you sign, the current terms apply.',
          'Hasta que firmes, se aplican las condiciones actuales.',
        )}
      </p>

      <div className="space-y-3 p-5">
        {rows.map(a => {
          const prev = normalizeResponsibilities(a.prev_responsibilities, null);
          const next = a.responsibilities ? normalizeResponsibilities(a.responsibilities, null) : null;
          const changed = next ? COLLAB_DOMAINS.filter(d => next[d] !== prev[d]) : [];
          const prevSplit = normalizeSplitRules(a.prev_split_rules);
          const nextSplit = normalizeSplitRules(a.split_rules);

          return (
            <div key={a.id} className="rounded-xl p-3.5 space-y-2" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
              <div className="flex items-center gap-1.5" style={{ color: T3, fontSize: 11 }}>
                <Clock className="h-3 w-3" />
                {new Date(a.created_at).toLocaleDateString('fr-FR')}
              </div>

              {changed.map(d => (
                <p key={d} className="flex flex-wrap items-center gap-1.5" style={{ color: T3, fontSize: 12 }}>
                  <span style={{ color: T1, fontWeight: 600 }}>{domainLabel(d)}</span>
                  <span>{holderLabel(prev[d])}</span>
                  <ArrowRight className="h-3 w-3" />
                  <span style={{ color: RED }}>{holderLabel(next![d])}</span>
                </p>
              ))}

              {nextSplit && (
                <p style={{ color: T3, fontSize: 12 }}>
                  <span style={{ color: T1, fontWeight: 600 }}>{tt('Partage des revenus', 'Revenue split', 'Reparto de ingresos')}</span>
                  {' — '}
                  {tt('Billets', 'Tickets', 'Entradas')} {prevSplit ? `${prevSplit.tickets.venue_pct}%` : '—'}
                  {' → '}
                  <span style={{ color: RED }}>{nextSplit.tickets.venue_pct}%</span>
                  {' '}{tt('club', 'club', 'club')}
                </p>
              )}

              {a.reason && (
                <p style={{ color: T3, fontSize: 11.5, fontStyle: 'italic' }}>« {a.reason} »</p>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="button" disabled={busyId === a.id} onClick={() => sign(a)}
                  className="rounded-lg px-3 py-1.5 text-[12px] font-medium"
                  style={{ background: 'rgba(232,25,44,0.14)', border: '1px solid rgba(232,25,44,0.32)', color: RED, cursor: 'pointer' }}
                >
                  {tt('Signer', 'Sign', 'Firmar')}
                </button>
                <button
                  type="button" disabled={busyId === a.id} onClick={() => refuse(a)}
                  className="rounded-lg px-3 py-1.5 text-[12px] font-medium"
                  style={{ background: 'transparent', border: `1px solid ${BORDER}`, color: T3, cursor: 'pointer' }}
                >
                  {tt('Refuser', 'Refuse', 'Rechazar')}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default CollabPendingAmendments;
