import { describe, expect, it } from 'vitest';
import { isLikelyBot } from '@/lib/botUserAgent';

describe('isLikelyBot', () => {
  it('écarte les robots d’aperçu et d’indexation', () => {
    for (const ua of [
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'WhatsApp/2.23.20.0',
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'TelegramBot (like TwitterBot)',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36',
      '',
    ]) expect(isLikelyBot(ua)).toBe(true);
  });
  it('garde les vrais navigateurs, app Instagram comprise', () => {
    for (const ua of [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.40.92',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
    ]) expect(isLikelyBot(ua)).toBe(false);
  });
});
