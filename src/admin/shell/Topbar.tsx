/**
 * En-tête de l'admin : fil d'Ariane (rubrique › page), recherche ⌘K, cloche
 * des alertes plateforme, portée démo, clair / sombre. Sur téléphone, le
 * bouton du menu ouvre la barre latérale.
 */
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, FlaskConical, Menu, Moon, Search, Sun } from 'lucide-react';
import { NotificationsBell } from '@/components/NotificationsBell';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ADMIN_FEED_CONFIG } from '@/lib/notifications';
import { useAdminScope } from '@/components/admin/AdminScope';
import { useProTheme, originOf } from '@/lib/proTheme';
import { activeEntry, entryLabelKey, rubricLabelKey } from '../nav';
import { useAdminT } from '../ui/i18n';
import { PulseBar } from './Pulse';

export function Breadcrumbs() {
  const { t } = useAdminT();
  const { pathname } = useLocation();
  const { rubric, entry } = activeEntry(pathname);
  const first = rubric.entries.find((e) => !e.hidden);
  const deeper = entry && pathname.replace(/\/+$/, '') !== entry.path;
  return (
    <nav aria-label={t('adm.shell.breadcrumb')} className="flex min-w-0 items-center gap-1.5 text-[13px]">
      <Link to={first?.path ?? rubric.base} className="a-t2 truncate no-underline hover:text-[var(--a-text)]">{t(rubricLabelKey(rubric.id))}</Link>
      {entry && (
        <>
          <ChevronRight className="a-t3 h-3.5 w-3.5 flex-none" />
          {deeper
            ? <Link to={entry.path} className="a-t2 truncate no-underline hover:text-[var(--a-text)]">{t(entryLabelKey(rubric.id, entry.key))}</Link>
            : <span className="a-t1 truncate font-medium" aria-current="page">{t(entryLabelKey(rubric.id, entry.key))}</span>}
        </>
      )}
      {deeper && (
        <>
          <ChevronRight className="a-t3 h-3.5 w-3.5 flex-none" />
          <span className="a-t1 truncate font-medium" aria-current="page">{t('adm.shell.detail')}</span>
        </>
      )}
    </nav>
  );
}

export function DemoSwitch() {
  const { t } = useAdminT();
  const { includeDemo, setIncludeDemo } = useAdminScope();
  return (
    <button type="button" aria-pressed={includeDemo} onClick={() => setIncludeDemo(!includeDemo)}
      title={t('adm.shell.demoHint')}
      className="a-btn a-btn--sm"
      style={includeDemo ? { background: 'var(--a-warn-soft)', borderColor: 'var(--a-warn)', color: 'var(--a-warn)' } : undefined}>
      <FlaskConical className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{includeDemo ? t('adm.shell.demoOn') : t('adm.shell.demoOff')}</span>
    </button>
  );
}

export function ThemeSwitch() {
  const { t } = useAdminT();
  const { pref, setPref } = useProTheme();
  const dark = pref !== 'light';
  return (
    <button type="button" className="a-btn a-btn--ghost a-btn--icon" aria-label={dark ? t('adm.shell.light') : t('adm.shell.dark')}
      title={dark ? t('adm.shell.light') : t('adm.shell.dark')}
      onClick={(e) => setPref(dark ? 'light' : 'dark', originOf(e.currentTarget))}>
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

export function Topbar({ onMenu, onSearch }: { onMenu: () => void; onSearch: () => void }) {
  const { t } = useAdminT();
  return (
    <header className="sticky top-0 z-40 flex h-12 items-center gap-2 border-b px-3 md:px-5"
      style={{ background: 'color-mix(in srgb, var(--a-bg) 88%, transparent)', backdropFilter: 'blur(10px)', paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      {/* Les classes d'affichage vivent sur un conteneur : `.a-btn` (plus spécifique) écraserait `hidden`. */}
      <div className="lg:hidden"><button type="button" className="a-btn a-btn--ghost a-btn--icon" onClick={onMenu} aria-label={t('adm.shell.menu')}><Menu className="h-4 w-4" /></button></div>
      <div className="min-w-0 flex-1"><Breadcrumbs /></div>
      <PulseBar />
      <div className="hidden md:block">
        <button type="button" onClick={onSearch} className="a-btn a-btn--sm w-[220px] justify-start" style={{ color: 'var(--a-text-3)' }}>
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">{t('adm.shell.search')}</span>
          <span className="a-kbd">⌘K</span>
        </button>
      </div>
      <div className="md:hidden"><button type="button" onClick={onSearch} className="a-btn a-btn--ghost a-btn--icon" aria-label={t('adm.shell.search')}><Search className="h-4 w-4" /></button></div>
      <DemoSwitch />
      <ThemeSwitch />
      <TooltipProvider delayDuration={300}><NotificationsBell config={ADMIN_FEED_CONFIG} /></TooltipProvider>
    </header>
  );
}
