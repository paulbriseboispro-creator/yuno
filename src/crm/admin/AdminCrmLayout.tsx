/**
 * Coquille de l'Admin CRM (/admin/crm) : garde super admin, dictionnaires
 * (admin + CRM), menu latéral en quatre groupes, bascule Suite / CRM, palette
 * ⌘K, interrupteur « démo incluse ». Les écrans s'y rangent par `<Outlet />`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import '@/crm/styles/crm.css';
import { supabase } from '@/integrations/supabase/client';
import { isPreviewActive } from '@/contexts/PreviewModeContext';
import { useLocaleSection } from '@/contexts/LanguageContext';
import { AdminScopeProvider, useAdminScope } from '@/components/admin/AdminScope';
import { useCrmT } from '@/crm/i18n';
import { buildTodo, atRisk } from '@/crm/lib/admin';
import type { AdminAccount } from '@/crm/lib/admin';
import { CrmToastProvider } from '@/crm/ui/kit';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { useNarrow } from '@/crm/ui/useNarrow';
import { YunitFace } from '@/crm/ui/YunitFace';
import { CrmErrorBoundary } from '@/crm/errors/CrmErrorBoundary';
import { OfflineBar } from '@/crm/errors/OfflineBar';
import yunoIcon from '@/crm/assets/yuno-app-icon.webp';
import { ADMIN_NAV, ADMIN_ROUTES, adminScreenFor } from './adminNav';
import type { AdminScreen } from './adminNav';
import { useAdminAccounts, useAdminLiveSignups } from './data';
import { hasValidMfaSession, useAdminDocument } from './adminSession';

function Splash() {
  return <div className="yc yc-page-bg" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><YunitFace mood="content" size={56} /></div>;
}

export default function AdminCrmLayout() {
  useAdminDocument();
  const navigate = useNavigate();
  const adminReady = useLocaleSection('admin');
  const crmReady = useLocaleSection('crm');
  const [state, setState] = useState<'wait' | 'ok'>('wait');

  useEffect(() => {
    let off = false;
    (async () => {
      try {
        if (isPreviewActive()) { navigate('/', { replace: true }); return; }
        const login = `${ADMIN_ROUTES.login}?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { navigate(login, { replace: true }); return; }
        const { data: ok, error } = await supabase.rpc('is_super_admin');
        if (error || !ok) { navigate('/'); return; }
        // 2FA activée sur le compte et pas encore confirmée dans ce navigateur : l'étape 2 de la connexion.
        const { data: prof } = await supabase.from('profiles').select('mfa_enabled').eq('id', user.id).maybeSingle();
        if (prof?.mfa_enabled && !hasValidMfaSession(user.id)) { navigate(`${login}&step=code`, { replace: true }); return; }
        if (!off) setState('ok');
      } catch {
        navigate(ADMIN_ROUTES.login, { replace: true });
      }
    })();
    return () => { off = true; };
  }, [navigate]);

  if (state !== 'ok' || !adminReady || !crmReady) return <Splash />;
  return (
    <AdminScopeProvider>
      <CrmToastProvider>
        <Shell />
      </CrmToastProvider>
    </AdminScopeProvider>
  );
}

export function Shell() {
  const { t, dShort, time } = useCrmT();
  const { pathname } = useLocation();
  const [sp] = useSearchParams();
  const narrow = useNarrow(960);
  const [drawer, setDrawer] = useState(false);
  const [pal, setPal] = useState(false);
  const { includeDemo, setIncludeDemo } = useAdminScope();
  const accounts = useAdminAccounts();
  const live = useAdminLiveSignups().data ?? 0;
  const current = adminScreenFor(pathname);
  const rows = useMemo(() => accounts.data?.accounts ?? [], [accounts.data]);
  const badges = useMemo<Partial<Record<AdminScreen, number>>>(() => ({
    cockpit: buildTodo(rows).filter((x) => x.sev === 'red').length,
    clients: rows.filter(atRisk).length,
  }), [rows]);

  useEffect(() => { setDrawer(false); window.scrollTo(0, 0); }, [pathname]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPal((v) => !v); } };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const tab = sp.get('tab');
  const curLabel = t(`adm.crm.nav.${current}`);

  const aside = (
    <aside style={{ boxSizing: 'border-box', width: 264, height: '100vh', display: 'flex', flexDirection: 'column', gap: 2, padding: '14px 12px 12px', background: '#fff', borderRight: '1px solid var(--sand-100)', overflowY: 'auto', scrollbarWidth: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 6px 14px' }}>
        <img src={yunoIcon} alt="" style={{ width: 36, height: 36, borderRadius: 10 }} />
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontWeight: 600, fontSize: 15, lineHeight: '18px' }}>Yuno</span>
          <span style={{ fontSize: 12, color: 'var(--sand-500)' }}>{t('adm.crm.brand')}</span>
        </span>
        {narrow && <Hv as="button" type="button" onClick={() => setDrawer(false)} aria-label={t('yc.common.close')} style={{ width: 36, height: 36, border: 0, borderRadius: 10, background: 'var(--sand-50)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><Icon name="x" size={16} stroke={2.4} /></Hv>}
      </div>
      <div role="group" aria-label={t('adm.crm.product')} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', padding: 3, gap: 2, margin: '0 2px 10px', borderRadius: 99, background: 'var(--sand-100)' }}>
        <Hv as={Link} to="/admin" style={{ height: 32, borderRadius: 99, color: 'var(--sand-600)', fontSize: 13.5, fontWeight: 600, display: 'grid', placeItems: 'center', textDecoration: 'none' }} hover={{ color: 'var(--ink)', textDecoration: 'none' }}>{t('adm.crm.suite')}</Hv>
        <span style={{ height: 32, borderRadius: 99, background: '#fff', boxShadow: 'var(--shadow-xs)', fontSize: 13.5, fontWeight: 600, display: 'grid', placeItems: 'center' }}>CRM</span>
      </div>
      <Hv as="button" type="button" onClick={() => setPal(true)} style={{ height: 40, margin: '0 2px 8px', padding: '0 8px 0 12px', border: 0, borderRadius: 12, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', color: 'var(--sand-500)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer', textAlign: 'left' }} hover={{ boxShadow: 'inset 0 0 0 1px var(--sand-300)', color: 'var(--ink)' }}>
        <Icon name="search" size={16} stroke={2.2} /><span style={{ flex: 1 }}>{t('adm.crm.search')}</span>
        <span style={{ height: 22, padding: '0 7px', borderRadius: 7, background: 'var(--sand-100)', color: 'var(--sand-500)', font: "500 11.5px/22px 'Geist Mono'" }}>⌘K</span>
      </Hv>
      {ADMIN_NAV.map((g) => (
        <div key={g.label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-400)', padding: '14px 12px 4px' }}>{t(`adm.crm.group.${g.label}`)}</span>
          {g.items.map((it) => {
            const on = current === it.id;
            const badge = badges[it.id];
            return (
              <div key={it.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Hv as={Link} to={it.to} style={{ display: 'flex', alignItems: 'center', gap: 12, height: 42, padding: '0 10px 0 12px', borderRadius: 12, background: on ? 'var(--red-50)' : 'transparent', color: on ? 'var(--red-700)' : 'var(--sand-700)', fontSize: 15, fontWeight: on ? 600 : 500, textDecoration: 'none', transition: 'background 160ms' }} hover={{ background: on ? 'var(--red-50)' : 'var(--sand-50)', color: on ? 'var(--red-700)' : 'var(--ink)', textDecoration: 'none' }}>
                  <Icon d={it.d} size={20} />
                  <span style={{ flex: 1, whiteSpace: 'nowrap' }}>{t(`adm.crm.nav.${it.key}`)}</span>
                  {!!badge && <span style={{ minWidth: 20, height: 20, padding: '0 6px', boxSizing: 'border-box', borderRadius: 99, background: it.id === 'cockpit' || it.id === 'clients' ? 'var(--red-500)' : 'var(--amber-500)', color: '#fff', fontSize: 11.5, fontWeight: 600, display: 'grid', placeItems: 'center' }}>{badge}</span>}
                </Hv>
                {on && it.subs?.map((s) => {
                  const subOn = (s.tab ?? null) === tab && pathname.replace(/\/+$/, '') === it.to;
                  const subBadge = s.key === 'cockpitLive' ? live : 0;
                  return (
                    <Hv key={s.key} as={Link} to={s.to} style={{ marginLeft: 21, padding: '0 12px', height: 36, boxSizing: 'border-box', borderLeft: '1px solid var(--sand-200)', borderRadius: '0 10px 10px 0', background: subOn ? 'var(--red-50)' : 'transparent', display: 'flex', alignItems: 'center', fontSize: 14, fontWeight: subOn ? 600 : 500, color: subOn ? 'var(--red-700)' : 'var(--sand-600)', textDecoration: 'none' }} hover={{ background: subOn ? 'var(--red-50)' : 'var(--sand-50)', color: subOn ? 'var(--red-700)' : 'var(--ink)', textDecoration: 'none' }}>
                      <span style={{ flex: 1 }}>{t(`adm.crm.nav.${s.key}`)}</span>
                      {!!subBadge && <span style={{ minWidth: 20, height: 20, padding: '0 6px', boxSizing: 'border-box', borderRadius: 99, background: 'var(--red-500)', color: '#fff', fontSize: 11.5, fontWeight: 600, display: 'grid', placeItems: 'center' }}>{subBadge}</span>}
                    </Hv>
                  );
                })}
              </div>
            );
          })}
        </div>
      ))}
      <div style={{ flex: 1, minHeight: 16 }} />
      <Hv as="button" type="button" onClick={() => setIncludeDemo(!includeDemo)} aria-pressed={includeDemo} style={{ margin: '0 2px 8px', padding: '10px 12px', border: 0, borderRadius: 14, background: 'var(--sand-50)', display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'left', cursor: 'pointer' }} hover={{ background: 'var(--sand-100)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 600 }}>
          <i style={{ width: 7, height: 7, borderRadius: 99, background: includeDemo ? 'var(--amber-500)' : 'var(--green-500)' }} />
          {t(includeDemo ? 'adm.crm.demoOn' : 'adm.crm.demoOff')}
        </span>
        <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--sand-500)' }}>{accounts.data ? t('adm.crm.dataAt', { date: dShort(accounts.data.at), time: time(accounts.data.at) }) : '…'}</span>
      </Hv>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px 4px', borderTop: '1px solid var(--sand-100)' }}>
        <span style={{ flex: 'none', width: 32, height: 32, borderRadius: 99, background: 'var(--gradient-brand)', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, color: '#fff' }}>AY</span>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t('adm.crm.me')}</span>
          <span style={{ fontSize: 12, color: 'var(--sand-500)' }}>{t('adm.crm.meRole')}</span>
        </span>
      </div>
    </aside>
  );

  return (
    <div className="yc yc-page-bg" style={{ minHeight: '100vh', display: narrow ? 'block' : 'flex' }}>
      {!narrow && <div style={{ flex: 'none', position: 'sticky', top: 0, height: '100vh', zIndex: 30 }}>{aside}</div>}
      {narrow && (
        <>
          <div style={{ boxSizing: 'border-box', height: 56, padding: '0 12px 0 16px', display: 'flex', alignItems: 'center', gap: 12, background: '#fff', borderBottom: '1px solid var(--sand-100)', position: 'sticky', top: 0, zIndex: 40 }}>
            <Hv as="button" type="button" onClick={() => setDrawer(true)} aria-label={t('adm.crm.menu')} style={{ width: 40, height: 40, marginLeft: -8, border: 0, borderRadius: 12, background: 'none', display: 'grid', placeItems: 'center', cursor: 'pointer' }} hover={{ background: 'var(--sand-50)' }}><Icon d="M4 6h16M4 12h16M4 18h16" size={22} /></Hv>
            <img src={yunoIcon} alt="" style={{ width: 28, height: 28, borderRadius: 8 }} />
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>Yuno CRM · admin</span>
              <span style={{ fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{curLabel}</span>
            </span>
            <Hv as="button" type="button" onClick={() => setPal(true)} aria-label={t('adm.crm.search')} style={{ width: 40, height: 40, border: 0, borderRadius: 12, background: 'var(--sand-50)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><Icon name="search" size={18} stroke={2.2} /></Hv>
          </div>
          {drawer && (
            <>
              <div onClick={() => setDrawer(false)} style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(18,12,14,.5)' }} />
              <div style={{ position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 71, animation: 'yc-slide-in 260ms var(--ease-out) both' }}>{aside}</div>
            </>
          )}
        </>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <OfflineBar />
        <CrmErrorBoundary resetKey={pathname}><Outlet /></CrmErrorBoundary>
      </div>
      {pal && <Palette rows={rows} onClose={() => setPal(false)} />}
      <div id="yc-portal" className="yc" />
    </div>
  );
}

function Palette({ rows, onClose }: { rows: AdminAccount[]; onClose: () => void }) {
  const { t } = useCrmT();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);

  const items = useMemo(() => {
    const s = q.trim().toLowerCase();
    const pages = ADMIN_NAV.flatMap((g) => g.items).map((it) => ({ k: `p:${it.id}`, label: t(`adm.crm.nav.${it.key}`), hint: t('adm.crm.pal.page'), to: it.to, hay: `${t(`adm.crm.nav.${it.key}`)} ${t(`adm.crm.nav.kw.${it.key}`)}`.toLowerCase() }));
    const accs = rows.map((a) => ({ k: `a:${a.id}`, label: a.name, hint: [a.city, t(`adm.crm.type.${a.type}`)].filter(Boolean).join(' · '), to: ADMIN_ROUTES.account(a.id), hay: `${a.name} ${a.city ?? ''} ${a.contact ?? ''} ${a.email ?? ''}`.toLowerCase() }));
    const all = [...pages, ...accs];
    return (s ? all.filter((x) => x.hay.includes(s)) : all.slice(0, 8)).slice(0, 10);
  }, [q, rows, t]);

  const go = (to: string) => { onClose(); nav(to); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') { e.preventDefault(); setI((v) => Math.min(items.length - 1, v + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setI((v) => Math.max(0, v - 1)); }
    else if (e.key === 'Enter' && items[i]) go(items[i].to);
  };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(18,12,14,.42)', backdropFilter: 'blur(2px)' }} />
      <div role="dialog" aria-label={t('adm.crm.search')} onKeyDown={onKey} style={{ position: 'fixed', zIndex: 81, top: 'min(12vh,96px)', left: '50%', transform: 'translateX(-50%)', width: 'min(640px,calc(100vw - 24px))', boxSizing: 'border-box', borderRadius: 22, background: '#fff', boxShadow: '0 30px 80px -20px rgba(18,12,14,.5),0 0 0 1px var(--sand-200)', overflow: 'hidden', animation: 'yc-pop 200ms var(--ease-out) both' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 18px', height: 60, borderBottom: '1px solid var(--sand-100)' }}>
          <Icon name="search" size={19} color="var(--sand-500)" />
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setI(0); }} placeholder={t('adm.crm.pal.ph')} style={{ flex: 1, border: 0, outline: 0, background: 'none', fontSize: 16, color: 'var(--ink)', font: 'inherit' }} />
          <span style={{ height: 22, padding: '0 7px', borderRadius: 7, background: 'var(--sand-100)', color: 'var(--sand-500)', font: "500 11.5px/22px 'Geist Mono'" }}>esc</span>
        </div>
        <div style={{ maxHeight: 360, overflowY: 'auto', padding: 8 }}>
          {items.length === 0 && <div style={{ padding: '24px 12px', fontSize: 14.5, color: 'var(--sand-500)' }}>{t('adm.crm.pal.none', { q })}</div>}
          {items.map((x, k) => (
            <Hv key={x.k} as="button" type="button" onClick={() => go(x.to)} onMouseEnter={() => setI(k)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, height: 46, padding: '0 12px', border: 0, borderRadius: 12, background: k === i ? 'var(--sand-50)' : 'transparent', cursor: 'pointer', textAlign: 'left', font: 'inherit' }}>
              <span style={{ flex: 1, fontSize: 15, fontWeight: 600 }}>{x.label}</span>
              <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{x.hint}</span>
            </Hv>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 16, padding: '10px 18px', borderTop: '1px solid var(--sand-100)', fontSize: 12.5, color: 'var(--sand-500)' }}>
          <span>{t('adm.crm.pal.nav')}</span><span>{t('adm.crm.pal.open')}</span><span>{t('adm.crm.pal.close')}</span>
        </div>
      </div>
    </>
  );
}
