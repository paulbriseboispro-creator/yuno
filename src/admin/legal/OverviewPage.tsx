/**
 * Légal › Vue d'ensemble (v3) : « Sommes-nous en règle ? »
 * Une page d'ÉTAT : le héros est le verdict en une phrase (« Tout est en règle »
 * ou « 2 choses à traiter, dont 1 en retard : … »). Dessous, un tableau de bord
 * d'obligations, une ligne chacune : son état (pastille + mot), ce qu'il y a à
 * faire en une phrase, son délai qui se remplit, et le lien qui la traite.
 * Les états se décident dans `rules.ts` (testé) ; les compteurs viennent de
 * `admin_legal_overview`. Rien ici n'est un avis juridique.
 */
import { useMemo } from 'react';
import { Block, ErrorState, Page, useAdminT } from '@/admin/ui';
import { fmtNum } from '@/lib/adminFormat';
import { useLegalOverview } from './data';
import { obligations, type Obligation } from './rules';
import { Cutoff, DeadlineBar, elapsedShare, GoTo, Ledger, LedgerRow, StateMark, useNow, Verdict } from './parts';
import { SourceNote } from './ui';

const ORDER = { late: 0, todo: 1, ok: 2 } as const;

export default function OverviewPage() {
  const { t, lang } = useAdminT();
  const q = useLegalOverview();
  const now = useNow();
  const o = q.data;
  const rows = useMemo(() => (o ? [...obligations(o)].sort((a, b) => ORDER[a.state] - ORDER[b.state]) : []), [o]);
  const late = rows.filter((r) => r.state === 'late');
  const todo = rows.filter((r) => r.state !== 'ok');
  const names = todo.map((r) => t(`adm.lg2.ob.${r.id}`).toLowerCase()).join(', ');

  const headline = !o ? '' : todo.length === 0 ? t('adm.lg3.ov.headOk')
    : t(todo.length === 1 ? (late.length ? 'adm.lg3.ov.headOneLate' : 'adm.lg3.ov.headOne') : (late.length ? 'adm.lg3.ov.headManyLate' : 'adm.lg3.ov.headMany'),
      { n: todo.length, l: late.length, names });

  const deadline = (ob: Obligation) => {
    if (!ob.next) return <span className="a-t3 text-[12px]">{t('adm.lg3.ov.noDeadline')}</span>;
    const to = new Date(ob.next).getTime();
    if (Number.isNaN(to)) return <span className="a-t3 text-[12px]">{t('adm.lg3.ov.noDeadline')}</span>;
    const inc = ob.id === 'incidents';
    const span = inc ? 72 * 3_600_000 : 30 * 86_400_000;
    const left = to - now;
    const label = inc
      ? (left <= 0 ? t('adm.lg2.in.overdue') : t('adm.lg2.in.left', { h: Math.floor(left / 3_600_000) }))
      : (left < 0 ? t('adm.lg2.late', { n: Math.ceil(-left / 86_400_000) }) : t('adm.lg2.daysLeft', { n: Math.floor(left / 86_400_000) }));
    return <DeadlineBar share={elapsedShare(to - span, to, now)} tone={ob.state} label={label} right={t(`adm.lg3.ov.span.${ob.id}`)} />;
  };

  if (q.isError && !o) return <Page title={t('adm.lg2.ov.title')}><ErrorState onRetry={() => void q.refetch()} /></Page>;

  return (
    <Page title={t('adm.lg2.ov.title')} subtitle={t('adm.lg2.ov.sub')}>
      {!o ? (
        <div className="flex flex-col gap-3"><div className="a-skel h-10 w-[28rem] max-w-full" /><div className="a-skel h-4 w-96 max-w-full" /></div>
      ) : (
        <Verdict tone={late.length ? 'late' : todo.length ? 'todo' : 'ok'} kicker={t('adm.lg3.ov.kicker')} headline={headline} sub={t('adm.lg3.ov.sub')} />
      )}

      <Block title={t('adm.lg2.ov.list')} meta={o ? t('adm.lg3.ov.metaCount', { n: rows.length }) : undefined}>
        {!o ? (
          <div className="flex flex-col gap-3">{Array.from({ length: 6 }, (_, i) => <div key={i} className="a-skel h-12 w-full" />)}</div>
        ) : (
          <Ledger>
            {rows.map((r) => (
              <LedgerRow key={r.id} to={r.path} className="grid-cols-1 md:grid-cols-[120px_minmax(0,1.5fr)_minmax(180px,1fr)_auto]">
                <StateMark tone={r.state}>{t(`adm.lg2.state.${r.state}`)}</StateMark>
                <div className="flex min-w-0 flex-col">
                  <span className="a-t1 text-[14px] font-medium">{t(`adm.lg2.ob.${r.id}`)}</span>
                  <span className="a-t2 text-[12.5px] leading-snug">
                    {r.state === 'ok' ? t(`adm.lg3.ov.fine.${r.id}`) : t(`adm.lg3.ov.do.${r.id}`, { n: fmtNum(r.count, lang) })}
                  </span>
                </div>
                <div className="min-w-0">{deadline(r)}</div>
                <GoTo>{t('adm.lg3.open')}</GoTo>
              </LedgerRow>
            ))}
          </Ledger>
        )}
      </Block>

      {o && todo.length === 0 && <Cutoff>{t('adm.lg3.ov.quiet')}</Cutoff>}
      <SourceNote jurist>{t('adm.lg2.ov.note')}</SourceNote>
    </Page>
  );
}
