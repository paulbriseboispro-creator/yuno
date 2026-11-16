/** Fiche d'un pro : onglets Vue d'ensemble, Ventes, Soirées. */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, Phone } from 'lucide-react';
import { Card, Chart, DataTable, EmptyState, Grid, Kpi, KpiRow, KeyValue, Section, Status, Badge, useAdminT, type ColumnDef } from '@/admin/ui';
import { fmtDate, fmtEur, fmtNum, fmtRelative } from '@/lib/adminFormat';
import type { AccountCard, EventRow } from '../data';
import { YesNo } from '../bits';
import { phoneLinks } from '../accounts';

export function OverviewTab({ card, onTab }: { card: AccountCard; onTab: (v: string) => void }) {
  const { t, lang } = useAdminT();
  const row = card.row;
  const id = card.identity;
  const o = card.owner;
  const phone = phoneLinks(o?.phone);
  const pinned = card.notes.filter((n) => n.pinned);
  const stripe = id.stripe;

  return (
    <div className="flex flex-col gap-6">
      {row && (
        <KpiRow>
          <Kpi label={t('adm.pros.k.sales30')} value={fmtNum(row.sales_30d, lang)} to="?tab=sales" />
          {row.revenue_total != null && <Kpi label={t('adm.pros.k.rev30')} value={fmtEur(row.revenue_period, lang, { cents: false })} current={row.revenue_period} previous={row.revenue_prev} to="?tab=sales" hint={t('adm.pros.k.revHint')} />}
          {row.revenue_total != null && <Kpi label={t('adm.pros.k.revTotal')} value={fmtEur(row.revenue_total, lang, { cents: false })} to="?tab=sales" hint={t('adm.pros.k.revHint')} />}
          <Kpi label={t('adm.pros.k.upcoming')} value={fmtNum(row.upcoming, lang)} to="?tab=events" />
          {row.crm && <Kpi label={t('adm.pros.k.crmHealth')} value={`${row.crm.health}/100`} to="?tab=crm" hint={t('adm.pros.k.crmHealthHint')} />}
        </KpiRow>
      )}

      {pinned.length > 0 && (
        <div className="a-card flex flex-col gap-1 p-4" style={{ borderColor: 'var(--a-warn)' }}>
          {pinned.map((n) => <p key={n.id} className="a-t1 whitespace-pre-wrap text-[13px]">{n.body}</p>)}
          <button type="button" className="a-t3 self-start border-0 bg-transparent p-0 text-[12px] underline" onClick={() => onTab('journal')}>{t('adm.pros.card.allNotes')}</button>
        </div>
      )}

      <Grid cols={2}>
        <Card title={t('adm.pros.card.owner')}>
          {o ? (
            <>
              <KeyValue items={[
                { label: t('adm.pros.f.name'), value: o.name ?? '—' },
                { label: t('adm.pros.f.email'), value: o.email ? <a className="hover:underline" href={`mailto:${o.email}`}>{o.email}</a> : '—' },
                { label: t('adm.pros.f.phone'), value: o.phone ?? '—' },
                { label: t('adm.pros.f.lastLogin'), value: o.last_login ? fmtRelative(o.last_login, lang) : t('adm.pros.never') },
                { label: t('adm.pros.f.mfa'), value: <Status tone={o.mfa ? 'positive' : 'warning'}>{t(o.mfa ? 'adm.pros.f.mfaOn' : 'adm.pros.f.mfaOff')}</Status> },
                ...(o.suspended ? [{ label: t('adm.pros.f.suspended'), value: <Badge tone="negative">{t('adm.pros.yes')}</Badge> }] : []),
              ]} />
              {(phone || o.email) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {phone && <a className="a-btn a-btn--sm" href={phone.wa} target="_blank" rel="noreferrer"><MessageCircle className="h-3.5 w-3.5" />WhatsApp</a>}
                  {phone && <a className="a-btn a-btn--sm" href={phone.tel}><Phone className="h-3.5 w-3.5" />{t('adm.pros.call')}</a>}
                </div>
              )}
            </>
          ) : <EmptyState title={t('adm.pros.card.noOwner')} body={t('adm.pros.card.noOwnerBody')} />}
        </Card>

        <Card title={t('adm.pros.card.account')}>
          <KeyValue items={[
            { label: t('adm.pros.f.created'), value: id.created_at ? fmtDate(String(id.created_at), lang, 'long') : '—' },
            { label: 'Stripe', value: stripe ? <Status tone={stripe.charges ? 'positive' : stripe.account ? 'warning' : 'neutral'}>{t(stripe.charges ? 'adm.pros.stripe.ready' : stripe.account ? 'adm.pros.stripe.pending' : 'adm.pros.stripe.no')}</Status> : '—' },
            ...(stripe?.account ? [{ label: t('adm.pros.f.payouts'), value: <YesNo v={stripe.payouts} /> }] : []),
            ...(card.kind === 'venue' ? [
              { label: t('adm.pros.f.visible'), value: id.decommissioned_at ? <Badge tone="negative">{t('adm.pros.f.decommissioned', { date: fmtDate(String(id.purge_at ?? id.decommissioned_at), lang) })}</Badge> : <YesNo v={!id.is_hidden} /> },
              { label: t('adm.pros.f.address'), value: id.address ? String(id.address) : '—' },
            ] : []),
            ...(card.kind === 'org' ? [{ label: t('adm.pros.type.association'), value: <YesNo v={!!id.association} /> }] : []),
            ...(card.kind === 'agency' ? [
              { label: t('adm.pros.f.active'), value: <YesNo v={id.is_active !== false} /> },
              { label: t('adm.pros.f.promoters'), value: fmtNum(Number(id.promoters ?? 0), lang) },
            ] : []),
            { label: t('adm.pros.f.lastSeen'), value: row?.last_seen ? fmtRelative(row.last_seen, lang) : t('adm.pros.never') },
            ...(card.tags.length ? [{ label: t('adm.pros.f.tags'), value: <span className="flex flex-wrap gap-1">{card.tags.map((x) => <Badge key={x}>{x}</Badge>)}</span> }] : []),
          ]} />
        </Card>
      </Grid>

      {(card.collabs.length > 0 || card.cohosts.length > 0) && (
        <Section title={t('adm.pros.card.collabs')}>
          <div className="a-card divide-y">
            {card.collabs.map((c) => (
              <div key={`c${c.event_id}`} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                <span className="a-t1 min-w-0 flex-1 truncate">{c.title}</span>
                <span className="a-t2">{c.with ?? '—'}</span>
                <Badge tone={c.status === 'pending_signatures' ? 'warning' : 'positive'}>{t(`adm.pros.collab.${c.status}`)}</Badge>
                <span className="a-t3 a-num w-24 text-right">{fmtDate(c.start_at, lang)}</span>
              </div>
            ))}
            {card.cohosts.map((c) => (
              <div key={`h${c.event_id}`} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                <span className="a-t1 min-w-0 flex-1 truncate">{c.title}</span>
                <Badge>{t(c.role === 'principal' ? 'adm.pros.collab.principal' : 'adm.pros.collab.cohost')}</Badge>
                <span className="a-t3 a-num w-24 text-right">{fmtDate(c.start_at, lang)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title={t('adm.pros.card.products')}>
        <div className="a-card p-4">
          {card.products_history.length === 0
            ? <p className="a-t3 text-[13px]">{t('adm.pros.card.noProductHistory')}</p>
            : (
              <ul className="flex flex-col gap-1.5">
                {card.products_history.map((e, i) => (
                  <li key={i} className="a-t2 flex flex-wrap gap-2 text-[13px]">
                    <span className="a-num a-t3 w-24">{fmtDate(e.at, lang)}</span>
                    <span className="a-t1">{t(`adm.pros.product.${e.product === 'crm' ? 'crm' : 'tickets'}`)}</span>
                    <span>{t(`adm.pros.pa.${e.action}`)}</span>
                    {e.email && <span className="a-t3">· {e.email}</span>}
                  </li>
                ))}
              </ul>
            )}
        </div>
      </Section>
    </div>
  );
}

export function SalesTab({ card }: { card: AccountCard }) {
  const { t, lang } = useAdminT();
  const monthFmt = useMemo(() => new Intl.DateTimeFormat(lang, { month: 'short', year: '2-digit' }), [lang]);
  const data = useMemo(() => (card.monthly ?? []).map((m) => ({ ...m, label: monthFmt.format(new Date(`${m.month}-01T12:00:00`)) })), [card.monthly, monthFmt]);
  if (card.kind === 'agency') {
    return <div className="a-card"><EmptyState title={t('adm.pros.sales.agency')} body={t('adm.pros.sales.agencyBody', { n: card.row?.sales_total ?? 0 })} /></div>;
  }
  const ov = card.venue_overview?.revenue;
  const sum = (k: 'tickets' | 'tables' | 'guestlist' | 'tickets_rev' | 'tables_rev') => (card.monthly ?? []).reduce((s, m) => s + Number(m[k] || 0), 0);
  return (
    <div className="flex flex-col gap-6">
      <KpiRow>
        <Kpi label={t('adm.pros.sales.tickets12')} value={fmtNum(sum('tickets'), lang)} />
        <Kpi label={t('adm.pros.sales.tables12')} value={fmtNum(sum('tables'), lang)} />
        <Kpi label={t('adm.pros.sales.gl12')} value={fmtNum(sum('guestlist'), lang)} hint={t('adm.pros.sales.glHint')} />
        <Kpi label={t('adm.pros.sales.rev12')} value={fmtEur(sum('tickets_rev') + sum('tables_rev'), lang, { cents: false })} hint={t('adm.pros.k.revHint')} />
        {ov && <Kpi label={t('adm.pros.k.revTotal')} value={fmtEur(Number(ov.tickets?.gross ?? 0) + Number(ov.tables?.gross ?? 0), lang, { cents: false })} hint={t('adm.pros.k.revHint')} />}
      </KpiRow>
      <Grid cols={2}>
        <Card title={t('adm.pros.sales.revChart')}>
          <Chart kind="stacked" data={data} x="label" unit="eur"
            series={[{ key: 'tickets_rev', label: t('adm.pros.pillar.tickets') }, { key: 'tables_rev', label: t('adm.pros.pillar.tables') }]} />
        </Card>
        <Card title={t('adm.pros.sales.countChart')}>
          <Chart kind="stacked" data={data} x="label" unit="count"
            series={[{ key: 'tickets', label: t('adm.pros.pillar.tickets') }, { key: 'tables', label: t('adm.pros.pillar.tables') }, { key: 'guestlist', label: t('adm.pros.pillar.guestlist') }]} />
        </Card>
      </Grid>
      <p className="a-t3 text-[12.5px]">{t('adm.pros.sales.note')}</p>
    </div>
  );
}

export function EventsTab({ card }: { card: AccountCard }) {
  const { t, lang } = useAdminT();
  const now = Date.now();
  const columns = useMemo<ColumnDef<EventRow, unknown>[]>(() => [
    {
      id: 'title', header: t('adm.pros.ev.title'), accessorKey: 'title',
      cell: ({ row: { original: e } }) => (
        <span className="flex items-center gap-2">
          <Link className="a-t1 truncate font-medium hover:underline" to={`/admin/clients/events?q=${encodeURIComponent(e.id)}`} onClick={(ev) => ev.stopPropagation()}>{e.title}</Link>
          {e.role === 'partner' && <Badge>{t('adm.pros.ev.partner')}</Badge>}
          {e.cancelled && <Badge tone="negative">{t('adm.pros.ev.cancelled')}</Badge>}
          {!e.cancelled && new Date(e.start_at).getTime() > now && <Badge tone="accent">{t('adm.pros.ev.upcoming')}</Badge>}
        </span>
      ),
    },
    { id: 'date', header: t('adm.pros.ev.date'), accessorFn: (e) => new Date(e.start_at).getTime(), cell: ({ row: { original: e } }) => <span className="a-num whitespace-nowrap">{fmtDate(e.start_at, lang, 'datetime')}</span> },
    { id: 'tickets', header: t('adm.pros.pillar.tickets'), accessorKey: 'tickets', meta: { align: 'right' }, cell: ({ row: { original: e } }) => fmtNum(e.tickets, lang) },
    { id: 'tables', header: t('adm.pros.pillar.tables'), accessorKey: 'tables', meta: { align: 'right' }, cell: ({ row: { original: e } }) => fmtNum(e.tables, lang) },
    { id: 'gl', header: t('adm.pros.pillar.guestlist'), accessorKey: 'guestlist', meta: { align: 'right' }, cell: ({ row: { original: e } }) => fmtNum(e.guestlist, lang) },
    { id: 'rev', header: t('adm.pros.ev.revenue'), accessorKey: 'revenue', meta: { align: 'right' }, cell: ({ row: { original: e } }) => fmtEur(e.revenue, lang, { cents: false }) },
  ], [t, lang, now]);
  if (card.kind === 'agency') return <div className="a-card"><EmptyState title={t('adm.pros.ev.agency')} /></div>;
  return (
    <DataTable data={card.events} columns={columns} initialSort={[{ id: 'date', desc: true }]} getRowId={(e) => e.id}
      empty={{ title: t('adm.pros.ev.empty') }} />
  );
}
