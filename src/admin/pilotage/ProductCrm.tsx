/**
 * Pilotage › Produit › CRM (v3) : « Qui utilise quoi dans Yuno CRM, et qu'en pensent-ils ? »
 *   1. une phrase et la grille d'usage : chaque étape de la mise en route ×
 *      (comptes en ligne, comptes avec accès), cases teintées ;
 *   2. la valeur : délais avant la valeur en bullets, l'effet des recettes,
 *      les recettes allumées en barres ;
 *   3. le NPS : le score, sa répartition en barre à 100 %, les réponses ;
 *   4. les demandes avec leur statut (changé avec un motif, journal d'audit),
 *      la liste d'attente des fonctions à venir.
 * Lecture : crm_admin_product, crm_admin_feedback. Écriture : crm_admin_feature_status.
 * Les RPC ne rendent pas l'usage compte par compte : la grille est par étape.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Block, BulletBar, ErrorState, RankBars, ReasonDialog, StackedShare, cellTint, useAdminFilters, useAdminT, Chips, Status } from '@/admin/ui';
import { fmtNum, fmtPct, fmtRelative } from '@/lib/adminFormat';
import { MIN_SAMPLE } from '@/lib/metrics';
import { ADMIN_ROUTES } from '@/crm/admin/adminNav';
import { rpc, useCrmFeedback, useCrmProduct, type FeatureStatus } from './data';
import type { Tone } from '@/admin/ui';

const STATUSES: FeatureStatus[] = ['new', 'seen', 'planned', 'done'];
const STATUS_TONE: Record<FeatureStatus, Tone> = { new: 'accent', seen: 'neutral', planned: 'warning', done: 'positive' };

export default function ProductCrm() {
  const { t, lang } = useAdminT();
  const { includeDemo } = useAdminFilters();
  const q = useCrmProduct(includeDemo);
  const fb = useCrmFeedback(includeDemo);
  const d = q.data;
  const [edit, setEdit] = useState<{ key: string; body: string; status: FeatureStatus } | null>(null);
  const [filter, setFilter] = useState<'all' | FeatureStatus>('all');
  const n = (v: number | null | undefined) => fmtNum(v ?? 0, lang);
  const tr = (prefix: string, raw: string) => { const k = `${prefix}.${raw}`; const v = t(k); return v === k ? raw : v; };

  if (q.error && !d) return <ErrorState onRetry={() => void q.refetch()} />;
  if (!d) return <div className="flex flex-col gap-6"><div className="a-skel h-6 w-2/3" /><div className="a-skel h-48 w-full" /></div>;

  const r = d.retention;
  const small = r.with_recipes + r.without < MIN_SAMPLE;
  const nps = fb.data?.nps;
  const days = (v: number | null) => (v === null ? '—' : v < 1 ? t('adm.crm.pr.lessDay') : t('adm.crm.pr.days', { n: fmtNum(v, lang, 1) }));
  const ttv = ([['sync', d.ttv.sync, d.ttv.n_sync], ['sent', d.ttv.sent, d.ttv.n_sent], ['bought', d.ttv.bought, d.ttv.n_bought]] as const);
  const ttvMax = Math.max(14, ...ttv.map(([, v]) => (v ?? 0) * 1.2));
  const requests = (fb.data?.requests ?? []).filter((x) => filter === 'all' || x.status === filter);
  const top = d.usage.length ? Math.max(1, d.live) : 1;

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-5">
        <p className="a-hero-sentence max-w-[72ch]">
          {d.live === 0 ? t('adm.pil.v3c.none') : (
            <>
              <b>{n(d.live)}</b> {t(d.live === 1 ? 'adm.pil.v3c.liveOne' : 'adm.pil.v3c.live')} <b>{n(d.paid)}</b> {t('adm.pil.v3c.paid')}
              {nps && nps.n >= 10 && nps.score != null ? <>{t('adm.pil.v3c.nps')} <b>{nps.score > 0 ? '+' : ''}{nps.score}</b></> : null}.
            </>
          )}
        </p>
        <Block title={t('adm.pil.v3c.usageTitle')} meta={t('adm.pil.v3c.usageMeta')}>
          {d.usage.length === 0 ? <p className="a-t2 text-[13px]">{t('adm.crm.pr.usageNone')}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th className="a-kicker pb-2 text-left font-normal">{t('adm.pl.crm.step')}</th>
                    <th className="a-kicker w-40 pb-2 text-right font-normal">{t('adm.pil.v3c.colLive', { n: n(d.live) })}</th>
                    <th className="a-kicker w-40 pb-2 text-right font-normal">{t('adm.pil.v3c.colPaid', { n: n(d.paid) })}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.usage.map((u) => (
                    <tr key={u.step} className="border-t">
                      <td className="a-t1 py-2 pr-3">{t(`adm.crm.ob.${u.step}`)}</td>
                      <td className="a-num py-2 pr-3 text-right" style={{ background: cellTint(u.n, top) }}>
                        {n(u.n)}{d.live >= MIN_SAMPLE ? <span className="a-mono a-t3 ml-2 text-[11px]">{fmtPct((u.n / d.live) * 100, 0, lang)}</span> : null}
                      </td>
                      <td className="a-num py-2 pr-3 text-right" style={{ background: cellTint(u.paid, Math.max(1, d.paid)) }}>{n(u.paid)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Block>
      </div>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
        <Block title={t('adm.crm.pr.ttv')} meta={t('adm.crm.pr.ttvSub', { n: d.ttv.n })}>
          <div className="flex flex-col gap-4">
            {ttv.map(([k, v, c]) => (
              <div key={k} className="flex flex-col gap-1">
                {v == null ? (
                  <div className="flex items-baseline gap-2 text-[13px]"><span className="a-t2 flex-1">{t(`adm.crm.pr.t.${k}`)}</span><span className="a-t3">{t('adm.pil.v3c.notYet')}</span></div>
                ) : (
                  <BulletBar value={v} max={ttvMax} target={7} targetLabel={t('adm.pil.v3a.week')} label={t(`adm.crm.pr.t.${k}`)} display={days(v)} />
                )}
                <span className="a-mono a-t3 text-[11px]">{t('adm.pil.v3c.onN', { n: n(c) })}</span>
              </div>
            ))}
          </div>
        </Block>
        <Block title={t('adm.crm.pr.retain')} meta={t('adm.crm.pr.retainSub')}>
          <div className="flex flex-col gap-4">
            {([['with', r.with_recipes, r.with_recipes_paid], ['without', r.without, r.without_paid]] as const).map(([k, all, paid]) => (
              <BulletBar key={k} value={paid} max={Math.max(1, all)} label={k === 'with' ? t('adm.crm.pr.withRecipes') : t('adm.crm.pr.withoutRecipes')}
                display={small || all === 0 ? `${n(paid)} / ${n(all)}` : `${n(paid)} / ${n(all)} · ${fmtPct((paid / all) * 100, 0, lang)}`} />
            ))}
            {small && <p className="a-t3 text-[12px]">{t('adm.crm.pr.smallSample')}</p>}
            <span className="a-kicker mt-2">{t('adm.crm.pr.recipes')}</span>
            <RankBars emptyText={t('adm.crm.pr.recipesNone')} items={[...d.recipes].sort((a, b) => b.n - a.n).map((x) => ({ key: x.kind, label: tr('adm.crm.pr.kind', x.kind), value: x.n, display: n(x.n) }))} />
          </div>
        </Block>
      </div>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[340px_minmax(0,1fr)]">
        <Block title={t('adm.crm.fb.nps')} meta={nps ? (nps.n >= 10 ? t('adm.crm.fb.npsSub', { n: nps.n }) : t('adm.crm.fb.npsFew', { n: nps.n })) : undefined}>
          {!nps ? <div className="a-skel h-24 w-full" /> : (
            <div className="flex flex-col gap-4">
              <span className="a-stat-value" style={{ fontSize: 36 }}>{nps.n >= 10 && nps.score !== null ? `${nps.score > 0 ? '+' : ''}${nps.score}` : '—'}</span>
              <StackedShare emptyText={t('adm.crm.fb.npsNone')} fmtShare={(s) => (nps.n >= 10 ? fmtPct(s * 100, 0, lang) : '')}
                parts={[
                  { key: 'p', label: t('adm.pil.v3c.promoters'), value: nps.promoters, display: n(nps.promoters) },
                  { key: 'm', label: t('adm.pil.v3c.passives'), value: nps.passives, display: n(nps.passives) },
                  { key: 'd', label: t('adm.pil.v3c.detractors'), value: nps.detractors, display: n(nps.detractors) },
                ]} />
              {nps.dismissed > 0 && <p className="a-t3 text-[12px]">{t('adm.crm.fb.dismissed', { n: nps.dismissed })}</p>}
            </div>
          )}
        </Block>
        <Block title={t('adm.pil.v3c.answers')}>
          {!nps ? null : nps.responses.length === 0 ? <p className="a-t2 text-[13px]">{t('adm.crm.fb.npsNone')}</p> : (
            <ul className="flex flex-col">
              {nps.responses.slice(0, 10).map((x) => (
                <li key={`${x.id}${x.at}`} className="flex items-baseline gap-3 border-b py-2">
                  <span className="a-mono w-7 flex-none text-right text-[13px] font-semibold" style={{ color: x.score >= 9 ? 'var(--a-pos)' : x.score >= 7 ? 'var(--a-text-2)' : 'var(--a-warn)' }}>{x.score}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <Link to={ADMIN_ROUTES.account(x.id)} className="a-t1 truncate text-[13px] no-underline hover:underline">{x.name}{x.person ? ` · ${x.person}` : ''}</Link>
                    {x.comment && <span className="a-t2 text-[12.5px]">« {x.comment} »</span>}
                  </span>
                  <span className="a-mono a-t3 flex-none text-[11px]">{fmtRelative(x.at, lang)}</span>
                </li>
              ))}
            </ul>
          )}
        </Block>
      </div>

      <Block title={t('adm.crm.fb.req')} meta={t('adm.crm.fb.reqSub')}>
        <Chips<'all' | FeatureStatus> value={filter} onChange={setFilter} label={t('adm.pl.sig.status')}
          options={[{ value: 'all', label: t('adm.pil.v3c.all'), count: fb.data?.requests.length ?? null },
            ...STATUSES.map((s) => ({ value: s, label: t(`adm.crm.fb.st.${s}`), count: fb.data?.requests.filter((x) => x.status === s).length ?? null }))]} />
        {fb.isLoading ? <div className="a-skel h-24 w-full" /> : fb.error && !fb.data ? <ErrorState onRetry={() => void fb.refetch()} /> : requests.length === 0 ? (
          <p className="a-t2 text-[13px]">{t('adm.crm.fb.reqNone')}</p>
        ) : (
          <ul className="flex flex-col">
            {requests.map((x) => (
              <li key={x.key}>
                <button type="button" onClick={() => setEdit({ key: x.key, body: x.body, status: x.status })}
                  className="a-focus flex w-full items-baseline gap-3 border-0 border-b bg-transparent py-2.5 text-left font-[inherit] hover:bg-[var(--a-hover)]" style={{ cursor: 'pointer' }}>
                  <span className="a-mono a-t1 w-8 flex-none text-right text-[13px] font-semibold" title={t('adm.pl.crm.accounts')}>{n(x.accounts)}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="a-t1 text-[13px]">{x.body}</span>
                    <span className="a-t3 truncate text-[12px]">{x.names.slice(0, 3).join(', ')}{x.names.length > 3 ? '…' : ''}</span>
                  </span>
                  <Status tone={STATUS_TONE[x.status]}>{t(`adm.crm.fb.st.${x.status}`)}</Status>
                  <span className="a-mono a-t3 w-20 flex-none text-right text-[11px]">{fmtRelative(x.last_at, lang)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title={t('adm.crm.pr.wait')} meta={t('adm.crm.pr.waitSub')}>
        <RankBars emptyText={t('adm.crm.pr.waitNone')} items={[...d.waitlist].sort((a, b) => b.n - a.n).map((x) => ({ key: x.feature, label: tr('adm.crm.pr.feat', x.feature), value: x.n, display: n(x.n) }))} />
      </Block>

      <ReasonDialog open={!!edit} onOpenChange={(v) => { if (!v) setEdit(null); }} title={t('adm.crm.fb.change')} description={edit?.body} confirmLabel={t('adm.pl.crm.save')}
        onConfirm={async (reason) => {
          if (!edit) return;
          await rpc('crm_admin_feature_status', { p_key: edit.key, p_status: edit.status, p_reason: reason });
          await fb.refetch();
        }}>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('adm.pl.sig.status')}>
          {STATUSES.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={edit?.status === s} className={`a-btn a-btn--sm ${edit?.status === s ? 'a-btn--primary' : ''}`}
              onClick={() => edit && setEdit({ ...edit, status: s })}>{t(`adm.crm.fb.st.${s}`)}</button>
          ))}
        </div>
      </ReasonDialog>
    </div>
  );
}
