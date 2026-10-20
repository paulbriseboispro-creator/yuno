import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_CONNECT_COUNTRY,
  STRIPE_CONNECT_COUNTRIES,
  STRIPE_V1_API_VERSION,
  STRIPE_V2_API_VERSION,
  StripeHttpError,
  UnsupportedConnectCountryError,
  connectCurrencyFor,
  connectLocaleFor,
  connectStatusOf,
  createConnectedAccount,
  createOnboardingLink,
  dashboardUrlFor,
  STRIPE_FULL_DASHBOARD_URL,
  createSessionWithPaymentMethodFallback,
  formEncode,
  healChargesEnabled,
  isDefinitiveRejection,
  normalizeConnectCountry,
  organizerConnectColumns,
  readConnectAccountState,
  stateFromV1Account,
  stateFromV2Account,
  v1ControllerAccountBody,
  v2AccountBody,
  type NewConnectedAccount,
} from '../../../supabase/functions/_shared/stripe-connect-accounts.ts';
import { checkPayoutReadinessHealing } from '../../../supabase/functions/_shared/payout-readiness.ts';

// Comptes connectés Stripe. Le premier organisateur réel est resté bloqué sur
// « Use Accounts v2, remove `type`, and set `losses_collector` to `stripe` »
// (29/09) ; Poupée sur l'Express refusé et les jetons de compte qu'impose une
// plateforme française en v2 (19/10). Ces tests figent les corps envoyés à
// Stripe et l'enchaînement des filets, sans réseau.

interface Call { url: string; method: string; headers: Record<string, string>; body?: string }

/** Faux Stripe : chaque appel consomme la réponse suivante de la liste. */
function fakeStripe(responses: { status: number; body: unknown }[]) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body as string | undefined,
    });
    const next = responses.shift();
    if (!next) throw new Error('unexpected Stripe call');
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof fetch;
  return { calls, ctx: { secretKey: 'sk_test_x', fetchImpl } };
}

const refused = (message: string, status = 400) => ({ status, body: { error: { type: 'invalid_request_error', message } } });

/** Ce que les tests lisent des corps envoyés à Stripe. */
interface V2Body {
  dashboard: string;
  contact_email?: string;
  identity: Record<string, unknown>;
  configuration: {
    merchant?: { capabilities: { card_payments: unknown } };
    recipient?: { capabilities: { stripe_balance: { stripe_transfers: unknown } } };
  };
  defaults: { responsibilities: unknown; currency: string; locales: string[] };
}
interface V1Body {
  country: string;
  email?: string;
  controller: unknown;
  business_type?: string;
  capabilities?: unknown;
}
const asV2 = (b: Record<string, unknown>) => b as unknown as V2Body;
const asV1 = (b: Record<string, unknown>) => b as unknown as V1Body;

const organizer: NewConnectedAccount = {
  purpose: 'seller',
  country: 'FR',
  email: 'orga@example.com',
  displayName: 'Amoris',
  productDescription: 'Vente de billets pour événements',
  metadata: { user_id: 'u1', platform: 'yuno' },
};

