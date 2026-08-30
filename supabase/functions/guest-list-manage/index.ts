// Gestion guest list côté détenteur — deux actions authentifiées :
//   - add_guest : ajout direct nom/email sur N'IMPORTE QUELLE part que
//     l'appelant gère (club / organisateur / DJ / promoteur / custom).
//     Généralise promoter-add-guest : l'invité reçoit son QR par email
//     et un push s'il a un compte Yuno.
//   - send_invite_email : envoie le lien unique personnel d'une invitation
//     (guest_list_invites) à son destinataire.
// L'autorisation passe par la RPC can_manage_guest_list_part (source unique,
// partagée avec les policies RLS des invitations).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import type { EmailLanguage } from "../_shared/email-branding.ts";
import { restrictedCorsHeaders } from "../_shared/cors.ts";
import { sendAutoPush } from "../_shared/auto-push.ts";
import {
  entryTypeLabel,
  resolveGuestListBrandName,
  resolveGuestListHolderName,
  resolveGuestListPlace,
} from "../_shared/guest-list-email.ts";
import {
  buildGuestListConfirmation,
  buildGuestListInvite,
  fmtDateParts,
} from "../_shared/email-templates.ts";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[GUEST-LIST-MANAGE] ${step}`, details ? JSON.stringify(details) : "");
};

const APP_URL = "https://yunoapp.eu";

function generateReservationCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `YN-${code}`;
}

function generateQRCode(): string {
  // Credential de porte : crypto-random, jamais dérivé d'un timestamp.
  return `GL-${crypto.randomUUID()}`;
}

/** Map the atomic-capacity trigger's error to a clean client message (else null). */
function capacityErrorMessage(err: { message?: string; code?: string } | null): string | null {
  const msg = err?.message || "";
  if (msg.includes("Female quota reached")) return "Female quota reached";
  if (msg.includes("Male quota reached")) return "Male quota reached";
  if (msg.includes("Guest list is full")) return "Guest list is full";
  if (err?.code === "23505") return "This guest is already on the list";
  return null;
}

/** Slug cosmétique du lien public (la page résout par token, pas par slug). */
function slugify(name: string | null | undefined): string {
  const s = (name || "event").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "event";
}

interface PartRow {
  id: string;
  event_id: string;
  venue_id: string | null;
  organizer_user_id: string | null;
  dj_id: string | null;
  promoter_id: string | null;
  agency_id: string | null;
  holder_type: string;
  holder_label: string | null;
  quota: number | null;
  quota_normal: number;
  quota_drink: number;
  quota_table: number;
  entry_kind: string | null;
  entry_deadline: string | null;
  free_before_time: string | null;
  agency_distribution_mode: string | null;
  is_active: boolean;
}

interface EventRow {
  id: string;
  title: string;
  venue_id: string | null;
  partner_venue_id: string | null;
  organizer_user_id: string | null;
  start_at: string;
  end_at: string | null;
  poster_url: string | null;
  timezone: string | null;
}

/** Miroir TS de public.guest_list_allowed_entry_types (même règle). */
function allowedEntryTypes(part: PartRow): string[] {
  if (part.holder_type === "club") return ["normal", "drink", "table"];
  if ((part.quota_normal ?? 0) + (part.quota_drink ?? 0) + (part.quota_table ?? 0) > 0) {
    const out: string[] = [];
    if ((part.quota_normal ?? 0) > 0) out.push("normal");
    if ((part.quota_drink ?? 0) > 0) out.push("drink");
    if ((part.quota_table ?? 0) > 0) out.push("table");
    return out;
  }
  return [part.entry_kind || "normal"];
}

async function loadPartAndEvent(admin: SupabaseClient, guestListId: string): Promise<{ part: PartRow; event: EventRow; venueName: string }> {
  const { data: part } = await admin
    .from("guest_lists")
    .select("id, event_id, venue_id, organizer_user_id, dj_id, promoter_id, agency_id, holder_type, holder_label, quota, quota_normal, quota_drink, quota_table, entry_kind, entry_deadline, free_before_time, agency_distribution_mode, is_active")
    .eq("id", guestListId)
    .maybeSingle();
  if (!part) throw new Error("Guest list not found");

  const { data: event } = await admin
    .from("events")
    .select("id, title, venue_id, partner_venue_id, organizer_user_id, start_at, end_at, poster_url, timezone, location_address, location_city, location_is_secret, reveal_address_in_email")
    .eq("id", part.event_id)
    .maybeSingle();
  if (!event) throw new Error("Event not found");

  // Enseigne affichée : club hôte/partenaire, sinon l'organisateur de la
  // soirée. Avant, une soirée org-led (venue_id NULL) partait avec un en-tête
  // d'email vide et un « invité par Yuno » au lieu du nom de l'organisateur.
  const venueName = await resolveGuestListBrandName(admin, event as EventRow);
  return { part: part as PartRow, event: event as EventRow, venueName };
}

async function sendResendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const RESEND_FROM = Deno.env.get("RESEND_FROM_EMAIL") || "noreply@yunoapp.eu";
  if (!RESEND_API_KEY) {
    logStep("RESEND_API_KEY not set, skipping email");
    return false;
  }
  // Timeout : un tiers (Resend) qui ne répond pas ne doit pas suspendre la fonction.
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: RESEND_FROM, to: [to], subject, html }),
    signal: AbortSignal.timeout(10000),
  });
  // Ne plus avaler un échec Resend en silence : on trace et on retourne false
  // (l'appelant ne marquera email_sent_at que si l'envoi a réussi).
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logStep("Resend send failed", { to, status: res.status, body });
    return false;
  }
  return true;
}

serve(async (req) => {
  const corsHeaders = restrictedCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Authentication required");

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) throw new Error("Authentication required");

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const body = await req.json();
    const action = body.action as string;

    // ────────────────────────────────────────────────────────────────────
    // add_guest — ajout direct par le détenteur de la part.
    // ────────────────────────────────────────────────────────────────────
    if (action === "add_guest") {
      const { guestListId, fullName, email, phone, gender, entryType } = body;
      if (!guestListId || !fullName?.trim()) {
        throw new Error("Missing required fields: guestListId, fullName");
      }

      const { data: canManage } = await admin.rpc("can_manage_guest_list_part", {
        _user_id: user.id,
        _guest_list_id: guestListId,
      });
      if (canManage !== true) throw new Error("Unauthorized: you don't manage this guest list");

      const { part, event, venueName } = await loadPartAndEvent(admin, guestListId);
      if (!part.is_active) throw new Error("Guest list is inactive");
      if (event.end_at && new Date(event.end_at) < new Date()) {
        throw new Error("Event has ended");
      }

      const allowed = allowedEntryTypes(part);
      const resolvedEntryType = typeof entryType === "string" && entryType ? entryType : allowed[0];
      if (!allowed.includes(resolvedEntryType)) {
        throw new Error(`This guest list doesn't offer "${resolvedEntryType}" entries`);
      }

      const normalizedName = String(fullName).trim();
      const normalizedEmail = (email || "").trim().toLowerCase();
      const normalizedGender = gender === "female" || gender === "male" ? gender : null;

      // Dedup sur l'email normalisé (la vraie clé unique de la part).
      let existingEntry: { id: string; entry_type: string | null; qr_code: string | null; reservation_code: string | null } | null = null;
      if (normalizedEmail) {
        const { data: existingByEmail } = await admin
          .from("guest_list_entries")
          .select("id, entry_type, qr_code, reservation_code")
          .eq("guest_list_id", part.id)
          .eq("email", normalizedEmail)
          .neq("status", "cancelled")
          .maybeSingle();
        existingEntry = existingByEmail;
      }
      const isUpdate = Boolean(existingEntry);
      const typeChanging = isUpdate && (resolvedEntryType !== ((existingEntry?.entry_type) || "normal"));

      // Pré-checks quotas (le trigger atomic-capacity reste l'arbitre final) :
      // par type quand la part est ventilée, puis plafond global.
      const hasPerType = ((part.quota_normal ?? 0) + (part.quota_drink ?? 0) + (part.quota_table ?? 0)) > 0;
      if ((!isUpdate || typeChanging) && hasPerType) {
        const typeQuota = resolvedEntryType === "table" ? part.quota_table
          : resolvedEntryType === "drink" ? part.quota_drink
          : part.quota_normal;
        if (typeQuota > 0) {
          const { count: typeCount } = await admin
            .from("guest_list_entries")
            .select("*", { count: "exact", head: true })
            .eq("guest_list_id", part.id)
            .eq("entry_type", resolvedEntryType)
            .neq("status", "cancelled");
          if ((typeCount ?? 0) >= typeQuota) {
            throw new Error(`Quota reached for "${resolvedEntryType}" entries`);
          }
        }
      }
      if (!isUpdate && part.quota != null) {
        const { count: totalEntries } = await admin
          .from("guest_list_entries")
          .select("*", { count: "exact", head: true })
          .eq("guest_list_id", part.id)
          .neq("status", "cancelled");
        if ((totalEntries ?? 0) >= part.quota) {
          throw new Error("Guest list quota reached");
        }
      }

      // Auto-lien vers un compte Yuno existant (l'invité retrouve son QR dans l'app).
      // Langue de l'email = préférence du compte lié si connu, sinon anglais
      // (l'app est anglaise par défaut — on ne force plus le français).
      let linkedUserId: string | null = null;
      let recipientLang: EmailLanguage = "en";
      if (normalizedEmail) {
        const { data: existingProfile } = await admin
          .from("profiles")
          .select("id, preferred_language")
          .eq("email", normalizedEmail)
          .maybeSingle();
        if (existingProfile) {
          linkedUserId = existingProfile.id;
          if (existingProfile.preferred_language && ["en", "es", "fr"].includes(existingProfile.preferred_language)) {
            recipientLang = existingProfile.preferred_language as EmailLanguage;
          }
        }
      }

      let entryId = "";
      let qrCode = existingEntry?.qr_code || "";
      let reservationCode = existingEntry?.reservation_code || "";
      let wasUpdated = false;

      if (isUpdate && existingEntry) {
        const updatePayload: Record<string, unknown> = {
          full_name: normalizedName,
          email: normalizedEmail,
          gender: normalizedGender,
          status: "confirmed",
          entry_type: resolvedEntryType,
          entry_deadline: part.entry_deadline ?? null,
        };
        if (linkedUserId) updatePayload.user_id = linkedUserId;

        const { data: updatedEntry, error: updateError } = await admin
          .from("guest_list_entries")
          .update(updatePayload)
          .eq("id", existingEntry.id)
          .select("id, qr_code, reservation_code")
          .single();
        if (updateError || !updatedEntry) {
          console.error("Update error:", updateError);
          throw new Error(capacityErrorMessage(updateError) || "Failed to update guest");
        }
        entryId = updatedEntry.id;
        qrCode = updatedEntry.qr_code || qrCode;
        reservationCode = updatedEntry.reservation_code || reservationCode;
        wasUpdated = true;
        logStep("Guest updated", { entryId, entryType: resolvedEntryType });
      } else {
        qrCode = generateQRCode();
        reservationCode = generateReservationCode();

        const insertPayload: Record<string, unknown> = {
          guest_list_id: part.id,
          full_name: normalizedName,
          email: normalizedEmail,
          phone: (phone || "").trim(),
          qr_code: qrCode,
          reservation_code: reservationCode,
          gender: normalizedGender,
          // Une part promoteur attribue l'entrée au promoteur (commission au scan).
          promoter_id: part.holder_type === "promoter" ? part.promoter_id : null,
          status: "confirmed",
          entry_type: resolvedEntryType,
          entry_deadline: part.entry_deadline ?? null,
        };
        if (linkedUserId) insertPayload.user_id = linkedUserId;

        const { data: insertedEntry, error: insertError } = await admin
          .from("guest_list_entries")
          .insert(insertPayload)
          .select("id")
          .single();
        if (insertError || !insertedEntry) {
          console.error("Insert error:", insertError);
          throw new Error(capacityErrorMessage(insertError) || "Failed to add guest");
        }
        entryId = insertedEntry.id;
        logStep("Guest added", { entryId, entryType: resolvedEntryType, holderType: part.holder_type, linkedUserId });
      }

      // Crédit boisson (mode credits) — seulement pour un invité avec compte et un
      // club où le consommer.
      const creditVenueId = event.venue_id ?? part.venue_id ?? null;
      if (resolvedEntryType === "drink" && linkedUserId && creditVenueId) {
        const expiresAt = new Date(new Date(event.start_at).getTime() + 24 * 60 * 60 * 1000).toISOString();
        await admin
          .from("order_pack_credits")
          .upsert({
            user_id: linkedUserId,
            venue_id: creditVenueId,
            event_id: event.id,
            pack_id: `gl-drink-${entryId}`,
            total_credits: 1,
            used_credits: 0,
            expires_at: expiresAt,
          }, { onConflict: "user_id,pack_id" });
        logStep("Drink credits created", { userId: linkedUserId });
      }

      // Email d'invitation (QR + code) — même gabarit que promoter-add-guest.
      if (normalizedEmail) {
        try {
          const invitedBy = await resolveGuestListHolderName(admin, part, venueName);
          const place = await resolveGuestListPlace(admin, event);
          const { day, month, time } = fmtDateParts(event.start_at, recipientLang, event.timezone || "Europe/Paris");
          const built = buildGuestListConfirmation({
            lang: recipientLang,
            firstName: normalizedName.trim().split(" ")[0] || undefined,
            eventTitle: event.title || "Événement",
            venueName,
            posterUrl: event.poster_url || undefined,
            day, month, openTime: time,
            city: place.city || undefined,
            address: place.address || undefined,
            guestName: normalizedName.trim(),
            entryLabel: entryTypeLabel(resolvedEntryType, recipientLang),
            invitedBy,
            reference: reservationCode,
            freeBefore: part.free_before_time ? String(part.free_before_time).slice(0, 5) : undefined,
            qrDataUrl: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrCode)}`,
            ctaUrl: linkedUserId ? `${APP_URL}/my-orders` : `${APP_URL}/auth?redirect=/my-orders`,
            hasAccount: !!linkedUserId,
          });
          await sendResendEmail(normalizedEmail, built.subject, built.html);
          logStep("Invitation email sent", { to: normalizedEmail, hasAccount: !!linkedUserId });
        } catch (emailErr) {
          console.error("Email sending failed (non-blocking):", emailErr);
        }
      }

      // Push « tu es sur la guest list » — compte Yuno + première inscription.
      if (linkedUserId && !wasUpdated) {
        try {
          await sendAutoPush(admin, {
            key: "guest_list_added",
            userId: linkedUserId,
            url: "/my-orders",
            vars: { event: event.title || { fr: "Événement", en: "Event", es: "Evento" } },
          });
        } catch (pushErr) {
          console.error("Guest list push failed (non-blocking):", pushErr);
        }
      }

      return new Response(
        JSON.stringify({ success: true, entryId, updated: wasUpdated, reservationCode }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // ────────────────────────────────────────────────────────────────────
    // send_invite_email — envoie le lien unique personnel à son destinataire.
    // ────────────────────────────────────────────────────────────────────
    if (action === "send_invite_email") {
      const { inviteId } = body;
      if (!inviteId) throw new Error("Missing required field: inviteId");

      const { data: invite } = await admin
        .from("guest_list_invites")
        .select("id, guest_list_id, token, entry_type, max_uses, guest_name, guest_email, revoked_at")
        .eq("id", inviteId)
        .maybeSingle();
      if (!invite) throw new Error("Invite not found");
      if (invite.revoked_at) throw new Error("Invite has been revoked");
      if (!invite.guest_email) throw new Error("This invite has no email address");

      const { data: canManage } = await admin.rpc("can_manage_guest_list_part", {
        _user_id: user.id,
        _guest_list_id: invite.guest_list_id,
      });
      if (canManage !== true) throw new Error("Unauthorized: you don't manage this guest list");

      const { part, event, venueName } = await loadPartAndEvent(admin, invite.guest_list_id);
      if (event.end_at && new Date(event.end_at) < new Date()) {
        throw new Error("Event has ended");
      }

      // Slug cosmétique (la page résout par ?invite=). Organizer-only → user id.
      const slug = (event.venue_id || event.partner_venue_id)
        ? slugify(venueName)
        : (part.organizer_user_id || "organizer");
      const inviteUrl = `${APP_URL}/club/${slug}/event/${event.id}/guestlist?invite=${invite.token}`;

      // Langue du destinataire : préférence de son compte Yuno si l'email en a un,
      // sinon anglais par défaut (l'app est anglaise par défaut).
      let inviteLang: EmailLanguage = "en";
      {
        const { data: inviteeProfile } = await admin
          .from("profiles")
          .select("preferred_language")
          .eq("email", invite.guest_email.trim().toLowerCase())
          .maybeSingle();
        if (inviteeProfile?.preferred_language && ["en", "es", "fr"].includes(inviteeProfile.preferred_language)) {
          inviteLang = inviteeProfile.preferred_language as EmailLanguage;
        }
      }

      const invitedBy = await resolveGuestListHolderName(admin, part, venueName);
      const place = await resolveGuestListPlace(admin, event);
      const parts = fmtDateParts(event.start_at, inviteLang, event.timezone || "Europe/Paris");
      const built = buildGuestListInvite({
        lang: inviteLang,
        eventTitle: event.title || "Événement",
        venueName,
        posterUrl: event.poster_url || undefined,
        day: parts.day, month: parts.month, openTime: parts.time,
        city: place.city || undefined,
        entryLabel: entryTypeLabel(invite.entry_type, inviteLang),
        invitedBy,
        maxUses: invite.max_uses,
        inviteUrl,
      });
      const sent = await sendResendEmail(invite.guest_email, built.subject, built.html);
      if (sent) {
        await admin.from("guest_list_invites").update({ email_sent_at: new Date().toISOString() }).eq("id", invite.id);
      }
      logStep("Invite email sent", { to: invite.guest_email, inviteId: invite.id, sent });

      return new Response(
        JSON.stringify({ success: true, sent }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (error: unknown) {
    console.error("Error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }
});
