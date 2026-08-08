import { useLanguage } from '@/contexts/LanguageContext';

/** Drapeaux d'offre d'une soirée affiliée (tables VIP / guest list). */
export type OfferFlags = {
  has_tables?: boolean | null;
  tables_only?: boolean | null;
  has_guest_list?: boolean | null;
  guest_list_type?: string | null;
};

export function offerBadgeLabels(flags: OfferFlags, t: (k: string) => string): string[] {
  const out: string[] = [];
  if (flags.tables_only) out.push(t('aff.badge.tablesOnly'));
  else if (flags.has_tables) out.push(t('aff.badge.tables'));
  if (flags.has_guest_list) {
    out.push(flags.guest_list_type === 'women' ? t('aff.badge.guestListWomen') : t('aff.badge.guestList'));
  }
  return out;
}

/**
 * Badges d'offre, même chip que les genres des surfaces publiques.
 * `size="sm"` pour les cartes de vitrine, `size="md"` pour la page soirée.
 */
export function OfferBadges({ flags, size = 'sm' }: { flags: OfferFlags; size?: 'sm' | 'md' }) {
  const { t } = useLanguage();
  const labels = offerBadgeLabels(flags, t);
  if (labels.length === 0) return null;
  const sm = size === 'sm';
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: sm ? 5 : 0 }}>
      {labels.map((label) => (
        <span
          key={label}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            height: sm ? 18 : 22,
            padding: sm ? '0 7px' : '0 9px',
            borderRadius: 999,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: sm ? 9 : 10,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase' as const,
            background: 'rgba(232,25,44,0.08)',
            border: '1px solid rgba(232,25,44,0.22)',
            color: '#F2707C',
            whiteSpace: 'nowrap' as const,
          }}
        >
          {label}
        </span>
      ))}
    </div>
  );
}
