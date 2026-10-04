/**
 * Notifications (/crm/notifications) : « À faire » (ce qui se bloque si l'on
 * attend, chaque carte part d'elle-même une fois réglée), puis l'historique
 * filtrable (tout, non lues, rappels programmés, archivées), groupé par jour,
 * et le détail d'une notification dans un volet. Raccourcis : J/K, Entrée,
 * E (archiver), U (lu / non lu), Échap.
 *
 * Tout vient de get_crm_notifications (déduit des tables qui font foi) ; les
 * gestes passent par crm_notifications_mark, propres à chaque personne.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Sheet, Skel } from '@/crm/ui/kit';
import { EASE, SPRING, useIntro } from '@/crm/ui/motion';
import { YunitFace } from '@/crm/ui/YunitFace';
import { useCrmToast } from '@/crm/ui/toast';
import { useCrmT } from '@/crm/i18n';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { NOTIF_ICON, NOTIF_TONE_COLORS, notifCopy } from '@/crm/shell/notifCopy';
import { useRelTime } from '@/crm/shell/relTime';
import { useCrmNotifAction, useCrmNotifications, type CrmNotif } from '@/crm/data/notifications';

type Filter = 'all' | 'unread' | 'snz' | 'arc';
type Group = 'today' | 'hier' | 'semaine' | 'ancien';
const PAGE = 15;

function dayGroup(iso: string, now = new Date()): Group {
  const d = new Date(iso);
  const sod = new Date(now); sod.setHours(0, 0, 0, 0);
  if (d >= sod) return 'today';
  if (d >= new Date(sod.getTime() - 86_400_000)) return 'hier';
  if (d >= new Date(sod.getTime() - 6 * 86_400_000)) return 'semaine';
  return 'ancien';
}

/** Les trois rappels du design : dans 1 h, demain 9 h, lundi 9 h (heure de l'appareil). */
function snoozeTargets(now = new Date()): { k: '1h' | 'tom' | 'mon'; at: Date }[] {
  const tom = new Date(now); tom.setDate(tom.getDate() + 1); tom.setHours(9, 0, 0, 0);
  const mon = new Date(now); mon.setDate(mon.getDate() + (((8 - mon.getDay()) % 7) || 7)); mon.setHours(9, 0, 0, 0);
  return [{ k: '1h', at: new Date(now.getTime() + 3_600_000) }, { k: 'tom', at: tom }, { k: 'mon', at: mon }];
}

const visible = (i: CrmNotif) => !i.archived && !(i.snoozed_until && new Date(i.snoozed_until) > new Date());

export default function NotificationsPage() {
  const q = useCrmNotifications(true);
  const T = useCrmT();
  const { t } = T;
  if (q.isLoading) return <Shell><LoadingState /></Shell>;
  if (q.isError || !q.data) {
    return (
      <Shell>
        <Header items={[]} onReadAll={() => undefined} />
        <section role="alert" style={{ ...cardCss, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '18px 24px', padding: '26px 28px', animation: `yc-rise 600ms ${EASE} both` }}>
          <YunitFace mood="inquiet" size={72} />
          <div style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.03em', lineHeight: 1.1 }}>{t('yc.nf.err.t')}</span>
            <span style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t('yc.nf.err.s')}</span>
          </div>
          <Hv as="button" type="button" onClick={() => void q.refetch()} style={{ flex: 'none', height: 48, padding: '0 22px', borderRadius: 99, border: 0, background: 'var(--ink)', color: '#fff', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} hover={{ background: 'var(--sand-700)' }} active={{ transform: 'scale(.97)' }}>
            <Icon name="refresh" size={16} stroke={2.4} />{t('yc.nf.err.retry')}
          </Hv>
        </section>
      </Shell>
    );
  }
  return <NotifView items={q.data} />;
}

const cardCss: CSSProperties = { boxSizing: 'border-box', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)' };

function Shell({ children }: { children: ReactNode }) {
  return (
    <main style={{ flex: 1, width: '100%', maxWidth: 1240, boxSizing: 'border-box', margin: '0 auto', padding: 'clamp(24px,3vw,40px) clamp(16px,3vw,40px) 96px', display: 'flex', justifyContent: 'center' }}>
      <div style={{ flex: '1 1 560px', minWidth: 0, maxWidth: 840, display: 'flex', flexDirection: 'column', gap: 24 }}>{children}</div>
    </main>
  );
}

