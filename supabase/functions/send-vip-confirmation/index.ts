import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import * as QRCode from "https://esm.sh/qrcode@1.5.3";
import { EmailLanguage, escapeHtml } from "../_shared/email-branding.ts";
import { buildVipConfirmation, buildVipStatus, buildWalkinSummary, fmtDateParts } from "../_shared/email-templates.ts";
import { ensureWalletPass, walletPassUrl } from "../_shared/wallet/router.ts";
import { demoPreviewGuard } from "../_shared/demo-guard.ts";
import {
  enqueueSaleEmail, isResendNetworkError, isRetryableResend, isSaleEmailReplay, recordSaleEmailSent, resendEmailId, saleEmailTags,
} from "../_shared/sale-email.ts";
import { vipEmailStateOk } from "../_shared/vip-email-state.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[SEND-VIP-CONFIRMATION] ${step}${detailsStr}`);
};

// Payé = confirmé : il n'y a plus de « refus » sans remboursement. Un appel
// `refused` d'un ancien front reçoit 410, sans e-mail (il disait « rien n'a été
// débité » à un client qui avait payé). Une annulation par l'organisation est
// `cancelled_refunded` (tout rendu) ou `cancelled` (rien n'avait été payé en ligne).
type VipEmailType =
  | 'request_received' | 'confirmed' | 'modified' | 'table_changed'
  | 'cancelled_refunded' | 'cancelled' | 'walkin_summary';
const VIP_EMAIL_TYPES: VipEmailType[] = [
  'request_received', 'confirmed', 'modified', 'table_changed', 'cancelled_refunded', 'cancelled', 'walkin_summary',
];

