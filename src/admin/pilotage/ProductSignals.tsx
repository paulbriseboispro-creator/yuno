/**
 * Pilotage › Produit › Signaux : « Que font les gens dans Yuno ? »
 * Six chiffres, les soirées et pages les plus vues, puis le reste rangé en
 * sections repliées (favoris, conversion par pilier, notifications
 * automatiques, questions aux assistants, retours, goûts et audience).
 * Lecture : admin_product_insights (une RPC, démo selon l'interrupteur).
 */
import { Link } from 'react-router-dom';
import {
  Badge, Card, DataTable, ErrorState, Grid, Kpi, KpiRow, KeyValue, Section, useAdminFilters, useAdminT, type ColumnDef,
} from '@/admin/ui';
import { fmtDate, fmtNum, fmtPct, fmtPlural, fmtRelative } from '@/lib/adminFormat';
import { MIN_SAMPLE } from '@/lib/metrics';
import { useProductInsights, type KV, type ProductInsights } from './data';
import { proHref } from './format';
import { Fold } from './Fold';

const secs = (n: number | null): string => (n == null ? '—' : n >= 60 ? `${Math.round(n / 60)} min` : `${Math.round(n)} s`);

export default function ProductSignals() {
  const { t, lang } = useAdminT();
  const { range, includeDemo } = useAdminFilters();
  const q = useProductInsights(range, includeDemo);
  const d = q.data;
  const tr = (prefix: string, raw: string) => {
    if (!raw) return t('adm.product.unknownValue');
    const k = `${prefix}.${raw}`;
    const v = t(k);
    return v === k ? raw : v;
  };
  const n = (v: number | null | undefined) => fmtNum(v, lang);

  if (q.error && !d) return <ErrorState onRetry={() => void q.refetch()} />;

  const views = d ? d.page_groups.reduce((s, g) => s + g.views, 0) : 0;
  const en = d?.entry;

  return (
    <div className="flex flex-col gap-6">
      <KpiRow>
        <Kpi label={t('adm.pl.sig.k.views')} hint={t('adm.pl.sig.k.viewsHint')} loading={!d} value={n(views)} />
        <Kpi label={t('adm.product.entry.guestlist')} hint={d ? t('adm.product.entry.scanned', { n: n(en?.guestlist_scanned) }) : undefined} loading={!d} value={n(en?.guestlist)} />
        <Kpi label={t('adm.product.entry.tickets')} hint={d ? t('adm.product.entry.scanned', { n: n(en?.tickets_scanned) }) : undefined} loading={!d} value={n(en?.tickets)} />
        <Kpi label={t('adm.product.entry.abandoned')} loading={!d} value={n(en?.abandoned_carts)} />
        <Kpi label={t('adm.pl.sig.k.push')} hint={t('adm.pl.sig.k.pushHint')} loading={!d} value={n(d?.notifications.push_users)} />
        <Kpi label={t('adm.pl.sig.k.feedback')} loading={!d} value={n(d?.feedback.open)} to="/admin/today/feedback" invert />
      </KpiRow>

      <Section title={t('adm.product.topEvents')} description={t('adm.pl.sig.eventsSub')}>
        <EventsTable rows={d?.top_events_viewed} loading={!d} error={q.error} onRetry={() => void q.refetch()} />
      </Section>

      <Grid cols={2}>
        <Card title={t('adm.product.pageGroups')} padded={false}>
          <GroupsTable rows={d?.page_groups} loading={!d} tr={tr} />
        </Card>
        <Card title={t('adm.product.topPaths')} padded={false}>
          <PathsTable rows={d?.top_paths} loading={!d} tr={tr} />
        </Card>
      </Grid>

      {d && (
        <div className="flex flex-col gap-3">
          <Fold title={t('adm.product.favorites')} hint={t('adm.product.favoritesHint')}>
            <Grid cols={2}>
              <FavTypes rows={d.favorites.by_type} tr={tr} />
              <FollowsTable rows={d.follows.by_subject} tr={tr} />
            </Grid>
            <Grid cols={3}>
              <RankTable title={t('adm.product.topFavEvents')} rows={d.favorites.top_events.map((e) => ({ id: e.id, name: e.title, sub: fmtDate(e.start_at, lang, 'day'), n: e.n }))} />
              <RankTable title={t('adm.product.topFavVenues')} rows={d.favorites.top_venues.map((v) => ({ id: v.id, name: v.name, sub: v.city ?? '', n: v.n, href: proHref(`venue:${v.id}`) }))} />
              <RankTable title={t('adm.product.topFavDjs')} rows={d.favorites.top_djs.map((x) => ({ id: x.id, name: x.name, sub: '', n: x.n }))} />
            </Grid>
          </Fold>

          <Fold title={t('adm.pl.sig.conv')} hint={t('adm.pl.sig.convHint')}>
            <ConversionTable entry={d.entry} />
            <KeyValue columns={2} items={[
              { label: t('adm.product.entry.wallet'), value: `${n(d.entry.wallet_passes)}${d.entry.wallet_by_type.length ? ` (${d.entry.wallet_by_type.map((w) => `${n(w.n)} ${tr('adm.product.wallet', w.k)}`).join(' · ')})` : ''}` },
              { label: t('adm.product.entry.guestShare'), value: d.entry.guest_checkout_share == null ? t('adm.product.entry.noSale') : fmtPct(d.entry.guest_checkout_share) },
            ]} />
          </Fold>

          <Fold title={t('adm.product.autoPush')} hint={fmtPlural(d.notifications.auto_push.length, lang, t('adm.pl.sig.rule1'), t('adm.pl.sig.rules', { n: d.notifications.auto_push.length }))}>
            <AutoPushTable rows={d.notifications.auto_push} />
            <KeyValue columns={2} items={[
              { label: t('adm.product.push'), value: fmtPlural(d.notifications.push_users, lang, t('adm.product.pushUsersOne'), t('adm.product.pushUsers')).replace('{n}', n(d.notifications.push_users)) },
              { label: t('adm.pl.sig.platforms'), value: d.notifications.push_by_platform.map((p) => `${p.k || t('adm.product.unknownValue')} ${n(p.n)}`).join(' · ') || '—' },
              { label: t('adm.product.discovery'), value: t('adm.product.discoveryLine', { s: n(d.notifications.discovery_sent), o: n(d.notifications.discovery_opened), x: n(d.notifications.discovery_opt_out) }) },
              { label: t('adm.product.newsletter'), value: t('adm.product.newsletterLine', { i: n(d.notifications.newsletter_opt_in), o: n(d.notifications.newsletter_opt_out_period) }) },
            ]} />
            <div><Link to="/admin/comms/engine" className="a-btn a-btn--sm">{t('adm.product.seeAll')}</Link></div>
          </Fold>

          <Fold title={t('adm.pl.sig.assistants')} hint={t('adm.pl.sig.assistantsHint')}>
            <Grid cols={2}>
              <QuestionsTable title={t('adm.product.aiQuestions')} rows={d.ai_questions.map((x, i) => ({ id: String(i), at: x.at, q: x.q, tag: x.lang ? x.lang.toUpperCase() : '', bad: x.status !== 'ok' ? x.status : '' }))} />
              <QuestionsTable title={t('adm.product.proQuestions')} rows={d.pro_questions.map((x, i) => ({ id: String(i), at: x.at, q: x.q, tag: tr('adm.ai.a', x.assistant), bad: x.status !== 'ok' ? x.status : '' }))} />
            </Grid>
            <LinksInterest rows={d.links_interest} />
          </Fold>

          <Fold title={t('adm.product.feedback')} hint={t('adm.product.feedbackOpen', { n: n(d.feedback.open) })}>
            <FeedbackTable rows={d.feedback.recent} />
            <KeyValue columns={2} items={[
              { label: t('adm.product.incidents'), value: n(d.feedback.incidents) },
              { label: t('adm.product.complaints'), value: n(d.feedback.email_complaints) },
              ...d.feedback.by_category.map((c) => ({ label: c.k || t('adm.product.unknownValue'), value: n(c.n) })),
            ]} />
            <div><Link to="/admin/today/feedback" className="a-btn a-btn--sm">{t('adm.product.seeAll')}</Link></div>
          </Fold>

          <Fold title={t('adm.pl.sig.taste')} hint={t('adm.product.tasteN', { n: n(d.taste.profiles) })}>
            <Grid cols={3}>
              <Dist title={t('adm.product.taste.genres')} items={d.taste.genres} />
              <Dist title={t('adm.product.taste.night_type')} items={d.taste.night_type} />
              <Dist title={t('adm.product.taste.budget')} items={d.taste.budget} />
              <Dist title={t('adm.product.taste.frequency')} items={d.taste.frequency} />
              <Dist title={t('adm.product.taste.drink')} items={d.taste.drink} />
              <Dist title={t('adm.product.taste.booking')} items={d.taste.booking} />
              <Dist title={t('adm.product.aud.cities')} items={d.audience.cities} />
              <Dist title={t('adm.product.aud.languages')} items={d.audience.languages.map((l) => ({ ...l, k: l.k === '?' ? '' : l.k.toUpperCase() }))} />
              <Dist title={t('adm.product.aud.genders')} items={d.audience.genders.map((l) => ({ ...l, k: l.k === '?' ? '' : l.k }))} />
              <Dist title={t('adm.product.aud.ages')} items={d.audience.ages} />
              <Dist title={t('adm.product.aud.personas')} items={d.audience.personas} />
              <Dist title={t('adm.product.aud.session_countries')} items={d.audience.session_countries.map((l) => ({ ...l, k: l.k === '?' ? '' : l.k }))} />
              <Dist title={t('adm.product.aud.session_languages')} items={d.audience.session_languages.map((l) => ({ ...l, k: l.k === '?' ? '' : l.k.toUpperCase() }))} />
              <Dist title={t('adm.product.aud.session_devices')} items={d.audience.session_devices.map((l) => ({ ...l, k: l.k === '?' ? '' : l.k }))} />
            </Grid>
          </Fold>
        </div>
      )}
    </div>
  );

}

