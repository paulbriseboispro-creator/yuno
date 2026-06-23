import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import {
  EmailLanguage
} from "../_shared/email-branding.ts";
import { buildEventUpdate } from "../_shared/email-templates.ts";

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
      : 'Yuno <noreply@yunoapp.eu>';

    let sentCount = 0;

    for (const [recipientEmail, userId] of emailMap) {
      try {
        let lang: EmailLanguage = 'fr';
        if (userId) {
          const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('preferred_language')
            .eq('id', userId)
            .single();
          if (profile?.preferred_language && ['en', 'es', 'fr'].includes(profile.preferred_language)) {
            lang = profile.preferred_language as EmailLanguage;
          }
        }

        const changeTypeLabels: Record<string, { en: string; fr: string; es: string }> = {
          time: { en: 'Time changed', fr: "Horaire modifié", es: 'Horario cambiado' },
          dj: { en: 'DJ lineup changed', fr: 'Line-up DJ modifié', es: 'Lineup de DJs cambiado' },
          details: { en: 'Details updated', fr: 'Détails mis à jour', es: 'Detalles actualizados' },
        };

        // Map each change into a k/v row: "Old → New"
        const changeRows = changes.map(change => ({
          k: (changeTypeLabels[change.type] || { en: change.type, fr: change.type, es: change.type })[lang],
          v: `${change.oldValue} → ${change.newValue}`,
        }));

        // The change text (the builder prepends the event title itself)
        const updateMessage = {
          en: 'some details just changed.',
          fr: 'des infos viennent de changer.',
          es: 'algunos detalles acaban de cambiar.',
        }[lang];

        const mail = buildEventUpdate({
          lang,
          eventTitle: event.title,
          venueName,
          updateMessage,
          changes: changeRows,
          eventUrl: `https://yunoapp.eu/club/${event.venue_id}`,
        });

        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${resendApiKey}`,
          },
          body: JSON.stringify({ from, to: [recipientEmail], subject: mail.subject, html: mail.html }),
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
