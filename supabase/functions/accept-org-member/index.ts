import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildPasswordSetup } from "../_shared/email-templates.ts";

/**
 * Acceptation d'une invitation d'équipe organisateur (admin / editor / scanner).
 *
 * Le lien de l'email pointe sur `/accept-org-member?token=…`. Cette page appelle
 * ici deux fois : `describe` pour savoir QUI est invité et à QUOI, puis `accept`.
 *
 * Deux chemins, parce que l'invité peut ne pas encore exister chez Yuno :
 *
 *  • Il a déjà un compte → l'acceptation passe par la RPC
 *    `accept_org_member_invitation`, qui porte la règle (email qui correspond,
 *    invitation encore en attente, non expirée, pas de session d'accès assisté).
 *    C'est la base qui décide, pas cette fonction.
 *
 *  • Il n'a pas de compte → on le crée avec l'email de l'invitation, on lui
 *    envoie le mail « choisis ton mot de passe », puis on relie l'invitation
 *    côté serveur. Sans ça, l'invité tombait sur « connecte-toi d'abord » sans
 *    avoir de compte à créer avec le bon email : un cul-de-sac.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APP_URL = "https://yunoapp.eu";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Un compte VIVANT pour cet email, ou null. Jamais `profiles` : une suppression
 *  douce y laisse des profils orphelins, et un doublon ferait tomber la requête. */
