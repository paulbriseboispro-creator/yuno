import { useNavigate } from 'react-router-dom';
import { cardImage } from '@/lib/imageOptimization';
import { FadeImage } from '@/components/ui/fade-image';

export interface ExploreVenueItem {
  id: string;
  name: string;
  coverUrl: string | null;
  logoUrl: string | null;
  city?: string;
  primaryGenre?: string;
  isAffiliate?: boolean;
  slug?: string;
}

export function ExploreVenueCard({ venue }: { venue: ExploreVenueItem }) {
  const navigate = useNavigate();

  const handleClick = () => {
    sessionStorage.setItem('yuno_club_origin', 'explore');
    if (venue.isAffiliate && venue.slug) {
      navigate(`/affiliate-venue/${venue.slug}`);
    } else {
      navigate(`/club/${venue.id}`);
    }
  };

  const imgSrc = cardImage(venue.coverUrl || venue.logoUrl, 320);

  return (
    <div
      onClick={handleClick}
      role="button"
      tabIndex={0}
      aria-label={venue.name}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      className="shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      style={{ width: 148 }}
    >
      <div
        className="relative overflow-hidden"
        style={{ height: 148, borderRadius: '16px' }}
      >
        {imgSrc ? (
          <FadeImage
            src={imgSrc}
            alt={venue.name}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(160deg, #1a0f12, #0f0f12)' }}
          />
        )}

        {/* Gradient overlay */}
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to top, rgba(8,8,10,0.92) 0%, transparent 60%)' }}
        />

        {/* Text */}
        <div className="absolute bottom-2.5 left-2.5 right-2.5">
          <p
            className="font-display font-bold"
            style={{ fontSize: '15px', lineHeight: 1.05, color: '#fff' }}
          >
            {venue.name}
          </p>
          {(venue.primaryGenre || venue.city) && (
            <p
              className="font-mono mt-0.5"
              style={{ fontSize: '10px', color: '#9A9AA4' }}
            >
              {[venue.primaryGenre, venue.city].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
