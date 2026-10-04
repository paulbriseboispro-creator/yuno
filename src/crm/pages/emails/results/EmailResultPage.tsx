/**
 * Résultats d'un e-mail envoyé (`/crm/emails/results/:id`) — « a-t-il
 * marché ? ». Trois onglets adressables (`?tab=sum|links|who`) : Résumé
 * (ventes, entonnoir, réactions, délivrabilité), Liens et clics,
 * Destinataires. En tête : changer de campagne, dupliquer, relancer les
 * non-ouvreurs. Chiffres : `crm_email_result` (une seule définition, celle
 * de `_crm_email_stats` / `_crm_email_attrib`).
 */
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Portal, Skel } from '@/crm/ui/kit';
import { useCrmToast } from '@/crm/ui/toast';
import { EASE } from '@/crm/ui/motion';
import { useNarrow } from '@/crm/ui/useNarrow';
import { useCrmT } from '@/crm/i18n';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { useEmailResult, useInvalidateEmails, type EmailResult } from '@/crm/data/emails';
import { duplicateCampaigns } from '@/crm/data/emailActions';
import { useEmailHtml } from '../emailHtml';
import { ScaledFrame } from '../ScaledFrame';
import { ResultSummary } from './ResultSummary';
import { ResultLinks } from './ResultLinks';
import { ResultWho, type ResendState } from './ResultWho';
import { ResendModal } from './ResendModal';

type Tab = 'sum' | 'links' | 'who';
const TABS: Tab[] = ['sum', 'links', 'who'];

const main: CSSProperties = { width: '100%', maxWidth: 1280, boxSizing: 'border-box', margin: '0 auto', padding: 'clamp(24px,3vw,36px) clamp(16px,3vw,40px) 72px', display: 'flex', flexDirection: 'column', gap: 26 };
const rise = (d: number): CSSProperties => ({ animation: `yc-rise 800ms ${EASE} ${d}ms both` });

function resendState(r: EmailResult): ResendState {
  if (r.status !== 'sent' || !(r.stats?.non_openers ?? 0)) return r.resend.campaign_id ? 'done' : 'none';
  if (r.resend.campaign_id) return 'done';
  if (r.resend.enabled && !r.resend.done_at) return 'planned';
  if (r.resend.done_at) return 'none';
  return 'open';
}

export default function EmailResultPage() {
  const { id = '' } = useParams();
  const { t } = useCrmT();
  const q = useEmailResult(id);
  const r = q.data;

  if (q.isLoading) return <ResultSkeleton />;
  if (q.isError || !r || r.error === 'not_found') {
    return (
      <main style={main}>
        <BackLink />
        <div style={{ padding: '40px 0', fontSize: 16, color: 'var(--sand-600)' }}>{t('yc.em.rs.notFound')}</div>
      </main>
    );
  }
  if (r.status === 'draft' || r.status === 'scheduled') return <Navigate to={CRM_ROUTES.emailStudio(r.id)} replace />;
  return <ResultView key={r.id} r={r} />;
}

function BackLink() {
  const { t } = useCrmT();
  return (
    <Hv as={Link} to={`${CRM_ROUTES.emailCampaigns}?s=sent`} style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14.5, fontWeight: 600, color: 'var(--sand-600)', textDecoration: 'none', ...rise(60) }} hover={{ color: 'var(--ink)', textDecoration: 'none' }}>
      <Icon name="arrowLeft" size={16} stroke={2.4} />{t('yc.em.rs.all')}
    </Hv>
  );
}

