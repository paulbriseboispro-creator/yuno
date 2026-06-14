import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { buildCampaignHtml, slugifyVenueName, type EmailBlock } from '../_shared/campaign-html.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const EMAIL_DOMAIN = Deno.env.get('EMAIL_DOMAIN') || 'yunoapp.eu';
const PUBLIC_URL = Deno.env.get('PUBLIC_APP_URL') || 'https://yunoapp.eu';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface Recipient {
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  unsubscribe_token?: string | null;
}

async function sendBatch(from: string, replyTo: string | null, subject: string, recipients: Recipient[], buildHtml: (r: Recipient) => string, campaignId: string) {
  const payload = recipients.map((r) => {
    const headers: Record<string, string> = {};
    if (r.unsubscribe_token) {
      const url = `${PUBLIC_URL}/unsubscribe?token=${r.unsubscribe_token}`;
      headers['List-Unsubscribe'] = `<${url}>`;
      headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
    }
    return {
      from,
      to: [r.email],
      subject,
      html: buildHtml(r),
      reply_to: replyTo || undefined,
      headers,
      tags: [{ name: 'campaign_id', value: campaignId }],
    };
  });

  const res = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend batch failed (${res.status}): ${body}`);
  }
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured');

    const authHeader = req.headers.get('Authorization');
    const body = await req.json();
    const { campaign_id, send_test, test_email, scheduled } = body;
    if (!campaign_id) {
      return new Response(JSON.stringify({ error: 'campaign_id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Authentification : soit user JWT, soit appel interne (cron) avec service role bearer
    let actingUserId: string | null = null;
    if (!scheduled) {
      if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData } = await userClient.auth.getUser();
      if (!userData?.user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      actingUserId = userData.user.id;
    }

    const { data: campaign, error: cErr } = await admin
      .from('email_campaigns').select('*').eq('id', campaign_id).single();
    if (cErr || !campaign) throw new Error('Campaign not found');

    // Resolve sender + ownership
    let senderName = '';
    let senderCity: string | null = null;
    let ownerUserId: string | null = null;

    if (campaign.venue_id) {
      const { data: venue } = await admin
        .from('venues').select('id, name, city, owner_id').eq('id', campaign.venue_id).single();
      if (!venue) throw new Error('Venue not found');
      senderName = venue.name; senderCity = venue.city; ownerUserId = venue.owner_id;
    } else if (campaign.organizer_user_id) {
      const { data: orgProfile } = await admin
        .from('profiles').select('id, organization_name, first_name, last_name, city').eq('id', campaign.organizer_user_id).single();
      if (!orgProfile) throw new Error('Organizer not found');
      senderName = orgProfile.organization_name || `${orgProfile.first_name || ''} ${orgProfile.last_name || ''}`.trim() || 'Organisateur';
      senderCity = (orgProfile as any).city || null;
      ownerUserId = orgProfile.id;
    } else {
      throw new Error('Campaign has no owner');
    }

    if (actingUserId && ownerUserId !== actingUserId) {
      const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', actingUserId);
      const isAdmin = roles?.some((r: { role: string }) => r.role === 'admin');
      if (!isAdmin) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: ownerProfile } = await admin
      .from('profiles').select('email, first_name, last_name').eq('id', ownerUserId!).single();

    const slug = slugifyVenueName(senderName);
    const fromAddress = `${slug}@${EMAIL_DOMAIN}`;
    const from = `${senderName} <${fromAddress}>`;
    const replyTo = ownerProfile?.email || null;

    // Build recipients
    let recipients: Recipient[] = [];
    if (send_test) {
      const target = test_email || ownerProfile?.email;
      if (!target) throw new Error('No test email available');
      recipients = [{
        email: target,
        first_name: ownerProfile?.first_name,
        last_name: ownerProfile?.last_name,
        unsubscribe_token: '00000000-0000-0000-0000-000000000000',
      }];
    } else {
      // Use unified RPC; fallback to legacy logic if missing
      const { data: rows, error: rErr } = await admin.rpc('resolve_campaign_audience', { p_campaign_id: campaign_id });
      if (rErr) throw new Error(`Audience resolution failed: ${rErr.message}`);
      const seen = new Set<string>();
      for (const r of (rows || []) as any[]) {
        const em = String(r.email || '').toLowerCase();
        if (!em || seen.has(em)) continue;
        seen.add(em);
        recipients.push({
          email: em,
          first_name: r.first_name,
          last_name: r.last_name,
          unsubscribe_token: r.unsubscribe_token,
        });
      }
    }

    if (recipients.length === 0) throw new Error('No recipients found for this audience');

    if (!send_test) {
      await admin.from('email_campaigns').update({ status: 'sending' }).eq('id', campaign_id);

      // Snapshot recipients (pending) — skip those already sent (retry-safe)
      const { data: existing } = await admin
        .from('email_campaign_recipients')
        .select('email, status')
        .eq('campaign_id', campaign_id);
      const alreadySent = new Set<string>((existing || []).filter((r: any) => r.status === 'sent').map((r: any) => r.email.toLowerCase()));
      const toInsert = recipients
        .filter(r => !(existing || []).some((e: any) => e.email.toLowerCase() === r.email))
        .map(r => ({
          campaign_id,
          email: r.email,
          first_name: r.first_name || null,
          last_name: r.last_name || null,
          unsubscribe_token: r.unsubscribe_token && r.unsubscribe_token !== '00000000-0000-0000-0000-000000000000' ? r.unsubscribe_token : null,
          status: 'pending',
        }));
      if (toInsert.length > 0) {
        await admin.from('email_campaign_recipients').insert(toInsert);
      }
      // Filter out already-sent for retries
      recipients = recipients.filter(r => !alreadySent.has(r.email));
    }

    const blocks = (campaign.blocks_json || []) as EmailBlock[];
    // Inject campaign-level logo into header blocks if absent
    const campaignLogo = (campaign as any).logo_url as string | null;
    if (campaignLogo) {
      for (const b of blocks) {
        if (b.type === 'header' && !(b as any).logo_url) {
          (b as any).logo_url = campaignLogo;
        }
      }
    }
    const theme = ((campaign as any).theme_json || {}) as any;
    const socialLinks = ((campaign as any).social_links_json || {}) as any;

    const buildHtml = (r: Recipient) => buildCampaignHtml({
      blocks,
      preheader: campaign.preheader,
      subject: campaign.subject,
      venueName: senderName,
      city: senderCity || undefined,
      recipientEmail: r.email,
      emailType: campaign.type,
      firstName: r.first_name || undefined,
      lastName: r.last_name || undefined,
      unsubscribeUrl: r.unsubscribe_token ? `${PUBLIC_URL}/unsubscribe?token=${r.unsubscribe_token}` : undefined,
      theme,
      socialLinks,
    });

    // Send by chunks of 100 (Resend batch limit)
    const BATCH = 100;
    let sentTotal = 0;
    let failedTotal = 0;
    const eventLogs: Array<any> = [];
    for (let i = 0; i < recipients.length; i += BATCH) {
      const chunk = recipients.slice(i, i + BATCH);
      try {
        const result = await sendBatch(from, replyTo, campaign.subject, chunk, buildHtml, campaign_id);
        const data = (result as any)?.data || [];
        for (let j = 0; j < chunk.length; j++) {
          const rid = data[j]?.id;
          sentTotal++;
          eventLogs.push({ campaign_id, recipient_email: chunk[j].email, event_type: 'sent', resend_email_id: rid });
          if (!send_test) {
            await admin.from('email_campaign_recipients')
              .update({ status: 'sent', resend_email_id: rid, sent_at: new Date().toISOString() })
              .eq('campaign_id', campaign_id).eq('email', chunk[j].email);
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('Batch error:', msg);
        for (const r of chunk) {
          failedTotal++;
          eventLogs.push({ campaign_id, recipient_email: r.email, event_type: 'failed' });
          if (!send_test) {
            await admin.from('email_campaign_recipients')
              .update({ status: 'failed', error_message: msg })
              .eq('campaign_id', campaign_id).eq('email', r.email);
          }
        }
      }
    }

    if (eventLogs.length > 0 && !send_test) {
      await admin.from('email_campaign_events').insert(eventLogs);
    }

    if (!send_test) {
      // Final status: sent if any success, failed if zero
      const finalStatus = sentTotal > 0 ? 'sent' : 'failed';
      const firstHtml = recipients[0] ? buildHtml(recipients[0]) : null;
      await admin.from('email_campaigns').update({
        status: finalStatus,
        sent_at: new Date().toISOString(),
        recipients_count: sentTotal,
        html_body: firstHtml,
        error_message: failedTotal > 0 && sentTotal === 0 ? 'Tous les envois ont échoué' : null,
      }).eq('id', campaign_id);

      // Owner notification: campaign sent
      if (finalStatus === 'sent' && campaign.venue_id) {
        try {
          await admin.from('staff_notifications').insert({
            venue_id: campaign.venue_id,
            target_role: 'owner',
            notification_type: 'campaign_sent',
            title: 'Campagne email envoyée',
            message: `"${campaign.subject}" — ${sentTotal} destinataire${sentTotal > 1 ? 's' : ''}${failedTotal > 0 ? ` (${failedTotal} échec${failedTotal > 1 ? 's' : ''})` : ''}`,
            priority: 'normal',
            reference_type: 'email_campaign',
            reference_id: campaign_id,
            metadata: { subject: campaign.subject, sent: sentTotal, failed: failedTotal },
          });
        } catch (notifErr) {
          console.error('Owner notif error (campaign_sent):', notifErr);
        }
      }
    }

    return new Response(JSON.stringify({ success: true, sent: sentTotal, failed: failedTotal, test: !!send_test }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('send-campaign error:', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
