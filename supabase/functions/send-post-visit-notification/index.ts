import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { Resend } from "https://esm.sh/resend@2.0.0";
import {
  EmailLanguage
} from "../_shared/email-branding.ts";
import { buildPostVisitLoyalty } from "../_shared/email-templates.ts";

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

        // Build a localized next-reward hint from the tier progress, if any
        let rewardHint: string | undefined;
        if (summary.nextTierProgress) {
          const ntp = summary.nextTierProgress;
          const tierName = ntp.nextTier.charAt(0).toUpperCase() + ntp.nextTier.slice(1);
          if (ntp.pointsNeeded > 0) {
            const amt = ntp.pointsNeeded.toFixed(0);
            rewardHint = {
              en: `Spend €${amt} more to reach ${tierName}.`,
              es: `Gasta €${amt} más para alcanzar ${tierName}.`,
              fr: `Dépense ${amt}€ de plus pour atteindre ${tierName}.`,
            }[lang];
          } else {
            rewardHint = {
              en: `You're almost at ${tierName}!`,
              es: `¡Casi llegas a ${tierName}!`,
              fr: `Tu y es presque, niveau ${tierName} !`,
            }[lang];
          }
        }

        const mail = buildPostVisitLoyalty({
          lang,
          firstName: summary.firstName || undefined,
          venueName: summary.venueName,
          pointsEarned: String(summary.pointsEarned),
          totalPoints: String(summary.currentBalance),
          tier: summary.tier ? summary.tier.charAt(0).toUpperCase() + summary.tier.slice(1) : undefined,
          rewardHint,
          loyaltyUrl: 'https://yunoapp.eu/profile',
        });

        const rawFrom = Deno.env.get('RESEND_FROM_EMAIL');
        const from = rawFrom
          ? (rawFrom.includes('<') ? rawFrom : `Yuno <${rawFrom}>`)
          : 'Yuno <noreply@yunoapp.eu>';

        await resend.emails.send({
          from,
          to: [email],
          subject: mail.subject,
          html: mail.html
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
