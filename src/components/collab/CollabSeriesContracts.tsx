import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { toast } from 'sonner';
import { Repeat, Clock, FileText, Loader2, XCircle, FileSignature } from 'lucide-react';
import { loadCollabSeriesContractPdfData } from '@/lib/collabContractData';
import { previewContractPDF } from '@/lib/generateContractPDF';
import { CollabAmendmentDialog, type AmendmentTarget } from './CollabAmendmentDialog';
import type { EventCollabSeriesContractRow } from '@/hooks/useEventCollabSeriesContract';

// ─── Yuno DA tokens (aligned with the collab inbox) ────────────────────────────
const AMBER = '#F5A623';
const GREEN = '#34D399';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

// 0 = Sunday — matches Postgres EXTRACT(DOW) / JS getDay().
const WEEKDAYS = {
  fr: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'],
  en: ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'],
  es: ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'],
};

interface Props {
  /** Which side is viewing. 'organizer' uses the signed-in user; 'venue' needs venueId. */
  role: 'venue' | 'organizer';
  venueId?: string;
  /** Called after a framework is terminated so a parent list can refresh. */
  onChanged?: () => void;
}

interface ActiveSeries {
  row: EventCollabSeriesContractRow;
  name: string;
  cadence: string;
  label: string;
  partnerName: string;
}

/**
 * Active recurring FRAMEWORK contracts (contrats-cadres) for this side — the signed
 * agreements that auto-accept every occurrence of a residency. Lets a party DOWNLOAD the
 * framework PDF and TERMINATE it for the future (already-active occurrences stay intact).
 * Pending frameworks live in CollabProposalsInbox (sign-once card); this is the post-signature
 * surface. Renders nothing when there are no active frameworks.
 */
