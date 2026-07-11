// Moteur d'alertes live ops du centre de commandement owner.
//
// Appelé par process-scheduled-campaigns (cron */5 min, déjà déployé — évite le
// cap 402). Pour chaque event actif : évalue les règles nightlife (backlog bar,
// commande oubliée, no-show VIP, minimum conso à risque, porte lente vs soirée
// comparable, jauge de capacité, vague de remboursements, objectif CA, rafale
// d'incidents), persiste chaque alerte en staff_notifications (cloche owner,
// realtime, deep-link /owner/live) et pousse sur le téléphone de l'owner pour
// les seules priorités urgent — dans sa langue (miroir inline FR/EN/ES, même
// pattern que push-automations.ts).
//
// La granularité 5 min est assumée : toutes ces règles tolèrent ce délai, le
// front affiche déjà l'état instantané dans les stations. L'anti-spam passe
// par notifAlreadySent avec une fenêtre par type (30 min à 1× par nuit).

import { insertOwnerNotif, notifAlreadySent, type NotifPriority } from './owner-notifications.ts';

type Lang = 'fr' | 'en' | 'es';
type LocalizedText = { title: string; body: string };

interface AlertRuleText {
  fr: LocalizedText;
  en: LocalizedText;
  es: LocalizedText;
}

const TEXTS: Record<string, AlertRuleText> = {
  liveops_bar_backlog: {
    fr: { title: 'Le bar déborde', body: '{n} commandes payées attendent au bar depuis plus de quelques minutes.' },
    en: { title: 'Bar is overloaded', body: '{n} paid orders are waiting at the bar.' },
    es: { title: 'El bar está desbordado', body: '{n} pedidos pagados esperan en el bar.' },
  },
  liveops_order_stuck: {
    fr: { title: 'Commande prête oubliée', body: 'La commande {ref} est prête depuis plus de 10 min et personne ne l’a récupérée.' },
    en: { title: 'Ready order forgotten', body: 'Order {ref} has been ready for over 10 min and nobody picked it up.' },
    es: { title: 'Pedido listo olvidado', body: 'El pedido {ref} lleva más de 10 min listo y nadie lo ha recogido.' },
  },
  liveops_vip_no_show: {
    fr: { title: 'Table VIP pas arrivée', body: 'La table de {name} n’est toujours pas arrivée 2 h après le début de la soirée.' },
    en: { title: 'VIP table not arrived', body: '{name}’s table still hasn’t arrived 2 h after the night started.' },
    es: { title: 'Mesa VIP sin llegar', body: 'La mesa de {name} sigue sin llegar 2 h después del inicio.' },
  },
  liveops_min_spend_risk: {
    fr: { title: 'Minimum conso à risque', body: 'Table de {name} : {spent} € consommés sur {min} € de minimum, à 90 min de la fermeture.' },
    en: { title: 'Min spend at risk', body: '{name}’s table: {spent} € spent of a {min} € minimum, 90 min before close.' },
    es: { title: 'Mínimo de consumo en riesgo', body: 'Mesa de {name}: {spent} € consumidos de {min} € de mínimo, a 90 min del cierre.' },
  },
  liveops_door_slow: {
    fr: { title: 'Porte plus lente que d’habitude', body: '{n} entrées contre {ref} à la même heure lors de la soirée comparable.' },
    en: { title: 'Door slower than usual', body: '{n} entries vs {ref} at the same time on the comparable night.' },
    es: { title: 'Puerta más lenta de lo normal', body: '{n} entradas frente a {ref} a la misma hora en la noche comparable.' },
  },
  liveops_capacity_80: {
    fr: { title: 'Jauge à 80 %', body: '{n} entrées cumulées — tu approches de la capacité ({cap}).' },
    en: { title: 'Capacity at 80%', body: '{n} cumulative entries — approaching room capacity ({cap}).' },
    es: { title: 'Aforo al 80 %', body: '{n} entradas acumuladas: te acercas al aforo ({cap}).' },
  },
  liveops_capacity_95: {
    fr: { title: 'Jauge à 95 %', body: '{n} entrées cumulées sur {cap} — la salle est quasi pleine.' },
    en: { title: 'Capacity at 95%', body: '{n} cumulative entries of {cap} — the room is nearly full.' },
    es: { title: 'Aforo al 95 %', body: '{n} entradas acumuladas de {cap}: la sala está casi llena.' },
  },
  liveops_refund_spike: {
    fr: { title: 'Vague de remboursements', body: '{n} remboursements dans les 30 dernières minutes. Va voir ce qui se passe au bar.' },
    en: { title: 'Refund spike', body: '{n} refunds in the last 30 minutes. Check what’s happening at the bar.' },
    es: { title: 'Ola de reembolsos', body: '{n} reembolsos en los últimos 30 minutos. Mira qué pasa en el bar.' },
  },
  liveops_revenue_goal: {
    fr: { title: 'Objectif CA atteint', body: 'Le CA de ce soir ({n} €) dépasse déjà celui de la soirée comparable ({ref} €).' },
    en: { title: 'Revenue goal reached', body: 'Tonight’s revenue ({n} €) already beats the comparable night ({ref} €).' },
    es: { title: 'Objetivo de ingresos alcanzado', body: 'Los ingresos de esta noche ({n} €) ya superan la noche comparable ({ref} €).' },
  },
  liveops_incident: {
    fr: { title: 'Plusieurs incidents à la porte', body: '{n} incidents signalés par ton staff en 30 minutes.' },
    en: { title: 'Several door incidents', body: '{n} incidents reported by your staff within 30 minutes.' },
    es: { title: 'Varias incidencias en la puerta', body: '{n} incidencias señaladas por tu staff en 30 minutos.' },
  },
};

