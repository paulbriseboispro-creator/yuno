/**
 * UN fil d'activité : Yuno Tickets (`admin_activity_feed`, paginé) et Yuno CRM
 * (`crm_admin_activity`, 150 dernières lignes) réunis côté écran par
 * `mergeFeed`, filtrables par famille.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtDate, fmtEur, fmtRelative } from '@/lib/adminFormat';
import { Card, EmptyState, ErrorState, Section, Status, useAdminT } from '@/admin/ui';
import { FEED_FAMILIES, mergeFeed, type FeedFamily, type FeedRow } from './queue';
import { useCrmFeed, useSuiteFeed } from './data';

export function ActivityFeed({ includeDemo }: { includeDemo: boolean }) {
  const { t } = useAdminT();
  const [filter, setFilter] = useState<FeedFamily | 'all'>('all');
  const suite = useSuiteFeed(includeDemo);
  const crm = useCrmFeed(includeDemo);
  const suiteRows = useMemo(() => suite.data?.pages.flat() ?? [], [suite.data]);
  const done = !suite.hasNextPage;
  const rows = useMemo(() => mergeFeed(suiteRows, crm.data ?? [], done, filter), [suiteRows, crm.data, done, filter]);
  const loading = suite.isLoading || crm.isLoading;
  const failed = suite.isError && crm.isError;

  return (
    <Section title={t('adm.today.feed.title')} description={t('adm.today.feed.desc')}>
      <div className="max-w-full self-start overflow-x-auto"><div className="a-seg" role="group">
        {(['all', ...FEED_FAMILIES] as const).map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {t(`adm.today.feed.f.${f}`)}
          </button>
        ))}
      </div></div>
      <Card padded={false}
        footer={suite.hasNextPage ? (
          <button type="button" className="a-btn a-btn--sm" disabled={suite.isFetchingNextPage} onClick={() => void suite.fetchNextPage()}>
            {suite.isFetchingNextPage ? t('adm.ui.working') : t('adm.today.feed.more')}
          </button>
        ) : undefined}>
        {failed ? (
          <ErrorState onRetry={() => { void suite.refetch(); void crm.refetch(); }} />
        ) : loading ? (
          <div>{[0, 1, 2, 3, 4].map((i) => <div key={i} className="border-b px-4 py-3 last:border-b-0"><div className="a-skel h-4 w-1/2" /></div>)}</div>
        ) : rows.length === 0 ? (
          <EmptyState title={t('adm.today.feed.empty')} />
        ) : (
          <ul className="flex flex-col">{rows.map((r) => <FeedLine key={r.id} row={r} />)}</ul>
        )}
      </Card>
    </Section>
  );
}

function FeedLine({ row }: { row: FeedRow }) {
  const { t, lang } = useAdminT();
  const body = (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div className="w-[120px] flex-none sm:w-[150px]"><Status tone={row.tone}>{t(`adm.today.feed.k.${row.kind}`)}</Status></div>
      <div className="min-w-0 flex-1">
        <span className="a-t1 text-[13px]">{row.title || t('adm.today.unknown')}</span>
        {row.sub && <span className="a-t3 ml-2 truncate text-[12.5px]">{row.sub}</span>}
      </div>
      {row.amount != null && row.amount > 0 && <span className="a-num a-t2 flex-none text-[12.5px]">{fmtEur(row.amount, lang)}</span>}
      <time className="a-t3 w-[96px] flex-none whitespace-nowrap text-right text-[12px] sm:w-[120px]" dateTime={row.at} title={fmtDate(row.at, lang, 'datetime')}>{fmtRelative(row.at, lang)}</time>
    </div>
  );
  return (
    <li className="border-b last:border-b-0">
      {row.href ? <Link to={row.href} className="a-focus block hover:bg-[var(--a-hover)]">{body}</Link> : body}
    </li>
  );
}
