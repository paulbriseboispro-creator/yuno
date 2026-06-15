import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { 
  EmailLanguage, 
  t, 
  wrapEmailWithBranding,
  escapeHtml 
} from "../_shared/email-branding.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[SEND-EVENT-UPDATE] ${step}${detailsStr}`);
};

interface ChangeItem {
  type: 'time' | 'dj' | 'details';
  oldValue: string;
  newValue: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) throw new Error("RESEND_API_KEY not configured");

    const { eventId, changes } = await req.json() as { eventId: string; changes: ChangeItem[] };

    if (!eventId || !changes || changes.length === 0) {
      throw new Error("eventId and changes are required");
    }

    const { data: event, error: eventError } = await supabaseAdmin
      .from('events')
      .select('id, title, start_at, end_at, venue_id, poster_url, venues(name)')
      .eq('id', eventId)
      .single();

    if (eventError || !event) throw new Error("Event not found");

    const venueName = (event.venues as any)?.name || '';
    const safeEventTitle = escapeHtml(event.title);
    const safeVenueName = escapeHtml(venueName);
    const eventImageUrl = event.poster_url || null;

    const { data: tickets } = await supabaseAdmin
      .from('tickets')
      .select('user_id, user_email')
      .eq('event_id', eventId)
      .in('status', ['paid', 'used']);

    const { data: tableRes } = await supabaseAdmin
      .from('table_reservations')
      .select('user_id, user_email')
      .eq('event_id', eventId)
      .eq('status', 'confirmed');

    const emailMap = new Map<string, string | null>();
    for (const t of tickets || []) {
      if (t.user_email) emailMap.set(t.user_email, t.user_id);
    }
    for (const r of tableRes || []) {
      if (r.user_email) emailMap.set(r.user_email, r.user_id);
    }

    logStep("Recipients found", { count: emailMap.size });

    if (emailMap.size === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: "No ticket holders to notify" }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const rawFrom = Deno.env.get('RESEND_FROM_EMAIL');
    const from = rawFrom
      ? (rawFrom.includes('<') ? rawFrom : `Yuno <${rawFrom}>`)
      : 'Yuno <onboarding@resend.dev>';

    let sentCount = 0;

    for (const [recipientEmail, userId] of emailMap) {
      try {
        let lang: EmailLanguage = 'fr';
        let firstName = '';
        if (userId) {
          const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('first_name, preferred_language')
            .eq('id', userId)
            .single();
          if (profile?.preferred_language && ['en', 'es', 'fr'].includes(profile.preferred_language)) {
            lang = profile.preferred_language as EmailLanguage;
          }
          firstName = profile?.first_name || '';
        }

        const changeTypeLabels: Record<string, string> = {
          time: t('eventUpdate.timeChanged', lang),
          dj: t('eventUpdate.djChanged', lang),
          details: t('eventUpdate.detailsChanged', lang),
        };

        const changesHtml = changes.map(change => `
          <tr>
            <td style="padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.05);">
              <p style="color: #dc2626; font-weight: 600; font-size: 14px; margin: 0 0 8px;">
                ${changeTypeLabels[change.type] || change.type}
              </p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width: 48%;">
                    <p style="color: #888; font-size: 11px; margin: 0 0 2px; text-transform: uppercase;">${t('eventUpdate.from', lang)}</p>
                    <p style="color: #999; font-size: 13px; margin: 0; text-decoration: line-through;">${escapeHtml(change.oldValue)}</p>
                  </td>
                  <td style="width: 4%; text-align: center; color: #555;">→</td>
                  <td style="width: 48%;">
                    <p style="color: #888; font-size: 11px; margin: 0 0 2px; text-transform: uppercase;">${t('eventUpdate.to', lang)}</p>
                    <p style="color: #fff; font-size: 13px; margin: 0; font-weight: 600;">${escapeHtml(change.newValue)}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        `).join('');

        const nameStr = firstName ? ` ${firstName}` : '';

        const emailContent = `
          ${eventImageUrl ? `
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <img src="${eventImageUrl}" alt="${safeEventTitle}" style="width: 100%; max-height: 200px; object-fit: cover; display: block;" />
              </td>
            </tr>
          </table>
          ` : ''}

          <!-- Header gradient -->
          <div style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); padding: 24px 28px; text-align: center;">
            <div style="font-size: 20px; font-weight: bold; color: #fff; margin-bottom: 4px;">${safeVenueName}</div>
            <h1 style="color: white; margin: 0; font-size: 22px;">${t('eventUpdate.title', lang)}</h1>
          </div>

          <!-- Content -->
          <div style="padding: 28px;">
            <p style="color: #fff; font-size: 16px; margin-bottom: 16px;">
              ${nameStr ? `${t('ticket.greeting', lang)}${nameStr}!` : `${t('ticket.greeting', lang)}!`}
            </p>

            <p style="color: #a0a0a0; font-size: 14px; line-height: 1.6; margin-bottom: 24px;">
              ${t('eventUpdate.body', lang, { eventTitle: safeEventTitle, venueName: safeVenueName })}
            </p>
            
            <!-- Changes Card -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background: rgba(255,255,255,0.05); border-radius: 12px; overflow: hidden; margin-bottom: 24px;">
              ${changesHtml}
            </table>
            
            <table cellpadding="0" cellspacing="0" style="margin: 0 0 24px;">
              <tr>
                <td>
                  <a href="https://yunoapp.eu/club/${event.venue_id}" 
                     style="display: inline-block; background: #dc2626; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 10px; font-weight: 600; font-size: 14px;">
                    ${t('eventUpdate.viewEvent', lang)}
                  </a>
                </td>
              </tr>
            </table>
            
            <!-- Footer -->
            <div style="text-align: center; margin-top: 24px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1);">
              <p style="color: #fff; font-size: 14px; margin: 5px 0;">
                ${t('ticket.thanks', lang)}
              </p>
              <p style="color: #666; font-size: 13px; margin: 8px 0 0;">
                ${t('eventUpdate.teamSign', lang)}
              </p>
            </div>
          </div>
        `;

        const html = wrapEmailWithBranding(emailContent, lang, venueName);
        const subject = t('eventUpdate.subject', lang, { eventTitle: event.title });

        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${resendApiKey}`,
          },
          body: JSON.stringify({ from, to: [recipientEmail], subject, html }),
        });

        if (res.ok) {
          sentCount++;
        } else {
          const errData = await res.text();
          console.error(`Failed to email ${recipientEmail}:`, errData);
        }
      } catch (emailErr) {
        console.error(`Email error for ${recipientEmail}:`, emailErr);
      }
    }

    logStep("Completed", { sentCount, totalRecipients: emailMap.size });

    return new Response(
      JSON.stringify({ success: true, sent: sentCount, total: emailMap.size }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[SEND-EVENT-UPDATE] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
