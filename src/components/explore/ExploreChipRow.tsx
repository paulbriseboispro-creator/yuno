import { useLanguage } from '@/contexts/LanguageContext';

type DateChip = 'today' | 'tomorrow' | 'weekend';

interface ExploreChipRowProps {
  dateFilter: string;
  onDateChip: (filter: DateChip) => void;
  genreFilter: string[];
  onGenreToggle: (genre: string) => void;
  freeOnly: boolean;
  onFreeToggle: () => void;
}

const DATE_CHIPS: { key: DateChip; i18n: string }[] = [
  { key: 'today', i18n: 'explore.today' },
  { key: 'tomorrow', i18n: 'explore.tomorrow' },
  { key: 'weekend', i18n: 'explore.weekend' },
];

const GENRE_CHIPS = ['House', 'Open Format', 'Reggaeton'];

export function ExploreChipRow({
  dateFilter,
  onDateChip,
  genreFilter,
  onGenreToggle,
  freeOnly,
  onFreeToggle,
}: ExploreChipRowProps) {
  const { t } = useLanguage();
  return (
    <div
      className="flex gap-2 overflow-x-auto"
      style={{
        paddingLeft: 20,
        paddingRight: 20,
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        WebkitOverflowScrolling: 'touch',
      } as React.CSSProperties}
    >
      {DATE_CHIPS.map(c => {
        const on = dateFilter === c.key;
        return (
          <button
            key={c.key}
            onClick={() => onDateChip(c.key)}
            className="font-mono font-semibold shrink-0"
            style={{
              fontSize: '13.5px',
              padding: '9px 15px',
              borderRadius: '10px',
              border: `1px solid ${on ? '#E8192C' : 'rgba(255,255,255,0.14)'}`,
              background: on ? '#E8192C' : '#141417',
              color: on ? '#fff' : '#9A9AA4',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              lineHeight: 1,
            }}
          >
            {t(c.i18n)}
          </button>
        );
      })}

      <button
        onClick={onFreeToggle}
        className="font-mono font-semibold shrink-0"
        style={{
          fontSize: '13.5px',
          padding: '9px 15px',
          borderRadius: '10px',
          border: `1px solid ${freeOnly ? '#E8192C' : 'rgba(255,255,255,0.14)'}`,
          background: freeOnly ? '#E8192C' : '#141417',
          color: freeOnly ? '#fff' : '#9A9AA4',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          lineHeight: 1,
        }}
      >
        {t('explore.free')}
      </button>

      {GENRE_CHIPS.map(g => {
        const on = genreFilter.includes(g);
        return (
          <button
            key={g}
            onClick={() => onGenreToggle(g)}
            className="font-mono font-semibold shrink-0"
            style={{
              fontSize: '13.5px',
              padding: '9px 15px',
              borderRadius: '10px',
              border: `1px solid ${on ? '#E8192C' : 'rgba(255,255,255,0.14)'}`,
              background: on ? '#E8192C' : '#141417',
              color: on ? '#fff' : '#9A9AA4',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              lineHeight: 1,
            }}
          >
            {g}
          </button>
        );
      })}
    </div>
  );
}