function render(text: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)),
    text,
  );
}

// deno-lint-ignore no-explicit-any
type Admin = any;

interface PendingAlert {
  type: string;
  priority: NotifPriority;
  referenceType: string;
  referenceId: string;
  /** Fenêtre de dédup en heures (notifAlreadySent). */
  dedupHours: number;
  push: boolean;
  vars: Record<string, string | number>;
  metadata?: Record<string, unknown>;
}

async function pushToOwner(
  supabaseUrl: string,
  serviceKey: string,
  ownerId: string,
  text: LocalizedText,
  vars: Record<string, string | number>,
): Promise<void> {
  try {
    await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({
        user_id: ownerId,
        payload: { title: render(text.title, vars), body: render(text.body, vars), url: '/owner/live' },
      }),
    });
  } catch (e) {
    console.warn('[LIVE-OPS] push failed', ownerId, String(e));
  }
}

export async function dispatchLiveOpsAlerts(
  admin: Admin,
  supabaseUrl: string,
  serviceKey: string,
): Promise<{ events: number; alerts: number; pushed: number }> {
  const now = new Date();
  const nowIso = now.toISOString();
  let alerts = 0;
  let pushed = 0;

  const { data: activeEvents } = await admin
    .from('events')
    .select('id, title, venue_id, start_at, end_at')
    .eq('is_active', true)
    .lte('start_at', nowIso)
    .gte('end_at', nowIso)
    .not('venue_id', 'is', null)
    .limit(50);

  for (const event of activeEvents || []) {
    try {
      const pending: PendingAlert[] = [];
      const venueId = event.venue_id as string;
      const startMs = new Date(event.start_at).getTime();
      const endMs = new Date(event.end_at).getTime();
      const elapsedMin = Math.floor((now.getTime() - startMs) / 60_000);

      const [ordersRes, ticketsRes, tablesRes] = await Promise.all([
        admin
          .from('orders')
          .select('id, order_number, status, prep_status, created_at, ready_at, refunded_at, total, service_fee')
          .eq('venue_id', venueId)
          .eq('event_id', event.id)
          .gte('created_at', event.start_at),
        admin
          .from('tickets')
          .select('id, entry_scanned, entry_scanned_at')
          .eq('event_id', event.id)
          .eq('status', 'paid')
          .eq('entry_scanned', true),
        admin
          .from('table_reservations')
          .select('id, full_name, status, checked_in_at, entry_scanned, minimum_spend')
          .eq('event_id', event.id)
          .neq('status', 'cancelled'),
      ]);

      // deno-lint-ignore no-explicit-any
      const orders: any[] = ordersRes.data || [];
      // deno-lint-ignore no-explicit-any
      const scannedTickets: any[] = ticketsRes.data || [];
      // deno-lint-ignore no-explicit-any
      const tables: any[] = (tablesRes.data || []).filter((t: any) => t.status !== 'denied');

      const entries = scannedTickets.length + tables.filter((t) => t.entry_scanned || t.checked_in_at).length;
      const orderRef = (o: { order_number?: string | null; id: string }) => `#${o.order_number || o.id.slice(0, 6)}`;

      // ── Bar : backlog ────────────────────────────────────────────────────
      const backlog = orders.filter((o) => o.status === 'paid' && !o.refunded_at && (!o.prep_status || o.prep_status === 'queue'));
      if (backlog.length >= 8) {
        pending.push({
          type: 'liveops_bar_backlog', priority: 'high', referenceType: 'event', referenceId: event.id,
          dedupHours: 0.5, push: false, vars: { n: backlog.length },
        });
      }

      // ── Bar : commande prête oubliée > 10 min ───────────────────────────
      const tenMinAgoIso = new Date(now.getTime() - 10 * 60_000).toISOString();
      orders
        .filter((o) => o.prep_status === 'ready' && o.ready_at && o.ready_at <= tenMinAgoIso && !o.refunded_at)
        .slice(0, 3)
        .forEach((o) => {
          pending.push({
            type: 'liveops_order_stuck', priority: 'high', referenceType: 'order', referenceId: o.id,
            dedupHours: 12, push: false, vars: { ref: orderRef(o) },
          });
        });

      // ── VIP : no-show 2 h après le début ─────────────────────────────────
      if (now.getTime() >= startMs + 2 * 3600_000) {
        tables
          .filter((t) => !t.checked_in_at && !t.entry_scanned)
          .slice(0, 3)
          .forEach((t) => {
            pending.push({
              type: 'liveops_vip_no_show', priority: 'normal', referenceType: 'reservation', referenceId: t.id,
              dedupHours: 12, push: false, vars: { name: t.full_name || 'VIP' },
            });
          });
      }

      // ── VIP : minimum conso à risque à T-90 min ──────────────────────────
      const remainingMs = endMs - now.getTime();
      if (remainingMs > 0 && remainingMs <= 90 * 60_000) {
        const arrived = tables.filter((t) => (t.checked_in_at || t.entry_scanned) && Number(t.minimum_spend || 0) > 0);
        if (arrived.length > 0) {
          const { data: consumptions } = await admin
            .from('vip_consumptions')
            .select('table_reservation_id, total_price')
            .eq('venue_id', venueId)
            .gte('served_at', event.start_at);
          const spendByTable = new Map<string, number>();
          // deno-lint-ignore no-explicit-any
          (consumptions || []).forEach((c: any) => {
            spendByTable.set(c.table_reservation_id, (spendByTable.get(c.table_reservation_id) || 0) + Number(c.total_price || 0));
          });
          arrived
            .filter((t) => (spendByTable.get(t.id) || 0) < Number(t.minimum_spend) * 0.6)
            .slice(0, 3)
            .forEach((t) => {
              pending.push({
                type: 'liveops_min_spend_risk', priority: 'urgent', referenceType: 'reservation', referenceId: t.id,
                dedupHours: 12, push: true,
                vars: { name: t.full_name || 'VIP', spent: Math.round(spendByTable.get(t.id) || 0), min: Math.round(Number(t.minimum_spend)) },
              });
            });
        }
      }

      // ── Remboursements : vague sur 30 min ────────────────────────────────
      const thirtyMinAgoIso = new Date(now.getTime() - 30 * 60_000).toISOString();
      const recentRefunds = orders.filter((o) => o.refunded_at && o.refunded_at >= thirtyMinAgoIso).length;
      if (recentRefunds > 3) {
        pending.push({
          type: 'liveops_refund_spike', priority: 'urgent', referenceType: 'event', referenceId: event.id,
          dedupHours: 1, push: true, vars: { n: recentRefunds },
        });
      }

      // ── Incidents staff : rafale sur 30 min ──────────────────────────────
      const { count: incidentCount } = await admin
        .from('night_ops_events')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', venueId)
        .like('kind', 'incident_%')
        .gte('created_at', thirtyMinAgoIso);
      if ((incidentCount ?? 0) >= 3) {
        pending.push({
          type: 'liveops_incident', priority: 'urgent', referenceType: 'event', referenceId: event.id,
          dedupHours: 1, push: true, vars: { n: incidentCount ?? 0 },
        });
      }

      // ── Jauge de capacité 80 / 95 % ──────────────────────────────────────
      const { data: baseline } = await admin
        .from('venue_hype_baseline')
        .select('capacity')
        .eq('venue_id', venueId)
        .maybeSingle();
      const capacity = Number(baseline?.capacity || 0);
      if (capacity > 0) {
        if (entries >= capacity * 0.95) {
          pending.push({
            type: 'liveops_capacity_95', priority: 'urgent', referenceType: 'event', referenceId: event.id,
            dedupHours: 12, push: true, vars: { n: entries, cap: capacity },
          });
        } else if (entries >= capacity * 0.8) {
          pending.push({
            type: 'liveops_capacity_80', priority: 'high', referenceType: 'event', referenceId: event.id,
            dedupHours: 12, push: false, vars: { n: entries, cap: capacity },
          });
        }
      }

      // ── Comparable : porte lente + objectif CA (1× par nuit chacune) ─────
      // Dédup AVANT le calcul : la soirée comparable coûte 3 requêtes.
      const doorSlowSent = await notifAlreadySent(admin, venueId, 'liveops_door_slow', event.id, 12);
      const revenueGoalSent = await notifAlreadySent(admin, venueId, 'liveops_revenue_goal', event.id, 12);
      if ((!doorSlowSent && elapsedMin >= 90) || !revenueGoalSent) {
        const comparable = await fetchComparable(admin, venueId, event.id, event.start_at);
        if (comparable) {
          if (!doorSlowSent && elapsedMin >= 90) {
            const refEntries = comparable.entriesAt(elapsedMin);
            if (refEntries >= 30 && entries < refEntries * 0.5) {
              pending.push({
                type: 'liveops_door_slow', priority: 'high', referenceType: 'event', referenceId: event.id,
                dedupHours: 12, push: false, vars: { n: entries, ref: refEntries },
              });
            }
          }
          if (!revenueGoalSent && comparable.totalRevenue > 100) {
            const revenue = orders
              .filter((o) => o.status === 'paid' || o.status === 'served')
              .reduce((s, o) => s + Number(o.total || 0) - Number(o.service_fee || 0), 0);
            if (revenue >= comparable.totalRevenue) {
              pending.push({
                type: 'liveops_revenue_goal', priority: 'normal', referenceType: 'event', referenceId: event.id,
                dedupHours: 12, push: false,
                vars: { n: Math.round(revenue), ref: Math.round(comparable.totalRevenue) },
              });
            }
          }
        }
      }

      // ── Persistance + push (dédup par type/référence) ─────────────────────
      if (pending.length === 0) continue;

      const { data: venue } = await admin.from('venues').select('owner_id').eq('id', venueId).maybeSingle();
      const ownerId: string | null = venue?.owner_id ?? null;
      let lang: Lang = 'fr';
      if (ownerId) {
        const { data: profile } = await admin.from('profiles').select('preferred_language').eq('id', ownerId).maybeSingle();
        if (profile?.preferred_language === 'en' || profile?.preferred_language === 'es') lang = profile.preferred_language;
      }

      for (const alert of pending) {
        const already = await notifAlreadySent(admin, venueId, alert.type, alert.referenceId, alert.dedupHours);
        if (already) continue;
        const text = TEXTS[alert.type][lang];
        await insertOwnerNotif({
          venueId,
          type: alert.type,
          title: render(text.title, alert.vars),
          message: render(text.body, alert.vars),
          priority: alert.priority,
          referenceType: alert.referenceType,
          referenceId: alert.referenceId,
          eventId: event.id,
          metadata: { ...alert.vars, ...(alert.metadata || {}) },
          client: admin,
        });
        alerts++;
        if (alert.push && ownerId) {
          await pushToOwner(supabaseUrl, serviceKey, ownerId, TEXTS[alert.type][lang], alert.vars);
          pushed++;
        }
      }
    } catch (e) {
      console.error('[LIVE-OPS] event failed', event.id, String(e));
    }
  }

  return { events: (activeEvents || []).length, alerts, pushed };
}