async function liveAuthUserIdForEmail(admin: SupabaseClient, email: string): Promise<string | null> {
  const { data, error } = await admin.rpc("auth_user_id_for_email", { _email: email.toLowerCase() });
  if (error) {
    console.error("auth_user_id_for_email failed:", error.message);
    return null;
  }
  return (data as string | null) ?? null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({}));
    const action: string = body?.action ?? "accept";
    const token: string | undefined = body?.token;
    const firstName: string | undefined = body?.first_name;
    const lastName: string | undefined = body?.last_name;

    if (!token) return json({ error: "Missing token" }, 400);

    const { data: invitation } = await admin
      .from("org_members")
      .select("*, profiles!org_members_organizer_user_id_fkey(organization_name)")
      .eq("invitation_token", token)
      .maybeSingle();

    if (!invitation) return json({ error: "Invitation introuvable", code: "not_found" }, 404);

    const orgName =
      (invitation as { profiles?: { organization_name?: string | null } | null }).profiles
        ?.organization_name ?? "Yuno";
    const invitedEmail = String(invitation.member_email).toLowerCase();
    const expired = new Date(invitation.expires_at) < new Date();

    // ---------------------------------------------------------------- describe
    // Lecture publique du strict nécessaire pour dessiner l'écran. Elle répond
    // même sur une invitation close ou périmée : la page doit pouvoir le DIRE,
    // pas afficher une erreur nue. `verify` est conservé — c'est le nom qu'une
    // ancienne version appelait.
    if (action === "describe" || action === "verify") {
      const hasAccount = !!(await liveAuthUserIdForEmail(admin, invitedEmail));
      return json({
        invitation: {
          email: invitedEmail,
          role: invitation.role,
          organization_name: orgName,
          status: expired ? "expired" : invitation.invitation_status,
          requires_account_creation: !hasAccount,
        },
      });
    }

    if (action !== "accept") return json({ error: "Unknown action" }, 400);

    // ------------------------------------------------------------------ accept
    if (invitation.invitation_status === "revoked") {
      return json({ error: "Cette invitation a été annulée.", code: "revoked" }, 400);
    }
    if (expired && invitation.invitation_status === "pending") {
      return json({ error: "Cette invitation a expiré.", code: "expired" }, 400);
    }

    const authHeader = req.headers.get("Authorization");

    // 1) Personne déjà connectée : la base tranche.
    if (authHeader) {
      const asUser = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await asUser.auth.getUser();

      if (user) {
        const { data: res, error } = await asUser.rpc("accept_org_member_invitation", {
          p_token: token,
        });
        if (error) {
          console.error("accept_org_member_invitation failed:", error.message);
          return json({ error: error.message }, 500);
        }
        const out = res as {
          ok: boolean; code?: string; already?: boolean;
          organizer_user_id?: string; role?: string;
          invited_email?: string; signed_in_email?: string;
        };
        if (out.ok) {
          return json({
            success: true,
            already: !!out.already,
            role: out.role ?? invitation.role,
            organization_name: orgName,
            organizer_user_id: out.organizer_user_id,
          });
        }
        // On NOMME les deux emails : « connecte-toi avec le bon compte » sans
        // dire lequel est un cul-de-sac, et c'est le cas le plus fréquent (on
        // ouvre ses mails sur le téléphone déjà connecté à son compte client).
        if (out.code === "email_mismatch") {
          return json({
            error: `Vous êtes connecté avec ${out.signed_in_email ?? "un autre compte"}, mais cette invitation a été envoyée à ${out.invited_email ?? invitedEmail}.`,
            code: "email_mismatch",
            invited_email: out.invited_email ?? invitedEmail,
            signed_in_email: out.signed_in_email,
          }, 403);
        }
        if (out.code === "support_session") {
          return json({
            error: "Une session d'accès assisté ne peut pas accepter une invitation à la place du pro.",
            code: "support_session",
          }, 403);
        }
        if (out.code === "expired") return json({ error: "Cette invitation a expiré.", code: "expired" }, 400);
        if (out.code === "not_pending") {
          return json({ error: "Cette invitation a déjà été utilisée ou annulée.", code: "not_pending" }, 400);
        }
        return json({ error: "Invitation introuvable", code: out.code ?? "not_found" }, 404);
      }
    }

    // 2) Personne pas connectée. Si l'email de l'invitation a déjà un compte, on
    //    ne peut rien faire pour elle ici : il faut sa session.
    if (invitation.invitation_status !== "pending") {
      return json({ error: "Cette invitation a déjà été utilisée ou annulée.", code: "not_pending" }, 400);
    }

    const existingUserId = await liveAuthUserIdForEmail(admin, invitedEmail);
    if (existingUserId) {
      return json({
        error: "Un compte existe déjà pour cet email. Connecte-toi, puis rouvre ce lien.",
        code: "sign_in_required",
        invited_email: invitedEmail,
      }, 401);
    }

    // 3) Aucun compte : on le crée avec l'email de l'invitation. C'est la seule
    //    façon que l'email de l'invitation et celui du compte coïncident, donc
    //    que l'acceptation passe.
    const { data: newUser, error: createError } = await admin.auth.admin.createUser({
      email: invitedEmail,
      password: crypto.randomUUID(),
      email_confirm: true,
      user_metadata: { first_name: firstName ?? "", last_name: lastName ?? "" },
    });
    if (createError || !newUser.user) {
      console.error("accept-org-member createUser failed:", createError?.message);
      return json({ error: "Erreur lors de la création du compte" }, 500);
    }
    const userId = newUser.user.id;

    if (firstName || lastName) {
      await admin.from("profiles").update({
        first_name: firstName || null,
        last_name: lastName || null,
      }).eq("id", userId);
    }

    const { error: linkError } = await admin
      .from("org_members")
      .update({
        member_user_id: userId,
        invitation_status: "accepted",
        accepted_at: new Date().toISOString(),
      })
      .eq("id", invitation.id);
    if (linkError) {
      console.error("accept-org-member link failed:", linkError.message);
      return json({ error: linkError.message }, 500);
    }

    // Le mot de passe temporaire n'est connu de personne : sans ce mail, le
    // compte existe mais reste inaccessible.
    let passwordResetSent = false;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (resendApiKey) {
      const { data: resetData } = await admin.auth.admin.generateLink({
        type: "recovery",
        email: invitedEmail,
        options: { redirectTo: `${APP_URL}/auth` },
      });
      if (resetData?.properties?.action_link) {
        const roleLabel =
          invitation.role === "admin" ? "Administrateur"
          : invitation.role === "editor" ? "Éditeur"
          : "Scanner";
        const mail = buildPasswordSetup({
          lang: "fr",
          orgName,
          roleLabel,
          setupUrl: resetData.properties.action_link,
        });
        const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") ?? "noreply@yunoapp.eu";
        const from = fromEmail.includes("<") ? fromEmail : `Yuno <${fromEmail}>`;
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to: [invitedEmail], subject: mail.subject, html: mail.html }),
        });
        if (res.ok) passwordResetSent = true;
        else console.error("accept-org-member password email failed:", res.status, await res.text().catch(() => ""));
      }
    }

    return json({
      success: true,
      already: false,
      account_created: true,
      password_reset_sent: passwordResetSent,
      role: invitation.role,
      organization_name: orgName,
      organizer_user_id: invitation.organizer_user_id,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in accept-org-member:", message);
    return json({ error: message }, 500);
  }
});
