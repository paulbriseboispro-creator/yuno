// Staff de porte limité à UNE soirée (event_door_staff, migration 20261105230000).
//
//  • `handleEventDoorInviteEmail` — action `kind: "door_staff"` de l'edge
//    `invite-organizer-collab` : envoie l'invitation à un membre du staff du
//    club invité. Appelable SANS compte par l'invité (son jeton d'espace
//    suffit, `pass_token`) ou par l'organisateur (JWT) ; les règles vivent dans
//    la RPC `prepare_event_door_invite_email`. Jamais d'envoi vers une adresse démo.
//  • `handleAcceptEventDoor` — action `accept_event_door` de l'edge
//    `accept-staff-invitation`. Deux temps (27/10, refonte « une nuit, des gens
//    pressés ») : `step: "send_code"` crée le compte Yuno si besoin et envoie un
//    code à l'adresse de l'invitation ; la personne le tape, l'app ouvre SA
//    session (verifyOtp), puis l'acceptation se fait CONNECTÉE : rôle `bouncer`,
//    rattachement à la seule soirée (`accept_event_door_invite`), et l'app
//    l'envoie droit sur le scanner. Plus de mot de passe ni de code PIN.
//  • `handleStaffLoginCode` — action `staff_login_code` : le même code pour se
//    reconnecter à Yuno Pro, autant de fois qu'il faut (nouveau téléphone, app
//    réinstallée), pour toute adresse qui tient un poste de staff.
//
// Le quota de fonctions edge du projet est atteint : deux actions de plus sur
// des fonctions existantes.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { buildDoorInvitation, buildOtp, type Lang } from "./email-templates.ts";
import { isDemoEmail } from "./demo-guard.ts";

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
      const mail = buildDoorInvitation({
        lang,
        inviterName: inv.inviter_name,
        eventTitle: inv.event_title,
        eventStartAt: inv.event_start_at,
        timezone: inv.timezone,
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

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CODE_WINDOW_MS = 15 * 60 * 1000;
const CODE_MAX_SENDS = 4;

/**
 * Envoie un code de connexion Yuno (celui de Supabase Auth, 8 chiffres, 1 h) à
 * une adresse, dans un e-mail aux couleurs de Yuno. L'app le passe à
 * `supabase.auth.verifyOtp({ type: 'email' })` : c'est une vraie connexion au
 * compte, sans mot de passe. Freiné à 4 envois / 15 min par adresse. Jamais
 * vers une adresse démo.
 */
async function sendLoginCode(
  supabase: SupabaseClient,
  email: string,
  lang: Lang,
  context: string,
): Promise<"sent" | "rate_limited" | "demo" | "failed"> {
  if (isDemoEmail(email)) return "demo";
  const { data: attempts } = await supabase.rpc("upsert_staff_pin_rate_limit", {
    p_ip: `login-code:${email}`,
    p_window_cutoff: new Date(Date.now() - CODE_WINDOW_MS).toISOString(),
    p_max_attempts: CODE_MAX_SENDS,
  });
  if (typeof attempts === "number" && attempts > CODE_MAX_SENDS) return "rate_limited";
  const { data: link, error } = await supabase.auth.admin.generateLink({ type: "magiclink", email });
  const code = (link?.properties as { email_otp?: string } | undefined)?.email_otp;
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (error || !code || !RESEND_API_KEY) return "failed";
  const mail = buildOtp({
    lang, code, expiresMin: 60, context,
    purposeLabel: lang === "fr" ? "Ton code pour Yuno Pro" : lang === "es" ? "Tu código para Yuno Pro" : "Your Yuno Pro code",
  });
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "Yuno <contact@yunoapp.eu>", to: [email], subject: mail.subject, html: mail.html }),
  });
  return res.ok ? "sent" : "failed";
}

function codeContext(lang: Lang, eventTitle?: string | null): string {
  if (eventTitle) {
    return lang === "fr" ? `Tape ce code dans Yuno Pro pour tenir la porte de ${eventTitle}.`
      : lang === "es" ? `Escribe este código en Yuno Pro para llevar la puerta de ${eventTitle}.`
      : `Type this code in Yuno Pro to run the door of ${eventTitle}.`;
  }
  return lang === "fr" ? "Tape ce code dans Yuno Pro pour te connecter."
    : lang === "es" ? "Escribe este código en Yuno Pro para entrar."
    : "Type this code in Yuno Pro to sign in.";
}

