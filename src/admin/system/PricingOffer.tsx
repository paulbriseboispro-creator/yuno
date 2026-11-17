/**
 * Système › Offre et tarifs › Offre et prix : la grille que lit la Console et
 * la page Tarifs (prix, essai, Yunits, tarif par canal, coût réel), le seuil
 * des 50 payants (état des prix publics chez Stripe, lecture seule) et
 * l'historique des changements. Chaque enregistrement demande un motif (journal
 * d'audit). Le montant FACTURÉ vient des prix Stripe (lookup_key
 * `yuno_crm_base_*`) : changer un prix ici ne modifie ni un abonnement existant
 * ni Stripe, et l'écran le dit.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Badge, Card, DataTable, ErrorState, Grid, KeyValue, ReasonDialog, Section, Status, useAdminT, type ColumnDef } from '@/admin/ui';
import { fmtDate, fmtEur, fmtNum, fmtPct, fmtRelative } from '@/lib/adminFormat';
import type { AdminPricing, PricingCfg } from '@/crm/admin/data';
import { rpc } from './data';
import { usePriceTier, type StripePrices } from './pricingData';
import { NumField } from './NumField';

const NUM_KEYS = ['price_month', 'price_month_next', 'price_year', 'price_switch_at', 'trial_days', 'trial_yunits', 'trial_extensions', 'monthly_yunits', 'annual_bonus_yunits'] as const;
/** Grille des prix : le SMS a un second tarif, vers l'étranger (tout indicatif hors +33). */
const PRICE_ROWS = ['email', 'sms', 'sms_intl', 'whatsapp', 'instagram'] as const;
const LOCALES = { en: 'en-GB', fr: 'fr-FR', es: 'es-ES' } as const;

interface ChannelRow { key: string; rate: number; billed: number; cost: number; margin: number | null; live: boolean }

export default function PricingOffer({ pricing, onChanged }: { pricing: { data: AdminPricing | undefined; error: unknown; refetch: () => unknown }; onChanged: () => void }) {
  const { t, lang } = useAdminT();
  const cfg = pricing.data?.cfg;
  if (!cfg) return pricing.error ? <ErrorState onRetry={() => void pricing.refetch()} /> : <div className="a-skel h-64" />;
  return (
    <div className="flex flex-col gap-6">
      <TierCard />
      <Editor cfg={cfg} onSaved={onChanged} />
      <Section title={t('adm.sys.pr.history')} description={t('adm.crm.se.auditSub')}>
        <History history={pricing.data?.history ?? []} lang={lang} />
      </Section>
    </div>
  );
}

