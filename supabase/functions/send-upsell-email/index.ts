import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { EmailLanguage, t, wrapEmailWithBranding, escapeHtml } from "../_shared/email-branding.ts";
import { loadOptIns, optInToken, unsubscribeHeaders } from "../_shared/email-compliance.ts";
import { authorizeCronRequest } from "../_shared/cron-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const logStep = (step: string, details?: any) => {
  console.log(`[UPSELL-EMAIL] ${step}${details ? ` - ${JSON.stringify(details)}` : ''}`);
};

async function wasAlreadySent(supabase: any, userId: string, notifType: string, key: string): Promise<boolean> {
  const { data } = await supabase
    .from('notification_log')
    .select('id')
    .eq('user_id', userId)
    .eq('notification_type', notifType)
    .eq('title', key)
    .limit(1);
  return (data && data.length > 0);
}

async function markSent(supabase: any, userId: string, notifType: string, key: string) {
  await supabase
    .from('notification_log')
    .insert({ user_id: userId, notification_type: notifType, title: key });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const auth = await authorizeCronRequest(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    logStep("Function started", { via: auth.via });

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) throw new Error("RESEND_API_KEY not configured");

    const rawFrom = Deno.env.get('RESEND_FROM_EMAIL');
    const from = rawFrom ? (rawFrom.includes('<') ? rawFrom : `Yuno <${rawFrom}>`) : 'Yuno <noreply@yunoapp.eu>';

    // Find tickets purchased in the last 45 minutes
    const fortyFiveMinAgo = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    const { data: recentTickets } = await supabaseAdmin
      .from('tickets')
      .select('id, user_id, user_email, event_id, created_at')
      .eq('status', 'paid')
      .gte('created_at', fortyFiveMinAgo)
      .lte('created_at', thirtyMinAgo)
      .not('user_id', 'is', null);

    if (!recentTickets || recentTickets.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: "No recent tickets to upsell" }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Deduplicate by user+event
    const seen = new Set<string>();
    const uniqueTickets = recentTickets.filter(t => {
      const key = `${t.user_id}-${t.event_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const optins = await loadOptIns(supabaseAdmin, uniqueTickets.map(tk => tk.user_email));

    let sentCount = 0;

    for (const ticket of uniqueTickets) {
      try {
        const dedupKey = `${ticket.user_id}-${ticket.event_id}`;

        // Check notification_log for dedup
        const alreadySent = await wasAlreadySent(supabaseAdmin, ticket.user_id, 'upsell', dedupKey);
        if (alreadySent) continue;

        // Skip if user already has a table reservation for this event
        const { data: existingTable } = await supabaseAdmin
          .from('table_reservations')
          .select('id')
          .eq('event_id', ticket.event_id)
          .eq('user_id', ticket.user_id)
          .limit(1);

        if (existingTable && existingTable.length > 0) continue;

        const { data: event } = await supabaseAdmin
          .from('events')
          .select('id, title, venue_id, organizer_user_id, tables_enabled, venues(name, address)')
          .eq('id', ticket.event_id)
          .single();

        if (!event) continue;

        // Marketing (upsell): send ONLY to recipients who opted in for this venue/organizer.
        const unsubToken = optInToken(optins, ticket.user_email, { venueId: event.venue_id, organizerUserId: (event as any).organizer_user_id });
        if (unsubToken === null) continue;

        const venueName = (event.venues as any)?.name || '';
        const venueSlug = event.venue_id;

        let lang: EmailLanguage = 'fr';
        let firstName = '';
        if (ticket.user_id) {
          const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('first_name, preferred_language')
            .eq('id', ticket.user_id)
            .single();
          if (profile?.preferred_language && ['en', 'es', 'fr'].includes(profile.preferred_language)) {
            lang = profile.preferred_language as EmailLanguage;
          }
          firstName = profile?.first_name || '';
        }

        const nameStr = firstName ? ` ${firstName}` : '';
        const safeEventTitle = escapeHtml(event.title);
        const safeVenueName = escapeHtml(venueName);

        let upsellOptions = '';
        
        if (event.tables_enabled) {
          upsellOptions += `
            <table width="100%" cellpadding="0" cellspacing="0" style="background: rgba(255,255,255,0.05); border-radius: 12px; margin-bottom: 12px;">
              <tr><td style="padding: 20px;">
                <p style="color: #fff; font-weight: 700; font-size: 16px; margin: 0 0 8px;">${t('upsell.upgradeVip', lang)}</p>
                <p style="color: #999; font-size: 14px; margin: 0 0 16px;">${t('upsell.upgradeVipDesc', lang)}</p>
                <a href="https://yunoapp.eu/club/${venueSlug}" style="display: inline-block; background: #dc2626; color: #fff; text-decoration: none; padding: 10px 24px; border-radius: 8px; font-weight: 600; font-size: 13px;">
                  ${t('upsell.ctaVip', lang)}
                </a>
              </td></tr>
            </table>
          `;
        }

        upsellOptions += `
          <table width="100%" cellpadding="0" cellspacing="0" style="background: rgba(255,255,255,0.05); border-radius: 12px;">
            <tr><td style="padding: 20px;">
              <p style="color: #fff; font-weight: 700; font-size: 16px; margin: 0 0 8px;">${t('upsell.preorderDrinks', lang)}</p>
              <p style="color: #999; font-size: 14px; margin: 0 0 16px;">${t('upsell.preorderDrinksDesc', lang)}</p>
              <a href="https://yunoapp.eu/club/${venueSlug}" style="display: inline-block; background: rgba(220,38,38,0.15); border: 1px solid rgba(220,38,38,0.3); color: #dc2626; text-decoration: none; padding: 10px 24px; border-radius: 8px; font-weight: 600; font-size: 13px;">
                ${t('upsell.ctaDrinks', lang)}
              </a>
            </td></tr>
          </table>
        `;

        const emailContent = `
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding: 32px 28px;">
              <h1 style="color: #fff; font-size: 22px; font-weight: 700; margin: 0 0 16px;">${t('upsell.title', lang)}</h1>
              <p style="color: #ccc; font-size: 15px; line-height: 1.6; margin: 0 0 8px;">${t('upsell.greeting', lang, { name: nameStr })}</p>
              <p style="color: #ccc; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
                ${t('upsell.body', lang, { eventTitle: safeEventTitle, venueName: safeVenueName })}
              </p>
              ${upsellOptions}
              <div style="border-top: 1px solid rgba(255,255,255,0.08); margin: 24px 0 20px;"></div>
              <p style="color: #666; font-size: 13px; margin: 0;">${t('upsell.teamSign', lang)}</p>
            </td></tr>
          </table>
        `;

        const html = wrapEmailWithBranding(emailContent, lang, venueName);
        const subject = t('upsell.subject', lang, { eventTitle: event.title });

        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendApiKey}` },
          body: JSON.stringify({ from, to: [ticket.user_email], subject, html, headers: unsubscribeHeaders(unsubToken) }),
        });

        if (res.ok) {
          await markSent(supabaseAdmin, ticket.user_id, 'upsell', dedupKey);
          sentCount++;
        } else {
          console.error(`Failed upsell to ${ticket.user_email}:`, await res.text());
        }
      } catch (err) {
        console.error(`Upsell error for ticket ${ticket.id}:`, err);
      }
    }

    logStep("Completed", { sentCount });
    return new Response(
      JSON.stringify({ success: true, sent: sentCount }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[UPSELL-EMAIL] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});