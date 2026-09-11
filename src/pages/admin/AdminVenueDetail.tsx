import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { ArrowLeft, Bot, Building2, CalendarDays, CreditCard, Crown, ExternalLink, Heart, HeartHandshake, LifeBuoy, Mail, RefreshCw, Shield, Ticket, Users, Wine, Zap } from 'lucide-react';
import { AdminPage, Card, Stat, Btn, Pill, KeyValue, TableWrap, Th, Td, EmptyState, ErrorState, PageSkeleton, ProgressBar, POS, NEG, WARN, T1, T3, C_MID } from '@/components/admin/ui';
import { fmtDate, fmtEur, fmtNum, fmtRelative, fmtPct } from '@/lib/adminFormat';

interface Overview {
  venue: { id: string; name: string; slug: string | null; city: string | null; address: string | null; created_at: string; is_hidden: boolean; decommissioned_at: string | null; purge_at: string | null; stripe_account_id: string | null; stripe_onboarding_complete: boolean; stripe_charges_enabled: boolean; stripe_payouts_enabled: boolean; menu_enabled: boolean; vip_placement_enabled: boolean; live_mode_enabled: boolean; timezone: string | null; owner_id: string | null; showcase_shadow_owner_id: string | null; logo_url: string | null; instagram_url: string | null; whatsapp_number: string | null; legal_name: string | null; siret: string | null; is_demo: boolean } | null;
  owner: { id: string; email: string; name: string | null; mfa_enabled: boolean; is_suspended: boolean; created_at: string } | null;
  onboarding: { current_step: number | null; steps: unknown; completed_at: string | null } | null;
  subscription: { status: string; plan: string | null; trial_end: string | null; is_early_adopter: boolean; period_end: string | null } | null;
  revenue: { drinks: { n: number; gross: number; yuno: number }; tickets: { n: number; gross: number; yuno: number }; tables: { n: number; gross: number; yuno: number }; guestlist: number; last_sale_at: string | null };
  events: { total: number; upcoming: number; recent: { id: string; title: string; start_at: string; is_active: boolean; ticketing: boolean; tables: boolean; cancelled: boolean; organizer: string | null; tickets: number; guestlist: number }[] };
  staff: { id: string; email: string; name: string | null; roles: string[] | null; has_pin: boolean; since: string | null }[];
  promoters: number; customers: number; followers: number; zones: number; drinks: number; ai_chats_30d: number; email_campaigns: number; newsletter: number;
  support_grant: { status: string; created_at: string } | null;
}

