// Les messages des outils locaux de Paul vers son Telegram (Yuno Studio : choix de la semaine, designs à
// valider, contenu prêt), et ses réponses. File ops_telegram_outbox (migrations 20261202100000 et
// 110000), remplie par ops_telegram_notify ; même bot et même chat que les alertes d'inscription pro.
// Les réponses de Paul sont relevées par getUpdates (le bot n'a pas de webhook) et rangées dans
// ops_telegram_inbox, que le Studio lit. Ne lève jamais.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { telegramChat, telegramSend, telegramToken } from './telegram-ops.ts';
import type { TelegramButton } from './pro-signup-telegram.ts';

type OutboxRow = { id: string; text: string; buttons: unknown; media: unknown; created_at: string };
type Media = { url: string; caption?: string };

const API = 'https://api.telegram.org';
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function tg<T>(token: string, method: string, body: Record<string, unknown>): Promise<{ ok: boolean; result?: T; description?: string; retry?: number }> {
  try {
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
    });
    const j = await res.json().catch(() => ({ ok: false, description: `http_${res.status}` }));
    return { ...j, retry: j?.parameters?.retry_after };
  } catch (e) {
    return { ok: false, description: e instanceof Error ? e.message : 'error' };
  }
}

/** Boutons sûrs seulement : lignes de { text, url } en https. */
function cleanButtons(raw: unknown): TelegramButton[][] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => (Array.isArray(row) ? row : [row])
      .filter((b): b is TelegramButton => !!b && typeof b === 'object' && typeof (b as TelegramButton).text === 'string'
        && typeof (b as TelegramButton).url === 'string' && /^https:\/\//.test((b as TelegramButton).url))
      .map((b) => ({ text: b.text.slice(0, 60), url: b.url.slice(0, 500) })))
    .filter((row) => row.length)
    .slice(0, 4);
}

function cleanMedia(raw: unknown): Media[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m): m is Media => !!m && typeof m === 'object' && typeof (m as Media).url === 'string' && /^https:\/\//.test((m as Media).url))
    .slice(0, 40);
}

/** Albums de 10 photos au plus, la légende sur la première de chaque album. */
async function sendMedia(token: string, chatId: number, media: Media[]): Promise<string | null> {
  for (let i = 0; i < media.length; i += 10) {
    const chunk = media.slice(i, i + 10);
    const items = chunk.map((m, k) => ({ type: 'photo', media: m.url, ...(k === 0 && m.caption ? { caption: m.caption.slice(0, 1000), parse_mode: 'HTML' } : {}) }));
    let r = chunk.length === 1
      ? await tg(token, 'sendPhoto', { chat_id: chatId, photo: chunk[0].url, ...(chunk[0].caption ? { caption: chunk[0].caption.slice(0, 1000), parse_mode: 'HTML' } : {}) })
      : await tg(token, 'sendMediaGroup', { chat_id: chatId, media: items });
    if (!r.ok && r.retry && r.retry <= 20) {                // Telegram asks to slow down: wait once
      await pause(r.retry * 1000 + 300);
      r = chunk.length === 1 ? await tg(token, 'sendPhoto', { chat_id: chatId, photo: chunk[0].url })
        : await tg(token, 'sendMediaGroup', { chat_id: chatId, media: items });
    }
    if (!r.ok) return r.description ?? 'media_error';
    await pause(1100);                                     // ~1 message a second in a private chat
  }
  return null;
}

