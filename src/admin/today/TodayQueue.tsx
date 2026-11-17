/**
 * La boîte de traitement d'Aujourd'hui (v3, façon Linear / Superhuman) :
 *   - QueueList  : la file, compacte, groupée par urgence, une ligne choisie
 *                  (j / k), sans boîte par ligne ;
 *   - QueueContext : le contexte de la ligne choisie (pourquoi elle est là, le
 *                  compte, ses faits), et les gestes : action, Traité, Plus tard.
 * Raccourcis de la page : j / k, entrée (action), e (traité), l (plus tard, un jour).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Check, Clock, RotateCcw } from 'lucide-react';
import { notifLink, type AppNotif, type FeedConfig } from '@/lib/notifications';
import { fmtDate, fmtEur, fmtRelative } from '@/lib/adminFormat';
import { Badge, KeyValue, Status, useAdminT, type KeyValueItem } from '@/admin/ui';
import type { Tone } from '@/admin/ui';
import { daysUntil, groupByUrgency, type TodayItem, type Urgency } from './queue';
import { useMarkItem } from './data';
import { subjectAccountKey } from './brief';
import { useAccount } from '../pros/data';
import { isTyping } from '../shell/keys';

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

function useItemTitle() {
  const { t } = useAdminT();
  return (item: TodayItem) => {
    const p = (item.params ?? {}) as Record<string, unknown>;
    const days = p.days != null ? Number(p.days) : daysUntil(item.due_at);
    return t(`adm.today.k.${item.kind}`, { name: item.name || t('adm.today.unknown'), days: days ?? '' });
  };
}

/** Sélection au clavier : j / k bougent, entrée agit, e traite, l reporte d'un jour. */
export function useQueueKeys(order: TodayItem[], selected: string | null, setSelected: (k: string) => void) {
  const navigate = useNavigate();
  const mark = useMarkItem();
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || order.length === 0) return;
      const i = Math.max(0, order.findIndex((x) => x.key === selected));
      const cur = order[i];
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); setSelected(order[Math.min(order.length - 1, i + 1)].key); }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); setSelected(order[Math.max(0, i - 1)].key); }
      else if (e.key === 'Enter' && cur) { const h = hrefOf(cur); if (/^https?:/.test(h)) window.open(h, '_blank', 'noopener'); else navigate(h); }
      else if (e.key === 'e' && cur && !cur.mark) { mark.mutate({ key: cur.key, status: 'done' }); setSelected(order[Math.min(order.length - 1, i + 1)]?.key ?? cur.key); }
      else if (e.key === 'l' && cur && !cur.mark) { mark.mutate({ key: cur.key, status: 'snoozed', days: 1 }); setSelected(order[Math.min(order.length - 1, i + 1)]?.key ?? cur.key); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [order, selected, setSelected, navigate, mark]);
}

