import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { restrictedCorsHeaders } from "../_shared/cors.ts";
import { isSupportSessionToken } from "../_shared/support-session.ts";
import { demoPreviewGuard } from "../_shared/demo-guard.ts";
import {
  alreadyRefundedCents, fromCents, isSaleKind, planRefund, refundAllowed, refundCapCents,
  saleCollector, saleParties, SALE_TABLE, toCents,
  type CollectorRights, type SaleAmounts, type SaleCollector, type SaleKind, type SaleParty,
} from "../_shared/sale-refund.ts";
import {
  applyFullRefundEffects, applyRefundAmountEffects, markSaleFullyRefunded, refundSaleOnStripe,
  type SaleRefundContext,
} from "../_shared/sale-refund-effects.ts";

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[OWNER-REFUND] ${step}${detailsStr}`);
};

interface RefundRequestItem { type: string; id: string; amount?: number }

interface ItemResult { id: string; type: string; success: boolean; error?: string; amount?: number }

interface EventRow {
  id: string;
  title: string | null;
  venue_id: string | null;
  partner_venue_id: string | null;
  organizer_user_id: string | null;
  partner_organizer_id: string | null;
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
}

/** Ce que l'écran demande pour une vente : puis-je la rembourser, et sinon qui l'a encaissée. */
interface SaleRight { allowed: boolean; collector: string | null }

const json = (cors: Record<string, string>, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { headers: { ...cors, "Content-Type": "application/json" }, status });

serve(async (req) => {
  const corsHeaders = restrictedCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: string; event_id?: unknown; items?: unknown; reason?: unknown;
  };
  // `rights` ne fait que LIRE (qui peut rembourser quoi) : l'écran s'en sert pour
  // ne proposer que ce que le serveur acceptera. Tout le reste rembourse.
  const action: "rights" | "refund" = body?.action === "rights" ? "rights" : "refund";

  // Lien démo : lecture seule garantie côté serveur (_shared/demo-guard.ts).
  if (action === "refund") {
    const demoRefusal = await demoPreviewGuard(req, corsHeaders);
    if (demoRefusal) return demoRefusal;
  }

  try {
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
    // pro. Cette fonction écrit en service_role, donc les triggers de garde de
    // la base ne la voient jamais — le refus doit être posé ici.
    if (await isSupportSessionToken(supabaseAdmin, (req.headers.get("Authorization") ?? "").replace("Bearer ", ""))) {
      return action === "rights"
        ? json(corsHeaders, { rights: {}, blocked: "support_session" })
        : json(corsHeaders, { error: "support_session_forbidden" }, 403);
    }

    // Super admin peut rembourser n'importe quelle transaction (support plateforme).
    const { data: adminRole } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    const isAdmin = !!adminRole;

    // ── Qui a encaissé, et qui peut rembourser ─────────────────────────────
    // Seul l'ENCAISSEUR rembourse (`saleCollector`) : en charge directe l'argent
    // est arrivé sur SON compte Stripe, c'est de là qu'il repart. Chez lui,
    // peuvent rembourser : le propriétaire du club ou un manager à qui il a donné
    // « Remboursements » (`manager_permissions.can_manage_refunds`, ce que lit
    // /manager/refunds) ; l'organisateur ou un membre de son équipe autorisé
    // (`org_member_has_permission(…, 'refund')`, ce que rend
    // `get_my_org_memberships`). Un partenaire de collab ou un co-hôte ne
    // rembourse jamais une vente encaissée par un autre.
    const venueCache = new Map<string, { accountId: string | null; ownerId: string | null; name: string }>();
    const venueInfo = async (id: string) => {
      if (!venueCache.has(id)) {
        const { data } = await supabaseAdmin.from("venues")
          .select("owner_id, name, stripe_account_id").eq("id", id).maybeSingle();
        venueCache.set(id, { accountId: data?.stripe_account_id ?? null, ownerId: data?.owner_id ?? null, name: data?.name || "" });
      }
      return venueCache.get(id)!;
    };
    const orgInfoCache = new Map<string, { accountId: string | null; name: string }>();
    const organizerInfo = async (id: string) => {
      if (!orgInfoCache.has(id)) {
        const { data } = await supabaseAdmin.from("profiles")
          .select("stripe_connect_account_id, organization_name").eq("id", id).maybeSingle();
        orgInfoCache.set(id, { accountId: data?.stripe_connect_account_id ?? null, name: data?.organization_name || "" });
      }
      return orgInfoCache.get(id)!;
    };
    const eventCache = new Map<string, EventRow | null>();
    const loadEvent = async (id: string | null | undefined): Promise<EventRow | null> => {
      if (!id) return null;
      if (!eventCache.has(id)) {
        const { data } = await supabaseAdmin.from("events")
          .select("id, title, venue_id, partner_venue_id, organizer_user_id, partner_organizer_id")
          .eq("id", id).maybeSingle();
        eventCache.set(id, (data as EventRow | null) ?? null);
      }
      return eventCache.get(id)!;
    };

    const partiesOf = async (kind: SaleKind, sale: { venue_id?: string | null }, ev: EventRow | null): Promise<SaleParty[]> => {
      const shape = kind === "order"
        ? { venue_id: sale.venue_id ?? null }
        : {
          venue_id: ev?.venue_id ?? null,
          partner_venue_id: ev?.partner_venue_id ?? null,
          organizer_user_id: ev?.organizer_user_id ?? null,
          partner_organizer_id: ev?.partner_organizer_id ?? null,
        };
      const venues: Record<string, string | null> = {};
      const organizers: Record<string, string | null> = {};
      for (const id of [shape.venue_id, "partner_venue_id" in shape ? shape.partner_venue_id : null]) {
        if (id) venues[id] = (await venueInfo(id)).accountId;
      }
      if (kind !== "order") {
        const s = shape as { organizer_user_id: string | null; partner_organizer_id: string | null };
        for (const id of [s.organizer_user_id, s.partner_organizer_id]) {
          if (id) organizers[id] = (await organizerInfo(id)).accountId;
        }
      }
      return saleParties(shape, { venues, organizers });
    };

    const rightsCache = new Map<string, boolean>();
    const collectorRights = async (collector: SaleCollector | null): Promise<CollectorRights> => {
      const r: CollectorRights = { isAdmin, clubRefunder: false, orgRefunder: false };
      if (isAdmin || !collector) return r;
      const key = `${collector.party}:${collector.id}`;
      if (!rightsCache.has(key)) {
        let ok = false;
        if (collector.party === "venue") {
          ok = (await venueInfo(collector.id)).ownerId === user.id;
          if (!ok) {
            const { data } = await supabaseAdmin.from("manager_permissions")
              .select("can_manage_refunds").eq("user_id", user.id).eq("venue_id", collector.id).maybeSingle();
            ok = data?.can_manage_refunds === true;
          }
        } else {
          ok = collector.id === user.id;
          if (!ok) {
            const { data } = await supabaseAdmin.rpc("org_member_has_permission", {
              _user_id: user.id, _organizer_user_id: collector.id, _permission: "refund",
            });
            ok = data === true;
          }
        }
        rightsCache.set(key, ok);
      }
      const ok = rightsCache.get(key)!;
      return collector.party === "venue" ? { ...r, clubRefunder: ok } : { ...r, orgRefunder: ok };
    };

    const decide = async (
      kind: SaleKind,
      sale: { venue_id?: string | null; stripe_connected_account_id: string | null },
      ev: EventRow | null,
    ): Promise<{ allowed: boolean; collector: SaleCollector | null; collectorName: string | null }> => {
      const collector = saleCollector(kind, sale.stripe_connected_account_id, await partiesOf(kind, sale, ev));
      const allowed = refundAllowed(collector, await collectorRights(collector));
      const collectorName = !collector
        ? null
        : collector.party === "venue" ? (await venueInfo(collector.id)).name : (await organizerInfo(collector.id)).name;
      return { allowed, collector, collectorName };
    };

    // ── Lecture des droits (écran Remboursements, service VIP) ─────────────
    if (action === "rights") {
      const rows: { kind: SaleKind; id: string; venue_id?: string | null; event_id?: string | null; stripe_connected_account_id: string | null }[] = [];
      const cols: Record<SaleKind, string> = {
        order: "id, venue_id, event_id, stripe_connected_account_id",
        ticket: "id, event_id, stripe_connected_account_id",
        table_reservation: "id, event_id, stripe_connected_account_id",
      };
      const eventId = typeof body.event_id === "string" ? body.event_id : null;
      const wanted = Array.isArray(body.items) ? (body.items as RefundRequestItem[]).filter((i) => isSaleKind(i?.type) && typeof i?.id === "string") : [];
      for (const kind of ["order", "ticket", "table_reservation"] as const) {
        const ids = wanted.filter((i) => i.type === kind).map((i) => i.id);
        if (!eventId && ids.length === 0) continue;
        let q = supabaseAdmin.from(SALE_TABLE[kind]).select(cols[kind]);
        q = eventId ? q.eq("event_id", eventId) : q.in("id", ids.slice(0, 500));
        const { data, error } = await q;
        if (error) throw error;
        for (const row of (data ?? []) as unknown as { id: string; venue_id?: string | null; event_id?: string | null; stripe_connected_account_id: string | null }[]) {
          rows.push({ kind, ...row });
        }
      }
      const rights: Record<string, SaleRight> = {};
      for (const row of rows) {
        const d = await decide(row.kind, row, await loadEvent(row.event_id));
        rights[row.id] = { allowed: d.allowed, collector: d.collectorName };
      }
      return json(corsHeaders, { rights });
    }

    // ── Remboursement ──────────────────────────────────────────────────────
    const items = body.items as RefundRequestItem[] | undefined;
    const reason = body.reason;
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new Error("No items to refund");
    }
    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      throw new Error("Reason is required");
    }
    const cleanReason = reason.trim();
    logStep("Refund requested", { userId: user.id, count: items.length, isAdmin });

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const results: ItemResult[] = [];

    for (const item of items) {
      const kind = item?.type;
      if (!isSaleKind(kind)) {
        results.push({ id: item?.id, type: String(kind), success: false, error: "Invalid type" });
        continue;
      }
      try {
        const table = SALE_TABLE[kind];
        const { data } = await supabaseAdmin.from(table).select("*").eq("id", item.id).maybeSingle();
        const record = data as unknown as SaleRecord | null;
        if (!record) { results.push({ id: item.id, type: kind, success: false, error: "Not found" }); continue; }

        const ev = await loadEvent(record.event_id);
        const { allowed, collector, collectorName } = await decide(kind, record, ev);
        if (!allowed) {
          results.push({
            id: item.id, type: kind, success: false,
            error: collectorName ? `Collected by ${collectorName}: only they can refund it` : "Unauthorized",
          });
          continue;
        }
        if (record.status === "refunded") {
          results.push({ id: item.id, type: kind, success: false, error: "Already refunded" });
          continue;
        }

        // Club de la soirée (stats client, fidélité, notification) : celui de la
        // commande, sinon le club de la soirée ou le club partenaire.
        const clubId = kind === "order" ? record.venue_id || "" : ev?.venue_id || ev?.partner_venue_id || "";
        const ctx: SaleRefundContext = {
          kind, id: record.id, venueId: clubId, venueName: clubId ? (await venueInfo(clubId)).name : "",
          eventTitle: ev?.title || "", customerEmail: record.user_email || "", customerUserId: record.user_id || "",
        };

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
        logStep("Refund planned", { id: item.id, kind, collector, capCents, prevCents, plan });

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
        const prevRaw = record.refund_amount ?? null;
        let claim = supabaseAdmin.from(table)
          .update({
            refund_amount: fromCents(plan.cumulativeCents),
            refund_reason: cleanReason,
            refunded_by: user.id,
            refunded_at: new Date().toISOString(),
          })
          .eq("id", item.id)
          .neq("status", "refunded");
        claim = prevRaw === null ? claim.is("refund_amount", null) : claim.eq("refund_amount", prevRaw);
        const { data: claimed, error: claimError } = await claim.select("id");
        if (claimError) throw claimError;
        if (!claimed || claimed.length === 0) {
          results.push({ id: item.id, type: kind, success: false, error: "This sale was just refunded from another screen — reload" });
          continue;
        }

        const connectedAccountId = record.stripe_connected_account_id || null;
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
              refund_amount: prevRaw,
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
              metadata: { amount: fromCents(plan.amountCents), reason: cleanReason, venue_id: ctx.venueId, collector },
            });
          } catch (auditErr) {
            console.error("Admin audit log error (refund):", auditErr);
          }
        }
      } catch (itemError) {
        results.push({ id: item.id, type: kind, success: false, error: (itemError as Error).message });
      }
    }

    return json(corsHeaders, { success: true, results });
  } catch (error) {
    console.error("[OWNER-REFUND] Error:", error);
    return json(corsHeaders, { error: error instanceof Error ? error.message : "Unknown error" }, 400);
  }
});
