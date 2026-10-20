import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { verifySvixSignature } from '../_shared/svix-verify.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_SECRET = Deno.env.get('RESEND_WEBHOOK_SECRET'); // Svix secret from Resend dashboard (whsec_...)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const rawBody = await req.text();
    // Signature Svix obligatoire (audit du 18/10, MAIL-10) : sans secret posé,
    // on refuse (503 : Resend réessaiera une fois le secret posé) au lieu
    // d'accepter une charge que n'importe qui peut forger.
    const verdict = await verifySvixSignature(WEBHOOK_SECRET, rawBody, req.headers).catch(() => 'bad_signature' as const);
    if (verdict === 'no_secret') {
      console.error('resend-webhook: RESEND_WEBHOOK_SECRET not set — refusing unverified payload');
      return new Response(JSON.stringify({ error: 'webhook_not_configured' }), { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (verdict !== 'ok') {
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
    const tagValue = (name: string): string | undefined => Array.isArray(rawTags)
      ? rawTags.find((t) => t?.name === name)?.value
      : rawTags && typeof rawTags === 'object'
        ? (rawTags as Record<string, string>)[name]
        : undefined;
    const campaignId = tagValue('campaign_id');
    // E-mail de vente (billet…) : son état est suivi pour que la confirmation
    // et l'organisateur voient un rebond (send-ticket-confirmation pose ces tags).
    const saleKind = tagValue('sale_kind');
    const saleId = tagValue('sale_id');
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

    // Un rebond SOFT n'est pas un échec : l'e-mail repartira, rien à signaler.
    if (saleKind && saleId && recipient && (evt === 'delivered' || isHardBounce)) {
      const { error: saleErr } = await admin.rpc('record_sale_email_event', {
        p_kind: saleKind,
        p_sale_id: saleId,
        p_email: recipient,
        p_event: evt,
        p_resend_email_id: resendEmailId ?? null,
        p_detail: bounceType || null,
      });
      if (saleErr) console.error('record_sale_email_event failed:', saleErr.message);
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

    // Le svix-id est stable à travers les retries d'une même livraison :
    // l'index unique fait échouer l'insert du doublon (23505) et on s'arrête
    // là — sans lui, une rafale de retries dupliquait les lignes et faussait
    // les compteurs.
    const { error: insertErr } = await admin.from('email_campaign_events').insert({
      campaign_id: campaignId,
      recipient_email: recipient || 'unknown',
      event_type: evt,
      resend_email_id: resendEmailId,
      svix_id: req.headers.get('svix-id'),
      metadata: data,
    });
    if (insertErr?.code === '23505') {
      return new Response(JSON.stringify({ ok: true, duplicate: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (insertErr) console.error('email_campaign_events insert failed:', insertErr.message);

    // ── Compteurs de campagne ───────────────────────────────────────────────
    // RECALCULÉS depuis les événements (destinataires uniques de la file, les
    // tests exclus) — jamais incrémentés : le pattern « compter puis +1 »
    // perdait des unités sous les livraisons concurrentes.
    const { error: recountErr } = await admin.rpc('recount_campaign_email_counters', { p_campaign_id: campaignId });
    if (recountErr) console.error('recount_campaign_email_counters failed:', recountErr.message);

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
      const { data: verdict, error: breakerErr } = await admin.rpc('campaign_circuit_breaker', { p_campaign_id: campaignId });
      if (breakerErr) console.error('circuit breaker failed:', breakerErr.message);
      if (verdict?.paused) {
        console.warn(`circuit breaker: campagne ${campaignId} en pause (${verdict.reason})`);
      }
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('resend-webhook error:', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