export function QueueList({ items, selected, onSelect }: { items: TodayItem[]; selected: string | null; onSelect: (k: string) => void }) {
  const { t, lang } = useAdminT();
  const title = useItemTitle();
  const groups = useMemo(() => groupByUrgency(items), [items]);
  return (
    <div className="flex flex-col gap-5" role="listbox" aria-label={t('adm.today.queue.title')}>
      {groups.map((g) => (
        <section key={g.urgency} className="flex flex-col">
          <div className="flex items-center gap-2 border-b pb-1.5">
            <Status tone={URGENCY_TONE[g.urgency]}><span className="a-kicker" style={{ color: 'inherit' }}>{t(`adm.today.u.${g.urgency}`)}</span></Status>
            <span className="a-mono a-t3 text-[11px]">{g.items.length}</span>
          </div>
          <ul className="flex flex-col">
            {g.items.map((it) => {
              const on = it.key === selected;
              const when = it.due_at ? t('adm.today.due', { when: fmtDate(it.due_at, lang, 'short') }) : it.at ? fmtRelative(it.at, lang) : '';
              return (
                <li key={it.key} role="option" aria-selected={on}>
                  <button type="button" onClick={() => onSelect(it.key)}
                    className={`a-focus flex w-full items-center gap-3 border-0 border-b bg-transparent px-2 py-2 text-left font-[inherit] hover:bg-[var(--a-hover)] ${on ? 'a-row-active' : ''}`}
                    style={{ cursor: 'pointer', opacity: it.mark ? 0.55 : 1 }}>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[13.5px] ${on ? 'a-t1 font-medium' : 'a-t1'}`}>{title(it)}</span>
                      {it.detail && <span className="a-t3 block truncate text-[12px]">{it.detail}</span>}
                    </span>
                    <span className="a-mono a-t3 hidden flex-none text-[11px] sm:inline">{t(`adm.today.fam.${it.family}`)}</span>
                    <span className="a-mono a-t3 w-28 flex-none truncate whitespace-nowrap text-right text-[11px]">{when}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function QueueContext({ item }: { item: TodayItem | null }) {
  const { t, lang } = useAdminT();
  const title = useItemTitle();
  const mark = useMarkItem();
  const [later, setLater] = useState(false);
  const key = item ? subjectAccountKey(item.subject_kind, item.subject_id) : null;
  const acc = useAccount(key ?? undefined);
  useEffect(() => { setLater(false); }, [item?.key]);
  if (!item) return null;

  const href = hrefOf(item);
  const external = /^https?:/.test(href);
  const a = acc.data;
  const id = a?.identity;
  const facts: KeyValueItem[] = a ? [
    { label: t('adm.today.ctx.city'), value: id?.city || null },
    { label: t('adm.today.ctx.since'), value: id?.created_at ? fmtDate(id.created_at, lang) : null },
    { label: t('adm.today.ctx.owner'), value: a.owner ? [a.owner.name, a.owner.email].filter(Boolean).join(' · ') : null },
    { label: t('adm.today.ctx.phone'), value: a.owner?.phone ?? null, mono: true },
    { label: t('adm.today.ctx.lastSale'), value: a.venue_overview?.revenue?.last_sale_at ? fmtRelative(a.venue_overview.revenue.last_sale_at, lang) : null },
    { label: t('adm.today.ctx.sold'), value: a.venue_overview?.revenue?.tickets ? fmtEur((a.venue_overview.revenue.tickets.gross ?? 0) + (a.venue_overview.revenue.tables?.gross ?? 0), lang, { cents: false }) : null },
  ].filter((f) => f.value) : [];

  return (
    <div className="flex flex-col gap-5 border-t pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Status tone={URGENCY_TONE[item.urgency]}>{t(`adm.today.u.${item.urgency}`)}</Status>
          <Badge>{t(`adm.today.fam.${item.family}`)}</Badge>
        </div>
        <h2 className="a-t1 text-[18px] font-semibold leading-snug tracking-[-0.01em]">{title(item)}</h2>
        {item.detail && <p className="a-t2 text-[13.5px] leading-relaxed">{item.detail}</p>}
        <p className="a-mono a-t3 text-[11px]">
          {item.due_at ? t('adm.today.due', { when: fmtDate(item.due_at, lang, 'datetime') }) : item.at ? t('adm.today.since', { when: fmtRelative(item.at, lang) }) : ''}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="a-kicker">{t('adm.today.ctx.why')}</span>
        <p className="a-t2 text-[13px] leading-relaxed">{t(`adm.today.why.${item.family}`)}</p>
      </div>

      {key && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline gap-2">
            <span className="a-kicker flex-1">{t('adm.today.ctx.account')}</span>
            <Link to={`/admin/pros/${encodeURIComponent(key)}`} className="a-t2 text-[12px] underline underline-offset-2">{t('adm.today.ctx.openAccount')}</Link>
          </div>
          {acc.isLoading ? <div className="flex flex-col gap-2"><div className="a-skel h-4 w-2/3" /><div className="a-skel h-4 w-1/2" /></div>
            : facts.length ? <KeyValue items={facts} /> : <p className="a-t3 text-[12.5px]">{t('adm.today.ctx.noFacts')}</p>}
        </div>
      )}

      {item.mark && (
        <p className="a-t3 text-[12.5px]">
          {item.mark.status === 'done' ? t('adm.today.markedDone', { when: fmtRelative(item.mark.at, lang) }) : t('adm.today.markedUntil', { when: fmtDate(item.mark.until, lang, 'datetime') })}
          {item.mark.reason ? ` · ${item.mark.reason}` : ''}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {external
          ? <a className="a-btn a-btn--primary" href={href} target="_blank" rel="noreferrer">{t(`adm.today.act.${item.family}`)}<ArrowUpRight className="h-3.5 w-3.5" /></a>
          : <Link className="a-btn a-btn--primary" to={href}>{t(`adm.today.act.${item.family}`)}<span className="a-kbd ml-1">↵</span></Link>}
        {item.mark ? (
          <button type="button" className="a-btn" disabled={mark.isPending} onClick={() => mark.mutate({ key: item.key, status: 'open' })}>
            <RotateCcw className="h-3.5 w-3.5" />{t('adm.today.reopen')}
          </button>
        ) : (
          <>
            <button type="button" className="a-btn" disabled={mark.isPending} onClick={() => mark.mutate({ key: item.key, status: 'done' })}>
              <Check className="h-3.5 w-3.5" />{t('adm.today.done')}<span className="a-kbd ml-1">e</span>
            </button>
            <button type="button" className="a-btn a-btn--ghost" disabled={mark.isPending} aria-expanded={later} onClick={() => setLater((v) => !v)}>
              <Clock className="h-3.5 w-3.5" />{t('adm.today.later')}<span className="a-kbd ml-1">l</span>
            </button>
          </>
        )}
      </div>
      {later && !item.mark && (
        <div className="flex flex-wrap gap-2">
          {[1, 3, 7].map((d) => (
            <button key={d} type="button" className="a-btn a-btn--sm" disabled={mark.isPending} onClick={() => mark.mutate({ key: item.key, status: 'snoozed', days: d })}>
              {t(`adm.today.later.${d}`)}
            </button>
          ))}
        </div>
      )}
      {mark.isError && <p role="alert" className="text-[12px]" style={{ color: 'var(--a-neg)' }}>{t('adm.today.markError')}</p>}
    </div>
  );
}
