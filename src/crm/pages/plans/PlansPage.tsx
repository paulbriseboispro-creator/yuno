/**
 * Campagnes › Plans de soirée (nom validé par Paul le 03/11) : les plans en
 * cours (en préparation compris), les soirées à venir sans plan, les plans des
 * soirées passées. Une soirée = un plan ; tout chiffre vient de
 * crm_night_plans_list.
 */
import { Link } from 'react-router-dom';
import { Badge, MonoLabel, PillButton, Skel } from '@/crm/ui/kit';
import { useCrmT } from '@/crm/i18n';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { useNightPlans, type PlansListRow } from '@/crm/data/nightPlans';

type T = ReturnType<typeof useCrmT>;

const card = { padding: 'clamp(18px,3vw,24px)', borderRadius: 24, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', display: 'flex', flexDirection: 'column', gap: 10 } as const;
const h2 = { margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em', lineHeight: 1.2 } as const;
const muted = { fontSize: 14, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' } as const;

export default function PlansPage() {
  const T = useCrmT();
  const { t } = T;
  const q = useNightPlans();
  const d = q.data;
  return (
    <main style={{ flex: 1, width: '100%', maxWidth: 1040, boxSizing: 'border-box', margin: '0 auto', padding: 'clamp(24px,3vw,36px) 16px 72px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <MonoLabel>{t('yc.np.p.eyebrow')}</MonoLabel>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,4vw,40px)', letterSpacing: '-.035em', lineHeight: 1.05 }}>{t('yc.np.p.title')}</h1>
        <span style={{ ...muted, maxWidth: 640 }}>{t('yc.np.p.sub')}</span>
      </header>
      {q.isError ? <CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} />
        : !d ? <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}><Skel h={140} r={24} /><Skel h={220} r={24} /></div>
          : (
            <>
              <section style={card}>
                <h2 style={h2}>{t('yc.np.p.live')}</h2>
                {d.live.length ? d.live.map((r, i) => <LiveRow key={r.event.id} r={r} first={i === 0} T={T} />) : <span style={muted}>{t('yc.np.p.liveEmpty')}</span>}
              </section>
              <section style={card}>
                <h2 style={h2}>{t('yc.np.p.todo')}</h2>
                {d.todo.length ? d.todo.map((r, i) => <TodoRow key={r.event.id} r={r} first={i === 0} T={T} />) : <span style={muted}>{t('yc.np.p.todoEmpty')}</span>}
              </section>
              {d.past.length > 0 && (
                <section style={card}>
                  <h2 style={h2}>{t('yc.np.p.past')}</h2>
                  {d.past.map((r, i) => <LiveRow key={r.event.id} r={r} first={i === 0} T={T} />)}
                </section>
              )}
            </>
          )}
    </main>
  );
}

function Poster({ url }: { url: string | null }) {
  return (
    <div style={{ width: 56, height: 56, flex: 'none', borderRadius: 14, overflow: 'hidden', background: 'var(--sand-100)' }}>
      {url && <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
    </div>
  );
}

function LiveRow({ r, first, T }: { r: PlansListRow; first: boolean; T: T }) {
  const { t, tp, n, dWeek, time } = T;
  const status = r.status ?? 'active';
  const tone = status === 'active' ? 'live' : status === 'setup' ? 'todo' : status === 'paused' ? 'warn' : 'done';
  const label = status === 'setup' ? t('yc.np.s.setup') : t(`yc.np.st.${status}`);
  const sub = [
    `${dWeek(r.event.start_at)} · ${time(r.event.start_at)}`,
    r.next_at ? t('yc.np.live.next', { d: `${dWeek(r.next_at)} · ${time(r.next_at)}` }) : null,
    r.sent ? tp('yc.np.p.sent', r.sent, { n: n(r.sent) }) : null,
    r.contacted?.buyers ? tp('yc.np.p.buyers', r.contacted.buyers, { n: n(r.contacted.buyers) }) : null,
  ].filter(Boolean).join(' · ');
  return (
    <Link to={CRM_ROUTES.plan(r.event.id)} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderTop: first ? 0 : '1px solid var(--sand-100)', color: 'var(--ink)', textDecoration: 'none' }}>
      <Poster url={r.event.cover_url} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 15.5, fontWeight: 600, overflowWrap: 'anywhere' }}>{r.event.title}</span>
        <span style={{ fontSize: 13.5, color: 'var(--sand-600)' }}>{sub}</span>
      </div>
      <Badge tone={tone}>{label}</Badge>
    </Link>
  );
}

function TodoRow({ r, first, T }: { r: PlansListRow; first: boolean; T: T }) {
  const { t, tp, n, dWeek, time } = T;
  const days = r.days_left ?? 0;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14, padding: '12px 0', borderTop: first ? 0 : '1px solid var(--sand-100)' }}>
      <Poster url={r.event.cover_url} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: '1 1 220px' }}>
        <span style={{ fontSize: 15.5, fontWeight: 600, overflowWrap: 'anywhere' }}>{r.event.title}</span>
        <span style={{ fontSize: 13.5, color: 'var(--sand-600)' }}>
          {dWeek(r.event.start_at)} · {time(r.event.start_at)} · {days === 0 ? t('yc.np.p.today') : tp('yc.np.p.days', days, { n: n(days) })}
        </span>
      </div>
      <PillButton size="sm" tone="dark" to={`${CRM_ROUTES.nights}?e=${encodeURIComponent(r.event.id)}&v=target`}>{t('yc.np.p.prepare')}</PillButton>
    </div>
  );
}
