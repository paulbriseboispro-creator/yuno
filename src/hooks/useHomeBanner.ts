import { useEffect, useState } from 'react';
import { fetchHomeBanner, type HomeBanner, type HomeBannerScope } from '@/lib/homeBanner';

/** Bannière d'accueil de la Console pour un club ou une organisation. */
export function useHomeBanner(scope: HomeBannerScope | null) {
  const [banner, setBanner] = useState<HomeBanner | null>(null);
  const [loaded, setLoaded] = useState(false);
  const kind = scope?.kind;
  const id = scope?.id;

  useEffect(() => {
    if (!kind || !id) return;
    let alive = true;
    setLoaded(false);
    fetchHomeBanner({ kind, id } as HomeBannerScope).then((b) => {
      if (!alive) return;
      setBanner(b);
      setLoaded(true);
    });
    return () => { alive = false; };
  }, [kind, id]);

  return { banner, loaded, setBanner };
}
