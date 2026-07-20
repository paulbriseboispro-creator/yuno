import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { buildSplitProposal } from "../_shared/email-templates.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Notifies the partner side (venue or organizer) when a revenue-split proposal
 * is created, accepted, or declined.
 *
 * Body:
 *  - kind: 'partnership' | 'event' | 'series'   — which contract object
 *  - id: string                       — partnership.id OR event.id OR owner_recurring_templates.id
 *  - action: 'proposed' | 'accepted' | 'declined'
 *  - proposer_side: 'venue' | 'organizer'   — who triggered the action
 *  - rules?: { tickets, tables, drinks }     — the proposal payload (for 'proposed')
 *
 * 'series' = the recurring FRAMEWORK contract (contrat-cadre). One signature covers
 * every night of a residency, so the partner needs more than percentages to decide:
 * the email carries a RECAP of what they are signing up for (cadence, hours, lead
 * time, ticketing, VIP tables, guest list, the next dates) alongside the terms.
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

// 0 = dimanche — aligné sur Postgres EXTRACT(DOW) / JS getDay().
const WEEKDAYS_FR = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

/** Les `count` prochaines dates tombant ce jour de semaine, formatées en FR. */
function nextOccurrenceLabels(dayOfWeek: number, count = 4): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  let guard = 0;
  while (out.length < count && guard++ < 400) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() === dayOfWeek) {
      out.push(d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" }));
    }
  }
  return out;
}

