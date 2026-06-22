import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { Resend } from "https://esm.sh/resend@2.0.0";
import { 
  EmailLanguage, 
  t, 
  wrapEmailWithBranding 
} from "../_shared/email-branding.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[POST-VISIT-NOTIFICATION] ${step}${detailsStr}`);
};

interface VisitSummary {
  userId: string;
  email: string;
  firstName: string | null;
  lang: EmailLanguage;
  venueId: string;
  venueName: string;
  orderIds: string[];
  totalSpent: number;
  pointsEarned: number;
  currentBalance: number;
  tier: string;
  nextTierProgress?: {
    nextTier: string;
    pointsNeeded: number;
    progressPercent: number;
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      throw new Error("RESEND_API_KEY not configured");
    }

    const resend = new Resend(resendApiKey);

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    // Find orders that were served in the last 2 hours and haven't had notification sent
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    
    const { data: recentOrders, error: ordersError } = await supabaseAdmin
      .from('orders')
      .select(`
        id,
        user_id,
        user_email,
        venue_id,
        total,
        served_at,
        post_visit_notified
      `)
      .eq('status', 'served')
      .eq('post_visit_notified', false)
      .gte('served_at', twoHoursAgo)
      .not('user_id', 'is', null);

    if (ordersError) {
      throw new Error(`Error fetching orders: ${ordersError.message}`);
    }

    logStep("Found orders to process", { count: recentOrders?.length || 0 });

