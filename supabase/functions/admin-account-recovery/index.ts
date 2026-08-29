// admin-account-recovery — actions pro déclenchées par un super admin, PLUS le
// cycle de session de l'accès support assisté (voir migration 20260824120000).
//
// Dispatcher sur body.action :
//   • "reset-password"        (admin) — lien de réinitialisation GoTrue par email.
//   • "open-support-session"  (admin) — sur un grant ACTIF approuvé par le client,
//                              mint une session GoTrue POUR le client (magiclink
//                              consommé côté serveur), l'enregistre dans
//                              admin_support_sessions (le claim session_id du JWT
//                              est la clé de tous les verrous), renvoie les tokens.
//   • "end-support-session"   (session support) — clôt la session courante ;
//                              n'exige PAS le rôle admin car l'appelant porte
//                              alors l'identité du client, mais ne peut fermer QUE
//                              la session dont il détient le JWT.
//   • "create-showcase-owner" (admin) — crée le compte FANTÔME d'une venue
//                              vitrine (prospection) : user jetable propriétaire
//                              d'une venue cachée, marqueur
//                              venues.showcase_shadow_owner_id posé, et renvoie
//                              un magiclink que l'admin ouvre en fenêtre privée
//                              pour construire le contenu. Voir migration
//                              20260826100000. (Logée ici et pas dans une
//                              fonction dédiée : cap Supabase sur les nouvelles
//                              edge functions.)
//   • "create-showcase-organizer" (admin) — pendant ORGANISATEUR : user jetable
//                              portant un organizer_profiles privé marqué
//                              is_showcase_shadow (migration 20260826110000).
//                              La réclamation re-parente tout via
//                              handoff_showcase_organizer.
//   • "request-support-access" (admin) — crée (ou relance) une demande d'accès
//                              assisté EN ATTENTE et prévient le pro par EMAIL
//                              (en plus de la notif in-app + push posées par
//                              les triggers) avec un bouton vers sa page
//                              d'acceptation. Le consentement reste chez lui :
//                              rien ne s'ouvre tant qu'il n'a pas approuvé.
//
// Le reset MFA se fait via la RPC admin_reset_user_mfa ; la suspension via
// admin_set_user_suspended ; approbation/révocation d'un grant via les RPC
// approve_support_grant / revoke_support_grant (côté client).
//
// NB déploiement : verify_jwt = true (config.toml). "end-support-session" reste
// joignable car la session support EST un JWT valide.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { buildSecureLink } from "../_shared/email-templates.ts";
import { restrictedCorsHeaders } from "../_shared/cors.ts";
import { jwtSessionId } from "../_shared/support-session.ts";

const APP_URL = "https://yunoapp.eu";

type Lang = "en" | "fr" | "es";

const COPY: Record<Lang, { subject: string; title: string; body: string; cta: string; ignore: string }> = {
  fr: {
    subject: "Réinitialisation de votre mot de passe Yuno",
    title: "Réinitialisez votre mot de passe",
    body: "L'équipe Yuno a initié une réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour en choisir un nouveau.",
    cta: "Choisir un nouveau mot de passe",
    ignore: "Si vous n'avez rien demandé, contactez support@yunoapp.eu.",
  },
  en: {
    subject: "Reset your Yuno password",
    title: "Reset your password",
    body: "The Yuno team initiated a password reset for your account. Click the button below to choose a new one.",
    cta: "Choose a new password",
    ignore: "If you didn't request this, contact support@yunoapp.eu.",
  },
  es: {
    subject: "Restablece tu contraseña de Yuno",
    title: "Restablece tu contraseña",
    body: "El equipo de Yuno inició un restablecimiento de tu contraseña. Haz clic en el botón para elegir una nueva.",
    cta: "Elegir una nueva contraseña",
    ignore: "Si no lo solicitaste, contacta support@yunoapp.eu.",
  },
};

