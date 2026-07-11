// Live Activity « suivi de commande » — écran verrouillé + Dynamic Island.
//
// Le plugin natif `OrderActivity` est un mini plugin Swift MAISON (voir
// docs/NATIVE_SETUP.md § Live Activities) : les plugins communautaires
// n'exposent pas les push tokens ActivityKit, or LE chemin qui compte est le
// push serveur (téléphone en poche en boîte). Contrat :
//   start({orderId,title,status,pin,items})  → { activityId, pushToken? }
//     (réutilise l'activité existante du même orderId si encore vivante)
//   update({orderId,status,pin,items})       → void
//   end({orderId,status})                    → void
//   event 'pushToken' { orderId, activityId, pushToken } (rotations async)
//
// Le push token part dans live_activity_tokens ; ensuite le trigger DB
// trg_order_live_activity_push pousse chaque changement de statut via APNs
// (send-push-notification, action live_activity_update) — app fermée comprise.
//
// Tout est fire-and-forget et gardé natif B2C : sur le web, l'app Pro, ou un
// build sans l'extension YunoWidgets (pré-Phase 3), chaque appel échoue en
// silence — LiveOrderStatus reste la source de vérité visible.
import { registerPlugin } from '@capacitor/core';
import { supabase } from '@/integrations/supabase/client';
import { isNative, isProApp } from '@/lib/native';

interface OrderActivityPlugin {
  start(options: {
    orderId: string;
    title: string;
    status: string;
    pin: string | null;
    items: string;
  }): Promise<{ activityId: string; pushToken?: string }>;
  update(options: { orderId: string; status: string; pin: string | null; items: string }): Promise<void>;
  end(options: { orderId: string; status: string }): Promise<void>;
  addListener(
    eventName: 'pushToken',
    listener: (data: { orderId: string; activityId: string; pushToken: string }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

const OrderActivity = registerPlugin<OrderActivityPlugin>('OrderActivity');

function enabled(): boolean {
  return isNative() && !isProApp();
}

/** Tokens déjà persistés cette session (évite les doublons d'insert). */
const savedTokens = new Set<string>();
let listenerArmed = false;

async function saveToken(orderId: string, activityId: string, pushToken: string): Promise<void> {
  const dedupeKey = `${activityId}:${pushToken}`;
  if (savedTokens.has(dedupeKey)) return;
  savedTokens.add(dedupeKey);
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('live_activity_tokens').insert({
      order_id: orderId,
      user_id: user.id,
      activity_id: activityId,
      push_token: pushToken,
    });
  } catch {
    savedTokens.delete(dedupeKey);
  }
}

/** Écoute les rotations de token ActivityKit (émises après le start). */
async function armTokenListener(): Promise<void> {
  if (listenerArmed) return;
  listenerArmed = true;
  try {
    await OrderActivity.addListener('pushToken', (data) => {
      void saveToken(data.orderId, data.activityId, data.pushToken);
    });
  } catch {
    listenerArmed = false;
  }
}

export interface OrderActivityState {
  orderId: string;
  title: string;
  status: 'pending' | 'preparing' | 'ready' | 'served';
  pin: string | null;
  items: string;
}

/** IDs de commandes dont l'activité a été démarrée cette session. */
const startedOrders = new Set<string>();

/** Démarre (ou ré-attache) l'activité d'une commande. Fire-and-forget. */
export async function startOrderActivity(state: OrderActivityState): Promise<void> {
  if (!enabled() || startedOrders.has(state.orderId)) return;
  startedOrders.add(state.orderId);
  try {
    await armTokenListener();
    const { activityId, pushToken } = await OrderActivity.start({
      orderId: state.orderId,
      title: state.title,
      status: state.status,
      pin: state.pin,
      items: state.items,
    });
    if (pushToken) await saveToken(state.orderId, activityId, pushToken);
  } catch {
    // Extension absente (pré-P3) / iOS < 16.2 / activités désactivées : silencieux.
    startedOrders.delete(state.orderId);
  }
}

/** Met à jour localement (app au premier plan) — le push serveur fait le reste. */
export function updateOrderActivity(state: OrderActivityState): void {
  if (!enabled() || !startedOrders.has(state.orderId)) return;
  const call = state.status === 'served'
    ? OrderActivity.end({ orderId: state.orderId, status: state.status })
    : OrderActivity.update({
        orderId: state.orderId,
        status: state.status,
        pin: state.pin,
        items: state.items,
      });
  call.catch(() => { /* silencieux */ });
  if (state.status === 'served') startedOrders.delete(state.orderId);
}