    if (!recentOrders || recentOrders.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No orders to process", notified: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Group orders by user and venue
    const userVenueMap = new Map<string, {
      userId: string;
      email: string;
      venueId: string;
      orderIds: string[];
      totalSpent: number;
    }>();

    for (const order of recentOrders) {
      const key = `${order.user_id}_${order.venue_id}`;
      if (!userVenueMap.has(key)) {
        userVenueMap.set(key, {
          userId: order.user_id,
          email: order.user_email,
          venueId: order.venue_id,
          orderIds: [],
          totalSpent: 0
        });
      }
      const entry = userVenueMap.get(key)!;
      entry.orderIds.push(order.id);
      entry.totalSpent += order.total || 0;
    }

    let notifiedCount = 0;
    const processedOrderIds: string[] = [];

    for (const [_, data] of userVenueMap) {
      try {
        // Fetch venue details
        const { data: venue } = await supabaseAdmin
          .from('venues')
          .select('name, logo_url')
          .eq('id', data.venueId)
          .single();

        if (!venue) continue;

        // Check if loyalty is enabled for this venue
        const { data: loyaltySettings } = await supabaseAdmin
          .from('loyalty_settings')
          .select('is_enabled, post_visit_notification')
          .eq('venue_id', data.venueId)
          .single();

        if (!loyaltySettings?.is_enabled || !loyaltySettings?.post_visit_notification) {
          // Mark orders as notified even if we skip
          processedOrderIds.push(...data.orderIds);
          continue;
        }

        // Fetch user profile with language preference
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('first_name, email, preferred_language')
          .eq('id', data.userId)
          .single();

        const email = data.email || profile?.email;
        if (!email) {
          processedOrderIds.push(...data.orderIds);
          continue;
        }

        // Determine user's preferred language
        let lang: EmailLanguage = 'fr';
        if (profile?.preferred_language && ['en', 'es', 'fr'].includes(profile.preferred_language)) {
          lang = profile.preferred_language as EmailLanguage;
        }

        // Fetch loyalty data
        const { data: loyaltyData } = await supabaseAdmin
          .from('customer_loyalty')
          .select('current_balance, total_points_earned, tier')
          .eq('venue_id', data.venueId)
          .eq('user_id', data.userId)
          .single();

        // Fetch points earned from these orders
        const { data: transactions } = await supabaseAdmin
          .from('loyalty_transactions')
          .select('points')
          .eq('transaction_type', 'earn')
          .in('reference_id', data.orderIds);

        const pointsEarned = transactions?.reduce((sum, t) => sum + t.points, 0) || 0;

        // Calculate tier progress
        const tierThresholds: Record<string, { min: number; next: string | null; nextMin: number }> = {
          bronze: { min: 0, next: 'silver', nextMin: 200 },
          silver: { min: 200, next: 'gold', nextMin: 500 },
          gold: { min: 500, next: 'platinum', nextMin: 1000 },
          platinum: { min: 1000, next: null, nextMin: 0 }
        };

        const currentTier = loyaltyData?.tier || 'bronze';
        const tierInfo = tierThresholds[currentTier];
        let nextTierProgress = null;

        if (tierInfo?.next) {
          const currentSpent = data.totalSpent;
          const pointsNeeded = tierInfo.nextMin - currentSpent;
          nextTierProgress = {
            nextTier: tierInfo.next,
            pointsNeeded: Math.max(0, pointsNeeded),
            progressPercent: Math.min(100, (currentSpent / tierInfo.nextMin) * 100)
          };
        }

        const summary: VisitSummary = {
          userId: data.userId,
          email,
          firstName: profile?.first_name || null,
          lang,
          venueId: data.venueId,
          venueName: venue.name,
          orderIds: data.orderIds,
          totalSpent: data.totalSpent,
          pointsEarned,
          currentBalance: loyaltyData?.current_balance || 0,
          tier: currentTier,
          nextTierProgress: nextTierProgress || undefined
        };

        // Send email
        const tierColors: Record<string, string> = {
          bronze: '#CD7F32',
          silver: '#C0C0C0',
          gold: '#FFD700',
          platinum: '#E5E4E2'
        };

        const emailContent = `
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); padding: 30px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 26px; font-weight: 700;">
              ${t('postVisit.thanks', lang)}${summary.firstName ? `, ${summary.firstName}` : ''}! 🎉
            </h1>
            <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0; font-size: 16px;">
              ${summary.venueName}
            </p>
          </div>

          <!-- Content -->
          <div style="padding: 30px;">
            <!-- Points Earned Card -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
              <tr>
                <td style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); border-radius: 12px; padding: 24px; text-align: center;">
                  <p style="color: rgba(255,255,255,0.8); margin: 0 0 8px; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">
                    ${t('postVisit.pointsEarnedToday', lang)}
                  </p>
                  <p style="color: #ffffff; margin: 0; font-size: 48px; font-weight: 800;">
                    +${summary.pointsEarned}
                  </p>
                  <p style="color: rgba(255,255,255,0.7); margin: 8px 0 0; font-size: 14px;">
                    ${t('postVisit.fromSpent', lang, { amount: summary.totalSpent.toFixed(2) })}
                  </p>
                </td>
              </tr>
            </table>

            <!-- Current Balance -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
              <tr>
                <td style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 20px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="width: 50%; text-align: center; border-right: 1px solid rgba(255,255,255,0.1);">
                        <p style="color: #a0a0a0; margin: 0 0 4px; font-size: 12px; text-transform: uppercase;">
                          ${t('postVisit.yourBalance', lang)}
                        </p>
                        <p style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700;">
                          ${summary.currentBalance}
                        </p>
                        <p style="color: #a0a0a0; margin: 0; font-size: 12px;">${t('postVisit.points', lang)}</p>
                      </td>
                      <td style="width: 50%; text-align: center;">
                        <p style="color: #a0a0a0; margin: 0 0 4px; font-size: 12px; text-transform: uppercase;">
                          ${t('postVisit.yourTier', lang)}
                        </p>
                        <p style="color: ${tierColors[summary.tier] || '#ffffff'}; margin: 0; font-size: 24px; font-weight: 700; text-transform: capitalize;">
                          ${summary.tier}
                        </p>
                        <p style="color: #a0a0a0; margin: 0; font-size: 12px;">${t('postVisit.member', lang)}</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            ${summary.nextTierProgress ? `
            <!-- Next Tier Progress -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
              <tr>
                <td style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 16px;">
                  <p style="color: #a0a0a0; margin: 0 0 12px; font-size: 14px;">
                    ${summary.nextTierProgress.pointsNeeded > 0 
                      ? `${t('postVisit.spendMore', lang, { amount: summary.nextTierProgress.pointsNeeded.toFixed(0) })} <span style="color: ${tierColors[summary.nextTierProgress.nextTier]}; text-transform: capitalize; font-weight: 600;">${summary.nextTierProgress.nextTier}</span>`
                      : `${t('postVisit.almostThere', lang)} <span style="color: ${tierColors[summary.nextTierProgress.nextTier]}; text-transform: capitalize; font-weight: 600;">${summary.nextTierProgress.nextTier}</span>!`
                    }
                  </p>
                  <div style="background: rgba(255,255,255,0.1); border-radius: 8px; height: 8px; overflow: hidden;">
                    <div style="background: linear-gradient(90deg, #dc2626, #ef4444); height: 100%; width: ${summary.nextTierProgress.progressPercent}%; border-radius: 8px;"></div>
                  </div>
                </td>
              </tr>
            </table>
            ` : ''}

            <!-- CTA -->
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="text-align: center; padding: 16px 0;">
                  <p style="color: #a0a0a0; margin: 0 0 16px; font-size: 14px;">
                    ${t('postVisit.redeemPoints', lang)}
                  </p>
                  <a href="https://yunoapp.eu/profile" 
                     style="display: inline-block; background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
                    ${t('postVisit.viewRewards', lang)}
                  </a>
                </td>
              </tr>
            </table>

            <!-- Venue Footer -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 24px; padding-top: 24px; border-top: 1px solid rgba(255,255,255,0.1);">
              <tr>
                <td style="text-align: center;">
                  <p style="color: #666666; margin: 0; font-size: 13px;">
                    ${t('postVisit.seeYouNext', lang)} ${summary.venueName}!
                  </p>
                </td>
              </tr>
            </table>
          </div>
        `;

        const html = wrapEmailWithBranding(emailContent, lang, venue.name);

        const rawFrom = Deno.env.get('RESEND_FROM_EMAIL');
        const from = rawFrom
          ? (rawFrom.includes('<') ? rawFrom : `Yuno <${rawFrom}>`)
          : 'Yuno <noreply@yunoapp.eu>';

        // Localized subject
        const subjectMap: Record<EmailLanguage, string> = {
          en: `Thanks for your visit! You earned ${pointsEarned} points 🎉`,
          es: `¡Gracias por tu visita! Has ganado ${pointsEarned} puntos 🎉`,
          fr: `Merci pour ta visite ! Tu as gagné ${pointsEarned} points 🎉`
        };

        await resend.emails.send({
          from,
          to: [email],
          subject: subjectMap[lang],
          html
        });

        logStep("Email sent", { email, pointsEarned, lang });
        notifiedCount++;
        processedOrderIds.push(...data.orderIds);

      } catch (emailError) {
        console.error('Error sending email:', emailError);
        processedOrderIds.push(...data.orderIds);
      }
    }

    // Mark all processed orders as notified
    if (processedOrderIds.length > 0) {
      await supabaseAdmin
        .from('orders')
        .update({ post_visit_notified: true })
        .in('id', processedOrderIds);
    }

    logStep("Completed", { notifiedCount, processedOrders: processedOrderIds.length });

    return new Response(
      JSON.stringify({ 
        success: true, 
        notified: notifiedCount,
        processedOrders: processedOrderIds.length 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in post-visit notification:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
