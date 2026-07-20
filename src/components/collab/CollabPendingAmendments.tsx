import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { FileSignature, ArrowRight, Clock, Repeat, CalendarDays, FileText } from 'lucide-react';
import { COLLAB_DOMAINS, normalizeResponsibilities, type CollabDomain, type DomainHolder } from '@/utils/collabResponsibilities';
import { normalizeSplitRules } from '@/lib/splitRules';
import { COLLAB_TERMS_VERSION } from '@/lib/collabContractTerms';
import { previewAmendmentPDF } from '@/lib/generateAmendmentPDF';

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
 * Un avenant + de quoi savoir SUR QUOI on signe. La ligne seule ne porte que des
 * identifiants : sans ce contexte, la carte demandait une signature sur « Design :
 * Les deux → Organisateur » sans dire de quelle soirée il s'agissait.
 */
type AmendmentCard = {
  row: AmendmentRow;
  /** « Yuno Electronic Body · tous les vendredis » ou le titre de la soirée. */
  subject: string;
  /** Série récurrente (toutes les dates à venir) plutôt qu'une soirée unique. */
  recurring: boolean;
  /** Qui a proposé, du point de vue de celui qui lit. */
  proposerLabel: string;
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
  const [rows, setRows] = useState<AmendmentCard[]>([]);
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
    const mine = all.filter(a => (role === 'venue' ? !a.venue_signed_at : !a.org_signed_at));
    if (!mine.length) { setRows([]); return; }

    // ── Résoudre le SUJET de chaque avenant ────────────────────────────────
    // Un avenant de série pointe le contrat-cadre, qui pointe le template ;
    // un avenant de soirée pointe le contrat d'occurrence, qui pointe l'event.
    const seriesIds = mine.map(a => a.series_contract_id).filter(Boolean) as string[];
    const contractIds = mine.map(a => a.contract_id).filter(Boolean) as string[];

    const [{ data: seriesRows }, { data: contractRows }] = await Promise.all([
      seriesIds.length
        ? supabase.from('event_collab_series_contracts' as never)
            .select('id, template_id').in('id' as never, seriesIds as never)
        : Promise.resolve({ data: [] as unknown }),
      contractIds.length
        ? supabase.from('event_collab_contracts' as never)
            .select('id, event_id').in('id' as never, contractIds as never)
        : Promise.resolve({ data: [] as unknown }),
    ]);

    const tplByseries = new Map<string, string>();
    for (const r of ((seriesRows as unknown as { id: string; template_id: string }[]) || [])) {
      tplByseries.set(r.id, r.template_id);
    }
    const evByContract = new Map<string, string>();
    for (const r of ((contractRows as unknown as { id: string; event_id: string }[]) || [])) {
      evByContract.set(r.id, r.event_id);
    }

    const [{ data: tpls }, { data: evs }] = await Promise.all([
      tplByseries.size
        ? supabase.from('owner_recurring_templates')
            .select('id, name, day_of_week, start_time').in('id', Array.from(tplByseries.values()))
        : Promise.resolve({ data: [] as unknown }),
      evByContract.size
        ? supabase.from('events').select('id, title, start_at').in('id', Array.from(evByContract.values()))
        : Promise.resolve({ data: [] as unknown }),
    ]);
    const tplMap = new Map(((tpls as unknown as { id: string; name: string; day_of_week: number; start_time: string }[]) || [])
      .map(t => [t.id, t]));
    const evMap = new Map(((evs as unknown as { id: string; title: string; start_at: string }[]) || [])
      .map(e => [e.id, e]));

    // ── Nom du proposant ───────────────────────────────────────────────────
    // Le club voit le nom de l'organisateur et l'inverse : « Untel te propose »
    // vaut mieux qu'un uuid ou qu'un « quelqu'un ».
    const nameById = new Map<string, string>();
    if (role === 'organizer') {
      const { data: venues } = await supabase.from('venues').select('id, name')
        .in('id', Array.from(new Set(mine.map(a => a.venue_id))));
      for (const v of ((venues as { id: string; name: string }[] | null) || [])) nameById.set(v.id, v.name);
    } else {
      const { data: profs } = await supabase.from('organizer_profiles' as never)
        .select('user_id, display_name')
        .in('user_id' as never, Array.from(new Set(mine.map(a => a.organizer_user_id))) as never);
      for (const p of ((profs as unknown as { user_id: string; display_name: string | null }[]) || [])) {
        if (p.display_name) nameById.set(p.user_id, p.display_name);
      }
    }

    const weekdays = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

    setRows(mine.map((a): AmendmentCard => {
      let subject = tt('Cette collaboration', 'This collaboration', 'Esta colaboración');
      let recurring = false;
      if (a.series_contract_id) {
        const tpl = tplMap.get(tplByseries.get(a.series_contract_id) ?? '');
        recurring = true;
        subject = tpl
          ? `${tpl.name} · ${tt('tous les', 'every', 'todos los')} ${weekdays[tpl.day_of_week] ?? ''} · ${(tpl.start_time || '').slice(0, 5)}`
          : tt('Une série récurrente', 'A recurring series', 'Una serie recurrente');
      } else if (a.contract_id) {
        const ev = evMap.get(evByContract.get(a.contract_id) ?? '');
        subject = ev
          ? `${ev.title} · ${new Date(ev.start_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`
          : tt('Une soirée', 'An event', 'Una noche');
      }
      const who = nameById.get(role === 'organizer' ? a.venue_id : a.organizer_user_id)
        || (role === 'organizer' ? tt('Le club', 'The club', 'El club') : tt('L\'organisateur', 'The organizer', 'El organizador'));
      return { row: a, subject, recurring, proposerLabel: who };
    }));
  }, [user, role, venueId]); // eslint-disable-line react-hooks/exhaustive-deps

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

      // Prevenir le proposant que son avenant vient d'entrer en vigueur.
      try {
        await supabase.functions.invoke('notify-split-proposal', {
          body: { kind: 'amendment', id: a.id, action: 'accepted', proposer_side: 'venue' },
        });
      } catch (e) { console.warn('[amendment] notify failed', e); }

      toast.success(tt('Avenant signé', 'Amendment signed', 'Adenda firmada'), {
        description: tt(
          'Les nouvelles conditions sont en vigueur.',
          'The new terms are now in force.',
          'Las nuevas condiciones están en vigor.',
        ),
      });
      setRows(prev => prev.filter(x => x.row.id !== a.id));
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
      setRows(prev => prev.filter(x => x.row.id !== a.id));
      onChanged?.();
    } catch (e) {
      toast.error((e as { message?: string }).message || tt('Erreur', 'Error', 'Error'));
    } finally { setBusyId(null); }
  };

  /**
   * Ouvre l'AVENANT en PDF — le document que les deux parties signent.
   * Les identités légales viennent des fiches club / organisateur : un avenant
   * sans dénomination sociale ni SIRET vaut beaucoup moins comme preuve.
   */
  const openPdf = async (card: AmendmentCard) => {
    const a = card.row;
    try {
      const [{ data: venue }, { data: orgProfile }, { data: prof }] = await Promise.all([
        supabase.from('venues')
          .select('name, legal_name, legal_address, siret, vat_number').eq('id', a.venue_id).maybeSingle(),
        supabase.from('organizer_profiles' as never)
          .select('display_name, legal_name, legal_address, siret, vat_number')
          .eq('user_id' as never, a.organizer_user_id as never).maybeSingle(),
        supabase.from('profiles').select('first_name, last_name').eq('id', a.organizer_user_id).maybeSingle(),
      ]);
      const op = orgProfile as unknown as {
        display_name?: string | null; legal_name?: string | null; legal_address?: string | null;
        siret?: string | null; vat_number?: string | null;
      } | null;
      const pr = prof as { first_name?: string | null; last_name?: string | null } | null;
      const orgName = op?.display_name
        || [pr?.first_name, pr?.last_name].filter(Boolean).join(' ')
        || tt('Organisateur', 'Organizer', 'Organizador');

      previewAmendmentPDF({
        amendmentId: a.id,
        contractRef: a.series_contract_id ?? a.contract_id ?? a.id,
        recurring: card.recurring,
        subject: card.subject,
        venue: {
          name: venue?.name || 'Club',
          legalName: venue?.legal_name, legalAddress: venue?.legal_address,
          registrationNumber: venue?.siret, vatNumber: venue?.vat_number,
        },
        organizer: {
          name: orgName,
          legalName: op?.legal_name, legalAddress: op?.legal_address,
          registrationNumber: op?.siret, vatNumber: op?.vat_number,
        },
        prevResponsibilities: a.prev_responsibilities,
        nextResponsibilities: a.responsibilities,
        prevSplit: normalizeSplitRules(a.prev_split_rules),
        nextSplit: normalizeSplitRules(a.split_rules),
        reason: a.reason,
        proposedByLabel: card.proposerLabel,
        proposedAt: new Date(a.created_at),
        venueSignedAt: a.venue_signed_at ? new Date(a.venue_signed_at) : null,
        orgSignedAt: a.org_signed_at ? new Date(a.org_signed_at) : null,
        language: language === 'en' ? 'en' : language === 'es' ? 'es' : 'fr',
      });
    } catch (e) {
      toast.error((e as { message?: string }).message || tt('Erreur', 'Error', 'Error'));
    }
  };

  if (!rows.length) return null;

  const domainLabel = (d: CollabDomain) => tt(
    d === 'design' ? 'Design' : 'Opérationnel',
    d === 'design' ? 'Design' : 'Operations',
    d === 'design' ? 'Diseño' : 'Operativo',
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
        {rows.map(card => {
          const a = card.row;
          const prev = normalizeResponsibilities(a.prev_responsibilities, null);
          const next = a.responsibilities ? normalizeResponsibilities(a.responsibilities, null) : null;
          const changed = next ? COLLAB_DOMAINS.filter(d => next[d] !== prev[d]) : [];
          const prevSplit = normalizeSplitRules(a.prev_split_rules);
          const nextSplit = normalizeSplitRules(a.split_rules);

          return (
            <div key={a.id} className="rounded-xl p-3.5 space-y-2" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
              {/* SUR QUOI on signe. Sans ça la carte demandait une signature sur
                  « Design : Les deux → Organisateur » sans dire de quelle soirée. */}
              <div className="flex items-start gap-2">
                {card.recurring
                  ? <Repeat className="h-4 w-4 mt-0.5 flex-none" style={{ color: RED }} />
                  : <CalendarDays className="h-4 w-4 mt-0.5 flex-none" style={{ color: RED }} />}
                <div className="min-w-0">
                  <p style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{card.subject}</p>
                  <p style={{ color: T3, fontSize: 11.5 }}>
                    {tt(
                      `Proposé par ${card.proposerLabel}`,
                      `Proposed by ${card.proposerLabel}`,
                      `Propuesto por ${card.proposerLabel}`,
                    )}
                    {card.recurring && ` · ${tt(
                      'toutes les dates à venir',
                      'every upcoming date',
                      'todas las fechas futuras',
                    )}`}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5" style={{ color: T3, fontSize: 11 }}>
                <Clock className="h-3 w-3" />
                {new Date(a.created_at).toLocaleDateString('fr-FR')}
              </div>

              <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', paddingTop: 2 }}>
                {tt('Ce qui change', 'What changes', 'Lo que cambia')}
              </p>

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

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button" onClick={() => openPdf(card)}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium"
                  style={{ background: 'transparent', border: `1px solid ${BORDER}`, color: T3, cursor: 'pointer' }}
                >
                  <FileText className="h-3.5 w-3.5" />
                  {tt("Lire l'avenant", 'Read the amendment', 'Leer la adenda')}
                </button>
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
