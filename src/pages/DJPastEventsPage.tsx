import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Calendar, Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatInTimeZone } from 'date-fns-tz';
import { fr, es, enUS } from 'date-fns/locale';
import { PARIS_TIMEZONE } from '@/lib/timezone';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';
import { formatCompactCount } from '@/components/formater';
import { BottomNav } from '@/components/BottomNav';
import { FadeInView } from '@/components/motion';

interface TopEvent {
  id: string; title: string; start_at: string; poster_url: string | null;
  venue_id: string | null; venue_name: string | null; venue_city: string | null; interest_count: number;
}
interface PastEvent {
  id: string; title: string; start_at: string; end_at: string; poster_url: string | null;
  venue_id: string | null; venue_name: string | null; venue_city: string | null;
}

export default function DJPastEventsPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { language, t } = useLanguage();
  const locale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  const [name, setName] = useState('');
  const [top, setTop] = useState<TopEvent[]>([]);
  const [past, setPast] = useState<PastEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (slug) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const load = async () => {
    try {
      const rpcProfile = supabase.rpc.bind(supabase) as unknown as (
        fn: 'get_dj_public_profile', args: { p_slug: string },
      ) => Promise<{ data: { stage_name?: string; first_name?: string; last_name?: string } | null }>;
      const rpcEvents = supabase.rpc.bind(supabase) as unknown as (
        fn: 'get_dj_public_events', args: { p_slug: string },
      ) => Promise<{ data: PastEvent[] | null }>;
      const rpcTop = supabase.rpc.bind(supabase) as unknown as (
        fn: 'get_dj_top_past_events', args: { p_slug: string },
      ) => Promise<{ data: TopEvent[] | null }>;

      const [{ data: profile }, { data: events }, { data: topData }] = await Promise.all([
        rpcProfile('get_dj_public_profile', { p_slug: slug! }),
        rpcEvents('get_dj_public_events', { p_slug: slug! }),
        rpcTop('get_dj_top_past_events', { p_slug: slug! }),
      ]);

      if (profile) setName(profile.stage_name || `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim());
      const now = new Date().toISOString();
      setPast((events || []).filter((e) => e.end_at < now).reverse());
      setTop(topData || []);
    } catch (err) {
      console.error('Error loading past events:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0A0A0A' }}>
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="relative min-h-[100dvh] flex flex-col" style={{ background: '#0A0A0A' }}>
      <main className="flex-1 pb-28 mx-auto w-full max-w-xl">
        {/* Header */}
        <div className="flex items-center gap-3 px-5" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1rem)', paddingBottom: 12 }}>
          <button
            onClick={() => navigate(`/dj/${slug}`)}
            aria-label={t('djPublic.back')}
            className="flex items-center justify-center h-9 w-9 hover:opacity-80 transition-opacity"
            style={{ borderRadius: '2px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)' }}
          >
            <ArrowLeft className="h-4 w-4" style={{ color: '#E5E5E5' }} />
          </button>
          <div className="min-w-0">
            <p className="font-mono uppercase truncate" style={{ fontSize: '10px', letterSpacing: '0.14em', color: '#5A5A5E' }}>{name}</p>
            <h1 className="font-display font-bold" style={{ fontSize: '20px', color: '#FFFFFF', letterSpacing: '-0.01em', lineHeight: 1.1 }}>
              {t('djPublic.pastEventsTitle')}
            </h1>
          </div>
        </div>

        {/* ===== TOP 5 — plus gros events par affluence ===== */}
        {top.length > 0 && (
          <div className="pt-4">
            <p className="section-label-ruled mb-4 px-5">{t('djPublic.biggestEvents')}</p>
            <div className="flex flex-col">
              {top.map((e, i) => (
                <div
                  key={e.id}
                  className="flex items-center gap-3 px-5 py-3"
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
                >
                  <span
                    className="font-display font-bold shrink-0 text-center"
                    style={{ width: 28, fontSize: '26px', lineHeight: 1, color: 'transparent', WebkitTextStroke: '1.2px rgba(255,255,255,0.30)' }}
                  >
                    {i + 1}
                  </span>
                  <div className="h-14 w-12 shrink-0 overflow-hidden" style={{ borderRadius: 6, background: 'rgba(255,255,255,0.05)' }}>
                    {e.poster_url ? (
                      <img src={getOptimizedImageUrl(e.poster_url, { width: 120, height: 140, quality: 75 })} alt="" loading="lazy" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><Calendar className="h-4 w-4" style={{ color: '#5A5A5E' }} /></div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate" style={{ fontSize: '14px', color: '#FFFFFF', fontWeight: 600 }}>{e.title}</p>
                    <p className="font-mono mt-0.5 truncate" style={{ fontSize: '11px', color: '#5A5A5E', letterSpacing: '0.04em' }}>
                      {formatInTimeZone(new Date(e.start_at), PARIS_TIMEZONE, 'MMM yyyy', { locale })}
                      {e.venue_name ? ` · ${e.venue_name}` : ''}
                    </p>
                  </div>
                  <span className="flex items-center gap-1 font-mono shrink-0" style={{ fontSize: '12px', color: '#E8192C' }}>
                    <Users className="h-3.5 w-3.5" />
                    {formatCompactCount(e.interest_count, language)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ===== TOUS LES EVENTS PASSÉS ===== */}
        <div className="pt-9">
          <div className="px-5 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 8 }}>
            <p className="font-mono uppercase" style={{ fontSize: '10px', letterSpacing: '0.14em', color: '#5A5A5E' }}>{t('djPublic.allPast')}</p>
            <span className="font-mono" style={{ fontSize: '10px', color: '#3A3A3E', letterSpacing: '0.08em' }}>{past.length}</span>
          </div>
          {past.length > 0 ? (
            <div className="px-5 pt-4">
              {past.map((e, i) => (
                <FadeInView key={e.id} index={i < 6 ? i : 0} className="flex items-center gap-3 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="h-14 w-12 shrink-0 overflow-hidden" style={{ borderRadius: 3, background: 'rgba(255,255,255,0.05)' }}>
                    {e.poster_url ? (
                      <img src={getOptimizedImageUrl(e.poster_url, { width: 120, height: 140, quality: 75 })} alt="" loading="lazy" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><Calendar className="h-4 w-4" style={{ color: '#5A5A5E' }} /></div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate" style={{ fontSize: '14px', color: '#FFFFFF', fontWeight: 500 }}>{e.title}</p>
                    <p className="font-mono mt-0.5 truncate" style={{ fontSize: '11px', color: '#5A5A5E', letterSpacing: '0.04em' }}>
                      {formatInTimeZone(new Date(e.start_at), PARIS_TIMEZONE, 'EEE d MMM yyyy', { locale })}
                      {e.venue_name ? ` · ${e.venue_name}` : ''}
                    </p>
                  </div>
                </FadeInView>
              ))}
            </div>
          ) : (
            <p className="px-5 pt-6 font-mono" style={{ fontSize: '12px', color: '#5A5A5E' }}>{t('djPublic.noPast')}</p>
          )}
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