/** Soirée comparable : même jour de semaine (Paris) sur 60 j, sinon la plus
 * récente. Retourne les entrées cumulées à un instant donné + le CA total. */
async function fetchComparable(
  admin: Admin,
  venueId: string,
  currentEventId: string,
  currentStartAt: string,
): Promise<{ entriesAt: (elapsedMin: number) => number; totalRevenue: number } | null> {
  const nowIso = new Date().toISOString();
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 3600_000).toISOString();
  const { data: candidates } = await admin
    .from('events')
    .select('id, start_at, end_at')
    .eq('venue_id', venueId)
    .neq('id', currentEventId)
    .lt('end_at', nowIso)
    .gte('end_at', sixtyDaysAgo)
    .order('start_at', { ascending: false })
    .limit(12);
  if (!candidates || candidates.length === 0) return null;

  const weekday = (iso: string) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', weekday: 'short' }).format(new Date(iso));
  const currentDay = weekday(currentStartAt);
  // deno-lint-ignore no-explicit-any
  const chosen = candidates.find((c: any) => weekday(c.start_at) === currentDay) ?? candidates[0];
  const chosenStartMs = new Date(chosen.start_at).getTime();

  const [scansRes, ordersRes] = await Promise.all([
    admin
      .from('tickets')
      .select('entry_scanned_at')
      .eq('event_id', chosen.id)
      .eq('status', 'paid')
      .eq('entry_scanned', true),
    admin
      .from('orders')
      .select('total, service_fee, status')
      .eq('event_id', chosen.id)
      .in('status', ['paid', 'served']),
  ]);

  const scanOffsets: number[] = (scansRes.data || [])
    // deno-lint-ignore no-explicit-any
    .filter((t: any) => t.entry_scanned_at)
    // deno-lint-ignore no-explicit-any
    .map((t: any) => Math.max(0, Math.floor((new Date(t.entry_scanned_at).getTime() - chosenStartMs) / 60_000)))
    .sort((a: number, b: number) => a - b);
  const totalRevenue = (ordersRes.data || [])
    // deno-lint-ignore no-explicit-any
    .reduce((s: number, o: any) => s + Number(o.total || 0) - Number(o.service_fee || 0), 0);

  return {
    entriesAt: (elapsedMin: number) => scanOffsets.filter((m) => m <= elapsedMin).length,
    totalRevenue,
  };
}
