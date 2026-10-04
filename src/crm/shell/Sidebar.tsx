/**
 * Menu latéral de la Console CRM (AppSidebar du design) : l'espace en tête,
 * trois groupes (Piloter, Agir, Connaître), puis au pied le bloc Yunits,
 * Connecteurs, Réglages, Aide et « Réduire le menu ». Replié ou déplié se
 * garde par appareil (`yuno.sidebar`).
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { rememberActingOrganizer } from '@/hooks/useActingOrganizer';
import { Icon, PanelIcon } from '@/crm/ui/Icon';
import type { IconName } from '@/crm/ui/Icon';
import { YunitFace } from '@/crm/ui/YunitFace';
import type { YunitMood } from '@/crm/ui/YunitFace';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import { CRM_ROUTES, NAV_GROUP_CHILDREN } from './nav';
import type { CrmScreen, NavGroupKey } from './nav';
import yunoIcon from '@/crm/assets/yuno-app-icon.webp';

type Row =
  | { type: 'label'; t: string }
  | { type: 'link'; id: CrmScreen; t: string; icon: IconName; to: string; tag?: string }
  | { type: 'group'; key: NavGroupKey; t: string; icon: IconName; badge?: { n: number; tone: 'red' | 'sand' }; subs: { id: CrmScreen; t: string; to: string; tag?: string }[] };

export function Sidebar({
  current, compact, onToggleCompact, badges, yunits, mood, onNavigate,
}: {
  current: CrmScreen;
  compact: boolean;
  onToggleCompact: () => void;
  badges: { campaigns: number; clients: number };
  yunits: number | null;
  mood: YunitMood;
  onNavigate?: () => void;
}) {
  const { t, n } = useCrmT();
  const { space, spaces, switchTo } = useCrmScope();
  const exp = !compact;
  const ownerGroup = (Object.keys(NAV_GROUP_CHILDREN) as NavGroupKey[]).find((k) => NAV_GROUP_CHILDREN[k].includes(current)) ?? null;
  const [open, setOpen] = useState<NavGroupKey | '' | null>(null);
  const openKey = open !== null ? open : ownerGroup ?? '';
  const [spacesOpen, setSpacesOpen] = useState(false);
  const itemJc = exp ? 'flex-start' : 'center';

  const rows: Row[] = [
    { type: 'label', t: t('yc.nav.pilot') },
    { type: 'link', id: 'accueil', t: t('yc.nav.home'), icon: 'home', to: CRM_ROUTES.home },
    {
      type: 'group', key: 'analyses', t: t('yc.nav.analyses'), icon: 'chart', subs: [
        { id: 'ventes', t: t('yc.nav.sales'), to: CRM_ROUTES.sales },
        { id: 'trafic', t: t('yc.nav.traffic'), to: CRM_ROUTES.traffic },
        { id: 'communaute', t: t('yc.nav.community'), to: CRM_ROUTES.community },
        { id: 'parcours', t: t('yc.nav.journey'), to: CRM_ROUTES.journey },
      ],
    },
    { type: 'label', t: t('yc.nav.act') },
    {
      type: 'group', key: 'campagnes', t: t('yc.nav.campaigns'), icon: 'send',
      badge: badges.campaigns ? { n: badges.campaigns, tone: 'red' } : undefined,
      subs: [
        { id: 'emails', t: t('yc.nav.emails'), to: CRM_ROUTES.emails },
        { id: 'sms', t: t('yc.nav.sms'), to: CRM_ROUTES.sms },
        { id: 'auto', t: t('yc.nav.automations'), to: CRM_ROUTES.automations },
        { id: 'instagram', t: t('yc.nav.instagram'), to: CRM_ROUTES.instagram, tag: t('yc.nav.soon') },
      ],
    },
    {
      type: 'group', key: 'soirees', t: t('yc.nav.nights'), icon: 'calendar', subs: [
        { id: 'avenir', t: t('yc.nav.upcoming'), to: CRM_ROUTES.nights },
        { id: 'passees', t: t('yc.nav.past'), to: CRM_ROUTES.nightsPast },
      ],
    },
    { type: 'label', t: t('yc.nav.know') },
    { type: 'link', id: 'inscriptions', t: t('yc.nav.signupPages'), icon: 'qr', to: CRM_ROUTES.signupPages, tag: t('yc.nav.soon') },
    {
      type: 'group', key: 'clients', t: t('yc.nav.clients'), icon: 'users',
      badge: badges.clients ? { n: badges.clients, tone: 'sand' } : undefined,
      subs: [
        { id: 'clients', t: t('yc.nav.allClients'), to: CRM_ROUTES.clients },
        { id: 'segments', t: t('yc.nav.segments'), to: CRM_ROUTES.segments },
        { id: 'imports', t: t('yc.nav.imports'), to: CRM_ROUTES.imports },
      ],
    },
  ];

  const foot: { id: CrmScreen; t: string; icon: IconName; to: string }[] = [
    { id: 'connecteurs', t: t('yc.nav.connectors'), icon: 'plug', to: CRM_ROUTES.connectors },
    { id: 'reglages', t: t('yc.nav.settings'), icon: 'sliders', to: CRM_ROUTES.settings },
    { id: 'aide', t: t('yc.nav.help'), icon: 'help', to: CRM_ROUTES.accountSection('help') },
  ];

  const linkStyle = (on: boolean, h = 42, fs = 15) => ({
    display: 'flex', alignItems: 'center', justifyContent: itemJc, gap: 12, height: h, padding: '0 12px', borderRadius: 12,
    background: on ? 'var(--red-50)' : 'transparent', color: on ? 'var(--red-600)' : 'var(--sand-600)',
    fontSize: fs, fontWeight: on ? 600 : 500, textDecoration: 'none', border: 0, cursor: 'pointer', width: '100%', textAlign: 'left' as const,
    position: 'relative' as const,
  });
  const hov = { background: 'var(--sand-50)', color: 'var(--ink)', textDecoration: 'none' };

  const spaceKind = t(space.kind === 'venue' ? 'yc.nav.kind.venue' : 'yc.nav.kind.org');
  const spaceSub = [space.city, spaceKind].filter(Boolean).join(' · ');

  return (
    <aside style={{
      width: exp ? 264 : 76, height: '100vh', transition: 'width 240ms cubic-bezier(.22,1,.36,1)', display: 'flex', flexDirection: 'column',
      gap: 2, padding: '14px 12px', background: '#fff', borderRight: '1px solid var(--sand-100)', overflowY: 'auto', overflowX: 'hidden',
      fontFamily: 'var(--font-body)', color: 'var(--ink)', flex: 'none',
    }} className="yc-noscroll">
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: itemJc, gap: 10, padding: '2px 0 10px' }}>
        <Hv
          as="button"
          type="button"
          title={t('yc.nav.switchSpace')}
          onClick={() => spaces.length > 1 && setSpacesOpen((o) => !o)}
          style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, border: 0, background: 'none', padding: 4, borderRadius: 14, cursor: spaces.length > 1 ? 'pointer' : 'default', textAlign: 'left' }}
          hover={{ background: 'var(--sand-50)' }}
        >
          {space.logoUrl
            ? <img src={space.logoUrl} alt="" style={{ flex: 'none', width: 36, height: 36, borderRadius: 10, display: 'block', objectFit: 'cover' }} />
            : <img src={yunoIcon} alt="" style={{ flex: 'none', width: 36, height: 36, borderRadius: 10, display: 'block' }} />}
          {exp && (
            <>
              <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontWeight: 600, fontSize: 15, lineHeight: '18px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--ink)', maxWidth: 150 }}>{space.name}</span>
                <span style={{ fontSize: 12, lineHeight: '15px', color: 'var(--sand-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 150 }}>{spaceSub}</span>
              </span>
              {spaces.length > 1 && <Icon name="chevronsUpDown" size={14} stroke={2.2} color="var(--sand-400)" />}
            </>
          )}
        </Hv>
        {spacesOpen && (
          <>
            <div onClick={() => setSpacesOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
            <div role="menu" style={{ position: 'absolute', top: 52, left: 0, zIndex: 51, width: 240, padding: 6, borderRadius: 16, background: '#fff', boxShadow: 'var(--shadow-md),0 0 0 1px var(--sand-200)', animation: 'yc-pop 220ms cubic-bezier(.22,1,.36,1) both' }}>
              {spaces.map((s) => (
                <Hv
                  as="button"
                  key={s.key}
                  type="button"
                  role="menuitem"
                  onClick={() => { switchTo(s.key); setSpacesOpen(false); }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: 0, borderRadius: 12, background: s.key === space.key ? 'var(--sand-50)' : 'none', cursor: 'pointer', textAlign: 'left' }}
                  hover={{ background: 'var(--sand-50)' }}
                >
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--sand-500)' }}>{[s.city, t(s.kind === 'venue' ? 'yc.nav.kind.venue' : 'yc.nav.kind.org')].filter(Boolean).join(' · ')}</span>
                  </span>
                  {s.key === space.key && <Icon name="check" size={15} stroke={2.6} color="var(--red-500)" />}
                </Hv>
              ))}
            </div>
          </>
        )}
      </div>

      {rows.map((r, i) => {
        if (r.type === 'label') {
          return exp
            ? <span key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-400)', padding: '14px 12px 4px' }}>{r.t}</span>
            : <span key={i} style={{ height: 12 }} />;
        }
        if (r.type === 'link') {
          const on = current === r.id;
          return (
            <Hv key={r.id} as={Link} to={r.to} title={r.t} onClick={onNavigate} style={linkStyle(on)} hover={hov}>
              <Icon name={r.icon} size={20} />
              {exp && <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.t}</span>}
              {exp && r.tag && <Tag>{r.tag}</Tag>}
            </Hv>
          );
        }
        const isOpen = exp && openKey === r.key;
        const child = NAV_GROUP_CHILDREN[r.key].includes(current);
        const act = child && !isOpen;
        return (
          <div key={r.key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Hv
              as="button"
              type="button"
              title={r.t}
              onClick={() => {
                if (!exp) { onToggleCompact(); setOpen(r.key); return; }
                setOpen(isOpen ? '' : r.key);
              }}
              style={{
                ...linkStyle(false),
                background: act && !exp ? 'var(--red-50)' : 'transparent',
                color: act ? 'var(--red-600)' : child ? 'var(--ink)' : 'var(--sand-600)',
                fontWeight: child ? 600 : 500,
              }}
              hover={{ background: 'var(--sand-50)', color: 'var(--ink)' }}
            >
              <Icon name={r.icon} size={20} />
              {exp && (
                <>
                  <span style={{ flex: 1 }}>{r.t}</span>
                  {r.badge && <Bubble n={r.badge.n} tone={r.badge.tone} format={n} />}
                  <Icon name="chevronDown" size={16} stroke={2.2} color="var(--sand-400)" style={{ transform: `rotate(${isOpen ? 180 : 0}deg)`, transition: 'transform 200ms' }} />
                </>
              )}
              {!exp && r.badge && (
                <span style={{ position: 'absolute', top: 8, right: 14, width: 9, height: 9, borderRadius: 99, background: r.badge.tone === 'red' ? 'var(--red-500)' : 'var(--sand-400)', border: '2px solid #fff' }} />
              )}
            </Hv>
            {isOpen && r.subs.map((s) => {
              const on = current === s.id;
              return (
                <Hv
                  key={s.id}
                  as={Link}
                  to={s.to}
                  onClick={onNavigate}
                  style={{
                    marginLeft: 21, padding: '0 12px', height: 36, borderLeft: '1px solid var(--sand-200)', borderRadius: '0 10px 10px 0',
                    display: 'flex', alignItems: 'center', background: on ? 'var(--red-50)' : 'transparent', fontSize: 14,
                    fontWeight: on ? 600 : 500, color: on ? 'var(--red-600)' : 'var(--sand-600)', textDecoration: 'none',
                  }}
                  hover={hov}
                >
                  <span style={{ flex: 1 }}>{s.t}</span>
                  {s.tag && <Tag>{s.tag}</Tag>}
                </Hv>
              );
            })}
          </div>
        );
      })}

      <div style={{ flex: 1, minHeight: 12 }} />
      <div style={{ borderTop: '1px solid var(--sand-100)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Hv
          as={Link}
          to={CRM_ROUTES.yunits}
          title={t('yc.nav.yunits')}
          onClick={onNavigate}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: itemJc, gap: 12, height: 52, padding: '0 10px', marginBottom: 6,
            borderRadius: 14, background: current === 'yunits' ? 'var(--red-50)' : 'var(--sand-50)', color: 'var(--ink)', textDecoration: 'none',
          }}
          hover={{ background: 'var(--sand-100)', color: 'var(--ink)', textDecoration: 'none' }}
        >
          <YunitFace mood={mood} size={30} />
          {exp && (
            <>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontSize: 14.5, fontWeight: 600, lineHeight: '18px' }}>{t('yc.nav.yunits')}</span>
                <span style={{ fontSize: 12.5, lineHeight: '15px', color: 'var(--sand-500)', fontVariantNumeric: 'tabular-nums' }}>
                  {yunits === null ? '…' : t('yc.nav.yunitsAvailable', { n: n(yunits) })}
                </span>
              </span>
              <Icon name="chevronRight" size={16} stroke={2.2} color="var(--sand-400)" />
            </>
          )}
        </Hv>
        {foot.map((f) => {
          const on = current === f.id;
          return (
            <Hv key={f.id} as={Link} to={f.to} title={f.t} onClick={onNavigate} style={linkStyle(on, 40, 14.5)} hover={hov}>
              <Icon name={f.icon} size={20} />
              {exp && <span>{f.t}</span>}
            </Hv>
          );
        })}
        {/* Compte qui a aussi la Billetterie : le passage vers sa Console. */}
        {space.products.includes('suite') && (
          <Hv
            as="a"
            href={space.kind === 'venue' ? '/owner/dashboard' : '/organizer-app'}
            title={t('yc.nav.openTicketingTitle')}
            onClick={() => { if (space.kind === 'org' && space.organizerUserId) rememberActingOrganizer(space.organizerUserId); }}
            style={linkStyle(false, 40, 14.5)}
            hover={hov}
          >
            <Icon name="ticket" size={20} />
            {exp && <span>{t('yc.nav.openTicketing')}</span>}
          </Hv>
        )}
        <Hv
          as="button"
          type="button"
          onClick={onToggleCompact}
          title={t('yc.nav.collapseTitle')}
          style={{ ...linkStyle(false, 40, 14.5), color: 'var(--sand-500)' }}
          hover={{ background: 'var(--sand-50)', color: 'var(--ink)' }}
        >
          <PanelIcon size={20} />
          {exp && <span>{t('yc.nav.collapse')}</span>}
        </Hv>
      </div>
    </aside>
  );
}

function Tag({ children }: { children: ReactNode }) {
  return (
    <span style={{ height: 20, padding: '0 8px', borderRadius: 99, background: 'var(--sand-100)', color: 'var(--sand-600)', fontSize: 11, fontWeight: 600, display: 'inline-flex', alignItems: 'center', flex: 'none' }}>
      {children}
    </span>
  );
}

function Bubble({ n, tone, format }: { n: number; tone: 'red' | 'sand'; format: (v: number) => string }) {
  return (
    <span style={{
      minWidth: 20, height: 20, padding: '0 6px', boxSizing: 'border-box', borderRadius: 99,
      background: tone === 'red' ? 'var(--red-500)' : 'var(--sand-100)', color: tone === 'red' ? '#fff' : 'var(--sand-700)',
      fontSize: 12, fontWeight: 600, display: 'grid', placeItems: 'center',
    }}>{n > 99 ? '99+' : format(n)}</span>
  );
}
