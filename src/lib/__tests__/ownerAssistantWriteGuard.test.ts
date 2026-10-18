import { describe, expect, it } from 'vitest';
import {
  WRITE_TOOLS,
  checkWriteConfirmation,
  withConfirmationParam,
} from '../../../supabase/functions/owner-assistant/write-confirmation.ts';

const tool = (name: string, required?: string[]) => ({
  type: 'function',
  function: {
    name,
    description: name,
    parameters: { type: 'object', properties: { event_id: { type: 'string' } }, ...(required ? { required } : {}) },
  },
});

describe('withConfirmationParam', () => {
  it('ajoute confirmed, requis, aux seuls outils d’écriture', () => {
    const [write, read, bare] = withConfirmationParam([
      tool('toggle_guest_list', ['event_id']),
      tool('list_events', ['event_id']),
      tool('set_night_brief'),
    ]);
    expect(write.function.parameters.properties).toHaveProperty('confirmed');
    expect(write.function.parameters.required).toEqual(['event_id', 'confirmed']);
    expect(read.function.parameters.properties).not.toHaveProperty('confirmed');
    expect(read.function.parameters.required).toEqual(['event_id']);
    expect(bare.function.parameters.required).toEqual(['confirmed']);
  });

  it('couvre les dix outils d’écriture', () => {
    expect(WRITE_TOOLS.size).toBe(10);
  });
});

describe('checkWriteConfirmation', () => {
  it('refuse un outil d’écriture sans confirmed: true', () => {
    for (const confirmed of [undefined, false, 'true', 1]) {
      const r = checkWriteConfirmation('update_event', { event_id: 'e', confirmed });
      expect(r.ok).toBe(false);
      if ('payload' in r) expect(r.payload.error).toBe('confirmation_required');
    }
  });

  it('laisse partir un outil confirmé, sans le paramètre confirmed', () => {
    const r = checkWriteConfirmation('update_event', { event_id: 'e', confirmed: true });
    expect(r).toEqual({ ok: true, args: { event_id: 'e' } });
  });

  it('ne touche pas un outil de lecture', () => {
    expect(checkWriteConfirmation('list_events', { filter: 'upcoming' })).toEqual({ ok: true, args: { filter: 'upcoming' } });
  });
});
