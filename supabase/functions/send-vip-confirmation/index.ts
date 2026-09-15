import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { EmailLanguage, escapeHtml } from "../_shared/email-branding.ts";
import { buildVipConfirmation, buildVipStatus, buildWalkinSummary, fmtDateParts } from "../_shared/email-templates.ts";
import { ensureWalletPass, walletPassUrl } from "../_shared/wallet/router.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[SEND-VIP-CONFIRMATION] ${step}${detailsStr}`);
};

type VipEmailType = 'request_received' | 'confirmed' | 'modified' | 'refused' | 'walkin_summary';

interface VipEmailRequest {
  // Les appelants ne sont pas homogènes : les checkouts serveur
  // (create-table-checkout, verify-table-payment) et les composants owner/hôte
  // envoient `reservation_id` (snake), tandis que useVipNight / VipHostDashboard
  // envoient `reservationId` (camel). On accepte les DEUX pour ne perdre aucun
  // email de confirmation (sinon 4 appelants sur 6 échouaient en silence).
  reservationId?: string;
  reservation_id?: string;
  type: VipEmailType;
  changes?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    // SECURITY : cette fonction n'est plus déclenchable par un simple
    // reservationId anonyme. Elle envoie toujours l'email au titulaire de la
    // réservation (jamais à une adresse fournie par l'appelant → pas de relais
    // ouvert), mais on exige un appelant authentifié : soit la service-role
    // (checkout / verify serveur), soit un JWT utilisateur valide (owner / hôte
    // VIP qui confirme, refuse ou encaisse). Un anonyme est refusé (403).
    const authHeader = req.headers.get("Authorization") || "";
    const bearer = authHeader.replace("Bearer ", "");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    let authorized = bearer !== "" && bearer === serviceKey;
    if (!authorized && authHeader) {
      const authClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } }
      );
      const { data: { user: caller } } = await authClient.auth.getUser();
      if (caller) authorized = true;
    }
    if (!authorized) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) throw new Error("RESEND_API_KEY not configured");

    const body = await req.json() as VipEmailRequest;
    const reservationId = body.reservationId ?? body.reservation_id;
    const { type, changes } = body;

    if (!reservationId || !type) {
      throw new Error("reservationId (or reservation_id) and type are required");
    }

    if (!['request_received', 'confirmed', 'modified', 'refused', 'walkin_summary'].includes(type)) {
      throw new Error("Invalid type. Must be: request_received, confirmed, modified, refused, walkin_summary");
    }

    const { data: reservation, error: resError } = await supabaseAdmin
      .from('table_reservations')
      .select(`
        id, user_email, user_id, full_name, minimum_spend, total_price, guest_count, qr_code, reference_code,
        zone_id,
        table_zones(name, venue_id),
        events!inner(id, title, start_at, venue_id, poster_url, location_name, location_address, location_is_secret, reveal_address_in_email, venues!events_venue_id_fkey(name, address))
      `)
      .eq('id', reservationId)
      .single();

    if (resError || !reservation) throw new Error("Reservation not found");

    // Colonnes des embeds du select ci-dessus (utilisées dans ce fichier)
    interface VipEmailEvent {
      id: string;
      title: string | null;
      start_at: string;
      venue_id: string | null;
      poster_url: string | null;
      location_name: string | null;
      location_address: string | null;
      location_is_secret: boolean | null;
      reveal_address_in_email: boolean | null;
      venues: { name: string | null; address: string | null } | null;
    }
    const event = reservation.events as VipEmailEvent;
    const zone = reservation.table_zones as { name: string | null; venue_id: string | null } | null;
    const venue = event?.venues;
    const venueName = venue?.name || event?.location_name || '';
    const eventTitle = event?.title || '';
    const customerEmail = reservation.user_email;
    // Secret-location reveal: show the exact address only when the event isn't
    // secret, or when the organizer chose to reveal it in the confirmation email.
    const isSecret = !!event?.location_is_secret;
    const revealInEmail = event?.reveal_address_in_email !== false;
    const rawAddress = venue?.address || event?.location_address || '';
    const venueAddress = rawAddress && (!isSecret || revealInEmail) ? escapeHtml(rawAddress) : '';
    const addressDeferred = isSecret && !revealInEmail;

    if (!customerEmail) throw new Error("No customer email");

    let lang: EmailLanguage = 'en';
    let firstName = '';
    if (reservation.user_id) {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('first_name, preferred_language')
        .eq('id', reservation.user_id)
        .single();
      if (profile?.preferred_language && ['en', 'es', 'fr'].includes(profile.preferred_language)) {
        lang = profile.preferred_language as EmailLanguage;
      }
      firstName = profile?.first_name || '';
    }
    if (!firstName && reservation.full_name) {
      firstName = reservation.full_name.split(' ')[0] || '';
    }

    const addressDeferredText = lang === 'fr'
      ? "L'adresse exacte vous sera communiquée par email par l'organisateur avant l'événement."
      : lang === 'es'
      ? "La dirección exacta te será comunicada por email por el organizador antes del evento."
      : "The exact address will be sent to you by email by the host before the event.";

    const safeEventTitle = escapeHtml(eventTitle);
    const safeVenueName = escapeHtml(venueName);
    const nameStr = firstName ? ` ${firstName}` : '';
    const eventImageUrl = event?.poster_url || null;

    // Guest reservations (no linked account) can't use /my-orders. Give them the
    // short reference + a "Find my order" claim link, same as the ticket email.
    const appBaseUrl = Deno.env.get("APP_BASE_URL") || "https://yunoapp.eu";
    const isGuest = !reservation.user_id;
    const reservationRef = reservation.reference_code || reservation.qr_code || '';

    // ── Récap walk-in : commande servie + accès rapide « créer mon compte » ──
    // (nom/prénom/email déjà connus du club, pré-remplis → le client n'a qu'à
    // choisir un mot de passe). Envoyé quand un walk-in avec email est encaissé.
    if (type === 'walkin_summary') {
      const { data: cons } = await supabaseAdmin
        .from('vip_consumptions')
        .select('item_name, quantity, total_price')
        .eq('table_reservation_id', reservationId)
        .order('served_at', { ascending: true });
      const items = (cons || []) as Array<{ item_name: string | null; quantity: number | null; total_price: number | null }>;
      const total = items.reduce((s, c) => s + (Number(c.total_price) || 0), 0);
      const prefillName = reservation.full_name || firstName || '';
      const signupUrl = `${appBaseUrl}/auth?signup=true&email=${encodeURIComponent(customerEmail)}${prefillName ? `&name=${encodeURIComponent(prefillName)}` : ''}`;

      const mail = buildWalkinSummary({
        lang,
        firstName: firstName || undefined,
        venueName,
        items: items.map((c) => ({ k: `${c.quantity ?? 1} × ${c.item_name || ''}`, v: `€${(Number(c.total_price) || 0).toFixed(2)}` })),
        total: `€${total.toFixed(2)}`,
        signupUrl,
      });
      const html = mail.html;
      const rawFrom = Deno.env.get('RESEND_FROM_EMAIL');
      const from = rawFrom ? (rawFrom.includes('<') ? rawFrom : `Yuno <${rawFrom}>`) : 'Yuno <noreply@yunoapp.eu>';
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendApiKey}` },
        body: JSON.stringify({ from, to: [customerEmail], subject: mail.subject, html }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`Resend error: ${await res.text()}`);
      logStep("Walkin summary sent", { to: customerEmail });
      return new Response(
        JSON.stringify({ success: true, type, email: customerEmail }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const dateLocales: Record<EmailLanguage, string> = { en: 'en-GB', es: 'es-ES', fr: 'fr-FR' };
    let formattedDate = '';
    try {
      const d = new Date(event.start_at);
      formattedDate = d.toLocaleDateString(dateLocales[lang], {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris'
      });
    } catch { /* ignore */ }

    // For the "confirmed" (booked) email, render via the new shared editorial
    // builder. The other types (request_received / modified / refused) have no
    // dedicated builder, so they keep the inline emailContent above.
    let html: string;
    let finalSubject = '';
    if (type === 'confirmed') {
      // Apple Wallet : lien de téléchargement direct du pass VIP (idempotent,
      // seul canal pass pour les invités sans compte). Jamais bloquant.
      let walletUrl: string | undefined;
      try {
        const wp = await ensureWalletPass(supabaseAdmin, 'vip', reservationId, reservation.user_id ?? null);
        walletUrl = walletPassUrl(wp.serial, wp.authToken);
      } catch (walletErr) {
        console.error('[SEND-VIP-CONFIRMATION] wallet link skipped:', walletErr);
      }

      const dp = fmtDateParts(event.start_at, lang);
      const gc = reservation.guest_count ?? 0;
      const guestsStr = gc > 0
        ? (lang === 'fr'
            ? `${gc} ${gc > 1 ? 'personnes' : 'personne'}`
            : lang === 'es'
            ? `${gc} ${gc > 1 ? 'personas' : 'persona'}`
            : `${gc} ${gc > 1 ? 'guests' : 'guest'}`)
        : '—';
      const mail = buildVipConfirmation({
        lang,
        firstName: firstName || undefined,
        eventTitle,
        venueName,
        posterUrl: event?.poster_url || undefined,
        day: dp.day,
        month: dp.month,
        arrivalTime: dp.time,
        tableName: zone?.name || (lang === 'fr' ? 'Table VIP' : lang === 'es' ? 'Mesa VIP' : 'VIP table'),
        guests: guestsStr,
        total: `€${(reservation.total_price ?? reservation.minimum_spend ?? 0).toFixed(2)}`,
        reference: reservation.reference_code || reservation.qr_code || '',
        manageUrl: `${appBaseUrl}/my-orders`,
        walletUrl,
      });
      html = mail.html;
      finalSubject = mail.subject;
    } else {
      // request_received / modified / refused : même grille éditoriale que la
      // confirmation, sans bouton sur un refus.
      const dp = fmtDateParts(event.start_at, lang);
      const gc = reservation.guest_count ?? 0;
      const mail = buildVipStatus({
        lang,
        kind: type as 'request_received' | 'modified' | 'refused',
        firstName: firstName || undefined,
        eventTitle,
        venueName,
        posterUrl: event?.poster_url || undefined,
        day: dp.day,
        month: dp.month,
        arrivalTime: dp.time,
        tableName: zone?.name || undefined,
        guests: gc > 0 ? String(gc) : undefined,
        changes: changes || undefined,
        address: venueAddress ? rawAddress : undefined,
        addressDeferred,
        manageUrl: !isGuest ? `${appBaseUrl}/my-orders` : undefined,
        claimUrl: isGuest && reservationRef ? `${appBaseUrl}/claim?type=table&ref=${encodeURIComponent(reservationRef)}` : undefined,
      });
      html = mail.html;
      finalSubject = mail.subject;
    }

    const rawFrom = Deno.env.get('RESEND_FROM_EMAIL');
    const from = rawFrom
      ? (rawFrom.includes('<') ? rawFrom : `Yuno <${rawFrom}>`)
      : 'Yuno <noreply@yunoapp.eu>';

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({ from, to: [customerEmail], subject: finalSubject, html }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const errData = await res.text();
      throw new Error(`Resend error: ${errData}`);
    }

    logStep("Email sent", { type, to: customerEmail });

    return new Response(
      JSON.stringify({ success: true, type, email: customerEmail }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[SEND-VIP-CONFIRMATION] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