function EventsTable({ rows, loading, error, onRetry }: { rows: ProductInsights['top_events_viewed'] | undefined; loading: boolean; error: unknown; onRetry: () => void }) {
  const { t, lang } = useAdminT();
  const n = (v: number) => fmtNum(v, lang);
  const cols: ColumnDef<ProductInsights['top_events_viewed'][number], unknown>[] = [
    { accessorKey: 'title', header: t('adm.product.col.event'), cell: ({ row }) => (
      <span className="flex flex-col">
        <span className="a-t1 font-medium">{row.original.title}</span>
        <span className="a-t3 text-[12px]">{fmtDate(row.original.start_at, lang, 'day')}{row.original.venue_name ? ` · ${row.original.venue_name}` : ''}</span>
      </span>
    ) },
    { accessorKey: 'views', header: t('adm.product.col.views'), meta: { align: 'right' }, cell: (c) => n(c.getValue<number>()) },
    { accessorKey: 'sessions', header: t('adm.product.col.sessions'), meta: { align: 'right' }, cell: (c) => n(c.getValue<number>()) },
    { accessorKey: 'avg_seconds', header: t('adm.product.col.time'), meta: { align: 'right' }, cell: (c) => secs(c.getValue<number | null>()) },
    { accessorKey: 'guestlist', header: t('adm.product.col.guestlist'), meta: { align: 'right' }, cell: (c) => n(c.getValue<number>()) },
    { accessorKey: 'tickets', header: t('adm.product.col.tickets'), meta: { align: 'right' }, cell: (c) => n(c.getValue<number>()) },
  ];
  return <DataTable data={rows} columns={cols} loading={loading} error={error} onRetry={onRetry} pageSize={10} initialSort={[{ id: 'views', desc: true }]} getRowId={(r) => r.id} empty={{ title: t('adm.product.noSignal') }} />;
}

