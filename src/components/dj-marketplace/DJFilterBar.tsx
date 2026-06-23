import { useState } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { makeDjT } from '@/i18n/djTranslate';
import { DJ_GENRES, RADIUS_PRESETS, type MarketplaceFilters, type DiscoveryMode } from './types';

/**
 * Faceted filters for the marketplace. Genre + city for everyone; booker mode adds
 * min followers, a price range and an "available on" date. Dark styling for both surfaces.
 */

const inputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.10)',
  borderRadius: 12,
  color: '#fff',
  fontSize: 13,
  padding: '9px 12px',
  outline: 'none',
  width: '100%',
};

const labelStyle: React.CSSProperties = {
  fontFamily: 'monospace', fontSize: 10, color: '#7A7A7E',
  letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6, display: 'block',
};

export function DJFilterBar({
  mode,
  value,
  onChange,
}: {
  mode: DiscoveryMode;
  value: MarketplaceFilters;
  onChange: (next: MarketplaceFilters) => void;
}) {
  const { language } = useLanguage();
  const tt = makeDjT(language);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const set = (patch: Partial<MarketplaceFilters>) => onChange({ ...value, ...patch });

  const activeCount =
    (value.minFollowers ? 1 : 0) + (value.minFee != null || value.maxFee != null ? 1 : 0) + (value.availableOn ? 1 : 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* City / zone search + advanced toggle */}
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <Search size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: '#7A7A7E' }} />
          <input
            value={value.city ?? ''}
            onChange={(e) => set({ city: e.target.value || null })}
            placeholder={mode === 'booker'
              ? tt('Zone (ta ville)', 'Zone (your city)', 'Zona (tu ciudad)')
              : tt('Ville', 'City', 'Ciudad')}
            style={{ ...inputStyle, paddingLeft: 34 }}
          />
        </div>
        {mode === 'booker' && (
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            style={{
              flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '0 14px', borderRadius: 12, cursor: 'pointer',
              background: showAdvanced || activeCount ? 'rgba(232,25,44,0.12)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${showAdvanced || activeCount ? 'rgba(232,25,44,0.3)' : 'rgba(255,255,255,0.10)'}`,
              color: showAdvanced || activeCount ? '#E8192C' : '#B8B8BC', fontSize: 13, fontWeight: 600,
            }}
          >
            <SlidersHorizontal size={14} />
            {tt('Filtres', 'Filters', 'Filtros')}{activeCount ? ` · ${activeCount}` : ''}
          </button>
        )}
      </div>

      {/* Radius around the booker's zone (booker only) */}
      {mode === 'booker' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          <span style={{ ...labelStyle, marginBottom: 0, marginRight: 2 }}>{tt('Rayon', 'Radius', 'Radio')}</span>
          {RADIUS_PRESETS.map(({ km }) => {
            const active = value.radiusKm === km;
            const lbl = km == null ? tt('Partout', 'Anywhere', 'Todo') : `${km} km`;
            return (
              <button
                key={km ?? 'all'}
                onClick={() => set({ radiusKm: km })}
                style={{
                  flexShrink: 0, padding: '6px 11px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
                  background: active ? 'rgba(232,25,44,0.16)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${active ? 'rgba(232,25,44,0.3)' : 'rgba(255,255,255,0.10)'}`,
                  color: active ? '#fff' : '#B8B8BC',
                }}
              >
                {lbl}
              </button>
            );
          })}
        </div>
      )}

      {/* Genre chips */}
      <div style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 2, scrollbarWidth: 'none' }}>
        {value.genre && (
          <button
            onClick={() => set({ genre: null })}
            style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: '#E8192C', color: '#fff', border: 'none', cursor: 'pointer' }}
          >
            {value.genre}<X size={12} />
          </button>
        )}
        {DJ_GENRES.filter((g) => g !== value.genre).map((g) => (
          <button
            key={g}
            onClick={() => set({ genre: g })}
            style={{ flexShrink: 0, padding: '6px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', color: '#B8B8BC', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            {g}
          </button>
        ))}
      </div>

      {/* Advanced (booker) */}
      {mode === 'booker' && showAdvanced && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, padding: 14, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14 }}>
          <div>
            <span style={labelStyle}>{tt('Dispo le', 'Available on', 'Disponible el')}</span>
            <input type="date" value={value.availableOn ?? ''} onChange={(e) => set({ availableOn: e.target.value || null })} style={inputStyle} />
          </div>
          <div>
            <span style={labelStyle}>{tt('Abonnés min', 'Min followers', 'Seguidores mín')}</span>
            <input type="number" min={0} value={value.minFollowers ?? ''} onChange={(e) => set({ minFollowers: e.target.value ? Number(e.target.value) : null })} placeholder="0" style={inputStyle} />
          </div>
          <div>
            <span style={labelStyle}>{tt('Budget min', 'Min budget', 'Presup. mín')}</span>
            <input type="number" min={0} value={value.minFee ?? ''} onChange={(e) => set({ minFee: e.target.value ? Number(e.target.value) : null })} placeholder="0 €" style={inputStyle} />
          </div>
          <div>
            <span style={labelStyle}>{tt('Budget max', 'Max budget', 'Presup. máx')}</span>
            <input type="number" min={0} value={value.maxFee ?? ''} onChange={(e) => set({ maxFee: e.target.value ? Number(e.target.value) : null })} placeholder="∞" style={inputStyle} />
          </div>
        </div>
      )}
    </div>
  );
}
