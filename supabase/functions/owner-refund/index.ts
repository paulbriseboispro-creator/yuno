import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { restrictedCorsHeaders } from "../_shared/cors.ts";
import { isSupportSessionToken } from "../_shared/support-session.ts";
import { demoPreviewGuard } from "../_shared/demo-guard.ts";
import {
  alreadyRefundedCents, fromCents, isSaleKind, planRefund, refundAllowed, refundCapCents,
  SALE_TABLE, toCents, type SaleAmounts,
} from "../_shared/sale-refund.ts";
import {
  applyFullRefundEffects, applyRefundAmountEffects, markSaleFullyRefunded, refundSaleOnStripe,
  type SaleRefundContext,
} from "../_shared/sale-refund-effects.ts";

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[OWNER-REFUND] ${step}${detailsStr}`);
};

interface RefundRequestItem { type: string; id: string; amount: number }

interface ItemResult { id: string; type: string; success: boolean; error?: string; amount?: number }

interface EventJoin {
  id: string;
  title: string | null;
  venue_id: string | null;
  partner_venue_id: string | null;
  organizer_user_id: string | null;
  partner_organizer_id: string | null;
  venues: { id: string; owner_id: string | null; name: string | null } | null;
}

/** Colonnes de la vente lues ici (`select *`) : plafond, paiement Stripe, client, état à rétablir. */
interface SaleRecord extends SaleAmounts {
  id: string;
  status: string | null;
  user_id: string | null;
  user_email: string | null;
  venue_id?: string | null;
  event_id?: string | null;
  stripe_payment_intent_id: string | null;
  stripe_session_id: string | null;
  stripe_connected_account_id: string | null;
  refund_reason: string | null;
  refunded_by: string | null;
  refunded_at: string | null;
  venues?: { id: string; owner_id: string | null; name: string | null } | null;
  events?: EventJoin | null;
}

serve(async (req) => {
  const corsHeaders = restrictedCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  // Lien démo : lecture seule garantie côté serveur (_shared/demo-guard.ts).
  const demoRefusal = await demoPreviewGuard(req, corsHeaders);
  if (demoRefusal) return demoRefusal;

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

    // Accès assisté Yuno : un remboursement sort de l'argent du compte Stripe du
    // club. Cette fonction écrit en service_role, donc les triggers de garde de
    // la base ne la voient jamais — le refus doit être posé ici.
    if (await isSupportSessionToken(supabaseAdmin, (req.headers.get("Authorization") ?? "").replace("Bearer ", ""))) {
      return new Response(JSON.stringify({ error: "support_session_forbidden" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 403,
      });
    }

    logStep("User authenticated", { userId: user.id });

    // Super admin peut rembourser n'importe quelle transaction (support plateforme).
    const { data: adminRole } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    const isAdmin = !!adminRole;
    if (isAdmin) logStep("Caller is super admin — ownership checks bypassed");

    const { items, reason } = await req.json() as { items?: RefundRequestItem[]; reason?: string };

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new Error("No items to refund");
    }
    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      throw new Error("Reason is required");
    }
    const cleanReason = reason.trim();

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    // ── Qui peut rembourser ────────────────────────────────────────────────
    // Les droits suivent EXACTEMENT ce que la Console propose (`refundAllowed`) :
    // le propriétaire du club, un manager à qui il a donné « Remboursements »
    // (`manager_permissions.can_manage_refunds`, ce que lit /manager/refunds),
    // l'organisateur de la soirée et un membre de son équipe autorisé à
    // rembourser (`org_member_has_permission(…, 'refund')`, la même règle que
    // `get_my_org_memberships` rend au front). Avant, seuls le propriétaire et
    // l'organisateur passaient : un manager ou un admin d'équipe voyaient la page
    // et recevaient « Unauthorized » à chaque remboursement.
    const managerCache = new Map<string, boolean>();
    const managesRefunds = async (venueId: string | null | undefined): Promise<boolean> => {
      if (!venueId) return false;
      if (!managerCache.has(venueId)) {
        const { data } = await supabaseAdmin.from("manager_permissions")
          .select("can_manage_refunds").eq("user_id", user.id).eq("venue_id", venueId).maybeSingle();
        managerCache.set(venueId, data?.can_manage_refunds === true);
      }
      return managerCache.get(venueId)!;
    };
    const orgCache = new Map<string, boolean>();
    const orgMemberCanRefund = async (organizerIds: (string | null | undefined)[]): Promise<boolean> => {
      for (const orgId of organizerIds) {
        if (!orgId) continue;
        if (!orgCache.has(orgId)) {
          const { data } = await supabaseAdmin.rpc("org_member_has_permission", {
            _user_id: user.id, _organizer_user_id: orgId, _permission: "refund",
          });
          orgCache.set(orgId, data === true);
        }
        if (orgCache.get(orgId)) return true;
      }
      return false;
    };

    // Co-soirée menée par un organisateur : events.venue_id est NULL et le club
    // hôte vit dans partner_venue_id. Club EFFECTIF de la soirée.
    const resolveEventVenue = async (ev: EventJoin | null | undefined): Promise<{ id: string; owner_id: string | null; name: string } | null> => {
      if (ev?.venues) return { id: ev.venues.id, owner_id: ev.venues.owner_id, name: ev.venues.name || "" };
      if (ev?.partner_venue_id) {
        const { data: pv } = await supabaseAdmin
          .from("venues").select("id, owner_id, name").eq("id", ev.partner_venue_id).maybeSingle();
        if (pv) return { id: pv.id, owner_id: pv.owner_id, name: pv.name || "" };
      }
      return null;
    };

    const results: ItemResult[] = [];

    for (const item of items) {
      const kind = item?.type;
      if (!isSaleKind(kind)) {
        results.push({ id: item?.id, type: String(kind), success: false, error: "Invalid type" });
        continue;
      }
      try {
        const table = SALE_TABLE[kind];
        let record: SaleRecord | null = null;
        let ctx: SaleRefundContext;
        let allowed = false;

        if (kind === "order") {
          const { data } = await supabaseAdmin
            .from("orders").select("*, venues!inner(id, owner_id, name)").eq("id", item.id).maybeSingle();
          record = data as unknown as SaleRecord | null;
          if (!record) { results.push({ id: item.id, type: kind, success: false, error: "Not found" }); continue; }
          const base = { isAdmin, ownsVenue: !!record.venues?.owner_id && record.venues.owner_id === user.id, isOrganizer: false, orgMemberCanRefund: false };
          allowed = refundAllowed(kind, { ...base, managesRefunds: false })
            || refundAllowed(kind, { ...base, managesRefunds: await managesRefunds(record.venue_id) });
          let eventTitle = "";
          if (record.event_id) {
            const { data: evt } = await supabaseAdmin.from("events").select("title").eq("id", record.event_id).maybeSingle();
            eventTitle = evt?.title || "";
          }
          ctx = {
            kind, id: record.id, venueId: record.venue_id || "", venueName: record.venues?.name || "",
            eventTitle, customerEmail: record.user_email || "", customerUserId: record.user_id || "",
          };
        } else {
          const { data } = await supabaseAdmin
            .from(table)
            .select("*, events!inner(id, title, venue_id, partner_venue_id, organizer_user_id, partner_organizer_id, venues:venue_id(id, owner_id, name))")
            .eq("id", item.id)
            .maybeSingle();
          record = data as unknown as SaleRecord | null;
          if (!record) { results.push({ id: item.id, type: kind, success: false, error: "Not found" }); continue; }
          const ev = record.events ?? null;
          const eventVenue = await resolveEventVenue(ev);
          const organizers = [ev?.organizer_user_id, ev?.partner_organizer_id];
          const base = {
            isAdmin,
            ownsVenue: !!eventVenue?.owner_id && eventVenue.owner_id === user.id,
            isOrganizer: organizers.some((o) => !!o && o === user.id),
          };
          // Les droits délégués (manager, équipe) ne sont lus que s'il le faut.
          allowed = refundAllowed(kind, { ...base, managesRefunds: false, orgMemberCanRefund: false })
            || refundAllowed(kind, {
              ...base,
              managesRefunds: await managesRefunds(eventVenue?.id),
              orgMemberCanRefund: await orgMemberCanRefund(organizers),
            });
          ctx = {
            kind, id: record.id, venueId: eventVenue?.id || "", venueName: eventVenue?.name || "",
            eventTitle: ev?.title || "", customerEmail: record.user_email || "", customerUserId: record.user_id || "",
          };
        }

        if (!allowed) {
          results.push({ id: item.id, type: kind, success: false, error: "Unauthorized" });
          continue;
        }
        if (record.status === "refunded") {
          results.push({ id: item.id, type: kind, success: false, error: "Already refunded" });
          continue;
        }

        // Remboursements PARTIELS cumulables, plafonnés côté club (frais Yuno
        // jamais rendus) : `planRefund` ramène la demande à ce qui reste, et seul
        // le remboursement qui atteint le plafond passe la vente « remboursée ».
        const capCents = refundCapCents(kind, record);
        const prevCents = alreadyRefundedCents(record);
        const plan = planRefund(capCents, prevCents, toCents(item.amount));
        if (!plan) {
          results.push({
            id: item.id, type: kind, success: false,
            error: prevCents >= capCents ? "Nothing left to refund" : "Invalid refund amount",
          });
          continue;
        }
        logStep("Refund planned", { id: item.id, kind, capCents, prevCents, plan });

        let paymentIntentId: string | null = record.stripe_payment_intent_id || null;
        if (!paymentIntentId && record.stripe_session_id) {
          try {
            const session = await stripe.checkout.sessions.retrieve(
              record.stripe_session_id,
              undefined,
              record.stripe_connected_account_id ? { stripeAccount: record.stripe_connected_account_id } : undefined,
            );
            paymentIntentId = typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent?.id || null;
            if (paymentIntentId) {
              await supabaseAdmin.from(table).update({ stripe_payment_intent_id: paymentIntentId }).eq("id", item.id);
              logStep("Retrieved and saved payment_intent_id", { paymentIntentId });
            }
          } catch (sessionError) {
            logStep("Error retrieving Stripe session", { error: (sessionError as Error).message });
          }
        }
        if (!paymentIntentId) {
          results.push({ id: item.id, type: kind, success: false, error: "No Stripe payment found for this item" });
          continue;
        }

        // Verrou AVANT Stripe : le cumul passe de l'ancien au nouveau montant
        // seulement si personne ne l'a bougé depuis la lecture. Deux
        // remboursements simultanés de la même vente (deux onglets, un manager et
        // le propriétaire) ne peuvent donc plus dépasser le plafond : le second
        // s'arrête ici, avant d'avoir touché à l'argent. Le webhook
        // `charge.refunded` que ce remboursement va provoquer trouvera le cumul
        // déjà posé et ne le rejouera pas.
        const prevRaw = record.refund_amount as number | string | null;
        let claim = supabaseAdmin.from(table)
          .update({
            refund_amount: fromCents(plan.cumulativeCents),
            refund_reason: cleanReason,
            refunded_by: user.id,
            refunded_at: new Date().toISOString(),
          })
          .eq("id", item.id)
          .neq("status", "refunded");
        claim = prevRaw === null || prevRaw === undefined ? claim.is("refund_amount", null) : claim.eq("refund_amount", prevRaw);
        const { data: claimed, error: claimError } = await claim.select("id");
        if (claimError) throw claimError;
        if (!claimed || claimed.length === 0) {
          results.push({ id: item.id, type: kind, success: false, error: "This sale was just refunded from another screen — reload" });
          continue;
        }

        const connectedAccountId = (record.stripe_connected_account_id as string | null) || null;
        const refund = await refundSaleOnStripe(stripe, supabaseAdmin, {
          paymentIntentId,
          amountCents: plan.amountCents,
          connectedAccountId,
          idempotencyKey: `owner-refund:${kind}:${item.id}:${prevCents}:${plan.cumulativeCents}`,
          expectedCumulativeCents: plan.cumulativeCents,
        });
        if (!refund.ok) {
          // Rien n'est parti : le verrou est défait, la vente redevient remboursable.
          await supabaseAdmin.from(table)
            .update({
              refund_amount: prevRaw ?? null,
              refund_reason: record.refund_reason ?? null,
              refunded_by: record.refunded_by ?? null,
              refunded_at: record.refunded_at ?? null,
            })
            .eq("id", item.id)
            .eq("refund_amount", fromCents(plan.cumulativeCents));
          logStep("Stripe refund error — claim released", { error: refund.error });
          results.push({ id: item.id, type: kind, success: false, error: `Stripe: ${refund.error}` });
          continue;
        }
        logStep("Stripe refund done", { paymentIntentId, amountCents: plan.amountCents, direct: !!connectedAccountId });

        await applyRefundAmountEffects(supabaseAdmin, ctx, plan.amountCents, { reason: cleanReason, source: "yuno" });

        if (plan.isFull) {
          try {
            // Passage unique à « refunded » : places du billet rendues, consos et
            // commissions promoteur annulées par les triggers de la base.
            if (await markSaleFullyRefunded(supabaseAdmin, kind, item.id)) {
              await applyFullRefundEffects(supabaseAdmin, ctx);
            }
          } catch (statusError) {
            // L'argent est rendu et le montant enregistré : le webhook
            // `charge.refunded` repassera la vente « remboursée ».
            logStep("Status update failed after Stripe refund", { id: item.id, error: (statusError as Error).message });
          }
        }

        results.push({ id: item.id, type: kind, success: true, amount: fromCents(plan.amountCents) });
        logStep("Item refunded", { id: item.id, type: kind, amount: fromCents(plan.amountCents), full: plan.isFull });

        // Journal d'audit admin (remboursement déclenché par un super admin)
        if (isAdmin) {
          try {
            await supabaseAdmin.from("admin_audit_log").insert({
              admin_id: user.id,
              action: "refund_issued",
              entity_type: kind,
              entity_id: item.id,
              metadata: { amount: fromCents(plan.amountCents), reason: cleanReason, venue_id: ctx.venueId },
            });
          } catch (auditErr) {
            console.error("Admin audit log error (refund):", auditErr);
          }
        }
      } catch (itemError) {
        results.push({ id: item.id, type: kind, success: false, error: (itemError as Error).message });
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
