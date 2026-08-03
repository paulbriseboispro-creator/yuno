import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { Coins, Pencil, Check, RotateCcw, MousePointerClick, Ticket } from 'lucide-react';
import {
  AffPage, AffHeading, AffCard, StatTile, SectionLabel, Pill, AffButton, AffSpinner, AffEmpty,
  DarkInput, FieldLabel,
  RED, POS, WARN, T1, T2, T3, BORDER, C_FAINT, INNER_BG,
} from '@/components/affiliate/affiliate-ui';

// Le grand livre de l'agence : la vente réelle vit sur la billetterie externe,
// mais les chiffres reviennent des clubs — on les rapproche des clics tracés.
// Table trop récente pour le fichier de types généré : casts locaux.

type ReportRow = {
  id: string;
  affiliate_event_id: string;
  tickets_sold: number;
  revenue_amount: number | null;
  commission_due: number;
  commission_status: 'pending' | 'settled';
  settled_at: string | null;
  note: string | null;
  affiliate_events: {
    name: string;
    event_date: string;
    affiliate_venues: { id: string; name: string } | null;
  } | null;
};

type PastEvent = {
  id: string;
  name: string;
  event_date: string;
  affiliate_venues: { id: string; name: string } | null;
};

type FormState = { tickets: string; revenue: string; commission: string; note: string };
const EMPTY_FORM: FormState = { tickets: '', revenue: '', commission: '', note: '' };

const eur = (n: number) => `${(Number(n) || 0).toFixed(2)} €`;
/** « En retard » = due, soirée passée depuis plus de 14 jours. */
const LATE_DAYS_MS = 14 * 24 * 3600 * 1000;
const isLate = (r: { commission_status: string }, eventDate: string | undefined) =>
  r.commission_status === 'pending' && !!eventDate &&
  Date.now() - new Date(eventDate).getTime() > LATE_DAYS_MS;

