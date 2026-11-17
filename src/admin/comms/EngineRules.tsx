/**
 * Notifications automatiques › Règles : les neuf étapes du cycle de vie d'une
 * soirée dans un tableau (règle, état, envoyées, ouvertes, acheteurs). Une
 * ligne ouvre un tiroir : interrupteur, paramètres, textes par langue et par
 * variante. Mêmes RPC qu'avant (`admin_set_push_rule`, `admin_set_push_template`).
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge, Block, Drawer, KeyValue, Tabs, useAdminT, EmptyLine, Ledger, LedgerRow, MiniBar, Status } from '@/admin/ui';
import { fmtDate, fmtEur, fmtNum, fmtPct } from '@/lib/adminFormat';
import { ENGINE_RULES, tapRate } from '@/lib/pushEngine';
import { DRINKS_PILLAR_LIVE } from '@/lib/drinksPillar';
import { COMMS_KEY, useRuleTemplates, type EngineOverview, type RuleStats, type RuleTemplate } from './data';
import { rpc } from '../system/data';
import { Field, SwitchRow } from '@/admin/ui';

const ORDER = new Map(ENGINE_RULES.map((r, i) => [r.key as string, i]));

export default function EngineRules({ data }: { data: EngineOverview }) {
  const { t, lang } = useAdminT();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const rows = useMemo(() => [...data.rules].filter((r) => ORDER.has(r.key)).sort((a, b) => ORDER.get(a.key)! - ORDER.get(b.key)!), [data.rules]);
  const open = rows.find((r) => r.key === openKey) ?? null;
  // Mêmes maxima pour toute la colonne : les barres se comparent d'une ligne à l'autre.
  const maxSent = Math.max(0, ...rows.map((r) => r.sent));
  const maxBuyers = Math.max(0, ...rows.map((r) => r.buyers));
  const maxRate = Math.max(0, ...rows.map((r) => tapRate(r.taps, r.sent) ?? 0));

  return (
    <Block title={t('adm.comms.en3.rules')} meta={t('adm.comms.en3.rulesMeta')}>
      <EmptyLine>{t('adm.comms.en.r.intro')}</EmptyLine>
      {rows.length === 0 ? <EmptyLine>{t('adm.comms.en.r.empty')}</EmptyLine> : (
        <Ledger>
          <div className="a-mono a-t3 hidden grid-cols-[90px_minmax(0,1.6fr)_150px_150px_130px_90px] gap-x-4 px-1 py-2 text-[10.5px] uppercase tracking-wide lg:grid">
            <span>{t('adm.comms.en.r.state')}</span><span>{t('adm.comms.en.r.rule')}</span><span>{t('adm.comms.en.k.sent')}</span><span>{t('adm.comms.en.k.opened')}</span><span>{t('adm.comms.en.k.buyers')}</span><span>{t('adm.comms.en.r.last')}</span>
          </div>
          {rows.map((r) => {
            const rate = tapRate(r.taps, r.sent);
            return (
              <LedgerRow key={r.key} onClick={() => setOpenKey(r.key)} className="grid-cols-1 lg:grid-cols-[90px_minmax(0,1.6fr)_150px_150px_130px_90px]">
                <Status strong tone={r.enabled ? 'positive' : 'neutral'}>{r.enabled ? t('adm.comms.en.r.on') : t('adm.comms.en.r.off')}</Status>
                <div className="min-w-0"><div className="a-t1 truncate text-[13.5px] font-medium">{t(`adm.engine.rule.${r.key}.name`)}</div><div className="a-t3 truncate text-[12px]">{t(`adm.engine.rule.${r.key}.desc`)}</div></div>
                <MiniBar value={r.sent} max={maxSent} display={fmtNum(r.sent, lang)} />
                <MiniBar value={rate} max={maxRate} display={rate == null ? '—' : fmtPct(rate)} />
                <MiniBar value={r.buyers} max={maxBuyers} display={fmtNum(r.buyers, lang)} width={64} />
                <span className="a-mono a-t3 text-[11px]">{r.lastAt ? fmtDate(r.lastAt, lang) : t('adm.engine.neverSent')}</span>
              </LedgerRow>
            );
          })}
        </Ledger>
      )}
      {open && <RuleDrawer rule={open} onClose={() => setOpenKey(null)} />}
    </Block>
  );
}

function RuleDrawer({ rule, onClose }: { rule: RuleStats; onClose: () => void }) {
  const { t, lang } = useAdminT();
  const qc = useQueryClient();
  const refresh = () => { void qc.invalidateQueries({ queryKey: COMMS_KEY }); };
  const [params, setParams] = useState<Record<string, string>>({});
  useEffect(() => { setParams(Object.fromEntries(Object.entries(rule.params ?? {}).map(([k, v]) => [k, String(v)]))); }, [rule]);
  const dirty = Object.entries(params).filter(([k, v]) => String(rule.params?.[k]) !== v);

  const save = useMutation({
    mutationFn: async (enabled?: boolean) => {
      const patch: Record<string, number> = {};
      for (const [k, v] of dirty) {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) throw new Error(t('adm.engine.badNumber'));
        patch[k] = Math.round(n);
      }
      await rpc('admin_set_push_rule', { p_key: rule.key, p_enabled: enabled ?? null, p_params: Object.keys(patch).length ? patch : null });
      return enabled;
    },
    onSuccess: (enabled) => { toast.success(enabled === undefined ? t('adm.engine.saved') : enabled ? t('adm.engine.ruleOn') : t('adm.engine.ruleOff')); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const holds = Object.entries(rule.heldBy ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const holdLabel = (k: string) => { const v = t(`adm.engine.hold.${k}`); return v === `adm.engine.hold.${k}` ? k : v; };
  const rate = tapRate(rule.taps, rule.sent);

  return (
    <Drawer open onOpenChange={(v) => { if (!v) onClose(); }} title={t(`adm.engine.rule.${rule.key}.name`)} description={t(`adm.engine.rule.${rule.key}.desc`)}>
      <div className="flex flex-col gap-6">
        <div>
          <SwitchRow label={t('adm.comms.en.r.enabled')} hint={rule.enabled ? t('adm.comms.en.r.onHint') : t('adm.comms.en.r.offHint')}
            checked={rule.enabled} disabled={save.isPending} onChange={(v) => save.mutate(v)} />
          <KeyValue items={[
            { label: t('adm.comms.en.k.sent'), value: fmtNum(rule.sent, lang) },
            { label: t('adm.comms.en.k.opened'), value: rate == null ? fmtNum(rule.taps, lang) : `${fmtNum(rule.taps, lang)} · ${fmtPct(rate)}` },
            { label: t('adm.comms.en.k.buyers'), value: fmtNum(rule.buyers, lang) },
            { label: t('adm.comms.en.r.revenue'), value: rule.revenue > 0 ? fmtEur(rule.revenue, lang) : '—' },
            { label: t('adm.comms.en.r.queued'), value: fmtNum(rule.queued, lang) },
            { label: t('adm.comms.en.k.held'), value: rule.held > 0 ? `${fmtNum(rule.held, lang)}${holds.length ? ` (${holds.map(([k, v]) => `${holdLabel(k)} ${fmtNum(v, lang)}`).join(', ')})` : ''}` : '0' },
            { label: t('adm.comms.en.r.last'), value: rule.lastAt ? fmtDate(rule.lastAt, lang, 'datetime') : t('adm.engine.neverSent') },
          ]} />
        </div>

        {Object.keys(params).length > 0 && (
          <section className="flex flex-col gap-3">
            <h3 className="a-t1 text-[14px] font-semibold">{t('adm.comms.en.r.params')}</h3>
            <div className="grid grid-cols-2 gap-4">
              {Object.keys(params).map((k) => (
                <Field key={k} label={t(`adm.engine.param.${k}`)}>
                  <input className="a-input a-num" type="number" inputMode="numeric" value={params[k]} onChange={(e) => setParams((p) => ({ ...p, [k]: e.target.value }))} />
                </Field>
              ))}
            </div>
            <div><button type="button" className="a-btn a-btn--primary a-btn--sm" disabled={dirty.length === 0 || save.isPending} onClick={() => save.mutate(undefined)}>{t('adm.engine.save')}</button></div>
          </section>
        )}

        <Texts ruleKey={rule.key} onSaved={refresh} />
      </div>
    </Drawer>
  );
}

function Texts({ ruleKey, onSaved }: { ruleKey: string; onSaved: () => void }) {
  const { t } = useAdminT();
  const q = useRuleTemplates();
  // Pilier boissons en pause : sa variante de texte n'est jamais envoyée, on ne la montre pas.
  const rows = (q.data ?? []).filter((r) => r.rule_key === ruleKey && (DRINKS_PILLAR_LIVE || r.variant !== 'drinks'));
  const langs = [...new Set(rows.map((r) => r.lang))];
  const [lg, setLg] = useState<string>('');
  const cur = lg && langs.includes(lg) ? lg : langs.includes('fr') ? 'fr' : langs[0] ?? '';
  return (
    <section className="flex flex-col gap-3">
      <h3 className="a-t1 text-[14px] font-semibold">{t('adm.comms.en.r.texts')}</h3>
      {q.isLoading ? <div className="a-skel h-24" /> : rows.length === 0 ? <p className="a-t3 text-[13px]">{t('adm.comms.en.r.noTexts')}</p> : (
        <>
          <Tabs items={langs.map((l) => ({ value: l, label: l.toUpperCase() }))} value={cur} onChange={setLg} />
          <div className="flex flex-col gap-4">
            {rows.filter((r) => r.lang === cur).map((r) => <TemplateEditor key={`${r.variant}|${r.reason}|${r.lang}`} row={r} onSaved={() => { void q.refetch(); onSaved(); }} />)}
          </div>
          <p className="a-t3 text-[12px] leading-relaxed">{t('adm.engine.varsHint')}</p>
        </>
      )}
    </section>
  );
}

function TemplateEditor({ row, onSaved }: { row: RuleTemplate; onSaved: () => void }) {
  const { t } = useAdminT();
  const [title, setTitle] = useState(row.title);
  const [body, setBody] = useState(row.body);
  useEffect(() => { setTitle(row.title); setBody(row.body); }, [row.title, row.body]);
  const custom = row.title !== row.default_title || row.body !== row.default_body;
  const dirty = title !== row.title || body !== row.body;
  const call = useMutation({
    mutationFn: (reset: boolean) => rpc('admin_set_push_template', { p_rule: row.rule_key, p_variant: row.variant, p_reason: row.reason, p_lang: row.lang, p_title: reset ? null : title, p_body: reset ? null : body }),
    onSuccess: (_d, reset) => { toast.success(reset ? t('adm.engine.textReset') : t('adm.engine.saved')); onSaved(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const tr = (k: string, v: string) => { const x = t(`adm.engine.${k}.${v}`); return x === `adm.engine.${k}.${v}` ? v : x; };
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {row.variant !== 'default' && <Badge>{tr('variant', row.variant)}</Badge>}
        {row.reason !== 'any' && <Badge>{tr('reason', row.reason)}</Badge>}
        {custom && <Badge tone="warning">{t('adm.engine.customText')}</Badge>}
      </div>
      <input className="a-input" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} aria-label={t('adm.engine.textTitle')} />
      <textarea className="a-input" value={body} maxLength={240} rows={2} onChange={(e) => setBody(e.target.value)} aria-label={t('adm.engine.textBody')} />
      <div className="flex gap-2">
        <button type="button" className="a-btn a-btn--primary a-btn--sm" disabled={!dirty || !title.trim() || !body.trim() || call.isPending} onClick={() => call.mutate(false)}>{t('adm.engine.save')}</button>
        {custom && <button type="button" className="a-btn a-btn--sm" disabled={call.isPending} onClick={() => call.mutate(true)}>{t('adm.engine.resetText')}</button>}
      </div>
    </div>
  );
}
