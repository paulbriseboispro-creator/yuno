import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { wrapEmailWithBranding, t as emailT, type EmailLanguage } from "../_shared/email-branding.ts";
import { restrictedCorsHeaders } from "../_shared/cors.ts";

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[OWNER-REFUND] ${step}${detailsStr}`);
};

serve(async (req) => {
  const corsHeaders = restrictedCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) throw new Error("Not authenticated");

    logStep("User authenticated", { userId: user.id });

    // Super admin peut rembourser n'importe quelle transaction (support plateforme).
    // Les contrôles de propriété par item sont alors court-circuités.
    const { data: adminRole } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    const isAdmin = !!adminRole;
    if (isAdmin) logStep("Caller is super admin — ownership checks bypassed");

    const { items, reason } = await req.json();
    // items: Array<{ type: 'order' | 'ticket' | 'table_reservation', id: string, amount: number }>

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new Error("No items to refund");
    }
    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      throw new Error("Reason is required");
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const results: Array<{ id: string; type: string; success: boolean; error?: string; amount?: number }> = [];

    for (const item of items) {
      try {
        let record: any = null;
        let venueId: string = "";
        let customerEmail: string = "";
        let customerUserId: string = "";
        let maxRefundable: number = 0; // total - serviceFee
        let eventTitle: string = "";
        let venueName: string = "";
        const ownerAmount = Number(item.amount) || 0;

        if (item.type === "order") {
          const { data } = await supabaseAdmin
            .from("orders")
            .select("*, venues!inner(id, owner_id, name)")
            .eq("id", item.id)
            .single();
          record = data;
          if (!record) { results.push({ id: item.id, type: item.type, success: false, error: "Not found" }); continue; }
          
          if (!isAdmin && record.venues.owner_id !== user.id) {
            results.push({ id: item.id, type: item.type, success: false, error: "Unauthorized" }); continue;
          }
          venueId = record.venue_id;
          venueName = record.venues.name || "";
          customerEmail = record.user_email || "";
          customerUserId = record.user_id || "";
          const orderServiceFee = Number(record.service_fee) || 0;
          maxRefundable = Number(record.total) - orderServiceFee;

          if (record.event_id) {
            const { data: evt } = await supabaseAdmin.from("events").select("title").eq("id", record.event_id).single();
            eventTitle = evt?.title || "";
          }

        } else if (item.type === "ticket") {
          const { data } = await supabaseAdmin
            .from("tickets")
            .select("*, events!inner(id, title, venue_id, organizer_user_id, partner_organizer_id, venues:venue_id(id, owner_id, name))")
            .eq("id", item.id)
            .single();
          record = data;
          if (!record) { results.push({ id: item.id, type: item.type, success: false, error: "Not found" }); continue; }

          const isVenueOwner = record.events?.venues?.owner_id === user.id;
          const isOrganizer = record.events?.organizer_user_id === user.id || record.events?.partner_organizer_id === user.id;
          if (!isAdmin && !isVenueOwner && !isOrganizer) {
            results.push({ id: item.id, type: item.type, success: false, error: "Unauthorized" }); continue;
          }
          venueId = record.events.venue_id;
          venueName = record.events?.venues?.name || "";
          customerEmail = record.user_email || "";
          customerUserId = record.user_id || "";
          const ticketServiceFee = Number(record.service_fee) || 0;
          const ticketInsuranceFee = Number(record.insurance_fee) || 0;
          // Club-side cap: total paid minus ALL Yuno fees (service + insurance).
          // Yuno never refunds its own fees, so they must not inflate the cap.
          maxRefundable = Number(record.total_price) - ticketServiceFee - ticketInsuranceFee;
          eventTitle = record.events.title || "";

        } else if (item.type === "table_reservation") {
          const { data } = await supabaseAdmin
            .from("table_reservations")
            .select("*, events!inner(id, title, venue_id, organizer_user_id, partner_organizer_id, venues:venue_id(id, owner_id, name))")
            .eq("id", item.id)
            .single();
          record = data;
          if (!record) { results.push({ id: item.id, type: item.type, success: false, error: "Not found" }); continue; }

          const isVenueOwner = record.events?.venues?.owner_id === user.id;
          const isOrganizer = record.events?.organizer_user_id === user.id || record.events?.partner_organizer_id === user.id;
          if (!isAdmin && !isVenueOwner && !isOrganizer) {
            results.push({ id: item.id, type: item.type, success: false, error: "Unauthorized" }); continue;
          }
          venueId = record.events.venue_id;
          venueName = record.events?.venues?.name || "";
          customerEmail = record.user_email || "";
          customerUserId = record.user_id || "";
          maxRefundable = Number(record.total_price) - Number(record.service_fee || 0) - Number(record.management_fee || 0);
          eventTitle = record.events.title || "";
        } else {
          results.push({ id: item.id, type: item.type, success: false, error: "Invalid type" }); continue;
        }

        if (record.status === "refunded") {
          results.push({ id: item.id, type: item.type, success: false, error: "Already refunded" }); continue;
        }

        // Validate owner-specified amount
        const refundAmount = Math.min(ownerAmount, maxRefundable);
        if (refundAmount <= 0) {
          results.push({ id: item.id, type: item.type, success: false, error: "Invalid refund amount" }); continue;
        }

        logStep("Refund amount validated", { ownerAmount, maxRefundable, refundAmount });

        let paymentIntentId = record.stripe_payment_intent_id;

        // If no payment_intent_id stored, try to retrieve it from the Stripe session
        if (!paymentIntentId && record.stripe_session_id) {
          try {
            logStep("No payment_intent_id, fetching from Stripe session", { sessionId: record.stripe_session_id });
            const session = await stripe.checkout.sessions.retrieve(record.stripe_session_id);
            paymentIntentId = typeof session.payment_intent === 'string' 
              ? session.payment_intent 
              : session.payment_intent?.id || null;
            
            if (paymentIntentId) {
              // Save it for future reference
              const table = item.type === "order" ? "orders" : item.type === "ticket" ? "tickets" : "table_reservations";
              await supabaseAdmin.from(table).update({ stripe_payment_intent_id: paymentIntentId }).eq("id", item.id);
              logStep("Retrieved and saved payment_intent_id", { paymentIntentId });
            }
          } catch (sessionError: any) {
            logStep("Error retrieving Stripe session", { error: sessionError.message });
          }
        }

        if (!paymentIntentId) {
          logStep("No payment_intent_id found, cannot process Stripe refund", { id: item.id });
          results.push({ id: item.id, type: item.type, success: false, error: "No Stripe payment found for this item" }); continue;
        }

        try {
          const refundAmountCents = Math.round(refundAmount * 100);
          // DIRECT charge → refund on the connected account (no transfer to reverse).
          // SEPARATE/platform charge → refund on the platform and reverse the transfers.
          const connectedAccount = (record.stripe_connected_account_id as string | null) || null;
          await stripe.refunds.create({
            payment_intent: paymentIntentId,
            amount: refundAmountCents,
            ...(connectedAccount ? {} : { reverse_transfer: true }),
            refund_application_fee: false,
          }, connectedAccount ? { stripeAccount: connectedAccount } : undefined);
          logStep("Stripe refund created", { paymentIntentId, refundAmount, refundAmountCents, direct: !!connectedAccount });
        } catch (stripeError: any) {
          logStep("Stripe refund error", { error: stripeError.message });
          results.push({ id: item.id, type: item.type, success: false, error: `Stripe: ${stripeError.message}` }); continue;
        }

        // Update status in DB
        const table = item.type === "order" ? "orders" : item.type === "ticket" ? "tickets" : "table_reservations";
        const updateData: any = {
          status: "refunded",
          refund_reason: reason.trim(),
          refund_amount: refundAmount,
          refunded_by: user.id,
          refunded_at: new Date().toISOString(),
        };

        if (item.type === "order") {
          updateData.archived = true;
          updateData.token_used = true;
        }

        const { error: updateError } = await supabaseAdmin.from(table).update(updateData).eq("id", item.id);
        if (updateError) {
          logStep("DB update failed after Stripe refund — inconsistency!", { id: item.id, error: updateError.message });
          results.push({ id: item.id, type: item.type, success: false, error: `Stripe refund succeeded but DB update failed: ${updateError.message}` });
          continue;
        }

        // Delete drink credits linked to refunded ticket
        if (item.type === "ticket") {
          try {
            await supabaseAdmin.from("order_pack_credits").delete().eq("ticket_order_id", item.id);
            await supabaseAdmin.from("ticket_upsell_selections").update({ status: "cancelled" }).eq("ticket_id", item.id);
          } catch (e) { console.error("Error deleting drink credits:", e); }
        }

        // Decrement venue customer stats
        if (venueId && customerUserId) {
          try {
            const deltas: any = { p_venue_id: venueId, p_user_id: customerUserId, p_order_delta: 0, p_ticket_delta: 0, p_table_delta: 0, p_spent_delta: -refundAmount };
            if (item.type === "order") deltas.p_order_delta = -1;
            if (item.type === "ticket") deltas.p_ticket_delta = -1;
            if (item.type === "table_reservation") deltas.p_table_delta = -1;
            await supabaseAdmin.rpc("increment_venue_customer_stats", deltas);
          } catch (e) { console.error("Stats rollback error:", e); }
        }

        // Re-credit loyalty points
        if (venueId && customerUserId) {
          try {
            const { data: txns } = await supabaseAdmin
              .from("loyalty_transactions")
              .select("id, points, customer_loyalty_id")
              .eq("reference_id", item.id)
              .eq("transaction_type", "earn");
            
            for (const txn of txns || []) {
              const { data: cl } = await supabaseAdmin
                .from("customer_loyalty")
                .select("current_balance, total_points_earned")
                .eq("id", txn.customer_loyalty_id)
                .single();
              
              if (cl) {
                await supabaseAdmin
                  .from("customer_loyalty")
                  .update({
                    current_balance: Math.max(0, cl.current_balance - txn.points),
                    total_points_earned: Math.max(0, cl.total_points_earned - txn.points),
                  })
                  .eq("id", txn.customer_loyalty_id);
              }

              await supabaseAdmin.from("loyalty_transactions").insert({
                customer_loyalty_id: txn.customer_loyalty_id,
                venue_id: venueId,
                transaction_type: "adjustment",
                points: -txn.points,
                description: "Points removed (owner refund)",
                reference_type: "refund",
                reference_id: item.id,
              });
            }
          } catch (e) { console.error("Loyalty rollback error:", e); }
        }

        // Send refund email with accurate amount and context
        if (customerEmail) {
          try {
            // Get user language preference
            let lang: EmailLanguage = "fr";
            if (customerUserId) {
              const { data: profile } = await supabaseAdmin
                .from("profiles")
                .select("preferred_language")
                .eq("id", customerUserId)
                .single();
              if (profile?.preferred_language && ["en", "es", "fr"].includes(profile.preferred_language)) {
                lang = profile.preferred_language as EmailLanguage;
              }
            }

            const itemTypeLabels: Record<string, string> = {
              order: emailT('refund.typeOrder', lang),
              ticket: emailT('refund.typeTicket', lang),
              table_reservation: emailT('refund.typeTable', lang),
            };

            const emailContent = `
              <div style="padding: 32px 24px;">
                <h1 style="color: #fff; font-size: 22px; margin: 0 0 16px;">
                  ${emailT('refund.title', lang)}
                </h1>
                <p style="color: #ccc; font-size: 14px; line-height: 1.6; margin: 0 0 20px;">
                  ${emailT('refund.body', lang, { venueName })}
                </p>
                
                <table width="100%" cellpadding="0" cellspacing="0" style="background: rgba(255,255,255,0.05); border-radius: 12px; margin-bottom: 20px;">
                  <tr>
                    <td style="padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                      <p style="color: #888; font-size: 12px; margin: 0;">${emailT('refund.amount', lang)}</p>
                      <p style="color: #22c55e; font-size: 24px; font-weight: 700; margin: 4px 0 0;">${refundAmount.toFixed(2)} €</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                      <p style="color: #888; font-size: 12px; margin: 0;">${emailT('refund.itemType', lang)}</p>
                      <p style="color: #fff; font-size: 14px; margin: 4px 0 0;">${itemTypeLabels[item.type] || item.type}</p>
                    </td>
                  </tr>
                  ${eventTitle ? `<tr>
                    <td style="padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                      <p style="color: #888; font-size: 12px; margin: 0;">${emailT('refund.event', lang)}</p>
                      <p style="color: #fff; font-size: 14px; margin: 4px 0 0;">${eventTitle}</p>
                    </td>
                  </tr>` : ""}
                  <tr>
                    <td style="padding: 12px 16px;">
                      <p style="color: #888; font-size: 12px; margin: 0;">${emailT('refund.reason', lang)}</p>
                      <p style="color: #fff; font-size: 14px; margin: 4px 0 0;">${reason.trim()}</p>
                    </td>
                  </tr>
                </table>
                
                <p style="color: #888; font-size: 12px; line-height: 1.6;">
                  ${emailT('refund.delay', lang)}
                </p>
              </div>
            `;

            const html = wrapEmailWithBranding(emailContent, lang, venueName);

            const resendApiKey = Deno.env.get("RESEND_API_KEY");
            const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "noreply@yunoapp.eu";

            if (resendApiKey) {
              const subject = emailT('refund.subject', lang, { amount: refundAmount.toFixed(2) }) + ` - ${eventTitle || venueName}`;
              await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${resendApiKey}`,
                },
                body: JSON.stringify({
                  from: `Yuno <${fromEmail}>`,
                  to: [customerEmail],
                  subject,
                  html,
                }),
              });
              logStep("Refund email sent", { to: customerEmail, refundAmount, lang });
            }
          } catch (emailError) {
            console.error("Email error:", emailError);
          }
        }

        // Send push notification
        if (customerUserId) {
          try {
            await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push-notification`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
              body: JSON.stringify({
                user_id: customerUserId,
                payload: {
                  title: 'Remboursement traité 💸',
                  body: `${refundAmount.toFixed(2)}€ remboursés sur ton moyen de paiement.`,
                  url: '/my-orders'
                }
              })
            });
          } catch (pushError) {
            console.error('Push notification error:', pushError);
          }
        }

        results.push({ id: item.id, type: item.type, success: true, amount: refundAmount });
        logStep("Item refunded", { id: item.id, type: item.type, amount: refundAmount });

        // Journal d'audit admin (remboursement déclenché par un super admin)
        if (isAdmin) {
          try {
            await supabaseAdmin.from("admin_audit_log").insert({
              admin_id: user.id,
              action: "refund_issued",
              entity_type: item.type,
              entity_id: item.id,
              metadata: { amount: refundAmount, reason: reason.trim(), venue_id: venueId },
            });
          } catch (auditErr) {
            console.error("Admin audit log error (refund):", auditErr);
          }
        }

        // Owner notification: refund processed
        if (venueId) {
          try {
            const typeLabels: Record<string, string> = { order: 'commande', ticket: 'billet', table_reservation: 'table VIP' };
            await supabaseAdmin.from('staff_notifications').insert({
              venue_id: venueId,
              target_role: 'owner',
              notification_type: 'refund_issued',
              title: 'Remboursement effectué',
              message: `${typeLabels[item.type] ?? item.type} — ${refundAmount.toFixed(2)} € remboursés`,
              priority: 'high',
              reference_type: item.type,
              reference_id: item.id,
              metadata: { type: item.type, amount: refundAmount, reason: reason ?? null },
            });
          } catch (notifErr) {
            console.error('Owner notif error (refund_issued):', notifErr);
          }
        }

      } catch (itemError: any) {
        results.push({ id: item.id, type: item.type, success: false, error: itemError.message });
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    console.error("[OWNER-REFUND] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }
});
