// Rappel « charge la liste » au staff de porte, avant les portes.
//
// Aucun serveur ne peut écrire dans le cache hors ligne d'un téléphone : seule
// l'app peut aller chercher la liste. Ce cron est donc le seul levier qu'on ait
// pour que ça arrive AVANT le sous-sol sans réseau — il pousse une
// notification aux gens qui tiendront la porte ce soir, et l'ouverture de Yuno
// Pro fait le reste (le manifeste se télécharge dès le premier écran).
//
// Fenêtre : les soirées qui ouvrent dans 2 à 5 h. Assez tôt pour être encore
// dans le métro avec du réseau, assez tard pour que la liste soit à jour (les
// inscriptions de dernière minute entrent quand même par le rafraîchissement
// toutes les 5 min de l'écran videur, et par le bouton « Recharger »).
//
// Une notification par personne et par soirée, jamais deux : le cron passe
// toutes les heures et la fenêtre fait 3 h.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { authorizeCronRequest } from "../_shared/cron-auth.ts";
import { sendAutoPush } from "../_shared/auto-push.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Marqueur d'envoi : une ligne par (personne, soirée). Même table que les autres rappels. */
const LOG_TYPE = "door_preload";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await authorizeCronRequest(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.message }), {
      status: auth.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    const now = Date.now();
    const { data: events } = await admin
      .from("events")
      .select("id, title, start_at")
      .eq("is_active", true)
      .gte("start_at", new Date(now + 2 * 3600 * 1000).toISOString())
      .lte("start_at", new Date(now + 5 * 3600 * 1000).toISOString());

    if (!events || events.length === 0) {
      return new Response(JSON.stringify({ success: true, events: 0, sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sent = 0;
    for (const event of events) {
      const { data: staff, error } = await admin.rpc("event_door_staff_ids", { p_event_id: event.id });
      if (error) {
        console.error("[DOOR-PRELOAD] door staff lookup failed", event.id, error.message);
        continue;
      }

      for (const row of (staff ?? []) as { user_id: string }[]) {
        const userId = row.user_id;
        if (!userId) continue;

        const { data: already } = await admin
          .from("notification_log")
          .select("id")
          .eq("user_id", userId)
          .eq("notification_type", LOG_TYPE)
          .eq("title", event.id)
          .limit(1);
        if (already && already.length > 0) continue;

        // Le marqueur est posé AVANT l'envoi : deux exécutions qui se
        // chevauchent ne doivent pas produire deux notifications. Un push perdu
        // vaut mieux qu'un réveil en double à quelqu'un qui bosse ce soir.
        await admin.from("notification_log").insert({
          user_id: userId, notification_type: LOG_TYPE, title: event.id,
        });

        const res = await sendAutoPush(admin, {
          key: "door_manifest_preload",
          userId,
          url: "/bouncer",
          vars: { event: event.title },
        });
        sent += res.sent;
      }
    }

    return new Response(JSON.stringify({ success: true, events: events.length, sent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[DOOR-PRELOAD] failed", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
