import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CONNECT_COUNTRY,
  OTHER_CONNECT_COUNTRY,
  STRIPE_CONNECT_COUNTRIES,
  connectCountryName,
  connectCountryOptions,
  countryCodeFromText,
  isSupportedConnectCountry,
  suggestConnectCountry,
} from '../stripeConnectCountry';
import {
  DEFAULT_CONNECT_COUNTRY as SERVER_DEFAULT,
  STRIPE_CONNECT_COUNTRIES as SERVER_COUNTRIES,
} from '../../../supabase/functions/_shared/stripe-connect-accounts.ts';

// Le pays d'un compte Stripe ne change plus après sa création : la Console le
// fait choisir avant « Activer les paiements ». Pros réels visés : Amoris et
// Goya (Madrid), ECLIPX'S EVENTS (Vilanova i la Geltrú), Babouchka (Marrakech,
// pays que Stripe ne prend pas en charge).

describe('liste des pays', () => {
  it('miroir exact du serveur (qui revérifie)', () => {
    expect([...STRIPE_CONNECT_COUNTRIES].sort()).toEqual([...SERVER_COUNTRIES]);
    expect(DEFAULT_CONNECT_COUNTRY).toBe(SERVER_DEFAULT);
  });

  it('Espagne oui, Maroc non, « Autre pays » non', () => {
    expect(isSupportedConnectCountry('ES')).toBe(true);
    expect(isSupportedConnectCountry('es')).toBe(true);
    expect(isSupportedConnectCountry('MA')).toBe(false);
    expect(isSupportedConnectCountry(OTHER_CONNECT_COUNTRY)).toBe(false);
    expect(isSupportedConnectCountry(null)).toBe(false);
  });
});

describe('countryCodeFromText', () => {
  it('codes, noms FR / EN / ES', () => {
    expect(countryCodeFromText('es')).toBe('ES');
    expect(countryCodeFromText('España')).toBe('ES');
    expect(countryCodeFromText(' Spain ')).toBe('ES');
    expect(countryCodeFromText('Espagne')).toBe('ES');
    expect(countryCodeFromText('Maroc')).toBe('MA');
    expect(countryCodeFromText('Estonie')).toBe('EE');
    expect(countryCodeFromText('Atlantide')).toBeNull();
    expect(countryCodeFromText('')).toBeNull();
  });
});

describe('suggestConnectCountry', () => {
  it('le pays déclaré par le DJ passe devant tout', () => {
    expect(suggestConnectCountry({ countryText: 'España', deviceTimezone: 'Europe/Paris' }))
      .toEqual({ code: 'ES', source: 'profile' });
  });

  it('Madrid : la ville suffit', () => {
    expect(suggestConnectCountry({ city: 'Madrid', timezone: 'Europe/Madrid' })).toEqual({ code: 'ES', source: 'place' });
  });

  it('Vilanova i la Geltrú : ville inconnue, fuseau Paris posé par défaut, l’adresse Mapbox donne le pays', () => {
    expect(suggestConnectCountry({
      city: 'Vilanova i la Geltrú',
      addresses: ['Carrer de la Unió 12, 08800 Vilanova i la Geltrú, Barcelona, Spain'],
      timezone: 'Europe/Paris',
      deviceTimezone: 'Europe/Paris',
    })).toEqual({ code: 'ES', source: 'place' });
  });

  it('Marrakech : le Maroc est proposé tel quel (l’écran explique qu’il n’est pas pris en charge)', () => {
    const s = suggestConnectCountry({ city: 'Marrakech', timezone: 'Africa/Casablanca' });
    expect(s).toEqual({ code: 'MA', source: 'place' });
    expect(isSupportedConnectCountry(s.code)).toBe(false);
  });

  it('ville inconnue et fuseau Paris par défaut : le fuseau de l’appareil tranche', () => {
    expect(suggestConnectCountry({ city: 'Sitges', timezone: 'Europe/Paris', deviceTimezone: 'Europe/Madrid' }))
      .toEqual({ code: 'ES', source: 'device' });
    expect(suggestConnectCountry({ city: 'Sitges', timezone: 'Europe/Paris' })).toEqual({ code: 'FR', source: 'place' });
  });

  it('rien du tout : la France, comme avant', () => {
    expect(suggestConnectCountry({})).toEqual({ code: 'FR', source: 'default' });
  });
});

describe('sélecteur', () => {
  it('pays pris en charge triés par nom ; un pays non pris en charge courant reste visible en tête', () => {
    const fr = connectCountryOptions('fr');
    expect(fr.every((o) => o.supported)).toBe(true);
    expect(fr.map((o) => o.name)).toEqual([...fr.map((o) => o.name)].sort((a, b) => a.localeCompare(b, 'fr')));
    const withMorocco = connectCountryOptions('fr', 'MA');
    expect(withMorocco[0]).toEqual({ code: 'MA', name: 'Maroc', supported: false });
    expect(connectCountryOptions('fr', OTHER_CONNECT_COUNTRY)).toHaveLength(STRIPE_CONNECT_COUNTRIES.length);
  });

  it('noms dans la langue de la Console', () => {
    expect(connectCountryName('ES', 'fr')).toBe('Espagne');
    expect(connectCountryName('ES', 'es')).toBe('España');
    expect(connectCountryName('ES', 'en')).toBe('Spain');
  });
});