describe('corps envoyés à Stripe', () => {
  it('v1 par controller (forme du compte live d’Amoris) : frais au vendeur, pertes à Stripe, tableau de bord complet', () => {
    const body = asV1(v1ControllerAccountBody({ ...organizer, entityType: 'company' }, { capabilities: true, prefill: true }));
    expect('type' in body).toBe(false);
    expect(body.controller).toEqual({
      fees: { payer: 'account' },
      losses: { payments: 'stripe' },
      requirement_collection: 'stripe',
      stripe_dashboard: { type: 'full' },
    });
    expect(body.business_type).toBe('company');
    expect(body.email).toBe('orga@example.com');
    expect(body.capabilities).toEqual({ card_payments: { requested: true }, transfers: { requested: true } });
  });

  it('v1 nu : ni capacités, ni type d’entité, ni e-mail — tout se saisit chez Stripe', () => {
    const bare = asV1(v1ControllerAccountBody({ ...organizer, entityType: 'company' }, { capabilities: false, prefill: false }));
    expect(bare.capabilities).toBeUndefined();
    expect(bare.business_type).toBeUndefined();
    expect(bare.email).toBeUndefined();
    expect((bare.controller as { stripe_dashboard: unknown }).stripe_dashboard).toEqual({ type: 'full' });
  });

  it('jamais d’Express : Stripe le refuse quand il porte les pertes et collecte les frais', () => {
    expect(asV1(v1ControllerAccountBody(organizer, { capabilities: true, prefill: true })).controller).toMatchObject({ stripe_dashboard: { type: 'full' } });
    expect(asV2(v2AccountBody(organizer, ['merchant'], 'none')).dashboard).toBe('full');
    expect(asV2(v2AccountBody(organizer, ['merchant'], 'prefill')).dashboard).toBe('full');
  });

  it('v1 d’un DJ : la seule capacité de recevoir des cachets', () => {
    const dj = asV1(v1ControllerAccountBody({ ...organizer, purpose: 'payee' }, { capabilities: true, prefill: true }));
    expect(dj.capabilities).toEqual({ transfers: { requested: true } });
  });

  it('v2 sans identité (plateforme française sans jeton de compte) : le pays seul', () => {
    const asso = { ...organizer, entityType: 'non_profit' as const, registeredName: 'Asso Amoris' };
    const body = asV2(v2AccountBody(asso, ['merchant', 'recipient'], 'none'));
    expect(body.identity).toEqual({ country: 'fr' });
    expect(body.contact_email).toBeUndefined();
    expect('display_name' in body).toBe(false);
    expect((body.defaults as unknown as { profile: Record<string, unknown> }).profile).toEqual({ product_description: 'Vente de billets pour événements' });
    expect(body.defaults.responsibilities).toEqual({ fees_collector: 'stripe', losses_collector: 'stripe' });
    expect(body.configuration.merchant?.capabilities.card_payments).toEqual({ requested: true });
    expect(body.configuration.recipient?.capabilities.stripe_balance.stripe_transfers).toEqual({ requested: true });
    expect('type' in body).toBe(false);
  });

  it('v2 pré-rempli (pour une plateforme hors de France) : identité complète', () => {
    const asso = { ...organizer, entityType: 'non_profit' as const, registeredName: 'Asso Amoris' };
    const body = asV2(v2AccountBody(asso, ['merchant'], 'prefill'));
    expect(body.identity).toEqual({
      country: 'fr', entity_type: 'non_profit', business_details: { registered_name: 'Asso Amoris' },
    });
    expect(body.contact_email).toBe('orga@example.com');
    expect(body.configuration.recipient).toBeUndefined();
  });

  it('pays : un club de Madrid naît en Espagne, en euros, avec des emails Stripe en espagnol', () => {
    const madrid = { ...organizer, country: 'es', language: 'es' as const };
    const v2 = asV2(v2AccountBody(madrid, ['merchant', 'recipient'], 'none'));
    expect(v2.identity).toEqual({ country: 'es' });
    expect(v2.defaults.currency).toBe('eur');
    expect(v2.defaults.locales).toEqual(['es-ES']);
    const v1 = asV1(v1ControllerAccountBody(madrid, { capabilities: true, prefill: true }));
    expect(v1.country).toBe('ES');
  });

  it('pays hors zone euro : la devise par défaut du compte suit le pays', () => {
    expect(asV2(v2AccountBody({ ...organizer, country: 'GB' }, ['merchant'], 'none')).defaults).toMatchObject({ currency: 'gbp', locales: ['en-GB'] });
    expect(asV2(v2AccountBody({ ...organizer, country: 'CH', language: 'fr' }, ['merchant'], 'none')).defaults).toMatchObject({ currency: 'chf', locales: ['fr-FR'] });
    expect(connectCurrencyFor('dk')).toBe('dkk');
    expect(connectCurrencyFor('BG')).toBe('eur');
  });

  it('langue des emails Stripe : celle de la Console, sinon celle du pays', () => {
    expect(connectLocaleFor('en', 'FR')).toBe('en-GB');
    expect(connectLocaleFor(null, 'FR')).toBe('fr-FR');
    expect(connectLocaleFor(undefined, 'ES')).toBe('es-ES');
    expect(connectLocaleFor(null, 'IT')).toBe('en-GB');
  });

  it('encodage v1 : crochets, tableaux indexés, valeurs vides ignorées', () => {
    expect(formEncode({ a: { b: 'c', n: null }, l: ['x', 'y'], u: undefined })).toBe('a[b]=c&l[0]=x&l[1]=y');
  });
});

