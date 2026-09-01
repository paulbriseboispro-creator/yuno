// Achat de crédits email — checkout Stripe + vérification, en UNE fonction
// (action: 'checkout' | 'verify') pour n'occuper qu'un seul slot edge.
//
// Décision produit (2026-09-01) : les crédits sont vendus À PRIX COÛTANT —
// overage Resend 0,90 $/1 000 + frais Stripe du checkout, aucun revenu pour
// Yuno. Le prix vit dans `email_packs`, jamais ici.
//
// Miroir du patron crédits SMS (sms-purchase-checkout / sms-purchase-verify) :
// même kill-switch paiements, même bypass démo (@womber.fr → crédit gratuit
// sans Stripe), même idempotence portée par la base (add_email_credits +
// index unique sur la session Stripe : un verify rejoué ne crédite pas deux
// fois).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { resolvePaymentMode, PAYMENTS_DISABLED_CODE } from "../_shared/payment-guard.ts";
import { resolveReturnOrigin } from "../_shared/cors.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface Body {
  action: "checkout" | "verify";
  // checkout
  pack_id?: string;
  scope?: "venue" | "organizer";
  venue_id?: string | null;
  return_path?: string;
  // verify
  session_id?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

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

    const body: Body = await req.json();

    // ── VERIFY : retour de Stripe ─────────────────────────────────────────────
    if (body.action === "verify") {
      if (!body.session_id) throw new Error("Missing session_id");

      const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-08-27.basil" });
      const session = await stripe.checkout.sessions.retrieve(body.session_id);
      if (!session) throw new Error("Session not found");
      if (session.payment_status !== "paid") {
        return json({ status: session.payment_status, credited: false });
      }

      const meta = session.metadata ?? {};
      if (meta.kind !== "email_pack_purchase") throw new Error("Invalid session kind");
      if (meta.user_id !== user.id) throw new Error("Session does not belong to user");

      const credits = Number(meta.credits || 0);
      const scope = meta.scope as "venue" | "organizer";
      const venueId = meta.venue_id ? (meta.venue_id as string) : null;
      if (!credits || !meta.pack_id) throw new Error("Invalid session metadata");

      const scopeKey = scope === "venue" ? `venue:${venueId}` : `org:${user.id}`;
      // add_email_credits est idempotent sur la session : rejouer ce verify
      // renvoie le solde sans re-créditer.
      const { data: balance, error: addErr } = await admin.rpc("add_email_credits", {
        p_scope_key: scopeKey,
        p_venue_id: scope === "venue" ? venueId : null,
        p_organizer_user_id: scope === "organizer" ? user.id : null,
        p_amount: credits,
        p_type: "purchase",
        p_pack_id: meta.pack_id,
        p_stripe_session_id: session.id,
        p_stripe_payment_intent_id:
          typeof session.payment_intent === "string" ? session.payment_intent : null,
        p_notes: `Pack ${meta.pack_id} via Stripe (${(session.amount_total ?? 0) / 100} €)`,
        p_created_by: user.id,
      });
      if (addErr) throw addErr;

      return json({ status: "paid", credits_added: credits, balance: balance ?? 0 });
    }

    // ── CHECKOUT ──────────────────────────────────────────────────────────────
    if (body.action !== "checkout") throw new Error("Invalid action");
    if (!body.pack_id || !body.scope) throw new Error("Missing pack_id or scope");
    if (body.scope === "venue" && !body.venue_id) throw new Error("venue_id required");

    const { data: pack, error: packErr } = await admin
      .from("email_packs")
      .select("*")
      .eq("id", body.pack_id)
      .eq("is_active", true)
      .maybeSingle();
    if (packErr || !pack) throw new Error("Pack not found");

    // Autorisation du périmètre.
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

    const scopeKey = body.scope === "venue" ? `venue:${body.venue_id}` : `org:${user.id}`;

    // Kill-switch paiements + bypass démo (même patron que les crédits SMS).
    const paymentMode = (await resolvePaymentMode(admin, user.email)).mode;
    if (paymentMode === "blocked") {
      return json({
        success: false,
        error: "Payments are temporarily unavailable. Please try again later.",
        code: PAYMENTS_DISABLED_CODE,
      });
    }
    if (paymentMode === "simulate") {
      const { data: balance, error: addErr } = await admin.rpc("add_email_credits", {
        p_scope_key: scopeKey,
        p_venue_id: body.scope === "venue" ? body.venue_id : null,
        p_organizer_user_id: body.scope === "organizer" ? user.id : null,
        p_amount: pack.emails_amount,
        p_type: "demo",
        p_pack_id: pack.id,
        p_stripe_session_id: null,
        p_stripe_payment_intent_id: null,
        p_notes: "Demo purchase (womber.fr bypass — no charge)",
        p_created_by: user.id,
      });
      if (addErr) throw addErr;
      return json({ success: true, demo: true, credits_added: pack.emails_amount, balance: balance ?? 0 });
    }

    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-08-27.basil" });

    let customerId: string | undefined;
    if (user.email) {
      const customers = await stripe.customers.list({ email: user.email, limit: 1 });
      if (customers.data.length > 0) customerId = customers.data[0].id;
    }

    // Retour : la page d'où le pro est parti (Studio ou liste des campagnes).
    // Chemin RELATIF strictement validé — l'origine reste verrouillée sur la
    // liste blanche CORS, jamais dérivée du body.
    const { origin } = resolveReturnOrigin(req);
    const fallbackPath = body.scope === "venue" ? "/owner/campaigns" : "/organizer-app/campaigns";
    const rawPath = typeof body.return_path === "string" ? body.return_path : "";
    const returnPath = /^\/[A-Za-z0-9/_-]*$/.test(rawPath) ? rawPath : fallbackPath;
    const sep = returnPath.includes("?") ? "&" : "?";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: `Pack emails ${pack.name}`,
              description: `${pack.emails_amount} emails supplémentaires pour vos campagnes Yuno`,
            },
            unit_amount: Math.round(Number(pack.price_eur) * 100),
          },
          quantity: 1,
        },
      ],
      metadata: {
        kind: "email_pack_purchase",
        pack_id: pack.id,
        credits: String(pack.emails_amount),
        user_id: user.id,
        scope: body.scope,
        venue_id: body.venue_id ?? "",
      },
      success_url: `${origin}${returnPath}${sep}emailCredits=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}${returnPath}${sep}emailCredits=cancelled`,
    });

    return json({ url: session.url });
  } catch (e) {
    console.error("[email-credits]", e);
    return json({ error: (e as Error).message }, 400);
  }
});