export function CollabSeriesContracts({ role, venueId, onChanged }: Props) {
  const { user } = useAuth();
  const { language } = useLanguage();
  const tt = (frTxt: string, en: string, esTxt?: string) => translate(language, frTxt, en, esTxt);
  const lang = language === 'en' ? 'en' : language === 'es' ? 'es' : 'fr';
  const [items, setItems] = useState<ActiveSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Avenant en cours de redaction sur l'une des series.
  const [amendTarget, setAmendTarget] = useState<AmendmentTarget | null>(null);
  const [amendOpen, setAmendOpen] = useState(false);

  const everyWeekday = (dow: number, time: string) => {
    const hhmm = (time || '').slice(0, 5);
    const day = WEEKDAYS[lang][dow] ?? '';
    const prefix = lang === 'en' ? 'Every ' : lang === 'es' ? 'Todos los ' : 'Tous les ';
    const w = lang === 'fr' ? `${day}s` : day;
    return `${prefix}${w} · ${hhmm}`;
  };

  const load = useCallback(async () => {
    if (!user || (role === 'venue' && !venueId)) { setLoading(false); return; }
    let q = supabase
      .from('event_collab_series_contracts' as never)
      .select('*')
      .eq('status' as never, 'active' as never);
    q = role === 'organizer'
      ? q.eq('organizer_user_id' as never, user.id as never)
      : q.eq('venue_id' as never, venueId as never);
    const { data } = await q;
    const rows = ((data as unknown as EventCollabSeriesContractRow[]) || []);
    if (!rows.length) { setItems([]); setLoading(false); return; }

    const tplIds = rows.map((r) => r.template_id);
    const { data: tpls } = await supabase
      .from('owner_recurring_templates').select('id, name, day_of_week, start_time').in('id', tplIds);
    const tplMap = new Map(((tpls as { id: string; name: string; day_of_week: number; start_time: string }[]) || []).map((t) => [t.id, t]));

    const nameMap = new Map<string, string>();
    if (role === 'organizer') {
      const { data: venues } = await supabase.from('venues').select('id, name').in('id', Array.from(new Set(rows.map((r) => r.venue_id))));
      for (const v of (venues as { id: string; name: string }[] | null) || []) nameMap.set(v.id, v.name);
    } else {
      const { data: profs } = await supabase
        .from('organizer_profiles' as never).select('user_id, display_name').in('user_id' as never, Array.from(new Set(rows.map((r) => r.organizer_user_id))) as never);
      for (const p of ((profs as unknown as { user_id: string; display_name: string | null }[]) || [])) nameMap.set(p.user_id, p.display_name || '');
    }

    setItems(rows.map((r): ActiveSeries => {
      const tp = tplMap.get(r.template_id);
      const dow = tp?.day_of_week ?? 5;
      const time = tp?.start_time ?? '23:00';
      const name = tp?.name || tt('Soirée récurrente', 'Recurring event', 'Evento recurrente');
      return {
        row: r, name,
        cadence: everyWeekday(dow, time),
        label: `${name} · ${everyWeekday(dow, time)}`,
        partnerName: nameMap.get(role === 'organizer' ? r.venue_id : r.organizer_user_id)
          || (role === 'organizer' ? tt('Un club', 'A club', 'Un club') : tt('Un organisateur', 'An organizer', 'Un organizador')),
      };
    }));
    setLoading(false);
  }, [user, role, venueId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const viewPdf = async (s: ActiveSeries) => {
    try {
      const data = await loadCollabSeriesContractPdfData(s.row, s.label, lang);
      previewContractPDF(data);
    } catch (e) {
      toast.error((e as { message?: string }).message || tt('Erreur', 'Error', 'Error'));
    }
  };

  const terminate = async (s: ActiveSeries) => {
    if (!confirm(tt(
      'Résilier le contrat-cadre récurrent ? Les prochaines soirées ne seront plus auto-acceptées. Les soirées déjà ouvertes restent inchangées.',
      'Terminate the recurring framework contract? Future events will no longer be auto-accepted. Events already open stay unchanged.',
      '¿Resolver el contrato marco recurrente? Los próximos eventos ya no se aceptarán automáticamente. Los eventos ya abiertos no cambian.',
    ))) return;
    setBusyId(s.row.id);
    try {
      const { error } = await supabase.rpc('terminate_event_collab_series_contract' as never, { p_contract_id: s.row.id } as never);
      if (error) throw error;
      toast.success(tt('Contrat-cadre résilié', 'Framework contract terminated', 'Contrato marco resuelto'));
      setItems((prev) => prev.filter((x) => x.row.id !== s.row.id));
      onChanged?.();
    } catch (e) {
      toast.error((e as { message?: string }).message || tt('Erreur', 'Error', 'Error'));
    } finally { setBusyId(null); }
  };

  if (loading || items.length === 0) return null;

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, overflow: 'hidden' }}>
      <div className="flex items-center gap-2 px-5 pb-1 pt-4">
        <Repeat className="h-4 w-4" style={{ color: GREEN }} />
        <h2 style={{ color: T1, fontSize: 14, fontWeight: 600 }}>
          {tt('Contrats-cadres récurrents', 'Recurring framework contracts', 'Contratos marco recurrentes')}
        </h2>
      </div>
      <p className="px-5 pb-3" style={{ color: T3, fontSize: 12 }}>
        {tt(
          'Signés une fois — toutes les soirées de la série sont auto-acceptées. Résilie pour arrêter les soirées à venir.',
          'Signed once — every event in the series is auto-accepted. Terminate to stop future events.',
          'Firmados una vez — todos los eventos de la serie se aceptan automáticamente. Resuelve para detener los futuros.',
        )}
      </p>
      <div className="space-y-2 px-3 pb-3">
        {items.map((s) => (
          <div key={s.row.id} className="flex items-center gap-3 rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
            <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg" style={{ background: 'rgba(52,211,153,0.1)', border: `1px solid rgba(52,211,153,0.22)` }}>
              <Repeat className="h-4 w-4" style={{ color: GREEN }} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate" style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{s.name}</p>
                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  style={{ background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.25)', color: GREEN }}>
                  {tt('Actif · auto-accepté', 'Active · auto-accepted', 'Activo · auto-aceptado')}
                </span>
              </div>
              <p className="truncate" style={{ color: T2, fontSize: 12 }}>{tt('Avec', 'With', 'Con')} {s.partnerName}</p>
              <p className="mt-0.5 flex items-center gap-1" style={{ color: T3, fontSize: 11 }}>
                <Clock className="h-3 w-3" />{s.cadence}
              </p>
            </div>
            <div className="flex flex-none flex-col gap-1.5 sm:flex-row">
              <button
                onClick={() => viewPdf(s)}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium"
                style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}
              >
                <FileText className="h-3.5 w-3.5" />{tt('Contrat', 'Contract', 'Contrato')}
              </button>
              <button
                onClick={() => {
                  setAmendTarget({
                    seriesContractId: s.row.id,
                    responsibilities: s.row.responsibilities,
                    splitRules: s.row.split_rules,
                    eventMode: null,
                    label: s.label,
                    partnerName: s.partnerName,
                    recurring: true,
                  });
                  setAmendOpen(true);
                }}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium"
                style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}
              >
                <FileSignature className="h-3.5 w-3.5" />{tt('Avenant', 'Amendment', 'Adenda')}
              </button>
              <button
                onClick={() => terminate(s)}
                disabled={busyId === s.row.id}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium"
                style={{ background: 'rgba(232,25,44,0.08)', border: '1px solid rgba(232,25,44,0.2)', color: '#FF5C63', opacity: busyId === s.row.id ? 0.5 : 1 }}
              >
                {busyId === s.row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                {tt('Résilier', 'Terminate', 'Resolver')}
              </button>
            </div>
          </div>
        ))}
      </div>

      <CollabAmendmentDialog
        open={amendOpen}
        onOpenChange={setAmendOpen}
        target={amendTarget}
        onDone={load}
      />
    </div>
  );
}
