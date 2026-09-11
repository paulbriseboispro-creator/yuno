import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { INPUT_STYLE, INNER_BG, BORDER, T2, T3 } from '@/components/admin/ui';

/** Pagination + barre de recherche partagées par les onglets de l'annuaire. */
export function Paginator({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
  if (totalPages <= 1) return null;
  const btn = (disabled: boolean) => ({ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, opacity: disabled ? 0.4 : 1 });
  return (
    <div className="flex items-center justify-end gap-2">
      <button onClick={() => onPage(Math.max(0, page - 1))} disabled={page === 0} className="inline-flex items-center justify-center h-8 w-8 rounded-lg cursor-pointer transition-all duration-150 disabled:cursor-not-allowed" style={btn(page === 0)}><ChevronLeft className="h-4 w-4" /></button>
      <span className="tabular-nums px-2" style={{ color: T3, fontSize: 12.5 }}>{page + 1} / {totalPages}</span>
      <button onClick={() => onPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} className="inline-flex items-center justify-center h-8 w-8 rounded-lg cursor-pointer transition-all duration-150 disabled:cursor-not-allowed" style={btn(page >= totalPages - 1)}><ChevronRight className="h-4 w-4" /></button>
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder, right }: { value: string; onChange: (v: string) => void; placeholder: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="relative flex-1 max-w-sm min-w-[200px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: T3 }} />
        <input placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} style={{ ...INPUT_STYLE, paddingLeft: 36 }} />
      </div>
      {right}
    </div>
  );
}

/** Échappe les caractères qui cassent un filtre PostgREST `ilike`. */
export function safeLike(s: string): string {
  return s.replace(/[%_,()]/g, ' ').trim();
}
