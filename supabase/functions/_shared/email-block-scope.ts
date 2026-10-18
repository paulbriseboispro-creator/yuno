// Blocs d'e-mail liés à une soirée hors de l'espace qui envoie : ils ne
// partent pas (audit du 18/10, MAIL-14). Pur, testé par
// src/lib/__tests__/emailBlockScope.test.ts ; la liste des soirées de l'espace
// vient de `email_scope_event_ids` (migration 20261023160000).

export interface ScopedBlock { type: string; eventId?: unknown; [k: string]: unknown }

/**
 * Retire les blocs « live » (`isLive`) dont la soirée effective — la sienne,
 * sinon celle de la campagne — n'est pas dans `allowed`. La soirée de la
 * campagne elle-même ne compte que si elle est dans `allowed`.
 */
export function dropBlocksOutsideScope<B extends ScopedBlock>(
  blocks: B[], campaignEventId: string | null, allowed: Set<string>, isLive: (b: B) => boolean,
): { blocks: B[]; eventId: string | null; dropped: number } {
  const eventId = campaignEventId && allowed.has(campaignEventId) ? campaignEventId : null;
  let dropped = 0;
  const kept = blocks.filter((b) => {
    if (!isLive(b)) return true;
    const own = typeof b.eventId === 'string' && b.eventId ? b.eventId : null;
    const effective = own ?? campaignEventId;
    if (!effective || allowed.has(effective)) return true;
    dropped++;
    return false;
  });
  return { blocks: kept, eventId, dropped };
}
