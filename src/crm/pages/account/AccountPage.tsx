/**
 * Mon compte (`/crm/account/:section`) — profil, équipe et accès, abonnement
 * et facturation, notifications, aide et contact. Un rail à gauche (une
 * rangée défilante sur un écran étroit) dont l'indicateur glisse d'une
 * entrée à l'autre ; chaque section a son titre-question, comme le design.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import type { IconName } from '@/crm/ui/Icon';
import { EASE, useIntro } from '@/crm/ui/motion';
import { useNarrow } from '@/crm/ui/useNarrow';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { useTeam } from '@/crm/data/account';
import { AccountProfile } from './AccountProfile';
import { AccountTeam } from './AccountTeam';
import { AccountNotifications } from './AccountNotifications';
import { AccountHelp } from './AccountHelp';
import { AccountBilling } from './AccountBilling';

type AccountSection = 'profile' | 'team' | 'billing' | 'notifications' | 'help';
const SECTIONS: { k: AccountSection; icon: IconName; key: string }[] = [
  { k: 'profile', icon: 'user', key: 'yc.acc.profile' },
  { k: 'team', icon: 'users', key: 'yc.acc.team' },
  { k: 'billing', icon: 'card', key: 'yc.acc.billing' },
  { k: 'notifications', icon: 'bell', key: 'yc.acc.notifications' },
  { k: 'help', icon: 'help', key: 'yc.acc.help' },
];
const HEAD: Record<AccountSection, [string, string]> = {
  profile: ['yc.acc.profile.t', 'yc.acc.profile.s'],
  team: ['yc.acc.team.t', 'yc.acc.team.s'],
  billing: ['yc.acc.billing.t', 'yc.acc.billing.s'],
  notifications: ['yc.acc.notif.t', 'yc.acc.notif.s'],
  help: ['yc.acc.help.t', 'yc.acc.help.s'],
};

export default function AccountPage() {
  const { section } = useParams<{ section?: string }>();
  if (!section) return <Navigate to={CRM_ROUTES.accountSection('profile')} replace />;
  if (!SECTIONS.some((s) => s.k === section)) return <Navigate to={CRM_ROUTES.accountSection('profile')} replace />;
  return <AccountView section={section as AccountSection} />;
}

function AccountView({ section }: { section: AccountSection }) {
  const { t, n } = useCrmT();
  const { space } = useCrmScope();
  const narrow = useNarrow(1180);
  const intro = useIntro();
  const team = useTeam();
  const [headAction, setHeadAction] = useState<ReactNode>(null);
  const [profileDirty, setProfileDirty] = useState(false);
  const idx = SECTIONS.findIndex((s) => s.k === section);
  const crumb = t(SECTIONS[idx].key);
  const [titleKey, subKey] = HEAD[section];
  const members = team.data?.members.length ?? null;
  const railRef = useRef<HTMLDivElement>(null);

  // Sur un écran étroit, la rangée défile jusqu'à l'onglet ouvert.
  useEffect(() => {
    const box = railRef.current;
    const el = box?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!narrow || !box || !el) return;
    box.scrollTo({ left: Math.max(0, el.offsetLeft - 16), behavior: 'smooth' });
    // La pastille de l'équipe arrive après coup et allonge la rangée : on recale.
  }, [narrow, section, members]);

  return (
    <main style={{ flex: 1, width: '100%', maxWidth: 1240, boxSizing: 'border-box', margin: '0 auto', padding: 'clamp(24px,3vw,40px) clamp(16px,3vw,40px) 120px', display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '28px 40px' }}>
      <nav aria-label={t('yc.acc.rail')} style={{ flex: narrow ? '1 1 100%' : '1 1 256px', maxWidth: narrow ? '100%' : 272, minWidth: 0, position: narrow ? 'static' : 'sticky', top: 96, display: 'flex', flexDirection: 'column', gap: 14, opacity: intro ? 1 : 0, transform: intro ? 'none' : 'translateX(-18px)', transition: `opacity 700ms ${EASE} 160ms,transform 800ms ${EASE} 160ms` }}>
        {!narrow && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-400)', padding: '0 14px' }}>{t('yc.acc.rail')}</span>}
        <div ref={railRef} className={narrow ? 'yc-noscroll' : undefined} style={{ position: 'relative', display: 'flex', flexDirection: narrow ? 'row' : 'column', gap: narrow ? 6 : 4, overflowX: narrow ? 'auto' : 'visible', padding: narrow ? 4 : 0, margin: narrow ? -4 : 0 }}>
          {!narrow && <span aria-hidden style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 48, borderRadius: 14, background: 'var(--red-50)', transform: `translateY(${idx * 52}px)`, transition: `transform 460ms ${EASE}`, pointerEvents: 'none' }} />}
          {SECTIONS.map((s) => {
            const on = s.k === section;
            return (
              <Hv
                key={s.k}
                as={Link}
                to={CRM_ROUTES.accountSection(s.k)}
                aria-current={on ? 'page' : undefined}
                style={{ position: 'relative', flex: 'none', height: narrow ? 44 : 48, padding: '0 14px', borderRadius: 14, background: narrow && on ? 'var(--red-50)' : 'transparent', display: 'flex', alignItems: 'center', gap: 12, color: on ? 'var(--red-600)' : 'var(--sand-600)', fontSize: 14.5, fontWeight: on ? 600 : 500, textDecoration: 'none', whiteSpace: 'nowrap', transition: 'color 240ms,background 240ms' }}
                hover={{ color: on ? 'var(--red-600)' : 'var(--ink)', textDecoration: 'none' }}
                active={{ transform: 'scale(.98)' }}
              >
                <Icon name={s.icon} size={19} stroke={2} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t(s.key)}</span>
                {s.k === 'team' && members !== null && (
                  <span style={{ minWidth: 20, height: 20, padding: '0 6px', boxSizing: 'border-box', borderRadius: 99, background: '#fff', color: 'var(--sand-700)', fontSize: 12, fontWeight: 600, display: 'grid', placeItems: 'center', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>{n(members)}</span>
                )}
                {s.k === 'profile' && profileDirty && !on && <span title={t('yc.acc.unsavedDot')} style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--red-500)' }} />}
              </Hv>
            );
          })}
        </div>
      </nav>

      <div style={{ flex: '999 1 560px', minWidth: 0, maxWidth: 860, display: 'flex', flexDirection: 'column' }}>
        <div key={`h-${section}`} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px 24px', marginBottom: 26, animation: `yc-row 640ms ${EASE} both` }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, flex: '1 1 360px' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.acc.kick', { crumb })}</span>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,3vw,36px)', lineHeight: 1.05, letterSpacing: '-.035em', textWrap: 'balance' }}>{t(titleKey, { name: space.name })}</h1>
            <p style={{ margin: 0, fontSize: 16, lineHeight: 1.45, fontWeight: 500, color: 'var(--sand-600)', textWrap: 'pretty', maxWidth: 600 }}>{t(subKey)}</p>
          </div>
          {headAction}
        </div>
        <div key={`b-${section}`} style={{ animation: `yc-rise 520ms ${EASE} both` }}>
          {section === 'profile' && <AccountProfile onDirty={setProfileDirty} />}
          {section === 'team' && <AccountTeam setHeadAction={setHeadAction} />}
          {section === 'billing' && <AccountBilling />}
          {section === 'notifications' && <AccountNotifications setHeadAction={setHeadAction} />}
          {section === 'help' && <AccountHelp />}
        </div>
      </div>
    </main>
  );
}