export default function AdminVenueDetail() {
  const { venueId } = useParams<{ venueId: string }>();
  const { t, language } = useLanguage();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!venueId) return;
    setLoading(true); setError(null);
    const { data: d, error: e } = await supabase.rpc('admin_venue_overview' as never, { p_venue_id: venueId } as never);
    if (e) setError(e.message); else setData(d as unknown as Overview);
    setLoading(false);
  }, [venueId]);
  useEffect(() => { load(); }, [load]);

  const back = <Btn to="/admin/venues" icon={ArrowLeft} variant="subtle">{t('adm.common.back')}</Btn>;
  if (loading && !data) return <AdminPage eyebrow={t('adm.venue.eyebrow')} title="…" actions={back}><PageSkeleton tiles={4} blocks={2} /></AdminPage>;
  if (error || !data || !data.venue) return <AdminPage eyebrow={t('adm.venue.eyebrow')} title={t('adm.venue.detail')} actions={back}><Card><ErrorState text={error ?? t('adm.venue.notFound')} onRetry={load} retryLabel={t('adm.common.retry')} /></Card></AdminPage>;

  const v = data.venue; const r = data.revenue;
  const total = r.drinks.gross + r.tickets.gross + r.tables.gross;
  const yuno = r.drinks.yuno + r.tickets.yuno + r.tables.yuno;
  const stripeState = v.stripe_charges_enabled && v.stripe_payouts_enabled ? 'ready' : v.stripe_account_id ? 'pending' : 'none';
  const onbPct = data.onboarding?.completed_at ? 100 : data.onboarding?.current_step ? Math.min(100, Math.round((data.onboarding.current_step / 8) * 100)) : 0;
  const roleLabel = (role: string) => { const k = `adm.people.role.${role}`; const x = t(k); return x === k ? role : x; };

  return (
    <AdminPage eyebrow={<>{t('adm.venue.eyebrow')} · {v.city ?? ''}</>} title={<span className="inline-flex items-center gap-2 flex-wrap">{v.name}
      {v.is_demo && <Pill tone="accent">{t('adm.venue.demo')}</Pill>}{v.is_hidden && <Pill tone="muted">{t('adm.venue.hidden')}</Pill>}{v.showcase_shadow_owner_id && <Pill tone="accent">{t('adm.venue.showcase')}</Pill>}
      {v.decommissioned_at && <Pill tone="neg">{t('adm.venue.decommissioned')}{v.purge_at ? ` · ${t('adm.venue.purgeAt').replace('{d}', fmtDate(v.purge_at, language))}` : ''}</Pill>}</span>}
      subtitle={v.address ?? undefined}
      actions={<>{back}<Btn to="/admin/venues" icon={Building2}>{t('adm.venue.manageInList')}</Btn>{v.slug && <Btn href={`/club/${v.slug}`} icon={ExternalLink}>{t('adm.common.seePage')}</Btn>}<Btn onClick={load} icon={RefreshCw} loading={loading}>{t('adm.common.refresh')}</Btn></>}>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label={t('adm.venue.revenue')} value={fmtEur(total, language, { compact: true })} icon={Zap} highlight sub={t('adm.venue.yunoFees').replace('{v}', fmtEur(yuno, language))} />
        <Stat label={t('adm.common.tickets')} value={fmtNum(r.tickets.n, language)} icon={Ticket} sub={fmtEur(r.tickets.gross, language)} />
        <Stat label={t('adm.common.tables')} value={fmtNum(r.tables.n, language)} icon={Crown} sub={fmtEur(r.tables.gross, language)} />
        <Stat label={t('adm.common.drinks')} value={fmtNum(r.drinks.n, language)} icon={Wine} sub={fmtEur(r.drinks.gross, language)} />
      </div>
      <p style={{ color: T3, fontSize: 11.5, marginTop: -12 }}>{t('adm.venue.revenueHint')} · {r.last_sale_at ? t('adm.venue.lastSale').replace('{t}', fmtRelative(r.last_sale_at, language)) : t('adm.venue.noSale')} · {t('adm.venue.guestlist')}: {fmtNum(r.guestlist, language)}</p>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title={t('adm.venue.info')} icon={Building2}>
          <KeyValue rows={[
            { k: t('adm.venue.address'), v: v.address ?? '—' },
            { k: t('adm.common.city'), v: v.city ?? '—' },
            { k: t('adm.venue.createdAt'), v: fmtDate(v.created_at, language) },
            { k: t('adm.venue.timezone'), v: v.timezone ?? '—' },
            { k: t('adm.venue.legal'), v: v.legal_name ?? '—' },
            { k: t('adm.venue.siret'), v: v.siret ?? '—' },
            { k: 'Instagram', v: v.instagram_url ? <a href={v.instagram_url} target="_blank" rel="noreferrer" className="hover:underline">{v.instagram_url.replace(/^https?:\/\/(www\.)?/, '')}</a> : '—' },
          ]} />
          <div className="mt-4"><div style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{t('adm.venue.modules')}</div>
            <div className="flex gap-1.5 flex-wrap"><Pill size="xs" tone={v.menu_enabled ? 'pos' : 'muted'}>{t('adm.venue.menu')}</Pill><Pill size="xs" tone={v.vip_placement_enabled ? 'pos' : 'muted'}>{t('adm.venue.vip')}</Pill><Pill size="xs" tone={v.live_mode_enabled ? 'pos' : 'muted'}>{t('adm.venue.liveMode')}</Pill></div></div>
        </Card>
        <Card title={t('adm.venue.stripe')} icon={CreditCard} accent={stripeState !== 'ready'}>
          <div className="flex items-center gap-2 mb-3"><Pill tone={stripeState === 'ready' ? 'pos' : stripeState === 'pending' ? 'accent' : 'neg'}>{stripeState === 'ready' ? t('adm.venue.stripeReady') : stripeState === 'pending' ? t('adm.venue.stripePending') : t('adm.venue.stripeNone')}</Pill></div>
          <KeyValue rows={[
            { k: t('adm.venue.charges'), v: <span style={{ color: v.stripe_charges_enabled ? POS : NEG }}>{v.stripe_charges_enabled ? t('adm.common.yes') : t('adm.common.no')}</span> },
            { k: t('adm.venue.payouts'), v: <span style={{ color: v.stripe_payouts_enabled ? POS : NEG }}>{v.stripe_payouts_enabled ? t('adm.common.yes') : t('adm.common.no')}</span> },
            { k: 'Stripe ID', v: v.stripe_account_id ?? '—' },
            { k: t('adm.venue.subscription'), v: data.subscription ? `${data.subscription.status}${data.subscription.plan ? ` · ${data.subscription.plan}` : ''}${data.subscription.is_early_adopter ? ' · early adopter' : ''}` : '—' },
          ]} />
          <div className="mt-4"><div className="flex items-center justify-between" style={{ fontSize: 12 }}><span style={{ color: T3 }}>{t('adm.venue.onboarding')}</span><span className="tabular-nums" style={{ color: T1, fontWeight: 600 }}>{fmtPct(onbPct)}</span></div><div className="mt-1.5"><ProgressBar pct={onbPct} color={onbPct === 100 ? POS : WARN} height={5} /></div>
            <div style={{ color: T3, fontSize: 11, marginTop: 4 }}>{data.onboarding?.completed_at ? t('adm.venue.onboardingDone').replace('{d}', fmtDate(data.onboarding.completed_at, language)) : data.onboarding?.current_step ? t('adm.venue.onboardingStep').replace('{n}', String(data.onboarding.current_step)) : '—'}</div></div>
        </Card>
        <Card title={t('adm.venue.owner')} icon={Users}>
          {data.owner ? (
            <>
              <Link to={`/admin/people/${data.owner.id}`} className="hover:underline" style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{data.owner.name ?? data.owner.email}</Link>
              <div style={{ color: T3, fontSize: 12 }}>{data.owner.email}</div>
              <div className="flex gap-1.5 flex-wrap mt-2">
                <Pill size="xs" tone={data.owner.mfa_enabled ? 'pos' : 'muted'} icon={Shield}>{t('adm.venue.mfa')} {data.owner.mfa_enabled ? t('adm.common.on') : t('adm.common.off')}</Pill>
                {data.owner.is_suspended && <Pill size="xs" tone="neg">{t('adm.venue.suspended')}</Pill>}
                {data.support_grant && <Pill size="xs" tone="accent" icon={LifeBuoy}>{t('adm.venue.support')} · {data.support_grant.status}</Pill>}
              </div>
              <div style={{ color: T3, fontSize: 11, marginTop: 8 }}>{t('adm.common.created')} {fmtDate(data.owner.created_at, language)}</div>
            </>
          ) : <EmptyState icon={Users} text={t('adm.venue.noOwner')} />}
        </Card>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <Stat compact label={t('adm.venue.events')} value={fmtNum(data.events.total, language)} icon={CalendarDays} sub={t('adm.venue.upcoming').replace('{n}', fmtNum(data.events.upcoming, language))} />
        <Stat compact label={t('adm.venue.customers')} value={fmtNum(data.customers, language)} icon={Users} />
        <Stat compact label={t('adm.venue.followers')} value={fmtNum(data.followers, language)} icon={Heart} />
        <Stat compact label={t('adm.venue.promoters')} value={fmtNum(data.promoters, language)} icon={HeartHandshake} />
        <Stat compact label={t('adm.venue.zones')} value={fmtNum(data.zones, language)} icon={Crown} />
        <Stat compact label={t('adm.venue.drinks')} value={fmtNum(data.drinks, language)} icon={Wine} />
        <Stat compact label={t('adm.venue.campaigns')} value={fmtNum(data.email_campaigns, language)} icon={Mail} sub={`${t('adm.venue.newsletter')}: ${fmtNum(data.newsletter, language)}`} />
        <Stat compact label={t('adm.venue.aiChats')} value={fmtNum(data.ai_chats_30d, language)} icon={Bot} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title={t('adm.venue.staff')} icon={Users} flush>
          {data.staff.length === 0 ? <EmptyState text={t('adm.venue.noStaff')} /> : (
            <TableWrap minWidth={360}>
              <thead><tr><Th>{t('adm.common.name')}</Th><Th>{t('adm.common.roles')}</Th><Th>{t('adm.venue.pin')}</Th></tr></thead>
              <tbody>{data.staff.map((s) => <tr key={s.id}><Td strong><Link to={`/admin/people/${s.id}`} className="hover:underline">{s.name ?? s.email}</Link><div style={{ color: T3, fontSize: 11, fontWeight: 400 }}>{s.email}</div></Td><Td><div className="flex gap-1 flex-wrap">{(s.roles ?? []).map((r) => <Pill key={r} size="xs">{roleLabel(r)}</Pill>)}</div></Td><Td><span style={{ color: s.has_pin ? POS : T3, fontSize: 12 }}>{s.has_pin ? t('adm.common.yes') : t('adm.common.no')}</span></Td></tr>)}</tbody>
            </TableWrap>
          )}
        </Card>
        <Card title={t('adm.venue.recentEvents')} icon={CalendarDays} className="xl:col-span-2" flush>
          {data.events.recent.length === 0 ? <EmptyState text={t('adm.venue.noEvents')} /> : (
            <TableWrap minWidth={640}>
              <thead><tr><Th>{t('adm.venue.col.title')}</Th><Th>{t('adm.venue.col.date')}</Th><Th>{t('adm.venue.col.organizer')}</Th><Th right>{t('adm.venue.col.tickets')}</Th><Th right>{t('adm.venue.col.guestlist')}</Th><Th>{t('adm.venue.col.flags')}</Th></tr></thead>
              <tbody>{data.events.recent.map((e) => (
                <tr key={e.id}>
                  <Td strong><Link to={`/admin/events?q=${encodeURIComponent(e.title)}`} className="hover:underline">{e.title}</Link>{e.cancelled && <Pill size="xs" tone="neg">{t('adm.venue.cancelled')}</Pill>}{!e.is_active && !e.cancelled && <Pill size="xs" tone="muted">{t('adm.venue.inactive')}</Pill>}</Td>
                  <Td muted>{fmtDate(e.start_at, language, 'datetime')}</Td>
                  <Td muted>{e.organizer ?? '—'}</Td>
                  <Td right>{fmtNum(e.tickets, language)}</Td>
                  <Td right>{fmtNum(e.guestlist, language)}</Td>
                  <Td><div className="flex gap-1">{e.ticketing && <Pill size="xs" tone="default">{t('adm.venue.ticketing')}</Pill>}{e.tables && <Pill size="xs" tone="default">{t('adm.venue.tables')}</Pill>}</div></Td>
                </tr>
              ))}</tbody>
            </TableWrap>
          )}
        </Card>
      </div>
      <p style={{ color: T3, fontSize: 11 }}>{C_MID && ''}</p>
    </AdminPage>
  );
}
