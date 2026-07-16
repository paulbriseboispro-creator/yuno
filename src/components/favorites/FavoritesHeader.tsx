import { Search, X, LayoutGrid, Rows3 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { D, type Filter } from './shared';

/* ── Chip de filtre ── */
function FilterChip({
  label, count, active, onClick,
}: {
  label: string; count: number; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        fontFamily: D.mono,
        fontSize: 11.5,
        fontWeight: 600,
        letterSpacing: '.04em',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        padding: '8px 12px',
        borderRadius: 10,
        transition: 'background-color .18s ease, box-shadow .18s ease, color .18s ease, border-color .18s ease',
        color: active ? '#fff' : D.muted,
        backgroundColor: active ? D.red : 'rgba(255,255,255,.05)',
        border: `1px solid ${active ? 'rgba(232,25,44,.55)' : 'rgba(255,255,255,.10)'}`,
        boxShadow: active ? '0 6px 18px -6px rgba(232,25,44,.6)' : 'none',
      }}
    >
      {label}
      <span style={{
        fontFamily: D.mono,
        fontSize: 9.5,
        fontWeight: 700,
        lineHeight: 1,
        padding: '3px 5px',
        borderRadius: 5,
        color: active ? 'rgba(255,255,255,.9)' : D.faint,
        background: active ? 'rgba(255,255,255,.2)' : D.elevated,
      }}>
        {count}
      </span>
    </button>
  );
}

/* ── Bascule grille / liste ──
   Segments de 40px : sous les 44px du HIG, mais c'est une commande secondaire
   logée dans la barre de recherche (cf. maquette) et l'élargir mangerait la
   moitié du champ sur un écran de 375px. */
function ViewToggle({ view, onChange }: { view: 'grid' | 'list'; onChange: (v: 'grid' | 'list') => void }) {
  const { t } = useLanguage();
  const OPTIONS = [
    { id: 'grid' as const, icon: LayoutGrid, labelKey: 'favorites.viewGrid' },
    { id: 'list' as const, icon: Rows3,      labelKey: 'favorites.viewList' },
  ];
  return (
    <div role="group" style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 10, background: 'rgba(0,0,0,.38)', border: `1px solid ${D.line}`, flexShrink: 0 }}>
      {OPTIONS.map(({ id, icon: Icon, labelKey }) => {
        const active = view === id;
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            aria-pressed={active}
            aria-label={t(labelKey)}
            title={t(labelKey)}
            style={{
              width: 38,
              height: 32,
              borderRadius: 7,
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
              border: 'none',
              padding: 0,
              background: active ? D.elevated : 'transparent',
              color: active ? '#fff' : D.faint,
              transition: 'background-color .18s ease, color .18s ease',
            }}
          >
            <Icon size={14} strokeWidth={2.2} />
          </button>
        );
      })}
    </div>
  );
}

export interface FavoritesHeaderProps {
  totalCount: number;
  /** Cache chips + recherche : sans un seul favori, il n'y a rien à filtrer. */
  bare: boolean;
  counts: Record<Filter, number>;
  activeFilter: Filter;
  onFilter: (f: Filter) => void;
  query: string;
  onQuery: (q: string) => void;
  view: 'grid' | 'list';
  onView: (v: 'grid' | 'list') => void;
}

/**
 * En-tête collant de /favorites : titre + total, chips de filtre scrollables,
 * recherche et bascule grille/liste. Purement présentationnel — tout l'état vit
 * dans la page, ce qui rend l'en-tête rendable seul (harness de preview).
 */
export function FavoritesHeader({
  totalCount, bare, counts, activeFilter, onFilter, query, onQuery, view, onView,
}: FavoritesHeaderProps) {
  const { t } = useLanguage();

  const FILTERS: { id: Filter; label: string }[] = [
    { id: 'all',        label: t('favorites.filterAll') },
    { id: 'clubs',      label: t('favorites.clubs') },
    { id: 'events',     label: t('favorites.tabParties') },
    { id: 'djs',        label: `${t('favorites.typeDJ')}s` },
    { id: 'drinks',     label: t('favorites.drinks') },
    { id: 'organizers', label: t('favorites.tabOrganizers') },
  ];

  return (
    <header style={{
      position: 'sticky',
      top: 0,
      zIndex: 40,
      paddingTop: 'env(safe-area-inset-top, 0px)',
      background: 'rgba(10,10,10,.92)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      borderBottom: '1px solid rgba(255,255,255,.07)',
    }}>
      {/* Glow ambiant — le rouge de marque qui « allume » le haut de l'écran */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          backgroundImage: 'radial-gradient(120% 140% at 18% -20%, rgba(232,25,44,.20), transparent 60%)',
        }}
      />

      <div style={{ position: 'relative', maxWidth: 512, margin: '0 auto' }}>
        {/* Titre + total */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 20px 14px' }}>
          <h1 style={{ margin: 0, fontFamily: D.display, fontSize: 26, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1 }}>
            {t('nav.favorites')}
          </h1>
          {totalCount > 0 && (
            <span style={{
              fontFamily: D.mono,
              fontSize: 11,
              fontWeight: 600,
              color: D.faint,
              background: D.elevated,
              border: `1px solid ${D.line}`,
              padding: '4px 11px',
              borderRadius: 999,
              flexShrink: 0,
            }}>
              {totalCount}
            </span>
          )}
        </div>

        {!bare && (
          <>
            {/* ── Chips de filtre — même pattern qu'ExploreChipRow ── */}
            <style>{`.fav-hscroll::-webkit-scrollbar{display:none}`}</style>
            <div
              className="fav-hscroll flex gap-2 overflow-x-auto"
              style={{
                scrollbarWidth: 'none' as const,
                msOverflowStyle: 'none',
                WebkitOverflowScrolling: 'touch',
                paddingLeft: 20,
                paddingBottom: 14,
              } as React.CSSProperties}
            >
              {FILTERS.map((f) => (
                <FilterChip
                  key={f.id}
                  label={f.label}
                  count={counts[f.id]}
                  active={activeFilter === f.id}
                  onClick={() => onFilter(f.id)}
                />
              ))}
              <div style={{ width: 20, flexShrink: 0 }} />
            </div>

            {/* ── Recherche + bascule de vue ── */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              margin: '0 20px 16px',
              padding: '5px 5px 5px 12px',
              background: D.input,
              border: `1px solid ${D.line}`,
              borderRadius: 14,
            }}>
              <Search size={16} strokeWidth={2.2} color={D.red} style={{ flexShrink: 0 }} />
              <input
                className="fav-search"
                type="search"
                value={query}
                onChange={(e) => onQuery(e.target.value)}
                placeholder={t('favorites.searchPlaceholder')}
                aria-label={t('favorites.searchPlaceholder')}
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: 32,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: '#fff',
                  fontFamily: D.mono,
                  // 16px : en dessous, iOS Safari zoome au focus et casse le layout.
                  fontSize: 16,
                  letterSpacing: '.01em',
                }}
              />
              {query.length > 0 && (
                <button
                  onClick={() => onQuery('')}
                  aria-label={t('favorites.clearSearch')}
                  style={{
                    width: 28,
                    height: 28,
                    flexShrink: 0,
                    borderRadius: 8,
                    display: 'grid',
                    placeItems: 'center',
                    cursor: 'pointer',
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    color: D.faint,
                  }}
                >
                  <X size={15} strokeWidth={2.2} />
                </button>
              )}
              <ViewToggle view={view} onChange={onView} />
            </div>
          </>
        )}
      </div>
    </header>
  );
}
