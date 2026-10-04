/**
 * Connecteurs (maquette « Connecteurs.dc.html ») : `/crm/connectors`.
 *
 *   liste      la carte Shotgun (non connecté · connecté · synchro interrompue)
 *   ?v=wizard  l'assistant : Préparer → Coller (ID + jeton) → Importer (en direct)
 *              `&r=1` = remplacer le jeton d'une connexion existante
 *   ?v=manage  la gestion : relire, remplacer le jeton, soirées co-organisées,
 *              déconnecter, tout supprimer
 *
 * Lecture : get_my_ticketing_connections (titulaire du compte seulement ; les
 * autres rôles voient l'état depuis la coquille, sans bouton). Actions : edge
 * affiliate-ticket-sync (ticketing_*). Rien ne s'écrit chez Shotgun.
 */
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Modal, Skel, useCrmToast } from '@/crm/ui/kit';
import { EASE, SPRING, useProgress } from '@/crm/ui/motion';
import { Rich } from '@/crm/ui/Rich';
import { YunitFace } from '@/crm/ui/YunitFace';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import { useCrmShell } from '@/crm/data/shell';
import {
  connState, setCohosted, ticketingAction, ticketingErrorKey, useInvalidateTicketing, useTicketingConnection,
} from '@/crm/data/connectors';
import type { ConnState, TicketingConnection } from '@/crm/data/connectors';
import { CRM_ROUTES } from '@/crm/shell/nav';
import shotgunLogo from '@/crm/assets/shotgun-logo.webp';

const SMARTBOARD = 'https://smartboard.shotgun.live';
const P = {
  arrow: 'M5 12h14M13 6l6 6-6 6',
  back: 'M19 12H5M11 18l-6-6 6-6',
  alert: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01',
  shield: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
  plus: 'M5 12h14M12 5v14',
  check: 'M5 12l5 5L20 7',
  ext: 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  lock: 'M7 11V7a5 5 0 0 1 10 0v4M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z',
  eye: 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20',
  sync: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5',
  nights: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  tickets: 'M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2ZM13 5v2M13 17v2M13 11v2',
  buyers: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
} as const;

const PILL: Record<ConnState | 'kept', [string, string, string]> = {
  on: ['var(--green-50)', 'var(--green-700)', 'yc.co.pill.on'],
  broken: ['var(--red-50)', 'var(--red-700)', 'yc.co.pill.broken'],
  off: ['var(--sand-100)', 'var(--sand-600)', 'yc.co.pill.off'],
  kept: ['var(--sand-100)', 'var(--sand-600)', 'yc.co.pill.kept'],
};

const CARD: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 24, padding: 'clamp(20px,2.4vw,32px)', borderRadius: 28,
  background: 'radial-gradient(60% 50% at 100% 0%,rgba(255,107,53,.07),transparent 70%),#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)',
};
const LOGO = (size: number, r: number): CSSProperties => ({ flex: 'none', width: size, height: size, borderRadius: r, display: 'block', boxShadow: '0 0 0 1px rgba(28,21,23,.08),var(--shadow-xs)' });
const ENTER = { animation: `yc-rise 700ms ${EASE} both` };

export default function ConnectorsPage() {
  const T = useCrmT();
  const { t } = T;
  const [sp, setSp] = useSearchParams();
  const q = useTicketingConnection();
  const shell = useCrmShell();
  const view = sp.get('v') === 'wizard' ? 'wizard' : sp.get('v') === 'manage' ? 'manage' : 'list';
  const go = (p: Record<string, string> | null) => setSp(p ? new URLSearchParams(p) : new URLSearchParams(), { replace: false });

  const forbidden = !!q.data?.forbidden;
  const conn = q.data?.conn ?? null;
  // Un rôle sans accès lit l'état dans la coquille.
  const shellConn = shell.data?.connection ?? null;
  const state: ConnState = forbidden
    ? (!shellConn ? 'off' : shellConn.state === 'broken' ? 'broken' : shellConn.status === 'disconnected' ? 'off' : 'on')
    : connState(conn);
  const kept = !forbidden ? conn?.status === 'disconnected' : shellConn?.status === 'disconnected';

  return (
    <main style={{ flex: 1, width: '100%', maxWidth: 1280, margin: '0 auto', padding: 'clamp(24px,3vw,36px) clamp(16px,3vw,40px) 96px', display: 'flex', flexDirection: 'column', gap: 28, boxSizing: 'border-box' }}>
      {q.isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Skel w={160} h={14} /><Skel w="50%" h={38} /><Skel h={300} r={28} />
        </div>
      ) : view === 'wizard' && !forbidden ? (
        <Wizard conn={conn} replace={sp.get('r') === '1'} step={Number(sp.get('s')) || 1} go={go} />
      ) : view === 'manage' && !forbidden && conn ? (
        <Manage conn={conn} state={state} go={go} />
      ) : (
        <ListView conn={conn} state={state} kept={!!kept} forbidden={forbidden} lastOk={forbidden ? shellConn?.last_ok_at ?? null : conn?.last_ok_at ?? null} go={go} t={t} />
      )}
    </main>
  );
}

// ── Utilitaires ───────────────────────────────────────────────────────────

