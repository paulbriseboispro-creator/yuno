import type { ScarcitySettings } from '@/hooks/useScarcitySettings';

/**
 * Rareté sur une part de guest list — la même règle que les paliers de billets
 * et les zones de tables, lue dans `event_scarcity_settings` :
 *  • mode Badge   : « 🔥 Dernières places » dès que le remplissage atteint le
 *                   seuil ; jamais de chiffre.
 *  • mode Compteur: le nombre de places restantes, plafonné par part via
 *                   `display_caps_per_round` (clé = id de la part, ou
 *                   `<id>:female` / `<id>:male` pour une part genrée).
 *  • mode Rien    : aucun signal.
 * Sans réglage de rareté sur la soirée (aucune ligne), le compteur brut suit
 * `guest_lists.show_remaining`, comme avant. Ce drapeau de part reste la porte
 * du CHIFFRE, à une exception près : un plafond SAISI pour cette part sur la
 * page Rareté & FOMO (`display_caps_per_round`, plafonnage activé) est une
 * instruction explicite d'afficher un nombre et prime sur `show_remaining` —
 * sinon la page promet « 32 places restantes » dans son aperçu et le public
 * n'affiche rien. Le badge (qui ne révèle rien) s'affiche partout.
 * Quota NULL = part illimitée : ni pleine, ni signal.
 */
export const SCARCITY_LABELS: Record<string, { key: string; emoji: string }> = {
  few_left: { key: 'scarcity.labelFewLeft', emoji: '🔥' },
  almost_sold_out: { key: 'scarcity.labelAlmostSoldOut', emoji: '⚡' },
  last_tickets: { key: 'scarcity.labelLastTickets', emoji: '🎟️' },
};

export interface ScarcityBadge { label: string; emoji: boolean }

export function scarcityBadgeText(badge: ScarcityBadge, t: (key: string) => string): string {
  const def = SCARCITY_LABELS[badge.label] ?? SCARCITY_LABELS.few_left;
  return badge.emoji ? `${def.emoji} ${t(def.key)}` : t(def.key);
}

export interface GuestListScarcityInput {
  /** Clé du plafond : id de la part, ou `<id>:female` / `<id>:male`. */
  capKey: string;
  /** Quota du périmètre jugé (part entière ou genre). NULL = illimité. */
  quota: number | null;
  /** Inscrits du même périmètre. */
  count: number;
  /** Restant déjà calculé par l'appelant (ex. limité aux types offerts) ; sinon quota − count. */
  remaining?: number | null;
  /** `guest_lists.show_remaining` de la part. */
  showRemaining: boolean;
}

export interface GuestListScarcitySignal {
  /** Restant réel, NULL = illimité. */
  remaining: number | null;
  isFull: boolean;
  badge: ScarcityBadge | null;
  /** Chiffre à afficher (déjà plafonné), NULL = rien. */
  counter: number | null;
}

export function guestListScarcity(
  settings: ScarcitySettings | null | undefined,
  gl: GuestListScarcityInput,
): GuestListScarcitySignal {
  const remaining = gl.remaining !== undefined
    ? gl.remaining
    : (gl.quota === null ? null : Math.max(0, gl.quota - gl.count));
  const isFull = remaining !== null && remaining <= 0;
  const none = { remaining, isFull, badge: null, counter: null };
  if (isFull || remaining === null) return none;
  if (!settings) return { ...none, counter: gl.showRemaining ? remaining : null };

  const counterMode = settings.show_remaining_count && !settings.low_stock_enabled;
  const badgeMode = settings.low_stock_enabled && !settings.show_remaining_count;
  if (counterMode) {
    const cap = settings.display_cap_enabled ? settings.display_caps_per_round?.[gl.capKey] : undefined;
    const capped = typeof cap === 'number' && cap > 0;
    // Le plafond saisi vaut opt-in explicite pour CETTE part : il ouvre le
    // compteur même quand `show_remaining` est coupé.
    if (!gl.showRemaining && !capped) return none;
    return { ...none, counter: capped ? Math.min(remaining, cap as number) : remaining };
  }
  if (badgeMode) {
    const pct = gl.quota && gl.quota > 0 ? (gl.count / gl.quota) * 100 : null;
    const hit = pct !== null && pct >= (settings.low_stock_percent ?? 80);
    return { ...none, badge: hit ? { label: settings.low_stock_label, emoji: settings.emoji_enabled } : null };
  }
  return none;
}
