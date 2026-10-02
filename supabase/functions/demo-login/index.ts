// demo-login — connexion serveur aux comptes démo @womber.fr.
//
// Le mot de passe partagé des comptes démo vivait en clair dans le bundle web
// (DemoSwitcher / demoSession.ts). Il vit désormais UNIQUEMENT dans le secret
// edge DEMO_LOGIN_PASSWORD : le front envoie l'email du compte démo voulu, la
// fonction vérifie l'allowlist stricte ci-dessous, fait le signInWithPassword
// côté serveur (client anon supabase-js) et renvoie les tokens de session.
//
//   POST { email } → 200 { access_token, refresh_token }
//                  → 403 { error: "forbidden" }        (email hors allowlist,
//                                                       ou appelant non connecté
//                                                       à un compte @womber.fr)
//                  → 500 { error: "not_configured" }   (secret absent)
//                  → 401 { error: "signin_failed" }    (mdp secret ≠ mdp en base)
//
// Ce flux sert AUSSI la démo du reviewer Apple (DemoSwitcher dans l'app native).
// verify_jwt = false dans config.toml (la passerelle ne filtre pas), MAIS depuis
// le 2026-09-27 l'appelant doit être DÉJÀ connecté à un compte @womber.fr : la
// fonction était publique, et n'importe qui obtenait une session en écriture
// sur owner@womber.fr avec un simple POST {email} — le mot de passe des liens
// d'aperçu ne protégeait donc rien. Tous les usages légitimes (DemoSwitcher,
// visible seulement pour un compte démo ; bascule de rôle d'un aperçu) partent
// d'une session @womber.fr.
//
// Une bascule demandée DEPUIS une session d'aperçu (lien /preview) rend une
// session elle-même marquée aperçu (demo_preview_sessions, origin
// 'role_switch') : changer de rôle ne rend jamais l'écriture au prospect.
//
// Garde anti-abus : allowlist explicite + délai fixe sur chaque réponse pour
// aplanir le timing (pas d'énumération), et jamais aucun détail d'erreur auth.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { restrictedCorsHeaders } from "../_shared/cors.ts";
import { jwtSessionId } from "../_shared/support-session.ts";
import { isDemoPreviewSessionId } from "../_shared/demo-guard.ts";

// Allowlist stricte — miroir exact de DEMO_ACCOUNTS (src/lib/demoSession.ts).
// Uniquement des comptes @womber.fr (club masqué, données fictives). Ne JAMAIS
// y ajouter un compte réel. apple-review@womber.fr n'y est pas : le reviewer se
// connecte au formulaire classique avec le mot de passe des notes ASC.
// NB : l'hôte VIP est bien viphost@ (sans underscore), comme dans demoSession.ts.
const DEMO_EMAILS = new Set([
  "owner@womber.fr",
  "organizer@womber.fr",
  "bde@womber.fr",
  "crm@womber.fr",
  "promoter@womber.fr",
  "agency@womber.fr",
  "dj@womber.fr",
  "affiliate@womber.fr",
  "bouncer@womber.fr",
  "barman@womber.fr",
  "cloakroom@womber.fr",
  "viphost@womber.fr",
]);

/** Délai fixe appliqué à toutes les réponses (succès comme refus) : le timing
 *  ne révèle ni l'existence du compte ni la validité de l'email. */
const FIXED_DELAY_MS = 400;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const cors = restrictedCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, cors);

  const started = Date.now();
  const respond = async (body: unknown, status: number) => {
    // Réponse à cadence fixe (anti-abus simple, timing constant).
    const elapsed = Date.now() - started;
    if (elapsed < FIXED_DELAY_MS) await sleep(FIXED_DELAY_MS - elapsed);
    return json(body, status, cors);
  };

  try {
    const body = await req.json().catch(() => ({}));
    const email = String((body as { email?: unknown })?.email ?? "").trim().toLowerCase();

    // @womber.fr strict + allowlist explicite : tout le reste → 403, sans détail.
    if (!email.endsWith("@womber.fr") || !DEMO_EMAILS.has(email)) {
      return await respond({ error: "forbidden" }, 403);
    }

    // DEMO_ACCOUNT_PASSWORD est le secret historique du flux preview
    // (accept-staff-invitation) : accepté en repli pour qu'une rotation ne
    // demande qu'un seul secret. AUCUN mot de passe en dur ici.
    const demoPassword = Deno.env.get("DEMO_LOGIN_PASSWORD") ?? Deno.env.get("DEMO_ACCOUNT_PASSWORD");
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!demoPassword || !url || !anonKey || !serviceKey) {
      return await respond({ error: "not_configured" }, 500);
    }

    // L'appelant doit être une session VALIDE d'un compte @womber.fr.
    const authHeader = req.headers.get("Authorization") ?? "";
    const callerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!callerToken) return await respond({ error: "forbidden" }, 403);
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: caller, error: callerErr } = await admin.auth.getUser(callerToken);
    const callerEmail = String(caller?.user?.email ?? "").toLowerCase();
    if (callerErr || !callerEmail.endsWith("@womber.fr")) {
      return await respond({ error: "forbidden" }, 403);
    }
    const fromPreview = await isDemoPreviewSessionId(jwtSessionId(callerToken));

    const authClient = createClient(url, anonKey);
    const { data, error } = await authClient.auth.signInWithPassword({
      email,
      password: demoPassword,
    });
    if (error || !data?.session) {
      return await respond({ error: "signin_failed" }, 401);
    }

    // Aperçu → la nouvelle session hérite du marquage (fail-closed : sans
    // marquage, pas de session).
    if (fromPreview) {
      const sid = jwtSessionId(data.session.access_token);
      const { error: regErr } = sid
        ? await admin.rpc("register_demo_preview_session", {
            p_session_id: sid, p_user_id: data.session.user.id, p_token: null, p_origin: "role_switch",
          })
        : { error: new Error("no_session_id") };
      if (regErr) {
        try { await admin.auth.admin.signOut(data.session.access_token, "local"); } catch { /* best effort */ }
        return await respond({ error: "server_error" }, 500);
      }
    }

    return await respond(
      {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      },
      200,
    );
  } catch {
    return await respond({ error: "server_error" }, 500);
  }
});
