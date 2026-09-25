import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { restrictedCorsHeaders } from "../_shared/cors.ts";

// On matérialise les OCCURRENCE_HORIZON prochaines soirées de chaque modèle,
// pas seulement la fenêtre advance_days : le RP voit toutes les dates à venir
// dans son cockpit (page Events groupée par jour) et peut poser le lien de
// chacune quand il veut. Les occurrences au-delà de la plus proche restent en
// brouillon (cachées du public) tant qu'aucun lien n'est posé — le verrou
// link_gate s'en assure. Aucun cron ne purge ces brouillons.
const OCCURRENCE_HORIZON = 10;

// « Aujourd'hui » = date calendaire de Paris/Madrid (le runtime est en UTC :
// entre 00 h et 02 h heure de Madrid, il vivait encore sur la veille).
function parisToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Returns the next `count` occurrences of dayOfWeek from today (inclusive).
// Results are sorted ascending (nearest first). The caller is responsible for
// deciding which occurrences inherit the template's publication_url vs. draft.
function upcomingOccurrenceDates(dayOfWeek: number, count: number, today: string): string[] {
  const todayDow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const first = addDays(today, (dayOfWeek - todayDow + 7) % 7);
  return Array.from({ length: count }, (_, i) => addDays(first, i * 7));
}