const ACTION_LABEL: Record<string, { fr: string; emoji: string }> = {
  proposed: { fr: "Nouvelle proposition de répartition", emoji: "🤝" },
  accepted: { fr: "Proposition de répartition acceptée", emoji: "✅" },
  declined: { fr: "Proposition de répartition refusée", emoji: "❌" },
};

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
    if (!["partnership", "event", "series"].includes(kind)) {
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
    // Récap de la série (kind='series') : ce que le partenaire signe, pas juste des %.
    let recapTerms: Array<{ k: string; v: string }> = [];
    // Termes réellement enregistrés côté contrat — priment sur le payload client.
    let storedRules: SplitRules | null = null;
    let storedPolicy: string | null = null;

    if (kind === "series") {
      const { data: tpl, error } = await admin
        .from("owner_recurring_templates")
        .select("id, name, venue_id, partner_organizer_id, day_of_week, start_time, end_time, advance_days, ticket_preset_id, vip_preset_id, table_preset_id, guest_list_template_id, auto_enable_tables")
        .eq("id", id)
        .maybeSingle();
      if (error || !tpl) {
        log("template not found", error);
        return new Response(JSON.stringify({ ok: false, reason: "not_found" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      venueId = tpl.venue_id;
      organizerUserId = tpl.partner_organizer_id;

      const dayLabel = WEEKDAYS_FR[tpl.day_of_week] ?? "";
      const hhmm = (s: string | null) => (s || "").slice(0, 5);
      const cadence = `Tous les ${dayLabel}s · ${hhmm(tpl.start_time)} → ${hhmm(tpl.end_time)}`;
      eventTitle = `${tpl.name} · tous les ${dayLabel}s`;
      contextLabel = `la série « ${tpl.name} »`;

      // Noms lisibles des presets — « Modèle billets : Early Bird » vaut mieux qu'un uuid.
      const ticketIds = [tpl.ticket_preset_id, tpl.vip_preset_id].filter(Boolean) as string[];
      const [{ data: tickets }, { data: tablePreset }, { data: guestList }] = await Promise.all([
        ticketIds.length
          ? admin.from("ticket_presets").select("id, name").in("id", ticketIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
        tpl.table_preset_id
          ? admin.from("table_pack_presets").select("name").eq("id", tpl.table_preset_id).maybeSingle()
          : Promise.resolve({ data: null }),
        tpl.guest_list_template_id
          ? admin.from("guest_list_templates").select("name, quota").eq("id", tpl.guest_list_template_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      const presetName = (pid: string | null) =>
        (tickets as { id: string; name: string }[] | null)?.find((p) => p.id === pid)?.name ?? null;

      recapTerms = [
        { k: "Rythme", v: cadence },
        { k: "Mise en ligne", v: `${tpl.advance_days} jours avant chaque date` },
        { k: "Billetterie", v: presetName(tpl.ticket_preset_id) ?? "Aucune billetterie automatique" },
        ...(presetName(tpl.vip_preset_id) ? [{ k: "Billets VIP", v: presetName(tpl.vip_preset_id)! }] : []),
        ...(tablePreset?.name
          ? [{ k: "Tables VIP", v: tablePreset.name }]
          : tpl.auto_enable_tables ? [{ k: "Tables VIP", v: "Ouvertes à la réservation" }] : []),
        ...(guestList?.name ? [{ k: "Guest list", v: `${guestList.name} — ${guestList.quota} places` }] : []),
        { k: "Prochaines dates", v: nextOccurrenceLabels(tpl.day_of_week).join(" · ") },
      ];

      // Le contrat-cadre fait foi : le RPC peut avoir corrigé la part boissons (licence
      // d'alcool). Envoyer le payload client afficherait des termes que personne n'a signés.
      const { data: sc } = await admin
        .from("event_collab_series_contracts")
        .select("split_rules, cancellation_policy")
        .eq("template_id", id)
        .in("status", ["draft", "pending_signatures", "active"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (sc) {
        storedRules = sc.split_rules as SplitRules;
        storedPolicy = sc.cancellation_policy as string;
      }
    } else if (kind === "partnership") {
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

    // Une résidence se propose au nom du CLUB, pas du prénom de son gérant.
    if (kind === "series" && venueId) {
      const { data: v } = await admin.from("venues").select("name").eq("id", venueId).maybeSingle();
      if (v?.name) proposerName = v.name;
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
        : kind === "series"
        ? `https://yunoapp.eu/organizer-app/collaborations`
        : `https://yunoapp.eu/owner/partnerships`;

      // Map the split rules into builder terms (only used for the 'proposed' email).
      // For a series the recap comes first: the partner signs the residency, then the %.
      const r = (storedRules ?? (rules as SplitRules | null | undefined)) || null;
      const splitTerms = r
        ? [
            ...recapTerms,
            { k: "Billets", v: `Orga ${r.tickets?.organizer_pct ?? 0}% · Club ${r.tickets?.venue_pct ?? 0}%` },
            { k: "Tables / VIP", v: `Orga ${r.tables?.organizer_pct ?? 0}% · Club ${r.tables?.venue_pct ?? 0}%` },
            { k: "Boissons", v: `Orga ${r.drinks?.organizer_pct ?? 0}% · Club ${r.drinks?.venue_pct ?? 100}%` },
            ...(storedPolicy
              ? [{
                  k: "En cas d'annulation",
                  v: storedPolicy === "no_refund_after_event"
                    ? "Pas de remboursement après la soirée"
                    : "Remboursement au prorata",
                }]
              : []),
          ]
        : (recapTerms.length ? recapTerms : undefined);

      let emailSubject: string;
      let html: string;
      if (action === "proposed") {
        const mail = buildSplitProposal({
          lang: "fr",
          fromOrg: proposerName || "Votre partenaire",
          eventTitle: eventTitle || contextLabel,
          terms: splitTerms,
          reviewUrl: ctaUrl,
        });
        emailSubject = mail.subject;
        html = mail.html;
      } else {
        // accepted / declined have no dedicated editorial builder — keep inline HTML.
        emailSubject = subject;
        const intro = action === "accepted"
          ? `<strong style="color:#fff">${proposerName}</strong> a accepté la proposition de répartition pour ${contextLabel}. Le contrat est maintenant actif et appliqué automatiquement aux paiements Stripe.`
          : `<strong style="color:#fff">${proposerName}</strong> a refusé la proposition de répartition pour ${contextLabel}. La répartition précédente reste en vigueur.`;
        html = `
<!DOCTYPE html><html><body style="margin:0;background:#050505;font-family:system-ui,-apple-system,sans-serif;color:#fff">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:linear-gradient(135deg,#dc2626,#b91c1c);padding:24px;border-radius:16px 16px 0 0;text-align:center">
      <h1 style="margin:0;font-size:22px;color:#fff">${label.emoji} ${label.fr}</h1>
    </div>
    <div style="background:#161616;padding:24px;border-radius:0 0 16px 16px;line-height:1.6">
      <p style="margin:0 0 12px;color:#ddd">Bonjour ${recipientName ? recipientName : ""},</p>
      <p style="margin:0 0 12px;color:#bbb">${intro}</p>
      <div style="text-align:center;margin:24px 0">
        <a href="${ctaUrl}" style="display:inline-block;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;text-decoration:none;padding:14px 28px;border-radius:12px;font-weight:bold">
          Voir le contrat
        </a>
      </div>
      <p style="color:#666;font-size:12px;text-align:center">Yuno — Plateforme nightlife</p>
    </div>
  </div>
</body></html>`;
      }

      try {
        const resp = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
          body: JSON.stringify({ from, to: [recipientEmail], subject: emailSubject, html }),
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
      const pushBody = action === "proposed" && kind === "series"
        ? `${proposerName} te propose ${contextLabel} : une seule signature couvre toutes les dates.`
        : action === "proposed"
        ? `${proposerName} propose une nouvelle répartition pour ${contextLabel}.`
        : action === "accepted"
        ? `${proposerName} a accepté la nouvelle répartition.`
        : `${proposerName} a refusé la proposition de répartition.`;

      const pushUrl = `${supabaseUrl}/functions/v1/send-push-notification`;
      const payload = {
        title: subject,
        body: pushBody,
        url: kind === "event"
          ? `/organizer/events/${id}`
          : kind === "series" ? `/organizer-app/collaborations` : `/owner/partnerships`,
      };
      await Promise.all(recipientUserIds.map((uid) =>
        fetch(pushUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          // Répartition d'une collab : sujet pro, app Yuno Pro uniquement.
          body: JSON.stringify({ user_id: uid, platforms: ["ios_pro"], payload }),
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
