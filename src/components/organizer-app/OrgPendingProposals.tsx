import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { toast } from 'sonner';
import { Handshake, Clock, Check, X, ArrowRight, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { fr, enUS } from 'date-fns/locale';

// ─── Yuno DA tokens (aligned with the Org dashboard) ───────────────────────────
const AMBER = '#F5A623';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

interface ContractRow { id: string; event_id: string; venue_id: string; org_signed_at: string | null; }
interface Proposal { contractId: string; eventId: string; title: string; posterUrl: string | null; startAt: string; venueName: string; }

/**
 * Inbox of co-event proposals awaiting THIS organizer's acceptance. A club that
 * proposes a co-event opens a contract in `pending_signatures` (club pre-signed);
 * the organizer must accept (sign) or decline before the co-event can sell. This
 * is the surface that makes a proposal actually "arrive" in the org dashboard —
 * without it the contract sat invisible. Renders nothing when there's nothing
 * pending. "Examiner" routes to the event detail where the SplitContractBanner
 * shows the split and signs; "Refuser" cancels the contract inline.
 */
export function OrgPendingProposals() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const tt = (frTxt: string, en: string, es?: string) => translate(language, frTxt, en, es);
  const locale = language === 'fr' ? fr : enUS;
  const [items, setItems] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    // Contracts where I'm the organizer, still pending, and I haven't signed yet.
    const { data: contracts } = await supabase
      .from('event_collab_contracts' as never)
      .select('id, event_id, venue_id, org_signed_at')
      .eq('organizer_user_id' as never, user.id as never)
      .eq('status' as never, 'pending_signatures' as never);
    const pending = ((contracts as unknown as ContractRow[]) || []).filter((c) => !c.org_signed_at);
    if (!pending.length) { setItems([]); setLoading(false); return; }

    const eventIds = pending.map((c) => c.event_id);
    const venueIds = Array.from(new Set(pending.map((c) => c.venue_id)));
    const [{ data: events }, { data: venues }] = await Promise.all([
      supabase.from('events').select('id, title, poster_url, start_at, end_at').in('id', eventIds),
      supabase.from('venues').select('id, name').in('id', venueIds),
    ]);
    const evMap = new Map((events || []).map((e) => [e.id, e]));
    const vMap = new Map((venues || []).map((v: { id: string; name: string }) => [v.id, v.name]));
    const list: Proposal[] = pending
      .map((c): Proposal | null => {
        const ev = evMap.get(c.event_id);
        if (!ev) return null; // not readable / deleted
        return {
          contractId: c.id, eventId: c.event_id, title: ev.title,
          posterUrl: ev.poster_url, startAt: ev.start_at,
          venueName: vMap.get(c.venue_id) || tt('Un club', 'A club', 'Un club'),
        };
      })
      .filter((p): p is Proposal => p !== null)
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    setItems(list);
    setLoading(false);
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const decline = async (contractId: string, eventId: string) => {
    setBusyId(contractId);
    try {
      const { error } = await supabase.rpc('cancel_event_collab_contract' as never, { p_contract_id: contractId } as never);
      if (error) throw error;
      // Let the club know its proposal was declined (best-effort).
      try {
        await supabase.functions.invoke('notify-split-proposal', {
          body: { kind: 'event', id: eventId, action: 'declined', proposer_side: 'organizer' },
        });
      } catch (e) { console.warn('Decline notify failed:', e); }
      toast.success(tt('Proposition refusée', 'Proposal declined', 'Propuesta rechazada'));
      setItems((prev) => prev.filter((p) => p.contractId !== contractId));
    } catch (e) {
      toast.error((e as { message?: string }).message || tt('Erreur', 'Error', 'Error'));
    } finally { setBusyId(null); }
  };

  if (loading || items.length === 0) return null;

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${AMBER}40`, borderRadius: 18, boxShadow: CARD_SHADOW, overflow: 'hidden' }}>
      <div className="flex items-center gap-2 px-5 pb-1 pt-4">
        <Handshake className="h-4 w-4" style={{ color: AMBER }} />
        <h2 style={{ color: T1, fontSize: 14, fontWeight: 600 }}>
          {items.length}{' '}
          {tt(
            items.length > 1 ? 'propositions de soirée à valider' : 'proposition de soirée à valider',
            items.length > 1 ? 'event proposals to review' : 'event proposal to review',
            items.length > 1 ? 'propuestas de evento por revisar' : 'propuesta de evento por revisar',
          )}
        </h2>
      </div>
      <p className="px-5 pb-3" style={{ color: T3, fontSize: 12 }}>
        {tt(
          'Un club vous propose de co-organiser une soirée. Acceptez pour ouvrir la billetterie, ou refusez.',
          'A club wants to co-organize an event with you. Accept to open ticketing, or decline.',
          'Un club quiere coorganizar un evento contigo. Acepta para abrir la venta, o rechaza.',
        )}
      </p>
      <div className="space-y-2 px-3 pb-3">
        {items.map((p) => (
          <div key={p.contractId} className="flex items-center gap-3 rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
            {p.posterUrl ? (
              <img src={p.posterUrl} alt="" className="h-14 w-11 flex-none rounded-lg object-cover" style={{ border: `1px solid ${BORDER}` }} />
            ) : (
              <div className="h-14 w-11 flex-none rounded-lg" style={{ background: 'rgba(255,255,255,0.04)' }} />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate" style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{p.title}</p>
              <p className="truncate" style={{ color: T2, fontSize: 12 }}>{tt('Proposé par', 'Proposed by', 'Propuesto por')} {p.venueName}</p>
              <p className="mt-0.5 flex items-center gap-1" style={{ color: T3, fontSize: 11 }}>
                <Clock className="h-3 w-3" />{format(new Date(p.startAt), 'd MMM yyyy · HH:mm', { locale })}
              </p>
            </div>
            <div className="flex flex-none flex-col gap-1.5 sm:flex-row">
              <button
                onClick={() => navigate(`/organizer-app/events/${p.eventId}`)}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold"
                style={{ background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.30)', color: '#FF5C63' }}
              >
                <Check className="h-3.5 w-3.5" />{tt('Examiner', 'Review', 'Revisar')}<ArrowRight className="h-3 w-3" />
              </button>
              <button
                onClick={() => decline(p.contractId, p.eventId)}
                disabled={busyId === p.contractId}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium"
                style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, opacity: busyId === p.contractId ? 0.5 : 1 }}
              >
                {busyId === p.contractId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                {tt('Refuser', 'Decline', 'Rechazar')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
