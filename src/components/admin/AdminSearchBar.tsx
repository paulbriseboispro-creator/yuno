import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Search, User, Building2, ShoppingBag } from 'lucide-react';

export default function AdminSearchBar() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<any>(null);

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

      const items: any[] = [];
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

  const handleSelect = (item: any) => {
    setOpen(false);
    setQuery('');
    if (item.type === 'user') navigate(`/admin/directory/user/${item.id}`);
    else if (item.type === 'venue') navigate(`/admin/directory/venue/${item.id}`);
  };

  return (
    <div ref={ref} className="relative w-full max-w-xs">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        placeholder="Rechercher…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        className="pl-8 h-9 text-sm"
      />
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-lg border border-border bg-card shadow-lg overflow-hidden">
          {results.map((item) => (
            <button
              key={`${item.type}-${item.id}`}
              onClick={() => handleSelect(item)}
              className="flex items-center gap-3 w-full px-3 py-2.5 text-left hover:bg-muted transition-colors"
            >
              <item.icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{item.label}</p>
                <p className="text-xs text-muted-foreground truncate">{item.sub}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
