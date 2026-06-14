import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      throw new Error("RESEND_API_KEY not configured");
    }

    const resend = new Resend(resendApiKey);
    const { templateId, recipientEmail } = await req.json();

    if (!templateId || !recipientEmail) {
      throw new Error("templateId and recipientEmail are required");
    }

    // Get template from database
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    const { data: template, error: templateError } = await supabaseAdmin
      .from('email_templates')
      .select('*')
      .eq('id', templateId)
      .single();

    if (templateError || !template) {
      throw new Error("Template not found");
    }

    // Generate mock stats HTML with Yuno colors
    const mockStatsHtml = `
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
        <tr>
          <td style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 20px; text-align: center; width: 33%;">
            <p style="color: #dc2626; margin: 0; font-size: 28px; font-weight: 800;">3</p>
            <p style="color: #9ca3af; margin: 4px 0 0; font-size: 13px;">drinks commandés</p>
          </td>
          <td style="width: 8px;"></td>
          <td style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 20px; text-align: center; width: 33%;">
            <p style="color: #22c55e; margin: 0; font-size: 28px; font-weight: 800;">45€</p>
            <p style="color: #9ca3af; margin: 4px 0 0; font-size: 13px;">dépensés ce soir</p>
          </td>
          <td style="width: 8px;"></td>
          <td style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 20px; text-align: center; width: 33%;">
            <p style="color: #dc2626; margin: 0; font-size: 28px; font-weight: 800;">+45</p>
            <p style="color: #9ca3af; margin: 4px 0 0; font-size: 13px;">points gagnés</p>
          </td>
        </tr>
      </table>
    `;

    // Try to fetch the real user name from profiles if we have auth
    let testFirstName = '';
    const authHeader = req.headers.get('authorization');
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user } } = await supabaseAdmin.auth.getUser(token);
      if (user) {
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('first_name')
          .eq('id', user.id)
          .single();
        if (profile?.first_name) {
          testFirstName = profile.first_name;
        }
      }
    }

    // Replace placeholders with test data
    let htmlContent = template.html_content
      .replace(/\{\{venue_name\}\}/g, 'Casanova Club')
      .replace(/\{\{venue_slug\}\}/g, 'casanova')
      .replace(/\{\{event_name\}\}/g, 'Saturday Night Fever')
      .replace(/\{\{event_date\}\}/g, '21 janvier 2026')
      .replace(/\{\{first_name\}\}/g, testFirstName)
      .replace(/\{\{visit_count\}\}/g, '5')
      .replace(/\{\{tier\}\}/g, 'Gold')
      .replace(/\{\{total_lifetime_points\}\}/g, '450')
      .replace(/\{\{stats_section\}\}/g, mockStatsHtml)
      .replace(/\{\{#if first_name\}\}/g, '')
      .replace(/\{\{\/if\}\}/g, '');

    const subject = `[TEST] ${template.subject}`
      .replace(/\{\{venue_name\}\}/g, 'Casanova Club')
      .replace(/\{\{event_name\}\}/g, 'Saturday Night Fever')
      .replace(/\{\{first_name\}\}/g, testFirstName);

    const rawFrom = Deno.env.get('RESEND_FROM_EMAIL');
    // Prefer providing just an email address in RESEND_FROM_EMAIL (ex: no-reply@yourdomain.com)
    // If you provide a full header (ex: "Yuno <no-reply@yourdomain.com>"), it will be used as-is.
    const from = rawFrom
      ? (rawFrom.includes('<') ? rawFrom : `Yuno <${rawFrom}>`)
      : 'Yuno <onboarding@resend.dev>';

    // Send test email
    const emailResponse = await resend.emails.send({
      from,
      to: [recipientEmail],
      subject,
      html: htmlContent
    });

    if (emailResponse?.error) {
      console.error('Resend send error:', emailResponse.error);
      return new Response(
        JSON.stringify({
          success: false,
          error: emailResponse.error.message,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log('Test email sent:', { id: (emailResponse as any)?.data?.id, to: recipientEmail });

    return new Response(
      JSON.stringify({ success: true, message: "Email sent" }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error sending test email:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
