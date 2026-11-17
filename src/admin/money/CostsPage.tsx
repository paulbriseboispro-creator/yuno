/**
 * Argent › Coûts et marge (v3) : « Combien coûte Yuno, et que reste-t-il ? »
 * Onglet Marge :
 *   1. Héros : la marge du mois choisi, sa phrase, et le compte de résultat en
 *      cascade (revenu de Yuno → chaque poste de coût → marge) ; à droite, poste
 *      par poste, ce qui est SAISI à la main et ce qui est LU automatiquement ;
 *   2. les 12 mois en tableau teinté, la saisie des coûts DANS les cases
 *      (motif + journal, admin_cost_set / admin_cost_delete) ; une ligne choisit
 *      le mois du héros.
 * Revenu de Yuno par mois : admin_pilot_overview (mêmes chiffres que la vue
 * d'ensemble) ; coûts : admin_costs_list, l'IA lue dans ai_usage_events (USD
 * convertis au taux indicatif) tant qu'aucune saisie ne la remplace.
 * Onglet Factures : un registre dense, les échecs en tête (admin_invoices_list).
 */
import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Block, ErrorState, Hero, Page, ReasonDialog, Tabs, cellTint, useAdminFilters, useAdminT, useTab, type Step, Status, Waterfall } from '@/admin/ui';
import { fmtDate, fmtEur, fmtNum } from '@/lib/adminFormat';
import { COST_ITEMS, margin, moneyLabelKey, monthCosts, yunoRevenue } from './terms';
import { INVOICES_PAGE_SIZE, useCostActions, useCosts, useInvoices, useMoneyIssues, type CostsMonth } from './data';
import { usePilotOverview } from '../pilotage/data';
import { fmtMonth, proHref } from '../pilotage/format';
import { TextLink } from '../pilotage/links';
import { orderHref } from './orderLink';

interface MarginRow { m: string; revenue: number; costs: number; margin: number; aiFromAuto: boolean; month: CostsMonth | null }

export default function CostsPage() {
  const { t } = useAdminT();
  const tabs = [{ value: 'margin', label: t('adm.mon.cost.tab.margin') }, { value: 'invoices', label: t('adm.mon.cost.tab.invoices') }];
  const [tab, setTab] = useTab(tabs);
  return (
    <Page title={t('adm.mon.cost.title')}>
      <Tabs items={tabs} value={tab} onChange={setTab} />
      {tab === 'margin' ? <MarginTab /> : <InvoicesTab />}
    </Page>
  );
}

/** Montant d'un poste pour un mois : la saisie, sinon (IA seulement) la lecture automatique. */
function itemAmount(m: CostsMonth | null, item: string): { amount: number; auto: boolean; line: CostsMonth['lines'][number] | null } {
  const lines = (m?.lines ?? []).filter((l) => l.item === item);
  if (lines.length > 0) return { amount: lines.reduce((s, l) => s + (Number(l.amount) || 0), 0), auto: false, line: lines[0] };
  if (item === 'ai' && (m?.ai_auto ?? 0) > 0) return { amount: m?.ai_auto ?? 0, auto: true, line: null };
  return { amount: 0, auto: false, line: null };
}

