/**
 * Admin CRM › Réglages (« Admin Reglages » du design) : la grille que lit la
 * Console et la page Tarifs (prix affichés, essai, Yunits, tarif par canal, coût
 * réel). Chaque enregistrement demande un motif et s'écrit au journal. Le
 * montant FACTURÉ vient des prix Stripe (lookup_key `yuno_crm_base_*`) : changer
 * un prix ici ne modifie ni un abonnement existant ni Stripe, et l'écran le dit.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCrmT } from '@/crm/i18n';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { Modal, Skel, Switch } from '@/crm/ui/kit';
import { Hv } from '@/crm/ui/Hv';
import { useCrmToast } from '@/crm/ui/toast';
import { useAdminGesture, useAdminPricing } from '../data';
import type { PricingCfg } from '../data';
import LifecycleTab from './LifecycleTab';
import { card, EmptyNote, PageHead, RowLine, Section, Tabs, pageWrap, useAgo } from '../ui';

type Tab = 'offer' | 'lifecycle' | 'switches' | 'audit';
const CHANNELS = ['email', 'sms', 'whatsapp', 'instagram'] as const;
/** Grille des prix : le SMS a un second tarif, vers l'étranger (tout indicatif hors +33). */
const PRICE_ROWS = ['email', 'sms', 'sms_intl', 'whatsapp', 'instagram'] as const;
const NUM_KEYS = ['price_month', 'price_month_next', 'price_year', 'price_switch_at', 'trial_days', 'trial_yunits', 'trial_extensions', 'monthly_yunits', 'annual_bonus_yunits'] as const;

export default function SettingsPage() {
  const { t } = useCrmT();
  const [sp, setSp] = useSearchParams();
  const q = useAdminPricing();
  const tab = (['lifecycle', 'switches', 'audit'] as const).find((x) => x === sp.get('tab')) ?? 'offer';
  if (q.isError && !q.data) return <main style={{ padding: 32 }}><CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} /></main>;
  return (
    <main style={pageWrap}>
      <PageHead kicker={t('adm.crm.se.kicker')} title={t('adm.crm.se.title')} sub={t('adm.crm.se.sub')} />
      <Tabs<Tab> value={tab} onChange={(v) => setSp(v === 'offer' ? {} : { tab: v }, { replace: true })}
        tabs={[{ id: 'offer', label: t('adm.crm.se.t.offer') }, { id: 'lifecycle', label: t('adm.crm.se.t.lifecycle') }, { id: 'switches', label: t('adm.crm.se.t.switches') }, { id: 'audit', label: t('adm.crm.se.t.audit') }]} />
      {!q.data ? <Skel h={420} r={28} /> : tab === 'audit' ? <AuditTab history={q.data.history} /> : tab === 'lifecycle' ? <LifecycleTab /> : <Editor cfg={q.data.cfg} mode={tab} />}
    </main>
  );
}

function Num({ value, onChange, step = 1, min = 0, width = 96 }: { value: number; onChange: (v: number) => void; step?: number; min?: number; width?: number }) {
  return (
    <input type="number" value={Number.isFinite(value) ? value : 0} min={min} step={step} onChange={(e) => onChange(Math.max(min, Number(e.target.value)))}
      style={{ width, height: 40, borderRadius: 10, border: 0, boxShadow: 'inset 0 0 0 1.5px var(--sand-200)', padding: '0 10px', textAlign: 'right', font: 'inherit', fontSize: 15, fontWeight: 600, outline: 'none' }} />
  );
}