function Header({ items, onReadAll }: { items: CrmNotif[]; onReadAll: () => void }) {
  const { t, tp } = useCrmT();
  const intro = useIntro();
  const vis = items.filter(visible);
  const need = vis.filter((i) => i.need && !i.resolved);
  const unread = vis.filter((i) => !(i.need && !i.resolved) && !i.read);
  const sub = !items.length ? t('yc.nf.sub.empty')
    : need.length ? `${tp('yc.nf.sub.need', need.length)}${unread.length ? tp('yc.nf.sub.news', unread.length) : ''}.`
      : unread.length ? tp('yc.nf.sub.calm', unread.length) : t('yc.nf.sub.done');
  const off = unread.length === 0;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px 24px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, flex: '1 1 380px', opacity: intro ? 1 : 0, transform: intro ? 'none' : 'translateY(22px)', transition: `opacity 700ms ${EASE} 160ms,transform 800ms ${EASE} 160ms` }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.nf.kick')}</span>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,3vw,36px)', lineHeight: 1.05, letterSpacing: '-.035em', textWrap: 'balance' }}>
          {t('yc.nf.title1')}<span style={{ background: 'var(--gradient-brand)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{t('yc.nf.title2')}</span>{t('yc.nf.title3')}
        </h1>
        <p style={{ margin: 0, fontSize: 16, lineHeight: 1.45, fontWeight: 500, color: 'var(--sand-600)', textWrap: 'pretty', maxWidth: 560 }}>{sub}</p>
      </div>
      <Hv
        as="button"
        type="button"
        onClick={onReadAll}
        disabled={off}
        style={{ flex: 'none', height: 46, padding: '0 20px 0 16px', borderRadius: 99, background: '#fff', border: '1px solid var(--sand-200)', boxShadow: 'var(--shadow-xs)', color: off ? 'var(--sand-400)' : 'var(--ink)', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, cursor: off ? 'default' : 'pointer', opacity: intro ? 1 : 0, transition: `opacity 700ms ${EASE} 280ms,translate 240ms ${EASE},box-shadow 240ms,border-color 200ms` }}
        hover={off ? {} : { translate: '0 -2px', boxShadow: 'var(--shadow-md)', borderColor: 'var(--sand-300)' }}
      >
        <Icon name="check" size={16} stroke={2.6} />{t('yc.notif.readAll')}
      </Hv>
    </div>
  );
}

function LoadingState() {
  return (
    <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Skel h={96} w="70%" r={14} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,250px),1fr))', gap: 12 }}>
        <Skel h={170} r={16} /><Skel h={170} r={16} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>{[90, 110, 140].map((w) => <Skel key={w} h={40} w={w} r={99} />)}</div>
      <Skel h={420} r={28} />
    </div>
  );
}

