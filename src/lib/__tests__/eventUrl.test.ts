import { describe, expect, it } from 'vitest';
import { eventPath, eventPathFromHost } from '../eventUrl';

const ID = '5f6d0d0e-1a2b-4c3d-9e8f-000000000001';

// Bug vécu : l'Email Studio construisait `/event/${slug || id}`. Sur une
// soirée qui a un slug, le clic depuis l'email tombait sur « Événement
// introuvable » — la route par UUID n'a jamais su lire un slug.
describe('eventPathFromHost — la route UUID n’accepte pas un slug', () => {
  it('host + slug → URL propre', () => {
    expect(eventPathFromHost(ID, 'woh-face-to-face-edition', 'la-nuit'))
      .toBe('/events/la-nuit/woh-face-to-face-edition');
  });

  it('sans host, on retombe sur l’ID — jamais sur le slug', () => {
    expect(eventPathFromHost(ID, 'woh-face-to-face-edition', null)).toBe(`/event/${ID}`);
    expect(eventPathFromHost(ID, 'woh-face-to-face-edition', '')).toBe(`/event/${ID}`);
  });

  it('sans slug non plus', () => {
    expect(eventPathFromHost(ID, null, 'la-nuit')).toBe(`/event/${ID}`);
    expect(eventPathFromHost(ID, undefined, undefined)).toBe(`/event/${ID}`);
  });
});

describe('eventPath — le host suit le porteur de la soirée', () => {
  it('soirée de club : host = slug du club', () => {
    expect(eventPath({ id: ID, slug: 'techno-rise', venueSlug: 'le-silo' }))
      .toBe('/events/le-silo/techno-rise');
  });

  it('soirée organizer-led : host = slug de l’orga', () => {
    expect(eventPath({
      id: ID, slug: 'techno-rise', isOrganizerLed: true,
      organizerSlug: 'womber', venueSlug: 'le-silo',
    })).toBe('/events/womber/techno-rise');
  });

  it('données incomplètes : repli sur une route par UUID, jamais par slug', () => {
    expect(eventPath({ id: ID, slug: 'techno-rise' })).toBe(`/event/${ID}`);
    expect(eventPath({ id: ID, venueSlug: 'le-silo' })).toBe(`/club/le-silo/event/${ID}`);
    expect(eventPath({ id: ID })).toBe(`/event/${ID}`);
  });
});
