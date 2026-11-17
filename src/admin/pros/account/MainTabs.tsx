/**
 * Fiche d'un pro (v3) : l'onglet « Fiche » (ce que ce compte vend, ses nuits,
 * sa frise, ses faits), l'onglet Ventes et l'onglet Soirées.
 *   Colonne principale : la phrase du compte ; la courbe du CA club sur 12 mois
 *   en héros (pic annoté) ; le calendrier des nuits (une case par soirée, teinte
 *   = places vendues) ; la frise du compte, colonne vertébrale (inscription,
 *   produits, première vente, soirées, envois, accès assisté, gestes de
 *   l'admin, notes, retours, acceptations légales).
 *   Rail : titulaire, compte, équipe, légal en liste clé / valeur, note épinglée.
 * Données : admin_account seulement, rien de recalculé.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, MessageCircle, Phone } from 'lucide-react';
import { Badge, Block, CalendarHeat, Chart, DataTable, EmptyState, Hero, HeroChart, HoverSync, StatStrip, Status, cellTint, useAdminT, type ColumnDef, type Stat as StripStat, KeyValue, Spine, type SpineItem } from '@/admin/ui';
import { fmtCompact, fmtDate, fmtEur, fmtNum, fmtRelative } from '@/lib/adminFormat';
import type { AccountCard, EventRow } from '../data';
import { YesNo } from '../bits';
import { phoneLinks } from '../accounts';
import { accountStory, firstSaleMonth, monthlySeries, nightsByDay } from '../story';
import { AccountSentence } from './Sentence';

const FAMILY_COLOR: Record<string, string> = {
  firstSale: 'var(--a-pos)', night: 'var(--a-text-2)', signup: 'var(--a-text)', support: 'var(--a-text-2)',
  incident: 'var(--a-warn)', note: 'var(--a-text-3)', admin: 'var(--a-text-3)',
};

function useMonthFmt() {
  const { lang } = useAdminT();
  return useMemo(() => {
    const f = new Intl.DateTimeFormat(lang, { month: 'short', year: '2-digit' });
    return (m: string) => f.format(new Date(`${m.slice(0, 7)}-15T12:00:00Z`));
  }, [lang]);
}

function weekdayInitials(lang: string): string[] {
  const f = new Intl.DateTimeFormat(lang, { weekday: 'narrow' });
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(2024, 0, 1 + i, 12))));
}

/** Les morceaux de la frise, du plus récent au plus ancien. */
function useSpineItems(card: AccountCard): SpineItem[] {
  const { t, lang, label } = useAdminT();
  return useMemo(() => {
    const out: SpineItem[] = [];
    const id = card.identity;
    if (id.created_at) out.push({ id: 'created', at: String(id.created_at), family: 'signup', strong: true, title: t('adm.pros.v3.f.created') });
    if (card.owner?.created_at && card.owner.created_at !== id.created_at) out.push({ id: 'owner', at: card.owner.created_at, family: 'signup', title: t('adm.pros.v3.f.owner', { name: card.owner.name ?? card.owner.email ?? '' }) });
    card.products_history.forEach((e, i) => out.push({ id: `p${i}`, at: e.at, family: 'product',
      title: <>{t(`adm.pros.product.${e.product === 'crm' ? 'crm' : 'tickets'}`)} · {t(`adm.pros.pa.${e.action}`)}</>, body: e.email ?? undefined }));
    const first = firstSaleMonth(card.monthly);
    if (first) out.push({ id: 'first', at: `${first}-01T12:00:00Z`, family: 'firstSale', strong: true, title: t('adm.pros.v3.f.firstSale') });
    for (const e of card.events) {
      const sold = Number(e.tickets || 0) + Number(e.tables || 0);
      out.push({ id: `e${e.id}`, at: e.start_at, family: 'night', strong: !e.cancelled && sold > 0,
        title: <>{e.title}{e.role === 'partner' ? <span className="a-t3"> · {t('adm.pros.ev.partner')}</span> : null}{e.cancelled ? <span className="a-t3"> · {t('adm.pros.ev.cancelled')}</span> : null}</>,
        body: e.cancelled ? undefined : t('adm.pros.v3.f.nightBody', { tickets: fmtNum(e.tickets, lang), tables: fmtNum(e.tables, lang), gl: fmtNum(e.guestlist, lang) }),
        value: e.revenue > 0 ? fmtEur(e.revenue, lang, { cents: false }) : undefined });
    }
    (card.crm?.sends ?? []).forEach((s, i) => out.push({ id: `s${i}`, at: s.at, family: 'send', title: s.name,
      body: s.recipients != null ? t('adm.pros.v3.f.sendBody', { n: fmtNum(s.recipients, lang) }) : undefined }));
    card.support.grants.forEach((g) => out.push({ id: `g${g.id}`, at: g.created_at, family: 'support',
      title: t(`adm.pros.v3.f.grant.${g.revoked_at ? 'revoked' : g.status === 'active' ? 'active' : 'pending'}`), body: g.reason ?? undefined }));
    card.support.sessions.forEach((s) => out.push({ id: `ss${s.id}`, at: s.created_at, family: 'support', title: t('adm.pros.v3.f.session', { who: s.admin ?? 'Yuno' }) }));
    card.audit.forEach((a, i) => out.push({ id: `a${i}`, at: a.at, family: 'admin', title: label(a.action), body: a.admin ?? undefined }));
    card.notes.forEach((n) => out.push({ id: `n${n.id}`, at: n.at, family: 'note', title: <span className="whitespace-pre-wrap">{n.body}</span>, body: n.author ?? undefined }));
    card.feedback.forEach((f) => out.push({ id: `fb${f.id}`, at: f.at, family: 'feedback', title: f.title }));
    card.requests.forEach((r) => out.push({ id: `rq${r.id}`, at: r.at, family: 'request', title: <span className="line-clamp-2">{r.body}</span> }));
    card.nps.forEach((n, i) => out.push({ id: `nps${i}`, at: n.at, family: 'nps', title: t('adm.pros.v3.f.nps', { n: n.score }), body: n.comment ?? undefined }));
    card.legal_acceptances.forEach((a, i) => out.push({ id: `l${i}`, at: a.at, family: 'legal', title: t('adm.pros.v3.f.legalAccepted', { doc: label(a.doc), d: /^\d{4}-\d{2}-\d{2}$/.test(String(a.version)) ? fmtDate(String(a.version), lang) : String(a.version) }) }));
    (card.sending?.incidents ?? []).forEach((x, i) => out.push({ id: `x${i}`, at: x.at, family: 'incident', title: label(x.kind) }));
    return out;
  }, [card, t, lang, label]);
}

