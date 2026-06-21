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
    .select('id, title, start_at, venue_id, organizer_user_id')
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