function useAgo() {
  const { t, tp } = useCrmT();
  return (iso: string | null) => {
    if (!iso) return '';
    const m = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60_000));
    if (m < 60) return t('yc.co.dur.min', { n: m });
    const h = Math.round(m / 60);
    if (h < 48) return t('yc.co.dur.h', { n: h });
    const d = Math.round(h / 24);
    return tp('yc.co.dur.d', d);
  };
}

function useWhen() {
  const { time, dShort } = useCrmT();
  return (iso: string | null) => {
    if (!iso) return { today: true, v: '—' };
    const today = new Date(iso).toDateString() === new Date().toDateString();
    return { today, v: today ? time(iso) : dShort(iso) };
  };
}

function BackLink({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Hv
      as="button"
      type="button"
      onClick={onClick}
      style={{ height: 36, padding: '0 14px 0 8px', border: 0, borderRadius: 99, background: 'none', color: 'var(--sand-600)', fontSize: 14.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', alignSelf: 'flex-start' }}
      hover={{ background: 'var(--sand-100)', color: 'var(--ink)' }}
    >
      <Icon d={P.back} size={16} stroke={2.4} />{label}
    </Hv>
  );
}

function GradientCta({ children, onClick, to, disabled, busy }: { children: ReactNode; onClick?: () => void; to?: string; disabled?: boolean; busy?: boolean }) {
  const ok = !disabled && !busy;
  const style: CSSProperties = {
    height: 46, padding: `0 ${ok ? 5 : 22}px 0 22px`, border: 0, borderRadius: 99, background: ok ? 'var(--gradient-brand)' : 'var(--sand-100)',
    color: ok ? '#fff' : 'var(--sand-500)', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 12,
    boxShadow: ok ? 'var(--shadow-cta)' : 'none', cursor: ok ? 'pointer' : busy ? 'progress' : 'not-allowed', whiteSpace: 'nowrap', textDecoration: 'none',
    transition: `transform 200ms ${SPRING},filter 160ms,background 200ms`,
  };
  const inner = (
    <>
      {children}
      {ok && <span style={{ width: 36, height: 36, borderRadius: 99, background: '#fff', color: 'var(--red-500)', display: 'grid', placeItems: 'center' }}><Icon d={P.arrow} size={16} stroke={2.4} /></span>}
      {busy && <span style={{ width: 18, height: 18, borderRadius: 99, border: '2.5px solid var(--sand-300)', borderTopColor: 'var(--ink)', animation: 'yc-spin 700ms linear infinite' }} />}
    </>
  );
  const hover = ok ? { filter: 'brightness(1.05)', transform: 'translateY(-1px)', color: '#fff', textDecoration: 'none' } : undefined;
  const active = ok ? { transform: 'scale(.97)' } : undefined;
  return to
    ? <Hv as={Link} to={to} style={style} hover={hover} active={active}>{inner}</Hv>
    : <Hv as="button" type="button" onClick={onClick} aria-disabled={!ok} style={style} hover={hover} active={active}>{inner}</Hv>;
}

function Toggle({ on }: { on: boolean }) {
  return (
    <span style={{ flex: 'none', position: 'relative', width: 44, height: 26, borderRadius: 99, background: on ? 'var(--ink)' : 'var(--sand-300)', transition: 'background 180ms' }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: 99, background: '#fff', boxShadow: '0 1px 3px rgba(28,21,23,.25)', transition: `left 200ms ${SPRING}` }} />
    </span>
  );
}

function StatusPill({ state, kept }: { state: ConnState; kept: boolean }) {
  const { t } = useCrmT();
  const [bg, fg, k] = PILL[state === 'off' && kept ? 'kept' : state];
  return (
    <span style={{ height: 24, padding: '0 10px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, background: bg, color: fg }}>
      <span style={{ width: 6, height: 6, borderRadius: 99, background: 'currentColor' }} />{t(k)}
    </span>
  );
}

function Reassure() {
  const { t } = useCrmT();
  return (
    <aside style={{
      flex: '1 1 300px', minWidth: 0, position: 'relative', overflow: 'hidden', isolation: 'isolate', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 20, padding: 28, borderRadius: 28,
      color: 'var(--text-on-night)', background: 'radial-gradient(90% 70% at 100% 110%,rgba(227,20,27,.38),transparent 65%),radial-gradient(60% 45% at 0% 0%,rgba(255,107,53,.14),transparent 70%),var(--noise-night),var(--night)',
      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.06)',
    }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-on-night-2)' }}>{t('yc.co.re.k')}</span>
      {[1, 2, 3, 4].map((i) => (
        <div key={i} style={{ display: 'flex', gap: 14 }}>
          <span style={{ flex: 'none', width: 28, height: 28, borderRadius: 99, background: 'rgba(255,255,255,.1)', boxShadow: 'inset 0 0 0 1px var(--border-night)', display: 'grid', placeItems: 'center', color: '#7CE0A2' }}>
            <Icon d={P.check} size={14} stroke={2.6} />
          </span>
          <span style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--text-on-night-2)', textWrap: 'pretty' }}>
            <b style={{ fontWeight: 600, color: '#fff' }}>{t(`yc.co.re${i}b`)}</b> {t(`yc.co.re${i}t`)}
          </span>
        </div>
      ))}
    </aside>
  );
}

// ── Liste ─────────────────────────────────────────────────────────────────

function ListView({ conn, state, kept, forbidden, lastOk, go, t }: {
  conn: TicketingConnection | null; state: ConnState; kept: boolean; forbidden: boolean; lastOk: string | null;
  go: (p: Record<string, string> | null) => void; t: (k: string, v?: Record<string, string | number>) => string;
}) {
  const { n } = useCrmT();
  const ago = useAgo();
  const when = useWhen();
  const off = state === 'off', on = state === 'on', broken = state === 'broken';
  const importing = on && !!conn && (!conn.initial_import_done_at || conn.running);
  const w = when(lastOk);
  const line = off ? t(kept ? 'yc.co.line.kept' : 'yc.co.line.off')
    : broken ? (lastOk ? t(w.today ? 'yc.co.line.broken' : 'yc.co.line.brokenDay', { time: w.v, date: w.v }) : t('yc.co.line.brokenNever'))
      : importing ? t('yc.co.line.importing') : t(w.today ? 'yc.co.line.on' : 'yc.co.line.onDay', { time: w.v, date: w.v });
  const stats = conn?.stats ?? null;
  const showNum = !off && !!stats;
  const cols = [
    { k: 'nights', d: P.nights, v: stats?.events },
    { k: 'tickets', d: P.tickets, v: stats?.tickets },
    { k: 'buyers', d: P.buyers, v: stats?.buyers },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28, ...ENTER }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.co.kick')}</span>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,3vw,36px)', lineHeight: 1.05, letterSpacing: '-.035em' }}>{t('yc.co.h1')}</h1>
        <p style={{ margin: 0, maxWidth: 640, fontSize: 16, lineHeight: 1.45, fontWeight: 500, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t('yc.co.sub')}</p>
      </div>
      <section style={CARD}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '20px 24px' }}>
          <img src={shotgunLogo} alt="Shotgun" style={LOGO(64, 16)} />
          <div style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
              <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, letterSpacing: '-.03em', lineHeight: 1 }}>Shotgun</h2>
              <StatusPill state={state} kept={kept} />
            </div>
            <span style={{ fontSize: 15, lineHeight: 1.45, color: 'var(--sand-600)', textWrap: 'pretty' }}>{line}</span>
          </div>
          {!forbidden && (
            <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              {off && <span style={{ fontSize: 13.5, color: 'var(--sand-500)' }}>{t('yc.co.duration')}</span>}
              {off && <GradientCta onClick={() => go({ v: 'wizard', s: '1' })}>{t('yc.co.connect')}</GradientCta>}
              {broken && (
                <Hv as="button" type="button" onClick={() => go({ v: 'wizard', s: '2', r: '1' })} style={{ height: 46, padding: '0 22px', border: 0, borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }} hover={{ background: 'var(--sand-700)' }}>
                  {t('yc.co.reconnect')}
                </Hv>
              )}
              {(broken || on) && (
                <Hv as="button" type="button" onClick={() => go({ v: 'manage' })} style={{ height: 46, padding: on ? '0 20px' : '0 18px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', color: 'var(--ink)', fontSize: 15, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: on ? 'var(--shadow-xs)' : 'none' }} hover={{ borderColor: 'var(--sand-300)', background: 'var(--paper)' }}>
                  {t(on ? 'yc.co.manageConn' : 'yc.co.manage')}
                </Hv>
              )}
            </div>
          )}
        </div>
        {broken && (
          <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderRadius: 16, background: 'var(--red-50)', boxShadow: 'inset 0 0 0 1px var(--red-200)', fontSize: 14.5, lineHeight: 1.45, color: 'var(--red-700)' }}>
            <Icon d={P.alert} size={18} stroke={2} />
            <span><Rich text={t('yc.co.broken.alert', { d: ago(lastOk) || '—' })} /></span>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,230px),1fr))', gap: 12 }}>
          {cols.map((c) => (
            <div key={c.k} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '18px 20px', borderRadius: 20, background: 'var(--sand-50)', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ flex: 'none', width: 34, height: 34, borderRadius: 10, background: '#fff', color: 'var(--sand-700)', display: 'grid', placeItems: 'center', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}><Icon d={c.d} size={17} stroke={2} /></span>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{t(`yc.co.col.${c.k}`)}</span>
              </div>
              {showNum && <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 36, lineHeight: 1, letterSpacing: '-.035em', fontVariantNumeric: 'tabular-nums' }}>{n(c.v ?? 0)}</span>}
              <span style={{ fontSize: 13.5, lineHeight: '19px', color: 'var(--sand-600)', textWrap: 'pretty' }}>{t(`yc.co.col.${c.k}S`)}</span>
            </div>
          ))}
        </div>
        {(off || forbidden) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, color: 'var(--sand-600)' }}>
            <Icon d={forbidden ? P.lock : P.shield} size={16} stroke={2} color="var(--sand-500)" />
            <span>{t(forbidden ? 'yc.co.ownerOnly' : 'yc.co.readOnly')}</span>
          </div>
        )}
      </section>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--sand-500)' }}>
        <Icon d={P.plus} size={16} stroke={2} />{t('yc.co.more')}
      </div>
    </div>
  );
}

