import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function base64UrlToUint8Array(input: string): Uint8Array {
  const cleaned = input.replace(/=+$/g, '');
  const base64 = cleaned.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(base64 + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generateVapidJWT(endpoint: string, vapidPrivateKey: string, vapidPublicKey: string): Promise<string> {
  const audience = new URL(endpoint).origin;
  const subject = 'mailto:contact@yunoapp.eu';

  const header = { typ: 'JWT', alg: 'ES256' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { aud: audience, exp: now + 12 * 60 * 60, sub: subject };

  const headerB64 = uint8ArrayToBase64Url(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = uint8ArrayToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  const publicKeyBytes = base64UrlToUint8Array(vapidPublicKey);

  const key = await crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256',
    d: vapidPrivateKey,
    x: uint8ArrayToBase64Url(publicKeyBytes.slice(1, 33)),
    y: uint8ArrayToBase64Url(publicKeyBytes.slice(33, 65)),
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key,
    new TextEncoder().encode(unsignedToken)
  );

  return `${unsignedToken}.${uint8ArrayToBase64Url(new Uint8Array(signature))}`;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const saltKeyBytes = salt.length > 0 ? salt : new Uint8Array(32);
  const saltKey = await crypto.subtle.importKey('raw', saltKeyBytes.buffer as ArrayBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const prk = new Uint8Array(await crypto.subtle.sign('HMAC', saltKey, ikm.buffer as ArrayBuffer));
  const prkKey = await crypto.subtle.importKey('raw', prk.buffer as ArrayBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

  const hashLen = 32;
  const n = Math.ceil(length / hashLen);
  let t = new Uint8Array(0);
  const okm = new Uint8Array(n * hashLen);

  for (let i = 0; i < n; i++) {
    const input = new Uint8Array(t.length + info.length + 1);
    input.set(t, 0);
    input.set(info, t.length);
    input[input.length - 1] = i + 1;
    t = new Uint8Array(await crypto.subtle.sign('HMAC', prkKey, input.buffer as ArrayBuffer));
    okm.set(t, i * hashLen);
  }
  return okm.slice(0, length);
}

async function encryptPayload(
  payload: string,
  subscriberPublicKey: Uint8Array,
  subscriberAuth: Uint8Array
): Promise<{ encrypted: Uint8Array }> {
  const serverKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const serverPublicKeyRaw = await crypto.subtle.exportKey('raw', serverKeyPair.publicKey);
  const serverPublicKey = new Uint8Array(serverPublicKeyRaw);

  const subscriberKey = await crypto.subtle.importKey('raw', subscriberPublicKey.buffer as ArrayBuffer, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: subscriberKey }, serverKeyPair.privateKey, 256));

  const salt = crypto.getRandomValues(new Uint8Array(16));

  const webPushInfo = new TextEncoder().encode('WebPush: info\0');
  const keyInfo = new Uint8Array(webPushInfo.length + subscriberPublicKey.length + serverPublicKey.length);
  keyInfo.set(webPushInfo, 0);
  keyInfo.set(subscriberPublicKey, webPushInfo.length);
  keyInfo.set(serverPublicKey, webPushInfo.length + subscriberPublicKey.length);

  const ikm = await hkdf(subscriberAuth, sharedSecret, keyInfo, 32);

  const cekInfo = new TextEncoder().encode('Content-Encoding: aes128gcm\0');
  const contentEncryptionKey = await hkdf(salt, ikm, cekInfo, 16);

  const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\0');
  const nonce = await hkdf(salt, ikm, nonceInfo, 12);

  const payloadBytes = new TextEncoder().encode(payload);
  const paddedPayload = new Uint8Array(payloadBytes.length + 1);
  paddedPayload.set(payloadBytes);
  paddedPayload[payloadBytes.length] = 2;

  const aesKey = await crypto.subtle.importKey('raw', contentEncryptionKey.buffer as ArrayBuffer, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce.buffer as ArrayBuffer }, aesKey, paddedPayload.buffer as ArrayBuffer));

  const recordSize = 4096;
  const encrypted = new Uint8Array(16 + 4 + 1 + serverPublicKey.length + ciphertext.length);
  let offset = 0;
  encrypted.set(salt, offset); offset += 16;
  encrypted[offset++] = (recordSize >>> 24) & 0xff;
  encrypted[offset++] = (recordSize >>> 16) & 0xff;
  encrypted[offset++] = (recordSize >>> 8) & 0xff;
  encrypted[offset++] = recordSize & 0xff;
  encrypted[offset++] = serverPublicKey.length;
  encrypted.set(serverPublicKey, offset); offset += serverPublicKey.length;
  encrypted.set(ciphertext, offset);

  return { encrypted };
}

// deno-lint-ignore no-explicit-any
type Subscription = { id: string; endpoint: string; p256dh: string; auth: string };

/**
 * Send one encrypted push to a single subscription. Returns 'ok', 'stale' (cleaned up),
 * or 'fail'. Stale subscriptions (401/403/404/410) are deleted so the table self-heals.
 */
// deno-lint-ignore no-explicit-any
async function sendToSubscription(
  supabase: any,
  subscription: Subscription,
  notificationPayload: string,
  vapidPublicKey: string,
  vapidPrivateKey: string,
): Promise<'ok' | 'stale' | 'fail'> {
  try {
    const subscriberPublicKey = base64UrlToUint8Array(subscription.p256dh);
    const subscriberAuth = base64UrlToUint8Array(subscription.auth);
    const { encrypted } = await encryptPayload(notificationPayload, subscriberPublicKey, subscriberAuth);
    const jwt = await generateVapidJWT(subscription.endpoint, vapidPrivateKey, vapidPublicKey);

    const body = encrypted.buffer.slice(encrypted.byteOffset, encrypted.byteOffset + encrypted.byteLength) as ArrayBuffer;

    const response = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        'Content-Length': encrypted.length.toString(),
        'TTL': '86400',
        'Authorization': `vapid t=${jwt}, k=${vapidPublicKey}`,
      },
      body,
    });

    if (response.ok || response.status === 201) return 'ok';
    if ([401, 403, 404, 410].includes(response.status)) {
      console.log(`[Push] Removing stale subscription (HTTP ${response.status}): ${subscription.endpoint.slice(0, 60)}...`);
      await supabase.from('push_subscriptions').delete().eq('id', subscription.id);
      return 'stale';
    }
    const txt = await response.text().catch(() => '');
    console.error(`[Push] Unexpected HTTP ${response.status} for ${subscription.endpoint.slice(0, 60)}: ${txt.slice(0, 200)}`);
    return 'fail';
  } catch (error) {
    console.error('[Push] Error sending to endpoint:', subscription.endpoint?.slice(0, 60), error);
    return 'fail';
  }
}