function Editor({ cfg, mode }: { cfg: PricingCfg; mode: 'offer' | 'switches' }) {
  const { t, pct, n, locale } = useCrmT();
  const price4 = (v: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(v);
  const eur2 = (v: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  const toast = useCrmToast();
  const save = useAdminGesture<{ p_patch: Record<string, unknown>; p_reason: string }>('crm_admin_pricing_set');
  const [draft, setDraft] = useState<PricingCfg>(cfg);
  const [ask, setAsk] = useState(false);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
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

  const submit = () => {
    save.mutate({ p_patch: patch, p_reason: reason }, {
      onSuccess: () => { toast(t('adm.crm.se.saved')); setAsk(false); setReason(''); setErr(null); },
      onError: (e) => { const m = (e as { message?: string }).message ?? ''; setErr(['reason_required', 'bad_value', 'unknown_key'].includes(m) ? t(`adm.crm.se.err.${m}`) : t('adm.crm.ac.err.x')); },
    });
  };
  const perThousand = 1000 / (draft.yunits_per_euro || 500);
  const saveBar = (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ fontSize: 13.5, color: 'var(--sand-500)', lineHeight: 1.5, maxWidth: 640 }}>{t('adm.crm.se.stripeNote')}</span>
      <div style={{ display: 'flex', gap: 10 }}>
        {dirty && <Hv as="button" type="button" onClick={() => setDraft(cfg)} style={{ height: 44, padding: '0 18px', borderRadius: 99, border: 0, background: 'var(--sand-100)', fontWeight: 600, fontSize: 14.5, cursor: 'pointer' }} hover={{ background: 'var(--sand-200)' }}>{t('adm.crm.se.reset')}</Hv>}
        <Hv as="button" type="button" disabled={!dirty} onClick={() => setAsk(true)} style={{ height: 44, padding: '0 22px', borderRadius: 99, border: 0, background: dirty ? 'var(--ink)' : 'var(--sand-100)', color: dirty ? '#fff' : 'var(--sand-400)', fontWeight: 600, fontSize: 14.5, cursor: dirty ? 'pointer' : 'default' }}>{dirty ? t('adm.crm.se.save') : t('adm.crm.se.uptodate')}</Hv>
      </div>
    </div>
  );
  return (
    <>
      {mode === 'offer' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,300px),1fr))', gap: 20, alignItems: 'start' }}>
            <Section title={t('adm.crm.se.price')} pad={24}>
              <Field label={t('adm.crm.se.priceMonth')}><Num value={draft.price_month} onChange={(v) => set('price_month', v)} /></Field>
              <Field label={t('adm.crm.se.priceYear')}><Num value={draft.price_year} onChange={(v) => set('price_year', v)} /></Field>
              <Field label={t('adm.crm.se.priceNext')}><Num value={draft.price_month_next} onChange={(v) => set('price_month_next', v)} /></Field>
              <Field label={t('adm.crm.se.switchAt')}><Num value={draft.price_switch_at} onChange={(v) => set('price_switch_at', v)} /></Field>
              <span style={{ fontSize: 13, color: 'var(--sand-500)', lineHeight: 1.5 }}>{t('adm.crm.se.priceHelp', { month: draft.monthly_yunits, year: draft.annual_bonus_yunits })}</span>
            </Section>
            <Section title={t('adm.crm.se.trial')} pad={24}>
              <Field label={t('adm.crm.se.trialDays')}><Num value={draft.trial_days} onChange={(v) => set('trial_days', v)} /></Field>
              <Field label={t('adm.crm.se.trialYunits')}><Num value={draft.trial_yunits} step={500} onChange={(v) => set('trial_yunits', v)} /></Field>
              <Field label={t('adm.crm.se.monthlyYunits')}><Num value={draft.monthly_yunits} step={500} onChange={(v) => set('monthly_yunits', v)} /></Field>
              <Field label={t('adm.crm.se.annualBonus')}><Num value={draft.annual_bonus_yunits} step={500} onChange={(v) => set('annual_bonus_yunits', v)} /></Field>
            </Section>
            <Section title={t('adm.crm.se.recharge')} pad={24} gap={4}>
              <RowLine first><span>{t('adm.crm.se.base')}</span><b>{t('adm.crm.se.perK', { eur: eur2(perThousand) })}</b></RowLine>
              {[...draft.bonus_tiers].sort((a, b) => a.min - b.min).map((tier) => <RowLine key={tier.min}><span>{t('adm.crm.se.from', { n: n(tier.min) })}</span><b style={{ color: 'var(--green-700)' }}>{t('adm.crm.se.bonus', { pct: tier.pct })}</b></RowLine>)}
              <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--sand-500)', lineHeight: 1.5 }}>{t('adm.crm.se.rechargeNote', { months: 12 })}</p>
            </Section>
          </div>
          <Section title={t('adm.crm.se.channels')} sub={t('adm.crm.se.channelsSub')} pad={0} gap={0}>
            <div style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: 640 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr 1fr', gap: 12, padding: '10px 28px', background: 'var(--sand-50)', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>
                  <span>{t('adm.crm.se.h.channel')}</span><span style={{ textAlign: 'right' }}>Yunits</span><span style={{ textAlign: 'right' }}>{t('adm.crm.se.h.billed')}</span><span style={{ textAlign: 'right' }}>{t('adm.crm.se.h.cost')}</span><span style={{ textAlign: 'right' }}>{t('adm.crm.se.h.margin')}</span>
                </div>
                {PRICE_ROWS.map((c) => {
                  const billed = (draft.rates[c] ?? 0) / (draft.yunits_per_euro || 500);
                  const cost = draft.costs[c] ?? 0;
                  const m = billed > 0 ? ((billed - cost) / billed) * 100 : null;
                  return (
                    <div key={c} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr 1fr', gap: 12, alignItems: 'center', padding: '12px 28px', borderTop: '1px solid var(--sand-100)', background: m !== null && m < 0 ? 'var(--red-50)' : undefined }}>
                      <b>{t(`adm.crm.se.ch.${c}`)}{!draft.channels_live[c === 'sms_intl' ? 'sms' : c] ? ` · ${t('adm.crm.se.soon')}` : ''}</b>
                      <span style={{ display: 'flex', justifyContent: 'flex-end' }}><Num value={draft.rates[c] ?? 0} onChange={(v) => set('rates', { ...draft.rates, [c]: v })} width={80} /></span>
                      <span style={{ textAlign: 'right' }}>{price4(billed)}</span>
                      <span style={{ display: 'flex', justifyContent: 'flex-end' }}><Num value={cost} step={0.0001} onChange={(v) => set('costs', { ...draft.costs, [c]: v })} width={96} /></span>
                      <span style={{ textAlign: 'right', fontWeight: 700, color: m === null ? 'var(--sand-500)' : m < 0 ? 'var(--red-600)' : m < 20 ? 'var(--amber-700)' : 'var(--green-700)' }}>{m === null ? '—' : pct(m)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </Section>
        </>
      )}
      {mode === 'switches' && (
        <Section title={t('adm.crm.se.switches')} sub={t('adm.crm.se.switchesSub')} pad={24} gap={4}>
          {CHANNELS.map((c, i) => (
            <RowLine key={c} first={i === 0}>
              <span style={{ display: 'flex', flexDirection: 'column' }}><b>{t(`adm.crm.se.ch.${c}`)}</b><span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t(draft.channels_live[c] ? 'adm.crm.se.live' : 'adm.crm.se.notLive')}</span></span>
              <Switch on={!!draft.channels_live[c]} onChange={(v) => set('channels_live', { ...draft.channels_live, [c]: v })} label={t(`adm.crm.se.ch.${c}`)} />
            </RowLine>
          ))}
          <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--sand-500)', lineHeight: 1.5 }}>{t('adm.crm.se.switchesNote')}</p>
        </Section>
      )}
      <div style={{ ...card, padding: '16px 24px' }}>{saveBar}</div>
      <Modal open={ask} onClose={() => setAsk(false)} width={500} label={t('adm.crm.se.save')}>
        <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.03em' }}>{t('adm.crm.se.confirmTitle')}</h2>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, color: 'var(--sand-600)', lineHeight: 1.6 }}>{Object.keys(patch).map((k) => <li key={k}>{t(`adm.crm.se.k.${k}`)}</li>)}</ul>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13.5, fontWeight: 600 }}>{t('adm.crm.ac.reason')}
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={300} style={{ borderRadius: 12, border: 0, boxShadow: 'inset 0 0 0 1.5px var(--sand-200)', padding: 12, font: 'inherit', fontSize: 15, outline: 'none', resize: 'vertical' }} />
          </label>
          {err && <span role="alert" style={{ fontSize: 13.5, color: 'var(--red-600)' }}>{err}</span>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Hv as="button" type="button" onClick={() => setAsk(false)} style={{ height: 44, padding: '0 20px', borderRadius: 99, border: 0, background: 'var(--sand-100)', fontWeight: 600, fontSize: 15, cursor: 'pointer' }} hover={{ background: 'var(--sand-200)' }}>{t('yc.common.cancel')}</Hv>
            <Hv as="button" type="button" disabled={reason.trim().length < 3 || save.isPending} onClick={submit} style={{ height: 44, padding: '0 22px', borderRadius: 99, border: 0, background: 'var(--ink)', color: '#fff', fontWeight: 600, fontSize: 15, cursor: reason.trim().length >= 3 ? 'pointer' : 'default', opacity: reason.trim().length >= 3 && !save.isPending ? 1 : 0.45 }}>{t('adm.crm.ac.confirm')}</Hv>
          </div>
        </div>
      </Modal>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 14.5 }}><span>{label}</span>{children}</div>;
}

function AuditTab({ history }: { history: { at: string; reason: string; before: PricingCfg; after: PricingCfg }[] }) {
  const { t, dShort, time } = useCrmT();
  const ago = useAgo();
  const changed = (h: { before: PricingCfg; after: PricingCfg }) => (Object.keys(h.after) as (keyof PricingCfg)[]).filter((k) => JSON.stringify(h.before[k]) !== JSON.stringify(h.after[k]));
  return (
    <Section title={t('adm.crm.se.t.audit')} sub={t('adm.crm.se.auditSub')} pad={24} gap={4}>
      {history.length === 0 && <EmptyNote>{t('adm.crm.se.auditNone')}</EmptyNote>}
      {history.map((h, i) => (
        <RowLine key={`${h.at}${i}`} first={i === 0}>
          <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <b>{changed(h).map((k) => t(`adm.crm.se.k.${String(k)}`)).join(', ')}</b>
            <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{h.reason}</span>
          </span>
          <span style={{ fontSize: 13, color: 'var(--sand-500)', textAlign: 'right' }}>{dShort(h.at)} {time(h.at)}<br />{ago(h.at)}</span>
        </RowLine>
      ))}
    </Section>
  );
}
