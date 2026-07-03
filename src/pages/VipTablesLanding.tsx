import { PillarLanding, type PillarConfig } from '@/components/pillar/PillarLanding';

const config: PillarConfig = {
  path: '/vip-tables',
  kicker: 'VIP tables',
  h1: 'Book a VIP table & bottle service',
  lead: 'Reserve VIP tables and bottle service at top clubs from your phone. Pick your table, choose your bottles, and lock in guaranteed entry — all before you leave the house.',
  primaryCta: { label: 'Find a club', to: '/clubs' },
  secondaryCta: { label: 'Browse events', to: '/events' },
  sections: [
    {
      h2: 'Bottle service, booked in advance',
      body: 'No more DMs and waiting for a callback. On Yuno you see the club’s real table map, the packages on offer, and what each one includes. Choose the table that fits your group, pre-order your bottles and mixers, and pay securely — your reservation is confirmed instantly. When you arrive, a host is expecting you.',
    },
    {
      h2: 'The best seat for every kind of night',
      body: 'Whether it is a birthday, a bachelor or bachelorette party, or just a big night out, a VIP table gets your group a guaranteed space, priority entry, and dedicated service. Browse clubs near you, compare table packages and minimum spends, and reserve the spot that matches your budget and your crowd.',
    },
  ],
  stepsTitle: 'How booking a table works',
  steps: [
    { title: 'Choose your club or event', body: 'Browse venues near you and open the one you want.' },
    { title: 'Pick a table package', body: 'See the table map, what each package includes, and the minimum spend.' },
    { title: 'Pre-order your bottles', body: 'Add bottles and mixers so everything is ready when you sit down.' },
    { title: 'Arrive & enjoy', body: 'Skip the line with guaranteed entry. Your host is expecting your group.' },
  ],
  featuresTitle: 'Why book VIP tables on Yuno',
  features: [
    { title: 'Real table maps', body: 'See exactly which tables are available and what each one includes.' },
    { title: 'Bottle packages', body: 'Pre-order bottles and mixers so nothing slows your night down.' },
    { title: 'Guaranteed entry', body: 'A VIP table means priority access — no waiting in the general line.' },
    { title: 'Dedicated host service', body: 'A host looks after your table from arrival to last call.' },
  ],
  faqTitle: 'VIP table & bottle service FAQ',
  faqs: [
    {
      q: 'How does bottle service work?',
      a: 'You reserve a VIP table that comes with a minimum spend, then choose bottles and mixers to hit that spend. On Yuno you can pre-order everything in advance so your table is set up when you arrive.',
    },
    {
      q: 'What is the minimum spend?',
      a: 'Minimum spend depends on the club, the table location and the night. Each table package on Yuno shows its minimum spend before you book, so there are no surprises.',
    },
    {
      q: 'Can I pre-order bottles before I arrive?',
      a: 'Yes. Once you reserve a table you can add bottles and mixers so everything is ready the moment you sit down.',
    },
    {
      q: 'Do VIP tables include entry?',
      a: 'In most cases a VIP table includes guaranteed entry for your group. The exact number of guests included is shown on the table package when you book.',
    },
  ],
  metaTitle: 'Book VIP Tables & Bottle Service — Reserve Online | Yuno',
  metaDescription:
    'Book VIP tables and bottle service at top nightclubs online. See real table maps, pre-order bottles, get guaranteed entry and host service. Reserve your table on Yuno.',
};

export default function VipTablesLanding() {
  return <PillarLanding config={config} />;
}
