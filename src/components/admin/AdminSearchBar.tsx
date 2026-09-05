import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Search, User, Building2, CalendarDays, CornerDownLeft, type LucideIcon } from 'lucide-react';

/**
 * Recherche globale de l'admin : les PAGES du back-office (titre, chemin,
 * mots-clés), puis les utilisateurs, les clubs et les événements en base.
 * Une page correspond dès la première lettre (local, instantané) ; la base
 * est interrogée à partir de 2 caractères, avec un délai de 250 ms.
 * Clavier : ↑ ↓ pour se déplacer, Entrée pour ouvrir, Échap pour fermer.
 */

export interface AdminSearchPage {
  title: string;
  path: string;
  icon: LucideIcon;
  /** Synonymes qui doivent retrouver la page (ex. « linktree, bio, instagram »). */
  keywords?: string;
}

type ResultKind = 'page' | 'user' | 'venue' | 'event';

interface SearchResult {
  kind: ResultKind;
  id: string;
  label: string;
  sub: string | null;
  icon: LucideIcon;
  to: string;
}

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED      = '#E8192C';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const F_BORDER = 'rgba(255,255,255,0.055)';
const INNER_BG = 'rgba(255,255,255,0.032)';

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Échappe les caractères qui casseraient le filtre PostgREST `or(...ilike...)`. */
function safeLike(s: string): string {
  return s.replace(/[,()%_\\]/g, ' ').trim();
}

export default function AdminSearchBar({ pages = [] }: { pages?: AdminSearchPage[] }) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [dbResults, setDbResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Pages : correspondance locale, immédiate.
  const pageResults = useMemo<SearchResult[]>(() => {
    const q = norm(query);
    if (!q) return [];
    return pages
      .filter((p) => norm(`${p.title} ${p.path} ${p.keywords ?? ''}`).includes(q))
      .slice(0, 6)
      .map((p) => ({ kind: 'page', id: p.path, label: p.title, sub: p.path, icon: p.icon, to: p.path }));
  }, [pages, query]);

  // Base : utilisateurs, clubs, événements.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = safeLike(query);
    if (q.length < 2) { setDbResults([]); setLoading(false); return; }
    setLoading(true);
    const seq = ++seqRef.current;

    debounceRef.current = setTimeout(async () => {
      try {
        const [profilesRes, venuesRes, eventsRes] = await Promise.all([
          supabase.from('profiles').select('id, email, first_name, last_name')
            .or(`email.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%`).limit(5),
          supabase.from('venues').select('id, name, city')
            .or(`name.ilike.%${q}%,city.ilike.%${q}%`).limit(5),
          supabase.from('events').select('id, title, start_at')
            .ilike('title', `%${q}%`).order('start_at', { ascending: false }).limit(5),
        ]);
        if (seq !== seqRef.current) return; // une frappe plus récente a repris la main
        for (const r of [profilesRes, venuesRes, eventsRes]) {
          if (r.error) console.error('[AdminSearchBar]', r.error.message);
        }
        const items: SearchResult[] = [];
        (profilesRes.data || []).forEach((p) => items.push({
          kind: 'user', id: p.id,
          label: `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.email || p.id,
          sub: p.email, icon: User, to: `/admin/directory/user/${p.id}`,
        }));
        (venuesRes.data || []).forEach((v) => items.push({
          kind: 'venue', id: v.id, label: v.name, sub: v.city, icon: Building2, to: `/admin/directory/venue/${v.id}`,
        }));
        (eventsRes.data || []).forEach((e) => items.push({
          kind: 'event', id: e.id, label: e.title,
          sub: e.start_at ? new Date(e.start_at).toLocaleDateString() : null,
          icon: CalendarDays, to: `/admin/events?q=${encodeURIComponent(e.title)}`,
        }));
        setDbResults(items);
      } catch (err) {
        if (seq === seqRef.current) console.error('[AdminSearchBar]', err);
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    }, 250);
  }, [query]);

  const results = useMemo(() => [...pageResults, ...dbResults], [pageResults, dbResults]);

  useEffect(() => {
    setActive(0);
    setOpen(query.trim().length > 0);
  }, [query, results.length]);

  const handleSelect = (item: SearchResult) => {
    setOpen(false);
    setQuery('');
    navigate(item.to);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { setOpen(false); (e.target as HTMLInputElement).blur(); return; }
    if (!open || !results.length) {
      if (e.key === 'Enter' && results.length) handleSelect(results[0]);
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % results.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + results.length) % results.length); }
    else if (e.key === 'Enter') { e.preventDefault(); handleSelect(results[Math.min(active, results.length - 1)]); }
  };

  const sectionLabel = (k: ResultKind) => t(`adminSearch.${k}`);
  const showEmpty = open && !loading && results.length === 0 && query.trim().length > 0;

  return (
    <div ref={ref} className="relative w-full">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: T3 }} />
      <input
        placeholder={t('adminSearch.placeholder')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => { setFocused(true); if (query.trim()) setOpen(true); }}
        onBlur={() => setFocused(false)}
        role="combobox"
        aria-expanded={open}
        aria-controls="admin-search-results"
        className="w-full h-9 pl-9 pr-3 rounded-xl text-[13px] outline-none transition-all duration-150"
        style={{ background: INNER_BG, border: `1px solid ${focused ? 'rgba(232,25,44,0.35)' : BORDER}`, color: T1 }}
      />
      {open && (results.length > 0 || loading || showEmpty) && (
        <div
          id="admin-search-results"
          role="listbox"
          className="absolute top-full left-0 right-0 mt-1.5 z-50 rounded-xl overflow-hidden"
          style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, boxShadow: '0 18px 40px -28px rgba(0,0,0,.9)', maxHeight: '60vh', overflowY: 'auto' }}
        >
          {results.map((item, i) => {
            const first = i === 0 || results[i - 1].kind !== item.kind;
            const isActive = i === active;
            return (
              <div key={`${item.kind}-${item.id}`}>
                {first && (
                  <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase" style={{ color: T3, letterSpacing: '0.08em', borderTop: i > 0 ? `1px solid ${F_BORDER}` : 'none' }}>
                    {sectionLabel(item.kind)}
                  </p>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => handleSelect(item)}
                  className="flex items-center gap-3 w-full px-3 py-2.5 text-left transition-colors duration-150 cursor-pointer"
                  style={{ background: isActive ? 'rgba(232,25,44,0.08)' : 'transparent' }}
                >
                  <item.icon className="h-4 w-4 flex-shrink-0" style={{ color: isActive ? RED : T3 }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium truncate" style={{ color: T1 }}>{item.label}</p>
                    {item.sub && <p className="text-[11px] truncate" style={{ color: T2 }}>{item.sub}</p>}
                  </div>
                  {isActive && <CornerDownLeft className="h-3.5 w-3.5 flex-shrink-0" style={{ color: T3 }} />}
                </button>
              </div>
            );
          })}
          {loading && (
            <p className="px-3 py-2.5 text-[12px]" style={{ color: T3, borderTop: results.length ? `1px solid ${F_BORDER}` : 'none' }}>{t('adminSearch.searching')}</p>
          )}
          {showEmpty && (
            <p className="px-3 py-3 text-[12.5px]" style={{ color: T3 }}>{t('adminSearch.empty')}</p>
          )}
        </div>
      )}
    </div>
  );
}