// ── Assistant ─────────────────────────────────────────────────────────────

function Wizard({ conn, replace, step, go }: { conn: TicketingConnection | null; replace: boolean; step: number; go: (p: Record<string, string> | null) => void }) {
  const T = useCrmT();
  const { t } = T;
  const toast = useCrmToast();
  const { space } = useCrmScope();
  const invalidate = useInvalidateTicketing();
  const q = useTicketingConnection();
  const [id, setId] = useState(replace ? conn?.external_org_id ?? '' : '');
  const [tok, setTok] = useState('');
  const [showTok, setShowTok] = useState(false);
  const [co, setCo] = useState(conn?.include_cohosted ?? true);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const s = step === 3 ? 3 : step === 2 ? 2 : 1;

  const idv = id.trim(), tk = tok.trim();
  const idOk = /^[A-Za-z0-9_-]{1,40}$/.test(idv);
  const tokOk = tk.length >= 12 && !/\s/.test(tk);
  const idBad = touched && !!idv && !idOk;
  const tokBad = touched && !!tk && !tokOk;
  const ok = idOk && tokOk && !busy;

  // Import en direct : relire la connexion tant que l'historique arrive.
  const live = q.data?.conn ?? conn;
  const importing = s === 3 && (!live?.initial_import_done_at || !!live?.running);
  useEffect(() => {
    if (s !== 3) return;
    const h = window.setInterval(() => { void q.refetch(); }, 3000);
    return () => window.clearInterval(h);
  }, [s, q]);

  const connect = async () => {
    if (!ok) { setTouched(true); return; }
    setBusy(true);
    setErr('');
    const code = await ticketingAction({ venueId: space.venueId, organizerUserId: space.organizerUserId }, 'ticketing_connect', { externalOrgId: idv, token: tk, includeCohosted: co });
    setBusy(false);
    if (code) { setErr(t(ticketingErrorKey(code))); return; }
    setTok('');
    invalidate();
    if (replace) { toast(t('yc.co.t.replaced')); go({ v: 'manage' }); return; }
    go({ v: 'wizard', s: '3' });
  };

  const stepper = [['yc.co.step.prep', 1], ['yc.co.step.paste', 2], ['yc.co.step.import', 3]] as const;
  const head = (title: string, sub: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <img src={shotgunLogo} alt="" style={LOGO(48, 12)} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, letterSpacing: '-.03em', lineHeight: 1.1 }}>{title}</h2>
        <span style={{ fontSize: 14.5, color: 'var(--sand-600)' }}>{sub}</span>
      </div>
    </div>
  );
  const ghost = (label: string, onClick: () => void) => (
    <Hv as="button" type="button" onClick={onClick} style={{ height: 46, padding: '0 6px', border: 0, background: 'none', fontSize: 15, fontWeight: 600, color: 'var(--sand-600)', cursor: 'pointer' }} hover={{ color: 'var(--ink)' }}>{label}</Hv>
  );
  const foot: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 20px', borderTop: '1px solid var(--sand-100)', paddingTop: 22 };
  const field: CSSProperties = { height: 52, boxSizing: 'border-box', padding: '0 16px', borderRadius: 12, background: '#fff', fontFamily: 'var(--font-mono)', fontSize: 16, color: 'var(--ink)', outline: 0, transition: 'border-color 140ms,box-shadow 140ms', width: '100%' };
  const stats = live?.stats ?? null;
  const done = s === 3 && !importing;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, ...ENTER }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <BackLink onClick={() => go(replace ? { v: 'manage' } : null)} label={t('yc.co.back')} />
        <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 10px' }}>
          {stepper.map(([l, k], i) => {
            const cur = s === k;
            const isDone = s > k || (k === 3 && done);
            return (
              <li key={k} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ flex: 'none', width: 28, height: 28, borderRadius: 99, background: isDone ? 'var(--green-500)' : cur ? 'var(--ink)' : 'var(--sand-100)', color: isDone || cur ? '#fff' : 'var(--sand-500)', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 600, transition: 'background 200ms,color 200ms' }}>
                  {isDone ? <Icon d={P.check} size={14} stroke={3} /> : k}
                </span>
                <span style={{ fontSize: 14, fontWeight: cur ? 600 : 500, color: cur ? 'var(--ink)' : 'var(--sand-500)' }}>{t(l)}</span>
                {i < 2 && <span style={{ width: 28, height: 1, background: 'var(--sand-300)', marginLeft: 2 }} />}
              </li>
            );
          })}
        </ol>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
        <section style={{ flex: '1.7 1 520px', minWidth: 0, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 26, padding: 'clamp(22px,2.6vw,36px)', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)' }}>
          {s === 1 && (
            <div key="s1" style={{ display: 'flex', flexDirection: 'column', gap: 26, animation: `yc-rise 600ms ${EASE} both` }}>
              {head(t('yc.co.s1.t'), t('yc.co.s1.s'))}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-400)' }}>{t('yc.co.s1.before')}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 14, background: 'var(--green-50)' }}>
                  <span style={{ flex: 'none', width: 24, height: 24, borderRadius: 99, background: 'var(--green-500)', color: '#fff', display: 'grid', placeItems: 'center' }}><Icon d={P.check} size={13} stroke={3} /></span>
                  <span style={{ flex: 1, fontSize: 14.5, lineHeight: 1.4 }}><b style={{ fontWeight: 600 }}>{t('yc.co.s1.p1b')}</b> <span style={{ color: 'var(--sand-600)' }}>{t('yc.co.s1.p1s')}</span></span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 14, background: 'var(--sand-50)' }}>
                  <span style={{ flex: 'none', width: 24, height: 24, borderRadius: 99, background: '#fff', boxShadow: 'inset 0 0 0 1.5px var(--sand-300)' }} />
                  <span style={{ flex: 1, fontSize: 14.5, lineHeight: 1.4 }}><b style={{ fontWeight: 600 }}>{t('yc.co.s1.p2b')}</b> <span style={{ color: 'var(--sand-600)' }}>{t('yc.co.s1.p2s')}</span></span>
                </div>
              </div>
              <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
                {[1, 2, 3].map((k) => (
                  <li key={k} style={{ display: 'flex', gap: 16 }}>
                    <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <span style={{ width: 32, height: 32, borderRadius: 99, background: 'var(--ink)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 14, fontWeight: 600 }}>{k}</span>
                      {k < 3 && <span style={{ flex: 1, width: 1, background: 'var(--sand-200)', margin: '6px 0' }} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: k === 1 ? 10 : 8, padding: k < 3 ? '3px 0 24px' : '3px 0 0' }}>
                      <span style={{ fontSize: 16, fontWeight: 600 }}>{t(k === 1 ? 'yc.co.s1.a.t' : k === 2 ? 'yc.co.s1.b.t' : 'yc.co.s1.c.t')}</span>
                      {k === 1 && (
                        <>
                          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 500 }}>
                            {(['yc.co.s1.a.p1', 'yc.co.s1.a.p2', 'yc.co.s1.a.p3'] as const).map((p, i) => (
                              <span key={p} style={{ display: 'contents' }}>
                                {i > 0 && <span style={{ color: 'var(--sand-400)' }}>›</span>}
                                <span style={{ height: 30, padding: '0 12px', borderRadius: 99, background: i === 2 ? 'var(--ink)' : 'var(--sand-100)', color: i === 2 ? '#fff' : undefined, display: 'inline-flex', alignItems: 'center' }}>{t(p)}</span>
                              </span>
                            ))}
                          </div>
                          <Hv as="a" href={SMARTBOARD} target="_blank" rel="noopener noreferrer" style={{ alignSelf: 'flex-start', height: 38, padding: '0 14px 0 16px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', color: 'var(--ink)', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none', boxShadow: 'var(--shadow-xs)' }} hover={{ borderColor: 'var(--sand-300)', color: 'var(--ink)', textDecoration: 'none' }}>
                            {t('yc.co.s1.a.btn')}<Icon d={P.ext} size={14} stroke={2.4} />
                          </Hv>
                        </>
                      )}
                      {k === 2 && <span style={{ fontSize: 14.5, lineHeight: 1.45, color: 'var(--sand-600)' }}>{t('yc.co.s1.b.s')} <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, padding: '2px 8px', borderRadius: 8, background: 'var(--sand-100)', color: 'var(--ink)' }}>173027</span></span>}
                      {k === 3 && <span style={{ fontSize: 14.5, lineHeight: 1.45, color: 'var(--sand-600)' }}>{t('yc.co.s1.c.s')}</span>}
                    </div>
                  </li>
                ))}
              </ol>
              <div style={foot}>
                <GradientCta onClick={() => go({ v: 'wizard', s: '2' })}>{t('yc.co.s1.go')}</GradientCta>
                {ghost(t('yc.co.later'), () => go(null))}
              </div>
            </div>
          )}

          {s === 2 && (
            <div key="s2" style={{ display: 'flex', flexDirection: 'column', gap: 24, animation: `yc-rise 600ms ${EASE} both` }}>
              {head(t(replace ? 'yc.co.s2.rt' : 'yc.co.s2.t'), t(replace ? 'yc.co.s2.rs' : 'yc.co.s2.s'))}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{t('yc.co.f.id')}</span>
                  <input
                    value={id}
                    onChange={(e) => { setId(e.target.value); setErr(''); setTouched(true); }}
                    inputMode="numeric" autoComplete="off" spellCheck={false} placeholder="173027"
                    style={{ ...field, border: `1px solid ${idBad ? 'var(--red-400)' : 'var(--sand-200)'}`, boxShadow: idBad ? '0 0 0 3px var(--red-100)' : 'none' }}
                  />
                  <span style={{ fontSize: 13, lineHeight: 1.4, color: idBad ? 'var(--red-600)' : 'var(--sand-500)' }}>{t(idBad ? 'yc.co.f.idBad' : 'yc.co.f.idHint')}</span>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{t('yc.co.f.tok')}</span>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showTok ? 'text' : 'password'}
                      value={tok}
                      onChange={(e) => { setTok(e.target.value); setErr(''); setTouched(true); }}
                      autoComplete="off" spellCheck={false} placeholder={t('yc.co.f.tokPh')}
                      style={{ ...field, padding: '0 52px 0 16px', fontSize: 15, border: `1px solid ${tokBad || err ? 'var(--red-400)' : 'var(--sand-200)'}`, boxShadow: tokBad || err ? '0 0 0 3px var(--red-100)' : 'none' }}
                    />
                    <Hv as="button" type="button" onClick={() => setShowTok((v) => !v)} aria-label={t('yc.co.f.tokEye')} title={t('yc.co.f.tokEye')} style={{ position: 'absolute', top: 8, right: 8, width: 36, height: 36, border: 0, borderRadius: 99, background: 'none', color: 'var(--sand-500)', cursor: 'pointer', display: 'grid', placeItems: 'center' }} hover={{ background: 'var(--sand-100)', color: 'var(--ink)' }}>
                      <Icon d={showTok ? P.eyeOff : P.eye} size={18} stroke={2} />
                    </Hv>
                  </div>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, lineHeight: 1.4, color: tokBad ? 'var(--red-600)' : 'var(--sand-500)' }}>
                    <Icon d={P.lock} size={13} stroke={2.2} />{t(tokBad ? 'yc.co.f.tokBad' : 'yc.co.f.tokHint')}
                  </span>
                </label>
                {!replace && (
                  <Hv as="button" type="button" role="switch" aria-checked={co} onClick={() => setCo((v) => !v)} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', border: 0, borderRadius: 16, background: 'var(--sand-50)', textAlign: 'left', cursor: 'pointer', width: '100%', font: 'inherit', color: 'inherit' }} hover={{ background: 'var(--sand-100)' }}>
                    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{t('yc.co.f.co')}</span>
                      <span style={{ fontSize: 13.5, lineHeight: 1.4, color: 'var(--sand-600)' }}>{t('yc.co.f.coS')}</span>
                    </span>
                    <Toggle on={co} />
                  </Hv>
                )}
              </div>
              {err && (
                <div role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px', borderRadius: 14, background: 'var(--red-50)', boxShadow: 'inset 0 0 0 1px var(--red-200)', fontSize: 14.5, lineHeight: 1.45, color: 'var(--red-700)' }}>
                  <Icon d={P.alert} size={18} stroke={2} style={{ marginTop: 1 }} /><span>{err}</span>
                </div>
              )}
              <div style={foot}>
                <GradientCta onClick={connect} disabled={!idOk || !tokOk} busy={busy}>
                  {busy ? t('yc.co.s2.check') : t(replace ? 'yc.co.s2.replace' : 'yc.co.connect')}
                </GradientCta>
                {ghost(t(replace ? 'yc.co.cancel' : 'yc.co.back2'), () => go(replace ? { v: 'manage' } : { v: 'wizard', s: '1' }))}
              </div>
            </div>
          )}

          {s === 3 && <ImportStep importing={importing} stats={stats} go={go} />}
        </section>
        <Reassure />
      </div>
    </div>
  );
}