const APP_BASE_URL = 'https://yunoapp.eu';
const EMAIL_DOMAIN = Deno.env.get('EMAIL_DOMAIN') || 'yunoapp.eu';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

// Inline dark email for "your followed DJ is playing in your city".
// No shared template dependency — keeps this function self-contained.
function buildDjLineupEmail(opts: {
  lang: string; djName: string; djPhoto: string | null | undefined;
  eventTitle: string | null; dateStr: string; city: string | null;
  eventUrl: string; firstName: string | null | undefined; unsubscribeToken: string | null | undefined;
}): string {
  const { lang, djName, djPhoto, eventTitle, dateStr, city, eventUrl, firstName, unsubscribeToken } = opts;
  const greeting = firstName ? (lang === 'fr' ? `Salut ${firstName} 👋` : lang === 'es' ? `Hola ${firstName} 👋` : `Hey ${firstName} 👋`) : '👋';
  const headline = lang === 'fr'
    ? `<strong>${djName}</strong> mixe dans ta ville`
    : lang === 'es'
    ? `<strong>${djName}</strong> pincha en tu ciudad`
    : `<strong>${djName}</strong> is playing in your city`;
  const sub = city && dateStr ? `${city} · ${dateStr}` : (city || dateStr || '');
  const ctaLabel = lang === 'fr' ? 'Voir la soirée' : lang === 'es' ? 'Ver el evento' : 'See the event';
  const unsub = lang === 'fr' ? 'Se désabonner' : lang === 'es' ? 'Cancelar suscripción' : 'Unsubscribe';
  const unsubUrl = unsubscribeToken ? `${APP_BASE_URL}/unsubscribe?token=${unsubscribeToken}` : `${APP_BASE_URL}/unsubscribe`;

  const photoBlock = djPhoto
    ? `<img src="${djPhoto}" alt="${djName}" width="80" height="80" style="border-radius:50%;object-fit:cover;display:block;margin:0 auto 16px;" />`
    : `<div style="width:80px;height:80px;border-radius:50%;background:#1a1a1a;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:32px;line-height:80px;text-align:center;">🎧</div>`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#111111;border-radius:16px;overflow:hidden;">
        <!-- Header -->
        <tr><td style="padding:32px 32px 24px;text-align:center;border-bottom:1px solid #222;">
          <span style="color:#ef4444;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">YUNO</span>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px;text-align:center;">
          ${photoBlock}
          <p style="color:#9ca3af;font-size:14px;margin:0 0 12px;">${greeting}</p>
          <p style="color:#ffffff;font-size:22px;font-weight:700;margin:0 0 8px;line-height:1.3;">${headline}</p>
          ${sub ? `<p style="color:#6b7280;font-size:14px;margin:0 0 24px;">${sub}</p>` : '<div style="height:24px;"></div>'}
          ${eventTitle ? `<p style="color:#e5e7eb;font-size:16px;font-weight:600;margin:0 0 24px;">${eventTitle}</p>` : ''}
          <a href="${eventUrl}" style="display:inline-block;background:#ef4444;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:10px;">${ctaLabel}</a>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:20px 32px;text-align:center;border-top:1px solid #1f1f1f;">
          <a href="${unsubUrl}" style="color:#4b5563;font-size:12px;text-decoration:none;">${unsub}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * A2 — fan out a "your followed DJ just got added to a line-up" push to a DJ's
 * followers. Geo-filtered + opt-in + dedup all live in the RPC; this only sends.
 * Only the event's owner (venue owner or organizer) may trigger it.
 */
// deno-lint-ignore no-explicit-any
async function handleDjLineup(req: Request, supabase: any, vapidPublicKey: string, vapidPrivateKey: string, body: any) {
  const eventId: string | undefined = body.event_id;
  const djIds: string[] = Array.isArray(body.dj_ids) ? body.dj_ids : (body.dj_id ? [body.dj_id] : []);
  if (!eventId || djIds.length === 0) {
    return new Response(JSON.stringify({ error: 'event_id and dj_ids required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Authorize: the caller must own the event (venue owner or organizer).
  const authHeader = req.headers.get('Authorization') || '';
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData } = await userClient.auth.getUser();
  const callerId = userData?.user?.id;
  if (!callerId) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const { data: event } = await supabase
    .from('events')
    .select('id, title, start_at, venue_id, organizer_user_id, location_city')
    .eq('id', eventId)
    .maybeSingle();
  if (!event) {
    return new Response(JSON.stringify({ error: 'event not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  let owns = false;
  if (event.venue_id) {
    const { data: venue } = await supabase.from('venues').select('owner_id').eq('id', event.venue_id).maybeSingle();
    owns = venue?.owner_id === callerId;
  } else if (event.organizer_user_id) {
    owns = event.organizer_user_id === callerId;
  }
  if (!owns) {
    return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  let dateStr = '';
  if (event.start_at) {
    try {
      dateStr = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(event.start_at));
    } catch { /* leave empty */ }
  }

  let totalSent = 0;
  let totalTargeted = 0;

  for (const djId of djIds) {
    // Recipients: geo-filtered + opt-in + not-already-notified (all in the RPC).
    const { data: targets, error: tErr } = await supabase.rpc('get_dj_lineup_notification_targets', {
      p_event_id: eventId,
      p_dj_id: djId,
    });
    if (tErr) { console.error('[Push] targets RPC error:', tErr); continue; }
    if (!targets?.length) continue;

    // DJ display name + their event tracked link (so notif-driven sales are attributed to them).
    const { data: dj } = await supabase.from('djs').select('stage_name, first_name, last_name').eq('id', djId).maybeSingle();
    const djName = (dj?.stage_name || `${dj?.first_name || ''} ${dj?.last_name || ''}`.trim() || 'DJ');
    const { data: link } = await supabase
      .from('tracked_links')
      .select('code')
      .eq('event_id', eventId).eq('dj_id', djId).eq('owner_kind', 'dj')
      .maybeSingle();
    const url = link?.code ? `${APP_BASE_URL}/l/${link.code}` : `${APP_BASE_URL}/event/${eventId}`;

    const notificationPayload = JSON.stringify({
      title: `🎧 ${djName}`,
      body: `${event.title || ''}${dateStr ? ' · ' + dateStr : ''}`.trim() || djName,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      url,
    });

    const targetedUserIds = new Set<string>();
    for (const sub of targets as (Subscription & { user_id: string })[]) {
      targetedUserIds.add(sub.user_id);
      const res = await sendToSubscription(supabase, sub, notificationPayload, vapidPublicKey, vapidPrivateKey);
      if (res === 'ok') totalSent++;
    }

    // Mark targeted followers so re-saving the line-up never re-notifies them.
    if (targetedUserIds.size > 0) {
      const ids = [...targetedUserIds];
      totalTargeted += ids.length;
      await supabase.from('dj_lineup_notifications').upsert(
        ids.map((uid) => ({ user_id: uid, event_id: eventId, dj_id: djId })),
        { onConflict: 'user_id,event_id,dj_id', ignoreDuplicates: true },
      );
      await supabase.from('notification_log').insert(
        ids.map((uid) => ({ user_id: uid, notification_type: 'dj_lineup', title: djName })),
      );
    }
  }

  // Email fallback: reach subscribers who didn't get push (no push sub or city unknown
  // for push, but they have an email and a matching city). Same dedup table — each
  // subscriber gets at most one notification (push wins, email covers the rest).
  if (RESEND_API_KEY) {
    for (const djId of djIds) {
      const { data: emailTargets, error: eErr } = await supabase.rpc('get_dj_lineup_email_targets', {
        p_event_id: eventId,
        p_dj_id: djId,
      });
      if (eErr) { console.error('[Email] targets RPC error:', eErr); continue; }
      if (!emailTargets?.length) continue;

      const { data: dj } = await supabase
        .from('djs').select('stage_name, first_name, last_name, profile_image_url')
        .eq('id', djId).maybeSingle();
      const djName = dj?.stage_name || `${dj?.first_name || ''} ${dj?.last_name || ''}`.trim() || 'DJ';
      const { data: link } = await supabase
        .from('tracked_links').select('code')
        .eq('event_id', eventId).eq('dj_id', djId).eq('owner_kind', 'dj')
        .maybeSingle();
      const eventUrl = link?.code ? `${APP_BASE_URL}/l/${link.code}` : `${APP_BASE_URL}/event/${eventId}`;

      // deno-lint-ignore no-explicit-any
      const batch = (emailTargets as any[]).map((r) => {
        const lang = r.preferred_language === 'fr' ? 'fr' : r.preferred_language === 'es' ? 'es' : 'en';
        const city: string = event.location_city || '';
        const subject = lang === 'fr'
          ? `🎧 ${djName} mixe à ${city}${dateStr ? ' · ' + dateStr : ''}`
          : lang === 'es'
          ? `🎧 ${djName} pincha en ${city}${dateStr ? ' · ' + dateStr : ''}`
          : `🎧 ${djName} is playing in ${city}${dateStr ? ' · ' + dateStr : ''}`;
        const html = buildDjLineupEmail({
          lang, djName, djPhoto: dj?.profile_image_url,
          eventTitle: event.title, dateStr, city,
          eventUrl, firstName: r.first_name, unsubscribeToken: r.unsubscribe_token,
        });
        const headers: Record<string, string> = {};
        if (r.unsubscribe_token) {
          const url = `${APP_BASE_URL}/unsubscribe?token=${r.unsubscribe_token}`;
          headers['List-Unsubscribe'] = `<${url}>`;
          headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
        }
        return { from: `Yuno <noreply@${EMAIL_DOMAIN}>`, to: [r.email], subject, html, headers };
      });

      // Send in chunks of 100 (Resend batch limit).
      for (let i = 0; i < batch.length; i += 100) {
        const chunk = batch.slice(i, i + 100);
        const res = await fetch('https://api.resend.com/emails/batch', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(chunk),
        });
        if (!res.ok) console.error('[Email] Resend batch error:', await res.text().catch(() => ''));
      }

      // Mark emailed users as notified so they don't receive push next time.
      // deno-lint-ignore no-explicit-any
      const emailUserIds = (emailTargets as any[]).map((r) => r.user_id);
      await supabase.from('dj_lineup_notifications').upsert(
        emailUserIds.map((uid: string) => ({ user_id: uid, event_id: eventId, dj_id: djId })),
        { onConflict: 'user_id,event_id,dj_id', ignoreDuplicates: true },
      );
      totalTargeted += emailUserIds.length;
    }
  }

  return new Response(JSON.stringify({ success: true, sent: totalSent, targeted: totalTargeted }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
    if (!vapidPublicKey || !vapidPrivateKey) {
      return new Response(JSON.stringify({ error: 'VAPID keys not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const reqBody = await req.json();

    // A2: fan-out to a DJ's followers (geo-filtered) when added to a line-up.
    if (reqBody?.action === 'dj_lineup') {
      return await handleDjLineup(req, supabase, vapidPublicKey, vapidPrivateKey, reqBody);
    }

    // Default: send to a single user's subscriptions.
    // This path is a PRIVILEGED relay. Internal callers pass the service-role key;
    // staff UIs (Barman, Click&Collect) call it with a logged-in staff session to
    // notify a customer. With verify_jwt=false it was an OPEN relay — anyone holding
    // the public anon key could push arbitrary phishing to any user_id. Require the
    // service-role bearer OR an authenticated caller holding a privileged role.
    {
      const authHeader = req.headers.get('Authorization') || '';
      const bearer = authHeader.replace('Bearer ', '').trim();
      const isServiceCall = !!bearer && bearer === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (!isServiceCall) {
        const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data: userData } = await userClient.auth.getUser();
        const callerId = userData?.user?.id;
        if (!callerId) {
          return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        const PRIVILEGED = new Set(['barman', 'bouncer', 'cloakroom', 'vip_host', 'manager', 'owner', 'organizer', 'dj', 'admin']);
        const { data: callerRoles } = await supabase.from('user_roles').select('role').eq('user_id', callerId);
        let allowed = (callerRoles ?? []).some((r: { role: string }) => PRIVILEGED.has(r.role));
        if (!allowed) {
          const { data: orgStaff } = await supabase
            .from('org_staff').select('role').eq('user_id', callerId).eq('invitation_status', 'accepted').limit(1);
          allowed = !!(orgStaff && orgStaff.length > 0);
        }
        if (!allowed) {
          return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      }
    }

    const { user_id, payload } = reqBody;
    if (!user_id || !payload) {
      return new Response(JSON.stringify({ error: 'user_id and payload required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: subscriptions, error: subError } = await supabase.from('push_subscriptions').select('*').eq('user_id', user_id);
    if (subError || !subscriptions?.length) {
      return new Response(JSON.stringify({ message: 'No subscriptions found', sent: 0 }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const notificationPayload = JSON.stringify({
      title: payload.title || 'Yuno',
      body: payload.body || 'Nouvelle notification',
      icon: payload.icon || '/favicon.ico',
      badge: '/favicon.ico',
      url: payload.url || '/',
    });

    let successCount = 0;
    let failCount = 0;
    for (const subscription of subscriptions) {
      const res = await sendToSubscription(supabase, subscription, notificationPayload, vapidPublicKey, vapidPrivateKey);
      if (res === 'ok') successCount++; else failCount++;
    }

    return new Response(JSON.stringify({ success: true, sent: successCount, failed: failCount, total: subscriptions.length }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal error';
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
