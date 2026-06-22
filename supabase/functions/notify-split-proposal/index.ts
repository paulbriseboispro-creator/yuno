import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Notifies the partner side (venue or organizer) when a revenue-split proposal
 * is created, accepted, or declined.
 *
 * Body:
 *  - kind: 'partnership' | 'event'   — which contract object
 *  - id: string                       — partnership.id OR event.id
 *  - action: 'proposed' | 'accepted' | 'declined'
 *  - proposer_side: 'venue' | 'organizer'   — who triggered the action
 *  - rules?: { tickets, tables, drinks }     — the proposal payload (for 'proposed')
 *
 * Sends BOTH an email (Resend if available) and a web-push notification to the partner.
 * Designed to be best-effort: never throws back to the client; logs internally.
 */
const log = (step: string, details?: unknown) => {
  console.log(`[NOTIFY-SPLIT] ${step}${details ? ` ${JSON.stringify(details)}` : ""}`);
};

interface SplitRules {
  tickets?: { organizer_pct: number; venue_pct: number };
  tables?: { organizer_pct: number; venue_pct: number };
  drinks?: { organizer_pct: number; venue_pct: number };
}

const ACTION_LABEL: Record<string, { fr: string; emoji: string }> = {
  proposed: { fr: "Nouvelle proposition de répartition", emoji: "🤝" },
  accepted: { fr: "Proposition de répartition acceptée", emoji: "✅" },
  declined: { fr: "Proposition de répartition refusée", emoji: "❌" },
};

