import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { MapPin, BadgeCheck, Share2, Printer, ExternalLink, Music2 } from 'lucide-react';
import { Instagram } from '@/components/icons/Instagram';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const RED = '#E8192C';
const BASE_URL = (import.meta.env.VITE_APP_BASE_URL as string | undefined) || 'https://yunoapp.eu';

interface DJProfile {
  id: string;
  stage_name?: string;
  first_name?: string;
  last_name?: string;
  description?: string;
  bio?: string;
  music_genres?: string[];
  profile_image_url?: string;
  cover_image_url?: string;
  instagram_url?: string;
  tiktok_url?: string;
  soundcloud_url?: string;
  spotify_url?: string;
  youtube_url?: string;
  city?: string;
  country?: string;
  is_verified?: boolean;
  slug?: string;
  handle?: string;
}

interface PlayedVenue {
  name: string;
  city?: string;
}

function spotifyEmbed(url?: string): string | null {
  if (!url) return null;
  const m = url.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?(artist|track|album|playlist)\/([A-Za-z0-9]+)/);
  return m ? `https://open.spotify.com/embed/${m[1]}/${m[2]}?theme=0` : null;
}

function soundcloudEmbed(url?: string): string | null {
  if (!url || !/soundcloud\.com/.test(url)) return null;
  return `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%23e8192c&visual=true&hide_related=true&show_comments=false`;
}

