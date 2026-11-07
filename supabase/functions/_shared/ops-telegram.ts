// Les messages des outils locaux de Paul vers son Telegram (Yuno Studio : choix de la semaine,
// contenu prêt). File ops_telegram_outbox (migration 20261202100000), remplie par
// ops_telegram_notify ; même bot et même chat que les alertes d'inscription pro. Ne lève jamais.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { telegramChat, telegramSend, telegramToken } from './telegram-ops.ts';
import type { TelegramButton } from './pro-signup-telegram.ts';

type OutboxRow = { id: string; text: string; buttons: unknown };

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

export async function dispatchOpsTelegram(admin: SupabaseClient): Promise<{ sent: number; failed: number; status: string }> {
  const out = { sent: 0, failed: 0, status: 'empty' };
  try {
    const { data } = await admin.rpc('claim_ops_telegram', { p_limit: 10 });
    const rows = (data ?? []) as OutboxRow[];
    if (!rows.length) return out;
    const token = telegramToken();
    const chat = token ? await telegramChat(admin, token) : { chatId: null, status: 'no_token' };
    out.status = chat.status;
    for (const r of rows) {
      if (!token || !chat.chatId) {
        await admin.rpc('finish_ops_telegram', { p_id: r.id, p_ok: false, p_error: token ? 'no_chat' : 'no_token' });
        out.failed++; continue;
      }
      const res = await telegramSend(token, chat.chatId, { text: r.text, buttons: cleanButtons(r.buttons) });
      await admin.rpc('finish_ops_telegram', { p_id: r.id, p_ok: res.ok, p_error: res.error });
      if (res.ok) out.sent++; else out.failed++;
    }
  } catch (e) {
    console.error('[OPS-TELEGRAM]', String(e));
    out.status = 'error';
  }
  return out;
}
