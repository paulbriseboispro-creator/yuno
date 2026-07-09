// Mode Live — boissons offertes de LA soirée. N'affiche l'élément que si le
// client a des crédits conso liés à cet événement (order_pack_credits,
// event_id = soirée en cours) et qu'il en reste. Affichage + guidage : les
// crédits se déduisent au paiement du panier (flux use-drink-credit existant).
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Gift, Wine } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { useLiveMode } from '@/contexts/LiveModeContext';
import { transitions } from '@/lib/motion';

export function LiveFreeDrinks() {
  const { session } = useLiveMode();
  const { t } = useLanguage();
  const { user } = useAuth();
  const [total, setTotal] = useState(0);
  const [used, setUsed] = useState(0);

  const eventId = session?.eventId;

  useEffect(() => {
    if (!user || !eventId) return;
    let cancelled = false;
    const fetchCredits = async () => {
      const now = new Date().toISOString();
      const { data } = await supabase
        .from('order_pack_credits')
        .select('total_credits, used_credits, expires_at')
        .eq('user_id', user.id)
        .eq('event_id', eventId);
      if (cancelled) return;
      const rows = (data ?? []).filter((c) => !c.expires_at || c.expires_at > now);
      setTotal(rows.reduce((s, c) => s + (c.total_credits ?? 0), 0));
      setUsed(rows.reduce((s, c) => s + (c.used_credits ?? 0), 0));
    };
    fetchCredits();
    // Une commande créditée décrémente used_credits → resync au retour foreground.
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchCredits();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user, eventId]);

  const remaining = Math.max(0, total - used);
  if (remaining <= 0) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={transitions.reveal}
      className="mx-4 mt-4 overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, rgba(251,191,36,0.12), rgba(20,20,20,0.9))',
        border: '1px solid rgba(251,191,36,0.4)',
        borderRadius: 10,
      }}
    >
      <div className="flex items-center gap-3 p-4">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
          style={{ background: 'rgba(251,191,36,0.16)' }}
        >
          <Gift className="h-5 w-5" style={{ color: '#FBBF24' }} />
        </span>
        <div className="min-w-0 flex-1">
          <p
            className="font-display font-bold uppercase leading-tight text-white"
            style={{ fontSize: 15, letterSpacing: '-0.005em' }}
          >
            {t('live.freeDrinks.title').replace('{count}', String(remaining))}
          </p>
          <p
            className="mt-0.5 font-mono uppercase"
            style={{ fontSize: 10, letterSpacing: '0.06em', color: '#C8C8CC' }}
          >
            {t('live.freeDrinks.hint')}
          </p>
        </div>
      </div>

      {/* Pastilles : utilisées (ternes) vs restantes (ambre) */}
      <div className="flex flex-wrap gap-1.5 px-4 pb-4">
        {Array.from({ length: total }).map((_, i) => (
          <span
            key={i}
            className="flex h-6 w-6 items-center justify-center rounded-full"
            style={{
              background: i < used ? 'rgba(255,255,255,0.06)' : 'rgba(251,191,36,0.2)',
            }}
          >
            <Wine
              className="h-3 w-3"
              style={{ color: i < used ? '#5A5A5E' : '#FBBF24', opacity: i < used ? 0.4 : 1 }}
            />
          </span>
        ))}
      </div>
    </motion.section>
  );
}
