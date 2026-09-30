// Co-organisation — invitation par EMAIL d'une structure sans compte Yuno.
// Portée par l'edge `invite-organizer-collab` (action `kind: "coorg"`) : le
// quota de fonctions du projet interdit d'en créer une nouvelle.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { buildCoorgInvitation } from "./email-templates.ts";

const DEFAULT_APP_ORIGIN = "https://yunoapp.eu";
// Le lien d'acceptation porte un jeton vivant : jamais une origine choisie par l'appelant.
const isAllowedOrigin = (o: string) =>
  o === "https://yuno.club" || o === DEFAULT_APP_ORIGIN || o.startsWith("http://localhost");

const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });

/**
 * Co-organisation — inviter par EMAIL une structure (club ou organisateur)
 * qui n'a pas encore de compte Yuno.
 *
 * Toutes les règles vivent dans la RPC `create_cohost_email_invite`, appelée
 * AVEC LE JWT du pro (partie principale niveau ≥ 2, soirée ouverte, 8 co-hôtes
 * max, démo ↔ démo, jamais en accès assisté). Cette fonction ne fait
 * qu'envoyer l'email ; une adresse démo n'en reçoit jamais (boîte fictive).
 *
 * Body : { kind: "coorg", event_id, email, name?, access?, share_crm?, message?, lang?, origin?,
 *          principal?, terms? } — `principal` = l'organisation invitée à ORGANISER la soirée
 *          d'un club (rôle appliqué à l'acceptation, `_collab_promote_principal`).
 */
export async function handleCoorgInvite(req: Request, b: any, corsHeaders: Record<string, string>): Promise<Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "not_authenticated" }, 401, corsHeaders);
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });

    const lang = (["fr", "en", "es"].includes(b?.lang) ? b.lang : "fr") as "fr" | "en" | "es";
    const { data: inv, error } = await userClient.rpc("create_cohost_email_invite", {
      p_event_id: b?.event_id ?? null,
      p_email: b?.email ?? null,
      p_name: b?.name ?? null,
      p_access: b?.access === "viewer" ? "viewer" : "editor",
      p_share_crm: b?.share_crm !== false,
      p_message: b?.message ?? null,
      p_lang: lang,
      p_principal: b?.principal === true,
      p_terms: b?.principal === true && b?.terms && typeof b.terms === "object" ? b.terms : null,
    });
    if (error) {
      // Codes lisibles par le front (useCoorgErrorText).
      const code = /([a-z_]+)$/.exec(String(error.message ?? "").trim())?.[1] ?? "error";
      return json({ error: code }, 400, corsHeaders);
    }

    const baseOrigin = b?.origin && isAllowedOrigin(b.origin) ? b.origin : DEFAULT_APP_ORIGIN;
    const acceptUrl = `${baseOrigin}/accept-cohost?token=${inv.token}`;

    const { data: isDemo } = await admin.rpc("is_demo_email", { p_email: inv.email });
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    let emailSent = false;
    if (RESEND_API_KEY && isDemo !== true) {
      const locale = lang === "es" ? "es-ES" : lang === "en" ? "en-GB" : "fr-FR";
      const { data: ev } = await admin.from("events").select("timezone").eq("id", b.event_id).maybeSingle();
      const eventDateLabel = inv.event_start_at
        ? new Date(inv.event_start_at).toLocaleString(locale, {
          weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
          timeZone: ev?.timezone || "Europe/Paris",
        })
        : null;
      const mail = buildCoorgInvitation({
        lang,
        inviterName: inv.inviter_name,
        eventTitle: inv.event_title ?? "Yuno",
        eventDateLabel,
        venueName: inv.venue_name ?? null,
        access: inv.access === "viewer" ? "viewer" : "editor",
        principal: inv.role === "principal",
        message: inv.message ?? null,
        acceptUrl,
        expiresLabel: new Date(Date.now() + 14 * 86400_000).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" }),
      });
      const rawFrom = Deno.env.get("RESEND_FROM_EMAIL");
      const from = rawFrom ? (rawFrom.includes("<") ? rawFrom : `Yuno <${rawFrom}>`) : "Yuno <noreply@yunoapp.eu>";
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({ from, to: [inv.email], subject: mail.subject, html: mail.html }),
      });
      if (!resp.ok) console.error("Resend error:", await resp.text());
      else emailSent = true;
    }

    return json({ success: true, invitation_id: inv.id, email_sent: emailSent }, 200, corsHeaders);
  } catch (err: any) {
    console.error("coorg invite error:", err);
    return json({ error: "error" }, 500, corsHeaders);
  }
}