function ImportStep({ importing, stats, go }: { importing: boolean; stats: TicketingConnection['stats']; go: (p: Record<string, string> | null) => void }) {
  const { t, n, pct } = useCrmT();
  const p = useProgress(1200, 200, `${stats?.events ?? 0}-${stats?.tickets ?? 0}-${stats?.buyers ?? 0}`);
  const cols = [['yc.co.col.nights', stats?.events ?? 0], ['yc.co.col.tickets', stats?.tickets ?? 0], ['yc.co.col.buyers', stats?.buyers ?? 0]] as const;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 26, animation: `yc-rise 600ms ${EASE} both` }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '18px 22px' }}>
        <YunitFace mood="ravi" size={72} />
        <div style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--green-700)' }}>{t('yc.co.s3.k')}</span>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 28, letterSpacing: '-.03em', lineHeight: 1.1, textWrap: 'balance' }}>{t(importing ? 'yc.co.s3.t' : 'yc.co.s3.td')}</h2>
          <span style={{ fontSize: 14.5, lineHeight: 1.45, color: 'var(--sand-600)' }}>{t(importing ? 'yc.co.s3.s' : 'yc.co.s3.sd')}</span>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ position: 'relative', height: 10, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden' }}>
          {importing
            ? <div style={{ position: 'absolute', top: 0, bottom: 0, width: 120, borderRadius: 99, background: 'var(--gradient-brand)', animation: 'yc-flow 1.6s ease-in-out infinite' }} />
            : <div style={{ width: '100%', height: '100%', borderRadius: 99, background: 'var(--gradient-brand)', transition: `width 600ms ${EASE}` }} />}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, color: 'var(--sand-500)' }}>
          <span>{t(importing ? 'yc.co.s3.running' : 'yc.co.s3.done')}</span>
          {!importing && <span style={{ fontVariantNumeric: 'tabular-nums' }}>{pct(100)}</span>}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,150px),1fr))', gap: 12 }}>
        {cols.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '16px 18px', borderRadius: 18, background: 'var(--sand-50)' }}>
            <span style={{ fontSize: 13.5, color: 'var(--sand-600)' }}>{t(k)}</span>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 34, lineHeight: 1.05, letterSpacing: '-.035em', fontVariantNumeric: 'tabular-nums' }}>{n(v * p)}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderRadius: 16, background: 'var(--red-50)' }}>
        <span style={{ flex: 'none', width: 8, height: 8, borderRadius: 99, background: 'var(--red-500)' }} />
        <span style={{ fontSize: 15, lineHeight: 1.45, fontWeight: 500, textWrap: 'pretty' }}>{t('yc.co.s3.then')}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 20px', borderTop: '1px solid var(--sand-100)', paddingTop: 22 }}>
        <GradientCta to={CRM_ROUTES.home}>{t('yc.co.s3.home')}</GradientCta>
        <Hv as="button" type="button" onClick={() => go({ v: 'manage' })} style={{ height: 46, padding: '0 6px', border: 0, background: 'none', fontSize: 15, fontWeight: 600, color: 'var(--sand-600)', cursor: 'pointer' }} hover={{ color: 'var(--ink)' }}>{t('yc.co.manageConn')}</Hv>
      </div>
    </div>
  );
}