serve(async (req) => {
  const corsHeaders = restrictedCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
  const fail = (message: string, status = 400) =>
    new Response(JSON.stringify({ error: message }), { headers: jsonHeaders, status });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail("Not authenticated", 401);
    const callerToken = authHeader.replace("Bearer ", "");

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) return fail("Not authenticated", 401);

    const body = await req.json().catch(() => ({}));
    const action: string = body.action ?? "reset-password";

    // ── end-support-session : accessible à la session support elle-même ────────
    // (l'appelant porte l'identité du client, pas le rôle admin).
    if (action === "end-support-session") {
      const sid = jwtSessionId(callerToken);
      if (!sid) return fail("no_session_id", 400);
      const { data: sess } = await supabaseAdmin
        .from("admin_support_sessions")
        .select("id, grant_id, target_user_id, admin_id")
        .eq("auth_session_id", sid)
        .eq("status", "active")
        .maybeSingle();
      if (!sess) return new Response(JSON.stringify({ success: true, alreadyEnded: true }), { headers: jsonHeaders });

      // La RPC supprime AUSSI la session GoTrue : marquer la ligne « ended »
      // sans révoquer le jeton laisserait l'admin avec un access token encore
      // valide — et, pire, un jeton que les gardes ne reconnaîtraient plus.
      await supabaseAdmin.rpc("end_support_session", { _session_id: sess.id });
      await supabaseAdmin.from("admin_support_audit").insert({
        grant_id: sess.grant_id, session_id: sess.id, target_user_id: sess.target_user_id,
        actor_id: sess.admin_id, action: "session_ended",
      });
      return new Response(JSON.stringify({ success: true }), { headers: jsonHeaders });
    }

    // ── Toutes les autres actions exigent le rôle super admin ──────────────────
    const { data: adminRole } = await supabaseAdmin
      .from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!adminRole) return fail("Admin role required", 403);

    // ── request-support-access : demande d'accès assisté + email au pro ────────
    if (action === "request-support-access") {
      const targetId: string | undefined = typeof body.userId === "string" ? body.userId : undefined;
      const reason: string | null = typeof body.reason === "string" ? body.reason.trim() || null : null;
      if (!targetId) return fail("userId is required", 400);
      if (targetId === user.id) return fail("cannot_target_self", 400);

      const { data: target } = await supabaseAdmin
        .from("profiles")
        .select("id, email, preferred_language, profile_type, first_name, organization_name")
        .eq("id", targetId)
        .maybeSingle();
      if (!target?.email) return fail("target_not_found", 404);

      // Un accord ouvert existe déjà ? Actif → rien à demander. En attente →
      // on le RÉUTILISE et on renvoie l'email (bouton « Relancer »).
      const { data: openGrant } = await supabaseAdmin
        .from("admin_support_grants")
        .select("id, status")
        .eq("target_user_id", targetId)
        .in("status", ["pending", "active"])
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (openGrant?.status === "active") {
        return new Response(JSON.stringify({ success: true, already_active: true }), { headers: jsonHeaders });
      }

      let grantId = openGrant?.id ?? null;
      if (!grantId) {
        const { data: created, error: grantErr } = await supabaseAdmin
          .from("admin_support_grants")
          .insert({ target_user_id: targetId, requested_by: user.id, reason })
          .select("id")
          .single();
        if (grantErr) return fail(grantErr.message, 500);
        grantId = created.id;
      }

      // La page d'acceptation dépend du rôle du pro (chaque app a la sienne).
      const { data: roleRows } = await supabaseAdmin
        .from("user_roles").select("role").eq("user_id", targetId);
      const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
      const acceptPath = roles.includes("owner")
        ? "/owner/support-access"
        : (roles.includes("organizer") || target.profile_type === "organizer")
        ? "/organizer-app/support-access"
        : roles.includes("manager")
        ? "/manager/support-access"
        : "/owner/support-access";

      const lang: Lang = (["en", "es", "fr"].includes(target.preferred_language) ? target.preferred_language : "fr") as Lang;
      const SUPPORT_COPY: Record<Lang, { subject: string; title: string; body: string; cta: string; footnote: string }> = {
        fr: {
          subject: "Yuno propose de configurer votre compte avec vous",
          title: "L'équipe Yuno vous propose son aide",
          body: `L'équipe Yuno demande votre accord pour ouvrir un accès d'assistance à votre compte et tout configurer avec vous.${reason ? ` Motif : ${reason}` : ""} Vos paiements, votre email de connexion et votre double authentification restent verrouillés, chaque action est journalisée, et vous coupez l'accès quand vous voulez.`,
          cta: "Examiner et accepter la demande",
          footnote: "Rien ne s'ouvre sans votre accord. Si vous n'êtes pas à l'origine de ce contact, ignorez cet email.",
        },
        en: {
          subject: "Yuno offers to set up your account with you",
          title: "The Yuno team offers to help",
          body: `The Yuno team is asking for your approval to open a support access to your account and set everything up with you.${reason ? ` Reason: ${reason}` : ""} Your payments, login email and two-factor stay locked, every action is logged, and you can cut access anytime.`,
          cta: "Review and accept the request",
          footnote: "Nothing opens without your approval. If you weren't expecting this, just ignore this email.",
        },
        es: {
          subject: "Yuno propone configurar tu cuenta contigo",
          title: "El equipo de Yuno te ofrece su ayuda",
          body: `El equipo de Yuno pide tu aprobación para abrir un acceso de asistencia a tu cuenta y configurarlo todo contigo.${reason ? ` Motivo: ${reason}` : ""} Tus pagos, tu email de acceso y tu doble factor permanecen bloqueados, cada acción queda registrada y puedes cortar el acceso cuando quieras.`,
          cta: "Revisar y aceptar la solicitud",
          footnote: "Nada se abre sin tu aprobación. Si no esperabas este contacto, ignora este email.",
        },
      };
      const copy = SUPPORT_COPY[lang];

      const resendApiKey = Deno.env.get("RESEND_API_KEY");
      let emailSent = false;
      if (resendApiKey) {
        const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "noreply@yunoapp.eu";
        const mail = buildSecureLink({
          lang,
          title: copy.title,
          message: copy.body,
          ctaLabel: copy.cta,
          ctaUrl: `${APP_URL}${acceptPath}`,
          footnote: copy.footnote,
        });
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendApiKey}` },
          body: JSON.stringify({ from: `Yuno <${fromEmail}>`, to: [target.email], subject: copy.subject, html: mail.html }),
        });
        if (!res.ok) {
          const errBody = await res.text().catch(() => "");
          console.error("[ADMIN-ACCOUNT-RECOVERY] support request email failed:", res.status, errBody);
        } else {
          emailSent = true;
        }
      }

      return new Response(JSON.stringify({
        success: true,
        grant_id: grantId,
        reused: !!openGrant,
        emailSent,
      }), { headers: jsonHeaders });
    }

    // ── create-showcase-owner : compte fantôme d'une venue vitrine ─────────────
    if (action === "create-showcase-owner") {
      const venueId: string | undefined = typeof body.venueId === "string" ? body.venueId.trim() : undefined;
      const email: string | undefined = typeof body.email === "string" ? body.email.trim().toLowerCase() : undefined;
      if (!venueId || !email) return fail("venueId and email are required", 400);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("invalid_email", 400);
      // Le suffixe @womber.fr court-circuite paymentsReady et affiche le
      // DemoSwitcher : un fantôme démo fausserait l'aperçu acheteur du prospect.
      if (email.endsWith("@womber.fr")) return fail("womber_email_forbidden", 400);

      const { data: venue } = await supabaseAdmin
        .from("venues")
        .select("id, owner_id, showcase_shadow_owner_id")
        .eq("id", venueId)
        .maybeSingle();
      if (!venue) return fail("venue_not_found", 404);

      // Jamais voler un vrai owner : seule une venue sans owner, ou déjà portée
      // par son propre fantôme (relance idempotente), est éligible.
      if (venue.owner_id && venue.owner_id !== venue.showcase_shadow_owner_id) {
        return fail("venue_already_owned", 409);
      }

      // Créer le user fantôme — ou le retrouver s'il existe déjà pour CETTE venue.
      let shadowId: string | null = null;
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
        password: crypto.randomUUID() + crypto.randomUUID(),
      });
      if (createErr) {
        const { data: existing } = await supabaseAdmin
          .from("profiles").select("id").eq("email", email).maybeSingle();
        if (!existing || existing.id !== venue.showcase_shadow_owner_id) {
          return fail("email_already_used", 409);
        }
        shadowId = existing.id;
      } else {
        shadowId = created.user.id;
      }

      await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: shadowId, role: "owner", email }, { onConflict: "user_id,role" });

      const { error: venueErr } = await supabaseAdmin
        .from("venues")
        .update({ owner_id: shadowId, is_hidden: true, showcase_shadow_owner_id: shadowId })
        .eq("id", venueId);
      if (venueErr) return fail("venue_update_failed", 500);

      // mfa_exempt : sans lui, la session de construction (magiclink, hors mode
      // preview) serait redirigée vers /mfa-setup.
      const { data: profRows } = await supabaseAdmin
        .from("profiles")
        .update({ venue_id: venueId, mfa_exempt: true })
        .eq("id", shadowId)
        .select("id");
      if (!profRows?.length) {
        await supabaseAdmin
          .from("profiles")
          .insert({ id: shadowId, email, venue_id: venueId, mfa_exempt: true });
      }

      const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: { redirectTo: `${APP_URL}/owner/dashboard` },
      });
      if (linkErr || !linkData?.properties?.action_link) return fail("mint_link_failed", 502);

      await supabaseAdmin.from("admin_audit_log").insert({
        admin_id: user.id,
        action: "showcase_owner_created",
        entity_type: "venue",
        entity_id: venueId,
        metadata: { email, shadow_user_id: shadowId },
      });

      return new Response(JSON.stringify({
        success: true,
        user_id: shadowId,
        action_link: linkData.properties.action_link,
      }), { headers: jsonHeaders });
    }

    // ── create-showcase-organizer : compte fantôme d'un profil orga vitrine ────
    if (action === "create-showcase-organizer") {
      const orgName: string | undefined = typeof body.name === "string" ? body.name.trim() : undefined;
      const email: string | undefined = typeof body.email === "string" ? body.email.trim().toLowerCase() : undefined;
      if (!orgName || !email) return fail("name and email are required", 400);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("invalid_email", 400);
      // Même règle que les vitrines club : jamais @womber.fr (paymentsReady,
      // DemoSwitcher).
      if (email.endsWith("@womber.fr")) return fail("womber_email_forbidden", 400);

      // Créer le user fantôme — ou le retrouver s'il est déjà le fantôme d'une
      // vitrine orga (relance idempotente pour regénérer le lien builder).
      let shadowId: string | null = null;
      let alreadyShadow = false;
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
        password: crypto.randomUUID() + crypto.randomUUID(),
      });
      if (createErr) {
        const { data: existing } = await supabaseAdmin
          .from("profiles").select("id").eq("email", email).maybeSingle();
        if (!existing) return fail("email_already_used", 409);
        const { data: orgRow } = await supabaseAdmin
          .from("organizer_profiles")
          .select("user_id, is_showcase_shadow")
          .eq("user_id", existing.id)
          .maybeSingle();
        if (!orgRow?.is_showcase_shadow) return fail("email_already_used", 409);
        shadowId = existing.id;
        alreadyShadow = true;
      } else {
        shadowId = created.user.id;
      }

      // profile_type='organizer' ouvre l'app orga (OrgAppRoute) et le trigger
      // de synchro pose user_roles 'organizer' tout seul. mfa_exempt : sans
      // lui, la session builder (magiclink) serait redirigée vers /mfa-setup.
      const { data: profRows } = await supabaseAdmin
        .from("profiles")
        .update({
          profile_type: "organizer",
          organization_name: orgName,
          onboarding_completed: true,
          mfa_exempt: true,
        })
        .eq("id", shadowId)
        .select("id");
      if (!profRows?.length) {
        await supabaseAdmin.from("profiles").insert({
          id: shadowId,
          email,
          profile_type: "organizer",
          organization_name: orgName,
          onboarding_completed: true,
          mfa_exempt: true,
        });
      }

      // Le profil vitrine : privé (invisible du public) + marqueur. Le slug est
      // généré par le trigger de la table.
      if (!alreadyShadow) {
        const { error: orgErr } = await supabaseAdmin
          .from("organizer_profiles")
          .insert({
            user_id: shadowId,
            display_name: orgName,
            is_public: false,
            is_showcase_shadow: true,
          });
        if (orgErr) return fail("organizer_profile_failed", 500);
      }

      const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: { redirectTo: `${APP_URL}/organizer-app` },
      });
      if (linkErr || !linkData?.properties?.action_link) return fail("mint_link_failed", 502);

      await supabaseAdmin.from("admin_audit_log").insert({
        admin_id: user.id,
        action: "showcase_organizer_created",
        entity_type: "organizer",
        entity_id: shadowId,
        metadata: { email, organization_name: orgName },
      });

      return new Response(JSON.stringify({
        success: true,
        user_id: shadowId,
        action_link: linkData.properties.action_link,
      }), { headers: jsonHeaders });
    }

    // ── open-support-session ───────────────────────────────────────────────────
    if (action === "open-support-session") {
      const grantId: string | undefined = body.grantId;
      if (!grantId) return fail("grantId is required", 400);

      const { data: grant } = await supabaseAdmin
        .from("admin_support_grants")
        .select("id, target_user_id, requested_by, status, expires_at")
        .eq("id", grantId).maybeSingle();
      if (!grant) return fail("grant_not_found", 404);
      if (grant.requested_by !== user.id) return fail("not_grant_owner", 403);
      if (grant.status !== "active") return fail("grant_not_active", 409);
      if (new Date(grant.expires_at) <= new Date()) return fail("grant_expired", 409);

      const { data: target } = await supabaseAdmin
        .from("profiles").select("email, first_name, last_name, organization_name").eq("id", grant.target_user_id).maybeSingle();
      if (!target?.email) return fail("target_not_found", 404);

      // Mint une session GoTrue pour le client SANS son mot de passe : magiclink
      // admin → hashed_token → verifyOtp côté serveur (client anon) → session.
      const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
        type: "magiclink",
        email: target.email,
      });
      if (linkErr || !linkData?.properties?.hashed_token) return fail("mint_link_failed", 502);

      const anonClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { auth: { persistSession: false } }
      );
      const { data: verified, error: verifyErr } = await anonClient.auth.verifyOtp({
        token_hash: linkData.properties.hashed_token,
        type: "magiclink",
      });
      if (verifyErr || !verified?.session) return fail("mint_session_failed", 502);

      const authSessionId = jwtSessionId(verified.session.access_token);
      if (!authSessionId) return fail("session_id_missing", 502);

      const { data: sessionRow, error: insErr } = await supabaseAdmin
        .from("admin_support_sessions")
        .insert({
          grant_id: grant.id,
          admin_id: user.id,
          target_user_id: grant.target_user_id,
          auth_session_id: authSessionId,
          status: "active",
          registered_at: new Date().toISOString(),
        })
        .select("id, expires_at")
        .single();
      if (insErr) {
        // La session GoTrue existe déjà à ce stade : si on ne la révoque pas,
        // elle reste vivante SANS être enregistrée — donc invisible du journal
        // et hors de portée de tous les verrous. On la tue avant de rendre
        // l'erreur.
        await supabaseAdmin.rpc("revoke_auth_session", { _auth_session_id: authSessionId });
        return fail("session_register_failed", 500);
      }

      await supabaseAdmin.from("admin_support_audit").insert({
        grant_id: grant.id, session_id: sessionRow.id, target_user_id: grant.target_user_id,
        actor_id: user.id, action: "session_opened",
      });

      const targetName =
        [target.first_name, target.last_name].filter(Boolean).join(" ").trim() ||
        target.organization_name || target.email;

      return new Response(JSON.stringify({
        success: true,
        access_token: verified.session.access_token,
        refresh_token: verified.session.refresh_token,
        session_id: sessionRow.id,
        target_user_id: grant.target_user_id,
        target_name: targetName,
        expires_at: sessionRow.expires_at,
      }), { headers: jsonHeaders });
    }

    // ── reset-password (comportement historique) ───────────────────────────────
    if (action !== "reset-password") return fail("Invalid action", 400);

    const { userId } = body;
    if (!userId) return fail("userId is required", 400);

    const { data: target } = await supabaseAdmin
      .from("profiles").select("email, preferred_language").eq("id", userId).maybeSingle();
    if (!target?.email) return fail("Target user not found", 404);

    const lang: Lang = (["en", "es", "fr"].includes(target.preferred_language) ? target.preferred_language : "fr") as Lang;
    const copy = COPY[lang];

    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: target.email,
      options: { redirectTo: `${APP_URL}/auth` },
    });
    if (linkErr) throw linkErr;
    const actionLink = linkData?.properties?.action_link;
    if (!actionLink) throw new Error("Could not generate recovery link");

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "noreply@yunoapp.eu";
    let emailSent = false;
    if (resendApiKey) {
      const mail = buildSecureLink({
        lang,
        title: copy.title,
        message: copy.body,
        ctaLabel: copy.cta,
        ctaUrl: actionLink,
        footnote: copy.ignore,
      });
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendApiKey}` },
        body: JSON.stringify({ from: `Yuno <${fromEmail}>`, to: [target.email], subject: copy.subject, html: mail.html }),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        console.error("[ADMIN-ACCOUNT-RECOVERY] Resend send failed:", res.status, errBody);
        return fail("Échec de l'envoi de l'email de récupération", 502);
      }
      emailSent = true;
    }

    await supabaseAdmin.from("admin_audit_log").insert({
      admin_id: user.id,
      action: "password_reset_sent",
      entity_type: "profile",
      entity_id: userId,
      metadata: { email: target.email },
    });

    return new Response(JSON.stringify({ success: true, emailSent }), { headers: jsonHeaders });
  } catch (error) {
    console.error("[ADMIN-ACCOUNT-RECOVERY] Error:", error);
    return fail(error instanceof Error ? error.message : "Unknown error", 400);
  }
});
