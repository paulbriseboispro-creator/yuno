// Détection de session support (accès admin assisté — migration 20260824120000).
//
// Une session support est une session GoTrue mintée par un super admin POUR un
// client consentant (grant actif). Elle est authentifiée COMME le client : les
// gardes RLS/triggers côté base la reconnaissent via le claim JWT `session_id`
// (table admin_support_sessions). Les edge functions qui touchent à l'argent ou
// à l'identité du compte (stripe-connect, email-change, delete-account) doivent
// la refuser explicitement — c'est le rôle de ce helper.
//
// Le parse du payload JWT est fait SANS vérification de signature : chaque
// appelant a déjà validé le token via auth.getUser() — on ne lit ici qu'un
// claim d'un token déjà authentifié.
//
// Fail-open volontaire : si la table n'existe pas encore (migration pas
// poussée) ou si la requête échoue, on répond false — aucune session support
// ne peut exister dans ce cas, le comportement historique est préservé.

export function jwtSessionId(token: string): string | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const payload = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload?.session_id === "string" && payload.session_id.length > 0
      ? payload.session_id
      : null;
  } catch {
    return null;
  }
}

interface MinimalAdminClient {
  from(table: string): {
    select(cols: string): {
      eq(col: string, val: string): {
        eq(col: string, val: string): {
          gt(col: string, val: string): {
            maybeSingle(): Promise<{ data: unknown; error: unknown }>;
          };
        };
      };
    };
  };
}

/** La session support derrière ce JWT — de quoi écrire une ligne d'audit. */
export interface SupportSessionRow {
  id: string;
  grant_id: string | null;
  target_user_id: string;
  admin_id: string | null;
}

/**
 * La session support active derrière ce JWT, ou null.
 *
 * Deux usages : refuser une écriture (le booléen suffit), ou l'AUTORISER en la
 * traçant — et pour tracer il faut nommer l'admin réel, pas le pro dont la
 * session est empruntée. D'où le retour de la ligne entière.
 */
export async function supportSessionFor(
  supabaseAdmin: MinimalAdminClient,
  accessToken: string,
): Promise<SupportSessionRow | null> {
  const sid = jwtSessionId(accessToken);
  if (!sid) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from("admin_support_sessions")
      .select("id, grant_id, target_user_id, admin_id")
      .eq("auth_session_id", sid)
      .eq("status", "active")
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (error || !data) return null;
    return data as SupportSessionRow;
  } catch {
    return null;
  }
}

/** La requête porte-t-elle un JWT de session support active ? */
export async function isSupportSessionToken(
  supabaseAdmin: MinimalAdminClient,
  accessToken: string,
): Promise<boolean> {
  return (await supportSessionFor(supabaseAdmin, accessToken)) !== null;
}
