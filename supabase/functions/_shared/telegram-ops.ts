// Le bot Telegram des alertes de Paul (inscriptions pro, migration 20261104200000).
//
// Le jeton est le secret TELEGRAM_BOT_TOKEN, posé par Paul ; il ne sort
// jamais d'ici. Le chat se lie seul : tant qu'aucun n'est retenu, on lit les
// derniers messages du bot (getUpdates) et le premier chat PRIVÉ qui a envoyé
// /start est gardé (ops_telegram_chat, jamais réécrit). Ne lève jamais.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import type { TelegramMessage } from './pro-signup-telegram.ts';

const API = 'https://api.telegram.org';

export function telegramToken(): string {
  return Deno.env.get('TELEGRAM_BOT_TOKEN')?.trim() ?? '';
}

type TgResult<T> = { ok: boolean; result?: T; description?: string };

async function call<T>(token: string, method: string, body?: Record<string, unknown>): Promise<TgResult<T>> {
  try {
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(15_000),
    });
    return (await res.json().catch(() => ({ ok: false, description: `http_${res.status}` }))) as TgResult<T>;
  } catch (e) {
    return { ok: false, description: e instanceof Error ? e.message : 'error' };
  }
}

/** Le chat de Paul : celui qui est retenu, sinon le premier /start privé trouvé. */
export async function telegramChat(
  admin: SupabaseClient,
  token: string,
): Promise<{ chatId: number | null; justLinked: boolean; status: string }> {
  const { data } = await admin.rpc('ops_telegram_chat_get');
  if (typeof data === 'number' || (typeof data === 'string' && data)) return { chatId: Number(data), justLinked: false, status: 'linked' };

  type Update = { message?: { text?: string; chat?: { id: number; type: string; username?: string; first_name?: string } } };
  const r = await call<Update[]>(token, 'getUpdates', { allowed_updates: ['message'], limit: 100 });
  if (!r.ok || !Array.isArray(r.result)) return { chatId: null, justLinked: false, status: `getUpdates: ${r.description ?? 'error'}` };
  const start = r.result
    .map((u) => u.message)
    .find((m) => m?.chat?.type === 'private' && typeof m.text === 'string' && m.text.trim().startsWith('/start'));
  if (!start?.chat) return { chatId: null, justLinked: false, status: `no_start_in_${r.result.length}_updates` };
  const { data: linked } = await admin.rpc('ops_telegram_chat_link', {
    p_chat_id: start.chat.id,
    p_username: start.chat.username ?? null,
    p_first_name: start.chat.first_name ?? null,
  });
  if (linked !== true) {
    const { data: again } = await admin.rpc('ops_telegram_chat_get');
    return { chatId: again ? Number(again) : null, justLinked: false, status: 'linked_elsewhere' };
  }
  await call(token, 'sendMessage', {
    chat_id: start.chat.id,
    parse_mode: 'HTML',
    text: '✅ <b>C’est branché.</b>\nChaque pro qui s’inscrit sur Yuno sans ton invitation arrivera ici : sa fiche tout de suite, puis ce que le web dit de sa structure.',
  });
  return { chatId: start.chat.id, justLinked: true, status: 'just_linked' };
}

export async function telegramSend(
  token: string,
  chatId: number,
  msg: TelegramMessage,
  replyTo?: number | null,
): Promise<{ ok: boolean; messageId: number | null; error: string | null }> {
  const r = await call<{ message_id: number }>(token, 'sendMessage', {
    chat_id: chatId,
    text: msg.text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...(msg.buttons.length ? { reply_markup: { inline_keyboard: msg.buttons } } : {}),
    ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
  });
  return { ok: r.ok, messageId: r.result?.message_id ?? null, error: r.ok ? null : (r.description ?? 'error').slice(0, 300) };
}
