import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { toast } from 'sonner';
import { Handshake, Clock, Check, X, ArrowRight, Loader2, Repeat } from 'lucide-react';
import { format } from 'date-fns';
import { fr, enUS, es } from 'date-fns/locale';
import { CollabContractTermsDialog } from '@/components/CollabContractTermsDialog';
import { loadCollabSeriesContractPdfData } from '@/lib/collabContractData';
import { COLLAB_TERMS_VERSION } from '@/lib/collabContractTerms';
import type { CollabContractPDFData } from '@/lib/generateContractPDF';
import type { EventCollabSeriesContractRow } from '@/hooks/useEventCollabSeriesContract';

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
interface SeriesProposal {
  row: EventCollabSeriesContractRow;
  templateName: string;
  posterUrl: string | null;
  /** Localized "Every Friday · 23:00". */
  cadence: string;
  /** "Résidence · tous les vendredis · 23:00" — for the contract PDF header. */
  label: string;
  upcomingCount: number;
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

// 0 = Sunday — matches Postgres EXTRACT(DOW) / JS getDay().
const WEEKDAYS = {
  fr: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'],
  en: ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'],
  es: ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'],
};

/**
 * Inbox of co-event proposals awaiting THIS side's signature — symmetric.
 *
 * Two kinds:
 *  • Per-soirée proposal: a co-event opens a contract in pending_signatures (proposer
 *    pre-signed) the partner must sign before sales open (CONTRACT GUARD).
 *  • RECURRING framework proposal (contrat-cadre): one signature commits both parties to
 *    every occurrence of a residency. When a pending framework covers a recurring series,
 *    its per-occurrence proposals are FOLDED into a single "sign once" card — signing it
 *    activates all pending occurrences and auto-accepts future ones.
 *
 * Renders nothing when there's nothing pending.
 */
export function CollabProposalsInbox({ role, venueId, onChanged }: Props) {
  const { user } = useAuth();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const tt = (frTxt: string, en: string, esTxt?: string) => translate(language, frTxt, en, esTxt);
  const locale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const lang = language === 'en' ? 'en' : language === 'es' ? 'es' : 'fr';
  const [items, setItems] = useState<Proposal[]>([]);
  const [series, setSeries] = useState<SeriesProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Series-contract review/sign dialog.
  const [signing, setSigning] = useState<SeriesProposal | null>(null);
  const [signData, setSignData] = useState<CollabContractPDFData | null>(null);
  const [confirming, setConfirming] = useState(false);

  const everyWeekday = (dow: number, time: string) => {
    const hhmm = (time || '').slice(0, 5);
    const day = WEEKDAYS[lang][dow] ?? '';
    const prefix = lang === 'en' ? 'Every ' : lang === 'es' ? 'Todos los ' : 'Tous les ';
    const w = lang === 'fr' ? `${day}s` : day; // "vendredi" → "vendredis"
    return `${prefix}${w} · ${hhmm}`;
  };

  const load = useCallback(async () => {
    if (!user || (role === 'venue' && !venueId)) { setLoading(false); return; }

    // ── Live recurring framework contracts addressed to my side (pending OR active). ──
    // Active ones don't surface as a card but their template_ids still suppress any stale
    // per-occurrence cards; pending-not-signed-by-me ones become the "sign once" card.
    let sq = supabase
      .from('event_collab_series_contracts' as never)
      .select('*')
      .in('status' as never, ['pending_signatures', 'active'] as never);
    sq = role === 'organizer'
      ? sq.eq('organizer_user_id' as never, user.id as never)
      : sq.eq('venue_id' as never, venueId as never);
    const { data: seriesRows } = await sq;
    const liveSeries = ((seriesRows as unknown as EventCollabSeriesContractRow[]) || []);
    const coveredTemplateIds = new Set(liveSeries.map((s) => s.template_id));
    const pendingSeries = liveSeries.filter((s) =>
      s.status === 'pending_signatures' && (role === 'organizer' ? !s.org_signed_at : !s.venue_signed_at));

    // ── Per-occurrence contracts still pending, addressed to MY side, unsigned by me. ──
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

    // Events for those occurrence contracts (recurring_template_id → fold under a framework).
    const evMap = new Map<string, { id: string; title: string; poster_url: string | null; start_at: string; recurring_template_id: string | null }>();
    if (pending.length) {
      const { data: events } = await supabase
        .from('events').select('id, title, poster_url, start_at, recurring_template_id').in('id', pending.map((c) => c.event_id));
      for (const e of (events || []) as { id: string; title: string; poster_url: string | null; start_at: string; recurring_template_id: string | null }[]) evMap.set(e.id, e);
    }

    // Templates + upcoming counts for the framework cards.
    const tplMap = new Map<string, { id: string; name: string; poster_url: string | null; day_of_week: number; start_time: string }>();
    const countMap = new Map<string, number>();
    if (pendingSeries.length) {
      const tplIds = pendingSeries.map((s) => s.template_id);
      const { data: tpls } = await supabase
        .from('owner_recurring_templates').select('id, name, poster_url, day_of_week, start_time').in('id', tplIds);
      for (const tp of (tpls || []) as { id: string; name: string; poster_url: string | null; day_of_week: number; start_time: string }[]) tplMap.set(tp.id, tp);
      const { data: occ } = await supabase
        .from('events').select('id, recurring_template_id').in('recurring_template_id', tplIds).gt('start_at', new Date().toISOString());
      for (const o of (occ || []) as { id: string; recurring_template_id: string | null }[]) {
        if (o.recurring_template_id) countMap.set(o.recurring_template_id, (countMap.get(o.recurring_template_id) || 0) + 1);
      }
    }

    // ── Partner display names (venue name for org view, organizer name for venue view). ──
    const venueIds = new Set<string>();
    const orgIds = new Set<string>();
    pending.forEach((c) => { venueIds.add(c.venue_id); orgIds.add(c.organizer_user_id); });
    pendingSeries.forEach((s) => { venueIds.add(s.venue_id); orgIds.add(s.organizer_user_id); });
    const nameMap = new Map<string, string>();
    if (role === 'organizer') {
      const { data: venues } = await supabase.from('venues').select('id, name').in('id', Array.from(venueIds));
      for (const v of (venues as { id: string; name: string }[] | null) || []) nameMap.set(v.id, v.name);
    } else {
      const { data: profs } = await supabase
        .from('organizer_profiles' as never).select('user_id, display_name').in('user_id' as never, Array.from(orgIds) as never);
      for (const p of ((profs as unknown as { user_id: string; display_name: string | null }[]) || [])) nameMap.set(p.user_id, p.display_name || '');
    }
    const partnerOf = (s: { venue_id: string; organizer_user_id: string }) =>
      nameMap.get(role === 'organizer' ? s.venue_id : s.organizer_user_id) || (role === 'organizer'
        ? tt('Un club', 'A club', 'Un club') : tt('Un organisateur', 'An organizer', 'Un organizador'));

    // Per-occurrence cards — EXCLUDING occurrences folded under a live framework.
    const list: Proposal[] = pending
      .map((c): Proposal | null => {
        const ev = evMap.get(c.event_id);
        if (!ev) return null;
        if (ev.recurring_template_id && coveredTemplateIds.has(ev.recurring_template_id)) return null; // folded into a framework card
        return {
          contractId: c.id, eventId: c.event_id, title: ev.title,
          posterUrl: ev.poster_url, startAt: ev.start_at, partnerName: partnerOf(c),
        };
      })
      .filter((p): p is Proposal => p !== null)
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());

    const seriesList: SeriesProposal[] = pendingSeries.map((s): SeriesProposal => {
      const tp = tplMap.get(s.template_id);
      const dow = tp?.day_of_week ?? 5;
      const time = tp?.start_time ?? '23:00';
      const name = tp?.name || tt('Soirée récurrente', 'Recurring event', 'Evento recurrente');
      return {
        row: s, templateName: name, posterUrl: tp?.poster_url ?? null,
        cadence: everyWeekday(dow, time),
        label: `${name} · ${everyWeekday(dow, time)}`,
        upcomingCount: countMap.get(s.template_id) || 0,
        partnerName: partnerOf(s),
      };
    });

    setItems(list);
    setSeries(seriesList);
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

  // Open the recurring framework contract for review + signature.
  const reviewSeries = async (sp: SeriesProposal) => {
    setSigning(sp);
    setSignData(null);
    try {
      const data = await loadCollabSeriesContractPdfData(sp.row, sp.label, lang);
      setSignData(data);
    } catch (e) {
      toast.error((e as { message?: string }).message || tt('Erreur', 'Error', 'Error'));
      setSigning(null);
    }
  };

  const confirmSignSeries = async () => {
    if (!signing) return;
    setConfirming(true);
    try {
      const { error } = await supabase.rpc('sign_event_collab_series_contract' as never, {
        p_contract_id: signing.row.id,
        p_ip: null,
        p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 300) : null,
        p_terms_version: COLLAB_TERMS_VERSION,
      } as never);
      if (error) throw error;
      toast.success(tt(
        'Contrat-cadre signé — toutes les soirées de la série sont validées',
        'Framework contract signed — every event in the series is approved',
        'Contrato marco firmado — todos los eventos de la serie están aprobados',
      ));
      setSigning(null);
      onChanged?.();
      load();
    } catch (e) {
      toast.error((e as { message?: string }).message || tt('Erreur', 'Error', 'Error'));
    } finally { setConfirming(false); }
  };

  const declineSeries = async (sp: SeriesProposal) => {
    setBusyId(sp.row.id);
    try {
      const { error } = await supabase.rpc('terminate_event_collab_series_contract' as never, { p_contract_id: sp.row.id } as never);
      if (error) throw error;
      toast.success(tt('Proposition récurrente refusée', 'Recurring proposal declined', 'Propuesta recurrente rechazada'));
      setSeries((prev) => prev.filter((s) => s.row.id !== sp.row.id));
      onChanged?.();
      load();
    } catch (e) {
      toast.error((e as { message?: string }).message || tt('Erreur', 'Error', 'Error'));
    } finally { setBusyId(null); }
  };

  if (loading || (items.length === 0 && series.length === 0)) return null;

  const total = items.length + series.length;

  return (
    <>
      <div style={{ background: CARD_BG, border: `1px solid ${AMBER}40`, borderRadius: 18, boxShadow: CARD_SHADOW, overflow: 'hidden' }}>
        <div className="flex items-center gap-2 px-5 pb-1 pt-4">
          <Handshake className="h-4 w-4" style={{ color: AMBER }} />
          <h2 style={{ color: T1, fontSize: 14, fontWeight: 600 }}>
            {total}{' '}
            {tt(
              total > 1 ? 'propositions de soirée à valider' : 'proposition de soirée à valider',
              total > 1 ? 'event proposals to review' : 'event proposal to review',
              total > 1 ? 'propuestas de evento por revisar' : 'propuesta de evento por revisar',
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
          {/* Recurring framework proposals — one signature covers the whole series. */}
          {series.map((sp) => (
            <div key={sp.row.id} className="flex items-center gap-3 rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${AMBER}30` }}>
              {sp.posterUrl ? (
                <img src={sp.posterUrl} alt="" className="h-14 w-11 flex-none rounded-lg object-cover" style={{ border: `1px solid ${BORDER}` }} />
              ) : (
                <div className="h-14 w-11 flex-none rounded-lg" style={{ background: 'rgba(255,255,255,0.04)' }} />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <Repeat className="h-3.5 w-3.5 flex-none" style={{ color: AMBER }} />
                  <p className="truncate" style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{sp.templateName}</p>
                </div>
                <p className="truncate" style={{ color: T2, fontSize: 12 }}>{tt('Proposé par', 'Proposed by', 'Propuesto por')} {sp.partnerName}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5" style={{ color: T3, fontSize: 11 }}>
                  <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{sp.cadence}</span>
                  <span style={{ color: AMBER }}>
                    {tt(
                      'Signe une fois pour toutes les soirées',
                      'Sign once for every event',
                      'Firma una vez para todos los eventos',
                    )}
                    {sp.upcomingCount > 0 ? ` (${sp.upcomingCount})` : ''}
                  </span>
                </p>
              </div>
              <div className="flex flex-none flex-col gap-1.5 sm:flex-row">
                <button
                  onClick={() => reviewSeries(sp)}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold"
                  style={{ background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.30)', color: '#FF5C63' }}
                >
                  <Check className="h-3.5 w-3.5" />{tt('Examiner', 'Review', 'Revisar')}<ArrowRight className="h-3 w-3" />
                </button>
                <button
                  onClick={() => declineSeries(sp)}
                  disabled={busyId === sp.row.id}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium"
                  style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, opacity: busyId === sp.row.id ? 0.5 : 1 }}
                >
                  {busyId === sp.row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                  {tt('Refuser', 'Decline', 'Rechazar')}
                </button>
              </div>
            </div>
          ))}

          {/* Single-event proposals. */}
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

      {signing && (
        <CollabContractTermsDialog
          open={!!signing}
          onOpenChange={(o) => { if (!o) setSigning(null); }}
          pdfData={signData ?? undefined}
          language={lang}
          title={{ fr: 'Lis et signe le contrat-cadre', en: 'Read and sign the framework contract', es: 'Lee y firma el contrato marco' }}
          onConfirm={confirmSignSeries}
          confirming={confirming}
        />
      )}
    </>
  );
}
