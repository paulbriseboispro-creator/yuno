import { useMemo, useState } from 'react';
import { Loader2, Megaphone, Minus, Plus, X } from 'lucide-react';
import { OrgButton, OrgPill, DarkInput, RED, T1, T2, T3 } from '@/components/org-ui';
import {
  addGuest, daysToNight, guestErrorCode, guestErrorText, removeGuest, requestPlaces, salesSeries, whoSellsRows,
} from '@/lib/guestSpace';
import type { GuestTabProps } from './context';
import { Bar, Card, CardHead, ChartLegend, Kpi, KpiGrid, Label, Note, Row, SalesChart, SubTabs, Table } from './ui';

function useChart(p: GuestTabProps) {
  const { d } = p;
  return useMemo(() => {
    const tz = d.event?.timezone || 'Europe/Paris';
    const toNight = d.event ? daysToNight(d.event.start_at, tz) : 0;
    // De J-21 au jour J ; avant la soirée, les jours qui restent sont grisés.
    const points = salesSeries(d.series ?? [], d.series_before, 22);
    const todayIdx = d.phase === 'before' ? Math.max(0, Math.min(points.length - 1, points.length - 1 - toNight)) : points.length - 1;
    return { points, todayIdx };
  }, [d]);
}

/** Le graphique des ventes avec ses deux chiffres de tête. */
function SalesHero(p: GuestTabProps & { tall?: boolean }) {
  const { d, w, num, eur } = p;
  const { points, todayIdx } = useChart(p);
  const t = d.totals!;
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Label>{w('guestSpace.home.salesTitle')}</Label>
          <div className="mt-2 flex flex-wrap items-end gap-x-7 gap-y-2">
            <div>
              <div className="tabular-nums" style={{ color: T1, fontSize: 'clamp(30px,3.4vw,40px)', fontWeight: 750, letterSpacing: '-0.03em', lineHeight: 1 }}>{num(t.tickets.sold)}</div>
              <div style={{ color: T3, fontSize: 12 }}>{w('guestSpace.home.ticketsSold')}</div>
            </div>
            {t.revenue && (
              <div>
                <div className="tabular-nums" style={{ color: T1, fontSize: 'clamp(22px,2.4vw,28px)', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1 }}>{eur(t.revenue.total)}</div>
                <div style={{ color: T3, fontSize: 12 }}>{w('guestSpace.home.caHint')}</div>
              </div>
            )}
            {d.phase === 'before' && t.tickets.today > 0 && (
              <div className="pb-1" style={{ color: RED, fontSize: 12.5, fontWeight: 600 }}>{w('guestSpace.home.today', { n: num(t.tickets.today) })}</div>
            )}
          </div>
        </div>
        <ChartLegend w={w} />
      </div>
      <SalesChart points={points} todayIdx={todayIdx} phase={d.phase ?? 'before'} w={w} tall={p.tall} />
    </Card>
  );
}

export function WhoSells(p: GuestTabProps & { withRule?: boolean }) {
  const { d, w, num, eur } = p;
  const rows = whoSellsRows(d);
  const total = Math.max(1, rows.reduce((a, r) => a + r.tickets, 0));
  const org = d.event?.organizer_name ?? '';
  const label = (r: (typeof rows)[number]) => {
    if (r.kind === 'me') return { t: w('guestSpace.who.me', { name: r.name }), m: w('guestSpace.who.meHint') };
    if (r.kind === 'yuno') return { t: w('guestSpace.who.yuno'), m: w('guestSpace.who.yunoHint') };
    if (r.kind === 'direct') return { t: w('guestSpace.who.direct'), m: w('guestSpace.who.directHint') };
    if (r.kind === 'guest') return { t: r.name, m: w('guestSpace.who.guestHint') };
    return { t: r.name, m: w('guestSpace.who.partyHint') };
  };
  return (
    <div>
      {rows.map((r) => {
        const l = label(r);
        return (
          <Row key={r.key} title={l.t} meta={l.m} right={num(r.tickets)}>
            <Bar className="hidden w-28 sm:block" pct={(r.tickets / total) * 100} tone={r.kind === 'me' ? 'green' : r.kind === 'party' || r.kind === 'guest' ? 'red' : 'muted'} />
            {r.revenue !== null && d.money_visible && (
              <span className="hidden w-20 text-right tabular-nums sm:block" style={{ color: T3, fontSize: 12 }}>{eur(r.revenue)}</span>
            )}
          </Row>
        );
      })}
      {p.withRule && (
        <div className="mt-4"><Note>{w('guestSpace.who.rule', { org })}</Note></div>
      )}
    </div>
  );
}

