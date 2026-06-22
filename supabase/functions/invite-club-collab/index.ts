import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { wrapEmailWithBranding, type EmailLanguage } from "../_shared/email-branding.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Payload {
  club_name: string;
  club_email: string;
  club_city?: string;
  club_address?: string;
  contact_first_name?: string;
  contact_last_name?: string;
  event_id?: string | null;
  invitation_message?: string;
  default_split_rules?: any;
  origin?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Not authenticated");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });
    const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) throw new Error("Not authenticated");

    const body = (await req.json()) as Payload;
    const {
      club_name,
      club_email,
      club_city,
      club_address,
      contact_first_name,
      contact_last_name,
      event_id,
      invitation_message,
      default_split_rules,
      origin,
    } = body;

    if (!club_name?.trim() || !club_email?.trim()) {
      return new Response(JSON.stringify({ error: "club_name et club_email requis" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const normalizedEmail = club_email.trim().toLowerCase();
    if (!emailRegex.test(normalizedEmail)) {
      return new Response(JSON.stringify({ error: "Email invalide" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if a venue with this email already exists in Yuno
    const { data: existingVenue } = await supabaseAdmin
      .from("venues")
      .select("id, name")
      .ilike("contact_email", normalizedEmail)
      .maybeSingle();
    if (existingVenue) {
      return new Response(
        JSON.stringify({
          error: `Ce club est déjà inscrit sur Yuno (${existingVenue.name}). Utilise plutôt "Demander un partenariat".`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check pending invitation by this organizer for this email
    const { data: existingInv } = await supabaseAdmin
      .from("venue_claim_invitations")
      .select("id, expires_at")
      .eq("organizer_user_id", user.id)
      .eq("club_email", normalizedEmail)
      .eq("status", "pending")
      .maybeSingle();
    if (existingInv) {
      return new Response(
        JSON.stringify({ error: "Une invitation est déjà en attente pour ce club." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get organizer profile for personalization
    const { data: orgProfile } = await supabaseAdmin
      .from("profiles")
      .select("first_name, last_name, organization_name")
      .eq("id", user.id)
      .maybeSingle();
    const organizerLabel =
      orgProfile?.organization_name ||
      [orgProfile?.first_name, orgProfile?.last_name].filter(Boolean).join(" ") ||
      "Un organisateur Yuno";

    // Create invitation
    const { data: invitation, error: insErr } = await supabaseAdmin
      .from("venue_claim_invitations")
      .insert({
        organizer_user_id: user.id,
        club_name: club_name.trim(),
        club_email: normalizedEmail,
        club_city: club_city?.trim() || null,
        club_address: club_address?.trim() || null,
        contact_first_name: contact_first_name?.trim() || null,
        contact_last_name: contact_last_name?.trim() || null,
        event_id: event_id || null,
        invitation_message: invitation_message?.trim() || null,
        default_split_rules: default_split_rules ?? undefined,
      })
      .select()
      .single();
    if (insErr) throw insErr;

    // Optional: language preference (defaults to fr)
    const lang: EmailLanguage = "fr";

    const baseUrl = origin || "https://yunoapp.eu";
    const acceptUrl = `${baseUrl}/club-invitation?token=${invitation.token}`;

    const subject = `${organizerLabel} t'invite à rejoindre Yuno pour collaborer`;

    const greetingName = contact_first_name
      ? `Bonjour ${contact_first_name},`
      : "Bonjour,";

    const bodyHtml = `
      <div style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); padding: 30px; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">🤝 Invitation à collaborer</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0; font-size: 14px;">
          ${organizerLabel} t'invite à rejoindre Yuno
        </p>
      </div>
      <div style="padding: 32px;">
        <p style="color: #e5e5e5; font-size: 15px; line-height: 1.6;">${greetingName}</p>
        <p style="color: #a0a0a0; font-size: 14px; line-height: 1.7;">
          <strong style="color: #fff;">${organizerLabel}</strong> souhaite organiser une soirée
          dans ton établissement <strong style="color: #fff;">${club_name}</strong> et t'invite
          à rejoindre <strong style="color: #dc2626;">Yuno</strong> pour gérer cette collaboration.
        </p>
        ${
          invitation_message
            ? `<div style="background: #1a1a1a; border-left: 3px solid #dc2626; padding: 14px 18px; margin: 18px 0; border-radius: 6px;">
                 <p style="color: #d1d1d1; font-style: italic; margin: 0; font-size: 14px; line-height: 1.6;">
                   « ${invitation_message.replace(/</g, "&lt;")} »
                 </p>
               </div>`
            : ""
        }
        <p style="color: #a0a0a0; font-size: 14px; line-height: 1.7;">
          En acceptant, ton club est créé automatiquement sur Yuno avec un accès
          <strong style="color: #fff;">Yuno Collaboration</strong> gratuit :
        </p>
        <ul style="color: #a0a0a0; font-size: 14px; line-height: 1.8; padding-left: 18px;">
          <li>Page publique de ton club avec la soirée co-organisée</li>
          <li>Statistiques de la collaboration en temps réel</li>
          <li>Paiements directs via Stripe Connect</li>
          <li>Possibilité d'activer plus tard un plan Yuno complet (menu, billetterie, VIP, fidélité…)</li>
        </ul>
        <div style="text-align: center; margin: 32px 0 12px;">
          <a href="${acceptUrl}" style="display: inline-block; background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); color: #fff !important; text-decoration: none; padding: 16px 36px; border-radius: 12px; font-weight: bold; font-size: 16px;">
            Accepter l'invitation →
          </a>
        </div>
        <p style="color: #666; font-size: 12px; text-align: center; margin-top: 18px;">
          Cette invitation expire dans 14 jours. Si tu n'attendais pas ce message, ignore-le simplement.
        </p>
      </div>`;

    const html = wrapEmailWithBranding(bodyHtml, lang);

    const rawFrom = Deno.env.get("RESEND_FROM_EMAIL");
    const from = rawFrom
      ? rawFrom.includes("<") ? rawFrom : `Yuno <${rawFrom}>`
      : "Yuno <noreply@yunoapp.eu>";

    if (RESEND_API_KEY) {
      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from,
          to: [normalizedEmail],
          subject,
          html,
        }),
      });
      if (!emailRes.ok) {
        const errTxt = await emailRes.text();
        console.error("Resend error:", errTxt);
      } else {
        console.log("Club collab invitation email sent to", normalizedEmail);
      }
    } else {
      console.warn("RESEND_API_KEY missing — skipping email");
    }

    return new Response(
      JSON.stringify({ success: true, invitation_id: invitation.id, token: invitation.token }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("invite-club-collab error:", error);
    return new Response(JSON.stringify({ error: error.message ?? "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
};

serve(handler);
