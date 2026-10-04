/**
 * Admin CRM › Produit et valeur (« Admin Produit » du design) : ce que les
 * comptes réels utilisent, en combien de temps ils voient la valeur, ce qu'ils
 * attendent : le NPS et les demandes libres (Console › Compte › Aide), et les
 * inscriptions aux listes d'attente « bientôt ».
 */
import { useCrmT } from '@/crm/i18n';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { Skel } from '@/crm/ui/kit';
import { useAdminProduct } from '../data';
import type { AdminProduct } from '../data';
import FeedbackSections from './FeedbackSections';
import { EmptyNote, Kpi, PageHead, RowLine, Section, kpiGrid, pageWrap, twoCols } from '../ui';

export default function ProductPage() {
  const { t } = useCrmT();
  const q = useAdminProduct();
  if (q.isError && !q.data) return <main style={{ padding: 32 }}><CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} /></main>;
  return (
    <main style={pageWrap}>
      <PageHead kicker={t('adm.crm.pr.kicker', { paid: q.data?.paid ?? 0, live: q.data?.live ?? 0 })} title={t('adm.crm.pr.title')} sub={t('adm.crm.pr.sub')} />
      {!q.data ? <><div style={kpiGrid}>{[0, 1, 2].map((i) => <Skel key={i} h={118} r={24} />)}</div><Skel h={320} r={28} /></> : <Body d={q.data} />}
    </main>
  );
}

function Body({ d }: { d: AdminProduct }) {
  const { t, n, pct, n1 } = useCrmT();
  const days = (v: number | null) => (v === null ? '—' : v < 1 ? t('adm.crm.pr.lessDay') : t('adm.crm.pr.days', { n: n1(v) }));
  const r = d.retention;
  const rateWith = r.with_recipes ? (r.with_recipes_paid / r.with_recipes) * 100 : null;
  const rateWithout = r.without ? (r.without_paid / r.without) * 100 : null;
  const small = r.with_recipes + r.without < 10;
  return (
    <>
      <FeedbackSections />
      <Section title={t('adm.crm.pr.retain')} sub={t('adm.crm.pr.retainSub')} pad={24} gap={12}>
        {rateWith === null && rateWithout === null ? <EmptyNote>{t('adm.crm.pr.retainNone')}</EmptyNote> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 16 }}>
            <Kpi label={t('adm.crm.pr.withRecipes')} value={rateWith === null ? '—' : pct(rateWith)} dot="var(--green-500)" sub={t('adm.crm.pr.ofN', { n: r.with_recipes_paid, m: r.with_recipes })} />
            <Kpi delay={60} label={t('adm.crm.pr.withoutRecipes')} value={rateWithout === null ? '—' : pct(rateWithout)} sub={t('adm.crm.pr.ofN', { n: r.without_paid, m: r.without })} />
          </div>
        )}
        {small && <p style={{ margin: 0, fontSize: 13, color: 'var(--sand-500)' }}>{t('adm.crm.pr.smallSample')}</p>}
      </Section>
      <div style={twoCols}>
        <Section title={t('adm.crm.pr.usage')} sub={t('adm.crm.pr.usageSub', { n: d.live })} pad={24} gap={10}>
          {d.live === 0 && <EmptyNote>{t('adm.crm.pr.usageNone')}</EmptyNote>}
          {d.usage.map((u) => (
            <div key={u.step} style={{ display: 'grid', gridTemplateColumns: 'minmax(140px,200px) 1fr 54px', alignItems: 'center', gap: 12, fontSize: 14 }}>
              <span>{t(`adm.crm.ob.${u.step}`)}</span>
              <span style={{ height: 14, borderRadius: 99, background: 'var(--sand-50)', overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${d.live ? (u.n / d.live) * 100 : 0}%`, background: 'var(--gradient-brand)', borderRadius: 99 }} /></span>
              <b style={{ textAlign: 'right' }}>{u.n}/{d.live}</b>
            </div>
          ))}
        </Section>
        <Section title={t('adm.crm.pr.ttv')} sub={t('adm.crm.pr.ttvSub', { n: d.ttv.n })} pad={24} gap={4}>
          {([['sync', d.ttv.sync, d.ttv.n_sync], ['sent', d.ttv.sent, d.ttv.n_sent], ['bought', d.ttv.bought, d.ttv.n_bought]] as [string, number | null, number][]).map(([k, v, c], i) => (
            <RowLine key={k} first={i === 0}><span>{t(`adm.crm.pr.t.${k}`)}</span><span style={{ textAlign: 'right' }}><b>{days(v)}</b><br /><span style={{ fontSize: 12, color: 'var(--sand-500)' }}>{t('adm.crm.pr.accounts', { n: c })}</span></span></RowLine>
          ))}
        </Section>
      </div>
      <div style={twoCols}>
        <Section title={t('adm.crm.pr.recipes')} sub={t('adm.crm.pr.recipesSub')} pad={24} gap={4}>
          {d.recipes.length === 0 && <EmptyNote>{t('adm.crm.pr.recipesNone')}</EmptyNote>}
          {d.recipes.map((x, i) => <RowLine key={x.kind} first={i === 0}><span style={{ fontWeight: 600 }}>{t(`adm.crm.pr.kind.${x.kind}`) === `adm.crm.pr.kind.${x.kind}` ? x.kind : t(`adm.crm.pr.kind.${x.kind}`)}</span><b>{n(x.n)}</b></RowLine>)}
        </Section>
        <Section title={t('adm.crm.pr.wait')} sub={t('adm.crm.pr.waitSub')} pad={24} gap={4}>
          {d.waitlist.length === 0 && <EmptyNote>{t('adm.crm.pr.waitNone')}</EmptyNote>}
          {d.waitlist.map((x, i) => <RowLine key={x.feature} first={i === 0}><span style={{ fontWeight: 600 }}>{t(`adm.crm.pr.feat.${x.feature}`) === `adm.crm.pr.feat.${x.feature}` ? x.feature : t(`adm.crm.pr.feat.${x.feature}`)}</span><b>{n(x.n)}</b></RowLine>)}
        </Section>
      </div>
    </>
  );
}
