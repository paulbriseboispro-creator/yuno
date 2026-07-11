// Widget « Prochaine soirée » — pipeline de données (Phase 6).
//
// Écrit le prochain événement billeté dans les UserDefaults du App Group
// (group.eu.yunoapp.app) via capacitor-widget-bridge, puis recharge les
// timelines WidgetKit. L'extension YunoWidgets (SwiftUI, voir
// docs/NATIVE_SETUP.md) lit la même clé. Leçon Duolingo : une surface que
// l'utilisateur a CHOISI de poser sur son écran d'accueil peut se rafraîchir
// sans jamais être du spam.
//
// Fire-and-forget, natif B2C uniquement — no-op web/Pro/pré-Phase 3.
import { isNative, isProApp } from '@/lib/native';

export const WIDGET_GROUP = 'group.eu.yunoapp.app';
export const WIDGET_KEY = 'yuno.nextEvent';

export interface NextEventWidgetData {
  title: string;
  venueName: string;
  /** ISO 8601 — le widget rend le compte à rebours nativement. */
  startAt: string;
  posterUrl?: string | null;
}

/**
 * Publie (ou efface avec null) le prochain événement dans le App Group.
 * À appeler après chargement des billets (MyOrders) et au logout.
 */
export async function syncNextEventWidget(next: NextEventWidgetData | null): Promise<void> {
  if (!isNative() || isProApp()) return;
  try {
    const { WidgetBridgePlugin } = await import('capacitor-widget-bridge');
    if (next) {
      await WidgetBridgePlugin.setItem({ key: WIDGET_KEY, value: JSON.stringify(next), group: WIDGET_GROUP });
    } else {
      await WidgetBridgePlugin.removeItem({ key: WIDGET_KEY, group: WIDGET_GROUP });
    }
    await WidgetBridgePlugin.reloadAllTimelines();
  } catch {
    // Plugin absent du build natif (pré-Phase 3) : silencieux.
  }
}

/** Choisit le prochain billet à venir et le publie. */
export function publishNextEventFromTickets(
  tickets: Array<{ eventTitle: string; eventStartAt: string; venueName: string; eventPosterUrl?: string | null; status: string }>,
): void {
  const now = Date.now();
  const upcoming = tickets
    .filter((t) => t.status === 'paid' && new Date(t.eventStartAt).getTime() > now)
    .sort((a, b) => new Date(a.eventStartAt).getTime() - new Date(b.eventStartAt).getTime())[0];
  void syncNextEventWidget(
    upcoming
      ? {
          title: upcoming.eventTitle,
          venueName: upcoming.venueName,
          startAt: upcoming.eventStartAt,
          posterUrl: upcoming.eventPosterUrl ?? null,
        }
      : null,
  );
}
