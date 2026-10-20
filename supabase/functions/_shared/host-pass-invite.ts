// Accès « club hôte » — envoi de l'email d'invitation (action `kind: "host_pass"`
// de l'edge `invite-organizer-collab` : le quota de fonctions du projet
// interdit d'en créer une nouvelle).
//
// Toutes les règles vivent dans la RPC `prepare_event_guest_pass_email`, appelée
// AVEC LE JWT du pro (partie principale niveau ≥ 2, accès vivant, 5 envois au
// plus, 10 min entre deux, jamais en accès assisté). Ici on n'envoie que l'email,
// et jamais vers une adresse démo.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { buildHostPassEmail } from "./host-pass-email.ts";

const DEFAULT_APP_ORIGIN = "https://yunoapp.eu";
// Le lien de la page porte un jeton vivant : jamais une origine choisie par l'appelant.
const isAllowedOrigin = (o: string) => o === DEFAULT_APP_ORIGIN || o.startsWith("http://localhost");

export interface HostPassInviteBody {
  kind?: string;
  pass_id?: string | null;
  origin?: string;
}

interface PreparedHostPassEmail {
  token: string;
  email: string;
  language: string;
  guest_name: string;
  guest_kind: string;
  inviter_name: string;
  event_title: string;
  event_start_at: string | null;
  timezone: string | null;
  poster_url: string | null;
  location_name: string | null;
  location_city: string | null;
  is_demo: boolean;
}

const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });

export async function handleHostPassInvite(req: Request, b: HostPassInviteBody, corsHeaders: Record<string, string>): Promise<Response> {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "not_authenticated" }, 401, corsHeaders);
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data, error } = await userClient.rpc("prepare_event_guest_pass_email", { p_pass_id: b?.pass_id ?? null });
    if (error) {
      const code = /([a-z_]+)$/.exec(String(error.message ?? "").trim())?.[1] ?? "error";
      return json({ error: code }, 400, corsHeaders);
    }
    const inv = data as PreparedHostPassEmail;
    const baseOrigin = b?.origin && isAllowedOrigin(b.origin) ? b.origin : DEFAULT_APP_ORIGIN;
    const pageUrl = `${baseOrigin}/h/${inv.token}`;

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    let emailSent = false;
    if (RESEND_API_KEY && inv.is_demo !== true) {
      const mail = buildHostPassEmail({
        lang: inv.language,
        venueName: inv.guest_name,
        inviterName: inv.inviter_name,
        eventTitle: inv.event_title,
        eventStartAt: inv.event_start_at,
        timezone: inv.timezone,
        posterUrl: inv.poster_url,
        locationName: inv.location_name,
        locationCity: inv.location_city,
        pageUrl,
        recipientEmail: inv.email,
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
    return json({ success: true, email_sent: emailSent, demo: inv.is_demo === true }, 200, corsHeaders);
  } catch (err: unknown) {
    console.error("host pass invite error:", err);
    return json({ error: "error" }, 500, corsHeaders);
  }
}