export function OverviewTab({ card, onTab }: { card: AccountCard; onTab: (v: string) => void }) {
  const { t, lang } = useAdminT();
  const monthFmt = useMonthFmt();
  const row = card.row;
  const story = accountStory(card);
  const series = useMemo(() => monthlySeries(card.monthly), [card.monthly]);
  const total12 = series.reduce((s, m) => s + m.revenue, 0);
  const sales12 = series.reduce((s, m) => s + m.sales, 0);
  const points = series.map((m) => ({ x: m.month, v: m.revenue }));
  const [more, setMore] = useState(false);
  const spine = useSpineItems(card);
  const agency = card.kind === 'agency';

  const calendar = useMemo(() => {
    const to = new Date();
    const last = card.events.reduce((mx, e) => Math.max(mx, new Date(e.start_at).getTime()), 0);
    if (last > to.getTime()) to.setTime(Math.min(last, Date.now() + 120 * 864e5));
    const from = new Date(Date.UTC(new Date().getUTCFullYear() - 1, new Date().getUTCMonth(), new Date().getUTCDate()));
    return nightsByDay(card.events, from, to);
  }, [card.events]);
  const nights = calendar.filter((d) => d.v > 0).length;
  const nightCount = card.events.filter((e) => !e.cancelled && new Date(e.start_at).getTime() >= Date.now() - 365 * 864e5).length;

  return (
    <div className="grid grid-cols-1 gap-x-12 gap-y-10 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-10">
        {agency ? (
          <Block title={t('adm.pros.v3.agencyTitle')}>
            <AccountSentence story={story} row={row} />
            <p className="a-t3 text-[13px]">{t('adm.pros.sales.agencyBody', { n: row?.sales_total ?? 0 })}</p>
          </Block>
        ) : (
          <HoverSync>
            <Hero kicker={t('adm.pros.v3.heroKicker')} value={fmtEur(total12, lang, { cents: false })}
              sentence={<AccountSentence story={story} row={row} className="a-hero-sentence" />}
              chart={total12 === 0 && sales12 === 0
                ? <p className="a-t3 border-y py-6 text-center text-[13px]">{t('adm.pros.v3.noSales12')}</p>
                : <HeroChart data={points} formatX={monthFmt} formatV={(v) => fmtEur(v, lang, { cents: false })}
                    formatTick={(v) => (v >= 1000 ? `${fmtCompact(v, lang)} €` : `${fmtNum(v, lang)} €`)} height={200}
                    labels={{ cur: t('adm.pros.v3.revLabel'), peak: t('adm.pil.v3.peak') }} />}
              note={t('adm.pros.v3.heroNote', { n: fmtNum(sales12, lang) })} />
          </HoverSync>
        )}

        {!agency && (
          <Block title={t('adm.pros.v3.nightsTitle')} meta={t('adm.pros.v3.nightsMeta', { n: fmtNum(nightCount, lang) })}>
            {nightCount === 0 ? <p className="a-t3 text-[13px]">{t('adm.pros.v3.noNights')}</p> : (
              <div className="flex flex-col gap-2">
                <CalendarHeat days={calendar} weekdays={weekdayInitials(lang)}
                  fmt={(d, v) => `${fmtDate(`${d}T12:00:00Z`, lang)} · ${v > 0 ? t('adm.pros.v3.placesN', { n: fmtNum(v, lang) }) : t('adm.pros.v3.noNight')}`} />
                <p className="a-t3 text-[12px]">{t('adm.pros.v3.nightsNote', { n: fmtNum(nights, lang) })}</p>
              </div>
            )}
          </Block>
        )}

        <Block title={t('adm.pros.v3.spineTitle')} meta={t('adm.pros.v3.spineMeta', { n: fmtNum(spine.length, lang) })}>
          <Spine items={spine} limit={more ? undefined : 40} onMore={() => setMore(true)}
            familyLabel={(f) => t(`adm.pros.v3.fam.${f}`)} familyColor={(f) => FAMILY_COLOR[f] ?? 'var(--a-text-3)'}
            empty={t('adm.pros.v3.spineEmpty')} />
        </Block>
      </div>

      <AccountRail card={card} onTab={onTab} />
    </div>
  );
}

