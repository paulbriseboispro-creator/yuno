/**
 * UN fil d'activité : Yuno Tickets (`admin_activity_feed`, paginé) et Yuno CRM
 * (`crm_admin_activity`, 150 dernières lignes) réunis côté écran par
 * `mergeFeed`, filtrables par famille.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtDate, fmtEur, fmtRelative } from '@/lib/adminFormat';
import { Block, EmptyState, ErrorState, useAdminT } from '@/admin/ui';
import { toneColor } from '@/admin/ui/tone';
import { FEED_FAMILIES, mergeFeed, type FeedFamily, type FeedRow } from './queue';
import { useCrmFeed, useSuiteFeed } from './data';

export function ActivityFeed({ includeDemo }: { includeDemo: boolean }) {
  const { t } = useAdminT();
  const [filter, setFilter] = useState<FeedFamily | 'all'>('all');
  const [limit, setLimit] = useState(12);
  const suite = useSuiteFeed(includeDemo);
  const crm = useCrmFeed(includeDemo);
  const suiteRows = useMemo(() => suite.data?.pages.flat() ?? [], [suite.data]);
  const done = !suite.hasNextPage;
  const rows = useMemo(() => mergeFeed(suiteRows, crm.data ?? [], done, filter), [suiteRows, crm.data, done, filter]);
  const loading = suite.isLoading || crm.isLoading;
  const failed = suite.isError && crm.isError;

  return (
    <Block title={t('adm.today.feed.title')} meta={t('adm.today.feed.desc')}>
      <div className="max-w-full self-start overflow-x-auto"><div className="a-seg" role="group">
        {(['all', ...FEED_FAMILIES] as const).map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {t(`adm.today.feed.f.${f}`)}
          </button>
        ))}
      </div></div>
      {failed ? (
        <ErrorState onRetry={() => { void suite.refetch(); void crm.refetch(); }} />
      ) : loading ? (
        <div className="flex flex-col gap-1">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="a-skel h-7" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState title={t('adm.today.feed.empty')} />
      ) : (
        <ol className="a-frieze flex flex-col">{rows.slice(0, limit).map((r) => <FeedLine key={r.id} row={r} />)}</ol>
      )}
      {(rows.length > limit || suite.hasNextPage) && !failed && !loading && (
        <button type="button" className="a-btn a-btn--ghost a-btn--sm self-start" disabled={suite.isFetchingNextPage}
          onClick={() => { if (rows.length > limit) setLimit((l) => l + 25); else void suite.fetchNextPage(); }}>
          {suite.isFetchingNextPage ? t('adm.ui.working') : t('adm.today.feed.more')}
        </button>
      )}
    </Block>
  );
}

function FeedLine({ row }: { row: FeedRow }) {
  const { t, lang } = useAdminT();
  const body = (
    <div className="grid grid-cols-[4.75rem_minmax(0,1fr)_auto] items-center gap-3 px-1 py-1.5 text-[13px] sm:grid-cols-[7rem_minmax(0,9rem)_minmax(0,1fr)_auto]">
      <time className="a-mono a-t3 truncate whitespace-nowrap text-[11px]" dateTime={row.at} title={fmtDate(row.at, lang, 'datetime')}>{fmtRelative(row.at, lang)}</time>
      <span className="a-t2 hidden min-w-0 items-center gap-2 truncate text-[12.5px] sm:flex">
        <span aria-hidden className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: toneColor(row.tone) }} />
        <span className="truncate">{t(`adm.today.feed.k.${row.kind}`)}</span>
      </span>
      <span className="min-w-0 truncate"><span aria-hidden className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle sm:hidden" style={{ background: toneColor(row.tone) }} /><span className="a-t1">{row.title || t('adm.today.unknown')}</span>{row.sub && <span className="a-t3 ml-2">{row.sub}</span>}</span>
      <span className="a-num a-t2 text-[12.5px]">{row.amount != null && row.amount > 0 ? fmtEur(row.amount, lang) : ''}</span>
    </div>
  );
  return (
    <li className="border-b last:border-b-0">
      {row.href ? <Link to={row.href} className="a-focus block no-underline hover:bg-[var(--a-hover)]">{body}</Link> : body}
    </li>
  );
}
