import { describe, expect, it } from 'vitest';
import { ASK_AI_MAX, aiAppFor, askAiUrl, pickConnection, type AiConnectionLite } from '../askAi';

const conn = (o: Partial<AiConnectionLite>): AiConnectionLite => ({ client_name: 'Claude', revoked_at: null, spaces: [{ key: 'org:1' }], ...o });

describe('« Préparer avec mon IA »', () => {
  it('reconnaît les applications web, pas les outils en ligne de commande', () => {
    expect(aiAppFor('Claude')).toBe('claude');
    expect(aiAppFor('claude.ai')).toBe('claude');
    expect(aiAppFor('ChatGPT')).toBe('chatgpt');
    expect(aiAppFor('OpenAI ChatGPT')).toBe('chatgpt');
    expect(aiAppFor('Claude Code')).toBeNull();
    expect(aiAppFor('Cursor')).toBeNull();
    expect(aiAppFor('Le Chat')).toBeNull();
    expect(aiAppFor(null)).toBeNull();
  });

  it('écrit la demande dans l’adresse, encodée et bornée', () => {
    expect(askAiUrl('claude', 'Plan & brouillons ?')).toBe('https://claude.ai/new?q=Plan%20%26%20brouillons%20%3F');
    expect(askAiUrl('chatgpt', 'a b')).toBe('https://chatgpt.com/?q=a%20b');
    const long = askAiUrl('claude', 'x'.repeat(5000));
    expect(long.length).toBe('https://claude.ai/new?q='.length + ASK_AI_MAX);
  });

  it('choisit une connexion active de l’espace, avec le droit demandé et une application web de préférence', () => {
    const list = [
      conn({ client_name: 'Claude Code', can_draft: true }),
      conn({ client_name: 'ChatGPT', can_draft: true }),
      conn({ client_name: 'Claude', can_draft: false }),
      conn({ client_name: 'Claude', revoked_at: '2026-10-01T00:00:00Z', can_draft: true }),
      conn({ client_name: 'Claude', spaces: [{ key: 'org:2' }], can_draft: true }),
      conn({ client_name: 'Claude', mine: false, can_draft: true, can_scenarios: true }),
    ];
    expect(pickConnection(list, 'org:1', 'drafts')).toEqual({ conn: list[1], right: true });
    expect(pickConnection(list, 'org:1', null).conn).toBe(list[1]);
    expect(pickConnection(list, 'org:1', 'scenarios')).toEqual({ conn: list[1], right: false });
    expect(pickConnection(list, 'org:9', null)).toEqual({ conn: null, right: false });
  });
});