// ─── Vue d'ensemble ────────────────────────────────────────────────────────

export function HomeTab(p: GuestTabProps) {
  const { d, w, num, eur, date, go } = p;
  const t = d.totals!;
  const after = d.phase === 'after';
  const nightStarted = d.phase === 'live' || after;
  const entered = t.entered.tickets + t.entered.tables + t.entered.guest_list;
  const org = d.event?.organizer_name ?? '';
  const share = d.money?.my_share;
  const contract = d.money?.mode === 'contract';
  return (
    <div className="space-y-4">
      <SalesHero {...p} />

      <Card>
        <CardHead
          title={w('guestSpace.home.where')}
          sub={after ? w('guestSpace.shell.over') : w('guestSpace.shell.updated', { time: date(d.now ?? new Date().toISOString(), { hour: '2-digit', minute: '2-digit' }) })}
          right={<OrgButton size="sm" onClick={() => go('sales')}>{w('guestSpace.home.detail')}</OrgButton>}
        />
        <KpiGrid>
          <Kpi label={w('guestSpace.kpi.tickets')} value={num(t.tickets.sold)}
            hint={t.tickets.capacity ? w('guestSpace.kpi.ticketsOf', { cap: num(t.tickets.capacity), n: num(t.tickets.on_sale) }) : w('guestSpace.kpi.ticketsOpen', { n: num(t.tickets.on_sale) })} />
          <Kpi label={w('guestSpace.kpi.tables')}
            value={<>{num(t.tables.booked)}{t.tables.capacity ? <span style={{ color: T3, fontSize: 15 }}> / {num(t.tables.capacity)}</span> : null}</>}
            hint={t.revenue ? w('guestSpace.kpi.tablesHint', { amount: eur(t.revenue.tables) }) : w('guestSpace.kpi.tablesGuests', { n: num(t.tables.guests) })} />
          <Kpi label={w('guestSpace.kpi.guestList')} value={num(t.guest_list.registered)}
            hint={t.guest_list.mine_places != null ? w('guestSpace.kpi.guestListMine', { n: num(t.guest_list.mine_registered) }) : undefined} />
          {nightStarted
            ? <Kpi label={w('guestSpace.kpi.entries')} value={num(entered)} hint={w('guestSpace.kpi.entriesOf', { n: num(t.expected) })} />
            : <Kpi label={w('guestSpace.kpi.expected')} value={num(t.expected)} hint={w('guestSpace.kpi.expectedHint')} />}
        </KpiGrid>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHead
            title={share ? w('guestSpace.home.myShare') : w('guestSpace.home.figures')}
            sub={!d.money_visible ? w('guestSpace.home.shareHidden', { org })
              : contract ? (d.money?.statement?.frozen ? w('guestSpace.home.shareFrozen') : w('guestSpace.home.shareLive'))
                : share ? w('guestSpace.home.shareDeclared', { org }) : w('guestSpace.home.shareExternal')}
            right={<OrgButton size="sm" onClick={() => go('money')}>{w('guestSpace.home.goMoney')}</OrgButton>}
          />
          {d.money_visible && share && share.amount != null ? (
            <>
              <div className="tabular-nums" style={{ color: T1, fontSize: 30, fontWeight: 750, letterSpacing: '-0.02em' }}>{eur(share.amount)}</div>
              <p style={{ color: T3, fontSize: 12.5, marginTop: 6 }}>
                {w('guestSpace.home.shareRule', { t: num(share.tickets_pct ?? 0), b: num(share.tables_pct ?? 0) })}
              </p>
              {after && contract && !d.money?.response && (
                <div className="mt-3"><Note tone="amber">{w('guestSpace.money.answerSub')}</Note></div>
              )}
            </>
          ) : d.money_visible && d.figures ? (
            <div>
              <Row title={w('guestSpace.money.row.tickets', { n: num(d.figures.tickets_count) })} right={eur(d.figures.tickets_gross)} />
              <Row title={w('guestSpace.money.row.tables', { n: num(d.figures.tables_count) })} right={eur(d.figures.tables_gross)} />
              <Row title={w('guestSpace.money.row.refunds')} right={d.figures.refunds > 0 ? eur(-d.figures.refunds) : eur(0)} />
            </div>
          ) : (
            <p style={{ color: T2, fontSize: 13 }}>{w('guestSpace.money.hidden', { org })}</p>
          )}
        </Card>
        <Card>
          <CardHead title={w('guestSpace.who.title')} sub={w('guestSpace.who.sub')} />
          <WhoSells {...p} />
        </Card>
      </div>
    </div>
  );
}