function NotifView({ items }: { items: CrmNotif[] }) {
  const T = useCrmT();
  const { t, tp, n, time, locale } = T;
  const rel = useRelTime();
  const nav = useNavigate();
  const toast = useCrmToast();
  const mark = useCrmNotifAction();
  const [f, setF] = useState<Filter>('all');
  const [lim, setLim] = useState(PAGE);
  const [qs, setQs] = useState('');
  const [mo, setMo] = useState('');
  const [leaving, setLeaving] = useState<string[]>([]);
  const [drawer, setDrawer] = useState<string | null>(null);
  const [sel, setSel] = useState(-1);
  const [kb, setKb] = useState(false);
  const [hv, setHv] = useState<string | null>(null);
  const [snzFor, setSnzFor] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 20_000); return () => window.clearInterval(id); }, []);

  const copy = useCallback((i: CrmNotif) => notifCopy(i, t, T), [t, T]);
  const act = useCallback((ids: string[], action: 'read' | 'unread' | 'archive' | 'unarchive' | 'snooze' | 'keep', until?: string) =>
    mark.mutateAsync({ ids, action, until }).catch(() => { toast(t('yc.nf.t.err')); }), [mark, t, toast]);

  const vis = items.filter(visible);
  const need = vis.filter((i) => i.need && !i.resolved && !leaving.includes(i.id))
    .sort((a, b) => (a.due_at ? Date.parse(a.due_at) : Infinity) - (b.due_at ? Date.parse(b.due_at) : Infinity) || Date.parse(b.at) - Date.parse(a.at));
  const info = vis.filter((i) => !(i.need && !i.resolved));
  const unread = info.filter((i) => !i.read);
  const snzd = items.filter((i) => !i.archived && i.snoozed_until && new Date(i.snoozed_until) > new Date());
  const arcd = items.filter((i) => i.archived);

  const mk = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const qn = qs.trim().toLowerCase();
  const list = f === 'snz' ? snzd : f === 'arc'
    ? arcd.filter((i) => (!mo || mk(i.at) === mo) && (!qn || `${copy(i).title} ${copy(i).body}`.toLowerCase().includes(qn)))
    : f === 'unread' ? unread : info;
  const shown = list.slice(0, lim);
  const ids = shown.map((i) => i.id);
  const months = useMemo(() => {
    const m: { v: string; l: string; c: number }[] = [];
    arcd.forEach((i) => {
      const k = mk(i.at);
      const x = m.find((y) => y.v === k);
      if (x) x.c += 1;
      else { const l = new Date(i.at).toLocaleDateString(locale, { month: 'long', year: 'numeric' }); m.push({ v: k, l: l.charAt(0).toUpperCase() + l.slice(1), c: 1 }); }
    });
    return m;
  }, [arcd, locale]);

  const fl: { k: Filter; c: number }[] = [{ k: 'all', c: info.length }, { k: 'unread', c: unread.length }];
  if (snzd.length || f === 'snz') fl.push({ k: 'snz', c: snzd.length });
  if (arcd.length || f === 'arc') fl.push({ k: 'arc', c: arcd.length });

  const open = useCallback((id: string) => {
    const it = items.find((x) => x.id === id);
    if (it && !it.read) void act([id], 'read');
    setDrawer(id); setSnzFor(null);
  }, [act, items]);
  const gone = (id: string, fn: () => Promise<unknown> | void) => {
    setLeaving((l) => [...l, id]);
    window.setTimeout(() => { void Promise.resolve(fn()).finally(() => setLeaving((l) => l.filter((x) => x !== id))); }, 320);
  };
  const archive = (id: string) => {
    if (drawer === id) setDrawer(null);
    gone(id, () => act([id], 'archive'));
    toast(t('yc.nf.t.archived'), { label: t('yc.nf.t.undo'), onClick: () => void act([id], 'unarchive') });
  };
  const snooze = (id: string, k: '1h' | 'tom' | 'mon') => {
    const at = snoozeTargets().find((x) => x.k === k)!.at;
    if (drawer === id) setDrawer(null);
    setSnzFor(null);
    gone(id, () => act([id], 'snooze', at.toISOString()));
    toast(t('yc.nf.t.snoozed', { when: t(`yc.nf.s.${k}`).toLowerCase() }), { label: t('yc.nf.t.undo'), onClick: () => void act([id], 'keep') });
  };
  const toggleRead = (i: CrmNotif) => { void act([i.id], i.read ? 'unread' : 'read'); };
  const readAll = () => {
    const ids0 = unread.map((i) => i.id);
    if (!ids0.length) return;
    void act(ids0, 'read').then(() => toast(t('yc.nf.t.allRead')));
  };

  // Clavier (comme le design) : J/K, Entrée, E, U, Échap.
  const state = useRef({ ids, sel, drawer, list: shown });
  state.current = { ids, sel, drawer, list: shown };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tg = e.target as HTMLElement | null;
      const tag = tg?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return;
      const s = state.current;
      if (e.key === 'Escape') { if (s.drawer) setDrawer(null); return; }
      if (!s.ids.length) return;
      const cur = s.drawer ? s.ids.indexOf(s.drawer) : s.sel;
      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault();
        const nx = Math.max(0, Math.min(s.ids.length - 1, cur < 0 ? 0 : cur + (e.key === 'j' ? 1 : -1)));
        if (s.drawer) open(s.ids[nx]); else { setSel(nx); setKb(true); }
      } else if (e.key === 'Enter' && !s.drawer && s.sel >= 0 && tag !== 'A' && tag !== 'BUTTON') {
        e.preventDefault(); open(s.ids[s.sel]);
      } else if (e.key === 'e' && cur >= 0) {
        e.preventDefault(); archive(s.ids[cur]);
      } else if (e.key === 'u' && cur >= 0) {
        e.preventDefault(); const it = s.list[cur]; if (it) toggleRead(it);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  // Sélection au clavier : la ligne reste visible.
  useEffect(() => {
    if (!kb || sel < 0) return;
    const el = document.querySelector<HTMLElement>(`[data-nid="${CSS.escape(ids[sel] ?? '')}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [sel, kb, ids]);

  if (!items.length) {
    return (
      <Shell>
        <Header items={items} onReadAll={readAll} />
        <section style={{ ...cardCss, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '56px 28px 52px', textAlign: 'center', background: 'radial-gradient(60% 60% at 50% 0%,rgba(255,107,53,.07),transparent 70%),#fff', animation: `yc-rise 600ms ${EASE} both` }}>
          <YunitFace mood="endormi" size={96} />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 28, letterSpacing: '-.03em', lineHeight: 1.1, textWrap: 'balance' }}>{t('yc.nf.empty.t')}</span>
          <span style={{ fontSize: 15.5, lineHeight: 1.5, color: 'var(--sand-600)', maxWidth: 440, textWrap: 'pretty' }}>{t('yc.nf.empty.s')}</span>
          <ChooseLink pill />
        </section>
      </Shell>
    );
  }

  const groups: Group[] = ['today', 'hier', 'semaine', 'ancien'];
  const empt = f === 'unread' ? 'unread' : f === 'arc' ? (qn || mo ? 'arcQ' : 'arc') : f === 'snz' ? 'snz' : 'all';
  let idx = 0;
  const dItem = drawer ? items.find((i) => i.id === drawer) ?? null : null;
  const dIdx = dItem ? ids.indexOf(dItem.id) : -1;

  return (
    <Shell>
      <Header items={items} onReadAll={readAll} />

      {/* À faire */}
      <section id="a-traiter" style={{ display: 'flex', flexDirection: 'column', gap: 14, scrollMarginTop: 96 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, animation: `yc-rise 640ms ${EASE} 80ms both` }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, letterSpacing: '-.03em' }}>{t('yc.nf.todo')}</h2>
          {need.length > 0 && <span style={{ minWidth: 26, height: 26, padding: '0 8px', boxSizing: 'border-box', borderRadius: 99, background: 'var(--red-500)', color: '#fff', fontSize: 13, fontWeight: 600, display: 'grid', placeItems: 'center', fontVariantNumeric: 'tabular-nums' }}>{need.length}</span>}
        </div>
        <p style={{ margin: '-6px 0 0', fontSize: 14.5, lineHeight: 1.45, color: 'var(--sand-500)', maxWidth: 560, textWrap: 'pretty' }}>{t('yc.nf.todoS')}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,300px),1fr))', gap: 12 }}>
          {need.map((i, k) => {
            const c = copy(i);
            const warn = i.tone === 'warn';
            const due = i.due_at ? Date.parse(i.due_at) : null;
            const mins = due !== null ? Math.round((due - now) / 60_000) : null;
            const sameDay = due !== null && new Date(due).toDateString() === new Date(now).toDateString();
            const badge = mins !== null && sameDay
              ? (mins > 0 ? t('yc.nf.due', { time: time(new Date(due as number)), d: mins >= 60 ? `${Math.floor(mins / 60)} h${mins % 60 ? ` ${String(mins % 60).padStart(2, '0')}` : ''}` : `${mins} min` }) : t('yc.nf.dueNow'))
              : t(warn ? 'yc.nf.badge.warn' : 'yc.nf.badge.todo');
            const later = !i.due_at && !i.lock;
            return (
              <Hv
                key={i.id}
                onClick={() => open(i.id)}
                style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 10, padding: '18px 20px', borderRadius: 16, background: '#fff', border: `1px solid ${warn ? 'var(--sand-200)' : 'var(--red-200)'}`, minWidth: 0, cursor: 'pointer', transition: `translate 240ms ${EASE},box-shadow 240ms,border-color 200ms`, animation: `yc-rise 640ms ${EASE} ${140 + k * 90}ms both` }}
                hover={{ translate: '0 -4px', boxShadow: 'var(--shadow-md)', borderColor: 'var(--sand-300)' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ height: 24, padding: '0 10px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, background: warn ? 'var(--amber-50)' : 'var(--red-50)', color: warn ? 'var(--amber-700)' : 'var(--red-700)', fontVariantNumeric: 'tabular-nums' }}>
                    <span style={{ width: 6, height: 6, borderRadius: 99, background: 'currentColor', animation: mins !== null && mins < 120 ? 'yc-pulse 1.6s ease-out infinite' : 'none' }} />{badge}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--sand-400)' }}>{t(`yc.notif.cat.${i.cat}`)}</span>
                </div>
                <span style={{ fontSize: 16.5, lineHeight: '21px', fontWeight: 600, letterSpacing: '-.01em', textWrap: 'balance' }}>{c.title}</span>
                <span style={{ fontSize: 14, lineHeight: '19.5px', color: 'var(--sand-600)', textWrap: 'pretty' }}>{c.body}</span>
                <div style={{ marginTop: 'auto', paddingTop: 6, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 14px' }}>
                  {c.action && c.href && (
                    k === 0 ? (
                      <Hv as={Link} to={c.href} onClick={(e: ReactMouseEvent) => { e.stopPropagation(); if (!i.read) void act([i.id], 'read'); }} style={{ height: 40, padding: '0 5px 0 16px', borderRadius: 99, background: 'var(--gradient-brand)', color: '#fff', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 10, boxShadow: 'var(--shadow-cta)', textDecoration: 'none', whiteSpace: 'nowrap', transition: `transform 200ms ${SPRING},filter 160ms` }} hover={{ filter: 'brightness(1.05)', transform: 'translateY(-1px)', color: '#fff', textDecoration: 'none' }} active={{ transform: 'scale(.97)' }}>
                        {c.action}<span style={{ width: 30, height: 30, borderRadius: 99, background: '#fff', color: 'var(--red-500)', display: 'grid', placeItems: 'center' }}><Icon name="arrowRight" size={15} stroke={2.4} /></span>
                      </Hv>
                    ) : (
                      <Hv as={Link} to={c.href} onClick={(e: ReactMouseEvent) => { e.stopPropagation(); if (!i.read) void act([i.id], 'read'); }} style={{ height: 40, padding: '0 16px', borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none', whiteSpace: 'nowrap', transition: `transform 200ms ${SPRING},background 160ms` }} hover={{ background: 'var(--sand-700)', color: '#fff', textDecoration: 'none' }} active={{ transform: 'scale(.97)' }}>
                        {c.action}<Icon name="arrowRight" size={15} stroke={2.4} />
                      </Hv>
                    )
                  )}
                  {later && (
                    <Hv as="button" type="button" onClick={(e: ReactMouseEvent) => { e.stopPropagation(); snooze(i.id, 'tom'); }} style={{ height: 40, padding: '0 6px', border: 0, borderRadius: 12, background: 'none', display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 14, fontWeight: 600, color: 'var(--sand-600)', cursor: 'pointer', transition: 'color 160ms' }} hover={{ color: 'var(--ink)' }}>
                      <Icon name="clock" size={15} stroke={2.2} />{t('yc.nf.later')}
                    </Hv>
                  )}
                </div>
              </Hv>
            );
          })}
          {need.length === 0 && (
            <div style={{ gridColumn: '1/-1', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '14px 16px', padding: '18px 22px', borderRadius: 16, background: 'var(--green-50)', border: '1px solid #BFE6CE', animation: `yc-pop 480ms ${EASE} both` }}>
              <YunitFace mood="ravi" size={48} />
              <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--green-700)' }}>{t('yc.nf.allDone.t')}</span>
                <span style={{ fontSize: 14.5, color: 'var(--sand-600)' }}>{t('yc.nf.allDone.s')}</span>
              </div>
            </div>
          )}
        </div>
      </section>

      <h2 style={{ margin: '16px 0 -6px', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, letterSpacing: '-.03em' }}>{t('yc.nf.hist')}</h2>
      <div style={{ position: 'sticky', top: 64, zIndex: 15, margin: '0 -8px', padding: 8, background: 'linear-gradient(180deg,var(--paper) 70%,rgba(252,250,249,0))', animation: `yc-rise 640ms ${EASE} 160ms both` }}>
        <div role="tablist" aria-label={t('yc.nf.filters')} className="yc-noscroll" style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: 3 }}>
          {fl.map((x) => {
            const on = f === x.k;
            const alert = x.k === 'unread' && x.c > 0;
            return (
              <Hv key={x.k} as="button" type="button" role="tab" aria-selected={on} onClick={() => { if (!on) { setF(x.k); setLim(PAGE); setSel(-1); setKb(false); setQs(''); setMo(''); } }} style={{ flex: 'none', height: 40, padding: '0 8px 0 16px', borderRadius: 99, border: `1px solid ${on ? 'var(--ink)' : 'var(--sand-200)'}`, background: on ? 'var(--ink)' : '#fff', color: on ? '#fff' : 'var(--sand-700)', boxShadow: on ? 'none' : 'var(--shadow-xs)', fontSize: 14.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', whiteSpace: 'nowrap', transition: `background 180ms,color 180ms,border-color 180ms,transform 200ms ${SPRING}` }} hover={{ borderColor: on ? 'var(--ink)' : 'var(--sand-300)' }} active={{ transform: 'scale(.97)' }}>
                {t(`yc.nf.f.${x.k}`)}
                <span style={{ minWidth: 24, height: 24, padding: '0 7px', boxSizing: 'border-box', borderRadius: 99, background: on ? 'rgba(255,255,255,.18)' : alert ? 'var(--red-500)' : 'var(--sand-100)', color: on || alert ? '#fff' : 'var(--sand-600)', fontSize: 12.5, fontWeight: 600, display: 'grid', placeItems: 'center', fontVariantNumeric: 'tabular-nums' }}>{x.c}</span>
              </Hv>
            );
          })}
        </div>
      </div>

      <section aria-label={t('yc.notif.title')} style={{ ...cardCss, marginTop: -8, padding: 8, display: 'flex', flexDirection: 'column', animation: `yc-rise 700ms ${EASE} 240ms both` }}>
        {f === 'arc' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '10px 12px 6px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <label style={{ flex: '1 1 240px', minWidth: 0, height: 42, padding: '0 16px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--sand-500)' }}>
                <Icon name="search" size={16} stroke={2.2} />
                <input type="search" value={qs} onChange={(e) => setQs(e.target.value)} placeholder={t('yc.nf.arcSearch')} aria-label={t('yc.nf.arcSearch')} style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'none', font: 'inherit', fontSize: 14.5, color: 'var(--ink)' }} />
              </label>
              <select value={mo} onChange={(e) => setMo(e.target.value)} aria-label={t('yc.nf.arcMonth')} style={{ flex: '0 1 220px', height: 42, padding: '0 14px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', font: 'inherit', fontSize: 14.5, fontWeight: 500, color: 'var(--ink)', cursor: 'pointer' }}>
                <option value="">{t('yc.nf.arcAll')}</option>
                {months.map((m) => <option key={m.v} value={m.v}>{`${m.l} (${m.c})`}</option>)}
              </select>
            </div>
            <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--sand-500)', textWrap: 'pretty' }}>{t('yc.nf.arcNote')}</span>
          </div>
        )}
        {groups.map((g, gi) => {
          const gl = shown.filter((i) => dayGroup(i.at, new Date(now)) === g);
          if (!gl.length) return null;
          return (
            <div key={g} style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: gi === 0 || !shown.some((i) => groups.indexOf(dayGroup(i.at, new Date(now))) < gi) ? '10px 20px 6px' : '18px 20px 6px', fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-400)' }}>
                {t(`yc.nf.g.${g}`)}<span style={{ flex: 1, height: 1, background: 'var(--sand-100)' }} /><span style={{ fontVariantNumeric: 'tabular-nums' }}>{gl.length}</span>
              </div>
              {gl.map((i) => {
                const k = idx++;
                const c = copy(i);
                const [tbg, tfg] = NOTIF_TONE_COLORS[i.tone] ?? NOTIF_TONE_COLORS.info;
                const lv = leaving.includes(i.id);
                const selOn = kb && sel === k;
                const showA = hv === i.id || selOn || snzFor === i.id;
                const isSnz = f === 'snz';
                const isArc = f === 'arc';
                const chip = isSnz && i.snoozed_until ? [t('yc.nf.chip.snz', { when: new Date(i.snoozed_until).toLocaleString(locale, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) }), 'var(--sand-100)', 'var(--sand-600)']
                  : isArc ? [t('yc.nf.chip.arc'), 'var(--sand-100)', 'var(--sand-600)']
                    : i.need && !i.resolved ? [t('yc.nf.chip.todo'), 'var(--red-50)', 'var(--red-700)'] : null;
                return (
                  <div key={i.id} data-nid={i.id} style={{ display: 'grid', gridTemplateRows: lv ? '0fr' : '1fr', opacity: lv ? 0 : 1, transition: `grid-template-rows 320ms ${EASE},opacity 220ms`, position: 'relative', zIndex: snzFor === i.id ? 6 : 1, animation: `yc-rise 560ms ${EASE} ${Math.min(k, 8) * 45}ms both` }}>
                    <div style={{ minHeight: 0, overflow: lv ? 'hidden' : 'visible' }}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => open(i.id)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); open(i.id); } }}
                        onMouseEnter={() => { if (hv !== i.id) { setHv(i.id); setKb(false); } }}
                        onMouseLeave={() => { if (hv === i.id) setHv(null); }}
                        style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 20px 14px 24px', borderRadius: 18, background: selOn ? 'var(--sand-50)' : !i.read ? 'rgba(255,242,241,.7)' : hv === i.id ? 'var(--sand-50)' : 'transparent', boxShadow: selOn ? 'inset 0 0 0 2px var(--red-200)' : 'none', cursor: 'pointer', transition: 'background 300ms ease,box-shadow 160ms', outline: 'none' }}
                      >
                        {!i.read && <span style={{ position: 'absolute', left: 9, top: 28, width: 8, height: 8, borderRadius: 99, background: 'var(--red-500)' }} />}
                        <span style={{ flex: 'none', width: 40, height: 40, borderRadius: 12, background: tbg, color: tfg, display: 'grid', placeItems: 'center' }}><Icon name={NOTIF_ICON[i.kind] ?? 'bell'} size={18} stroke={2} /></span>
                        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 10px', fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--sand-400)' }}>
                            {t(`yc.notif.cat.${i.cat}`)} · {rel(i.at, new Date(now))}
                            {chip && <span style={{ height: 20, padding: '0 8px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-body, inherit)', fontSize: 12, fontWeight: 600, letterSpacing: 0, textTransform: 'none', background: chip[1], color: chip[2] }}><span style={{ width: 5, height: 5, borderRadius: 99, background: 'currentColor' }} />{chip[0]}</span>}
                          </span>
                          <span style={{ fontSize: 15.5, lineHeight: '20px', fontWeight: !i.read ? 600 : 500, letterSpacing: '-.005em', textWrap: 'balance' }}>{c.title}</span>
                          <span style={{ fontSize: 14, lineHeight: '19.5px', color: 'var(--sand-600)', textWrap: 'pretty' }}>{c.body}</span>
                          {c.action && c.href && (
                            <Hv as={Link} to={c.href} onClick={(e: ReactMouseEvent) => { e.stopPropagation(); if (!i.read) void act([i.id], 'read'); }} style={{ marginTop: 4, alignSelf: 'flex-start', height: 32, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600, color: 'var(--ink)', textDecoration: 'none' }} hover={{ color: 'var(--red-600)', textDecoration: 'none' }}>
                              {c.action}<Icon name="arrowRight" size={14} stroke={2.4} />
                            </Hv>
                          )}
                        </span>
                        {isSnz || isArc ? (
                          <Hv as="button" type="button" onClick={(e: ReactMouseEvent) => { e.stopPropagation(); void act([i.id], 'keep').then(() => toast(t('yc.nf.t.restored'))); }} style={{ flex: 'none', height: 34, padding: '0 14px', border: '1px solid var(--sand-200)', borderRadius: 99, background: '#fff', fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer' }} hover={{ borderColor: 'var(--sand-300)' }}>
                            {t('yc.nf.restore')}
                          </Hv>
                        ) : (
                          <span style={{ flex: 'none', position: 'relative', display: 'flex', alignItems: 'center', gap: 2, opacity: showA ? 1 : 0, transform: showA ? 'none' : 'translateY(4px)', pointerEvents: showA ? 'auto' : 'none', transition: `opacity 160ms,transform 220ms ${EASE}` }}>
                            <RowBtn label={t(i.read ? 'yc.nf.d.unread' : 'yc.nf.d.read')} icon={i.read ? 'eye' : 'check'} onClick={() => toggleRead(i)} />
                            {!(i.need && (i.due_at || i.lock)) && <RowBtn label={t('yc.nf.d.snooze')} icon="clock" on={snzFor === i.id} onClick={() => setSnzFor(snzFor === i.id ? null : i.id)} />}
                            <RowBtn label={t('yc.nf.d.archive')} icon="archive" onClick={() => archive(i.id)} />
                            {snzFor === i.id && <SnoozeMenu onPick={(k2) => snooze(i.id, k2)} style={{ top: 40, right: 0 }} />}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
        {list.length > lim && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '14px 0 6px' }}>
            <Hv as="button" type="button" onClick={() => setLim((l) => l + PAGE)} style={{ height: 42, padding: '0 20px', borderRadius: 99, background: '#fff', border: '1px solid var(--sand-200)', fontSize: 14.5, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer' }} hover={{ borderColor: 'var(--sand-300)', boxShadow: 'var(--shadow-sm)' }}>
              {t('yc.nf.more', { n: n(Math.min(PAGE, list.length - lim)) })}
            </Hv>
          </div>
        )}
        {list.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '44px 24px 40px', textAlign: 'center', animation: `yc-rise 500ms ${EASE} both` }}>
            <YunitFace mood="content" size={64} />
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t(`yc.nf.no.${empt}.t`)}</span>
            <span style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--sand-500)', maxWidth: 380, textWrap: 'pretty' }}>{t(`yc.nf.no.${empt}.s`)}</span>
            {f !== 'all' && (
              <Hv as="button" type="button" onClick={() => { setF('all'); setQs(''); setMo(''); }} style={{ marginTop: 4, height: 42, padding: '0 18px', borderRadius: 99, background: '#fff', border: '1px solid var(--sand-200)', fontSize: 14.5, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer' }} hover={{ borderColor: 'var(--sand-300)', boxShadow: 'var(--shadow-sm)' }}>
                {t('yc.nf.seeAll')}
              </Hv>
            )}
          </div>
        )}
        {list.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '8px 18px', padding: '14px 20px 8px', marginTop: 6, borderTop: '1px solid var(--sand-100)' }}>
            <span style={{ fontSize: 13, lineHeight: 1.4, color: 'var(--sand-500)', maxWidth: 360, textWrap: 'pretty' }}>{t('yc.nf.footer')}</span>
            <ChooseLink />
          </div>
        )}
      </section>

      <Sheet open={!!dItem} onClose={() => setDrawer(null)} width={500} label={t('yc.nf.d.label')}>
        {dItem && (
          <Drawer
            item={dItem}
            title={copy(dItem).title}
            body={copy(dItem).body}
            action={copy(dItem).action}
            href={copy(dItem).href}
            when={rel(dItem.at, new Date(now))}
            hasPrev={dIdx > 0}
            hasNext={dIdx >= 0 && dIdx < ids.length - 1}
            onPrev={() => dIdx > 0 && open(ids[dIdx - 1])}
            onNext={() => dIdx < ids.length - 1 && open(ids[dIdx + 1])}
            onClose={() => setDrawer(null)}
            onUnread={() => { void act([dItem.id], dItem.read ? 'unread' : 'read'); toast(t(dItem.read ? 'yc.nf.t.unread' : 'yc.nf.d.read')); }}
            onArchive={() => archive(dItem.id)}
            onSnooze={(k2) => snooze(dItem.id, k2)}
            navigate={(to) => { setDrawer(null); nav(to); }}
          />
        )}
      </Sheet>
    </Shell>
  );
}

const ARCHIVE_D = 'M21 8v13H3V8M1 3h22v5H1zM10 12h4';

function RowBtn({ label, icon, onClick, on }: { label: string; icon: 'eye' | 'check' | 'clock' | 'archive'; onClick: () => void; on?: boolean }) {
  return (
    <Hv as="button" type="button" aria-label={label} title={label} onClick={(e: ReactMouseEvent) => { e.stopPropagation(); onClick(); }} style={{ width: 34, height: 34, border: 0, borderRadius: 99, background: on ? 'var(--sand-100)' : 'transparent', color: 'var(--sand-600)', display: 'grid', placeItems: 'center', cursor: 'pointer', transition: 'background 140ms,color 140ms' }} hover={{ background: 'var(--sand-100)', color: 'var(--ink)' }}>
      {icon === 'archive' ? <Icon d={ARCHIVE_D} size={16} stroke={2.2} /> : <Icon name={icon} size={16} stroke={2.2} />}
    </Hv>
  );
}

function SnoozeMenu({ onPick, style }: { onPick: (k: '1h' | 'tom' | 'mon') => void; style: CSSProperties }) {
  const { t } = useCrmT();
  return (
    <div role="menu" onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', zIndex: 8, width: 220, boxSizing: 'border-box', padding: 6, borderRadius: 16, background: '#fff', boxShadow: 'var(--shadow-md),0 0 0 1px var(--sand-200)', animation: `yc-pop 220ms ${EASE} both`, ...style }}>
      <span style={{ display: 'block', padding: '8px 10px 6px', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-400)' }}>{t('yc.nf.d.snooze')}</span>
      {(['1h', 'tom', 'mon'] as const).map((k) => (
        <Hv key={k} as="button" type="button" role="menuitem" onClick={() => onPick(k)} style={{ width: '100%', height: 38, padding: '0 10px', border: 0, borderRadius: 10, background: 'none', display: 'flex', alignItems: 'center', fontSize: 14.5, fontWeight: 500, color: 'var(--ink)', cursor: 'pointer', textAlign: 'left' }} hover={{ background: 'var(--sand-50)' }}>
          {t(`yc.nf.s.${k}`)}
        </Hv>
      ))}
    </div>
  );
}

function ChooseLink({ pill }: { pill?: boolean }) {
  const { t } = useCrmT();
  return pill ? (
    <Hv as={Link} to={CRM_ROUTES.accountSection('notifications')} style={{ marginTop: 6, height: 46, padding: '0 20px', borderRadius: 99, background: '#fff', border: '1px solid var(--sand-200)', boxShadow: 'var(--shadow-xs)', color: 'var(--ink)', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none' }} hover={{ borderColor: 'var(--sand-300)', boxShadow: 'var(--shadow-md)', color: 'var(--ink)', textDecoration: 'none' }}>
      {t('yc.nf.choose')}
    </Hv>
  ) : (
    <Hv as={Link} to={CRM_ROUTES.accountSection('notifications')} style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }} hover={{ color: 'var(--red-600)', textDecoration: 'none' }}>
      {t('yc.nf.choose')}<Icon name="arrowRight" size={14} stroke={2.4} />
    </Hv>
  );
}

function Drawer({ item, title, body, action, href, when, hasPrev, hasNext, onPrev, onNext, onClose, onUnread, onArchive, onSnooze, navigate }: {
  item: CrmNotif; title: string; body: string; action: string | null; href: string | null; when: string;
  hasPrev: boolean; hasNext: boolean; onPrev: () => void; onNext: () => void; onClose: () => void;
  onUnread: () => void; onArchive: () => void; onSnooze: (k: '1h' | 'tom' | 'mon') => void; navigate: (to: string) => void;
}) {
  const { t } = useCrmT();
  const [snz, setSnz] = useState(false);
  const [tbg, tfg] = NOTIF_TONE_COLORS[item.tone] ?? NOTIF_TONE_COLORS.info;
  const canSnz = !(item.need && (item.due_at || item.lock));
  const chip = item.need && !item.resolved ? [t('yc.nf.chip.todo'), 'var(--red-50)', 'var(--red-700)'] : null;
  const navBtn = (lab: string, ic: 'chevronUp' | 'chevronDown', on: boolean, fn: () => void) => (
    <Hv as="button" type="button" onClick={fn} disabled={!on} aria-label={lab} title={lab} style={{ width: 36, height: 36, border: 0, borderRadius: 99, background: 'none', color: on ? 'var(--ink)' : 'var(--sand-300)', cursor: on ? 'pointer' : 'default', display: 'grid', placeItems: 'center' }} hover={on ? { background: 'var(--sand-100)' } : {}}>
      <Icon name={ic} size={16} stroke={2.4} />
    </Hv>
  );
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: '#fff' }}>
      <div style={{ flex: 'none', height: 64, boxSizing: 'border-box', padding: '0 16px 0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid var(--sand-100)' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t(`yc.notif.cat.${item.cat}`)}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {navBtn(t('yc.nf.d.prev'), 'chevronUp', hasPrev, onPrev)}
          {navBtn(t('yc.nf.d.next'), 'chevronDown', hasNext, onNext)}
          <Hv as="button" type="button" onClick={onClose} aria-label={t('yc.nf.d.close')} title={t('yc.nf.d.close')} style={{ width: 36, height: 36, marginLeft: 4, border: 0, borderRadius: 99, background: 'var(--sand-100)', color: 'var(--ink)', cursor: 'pointer', display: 'grid', placeItems: 'center', transition: `transform 200ms ${SPRING}` }} hover={{ background: 'var(--sand-200)' }} active={{ transform: 'scale(.92)' }}>
            <Icon name="x" size={15} stroke={2.4} />
          </Hv>
        </span>
      </div>
      <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
        <div key={item.id} style={{ padding: '28px 28px 8px', display: 'flex', flexDirection: 'column', gap: 18, animation: `yc-rise 360ms ${EASE} both` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ flex: 'none', width: 52, height: 52, borderRadius: 16, background: tbg, color: tfg, display: 'grid', placeItems: 'center' }}><Icon name={NOTIF_ICON[item.kind] ?? 'bell'} size={22} stroke={2} /></span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-start' }}>
              {chip && <span style={{ height: 24, padding: '0 10px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, background: chip[1], color: chip[2] }}><span style={{ width: 6, height: 6, borderRadius: 99, background: 'currentColor' }} />{chip[0]}</span>}
              <span style={{ fontSize: 13.5, color: 'var(--sand-500)' }}>{when}</span>
            </span>
          </div>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 28, lineHeight: 1.1, letterSpacing: '-.03em', textWrap: 'balance' }}>{title}</h2>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: 'var(--sand-700)', textWrap: 'pretty' }}>{body}</p>
        </div>
      </div>
      <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 14, padding: '18px 28px 20px', borderTop: '1px solid var(--sand-100)', background: '#fff' }}>
        {action && href && (
          <div>
            <Hv as="button" type="button" onClick={() => navigate(href)} style={{ height: 46, padding: '0 5px 0 20px', border: 0, borderRadius: 99, background: 'var(--gradient-brand)', color: '#fff', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 12, boxShadow: 'var(--shadow-cta)', cursor: 'pointer', whiteSpace: 'nowrap', transition: `transform 200ms ${SPRING},filter 160ms` }} hover={{ filter: 'brightness(1.05)', transform: 'translateY(-1px)' }} active={{ transform: 'scale(.97)' }}>
              {action}<span style={{ width: 36, height: 36, borderRadius: 99, background: '#fff', color: 'var(--red-500)', display: 'grid', placeItems: 'center' }}><Icon name="arrowRight" size={16} stroke={2.4} /></span>
            </Hv>
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '8px 16px' }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 2, margin: '0 -10px' }}>
            <FootBtn icon={item.read ? 'eye' : 'check'} label={t(item.read ? 'yc.nf.d.unread' : 'yc.nf.d.read')} onClick={onUnread} />
            {canSnz && <FootBtn icon="clock" label={t('yc.nf.d.snooze')} on={snz} onClick={() => setSnz((x) => !x)} />}
            <FootBtn icon="archive" label={t('yc.nf.d.archive')} onClick={onArchive} />
            {snz && <SnoozeMenu onPick={(k) => { setSnz(false); onSnooze(k); }} style={{ bottom: 46, left: 62 }} />}
          </div>
          {item.lock
            ? <span style={{ fontSize: 13.5, color: 'var(--sand-500)', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="lock" size={13} stroke={2.4} />{t('yc.nf.d.locked')}</span>
            : <Hv as={Link} to={CRM_ROUTES.accountSection('notifications')} style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sand-500)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }} hover={{ color: 'var(--ink)', textDecoration: 'none' }}>{t('yc.nf.d.setting')}</Hv>}
        </div>
      </div>
    </div>
  );
}

function FootBtn({ icon, label, onClick, on }: { icon: 'eye' | 'check' | 'clock' | 'archive'; label: string; onClick: () => void; on?: boolean }) {
  return (
    <Hv as="button" type="button" onClick={onClick} style={{ height: 38, padding: '0 10px', border: 0, borderRadius: 12, background: on ? 'var(--sand-50)' : 'none', display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 14, fontWeight: 600, color: 'var(--sand-600)', cursor: 'pointer' }} hover={{ background: 'var(--sand-50)', color: 'var(--ink)' }}>
      {icon === 'archive' ? <Icon d={ARCHIVE_D} size={16} stroke={2.2} /> : <Icon name={icon} size={16} stroke={2.2} />}{label}
    </Hv>
  );
}
