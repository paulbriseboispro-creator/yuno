import { format, type Locale } from 'date-fns';
import { fr, enUS, es } from 'date-fns/locale';

export interface EventPromoDj {
  stageName: string;
  profileImageUrl?: string | null;
}

export interface EventPromoOrganizer {
  name: string;
  logoUrl?: string | null;
}

export interface EventPromoProps {
  venueName: string;
  venueCity?: string;
  venueAddress?: string;
  eventTitle: string;
  eventDate: string;
  eventEndDate?: string;
  eventDescription: string;
  eventImageUrl: string;
  musicGenre: string;
  ctaText: string;
  language: string;
  djs?: EventPromoDj[];
  organizers?: EventPromoOrganizer[];
  bgColor1?: string;
  bgColor2?: string;
  textColor?: string;
}

const localeMap: Record<string, Locale> = { fr, en: enUS, es };

export function EventPromoTemplate({
  venueName,
  venueCity,
  venueAddress,
  eventTitle,
  eventDate,
  eventEndDate,
  eventImageUrl,
  musicGenre,
  ctaText,
  language,
  djs = [],
  organizers = [],
}: EventPromoProps) {
  const locale = localeMap[language] || enUS;
  const date = new Date(eventDate);
  const dayName = format(date, 'EEEE', { locale }).toUpperCase();
  const dayNum = format(date, 'd', { locale });
  const month = format(date, 'MMMM', { locale }).toUpperCase();
  const timeStart = format(date, 'HH:mm', { locale });
  const timeEnd = eventEndDate ? format(new Date(eventEndDate), 'HH:mm', { locale }) : null;

  return (
    <div style={{
      width: 1080, height: 1920, position: 'relative', overflow: 'hidden',
      fontFamily: "'Inter', 'Helvetica Neue', sans-serif", background: '#050505',
    }}>
      {/* ── BG layers ── */}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, #150000 0%, #1c0505 18%, #200808 35%, #180303 50%, #0d0000 70%, #050505 90%, #080000 100%)' }} />
      <div style={{ position: 'absolute', top: -180, left: '50%', transform: 'translateX(-50%)', width: 1200, height: 800, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(180,20,20,0.22) 0%, transparent 75%)' }} />
      <div style={{ position: 'absolute', bottom: -100, left: '50%', transform: 'translateX(-50%)', width: 1000, height: 500, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(180,20,20,0.1) 0%, transparent 70%)' }} />
      <div style={{ position: 'absolute', inset: 0, opacity: 0.04, backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`, backgroundSize: '200px 200px' }} />
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: 'linear-gradient(180deg, transparent 5%, rgba(220,38,38,0.4) 30%, rgba(220,38,38,0.15) 70%, transparent 95%)' }} />
      <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 3, background: 'linear-gradient(180deg, transparent 5%, rgba(220,38,38,0.4) 30%, rgba(220,38,38,0.15) 70%, transparent 95%)' }} />

      {/* ── CONTENT ── */}
      <div style={{
        position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column',
        height: '100%', padding: '40px 36px 36px',
      }}>

        {/* ── Main card ── */}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          background: 'rgba(255,255,255,0.04)',
          border: '1.5px solid rgba(255,255,255,0.1)',
          borderRadius: 32, padding: '48px 44px 44px',
          backdropFilter: 'blur(8px)',
          boxShadow: '0 8px 60px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)',
        }}>

          {/* Venue name */}
          <p style={{ fontSize: 32, fontWeight: 900, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: 10, textAlign: 'center', marginBottom: 16 }}>
            {venueName}
          </p>

          {/* Event banner image — rounded, contained inside card */}
          {eventImageUrl && (
            <div style={{
              width: '100%', height: 380, borderRadius: 20, overflow: 'hidden',
              marginBottom: 28, position: 'relative', flexShrink: 0,
            }}>
              <img
                src={eventImageUrl} alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }}
                crossOrigin="anonymous"
              />
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 120, background: 'linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.6) 100%)' }} />
            </div>
          )}

          {/* Genre badge */}
          {musicGenre && (
            <p style={{ fontSize: 22, fontWeight: 800, color: '#ef4444', textTransform: 'uppercase', letterSpacing: 8, textAlign: 'center', marginBottom: 8 }}>
              {musicGenre}
            </p>
          )}

          {/* Title */}
          <h1 style={{
            fontSize: 88, fontWeight: 900, color: '#fff', lineHeight: 0.95,
            textAlign: 'center', textTransform: 'uppercase', marginBottom: 16,
            textShadow: '0 0 60px rgba(220,38,38,0.3), 0 4px 20px rgba(0,0,0,0.8)',
          }}>
            {eventTitle}
          </h1>

          {/* Date line */}
          <p style={{
            fontSize: 28, fontWeight: 700, color: 'rgba(255,255,255,0.4)',
            textAlign: 'center', textTransform: 'uppercase', letterSpacing: 4, marginBottom: 28,
          }}>
            {dayName} · {dayNum} {month}
          </p>

          {/* Time row */}
          <div style={{
            display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 0, marginBottom: 24,
            background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)',
            borderRadius: 20, overflow: 'hidden',
          }}>
            <div style={{ flex: 1, textAlign: 'center', padding: '22px 0', borderRight: timeEnd ? '1px solid rgba(220,38,38,0.15)' : 'none' }}>
              <p style={{ fontSize: 16, fontWeight: 700, color: 'rgba(255,255,255,0.35)', letterSpacing: 3, marginBottom: 6 }}>DOORS OPEN</p>
              <p style={{ fontSize: 52, fontWeight: 900, color: '#fff', lineHeight: 1 }}>{timeStart}</p>
            </div>
            {timeEnd && (
              <div style={{ flex: 1, textAlign: 'center', padding: '22px 0' }}>
                <p style={{ fontSize: 16, fontWeight: 700, color: 'rgba(255,255,255,0.35)', letterSpacing: 3, marginBottom: 6 }}>UNTIL</p>
                <p style={{ fontSize: 52, fontWeight: 900, color: 'rgba(255,255,255,0.65)', lineHeight: 1 }}>{timeEnd}</p>
              </div>
            )}
          </div>

          {/* Address */}
          {(venueAddress || venueCity) && (
            <p style={{ fontSize: 24, fontWeight: 600, color: 'rgba(255,255,255,0.4)', letterSpacing: 1, textAlign: 'center', marginBottom: 28 }}>
              📍 {venueAddress || venueCity}
            </p>
          )}

          {/* Decorative line */}
          <div style={{ width: 100, height: 2, margin: '0 auto 28px', background: 'linear-gradient(90deg, transparent, #dc2626, transparent)' }} />

          {/* LINE-UP */}
          {djs.length > 0 && (
            <div style={{ marginBottom: 24, textAlign: 'center' }}>
              <p style={{ fontSize: 22, fontWeight: 800, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 6, marginBottom: 18 }}>LINE-UP</p>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 16, flexWrap: 'wrap' }}>
                {djs.map((dj, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 44, padding: '12px 32px 12px 12px',
                  }}>
                    {dj.profileImageUrl ? (
                      <img src={dj.profileImageUrl} alt="" style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(220,38,38,0.5)' }} crossOrigin="anonymous" />
                    ) : (
                      <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'linear-gradient(135deg, #dc2626, #ef4444)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ fontSize: 26, fontWeight: 900, color: '#fff' }}>{dj.stageName.charAt(0).toUpperCase()}</span>
                      </div>
                    )}
                    <span style={{ fontSize: 32, fontWeight: 800, color: '#fff', textTransform: 'uppercase', letterSpacing: 2 }}>{dj.stageName}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* PRESENTED BY */}
          {organizers.length > 0 && (
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 22, fontWeight: 800, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 6, marginBottom: 18 }}>Presented by</p>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 16, flexWrap: 'wrap' }}>
                {organizers.map((org, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 44, padding: '12px 32px 12px 12px',
                  }}>
                    {org.logoUrl ? (
                      <img src={org.logoUrl} alt="" style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover' }} crossOrigin="anonymous" />
                    ) : (
                      <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />
                    )}
                    <span style={{ fontSize: 32, fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>{org.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ flex: 1 }} />

          {/* CTA */}
          <div style={{ textAlign: 'center' }}>
            <div style={{
              display: 'inline-block',
              background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 50%, #b91c1c 100%)',
              padding: '32px 100px', borderRadius: 50,
              boxShadow: '0 0 50px rgba(220,38,38,0.5), 0 12px 40px rgba(220,38,38,0.3)',
            }}>
              <span style={{ fontSize: 36, fontWeight: 900, color: '#fff', textTransform: 'uppercase', letterSpacing: 4 }}>{ctaText}</span>
            </div>
          </div>

        </div>{/* end card */}

        {/* ── YUNO branding ── */}
        <div style={{ textAlign: 'center', paddingTop: 24, paddingBottom: 4 }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.2)', letterSpacing: 5, marginBottom: 8, textTransform: 'uppercase' }}>Powered by</p>
          <p style={{ fontSize: 56, fontWeight: 900, color: 'rgba(255,255,255,0.55)', letterSpacing: 16, marginBottom: 6, lineHeight: 1 }}>YUNO</p>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.2)', fontWeight: 700, letterSpacing: 4 }}>BUILT FOR NIGHTLIFE, MADE FOR YOUR NIGHT</p>
        </div>
      </div>
    </div>
  );
}