describe('pays pris en charge', () => {
  it('Europe de Stripe seulement ; Maroc, Algérie, États-Unis refusés', () => {
    expect(normalizeConnectCountry('es')).toBe('ES');
    expect(normalizeConnectCountry(' fr ')).toBe('FR');
    expect(normalizeConnectCountry('GB')).toBe('GB');
    for (const refusedCode of ['MA', 'DZ', 'TN', 'US', 'MC', 'ESP', '', 'F', null, undefined, 34]) {
      expect(normalizeConnectCountry(refusedCode)).toBeNull();
    }
    expect(DEFAULT_CONNECT_COUNTRY).toBe('FR');
    expect(STRIPE_CONNECT_COUNTRIES).toContain('FR');
    expect(STRIPE_CONNECT_COUNTRIES).toContain('ES');
    expect([...STRIPE_CONNECT_COUNTRIES]).toEqual([...STRIPE_CONNECT_COUNTRIES].sort());
  });
});

describe('createConnectedAccount', () => {
  it('pays non pris en charge : refus AVANT tout appel à Stripe (le pays ne se change plus ensuite)', async () => {
    const { calls, ctx } = fakeStripe([]);
    await expect(createConnectedAccount(ctx, { ...organizer, country: 'MA' })).rejects.toBeInstanceOf(UnsupportedConnectCountryError);
    expect(calls).toHaveLength(0);
  });

  it('le pays suit toutes les formes, jusqu’au filet v2', async () => {
    const { calls, ctx } = fakeStripe([
      refused('v1 refusé'),
      refused('v1 nu refusé'),
      { status: 200, body: { id: 'acct_v2' } },
    ]);
    await createConnectedAccount(ctx, { ...organizer, country: 'es' });
    expect(calls[0].body).toContain('country=ES');
    expect(calls[1].body).toContain('country=ES');
    expect(JSON.parse(calls[2].body!).identity.country).toBe('es');
  });

  it('crée en v1 par controller (forme d’Amoris) au premier essai, clé d’idempotence', async () => {
    const { calls, ctx } = fakeStripe([{ status: 200, body: { id: 'acct_v1', object: 'account' } }]);
    await expect(createConnectedAccount(ctx, organizer)).resolves.toEqual({ id: 'acct_v1', api: 'v1', shape: 'v1-controller' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.stripe.com/v1/accounts');
    expect(calls[0].headers['Stripe-Version']).toBe(STRIPE_V1_API_VERSION);
    expect(calls[0].headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(calls[0].headers['Idempotency-Key']).toMatch(/^yuno-connect-/);
    expect(calls[0].body).toContain('controller[losses][payments]=stripe');
    expect(calls[0].body).toContain('controller[fees][payer]=account');
    expect(calls[0].body).toContain('controller[stripe_dashboard][type]=full');
    expect(calls[0].body).not.toMatch(/(^|&)type=/);
    expect(calls[0].body).not.toContain('express');
  });

  it('Poupée (19/10) : v1 refusé, v2 SANS identité — rien de ce qu’une plateforme française doit passer par jeton', async () => {
    const { calls, ctx } = fakeStripe([
      refused('v1'), refused('v1 nu'),
      { status: 200, body: { id: 'acct_v2' } },
    ]);
    // Ce que Stripe refuse à une plateforme française en v2 sans jeton de compte :
    // « can only update certain identity information … via account tokens ».
    await expect(createConnectedAccount(ctx, organizer)).resolves.toEqual({ id: 'acct_v2', api: 'v2', shape: 'v2-identity-free' });
    const v2 = JSON.parse(calls[2].body!);
    expect(calls[2].url).toBe('https://api.stripe.com/v2/core/accounts');
    expect(calls[2].headers['Stripe-Version']).toBe(STRIPE_V2_API_VERSION);
    expect(v2.identity).toEqual({ country: 'fr' });
    expect(v2.contact_email).toBeUndefined();
    expect(v2.display_name).toBeUndefined();
    expect(v2.dashboard).toBe('full');
  });

  it('une panne serveur n’enchaîne JAMAIS (le compte a pu naître : pas de doublon)', async () => {
    const { calls, ctx } = fakeStripe([{ status: 500, body: { error: { message: 'boom' } } }]);
    await expect(createConnectedAccount(ctx, organizer)).rejects.toMatchObject({
      name: 'ConnectAccountCreateError',
      attempts: [{ shape: 'v1-controller', message: 'boom' }],
    });
    expect(calls).toHaveLength(1);
  });

  it('tout refusé : l’erreur porte le premier message Stripe et chaque tentative, jamais une forme Express', async () => {
    const { calls, ctx } = fakeStripe([refused('A'), refused('B'), refused('C'), refused('D')]);
    const err = await createConnectedAccount(ctx, organizer).catch((e) => e);
    expect(err.message).toBe('A');
    expect(err.attempts.map((a: { shape: string }) => a.shape)).toEqual(['v1-controller', 'v1-controller-bare', 'v2-identity-free', 'v2-identity-free-merchant-only']);
    for (const c of calls) expect(c.body).not.toContain('express');
  });

  it('un DJ (payee) ne demande que la réception de transferts, en v1 comme en v2', async () => {
    const { calls, ctx } = fakeStripe([refused('v1'), refused('v1 nu'), { status: 200, body: { id: 'acct_dj' } }]);
    await createConnectedAccount(ctx, { ...organizer, purpose: 'payee', entityType: 'individual' });
    expect(calls[0].body).toContain('capabilities[transfers][requested]=true');
    expect(calls[0].body).not.toContain('card_payments');
    const body = JSON.parse(calls[2].body!);
    expect(body.configuration.merchant).toBeUndefined();
    expect(body.configuration.recipient).toBeDefined();
    expect(calls).toHaveLength(3);
  });
});

describe('createOnboardingLink', () => {
  const urls = { refreshUrl: 'https://yunoapp.eu/r', returnUrl: 'https://yunoapp.eu/ok' };

  it('v2 : lien sur les configurations réellement portées par le compte', async () => {
    const { calls, ctx } = fakeStripe([
      { status: 200, body: { id: 'acct_1', applied_configurations: ['merchant', 'recipient', 'customer'] } },
      { status: 200, body: { url: 'https://connect.stripe.com/setup/x' } },
    ]);
    await expect(createOnboardingLink(ctx, 'acct_1', urls)).resolves.toBe('https://connect.stripe.com/setup/x');
    expect(JSON.parse(calls[1].body!)).toEqual({
      account: 'acct_1',
      use_case: {
        type: 'account_onboarding',
        account_onboarding: { configurations: ['merchant', 'recipient'], refresh_url: urls.refreshUrl, return_url: urls.returnUrl },
      },
    });
  });

  it('compte que v2 ne connaît pas : lien v1', async () => {
    const { calls, ctx } = fakeStripe([
      refused('not a v2 account', 404),
      { status: 200, body: { url: 'https://connect.stripe.com/setup/v1' } },
    ]);
    await expect(createOnboardingLink(ctx, 'acct_1', urls)).resolves.toBe('https://connect.stripe.com/setup/v1');
    expect(calls[1].url).toBe('https://api.stripe.com/v1/account_links');
    expect(calls[1].body).toContain('type=account_onboarding');
  });
});

describe('état du compte', () => {
  it('v1 : les drapeaux que la base a toujours miroités', async () => {
    const { ctx } = fakeStripe([{ status: 200, body: {
      charges_enabled: true, payouts_enabled: false, details_submitted: true,
      requirements: { currently_due: ['external_account'], past_due: [] },
      controller: { stripe_dashboard: { type: 'full' } },
    } }]);
    const s = await readConnectAccountState(ctx, 'acct_1');
    expect(s).toMatchObject({ chargesEnabled: true, payoutsEnabled: false, detailsSubmitted: true, hasRequirements: true, dashboard: 'full', source: 'v1' });
    expect(s.country).toBeNull();
    expect(stateFromV1Account({ country: 'es' }).country).toBe('ES');
    expect(stateFromV2Account({ identity: { country: 'gb' } }).country).toBe('GB');
    expect(connectStatusOf(s)).toBe('restricted');
  });

  it('v1 refusé : lecture v2 avec les includes, capacités → drapeaux', async () => {
    const { calls, ctx } = fakeStripe([
      refused('use v2'),
      { status: 200, body: {
        dashboard: 'full',
        configuration: {
          merchant: { capabilities: { card_payments: { status: 'active' }, stripe_balance: { payouts: { status: 'active' } } } },
        },
        requirements: { entries: [] },
      } },
    ]);
    const s = await readConnectAccountState(ctx, 'acct_1');
    expect(calls[1].url).toBe(
      'https://api.stripe.com/v2/core/accounts/acct_1?include[0]=configuration.merchant&include[1]=configuration.recipient&include[2]=requirements',
    );
    expect(s).toMatchObject({ chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, source: 'v2' });
    expect(connectStatusOf(s)).toBe('active');
  });

  it('v2 : une exigence à la charge du pro = formulaire à compléter', () => {
    const s = stateFromV2Account({
      configuration: { merchant: { capabilities: { card_payments: { status: 'pending' } } } },
      requirements: { entries: [
        { awaiting_action_from: 'user', description: 'IBAN', minimum_deadline: { status: 'currently_due' } },
        { awaiting_action_from: 'stripe', description: 'revue', minimum_deadline: { status: 'currently_due' } },
      ] },
    });
    expect(s).toMatchObject({ chargesEnabled: false, detailsSubmitted: false, hasRequirements: true });
    expect(s.requirements.currently_due).toEqual(['IBAN']);
    expect(connectStatusOf(s)).toBe('pending');
  });

  it('ancien compte Express (type sans controller) : tableau de bord express', () => {
    expect(stateFromV1Account({ type: 'express' }).dashboard).toBe('express');
  });

  it('colonnes organisateur : même règle que le webhook', () => {
    const now = new Date('2026-09-29T20:00:00Z');
    const active = stateFromV1Account({ charges_enabled: true, payouts_enabled: true });
    expect(organizerConnectColumns(active, { now })).toEqual({
      stripe_connect_status: 'active',
      stripe_connect_charges_enabled: true,
      stripe_connect_payouts_enabled: true,
      stripe_connect_onboarded_at: '2026-09-29T20:00:00.000Z',
    });
    // La première date d'activation est gardée ; un compte qui n'encaisse plus la perd.
    expect(organizerConnectColumns(active, { onboardedAt: '2026-09-01T10:00:00.000Z', now }).stripe_connect_onboarded_at)
      .toBe('2026-09-01T10:00:00.000Z');
    expect(organizerConnectColumns(stateFromV1Account({ charges_enabled: false }), { onboardedAt: '2026-09-01T10:00:00.000Z' }))
      .toMatchObject({ stripe_connect_status: 'pending', stripe_connect_onboarded_at: null });
  });
});

describe('healChargesEnabled — le miroir en retard ne refuse plus un acheteur', () => {
  it('déjà prêt, sans compte ou compte démo : aucun appel Stripe', async () => {
    const { calls, ctx } = fakeStripe([]);
    const persist = vi.fn();
    expect(await healChargesEnabled(ctx, 'acct_1', true, persist)).toBe(true);
    expect(await healChargesEnabled(ctx, null, false, persist)).toBe(false);
    expect(await healChargesEnabled(ctx, 'acct_demo_yuno', false, persist)).toBe(false);
    expect(calls).toHaveLength(0);
    expect(persist).not.toHaveBeenCalled();
  });

  it('Stripe dit « actif » : la base est réparée et la vente passe', async () => {
    const { ctx } = fakeStripe([{ status: 200, body: { charges_enabled: true, payouts_enabled: true, details_submitted: true } }]);
    const persist = vi.fn(async () => {});
    expect(await healChargesEnabled(ctx, 'acct_1', false, persist)).toBe(true);
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ chargesEnabled: true }));
  });

  it('Stripe injoignable : la porte reste fermée, sans lever', async () => {
    const { ctx } = fakeStripe([{ status: 503, body: {} }]);
    expect(await healChargesEnabled(ctx, 'acct_1', false, vi.fn())).toBe(false);
  });

  it('checkPayoutReadinessHealing : soirée d’organisateur seul, compte réparé → vente ouverte', async () => {
    const input = {
      itemType: 'ticket' as const,
      event: { id: 'ev', venue_id: null, organizer_user_id: 'org', partner_venue_id: null, partner_organizer_id: null, event_mode: 'solo_organizer', revenue_split_rules: null },
    };
    const acc = { venueStripeAccountId: null, venueChargesEnabled: false, organizerStripeAccountId: 'acct_org', organizerChargesEnabled: false };
    const heal = vi.fn(async () => true);
    const r = await checkPayoutReadinessHealing(input, acc, heal);
    expect(heal).toHaveBeenCalledWith('organizer', 'acct_org');
    expect('split' in r && r.split.primary.accountId).toBe('acct_org');
    await expect(checkPayoutReadinessHealing(input, acc, async () => false)).resolves.toEqual({ inactive: 'organizer' });
  });
});

