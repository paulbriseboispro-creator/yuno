/**
 * Recherche globale ⌘K : les pages de l'admin (carte src/admin/nav.ts), puis
 * la base par la RPC `admin_search` (clubs, organisateurs, agences, comptes
 * CRM, personnes, soirées, commandes), à partir de 2 caractères, 200 ms après
 * la dernière frappe. Le filtre des pages est local ; celui de la base est
 * fait par le serveur ; cmdk ne filtre rien lui-même (`shouldFilter={false}`).
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as D from '@radix-ui/react-dialog';
import { Command } from 'cmdk';
import { Building2, CalendarDays, Contact, CornerDownLeft, FileText, Handshake, Receipt, Search, Sparkles, User, type LucideIcon } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAdminScope } from '@/components/admin/AdminScope';
import { ADMIN_NAV, entryLabelKey, rubricLabelKey } from '../nav';
import { useAdminT } from '../ui/i18n';
import { useAdminPortal } from '../ui/portal';
import { searchResultHref, type AdminSearchRow } from './searchHref';

const KIND_ICON: Record<AdminSearchRow['kind'], LucideIcon> = {
  venue: Building2, organizer: Sparkles, agency: Handshake, crm: Contact, person: User, event: CalendarDays, ticket: Receipt, table: Receipt,
};
const KIND_ORDER: AdminSearchRow['kind'][] = ['venue', 'organizer', 'agency', 'crm', 'person', 'event', 'ticket', 'table'];

function norm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const id = window.setTimeout(() => setV(value), ms); return () => window.clearTimeout(id); }, [value, ms]);
  return v;
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useAdminT();
  const navigate = useNavigate();
  const container = useAdminPortal();
  const { includeDemo } = useAdminScope();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 200);

  useEffect(() => { if (!open) setQ(''); }, [open]);

  const db = useQuery({
    queryKey: ['admin', 'search', dq, includeDemo],
    enabled: open && dq.length >= 2,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_search' as never, { p_q: dq, p_include_demo: includeDemo } as never);
      if (error) throw error;
      return (data ?? []) as unknown as AdminSearchRow[];
    },
  });

  const pages = useMemo(() => ADMIN_NAV.flatMap((r) => r.entries.filter((e) => !e.hidden).map((e) => ({
    path: e.path,
    label: t(entryLabelKey(r.id, e.key)),
    rubric: t(rubricLabelKey(r.id)),
  }))), [t]);

  const shownPages = useMemo(() => {
    const n = norm(q);
    if (!n) return pages.slice(0, 8);
    return pages.filter((p) => norm(`${p.label} ${p.rubric}`).includes(n)).slice(0, 8);
  }, [pages, q]);

  const groups = useMemo(() => {
    const rows = dq.length >= 2 ? db.data ?? [] : [];
    return KIND_ORDER.map((k) => ({ kind: k, rows: rows.filter((r) => r.kind === k) })).filter((g) => g.rows.length > 0);
  }, [db.data, dq]);

  const go = (to: string) => { onOpenChange(false); navigate(to); };

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal container={container ?? undefined}>
        <D.Overlay className="fixed inset-0 z-[95]" style={{ background: 'var(--a-overlay)' }} />
        <D.Content className="fixed left-1/2 top-[12vh] z-[96] w-[min(640px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-xl border outline-none"
          style={{ background: 'var(--a-panel)', boxShadow: 'var(--a-shadow-pop)' }}>
          <D.Title className="sr-only">{t('adm.shell.search')}</D.Title>
          <D.Description className="sr-only">{t('adm.shell.searchHint')}</D.Description>
          <Command label={t('adm.shell.search')} shouldFilter={false} loop>
            <div className="flex items-center gap-2.5 border-b px-4">
              <Search className="a-t3 h-4 w-4 flex-none" />
              <Command.Input value={q} onValueChange={setQ} placeholder={t('adm.shell.searchPh')} autoFocus />
              <span className="a-kbd">esc</span>
            </div>
            <Command.List className="max-h-[min(420px,60vh)] overflow-y-auto p-2">
              {shownPages.length === 0 && groups.length === 0 && (
                <div className="a-t3 px-3 py-6 text-center text-[13.5px]">
                  {db.isFetching || q.trim() !== dq ? t('adm.shell.searching') : t('adm.shell.noResult', { q: q.trim() })}
                </div>
              )}
              {shownPages.length > 0 && <Command.Group heading={t('adm.shell.pages')}>
                {shownPages.map((p) => (
                  <Command.Item key={p.path} value={`page:${p.path}`} onSelect={() => go(p.path)}>
                    <FileText className="a-t3 h-4 w-4 flex-none" />
                    <span className="flex-1 truncate">{p.label}</span>
                    <span className="a-t3 text-[12px]">{p.rubric}</span>
                  </Command.Item>
                ))}
              </Command.Group>}
              {groups.map((g) => {
                const Icon = KIND_ICON[g.kind];
                return (
                  <Command.Group key={g.kind} heading={t(`adm.shell.kind.${g.kind}`)}>
                    {g.rows.map((r) => (
                      <Command.Item key={`${r.kind}:${r.id}`} value={`${r.kind}:${r.id}`} onSelect={() => go(searchResultHref(r))}>
                        <Icon className="a-t3 h-4 w-4 flex-none" />
                        <span className="min-w-0 flex-1 truncate">{r.label}</span>
                        {r.sub && <span className="a-t3 max-w-[50%] truncate text-[12px]">{r.sub}</span>}
                      </Command.Item>
                    ))}
                  </Command.Group>
                );
              })}
            </Command.List>
            <div className="a-t3 flex items-center gap-4 border-t px-4 py-2 text-[12px]">
              <span>↑↓ {t('adm.shell.palNav')}</span>
              <span className="inline-flex items-center gap-1"><CornerDownLeft className="h-3 w-3" /> {t('adm.shell.palOpen')}</span>
              {db.isError && <span style={{ color: 'var(--a-neg)' }}>{t('adm.ui.error.title')}</span>}
            </div>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
