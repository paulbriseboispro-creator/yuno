import { useNavigate } from 'react-router-dom';

const FALLBACK_GRADIENTS = [
  'linear-gradient(145deg, #3b1158 0%, #0f0712 100%)',
  'linear-gradient(145deg, #0d3545 0%, #060f14 100%)',
  'linear-gradient(145deg, #4a2200 0%, #160900 100%)',
  'linear-gradient(145deg, #0d2040 0%, #050a14 100%)',
  'linear-gradient(145deg, #1a3a1a 0%, #070e07 100%)',
  'linear-gradient(145deg, #3a1a00 0%, #120800 100%)',
];

function gradientForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return FALLBACK_GRADIENTS[hash % FALLBACK_GRADIENTS.length];
}

interface ExplorePopularClubCardProps {
  id: string;
  name: string;
  coverUrl: string | null;
  logoUrl: string | null;
  city?: string;
  primaryGenre?: string;
  isAffiliate?: boolean;
  slug?: string;
}

export function ExplorePopularClubCard({ id, name, coverUrl, logoUrl, city, primaryGenre, isAffiliate, slug }: ExplorePopularClubCardProps) {
  const navigate = useNavigate();
  const imgSrc = coverUrl || logoUrl;
  const subtitle = [primaryGenre, city].filter(Boolean).join(' · ');

  return (
    <div
      onClick={() => {
        sessionStorage.setItem('yuno_club_origin', 'explore');
        if (isAffiliate && slug) {
          navigate(`/affiliate-venue/${slug}`);
        } else {
          navigate(`/club/${id}`);
        }
      }}
      className="shrink-0 cursor-pointer"
      style={{ width: 282 }}
    >
      <div
        className="relative overflow-hidden"
        style={{ aspectRatio: '1 / 1', borderRadius: 20 }}
      >
        {/* Background: photo or gradient */}
        {imgSrc ? (
          <img
            src={imgSrc}
            alt={name}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0" style={{ background: gradientForId(id) }} />
        )}

        {/* Diagonal stripe overlay */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `repeating-linear-gradient(
              -45deg,
              rgba(255,255,255,0.045) 0px,
              rgba(255,255,255,0.045) 1px,
              transparent 1px,
              transparent 9px
            )`,
          }}
        />

        {/* Dark gradient overlay for text readability */}
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(to top, rgba(6,6,8,0.88) 0%, rgba(6,6,8,0.25) 45%, transparent 100%)',
          }}
        />

        {/* Text */}
        <div className="absolute bottom-0 left-0 right-0" style={{ padding: '0 14px 14px' }}>
          <p
            className="font-display font-bold"
            style={{ fontSize: '18px', lineHeight: 1.1, color: '#fff', letterSpacing: '-0.01em' }}
          >
            {name}
          </p>
          {subtitle && (
            <p
              className="font-mono mt-0.5"
              style={{ fontSize: '10.5px', color: '#9A9AA4', letterSpacing: '0.02em' }}
            >
              {subtitle}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
