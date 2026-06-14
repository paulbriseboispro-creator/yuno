import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { 
  EmailLanguage, 
  t, 
  wrapEmailWithBranding 
} from "../_shared/email-branding.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AuthEmailRequest {
  type: "confirmation" | "recovery";
  email: string;
  token: string;
  name?: string;
  userId?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { type, email, token, name, userId }: AuthEmailRequest = await req.json();
    
    const baseUrl = Deno.env.get("APP_BASE_URL") || "https://yunoapp.eu";
    
    // Fetch user's preferred language if userId is provided
    let lang: EmailLanguage = 'fr';
    
    if (userId) {
      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
        { auth: { persistSession: false } }
      );
      
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('preferred_language')
        .eq('id', userId)
        .single();
      
      if (profile?.preferred_language && ['en', 'es', 'fr'].includes(profile.preferred_language)) {
        lang = profile.preferred_language as EmailLanguage;
      }
    }

    let subject: string;
    let emailContent: string;
    
    if (type === "confirmation") {
      const confirmUrl = `${baseUrl}/auth#access_token=${token}&type=signup`;
      subject = t('auth.confirmEmail', lang);
      emailContent = `
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); padding: 30px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">${t('auth.welcome', lang)} ${name || ""}!</h1>
        </div>
        
        <!-- Content -->
        <div style="padding: 32px;">
          <p style="color: #a0a0a0; line-height: 1.6; margin: 0 0 16px 0;">${t('auth.thanksForSignup', lang)}</p>
          <p style="color: #a0a0a0; line-height: 1.6; margin: 0 0 24px 0;">${t('auth.clickToConfirm', lang)}</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${confirmUrl}" 
               style="display: inline-block; background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); color: #fff !important; text-decoration: none; padding: 16px 32px; border-radius: 12px; font-weight: bold; font-size: 16px;">
              ${t('auth.confirmButton', lang)}
            </a>
          </div>
          <p style="color: #666; font-size: 14px; margin-top: 24px;">
            ${t('auth.buttonNotWork', lang)}<br>
            <a href="${confirmUrl}" style="color: #dc2626; word-break: break-all;">${confirmUrl}</a>
          </p>
          <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.1);">
            <p style="color: #666; font-size: 12px; margin: 0;">
              ${t('auth.ignoreIfNotYou', lang)}
            </p>
          </div>
        </div>
      `;
    } else {
      const resetUrl = `${baseUrl}/auth?reset=true#access_token=${token}&type=recovery`;
      subject = t('auth.passwordReset', lang);
      emailContent = `
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); padding: 30px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">${t('auth.passwordReset', lang)}</h1>
        </div>
        
        <!-- Content -->
        <div style="padding: 32px;">
          <p style="color: #a0a0a0; line-height: 1.6; margin: 0 0 16px 0;">${t('auth.passwordResetRequest', lang)}</p>
          <p style="color: #a0a0a0; line-height: 1.6; margin: 0 0 24px 0;">${t('auth.clickToReset', lang)}</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" 
               style="display: inline-block; background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); color: #fff !important; text-decoration: none; padding: 16px 32px; border-radius: 12px; font-weight: bold; font-size: 16px;">
              ${t('auth.resetButton', lang)}
            </a>
          </div>
          <p style="color: #666; font-size: 14px; margin-top: 24px;">
            ${t('auth.buttonNotWork', lang)}<br>
            <a href="${resetUrl}" style="color: #dc2626; word-break: break-all;">${resetUrl}</a>
          </p>
          <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.1);">
            <p style="color: #666; font-size: 12px; margin: 0;">
              ${t('auth.ignoreIfNotRequested', lang)}
            </p>
          </div>
        </div>
      `;
    }

    const html = wrapEmailWithBranding(emailContent, lang);

    const rawFrom = Deno.env.get('RESEND_FROM_EMAIL');
    const from = rawFrom
      ? (rawFrom.includes('<') ? rawFrom : `Yuno <${rawFrom}>`)
      : 'Yuno <onboarding@resend.dev>';

    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject,
        html,
      }),
    });

    if (!emailResponse.ok) {
      const error = await emailResponse.text();
      throw new Error(`Resend API error: ${error}`);
    }

    const data = await emailResponse.json();

    console.log("Auth email sent successfully:", data);

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error sending auth email:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
