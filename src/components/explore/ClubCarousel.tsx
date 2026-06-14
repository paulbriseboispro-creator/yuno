import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';

export interface ClubCarouselItem {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  followersCount: number;
  distance?: number | null;
}

interface ClubCarouselProps {
  clubs: ClubCarouselItem[];
  city?: string;
}

export function ClubCarousel({ clubs, city }: ClubCarouselProps) {
  const navigate = useNavigate();
  const { t } = useLanguage();

  if (clubs.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-base font-bold uppercase tracking-wider text-foreground">
        {city ? `${t('explore.clubsIn')} ${city.toUpperCase()}` : t('explore.clubsNearYou')}
      </h2>
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-none">
        {clubs.map(club => (
          <button
            key={club.id}
            onClick={() => {
              sessionStorage.setItem('yuno_club_origin', 'explore');
              navigate(`/club/${club.slug}`);
            }}
            className="flex w-[125px] shrink-0 flex-col items-center gap-2.5 rounded-xl border border-border bg-card p-4 transition-all hover:border-border/50"
          >
            {/* Logo */}
            <div className="relative h-[70px] w-[70px] overflow-hidden rounded-full border border-border bg-muted">
              {club.logoUrl ? (
                <img src={club.logoUrl} alt={club.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <span className="text-lg font-bold text-primary">{club.name[0]}</span>
                </div>
              )}
            </div>

            <div className="w-full text-center">
              <p className="text-sm font-semibold text-foreground truncate">{club.name}</p>
              <p className="text-xs text-muted-foreground">
                {club.followersCount} {club.followersCount === 1 ? t('venue.follower') : t('venue.followers')}
              </p>
              {club.distance != null && (
                <p className="text-xs text-muted-foreground">
                  {club.distance < 1 ? `${Math.round(club.distance * 1000)}m` : `${club.distance.toFixed(1)}km`}
                </p>
              )}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
