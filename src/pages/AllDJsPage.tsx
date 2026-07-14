import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { DJDiscovery } from '@/components/dj-marketplace/DJDiscovery';
import { Seo } from '@/components/Seo';
import { PublicPage } from '@/components/PublicPage';

// Public DJ discovery (fan mode): ranked, filterable directory. Booking + price live
// only in the dashboard "Book a DJ" surface (DJDiscovery mode="booker"). Both share
// the same components — fan mode hides money + the Book CTA.
export default function AllDJsPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();

  return (
    <div style={{ minHeight: '100dvh', background: '#0A0A0A', display: 'flex', flexDirection: 'column' }}>
      <Seo
        title="DJs & Artists — Book DJ Lineups for Nightlife | Yuno"
        description="Discover DJs playing near you: browse lineups by genre and city, follow your favourite artists, and see where they play next. Book DJs for your event on Yuno."
        canonical="/djs"
      />
      {/* ── Header ── */}
      <div
        style={{
          position: 'sticky', top: 0, zIndex: 40,
          background: 'rgba(10,10,10,0.92)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(255,255,255,0.07)', padding: 'calc(env(safe-area-inset-top, 0px) + 14px) 20px 14px',
          display: 'flex', alignItems: 'center', gap: 14,
        }}
      >
        <button
          onClick={() => navigate(-1)}
          aria-label={t('djPublic.back')}
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: '50%', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff', flexShrink: 0 }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontFamily: 'monospace', fontSize: 10, color: '#5A5A5E', letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {t('allDJs.kicker')}
          </p>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#fff', letterSpacing: '-0.01em', lineHeight: 1, textTransform: 'uppercase', margin: 0 }}>
            {t('allDJs.title')}
          </h1>
        </div>
      </div>

      {/* ── Discovery ── */}
      <PublicPage variant="discovery">
      <div style={{ flex: 1, width: '100%', maxWidth: 512, margin: '0 auto', padding: '18px 18px 96px' }}>
        <DJDiscovery mode="fan" />
      </div>
      </PublicPage>

    </div>
  );
}
