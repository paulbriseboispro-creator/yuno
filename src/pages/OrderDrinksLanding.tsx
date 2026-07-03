import { PillarLanding, type PillarConfig } from '@/components/pillar/PillarLanding';

const config: PillarConfig = {
  path: '/order-drinks',
  kicker: 'Order drinks',
  h1: 'Order drinks and skip the bar queue',
  lead: 'Order drinks from your phone and skip the line at the bar. Browse the club menu, pay in the app, and collect at a dedicated pickup point — more time on the floor, less time waiting.',
  primaryCta: { label: 'Find a club', to: '/clubs' },
  secondaryCta: { label: 'Browse events', to: '/events' },
  sections: [
    {
      h2: 'Skip the queue, keep the night moving',
      body: 'The bar queue is where nights go to die. Yuno lets you order drinks straight from the club’s menu on your phone, pay in-app, and pick them up at a fast collection point — no elbowing to the front, no waving cash. Order a full round for your group in one go and keep dancing while it is being made.',
    },
    {
      h2: 'Cashless, fast, and built for the floor',
      body: 'Every drink you order is paid for securely in the app, so there is no fumbling for cards at a loud bar. Menus, prices and availability come straight from the club, so what you see is what you get. It is the fastest way to keep the drinks flowing on a busy night.',
    },
  ],
  stepsTitle: 'How ordering drinks works',
  steps: [
    { title: 'Open the club menu', body: 'Scan the code at your table or open the venue in the app.' },
    { title: 'Add your drinks', body: 'Build a round for the whole group in a few taps.' },
    { title: 'Pay in-app', body: 'Check out securely — no cash, no card at the bar.' },
    { title: 'Collect at the pickup point', body: 'Grab your order at the dedicated collection point. No queue.' },
  ],
  featuresTitle: 'Why order drinks on Yuno',
  features: [
    { title: 'No bar queue', body: 'Order ahead and pick up at a fast collection point.' },
    { title: 'Order full rounds', body: 'Get drinks for the whole group in a single order.' },
    { title: 'Cashless & secure', body: 'Pay in-app with card, Apple Pay or Google Pay.' },
    { title: 'Real club menus', body: 'Live menu, prices and availability straight from the venue.' },
  ],
  faqTitle: 'Ordering drinks FAQ',
  faqs: [
    {
      q: 'How do I order drinks with Yuno?',
      a: 'Open the club’s menu in the app, add the drinks you want, and pay in-app. You then collect your order at the venue’s dedicated pickup point instead of queuing at the bar.',
    },
    {
      q: 'Where do I collect my drinks?',
      a: 'Each club sets a collection point for app orders. After you pay, the app shows you where to pick up your order.',
    },
    {
      q: 'Can I order a round for my whole group?',
      a: 'Yes. Add as many drinks as you like to a single order and collect them together — ideal for rounds.',
    },
    {
      q: 'Is ordering available at every club?',
      a: 'Drink ordering is available at clubs that have enabled it on Yuno. Open a venue in the app to see whether its menu is available for ordering.',
    },
  ],
  metaTitle: 'Order Drinks & Skip the Bar Queue — Order Ahead | Yuno',
  metaDescription:
    'Order drinks from your phone and skip the bar queue. Browse the club menu, pay in-app, and collect at a dedicated pickup point. Order rounds cashless with Yuno.',
};

export default function OrderDrinksLanding() {
  return <PillarLanding config={config} />;
}
