// Mode Live — commandes actives de la soirée : statut en direct (realtime sur
// MES orders), PIN (4 derniers caractères du token) + QR inline. Le client
// n'a pas à quitter le Live pour montrer sa commande au bar — le QR est rendu
// localement depuis le token déjà chargé (fonctionne même si le réseau tombe).
import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Clock, Martini } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { transitions } from '@/lib/motion';
import { celebrate } from '@/lib/celebrate';
import { startOrderActivity, updateOrderActivity } from '@/lib/liveActivity';

interface LiveOrder {
  id: string;
  status: string;
  token: string | null;
  token_used: boolean | null;
  total: number;
  items: { name?: string; qty?: number; quantity?: number }[];
  ready_at: string | null;
  served_at: string | null;
  created_at: string;
}

type DisplayStatus = 'pending' | 'preparing' | 'ready' | 'served';

function displayStatus(o: LiveOrder): DisplayStatus {
  if (o.served_at || o.status === 'served' || o.token_used) return 'served';
  if (o.ready_at) return 'ready';
  if (o.status === 'preparing' || o.status === 'confirmed') return 'preparing';
  return 'pending';
}

const STATUS_STEPS: DisplayStatus[] = ['pending', 'preparing', 'ready'];

export function LiveOrderStatus({ eventId }: { eventId: string }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [orders, setOrders] = useState<LiveOrder[]>([]);
  const [qrByOrder, setQrByOrder] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const prevStatusRef = useRef<Record<string, DisplayStatus>>({});

  const fetchOrders = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('orders')
      .select('id, status, token, token_used, total, items, ready_at, served_at, created_at')
      .eq('user_id', user.id)
      .eq('event_id', eventId)
      .in('status', ['paid', 'confirmed', 'preparing', 'served'])
      .order('created_at', { ascending: false })
      .limit(5);
    setOrders(((data ?? []) as unknown as LiveOrder[]));
  }, [user, eventId]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Realtime : chaque UPDATE de MES commandes (préparation, prête, servie).
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`live-orders-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `user_id=eq.${user.id}` },
        () => fetchOrders()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetchOrders]);

  // Haptic de succès quand UNE commande passe « prête » (transition observée,
  // pas l'état initial : une commande déjà prête au chargement ne vibre pas).
  // Visuel = la carte qui passe au vert ci-dessous — pas d'overlay.
  // Live Activity (natif) : démarrée pour toute commande active vue ici,
  // mise à jour localement au premier plan — le push serveur (trigger
  // trg_order_live_activity_push) couvre le téléphone en poche.
  useEffect(() => {
    const prev = prevStatusRef.current;
    const next: Record<string, DisplayStatus> = {};
    let becameReady = false;
    for (const o of orders) {
      const s = displayStatus(o);
      next[o.id] = s;
      if (s === 'ready' && prev[o.id] && prev[o.id] !== 'ready') becameReady = true;

      const activityState = {
        orderId: o.id,
        title: t('live.orderStatus.title'),
        status: s,
        pin: o.token ? o.token.slice(-4).toUpperCase() : null,
        items: (o.items ?? [])
          .map((i) => `${i.qty ?? i.quantity ?? 1}× ${i.name ?? ''}`)
          .join(' · ')
          .slice(0, 120),
      };
      if (s !== 'served' && !prev[o.id]) void startOrderActivity(activityState);
      else if (prev[o.id] && prev[o.id] !== s) updateOrderActivity(activityState);
    }
    prevStatusRef.current = next;
    if (becameReady) celebrate('orderReady');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders]);

  // QR rendu localement depuis le token (offline-friendly une fois chargé).
  useEffect(() => {
    const active = orders.filter((o) => displayStatus(o) !== 'served' && o.token);
    active.forEach(async (o) => {
      if (qrByOrder[o.id]) return;
      try {
        const url = await QRCode.toDataURL(o.token!, {
          width: 360,
          margin: 1,
          color: { dark: '#0A0A0A', light: '#FFFFFF' },
        });
        setQrByOrder((prev) => ({ ...prev, [o.id]: url }));
      } catch {
        // pas de QR : le PIN suffit au bar
      }
    });
  }, [orders, qrByOrder]);

  const activeOrders = orders.filter((o) => displayStatus(o) !== 'served');
  if (activeOrders.length === 0) return null;

  const statusLabel = (s: DisplayStatus) => t(`live.orderStatus.${s}`);

  return (
    <section className="mx-4 mt-4 space-y-3">
      {activeOrders.map((order) => {
        const status = displayStatus(order);
        const stepIndex = STATUS_STEPS.indexOf(status);
        const pin = order.token ? order.token.slice(-4).toUpperCase() : null;
        const expanded = expandedId === order.id || status === 'ready';
        const itemsSummary = (order.items ?? [])
          .map((i) => `${i.qty ?? i.quantity ?? 1}× ${i.name ?? ''}`)
          .join(' · ');

        return (
          <motion.div
            key={order.id}
            layout
            transition={transitions.smooth}
            className="overflow-hidden"
            style={{
              background: '#141414',
              border: `1px solid ${status === 'ready' ? 'rgba(52,211,153,0.5)' : 'rgba(255,255,255,0.08)'}`,
              borderRadius: 10,
            }}
          >
            <button
              type="button"
              className="w-full p-4 text-left"
              onClick={() => setExpandedId(expanded ? null : order.id)}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  {status === 'ready' ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: '#34D399' }} />
                  ) : status === 'preparing' ? (
                    <Martini className="h-4 w-4 shrink-0" style={{ color: '#E8192C' }} />
                  ) : (
                    <Clock className="h-4 w-4 shrink-0" style={{ color: '#9A9A9A' }} />
                  )}
                  <span
                    className="font-mono font-bold uppercase truncate"
                    style={{
                      fontSize: 11,
                      letterSpacing: '0.1em',
                      color: status === 'ready' ? '#34D399' : '#FFFFFF',
                    }}
                  >
                    {t('live.orderStatus.title')} · {statusLabel(status)}
                  </span>
                </div>
                {pin && (
                  <span
                    className="font-mono font-bold shrink-0 rounded px-2 py-0.5"
                    style={{
                      fontSize: 12,
                      letterSpacing: '0.2em',
                      color: '#FFFFFF',
                      background: 'rgba(255,255,255,0.07)',
                    }}
                  >
                    {pin}
                  </span>
                )}
              </div>

              {/* Timeline 3 étapes */}
              <div className="mt-3 flex items-center gap-1.5">
                {STATUS_STEPS.map((step, i) => (
                  <div
                    key={step}
                    className="h-1 flex-1 rounded-full transition-colors duration-500"
                    style={{
                      background:
                        i <= stepIndex
                          ? status === 'ready'
                            ? '#34D399'
                            : '#E8192C'
                          : 'rgba(255,255,255,0.10)',
                    }}
                  />
                ))}
              </div>
              {itemsSummary && (
                <p
                  className="mt-2 truncate font-mono uppercase"
                  style={{ fontSize: 10, letterSpacing: '0.05em', color: '#9A9A9A' }}
                >
                  {itemsSummary}
                </p>
              )}
            </button>

            <AnimatePresence>
              {expanded && qrByOrder[order.id] && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={transitions.modal}
                  className="overflow-hidden"
                >
                  <div className="flex flex-col items-center gap-2 px-4 pb-4">
                    <div className="rounded-lg bg-white p-2.5">
                      <img
                        src={qrByOrder[order.id]}
                        alt="QR"
                        className="h-40 w-40"
                        style={{ imageRendering: 'pixelated' }}
                      />
                    </div>
                    <p
                      className="font-mono uppercase"
                      style={{ fontSize: 10, letterSpacing: '0.08em', color: '#9A9A9A' }}
                    >
                      {t('live.orderStatus.showQr')}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
    </section>
  );
}
