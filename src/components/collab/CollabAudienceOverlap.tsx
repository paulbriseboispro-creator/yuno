import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';

// Chevauchement d'audience entre les deux parties d'une collab (RPC DEFINER
// get_collab_audience_overlap, gardé is_event_collab_participant). Comptes seulement.
interface Overlap {
  ok: boolean;
  supported: boolean;
  venue?: { id: string; name: string; followers: number };
  organizer?: { id: string; name: string; followers: number };
  shared?: number;
  union?: number;
  jaccard?: number;
  net_new_for_venue?: number;
  net_new_for_organizer?: number;
}

export function CollabAudienceOverlap({ eventId }: { eventId: string }) {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es: string) => (language === 'fr' ? fr : language === 'es' ? es : en);
  const [data, setData] = useState<Overlap | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // RPC pas encore dans les types générés → cast.
      const rpc = supabase.rpc as unknown as (n: string, p: Record<string, unknown>) => Promise<{ data: unknown }>;
      const { data: d } = await rpc('get_collab_audience_overlap', { p_event_id: eventId });
      if (!cancelled) { setData((d as Overlap) ?? null); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [eventId]);

  if (loading || !data?.ok || !data.supported || !data.venue || !data.organizer) return null;

  const nf = (n: number) => n.toLocaleString('fr-FR');
  const venueName = data.venue.name || t('le club', 'the club', 'el club');
  const orgName = data.organizer.name || t("l'organisateur", 'the organizer', 'el organizador');

  return (
    <div className="rounded-2xl p-5"
      style={{ background: 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c', border: '1px solid rgba(255,255,255,0.085)' }}>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-[32px] font-[700] tabular-nums leading-none" style={{ color: '#fff' }}>{nf(data.shared ?? 0)}</span>
        <span className="text-[14px]" style={{ color: 'rgba(255,255,255,0.6)' }}>{t('abonnés en commun', 'shared subscribers', 'suscriptores en común')}</span>
      </div>
      <p className="text-[12px] mt-1.5" style={{ color: 'rgba(255,255,255,0.36)' }}>
        {t(`${data.jaccard ?? 0}% de recouvrement · ${nf(data.venue.followers)} vs ${nf(data.organizer.followers)} abonnés`,
           `${data.jaccard ?? 0}% overlap · ${nf(data.venue.followers)} vs ${nf(data.organizer.followers)} subscribers`,
           `${data.jaccard ?? 0}% de solapamiento · ${nf(data.venue.followers)} vs ${nf(data.organizer.followers)} suscriptores`)}
      </p>

      <div className="mt-4 pt-4 grid grid-cols-2 gap-3" style={{ borderTop: '1px solid rgba(255,255,255,0.085)' }}>
        <div>
          <div className="text-[22px] font-[680] tabular-nums" style={{ color: '#34D399' }}>+{nf(data.net_new_for_venue ?? 0)}</div>
          <div className="text-[11.5px] mt-0.5" style={{ color: 'rgba(255,255,255,0.36)' }}>
            {t(`nouveaux pour ${venueName}`, `new for ${venueName}`, `nuevos para ${venueName}`)}
          </div>
        </div>
        <div>
          <div className="text-[22px] font-[680] tabular-nums" style={{ color: '#34D399' }}>+{nf(data.net_new_for_organizer ?? 0)}</div>
          <div className="text-[11.5px] mt-0.5" style={{ color: 'rgba(255,255,255,0.36)' }}>
            {t(`nouveaux pour ${orgName}`, `new for ${orgName}`, `nuevos para ${orgName}`)}
          </div>
        </div>
      </div>
      <p className="text-[11px] mt-3 leading-relaxed" style={{ color: 'rgba(255,255,255,0.36)' }}>
        {t("Les abonnés de l'un qui ne suivent pas encore l'autre — l'audience que cette collab peut convertir. Agrégé, jamais nominatif.",
           "Each side's subscribers who don't yet follow the other — the audience this collab can convert. Aggregated, never by name.",
           "Los suscriptores de cada lado que aún no siguen al otro — la audiencia que esta colaboración puede convertir. Agregado, nunca nominal.")}
      </p>
    </div>
  );
}