/** Session de l'appelant, s'il en envoie une (jamais la clé publique). */
async function callerUser(req: Request, supabase: SupabaseClient) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  return user?.email ? user : null;
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
  const invitedEmail = ((row?.email as string | null) ?? "").trim().toLowerCase() || null;
  const given = String(body.email ?? "").trim().toLowerCase();
  const lang = asLang(body.language ?? inv.language);

  // 1er temps : le code. Le compte naît ici s'il n'existe pas (sans mot de
  // passe utilisable : on s'y connecte par code, ou par Apple / Google).
  if (body.step === "send_code") {
    const email = invitedEmail ?? given;
    if (!EMAIL_RE.test(email)) return json({ error: "email_required" }, 400, corsHeaders);
    let accountCreated = false;
    const { data: liveId } = await supabase.rpc("auth_user_id_for_email", { _email: email });
    if (!liveId) {
      const { data: created, error: createError } = await supabase.auth.admin.createUser({
        email, password: crypto.randomUUID(), email_confirm: true,
        user_metadata: { first_name: row?.display_name ?? "" },
      });
      if (createError || !created.user) return json({ error: "account_failed" }, 500, corsHeaders);
      accountCreated = true;
    }
    const sent = await sendLoginCode(supabase, email, lang, codeContext(lang, inv.event_title));
    if (sent === "rate_limited") return json({ error: "code_rate_limited" }, 429, corsHeaders);
    if (sent === "failed") return json({ error: "code_failed" }, 500, corsHeaders);
    return json({ success: true, email, account_created: accountCreated, demo: sent === "demo" }, 200, corsHeaders);
  }

  // 2e temps : connecté. L'invitation partie par e-mail ne s'accepte qu'avec
  // CE compte ; celle partie par WhatsApp, avec le compte qui vient de prouver
  // son adresse par le code.
  const user = await callerUser(req, supabase);
  if (!user) return json({ error: "sign_in_required" }, 401, corsHeaders);
  const email = user.email!.toLowerCase();
  if (invitedEmail && email !== invitedEmail) {
    return json({ error: "email_mismatch", invited_email: invitedEmail, signed_in_email: user.email }, 403, corsHeaders);
  }

  // La porte de CETTE soirée d'abord (règles dans la RPC), puis le rôle qui
  // ouvre l'écran du videur dans Yuno Pro.
  const { error: acceptError } = await supabase.rpc("accept_event_door_invite", {
    p_token: token, p_user_id: user.id, p_email: email,
  });
  if (acceptError) {
    const code = /([a-z_]+)$/.exec(String(acceptError.message ?? "").trim())?.[1] ?? "error";
    return json({ error: code }, 400, corsHeaders);
  }
  const { error: roleError } = await supabase.from("user_roles")
    .upsert({ user_id: user.id, role: "bouncer", email }, { onConflict: "user_id,role" });
  if (roleError) return json({ error: "link_failed" }, 500, corsHeaders);

  return json({ success: true, role: "bouncer", event_title: inv.event_title, redirect: "/bouncer" }, 200, corsHeaders);
}

/**
 * Code de reconnexion à Yuno Pro pour le staff de nuit. Répond toujours
 * « envoyé » : on ne dit jamais si une adresse a un compte. N'envoie qu'à une
 * adresse qui tient un poste (videur, barman, vestiaire, hôte VIP, manager) ou
 * une porte de soirée.
 */
export async function handleStaffLoginCode(
  supabase: SupabaseClient,
  body: Record<string, unknown>,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const email = String(body.email ?? "").trim().toLowerCase();
  const lang = asLang(body.language);
  if (!EMAIL_RE.test(email)) return json({ error: "email_required" }, 400, corsHeaders);
  const { data: userId } = await supabase.rpc("auth_user_id_for_email", { _email: email });
  if (userId) {
    const [{ count: roles }, { count: doors }] = await Promise.all([
      supabase.from("user_roles").select("role", { count: "exact", head: true })
        .eq("user_id", userId as string).in("role", ["bouncer", "barman", "cloakroom", "vip_host", "manager"]),
      supabase.from("event_door_staff").select("id", { count: "exact", head: true })
        .eq("user_id", userId as string).eq("status", "accepted"),
    ]);
    if ((roles ?? 0) + (doors ?? 0) > 0) {
      const sent = await sendLoginCode(supabase, email, lang, codeContext(lang));
      if (sent === "rate_limited") return json({ error: "code_rate_limited" }, 429, corsHeaders);
    }
  }
  return json({ success: true }, 200, corsHeaders);
}
