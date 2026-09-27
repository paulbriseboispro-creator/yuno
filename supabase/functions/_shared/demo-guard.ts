// Garde « démo » des edge functions (2026-09-27, migration 20260927160000).
//
// Deux niveaux, lus depuis le JWT de l'appelant :
//
//   • SESSION D'APERÇU (lien /preview/:token, table demo_preview_sessions) :
//     le prospect a promis la LECTURE SEULE. Côté PostgREST c'est le hook
//     pre-request qui l'impose ; mais une edge function écrit en service_role,
//     le hook ne la voit pas. `demoPreviewGuard` la refuse donc à l'entrée —
//     miroir serveur de previewGuard.ts, qui bloque déjà tout
//     `functions.invoke` dans l'onglet d'aperçu.
//
//   • COMPTE DÉMO (@womber.fr, toute session — Paul et l'agent compris) :
//     `demoAccountGuard` refuse ce qui n'a JAMAIS de sens sur un compte
//     partagé : relier un actif réel (Meta, Stripe Connect), acheter avec une
//     vraie carte, changer l'identité du compte, le supprimer, y poser une 2FA.
//
// Le JWT est lu SANS vérifier sa signature : on ne fait que REFUSER en plus.
// Un jeton forgé ne passera de toute façon pas l'auth.getUser() de la
// fonction ; un jeton forgé pour se faire refuser n'a aucun intérêt.
// Fail-open sur panne de lecture de la table (même choix que
// support-session.ts) : côté base, le hook pre-request reste la vraie porte.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jwtSessionId } from "./support-session.ts";

interface JwtBits {
  email: string | null;
  sessionId: string | null;
}

function readJwt(req: Request): JwtBits {
  const h = req.headers.get("Authorization") ?? "";
  if (!h.startsWith("Bearer ")) return { email: null, sessionId: null };
  const token = h.slice(7);
  let email: string | null = null;
  try {
    const part = token.split(".")[1];
    const payload = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    email = typeof payload?.email === "string" ? payload.email.toLowerCase() : null;
  } catch {
    email = null;
  }
  return { email, sessionId: jwtSessionId(token) };
}

/** Miroir de is_demo_email() (SQL) : comptes démo, vitrines, comptes supprimés. */
export function isDemoEmail(email: string | null | undefined): boolean {
  const e = String(email ?? "").toLowerCase();
  return e.endsWith("@womber.fr")
    || (e.startsWith("vitrine+") && e.endsWith("@yunoapp.eu"))
    || (e.startsWith("deleted-") && e.endsWith("@deleted.local"));
}

/** Compte démo PARTAGÉ (@womber.fr) : identifiants et actifs réels gelés. */
export function isSharedDemoEmail(email: string | null | undefined): boolean {
  return String(email ?? "").toLowerCase().endsWith("@womber.fr");
}

/** La session derrière ce jeton a-t-elle été ouverte par un lien d'aperçu ? */
export async function isDemoPreviewSessionId(sessionId: string | null): Promise<boolean> {
  if (!sessionId) return false;
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );
    const { data, error } = await admin
      .from("demo_preview_sessions")
      .select("auth_session_id")
      .eq("auth_session_id", sessionId)
      .maybeSingle();
    return !error && !!data;
  } catch {
    return false;
  }
}

/** La requête vient-elle d'une session d'aperçu démo ? */
export async function isDemoPreviewRequest(req: Request): Promise<boolean> {
  const { email, sessionId } = readJwt(req);
  if (!isDemoEmail(email)) return false; // aucun accès base pour les vrais comptes
  return isDemoPreviewSessionId(sessionId);
}

function refusal(code: string, cors: Record<string, string>): Response {
  return new Response(
    JSON.stringify({ error: code, code, success: false }),
    { status: 403, headers: { ...cors, "Content-Type": "application/json" } },
  );
}

/**
 * Refuse toute action d'une session d'aperçu démo. À poser en tête du
 * handler, après l'OPTIONS : `const d = await demoPreviewGuard(req, cors); if (d) return d;`
 */
export async function demoPreviewGuard(
  req: Request,
  cors: Record<string, string>,
): Promise<Response | null> {
  return (await isDemoPreviewRequest(req)) ? refusal("demo_read_only", cors) : null;
}

/**
 * Refuse l'action à TOUT compte démo partagé (et, a fortiori, à un aperçu).
 * Pour ce qui relie un actif réel ou touche l'identité du compte.
 */
export async function demoAccountGuard(
  req: Request,
  cors: Record<string, string>,
): Promise<Response | null> {
  const { email, sessionId } = readJwt(req);
  if (isSharedDemoEmail(email)) return refusal("demo_account_locked", cors);
  if (isDemoEmail(email) && await isDemoPreviewSessionId(sessionId)) {
    return refusal("demo_read_only", cors);
  }
  return null;
}
