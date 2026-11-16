/**
 * La file « à traiter » : groupée par urgence, filtrable par famille. Chaque
 * ligne dit la chose, le compte concerné, depuis quand ou jusqu'à quand, et
 * porte trois gestes : agir (ouvre la page où agir), « Traité », « Plus tard ».
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Check, Clock, PartyPopper, RotateCcw } from 'lucide-react';
import { notifLink, type AppNotif, type FeedConfig } from '@/lib/notifications';
import { fmtDate, fmtRelative } from '@/lib/adminFormat';
import { Badge, Card, Dialog, EmptyState, ErrorState, Section, useAdminT } from '@/admin/ui';
import type { Tone } from '@/admin/ui';
import { daysUntil, familyCounts, groupByUrgency, visibleItems, type FamilyFilter, type TodayItem, type Urgency } from './queue';
import { useMarkItem } from './data';

const ADMIN_FEED: FeedConfig = {
  table: 'admin_notifications', filterColumn: 'scope', filterValue: 'platform', basePath: '/admin',
  pagePath: '/admin/today/alerts', realtimeFilter: 'scope=eq.platform', channelKey: 'today',
};

const URGENCY_TONE: Record<Urgency, Tone> = { 1: 'negative', 2: 'warning', 3: 'neutral' };

function hrefOf(item: TodayItem): string {
  if (item.family !== 'alert' || !item.params) return item.href;
  const p = item.params as Record<string, unknown>;
  const n: AppNotif = {
    id: item.key.slice(6), title: item.name ?? '', message: item.detail ?? '',
    notification_type: String(p.type ?? ''), priority: 'high', created_at: item.at ?? '', read_at: null,
    event_id: (p.event_id as string | null) ?? null, reference_type: (p.reference_type as string | null) ?? null,
    reference_id: (p.reference_id as string | null) ?? null, metadata: (p.metadata as Record<string, unknown>) ?? {},
  };
  return notifLink(n, ADMIN_FEED) ?? item.href;
}

export function TodayQueue({ items, loading, error, onRetry }: {
  items: TodayItem[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const { t } = useAdminT();
  const [filter, setFilter] = useState<FamilyFilter>('all');
  const [showMarked, setShowMarked] = useState(false);
  const all = useMemo(() => items ?? [], [items]);
  const fams = useMemo(() => familyCounts(all), [all]);
  const open = all.filter((i) => !i.mark).length;
  const marked = all.length - open;
  const rows = useMemo(() => visibleItems(all, filter, showMarked), [all, filter, showMarked]);
  const groups = useMemo(() => groupByUrgency(rows), [rows]);

  return (
    <Section title={<>{t('adm.today.queue.title')}{open > 0 && <span className="a-num a-t3 ml-2 text-[13px] font-medium">{open}</span>}</>}
      description={t('adm.today.queue.desc')}
      actions={marked > 0 && (
        <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={() => setShowMarked((v) => !v)}>
          {showMarked ? t('adm.today.queue.hideMarked') : t('adm.today.queue.showMarked', { n: marked })}
        </button>
      )}>
      {fams.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('adm.today.queue.title')}>
          <FilterChip on={filter === 'all'} onClick={() => setFilter('all')} label={t('adm.today.queue.all')} n={open} />
          {fams.map((f) => (
            <FilterChip key={f.family} on={filter === f.family} onClick={() => setFilter(f.family)} label={t(`adm.today.fam.${f.family}`)} n={f.n} />
          ))}
        </div>
      )}
      {error && !items ? (
        <Card padded={false}><ErrorState onRetry={onRetry} /></Card>
      ) : loading && !items ? (
        <Card padded={false}>{[0, 1, 2, 3].map((i) => <div key={i} className="border-b px-4 py-3 last:border-b-0"><div className="a-skel h-4 w-2/3" /><div className="a-skel mt-2 h-3 w-1/3" /></div>)}</Card>
      ) : groups.length === 0 ? (
        <Card padded={false}>
          {filter === 'all'
            ? <EmptyState icon={<PartyPopper className="h-4 w-4" style={{ color: 'var(--a-pos)' }} />} title={t('adm.today.queue.empty')} body={t('adm.today.queue.emptyBody')} />
            : <EmptyState title={t('adm.today.queue.emptyFiltered')} />}
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <Card key={g.urgency} padded={false}
              title={<span className="inline-flex items-center gap-2"><Badge tone={URGENCY_TONE[g.urgency]}>{t(`adm.today.u.${g.urgency}`)}</Badge><span className="a-num a-t3 text-[12.5px] font-medium">{g.items.length}</span></span>}>
              <ul className="flex flex-col">
                {g.items.map((it) => <QueueRow key={it.key} item={it} />)}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </Section>
  );
}

function FilterChip({ on, onClick, label, n }: { on: boolean; onClick: () => void; label: string; n: number }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className="a-focus inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] font-medium"
      style={{ cursor: 'pointer', background: on ? 'var(--a-accent-soft)' : 'var(--a-panel)', color: on ? 'var(--a-accent-text)' : 'var(--a-text-2)', borderColor: on ? 'transparent' : 'var(--a-border)' }}>
      {label}<span className="a-num" style={{ color: on ? 'var(--a-accent-text)' : 'var(--a-text-3)' }}>{n}</span>
    </button>
  );
}

function QueueRow({ item }: { item: TodayItem }) {
  const { t, lang } = useAdminT();
  const mark = useMarkItem();
  const [doneOpen, setDoneOpen] = useState(false);
  const [laterOpen, setLaterOpen] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState(false);

  const p = (item.params ?? {}) as Record<string, unknown>;
  const name = item.name || t('adm.today.unknown');
  const days = p.days != null ? Number(p.days) : daysUntil(item.due_at);
  const title = t(`adm.today.k.${item.kind}`, { name, days: days ?? '' });
  const when = item.due_at
    ? t('adm.today.due', { when: fmtDate(item.due_at, lang, 'datetime') })
    : item.at ? t('adm.today.since', { when: fmtRelative(item.at, lang) }) : null;
  const href = hrefOf(item);
  const external = /^https?:/.test(href);

  const run = (status: 'done' | 'snoozed' | 'open', d?: number, reason?: string) => {
    setErr(false);
    mark.mutate({ key: item.key, status, days: d, reason: reason ?? null }, {
      onError: () => setErr(true),
      onSuccess: () => { setDoneOpen(false); setLaterOpen(false); setNote(''); },
    });
  };

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 last:border-b-0" style={item.mark ? { opacity: 0.6 } : undefined}>
      <div className="min-w-0 flex-1 basis-[280px]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="a-t1 min-w-0 text-[13.5px] font-medium">{title}</span>
          <Badge>{t(`adm.today.fam.${item.family}`)}</Badge>
        </div>
        <div className="a-t3 mt-0.5 flex flex-wrap gap-x-2 text-[12.5px]">
          {item.detail && <span className="a-t2 min-w-0 max-w-[70ch] truncate">{item.detail}</span>}
          {when && <span>{when}</span>}
          {item.mark && (
            <span>
              {item.mark.status === 'done'
                ? t('adm.today.markedDone', { when: fmtRelative(item.mark.at, lang) })
                : t('adm.today.markedUntil', { when: fmtDate(item.mark.until, lang, 'datetime') })}
              {item.mark.reason ? ` · ${item.mark.reason}` : ''}
            </span>
          )}
        </div>
        {err && <p role="alert" className="mt-1 text-[12px]" style={{ color: 'var(--a-neg)' }}>{t('adm.today.markError')}</p>}
      </div>
      <div className="flex flex-none items-center gap-1.5">
        {external
          ? <a className="a-btn a-btn--sm a-btn--primary" href={href} target="_blank" rel="noreferrer">{t(`adm.today.act.${item.family}`)}<ArrowUpRight className="h-3.5 w-3.5" /></a>
          : <Link className="a-btn a-btn--sm a-btn--primary" to={href}>{t(`adm.today.act.${item.family}`)}</Link>}
        {item.mark ? (
          <button type="button" className="a-btn a-btn--sm" disabled={mark.isPending} onClick={() => run('open')}>
            <RotateCcw className="h-3.5 w-3.5" />{t('adm.today.reopen')}
          </button>
        ) : (
          <>
            <button type="button" className="a-btn a-btn--sm" disabled={mark.isPending} onClick={() => setDoneOpen(true)}>
              <Check className="h-3.5 w-3.5" />{t('adm.today.done')}
            </button>
            <button type="button" className="a-btn a-btn--sm a-btn--ghost" disabled={mark.isPending} onClick={() => setLaterOpen(true)}>
              <Clock className="h-3.5 w-3.5" />{t('adm.today.later')}
            </button>
          </>
        )}
      </div>

      <Dialog open={doneOpen} onOpenChange={setDoneOpen} title={t('adm.today.doneTitle')} description={t('adm.today.doneDesc')}
        confirmLabel={t('adm.today.done')} busy={mark.isPending} onConfirm={() => run('done', undefined, note.trim() || undefined)}>
        <label className="flex flex-col gap-1.5">
          <span className="a-t1 text-[12.5px] font-medium">{t('adm.today.doneNote')}</span>
          <textarea className="a-input" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </Dialog>
      <Dialog open={laterOpen} onOpenChange={setLaterOpen} title={t('adm.today.later')} description={title}>
        <div className="flex flex-wrap gap-2">
          {[1, 3, 7].map((d) => (
            <button key={d} type="button" className="a-btn" disabled={mark.isPending} onClick={() => run('snoozed', d)}>
              {t(`adm.today.later.${d}`)}
            </button>
          ))}
        </div>
      </Dialog>
    </li>
  );
}