const chunk = <T,>(arr: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

// Exécute `fn` sur chaque élément avec au plus `limit` appels en vol.
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
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
  // x-cron-secret is only sent server-side by pg_cron (no CORS preflight), but
  // keep it in Allow-Headers so a manual browser retry with it doesn't break.
  const corsHeaders = {
    ...restrictedCorsHeaders(req),
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-cron-secret",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Accept either the cron secret (pg_cron) or a VALIDATED affiliate admin (dashboard button).
  const cronSecret = Deno.env.get("CRON_SECRET");
  const providedCronSecret = req.headers.get("x-cron-secret");
  const isCron = !!cronSecret && providedCronSecret === cronSecret;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // Manual (non-cron) calls: the bearer token must resolve to a real user who
    // owns an affiliate profile — and the sweep is then scoped to THAT affiliate.
    let scopedAffiliateId: string | null = null;
    if (!isCron) {
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const authHeader = req.headers.get("Authorization");
      const supabaseUser = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader || "" } },
      });
      const { data: { user: caller } } = await supabaseUser.auth.getUser();
      if (!caller) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: affiliate } = await supabaseAdmin
        .from("affiliates")
        .select("id")
        .eq("user_id", caller.id)
        .eq("is_active", true)
        .maybeSingle();
      if (!affiliate) {
        return new Response(JSON.stringify({ error: "Affiliate profile required" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      scopedAffiliateId = affiliate.id;
    }

    // Fetch active templates (all of them for cron, the caller's only for manual runs)
    let tplQuery = supabaseAdmin
      .from("affiliate_recurring_templates")
      .select(`
        id, affiliate_id, affiliate_venue_id, name,
        day_of_week, advance_days, start_time, end_time,
        price_from, is_free, genres, publication_url, flyer_url,
        publication_url_set_at, publication_url_is_permanent,
        has_tables, tables_only, has_guest_list, guest_list_type,
        affiliate_venues(name, slug)
      `)
      .eq("is_active", true);
    if (scopedAffiliateId) tplQuery = tplQuery.eq("affiliate_id", scopedAffiliateId);
    const { data: templates, error: tplError } = await tplQuery;

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

    // Un lien de modèle est un lien d'ÉDITION (Fourvenues & co créent une page
    // par semaine) : il ne vaut que pour la première occurrence qui suit sa
    // pose, puis il expire — sauf lien coché « permanent ». Un lien sans date
    // de pose (posé avant ce système) est considéré périmé.
    const templateLinkFor = (
      tpl: { publication_url?: string | null; publication_url_set_at?: string | null; publication_url_is_permanent?: boolean | null },
      eventDate: string,
    ): string | null => {
      const url = tpl.publication_url ?? null;
      if (!url) return null;
      if (tpl.publication_url_is_permanent) return url;
      if (!tpl.publication_url_set_at) return null;
      const setAt = new Date(tpl.publication_url_set_at).getTime();
      const eventDayEnd = new Date(`${eventDate}T23:59:59`).getTime();
      const ageDays = (eventDayEnd - setAt) / 86_400_000;
      return ageDays >= 0 && ageDays < 7 ? url : null;
    };

    // ── Lecture EN LOT ────────────────────────────────────────────────────
    // L'ancienne boucle faisait 2 à 3 requêtes par (modèle × date) : ~57
    // modèles × 10 dates = plus d'un millier d'allers-retours en série, et
    // le bouton « Générer » expirait côté navigateur avant la fin. On lit
    // tout d'un coup, on calcule, puis on écrit en lots.
    const today = parisToday();
    type Existing = {
      id: string; recurring_template_id: string; event_date: string;
      external_ticket_url: string | null; flyer_url: string | null;
      status: string; ticket_url_overridden: boolean | null;
    };
    const existingByKey = new Map<string, Existing>();
    for (const ids of chunk(templates.map((t) => t.id), 100)) {
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabaseAdmin
          .from("affiliate_events")
          .select("id, recurring_template_id, event_date, external_ticket_url, flyer_url, status, ticket_url_overridden")
          .in("recurring_template_id", ids)
          .gte("event_date", today)
          .order("id")
          .range(from, from + 999);
        if (error) throw error;
        for (const row of (data ?? []) as Existing[]) existingByKey.set(`${row.recurring_template_id}|${row.event_date}`, row);
        if (!data || data.length < 1000) break;
      }
    }

    type Update = { id: string; external_ticket_url: string | null; flyer_url: string | null; status: string };
    const updates: Update[] = [];
    const inserts: Array<Record<string, unknown> & { slug: string; __base: string }> = [];

    for (const tpl of templates) {
      const eventDates = upcomingOccurrenceDates(tpl.day_of_week, OCCURRENCE_HORIZON, today);
      // Only the nearest occurrence (eventDates[0]) inherits the template's publication_url.
      // Advance-generated future events start as drafts to avoid publishing next week's
      // event with this week's ticket link.
      const nearestEventDate = eventDates[0];
      const tplFlyerUrl = (tpl as { flyer_url?: string | null }).flyer_url ?? null;

      for (const eventDate of eventDates) {
        const existing = existingByKey.get(`${tpl.id}|${eventDate}`);
        if (existing) {
          // Sync publication_url, flyer, and status from template — template is
          // source of truth, SAUF si un humain a posé le lien sur cette
          // occurrence (ticket_url_overridden, posé par trigger côté DB) :
          // son lien et le statut qui en découle ne sont alors plus touchés.
          // Un lien de modèle expiré (posé il y a plus d'un cycle) vaut null :
          // l'occurrence qui le portait est dépubliée et nettoyée ici même.
          const tplTicketUrl = templateLinkFor(tpl, eventDate);
          const overridden = existing.ticket_url_overridden === true;
          const targetUrl = overridden ? existing.external_ticket_url : tplTicketUrl;
          const correctStatus = targetUrl ? existing.status === "featured" ? "featured" : "published" : "draft";
          if (
            existing.external_ticket_url !== targetUrl ||
            existing.flyer_url !== tplFlyerUrl ||
            existing.status !== correctStatus
          ) {
            updates.push({ id: existing.id, external_ticket_url: targetUrl, flyer_url: tplFlyerUrl, status: correctStatus });
          }
          continue;
        }

        // Only apply the template's publication_url to the nearest occurrence,
        // et seulement s'il est encore frais (ou permanent). Future advance
        // events start as drafts — they'll be published when the user sets
        // their specific ticket link for that week.
        const isNearest = eventDate === nearestEventDate;
        const ticketUrl = isNearest ? templateLinkFor(tpl, eventDate) : null;
        const baseSlug = slugify(`${tpl.name} ${eventDate}`);
        inserts.push({
          __base: baseSlug,
          affiliate_id: tpl.affiliate_id,
          affiliate_venue_id: tpl.affiliate_venue_id,
          name: tpl.name,
          slug: baseSlug,
          event_date: eventDate,
          start_time: tpl.start_time,
          end_time: tpl.end_time,
          price_from: tpl.price_from,
          is_free: tpl.is_free,
          genres: tpl.genres,
          flyer_url: tplFlyerUrl,
          status: ticketUrl ? "published" : "draft",
          recurring_template_id: tpl.id,
          external_ticket_url: ticketUrl,
          // Offre (tables / guest list) : copiée du modèle à la création,
          // puis modifiable au cas par cas sur l'occurrence. Le générateur ne
          // la resynchronise jamais — c'est ce qui protège une soirée
          // personnalisée. Reporter un changement de modèle sur les soirées
          // déjà créées se fait à la demande, depuis le formulaire du modèle
          // (question posée à l'enregistrement, cf. AffiliateRecurringForm).
          has_tables: (tpl as { has_tables?: boolean }).has_tables ?? false,
          tables_only: (tpl as { tables_only?: boolean }).tables_only ?? false,
          has_guest_list: (tpl as { has_guest_list?: boolean }).has_guest_list ?? false,
          guest_list_type: (tpl as { guest_list_type?: string }).guest_list_type ?? "mixed",
        });
      }
    }

    // ── Slugs uniques : les conflits se lisent en lot ─────────────────────
    if (inserts.length > 0) {
      const candidates = inserts.flatMap((row) => [row.__base, ...[1, 2, 3, 4, 5].map((n) => `${row.__base}-${n}`)]);
      const taken = new Set<string>();
      for (const slugs of chunk(candidates, 150)) {
        const { data, error } = await supabaseAdmin.from("affiliate_events").select("slug").in("slug", slugs);
        if (error) throw error;
        for (const r of data ?? []) taken.add((r as { slug: string }).slug);
      }
      for (const row of inserts) {
        let slug = row.__base;
        for (let n = 1; taken.has(slug) && n <= 5; n++) slug = `${row.__base}-${n}`;
        if (taken.has(slug)) slug = `${row.__base}-${crypto.randomUUID().slice(0, 6)}`;
        taken.add(slug);
        row.slug = slug;
      }
    }

    // ── Écritures ─────────────────────────────────────────────────────────
    for (const batch of chunk(inserts.map(({ __base: _b, ...row }) => row), 100)) {
      const { error } = await supabaseAdmin.from("affiliate_events").insert(batch);
      if (!error) { generated += batch.length; continue; }
      // Un lot refusé (course avec une autre génération) : ligne à ligne,
      // pour que les autres soirées passent quand même.
      for (const row of batch) {
        const { error: rowError } = await supabaseAdmin.from("affiliate_events").insert(row);
        if (rowError) {
          errors.push(`Template ${row.recurring_template_id} / ${row.event_date}: ${rowError.message}`);
          console.error(`Insert failed for template ${row.recurring_template_id} / ${row.event_date}:`, rowError.message);
        } else {
          generated++;
        }
      }
    }

    await mapLimit(updates, 10, async (u) => {
      const { error } = await supabaseAdmin
        .from("affiliate_events")
        .update({ external_ticket_url: u.external_ticket_url, flyer_url: u.flyer_url, status: u.status })
        .eq("id", u.id);
      if (error) errors.push(`Update ${u.id}: ${error.message}`);
      else updated++;
    });

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
