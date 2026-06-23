import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildInvitation } from "../_shared/email-templates.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_APP_ORIGIN = "https://yunoapp.eu";

const isAllowedOrigin = (origin: string) =>
  origin === "https://yuno.club" ||
  origin === DEFAULT_APP_ORIGIN ||
  origin.startsWith("http://localhost");

const getAppOrigin = (req: Request) => {
  const origin = req.headers.get("origin");
  if (origin && isAllowedOrigin(origin)) return origin;
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      if (isAllowedOrigin(refOrigin)) return refOrigin;
    } catch { /* ignore */ }
  }
  return DEFAULT_APP_ORIGIN;
};

const sendEmail = async (apiKey: string, to: string, subject: string, html: string) => {
  const resendFromEmail = Deno.env.get("RESEND_FROM_EMAIL") ?? "noreply@yunoapp.eu";
  const from = resendFromEmail.includes("<") ? resendFromEmail : `Yuno <${resendFromEmail}>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error("Resend error:", err);
    throw new Error(`Email delivery failed: ${err}`);
  }
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const appOrigin = getAppOrigin(req);

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // ── Authenticate caller ──────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader || "" } },
    });
    const { data: { user: caller } } = await supabaseUser.auth.getUser();

    if (!caller) {
      return new Response(JSON.stringify({ error: "Non authentifié" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Verify caller is an affiliate admin ─────────────────────────────────
    const { data: callerRole } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("role", "affiliate")
      .maybeSingle();

    if (!callerRole) {
      return new Response(JSON.stringify({ error: "Accès refusé — rôle affilié requis" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Get caller's affiliate record ────────────────────────────────────────
    const { data: callerAffiliate } = await supabaseAdmin
      .from("affiliates")
      .select("id, name, is_active")
      .eq("user_id", caller.id)
      .single();

    if (!callerAffiliate || !callerAffiliate.is_active) {
      return new Response(JSON.stringify({ error: "Compte affilié introuvable ou inactif" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Parse body ───────────────────────────────────────────────────────────
    const { email, first_name, last_name, role = "promoter" } = await req.json();

    if (!email || typeof email !== "string") {
      return new Response(JSON.stringify({ error: "Email requis" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!first_name || typeof first_name !== "string" || !first_name.trim()) {
      return new Response(JSON.stringify({ error: "Prénom requis" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!last_name || typeof last_name !== "string" || !last_name.trim()) {
      return new Response(JSON.stringify({ error: "Nom requis" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return new Response(JSON.stringify({ error: "Email invalide" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!["promoter", "manager"].includes(role)) {
      return new Response(JSON.stringify({ error: "Rôle invalide (promoter ou manager)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const firstName = first_name.trim();
    const lastName = last_name.trim();
    const roleLabel = role === "manager" ? "Manager" : "Promoteur";
    const affiliateName = callerAffiliate.name;

    // ── Generate unique linktree slug (lowercase, hyphenated) ───────────────
    const baseSlug = `${firstName}-${lastName}`
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Mn}/gu, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    let linktreeSlug = baseSlug;
    let slugSuffix = 1;
    while (true) {
      const { data: existing } = await supabaseAdmin
        .from("affiliate_members")
        .select("id")
        .eq("linktree_slug", linktreeSlug)
        .maybeSingle();
      if (!existing) break;
      linktreeSlug = `${baseSlug}-${++slugSuffix}`;
    }

    // ── Check if user already exists ─────────────────────────────────────────
    const { data: existingProfile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle();
    const existingUser = existingProfile ? { id: existingProfile.id } : null;

    if (existingUser) {
      // Check not already a member of this affiliate
      const { data: existingMember } = await supabaseAdmin
        .from("affiliate_members")
        .select("id, is_active")
        .eq("affiliate_id", callerAffiliate.id)
        .eq("user_id", existingUser.id)
        .maybeSingle();

      if (existingMember) {
        if (existingMember.is_active) {
          return new Response(
            JSON.stringify({ error: "Cet utilisateur est déjà membre de votre équipe" }),
            { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        await supabaseAdmin
          .from("affiliate_members")
          .update({ is_active: true, role, first_name: firstName, last_name: lastName })
          .eq("id", existingMember.id);
      } else {
        await supabaseAdmin.from("affiliate_members").insert({
          affiliate_id: callerAffiliate.id,
          user_id: existingUser.id,
          role,
          first_name: firstName,
          last_name: lastName,
          linktree_slug: linktreeSlug,
          invited_by: caller.id,
          is_active: true,
        });
      }

      // Grant affiliate_member role
      await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: existingUser.id, role: "affiliate_member" }, { onConflict: "user_id,role" });

      if (resendApiKey) {
        try {
          const mail = buildInvitation({
            lang: "fr",
            orgName: affiliateName,
            roleLabel,
            acceptUrl: `${appOrigin}/auth?redirect=/affiliate/promoteur`,
          });
          await sendEmail(resendApiKey, normalizedEmail, mail.subject, mail.html);
        } catch (emailErr) {
          console.error("Notification email failed (non-blocking):", emailErr);
        }
      }

      return new Response(
        JSON.stringify({ success: true, user_exists: true, message: `${normalizedEmail} ajouté à votre équipe.` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── New user — standard invitation token flow ─────────────────────────────
    // Revoke any previous pending invite for this email + affiliate
    const { data: existingInvites } = await supabaseAdmin
      .from("platform_invitations")
      .select("id, token")
      .eq("email", normalizedEmail)
      .eq("profile_type", "affiliate_member")
      .eq("status", "pending");

    for (const inv of existingInvites ?? []) {
      await supabaseAdmin
        .from("affiliate_invitations_meta")
        .delete()
        .eq("invitation_token", inv.token);
      await supabaseAdmin
        .from("platform_invitations")
        .update({ status: "revoked" })
        .eq("id", inv.id);
    }

    // Create new invitation
    const invitationToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    const { error: invErr } = await supabaseAdmin
      .from("platform_invitations")
      .insert({
        email: normalizedEmail,
        profile_type: "affiliate_member",
        organization_name: affiliateName,
        status: "pending",
        token: invitationToken,
        expires_at: expiresAt,
        invited_by: caller.id,
      });

    if (invErr) throw invErr;

    // Store affiliate_id, role, first_name, last_name, linktree_slug in metadata
    await supabaseAdmin
      .from("affiliate_invitations_meta")
      .upsert({
        invitation_token: invitationToken,
        affiliate_name: affiliateName,
        affiliate_type: "independent",
        affiliate_id: callerAffiliate.id,
        member_role: role,
        first_name: firstName,
        last_name: lastName,
        linktree_slug: linktreeSlug,
        created_by: caller.id,
      }, { onConflict: "invitation_token" });

    const inviteLink = `${appOrigin}/auth?invite_affiliate_member=${invitationToken}&email=${encodeURIComponent(normalizedEmail)}`;

    let emailSent = false;
    if (resendApiKey) {
      try {
        const mail = buildInvitation({
          lang: "fr",
          orgName: affiliateName,
          roleLabel,
          acceptUrl: inviteLink,
        });
        await sendEmail(resendApiKey, normalizedEmail, mail.subject, mail.html);
        emailSent = true;
      } catch (emailErr) {
        console.error("Invitation email failed (non-blocking):", emailErr);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        user_exists: false,
        email_sent: emailSent,
        invite_link: inviteLink,
        message: emailSent ? `Invitation envoyée à ${normalizedEmail}.` : `Invitation créée — email non envoyé. Lien : ${inviteLink}`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in invite-affiliate-member:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
