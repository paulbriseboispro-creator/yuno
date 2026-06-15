import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { Resend } from "npm:resend@2.0.0";
import { wrapEmailWithBranding } from "../_shared/email-branding.ts";
import { generateSecret, generateOTPAuthURL, verifyTOTP } from "../_shared/totp.ts";
import { encode } from "https://deno.land/std@0.190.0/encoding/hex.ts";

// Unified MFA dispatcher.
// Replaces: mfa-disable, mfa-generate-secret, mfa-verify-login, mfa-verify-setup.
// Route via body.action:
//   "disable-request" | "disable-confirm" | "generate-secret" | "verify-login" | "verify-setup".
//
// verify_jwt = false (config.toml) because "disable-confirm" is reached from an email
// link with no session. Every other action re-validates the user JWT internally below.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });

async function hashCode(code: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(code);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hexBytes = encode(new Uint8Array(hashBuffer));
  return new TextDecoder().decode(hexBytes);
}

function generateRecoveryCode(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const hexBytes = encode(bytes);
  return new TextDecoder().decode(hexBytes).toUpperCase();
}

// Simple in-memory rate limit for verify-login (keyed by user id)
const rateLimitMap = new Map<string, { attempts: number; resetAt: number }>();
function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const limit = rateLimitMap.get(userId);
  if (!limit || now > limit.resetAt) {
    rateLimitMap.set(userId, { attempts: 1, resetAt: now + 60000 });
    return true;
  }
  if (limit.attempts >= 5) return false;
  limit.attempts++;
  return true;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const action: string = body.action;

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const authHeader = req.headers.get("Authorization");
    // Anon client bound to the caller's JWT — used for getUser() and RLS-scoped reads.
    const makeAuthClient = () =>
      createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: authHeader ?? "" } } },
      );

    // ─────────────────────────────────────────────────────────────────────────
    // action: "disable-confirm"  (← mfa-disable, confirm path — NO auth, token only)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "disable-confirm") {
      const { token } = body;
      if (!token) throw new Error("Token manquant");

      const { data: request, error: findError } = await serviceClient
        .from("mfa_disable_requests")
        .select("*")
        .eq("token", token)
        .eq("used", false)
        .gt("expires_at", new Date().toISOString())
        .single();

      if (findError || !request) throw new Error("Lien invalide ou expiré. Refais une demande de désactivation.");

      const userId = request.user_id;
      await serviceClient.from("mfa_disable_requests").update({ used: true, used_at: new Date().toISOString() }).eq("id", request.id);
      await serviceClient.rpc("delete_mfa_totp_secret", { p_user_id: userId });
      await serviceClient.from("mfa_recovery_codes").delete().eq("user_id", userId);

      const { error: profileError } = await serviceClient
        .from("profiles")
        .update({ mfa_enabled: false, mfa_verified_at: null })
        .eq("id", userId);
      if (profileError) throw profileError;

      await serviceClient.from("security_logs").insert({
        user_id: userId,
        action: "mfa_disabled_via_email",
        ip_address: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip"),
        user_agent: req.headers.get("user-agent"),
        success: true,
      });

      // Best-effort alert email
      try {
        const resendApiKey = Deno.env.get("RESEND_API_KEY");
        const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "noreply@yunoapp.eu";
        if (resendApiKey && request.email) {
          const resend = new Resend(resendApiKey);
          const ipAddress = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "inconnue";
          const when = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" });
          const alertContent = `<div style="padding:32px 24px">
            <h1 style="color:#fff;font-size:22px;margin:0 0 16px">⚠️ 2FA désactivée sur ton compte</h1>
            <p style="color:#ccc;font-size:14px;line-height:1.6;margin:0 0 16px">L'authentification à deux facteurs vient d'être désactivée sur ton compte Yuno.</p>
            <div style="background:rgba(255,255,255,0.05);border-radius:8px;padding:16px;margin:0 0 24px">
              <p style="color:#ccc;font-size:13px;margin:0 0 6px">📅 <strong>Date:</strong> ${when} (Paris)</p>
              <p style="color:#ccc;font-size:13px;margin:0">🌐 <strong>IP:</strong> ${ipAddress}</p>
            </div>
            <p style="color:#ccc;font-size:14px;line-height:1.6;margin:0 0 16px">✅ Si c'est bien toi, tu n'as rien à faire.</p>
            <div style="border-top:1px solid rgba(255,255,255,0.1);padding-top:16px;margin-top:16px">
              <p style="color:#f87171;font-size:13px;margin:0 0 8px">🚨 <strong>Si ce n'est PAS toi:</strong></p>
              <p style="color:#ccc;font-size:13px;line-height:1.6;margin:0">Change ton mot de passe immédiatement et réactive la 2FA depuis tes paramètres de sécurité.</p>
            </div>
          </div>`;
          await resend.emails.send({
            from: `Yuno Sécurité <${fromEmail}>`,
            to: [request.email],
            subject: "⚠️ 2FA désactivée sur ton compte Yuno",
            html: wrapEmailWithBranding(alertContent, "fr"),
          });
        }
      } catch (emailErr) {
        console.error("Failed to send MFA disable alert (non-blocking):", emailErr);
      }

      return json({ success: true });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // action: "disable-request"  (← mfa-disable, request path — requires auth)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "disable-request") {
      if (!authHeader) throw new Error("Non authentifié");
      const { data: { user }, error: authError } = await makeAuthClient().auth.getUser();
      if (authError || !user) throw new Error("Non authentifié");

      const { data: profile } = await serviceClient
        .from("profiles")
        .select("mfa_enabled, first_name")
        .eq("id", user.id)
        .single();
      if (!profile?.mfa_enabled) throw new Error("La 2FA n'est pas activée sur ce compte");

      const { data: rateOk } = await serviceClient.rpc("check_mfa_disable_rate_limit", { _user_id: user.id });
      if (rateOk === false) throw new Error("Trop de demandes. Réessaye dans une heure.");

      const { data: existing } = await serviceClient
        .from("mfa_disable_requests")
        .select("id")
        .eq("user_id", user.id)
        .eq("used", false)
        .gt("expires_at", new Date().toISOString())
        .limit(1);
      if (existing && existing.length > 0) throw new Error("Une demande est déjà en cours. Vérifie tes emails.");

      const token = crypto.randomUUID() + "-" + crypto.randomUUID();
      const ipAddress = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip");
      const userAgent = req.headers.get("user-agent");

      const { error: insertError } = await serviceClient.from("mfa_disable_requests").insert({
        user_id: user.id,
        token,
        email: user.email!,
        ip_address: ipAddress,
        user_agent: userAgent,
      });
      if (insertError) throw insertError;

      const resendApiKey = Deno.env.get("RESEND_API_KEY");
      const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "noreply@yunoapp.eu";
      if (!resendApiKey) throw new Error("Configuration email manquante");

      const resend = new Resend(resendApiKey);
      const origin = req.headers.get("origin") || "https://yunoapp.eu";
      const confirmUrl = `${origin}/mfa-disable-confirm?token=${token}`;
      const firstName = profile.first_name || "there";

      const emailContent = `<div style="padding:32px 24px">
        <h1 style="color:#fff;font-size:22px;margin:0 0 16px">🔓 Désactivation de la 2FA</h1>
        <p style="color:#ccc;font-size:14px;line-height:1.6;margin:0 0 8px">Salut ${firstName},</p>
        <p style="color:#ccc;font-size:14px;line-height:1.6;margin:0 0 24px">Tu as demandé à désactiver l'authentification à deux facteurs (2FA) sur ton compte Yuno. Clique sur le bouton ci-dessous pour confirmer cette action :</p>
        <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px"><tr><td>
          <a href="${confirmUrl}" style="display:inline-block;background:linear-gradient(135deg,#dc2626 0%,#b91c1c 100%);color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:600;font-size:15px">Confirmer la désactivation →</a>
        </td></tr></table>
        <p style="color:#888;font-size:12px;margin:0 0 8px">⏳ Ce lien expire dans 15 minutes.</p>
        <p style="color:#dc2626;font-size:11px;word-break:break-all;margin:0 0 24px">${confirmUrl}</p>
        <div style="border-top:1px solid rgba(255,255,255,0.1);padding-top:16px">
          <p style="color:#666;font-size:11px;margin:0">⚠️ Si tu n'as pas fait cette demande, ignore cet email. Ton compte reste sécurisé.</p>
        </div>
      </div>`;

      await resend.emails.send({
        from: `Yuno Sécurité <${fromEmail}>`,
        to: [user.email!],
        subject: "🔓 Confirme la désactivation de ta 2FA — Yuno",
        html: wrapEmailWithBranding(emailContent, "fr"),
      });

      await serviceClient.from("security_logs").insert({
        user_id: user.id,
        action: "mfa_disable_requested",
        ip_address: ipAddress,
        user_agent: userAgent,
        success: true,
      });

      return json({ success: true, message: "Email de vérification envoyé" });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // action: "generate-secret"  (← mfa-generate-secret — requires auth)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "generate-secret") {
      if (!authHeader) throw new Error("Non authentifié");
      const supabaseAuth = makeAuthClient();
      const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
      if (authError || !user) throw new Error("Non authentifié");

      const { data: roles } = await supabaseAuth
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);

      if (!roles || !roles.some((r) => r.role === "owner" || r.role === "affiliate")) {
        throw new Error("Accès refusé : seuls les owners et affiliés peuvent activer la 2FA");
      }

      const secret = generateSecret();
      const otpauthUrl = generateOTPAuthURL("Yuno App", user.email || user.id, secret);

      await serviceClient.rpc("cleanup_expired_mfa_pending");
      const { error: deleteError } = await serviceClient
        .from("mfa_pending")
        .delete()
        .eq("user_id", user.id);
      if (deleteError) console.error("⚠️ Erreur nettoyage:", deleteError);

      const { error: insertError } = await serviceClient
        .from("mfa_pending")
        .insert({ user_id: user.id, secret: secret, created_at: new Date().toISOString() });
      if (insertError) throw new Error("Impossible de sauvegarder le secret: " + insertError.message);

      await serviceClient.from("security_logs").insert({
        user_id: user.id,
        action: "mfa_secret_generated",
        ip_address: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip"),
        user_agent: req.headers.get("user-agent"),
        success: true,
      });

      return json({ success: true, otpauthUrl, secret });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // action: "verify-login"  (← mfa-verify-login — requires auth)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "verify-login") {
      const { code, recoveryCode } = body;
      if (!code && !recoveryCode) throw new Error("Code TOTP ou code de récupération requis");

      if (!authHeader) throw new Error("Non authentifié");
      const { data: { user }, error: authError } = await makeAuthClient().auth.getUser();
      if (authError || !user) throw new Error("Non authentifié");

      if (!checkRateLimit(user.id)) throw new Error("Trop de tentatives. Réessayez dans 1 minute.");

      let verified = false;

      if (recoveryCode) {
        const codeHash = await hashCode(recoveryCode.toUpperCase());
        const { data: recovery, error: recoveryError } = await serviceClient
          .from("mfa_recovery_codes")
          .select("id, used")
          .eq("user_id", user.id)
          .eq("code_hash", codeHash)
          .maybeSingle();

        if (recoveryError || !recovery) throw new Error("Code de récupération invalide");
        if (recovery.used) throw new Error("Ce code de récupération a déjà été utilisé");

        await serviceClient
          .from("mfa_recovery_codes")
          .update({ used: true, used_at: new Date().toISOString() })
          .eq("id", recovery.id);

        verified = true;

        await serviceClient.from("security_logs").insert({
          user_id: user.id,
          action: "mfa_recovery_code_used",
          ip_address: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip"),
          user_agent: req.headers.get("user-agent"),
          success: true,
        });
      } else {
        if (!/^\d{6}$/.test(code)) throw new Error("Code invalide (6 chiffres requis)");

        const { data: secret, error: secretError } = await serviceClient
          .rpc("get_mfa_totp_secret", { p_user_id: user.id });

        if (secretError || !secret) {
          console.error("MFA secret not found for user:", user.id, "Error:", secretError);
          throw new Error("MFA non configurée");
        }

        verified = await verifyTOTP(code, secret, 3);

        if (!verified) {
          await serviceClient.from("security_logs").insert({
            user_id: user.id,
            action: "mfa_login_failed",
            ip_address: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip"),
            user_agent: req.headers.get("user-agent"),
            success: false,
          });
          throw new Error("Code incorrect");
        }

        await serviceClient.from("security_logs").insert({
          user_id: user.id,
          action: "mfa_login_success",
          ip_address: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip"),
          user_agent: req.headers.get("user-agent"),
          success: true,
        });
      }

      await serviceClient
        .from("profiles")
        .update({ mfa_verified_at: new Date().toISOString() })
        .eq("id", user.id);

      rateLimitMap.delete(user.id);

      return json({
        success: true,
        verified: true,
        expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // action: "verify-setup"  (← mfa-verify-setup — requires auth)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "verify-setup") {
      const { code } = body;
      if (!code || !/^\d{6}$/.test(code)) throw new Error("Code invalide (6 chiffres requis)");

      if (!authHeader) throw new Error("Non authentifié");
      const { data: { user }, error: authError } = await makeAuthClient().auth.getUser();
      if (authError || !user) throw new Error("Non authentifié");

      const { data: pending, error: pendingError } = await serviceClient
        .from("mfa_pending")
        .select("secret, created_at")
        .eq("user_id", user.id)
        .single();

      if (pendingError || !pending) throw new Error("Aucun secret en attente. Veuillez recommencer le setup.");

      const createdAt = new Date(pending.created_at);
      const now = new Date();
      const diffMinutes = (now.getTime() - createdAt.getTime()) / 1000 / 60;

      if (diffMinutes > 15) {
        await serviceClient.from("mfa_pending").delete().eq("user_id", user.id);
        throw new Error("Le secret a expiré. Veuillez recommencer le setup.");
      }

      const isValid = await verifyTOTP(code, pending.secret);

      if (!isValid) {
        await serviceClient.from("security_logs").insert({
          user_id: user.id,
          action: "mfa_setup_failed",
          ip_address: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip"),
          user_agent: req.headers.get("user-agent"),
          success: false,
        });
        throw new Error("Code incorrect. Veuillez réessayer.");
      }

      const recoveryCodes: string[] = [];
      const recoveryHashes: Array<{ user_id: string; code_hash: string }> = [];
      for (let i = 0; i < 10; i++) {
        const rc = generateRecoveryCode();
        recoveryCodes.push(rc);
        const hash = await hashCode(rc);
        recoveryHashes.push({ user_id: user.id, code_hash: hash });
      }

      const { error: secretError } = await serviceClient
        .rpc("store_mfa_totp_secret", { p_user_id: user.id, p_secret: pending.secret });
      if (secretError) throw secretError;

      await serviceClient.from("mfa_recovery_codes").delete().eq("user_id", user.id);
      const { error: recoveryError } = await serviceClient
        .from("mfa_recovery_codes")
        .insert(recoveryHashes);
      if (recoveryError) throw recoveryError;

      const { error: profileError } = await serviceClient
        .from("profiles")
        .update({ mfa_enabled: true, mfa_verified_at: new Date().toISOString() })
        .eq("id", user.id);
      if (profileError) throw profileError;

      await serviceClient.from("mfa_pending").delete().eq("user_id", user.id);

      await serviceClient.from("security_logs").insert({
        user_id: user.id,
        action: "mfa_setup_completed",
        ip_address: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip"),
        user_agent: req.headers.get("user-agent"),
        success: true,
      });

      return json({ success: true, recoveryCodes });
    }

    throw new Error(`Unknown or missing action: ${action ?? "(none)"}`);
  } catch (error) {
    console.error("Erreur mfa:", error);
    return json({ error: error instanceof Error ? error.message : "Erreur inconnue" }, 400);
  }
});
