import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const PARIS_TZ = "Europe/Paris";

// Returns occurrences of dayOfWeek (0 = Sunday) from today through the next
// advanceDays days (inclusive), as 'YYYY-MM-DD' strings, sorted ascending.
function upcomingDatesForDayOfWeek(dayOfWeek: number, advanceDays: number): string[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const windowEnd = new Date(today);
  windowEnd.setDate(windowEnd.getDate() + Math.max(advanceDays, 0));

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

// Offset (in minutes) of Europe/Paris from UTC at a given instant.
function parisOffsetMinutes(instant: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: PARIS_TZ, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = dtf.formatToParts(instant).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {} as Record<string, string>);
  const asUTC = Date.UTC(
    +parts.year, +parts.month - 1, +parts.day,
    +parts.hour, +parts.minute, +parts.second,
  );
  return (asUTC - instant.getTime()) / 60000;
}

// Convert a Paris wall-clock (date + 'HH:MM[:SS]') to a UTC ISO string.
function parisWallClockToUtcISO(dateStr: string, timeStr: string): string {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, mi] = timeStr.split(":").map(Number);
  const utcGuess = Date.UTC(y, mo - 1, d, h, mi);
  const offset = parisOffsetMinutes(new Date(utcGuess));
  return new Date(utcGuess - offset * 60000).toISOString();
}

