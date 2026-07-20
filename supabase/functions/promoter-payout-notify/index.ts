import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { restrictedCorsHeaders } from "../_shared/cors.ts";
import { sendAutoPush } from "../_shared/auto-push.ts";

/**
 * Notifications du cycle de règlement promoteur.
 *
 * Appelée par le front juste après chaque transition (déclaration du virement,
 * accusé de réception, litige). Le client ne dit PAS quoi envoyer : il donne un
 * payout_id, et la fonction lit le statut réel en base pour décider. Sinon
 * n'importe quel appelant pourrait déclencher « virement déclaré » sur un lot
 * qui n'a jamais bougé, et le promoteur irait vérifier un compte pour rien.
 *
 * Le seul push réellement structurant est celui du virement déclaré : sans lui,
 * le promoteur ignore qu'on attend son accusé de réception, et le watchdog fait
 * basculer le lot en litige au bout de quelques jours. L'app affiche aussi la
 * demande en clair sur le tableau de bord promoteur — le push accélère, il ne
 * porte pas le flux à lui seul.
 *
 * ⚠️ Pas encore déployée : le cap de fonctions edge Supabase renvoie 402 sur
 * tout nouveau déploiement tant que le spend cap n'est pas relevé. Le cycle
 * fonctionne sans elle (surfaces in-app + bascule automatique en litige), mais
 * l'expérience est nettement meilleure une fois déployée.
 */

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[PROMOTER-PAYOUT-NOTIFY] ${step}`, details ? JSON.stringify(details) : "");
};

serve(async (req) => {
  const corsHeaders = restrictedCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authentication required" }, 401);

    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "Authentication required" }, 401);

    const { payout_id } = await req.json().catch(() => ({ payout_id: null }));
    if (!payout_id) return json({ error: "payout_id required" }, 400);

    const admin = createClient(url, serviceKey);

    const { data: payout } = await admin
      .from("promoter_payouts")
      .select("id, promoter_id, venue_id, organizer_user_id, amount, status, transfer_reference")
      .eq("id", payout_id)
      .maybeSingle();
    if (!payout) return json({ error: "payout not found" }, 404);

    const { data: promoter } = await admin
      .from("promoters")
      .select("user_id")
      .eq("id", payout.promoter_id)
      .maybeSingle();
    if (!promoter?.user_id) return json({ error: "promoter not found" }, 404);

    // Qui représente le club : owner du lieu, ou l'organisateur lui-même.
    let clubUserId: string | null = payout.organizer_user_id ?? null;
    let payerName = "";
    if (payout.venue_id) {
      const { data: venue } = await admin
        .from("venues")
        .select("owner_id, name")
        .eq("id", payout.venue_id)
        .maybeSingle();
      clubUserId = venue?.owner_id ?? null;
      payerName = venue?.name ?? "";
    }
    if (!payerName && clubUserId) {
      const { data: prof } = await admin
        .from("profiles")
        .select("first_name, last_name")
        .eq("id", clubUserId)
        .maybeSingle();
      payerName = `${prof?.first_name ?? ""} ${prof?.last_name ?? ""}`.trim();
    }

    // L'appelant doit être partie prenante. Un tiers authentifié n'a rien à
    // faire dans les notifications d'un règlement qui ne le concerne pas.
    const isParty = user.id === promoter.user_id || user.id === clubUserId;
    if (!isParty) return json({ error: "not a party to this payout" }, 403);

    const { data: promoterProfile } = await admin
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", promoter.user_id)
      .maybeSingle();
    const promoterName =
      `${promoterProfile?.first_name ?? ""} ${promoterProfile?.last_name ?? ""}`.trim() || "Ton promoteur";

    const amount = Number(payout.amount ?? 0).toFixed(2);

    // Le STATUT en base décide, pas le client.
    let sent = 0;
    if (payout.status === "approved") {
      const res = await sendAutoPush(admin, {
        key: "promoter_payout_declared",
        userId: promoter.user_id,
        url: "/promoter",
        vars: { payer: payerName || "Le club", amount },
      });
      sent = res.sent;
    } else if (payout.status === "paid" && clubUserId) {
      const res = await sendAutoPush(admin, {
        key: "promoter_payout_confirmed",
        userId: clubUserId,
        url: "/owner/promoters/finance",
        vars: { promoter: promoterName, amount },
      });
      sent = res.sent;
    } else if (payout.status === "disputed" && clubUserId) {
      const res = await sendAutoPush(admin, {
        key: "promoter_payout_disputed",
        userId: clubUserId,
        url: "/owner/promoters/finance",
        vars: { promoter: promoterName, amount, reference: payout.transfer_reference ?? "—" },
      });
      sent = res.sent;
    }

    logStep("Notified", { payout_id, status: payout.status, sent });
    return json({ ok: true, status: payout.status, sent });
  } catch (e) {
    console.error("[PROMOTER-PAYOUT-NOTIFY] error", e);
    return json({ error: "internal error" }, 500);
  }
});
