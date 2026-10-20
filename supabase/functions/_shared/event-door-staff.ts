// Staff de porte limité à UNE soirée (event_door_staff, migration 20261105230000).
//
//  • `handleEventDoorInviteEmail` — action `kind: "door_staff"` de l'edge
//    `invite-organizer-collab` : envoie l'invitation à un membre du staff du
//    club invité. Appelable SANS compte par l'invité (son jeton d'espace
//    suffit, `pass_token`) ou par l'organisateur (JWT) ; les règles vivent dans
//    la RPC `prepare_event_door_invite_email`. Jamais d'envoi vers une adresse démo.
//  • `handleAcceptEventDoor` — action `accept_event_door` de l'edge
//    `accept-staff-invitation` : crée le compte si besoin (même circuit que
//    l'acceptation d'une invitation staff), pose le rôle `bouncer` et rattache
//    la personne à la SEULE soirée (`accept_event_door_invite`, service_role).
//
// Le quota de fonctions edge du projet est atteint : deux actions de plus sur
// des fonctions existantes.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { buildInvitation, buildPasswordSetup, staffRoleLabel, type Lang } from "./email-templates.ts";

const APP = "https://yunoapp.eu";
const asLang = (v: unknown): Lang => (v === "fr" || v === "en" || v === "es" ? v : "en");
const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });

interface DoorInviteMail {
  invite_token: string;
  email: string | null;
  name: string;
  event_title: string;
  event_start_at: string;
  timezone: string;
  language: string;
  inviter_name: string;
  is_demo: boolean;
}

export function eventDoorAcceptUrl(token: string): string {
  return `${APP}/accept-staff-invitation?door=${token}`;
}

export async function handleEventDoorInviteEmail(
  req: Request,
  b: { staff_id?: string; pass_token?: string | null },
  corsHeaders: Record<string, string>,
): Promise<Response> {
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const authHeader = req.headers.get("Authorization") ?? `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`;
    const client = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data, error } = await client.rpc("prepare_event_door_invite_email", {
      p_staff_id: b?.staff_id ?? null,
      p_pass_token: b?.pass_token ?? null,
    });
    if (error) {
      const code = /([a-z_]+)$/.exec(String(error.message ?? "").trim())?.[1] ?? "error";
      return json({ error: code }, 400, corsHeaders);
    }
    const inv = data as DoorInviteMail;
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    let emailSent = false;
    if (RESEND_API_KEY && inv.email && inv.is_demo !== true) {
      const lang = asLang(inv.language);
      const mail = buildInvitation({
        lang,
        inviterName: inv.inviter_name,
        orgName: inv.event_title,
        roleLabel: staffRoleLabel("bouncer", lang),
        staffRole: "bouncer",
        acceptUrl: eventDoorAcceptUrl(inv.invite_token),
      });
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({ from: "Yuno <contact@yunoapp.eu>", to: [inv.email], subject: mail.subject, html: mail.html }),
      });
      if (!resp.ok) console.error("door invite email failed:", resp.status, await resp.text().catch(() => ""));
      else emailSent = true;
    }
    return json({ success: true, email_sent: emailSent, demo: inv.is_demo === true }, 200, corsHeaders);
  } catch (err: unknown) {
    console.error("door invite error:", err);
    return json({ error: "error" }, 500, corsHeaders);
  }
}

interface DoorInviteView {
  found: boolean;
  status?: string;
  has_email?: boolean;
  open?: boolean;
  name?: string;
  event_title?: string;
  language?: string;
}

export async function handleAcceptEventDoor(
  req: Request,
  supabase: SupabaseClient,
  body: Record<string, unknown>,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const token = String(body.token ?? "");
  if (!/^[0-9a-f]{32}$/.test(token)) return json({ error: "not_found" }, 400, corsHeaders);

  const { data: view } = await supabase.rpc("get_event_door_invite", { p_token: token });
  const inv = (view ?? { found: false }) as DoorInviteView;
  if (!inv.found) return json({ error: "not_found" }, 404, corsHeaders);
  if (!inv.open) return json({ error: "event_closed" }, 400, corsHeaders);

  // L'adresse de l'invitation (lue côté serveur), sinon celle que la personne donne.
  const { data: row } = await supabase.from("event_door_staff").select("email, display_name").eq("token", token).maybeSingle();
  const invitedEmail = (row?.email as string | null) ?? null;
  const given = String(body.email ?? "").trim().toLowerCase();
  const lang = asLang(body.language ?? inv.language);

  let userId: string | null = null;
  let email = invitedEmail ?? given;
  let accountCreated = false;
  let passwordResetSent = false;

  const authHeader = req.headers.get("Authorization");
  if (authHeader) {
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (user?.email) {
      if (invitedEmail && user.email.toLowerCase() !== invitedEmail) {
        return json({ error: "email_mismatch", invited_email: invitedEmail, signed_in_email: user.email }, 403, corsHeaders);
      }
      userId = user.id;
      email = user.email.toLowerCase();
    }
  }
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "email_required" }, 400, corsHeaders);

  if (!userId) {
    const { data: liveId } = await supabase.rpc("auth_user_id_for_email", { _email: email });
    if (liveId) {
      userId = liveId as string;
    } else {
      const { data: created, error: createError } = await supabase.auth.admin.createUser({
        email, password: crypto.randomUUID(), email_confirm: true,
        user_metadata: { first_name: row?.display_name ?? "" },
      });
      if (createError || !created.user) return json({ error: "account_failed" }, 500, corsHeaders);
      userId = created.user.id;
      accountCreated = true;
      const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
      if (RESEND_API_KEY) {
        const { data: reset } = await supabase.auth.admin.generateLink({
          type: "recovery", email, options: { redirectTo: `${APP}/auth` },
        });
        if (reset?.properties?.action_link) {
          const mail = buildPasswordSetup({
            lang, orgName: inv.event_title, roleLabel: staffRoleLabel("bouncer", lang), staffRole: "bouncer",
            setupUrl: reset.properties.action_link,
          });
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ from: "Yuno <contact@yunoapp.eu>", to: [email], subject: mail.subject, html: mail.html }),
          });
          passwordResetSent = res.ok;
        }
      }
    }
  }

  // La porte de CETTE soirée d'abord (règles dans la RPC), puis le rôle qui
  // ouvre l'écran du videur dans Yuno Pro.
  const { error: acceptError } = await supabase.rpc("accept_event_door_invite", {
    p_token: token, p_user_id: userId, p_email: email,
  });
  if (acceptError) {
    const code = /([a-z_]+)$/.exec(String(acceptError.message ?? "").trim())?.[1] ?? "error";
    return json({ error: code }, 400, corsHeaders);
  }
  const { error: roleError } = await supabase.from("user_roles")
    .upsert({ user_id: userId, role: "bouncer", email }, { onConflict: "user_id,role" });
  if (roleError) return json({ error: "link_failed" }, 500, corsHeaders);

  return json({
    success: true, role: "bouncer", event_title: inv.event_title,
    account_created: accountCreated, password_reset_sent: passwordResetSent, redirect: "/setup-pin",
  }, 200, corsHeaders);
}