function Editor({ cfg, onSaved }: { cfg: PricingCfg; onSaved: () => void }) {
  const { t, lang } = useAdminT();
  const [draft, setDraft] = useState<PricingCfg>(cfg);
  const [ask, setAsk] = useState(false);
  useEffect(() => { setDraft(cfg); }, [cfg]);

  const patch = useMemo(() => {
    const p: Record<string, unknown> = {};
    for (const k of NUM_KEYS) if (draft[k] !== cfg[k]) p[k] = draft[k];
    if (JSON.stringify(draft.rates) !== JSON.stringify(cfg.rates)) p.rates = draft.rates;
    if (JSON.stringify(draft.costs) !== JSON.stringify(cfg.costs)) p.costs = draft.costs;
    if (JSON.stringify(draft.channels_live) !== JSON.stringify(cfg.channels_live)) p.channels_live = draft.channels_live;
    return p;
  }, [draft, cfg]);
  const dirty = Object.keys(patch).length > 0;
  const set = <K extends keyof PricingCfg>(k: K, v: PricingCfg[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setRate = useCallback((c: string, v: number) => setDraft((d) => ({ ...d, rates: { ...d.rates, [c]: v } })), []);
  const setCost = useCallback((c: string, v: number) => setDraft((d) => ({ ...d, costs: { ...d.costs, [c]: v } })), []);

  const price4 = useCallback((v: number) => new Intl.NumberFormat(LOCALES[lang], { style: 'currency', currency: 'EUR', minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(v), [lang]);
  const perThousand = 1000 / (draft.yunits_per_euro || 500);

  const rows = useMemo<ChannelRow[]>(() => PRICE_ROWS.map((c) => {
    const billed = (draft.rates[c] ?? 0) / (draft.yunits_per_euro || 500);
    const cost = draft.costs[c] ?? 0;
    return { key: c, rate: draft.rates[c] ?? 0, billed, cost, margin: billed > 0 ? ((billed - cost) / billed) * 100 : null, live: !!draft.channels_live[c === 'sms_intl' ? 'sms' : c] };
  }), [draft]);

  const columns = useMemo<ColumnDef<ChannelRow, unknown>[]>(() => [
    { accessorKey: 'key', header: t('adm.crm.se.h.channel'), enableSorting: false, cell: ({ row }) => (
      <span className="flex items-center gap-2"><span className="a-t1 font-medium">{t(`adm.crm.se.ch.${row.original.key}`)}</span>{!row.original.live && <Badge>{t('adm.crm.se.soon')}</Badge>}</span>
    ) },
    { accessorKey: 'rate', header: 'Yunits', enableSorting: false, meta: { align: 'right' }, cell: ({ row }) => (
      <NumField value={row.original.rate} width={84} label={`Yunits ${row.original.key}`} onChange={(v) => setRate(row.original.key, v)} />
    ) },
    { accessorKey: 'billed', header: t('adm.crm.se.h.billed'), enableSorting: false, meta: { align: 'right' }, cell: (c) => price4(c.getValue<number>()) },
    { accessorKey: 'cost', header: t('adm.crm.se.h.cost'), enableSorting: false, meta: { align: 'right' }, cell: ({ row }) => (
      <NumField value={row.original.cost} step={0.0001} width={104} label={`${t('adm.crm.se.h.cost')} ${row.original.key}`} onChange={(v) => setCost(row.original.key, v)} />
    ) },
    { accessorKey: 'margin', header: t('adm.crm.se.h.margin'), enableSorting: false, meta: { align: 'right' }, cell: ({ row }) => {
      const m = row.original.margin;
      return m === null ? '—' : <Badge tone={m < 0 ? 'negative' : m < 20 ? 'warning' : 'positive'}>{fmtPct(m, 0)}</Badge>;
    } },
  ], [t, price4, setRate, setCost]);

  const save = async (reason: string) => {
    try {
      await rpc('crm_admin_pricing_set', { p_patch: patch, p_reason: reason });
    } catch (e) {
      const m = (e as { message?: string }).message ?? '';
      throw new Error(['reason_required', 'bad_value', 'unknown_key'].includes(m) ? t(`adm.crm.se.err.${m}`) : t('adm.crm.ac.err.x'));
    }
    toast.success(t('adm.crm.se.saved'));
    onSaved();
  };

  return (
    <>
      <Grid cols={3}>
        <Card title={t('adm.crm.se.price')}>
          <div className="flex flex-col gap-3">
            <Field label={t('adm.crm.se.priceMonth')}><NumField label={t('adm.crm.se.priceMonth')} value={draft.price_month} onChange={(v) => set('price_month', v)} /></Field>
            <Field label={t('adm.crm.se.priceYear')}><NumField label={t('adm.crm.se.priceYear')} value={draft.price_year} onChange={(v) => set('price_year', v)} /></Field>
            <Field label={t('adm.crm.se.priceNext')}><NumField label={t('adm.crm.se.priceNext')} value={draft.price_month_next} onChange={(v) => set('price_month_next', v)} /></Field>
            <Field label={t('adm.crm.se.switchAt')}><NumField label={t('adm.crm.se.switchAt')} value={draft.price_switch_at} onChange={(v) => set('price_switch_at', v)} /></Field>
            <p className="a-t3 text-[12.5px] leading-relaxed">{t('adm.crm.se.priceHelp', { month: draft.monthly_yunits, year: draft.annual_bonus_yunits })}</p>
          </div>
        </Card>
        <Card title={t('adm.crm.se.trial')}>
          <div className="flex flex-col gap-3">
            <Field label={t('adm.crm.se.trialDays')}><NumField label={t('adm.crm.se.trialDays')} value={draft.trial_days} onChange={(v) => set('trial_days', v)} /></Field>
            <Field label={t('adm.crm.se.trialYunits')}><NumField label={t('adm.crm.se.trialYunits')} value={draft.trial_yunits} step={500} onChange={(v) => set('trial_yunits', v)} /></Field>
            <Field label={t('adm.crm.se.monthlyYunits')}><NumField label={t('adm.crm.se.monthlyYunits')} value={draft.monthly_yunits} step={500} onChange={(v) => set('monthly_yunits', v)} /></Field>
            <Field label={t('adm.crm.se.annualBonus')}><NumField label={t('adm.crm.se.annualBonus')} value={draft.annual_bonus_yunits} step={500} onChange={(v) => set('annual_bonus_yunits', v)} /></Field>
          </div>
        </Card>
        <Card title={t('adm.crm.se.recharge')} footer={t('adm.crm.se.rechargeNote', { months: 12 })}>
          <KeyValue items={[
            { label: t('adm.crm.se.base'), value: t('adm.crm.se.perK', { eur: fmtEur(perThousand, lang) }) },
            ...[...draft.bonus_tiers].sort((a, b) => a.min - b.min).map((tier) => ({ label: t('adm.crm.se.from', { n: fmtNum(tier.min, lang) }), value: t('adm.crm.se.bonus', { pct: tier.pct }) })),
          ]} />
        </Card>
      </Grid>

      <Section title={t('adm.crm.se.channels')} description={t('adm.crm.se.channelsSub')}>
        <DataTable data={rows} columns={columns} getRowId={(r) => r.key} pageSize={10} />
      </Section>

      <div className="a-card flex flex-wrap items-center justify-between gap-3 p-4">
        <span className="a-t2 max-w-[70ch] text-[12.5px] leading-relaxed">{t('adm.crm.se.stripeNote')}</span>
        <div className="flex gap-2">
          {dirty && <button type="button" className="a-btn" onClick={() => setDraft(cfg)}>{t('adm.crm.se.reset')}</button>}
          <button type="button" className="a-btn a-btn--primary" disabled={!dirty} onClick={() => setAsk(true)}>{dirty ? t('adm.crm.se.save') : t('adm.crm.se.uptodate')}</button>
        </div>
      </div>

      <ReasonDialog open={ask} onOpenChange={setAsk} title={t('adm.crm.se.confirmTitle')} confirmLabel={t('adm.crm.ac.confirm')} onConfirm={save}
        description={t('adm.sys.pr.changes', { list: Object.keys(patch).map((k) => t(`adm.crm.se.k.${k}`)).join(', ') })} />
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3 text-[13.5px]"><span className="a-t1">{label}</span>{children}</div>;
}

type Hist = AdminPricing['history'][number];
function History({ history, lang }: { history: Hist[]; lang: 'en' | 'fr' | 'es' }) {
  const { t } = useAdminT();
  const changed = (h: Hist) => (Object.keys(h.after) as (keyof PricingCfg)[]).filter((k) => JSON.stringify(h.before[k]) !== JSON.stringify(h.after[k]));
  const rows = history.map((h, i) => ({ id: String(i), at: h.at, what: changed(h).map((k) => t(`adm.crm.se.k.${String(k)}`)).join(', '), reason: h.reason }));
  const cols: ColumnDef<(typeof rows)[number], unknown>[] = [
    { accessorKey: 'at', header: t('adm.sys.col.date'), cell: ({ row }) => <span title={fmtDate(row.original.at, lang, 'datetime')}>{fmtRelative(row.original.at, lang)}</span> },
    { accessorKey: 'what', header: t('adm.sys.pr.changed'), cell: (c) => <span className="a-t1 font-medium">{c.getValue<string>()}</span> },
    { accessorKey: 'reason', header: t('adm.sys.pr.reason'), cell: (c) => <span className="a-t2 whitespace-normal">{c.getValue<string>()}</span> },
  ];
  return <DataTable data={rows} columns={cols} getRowId={(r) => r.id} pageSize={10} initialSort={[{ id: 'at', desc: true }]} empty={{ title: t('adm.crm.se.auditNone') }} />;
}

/** Le seuil des 50 payants : le niveau en vigueur et les prix publics chez Stripe (lecture seule). */
function TierCard() {
  const { t, lang } = useAdminT();
  const qc = useQueryClient();
  const q = usePriceTier();
  const [st, setSt] = useState<StripePrices | null>(null);
  const [busy, setBusy] = useState(false);
  const d = q.data;

  const check = async () => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('club-subscription', { body: { action: 'crm_price_status' } });
    setBusy(false);
    if (error || !(data as { success?: boolean } | null)?.success) { toast.error(t('adm.crm.pt.checkFail')); return; }
    setSt(data as StripePrices);
    void qc.invalidateQueries({ queryKey: ['admin', 'system', 'price-tier'] });
  };
  const active = st ? st.public_active : d?.public_active ?? false;
  const cols: ColumnDef<StripePrices['prices'][number], unknown>[] = [
    { accessorKey: 'lookup_key', header: 'lookup_key', cell: (c) => <code className="text-[12px]">{c.getValue<string>()}</code> },
    { id: 'state', header: t('adm.sys.col.status'), enableSorting: false, cell: ({ row }) => {
      const p = row.original;
      return !p.found ? <Status tone="negative">{t('adm.crm.pt.missing')}</Status>
        : <Status tone={p.active ? 'positive' : 'warning'}>{`${p.amount ?? '—'} € · ${t(p.active ? 'adm.crm.pt.on' : 'adm.crm.pt.off')}`}</Status>;
    } },
  ];

  return (
    <Card title={t('adm.crm.pt.title')} actions={<button type="button" className="a-btn a-btn--sm" disabled={busy} onClick={() => void check()}>{busy ? t('adm.crm.pt.checking') : t('adm.crm.pt.check')}</button>}>
      <div className="flex flex-col gap-3">
        <p className="a-t2 text-[13px]">{t('adm.crm.pt.sub')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={active ? 'positive' : 'warning'}>{t(active ? 'adm.crm.pt.active' : 'adm.crm.pt.pending')}</Badge>
          {d && <Badge>{t(d.tier === 'public' ? 'adm.crm.pt.tierPublic' : 'adm.crm.pt.tierLaunch', { n: d.paying, at: d.switch_at })}</Badge>}
        </div>
        {st && <DataTable data={st.prices} columns={cols} getRowId={(p) => p.lookup_key} pageSize={10} />}
        {!st && d?.checked_at && <p className="a-t3 text-[12px]">{t('adm.crm.pt.lastCheck', { date: fmtDate(d.checked_at, lang, 'datetime') })}</p>}
        <p className="a-subtle rounded-lg p-3 text-[13px] leading-relaxed">{t('adm.crm.pt.howto')}</p>
      </div>
    </Card>
  );
}