export default function DJEpkPage() {
  const { slug } = useParams<{ slug: string }>();
  const { t } = useLanguage();
  const [dj, setDj] = useState<DJProfile | null>(null);
  const [venues, setVenues] = useState<PlayedVenue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    let active = true;
    (async () => {
      setLoading(true);
      try {
        // Aggregate across all the person's profiles (server-side RPCs), same as the
        // public page, so the EPK shows the full picture from any slug or clean handle.
        const rpcProfile = supabase.rpc.bind(supabase) as unknown as (
          fn: 'get_dj_public_profile', args: { p_slug: string },
        ) => Promise<{ data: DJProfile | null; error: unknown }>;
        const rpcEvents = supabase.rpc.bind(supabase) as unknown as (
          fn: 'get_dj_public_events', args: { p_slug: string },
        ) => Promise<{ data: { venue_name: string | null; venue_city: string | null }[] | null; error: unknown }>;

        const { data: profile } = await rpcProfile('get_dj_public_profile', { p_slug: slug });
        if (!active) return;
        if (!profile) { setLoading(false); return; }
        setDj(profile as DJProfile);

        // "Played at" — distinct venues across all of the DJ's profiles.
        const { data: events } = await rpcEvents('get_dj_public_events', { p_slug: slug });
        const seen = new Set<string>();
        const played: PlayedVenue[] = [];
        (events || []).forEach(e => {
          const nm = e.venue_name;
          if (nm && !seen.has(nm.toLowerCase())) { seen.add(nm.toLowerCase()); played.push({ name: nm, city: e.venue_city || undefined }); }
        });
        if (active) setVenues(played);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [slug]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0c', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="h-8 w-8 animate-spin rounded-full border-2" style={{ borderColor: `rgba(255,255,255,0.1) rgba(255,255,255,0.1) rgba(255,255,255,0.1) ${RED}` }} />
      </div>
    );
  }

  if (!dj) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0c', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#9A9A9A' }}>{t('djPublic.notFound')}</p>
      </div>
    );
  }

  const name = dj.stage_name || `${dj.first_name || ''} ${dj.last_name || ''}`.trim() || 'DJ';
  const location = [dj.city, dj.country].filter(Boolean).join(', ');
  const genres = [...new Set(dj.music_genres || [])];
  const epkUrl = `${BASE_URL}/dj/${dj.handle || dj.slug}/epk`;
  const spotify = spotifyEmbed(dj.spotify_url);
  const soundcloud = soundcloudEmbed(dj.soundcloud_url);

  const handleShare = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try { await navigator.share({ title: `${name} — EPK`, url: epkUrl }); } catch { /* cancelled */ }
    } else {
      await navigator.clipboard.writeText(epkUrl);
      toast.success(t('dj.share.copied'));
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0c', color: '#fff' }}>
      <Helmet>
        <title>{name} — EPK · Yuno</title>
        <meta property="og:title" content={`${name} — EPK`} />
        <meta property="og:description" content={(dj.description || dj.bio || `Press kit — ${name}`).slice(0, 160)} />
        {dj.cover_image_url || dj.profile_image_url ? <meta property="og:image" content={dj.cover_image_url || dj.profile_image_url} /> : null}
      </Helmet>

      <div style={{ maxWidth: 760, margin: '0 auto', padding: '0 0 64px' }}>
        {/* Action bar (hidden on print) */}
        <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '16px 20px 0' }}>
          <button onClick={handleShare} className="inline-flex items-center gap-1.5"
            style={{ borderRadius: 10, padding: '8px 12px', fontSize: 13, fontWeight: 600, background: RED, color: '#fff' }}>
            <Share2 className="h-3.5 w-3.5" /> {t('dj.epk.share')}
          </button>
          <button onClick={() => window.print()} className="inline-flex items-center gap-1.5"
            style={{ borderRadius: 10, padding: '8px 12px', fontSize: 13, fontWeight: 600, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}>
            <Printer className="h-3.5 w-3.5" /> {t('dj.epk.print')}
          </button>
        </div>

        {/* Hero */}
        <div style={{ position: 'relative', margin: '16px 20px 0', borderRadius: 18, overflow: 'hidden', aspectRatio: '16/9', background: '#141414' }}>
          {dj.cover_image_url || dj.profile_image_url ? (
            <img src={dj.cover_image_url || dj.profile_image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : null}
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 30%, rgba(10,10,12,0.95) 100%)' }} />
          <div style={{ position: 'absolute', left: 20, right: 20, bottom: 18 }}>
            <p className="section-label-ruled" style={{ marginBottom: 8 }}>{t('dj.epk.label')}</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h1 style={{ fontSize: 'clamp(28px,7vw,44px)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '-0.025em', lineHeight: 0.95, margin: 0 }}>{name}</h1>
              {dj.is_verified && <BadgeCheck className="h-6 w-6" style={{ color: RED, flexShrink: 0 }} />}
            </div>
            {location && (
              <p style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12, color: '#B8B8B8', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                <MapPin className="h-3.5 w-3.5" /> {location}
              </p>
            )}
          </div>
        </div>

        {genres.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '20px 20px 0' }}>
            {genres.map(g => <span key={g.toLowerCase()} className="genre-tag">{g}</span>)}
          </div>
        )}

        {(dj.description || dj.bio) && (
          <section style={{ padding: '28px 20px 0' }}>
            <p className="section-label-ruled" style={{ marginBottom: 14 }}>{t('dj.epk.bio')}</p>
            <p style={{ fontSize: 15, lineHeight: 1.65, color: '#D8D8D8', whiteSpace: 'pre-line' }}>{dj.description || dj.bio}</p>
          </section>
        )}

        {/* Played at — social proof */}
        {venues.length > 0 && (
          <section style={{ padding: '28px 20px 0' }}>
            <p className="section-label-ruled" style={{ marginBottom: 14 }}>{t('dj.epk.playedAt')}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {venues.map(v => (
                <span key={v.name.toLowerCase()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 999, padding: '7px 14px', fontSize: 13, fontWeight: 600, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
                  {v.name}{v.city ? <span style={{ color: '#8A8A8A', fontWeight: 400 }}>· {v.city}</span> : null}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Music */}
        {(spotify || soundcloud || dj.youtube_url) && (
          <section style={{ padding: '28px 20px 0' }}>
            <p className="section-label-ruled" style={{ marginBottom: 14 }}>{t('dj.epk.listen')}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {spotify && (
                <iframe title="Spotify" src={spotify} width="100%" height="152" frameBorder="0" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy" style={{ borderRadius: 12 }} />
              )}
              {soundcloud && (
                <iframe title="SoundCloud" src={soundcloud} width="100%" height="166" frameBorder="0" allow="autoplay" loading="lazy" style={{ borderRadius: 12 }} />
              )}
              {dj.youtube_url && (
                <a href={dj.youtube_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-between"
                  style={{ borderRadius: 12, padding: '14px 16px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', textDecoration: 'none' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 600 }}><Music2 className="h-4 w-4" /> YouTube</span>
                  <ExternalLink className="h-4 w-4" style={{ color: '#8A8A8A' }} />
                </a>
              )}
            </div>
          </section>
        )}

        {/* Socials / booking contact */}
        {(dj.instagram_url || dj.tiktok_url) && (
          <section style={{ padding: '28px 20px 0' }}>
            <p className="section-label-ruled" style={{ marginBottom: 14 }}>{t('dj.epk.contact')}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {dj.instagram_url && (
                <a href={dj.instagram_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2"
                  style={{ borderRadius: 12, padding: '12px 16px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', textDecoration: 'none', fontWeight: 600 }}>
                  <Instagram className="h-4 w-4" /> Instagram
                </a>
              )}
              {dj.tiktok_url && (
                <a href={dj.tiktok_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2"
                  style={{ borderRadius: 12, padding: '12px 16px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', textDecoration: 'none', fontWeight: 600 }}>
                  TikTok
                </a>
              )}
            </div>
          </section>
        )}

        <footer style={{ padding: '40px 20px 0', textAlign: 'center' }}>
          <p style={{ fontSize: 11, color: '#5A5A5E', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('dj.epk.poweredBy')}</p>
        </footer>
      </div>
    </div>
  );
}
