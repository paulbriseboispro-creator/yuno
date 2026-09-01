import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_SECRET = Deno.env.get('RESEND_WEBHOOK_SECRET'); // Svix secret from Resend dashboard (whsec_...)

// Verify the Svix signature Resend sends on every webhook. Returns true when the
// payload is authentic. If no secret is configured we fail OPEN (log a warning and
// accept) so existing open/click tracking keeps working until the secret is set —
// set RESEND_WEBHOOK_SECRET to enforce strict verification.
async function verifySvix(rawBody: string, headers: Headers): Promise<boolean> {
  if (!WEBHOOK_SECRET) {
    console.warn('resend-webhook: RESEND_WEBHOOK_SECRET not set — accepting unverified payload');
    return true;
  }
  const id = headers.get('svix-id');
  const timestamp = headers.get('svix-timestamp');
  const sigHeader = headers.get('svix-signature');
  if (!id || !timestamp || !sigHeader) return false;

  // Reject stale timestamps (>5 min skew) to blunt replay.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  try {
    const secretBytes = Uint8Array.from(atob(WEBHOOK_SECRET.replace(/^whsec_/, '')), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signed = new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`);
    const mac = await crypto.subtle.sign('HMAC', key, signed);
    const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
    // Header is space-separated "v1,<sig> v1,<sig>" — accept if any matches.
    return sigHeader.split(' ').some((part) => part.split(',')[1] === expected);
  } catch (e) {
    console.error('resend-webhook: signature verification error', e);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const rawBody = await req.text();
    if (!(await verifySvix(rawBody, req.headers))) {
      return new Response(JSON.stringify({ error: 'invalid signature' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const payload = JSON.parse(rawBody);
    const eventType: string = payload.type || '';
    const data = payload.data || {};
    // L'API d'ENVOI prend les tags en tableau [{name, value}], mais les webhooks
    // les renvoient en OBJET PLAT ({"campaign_id": "..."}). Accepter les deux :
    // un `.find` sur l'objet levait TypeError → 500 → tous les événements de
    // campagne (delivered/opened/clicked/bounced) étaient perdus, et avec eux
    // la suppression des bounces et le disjoncteur.
    const rawTags: unknown = data.tags;
    const campaignId: string | undefined = Array.isArray(rawTags)
      ? rawTags.find((t) => t?.name === 'campaign_id')?.value
      : rawTags && typeof rawTags === 'object'
        ? (rawTags as Record<string, string>).campaign_id
        : undefined;
    const recipient = Array.isArray(data.to) ? data.to[0] : data.to;
    const resendEmailId = data.email_id || data.id;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const map: Record<string, string> = {
      'email.delivered': 'delivered',
      'email.opened': 'opened',
      'email.clicked': 'clicked',
      'email.bounced': 'bounced',
      'email.complained': 'complained',
    };
    const evt = map[eventType];
    if (!evt) return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // ── Réputation : suppression AVANT tout le reste ────────────────────────
    // Un bounce dur ou une plainte retire l'adresse pour TOUS les expéditeurs,
    // qu'elle vienne d'une campagne ou d'un email transactionnel (donc même
    // sans tag campaign_id). La liste de suppression n'est consultée qu'à la
    // constitution d'une audience marketing : une confirmation de billet part
    // toujours, même vers une adresse supprimée.
    //
    // Un bounce SOFT (boîte pleine, indisponibilité temporaire) ne supprime
    // rien : l'adresse est valide, elle revivra.
    const bounceType: string = (data.bounce?.type || data.bounce?.subType || '').toString().toLowerCase();
    const isHardBounce = evt === 'bounced' && !bounceType.includes('soft') && !bounceType.includes('transient');

    if (recipient && (isHardBounce || evt === 'complained')) {
      try {
        await admin.rpc('suppress_email', {
          p_email: recipient,
          p_reason: isHardBounce ? 'hard_bounce' : 'complaint',
          p_source: 'resend_webhook',
          p_campaign_id: campaignId ?? null,
          p_metadata: { bounce: data.bounce ?? null, subject: data.subject ?? null },
        });
      } catch (e) {
        console.error('suppress_email failed:', e);
      }
    }

    if (!campaignId) {
      // Observabilité du quota mensuel : un événement terminal sans campagne
      // est un email TRANSACTIONNEL (billet, MFA, invitation…). Le compter ici
      // mesure la consommation réelle de la réserve de 10 000 sans toucher aux
      // 33 fonctions qui envoient en direct. Best-effort : l'échec du compteur
      // ne doit jamais faire échouer l'accusé de réception du webhook.
      if (evt === 'delivered' || evt === 'bounced') {
        try { await admin.rpc('count_transactional_email'); } catch { /* compteur best-effort */ }
      }
      return new Response(JSON.stringify({ ok: true, suppressed: isHardBounce || evt === 'complained' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { error: insertErr } = await admin.from('email_campaign_events').insert({
      campaign_id: campaignId,
      recipient_email: recipient || 'unknown',
      event_type: evt,
      resend_email_id: resendEmailId,
      metadata: data,
    });
    if (insertErr) console.error('email_campaign_events insert failed:', insertErr.message);

    // ── Compteurs de campagne ───────────────────────────────────────────────
    // delivered / bounced / complained alimentent le disjoncteur : ils doivent
    // être exacts, donc comptés une seule fois par destinataire.
    if (evt === 'delivered' || evt === 'bounced' || evt === 'complained') {
      const { count } = await admin
        .from('email_campaign_events')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)
        .eq('event_type', evt)
        .eq('recipient_email', recipient);

      if (count === 1) {
        const column = evt === 'delivered' ? 'delivered_count' : evt === 'bounced' ? 'bounced_count' : 'complained_count';
        const { data: c } = await admin.from('email_campaigns').select(column).eq('id', campaignId).single();
        await admin.from('email_campaigns')
          .update({ [column]: Number((c as Record<string, unknown> | null)?.[column] || 0) + 1 })
          .eq('id', campaignId);
      }

      if (recipient && (evt === 'bounced' || evt === 'complained')) {
        // `.eq` en minuscules, PAS `.ilike` : dans un motif LIKE, le `_` d'une
        // adresse (jean_bon@x.fr) est un joker et marquerait le mauvais
        // destinataire. La file stocke déjà les adresses en minuscules
        // (enqueue_campaign_recipients normalise), donc l'égalité suffit.
        await admin.from('email_campaign_recipients')
          .update({ status: evt })
          .eq('campaign_id', campaignId)
          .eq('email', String(recipient).toLowerCase());
      }

      // Disjoncteur : c'est ICI qu'il compte vraiment. Les signaux arrivent en
      // différé, donc une campagne encore en vol peut se couper toute seule
      // avant d'avoir vidé la file.
      if (evt === 'bounced' || evt === 'complained') {
        try {
          const { data: verdict } = await admin.rpc('campaign_circuit_breaker', { p_campaign_id: campaignId });
          if (verdict?.paused) {
            console.warn(`circuit breaker: campagne ${campaignId} en pause (${verdict.reason})`);
          }
        } catch (e) {
          console.error('circuit breaker failed:', e);
        }
      }
    }

    // Ouvertures / clics : premier événement par destinataire seulement.
    if (evt === 'opened') {
      const { count } = await admin
        .from('email_campaign_events')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)
        .eq('event_type', 'opened')
        .eq('recipient_email', recipient);
      if (count === 1) {
        const { data: c } = await admin.from('email_campaigns').select('opens_count').eq('id', campaignId).single();
        await admin.from('email_campaigns').update({ opens_count: (c?.opens_count || 0) + 1 }).eq('id', campaignId);
      }
    } else if (evt === 'clicked') {
      const { data: c } = await admin.from('email_campaigns').select('clicks_count').eq('id', campaignId).single();
      await admin.from('email_campaigns').update({ clicks_count: (c?.clicks_count || 0) + 1 }).eq('id', campaignId);
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('resend-webhook error:', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
