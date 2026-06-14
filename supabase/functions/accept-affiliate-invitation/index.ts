import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const { action, token } = await req.json();
    if (!token) {
      return new Response(JSON.stringify({ error: "Missing token" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: invitation, error: invError } = await supabaseAdmin
      .from("platform_invitations")
      .select("*")
      .eq("token", token)
      .in("profile_type", ["affiliate", "affiliate_member"])
      .maybeSingle();

    if (invError || !invitation) {
      return new Response(JSON.stringify({ error: "Invitation not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (invitation.status !== "pending") {
      return new Response(JSON.stringify({ error: "Invitation already used or revoked" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (new Date(invitation.expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: "Invitation expired" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "verify") {
      return new Response(
        JSON.stringify({
          invitation: {
            email: invitation.email,
            profile_type: invitation.profile_type,
            organization_name: invitation.organization_name,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "accept") {
      const authHeader = req.headers.get("Authorization");
      const supabaseUser = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader || "" } },
      });
      const { data: { user } } = await supabaseUser.auth.getUser();
      if (!user) {
        return new Response(JSON.stringify({ error: "Sign in required" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (user.email?.toLowerCase() !== invitation.email.toLowerCase()) {
        return new Response(JSON.stringify({ error: "Email mismatch with invitation" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Load extra metadata stored at invite time
      const { data: meta } = await supabaseAdmin
        .from("affiliate_invitations_meta")
        .select("*")
        .eq("invitation_token", token)
        .maybeSingle();

      if (invitation.profile_type === "affiliate_member") {
        // ── Member flow: add to affiliate_members ──────────────────────────
        const affiliateId = meta?.affiliate_id;
        const memberRole = meta?.member_role ?? "promoter";

        if (!affiliateId) {
          return new Response(
            JSON.stringify({ error: "Métadonnées d'invitation membre introuvables" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        await supabaseAdmin
          .from("affiliate_members")
          .upsert({
            affiliate_id: affiliateId,
            user_id: user.id,
            role: memberRole,
            first_name: meta?.first_name ?? null,
            last_name: meta?.last_name ?? null,
            linktree_slug: meta?.linktree_slug ?? null,
            invited_by: meta?.created_by ?? null,
            is_active: true,
          }, { onConflict: "affiliate_id,user_id" });

        // Grant affiliate_member role (distinct from full 'affiliate' admin)
        await supabaseAdmin
          .from("user_roles")
          .upsert({ user_id: user.id, role: "affiliate_member" }, { onConflict: "user_id,role" });

      } else {
        // ── Affiliate admin flow: create full affiliate record ──────────────
        const affiliateName = meta?.affiliate_name ?? invitation.organization_name;
        const affiliateType = meta?.affiliate_type ?? "independent";
        const affiliateCity = meta?.city ?? null;
        const commissionRate = meta?.commission_rate ?? 0;
        const createdBy = meta?.created_by ?? null;

        await supabaseAdmin
          .from("affiliates")
          .upsert({
            user_id: user.id,
            name: affiliateName,
            type: affiliateType,
            city: affiliateCity,
            commission_rate: commissionRate,
            created_by: createdBy,
            is_active: true,
          }, { onConflict: "user_id" });

        // Grant affiliate role
        await supabaseAdmin
          .from("user_roles")
          .upsert({ user_id: user.id, role: "affiliate" }, { onConflict: "user_id,role" });
      }

      // Mark invitation accepted
      await supabaseAdmin
        .from("platform_invitations")
        .update({
          status: "accepted",
          accepted_at: new Date().toISOString(),
          accepted_by: user.id,
        })
        .eq("id", invitation.id);

      // Clean up metadata
      if (meta) {
        await supabaseAdmin
          .from("affiliate_invitations_meta")
          .delete()
          .eq("invitation_token", token);
      }

      return new Response(
        JSON.stringify({ success: true, redirect: "/affiliate" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in accept-affiliate-invitation:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