export default function AffiliateCommissions() {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const { toast } = useToast();
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  const [affiliateId, setAffiliateId] = useState<string | null>(null);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [pastEvents, setPastEvents] = useState<PastEvent[]>([]);
  const [clicksByEvent, setClicksByEvent] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Saisie inline : id de l'événement en cours d'édition (nouveau ou existant).
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  useEffect(() => {
    if (user) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const load = async () => {
    setLoading(true);
    const { data: aff } = await supabase.from('affiliates').select('id').eq('user_id', user!.id).maybeSingle();
    if (!aff) { setLoading(false); return; }
    setAffiliateId(aff.id);

    const since = new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const [repRes, evRes] = await Promise.all([
      db.from('affiliate_reported_sales')
        .select('id, affiliate_event_id, tickets_sold, revenue_amount, commission_due, commission_status, settled_at, note, affiliate_events(name, event_date, affiliate_venues(id, name))')
        .eq('affiliate_id', aff.id)
        .order('created_at', { ascending: false }),
      db.from('affiliate_events')
        .select('id, name, event_date, affiliate_venues(id, name)')
        .eq('affiliate_id', aff.id)
        .in('status', ['published', 'featured'])
        .gte('event_date', since)
        .lte('event_date', today)
        .order('event_date', { ascending: false }),
    ]);
    if (repRes.error) console.error('reports load error:', repRes.error);
    if (evRes.error) console.error('past events load error:', evRes.error);
    const reps = (repRes.data ?? []) as ReportRow[];
    const past = (evRes.data ?? []) as PastEvent[];
    setReports(reps);
    setPastEvents(past);

    // Clics tracés par soirée (funnel clics → billets déclarés).
    const eventIds = [...new Set([...reps.map(r => r.affiliate_event_id), ...past.map(p => p.id)])];
    if (eventIds.length) {
      const { data: clicks, error: clErr } = await db
        .from('affiliate_clicks')
        .select('affiliate_event_id')
        .eq('affiliate_id', aff.id)
        .eq('is_internal', false)
        .in('affiliate_event_id', eventIds);
      if (clErr) console.error('clicks load error:', clErr);
      const counts: Record<string, number> = {};
      for (const c of (clicks ?? []) as { affiliate_event_id: string | null }[]) {
        if (c.affiliate_event_id) counts[c.affiliate_event_id] = (counts[c.affiliate_event_id] || 0) + 1;
      }
      setClicksByEvent(counts);
    }
    setLoading(false);
  };

  const reportByEvent = useMemo(() => {
    const m: Record<string, ReportRow> = {};
    for (const r of reports) m[r.affiliate_event_id] = r;
    return m;
  }, [reports]);

  // Soirées passées sans rapport : la file de saisie.
  const toReport = useMemo(
    () => pastEvents.filter(p => !reportByEvent[p.id]),
    [pastEvents, reportByEvent],
  );

  const totals = useMemo(() => {
    let pending = 0, settled = 0, late = 0;
    for (const r of reports) {
      if (r.commission_status === 'pending') {
        pending += Number(r.commission_due || 0);
        if (isLate(r, r.affiliate_events?.event_date)) late += 1;
      } else {
        settled += Number(r.commission_due || 0);
      }
    }
    return { pending, settled, late };
  }, [reports]);

  // Registre groupé par club, impayés d'abord.
  const byClub = useMemo(() => {
    const m = new Map<string, { name: string; rows: ReportRow[]; pending: number }>();
    for (const r of reports) {
      const club = r.affiliate_events?.affiliate_venues;
      const key = club?.id ?? 'unknown';
      if (!m.has(key)) m.set(key, { name: club?.name ?? '—', rows: [], pending: 0 });
      const g = m.get(key)!;
      g.rows.push(r);
      if (r.commission_status === 'pending') g.pending += Number(r.commission_due || 0);
    }
    return [...m.values()].sort((a, b) => b.pending - a.pending);
  }, [reports]);

  const openForm = (eventId: string) => {
    const existing = reportByEvent[eventId];
    setForm(existing ? {
      tickets: String(existing.tickets_sold ?? 0),
      revenue: existing.revenue_amount != null ? String(existing.revenue_amount) : '',
      commission: String(existing.commission_due ?? 0),
      note: existing.note ?? '',
    } : EMPTY_FORM);
    setEditingEventId(eventId);
  };

  const saveForm = async () => {
    if (!affiliateId || !editingEventId) return;
    setSaving(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from('affiliate_reported_sales').upsert({
      affiliate_id: affiliateId,
      affiliate_event_id: editingEventId,
      tickets_sold: Math.max(0, parseInt(form.tickets) || 0),
      revenue_amount: form.revenue.trim() === '' ? null : Math.max(0, parseFloat(form.revenue) || 0),
      commission_due: Math.max(0, parseFloat(form.commission) || 0),
      note: form.note.trim() || null,
    }, { onConflict: 'affiliate_event_id' });
    setSaving(false);
    if (error) {
      toast({ title: t('aff.comm.toast.error'), description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: t('aff.comm.toast.saved') });
    setEditingEventId(null);
    load();
  };

  const toggleSettled = async (r: ReportRow) => {
    const next = r.commission_status === 'pending' ? 'settled' : 'pending';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from('affiliate_reported_sales')
      .update({ commission_status: next, settled_at: next === 'settled' ? new Date().toISOString() : null })
      .eq('id', r.id);
    if (error) {
      toast({ title: t('aff.comm.toast.error'), description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: next === 'settled' ? t('aff.comm.toast.settled') : t('aff.comm.toast.reopened') });
    load();
  };

  const fmtDate = (iso: string) => format(parseISO(iso), 'd MMM yyyy', { locale: dateLocale });

  const entryForm = (eventId: string) => (
    <div className="mt-3 space-y-3" style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 12 }}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>{t('aff.comm.formTickets')}</FieldLabel>
          <DarkInput type="number" value={form.tickets} onChange={v => setForm(f => ({ ...f, tickets: v }))} placeholder="0" />
        </div>
        <div>
          <FieldLabel>{t('aff.comm.formRevenue')}</FieldLabel>
          <DarkInput type="number" value={form.revenue} onChange={v => setForm(f => ({ ...f, revenue: v }))} placeholder={t('aff.comm.formOptional')} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>{t('aff.comm.formCommission')}</FieldLabel>
          <DarkInput type="number" value={form.commission} onChange={v => setForm(f => ({ ...f, commission: v }))} placeholder="0.00" />
        </div>
        <div>
          <FieldLabel>{t('aff.comm.formNote')}</FieldLabel>
          <DarkInput value={form.note} onChange={v => setForm(f => ({ ...f, note: v }))} placeholder={t('aff.comm.formOptional')} />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <AffButton size="sm" variant="secondary" onClick={() => setEditingEventId(null)}>{t('aff.comm.formCancel')}</AffButton>
        <AffButton size="sm" onClick={saveForm} disabled={saving}>
          {saving ? t('aff.comm.formSaving') : t('aff.comm.formSave')}
        </AffButton>
      </div>
    </div>
  );

  const funnel = (eventId: string, tickets?: number) => {
    const clicks = clicksByEvent[eventId] ?? 0;
    const conv = tickets != null && clicks > 0 ? ` · ${((tickets / clicks) * 100).toFixed(0)}%` : '';
    return (
      <span className="inline-flex items-center gap-1" style={{ color: T3, fontSize: 11.5 }}>
        <MousePointerClick className="h-3 w-3" /> {clicks}
        {tickets != null && (<><span style={{ margin: '0 2px' }}>→</span><Ticket className="h-3 w-3" /> {tickets}{conv}</>)}
      </span>
    );
  };

  if (loading) return <AffSpinner />;

  return (
    <AffPage maxWidth={860}>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <AffHeading title={t('aff.comm.title')} subtitle={t('aff.comm.subtitle')} />
      </motion.div>

      <div className="grid grid-cols-3 gap-3">
        <StatTile label={t('aff.comm.tilePending')} value={eur(totals.pending)} icon={Coins} tone="warn" />
        <StatTile label={t('aff.comm.tileSettled')} value={eur(totals.settled)} icon={Check} tone="pos" />
        <StatTile label={t('aff.comm.tileLate')} value={totals.late} icon={RotateCcw} />
      </div>

      {/* File de saisie : soirées passées sans chiffres */}
      {toReport.length > 0 && (
        <div className="space-y-3">
          <SectionLabel>{t('aff.comm.toReport')} ({toReport.length})</SectionLabel>
          <div className="space-y-2">
            {toReport.map(ev => (
              <AffCard key={ev.id} padding={14}>
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{ev.name}</p>
                    <p style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>
                      {ev.affiliate_venues?.name ?? '—'} · {fmtDate(ev.event_date)} · {funnel(ev.id)}
                    </p>
                  </div>
                  {editingEventId !== ev.id && (
                    <AffButton size="sm" variant="secondary" onClick={() => openForm(ev.id)}>
                      <Pencil className="h-3.5 w-3.5" /> {t('aff.comm.reportBtn')}
                    </AffButton>
                  )}
                </div>
                {editingEventId === ev.id && entryForm(ev.id)}
              </AffCard>
            ))}
          </div>
        </div>
      )}

      {/* Registre par club */}
      {byClub.length === 0 && toReport.length === 0 ? (
        <AffEmpty icon={Coins} title={t('aff.comm.emptyTitle')} description={t('aff.comm.emptyDesc')} />
      ) : (
        byClub.map(club => (
          <div key={club.name} className="space-y-2">
            <div className="flex items-center justify-between">
              <SectionLabel>{club.name}</SectionLabel>
              {club.pending > 0 && (
                <span style={{ color: WARN, fontSize: 12.5, fontWeight: 680 }}>
                  {t('aff.comm.clubPending')} {eur(club.pending)}
                </span>
              )}
            </div>
            <div className="space-y-2">
              {club.rows.map(r => {
                const late = isLate(r, r.affiliate_events?.event_date);
                return (
                  <AffCard key={r.id} padding={14}
                    style={late ? { border: '1px solid rgba(255,92,99,0.35)' } : undefined}>
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>
                          {r.affiliate_events?.name ?? '—'}
                        </p>
                        <p style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>
                          {r.affiliate_events?.event_date ? fmtDate(r.affiliate_events.event_date) : '—'}
                          {' · '}{funnel(r.affiliate_event_id, r.tickets_sold)}
                          {r.revenue_amount != null && <> · {t('aff.comm.revenueShort')} {eur(r.revenue_amount)}</>}
                        </p>
                        {r.note && <p className="truncate" style={{ color: T3, fontSize: 11, marginTop: 2, fontStyle: 'italic' }}>{r.note}</p>}
                      </div>
                      <div className="flex items-center gap-2 flex-none">
                        <span style={{ color: r.commission_status === 'settled' ? POS : late ? '#FF5C63' : WARN, fontSize: 14, fontWeight: 700 }}>
                          {eur(r.commission_due)}
                        </span>
                        <Pill tone={r.commission_status === 'settled' ? 'success' : late ? 'danger' : 'warn'}>
                          {r.commission_status === 'settled'
                            ? t('aff.comm.statusSettled')
                            : late ? t('aff.comm.statusLate') : t('aff.comm.statusPending')}
                        </Pill>
                        <button title={t('aff.comm.editBtn')} onClick={() => editingEventId === r.affiliate_event_id ? setEditingEventId(null) : openForm(r.affiliate_event_id)}
                          className="p-1.5 transition-colors" style={{ background: C_FAINT, border: `1px solid ${BORDER}`, borderRadius: 8, color: T3, cursor: 'pointer' }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          title={r.commission_status === 'pending' ? t('aff.comm.settleBtn') : t('aff.comm.reopenBtn')}
                          onClick={() => toggleSettled(r)}
                          className="p-1.5 transition-colors"
                          style={{
                            background: r.commission_status === 'pending' ? 'rgba(52,211,153,0.10)' : INNER_BG,
                            border: `1px solid ${r.commission_status === 'pending' ? 'rgba(52,211,153,0.25)' : BORDER}`,
                            borderRadius: 8, color: r.commission_status === 'pending' ? POS : T3, cursor: 'pointer',
                          }}>
                          {r.commission_status === 'pending' ? <Check className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>
                    {editingEventId === r.affiliate_event_id && entryForm(r.affiliate_event_id)}
                  </AffCard>
                );
              })}
            </div>
          </div>
        ))
      )}
    </AffPage>
  );
}