function MarginTab() {
  const { t, lang } = useAdminT();
  const { range, includeDemo } = useAdminFilters();
  const ov = usePilotOverview(range, includeDemo);
  const cq = useCosts();
  const act = useCostActions();
  const [edit, setEdit] = useState<{ m: string; item: string; amount: string; note: string } | null>(null);
  const [del, setDel] = useState<{ id: string; label: string } | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const eur = (v: number) => fmtEur(v, lang);
  const eur0 = (v: number) => fmtEur(v, lang, { cents: false });
  const itemLabel = (i: string) => costItemLabel(t, i);

  const rows = useMemo<MarginRow[] | null>(() => {
    if (!ov.data || !cq.data) return null;
    const byMonth = new Map(cq.data.months.map((m) => [m.m, m]));
    return [...ov.data.months].sort((a, b) => b.m.localeCompare(a.m)).map((m) => {
      const cm = byMonth.get(m.m) ?? null;
      const c = monthCosts(cm?.lines ?? [], cm?.ai_auto ?? 0);
      const rev = yunoRevenue(m);
      return { m: m.m, revenue: rev, costs: c.total, margin: margin(rev, c.total), aiFromAuto: c.aiFromAuto, month: cm };
    });
  }, [ov.data, cq.data]);

  // Postes affichés : la liste du produit, plus tout poste saisi hors liste (gardé sous son nom).
  const items = useMemo(() => {
    const extra = new Set<string>();
    (cq.data?.months ?? []).forEach((m) => m.lines.forEach((l) => { if (!(COST_ITEMS as readonly string[]).includes(l.item)) extra.add(l.item); }));
    return [...COST_ITEMS, ...extra];
  }, [cq.data]);

  if ((ov.error || cq.error) && !rows) return <ErrorState onRetry={() => { void ov.refetch(); void cq.refetch(); }} />;

  const sel = rows?.find((r) => r.m === picked) ?? rows?.[0] ?? null;
  const steps: Step[] = sel ? [
    { key: 'rev', label: t(moneyLabelKey('yunoRevenue')), value: sel.revenue, display: eur0(sel.revenue), total: true },
    ...items.map((i) => ({ i, a: itemAmount(sel.month, i) })).filter((x) => x.a.amount > 0)
      .map(({ i, a }) => ({ key: i, label: `${itemLabel(i)}${a.auto ? ` · ${t('adm.mon.v3k.auto')}` : ''}`, value: -a.amount, display: `− ${eur0(a.amount)}` })),
    { key: 'margin', label: t(moneyLabelKey('margin')), value: sel.margin, display: eur0(sel.margin), total: true },
  ] : [];
  const tops = rows ? { rev: Math.max(0, ...rows.map((r) => r.revenue)), cost: Math.max(0, ...rows.map((r) => r.costs)), mar: Math.max(0, ...rows.map((r) => r.margin)) } : { rev: 0, cost: 0, mar: 0 };
  const itemMax = (i: string) => Math.max(0, ...(rows ?? []).map((r) => itemAmount(r.month, i).amount));

  const sentence = !sel ? null : sel.revenue === 0 && sel.costs === 0 ? t('adm.mon.v3k.empty', { m: fmtMonth(sel.m, lang) }) : (
    <>
      {t('adm.mon.v3k.in', { m: fmtMonth(sel.m, lang) })} <b>{eur0(sel.revenue)}</b> {t('adm.mon.v3k.earned')} <b>{eur0(sel.costs)}</b> {t('adm.mon.v3k.spent')}
      {' '}{sel.margin >= 0 ? t('adm.mon.v3k.left') : t('adm.mon.v3k.short')} <b>{eur0(Math.abs(sel.margin))}</b>.
    </>
  );

  return (
    <div className="flex flex-col gap-10">
      <Hero
        kicker={t('adm.mon.v3k.kicker', { m: sel ? fmtMonth(sel.m, lang) : '' })}
        loading={!rows}
        value={sel ? eur0(sel.margin) : '—'}
        current={sel?.margin}
        previous={rows && sel ? rows[rows.indexOf(sel) + 1]?.margin ?? null : undefined}
        sentence={sentence}
        chart={sel ? <div className="max-w-[640px]"><Waterfall steps={steps} /></div> : null}
        note={t('adm.mon.cost.manualNote')}
        aside={sel && (
          <Block title={t('adm.mon.v3k.sourcesTitle')}>
            <ul className="flex flex-col">
              {items.map((i) => {
                const a = itemAmount(sel.month, i);
                return (
                  <li key={i} className="flex items-baseline gap-2 border-b py-1.5 text-[13px]">
                    <span className="a-t2 flex-1">{itemLabel(i)}</span>
                    <Status tone={a.auto ? 'neutral' : a.line ? 'positive' : 'warning'}>{a.auto ? t('adm.mon.v3k.auto') : a.line ? t('adm.mon.v3k.manual') : t('adm.mon.v3k.missing')}</Status>
                  </li>
                );
              })}
            </ul>
            <p className="a-t3 text-[12px]">{t('adm.mon.v3k.sourcesNote')}</p>
          </Block>
        )}
      />

      <Block title={t('adm.mon.cost.byMonth')} meta={t('adm.mon.v3k.tableMeta')}>
        {!rows ? <div className="a-skel h-64 w-full" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b">
                  <th className="a-kicker py-2 pr-3 text-left font-normal">{t('adm.pil.ov.month')}</th>
                  <th className="a-kicker py-2 pr-3 text-right font-normal">{t(moneyLabelKey('yunoRevenue'))}</th>
                  {items.map((i) => <th key={i} className="a-kicker py-2 pr-2 text-right font-normal">{itemLabel(i)}</th>)}
                  <th className="a-kicker py-2 pr-3 text-right font-normal">{t(moneyLabelKey('costs'))}</th>
                  <th className="a-kicker py-2 text-right font-normal">{t(moneyLabelKey('margin'))}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const on = sel?.m === r.m;
                  return (
                    <tr key={r.m} className={`border-b ${on ? 'a-row-active' : ''}`}>
                      <td className="py-1 pr-3">
                        <button type="button" className="a-focus a-mono a-t1 border-0 bg-transparent p-0 text-left font-[inherit] text-[12px] underline-offset-2 hover:underline" style={{ cursor: 'pointer' }}
                          onClick={() => setPicked(r.m)} aria-pressed={on}>{fmtMonth(r.m, lang)}</button>
                      </td>
                      <td className="a-mono py-1 pr-3 text-right" style={{ background: cellTint(r.revenue, tops.rev) }}>{eur(r.revenue)}</td>
                      {items.map((i) => {
                        const a = itemAmount(r.month, i);
                        return (
                          <td key={i} className="group py-1 pr-2 text-right" style={{ background: cellTint(a.amount, itemMax(i)) }}>
                            <span className="inline-flex items-center justify-end gap-0.5">
                              <button type="button" className="a-focus a-mono rounded border-0 bg-transparent px-1 py-0.5 font-[inherit] text-[12px] hover:bg-[var(--a-hover)]"
                                style={{ cursor: 'pointer', color: a.amount > 0 ? (a.auto ? 'var(--a-text-2)' : 'var(--a-text)') : 'var(--a-text-3)', fontStyle: a.auto ? 'italic' : undefined }}
                                title={a.auto ? t('adm.mon.v3k.autoHint') : t('adm.mon.cost.edit')}
                                aria-label={`${itemLabel(i)} · ${fmtMonth(r.m, lang)}`}
                                onClick={() => setEdit({ m: r.m, item: i, amount: a.line ? String(a.line.amount) : a.auto ? String(a.amount) : '', note: a.line?.note ?? '' })}>
                                {a.amount > 0 ? eur(a.amount) : <Plus className="inline h-3 w-3" />}
                              </button>
                              {a.line && (
                                <button type="button" className="a-focus rounded border-0 bg-transparent p-0.5 opacity-0 group-hover:opacity-100 focus:opacity-100"
                                  style={{ cursor: 'pointer', color: 'var(--a-text-3)' }} aria-label={t('adm.mon.cost.delete')}
                                  onClick={() => setDel({ id: a.line!.id, label: `${itemLabel(i)} · ${fmtMonth(r.m, lang)}` })}>
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              )}
                            </span>
                          </td>
                        );
                      })}
                      <td className="a-mono py-1 pr-3 text-right" style={{ background: cellTint(r.costs, tops.cost) }}>{eur(r.costs)}</td>
                      <td className="a-mono py-1 text-right font-semibold" style={{ background: cellTint(r.margin, tops.mar), color: r.margin < 0 ? 'var(--a-neg)' : undefined }}>{eur(r.margin)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Block>

      <ReasonDialog open={!!edit} onOpenChange={(v) => { if (!v) setEdit(null); }}
        title={t('adm.mon.cost.setTitle', { m: edit ? fmtMonth(edit.m, lang) : '' })} description={t('adm.mon.cost.setDesc')}
        onConfirm={async (reason) => {
          if (!edit) return;
          const v = Number(edit.amount.replace(',', '.'));
          if (!Number.isFinite(v) || v < 0) throw new Error(t('adm.mon.ord.badAmount'));
          await act.set.mutateAsync({ month: edit.m, item: edit.item, amount: v, note: edit.note, reason });
        }}>
        {edit && (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="a-t1 text-[12.5px] font-medium">{t('adm.mon.cost.item')}</span>
              <select className="a-input" value={edit.item} onChange={(e) => setEdit({ ...edit, item: e.target.value })}>
                {items.map((i) => <option key={i} value={i}>{itemLabel(i)}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="a-t1 text-[12.5px] font-medium">{t('adm.mon.cost.amount')}</span>
              <input className="a-input a-num" inputMode="decimal" value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: e.target.value })} />
              {edit.item === 'ai' && <span className="a-t3 text-[12px]">{t('adm.mon.v3k.aiReplace')}</span>}
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="a-t1 text-[12.5px] font-medium">{t('adm.mon.cost.note')}</span>
              <input className="a-input" value={edit.note} maxLength={500} onChange={(e) => setEdit({ ...edit, note: e.target.value })} />
            </label>
          </div>
        )}
      </ReasonDialog>
      <ReasonDialog open={!!del} onOpenChange={(v) => { if (!v) setDel(null); }} tone="danger"
        title={t('adm.mon.cost.deleteTitle')} description={del?.label}
        onConfirm={async (reason) => { if (del) await act.remove.mutateAsync({ id: del.id, reason }); }} />
    </div>
  );
}

function InvoicesTab() {
  const { t, lang } = useAdminT();
  const { includeDemo } = useAdminFilters();
  const [page, setPage] = useState(0);
  const q = useInvoices(page, includeDemo);
  const iss = useMoneyIssues(includeDemo);
  const failed = iss.data?.alerts.filter((a) => a.type === 'admin_invoice_failed') ?? [];
  const rows = q.data?.rows ?? [];
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / INVOICES_PAGE_SIZE));
  const COLS = 'grid-cols-[minmax(0,10rem)_minmax(0,1fr)_7rem_6.5rem_9rem]';

  return (
    <div className="flex flex-col gap-8">
      <Block title={t('adm.mon.v3k.failedTitle')} meta={iss.data ? fmtNum(failed.length, lang) : undefined}>
        {!iss.data ? <div className="a-skel h-10 w-full" /> : failed.length === 0 ? (
          <p className="a-t2 text-[13px]">{t('adm.mon.v3k.noFailed')}</p>
        ) : (
          <ul className="flex flex-col">
            {failed.map((a) => (
              <li key={a.id} className="flex items-baseline gap-3 border-b py-2 text-[13px]">
                <Status tone="negative">{t('adm.mon.v3k.failed')}</Status>
                <span className="a-t1">{a.title}</span>
                <span className="a-t3 min-w-0 flex-1 truncate">{a.message}</span>
                <span className="a-mono a-t3 text-[11px]">{fmtDate(a.at, lang, 'datetime')}</span>
              </li>
            ))}
            <li className="pt-2"><TextLink to="/admin/money/issues">{t('adm.mon.inv.toIssues')}</TextLink></li>
          </ul>
        )}
      </Block>

      <Block title={t('adm.mon.v3k.registry')} meta={q.data ? t('adm.mon.v3k.issued', { n: fmtNum(total, lang) }) : undefined}>
        <p className="a-t3 text-[12px]">{t('adm.mon.inv.note')}</p>
        {q.error && !q.data ? <ErrorState onRetry={() => void q.refetch()} /> : (
          <div className="flex flex-col">
            <div className={`a-kicker grid ${COLS} gap-3 border-b pb-2`}>
              <span>{t('adm.mon.inv.number')}</span><span>{t('adm.mon.inv.seller')}</span><span>{t('adm.mon.inv.sale')}</span>
              <span className="text-right">{t('adm.mon.inv.amount')}</span><span className="text-right">{t('adm.mon.ord.date')}</span>
            </div>
            {q.isLoading && !q.data ? Array.from({ length: 8 }, (_, i) => <div key={i} className="a-skel my-1 h-7 w-full" />) : rows.length === 0 ? (
              <p className="a-t2 py-6 text-[13px]">{t('adm.mon.inv.empty')}</p>
            ) : rows.map((r) => (
              <div key={r.id} className={`grid ${COLS} items-center gap-3 border-b py-1.5 text-[13px]`} style={{ opacity: q.isFetching ? 0.6 : 1 }}>
                <span className="a-mono a-t1 truncate text-[12px]">{r.number}</span>
                <TextLink to={proHref(r.seller_key)}>{r.seller ?? r.seller_key}</TextLink>
                <span className="text-[12.5px]">{r.sale_type === 'order' ? t(`adm.mon.inv.type.${r.sale_type}`) : <TextLink to={orderHref(r.sale_type, r.sale_id)}>{t(`adm.mon.inv.type.${r.sale_type}`)}</TextLink>}</span>
                <span className="a-mono a-t1 text-right text-[12px]">{fmtEur(r.amount, lang)}</span>
                <span className="a-mono a-t3 text-right text-[11.5px]">{fmtDate(r.at, lang, 'datetime')}</span>
              </div>
            ))}
            {total > INVOICES_PAGE_SIZE && (
              <div className="a-t2 flex items-center gap-3 pt-3 text-[12.5px]">
                <span className="a-mono flex-1 text-[11.5px]">{t('adm.mon.ord.page', { page: fmtNum(page + 1, lang), pages: fmtNum(pages, lang), total: fmtNum(total, lang) })}</span>
                <button type="button" className="a-btn a-btn--sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>{t('adm.ui.table.prev')}</button>
                <button type="button" className="a-btn a-btn--sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>{t('adm.ui.table.next')}</button>
              </div>
            )}
          </div>
        )}
      </Block>
    </div>
  );
}

/** Libellé d'un poste de coût ; un poste inconnu (saisi avant une liste plus courte) garde son nom. */
function costItemLabel(t: (k: string) => string, item: string): string {
  const k = `adm.mon.cost.item.${item}`;
  const v = t(k);
  return v === k ? item : v;
}
