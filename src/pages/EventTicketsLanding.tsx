import { PillarLanding, type PillarConfig } from '@/components/pillar/PillarLanding';

const config: PillarConfig = {
  path: '/tickets',
  kicker: 'Event tickets',
  h1: 'Event tickets for the best nights out',
  lead: 'Buy tickets to club nights, parties and shows near you in seconds. Yuno gives you an instant QR ticket, secure payment, and one app for your whole night — tickets, VIP tables and drinks.',
  primaryCta: { label: 'Browse events', to: '/events' },
  secondaryCta: { label: 'Find clubs', to: '/clubs' },
  sections: [
    {
      h2: 'Buy nightlife tickets without the hassle',
      body: 'Yuno is built for going out. Find events happening tonight or this weekend, choose your ticket, and pay securely with card, Apple Pay or Google Pay. Your ticket lands in the app as a QR code you scan at the door — no printing, no waiting, no lost paper tickets. Presale, early-bird and limited-capacity releases are all handled in-app, so you never miss the drop.',
    },
    {
      h2: 'Real-time availability, real venues',
      body: 'Every event on Yuno is published by the club or organizer running it. That means accurate line-ups, real ticket tiers, and live availability — when a round sells out, you see it. Follow your favourite clubs and organizers to get notified the moment new events and tickets go live.',
    },
  ],
  stepsTitle: 'How buying tickets works',
  steps: [
    { title: 'Find an event', body: 'Browse events near you by date, city, club or music genre.' },
    { title: 'Pick your ticket', body: 'Choose a ticket tier — early bird, general admission or a table package.' },
    { title: 'Pay securely', body: 'Check out in seconds with card, Apple Pay or Google Pay. Payments are handled by Stripe.' },
    { title: 'Scan at the door', body: 'Show the QR ticket in the app. That is it — you are in.' },
  ],
  featuresTitle: 'Why buy tickets on Yuno',
  features: [
    { title: 'Instant QR tickets', body: 'Your ticket is in the app the moment you pay. Nothing to print.' },
    { title: 'Secure checkout', body: 'Card, Apple Pay and Google Pay, processed securely by Stripe.' },
    { title: 'Guest list & presale', body: 'Join guest lists and grab presale tickets before public release.' },
    { title: 'One app for the night', body: 'Add a VIP table or pre-order drinks from the same ticket.' },
  ],
  faqTitle: 'Event ticket FAQ',
  faqs: [
    {
      q: 'How do I buy tickets on Yuno?',
      a: 'Open the event page, choose your ticket tier, and pay with card, Apple Pay or Google Pay. Your QR ticket appears instantly in the app under your orders.',
    },
    {
      q: 'Do I need to print my ticket?',
      a: 'No. Your ticket is a QR code inside the Yuno app. Staff scan it at the door straight from your phone.',
    },
    {
      q: 'Can I get a refund?',
      a: 'Refunds are managed by the club or organizer running the event, according to their policy. Refunds, when granted, are issued back to your original payment method.',
    },
    {
      q: 'Are tickets tied to a specific event?',
      a: 'Yes. Each ticket is issued for a specific event and date, and the QR code is validated at entry for that event only.',
    },
  ],
  metaTitle: 'Buy Event Tickets — Club Nights, Parties & Shows | Yuno',
  metaDescription:
    'Buy tickets to club nights, parties and events near you. Instant QR tickets, secure Apple Pay / Google Pay checkout, presale and guest list — plus VIP tables and drinks in one app.',
};

export default function EventTicketsLanding() {
  return <PillarLanding config={config} />;
}
