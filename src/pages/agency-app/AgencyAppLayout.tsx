import { Outlet, NavLink } from 'react-router-dom';
import { LayoutGrid, Users, Building2, Wallet } from 'lucide-react';
import { useAgency } from '@/hooks/useAgency';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { T1, T2, T3, RED, INNER_BG, BORDER, F_BORDER, PromoButton } from '@/components/promoter/promoter-ui';
import { Building2 as AgencyIcon } from 'lucide-react';

const NAV = [
  { to: '/agency-app', end: true, icon: LayoutGrid, fr: 'Aperçu', en: 'Overview' },
  { to: '/agency-app/promoters', end: false, icon: Users, fr: 'Promoteurs', en: 'Promoters' },
  { to: '/agency-app/clubs', end: false, icon: Building2, fr: 'Clubs', en: 'Clubs' },
  { to: '/agency-app/finance', end: false, icon: Wallet, fr: 'Finance', en: 'Finance' },
];

export default function AgencyAppLayout() {
  const { agency, loading } = useAgency();
  const { language } = useLanguage();
  const tt = (fr: string, en: string) => translate(language, fr, en);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#000' }}>
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: RED, borderTopColor: 'transparent' }} />
      </div>
    );
  }

  if (!agency) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center gap-4 px-6" style={{ background: '#000' }}>
        <AgencyIcon className="h-10 w-10" style={{ color: T3 }} />
        <p style={{ color: T1, fontSize: 15, fontWeight: 600 }}>{tt('Aucune agence configurée', 'No agency configured')}</p>
        <NavLink to="/agency/start"><PromoButton>{tt('Créer mon agence', 'Create my agency')}</PromoButton></NavLink>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: '#000' }}>
      <header
        className="sticky top-0 z-40"
        style={{ background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(14px)', borderBottom: `1px solid ${F_BORDER}` }}
      >
        <div className="mx-auto flex items-center gap-3 px-4" style={{ height: 56, maxWidth: 1040 }}>
          <div className="flex items-center justify-center flex-none" style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.22)' }}>
            <AgencyIcon className="h-4 w-4" style={{ color: RED }} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate" style={{ color: T1, fontSize: 15, fontWeight: 680, letterSpacing: '-0.01em' }}>{agency.name}</p>
            <p style={{ color: T3, fontSize: 10.5 }}>{tt('Agence de promoteurs', 'Promoter agency')}</p>
          </div>
        </div>
        <nav className="mx-auto flex items-center gap-1 px-3 overflow-x-auto" style={{ maxWidth: 1040, paddingBottom: 8 }}>
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className="flex items-center gap-2 flex-none"
              style={({ isActive }) => ({
                padding: '7px 13px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                color: isActive ? T1 : T2,
                background: isActive ? INNER_BG : 'transparent',
                border: `1px solid ${isActive ? BORDER : 'transparent'}`,
                whiteSpace: 'nowrap', textDecoration: 'none',
              })}
            >
              <n.icon className="h-4 w-4" />
              {tt(n.fr, n.en)}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto px-4 py-4" style={{ maxWidth: 1040 }}>
        <Outlet />
      </main>
    </div>
  );
}