// Build start/end UTC timestamps from an event date + Paris open/close times.
// If close <= open, the event ends the next calendar day (e.g. 23:00 -> 06:00).
function buildStartEnd(eventDate: string, startTime: string, endTime: string) {
  const startISO = parisWallClockToUtcISO(eventDate, startTime);
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  let endDate = eventDate;
  if (eh * 60 + em <= sh * 60 + sm) {
    const d = new Date(`${eventDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    endDate = d.toISOString().split("T")[0];
  }
  const endISO = parisWallClockToUtcISO(endDate, endTime);
  return { startISO, endISO };
}

interface PresetRound {
  name: string;
  price: number;
  maxTickets: number;
  lastTicketsThreshold?: number;
  includesDrink?: boolean;
  entryDeadline?: string;
}

// Insert ticket rounds for an event from a ticket preset.
async function applyPreset(
  supabase: ReturnType<typeof createClient>,
  eventId: string,
  preset: Record<string, unknown>,
  startPosition: number,
): Promise<number> {
  const rounds = (preset.rounds as PresetRound[]) || [];
  if (rounds.length === 0) return 0;

  const sellingMode = (preset.selling_mode as string) || "rounds";
  const ticketType = (preset.ticket_type as string) || "standard";
  const presetIncludesDrink = (preset.includes_drink as boolean) ?? false;
  const drinkDeadlineType = (preset.drink_deadline_type as string) ?? "none";
  const drinkDeadlineHours = (preset.drink_deadline_hours as number) ?? null;
  const drinkCutoffTime = (preset.drink_cutoff_time as string) ?? null;

  const toInsert = rounds.map((r, index) => {
    const includesDrink = r.includesDrink || presetIncludesDrink || false;
    return {
      event_id: eventId,
      name: r.name,
      price: r.price,
      max_tickets: sellingMode === "simple" ? 999999 : r.maxTickets,
      last_tickets_threshold: r.lastTicketsThreshold ?? 20,
      position: startPosition + index,
      is_active: sellingMode === "simple" ? true : index === 0 && startPosition === 0,
      auto_activate: sellingMode !== "timed_entry" && sellingMode !== "simple",
      ticket_type: ticketType,
      includes_drink: includesDrink,
      drink_deadline_type: includesDrink ? drinkDeadlineType : "none",
      drink_deadline_hours: includesDrink && drinkDeadlineType === "hours_after_start" ? drinkDeadlineHours : null,
      drink_cutoff_time: includesDrink && drinkDeadlineType === "fixed_time" ? drinkCutoffTime : null,
      entry_deadline: r.entryDeadline ? r.entryDeadline + ":00" : null,
    };
  });

  const { error } = await supabase.from("ticket_rounds").insert(toInsert);
  if (error) throw error;
  return toInsert.length;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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

    // Optional: restrict to a single template (used by the "generate now"
    // button after a create/edit so the owner sees occurrences immediately).
    let onlyTemplateId: string | null = null;
    try {
      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        onlyTemplateId = body?.template_id ?? null;
      }
    } catch { /* no body */ }

    let tplQuery = supabaseAdmin
      .from("owner_recurring_templates")
      .select(`
        id, venue_id, name, description, poster_url, poster_position,
        music_genres, event_type, day_of_week, start_time, end_time,
        advance_days, ticket_preset_id, vip_preset_id, auto_enable_tables
      `)
      .eq("is_active", true);

    if (onlyTemplateId) tplQuery = tplQuery.eq("id", onlyTemplateId);

    const { data: templates, error: tplError } = await tplQuery;
    if (tplError) throw tplError;

    if (!templates || templates.length === 0) {
      return new Response(
        JSON.stringify({ success: true, generated: 0, message: "No active templates" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Preload referenced presets in one query.
    const presetIds = [
      ...new Set(
        templates
          .flatMap((t) => [t.ticket_preset_id, t.vip_preset_id])
          .filter((x): x is string => !!x),
      ),
    ];
    const presetsById: Record<string, Record<string, unknown>> = {};
    if (presetIds.length > 0) {
      const { data: presetRows } = await supabaseAdmin
        .from("ticket_presets")
        .select("*")
        .in("id", presetIds);
      for (const p of presetRows || []) presetsById[p.id as string] = p;
    }

    let generated = 0;
    const errors: string[] = [];

    for (const tpl of templates) {
      const startTime = (tpl.start_time as string)?.slice(0, 5) || "23:00";
      const endTime = (tpl.end_time as string)?.slice(0, 5) || "06:00";
      const dates = upcomingDatesForDayOfWeek(tpl.day_of_week, tpl.advance_days);

      for (const eventDate of dates) {
        try {
          const { startISO, endISO } = buildStartEnd(eventDate, startTime, endTime);

          // Dedupe: skip if an event for this template already exists on this date.
          const dayStartISO = parisWallClockToUtcISO(eventDate, "00:00");
          const nextDay = new Date(`${eventDate}T00:00:00Z`);
          nextDay.setUTCDate(nextDay.getUTCDate() + 1);
          const dayEndISO = parisWallClockToUtcISO(nextDay.toISOString().split("T")[0], "00:00");

          const { data: existing } = await supabaseAdmin
            .from("events")
            .select("id")
            .eq("recurring_template_id", tpl.id)
            .gte("start_at", dayStartISO)
            .lt("start_at", dayEndISO)
            .maybeSingle();

          if (existing) continue;

          const ticketPreset = tpl.ticket_preset_id ? presetsById[tpl.ticket_preset_id as string] : null;
          const vipPreset = tpl.vip_preset_id ? presetsById[tpl.vip_preset_id as string] : null;
          const willEnableTicketing = !!(ticketPreset || vipPreset);

          const sellingMode = ticketPreset
            ? ((ticketPreset.selling_mode as string) || "rounds")
            : "rounds";
          const maxTickets = (ticketPreset && (ticketPreset.selling_mode === "simple"))
            ? (ticketPreset.total_capacity as number) ?? null
            : null;

          const { data: newEvent, error: insertErr } = await supabaseAdmin
            .from("events")
            .insert({
              venue_id: tpl.venue_id,
              title: tpl.name,
              description: tpl.description,
              poster_url: tpl.poster_url,
              poster_position: tpl.poster_position,
              music_genres: tpl.music_genres,
              music_genre: (tpl.music_genres as string[])?.[0] || "Open Format",
              event_type: tpl.event_type,
              start_at: startISO,
              end_at: endISO,
              is_active: true,
              recurring_template_id: tpl.id,
              ticketing_enabled: willEnableTicketing,
              ticket_selling_mode: sellingMode,
              max_tickets: maxTickets,
              tables_enabled: tpl.auto_enable_tables ?? false,
            })
            .select("id")
            .single();

          if (insertErr) throw insertErr;

          // Apply presets (rounds) when configured.
          let position = 0;
          if (ticketPreset) {
            position += await applyPreset(supabaseAdmin, newEvent.id as string, ticketPreset, position);
          }
          if (vipPreset) {
            await applyPreset(supabaseAdmin, newEvent.id as string, vipPreset, position);
          }

          generated++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`Template ${tpl.id} / ${eventDate}: ${msg}`);
          console.error(`Failed for template ${tpl.id} / ${eventDate}:`, msg);
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, generated, errors: errors.length > 0 ? errors : undefined }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in create-owner-recurring-events:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