// ─── Ventes ────────────────────────────────────────────────────────────────

type SalesSub = 'tickets' | 'tables' | 'gl' | 'who';

export function SalesTab(p: GuestTabProps) {
  const { d, w } = p;
  const [sub, setSub] = useState<SalesSub>('tickets');
  const chart = useChart(p);
  return (
    <div className="space-y-4">
      <Card>
        <CardHead title={w('guestSpace.sales.evolution')} sub={w('guestSpace.sales.evolutionSub')} />
        <div className="-mt-2 mb-2"><ChartLegend w={w} /></div>
        <SalesChart points={chart.points} todayIdx={chart.todayIdx} phase={d.phase ?? 'before'} w={w} tall />
      </Card>
      <Card>
        <SubTabs<SalesSub> value={sub} onChange={setSub} tabs={[
          { value: 'tickets', label: w('guestSpace.sales.sub.tickets') },
          { value: 'tables', label: w('guestSpace.sales.sub.tables') },
          { value: 'gl', label: w('guestSpace.sales.sub.gl') },
          { value: 'who', label: w('guestSpace.sales.sub.who') },
        ]} />
        {sub === 'tickets' && <TicketsTable {...p} />}
        {sub === 'tables' && <TablesTable {...p} />}
        {sub === 'gl' && <GuestListPanel {...p} />}
        {sub === 'who' && (
          <>
            <WhoSells {...p} withRule />
            <div className="mt-3"><OrgButton size="sm" onClick={() => p.go('mkt')}><Megaphone className="h-3.5 w-3.5" /> {w('guestSpace.who.myLinks')}</OrgButton></div>
          </>
        )}
      </Card>
    </div>
  );
}

function statusPill(s: string, w: GuestTabProps['w']) {
  const label = w(`guestSpace.sales.status.${s}` as Parameters<typeof w>[0]);
  return <OrgPill tone={s === 'on_sale' ? 'success' : s === 'upcoming' ? 'warn' : 'muted'}>{label}</OrgPill>;
}

