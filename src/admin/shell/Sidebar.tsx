/**
 * Barre latérale : neuf rubriques, chacune ouvre ses entrées quand on y est.
 * Lit src/admin/nav.ts et rien d'autre.
 */
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Building2, ChevronRight, Coins, Inbox, LineChart, MapPin, Megaphone, Scale, Server, Users, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ADMIN_NAV, activeEntry, entryLabelKey, rubricLabelKey, type AdminRubric } from '../nav';
import { useAdminT } from '../ui/i18n';
import { useNavBadges } from './badges';

const RUBRIC_ICON: Record<AdminRubric['icon'], LucideIcon> = {
  Inbox, LineChart, MapPin, Building2, Users, Coins, Megaphone, Scale, Server,
};

export function Sidebar({ onNavigate, rail }: { onNavigate?: () => void; rail?: boolean }) {
  const { t } = useAdminT();
  const { pathname } = useLocation();
  const { rubric: current, entry } = activeEntry(pathname);
  const badges = useNavBadges();
  // Une rubrique ouverte à la main reste ouverte ; celle de l'adresse l'est toujours.
  const [opened, setOpened] = useState<Set<string>>(() => new Set());

  // Barre repliée : une icône par rubrique, son nom au survol, un point s'il y a à faire.
  if (rail) {
    return (
      <nav aria-label={t('adm.shell.menu')} className="flex flex-col items-center gap-1 py-2">
        {ADMIN_NAV.map((r) => {
          const Icon = RUBRIC_ICON[r.icon];
          const here = r.id === current.id;
          const visible = r.entries.filter((e) => !e.hidden);
          const n = visible.reduce((s, e) => s + (e.badge ? badges[e.badge] ?? 0 : 0), 0);
          return (
            <Link key={r.id} to={visible[0]?.path ?? r.base} title={t(rubricLabelKey(r.id))} aria-label={t(rubricLabelKey(r.id))}
              aria-current={here ? 'page' : undefined}
              className="a-focus relative grid h-9 w-9 place-items-center rounded-md hover:bg-[var(--a-hover)]"
              style={{ background: here ? 'var(--a-accent-soft)' : undefined }}>
              <Icon className="h-4 w-4" style={{ color: here ? 'var(--a-accent)' : 'var(--a-text-2)' }} />
              {n > 0 && <span aria-hidden className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full" style={{ background: 'var(--a-accent)' }} />}
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav aria-label={t('adm.shell.menu')} className="flex flex-col gap-0.5 px-2 py-2">
      {ADMIN_NAV.map((r) => {
        const Icon = RUBRIC_ICON[r.icon];
        const here = r.id === current.id;
        const open = here || opened.has(r.id);
        const visible = r.entries.filter((e) => !e.hidden);
        const rubricBadge = visible.reduce((s, e) => s + (e.badge ? badges[e.badge] ?? 0 : 0), 0);
        return (
          <div key={r.id}>
            <div className="flex items-center">
              <Link to={visible[0]?.path ?? r.base} onClick={onNavigate}
                className={cn('a-focus flex h-8 min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 text-[13.5px] no-underline transition-colors hover:bg-[var(--a-hover)]')}
                style={{ color: here ? 'var(--a-text)' : 'var(--a-text-2)', fontWeight: here ? 600 : 500 }}>
                <Icon className="h-4 w-4 flex-none" style={{ color: here ? 'var(--a-accent)' : 'var(--a-text-3)' }} />
                <span className="flex-1 truncate">{t(rubricLabelKey(r.id))}</span>
                {!open && rubricBadge > 0 && <CountBadge n={rubricBadge} />}
              </Link>
              {!here && visible.length > 1 && (
                <button type="button" aria-expanded={open} aria-label={t(rubricLabelKey(r.id))}
                  onClick={() => setOpened((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}
                  className="a-focus a-t3 grid h-8 w-6 place-items-center rounded-md border-0 bg-transparent hover:bg-[var(--a-hover)]" style={{ cursor: 'pointer' }}>
                  <ChevronRight className="h-3.5 w-3.5 transition-transform" style={{ transform: open ? 'rotate(90deg)' : undefined }} />
                </button>
              )}
            </div>
            {open && visible.length > 1 && (
              <div className="mb-1 ml-[17px] flex flex-col gap-px border-l pl-2">
                {visible.map((e) => {
                  const on = entry?.path === e.path;
                  const n = e.badge ? badges[e.badge] ?? 0 : 0;
                  return (
                    <Link key={e.path} to={e.path} onClick={onNavigate} aria-current={on ? 'page' : undefined}
                      className="a-focus relative flex h-8 items-center gap-2 rounded-md px-2 text-[13px] no-underline transition-colors hover:bg-[var(--a-hover)]"
                      style={{ color: on ? 'var(--a-accent-text)' : 'var(--a-text-2)', fontWeight: on ? 600 : 400, background: on ? 'var(--a-accent-soft)' : undefined }}>
                      {/* L'entrée active : une barre rouge sur le rail, un fond doux. */}
                      {on && <span aria-hidden className="absolute -left-[9px] top-1.5 bottom-1.5 w-[2px] rounded-full" style={{ background: 'var(--a-accent)' }} />}
                      <span className="flex-1 truncate">{t(entryLabelKey(r.id, e.key))}</span>
                      {n > 0 && <CountBadge n={n} />}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function CountBadge({ n }: { n: number }) {
  return (
    <span className="a-num grid h-[18px] min-w-[18px] place-items-center rounded-full px-1.5 text-[11px] font-semibold"
      style={{ background: 'var(--a-active)', color: 'var(--a-text)' }}>{n > 99 ? '99+' : n}</span>
  );
}
