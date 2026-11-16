/**
 * Le compte à créer depuis une démo : brouillon saisi par le super admin,
 * relu depuis admin_demo_link_signups, envoyé à admin_set_demo_link_signup.
 */
import { PILLARS, type LinkSignup, type Pillar, type SignupKind } from './data';

export interface SignupDraft {
  enabled: boolean; kind: SignupKind; firstName: string; lastName: string; orgName: string;
  email: string; phone: string; city: string; pillars: Pillar[]; offerSupport: boolean;
}

export const EMPTY_SIGNUP: SignupDraft = {
  enabled: false, kind: 'organizer', firstName: '', lastName: '', orgName: '',
  email: '', phone: '', city: '', pillars: ['tickets', 'tables', 'guest_list'], offerSupport: true,
};

export function draftFromSignup(s: LinkSignup): SignupDraft {
  return {
    enabled: true, kind: s.kind, firstName: s.first_name ?? '', lastName: s.last_name ?? '', orgName: s.org_name ?? '',
    email: s.email ?? '', phone: s.phone ?? '', city: s.city ?? '',
    pillars: (s.pillars ?? []).filter((p): p is Pillar => (PILLARS as string[]).includes(p)),
    offerSupport: s.offer_support,
  };
}

/** Le corps envoyé à admin_set_demo_link_signup (le bar n'est proposé que si le pilier est en ligne). */
export function signupPayload(d: SignupDraft) {
  return {
    kind: d.kind, first_name: d.firstName.trim(), last_name: d.lastName.trim(), org_name: d.orgName.trim(),
    email: d.email.trim(), phone: d.phone.trim(), city: d.city.trim(),
    pillars: d.pillars.filter((p) => PILLARS.includes(p) && (d.kind === 'club' || p !== 'drinks')),
    offer_support: d.offerSupport,
  };
}
