import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Search, User, Building2, type LucideIcon } from 'lucide-react';

interface SearchResult {
  type: 'user' | 'venue';
  id: string;
  label: string;
  sub: string | null;
  icon: LucideIcon;
}

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';

export default function AdminSearchBar() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 2) { setResults([]); setOpen(false); return; }

    debounceRef.current = setTimeout(async () => {
      const [profilesRes, venuesRes] = await Promise.all([
        supabase.from('profiles').select('id, email, first_name, last_name').or(`email.ilike.%${query}%,first_name.ilike.%${query}%,last_name.ilike.%${query}%`).limit(5),
        supabase.from('venues').select('id, name, city').or(`name.ilike.%${query}%,city.ilike.%${query}%`).limit(5),
      ]);

      const items: SearchResult[] = [];
      (profilesRes.data || []).forEach(p => items.push({
        type: 'user', id: p.id,
        label: `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.email,
        sub: p.email, icon: User,
      }));
      (venuesRes.data || []).forEach(v => items.push({
        type: 'venue', id: v.id,
        label: v.name, sub: v.city, icon: Building2,
      }));
      setResults(items);
      setOpen(items.length > 0);
    }, 300);
  }, [query]);

  const handleSelect = (item: SearchResult) => {
    setOpen(false);
    setQuery('');
    if (item.type === 'user') navigate(`/admin/directory/user/${item.id}`);
    else if (item.type === 'venue') navigate(`/admin/directory/venue/${item.id}`);
  };

  return (
    <div ref={ref} className="relative w-full">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: T3 }} />
      <input
        placeholder="Rechercher…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => { setFocused(true); if (results.length > 0) setOpen(true); }}
        onBlur={() => setFocused(false)}
        className="w-full h-9 pl-9 pr-3 rounded-xl text-[13px] outline-none transition-all duration-150"
        style={{
          background: INNER_BG,
          border: `1px solid ${focused ? 'rgba(232,25,44,0.35)' : BORDER}`,
          color: T1,
        }}
      />
      {open && (
        <div
          className="absolute top-full left-0 right-0 mt-1.5 z-50 rounded-xl overflow-hidden"
          style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, boxShadow: '0 18px 40px -28px rgba(0,0,0,.9)' }}
        >
          {results.map((item) => (
            <button
              key={`${item.type}-${item.id}`}
              onClick={() => handleSelect(item)}
              className="flex items-center gap-3 w-full px-3 py-2.5 text-left transition-colors duration-150 cursor-pointer hover:bg-white/[0.04]"
            >
              <item.icon className="h-4 w-4 flex-shrink-0" style={{ color: T3 }} />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium truncate" style={{ color: T1 }}>{item.label}</p>
                <p className="text-[11px] truncate" style={{ color: T2 }}>{item.sub}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