function TicketsTable({ d, w, num, eur }: GuestTabProps) {
  const lines = d.tickets ?? [];
  if (!lines.length) return <p style={{ color: T3, fontSize: 13 }}>{w('guestSpace.sales.noTickets')}</p>;
  const money = d.money_visible;
  const totalSold = lines.reduce((a, l) => a + l.sold, 0);
  const totalCa = lines.reduce((a, l) => a + (l.revenue ?? 0), 0);
  return (
    <Table
      head={[
        { label: w('guestSpace.sales.col.tier') }, { label: w('guestSpace.sales.col.price'), right: true },
        { label: w('guestSpace.sales.col.sold') }, ...(money ? [{ label: w('guestSpace.sales.col.ca'), right: true }] : []),
        { label: w('guestSpace.sales.col.status'), right: true },
      ]}
      rows={lines.map((l) => [
        l.name,
        l.price && Number(l.price) > 0 ? eur(Number(l.price)) : w('guestSpace.sales.free'),
        <div key="b" className="flex items-center gap-2.5">
          {l.capacity ? <Bar className="w-24" pct={(l.sold / l.capacity) * 100} tone={l.status === 'sold_out' ? 'muted' : 'red'} /> : null}
          <span className="tabular-nums">{num(l.sold)}{l.capacity ? ` / ${num(l.capacity)}` : ''}</span>
        </div>,
        ...(money ? [eur(l.revenue ?? 0)] : []),
        statusPill(l.status, w),
      ])}
      foot={[w('guestSpace.sales.total'), '', num(totalSold), ...(money ? [eur(totalCa)] : []), '']}
    />
  );
}

function TablesTable({ d, w, num, eur }: GuestTabProps) {
  const packs = d.tables ?? [];
  const org = d.event?.organizer_name ?? '';
  if (!packs.length) return <p style={{ color: T3, fontSize: 13 }}>{w('guestSpace.sales.noTables')}</p>;
  const money = d.money_visible;
  return (
    <>
      <Table
        head={[
          { label: w('guestSpace.sales.col.pack') }, { label: w('guestSpace.sales.col.price'), right: true },
          { label: w('guestSpace.sales.col.booked') }, ...(money ? [{ label: w('guestSpace.sales.col.ca'), right: true }] : []),
        ]}
        rows={packs.map((pk) => [
          pk.name,
          pk.price != null ? eur(Number(pk.price)) : '—',
          <div key="b" className="flex items-center gap-2.5">
            {pk.capacity ? <Bar className="w-24" pct={(pk.sold / pk.capacity) * 100} /> : null}
            <span className="tabular-nums">{num(pk.sold)}{pk.capacity ? ` / ${num(pk.capacity)}` : ''} · {w('guestSpace.kpi.tablesGuests', { n: num(pk.guests) })}</span>
          </div>,
          ...(money ? [eur(pk.revenue ?? 0)] : []),
        ])}
      />
      <p className="mt-3" style={{ color: T3, fontSize: 12.5 }}>{w('guestSpace.sales.tablesNote', { org })}</p>
    </>
  );
}

