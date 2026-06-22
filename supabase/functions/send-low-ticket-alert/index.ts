import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { EmailLanguage, t, wrapEmailWithBranding, escapeHtml } from "../_shared/email-branding.ts";

import { authorizeCronRequest } from "../_shared/cron-auth.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const logStep = (step: string, details?: any) => {
  console.log(`[LOW-TICKET-ALERT] ${step}${details ? ` - ${JSON.stringify(details)}` : ''}`);
};

// Generate a deterministic UUID v5-like ID from an email string for notification_log
function emailToUuid(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    const char = email.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0');
  return `00000000-0000-4000-8000-${hex.padStart(12, '0')}`;
}

async function wasAlreadySent(supabase: any, userId: string, notifType: string, eventId: string): Promise<boolean> {
  const { data } = await supabase
    .from('notification_log')
    .select('id')
    .eq('user_id', userId)
    .eq('notification_type', notifType)
    .eq('title', eventId)
    .limit(1);
  return (data && data.length > 0);
}

async function markSent(supabase: any, userId: string, notifType: string, eventId: string) {
  await supabase
    .from('notification_log')
    .insert({ user_id: userId, notification_type: notifType, title: eventId });
}

serve(async (req) => {
    // SECURITY: scheduled function — require shared cron secret or super-admin JWT
    const _cronAuth = await authorizeCronRequest(req);
    if (!_cronAuth.ok) {
      return new Response(
        JSON.stringify({ error: _cronAuth.message }),
        { status: _cronAuth.status, headers: { 'Content-Type': 'application/json' } }
      );
    }

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    logStep("Function started");

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) throw new Error("RESEND_API_KEY not configured");

    const rawFrom = Deno.env.get('RESEND_FROM_EMAIL');
    const from = rawFrom ? (rawFrom.includes('<') ? rawFrom : `Yuno <${rawFrom}>`) : 'Yuno <noreply@yunoapp.eu>';

    // Find active future events
    const now = new Date().toISOString();
    const { data: events } = await supabaseAdmin
      .from('events')
      .select('id, title, venue_id, max_tickets, start_at, venues(name, owner_id)')
      .eq('is_active', true)
      .eq('ticketing_enabled', true)
      .gt('start_at', now)
      .not('max_tickets', 'is', null);

    if (!events || events.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: "No events to check" }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let sentCount = 0;

    for (const event of events) {
      const { data: rounds } = await supabaseAdmin
        .from('ticket_rounds')
        .select('tickets_sold, max_tickets')
        .eq('event_id', event.id);

      const totalSold = rounds?.reduce((sum, r) => sum + (r.tickets_sold || 0), 0) || 0;
      const totalMax = event.max_tickets || rounds?.reduce((sum, r) => sum + (r.max_tickets || 0), 0) || 0;

      if (totalMax === 0) continue;

      const percent = Math.round((totalSold / totalMax) * 100);
      const remaining = totalMax - totalSold;

      if (percent < 80) continue;

      const venueName = (event.venues as any)?.name || '';
      const ownerId = (event.venues as any)?.owner_id;
      const safeEventTitle = escapeHtml(event.title);
      const safeVenueName = escapeHtml(venueName);

      // 1. Notify owner (dedup check)
      if (ownerId) {
        const alreadySent = await wasAlreadySent(supabaseAdmin, ownerId, 'low_ticket_owner', event.id);
        if (!alreadySent) {
          const { data: ownerProfile } = await supabaseAdmin
            .from('profiles')
            .select('email, preferred_language')
            .eq('id', ownerId)
            .single();

          if (ownerProfile?.email) {
            const lang = (ownerProfile.preferred_language as EmailLanguage) || 'fr';
            const ownerContent = `
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr><td style="padding: 32px 28px;">
                  <h1 style="color: #fff; font-size: 22px; font-weight: 700; margin: 0 0 16px;">${t('lowTicket.title', lang)}</h1>
                  <p style="color: #ccc; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
                    ${t('lowTicket.ownerBody', lang, { eventTitle: safeEventTitle, sold: String(totalSold), total: String(totalMax), percent: String(percent) })}
                  </p>
                  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                    <tr>
                      <td style="background:rgba(34,197,94,0.1);border-radius:12px;padding:20px;text-align:center;width:33%">
                        <p style="color:#22c55e;margin:0;font-size:28px;font-weight:800">${totalSold}</p>
                        <p style="color:#9ca3af;margin:4px 0 0;font-size:13px">${t('nightSummary.tickets', lang)}</p>
                      </td>
                      <td style="width:8px"></td>
                      <td style="background:rgba(220,38,38,0.1);border-radius:12px;padding:20px;text-align:center;width:33%">
                        <p style="color:#dc2626;margin:0;font-size:28px;font-weight:800">${remaining}</p>
                        <p style="color:#9ca3af;margin:4px 0 0;font-size:13px">remaining</p>
                      </td>
                      <td style="width:8px"></td>
                      <td style="background:rgba(245,158,11,0.1);border-radius:12px;padding:20px;text-align:center;width:33%">
                        <p style="color:#f59e0b;margin:0;font-size:28px;font-weight:800">${percent}%</p>
                        <p style="color:#9ca3af;margin:4px 0 0;font-size:13px">sold</p>
                      </td>
                    </tr>
                  </table>
                  <p style="color: #666; font-size: 13px; margin: 0;">${t('nightSummary.teamSign', lang)}</p>
                </td></tr>
              </table>
            `;
            const ownerHtml = wrapEmailWithBranding(ownerContent, lang, venueName);
            const res = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendApiKey}` },
              body: JSON.stringify({ from, to: [ownerProfile.email], subject: t('lowTicket.ownerSubject', lang, { eventTitle: event.title }), html: ownerHtml }),
            });
            if (res.ok) {
              await markSent(supabaseAdmin, ownerId, 'low_ticket_owner', event.id);
              sentCount++;
            }
          }
        }
      }

      // 2. Notify waitlist/private list members who haven't bought yet
      const { data: waitlistMembers } = await supabaseAdmin
        .from('event_waitlist')
        .select('email, full_name, user_id')
        .eq('event_id', event.id);

      if (!waitlistMembers || waitlistMembers.length === 0) continue;

      const { data: ticketHolders } = await supabaseAdmin
        .from('tickets')
        .select('user_email')
        .eq('event_id', event.id)
        .in('status', ['paid', 'used']);

      const ticketEmails = new Set(ticketHolders?.map(t => t.user_email) || []);

      for (const member of waitlistMembers) {
        if (ticketEmails.has(member.email)) continue;

        // Dedup: use user_id if available, otherwise generate from email
        const recipientId = member.user_id || emailToUuid(member.email);
        const alreadySent = await wasAlreadySent(supabaseAdmin, recipientId, 'low_ticket_user', event.id);
        if (alreadySent) continue;

        let lang: EmailLanguage = 'fr';
        if (member.user_id) {
          const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('preferred_language')
            .eq('id', member.user_id)
            .single();
          if (profile?.preferred_language && ['en', 'es', 'fr'].includes(profile.preferred_language)) {
            lang = profile.preferred_language as EmailLanguage;
          }
        }

        const content = `
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding: 32px 28px; text-align: center;">
              <h1 style="color: #fff; font-size: 24px; font-weight: 700; margin: 0 0 16px;">${t('lowTicket.title', lang)}</h1>
              <p style="color: #ccc; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
                ${t('lowTicket.body', lang, { eventTitle: safeEventTitle, venueName: safeVenueName, remaining: String(remaining) })}
              </p>
              <a href="https://yunoapp.eu/club/${event.venue_id}" style="display: inline-block; background: #dc2626; color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 15px;">
                ${t('lowTicket.cta', lang)}
              </a>
              <div style="border-top: 1px solid rgba(255,255,255,0.08); margin: 24px 0 20px;"></div>
              <p style="color: #666; font-size: 13px; margin: 0;">${t('lowTicket.teamSign', lang)}</p>
            </td></tr>
          </table>
        `;

        const html = wrapEmailWithBranding(content, lang, venueName);
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendApiKey}` },
          body: JSON.stringify({ from, to: [member.email], subject: t('lowTicket.subject', lang, { eventTitle: event.title }), html }),
        });
        if (res.ok) {
          await markSent(supabaseAdmin, recipientId, 'low_ticket_user', event.id);
          sentCount++;
        }
      }
    }

    logStep("Completed", { sentCount });
    return new Response(
      JSON.stringify({ success: true, sent: sentCount }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[LOW-TICKET-ALERT] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});