interface PlanLayout { tables?: { id?: string; name?: string }[] }

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
  // Lien démo : lecture seule garantie côté serveur (_shared/demo-guard.ts).
  const demoRefusal = await demoPreviewGuard(req, corsHeaders);
  if (demoRefusal) return demoRefusal;

  try {
    logStep("Function started");

    // SECURITY : cette fonction n'est plus déclenchable par un simple reservationId anonyme. Elle envoie toujours
    // l'email au titulaire de la réservation (jamais à une adresse fournie par l'appelant → pas de relais ouvert).
    // Deux appelants seulement : la clé service (checkout / verify / owner-refund serveur) ; ou un compte connecté QUI
    // GÈRE cette réservation (même porte que vip_set_table_placement : équipe de la soirée, partenaires, manager « tables »,
    // hôte VIP du club) — vérifié plus bas, une fois la réservation lue. N'importe quel autre compte connecté, qui
    // pouvait annoncer « table annulée et remboursée » à n'importe quel client, est refusé (403). Anonyme : 403.
    const authHeader = req.headers.get("Authorization") || "";
    const bearer = authHeader.replace("Bearer ", "");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const isService = bearer !== "" && bearer === serviceKey;
    let callerId: string | null = null;
    if (!isService && authHeader) {
      const authClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } }
      );
      const { data: { user: caller } } = await authClient.auth.getUser();
      callerId = caller?.id ?? null;
    }
    if (!isService && !callerId) {
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

    if ((type as string) === 'refused') {
      logStep("Legacy 'refused' type — no e-mail sent", { reservationId });
      return new Response(
        JSON.stringify({ error: "gone", detail: "The 'refused' e-mail no longer exists: a paid table is confirmed, and an organizer cancellation refunds everything (cancelled_refunded)." }),
        { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (!VIP_EMAIL_TYPES.includes(type)) {
      throw new Error(`Invalid type. Must be: ${VIP_EMAIL_TYPES.join(', ')}`);
    }

    const { data: reservation, error: resError } = await supabaseAdmin
      .from('table_reservations')
      .select(`
        id, status, refund_reason, user_email, user_id, full_name, minimum_spend, total_price, guest_count, qr_code, reference_code,
        deposit, management_fee, fee_absorbed, payment_mode, refund_amount, charged_total,
        requested_table_id, assigned_table_id, placement_status, placement_adjustment, placement_adjustment_amount,
        zone_id,
        table_zones(name, venue_id),
        table_packs(name),
        events!inner(id, title, start_at, venue_id, partner_venue_id, poster_url, location_name, location_address, location_is_secret, reveal_address_in_email, venues!events_venue_id_fkey(name, address))
      `)
      .eq('id', reservationId)
      .single();

    if (resError || !reservation) throw new Error("Reservation not found");

    // Un compte connecté doit gérer CETTE réservation (la clé service, elle, a déjà décidé côté serveur).
    if (!isService) {
      const resEvent = reservation.events as unknown as { id: string };
      const { data: canManage } = await supabaseAdmin.rpc('_can_manage_table_reservation', {
        p_uid: callerId, p_event_id: resEvent?.id ?? null, p_zone_id: reservation.zone_id ?? null, p_allow_vip_host: true,
      });
      if (canManage !== true) {
        logStep("Caller does not manage this reservation", { callerId, reservationId });
        return new Response(
          JSON.stringify({ error: "Forbidden" }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // L'e-mail ne dit jamais autre chose que l'état de la réservation (annulée et remboursée ≠ payée, confirmée ≠ impayée).
    if (!vipEmailStateOk(type, reservation as { status?: string | null; refund_amount?: number | string | null; refund_reason?: string | null })) {
      logStep("State does not match the e-mail type — no e-mail sent", { reservationId, type, status: (reservation as { status?: string }).status });
      return new Response(
        JSON.stringify({ error: "state_mismatch", detail: "The reservation is not in the state this e-mail announces." }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Colonnes des embeds du select ci-dessus (utilisées dans ce fichier)
    interface VipEmailEvent {
      id: string;
      title: string | null;
      start_at: string;
      venue_id: string | null;
      partner_venue_id: string | null;
      poster_url: string | null;
      location_name: string | null;
      location_address: string | null;
      location_is_secret: boolean | null;
      reveal_address_in_email: boolean | null;
      venues: { name: string | null; address: string | null } | null;
    }
    // Sans schéma, le client type chaque embed en tableau : on le relit tel qu'il arrive.
    const event = reservation.events as unknown as VipEmailEvent;
    const zone = reservation.table_zones as unknown as { name: string | null; venue_id: string | null } | null;
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

    // ── Table : nom lisible de la table demandée / attribuée / surclassée ──
    // Les tables du plan sont des ids dans le dessin (plan de la soirée, sinon
    // plan du club) : le nom que le client lit vient de là.
    const wantedTableIds = [reservation.requested_table_id, reservation.assigned_table_id].filter((v): v is string => !!v);
    const tableNames = new Map<string, string>();
    if (wantedTableIds.length > 0) {
      try {
        let layout: PlanLayout | null = null;
        const { data: eventPlan } = await supabaseAdmin
          .from('venue_floor_plans').select('layout').eq('event_id', event.id).maybeSingle();
        layout = (eventPlan?.layout as PlanLayout | null) ?? null;
        const clubId = event.venue_id ?? event.partner_venue_id;
        if (!layout && clubId) {
          const { data: venuePlan } = await supabaseAdmin
            .from('venue_floor_plans').select('layout').eq('venue_id', clubId).is('event_id', null).maybeSingle();
          layout = (venuePlan?.layout as PlanLayout | null) ?? null;
        }
        for (const tb of layout?.tables ?? []) {
          if (tb.id && tb.name && wantedTableIds.includes(tb.id)) tableNames.set(tb.id, tb.name);
        }
      } catch (planErr) {
        console.error('[SEND-VIP-CONFIRMATION] table name lookup skipped:', planErr);
      }
    }
    const requestedTableName = reservation.requested_table_id ? tableNames.get(reservation.requested_table_id) ?? null : null;
    const assignedTableName = reservation.assigned_table_id ? tableNames.get(reservation.assigned_table_id) ?? null : null;
    const packRow = reservation.table_packs as unknown as { name: string | null } | null;
    const euro = (n: number) => `€${n.toFixed(2)}`;

    // Surclassement offert / différence à régler sur place (déplacement vers une
    // autre formule, décision du pro) : jamais un nouveau débit en ligne.
    const adjustmentAmount = Number(reservation.placement_adjustment_amount) || 0;
    const adjustmentText = reservation.placement_adjustment === 'upgrade_free'
      ? (lang === 'fr' ? "C'est un surclassement offert par le club : rien de plus à régler."
        : lang === 'es' ? 'Es una mejora ofrecida por el club: no tienes nada más que pagar.'
        : 'This is an upgrade offered by the venue: nothing more to pay.')
      : reservation.placement_adjustment === 'pay_on_site' && adjustmentAmount > 0
      ? (lang === 'fr' ? `Différence à régler sur place : ${euro(adjustmentAmount)}.`
        : lang === 'es' ? `Diferencia a pagar en el local: ${euro(adjustmentAmount)}.`
        : `Difference to pay on site: ${euro(adjustmentAmount)}.`)
      : '';

    // Où en est le placement : dit honnêtement ce qui est promis et ce qui ne l'est pas.
    const placementText = (() => {
      if (reservation.placement_status === 'assign_on_arrival') {
        return lang === 'fr' ? "Placement à l'arrivée : l'organisateur t'attribue ta table quand tu arrives."
          : lang === 'es' ? 'Ubicación a la llegada: el organizador te asigna tu mesa cuando llegues.'
          : 'Seating on arrival: the host assigns your table when you get there.';
      }
      if (assignedTableName) {
        return lang === 'fr' ? `Ta table : ${assignedTableName}.`
          : lang === 'es' ? `Tu mesa: ${assignedTableName}.`
          : `Your table: ${assignedTableName}.`;
      }
      if (reservation.requested_table_id) {
        const nm = requestedTableName ?? '';
        return lang === 'fr' ? `Table demandée${nm ? ` : ${nm}` : ''}. L'organisateur te la confirme avant la soirée.`
          : lang === 'es' ? `Mesa solicitada${nm ? `: ${nm}` : ''}. El organizador te la confirma antes de la noche.`
          : `Table requested${nm ? `: ${nm}` : ''}. The host confirms it with you before the night.`;
      }
      return '';
    })();

    // Reçu de l'acompte : payé en ligne (acompte + frais) et reste à régler au club.
    const depositNum = Number(reservation.deposit) || 0;
    const totalNum = Number(reservation.total_price ?? reservation.minimum_spend ?? 0) || 0;
    // Payé en ligne = ce que la session Stripe a prélevé (posé au checkout : acompte + ligne de frais, frais absorbés
    // compris). Repli (réservation sans montants stockés) : l'estimation d'avant.
    const chargedTotalNum = Number(reservation.charged_total) || 0;
    const paidOnlineNum = chargedTotalNum > 0
      ? chargedTotalNum
      : depositNum > 0 ? depositNum + (reservation.fee_absorbed ? 0 : (Number(reservation.management_fee) || 0)) : 0;
    const remainingNum = Math.max(0, totalNum - depositNum);

    // For the "confirmed" (booked) email, render via the shared editorial
    // builder (QR de la réservation + pass Apple Wallet). The other types go
    // through buildVipStatus (même grille, sans QR).
    let html: string;
    let finalSubject = '';
    let attachments: Array<{ filename: string; content: string; content_id: string }> | undefined;
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

      // QR de la réservation en PNG inline (Gmail / Outlook bloquent les data:).
      // Il fait entrer toute la table ; les QR de chaque invité sont derrière le
      // lien du bouton. Jamais bloquant.
      let qrDataUrl: string | undefined;
      if (reservation.qr_code) {
        try {
          const png: string = await QRCode.toDataURL(reservation.qr_code, { width: 300, margin: 2 });
          attachments = [{ filename: 'qr.png', content: png.replace(/^data:image\/png;base64,/, ''), content_id: 'vip-qr' }];
          qrDataUrl = 'cid:vip-qr';
        } catch (qrErr) {
          console.error('[SEND-VIP-CONFIRMATION] QR skipped:', qrErr);
        }
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
        tableName: zone?.name || packRow?.name || (lang === 'fr' ? 'Table VIP' : lang === 'es' ? 'Mesa VIP' : 'VIP table'),
        guests: guestsStr,
        total: euro(totalNum),
        reference: reservation.reference_code || reservation.qr_code || '',
        manageUrl: isGuest && reservationRef
          ? `${appBaseUrl}/claim?type=table&ref=${encodeURIComponent(reservationRef)}`
          : `${appBaseUrl}/my-orders`,
        manageIsClaim: isGuest && !!reservationRef,
        walletUrl,
        qrDataUrl,
        paidOnline: paidOnlineNum > 0 ? euro(paidOnlineNum) : undefined,
        remainingOnSite: remainingNum > 0 ? euro(remainingNum) : undefined,
        note: [placementText, adjustmentText].filter(Boolean).join(' ') || undefined,
      });
      html = mail.html;
      finalSubject = mail.subject;
    } else {
      // request_received / modified / table_changed / cancelled_* : même grille
      // éditoriale que la confirmation, sans bouton sur une annulation sans paiement.
      const dp = fmtDateParts(event.start_at, lang);
      const gc = reservation.guest_count ?? 0;
      const statusType = type as 'request_received' | 'modified' | 'table_changed' | 'cancelled_refunded' | 'cancelled';
      // Ce qui a changé pour une table déplacée : nouvelle table, placement à
      // l'arrivée, surclassement offert ou différence à régler sur place.
      const changesText = statusType === 'table_changed'
        ? [
          reservation.placement_status === 'assign_on_arrival'
            ? placementText
            : assignedTableName
            ? (lang === 'fr' ? `Ta nouvelle table : ${assignedTableName}.`
              : lang === 'es' ? `Tu nueva mesa: ${assignedTableName}.`
              : `Your new table: ${assignedTableName}.`)
            : '',
          adjustmentText,
          changes || '',
        ].filter(Boolean).join(' ')
        : changes || '';
      const refundNum = Number(reservation.refund_amount) || 0;
      // Avoir de l'annulation (vague C2, credit_notes) : le plus récent de la réservation, lien public /avoir/<jeton>. Absent = pas de lien.
      let creditNoteUrl: string | undefined;
      if (statusType === 'cancelled_refunded') {
        try {
          const { data: cn } = await supabaseAdmin.from('credit_notes')
            .select('public_token').eq('table_reservation_id', reservationId)
            .order('created_at', { ascending: false }).limit(1).maybeSingle();
          if (cn?.public_token) creditNoteUrl = `${appBaseUrl}/avoir/${cn.public_token}`;
        } catch (cnErr) {
          console.error('[SEND-VIP-CONFIRMATION] credit note lookup skipped:', cnErr);
        }
      }
      const cancelled = statusType === 'cancelled' || statusType === 'cancelled_refunded';
      const mail = buildVipStatus({
        lang,
        kind: statusType,
        firstName: firstName || undefined,
        eventTitle,
        venueName,
        posterUrl: event?.poster_url || undefined,
        day: dp.day,
        month: dp.month,
        arrivalTime: dp.time,
        tableName: zone?.name || undefined,
        guests: gc > 0 ? String(gc) : undefined,
        changes: changesText || undefined,
        address: venueAddress && !cancelled ? rawAddress : undefined,
        addressDeferred: addressDeferred && !cancelled,
        manageUrl: !isGuest ? `${appBaseUrl}/my-orders` : undefined,
        claimUrl: isGuest && reservationRef && !cancelled ? `${appBaseUrl}/claim?type=table&ref=${encodeURIComponent(reservationRef)}` : undefined,
        refundAmount: statusType === 'cancelled_refunded' && refundNum > 0 ? euro(refundNum) : undefined,
        creditNoteUrl,
      });
      html = mail.html;
      finalSubject = mail.subject;
    }

    const rawFrom = Deno.env.get('RESEND_FROM_EMAIL');
    const from = rawFrom
      ? (rawFrom.includes('<') ? rawFrom : `Yuno <${rawFrom}>`)
      : 'Yuno <noreply@yunoapp.eu>';

    async function resendRefused(status: number, detail: string): Promise<Response> {
      const message = `Resend ${status || 'network'}: ${detail}`.slice(0, 500);
      if (replay) {
        return new Response(JSON.stringify({ error: message, retry: true }), { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const queued = await enqueueSaleEmail(supabaseAdmin, 'table', reservationId!, type, changes ? { changes } : {}, message);
      logStep("Resend refused — sale e-mail queued", { reservationId, type, status, queued });
      if (!queued) throw new Error(message);
      return new Response(JSON.stringify({ success: true, queued: true, type, email: customerEmail }), { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    // Resend refuse (quota, panne, délai) : la vente entre dans la file des e-mails de vente (D6), rejouée par
    // process-scheduled-campaigns. Un rejeu (en-tête posé par le passage) ne remet rien en file : 503, le passage compte.
    const replay = isSaleEmailReplay(req);
    let res: Response;
    try {
      res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resendApiKey}`,
        },
        // Tags relus par resend-webhook : un rebond se rattache à CETTE
        // réservation et prévient le club / l'organisateur (le récap walk-in, lui,
        // part après la soirée et n'est pas suivi).
        body: JSON.stringify({
          from, to: [customerEmail], subject: finalSubject, html,
          ...(attachments ? { attachments } : {}),
          tags: saleEmailTags('table', reservationId),
        }),
        signal: AbortSignal.timeout(10000),
      });
    } catch (netErr) {
      if (!isResendNetworkError(netErr)) throw netErr;
      return await resendRefused(0, String((netErr as Error)?.message ?? netErr));
    }

    if (!res.ok) {
      const errData = await res.text();
      if (isRetryableResend(res.status, errData)) return await resendRefused(res.status, errData);
      throw new Error(`Resend error: ${errData}`);
    }

    logStep("Email sent", { type, to: customerEmail });
    await recordSaleEmailSent(supabaseAdmin, 'table', reservationId, customerEmail, await resendEmailId(res));

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
