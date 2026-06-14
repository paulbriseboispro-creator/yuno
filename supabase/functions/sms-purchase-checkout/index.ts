import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface CheckoutBody {
  pack_id: string;
  scope: "venue" | "organizer";
  venue_id?: string | null;
}

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

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) throw new Error("Not authenticated");
    const user = userData.user;

    const body: CheckoutBody = await req.json();
    if (!body.pack_id || !body.scope) throw new Error("Missing pack_id or scope");
    if (body.scope === "venue" && !body.venue_id) throw new Error("venue_id required");

    // Load pack
    const { data: pack, error: packErr } = await admin
      .from("sms_packs")
      .select("*")
      .eq("id", body.pack_id)
      .eq("is_active", true)
      .maybeSingle();
    if (packErr || !pack) throw new Error("Pack not found");

    // Authorize scope
    if (body.scope === "venue") {
      const { data: venue } = await admin
        .from("venues")
        .select("id, owner_id")
        .eq("id", body.venue_id!)
        .maybeSingle();
      if (!venue) throw new Error("Venue not found");
      if (venue.owner_id !== user.id) {
        const { data: isAdmin } = await admin.rpc("has_role", {
          _user_id: user.id,
          _role: "admin",
        });
        if (!isAdmin) throw new Error("Not authorized for this venue");
      }
    }

    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-08-27.basil" });

    // Find / create Stripe customer
    let customerId: string | undefined;
    if (user.email) {
      const customers = await stripe.customers.list({ email: user.email, limit: 1 });
      if (customers.data.length > 0) customerId = customers.data[0].id;
    }

    const origin = req.headers.get("origin") || "https://yunoapp.eu";
    const unitAmount = Math.round(Number(pack.price_eur) * 100);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: `Pack SMS ${pack.name}`,
              description: `${pack.credits_amount} crédits SMS Yuno`,
            },
            unit_amount: unitAmount,
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        // Stripe fees are paid by the club: do NOT use application_fee here.
        // The 0.05€ margin is already baked into price_eur.
      },
      metadata: {
        kind: "sms_pack_purchase",
        pack_id: pack.id,
        credits: String(pack.credits_amount),
        user_id: user.id,
        scope: body.scope,
        venue_id: body.venue_id ?? "",
      },
      success_url: `${origin}/owner/sms?purchase=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/owner/sms?purchase=cancelled`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[sms-purchase-checkout]", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
