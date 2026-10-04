/**
 * Barre du haut de la Console CRM (AppTopBar du design) : recherche ⌘K, état
 * de la synchro billetterie, solde de Yunits (aperçu au clic), cloche des
 * notifications et menu du profil. Au-dessus, deux bandeaux : l'accès
 * assisté (l'équipe Yuno est dans la Console) et les envois suspendus.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import type { IconName } from '@/crm/ui/Icon';
import { YunitFace } from '@/crm/ui/YunitFace';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import { useCrmWallet } from '@/crm/data/shell';
import type { CrmShell } from '@/crm/data/shell';
import { useAuth } from '@/hooks/useAuth';
import { isSupportSessionActive } from '@/lib/supportSession';
import { SearchBox } from './SearchBox';
import { NotifBell } from './NotifBell';
import { CRM_ROUTES } from './nav';

export function TopBar({ shell, onOpenMenu, showMenuButton }: { shell: CrmShell | undefined; onOpenMenu: () => void; showMenuButton: boolean }) {
  const { t, n, time, dShort } = useCrmT();
  const [pop, setPop] = useState<null | 'yu' | 'pr'>(null);
  const conn = shell?.connection ?? null;
  const balance = shell?.wallet.balance ?? null;
  const assist = isSupportSessionActive();

  const sync = !conn
    ? { label: t('yc.top.sync.none'), dot: 'var(--sand-400)', bg: 'transparent', fg: 'var(--sand-600)' }
    : conn.state === 'broken'
      ? { label: t('yc.top.sync.broken'), dot: 'var(--red-500)', bg: 'var(--red-50)', fg: 'var(--red-700)' }
      : conn.state === 'running'
        ? { label: t('yc.top.sync.running'), dot: 'var(--amber-500)', bg: 'transparent', fg: 'var(--sand-600)' }
        : {
          label: t('yc.top.sync.ok', { time: conn.last_ok_at ? (isToday(conn.last_ok_at) ? time(conn.last_ok_at) : dShort(conn.last_ok_at)) : '—' }),
          dot: 'var(--green-500)', bg: 'transparent', fg: 'var(--sand-600)',
        };

  return (
    <div style={{ fontFamily: 'var(--font-body)', color: 'var(--ink)' }}>
      {pop && <div onClick={() => setPop(null)} style={{ position: 'fixed', inset: 0, zIndex: -1 }} />}
      {assist && (
        <div role="status" style={{ minHeight: 40, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: '6px 14px', padding: '6px 16px', background: 'var(--night)', color: 'var(--text-on-night)', fontSize: 13.5 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: 'var(--tangerine-500)' }} />
            <b style={{ fontWeight: 600 }}>{t('yc.top.assist')}</b>
            <span style={{ color: 'var(--text-on-night-2)' }}>{t('yc.top.assistSub')}</span>
          </span>
        </div>
      )}
      <header style={{
        height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'clamp(8px,2vw,16px)', padding: '0 clamp(16px,3vw,40px)',
        background: 'rgba(252,250,249,.88)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderBottom: '1px solid var(--sand-100)',
      }}>
        {showMenuButton && (
          <button type="button" onClick={onOpenMenu} aria-label={t('yc.nav.openMenu')} style={{ flex: 'none', width: 40, height: 40, borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink)' }}>
            <Icon d="M4 6h16M4 12h16M4 18h16" size={18} />
          </button>
        )}
        <SearchBox hasConnection={!!conn} balance={balance} />
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 'clamp(6px,1.4vw,10px)' }}>
          <span title={t('yc.top.sync.title')} className="yc-hide-sm" style={{ flex: 'none', height: 36, padding: '0 14px', borderRadius: 99, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 500, color: sync.fg, background: sync.bg, whiteSpace: 'nowrap' }}>
            <span style={{ flex: 'none', width: 7, height: 7, borderRadius: 99, background: sync.dot }} />
            {sync.label}
          </span>
          <div style={{ position: 'relative' }}>
            <Hv
              as="button"
              type="button"
              onClick={() => setPop((p) => (p === 'yu' ? null : 'yu'))}
              aria-expanded={pop === 'yu'}
              aria-haspopup="dialog"
              title={t('yc.top.yu.title')}
              style={{
                height: 36, padding: '0 10px 0 6px', borderRadius: 99, background: '#fff', border: `1px solid ${pop === 'yu' ? 'var(--sand-400)' : 'var(--sand-200)'}`,
                display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--ink)', whiteSpace: 'nowrap', cursor: 'pointer',
              }}
              hover={{ borderColor: 'var(--sand-300)' }}
            >
              <YunitFace mood="content" size={24} />
              {balance === null ? '…' : n(balance)}
              <span className="yc-hide-sm" style={{ fontWeight: 400, color: 'var(--sand-500)' }}>{t('yc.common.yunits')}</span>
              <Icon name="chevronDown" size={14} stroke={2.4} color="var(--sand-400)" style={{ transform: `rotate(${pop === 'yu' ? 180 : 0}deg)`, transition: 'transform 200ms' }} />
            </Hv>
            {pop === 'yu' && <YunitsPopover onClose={() => setPop(null)} />}
          </div>
          <NotifBell unread={shell?.notifications_unread ?? 0} />
          <ProfileMenu shell={shell} open={pop === 'pr'} onToggle={() => setPop((p) => (p === 'pr' ? null : 'pr'))} onClose={() => setPop(null)} />
        </div>
      </header>
    </div>
  );
}

function isToday(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

function YunitsPopover({ onClose }: { onClose: () => void }) {
  const { t, n, dShort } = useCrmT();
  const w = useCrmWallet(true);
  const bal = w.data?.balance ?? 0;
  const rates = w.data?.rates ?? { email: 1, sms: 40 };
  const reserved = w.data?.reserved_total ?? 0;
  const debits = (w.data?.moves ?? []).filter((m) => m.kind === 'debit').slice(0, 3);
  const lotLabel = (k: string) => ({ trial: 'yc.top.yu.lot.trial', monthly: 'yc.top.yu.lot.monthly', purchase: 'yc.top.yu.lot.purchase', bonus: 'yc.top.yu.lot.bonus' } as Record<string, string>)[k] ?? 'yc.top.yu.lot.bonus';
  const lotSub = (k: string, exp: string | null) => {
    if (k === 'trial') return t('yc.top.yu.lot.trialSub');
    if (k === 'monthly') return t('yc.top.yu.lot.monthlySub', { date: exp ? dShort(exp) : '—' });
    if (k === 'purchase') return t('yc.top.yu.lot.purchaseSub');
    return t('yc.top.yu.lot.bonusSub', { date: exp ? dShort(exp) : '—' });
  };
  const after = Math.max(0, bal - reserved);
  const rsvW = bal > 0 ? Math.min(100, (reserved / bal) * 100) : 0;
  return (
    <div role="dialog" aria-label={t('yc.top.yu.title')} style={{
      position: 'absolute', top: 44, right: 0, width: 'min(372px, calc(100vw - 32px))', borderRadius: 20, background: '#fff',
      boxShadow: 'var(--shadow-md),0 0 0 1px var(--sand-200)', overflow: 'hidden', display: 'flex', flexDirection: 'column',
      maxHeight: 'calc(100vh - 80px)', transformOrigin: 'top right', animation: 'yc-pop 240ms var(--ease-out) both', zIndex: 2,
    }}>
      <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
        <div style={{ padding: '20px 20px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-400)' }}>{t('yc.top.yu.balance')}</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 48, lineHeight: 1, letterSpacing: '-.05em', fontVariantNumeric: 'tabular-nums' }}>{w.isLoading ? '…' : n(bal)}</span>
              <span style={{ fontSize: 15, color: 'var(--sand-500)' }}>{t('yc.common.yunits')}</span>
            </div>
            <span style={{ fontSize: 13.5, color: 'var(--sand-600)' }}>{t('yc.top.yu.eq', { emails: n(Math.floor(bal / (rates.email || 1))), sms: n(Math.floor(bal / (rates.sms || 40))) })}</span>
          </div>
          {reserved > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', height: 10, gap: 2, borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ width: `${rsvW.toFixed(1)}%`, background: 'var(--gradient-brand)' }} />
                <div style={{ flex: 1, background: 'var(--green-500)' }} />
              </div>
              <Row dot="var(--red-500)" label={t('yc.top.yu.reserved')} value={`− ${n(reserved)}`} />
              <Row dot="var(--green-500)" label={t('yc.top.yu.after')} value={`${n(after)} ${t('yc.common.yunits')}`} />
              {after < (rates.sms || 40) * 100 && (
                <div style={{ padding: '10px 12px', borderRadius: 12, background: 'var(--amber-50)', color: 'var(--amber-700)', fontSize: 13.5, lineHeight: 1.4, fontWeight: 500 }}>{t('yc.top.yu.lowSms')}</div>
              )}
            </div>
          )}
          {!debits.length && !w.isLoading && (
            <div style={{ padding: '10px 12px', borderRadius: 12, background: 'var(--sand-50)', color: 'var(--sand-600)', fontSize: 13.5, lineHeight: 1.4 }}>{t('yc.top.yu.noMoves')}</div>
          )}
        </div>
        {(w.data?.lots ?? []).length > 0 && (
          <div style={{ padding: '14px 20px', borderTop: '1px solid var(--sand-100)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(w.data?.lots ?? []).map((l) => (
              <div key={l.kind} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{t(lotLabel(l.kind))}</span>
                  <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{lotSub(l.kind, l.expires_at)}</span>
                </span>
                <b style={{ fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>{n(l.remaining)}</b>
              </div>
            ))}
          </div>
        )}
        {debits.length > 0 && (
          <div style={{ padding: '14px 20px', borderTop: '1px solid var(--sand-100)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-400)' }}>{t('yc.top.yu.lastMoves')}</span>
            {debits.map((m, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 13.5 }}>
                <span style={{ flex: 'none', width: 52, color: 'var(--sand-500)' }}>{dShort(m.at)}</span>
                <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.label}</span>
                <b style={{ fontVariantNumeric: 'tabular-nums' }}>− {n(Math.abs(m.delta))}</b>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 20px', background: 'var(--sand-50)', borderTop: '1px solid var(--sand-100)' }}>
        <Hv as={Link} to={CRM_ROUTES.pricing} onClick={onClose} style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', textDecoration: 'none' }} hover={{ color: 'var(--red-600)', textDecoration: 'none' }}>
          {t('yc.top.yu.how')}
        </Hv>
        <Hv
          as={Link}
          to={CRM_ROUTES.yunits}
          onClick={onClose}
          style={{ height: 40, padding: '0 5px 0 16px', borderRadius: 99, background: 'var(--gradient-brand)', color: '#fff', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 10, boxShadow: 'var(--shadow-cta)', textDecoration: 'none', whiteSpace: 'nowrap' }}
          hover={{ filter: 'brightness(1.05)', color: '#fff', textDecoration: 'none' }}
        >
          {t('yc.top.yu.recharge')}
          <span style={{ width: 30, height: 30, borderRadius: 99, background: '#fff', color: 'var(--red-500)', display: 'grid', placeItems: 'center' }}><Icon name="arrowRight" size={15} stroke={2.4} /></span>
        </Hv>
      </div>
    </div>
  );
}

function Row({ dot, label, value }: { dot: string; label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
      <i style={{ width: 8, height: 8, borderRadius: 99, background: dot }} />
      <span style={{ flex: 1, color: 'var(--sand-600)' }}>{label}</span>
      <b style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</b>
    </div>
  );
}

function ProfileMenu({ shell, open, onToggle, onClose }: { shell: CrmShell | undefined; open: boolean; onToggle: () => void; onClose: () => void }) {
  const { t } = useCrmT();
  const nav = useNavigate();
  const { space } = useCrmScope();
  const { user, signOut } = useAuth();
  const p = shell?.profile;
  const first = p?.first_name ?? '';
  const last = p?.last_name ?? '';
  const name = [first, last].filter(Boolean).join(' ') || (user?.email ?? '');
  const ini = ((first[0] ?? '') + (last[0] ?? '')).toUpperCase() || (user?.email?.[0] ?? '?').toUpperCase();
  const photo = p?.avatar_url ?? null;
  const items: { label: string; icon: IconName; to: string }[] = [
    { label: t('yc.top.pr.profile'), icon: 'user', to: CRM_ROUTES.accountSection('profile') },
    { label: t('yc.top.pr.team'), icon: 'users', to: CRM_ROUTES.accountSection('team') },
    { label: t('yc.top.pr.billing'), icon: 'card', to: CRM_ROUTES.accountSection('billing') },
    { label: t('yc.top.pr.notifications'), icon: 'bell', to: CRM_ROUTES.accountSection('notifications') },
    { label: t('yc.top.pr.help'), icon: 'help', to: CRM_ROUTES.accountSection('help') },
  ];
  return (
    <div style={{ position: 'relative' }}>
      <Hv
        as="button"
        type="button"
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={open}
        title={name}
        style={{
          position: 'relative', width: 36, height: 36, padding: 0, border: 0, borderRadius: 99, overflow: 'hidden', background: 'var(--sand-100)',
          boxShadow: open ? '0 0 0 2px #fff,0 0 0 4px var(--sand-300)' : 'none', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 600,
          color: 'var(--sand-700)', cursor: 'pointer', transition: 'box-shadow 140ms',
        }}
        hover={{ background: 'var(--sand-200)' }}
      >
        {photo ? <img src={photo} alt="" style={{ width: 36, height: 36, objectFit: 'cover', display: 'block' }} /> : ini}
      </Hv>
      {open && (
        <div role="menu" style={{ position: 'absolute', top: 44, right: 0, width: 'min(296px, calc(100vw - 32px))', borderRadius: 20, background: '#fff', boxShadow: 'var(--shadow-md),0 0 0 1px var(--sand-200)', overflow: 'hidden', transformOrigin: 'top right', animation: 'yc-pop 240ms var(--ease-out) both', zIndex: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 16px 14px' }}>
            <span style={{ flex: 'none', width: 44, height: 44, borderRadius: 99, overflow: 'hidden', background: 'var(--sand-100)', display: 'grid', placeItems: 'center', fontSize: 15, fontWeight: 600, color: 'var(--sand-700)' }}>
              {photo ? <img src={photo} alt="" style={{ width: 44, height: 44, objectFit: 'cover', display: 'block' }} /> : ini}
            </span>
            <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{name}</span>
              <span style={{ fontSize: 13, color: 'var(--sand-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p?.email ?? user?.email}</span>
            </span>
          </div>
          <div style={{ margin: '0 16px 8px', padding: '8px 12px', borderRadius: 12, background: 'var(--sand-50)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
            <span style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{space.name}</span>
            <span style={{ color: 'var(--sand-500)', flex: 'none' }}>{t(`yc.top.role.${space.role}`)}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', padding: '4px 8px' }}>
            {items.map((it) => (
              <Hv
                as="button"
                key={it.to}
                type="button"
                role="menuitem"
                onClick={() => { onClose(); nav(it.to); }}
                style={{ height: 42, padding: '0 10px', border: 0, borderRadius: 12, background: 'none', display: 'flex', alignItems: 'center', gap: 12, fontSize: 14.5, fontWeight: 500, color: 'var(--ink)', cursor: 'pointer', textAlign: 'left' }}
                hover={{ background: 'var(--sand-50)' }}
              >
                <Icon name={it.icon} size={18} color="var(--sand-500)" />
                <span style={{ flex: 1 }}>{it.label}</span>
              </Hv>
            ))}
          </div>
          <div style={{ padding: '8px 8px 8px', borderTop: '1px solid var(--sand-100)', marginTop: 4 }}>
            <Hv
              as="button"
              type="button"
              role="menuitem"
              onClick={async () => { onClose(); await signOut(); nav('/auth'); }}
              style={{ width: '100%', height: 42, padding: '0 10px', border: 0, borderRadius: 12, background: 'none', display: 'flex', alignItems: 'center', gap: 12, fontSize: 14.5, fontWeight: 500, color: 'var(--red-600)', cursor: 'pointer', textAlign: 'left' }}
              hover={{ background: 'var(--red-50)' }}
            >
              <Icon name="logout" size={18} />
              {t('yc.top.pr.logout')}
            </Hv>
          </div>
        </div>
      )}
    </div>
  );
}
