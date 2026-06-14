import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { EmailLanguage, t, wrapEmailWithBranding, escapeHtml } from "../_shared/email-branding.ts";
import { authorizeCronRequest } from "../_shared/cron-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function wasAlreadySent(supabase: any, userId: string, notifType: string, key: string): Promise<boolean> {
  const { data } = await supabase
    .from("notification_log")
    .select("id")
    .eq("user_id", userId)
    .eq("notification_type", notifType)
    .eq("title", key)
    .limit(1);
  return data && data.length > 0;
}

async function markSent(supabase: any, userId: string, notifType: string, key: string) {
  await supabase.from("notification_log").insert({ user_id: userId, notification_type: notifType, title: key });
}

async function sendNightSummary(supabaseAdmin: any, resendApiKey: string, from: string): Promise<number> {
  const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  const { data: endedEvents } = await supabaseAdmin
    .from("events")
    .select("id, title, start_at, end_at, venue_id, venues(name, owner_id)")
    .lte("end_at", now)
    .gte("end_at", twelveHoursAgo);

  if (!endedEvents?.length) return 0;

  let sentCount = 0;

  for (const event of endedEvents) {
    const ownerId = (event.venues as any)?.owner_id;
    const venueName = (event.venues as any)?.name || "";
    if (!ownerId) continue;

    if (await wasAlreadySent(supabaseAdmin, ownerId, "night_summary", event.id)) continue;

    const { data: ownerProfile } = await supabaseAdmin
      .from("profiles")
      .select("email, preferred_language")
      .eq("id", ownerId)
      .single();
    if (!ownerProfile?.email) continue;

    const lang = (ownerProfile.preferred_language as EmailLanguage) || "fr";

    const { data: orders } = await supabaseAdmin
      .from("orders")
      .select("total, items")
      .eq("event_id", event.id)
      .in("status", ["paid", "served", "ready", "picked_up"]);

    const orderRevenue = orders?.reduce((s: number, o: any) => s + (o.total || 0), 0) || 0;
    const orderCount = orders?.length || 0;

    const { data: tickets } = await supabaseAdmin
      .from("tickets")
      .select("total_price")
      .eq("event_id", event.id)
      .in("status", ["paid", "used"]);
    const ticketRevenue = tickets?.reduce((s: number, t: any) => s + (t.total_price || 0), 0) || 0;
    const ticketCount = tickets?.length || 0;

    const { data: tables } = await supabaseAdmin
      .from("table_reservations")
      .select("total_price")
      .eq("event_id", event.id)
      .eq("status", "confirmed");
    const tableRevenue = tables?.reduce((s: number, t: any) => s + (t.total_price || 0), 0) || 0;
    const tableCount = tables?.length || 0;

    const totalRevenue = orderRevenue + ticketRevenue + tableRevenue;

    const productCounts = new Map<string, number>();
    for (const order of orders || []) {
      const items = order.items as { name?: string; qty?: number; quantity?: number }[];
      if (items) for (const item of items) {
        const name = item.name || "Unknown";
        const qty = item.qty || item.quantity || 1;
        productCounts.set(name, (productCounts.get(name) || 0) + qty);
      }
    }
    const topProducts = [...productCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

    const { data: incidents } = await supabaseAdmin
      .from("customer_incidents")
      .select("incident_type, reason")
      .eq("venue_id", event.venue_id)
      .gte("created_at", event.start_at)
      .lte("created_at", event.end_at);
    const incidentCount = incidents?.length || 0;

    const topProductsHtml = topProducts.length > 0
      ? topProducts.map(([name, qty], i) => `<tr><td style="padding:8px 16px;border-bottom:1px solid rgba(255,255,255,0.05);color:#999;width:30px">${i + 1}.</td><td style="padding:8px 16px;border-bottom:1px solid rgba(255,255,255,0.05);color:#fff">${escapeHtml(name)}</td><td style="padding:8px 16px;border-bottom:1px solid rgba(255,255,255,0.05);color:#dc2626;text-align:right;font-weight:600">x${qty}</td></tr>`).join("")
      : `<tr><td style="padding:12px 16px;color:#666">-</td></tr>`;

    const emailContent = `<table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:32px 28px">
      <h1 style="color:#fff;font-size:22px;font-weight:700;margin:0 0 8px">${t("nightSummary.title", lang)}</h1>
      <p style="color:#999;font-size:14px;margin:0 0 24px">${escapeHtml(event.title)} — ${escapeHtml(venueName)}</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px"><tr>
        <td style="background:rgba(34,197,94,0.1);border-radius:12px;padding:20px;text-align:center;width:25%"><p style="color:#22c55e;margin:0;font-size:24px;font-weight:800">${totalRevenue.toFixed(0)}€</p><p style="color:#9ca3af;margin:4px 0 0;font-size:12px">${t("nightSummary.revenue", lang)}</p></td>
        <td style="width:6px"></td>
        <td style="background:rgba(59,130,246,0.1);border-radius:12px;padding:20px;text-align:center;width:25%"><p style="color:#3b82f6;margin:0;font-size:24px;font-weight:800">${orderCount}</p><p style="color:#9ca3af;margin:4px 0 0;font-size:12px">${t("nightSummary.orders", lang)}</p></td>
        <td style="width:6px"></td>
        <td style="background:rgba(168,85,247,0.1);border-radius:12px;padding:20px;text-align:center;width:25%"><p style="color:#a855f7;margin:0;font-size:24px;font-weight:800">${ticketCount}</p><p style="color:#9ca3af;margin:4px 0 0;font-size:12px">${t("nightSummary.tickets", lang)}</p></td>
        <td style="width:6px"></td>
        <td style="background:rgba(245,158,11,0.1);border-radius:12px;padding:20px;text-align:center;width:25%"><p style="color:#f59e0b;margin:0;font-size:24px;font-weight:800">${tableCount}</p><p style="color:#9ca3af;margin:4px 0 0;font-size:12px">${t("nightSummary.tables", lang)}</p></td>
      </tr></table>
      <h2 style="color:#fff;font-size:16px;margin:24px 0 12px">${t("nightSummary.topProducts", lang)}</h2>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,0.05);border-radius:12px;margin-bottom:16px">${topProductsHtml}</table>
      <h2 style="color:#fff;font-size:16px;margin:24px 0 12px">${t("nightSummary.incidents", lang)}</h2>
      <p style="color:${incidentCount > 0 ? "#f59e0b" : "#22c55e"};font-size:14px;margin:0 0 24px">${incidentCount > 0 ? `⚠️ ${incidentCount} incident${incidentCount > 1 ? "s" : ""}` : `✅ ${t("nightSummary.none", lang)}`}</p>
      <div style="border-top:1px solid rgba(255,255,255,0.08);margin:0 0 20px"></div>
      <p style="color:#666;font-size:13px;margin:0">${t("nightSummary.teamSign", lang)}</p>
    </td></tr></table>`;

    const html = wrapEmailWithBranding(emailContent, lang, venueName);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendApiKey}` },
      body: JSON.stringify({ from, to: [ownerProfile.email], subject: t("nightSummary.subject", lang, { eventTitle: event.title }), html }),
    });
    if (res.ok) {
      await markSent(supabaseAdmin, ownerId, "night_summary", event.id);
      sentCount++;
    } else {
      console.error(`Night summary failed for ${ownerProfile.email}:`, await res.text());
    }
  }
  return sentCount;
}

async function sendWeeklyReport(supabaseAdmin: any, resendApiKey: string, from: string): Promise<number> {
  const d = new Date();
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + yearStart.getDay() + 1) / 7);
  const weekKey = `${d.getFullYear()}-W${weekNum}`;

  const { data: venues } = await supabaseAdmin.from("venues").select("id, name, owner_id").not("owner_id", "is", null);
  if (!venues?.length) return 0;

  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  let sentCount = 0;

  for (const venue of venues) {
    try {
      const dedupKey = `${weekKey}-${venue.id}`;
      if (await wasAlreadySent(supabaseAdmin, venue.owner_id, "weekly_report", dedupKey)) continue;

      const { data: ownerProfile } = await supabaseAdmin
        .from("profiles").select("email, preferred_language").eq("id", venue.owner_id).single();
      if (!ownerProfile?.email) continue;
      const lang = (ownerProfile.preferred_language as EmailLanguage) || "fr";

      const { data: thisWeekOrders } = await supabaseAdmin
        .from("orders").select("total").eq("venue_id", venue.id)
        .in("status", ["paid", "served", "ready", "picked_up"]).gte("created_at", oneWeekAgo);
      const thisWeekOrderRevenue = thisWeekOrders?.reduce((s: number, o: any) => s + (o.total || 0), 0) || 0;
      const thisWeekOrderCount = thisWeekOrders?.length || 0;

      const { data: thisWeekTickets } = await supabaseAdmin
        .from("tickets").select("total_price, event_id").in("status", ["paid", "used"]).gte("created_at", oneWeekAgo);

      const { data: venueEvents } = await supabaseAdmin.from("events").select("id, title").eq("venue_id", venue.id);
      const venueEventIds = new Set(venueEvents?.map((e: any) => e.id) || []);
      const venueTickets = thisWeekTickets?.filter((t: any) => venueEventIds.has(t.event_id)) || [];
      const ticketRevenue = venueTickets.reduce((s: number, t: any) => s + (t.total_price || 0), 0);
      const ticketCount = venueTickets.length;

      const { data: venueZones } = await supabaseAdmin.from("table_zones").select("id").eq("venue_id", venue.id);
      const zoneIds = new Set(venueZones?.map((z: any) => z.id) || []);
      const { data: venueTables } = await supabaseAdmin
        .from("table_reservations").select("total_price, zone_id").eq("status", "confirmed").gte("created_at", oneWeekAgo);
      const filteredTables = venueTables?.filter((t: any) => zoneIds.has(t.zone_id)) || [];
      const tableRevenue = filteredTables.reduce((s: number, t: any) => s + (t.total_price || 0), 0);
      const tableCount = filteredTables.length;
      const totalRevenue = thisWeekOrderRevenue + ticketRevenue + tableRevenue;

      if (totalRevenue === 0 && thisWeekOrderCount === 0 && ticketCount === 0) continue;

      const { data: prevWeekOrders } = await supabaseAdmin
        .from("orders").select("total").eq("venue_id", venue.id)
        .in("status", ["paid", "served", "ready", "picked_up"]).gte("created_at", twoWeeksAgo).lt("created_at", oneWeekAgo);
      const prevRevenue = prevWeekOrders?.reduce((s: number, o: any) => s + (o.total || 0), 0) || 0;
      const revenueChange = prevRevenue > 0 ? Math.round(((thisWeekOrderRevenue - prevRevenue) / prevRevenue) * 100) : 0;

      const { count: newCustomers } = await supabaseAdmin
        .from("venue_customers").select("id", { count: "exact", head: true }).eq("venue_id", venue.id).gte("created_at", oneWeekAgo);

      let topEventTitle = "-", topEventRevenue = 0;
      for (const ve of venueEvents || []) {
        const rev = venueTickets.filter((t: any) => t.event_id === ve.id).reduce((s: number, t: any) => s + (t.total_price || 0), 0);
        if (rev > topEventRevenue) { topEventRevenue = rev; topEventTitle = ve.title; }
      }

      const dateLocales: Record<EmailLanguage, string> = { en: "en-GB", es: "es-ES", fr: "fr-FR" };
      const periodStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toLocaleDateString(dateLocales[lang], { day: "numeric", month: "short" });
      const periodEnd = new Date().toLocaleDateString(dateLocales[lang], { day: "numeric", month: "short" });
      const changeColor = revenueChange >= 0 ? "#22c55e" : "#dc2626";
      const changeIcon = revenueChange >= 0 ? "↑" : "↓";

      const emailContent = `<table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:32px 28px">
        <h1 style="color:#fff;font-size:22px;font-weight:700;margin:0 0 8px">${t("weeklyReport.title", lang)}</h1>
        <p style="color:#999;font-size:14px;margin:0 0 24px">${escapeHtml(venue.name)} · ${periodStart} – ${periodEnd}</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(34,197,94,0.1);border-radius:16px;margin-bottom:20px"><tr><td style="padding:24px;text-align:center">
          <p style="color:#22c55e;font-size:36px;font-weight:800;margin:0">${totalRevenue.toFixed(0)}€</p>
          <p style="color:#9ca3af;font-size:14px;margin:4px 0 0">${t("weeklyReport.totalRevenue", lang)}</p>
          ${revenueChange !== 0 ? `<p style="color:${changeColor};font-size:13px;margin:8px 0 0">${changeIcon} ${Math.abs(revenueChange)}% vs last week</p>` : ""}
        </td></tr></table>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px"><tr>
          <td style="background:rgba(59,130,246,0.1);border-radius:12px;padding:16px;text-align:center;width:33%"><p style="color:#3b82f6;margin:0;font-size:22px;font-weight:800">${thisWeekOrderCount}</p><p style="color:#9ca3af;margin:4px 0 0;font-size:11px">${t("weeklyReport.totalOrders", lang)}</p></td>
          <td style="width:6px"></td>
          <td style="background:rgba(168,85,247,0.1);border-radius:12px;padding:16px;text-align:center;width:33%"><p style="color:#a855f7;margin:0;font-size:22px;font-weight:800">${ticketCount}</p><p style="color:#9ca3af;margin:4px 0 0;font-size:11px">${t("weeklyReport.totalTickets", lang)}</p></td>
          <td style="width:6px"></td>
          <td style="background:rgba(245,158,11,0.1);border-radius:12px;padding:16px;text-align:center;width:33%"><p style="color:#f59e0b;margin:0;font-size:22px;font-weight:800">${tableCount}</p><p style="color:#9ca3af;margin:4px 0 0;font-size:11px">${t("weeklyReport.totalTables", lang)}</p></td>
        </tr></table>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,0.05);border-radius:12px;margin-bottom:16px">
          <tr><td style="padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.05);color:#999">🏆 ${t("weeklyReport.topEvent", lang)}</td><td style="padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.05);color:#fff;text-align:right;font-weight:600">${escapeHtml(topEventTitle)}</td></tr>
          <tr><td style="padding:12px 16px;color:#999">👥 ${t("weeklyReport.newCustomers", lang)}</td><td style="padding:12px 16px;color:#fff;text-align:right;font-weight:600">${newCustomers || 0}</td></tr>
        </table>
        <div style="border-top:1px solid rgba(255,255,255,0.08);margin:24px 0 20px"></div>
        <p style="color:#666;font-size:13px;margin:0">${t("weeklyReport.teamSign", lang)}</p>
      </td></tr></table>`;

      const html = wrapEmailWithBranding(emailContent, lang, venue.name);
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendApiKey}` },
        body: JSON.stringify({ from, to: [ownerProfile.email], subject: t("weeklyReport.subject", lang, { venueName: venue.name }), html }),
      });
      if (res.ok) {
        await markSent(supabaseAdmin, venue.owner_id, "weekly_report", dedupKey);
        sentCount++;
      } else {
        console.error(`Weekly report failed for ${ownerProfile.email}:`, await res.text());
      }
    } catch (err) {
      console.error(`Weekly report error for venue ${venue.id}:`, err);
    }
  }
  return sentCount;
}

serve(async (req) => {
  const cronAuth = await authorizeCronRequest(req);
  if (!cronAuth.ok) {
    return new Response(JSON.stringify({ error: cronAuth.message }), {
      status: cronAuth.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const type: string = body.type || "night-summary";

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) throw new Error("RESEND_API_KEY not configured");

    const rawFrom = Deno.env.get("RESEND_FROM_EMAIL");
    const from = rawFrom ? (rawFrom.includes("<") ? rawFrom : `Yuno <${rawFrom}>`) : "Yuno <onboarding@resend.dev>";

    const sentCount = type === "weekly-report"
      ? await sendWeeklyReport(supabaseAdmin, resendApiKey, from)
      : await sendNightSummary(supabaseAdmin, resendApiKey, from);

    return new Response(
      JSON.stringify({ success: true, type, sent: sentCount }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[SEND-OWNER-REPORT] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
