import { BadgeCheck, TrendingUp, MapPin } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { makeDjT } from '@/i18n/djTranslate';
import type { MarketplaceDJ, ResidentScope } from './types';

/**
 * Trust badges for a marketplace DJ: Verified (admin-granted), Rising (auto),
 * Resident @ X (declared or derived). Forked visual language from loyalty/TierBadge,
 * but DJ-specific tiers. Works on both the public (fan) and pro (booker) dark surfaces.
 */

const RED = '#E8192C';
const RISING = '#FCD34D';
const RESIDENT = 'rgba(96,165,250,0.95)';

function Badge({ icon, label, color, compact }: { icon: React.ReactNode; label: string; color: string; compact?: boolean }) {
  if (compact) {
    return (
      <span
        title={label}
        style={{ display: 'inline-flex', alignItems: 'center', color, flexShrink: 0 }}
      >
        {icon}
      </span>
    );
  }
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 8px', borderRadius: 999,
        fontSize: 10.5, fontWeight: 700, letterSpacing: '0.02em',
        color,
        background: 'rgba(255,255,255,0.04)',
        border: `1px solid ${color}40`,
        whiteSpace: 'nowrap',
      }}
    >
      {icon}
      {label}
    </span>
  );
}

export function DJTierBadge({
  dj,
  compact = false,
}: {
  dj: Pick<MarketplaceDJ, 'is_verified' | 'rising' | 'resident' | 'resident_scopes'>;
  /** compact = icon-only (cards); full = labelled pills (profile header). */
  compact?: boolean;
}) {
  const { language } = useLanguage();
  const tt = makeDjT(language);

  const scopes = (dj.resident_scopes || []) as ResidentScope[];
  const residentName = scopes.find((s) => s.name)?.name ?? null;

  if (!dj.is_verified && !dj.rising && !dj.resident) return null;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: compact ? 6 : 6, flexWrap: 'wrap' }}>
      {dj.is_verified && (
        <Badge compact={compact} color={RED}
          icon={<BadgeCheck size={compact ? 15 : 13} strokeWidth={2.4} />}
          label={tt('Vérifié', 'Verified', 'Verificado')} />
      )}
      {dj.rising && (
        <Badge compact={compact} color={RISING}
          icon={<TrendingUp size={compact ? 14 : 12} strokeWidth={2.6} />}
          label={tt('Montant', 'Rising', 'En alza')} />
      )}
      {dj.resident && (
        <Badge compact={compact} color={RESIDENT}
          icon={<MapPin size={compact ? 14 : 12} strokeWidth={2.4} />}
          label={residentName
            ? tt(`Résident · ${residentName}`, `Resident · ${residentName}`, `Residente · ${residentName}`)
            : tt('Résident', 'Resident', 'Residente')} />
      )}
    </span>
  );
}
