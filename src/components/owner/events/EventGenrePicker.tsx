import { Music } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { RED, INNER_BG, BORDER, T3, FieldLabel } from './events-ui';
import { MUSIC_GENRES } from './events-utils';

interface EventGenrePickerProps {
  selectedGenres: string[];
  onToggleGenre: (genre: string) => void;
}

// Music-genre multi-select chips for the event create/edit form.
export function EventGenrePicker({ selectedGenres, onToggleGenre }: EventGenrePickerProps) {
  const { t } = useLanguage();
  return (
    <div>
      <FieldLabel>
        <Music className="w-3 h-3 inline mr-1" />
        {t('owner.musicGenre')}
      </FieldLabel>
      <div className="flex flex-wrap gap-2">
        {MUSIC_GENRES.map(g => {
          const selected = selectedGenres.includes(g);
          return (
            <button
              key={g}
              type="button"
              onClick={() => onToggleGenre(g)}
              className="rounded-full px-3 py-1.5 text-[12px] font-medium cursor-pointer transition-all duration-150"
              style={selected
                ? { background: `rgba(232,25,44,0.12)`, border: `1px solid rgba(232,25,44,0.3)`, color: RED }
                : { background: INNER_BG, border: `1px solid ${BORDER}`, color: T3 }
              }
            >
              {g}
            </button>
          );
        })}
      </div>
    </div>
  );
}
