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

// Comptes connectés Stripe (Accounts v2 depuis le 29/09) : le premier
// organisateur réel est resté bloqué sur « Use Accounts v2, remove `type`, and
// set `losses_collector` to `stripe` ». Ces tests figent les corps envoyés à
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
  it('v2 : Stripe porte les pertes ET collecte ses frais chez le vendeur, Express Dashboard', () => {
    const body = asV2(v2AccountBody(organizer, ['merchant', 'recipient'], true));
    expect(body.defaults.responsibilities).toEqual({ fees_collector: 'stripe', losses_collector: 'stripe' });
    expect(body.dashboard).toBe('express');
    expect(asV2(v2AccountBody(organizer, ['merchant'], false, 'full')).dashboard).toBe('full');
    expect(body.identity).toEqual({ country: 'fr' });
    expect(body.configuration.merchant?.capabilities.card_payments).toEqual({ requested: true });
    expect(body.configuration.recipient?.capabilities.stripe_balance.stripe_transfers).toEqual({ requested: true });
    expect(body.contact_email).toBe('orga@example.com');
    expect('type' in body).toBe(false);
  });

  it('v2 : pré-remplissage association, retiré quand prefill = false', () => {
    const asso = { ...organizer, entityType: 'non_profit' as const, registeredName: 'Asso Amoris' };
    expect(asV2(v2AccountBody(asso, ['merchant'], true)).identity).toEqual({
      country: 'fr', entity_type: 'non_profit', business_details: { registered_name: 'Asso Amoris' },
    });
    const bare = asV2(v2AccountBody(asso, ['merchant'], false));
    expect(bare.identity).toEqual({ country: 'fr' });
    expect(bare.configuration.recipient).toBeUndefined();
  });

  it('v1 de secours : `controller` à la place du `type` déprécié, mêmes responsabilités', () => {
    const body = asV1(v1ControllerAccountBody({ ...organizer, entityType: 'company' }, { capabilities: true, prefill: true }));
    expect('type' in body).toBe(false);
    expect(body.controller).toEqual({
      fees: { payer: 'account' },
      losses: { payments: 'stripe' },
      requirement_collection: 'stripe',
      stripe_dashboard: { type: 'express' },
    });
    expect(body.business_type).toBe('company');
    const bare = asV1(v1ControllerAccountBody({ ...organizer, entityType: 'company' }, { capabilities: false, prefill: false }));
    expect(bare.capabilities).toBeUndefined();
    expect(bare.business_type).toBeUndefined();
  });

  it('pays : un club de Madrid naît en Espagne, en euros, avec des emails Stripe en espagnol', () => {
    const madrid = { ...organizer, country: 'es', language: 'es' as const };
    const v2 = asV2(v2AccountBody(madrid, ['merchant', 'recipient'], true));
    expect(v2.identity).toEqual({ country: 'es' });
    expect(v2.defaults.currency).toBe('eur');
    expect(v2.defaults.locales).toEqual(['es-ES']);
    const v1 = asV1(v1ControllerAccountBody(madrid, { capabilities: true, prefill: true }));
    expect(v1.country).toBe('ES');
  });

  it('pays hors zone euro : la devise par défaut du compte suit le pays', () => {
    expect(asV2(v2AccountBody({ ...organizer, country: 'GB' }, ['merchant'], true)).defaults).toMatchObject({ currency: 'gbp', locales: ['en-GB'] });
    expect(asV2(v2AccountBody({ ...organizer, country: 'CH', language: 'fr' }, ['merchant'], true)).defaults).toMatchObject({ currency: 'chf', locales: ['fr-FR'] });
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

  it('le pays suit toutes les formes, jusqu’au filet v1', async () => {
    const { calls, ctx } = fakeStripe([
      refused('v2 refusé'),
      refused('v2 vendeur seul refusé'),
      { status: 200, body: { id: 'acct_v1' } },
    ]);
    await createConnectedAccount(ctx, { ...organizer, country: 'es' });
    expect(JSON.parse(calls[0].body!).identity.country).toBe('es');
    expect(JSON.parse(calls[1].body!).identity.country).toBe('es');
    expect(calls[2].body).toContain('country=ES');
  });

  it('crée en v2 (JSON, version dahlia, clé d’idempotence) au premier essai', async () => {
    const { calls, ctx } = fakeStripe([{ status: 200, body: { id: 'acct_v2', object: 'v2.core.account' } }]);
    await expect(createConnectedAccount(ctx, organizer)).resolves.toEqual({ id: 'acct_v2', api: 'v2', shape: 'v2' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.stripe.com/v2/core/accounts');
    expect(calls[0].headers['Stripe-Version']).toBe(STRIPE_V2_API_VERSION);
    expect(calls[0].headers['Content-Type']).toBe('application/json');
    expect(calls[0].headers['Idempotency-Key']).toMatch(/^yuno-connect-/);
    expect(JSON.parse(calls[0].body!).defaults.responsibilities.losses_collector).toBe('stripe');
  });

  it('un refus 400 passe à la forme suivante, jusqu’au v1 par controller', async () => {
    const { calls, ctx } = fakeStripe([
      refused('v2 refusé'),
      refused('v2 vendeur seul refusé'),
      { status: 200, body: { id: 'acct_v1' } },
    ]);
    await expect(createConnectedAccount(ctx, organizer)).resolves.toEqual({ id: 'acct_v1', api: 'v1', shape: 'v1-controller' });
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.stripe.com/v2/core/accounts',
      'https://api.stripe.com/v2/core/accounts',
      'https://api.stripe.com/v1/accounts',
    ]);
    expect(calls[2].headers['Stripe-Version']).toBe(STRIPE_V1_API_VERSION);
    expect(calls[2].body).toContain('controller[losses][payments]=stripe');
    expect(calls[2].body).not.toMatch(/(^|&)type=/);
  });

  it('toute forme Express refusée : dernier filet au tableau de bord complet', async () => {
    const { calls, ctx } = fakeStripe([
      refused('v2'), refused('v2 vendeur seul'), refused('v1'), refused('v1 nu'),
      { status: 200, body: { id: 'acct_full' } },
    ]);
    await expect(createConnectedAccount(ctx, organizer)).resolves.toEqual({ id: 'acct_full', api: 'v2', shape: 'v2-full-dashboard' });
    expect(JSON.parse(calls[4].body!).dashboard).toBe('full');
    expect(JSON.parse(calls[0].body!).dashboard).toBe('express');
  });

  it('une panne serveur n’enchaîne JAMAIS (le compte a pu naître : pas de doublon)', async () => {
    const { calls, ctx } = fakeStripe([{ status: 500, body: { error: { message: 'boom' } } }]);
    await expect(createConnectedAccount(ctx, organizer)).rejects.toMatchObject({
      name: 'ConnectAccountCreateError',
      attempts: [{ shape: 'v2', message: 'boom' }],
    });
    expect(calls).toHaveLength(1);
  });

  it('tout refusé : l’erreur porte le premier message Stripe et chaque tentative', async () => {
    const { ctx } = fakeStripe([refused('A'), refused('B'), refused('C'), refused('D'), refused('E')]);
    const err = await createConnectedAccount(ctx, organizer).catch((e) => e);
    expect(err.message).toBe('A');
    expect(err.attempts.map((a: { shape: string }) => a.shape)).toEqual(['v2', 'v2-merchant-only', 'v1-controller', 'v1-controller-bare', 'v2-full-dashboard']);
  });

  it('un DJ (payee) ne demande que la réception de transferts', async () => {
    const { calls, ctx } = fakeStripe([{ status: 200, body: { id: 'acct_dj' } }]);
    await createConnectedAccount(ctx, { ...organizer, purpose: 'payee', entityType: 'individual' });
    const body = JSON.parse(calls[0].body!);
    expect(body.configuration.merchant).toBeUndefined();
    expect(body.configuration.recipient).toBeDefined();
    expect(body.identity.entity_type).toBe('individual');
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
  const base = { chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, hasRequirements: false, requirements: { currently_due: [], past_due: [] }, source: 'v2' as const };

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
