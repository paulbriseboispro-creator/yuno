// Renommage des profils publics (agence, club, orga, DJ, promoteur) :
// le nom regénère les liens publics (triggers SQL 20260807100000) et un
// garde SQL limite à un changement par 30 jours (20260807101000).
// Ce module est le pendant front : aperçu du futur slug, prochaine date
// autorisée, parsing de l'erreur du garde.

export const RENAME_COOLDOWN_DAYS = 30;

/** Prochaine date de renommage autorisée, ou null si le renommage est libre. */
export function nextRenameAt(nameChangedAt: string | null | undefined): Date | null {
  if (!nameChangedAt) return null;
  const at = new Date(nameChangedAt).getTime();
  if (Number.isNaN(at)) return null;
  const next = new Date(at + RENAME_COOLDOWN_DAYS * 86_400_000);
  return next.getTime() > Date.now() ? next : null;
}

/** Date extraite d'une erreur 'rename_cooldown:<ISO>' du garde SQL, sinon null. */
export function parseRenameCooldownError(err: unknown): Date | null {
  const msg =
    typeof err === 'object' && err !== null && 'message' in err
      ? String((err as { message?: unknown }).message ?? '')
      : String(err ?? '');
  const m = msg.match(/rename_cooldown:(\S+)/);
  if (!m) return null;
  const d = new Date(m[1]);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Aperçu du slug qu'un nom produira — miroir des générateurs SQL
 * (search_norm + [^a-z0-9]+ → '-'). Le suffixe -2/-3 de désambiguïsation
 * n'est pas prévisible côté client : c'est un APERÇU, pas une promesse.
 */
export function slugifyName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