type TrFn = (prefix: string, raw: string) => string;

function GroupsTable({ rows, loading, tr }: { rows: ProductInsights['page_groups'] | undefined; loading: boolean; tr: TrFn }) {
  const { t, lang } = useAdminT();
  const cols: ColumnDef<ProductInsights['page_groups'][number], unknown>[] = [
    { accessorKey: 'group', header: t('adm.product.col.group'), cell: (c) => tr('adm.cockpit.g', c.getValue<string>()) },
    { accessorKey: 'views', header: t('adm.product.col.views'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { accessorKey: 'sessions', header: t('adm.product.col.sessions'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { accessorKey: 'avg_seconds', header: t('adm.product.col.time'), meta: { align: 'right' }, cell: (c) => secs(c.getValue<number | null>()) },
  ];
  return <DataTable data={rows} columns={cols} loading={loading} pageSize={10} initialSort={[{ id: 'views', desc: true }]} getRowId={(r) => r.group} empty={{ title: t('adm.product.noSignal') }} />;
}

function PathsTable({ rows, loading, tr }: { rows: ProductInsights['top_paths'] | undefined; loading: boolean; tr: TrFn }) {
  const { t, lang } = useAdminT();
  const cols: ColumnDef<ProductInsights['top_paths'][number], unknown>[] = [
    { accessorKey: 'path', header: t('adm.product.col.path'), cell: (c) => <code className="text-[12px]">{c.getValue<string>()}</code> },
    { accessorKey: 'group', header: t('adm.product.col.group'), cell: (c) => <span className="a-t2">{tr('adm.cockpit.g', c.getValue<string>())}</span> },
    { accessorKey: 'views', header: t('adm.product.col.views'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
  ];
  return <DataTable data={rows} columns={cols} loading={loading} pageSize={10} initialSort={[{ id: 'views', desc: true }]} getRowId={(r) => r.path} empty={{ title: t('adm.product.noSignal') }} />;
}

function FavTypes({ rows, tr }: { rows: ProductInsights['favorites']['by_type']; tr: TrFn }) {
  const { t, lang } = useAdminT();
  const cols: ColumnDef<ProductInsights['favorites']['by_type'][number], unknown>[] = [
    { accessorKey: 'type', header: t('adm.product.favorites'), cell: (c) => tr('adm.product.fav', c.getValue<string>()) },
    { accessorKey: 'period', header: t('adm.pl.sig.period'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { accessorKey: 'total', header: t('adm.pl.sig.total'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
  ];
  return <DataTable data={rows} columns={cols} pageSize={10} initialSort={[{ id: 'total', desc: true }]} getRowId={(r) => r.type} empty={{ title: t('adm.product.noSignal') }} />;
}

function FollowsTable({ rows, tr }: { rows: ProductInsights['follows']['by_subject']; tr: TrFn }) {
  const { t, lang } = useAdminT();
  const cols: ColumnDef<ProductInsights['follows']['by_subject'][number], unknown>[] = [
    { accessorKey: 'subject', header: t('adm.product.follows'), cell: (c) => tr('adm.product.sub', c.getValue<string>()) },
    { accessorKey: 'follows', header: t('adm.pl.sig.follows'), meta: { align: 'right' }, cell: (c) => `+${fmtNum(c.getValue<number>(), lang)}` },
    { accessorKey: 'unfollows', header: t('adm.pl.sig.unfollows'), meta: { align: 'right' }, cell: (c) => `−${fmtNum(c.getValue<number>(), lang)}` },
  ];
  return <DataTable data={rows} columns={cols} pageSize={10} getRowId={(r) => r.subject} empty={{ title: t('adm.product.noSignal') }} />;
}

function RankTable({ title, rows }: { title: string; rows: Array<{ id: string; name: string; sub: string; n: number; href?: string }> }) {
  const { t, lang } = useAdminT();
  const cols: ColumnDef<(typeof rows)[number], unknown>[] = [
    { accessorKey: 'name', header: title, cell: ({ row }) => (
      <span className="flex flex-col"><span className="a-t1 font-medium">{row.original.name}</span>{row.original.sub && <span className="a-t3 text-[12px]">{row.original.sub}</span>}</span>
    ) },
    { accessorKey: 'n', header: t('adm.pl.sig.favs'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
  ];
  return <DataTable data={rows} columns={cols} pageSize={8} getRowId={(r) => r.id} rowHref={(r) => r.href ?? null} empty={{ title: t('adm.product.noSignal') }} />;
}

function ConversionTable({ entry }: { entry: ProductInsights['entry'] }) {
  const { t, lang } = useAdminT();
  const rows = [
    { key: 'guestlist', n: entry.guestlist, scanned: entry.guestlist_scanned as number | null },
    { key: 'tickets', n: entry.tickets, scanned: entry.tickets_scanned as number | null },
    { key: 'tables', n: entry.tables, scanned: null as number | null },
  ];
  const cols: ColumnDef<(typeof rows)[number], unknown>[] = [
    { accessorKey: 'key', header: t('adm.pl.sig.pillar'), enableSorting: false, cell: (c) => t(`adm.product.entry.${c.getValue<string>()}`) },
    { accessorKey: 'n', header: t('adm.pl.sig.sold'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { accessorKey: 'scanned', header: t('adm.pl.sig.scanned'), meta: { align: 'right' }, cell: (c) => (c.getValue<number | null>() == null ? '—' : fmtNum(c.getValue<number>(), lang)) },
    { id: 'rate', header: t('adm.pl.sig.rate'), meta: { align: 'right' }, enableSorting: false, cell: ({ row }) => {
      const r = row.original;
      return r.scanned == null || r.n < MIN_SAMPLE ? '—' : fmtPct((r.scanned / r.n) * 100, 0);
    } },
  ];
  return <DataTable data={rows} columns={cols} getRowId={(r) => r.key} />;
}

function AutoPushTable({ rows }: { rows: ProductInsights['notifications']['auto_push'] }) {
  const { t, lang } = useAdminT();
  const cols: ColumnDef<ProductInsights['notifications']['auto_push'][number], unknown>[] = [
    { accessorKey: 'key', header: t('adm.product.col.key'), cell: (c) => <code className="text-[12px]">{c.getValue<string>()}</code> },
    { accessorKey: 'sent', header: t('adm.product.col.sent'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { accessorKey: 'clicked', header: t('adm.product.col.clicked'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { accessorKey: 'failed', header: t('adm.product.col.failed'), meta: { align: 'right' }, cell: (c) => (c.getValue<number>() > 0 ? <Badge tone="negative">{fmtNum(c.getValue<number>(), lang)}</Badge> : fmtNum(0, lang)) },
    { accessorKey: 'ctr', header: t('adm.product.col.ctr'), meta: { align: 'right' }, cell: (c) => fmtPct(c.getValue<number>(), 1) },
  ];
  return <DataTable data={rows} columns={cols} pageSize={10} initialSort={[{ id: 'sent', desc: true }]} getRowId={(r) => r.key} empty={{ title: t('adm.product.noSignal') }} />;
}

function QuestionsTable({ title, rows }: { title: string; rows: Array<{ id: string; at: string; q: string; tag: string; bad: string }> }) {
  const { t, lang } = useAdminT();
  const cols: ColumnDef<(typeof rows)[number], unknown>[] = [
    { accessorKey: 'q', header: title, enableSorting: false, cell: ({ row }) => (
      <span className="flex flex-col gap-0.5">
        <span className="a-t1 whitespace-normal">{row.original.q}</span>
        <span className="a-t3 flex items-center gap-1.5 text-[12px]">
          {row.original.tag && <Badge>{row.original.tag}</Badge>}
          {row.original.bad && <Badge tone="negative">{row.original.bad}</Badge>}
          {fmtRelative(row.original.at, lang)}
        </span>
      </span>
    ) },
  ];
  return <DataTable data={rows} columns={cols} pageSize={8} getRowId={(r) => r.id} empty={{ title: t('adm.product.noSignal') }} />;
}

function LinksInterest({ rows }: { rows: ProductInsights['links_interest'] }) {
  const { t, lang } = useAdminT();
  const cols: ColumnDef<ProductInsights['links_interest'][number], unknown>[] = [
    { accessorKey: 'target', header: t('adm.product.linksInterest'), cell: (c) => <code className="text-[12px]">{c.getValue<string>()}</code> },
    { accessorKey: 'n', header: t('adm.pl.sig.clicks'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
  ];
  return <DataTable data={rows} columns={cols} pageSize={8} initialSort={[{ id: 'n', desc: true }]} getRowId={(r) => r.target} empty={{ title: t('adm.product.noSignal') }} />;
}

function FeedbackTable({ rows }: { rows: ProductInsights['feedback']['recent'] }) {
  const { t, lang } = useAdminT();
  const cols: ColumnDef<ProductInsights['feedback']['recent'][number], unknown>[] = [
    { accessorKey: 'title', header: t('adm.pl.sig.feedbackTitle'), cell: ({ row }) => (
      <span className="flex flex-col"><span className="a-t1 font-medium">{row.original.title}</span><span className="a-t3 text-[12px]">{[row.original.venue, row.original.reporter].filter(Boolean).join(' · ')}</span></span>
    ) },
    { accessorKey: 'category', header: t('adm.pl.sig.category'), cell: (c) => <Badge>{c.getValue<string>()}</Badge> },
    { accessorKey: 'priority', header: t('adm.pl.sig.priority'), cell: ({ row }) => <Badge tone={row.original.priority === 'critical' || row.original.priority === 'high' ? 'warning' : 'neutral'}>{row.original.priority}</Badge> },
    { accessorKey: 'status', header: t('adm.pl.sig.status'), cell: ({ row }) => <Badge tone={row.original.status === 'open' ? 'warning' : row.original.status === 'resolved' || row.original.status === 'closed' ? 'positive' : 'neutral'}>{row.original.status}</Badge> },
    { accessorKey: 'at', header: t('adm.pl.sig.date'), cell: (c) => fmtRelative(c.getValue<string>(), lang) },
  ];
  return <DataTable data={rows} columns={cols} pageSize={8} getRowId={(r) => r.id} rowHref={() => '/admin/today/feedback'} empty={{ title: t('adm.product.noSignal') }} />;
}

function Dist({ title, items }: { title: string; items: KV[] }) {
  const { t, lang } = useAdminT();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <h3 className="a-t2 text-[12px] font-medium">{title}</h3>
      {items.length === 0 ? <p className="a-t3 text-[12.5px]">{t('adm.product.noSignal')}</p> : (
        <KeyValue items={items.map((i) => ({ label: i.k || t('adm.product.unknownValue'), value: fmtNum(i.n, lang) }))} />
      )}
    </div>
  );
}