function ResultView({ r }: { r: EmailResult }) {
  const { t, tp, n, dLong, time } = useCrmT();
  const nav = useNavigate();
  const toast = useCrmToast();
  const invalidate = useInvalidateEmails();
  const [sp, setSp] = useSearchParams();
  const tab = (TABS.includes(sp.get('tab') as Tab) ? sp.get('tab') : 'sum') as Tab;
  const setTab = (v: Tab) => setSp((p) => { const x = new URLSearchParams(p); if (v === 'sum') x.delete('tab'); else x.set('tab', v); return x; }, { replace: true });
  const html = useEmailHtml(r.id);
  const [zoom, setZoom] = useState(false);
  const [resendOpen, setResendOpen] = useState(false);
  const [dupBusy, setDupBusy] = useState(false);
  const name = r.name || r.subject || '—';
  const sent = r.sent_at ? new Date(r.sent_at) : null;
  const s = r.stats;
  const nonOpeners = s?.non_openers ?? 0;
  const resend = resendState(r);
  const narrow = useNarrow(640);

  const dup = async () => {
    if (dupBusy) return;
    setDupBusy(true);
    try {
      const [copy] = await duplicateCampaigns([r.id], t('yc.em.ca.copy'));
      invalidate();
      toast(t('yc.em.rs.dupDone'));
      if (copy) nav(CRM_ROUTES.emailStudio(copy));
    } catch {
      toast(t('yc.em.ca.t.err'));
    } finally {
      setDupBusy(false);
    }
  };

  const picks = [{ id: r.id, name }, ...r.others.filter((o) => o.id !== r.id).map((o) => ({ id: o.id, name: o.name || '—' }))];

  return (
    <main style={main}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <BackLink />
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px 24px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, flex: '1 1 420px' }}>
            {sent && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)', ...rise(120) }}>{t('yc.em.rs.kick', { date: dLong(sent), time: time(sent) })}</span>}
            <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,3vw,36px)', lineHeight: 1.05, letterSpacing: '-.035em', textWrap: 'balance', overflowWrap: 'anywhere', ...rise(190) }}>
              {t('yc.em.rs.h.a', { name })}
              <span style={{ background: 'var(--gradient-brand)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{t('yc.em.rs.h.b')}</span>
              {t('yc.em.rs.h.c', { name })}
            </h1>
            {s && <p style={{ margin: 0, fontSize: 16, lineHeight: 1.45, fontWeight: 500, color: 'var(--sand-600)', maxWidth: 660, textWrap: 'pretty', overflowWrap: 'anywhere', ...rise(260) }}>{tp('yc.em.rs.sub', s.n, { n: n(s.n), subject: r.subject ?? '' })}</p>}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, ...rise(320) }}>
            {picks.length > 1 && (
              <select
                value={r.id}
                onChange={(e) => nav(CRM_ROUTES.emailResults(e.target.value))}
                aria-label={t('yc.em.rs.pick')}
                style={{ height: 44, maxWidth: 240, padding: '0 36px 0 16px', borderRadius: 99, border: '1px solid var(--sand-200)', background: "#fff url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23A39A98' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\") no-repeat right 14px center", fontSize: 14.5, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none', textOverflow: 'ellipsis' }}
              >
                {picks.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            )}
            <Hv as="button" type="button" onClick={dup} disabled={dupBusy} style={{ height: 44, padding: '0 18px', borderRadius: 99, background: '#fff', border: '1px solid var(--sand-200)', color: 'var(--ink)', fontSize: 14.5, fontWeight: 600, display: 'flex', alignItems: 'center', cursor: 'pointer', opacity: dupBusy ? 0.6 : 1 }} hover={{ borderColor: 'var(--sand-300)' }}>
              {t('yc.em.rs.dup')}
            </Hv>
            {resend === 'open' && (
              <Hv as="button" type="button" onClick={() => setResendOpen(true)} style={{ height: 44, padding: '0 5px 0 18px', borderRadius: 99, border: 0, background: 'var(--gradient-brand)', color: '#fff', fontSize: 14.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 10, boxShadow: 'var(--shadow-cta)', whiteSpace: 'nowrap', cursor: 'pointer' }} hover={{ filter: 'brightness(1.05)' }}>
                {tp('yc.em.rs.resendBtn', nonOpeners, { n: n(nonOpeners) })}
                <span style={{ width: 34, height: 34, borderRadius: 99, background: '#fff', color: 'var(--red-500)', display: 'grid', placeItems: 'center' }}><Icon name="arrowRight" size={15} stroke={2.4} /></span>
              </Hv>
            )}
            {resend === 'planned' && (
              <span style={{ height: 44, padding: '0 18px', borderRadius: 99, background: 'var(--green-50)', color: 'var(--green-700)', fontSize: 14.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}><Icon name="clock" size={16} stroke={2.2} />{t('yc.em.rs.resendPlanned')}</span>
            )}
            {resend === 'done' && r.resend.campaign_id && (
              <Hv as={Link} to={CRM_ROUTES.emailResults(r.resend.campaign_id)} style={{ height: 44, padding: '0 18px', borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 14.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none' }} hover={{ background: 'var(--sand-700)', color: '#fff', textDecoration: 'none' }}>
                {t('yc.em.rs.resendDone')}<Icon name="arrowRight" size={15} stroke={2.4} />
              </Hv>
            )}
          </div>
        </div>
        <div style={rise(360)}>
          <div role="tablist" aria-label={t('yc.em.rs.tabs')} className="yc-thin-scroll" style={{ display: 'inline-flex', padding: 3, gap: 2, background: 'var(--sand-100)', borderRadius: 99, maxWidth: '100%', overflowX: 'auto', boxSizing: 'border-box' }}>
            {TABS.map((k) => {
              const on = k === tab;
              return (
                <button key={k} type="button" role="tab" aria-selected={on} onClick={() => setTab(k)} style={{ flex: 'none', height: 40, padding: narrow ? '0 13px' : '0 20px', border: 0, borderRadius: 99, background: on ? '#fff' : 'transparent', boxShadow: on ? 'var(--shadow-xs)' : 'none', fontSize: 14.5, fontWeight: 600, color: on ? 'var(--ink)' : 'var(--sand-600)', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background 160ms,color 160ms' }}>
                  {t(`yc.em.rs.tab.${k}`)}
                </button>
              );
            })}
          </div>
        </div>
        {r.status === 'sending' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 16, background: 'var(--amber-50)', color: 'var(--amber-700)', fontSize: 14.5, fontWeight: 500 }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: 'currentColor', animation: 'yc-pulse 1.4s ease-in-out infinite' }} />{t('yc.em.rs.sending')}
          </div>
        )}
      </div>

      {s && tab === 'sum' && <ResultSummary r={r} s={s} html={html.data} onZoom={() => setZoom(true)} />}
      {tab === 'links' && <ResultLinks r={r} />}
      {tab === 'who' && <ResultWho r={r} resend={resend} onResend={() => setResendOpen(true)} />}

      {zoom && html.data && <ZoomPreview html={html.data} onClose={() => setZoom(false)} />}
      {resendOpen && <ResendModal r={r} onClose={() => setResendOpen(false)} />}
    </main>
  );
}

function ZoomPreview({ html, onClose }: { html: string; onClose: () => void }) {
  const { t } = useCrmT();
  const [dev, setDev] = useState<'desk' | 'mob'>(() => (typeof window !== 'undefined' && window.innerWidth < 700 ? 'mob' : 'desk'));
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <Portal>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('yc.em.rs.zoomLabel')}
        style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '24px 16px', boxSizing: 'border-box' }}
      >
        <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(26,20,18,.55)', animation: 'yc-fade 200ms both' }} />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10, animation: `yc-pop 260ms ${EASE} both` }}>
          <div role="group" aria-label={t('yc.em.tp.m.device')} style={{ display: 'inline-flex', padding: 3, gap: 2, background: '#fff', borderRadius: 99 }}>
            {(['desk', 'mob'] as const).map((d) => (
              <button key={d} type="button" onClick={() => setDev(d)} aria-pressed={dev === d} style={{ height: 36, padding: '0 16px', border: 0, borderRadius: 99, background: dev === d ? 'var(--ink)' : 'transparent', fontSize: 14, fontWeight: 600, color: dev === d ? '#fff' : 'var(--sand-600)', cursor: 'pointer' }}>
                {t(`yc.em.tp.m.${d}`)}
              </button>
            ))}
          </div>
          <button type="button" onClick={onClose} autoFocus aria-label={t('yc.em.tp.m.close')} style={{ width: 42, height: 42, border: 0, borderRadius: 99, background: '#fff', color: 'var(--ink)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
            <Icon name="x" size={16} stroke={2.4} />
          </button>
        </div>
        <div style={{ position: 'relative', flex: 1, minHeight: 0, width: dev === 'mob' ? 375 : 680, maxWidth: '100%', borderRadius: 20, overflow: 'hidden', background: '#fff', boxShadow: 'var(--shadow-md)', transition: `width 300ms ${EASE}`, animation: `yc-pop 280ms ${EASE} both` }}>
          <ScaledFrame html={html} title={t('yc.em.rs.zoomLabel')} mobile={dev === 'mob'} />
        </div>
      </div>
    </Portal>
  );
}

function ResultSkeleton() {
  return (
    <main style={main}>
      <Skel w={160} h={18} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Skel w={260} h={14} />
        <Skel w="min(560px,90%)" h={38} r={12} />
        <Skel w={340} h={16} />
      </div>
      <Skel w={330} h={46} r={99} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
        <div style={{ flex: '1.5 1 520px' }}><Skel h={420} r={28} /></div>
        <div style={{ flex: '1 1 300px', maxWidth: 420 }}><Skel h={420} r={28} /></div>
      </div>
      <Skel h={360} r={28} />
    </main>
  );
}
