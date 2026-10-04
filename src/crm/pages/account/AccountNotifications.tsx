/**
 * Compte › Notifications : heures calmes (frise 24 h + deux sélecteurs) et la
 * grille « Que voulez-vous recevoir ? » (e-mail / dans Yuno). Chaque geste
 * s'enregistre tout de suite (crm_notif_prefs_set) ; la pastille de l'en-tête
 * passe à « Enregistré ». Les alertes verrouillées ne se coupent pas, et le
 * serveur le refuse de toute façon.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Skel } from '@/crm/ui/kit';
import { EASE } from '@/crm/ui/motion';
import { useCrmToast } from '@/crm/ui/toast';
import { useCrmT } from '@/crm/i18n';
import { useNotifPrefs, useSaveNotifPrefs, type NotifKind, type NotifPrefs } from '@/crm/data/account';
import { Card, InkSwitch } from './accountUi';

type Row = { g: string } | { k: NotifKind; sel?: boolean };
const ROWS: Row[] = [
  { g: 'yc.acc.n.g.send' }, { k: 'rapport' }, { k: 'prog' }, { k: 'bloque' }, { k: 'solde', sel: true },
  { g: 'yc.acc.n.g.data' }, { k: 'sync' }, { k: 'import' },
  { g: 'yc.acc.n.g.account' }, { k: 'facture' }, { k: 'equipe' }, { k: 'secu' }, { k: 'digest' },
];
const THRESHOLDS = [1000, 2000, 5000, 10000];
const H = (h: number) => `${String(h).padStart(2, '0')}:00`;

function SavedPill({ saved }: { saved: boolean }) {
  const { t } = useCrmT();
  return (
    <span role="status" style={{ flex: 'none', height: 36, padding: '0 14px', borderRadius: 99, background: saved ? 'var(--green-50)' : 'var(--sand-100)', color: saved ? 'var(--green-700)' : 'var(--sand-600)', fontSize: 13.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, transition: 'background 300ms,color 300ms' }}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M20 6 9 17l-5-5" style={{ strokeDasharray: 24, strokeDashoffset: saved ? 0 : 24, transition: `stroke-dashoffset 420ms ${EASE}` }} />
      </svg>
      {t(saved ? 'yc.acc.n.saved' : 'yc.acc.n.auto')}
    </span>
  );
}

export function AccountNotifications({ setHeadAction }: { setHeadAction: (n: ReactNode) => void }) {
  const q = useNotifPrefs();
  const [saved, setSaved] = useState(false);
  const timer = useRef<number>();
  useEffect(() => {
    setHeadAction(<SavedPill saved={saved} />);
  }, [saved, setHeadAction]);
  useEffect(() => () => { setHeadAction(null); window.clearTimeout(timer.current); }, [setHeadAction]);
  const onSaved = () => { setSaved(true); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setSaved(false), 2200); };

  if (q.isLoading || !q.data) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <Skel h={260} r={28} />
        <Skel h={620} r={28} />
      </div>
    );
  }
  return <NotifView server={q.data} onSaved={onSaved} />;
}

function NotifView({ server, onSaved }: { server: NotifPrefs; onSaved: () => void }) {
  const { t, n } = useCrmT();
  const toast = useCrmToast();
  const save = useSaveNotifPrefs();
  const [p, setP] = useState<NotifPrefs>(server);
  useEffect(() => { setP(server); }, [server]);

  const push = (next: NotifPrefs, patch: Record<string, unknown>) => {
    setP(next);
    save.mutate(patch, {
      onSuccess: onSaved,
      onError: () => { setP(server); toast(t('yc.acc.n.err')); },
    });
  };
  const toggle = (k: NotifKind, ch: 'm' | 'a') => {
    const c = p.kinds[k];
    if (!c || c.lock) return;
    const nextKind = { ...c, [ch]: !c[ch] };
    push({ ...p, kinds: { ...p.kinds, [k]: nextKind } }, { kinds: { [k]: { m: nextKind.m, a: nextKind.a } } });
  };
  const setQuiet = (patch: Partial<Pick<NotifPrefs, 'quiet_on' | 'quiet_from' | 'quiet_to' | 'low_balance'>>) => push({ ...p, ...patch }, patch);

  const keys = Object.keys(p.kinds) as NotifKind[];
  const active = keys.filter((k) => p.kinds[k].m || p.kinds[k].a).length;
  const a = p.quiet_from;
  const b = p.quiet_to;
  const ranges = !p.quiet_on ? [{ l: a / 24, w: 0 }, { l: 0, w: 0 }]
    : a < b ? [{ l: a / 24, w: (b - a) / 24 }, { l: 0, w: 0 }]
      : a > b ? [{ l: a / 24, w: (24 - a) / 24 }, { l: 0, w: b / 24 }]
        : [{ l: 0, w: 0 }, { l: 0, w: 0 }];
  const selCss = { width: '100%', height: 46, boxSizing: 'border-box', padding: '0 40px 0 14px', borderRadius: 12, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 15, fontVariantNumeric: 'tabular-nums', color: 'var(--ink)', outline: 0, appearance: 'none', WebkitAppearance: 'none', cursor: 'pointer' } as const;
  let idx = 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Card gap={20} style={{ animation: `yc-rise 700ms ${EASE} 40ms both` }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          <span style={{ flex: 'none', width: 44, height: 44, borderRadius: 14, background: 'var(--ink)', color: '#fff', display: 'grid', placeItems: 'center' }}><Icon name="moon" size={20} stroke={2} /></span>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.acc.n.quiet')}</h2>
            <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--sand-500)' }}>{p.quiet_on ? t('yc.acc.n.quietOn', { a: H(a), b: H(b) }) : t('yc.acc.n.quietOff')}</span>
          </div>
          <InkSwitch on={p.quiet_on} onChange={(v) => setQuiet({ quiet_on: v })} label={t('yc.acc.n.quiet')} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, opacity: p.quiet_on ? 1 : 0.45, transition: 'opacity 300ms' }}>
          <div style={{ position: 'relative', height: 44, borderRadius: 12, background: 'var(--sand-50)', boxShadow: 'inset 0 0 0 1px var(--sand-200)', overflow: 'hidden' }}>
            {ranges.map((r, i) => (
              <div key={i} style={{ position: 'absolute', top: 0, bottom: 0, left: `${(r.l * 100).toFixed(3)}%`, width: `${(r.w * 100).toFixed(3)}%`, background: 'var(--ink)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', transition: `left 460ms ${EASE},width 460ms ${EASE}` }}>
                {r.w >= 2 / 24 && <Icon name="moon" size={15} stroke={2} />}
              </div>
            ))}
            {[25, 50, 75].map((x) => <span key={x} style={{ position: 'absolute', top: 0, bottom: 0, left: `${x}%`, width: 1, background: 'rgba(28,21,23,.1)' }} />)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.06em', color: 'var(--sand-400)' }}>
            {['00 h', '06 h', '12 h', '18 h', '24 h'].map((x) => <span key={x}>{x}</span>)}
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 16px', opacity: p.quiet_on ? 1 : 0.45, transition: 'opacity 300ms' }}>
          {([['yc.acc.n.from', 'quiet_from', a], ['yc.acc.n.to', 'quiet_to', b]] as const).map(([lk, field, v]) => (
            <label key={field} style={{ flex: '1 1 160px', display: 'flex', flexDirection: 'column', gap: 7 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sand-700)' }}>{t(lk)}</span>
              <span style={{ position: 'relative', display: 'block' }}>
                <select value={v} disabled={!p.quiet_on} onChange={(e) => setQuiet({ [field]: parseInt(e.target.value, 10) })} className="yc-field" style={{ ...selCss, cursor: p.quiet_on ? 'pointer' : 'not-allowed' }}>
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{H(h)}</option>)}
                </select>
                <Icon name="chevronDown" size={16} stroke={2.2} style={{ position: 'absolute', right: 14, top: 15, pointerEvents: 'none', color: 'var(--sand-400)' }} />
              </span>
            </label>
          ))}
        </div>
      </Card>

      <Card gap={4} style={{ animation: `yc-rise 700ms ${EASE} 130ms both` }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 84px 84px', alignItems: 'end', gap: 8, paddingBottom: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.acc.n.what')}</h2>
            <span style={{ fontSize: 14, color: 'var(--sand-500)', fontVariantNumeric: 'tabular-nums' }}>{t('yc.acc.n.count', { a: active, b: keys.length })}</span>
          </div>
          {([['mail', 'yc.acc.n.mail'], ['bell', 'yc.acc.n.app']] as const).map(([ic, lk]) => (
            <span key={lk} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--sand-500)', textAlign: 'center' }}>
              <Icon name={ic} size={16} stroke={2} />{t(lk)}
            </span>
          ))}
        </div>
        {ROWS.map((r) => {
          if ('g' in r) {
            return <div key={r.g} style={{ padding: '22px 0 8px', fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-400)', borderTop: '1px solid var(--sand-100)' }}>{t(r.g)}</div>;
          }
          const c = p.kinds[r.k];
          if (!c) return null;
          const i = idx++;
          const lock = !!c.lock;
          const hasApp = c.app !== false;
          return (
            <Hv key={r.k} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 84px 84px', alignItems: 'center', gap: 8, padding: 12, margin: '0 -12px', borderRadius: 14, transition: 'background 160ms', animation: `yc-rise 520ms ${EASE} ${180 + i * 45}ms both` }} hover={{ background: 'var(--sand-50)' }}>
              <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 600 }}>
                  {t(`yc.acc.n.${r.k}`)}
                  {lock && <span title={t('yc.acc.n.locked')} style={{ display: 'inline-flex', color: 'var(--sand-400)' }}><Icon name="lock" size={13} stroke={2.4} /></span>}
                </span>
                <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px', fontSize: 13.5, lineHeight: 1.4, color: 'var(--sand-500)' }}>
                  {t(`yc.acc.n.${r.k}D`)}
                  {r.sel && (
                    <span style={{ position: 'relative', display: 'inline-block' }}>
                      <select value={p.low_balance} onChange={(e) => setQuiet({ low_balance: parseInt(e.target.value, 10) })} aria-label={t('yc.acc.n.soldeD')} className="yc-field" style={{ height: 28, padding: '0 26px 0 10px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 13, fontWeight: 600, color: 'var(--ink)', appearance: 'none', WebkitAppearance: 'none', outline: 0, cursor: 'pointer', fontVariantNumeric: 'tabular-nums' }}>
                        {THRESHOLDS.map((v) => <option key={v} value={v}>{t('yc.acc.n.threshold', { n: n(v) })}</option>)}
                      </select>
                      <Icon name="chevronDown" size={12} stroke={2.6} style={{ position: 'absolute', right: 9, top: 8, pointerEvents: 'none', color: 'var(--sand-500)' }} />
                    </span>
                  )}
                </span>
              </div>
              <span style={{ display: 'grid', placeItems: 'center' }}>
                <InkSwitch size="sm" on={c.m} onChange={() => toggle(r.k, 'm')} disabled={lock} label={`${t(`yc.acc.n.${r.k}`)} · ${t('yc.acc.n.mail')}`} />
              </span>
              <span style={{ display: 'grid', placeItems: 'center' }}>
                {hasApp
                  ? <InkSwitch size="sm" on={c.a} onChange={() => toggle(r.k, 'a')} disabled={lock} label={`${t(`yc.acc.n.${r.k}`)} · ${t('yc.acc.n.app')}`} />
                  : <span style={{ width: 10, height: 2, borderRadius: 2, background: 'var(--sand-300)' }} />}
              </span>
            </Hv>
          );
        })}
      </Card>
    </div>
  );
}
