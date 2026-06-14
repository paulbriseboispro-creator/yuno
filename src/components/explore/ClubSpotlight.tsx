import { useNavigate } from 'react-router-dom';
import { Ticket, Crown } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

export interface ClubSpotlightData {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  isOpenTonight: boolean;
  percentSold: number;
  hasVip: boolean;
  eventPosterUrl?: string | null;
}

export function ClubSpotlight({ club }: { club: ClubSpotlightData }) {
  const navigate = useNavigate();
  const { t } = useLanguage();

  return (
    <article
      onClick={() => {
        sessionStorage.setItem('yuno_club_origin', 'explore');
        navigate(`/club/${club.slug}`);
      }}
      className="relative overflow-hidden rounded-xl border border-border bg-card p-4 cursor-pointer transition-all hover:border-border/50"
    >
      <div className="flex items-center gap-4">
        {/* Club logo */}
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full border border-border bg-muted">
          {club.logoUrl ? (
            <img src={club.logoUrl} alt={club.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-surface-elevated">
              <span className="text-lg font-bold text-primary">{club.name[0]}</span>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0 space-y-1">
          <h3 className="text-sm font-bold text-foreground truncate">{club.name}</h3>

          <div className="flex flex-wrap items-center gap-2">
            {club.isOpenTonight && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary uppercase tracking-wider">
                Open tonight
              </span>
            )}
            {club.percentSold > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-amber-400">
                <Ticket className="h-3 w-3" /> {Math.round(club.percentSold)}% {t('explore.sold')}
              </span>
            )}
            {club.hasVip && (
              <span className="flex items-center gap-1 text-[11px] text-primary">
                <Crown className="h-3 w-3" /> VIP
              </span>
            )}
          </div>
        </div>

        {/* CTA */}
        <button
          className="shrink-0 rounded-[8px] bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          {t('explore.discoverClub')}
        </button>
      </div>
    </article>
  );
}
