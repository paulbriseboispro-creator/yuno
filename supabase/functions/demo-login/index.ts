// demo-login — connexion serveur aux comptes démo @womber.fr.
//
// Le mot de passe partagé des comptes démo vivait en clair dans le bundle web
// (DemoSwitcher / demoSession.ts). Il vit désormais UNIQUEMENT dans le secret
// edge DEMO_LOGIN_PASSWORD : le front envoie l'email du compte démo voulu, la
// fonction vérifie l'allowlist stricte ci-dessous, fait le signInWithPassword
// côté serveur (client anon supabase-js) et renvoie les tokens de session.
//
//   POST { email } → 200 { access_token, refresh_token }
//                  → 403 { error: "forbidden" }        (email hors allowlist)
//                  → 500 { error: "not_configured" }   (secret absent)
//                  → 401 { error: "signin_failed" }    (mdp secret ≠ mdp en base)
//
// Ce flux sert AUSSI la démo du reviewer Apple (DemoSwitcher dans l'app native) :
// il doit rester joignable sans JWT → verify_jwt = false dans config.toml.
// Garde anti-abus : allowlist explicite + délai fixe sur chaque réponse pour
// aplanir le timing (pas d'énumération), et jamais aucun détail d'erreur auth.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { restrictedCorsHeaders } from "../_shared/cors.ts";

// Allowlist stricte — miroir exact de DEMO_ACCOUNTS (src/lib/demoSession.ts).
// Uniquement des comptes @womber.fr (club masqué, données fictives). Ne JAMAIS
// y ajouter un compte réel. apple-review@womber.fr n'y est pas : le reviewer se
// connecte au formulaire classique avec le mot de passe des notes ASC.
// NB : l'hôte VIP est bien viphost@ (sans underscore), comme dans demoSession.ts.
const DEMO_EMAILS = new Set([
  "owner@womber.fr",
  "organizer@womber.fr",
  "bde@womber.fr",
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
    if (!demoPassword || !url || !anonKey) {
      return await respond({ error: "not_configured" }, 500);
    }

    const authClient = createClient(url, anonKey);
    const { data, error } = await authClient.auth.signInWithPassword({
      email,
      password: demoPassword,
    });
    if (error || !data?.session) {
      return await respond({ error: "signin_failed" }, 401);
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