function AccountRail({ card, onTab }: { card: AccountCard; onTab: (v: string) => void }) {
  const { t, lang } = useAdminT();
  const id = card.identity;
  const o = card.owner;
  const row = card.row;
  const phone = phoneLinks(o?.phone);
  const stripe = id.stripe;
  const pinned = card.notes.filter((n) => n.pinned);
  const legal = card.legal;
  const name = encodeURIComponent(String(id.name ?? ''));
  return (
    <aside className="flex min-w-0 flex-col gap-7 xl:sticky xl:top-[64px] xl:self-start xl:border-l xl:pl-8">
      {pinned.length > 0 && (
        <div className="flex flex-col gap-1.5 border-l-2 pl-3" style={{ borderColor: 'var(--a-warn)' }}>
          <span className="a-kicker">{t('adm.pros.v3.pinned')}</span>
          {pinned.map((n) => <p key={n.id} className="a-t1 whitespace-pre-wrap text-[13px] leading-relaxed">{n.body}</p>)}
          <button type="button" className="a-t3 self-start border-0 bg-transparent p-0 text-[12px] underline" onClick={() => onTab('journal')}>{t('adm.pros.card.allNotes')}</button>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <KeyValue hideEmpty title={t('adm.pros.card.owner')} items={o ? [
          { label: t('adm.pros.f.name'), value: o.name },
          { label: t('adm.pros.f.email'), value: o.email ? <a className="hover:underline" href={`mailto:${o.email}`}>{o.email}</a> : null },
          { label: t('adm.pros.f.phone'), value: o.phone, mono: true },
          { label: t('adm.pros.f.lastLogin'), value: o.last_login ? fmtRelative(o.last_login, lang) : t('adm.pros.never') },
          { label: t('adm.pros.f.mfa'), value: <Status tone={o.mfa ? 'positive' : 'warning'}>{t(o.mfa ? 'adm.pros.f.mfaOn' : 'adm.pros.f.mfaOff')}</Status> },
          { label: t('adm.pros.f.suspended'), value: o.suspended ? <Badge tone="negative">{t('adm.pros.yes')}</Badge> : null },
        ] : [{ label: t('adm.pros.card.owner'), value: t('adm.pros.card.noOwner') }]} />
        {phone && (
          <div className="flex flex-wrap gap-2">
            <a className="a-btn a-btn--sm" href={phone.wa} target="_blank" rel="noreferrer"><MessageCircle className="h-3.5 w-3.5" />WhatsApp</a>
            <a className="a-btn a-btn--sm" href={phone.tel}><Phone className="h-3.5 w-3.5" />{t('adm.pros.call')}</a>
          </div>
        )}
      </div>

      <KeyValue hideEmpty title={t('adm.pros.card.account')} items={[
        { label: t('adm.pros.f.created'), value: id.created_at ? fmtDate(String(id.created_at), lang) : null },
        { label: 'Stripe', value: stripe ? <Status tone={stripe.charges ? 'positive' : stripe.account ? 'warning' : 'neutral'}>{t(stripe.charges ? 'adm.pros.stripe.ready' : stripe.account ? 'adm.pros.stripe.pending' : 'adm.pros.stripe.no')}</Status> : null },
        { label: t('adm.pros.f.payouts'), value: stripe?.account ? <YesNo v={stripe.payouts} /> : null },
        { label: t('adm.pros.f.visible'), value: card.kind === 'venue' ? (id.decommissioned_at ? <Badge tone="negative">{t('adm.pros.f.decommissioned', { date: fmtDate(String(id.purge_at ?? id.decommissioned_at), lang) })}</Badge> : <YesNo v={!id.is_hidden} />) : null },
        { label: t('adm.pros.f.address'), value: card.kind === 'venue' && id.address ? String(id.address) : null },
        { label: t('adm.pros.type.association'), value: card.kind === 'org' && id.association ? <YesNo v /> : null },
        { label: t('adm.pros.f.active'), value: card.kind === 'agency' ? <YesNo v={id.is_active !== false} /> : null },
        { label: t('adm.pros.f.lastSeen'), value: row?.last_seen ? fmtRelative(row.last_seen, lang) : t('adm.pros.never') },
        { label: t('adm.pros.f.tags'), value: card.tags.length ? <span className="flex flex-wrap gap-1">{card.tags.map((x) => <Badge key={x}>{x}</Badge>)}</span> : null },
      ]} />

      <KeyValue hideEmpty title={t('adm.pros.tab.team')} items={[
        { label: t('adm.pros.v3.teamSize'), value: <button type="button" className="a-t1 border-0 bg-transparent p-0 underline-offset-2 hover:underline" onClick={() => onTab('team')}>{fmtNum(card.team.length + (o ? 1 : 0), lang)}</button> },
        ...card.team.slice(0, 4).map((m) => ({ label: m.role, value: m.name ?? m.email })),
      ]} />

      {legal && (
        <KeyValue hideEmpty title={t('adm.pros.sl.legal')} items={[
          { label: t('adm.pros.sl.legalName'), value: legal.legal_name },
          { label: 'SIRET', value: legal.siret, mono: true },
          { label: t('adm.pros.sl.vat'), value: legal.vat_number, mono: true },
          { label: 'RNA', value: legal.rna_number, mono: true },
        ]} />
      )}

      {(card.collabs.length > 0 || card.cohosts.length > 0) && (
        <section className="flex flex-col gap-1">
          <h3 className="a-kicker mb-1">{t('adm.pros.card.collabs')}</h3>
          {card.collabs.map((c) => (
            <div key={`c${c.event_id}`} className="flex items-baseline gap-2 py-1 text-[12.5px]">
              <span className="a-t1 min-w-0 flex-1 truncate">{c.title}</span>
              <span className="a-mono a-t3 text-[11px]">{fmtDate(c.start_at, lang)}</span>
            </div>
          ))}
          {card.cohosts.map((c) => (
            <div key={`h${c.event_id}`} className="flex items-baseline gap-2 py-1 text-[12.5px]">
              <span className="a-t1 min-w-0 flex-1 truncate">{c.title}</span>
              <span className="a-mono a-t3 text-[11px]">{fmtDate(c.start_at, lang)}</span>
            </div>
          ))}
        </section>
      )}

      <nav aria-label={t('adm.pros.card.elsewhere')} className="flex flex-col gap-1 text-[13px]">
        <span className="a-kicker mb-1">{t('adm.pros.card.elsewhere')}</span>
        {[
          { to: `/admin/money/orders?q=${name}`, label: t('adm.pros.card.seeOrders') },
          { to: `/admin/legal/sellers?q=${name}`, label: t('adm.pros.card.seeLegal') },
          { to: `/admin/comms/deliverability?q=${name}`, label: t('adm.pros.card.seeSending') },
        ].map((l) => (
          <Link key={l.to} to={l.to} className="a-t2 inline-flex items-center gap-1 py-0.5 hover:underline">{l.label}<ArrowUpRight className="h-3 w-3" /></Link>
        ))}
      </nav>
    </aside>
  );
}

export function SalesTab({ card }: { card: AccountCard }) {
  const { t, lang } = useAdminT();
  const monthFmt = useMonthFmt();
  const data = useMemo(() => (card.monthly ?? []).map((m) => ({ ...m, label: monthFmt(m.month) })), [card.monthly, monthFmt]);
  if (card.kind === 'agency') {
    return <EmptyState title={t('adm.pros.sales.agency')} body={t('adm.pros.sales.agencyBody', { n: card.row?.sales_total ?? 0 })} />;
  }
  const ov = card.venue_overview?.revenue;
  const sum = (k: 'tickets' | 'tables' | 'guestlist' | 'tickets_rev' | 'tables_rev') => (card.monthly ?? []).reduce((s, m) => s + Number(m[k] || 0), 0);
  const items: StripStat[] = [
    { key: 't', label: t('adm.pros.sales.tickets12'), value: fmtNum(sum('tickets'), lang), spark: (card.monthly ?? []).map((m) => Number(m.tickets || 0)), sparkKind: 'bar' },
    { key: 'b', label: t('adm.pros.sales.tables12'), value: fmtNum(sum('tables'), lang), spark: (card.monthly ?? []).map((m) => Number(m.tables || 0)), sparkKind: 'bar' },
    { key: 'g', label: t('adm.pros.sales.gl12'), value: fmtNum(sum('guestlist'), lang), hint: t('adm.pros.sales.glHint') },
    { key: 'r', label: t('adm.pros.sales.rev12'), value: fmtEur(sum('tickets_rev') + sum('tables_rev'), lang, { cents: false }), hint: t('adm.pros.k.revHint') },
    ...(ov ? [{ key: 'all', label: t('adm.pros.k.revTotal'), value: fmtEur(Number(ov.tickets?.gross ?? 0) + Number(ov.tables?.gross ?? 0), lang, { cents: false }), hint: t('adm.pros.k.revHint') }] : []),
  ];
  return (
    <div className="flex flex-col gap-10">
      <StatStrip items={items} />
      <div className="grid grid-cols-1 gap-x-10 gap-y-10 lg:grid-cols-2">
        <Block title={t('adm.pros.sales.revChart')}>
          <Chart kind="stacked" data={data} x="label" unit="eur"
            series={[{ key: 'tickets_rev', label: t('adm.pros.pillar.tickets') }, { key: 'tables_rev', label: t('adm.pros.pillar.tables') }]} />
        </Block>
        <Block title={t('adm.pros.sales.countChart')}>
          <Chart kind="stacked" data={data} x="label" unit="count"
            series={[{ key: 'tickets', label: t('adm.pros.pillar.tickets') }, { key: 'tables', label: t('adm.pros.pillar.tables') }, { key: 'guestlist', label: t('adm.pros.pillar.guestlist') }]} />
        </Block>
      </div>
      <p className="a-t3 text-[12.5px]">{t('adm.pros.sales.note')}</p>
    </div>
  );
}

export function EventsTab({ card }: { card: AccountCard }) {
  const { t, lang } = useAdminT();
  const now = Date.now();
  const mx = useMemo(() => ({
    tickets: Math.max(0, ...card.events.map((e) => e.tickets)),
    tables: Math.max(0, ...card.events.map((e) => e.tables)),
    gl: Math.max(0, ...card.events.map((e) => e.guestlist)),
    rev: Math.max(0, ...card.events.map((e) => e.revenue)),
  }), [card.events]);
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
    { id: 'date', header: t('adm.pros.ev.date'), accessorFn: (e) => new Date(e.start_at).getTime(), cell: ({ row: { original: e } }) => <span className="a-mono whitespace-nowrap text-[12px]">{fmtDate(e.start_at, lang, 'datetime')}</span> },
    { id: 'tickets', header: t('adm.pros.pillar.tickets'), accessorKey: 'tickets', meta: { align: 'right', tint: (e) => cellTint(e.tickets, mx.tickets) }, cell: ({ row: { original: e } }) => fmtNum(e.tickets, lang) },
    { id: 'tables', header: t('adm.pros.pillar.tables'), accessorKey: 'tables', meta: { align: 'right', tint: (e) => cellTint(e.tables, mx.tables) }, cell: ({ row: { original: e } }) => fmtNum(e.tables, lang) },
    { id: 'gl', header: t('adm.pros.pillar.guestlist'), accessorKey: 'guestlist', meta: { align: 'right', tint: (e) => cellTint(e.guestlist, mx.gl) }, cell: ({ row: { original: e } }) => fmtNum(e.guestlist, lang) },
    { id: 'rev', header: t('adm.pros.ev.revenue'), accessorKey: 'revenue', meta: { align: 'right', tint: (e) => cellTint(e.revenue, mx.rev) }, cell: ({ row: { original: e } }) => fmtEur(e.revenue, lang, { cents: false }) },
  ], [t, lang, now, mx]);
  if (card.kind === 'agency') return <EmptyState title={t('adm.pros.ev.agency')} />;
  return (
    <DataTable data={card.events} columns={columns} initialSort={[{ id: 'date', desc: true }]} getRowId={(e) => e.id}
      empty={{ title: t('adm.pros.ev.empty') }} />
  );
}