describe('createSessionWithPaymentMethodFallback', () => {
  const linkRefused = Object.assign(new Error('The payment method type provided: link is invalid.'), {
    type: 'StripeInvalidRequestError', param: 'payment_method_types',
  });

  it('Link refusé sur le compte du pro : nouvelle session carte seule', async () => {
    const create = vi.fn()
      .mockRejectedValueOnce(linkRefused)
      .mockResolvedValueOnce({ id: 'cs_1' });
    await expect(createSessionWithPaymentMethodFallback(create, { payment_method_types: ['card', 'link'], mode: 'payment' })).resolves.toEqual({ id: 'cs_1' });
    expect(create).toHaveBeenLastCalledWith({ payment_method_types: ['card'], mode: 'payment' });
  });

  it('toute autre erreur remonte telle quelle', async () => {
    const other = Object.assign(new Error('No such account'), { type: 'StripeInvalidRequestError', param: 'account' });
    const create = vi.fn().mockRejectedValue(other);
    await expect(createSessionWithPaymentMethodFallback(create, { payment_method_types: ['card', 'link'] })).rejects.toBe(other);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('isDefinitiveRejection', () => {
  it('400/403/404 = rien créé ; réseau, 401, 429 et 5xx = on s’arrête', () => {
    expect(isDefinitiveRejection(new StripeHttpError('x', 400, 'v2'))).toBe(true);
    expect(isDefinitiveRejection(new StripeHttpError('x', 404, 'v1'))).toBe(true);
    expect(isDefinitiveRejection(new StripeHttpError('x', 429, 'v2'))).toBe(false);
    expect(isDefinitiveRejection(new StripeHttpError('x', 500, 'v2'))).toBe(false);
    expect(isDefinitiveRejection(new TypeError('fetch failed'))).toBe(false);
  });
});

describe('dashboardUrlFor', () => {
  const base = { country: 'FR', chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, hasRequirements: false, requirements: { currently_due: [], past_due: [] }, source: 'v2' as const };

  it('Express : lien de connexion à usage unique généré par Stripe', async () => {
    const { calls, ctx } = fakeStripe([{ status: 200, body: { url: 'https://connect.stripe.com/express/abc' } }]);
    await expect(dashboardUrlFor(ctx, 'acct_1', { ...base, dashboard: 'express' })).resolves.toBe('https://connect.stripe.com/express/abc');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('https://api.stripe.com/v1/accounts/acct_1/login_links');
  });

  it('tableau de bord complet (filet) : dashboard.stripe.com, aucun appel Stripe', async () => {
    const { calls, ctx } = fakeStripe([]);
    await expect(dashboardUrlFor(ctx, 'acct_1', { ...base, dashboard: 'full' })).resolves.toBe(STRIPE_FULL_DASHBOARD_URL);
    expect(calls).toHaveLength(0);
  });
});