function buildRulesHtml(rules?: SplitRules | null): string {
  if (!rules) return "";
  const row = (label: string, o?: number, v?: number) =>
    `<tr><td style="padding:6px 12px;color:#bbb">${label}</td>
       <td style="padding:6px 12px;color:#fff;text-align:right">Orga ${o ?? 0}% · Club ${v ?? 0}%</td></tr>`;
  return `
    <table width="100%" style="border-collapse:collapse;background:#0d0d0d;border-radius:10px;margin:16px 0;font-size:14px">
      ${row("Billets", rules.tickets?.organizer_pct, rules.tickets?.venue_pct)}
      ${row("Tables / VIP", rules.tables?.organizer_pct, rules.tables?.venue_pct)}
      ${row("Boissons", rules.drinks?.organizer_pct ?? 0, rules.drinks?.venue_pct ?? 100)}
    </table>`;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { kind, id, action, proposer_side, rules } = body || {};
    if (!["partnership", "event"].includes(kind)) {
      return new Response(JSON.stringify({ error: "invalid kind" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!["proposed", "accepted", "declined"].includes(action)) {
      return new Response(JSON.stringify({ error: "invalid action" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!["venue", "organizer"].includes(proposer_side)) {
      return new Response(JSON.stringify({ error: "invalid proposer_side" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    log("incoming", { kind, id, action, proposer_side });

    // Resolve partner identity (the side that did NOT propose)
    let venueId: string | null = null;
    let organizerUserId: string | null = null;
    let eventTitle: string | null = null;
    let contextLabel = "votre partenariat";

    if (kind === "partnership") {
      const { data, error } = await admin
        .from("venue_organizer_partnerships")
        .select("id, venue_id, organizer_user_id")
        .eq("id", id)
        .maybeSingle();
      if (error || !data) {
        log("partnership not found", error);
        return new Response(JSON.stringify({ ok: false, reason: "not_found" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      venueId = data.venue_id;
      organizerUserId = data.organizer_user_id;
    } else {
      const { data, error } = await admin
        .from("events")
        .select("id, title, venue_id, partner_venue_id, organizer_user_id, partner_organizer_id")
        .eq("id", id)
        .maybeSingle();
      if (error || !data) {
        log("event not found", error);
        return new Response(JSON.stringify({ ok: false, reason: "not_found" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      venueId = data.venue_id ?? data.partner_venue_id;
      organizerUserId = data.organizer_user_id ?? data.partner_organizer_id;
      eventTitle = data.title;
      contextLabel = `la soirée « ${data.title ?? "événement"} »`;
    }

    // The partner = the side OPPOSITE the proposer
    const partnerSide: "venue" | "organizer" = proposer_side === "venue" ? "organizer" : "venue";

    // Resolve recipient user IDs + email
    const recipientUserIds: string[] = [];
    let recipientEmail: string | null = null;
    let recipientName: string | null = null;
    let proposerName: string | null = null;

    if (partnerSide === "organizer") {
      if (!organizerUserId) {
        log("no organizer to notify");
        return new Response(JSON.stringify({ ok: false, reason: "no_recipient" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      recipientUserIds.push(organizerUserId);
      const { data: prof } = await admin
        .from("profiles")
        .select("email, first_name, organization_name")
        .eq("id", organizerUserId)
        .maybeSingle();
      recipientEmail = prof?.email ?? null;
      recipientName = prof?.organization_name || prof?.first_name || null;
      // Also include accepted org members for redundancy
      const { data: members } = await admin
        .from("org_members")
        .select("member_user_id")
        .eq("organizer_user_id", organizerUserId)
        .eq("invitation_status", "accepted");
      for (const m of members ?? []) {
        if (m.member_user_id && !recipientUserIds.includes(m.member_user_id)) {
          recipientUserIds.push(m.member_user_id);
        }
      }
    } else {
      // partnerSide === 'venue' → notify the venue owner
      if (!venueId) {
        log("no venue to notify");
        return new Response(JSON.stringify({ ok: false, reason: "no_recipient" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: venue } = await admin
        .from("venues")
        .select("owner_id, name")
        .eq("id", venueId)
        .maybeSingle();
      if (venue?.owner_id) {
        recipientUserIds.push(venue.owner_id);
        const { data: prof } = await admin
          .from("profiles")
          .select("email, first_name")
          .eq("id", venue.owner_id)
          .maybeSingle();
        recipientEmail = prof?.email ?? null;
        recipientName = venue?.name || prof?.first_name || null;
      }
    }

    // Resolve proposer display name
    {
      const { data: prof } = await admin
        .from("profiles")
        .select("first_name, last_name, organization_name")
        .eq("id", user.id)
        .maybeSingle();
      proposerName =
        prof?.organization_name ||
        [prof?.first_name, prof?.last_name].filter(Boolean).join(" ") ||
        "Votre partenaire";
    }

    if (recipientUserIds.length === 0) {
      log("no recipient resolved");
      return new Response(JSON.stringify({ ok: false, reason: "no_recipient" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const label = ACTION_LABEL[action as keyof typeof ACTION_LABEL];
    const subject = `${label.emoji} ${label.fr} — ${proposerName}`;

    // ===== EMAIL via Resend (best-effort) =====
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (RESEND_API_KEY && recipientEmail) {
      const rawFrom = Deno.env.get("RESEND_FROM_EMAIL");
      const from = rawFrom
        ? (rawFrom.includes("<") ? rawFrom : `Yuno <${rawFrom}>`)
        : "Yuno <noreply@yunoapp.eu>";

      const ctaUrl = kind === "event"
        ? `https://yunoapp.eu/organizer/events/${id}`
        : `https://yunoapp.eu/owner/partnerships`;

      const intro = action === "proposed"
        ? `<strong style="color:#fff">${proposerName}</strong> propose une nouvelle répartition des revenus pour ${contextLabel}. Vous devez accepter ou refuser pour activer (ou ré-activer) les ventes.`
        : action === "accepted"
        ? `<strong style="color:#fff">${proposerName}</strong> a accepté la proposition de répartition pour ${contextLabel}. Le contrat est maintenant actif et appliqué automatiquement aux paiements Stripe.`
        : `<strong style="color:#fff">${proposerName}</strong> a refusé la proposition de répartition pour ${contextLabel}. La répartition précédente reste en vigueur.`;

      const html = `
<!DOCTYPE html><html><body style="margin:0;background:#050505;font-family:system-ui,-apple-system,sans-serif;color:#fff">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:linear-gradient(135deg,#dc2626,#b91c1c);padding:24px;border-radius:16px 16px 0 0;text-align:center">
      <h1 style="margin:0;font-size:22px;color:#fff">${label.emoji} ${label.fr}</h1>
    </div>
    <div style="background:#161616;padding:24px;border-radius:0 0 16px 16px;line-height:1.6">
      <p style="margin:0 0 12px;color:#ddd">Bonjour ${recipientName ? recipientName : ""},</p>
      <p style="margin:0 0 12px;color:#bbb">${intro}</p>
      ${action === "proposed" ? buildRulesHtml(rules as SplitRules) : ""}
      <div style="text-align:center;margin:24px 0">
        <a href="${ctaUrl}" style="display:inline-block;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;text-decoration:none;padding:14px 28px;border-radius:12px;font-weight:bold">
          ${action === "proposed" ? "Examiner la proposition" : "Voir le contrat"}
        </a>
      </div>
      <p style="color:#666;font-size:12px;text-align:center">Yuno — Plateforme nightlife</p>
    </div>
  </div>
</body></html>`;

      try {
        const resp = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
          body: JSON.stringify({ from, to: [recipientEmail], subject, html }),
        });
        if (!resp.ok) log("resend error", await resp.text());
        else log("email sent", { to: recipientEmail });
      } catch (e) {
        log("resend exception", String(e));
      }
    } else {
      log("email skipped", { hasResend: !!RESEND_API_KEY, hasEmail: !!recipientEmail });
    }

    // ===== PUSH notification (best-effort) =====
    try {
      const pushBody = action === "proposed"
        ? `${proposerName} propose une nouvelle répartition pour ${contextLabel}.`
        : action === "accepted"
        ? `${proposerName} a accepté la nouvelle répartition.`
        : `${proposerName} a refusé la proposition de répartition.`;

      const pushUrl = `${supabaseUrl}/functions/v1/send-push-notification`;
      const payload = {
        title: subject,
        body: pushBody,
        url: kind === "event" ? `/organizer/events/${id}` : `/owner/partnerships`,
      };
      await Promise.all(recipientUserIds.map((uid) =>
        fetch(pushUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({ user_id: uid, payload }),
        }).catch((e) => log("push send failed", String(e)))
      ));
      log("push dispatched", { count: recipientUserIds.length });
    } catch (e) {
      log("push exception", String(e));
    }

    return new Response(
      JSON.stringify({ ok: true, notified: recipientUserIds.length, email: !!recipientEmail }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "unknown";
    console.error("[NOTIFY-SPLIT] error", msg);
    // Best-effort: never break the client flow.
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
};

serve(handler);
