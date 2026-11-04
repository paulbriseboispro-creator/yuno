import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { unsubscribePageUrl, unsubscribeRequestKind } from '../_shared/one-click-unsubscribe.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PUBLIC_URL = Deno.env.get('PUBLIC_APP_URL') || 'https://yunoapp.eu';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    let bodyAction: string | null = null;
    let token: string | null = null;
    let bodyCampaignId: string | null = null;
    if (req.method === 'GET') {
      token = url.searchParams.get('token');
    } else {
      const body = await req.json().catch(() => ({}));
      token = body.token || url.searchParams.get('token');
      if (typeof body.action === 'string') bodyAction = body.action;
      if (typeof body.campaign_id === 'string') bodyCampaignId = body.campaign_id;
    }
    // POST (bouton « Se désabonner » de la messagerie, RFC 8058, ou la page du
    // site) = désabonner ; GET sans action = une personne a ouvert l'adresse de
    // l'en-tête List-Unsubscribe : on l'envoie sur la page du site.
    const action = unsubscribeRequestKind(req.method, url.searchParams.get('action') || bodyAction);
    // Optional explicit campaign attribution (link can carry ?c=<id>); falls back to the
    // most recent campaign that emailed this subscriber.
    const explicitCampaignId = bodyCampaignId || url.searchParams.get('c');
    if (!token) return new Response(JSON.stringify({ error: 'token required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (action === 'redirect') {
      return new Response(null, { status: 302, headers: { ...corsHeaders, Location: unsubscribePageUrl(PUBLIC_URL, token) } });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    if (action === 'preview') {
      const { data, error } = await admin.rpc('preview_unsubscribe', { p_token: token });
      if (error) throw error;
      const row = (data as Record<string, unknown>[])?.[0];
      if (!row) return new Response(JSON.stringify({ found: false }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ found: true, ...row }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Qui recevait encore les e-mails AVANT ce clic : un abonné du registre, ou un
    // client reçu au titre de « Vos clients » (jeton dans crm_customer_contacts).
    // Sans la seconde branche, ces désinscriptions n'étaient jamais comptées.
    // Un second clic (ou un renvoi du bouton de la messagerie) ne recompte rien.
    const [{ data: subBefore }, { data: custBefore }] = await Promise.all([
      admin.from('newsletter_subscriptions').select('opted_in').eq('unsubscribe_token', token).maybeSingle(),
      admin.from('crm_customer_contacts').select('state').eq('unsubscribe_token', token).maybeSingle(),
    ]);
    const wasActive = subBefore?.opted_in === true || (custBefore != null && custBefore.state !== 'objected');

    const { data, error } = await admin.rpc('unsubscribe_by_token', { p_token: token });
    if (error) throw error;
    const row = (data as { success?: boolean }[])?.[0];

    // La campagne du lien (?c=), sinon la dernière qui a écrit à ce jeton : un
    // événement `unsubscribed` par campagne et par adresse, le compteur suit.
    if (row?.success && wasActive) {
      const { error: countErr } = await admin.rpc('record_campaign_unsubscribe', {
        p_token: token,
        p_campaign_id: explicitCampaignId || null,
      });
      if (countErr) console.error('record_campaign_unsubscribe failed:', countErr.message);
    }

    return new Response(JSON.stringify(row || { success: false }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
