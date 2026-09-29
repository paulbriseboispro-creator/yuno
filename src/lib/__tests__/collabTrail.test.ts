import { describe, it, expect } from 'vitest';
import {
  collabToolHref, readCollabTrail, trailAppliesTo, collabEventHref, collabHubHref, sideOfPath,
} from '@/lib/collabTrail';

describe('fil d’Ariane de la collaboration', () => {
  it('l’adresse d’un outil garde sa propre requête et porte d’où l’on vient', () => {
    const href = collabToolHref('/owner/guest-list?event=e1', { eventId: 'e1', title: 'Goya', tool: 'guestlist' });
    const [path, q] = href.split('?');
    const p = new URLSearchParams(q);
    expect(path).toBe('/owner/guest-list');
    expect(p.get('event')).toBe('e1');
    expect(p.get('from')).toBe('collab');
    expect(p.get('ce')).toBe('e1');
    expect(p.get('cn')).toBe('Goya');
    expect(p.get('ct')).toBe('guestlist');
  });
  it('un titre avec des caractères spéciaux fait l’aller-retour', () => {
    const href = collabToolHref('/owner/ticketing', { eventId: 'e1', title: 'Nuit & Jour · 2/3', tool: 'ticketing' });
    const t = readCollabTrail('/owner/ticketing', `?${href.split('?')[1]}`);
    expect(t?.title).toBe('Nuit & Jour · 2/3');
  });
  it('lit le fil, ou rien si l’adresse ne vient pas de la collaboration', () => {
    expect(readCollabTrail('/owner/events', '?from=collab&ce=e1&cn=Goya&ct=design'))
      .toEqual({ eventId: 'e1', title: 'Goya', tool: 'design', toolPath: '/owner/events' });
    expect(readCollabTrail('/owner/events', '?edit=e1')).toBeNull();
    expect(readCollabTrail('/owner/events', '?from=collab&ce=e1&ct=inconnu')).toBeNull();
    expect(readCollabTrail('/owner/events', '?from=collab&ct=design')).toBeNull();
  });
  it('le fil ne suit que l’outil et ses sous-pages', () => {
    const t = { eventId: 'e1', title: 'Goya', tool: 'promoters' as const, toolPath: '/owner/promoters/event/e1' };
    expect(trailAppliesTo(t, '/owner/promoters/event/e1')).toBe(true);
    expect(trailAppliesTo(t, '/owner/promoters/event/e1/detail')).toBe(true);
    expect(trailAppliesTo(t, '/owner/dashboard')).toBe(false);
    expect(trailAppliesTo(null, '/owner/dashboard')).toBe(false);
  });
  it('adresses de la collaboration, club et organisateur', () => {
    expect(collabEventHref('venue', 'e1')).toBe('/owner/collab/event/e1');
    expect(collabEventHref('organizer', 'e1', 'sales')).toBe('/organizer-app/events/e1/sales');
    expect(collabEventHref('venue', 'e1', 'partners')).toBe('/owner/collab/event/e1/partners');
    expect(collabHubHref('organizer')).toBe('/organizer-app/collaborations?tab=nights');
    expect(sideOfPath('/owner/ticketing')).toBe('venue');
    expect(sideOfPath('/organizer-app/ticketing')).toBe('organizer');
  });
});
