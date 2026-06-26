import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { toast } from 'sonner';
import { Handshake, Clock, Check, X, ArrowRight, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { fr, enUS, es } from 'date-fns/locale';

// ─── Yuno DA tokens (aligned with the Org dashboard) ───────────────────────────
const AMBER = '#F5A623';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

interface ContractRow {
  id: string;
  event_id: string;
  venue_id: string;
  organizer_user_id: string;
  org_signed_at: string | null;
  venue_signed_at: string | null;
}
interface Proposal {
  contractId: string;
  eventId: string;
  title: string;
  posterUrl: string | null;
  startAt: string;
  /** Name of the OTHER party who proposed the co-event. */
  partnerName: string;
}

interface Props {
  /** Which side is viewing. 'organizer' on the org dashboard, 'venue' on the club dashboard. */
  role: 'venue' | 'organizer';
  /** Required when role==='venue' — the club whose incoming proposals to show. */
  venueId?: string;
  /** Called after a proposal is declined so the parent list can refresh. */
  onChanged?: () => void;
}

/**
 * Inbox of co-event proposals awaiting THIS side's signature — symmetric.
 *
 * A co-event proposal opens a contract in `pending_signatures` where the PROPOSING
 * side is pre-signed and the partner must accept (sign) or decline before the
 * co-event can sell (CONTRACT GUARD). This surface is what makes a proposal
 * actually "arrive" in the partner's dashboard instead of sitting invisible.
 *
 * - role='organizer' → contracts where I'm the organizer and I haven't signed yet
 *   (a club proposed). "Review" routes to the org event detail.
 * - role='venue'     → contracts for my venue where the club hasn't signed yet
 *   (an organizer proposed). "Review" routes to the club co-event dashboard.
 *
 * Renders nothing when there's nothing pending.
 */
export function CollabProposalsInbox({ role, venueId, onChanged }: Props) {
  const { user } = useAuth();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const tt = (frTxt: string, en: string, esTxt?: string) => translate(language, frTxt, en, esTxt);
  const locale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const [items, setItems] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user || (role === 'venue' && !venueId)) { setLoading(false); return; }

    // Contracts still pending, addressed to MY side and not yet signed by me.
    let q = supabase
      .from('event_collab_contracts' as never)
      .select('id, event_id, venue_id, organizer_user_id, org_signed_at, venue_signed_at')
      .eq('status' as never, 'pending_signatures' as never);
    q = role === 'organizer'
      ? q.eq('organizer_user_id' as never, user.id as never)
      : q.eq('venue_id' as never, venueId as never);
    const { data: contracts } = await q;

    const pending = ((contracts as unknown as ContractRow[]) || [])
      .filter((c) => (role === 'organizer' ? !c.org_signed_at : !c.venue_signed_at));
    if (!pending.length) { setItems([]); setLoading(false); return; }

    const eventIds = pending.map((c) => c.event_id);
    const { data: events } = await supabase
      .from('events').select('id, title, poster_url, start_at, end_at').in('id', eventIds);
    const evMap = new Map((events || []).map((e) => [e.id, e]));

    // The proposing party's display name: venue name (org view) or organizer name (venue view).
    let nameMap = new Map<string, string>();
    if (role === 'organizer') {
      const venueIds = Array.from(new Set(pending.map((c) => c.venue_id)));
      const { data: venues } = await supabase.from('venues').select('id, name').in('id', venueIds);
      nameMap = new Map(((venues as { id: string; name: string }[] | null) || []).map((v) => [v.id, v.name]));
    } else {
      // organizer_profiles is publicly readable; profiles RLS hides org rows from owners.
      const orgIds = Array.from(new Set(pending.map((c) => c.organizer_user_id)));
      const { data: profs } = await supabase
        .from('organizer_profiles' as never)
        .select('user_id, display_name')
        .in('user_id' as never, orgIds as never);
      nameMap = new Map(
        ((profs as unknown as { user_id: string; display_name: string | null }[]) || [])
          .map((p) => [p.user_id, p.display_name || '']),
      );
    }

    const list: Proposal[] = pending
      .map((c): Proposal | null => {
        const ev = evMap.get(c.event_id);
        if (!ev) return null; // not readable / deleted
        const key = role === 'organizer' ? c.venue_id : c.organizer_user_id;
        return {
          contractId: c.id, eventId: c.event_id, title: ev.title,
          posterUrl: ev.poster_url, startAt: ev.start_at,
          partnerName: nameMap.get(key) || (role === 'organizer'
            ? tt('Un club', 'A club', 'Un club')
            : tt('Un organisateur', 'An organizer', 'Un organizador')),
        };
      })
      .filter((p): p is Proposal => p !== null)
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    setItems(list);
    setLoading(false);
  }, [user, role, venueId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const reviewPath = (eventId: string) =>
    role === 'organizer' ? `/organizer-app/events/${eventId}` : `/owner/collab/event/${eventId}`;

  const decline = async (contractId: string, eventId: string) => {
    setBusyId(contractId);
    try {
      const { error } = await supabase.rpc('cancel_event_collab_contract' as never, { p_contract_id: contractId } as never);
      if (error) throw error;
      // Let the proposing party know it was declined (best-effort).
      try {
        await supabase.functions.invoke('notify-split-proposal', {
          body: { kind: 'event', id: eventId, action: 'declined', proposer_side: role },
        });
      } catch (e) { console.warn('Decline notify failed:', e); }
      toast.success(tt('Proposition refusée', 'Proposal declined', 'Propuesta rechazada'));
      setItems((prev) => prev.filter((p) => p.contractId !== contractId));
      onChanged?.();
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
        {role === 'organizer'
          ? tt(
              'Un club vous propose de co-organiser une soirée. Acceptez pour ouvrir la billetterie, ou refusez.',
              'A club wants to co-organize an event with you. Accept to open ticketing, or decline.',
              'Un club quiere coorganizar un evento contigo. Acepta para abrir la venta, o rechaza.',
            )
          : tt(
              'Un organisateur vous propose de co-organiser une soirée. Acceptez pour ouvrir la billetterie, ou refusez.',
              'An organizer wants to co-organize an event with you. Accept to open ticketing, or decline.',
              'Un organizador quiere coorganizar un evento contigo. Acepta para abrir la venta, o rechaza.',
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
              <p className="truncate" style={{ color: T2, fontSize: 12 }}>{tt('Proposé par', 'Proposed by', 'Propuesto por')} {p.partnerName}</p>
              <p className="mt-0.5 flex items-center gap-1" style={{ color: T3, fontSize: 11 }}>
                <Clock className="h-3 w-3" />{format(new Date(p.startAt), 'd MMM yyyy · HH:mm', { locale })}
              </p>
            </div>
            <div className="flex flex-none flex-col gap-1.5 sm:flex-row">
              <button
                onClick={() => navigate(reviewPath(p.eventId))}
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