export async function dispatchOpsTelegram(admin: SupabaseClient, budgetMs = 100_000): Promise<{ sent: number; failed: number; status: string }> {
  const out = { sent: 0, failed: 0, status: 'empty' };
  const t0 = Date.now();
  try {
    const { data } = await admin.rpc('claim_ops_telegram', { p_limit: 20 });
    // UPDATE … RETURNING gives no order: sent in the order they were written (albums, then the question)
    const rows = ((data ?? []) as OutboxRow[]).sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (!rows.length) return out;
    const token = telegramToken();
    const chat = token ? await telegramChat(admin, token) : { chatId: null, status: 'no_token' };
    out.status = chat.status;
    for (const r of rows) {
      if (!token || !chat.chatId) {
        await admin.rpc('finish_ops_telegram', { p_id: r.id, p_ok: false, p_error: token ? 'no_chat' : 'no_token' });
        out.failed++; continue;
      }
      if (Date.now() - t0 > budgetMs) {                    // left for the next run (claimed rows are taken again after 5 min)
        await admin.rpc('finish_ops_telegram', { p_id: r.id, p_ok: false, p_error: 'budget' });
        continue;
      }
      const mediaErr = await sendMedia(token, chat.chatId, cleanMedia(r.media));
      if (mediaErr) {
        await admin.rpc('finish_ops_telegram', { p_id: r.id, p_ok: false, p_error: mediaErr });
        out.failed++; continue;
      }
      const res = await telegramSend(token, chat.chatId, { text: r.text, buttons: cleanButtons(r.buttons) });
      await admin.rpc('finish_ops_telegram', { p_id: r.id, p_ok: res.ok, p_error: res.error });
      if (res.ok) out.sent++; else out.failed++;
      await pause(600);
    }
  } catch (e) {
    console.error('[OPS-TELEGRAM]', String(e));
    out.status = 'error';
  }
  return out;
}

type Update = { update_id: number; message?: { message_id: number; date: number; text?: string; caption?: string; chat: { id: number; type: string }; reply_to_message?: { message_id: number } } };

/** The secret Telegram puts in the X-Telegram-Bot-Api-Secret-Token header of each webhook call:
 *  derived from the bot token, so there is no extra secret to keep. */
export async function opsWebhookSecret(): Promise<string> {
  const token = telegramToken();
  if (!token) return '';
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`yuno-ops-webhook:${token}`));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 48);
}

/** Telegram calls us the moment Paul writes to the bot (webhook, no polling): his message goes to
 *  ops_telegram_inbox, read by the Studio, and he gets an acknowledgement. */
export async function handleOpsTelegramWebhook(admin: SupabaseClient, u: Update): Promise<string> {
  try {
    const token = telegramToken();
    const m = u.message;
    if (!token || !m || m.chat.type !== 'private') return 'ignored';
    let { data: chatId } = await admin.rpc('ops_telegram_chat_get');
    if (!chatId && /^\/start/.test(m.text ?? '')) {                 // first /start links the chat (as getUpdates did)
      await admin.rpc('ops_telegram_chat_link', { p_chat_id: m.chat.id, p_username: null, p_first_name: null });
      ({ data: chatId } = await admin.rpc('ops_telegram_chat_get'));
    }
    if (!chatId || Number(chatId) !== Number(m.chat.id)) return 'other_chat';
    const text = m.text ?? m.caption ?? '';
    if (!text || /^\/start/.test(text)) return 'skip';
    await admin.rpc('ops_telegram_inbox_save', {
      p_rows: [{ update_id: u.update_id, chat_id: m.chat.id, message_id: m.message_id, reply_to: m.reply_to_message?.message_id ?? '', text, date: m.date }],
      p_last_update_id: u.update_id,
    });
    // acknowledged only while a week waits for Paul's validation (designs sent in the last 48 h)
    const { data: waiting } = await admin.from('ops_telegram_outbox').select('id').like('dedup_key', 'studio:review:%')
      .gte('created_at', new Date(Date.now() - 48 * 3600_000).toISOString()).limit(1);
    if (waiting?.length) await telegramSend(token, Number(chatId), { text: '📥 Reçu. Le Studio s’en occupe dans la demi-heure et te renvoie la suite ici.', buttons: [] });
    await admin.rpc('ops_telegram_purge');
    return 'saved';
  } catch (e) {
    console.error('[OPS-TELEGRAM-WEBHOOK]', String(e));
    return 'error';
  }
}

/** One-off (cron secret or super admin): point the bot's webhook at process-scheduled-campaigns. */
export async function setOpsTelegramWebhook(functionUrl: string): Promise<unknown> {
  const token = telegramToken();
  if (!token) return { ok: false, description: 'no_token' };
  return await tg(token, 'setWebhook', { url: functionUrl, secret_token: await opsWebhookSecret(), allowed_updates: ['message'], drop_pending_updates: false });
}
