// Espace invité : l'envoi des e-mails de notifications de l'invité, drainé par
// `process-scheduled-campaigns`. La base met en file et écarte la démo
// (`claim_guest_pass_notification_emails`) ; le rendu vit dans
// `guest-pass-notify-email.ts` (pur, testé).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { buildGuestNotifEmail, type GuestNotifEmailRow } from "./guest-pass-notify-email.ts";

/** Draine la file : réclame, envoie par Resend, marque envoyé ou à réessayer. */
export async function dispatchGuestPassNotificationEmails(admin: SupabaseClient): Promise<{ sent: number; failed: number }> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return { sent: 0, failed: 0 };
  const { data, error } = await admin.rpc("claim_guest_pass_notification_emails", { p_limit: 40 });
  if (error || !Array.isArray(data) || data.length === 0) return { sent: 0, failed: 0 };
  const rawFrom = Deno.env.get("RESEND_FROM_EMAIL");
  const from = rawFrom ? (rawFrom.includes("<") ? rawFrom : `Yuno <${rawFrom}>`) : "Yuno <noreply@yunoapp.eu>";
  const sent: string[] = [];
  const failed: string[] = [];
  for (const r of data as GuestNotifEmailRow[]) {
    const mail = buildGuestNotifEmail(r);
    if (!mail) { sent.push(r.id); continue; }
    try {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "Idempotency-Key": `guest-notif-${r.id}` },
        body: JSON.stringify({ from, to: [r.email], subject: mail.subject, html: mail.html }),
      });
      if (resp.ok) sent.push(r.id);
      else { failed.push(r.id); console.error("[GUEST-NOTIF] resend", resp.status, (await resp.text()).slice(0, 200)); }
    } catch (e) {
      failed.push(r.id);
      console.error("[GUEST-NOTIF] send failed", String(e));
    }
  }
  await admin.rpc("mark_guest_pass_notification_emails", { p_sent: sent, p_failed: failed });
  return { sent: sent.length, failed: failed.length };
}