// ── Gestion ───────────────────────────────────────────────────────────────

function Manage({ conn, state, go }: { conn: TicketingConnection; state: ConnState; go: (p: Record<string, string> | null) => void }) {
  const T = useCrmT();
  const { t, n } = T;
  const toast = useCrmToast();
  const { space, rpc: args } = useCrmScope();
  const invalidate = useInvalidateTicketing();
  const q = useTicketingConnection();
  const ago = useAgo();
  const when = useWhen();
  const [co, setCo] = useState(conn.include_cohosted);
  const [syncing, setSyncing] = useState(false);
  const [confirm, setConfirm] = useState<null | 'disc' | 'del'>(null);
  const [working, setWorking] = useState(false);
  const broken = state === 'broken';
  const scope = { venueId: space.venueId, organizerUserId: space.organizerUserId };
  const w = when(conn.last_ok_at);
  const stats = conn.stats ?? {};
  const running = syncing || conn.running;

  useEffect(() => { setCo(conn.include_cohosted); }, [conn.include_cohosted]);
  // Pendant une lecture, la carte se relit toute seule.
  useEffect(() => {
    if (!running) return;
    const h = window.setInterval(() => { void q.refetch(); }, 4000);
    return () => window.clearInterval(h);
  }, [running, q]);

  const syncNow = async () => {
    if (syncing) return;
    setSyncing(true);
    const code = await ticketingAction(scope, 'ticketing_sync_now');
    if (code) { setSyncing(false); toast(t(ticketingErrorKey(code))); return; }
    toast(t('yc.co.t.syncStarted'));
    window.setTimeout(() => { setSyncing(false); invalidate(); }, 8000);
  };

  const toggleCo = async () => {
    const next = !co;
    setCo(next);
    try {
      await setCohosted(args, next);
      toast(t(next ? 'yc.co.m.coOn' : 'yc.co.m.coOff'));
      void q.refetch();
    } catch {
      setCo(!next);
      toast(t('yc.co.err.generic'));
    }
  };

  const doConfirm = async () => {
    if (!confirm) return;
    setWorking(true);
    const code = await ticketingAction(scope, confirm === 'disc' ? 'ticketing_disconnect' : 'ticketing_purge');
    setWorking(false);
    setConfirm(null);
    if (code) { toast(t(ticketingErrorKey(code))); return; }
    toast(t(confirm === 'disc' ? 'yc.co.t.disc' : 'yc.co.t.del'));
    invalidate();
    go(null);
  };

  const row = (label: string, sub: string, right: ReactNode, last = false) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '10px 16px', padding: last ? '16px 0 4px' : '16px 0', borderBottom: last ? 0 : '1px solid var(--sand-100)' }}>
      <span style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-500)' }}>{sub}</span>
      </span>
      {right}
    </div>
  );
  const softBtn = (label: string, onClick: () => void, danger = false) => (
    <Hv as="button" type="button" onClick={onClick} style={{ flex: 'none', height: 40, padding: '0 18px', borderRadius: 99, border: `1px solid ${danger ? 'var(--red-200)' : 'var(--sand-200)'}`, background: '#fff', fontSize: 14.5, fontWeight: 600, cursor: 'pointer', color: danger ? 'var(--red-600)' : 'var(--ink)' }} hover={danger ? { background: 'var(--red-50)' } : { borderColor: 'var(--sand-300)', background: 'var(--paper)' }}>
      {label}
    </Hv>
  );
  const h2: CSSProperties = { margin: '0 0 6px', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' };
  const panel: CSSProperties = { display: 'flex', flexDirection: 'column', padding: 'clamp(20px,2.4vw,28px)', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, ...ENTER }}>
      <BackLink onClick={() => go(null)} label={t('yc.co.back')} />
      <section style={{ ...CARD, gap: 22 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '18px 22px' }}>
          <img src={shotgunLogo} alt="Shotgun" style={LOGO(64, 16)} />
          <div style={{ flex: '1 1 280px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
              <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 30, letterSpacing: '-.035em', lineHeight: 1 }}>Shotgun</h1>
              <StatusPill state={state} kept={conn.status === 'disconnected'} />
            </div>
            <span style={{ fontSize: 14.5, lineHeight: 1.45, color: 'var(--sand-600)' }}>
              {broken
                ? (conn.last_ok_at ? t(w.today ? 'yc.co.line.broken' : 'yc.co.line.brokenDay', { time: w.v, date: w.v }) : t('yc.co.line.brokenNever'))
                : t(w.today ? 'yc.co.m.line' : 'yc.co.m.lineDay', { time: w.v, date: w.v })}
            </span>
          </div>
          <Hv as="button" type="button" onClick={syncNow} disabled={running} style={{ flex: 'none', height: 44, padding: '0 20px 0 16px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', color: 'var(--ink)', fontSize: 14.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: running ? 'default' : 'pointer', boxShadow: 'var(--shadow-xs)', whiteSpace: 'nowrap' }} hover={{ borderColor: 'var(--sand-300)', background: 'var(--paper)' }}>
            <Icon d={P.sync} size={16} stroke={2.2} style={{ animation: running ? 'yc-spin 800ms linear infinite' : 'none' }} />{t(running ? 'yc.co.m.syncing' : 'yc.co.m.sync')}
          </Hv>
        </div>
        {broken && (
          <div role="alert" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 20px', padding: '16px 20px', borderRadius: 20, background: 'var(--red-50)', boxShadow: 'inset 0 0 0 1px var(--red-200)' }}>
            <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--red-800)' }}>{t('yc.co.m.broken.t', { d: ago(conn.last_ok_at) || '—' })}</span>
              <span style={{ fontSize: 14.5, lineHeight: 1.45, color: 'var(--red-700)' }}>{t('yc.co.m.broken.s')}</span>
            </div>
            <Hv as="button" type="button" onClick={() => go({ v: 'wizard', s: '2', r: '1' })} style={{ flex: 'none', height: 44, padding: '0 20px', border: 0, borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer' }} hover={{ background: 'var(--sand-700)' }}>
              {t('yc.co.m.replaceTok')}
            </Hv>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,200px),1fr))', gap: 12 }}>
          {[
            ['yc.co.col.nights', stats.events ?? 0, t('yc.co.m.nightsS')],
            ['yc.co.col.tickets', stats.tickets ?? 0, t('yc.co.m.ticketsS')],
            ['yc.co.col.buyers', stats.buyers ?? 0, t('yc.co.m.buyersS', { n: n(stats.optin_buyers ?? 0) })],
          ].map(([k, v, s]) => (
            <div key={k as string} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '16px 20px', borderRadius: 18, background: 'var(--sand-50)', minWidth: 0 }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--sand-600)' }}>{t(k as string)}</span>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 38, lineHeight: 1.05, letterSpacing: '-.035em', fontVariantNumeric: 'tabular-nums' }}>{n(v as number)}</span>
              <span style={{ fontSize: 13, lineHeight: '18px', color: 'var(--sand-500)' }}>{s}</span>
            </div>
          ))}
        </div>
      </section>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
        <div style={{ flex: '1.7 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <section style={panel}>
            <h2 style={h2}>{t('yc.co.m.settings')}</h2>
            {row(t('yc.co.f.id'), t('yc.co.m.idS'), <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, padding: '6px 12px', borderRadius: 10, background: 'var(--sand-50)' }}>{conn.external_org_id}</span>)}
            {row(t('yc.co.f.tok'), t('yc.co.m.tokS'), (
              <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, padding: '6px 12px', borderRadius: 10, background: 'var(--sand-50)', color: 'var(--sand-600)' }}>•••• •••• {conn.token_hint ?? '••••'}</span>
                <Hv as="button" type="button" onClick={() => go({ v: 'wizard', s: '2', r: '1' })} style={{ height: 36, padding: '0 14px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', color: 'var(--ink)' }} hover={{ borderColor: 'var(--sand-300)', background: 'var(--paper)' }}>
                  {t('yc.co.m.replace')}
                </Hv>
              </span>
            ))}
            <Hv as="button" type="button" role="switch" aria-checked={co} onClick={toggleCo} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 0 4px', border: 0, background: 'none', textAlign: 'left', cursor: 'pointer', width: '100%', font: 'inherit', color: 'inherit' }}>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{t('yc.co.f.co')}</span>
                <span style={{ fontSize: 13.5, lineHeight: 1.4, color: 'var(--sand-500)' }}>{t('yc.co.f.coS')}</span>
              </span>
              <Toggle on={co} />
            </Hv>
          </section>
          <section style={panel}>
            <h2 style={h2}>{t('yc.co.m.stop')}</h2>
            {row(t('yc.co.m.disc'), t('yc.co.m.discS'), softBtn(t('yc.co.m.discBtn'), () => setConfirm('disc')))}
            {row(t('yc.co.m.del'), t('yc.co.m.delS'), softBtn(t('yc.co.m.delBtn'), () => setConfirm('del'), true), true)}
          </section>
        </div>
        <Reassure />
      </div>

      <Modal open={!!confirm} onClose={() => (working ? undefined : setConfirm(null))} width={460} label={confirm ? t(`yc.co.cf.${confirm}.t`) : ''}>
        {confirm && (
          <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.03em', lineHeight: 1.1 }}>{t(`yc.co.cf.${confirm}.t`)}</h2>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t(`yc.co.cf.${confirm}.b`)}</p>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10 }}>
              <Hv as="button" type="button" onClick={() => setConfirm(null)} disabled={working} style={{ height: 44, padding: '0 20px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer', color: 'var(--ink)' }} hover={{ background: 'var(--paper)' }}>{t('yc.co.cancel')}</Hv>
              <Hv as="button" type="button" onClick={doConfirm} disabled={working} style={{ height: 44, padding: '0 22px', border: 0, borderRadius: 99, background: confirm === 'del' ? 'var(--red-500)' : 'var(--ink)', color: '#fff', fontSize: 15, fontWeight: 600, cursor: working ? 'progress' : 'pointer', opacity: working ? 0.7 : 1 }} hover={{ filter: 'brightness(1.1)' }}>
                {t(confirm === 'disc' ? 'yc.co.m.discBtn' : 'yc.co.m.delBtn')}
              </Hv>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
