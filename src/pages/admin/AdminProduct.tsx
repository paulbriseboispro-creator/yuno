import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAdminScope } from '@/components/admin/AdminScope';
import {
  AtSign, Bell, Bot, Compass, Crown, Eye, Heart, ListChecks, Mail, MessageSquareWarning, Music, RefreshCw,
  Smartphone, Ticket, Users, Wallet, ShoppingCart,
} from 'lucide-react';
import {
  AdminPage, Card, Stat, SectionHeading, PeriodFilter, Btn, Pill, DistRow, RankRow, EmptyState, ErrorState, PageSkeleton, Reveal,
  TableWrap, Th, Td, ProgressBar, KeyValue, RED, NEG, WARN, T1, T3, F_BORDER, C_MID,
} from '@/components/admin/ui';
import { fmtNum, fmtRelative, fmtDate, periodRange, fmtPct, type AdminPeriod, fmtPlural } from '@/lib/adminFormat';

interface KV { k: string; n: number }
interface Insights {
  page_groups: { group: string; views: number; sessions: number; avg_seconds: number | null }[];
  top_events_viewed: { id: string; title: string; start_at: string; venue_name: string | null; views: number; sessions: number; avg_seconds: number | null; guestlist: number; tickets: number }[];
  top_paths: { path: string; group: string; views: number; avg_seconds: number | null }[];
  favorites: { by_type: { type: string; period: number; total: number }[]; top_events: { id: string; title: string; start_at: string; n: number }[]; top_venues: { id: string; name: string; city: string | null; n: number }[]; top_djs: { id: string; name: string; n: number }[] };
  follows: { by_subject: { subject: string; follows: number; unfollows: number }[] };
  taste: { profiles: number; genres: KV[]; night_type: KV[]; budget: KV[]; frequency: KV[]; drink: KV[]; booking: KV[] };
  audience: { cities: KV[]; languages: KV[]; genders: KV[]; ages: KV[]; personas: KV[]; session_countries: KV[]; session_languages: KV[]; session_devices: KV[] };
  entry: { guestlist: number; guestlist_scanned: number; tickets: number; tickets_scanned: number; tables: number; wallet_passes: number; wallet_by_type: KV[]; guest_checkout_share: number | null; abandoned_carts: number };
  notifications: { push_users: number; push_by_platform: KV[]; auto_push: { key: string; sent: number; clicked: number; failed: number; ctr: number }[]; discovery_sent: number; discovery_opened: number; discovery_opt_out: number; newsletter_opt_in: number; newsletter_opt_out_period: number };
  feedback: { open: number; by_category: KV[]; recent: { id: string; title: string; category: string; priority: string; status: string; at: string; reporter: string | null; venue: string | null }[]; incidents: number; email_complaints: number };
  ai_questions: { at: string; q: string; lang: string | null; turns: number | null; status: string }[];
  pro_questions: { at: string; q: string; assistant: string; tools: string[] | null; status: string }[];
  links_interest: { target: string; n: number }[];
}

const PERIODS: AdminPeriod[] = ['7d', '30d', '90d'];

function secs(n: number | null): string { if (n === null || n === undefined) return '—'; return n >= 60 ? `${Math.round(n / 60)} min` : `${Math.round(n)} s`; }

