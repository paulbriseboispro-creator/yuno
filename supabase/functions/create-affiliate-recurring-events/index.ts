import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

// Returns occurrences of dayOfWeek from today through the next advanceDays days (inclusive).
// Results are sorted ascending (nearest first). The caller is responsible for deciding
// which occurrences should inherit the template's publication_url vs. start as drafts.
function upcomingDatesForDayOfWeek(dayOfWeek: number, advanceDays: number): string[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const windowEnd = new Date(today);
  windowEnd.setDate(windowEnd.getDate() + Math.max(advanceDays, 0));

  // Find first occurrence of dayOfWeek on or after today
  const first = new Date(today);
  const daysUntilFirst = (dayOfWeek - first.getDay() + 7) % 7;
  first.setDate(first.getDate() + daysUntilFirst);

  const dates: string[] = [];
  const cur = new Date(first);
  while (cur <= windowEnd) {
    dates.push(cur.toISOString().split("T")[0]);
    cur.setDate(cur.getDate() + 7);
  }
  return dates;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Accept either the cron secret (pg_cron) or any authenticated Supabase user (dashboard button)
  const cronSecret = Deno.env.get("CRON_SECRET");
  const providedCronSecret = req.headers.get("x-cron-secret");
  const authHeader = req.headers.get("authorization");

  const isCron = !!cronSecret && providedCronSecret === cronSecret;
  const isAuthenticated = !!authHeader?.startsWith("Bearer ");

  if (!isCron && !isAuthenticated) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // Fetch all active templates
    const { data: templates, error: tplError } = await supabaseAdmin
      .from("affiliate_recurring_templates")
      .select(`
        id, affiliate_id, affiliate_venue_id, name,
        day_of_week, advance_days, start_time, end_time,
        price_from, is_free, genres, publication_url, flyer_url,
        affiliate_venues(name, slug)
      `)
      .eq("is_active", true);

    if (tplError) throw tplError;
    if (!templates || templates.length === 0) {
      return new Response(
        JSON.stringify({ success: true, generated: 0, updated: 0, message: "No active templates" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let generated = 0;
    let updated = 0;
    const errors: string[] = [];

    for (const tpl of templates) {
      const eventDates = upcomingDatesForDayOfWeek(tpl.day_of_week, tpl.advance_days);
      // Only the nearest occurrence (eventDates[0]) inherits the template's publication_url.
      // Advance-generated future events start as drafts to avoid publishing next week's
      // event with this week's ticket link.
      const nearestEventDate = eventDates[0];

      for (const eventDate of eventDates) {
        try {
          // Check if an event for this template+date already exists
          const { data: existing } = await supabaseAdmin
            .from("affiliate_events")
            .select("id, external_ticket_url, flyer_url, status")
            .eq("recurring_template_id", tpl.id)
            .eq("event_date", eventDate)
            .maybeSingle();

          if (existing) {
            // Sync publication_url, flyer, and status from template — template is source of truth
            const tplTicketUrl = (tpl as any).publication_url ?? null;
            const tplFlyerUrl = (tpl as any).flyer_url ?? null;
            const correctStatus = tplTicketUrl ? existing.status === "featured" ? "featured" : "published" : "draft";
            const needsUpdate =
              existing.external_ticket_url !== tplTicketUrl ||
              existing.flyer_url !== tplFlyerUrl ||
              existing.status !== correctStatus;

            if (needsUpdate) {
              await supabaseAdmin
                .from("affiliate_events")
                .update({ external_ticket_url: tplTicketUrl, flyer_url: tplFlyerUrl, status: correctStatus })
                .eq("id", existing.id);
              updated++;
            }
            continue;
          }

          // Generate a unique slug
          const baseSlug = slugify(`${tpl.name} ${eventDate}`);
          let slug = baseSlug;
          let attempt = 0;
          while (attempt < 5) {
            const { data: slugConflict } = await supabaseAdmin
              .from("affiliate_events")
              .select("id")
              .eq("slug", slug)
              .maybeSingle();
            if (!slugConflict) break;
            attempt++;
            slug = `${baseSlug}-${attempt}`;
          }

          // Only apply the template's publication_url to the nearest occurrence.
          // Future advance events start as drafts — they'll be published when the
          // user sets their specific ticket link for that week.
          const isNearest = eventDate === nearestEventDate;
          const ticketUrl = isNearest ? ((tpl as any).publication_url ?? null) : null;

          await supabaseAdmin.from("affiliate_events").insert({
            affiliate_id: tpl.affiliate_id,
            affiliate_venue_id: tpl.affiliate_venue_id,
            name: tpl.name,
            slug,
            event_date: eventDate,
            start_time: tpl.start_time,
            end_time: tpl.end_time,
            price_from: tpl.price_from,
            is_free: tpl.is_free,
            genres: tpl.genres,
            flyer_url: (tpl as any).flyer_url ?? null,
            status: ticketUrl ? "published" : "draft",
            recurring_template_id: tpl.id,
            external_ticket_url: ticketUrl,
          });

          generated++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`Template ${tpl.id} / ${eventDate}: ${msg}`);
          console.error(`Failed for template ${tpl.id} / ${eventDate}:`, msg);
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, generated, updated, errors: errors.length > 0 ? errors : undefined }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in create-affiliate-recurring-events:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
