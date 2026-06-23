import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { Resend } from "https://esm.sh/resend@2.0.0";
import { shouldHideYunoBranding } from "../_shared/venue-plan.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Yuno brand colors - FIXED, not customizable by clubs
const YUNO_COLORS = {
  background: '#0a0a0a',
  primary: '#dc2626',
  text: '#ffffff',
  textSecondary: '#9ca3af',
  border: 'rgba(255,255,255,0.1)',
  success: '#22c55e',
};

interface EmailBlock {
  id: string;
  type: 'hero' | 'text' | 'cta' | 'stats' | 'image' | 'divider';
  content: {
    title?: string;
    subtitle?: string;
    text?: string;
    buttonText?: string;
    buttonUrl?: string;
    imageUrl?: string;
    altText?: string;
  };
}

function generateBlockHtml(block: EmailBlock): string {
  switch (block.type) {
    case 'hero':
      return `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
          <tr>
            <td style="padding: 32px 20px; text-align: center; background: linear-gradient(135deg, ${YUNO_COLORS.primary}20, ${YUNO_COLORS.background}); border-radius: 12px;">
              <h1 style="color: ${YUNO_COLORS.text}; font-size: 28px; font-weight: 800; margin: 0 0 12px 0;">${block.content.title || ''}</h1>
              ${block.content.subtitle ? `<p style="color: ${YUNO_COLORS.textSecondary}; font-size: 16px; margin: 0;">${block.content.subtitle}</p>` : ''}
            </td>
          </tr>
        </table>
      `;
    
    case 'text':
      return `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
          <tr>
            <td style="padding: 0 20px;">
              <p style="color: ${YUNO_COLORS.text}; font-size: 16px; line-height: 1.6; margin: 0;">${block.content.text || ''}</p>
            </td>
          </tr>
        </table>
      `;
    
    case 'cta':
      return `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
          <tr>
            <td align="center" style="padding: 0 20px;">
              <a href="${block.content.buttonUrl || '#'}" 
                 style="display: inline-block; background: ${YUNO_COLORS.primary}; color: ${YUNO_COLORS.text}; 
                        font-size: 16px; font-weight: 600; text-decoration: none; padding: 14px 32px; 
                        border-radius: 8px;">
                ${block.content.buttonText || 'Click here'}
              </a>
            </td>
          </tr>
        </table>
      `;
    
    case 'image':
      return `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
          <tr>
            <td align="center" style="padding: 0 20px;">
              <img src="${block.content.imageUrl || ''}" alt="${block.content.altText || ''}" 
                   style="max-width: 100%; height: auto; border-radius: 12px;" />
            </td>
          </tr>
        </table>
      `;
    
    case 'divider':
      return `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin: 24px 0;">
          <tr>
            <td style="padding: 0 20px;">
              <div style="border-top: 1px solid ${YUNO_COLORS.border};"></div>
            </td>
          </tr>
        </table>
      `;
    
    case 'stats':
      return `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
          <tr>
            <td style="padding: 0 20px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 20px; text-align: center; width: 50%;">
                    <p style="color: ${YUNO_COLORS.primary}; margin: 0; font-size: 28px; font-weight: 800;">{{total_points}}</p>
                    <p style="color: ${YUNO_COLORS.textSecondary}; margin: 4px 0 0; font-size: 13px;">points</p>
                  </td>
                  <td style="width: 12px;"></td>
                  <td style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 20px; text-align: center; width: 50%;">
                    <p style="color: ${YUNO_COLORS.success}; margin: 0; font-size: 28px; font-weight: 800;">{{tier}}</p>
                    <p style="color: ${YUNO_COLORS.textSecondary}; margin: 4px 0 0; font-size: 13px;">tier</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      `;
    
    default:
      return '';
  }
}