export default function AdminProduct() {
  const { t, language } = useLanguage();
  const { includeDemo } = useAdminScope();
  const [period, setPeriod] = useState<AdminPeriod>('30d');
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const { from, to } = periodRange(period);
    const { data: d, error: e } = await supabase.rpc('admin_product_insights' as never, { p_from: from.toISOString(), p_to: to.toISOString(), p_include_demo: includeDemo } as never);
    if (e) setError(e.message); else setData(d as unknown as Insights);
    setLoading(false);
  }, [period, includeDemo]);
  useEffect(() => { load(); }, [load]);

  const tr = (prefix: string, raw: string) => { if (!raw) return t('adm.product.unknownValue'); const k = `${prefix}.${raw}`; const v = t(k); return v === k ? raw : v; };
  const header = (
    <>
      {includeDemo && <Pill tone="accent">{t('adm.common.demoIncluded')}</Pill>}
      <PeriodFilter<AdminPeriod> value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ key: p, label: t(`adm.common.period.${p}`) }))} />
      <Btn onClick={load} icon={RefreshCw} loading={loading}>{t('adm.common.refresh')}</Btn>
    </>
  );
  if (loading && !data) return <AdminPage eyebrow={t('adm.product.eyebrow')} title={t('adm.product.title')} subtitle={t('adm.product.subtitle')} actions={header}><PageSkeleton tiles={4} blocks={4} /></AdminPage>;
  if (error || !data) return <AdminPage eyebrow={t('adm.product.eyebrow')} title={t('adm.product.title')} actions={header}><Card><ErrorState text={error ?? t('adm.common.error')} onRetry={load} retryLabel={t('adm.common.retry')} /></Card></AdminPage>;

  const Dist = ({ items, prefix, max }: { items: KV[]; prefix?: string; max?: number }) => {
    if (!items || items.length === 0) return <p style={{ color: T3, fontSize: 12 }}>{t('adm.product.noSignal')}</p>;
    const m = max ?? Math.max(...items.map((i) => i.n), 1);
    return <>{items.map((i) => <DistRow key={i.k} label={prefix ? tr(prefix, i.k) : (i.k || t('adm.product.unknownValue'))} value={fmtNum(i.n, language)} pct={(i.n / m) * 100} />)}</>;
  };
  const Block = ({ title, children }: { title: string; children: ReactNode }) => (
    <div><div style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{title}</div>{children}</div>
  );

  const pg = data.page_groups; const pgMax = Math.max(...pg.map((p) => p.views), 1);
  const ev = data.top_events_viewed; const evMax = Math.max(...ev.map((e) => e.views), 1);
  const fav = data.favorites; const favMax = Math.max(...fav.by_type.map((f) => f.total), 1);
  const en = data.entry; const no = data.notifications; const fb = data.feedback;
  const linkMax = Math.max(...data.links_interest.map((l) => l.n), 1);

  return (
    <AdminPage eyebrow={t('adm.product.eyebrow')} title={t('adm.product.title')} subtitle={t('adm.product.subtitle')} actions={header}>
      {/* 01 */}
      <Reveal>
        <SectionHeading n={1} label={t('adm.product.z1')} icon={Eye} accent />
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-3 items-start">
          <Card title={t('adm.product.pageGroups')} subtitle={t('adm.product.pageGroupsHint')} icon={Compass}>
            {pg.length === 0 ? <EmptyState text={t('adm.product.noSignal')} /> : pg.map((p, i) => <DistRow key={p.group} label={tr('adm.cockpit.g', p.group)} value={fmtNum(p.views, language)} sub={`${fmtNum(p.sessions, language)} · ${secs(p.avg_seconds)}`} pct={(p.views / pgMax) * 100} color={i === 0 ? `linear-gradient(90deg,${RED}88,${RED})` : undefined} />)}
          </Card>
          <Card title={t('adm.product.topEvents')} icon={Ticket} className="xl:col-span-2" flush>
            {ev.length === 0 ? <EmptyState text={t('adm.product.noSignal')} /> : (
              <TableWrap minWidth={640}>
                <thead><tr><Th>{t('adm.product.col.event')}</Th><Th right>{t('adm.product.col.views')}</Th><Th right>{t('adm.product.col.sessions')}</Th><Th right>{t('adm.product.col.time')}</Th><Th right>{t('adm.product.col.guestlist')}</Th><Th right>{t('adm.product.col.tickets')}</Th></tr></thead>
                <tbody>{ev.map((e) => (
                  <tr key={e.id}>
                    <Td><Link to={`/admin/events?q=${encodeURIComponent(e.title)}`} className="hover:opacity-90"><div style={{ color: T1, fontWeight: 560 }}>{e.title}</div><div style={{ color: T3, fontSize: 11 }}>{fmtDate(e.start_at, language, 'day')}{e.venue_name ? ` · ${e.venue_name}` : ''}</div><div className="mt-1.5" style={{ maxWidth: 200 }}><ProgressBar pct={(e.views / evMax) * 100} height={3} color={C_MID} /></div></Link></Td>
                    <Td right strong>{fmtNum(e.views, language)}</Td><Td right>{fmtNum(e.sessions, language)}</Td><Td right>{secs(e.avg_seconds)}</Td><Td right>{fmtNum(e.guestlist, language)}</Td><Td right>{fmtNum(e.tickets, language)}</Td>
                  </tr>
                ))}</tbody>
              </TableWrap>
            )}
          </Card>
        </div>
        {data.top_paths.length > 0 && (
          <Card title={t('adm.product.topPaths')} icon={Compass} className="mt-4" flush>
            <TableWrap minWidth={520}>
              <thead><tr><Th>{t('adm.product.col.path')}</Th><Th>{t('adm.product.col.group')}</Th><Th right>{t('adm.product.col.views')}</Th><Th right>{t('adm.product.col.time')}</Th></tr></thead>
              <tbody>{data.top_paths.map((p) => <tr key={p.path}><Td strong><code style={{ fontSize: 12 }}>{p.path}</code></Td><Td muted>{tr('adm.cockpit.g', p.group)}</Td><Td right>{fmtNum(p.views, language)}</Td><Td right>{secs(p.avg_seconds)}</Td></tr>)}</tbody>
            </TableWrap>
          </Card>
        )}
      </Reveal>

      {/* 02 */}
      <Reveal delay={0.05}>
        <SectionHeading n={2} label={t('adm.product.z2')} icon={Heart} />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mt-3 items-start">
          <Card title={t('adm.product.favorites')} subtitle={t('adm.product.favoritesHint')} icon={Heart}>
            {fav.by_type.length === 0 ? <EmptyState text={t('adm.product.noSignal')} /> : fav.by_type.map((f) => <DistRow key={f.type} label={tr('adm.product.fav', f.type)} value={`${fmtNum(f.period, language)} / ${fmtNum(f.total, language)}`} pct={(f.total / favMax) * 100} />)}
            <div className="mt-4"><Block title={t('adm.product.follows')}>
              {data.follows.by_subject.length === 0 ? <p style={{ color: T3, fontSize: 12 }}>{t('adm.product.noSignal')}</p> : data.follows.by_subject.map((s) => (
                <div key={s.subject} className="flex items-center justify-between py-1.5" style={{ fontSize: 12.5, borderBottom: `1px solid ${F_BORDER}` }}>
                  <span style={{ color: T1 }}>{tr('adm.product.sub', s.subject)}</span>
                  <span className="tabular-nums"><span style={{ color: T1, fontWeight: 600 }}>+{fmtNum(s.follows, language)}</span> <span style={{ color: s.unfollows > 0 ? NEG : T3 }}>−{fmtNum(s.unfollows, language)}</span></span>
                </div>
              ))}
            </Block></div>
          </Card>
          <Card title={t('adm.product.topFavEvents')} icon={Ticket}>
            {fav.top_events.length === 0 ? <EmptyState text={t('adm.product.noSignal')} /> : fav.top_events.map((e, i) => <RankRow key={e.id} index={i} label={e.title} sub={fmtDate(e.start_at, language, 'day')} value={fmtNum(e.n, language)} pct={(e.n / (fav.top_events[0]?.n || 1)) * 100} leader={i === 0} to={`/admin/events?q=${encodeURIComponent(e.title)}`} />)}
          </Card>
          <Card title={t('adm.product.topFavVenues')} icon={Crown}>
            {fav.top_venues.length === 0 ? <EmptyState text={t('adm.product.noSignal')} /> : fav.top_venues.map((v, i) => <RankRow key={v.id} index={i} label={v.name} sub={v.city ?? undefined} value={fmtNum(v.n, language)} pct={(v.n / (fav.top_venues[0]?.n || 1)) * 100} leader={i === 0} to={`/admin/venues/${v.id}`} />)}
          </Card>
          <Card title={t('adm.product.topFavDjs')} icon={Music}>
            {fav.top_djs.length === 0 ? <EmptyState text={t('adm.product.noSignal')} /> : fav.top_djs.map((d, i) => <RankRow key={d.id} index={i} label={d.name} value={fmtNum(d.n, language)} pct={(d.n / (fav.top_djs[0]?.n || 1)) * 100} leader={i === 0} />)}
          </Card>
        </div>
      </Reveal>

      {/* 03 */}
      <Reveal delay={0.1}>
        <SectionHeading n={3} label={t('adm.product.z3')} icon={Users} />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3 items-start">
          <Card title={t('adm.product.taste')} subtitle={t('adm.product.tasteN').replace('{n}', fmtNum(data.taste.profiles, language))} icon={Music}>
            <div className="space-y-4">
              <Block title={t('adm.product.taste.genres')}><Dist items={data.taste.genres} /></Block>
              <Block title={t('adm.product.taste.night_type')}><Dist items={data.taste.night_type} /></Block>
              <Block title={t('adm.product.taste.budget')}><Dist items={data.taste.budget} /></Block>
              <Block title={t('adm.product.taste.frequency')}><Dist items={data.taste.frequency} /></Block>
              <Block title={t('adm.product.taste.drink')}><Dist items={data.taste.drink} /></Block>
              <Block title={t('adm.product.taste.booking')}><Dist items={data.taste.booking} /></Block>
            </div>
          </Card>
          <Card title={t('adm.product.audience')} icon={Users}>
            <div className="space-y-4">
              <Block title={t('adm.product.aud.cities')}><Dist items={data.audience.cities} /></Block>
              <Block title={t('adm.product.aud.languages')}><Dist items={data.audience.languages.map((l) => ({ ...l, k: l.k === '?' ? '' : l.k.toUpperCase() }))} /></Block>
              <Block title={t('adm.product.aud.genders')}><Dist items={data.audience.genders.map((l) => ({ ...l, k: l.k === '?' ? '' : l.k }))} /></Block>
              <Block title={t('adm.product.aud.ages')}><Dist items={data.audience.ages} /></Block>
              <Block title={t('adm.product.aud.personas')}><Dist items={data.audience.personas} /></Block>
            </div>
          </Card>
          <Card title={t('adm.product.sessions')} icon={Smartphone}>
            <div className="space-y-4">
              <Block title={t('adm.product.aud.session_countries')}><Dist items={data.audience.session_countries.map((l) => ({ ...l, k: l.k === '?' ? '' : l.k }))} /></Block>
              <Block title={t('adm.product.aud.session_languages')}><Dist items={data.audience.session_languages.map((l) => ({ ...l, k: l.k === '?' ? '' : l.k.toUpperCase() }))} /></Block>
              <Block title={t('adm.product.aud.session_devices')}><Dist items={data.audience.session_devices.map((l) => ({ ...l, k: l.k === '?' ? '' : l.k }))} /></Block>
            </div>
          </Card>
        </div>
      </Reveal>

      {/* 04 */}
      <Reveal delay={0.15}>
        <SectionHeading n={4} label={t('adm.product.z4')} icon={Ticket} />
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mt-3">
          <Stat label={t('adm.product.entry.guestlist')} value={fmtNum(en.guestlist, language)} icon={ListChecks} sub={t('adm.product.entry.scanned').replace('{n}', fmtNum(en.guestlist_scanned, language))} highlight />
          <Stat label={t('adm.product.entry.tickets')} value={fmtNum(en.tickets, language)} icon={Ticket} sub={t('adm.product.entry.scanned').replace('{n}', fmtNum(en.tickets_scanned, language))} />
          <Stat label={t('adm.product.entry.tables')} value={fmtNum(en.tables, language)} icon={Crown} />
          <Stat label={t('adm.product.entry.wallet')} value={fmtNum(en.wallet_passes, language)} icon={Wallet} sub={en.wallet_by_type.map((w) => `${fmtNum(w.n, language)} ${tr('adm.product.wallet', w.k)}`).join(' · ') || undefined} />
          <Stat label={t('adm.product.entry.guestShare')} value={en.guest_checkout_share === null ? '—' : fmtPct(en.guest_checkout_share)} icon={Users} sub={en.guest_checkout_share === null ? t('adm.product.entry.noSale') : undefined} />
          <Stat label={t('adm.product.entry.abandoned')} value={fmtNum(en.abandoned_carts, language)} icon={ShoppingCart} tone={en.abandoned_carts > 0 ? 'warn' : undefined} />
        </div>
      </Reveal>

      {/* 05 */}
      <Reveal delay={0.2}>
        <SectionHeading n={5} label={t('adm.product.z5')} icon={Bell} />
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-3 items-start">
          <Card title={t('adm.product.push')} subtitle={fmtPlural(no.push_users, language, t('adm.product.pushUsersOne'), t('adm.product.pushUsers'))} icon={Bell}>
            <Dist items={no.push_by_platform} />
            <div className="mt-4"><KeyValue rows={[
              { k: t('adm.product.discovery'), v: t('adm.product.discoveryLine').replace('{s}', fmtNum(no.discovery_sent, language)).replace('{o}', fmtNum(no.discovery_opened, language)).replace('{x}', fmtNum(no.discovery_opt_out, language)) },
              { k: t('adm.product.newsletter'), v: t('adm.product.newsletterLine').replace('{i}', fmtNum(no.newsletter_opt_in, language)).replace('{o}', fmtNum(no.newsletter_opt_out_period, language)) },
            ]} /></div>
          </Card>
          <Card title={t('adm.product.autoPush')} icon={Bell} className="xl:col-span-2" flush right={<Btn to="/admin/notifications" size="sm">{t('adm.product.seeAll')}</Btn>}>
            {no.auto_push.length === 0 ? <EmptyState text={t('adm.product.noSignal')} /> : (
              <TableWrap minWidth={520}>
                <thead><tr><Th>{t('adm.product.col.key')}</Th><Th right>{t('adm.product.col.sent')}</Th><Th right>{t('adm.product.col.clicked')}</Th><Th right>{t('adm.product.col.failed')}</Th><Th right>{t('adm.product.col.ctr')}</Th></tr></thead>
                <tbody>{no.auto_push.map((a) => <tr key={a.key}><Td strong><code style={{ fontSize: 12 }}>{a.key}</code></Td><Td right>{fmtNum(a.sent, language)}</Td><Td right>{fmtNum(a.clicked, language)}</Td><Td right style={{ color: a.failed > 0 ? NEG : undefined }}>{fmtNum(a.failed, language)}</Td><Td right><div className="flex items-center justify-end gap-2"><span style={{ color: T1, fontWeight: 600 }}>{fmtPct(a.ctr, 1)}</span><div style={{ width: 60 }}><ProgressBar pct={a.ctr} height={4} /></div></div></Td></tr>)}</tbody>
              </TableWrap>
            )}
          </Card>
        </div>
      </Reveal>

      {/* 06 */}
      <Reveal delay={0.25}>
        <SectionHeading n={6} label={t('adm.product.z6')} icon={Bot} />
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-3 items-start">
          <Card title={t('adm.product.aiQuestions')} icon={Bot} right={<Btn to="/admin/ai" size="sm">{t('adm.product.seeAll')}</Btn>}>
            {data.ai_questions.length === 0 ? <EmptyState icon={Bot} text={t('adm.product.noSignal')} /> : data.ai_questions.map((q, i) => (
              <div key={i} className="py-2" style={{ borderBottom: `1px solid ${F_BORDER}` }}>
                <p style={{ color: T1, fontSize: 13, margin: 0, lineHeight: 1.4 }}>{q.q}</p>
                <div className="flex items-center gap-2 mt-1" style={{ color: T3, fontSize: 11 }}>{q.lang && <Pill size="xs" tone="muted">{q.lang.toUpperCase()}</Pill>}{q.turns ? <span>{t('adm.product.turnsN').replace('{n}', String(q.turns))}</span> : null}<span>{fmtRelative(q.at, language)}</span>{q.status !== 'ok' && <Pill size="xs" tone="neg">{q.status}</Pill>}</div>
              </div>
            ))}
          </Card>
          <Card title={t('adm.product.proQuestions')} icon={Bot}>
            {data.pro_questions.length === 0 ? <EmptyState icon={Bot} text={t('adm.product.noSignal')} /> : data.pro_questions.map((q, i) => (
              <div key={i} className="py-2" style={{ borderBottom: `1px solid ${F_BORDER}` }}>
                <p style={{ color: T1, fontSize: 13, margin: 0, lineHeight: 1.4 }}>{q.q}</p>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap" style={{ color: T3, fontSize: 11 }}><Pill size="xs" tone="default">{tr('adm.ai.a', q.assistant)}</Pill>{(q.tools ?? []).map((x, j) => <Pill key={j} size="xs" tone="muted">{x}</Pill>)}<span>{fmtRelative(q.at, language)}</span></div>
              </div>
            ))}
          </Card>
          <Card title={t('adm.product.linksInterest')} icon={AtSign} right={<Btn to="/admin/links" size="sm">{t('adm.product.seeAll')}</Btn>}>
            {data.links_interest.length === 0 ? <EmptyState icon={AtSign} text={t('adm.product.noSignal')} /> : data.links_interest.map((l) => <DistRow key={l.target} label={<code style={{ fontSize: 12 }}>{l.target}</code>} value={fmtNum(l.n, language)} pct={(l.n / linkMax) * 100} />)}
          </Card>
        </div>
      </Reveal>

      {/* 07 */}
      <Reveal delay={0.3}>
        <SectionHeading n={7} label={t('adm.product.z7')} icon={MessageSquareWarning} accent={fb.open > 0} />
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-3 items-start">
          <Card title={t('adm.product.feedback')} subtitle={t('adm.product.feedbackOpen').replace('{n}', fmtNum(fb.open, language))} icon={MessageSquareWarning} className="xl:col-span-2" right={<Btn to="/admin/feedback" size="sm">{t('adm.product.seeAll')}</Btn>}>
            {fb.recent.length === 0 ? <EmptyState text={t('adm.product.noSignal')} /> : fb.recent.map((f) => (
              <Link key={f.id} to="/admin/feedback" className="flex items-center justify-between gap-3 py-2 hover:opacity-90" style={{ borderBottom: `1px solid ${F_BORDER}` }}>
                <div className="min-w-0"><div className="truncate" style={{ color: T1, fontSize: 13 }}>{f.title}</div><div className="truncate" style={{ color: T3, fontSize: 11 }}>{[f.venue, f.reporter].filter(Boolean).join(' · ')}</div></div>
                <div className="flex items-center gap-1.5 flex-none"><Pill size="xs" tone="muted">{f.category}</Pill><Pill size="xs" tone={f.priority === 'critical' || f.priority === 'high' ? 'hot' : 'default'}>{f.priority}</Pill><Pill size="xs" tone={f.status === 'open' ? 'accent' : f.status === 'resolved' || f.status === 'closed' ? 'pos' : 'default'}>{f.status}</Pill><span style={{ color: T3, fontSize: 11 }}>{fmtRelative(f.at, language)}</span></div>
              </Link>
            ))}
            {fb.by_category.length > 0 && <div className="mt-3"><Dist items={fb.by_category} /></div>}
          </Card>
          <div className="grid grid-cols-2 xl:grid-cols-1 gap-3">
            <Stat label={t('adm.product.incidents')} value={fmtNum(fb.incidents, language)} icon={MessageSquareWarning} tone={fb.incidents > 0 ? 'warn' : undefined} />
            <Stat label={t('adm.product.complaints')} value={fmtNum(fb.email_complaints, language)} icon={Mail} tone={fb.email_complaints > 0 ? 'warn' : undefined} />
          </div>
        </div>
      </Reveal>
      <p style={{ color: T3, fontSize: 11 }}>{includeDemo ? t('adm.common.demoIncluded') : t('adm.common.realOnlyNote')}{WARN && ''}</p>
    </AdminPage>
  );
}
