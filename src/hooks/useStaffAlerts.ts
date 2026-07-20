/**
 * Alertes entrantes des écrans staff : appels de poste, consigne du soir,
 * bravos. Écoute staff_notifications en realtime (la table est déjà publiée)
 * et traduit en toasts — le son et la vibration réveillent une main occupée.
 *
 * Distinct de useStaffNotifications (l'inbox de l'hôte VIP) : ici pas d'état,
 * pas d'historique, juste la réaction immédiate aux trois types « sociaux ».
 */

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { uniqueChannel } from '@/lib/realtime';
import { useLanguage } from '@/contexts/LanguageContext';
import type { StaffRole } from '@/lib/staffIdentity';

const CALL_LABEL_KEYS: Record<string, string> = {
  backup: 'staffcalls.kind.backup',
  security: 'staffcalls.kind.security',
  vip_arrival: 'staffcalls.kind.vip_arrival',
  stock: 'staffcalls.kind.stock',
  info: 'staffcalls.kind.info',
};

function buzz(pattern: number[]) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch {
    // vibration indisponible : le toast suffit
  }
}

interface Options {
  venueId: string | null;
  role: StaffRole;
  userId: string | null;
  /** Invalidation du pouls quand une consigne tombe (optionnel). */
  onBrief?: () => void;
}

export function useStaffAlerts({ venueId, role, userId, onBrief }: Options) {
  const { t } = useLanguage();
  // t change de référence à chaque render du provider : on fige la dernière
  // version dans une ref pour ne pas réabonner le canal en boucle.
  const tRef = useRef(t);
  tRef.current = t;
  const onBriefRef = useRef(onBrief);
  onBriefRef.current = onBrief;

  useEffect(() => {
    if (!venueId) return;

    const channel = supabase
      .channel(uniqueChannel(`staff-alerts-${venueId}-${role}`))
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'staff_notifications', filter: `venue_id=eq.${venueId}` },
        (payload) => {
          const n = payload.new as {
            target_role: string;
            notification_type: string;
            metadata: Record<string, string> | null;
          };
          const md = n.metadata ?? {};
          const tt = tRef.current;

          // On ne réagit pas à son propre geste.
          if (userId && md.actor_id === userId) return;

          if (n.notification_type === 'station_call' && n.target_role === role) {
            const kindLabel = CALL_LABEL_KEYS[md.call_kind] ? tt(CALL_LABEL_KEYS[md.call_kind]) : md.call_kind;
            toast.error(`${tt('staffcalls.incomingTitle')} — ${kindLabel}`, {
              description: md.from_name || undefined,
              duration: 12_000,
            });
            buzz([250, 120, 250, 120, 250]);
            return;
          }

          if (n.notification_type === 'night_brief' && n.target_role === role) {
            toast.info(tt('staffnight.briefIncoming'), {
              description: md.body_preview || undefined,
              duration: 10_000,
            });
            buzz([180, 90, 180]);
            onBriefRef.current?.();
            return;
          }

          if (n.notification_type === 'staff_kudos' && userId && md.recipient_id === userId) {
            toast.success(tt('staffnight.kudosIncoming'), {
              description: [md.from_name, md.body].filter(Boolean).join(' — ') || undefined,
              duration: 10_000,
            });
            buzz([120, 60, 120]);
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [venueId, role, userId]);
}