function generateEmailHtml(
  venue: { name: string; logo_url?: string | null },
  blocks: EmailBlock[],
  customerData: { first_name?: string; total_points?: number; tier?: string },
  hideBranding = false
): string {
  const blocksHtml = blocks.map(generateBlockHtml).join('');
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${venue.name}</title>
</head>
<body style="margin: 0; padding: 0; background-color: ${YUNO_COLORS.background}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: ${YUNO_COLORS.background};">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: ${YUNO_COLORS.background};">
          
          <!-- Club Header - AUTO INJECTED -->
          <tr>
            <td style="padding: 24px 20px 32px; text-align: center; border-bottom: 1px solid ${YUNO_COLORS.border};">
              ${venue.logo_url ? `
                <img src="${venue.logo_url}" alt="${venue.name}" 
                     style="max-height: 60px; margin-bottom: 16px; border-radius: 12px;" />
              ` : ''}
              <h2 style="color: ${YUNO_COLORS.text}; font-size: 22px; font-weight: 700; margin: 0;">
                ${venue.name}
              </h2>
            </td>
          </tr>
          
          <!-- Email Content -->
          <tr>
            <td style="padding: 32px 0;">
              ${blocksHtml}
            </td>
          </tr>
          
          <!-- Footer — "Powered by Yuno" removed on Essential+ (branding cap) -->
          ${hideBranding ? '' : `
          <tr>
            <td style="padding: 24px 20px; text-align: center; border-top: 1px solid ${YUNO_COLORS.border};">
              <p style="color: ${YUNO_COLORS.textSecondary}; font-size: 12px; margin: 0;">
                Powered by Yuno
              </p>
            </td>
          </tr>`}
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.replace(/\{\{first_name\}\}/g, customerData.first_name || 'there')
   .replace(/\{\{total_points\}\}/g, String(customerData.total_points || 0))
   .replace(/\{\{tier\}\}/g, customerData.tier || 'Bronze')
   .replace(/\{\{venue_name\}\}/g, venue.name);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // DISABLED — legacy CRM email path. It blasted venue_customers filtered only by
  // loyalty tier, with NO marketing-consent check and no unsubscribe link, which
  // violates the opt-in policy (never email marketing to people who didn't accept it).
  // The supported, consent-gated path is `send-campaign`: promotional audiences are
  // resolved through resolve_campaign_audience which requires opted_in = true.
  return new Response(
    JSON.stringify({
      error: 'send-crm-campaign is deprecated and disabled. Use send-campaign (consent-gated).',
      disabled: true,
    }),
    { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );

  // eslint-disable-next-line no-unreachable
  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      throw new Error("RESEND_API_KEY not configured");
    }

    const resend = new Resend(resendApiKey);
    const { campaignId, venueId, testEmail } = await req.json();

    if (!campaignId || !venueId) {
      throw new Error("campaignId and venueId are required");
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    // Fetch campaign details
    const { data: campaign, error: campaignError } = await supabaseAdmin
      .from('crm_campaigns')
      .select('*')
      .eq('id', campaignId)
      .single();

    if (campaignError || !campaign) {
      throw new Error("Campaign not found");
    }

    // Fetch venue details
    const { data: venue, error: venueError } = await supabaseAdmin
      .from('venues')
      .select('name, logo_url')
      .eq('id', venueId)
      .single();

    if (venueError || !venue) {
      throw new Error("Venue not found");
    }

    // Branding cap: Core keeps "Powered by Yuno"; Essential+ / collab white-label.
    const hideBranding = await shouldHideYunoBranding(supabaseAdmin, venueId);

    // Parse email blocks from segment_config
    let blocks: EmailBlock[] = [];
    if (campaign.segment_config && typeof campaign.segment_config === 'object') {
      const config = campaign.segment_config as { blocks?: EmailBlock[] };
      blocks = config.blocks || [];
    }

    // If no blocks, create a simple text block from message
    if (blocks.length === 0 && campaign.message) {
      blocks = [
        {
          id: 'default-text',
          type: 'text',
          content: { text: campaign.message }
        }
      ];
    }

    // If test email, send only to that address
    if (testEmail) {
      const htmlContent = generateEmailHtml(venue, blocks, {
        first_name: 'Test User',
        total_points: 150,
        tier: 'Gold'
      }, hideBranding);

      const rawFrom = Deno.env.get('RESEND_FROM_EMAIL');
      const from = rawFrom
        ? (rawFrom.includes('<') ? rawFrom : `${venue.name} <${rawFrom}>`)
        : `${venue.name} <noreply@yunoapp.eu>`;

      const emailResponse = await resend.emails.send({
        from,
        to: [testEmail],
        subject: `[TEST] ${campaign.name}`,
        html: htmlContent
      });

      if (emailResponse?.error) {
        throw new Error(emailResponse.error.message);
      }

      return new Response(
        JSON.stringify({ success: true, message: "Test email sent", sentCount: 1 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build target customer list based on segment
    let query = supabaseAdmin
      .from('customer_loyalty')
      .select(`
        user_id,
        venue_customer_id,
        total_points_earned,
        tier,
        venue_customers!inner(email, first_name)
      `)
      .eq('venue_id', venueId);

    switch (campaign.target_segment) {
      case 'vip':
        query = query.in('tier', ['gold', 'platinum']);
        break;
      case 'loyal':
        query = query.gte('total_points_earned', 100);
        break;
      case 'inactive':
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        query = query.lt('last_points_earned_at', thirtyDaysAgo.toISOString());
        break;
      case 'new':
        query = query.lt('total_points_earned', 50);
        break;
      case 'big_spenders':
        query = query.gte('total_points_earned', 500);
        break;
      // 'all' - no filter needed
    }

    const { data: customers, error: customersError } = await query;

    if (customersError) {
      console.error('Error fetching customers:', customersError);
      throw new Error("Failed to fetch customers");
    }

    if (!customers || customers.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No customers match the segment", sentCount: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const rawFrom = Deno.env.get('RESEND_FROM_EMAIL');
    const from = rawFrom
      ? (rawFrom.includes('<') ? rawFrom : `${venue.name} <${rawFrom}>`)
      : `${venue.name} <noreply@yunoapp.eu>`;

    let sentCount = 0;
    const errors: string[] = [];

    // Send emails to all customers
    for (const customer of customers) {
      const venueCustomer = customer.venue_customers as any;
      const email = venueCustomer?.email;
      
      if (!email) continue;

      const htmlContent = generateEmailHtml(venue, blocks, {
        first_name: venueCustomer?.first_name || undefined,
        total_points: customer.total_points_earned || 0,
        tier: customer.tier || 'Bronze'
      }, hideBranding);

      try {
        const emailResponse = await resend.emails.send({
          from,
          to: [email],
          subject: campaign.name,
          html: htmlContent
        });

        if (emailResponse?.error) {
          errors.push(`${email}: ${emailResponse.error.message}`);
        } else {
          sentCount++;

          // Create notification record
          await supabaseAdmin.from('crm_notifications').insert({
            venue_id: venueId,
            campaign_id: campaignId,
            venue_customer_id: customer.venue_customer_id,
            user_id: customer.user_id,
            title: campaign.name,
            message: campaign.message,
            notification_type: 'email',
            sent_at: new Date().toISOString()
          });
        }
      } catch (err) {
        errors.push(`${email}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    // Update campaign stats
    await supabaseAdmin
      .from('crm_campaigns')
      .update({ 
        sent_count: (campaign.sent_count || 0) + sentCount,
        last_sent_at: new Date().toISOString()
      })
      .eq('id', campaignId);

    console.log(`Campaign ${campaignId} sent to ${sentCount} customers`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Campaign sent to ${sentCount} customers`,
        sentCount,
        errors: errors.length > 0 ? errors : undefined
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error sending CRM campaign:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
