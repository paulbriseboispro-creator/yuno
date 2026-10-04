import { describe, expect, it } from 'vitest';
import {
  CRM_ORIGIN, TICKETING_ORIGIN, isCrmHostname, isCrmPath, isSharedProductPath, productHostDecision,
  type HostLocation,
} from '../productHost';

const at = (hostname: string, pathname: string, search = '', hash = '', port = '', protocol = 'https:'): HostLocation =>
  ({ hostname, port, protocol, pathname, search, hash });

describe('isCrmHostname', () => {
  it('recognises the CRM domain and its dev twin only', () => {
    expect(isCrmHostname('crm.yunoapp.eu')).toBe(true);
    expect(isCrmHostname('CRM.yunoapp.eu')).toBe(true);
    expect(isCrmHostname('crm.localhost')).toBe(true);
    expect(isCrmHostname('yunoapp.eu')).toBe(false);
    expect(isCrmHostname('landing.yunoapp.eu')).toBe(false);
    expect(isCrmHostname('localhost')).toBe(false);
  });
});

describe('isCrmPath / isSharedProductPath', () => {
  it('owns the CRM console, its login, its admin and the CRM opening', () => {
    for (const p of ['/crm', '/crm/', '/crm/clients', '/crm/emails/studio/1', '/login', '/admin/crm', '/admin/crm/login', '/crm-admin', '/open/crm']) {
      expect(isCrmPath(p)).toBe(true);
    }
  });

  it('never claims a lookalike path', () => {
    for (const p of ['/crmx', '/admin', '/admin/crmx', '/owner/crm/nights', '/open/suite', '/logins', '/']) {
      expect(isCrmPath(p)).toBe(false);
    }
  });

  it('shares sign-in, session handoff, signup follow-up, team invites and 2FA', () => {
    for (const p of ['/auth', '/auth/handoff', '/get-started', '/accept-org-member', '/mfa-setup', '/mfa-disable-confirm', '/account-suspended']) {
      expect(isSharedProductPath(p)).toBe(true);
    }
    expect(isSharedProductPath('/owner')).toBe(false);
  });
});

describe('productHostDecision on crm.yunoapp.eu', () => {
  it('keeps CRM and shared pages', () => {
    expect(productHostDecision(at('crm.yunoapp.eu', '/crm/clients'))).toEqual({ kind: 'stay' });
    expect(productHostDecision(at('crm.yunoapp.eu', '/login', '?redirect=%2Fcrm'))).toEqual({ kind: 'stay' });
    expect(productHostDecision(at('crm.yunoapp.eu', '/auth/handoff'))).toEqual({ kind: 'stay' });
    expect(productHostDecision(at('crm.yunoapp.eu', '/admin/crm'))).toEqual({ kind: 'stay' });
  });

  it('sends the generic sign-in to the CRM one, query and anchor kept', () => {
    expect(productHostDecision(at('crm.yunoapp.eu', '/auth', '?redirect=%2Fcrm%2Fclients')))
      .toEqual({ kind: 'local', to: '/login?redirect=%2Fcrm%2Fclients' });
    expect(productHostDecision(at('crm.yunoapp.eu', '/auth/', '', '#access_token=x')))
      .toEqual({ kind: 'local', to: '/login#access_token=x' });
  });

  it('sends ticketing pages back to yunoapp.eu with the full path', () => {
    expect(productHostDecision(at('crm.yunoapp.eu', '/owner/dashboard', '?tab=x')))
      .toEqual({ kind: 'cross', origin: TICKETING_ORIGIN, path: '/owner/dashboard?tab=x' });
    expect(productHostDecision(at('crm.yunoapp.eu', '/open/suite')))
      .toEqual({ kind: 'cross', origin: TICKETING_ORIGIN, path: '/open/suite' });
    expect(productHostDecision(at('crm.yunoapp.eu', '/legal/cgu')))
      .toEqual({ kind: 'cross', origin: TICKETING_ORIGIN, path: '/legal/cgu' });
  });

  it('under vite dev, the ticketing side is plain localhost on the same port', () => {
    expect(productHostDecision(at('crm.localhost', '/organizer-app', '', '', '8080', 'http:')))
      .toEqual({ kind: 'cross', origin: 'http://localhost:8080', path: '/organizer-app' });
    expect(productHostDecision(at('crm.localhost', '/', '', '', '8080', 'http:'))).toEqual({ kind: 'local', to: '/crm' });
  });
});

describe('productHostDecision on yunoapp.eu', () => {
  it('sends every CRM page to crm.yunoapp.eu', () => {
    expect(productHostDecision(at('yunoapp.eu', '/crm/emails/results/abc', '?x=1')))
      .toEqual({ kind: 'cross', origin: CRM_ORIGIN, path: '/crm/emails/results/abc?x=1' });
    expect(productHostDecision(at('www.yunoapp.eu', '/login')))
      .toEqual({ kind: 'cross', origin: CRM_ORIGIN, path: '/login' });
    expect(productHostDecision(at('yunoapp.eu', '/open/crm', '?token=t')))
      .toEqual({ kind: 'cross', origin: CRM_ORIGIN, path: '/open/crm?token=t' });
    expect(productHostDecision(at('yunoapp.eu', '/admin/crm/clients')))
      .toEqual({ kind: 'cross', origin: CRM_ORIGIN, path: '/admin/crm/clients' });
  });

  it('keeps ticketing and shared pages, the Suite CRM v1 pages included', () => {
    for (const p of ['/', '/owner', '/owner/crm/nights', '/organizer-app', '/auth', '/auth/handoff', '/get-started', '/admin', '/open/suite']) {
      expect(productHostDecision(at('yunoapp.eu', p))).toEqual({ kind: 'stay' });
    }
  });
});

describe('productHostDecision elsewhere', () => {
  it('never moves localhost, previews or the native app', () => {
    expect(productHostDecision(at('localhost', '/crm', '', '', '8080', 'http:'))).toEqual({ kind: 'stay' });
    expect(productHostDecision(at('yuno.paul-brisebois-pro.workers.dev', '/crm'))).toEqual({ kind: 'stay' });
    expect(productHostDecision(at('localhost', '/crm', '', '', '', 'capacitor:'))).toEqual({ kind: 'stay' });
  });

  it('an assisted or demo-preview session stays where it was opened', () => {
    expect(productHostDecision(at('yunoapp.eu', '/crm'), { exempt: true })).toEqual({ kind: 'stay' });
    expect(productHostDecision(at('crm.yunoapp.eu', '/owner'), { exempt: true })).toEqual({ kind: 'stay' });
  });
});
