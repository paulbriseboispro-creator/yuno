import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const logStep = (step: string, details?: any) => {
  console.log(`[CLAIM-GUEST-ORDER] ${step}`, details ? JSON.stringify(details) : "");
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const body = await req.json();
    const { action, orderNumber, lastName, otpCode, purchaseType, purchaseId, userId } = body;

    // purchaseType: 'order' (default), 'ticket', 'table'
    const type = purchaseType || 'order';

    // Helper to find a purchase by reference
    const findPurchase = async (ref?: string) => {
      const trimmedRef = (ref || "").trim();
      // Drink order numbers (DR-XXXXXX) are uppercase hex. Ticket/table QR codes
      // are `TK-`/`VP-` + a lowercase UUID and are case-sensitive, so uppercasing
      // them would break the match.
      const normalizedRef = type === 'order' ? trimmedRef.toUpperCase() : trimmedRef;
      if (type === 'ticket') {
        const { data, error } = await supabaseAdmin
          .from("tickets")
          .select("id, qr_code, user_email, guest_last_name, guest_first_name, guest_phone, full_name, phone, status, is_guest, user_id, event_id, claimed_by_user_id")
          .eq("qr_code", normalizedRef)
          .single();
        if (error || !data) return null;
        return { ...data, reference: data.qr_code, email: data.user_email, table: 'tickets' };
      } else if (type === 'table') {
        const { data, error } = await supabaseAdmin
          .from("table_reservations")
          .select("id, qr_code, user_email, guest_last_name, guest_first_name, guest_phone, full_name, phone, status, is_guest, user_id, event_id, claimed_by_user_id")
          .eq("qr_code", normalizedRef)
          .single();
        if (error || !data) return null;
        return { ...data, reference: data.qr_code, email: data.user_email, table: 'table_reservations' };
      } else {
        const { data, error } = await supabaseAdmin
          .from("orders")
          .select("id, order_number, guest_last_name, guest_first_name, guest_phone, user_email, status, is_guest, user_id, claimed_by_user_id, venue_id, event_id")
          .eq("order_number", normalizedRef)
          .single();
        if (error || !data) return null;
        return { ...data, reference: data.order_number, email: data.user_email, table: 'orders' };
      }
    };

    // Helper to find a purchase by ID
    const findPurchaseById = async (pid: string) => {
      if (type === 'ticket') {
        const { data, error } = await supabaseAdmin
          .from("tickets")
          .select("id, qr_code, user_email, guest_last_name, guest_first_name, guest_phone, full_name, phone, status, is_guest, user_id, event_id, claimed_by_user_id")
          .eq("id", pid)
          .single();
        if (error || !data) return null;
        return { ...data, reference: data.qr_code, email: data.user_email, table: 'tickets' };
      } else if (type === 'table') {
        const { data, error } = await supabaseAdmin
          .from("table_reservations")
          .select("id, qr_code, user_email, guest_last_name, guest_first_name, guest_phone, full_name, phone, status, is_guest, user_id, event_id, claimed_by_user_id")
          .eq("id", pid)
          .single();
        if (error || !data) return null;
        return { ...data, reference: data.qr_code, email: data.user_email, table: 'table_reservations' };
      } else {
        const { data, error } = await supabaseAdmin
          .from("orders")
          .select("id, order_number, guest_last_name, guest_first_name, guest_phone, user_email, status, is_guest, user_id, claimed_by_user_id, venue_id, event_id")
          .eq("id", pid)
          .single();
        if (error || !data) return null;
        return { ...data, reference: data.order_number, email: data.user_email, table: 'orders' };
      }
    };

    // ---- ACTION: finalize_context ----
    // Returns guest purchase data for the finalize account page.
    // SECURITY: requires a previously verified OTP for this purchaseId (lookup → verify → finalize_context).
    // This prevents unauthenticated enumeration of guest PII (email, name, phone).
    if (action === "finalize_context") {
      if (!purchaseId) throw new Error("ID d'achat requis");

      logStep("Finalize context request", { purchaseId, type });

      // Require a verified OTP — proves the caller controls the guest email.
      const { data: verifiedOtp } = await supabaseAdmin
        .from("guest_claim_otps")
        .select("id")
        .eq("order_id", purchaseId)
        .eq("verified", true)
        .limit(1)
        .maybeSingle();

      if (!verifiedOtp) {
        logStep("finalize_context blocked — no verified OTP", { purchaseId });
        return new Response(
          JSON.stringify({ error: "Vérification OTP requise" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 403 }
        );
      }

      const purchase = await findPurchaseById(purchaseId);
      if (!purchase) throw new Error("Achat introuvable");

      // Only allow for guest purchases (no user_id set, or is_guest flag)
      if (purchase.user_id && !purchase.is_guest) {
        throw new Error("Cet achat est déjà lié à un compte");
      }

      // Parse name parts
      let firstName = purchase.guest_first_name || '';
      let lastName2 = purchase.guest_last_name || '';
      const phone = purchase.guest_phone || purchase.phone || '';

      // Fallback: try to split full_name if guest fields are empty
      if (!firstName && !lastName2 && purchase.full_name) {
        const parts = purchase.full_name.trim().split(/\s+/);
        firstName = parts[0] || '';
        lastName2 = parts.slice(1).join(' ') || '';
      }

      // Get event/venue info
      let eventTitle = '';
      let venueName = '';
      if (purchase.event_id) {
        const { data: event } = await supabaseAdmin.from("events").select("title, venue_id").eq("id", purchase.event_id).single();
        eventTitle = event?.title || '';
        if (event?.venue_id) {
          const { data: venue } = await supabaseAdmin.from("venues").select("name").eq("id", event.venue_id).single();
          venueName = venue?.name || '';
        }
      }
      // For orders, get venue directly
      if (!venueName && purchase.venue_id) {
        const { data: venue } = await supabaseAdmin.from("venues").select("name").eq("id", purchase.venue_id).single();
        venueName = venue?.name || '';
      }

      return new Response(
        JSON.stringify({
          email: purchase.email || '',
          firstName,
          lastName: lastName2,
          phone,
          reference: purchase.reference || '',
          type,
          eventTitle,
          venueName,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // ---- ACTION: link_after_signup ----
    // Links a guest purchase to a newly created user (called right after signUp).
    // SECURITY: requires Authorization header matching the userId being linked,
    // AND a verified OTP for that purchase (created via the lookup→verify flow).
    if (action === "link_after_signup") {
      if (!purchaseId || !userId) throw new Error("Paramètres manquants");

      // 1. Authenticate the caller — we will only link to the caller's own user_id
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        throw new Error("Authentification requise");
      }
      const supabaseClientForAuth = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user: authUser }, error: authErr } = await supabaseClientForAuth.auth.getUser();
      if (authErr || !authUser) {
        throw new Error("Session invalide");
      }
      if (authUser.id !== userId) {
        logStep("link_after_signup userId mismatch", { authUid: authUser.id, requestedUserId: userId });
        throw new Error("Identifiant utilisateur invalide");
      }

      logStep("Link after signup", { purchaseId, userId, type });

      const purchase = await findPurchaseById(purchaseId);
      if (!purchase) throw new Error("Achat introuvable");

      if (purchase.claimed_by_user_id && purchase.claimed_by_user_id !== userId) {
        throw new Error("Cet achat est déjà lié à un autre compte");
      }

      // 2. Require a previously-verified OTP for this purchase
      // (the user must have proved control of the guest email via the lookup/verify flow)
      const { data: verifiedOtp } = await supabaseAdmin
        .from("guest_claim_otps")
        .select("id, email")
        .eq("order_id", purchase.id)
        .eq("verified", true)
        .limit(1)
        .maybeSingle();

      if (!verifiedOtp) {
        throw new Error("Vérification OTP requise avant de lier l'achat");
      }

      // 3. Best-effort: ensure the verified email matches the authenticated user's email
      // (prevents a logged-in attacker from claiming a guest order they OTP-verified
      // through someone else's email — defense in depth).
      if (verifiedOtp.email && authUser.email
          && verifiedOtp.email.toLowerCase() !== authUser.email.toLowerCase()) {
        logStep("link_after_signup email mismatch between OTP and auth", {
          otpEmail: verifiedOtp.email,
          authEmail: authUser.email,
        });
        throw new Error("L'email vérifié ne correspond pas à votre compte");
      }

      const updateData: Record<string, any> = {
        user_id: userId,
        claimed_by_user_id: userId,
        claimed_at: new Date().toISOString(),
      };

      await supabaseAdmin
        .from(purchase.table)
        .update(updateData)
        .eq("id", purchase.id);

      logStep("Purchase linked after signup", { purchaseId: purchase.id, userId });

      return new Response(
        JSON.stringify({ success: true, message: "Achat lié à votre compte" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // ---- Remaining actions require orderNumber ----
    if (!orderNumber) {
      throw new Error("Numéro de commande requis");
    }

    // Do NOT uppercase here — findPurchase normalizes per type (uppercase for
    // DR- order numbers, case-sensitive for TK-/VP- QR codes).
    const normalizedOrderNumber = orderNumber.trim();
    const normalizedLastName = (lastName || "").trim().toLowerCase();

    if (action === "lookup") {
      if (!normalizedLastName) {
        throw new Error("Nom de famille requis");
      }

      logStep("Lookup request", { orderNumber: normalizedOrderNumber, type });

      const purchase = await findPurchase(normalizedOrderNumber);
      if (!purchase) {
        throw new Error("Commande introuvable");
      }

      // Validate status
      const validStatuses = type === 'table' ? ['paid', 'confirmed'] : ['paid', 'served'];
      if (!validStatuses.includes(purchase.status)) {
        throw new Error("Cette commande n'est pas valide");
      }

      // Check last name match
      let lastNameMatch = false;
      if (purchase.guest_last_name && purchase.guest_last_name.toLowerCase() === normalizedLastName) {
        lastNameMatch = true;
      }
      if (!lastNameMatch && purchase.user_id) {
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("last_name")
          .eq("id", purchase.user_id)
          .single();
        if (profile?.last_name && profile.last_name.toLowerCase() === normalizedLastName) {
          lastNameMatch = true;
        }
      }
      // For tickets/tables, also check full_name
      if (!lastNameMatch && (type === 'ticket' || type === 'table')) {
        const { data: record } = await supabaseAdmin
          .from(purchase.table)
          .select("full_name")
          .eq("id", purchase.id)
          .single();
        if (record?.full_name) {
          const nameParts = record.full_name.toLowerCase().split(/\s+/);
          if (nameParts.includes(normalizedLastName)) {
            lastNameMatch = true;
          }
        }
      }

      if (!lastNameMatch) {
        throw new Error("Le nom de famille ne correspond pas");
      }

      // Rate-limit: don't re-send a code if one was issued in the last 60s.
      // Prevents email-bombing a guest whose reference + last name leaked.
      const { data: recentOtp } = await supabaseAdmin
        .from("guest_claim_otps")
        .select("created_at")
        .eq("order_id", purchase.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (recentOtp?.created_at && Date.now() - new Date(recentOtp.created_at).getTime() < 60_000) {
        throw new Error("Un code vient d'être envoyé. Patientez une minute avant de réessayer.");
      }

      // Generate OTP and send to email
      const otp = String(Math.floor(100000 + Math.random() * 900000));

      await supabaseAdmin
        .from("guest_claim_otps")
        .delete()
        .eq("order_id", purchase.id);

      await supabaseAdmin
        .from("guest_claim_otps")
        .insert({
          order_id: purchase.id,
          email: purchase.email,
          otp_code: otp,
        });

      const rawFrom = Deno.env.get("RESEND_FROM_EMAIL");
      const from = rawFrom
        ? rawFrom.includes("<") ? rawFrom : `Yuno <${rawFrom}>`
        : "Yuno <onboarding@resend.dev>";

      const maskedEmail = purchase.email
        ? purchase.email.replace(/(.{2})(.*)(@.*)/, "$1***$3")
        : "***";

      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from,
          to: [purchase.email],
          subject: `Yuno - Code de vérification : ${otp}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 30px; background: #0a0a0a; color: #fff; border-radius: 12px;">
              <h2 style="color: #dc2626; margin-bottom: 20px;">Vérification de votre commande</h2>
              <p style="color: #a0a0a0; margin-bottom: 20px;">Voici votre code de vérification pour retrouver votre commande <strong style="color:#fff;">${purchase.reference}</strong> :</p>
              <div style="background: #1a1a1a; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
                <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #dc2626;">${otp}</span>
              </div>
              <p style="color: #666; font-size: 12px;">Ce code expire dans 10 minutes.</p>
            </div>
          `,
        }),
      });

      logStep("OTP sent", { purchaseId: purchase.id, maskedEmail });

      return new Response(
        JSON.stringify({ success: true, maskedEmail, message: "Code envoyé par email" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    if (action === "verify") {
      if (!otpCode) {
        throw new Error("Code de vérification requis");
      }

      logStep("Verify OTP", { orderNumber: normalizedOrderNumber, type });

      const purchase = await findPurchase(normalizedOrderNumber);
      if (!purchase) {
        throw new Error("Commande introuvable");
      }

      const MAX_OTP_ATTEMPTS = 5;

      // Fetch the active (unverified, unexpired) OTP for this purchase, then
      // compare the code in app code so we can count wrong attempts.
      const { data: otpRecord } = await supabaseAdmin
        .from("guest_claim_otps")
        .select("*")
        .eq("order_id", purchase.id)
        .eq("verified", false)
        .gte("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!otpRecord) {
        throw new Error("Code invalide ou expiré");
      }

      // Brute-force guard: invalidate the code after too many wrong tries.
      if ((otpRecord.attempts ?? 0) >= MAX_OTP_ATTEMPTS) {
        await supabaseAdmin.from("guest_claim_otps").delete().eq("id", otpRecord.id);
        throw new Error("Trop de tentatives. Demandez un nouveau code.");
      }

      if (otpRecord.otp_code !== otpCode.trim()) {
        await supabaseAdmin
          .from("guest_claim_otps")
          .update({ attempts: (otpRecord.attempts ?? 0) + 1 })
          .eq("id", otpRecord.id);
        throw new Error("Code invalide ou expiré");
      }

      await supabaseAdmin
        .from("guest_claim_otps")
        .update({ verified: true })
        .eq("id", otpRecord.id);

      // Build response based on type
      let responseData: any = { id: purchase.id, reference: purchase.reference };

      if (type === 'ticket') {
        const { data: ticket } = await supabaseAdmin
          .from("tickets")
          .select("id, qr_code, quantity, total_price, status, paid_at, event_id, round_id, ticket_rounds(name)")
          .eq("id", purchase.id)
          .single();
        
        let eventTitle = "", venueName = "";
        if (ticket?.event_id) {
          const { data: event } = await supabaseAdmin.from("events").select("title, venue_id").eq("id", ticket.event_id).single();
          eventTitle = event?.title || "";
          if (event?.venue_id) {
            const { data: venue } = await supabaseAdmin.from("venues").select("name").eq("id", event.venue_id).single();
            venueName = venue?.name || "";
          }
        }
        responseData = {
          ...responseData,
          type: 'ticket',
          qrCode: ticket?.qr_code,
          quantity: ticket?.quantity,
          totalPrice: ticket?.total_price,
          status: ticket?.status,
          paidAt: ticket?.paid_at,
          roundName: (ticket?.ticket_rounds as any)?.name,
          eventTitle,
          venueName,
        };
      } else if (type === 'table') {
        const { data: reservation } = await supabaseAdmin
          .from("table_reservations")
          .select("id, qr_code, guest_count, total_price, deposit, status, paid_at, event_id, full_name, table_zones(name), table_packs(name)")
          .eq("id", purchase.id)
          .single();
        
        let eventTitle = "", venueName = "";
        if (reservation?.event_id) {
          const { data: event } = await supabaseAdmin.from("events").select("title, venue_id").eq("id", reservation.event_id).single();
          eventTitle = event?.title || "";
          if (event?.venue_id) {
            const { data: venue } = await supabaseAdmin.from("venues").select("name").eq("id", event.venue_id).single();
            venueName = venue?.name || "";
          }
        }
        responseData = {
          ...responseData,
          type: 'table',
          qrCode: reservation?.qr_code,
          guestCount: reservation?.guest_count,
          totalPrice: reservation?.total_price,
          deposit: reservation?.deposit,
          status: reservation?.status,
          paidAt: reservation?.paid_at,
          fullName: reservation?.full_name,
          zoneName: (reservation?.table_zones as any)?.name,
          packName: (reservation?.table_packs as any)?.name,
          eventTitle,
          venueName,
        };
      } else {
        const { data: order } = await supabaseAdmin
          .from("orders")
          .select("id, order_number, items, total, status, token, venue_id, event_id, created_at, paid_at")
          .eq("id", purchase.id)
          .single();

        let venueName = "", eventTitle = "";
        if (order?.venue_id) {
          const { data: venue } = await supabaseAdmin.from("venues").select("name").eq("id", order.venue_id).single();
          venueName = venue?.name || "";
        }
        if (order?.event_id) {
          const { data: event } = await supabaseAdmin.from("events").select("title").eq("id", order.event_id).single();
          eventTitle = event?.title || "";
        }
        responseData = {
          type: 'order',
          id: order?.id,
          orderNumber: order?.order_number,
          items: order?.items,
          total: order?.total,
          status: order?.status,
          token: order?.token,
          venueName,
          eventTitle,
          createdAt: order?.created_at,
          paidAt: order?.paid_at,
        };
      }

      logStep("OTP verified, returning purchase", { purchaseId: purchase.id, type });

      return new Response(
        JSON.stringify({ success: true, order: responseData }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    if (action === "link") {
      const supabaseClientForAuth = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        {
          global: {
            headers: { Authorization: req.headers.get("Authorization")! },
          },
        }
      );

      const { data: { user }, error: authError } = await supabaseClientForAuth.auth.getUser();
      if (authError || !user) {
        throw new Error("Vous devez être connecté pour lier cette commande");
      }

      const purchase = await findPurchase(normalizedOrderNumber);
      if (!purchase) {
        throw new Error("Commande introuvable");
      }

      if (purchase.claimed_by_user_id) {
        throw new Error("Cette commande est déjà liée à un compte");
      }

      // Verify OTP was previously verified for this purchase
      const { data: verifiedOtp } = await supabaseAdmin
        .from("guest_claim_otps")
        .select("id")
        .eq("order_id", purchase.id)
        .eq("verified", true)
        .limit(1)
        .single();

      if (!verifiedOtp) {
        throw new Error("Vérification OTP requise avant de lier la commande");
      }

      // Link purchase to user
      const updateData = {
        user_id: user.id,
        claimed_by_user_id: user.id,
        claimed_at: new Date().toISOString(),
      };

      await supabaseAdmin
        .from(purchase.table)
        .update(updateData)
        .eq("id", purchase.id);

      logStep("Purchase linked to user", { purchaseId: purchase.id, userId: user.id, type });

      return new Response(
        JSON.stringify({ success: true, message: "Commande liée à votre compte" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    throw new Error("Action invalide");
  } catch (error) {
    console.error("Error in claim-guest-order:", error);
    const errorMessage = error instanceof Error ? error.message : "Erreur inconnue";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }
});
