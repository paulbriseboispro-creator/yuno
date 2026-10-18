import { describe, expect, it } from 'vitest';
import {
  listUnsubscribeHeaders,
  oneClickUnsubscribeUrl,
  unsubscribePageUrl,
  unsubscribeRequestKind,
} from '../../../supabase/functions/_shared/one-click-unsubscribe';

// Audit du 18/10 (MAIL-01) : le bouton « Se désabonner » de Gmail / Yahoo envoie
// un POST à l'adresse de l'en-tête. Elle pointait sur une page de l'app, qui ne
// traite aucun POST : le désabonnement n'avait jamais lieu.
const SUPA = 'https://fulawxvdlwtdlpkycixe.supabase.co';
const TOKEN = '6f1c0b9e-3d7a-4f2b-9a51-0c2d4e6f8a10';

describe('désabonnement en un clic (RFC 8058)', () => {
  it("l'en-tête pointe sur la fonction qui traite le POST, jamais sur la page de l'app", () => {
    const h = listUnsubscribeHeaders(SUPA, TOKEN, 'c-1');
    expect(h['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    const url = new URL(h['List-Unsubscribe'].replace(/^<|>$/g, ''));
    expect(url.protocol).toBe('https:');
    expect(url.host).toBe('fulawxvdlwtdlpkycixe.supabase.co');
    expect(url.pathname).toBe('/functions/v1/unsubscribe-newsletter');
    expect(url.searchParams.get('token')).toBe(TOKEN);
    expect(url.searchParams.get('c')).toBe('c-1');
    expect(h['List-Unsubscribe']).not.toContain('yunoapp.eu/unsubscribe');
  });

  it('sans jeton, aucun en-tête (un e-mail sans abonnement ne promet pas de désabonnement)', () => {
    expect(listUnsubscribeHeaders(SUPA, null)).toEqual({});
    expect(listUnsubscribeHeaders(SUPA, undefined)).toEqual({});
  });

  it("une barre finale dans l'URL du projet ne double pas le chemin", () => {
    expect(oneClickUnsubscribeUrl(`${SUPA}/`, TOKEN)).toBe(`${SUPA}/functions/v1/unsubscribe-newsletter?token=${TOKEN}`);
  });

  it('POST de la messagerie = désabonner ; GET sans action = page du site ; actions explicites gardées', () => {
    expect(unsubscribeRequestKind('POST', null)).toBe('unsubscribe');
    expect(unsubscribeRequestKind('GET', null)).toBe('redirect');
    expect(unsubscribeRequestKind('POST', 'preview')).toBe('preview');   // la page du site lit l'aperçu en POST
    expect(unsubscribeRequestKind('POST', 'unsubscribe')).toBe('unsubscribe');
    expect(unsubscribeRequestKind('GET', 'preview')).toBe('preview');
    expect(unsubscribeRequestKind('GET', 'n_importe_quoi')).toBe('redirect');
  });

  it('la page humaine garde le jeton', () => {
    expect(unsubscribePageUrl('https://yunoapp.eu/', TOKEN)).toBe(`https://yunoapp.eu/unsubscribe?token=${TOKEN}`);
  });
});