function GuestListPanel(p: GuestTabProps) {
  const { d, w, num, token, reload, toast } = p;
  const org = d.event?.organizer_name ?? '';
  const t = d.totals!.guest_list;
  const [name, setName] = useState('');
  const [plus, setPlus] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [ask, setAsk] = useState(10);
  const hasShare = t.mine_places != null && t.mine_places > 0;
  const left = hasShare ? Math.max(0, (t.mine_places ?? 0) - t.mine_registered) : 0;
  const closed = d.phase === 'after' || d.phase === 'cancelled';

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) toast(ok);
      await reload();
    } catch (err) {
      toast(guestErrorText(guestErrorCode(err), w), 'err');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <Note>{hasShare ? w('guestSpace.gl.myShare', { org, n: num(t.mine_places ?? 0) }) : w('guestSpace.gl.noShare', { org })}</Note>
      <div>
        {(d.guest_list_parts ?? []).map((g, i) => (
          <Row key={i}
            title={g.mine ? w('guestSpace.gl.partMine', { name: g.name ?? '' }) : w('guestSpace.gl.part', { name: g.name ?? '' })}
            meta={[
              g.places ? w('guestSpace.gl.partLine', { n: num(g.registered), cap: num(g.places) }) : w('guestSpace.gl.partLineOpen', { n: num(g.registered) }),
              d.phase !== 'before' ? w('guestSpace.gl.partEntered', { n: num(g.entered) }) : null,
            ].filter(Boolean).join(' · ')}>
            {g.places ? <Bar className="w-24" pct={(g.registered / g.places) * 100} tone={g.mine ? 'green' : 'red'} /> : null}
          </Row>
        ))}
      </div>

      {hasShare && (
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <Label>{w('guestSpace.gl.myGuests')}</Label>
            <span style={{ color: T3, fontSize: 12 }}>{w('guestSpace.gl.left', { n: num(left) })}</span>
          </div>
          {!closed && (
            <form className="flex flex-wrap gap-2" onSubmit={(e) => {
              e.preventDefault();
              if (name.trim().length < 2) return;
              void run('add', async () => { await addGuest(token, name.trim(), plus); setName(''); setPlus(0); }, w('guestSpace.gl.added'));
            }}>
              <div className="min-w-[180px] flex-1"><DarkInput value={name} onChange={setName} placeholder={w('guestSpace.gl.namePh')} /></div>
              <div className="flex items-center gap-1 rounded-xl px-1.5" style={{ border: '1px solid rgb(var(--ink)/0.085)' }} aria-label={w('guestSpace.gl.plusPh')}>
                <button type="button" className="p-1.5" style={{ color: T2 }} onClick={() => setPlus((n) => Math.max(0, n - 1))} aria-label="−"><Minus className="h-3.5 w-3.5" /></button>
                <span className="w-10 text-center tabular-nums" style={{ color: T1, fontSize: 13 }}>+{plus}</span>
                <button type="button" className="p-1.5" style={{ color: T2 }} onClick={() => setPlus((n) => Math.min(9, n + 1))} aria-label="+"><Plus className="h-3.5 w-3.5" /></button>
              </div>
              <OrgButton type="submit" variant="primary" disabled={busy === 'add' || name.trim().length < 2 || left < 1 + plus}>
                {busy === 'add' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{w('guestSpace.gl.add')}
              </OrgButton>
            </form>
          )}
          <div className="mt-2">
            {(d.my_guests ?? []).map((g) => (
              <Row key={g.id} title={g.name} right={g.entered ? <OrgPill tone="success">{w('guestSpace.gl.entered')}</OrgPill> : (!closed ? (
                <button type="button" disabled={!!busy} onClick={() => void run(`rm:${g.id}`, () => removeGuest(token, g.id))}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1" style={{ color: T3, fontSize: 12 }}>
                  <X className="h-3.5 w-3.5" /> {w('guestSpace.gl.remove')}
                </button>
              ) : null)} />
            ))}
          </div>
        </div>
      )}

      {!closed && (
        d.guest?.places_requested ? (
          <Note tone="green">{w('guestSpace.gl.asked', { n: num(d.guest.places_requested) })}</Note>
        ) : askOpen ? (
          <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => {
            e.preventDefault();
            void run('ask', async () => { await requestPlaces(token, ask); setAskOpen(false); }, w('guestSpace.gl.asked', { n: num(ask) }));
          }}>
            <span style={{ color: T2, fontSize: 13 }}>{w('guestSpace.gl.askN')}</span>
            <div className="w-24"><DarkInput type="number" inputMode="numeric" value={String(ask)} onChange={(v) => setAsk(Math.max(1, Math.min(200, Number(v) || 1)))} /></div>
            <OrgButton type="submit" variant="primary" size="sm" disabled={busy === 'ask'}>{w('guestSpace.gl.askSend')}</OrgButton>
          </form>
        ) : (
          <OrgButton size="sm" onClick={() => setAskOpen(true)}>{w('guestSpace.gl.ask', { org })}</OrgButton>
        )
      )}
    </div>
  );
}
