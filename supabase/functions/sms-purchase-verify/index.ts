// Verifies a Stripe Checkout session for an SMS pack and credits the balance.
// Idempotent via sms_credit_transactions.stripe_session_id unique constraint
// (or duplicate detection).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing Authorization header");

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: userData } = await userClient.auth.getUser();
    if (!userData.user) throw new Error("Not authenticated");
    const user = userData.user;

    const { session_id } = await req.json();
    if (!session_id) throw new Error("Missing session_id");

    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-08-27.basil" });
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (!session) throw new Error("Session not found");
    if (session.payment_status !== "paid") {
      return new Response(
        JSON.stringify({ status: session.payment_status, credited: false }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const meta = session.metadata ?? {};
    if (meta.kind !== "sms_pack_purchase") throw new Error("Invalid session kind");
    if (meta.user_id !== user.id) throw new Error("Session does not belong to user");

    const credits = Number(meta.credits || 0);
    const packId = meta.pack_id as string;
    const scope = meta.scope as "venue" | "organizer";
    const venueId = meta.venue_id ? (meta.venue_id as string) : null;
    if (!credits || !packId) throw new Error("Invalid session metadata");

    // Idempotency: if a transaction already exists for this session, just return current balance.
    const { data: existing } = await admin
      .from("sms_credit_transactions")
      .select("id")
      .eq("stripe_session_id", session.id)
      .maybeSingle();

    if (!existing) {
      // Get or create balance row
      const { data: balanceId, error: balErr } = await admin.rpc(
        "get_or_create_sms_balance",
        {
          p_venue_id: scope === "venue" ? venueId : null,
          p_organizer_id: scope === "organizer" ? user.id : null,
        },
      );
      if (balErr || !balanceId) throw balErr ?? new Error("Balance unavailable");

      const { error: rpcErr } = await admin.rpc("add_sms_credits", {
        p_balance_id: balanceId,
        p_amount: credits,
        p_type: "purchase",
        p_pack_id: packId,
        p_stripe_session_id: session.id,
        p_stripe_payment_intent_id:
          typeof session.payment_intent === "string" ? session.payment_intent : null,
        p_notes: `Pack purchase via Stripe (${(session.amount_total ?? 0) / 100} €)`,
        p_created_by: user.id,
      });
      if (rpcErr) throw rpcErr;
    }

    // Return new balance
    const finalQuery = admin.from("sms_credit_balances").select("balance");
    if (scope === "venue") {
      finalQuery.eq("venue_id", venueId).is("organizer_id", null);
    } else {
      finalQuery.eq("organizer_id", user.id).is("venue_id", null);
    }
    const { data: finalBal } = await finalQuery.maybeSingle();

    return new Response(
      JSON.stringify({
        status: "paid",
        credited: !existing,
        credits_added: credits,
        balance: finalBal?.balance ?? 0,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[sms-purchase-verify]", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
