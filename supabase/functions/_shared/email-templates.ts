// ─────────────────────────────────────────────────────────────────────────────
// Yuno Email Templates — builders éditoriaux trilingues (EN / FR / ES).
//
// Chaque builder renvoie { subject, preheader, html }. Principes d'écriture :
//   • Objet : court (<45 car.), concret, nom event/club dedans, tutoiement (FR/ES).
//   • Preheader : COMPLÈTE l'objet (date/lieu/CTA), ne le répète pas.
//   • Corps : une idée par bloc, UN seul CTA, le factuel en mono.
//   • Voix Yuno : directe, nuit, jamais corporate.
//
// DATA = langue-indépendant (titre event, prix…). Seul le CHROME est traduit.
// ─────────────────────────────────────────────────────────────────────────────

import {
  shell, brandBar, poster, ruleLabel, title, mono, body, section,
  ctaPill, ctaSharp, walletPill, bigDate, calloutPrice, codeBlock, infoRows, eventMiniCard,
  qrCard, divider, spacer, footer, C, F,
} from './email-kit.ts';

/** Libellé du bouton Apple Wallet (3 langues). */
const WALLET_LABEL = { en: 'Add to Apple Wallet', fr: 'Ajouter à Apple Wallet', es: 'Añadir a Apple Wallet' };

export type Lang = 'en' | 'fr' | 'es';
export interface BuiltEmail { subject: string; preheader: string; html: string; }

const APP = 'https://yunoapp.eu';
function L(lang: Lang): Lang { return (['en', 'fr', 'es'] as Lang[]).includes(lang) ? lang : 'en'; }
function p(lang: Lang, m: { en: string; fr: string; es: string }): string { return m[L(lang)]; }

// Labels factuels partagés (infoRows / bigDate)
const LBL = {
  event: { en: 'Event', fr: 'Événement', es: 'Evento' },
  party: { en: 'Night', fr: 'Soirée', es: 'Noche' },
  venue: { en: 'Venue', fr: 'Lieu', es: 'Lugar' },
  club: { en: 'Club', fr: 'Club', es: 'Club' },
  ticket: { en: 'Ticket', fr: 'Billet', es: 'Entrada' },
  price: { en: 'Price', fr: 'Prix', es: 'Precio' },
  total: { en: 'Total', fr: 'Total', es: 'Total' },
  reference: { en: 'Reference', fr: 'Référence', es: 'Referencia' },
  date: { en: 'Date', fr: 'Date', es: 'Fecha' },
  doors: { en: 'Doors', fr: 'Ouverture', es: 'Apertura' },
  arrival: { en: 'Arrival', fr: 'Arrivée', es: 'Llegada' },
  table: { en: 'Table', fr: 'Table', es: 'Mesa' },
  guests: { en: 'Guests', fr: 'Convives', es: 'Invitados' },
  bottles: { en: 'Bottles', fr: 'Bouteilles', es: 'Botellas' },
  role: { en: 'Role', fr: 'Rôle', es: 'Rol' },
  org: { en: 'Organization', fr: 'Organisation', es: 'Organización' },
  validUntil: { en: 'Valid until', fr: 'Valide jusqu\'au', es: 'Válido hasta' },
  amount: { en: 'Amount', fr: 'Montant', es: 'Importe' },
};
const lbl = (lang: Lang, k: keyof typeof LBL) => p(lang, LBL[k]);
const reasonTicket = (lang: Lang) => p(lang, { en: 'you bought a ticket', fr: 'tu as acheté un billet', es: 'compraste una entrada' });

// Formatte une date ISO en {day:'22', month:'Juin 2026', time:'18:00'} selon la langue.
// tz par défaut Europe/Paris (marché FR/ES de Yuno, parité avec l'ancien rendu).
export function fmtDateParts(iso: string | Date, lang: Lang, tz = 'Europe/Paris'): { day: string; month: string; time: string } {
  const dt = iso instanceof Date ? iso : new Date(iso);
  if (isNaN(dt.getTime())) return { day: '—', month: '', time: '' };
  const loc = ({ en: 'en-GB', fr: 'fr-FR', es: 'es-ES' } as const)[L(lang)];
  const day = new Intl.DateTimeFormat(loc, { day: 'numeric', timeZone: tz }).format(dt);
  const m = new Intl.DateTimeFormat(loc, { month: 'long', timeZone: tz }).format(dt);
  const yr = new Intl.DateTimeFormat(loc, { year: 'numeric', timeZone: tz }).format(dt);
  const month = `${m.charAt(0).toUpperCase()}${m.slice(1)} ${yr}`;
  const time = new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(dt);
  return { day, month, time };
}

// ── 1. Confirmation de billet ────────────────────────────────────────────────
export function buildTicketConfirmation(d: {
  lang?: Lang; firstName?: string; eventTitle: string; venueName: string; posterUrl?: string;
  day: string; month: string; openTime?: string; city?: string;
  ticketType: string; price: string; reference: string; ticketUrl: string; recipientEmail?: string;
  qrDataUrl?: string; address?: string; attached?: boolean; walletUrl?: string;
  /** Éducation boissons (upsell post-achat) : lien /order/upsell + presale actif ? */
  drinksUpsell?: { url: string; presale: boolean };
}): BuiltEmail {
  const lang = L(d.lang || 'en');
  const hi = d.firstName ? `${d.firstName}, ` : '';
  const subject = `${p(lang, { en: 'Ticket confirmed', fr: 'Billet confirmé', es: 'Entrada confirmada' })} — ${d.eventTitle}`;
  const html = shell({
    title: subject,
    preheader: `${d.day} ${d.month}${d.openTime ? ` · ${d.openTime}` : ''} · ${d.venueName} · ${lbl(lang, 'reference')} ${d.reference}`,
    body: [
      brandBar(),
      poster(d.posterUrl || '', d.eventTitle),
      section(ruleLabel(p(lang, { en: 'Ticket confirmed', fr: 'Billet confirmé', es: 'Entrada confirmada' })) + `<div style="height:14px"></div>` +
        title(`${hi}${p(lang, { en: "you're in", fr: "c'est confirmé", es: 'estás dentro' })}`, 32) + `<div style="height:14px"></div>` +
        body(p(lang, {
          en: `Your ticket for <strong style="color:${C.white}">${d.eventTitle}</strong> is valid. Show the QR at the door, that's it.`,
          fr: `Ton billet pour <strong style="color:${C.white}">${d.eventTitle}</strong> est validé. Montre le QR à l'entrée, c'est tout.`,
          es: `Tu entrada para <strong style="color:${C.white}">${d.eventTitle}</strong> está validada. Muestra el QR en la entrada, eso es todo.`,
        }))),
      section(bigDate({ day: d.day, month: `${d.month}${d.city ? ' · ' + d.city : ''}`, dateLabel: lbl(lang, 'date'), timeLabel: lbl(lang, 'doors'), timeValue: d.openTime || '—' })),
      section(infoRows([
        { k: lbl(lang, 'event'), v: d.eventTitle },
        { k: lbl(lang, 'venue'), v: d.venueName },
        ...(d.address ? [{ k: p(lang, { en: 'Address', fr: 'Adresse', es: 'Dirección' }), v: d.address }] : []),
        { k: lbl(lang, 'ticket'), v: d.ticketType },
        { k: lbl(lang, 'price'), v: d.price },
        { k: lbl(lang, 'reference'), v: d.reference },
      ])),
      section(`${d.qrDataUrl
        ? qrCard(d.qrDataUrl, p(lang, { en: 'Scan at the door', fr: "À scanner à l'entrée", es: 'Escanear en la entrada' }), d.reference)
        : calloutPrice(p(lang, { en: 'Show at the door', fr: "À présenter à l'entrée", es: 'Mostrar en la entrada' }), d.reference)
        }${d.attached ? `<div style="height:14px"></div>${mono(p(lang, {
          en: 'Your ticket + receipt are attached as PDF',
          fr: 'Ton billet + ton reçu sont en pièce jointe (PDF)',
          es: 'Tu entrada + tu recibo están adjuntos en PDF',
        }), C.gray3, 11)}` : ''}${d.walletUrl ? `<div style="height:20px"></div>${walletPill(p(lang, WALLET_LABEL), d.walletUrl)}` : ''}<div style="height:20px"></div>${ctaPill(p(lang, { en: 'View my ticket', fr: 'Voir mon billet', es: 'Ver mi entrada' }), d.ticketUrl)}`, { border: false }),
      // Éducation boissons : le moment de plus forte intention (billet en main).
      ...(d.drinksUpsell ? [section(
        ruleLabel(p(lang, { en: '🍸 Skip the bar queue', fr: '🍸 Zéro file au bar', es: '🍸 Sin cola en la barra' })) +
        `<div style="height:12px"></div>` +
        body(d.drinksUpsell.presale
          ? p(lang, {
              en: 'Order your drinks ahead at the <strong style="color:' + C.white + '">presale price</strong> — show your QR at the bar that night, they\'re ready.',
              fr: 'Commande tes boissons à l\'avance au <strong style="color:' + C.white + '">prix presale</strong> — montre ton QR au bar le soir même, c\'est servi.',
              es: 'Pide tus copas por adelantado a <strong style="color:' + C.white + '">precio preventa</strong>: enseña tu QR en la barra esa noche y listo.',
            })
          : p(lang, {
              en: 'Order your drinks in the app — show your QR at the bar that night, no queue.',
              fr: 'Commande tes boissons dans l\'app — montre ton QR au bar le soir même, sans faire la file.',
              es: 'Pide tus copas en la app: enseña tu QR en la barra esa noche, sin cola.',
            })) +
        `<div style="height:16px"></div>` +
        ctaPill(p(lang, { en: 'Pre-order my drinks', fr: 'Commander mes boissons', es: 'Pedir mis copas' }), d.drinksUpsell.url),
      )] : []),
      footer({ lang, venueName: d.venueName }),
    ].join(''),
  });
  return { subject, preheader: `${d.day} ${d.month} · ${d.venueName}`, html };
}

// ── 2. Confirmation table VIP ────────────────────────────────────────────────
export function buildVipConfirmation(d: {
  lang?: Lang; firstName?: string; eventTitle: string; venueName: string; posterUrl?: string;
  day: string; month: string; arrivalTime?: string;
  tableName: string; guests: string; bottles?: string; total: string; reference: string; manageUrl: string;
  qrDataUrl?: string; walletUrl?: string;
}): BuiltEmail {
  const lang = L(d.lang || 'en');
  const hi = d.firstName ? `${d.firstName}, ` : '';
  const subject = `${p(lang, { en: 'Your VIP table is booked', fr: 'Ta table VIP est réservée', es: 'Tu mesa VIP está reservada' })} — ${d.venueName}`;
  const html = shell({
    title: subject,
    preheader: `${d.tableName} · ${d.guests} · ${d.day} ${d.month} · ${d.venueName}`,
    body: [
      brandBar(),
      poster(d.posterUrl || '', d.eventTitle),
      section(ruleLabel(p(lang, { en: 'VIP table confirmed', fr: 'Table VIP confirmée', es: 'Mesa VIP confirmada' })) + `<div style="height:14px"></div>` +
        title(`${hi}${p(lang, { en: 'your table awaits', fr: "ta table t'attend", es: 'tu mesa te espera' })}`, 30) + `<div style="height:14px"></div>` +
        body(p(lang, {
          en: `<strong style="color:${C.white}">${d.tableName}</strong> is reserved for <strong style="color:${C.white}">${d.eventTitle}</strong>. Head to VIP reception under your name.`,
          fr: `<strong style="color:${C.white}">${d.tableName}</strong> est réservée pour <strong style="color:${C.white}">${d.eventTitle}</strong>. Présente-toi à l'accueil VIP à ton nom.`,
          es: `<strong style="color:${C.white}">${d.tableName}</strong> está reservada para <strong style="color:${C.white}">${d.eventTitle}</strong>. Preséntate en recepción VIP a tu nombre.`,
        }))),
      section(bigDate({ day: d.day, month: d.month, dateLabel: lbl(lang, 'date'), timeLabel: lbl(lang, 'arrival'), timeValue: d.arrivalTime || '—' })),
      section(infoRows([
        { k: lbl(lang, 'party'), v: d.eventTitle },
        { k: lbl(lang, 'club'), v: d.venueName },
        { k: lbl(lang, 'table'), v: d.tableName },
        { k: lbl(lang, 'guests'), v: d.guests },
        ...(d.bottles ? [{ k: lbl(lang, 'bottles'), v: d.bottles }] : []),
        { k: lbl(lang, 'total'), v: d.total },
        { k: lbl(lang, 'reference'), v: d.reference },
      ])),
      ...(d.qrDataUrl ? [section(qrCard(d.qrDataUrl, p(lang, { en: 'Scan at VIP entry', fr: "À scanner à l'entrée VIP", es: 'Escanear en entrada VIP' }), d.reference), { border: false, padBottom: 4 })] : []),
      section(`${d.walletUrl ? `${walletPill(p(lang, WALLET_LABEL), d.walletUrl)}<div style="height:16px"></div>` : ''}${ctaPill(p(lang, { en: 'Manage my booking', fr: 'Gérer ma réservation', es: 'Gestionar mi reserva' }), d.manageUrl)}`, { border: false }),
      footer({ lang, venueName: d.venueName }),
    ].join(''),
  });
  return { subject, preheader: `${d.tableName} · ${d.day} ${d.month}`, html };
}

// ── 3. Confirmation commande (boissons / order) ───────────────────────────────
export function buildOrderConfirmation(d: {
  lang?: Lang; firstName?: string; venueName: string; items: Array<{ k: string; v: string }>;
  total: string; reference: string; pickupInfo?: string; orderUrl: string;
}): BuiltEmail {
  const lang = L(d.lang || 'en');
  const hi = d.firstName ? `${d.firstName}, ` : '';
  const subject = `${p(lang, { en: 'Order confirmed', fr: 'Commande confirmée', es: 'Pedido confirmado' })} — ${d.venueName}`;
  const html = shell({
    title: subject,
    preheader: `${d.total} · ${lbl(lang, 'reference')} ${d.reference} · ${d.venueName}`,
    body: [
      brandBar(),
      section(ruleLabel(p(lang, { en: 'Order confirmed', fr: 'Commande confirmée', es: 'Pedido confirmado' })) + `<div style="height:14px"></div>` +
        title(`${hi}${p(lang, { en: "it's served", fr: "c'est commandé", es: 'pedido listo' })}`, 30) + `<div style="height:14px"></div>` +
        body(p(lang, {
          en: `Your order at <strong style="color:${C.white}">${d.venueName}</strong> is confirmed.${d.pickupInfo ? ` ${d.pickupInfo}` : ''}`,
          fr: `Ta commande chez <strong style="color:${C.white}">${d.venueName}</strong> est confirmée.${d.pickupInfo ? ` ${d.pickupInfo}` : ''}`,
          es: `Tu pedido en <strong style="color:${C.white}">${d.venueName}</strong> está confirmado.${d.pickupInfo ? ` ${d.pickupInfo}` : ''}`,
        }))),
      section(infoRows([...d.items, { k: lbl(lang, 'total'), v: d.total }, { k: lbl(lang, 'reference'), v: d.reference }])),
      section(ctaPill(p(lang, { en: 'View my order', fr: 'Voir ma commande', es: 'Ver mi pedido' }), d.orderUrl), { border: false }),
      footer({ lang, venueName: d.venueName }),
    ].join(''),
  });
  return { subject, preheader: `${d.total} · ${d.venueName}`, html };
}

// ── 4. Win-back ("on t'a raté") — MARKETING (opt-in + désinscription) ─────────
export function buildWinBack(d: {
  lang?: Lang; firstName?: string; pastEventTitle: string; venueName: string; posterUrl?: string;
  attendeeCount?: string; nextEvent?: { title: string; meta: string; url: string; img?: string };
  venueUrl: string; unsubscribeUrl: string; recipientEmail: string;
}): BuiltEmail {
  const lang = L(d.lang || 'en');
  const hi = d.firstName ? `${d.firstName}, ` : '';
  const subject = p(lang, { en: `We missed you, ${d.venueName.toUpperCase()}`, fr: `On t'a raté, ${d.venueName.toUpperCase()}`, es: `Te echamos de menos, ${d.venueName.toUpperCase()}` });
  const html = shell({
    title: subject,
    preheader: d.nextEvent ? p(lang, { en: `Next up: ${d.nextEvent.title}. You in?`, fr: `La prochaine : ${d.nextEvent.title}. T'y seras ?`, es: `La próxima: ${d.nextEvent.title}. ¿Te apuntas?` }) : p(lang, { en: 'We\'re back soon.', fr: 'On remet ça bientôt.', es: 'Volvemos pronto.' }),
    body: [
      brandBar(),
      poster(d.posterUrl || '', d.pastEventTitle),
      section(ruleLabel(d.venueName) + `<div style="height:14px"></div>` +
        title(`${hi}${p(lang, { en: 'you missed it', fr: 'tu nous as manqué', es: 'te lo perdiste' })}`, 30) + `<div style="height:14px"></div>` +
        body(p(lang, {
          en: `<strong style="color:${C.white}">${d.pastEventTitle}</strong> went down without you.${d.attendeeCount ? ` ${d.attendeeCount} people were there.` : ''} The night won't wait — we're back soon.`,
          fr: `<strong style="color:${C.white}">${d.pastEventTitle}</strong> est passé sans toi.${d.attendeeCount ? ` ${d.attendeeCount} personnes y étaient.` : ''} La nuit n'attend pas — on remet ça bientôt.`,
          es: `<strong style="color:${C.white}">${d.pastEventTitle}</strong> pasó sin ti.${d.attendeeCount ? ` ${d.attendeeCount} personas estuvieron allí.` : ''} La noche no espera — volvemos pronto.`,
        }))),
      ...(d.nextEvent ? [
        section(ruleLabel(p(lang, { en: 'Next up', fr: 'La prochaine', es: 'La próxima' })) + `<div style="height:16px"></div>` +
          eventMiniCard({ img: d.nextEvent.img, title: d.nextEvent.title, meta: d.nextEvent.meta, url: d.nextEvent.url, cta: p(lang, { en: 'See the night', fr: 'Voir la soirée', es: 'Ver la noche' }) }), { border: false }),
      ] : [
        section(ctaPill(p(lang, { en: `See ${d.venueName}`, fr: `Voir ${d.venueName}`, es: `Ver ${d.venueName}` }), d.venueUrl), { border: false }),
      ]),
      footer({ lang, recipientEmail: d.recipientEmail, reason: p(lang, { en: `you attended a ${d.venueName} night`, fr: `tu as participé à une soirée de ${d.venueName}`, es: `asististe a una noche de ${d.venueName}` }), unsubscribeUrl: d.unsubscribeUrl, venueName: d.venueName }),
    ].join(''),
  });
  return { subject, preheader: d.nextEvent ? d.nextEvent.title : '', html };
}

// ── 5. Upsell (post-achat : VIP / boissons) — MARKETING ───────────────────────
export function buildUpsell(d: {
  lang?: Lang; firstName?: string; eventTitle: string; venueName: string;
  vipEnabled?: boolean; venueUrl: string; unsubscribeUrl: string; recipientEmail: string;
}): BuiltEmail {
  const lang = L(d.lang || 'en');
  const hi = d.firstName ? `${d.firstName}, ` : '';
  const subject = p(lang, { en: `Level up your night — ${d.eventTitle}`, fr: `Améliore ta soirée — ${d.eventTitle}`, es: `Mejora tu noche — ${d.eventTitle}` });
  const opts: string[] = [];
  if (d.vipEnabled) opts.push(p(lang, { en: '<strong style="color:#fff">VIP table</strong> — skip the queue, your own space.', fr: '<strong style="color:#fff">Table VIP</strong> — coupe la file, ton espace à toi.', es: '<strong style="color:#fff">Mesa VIP</strong> — sáltate la cola, tu propio espacio.' }));
  opts.push(p(lang, { en: '<strong style="color:#fff">Pre-order drinks</strong> — ready when you arrive.', fr: '<strong style="color:#fff">Commande tes boissons</strong> — prêtes à ton arrivée.', es: '<strong style="color:#fff">Pide tus bebidas</strong> — listas al llegar.' }));
  const html = shell({
    title: subject,
    preheader: p(lang, { en: 'VIP tables & pre-ordered drinks for your night.', fr: 'Tables VIP & boissons en pré-commande pour ta soirée.', es: 'Mesas VIP y bebidas por adelantado para tu noche.' }),
    body: [
      brandBar(),
      section(ruleLabel(p(lang, { en: 'Make it bigger', fr: 'Passe la vitesse', es: 'Sube de nivel' })) + `<div style="height:14px"></div>` +
        title(`${hi}${p(lang, { en: 'your night, upgraded', fr: 'ta soirée, en mieux', es: 'tu noche, mejorada' })}`, 28) + `<div style="height:14px"></div>` +
        body(p(lang, {
          en: `You're set for <strong style="color:${C.white}">${d.eventTitle}</strong>. Want to go all in?`,
          fr: `Tu es prêt pour <strong style="color:${C.white}">${d.eventTitle}</strong>. Envie de tout donner ?`,
          es: `Estás listo para <strong style="color:${C.white}">${d.eventTitle}</strong>. ¿Lo damos todo?`,
        }) + `<div style="height:14px"></div><ul style="margin:0;padding-left:18px;color:${C.gray1};font-family:${F.body};font-size:15px;line-height:1.8;">${opts.map((o) => `<li>${o}</li>`).join('')}</ul>`), { border: false }),
      section(ctaPill(p(lang, { en: 'Upgrade my night', fr: 'Améliorer ma soirée', es: 'Mejorar mi noche' }), d.venueUrl), { border: false }),
      footer({ lang, recipientEmail: d.recipientEmail, reason: reasonTicket(lang), unsubscribeUrl: d.unsubscribeUrl, venueName: d.venueName }),
    ].join(''),
  });
  return { subject, preheader: '', html };
}

// ── 6. Recommandation soirées — MARKETING ─────────────────────────────────────
export function buildNextEventRec(d: {
  lang?: Lang; firstName?: string; events: Array<{ title: string; meta: string; url: string; img?: string }>;
  unsubscribeUrl: string; recipientEmail: string;
}): BuiltEmail {
  const lang = L(d.lang || 'en');
  const hi = d.firstName ? `${d.firstName}, ` : '';
  const subject = p(lang, { en: 'Nights picked for you', fr: 'Des soirées pour toi', es: 'Noches elegidas para ti' });
  const cards = d.events.slice(0, 3).map((e) => eventMiniCard({ img: e.img, title: e.title, meta: e.meta, url: e.url, cta: p(lang, { en: 'Get tickets', fr: 'Prendre ma place', es: 'Conseguir entradas' }) }) + `<div style="height:12px"></div>`).join('');
  const html = shell({
    title: subject,
    preheader: d.events[0] ? d.events[0].title : p(lang, { en: 'Based on where you\'ve been.', fr: 'D\'après tes sorties.', es: 'Según tus salidas.' }),
    body: [
      brandBar(),
      section(ruleLabel(p(lang, { en: 'For you', fr: 'Pour toi', es: 'Para ti' })) + `<div style="height:14px"></div>` +
        title(`${hi}${p(lang, { en: 'this is your scene', fr: 'ça, c\'est pour toi', es: 'esto es lo tuyo' })}`, 28) + `<div style="height:14px"></div>` +
        body(p(lang, { en: 'Based on the nights you loved, here\'s what\'s coming.', fr: 'D\'après les soirées que tu as aimées, voici ce qui arrive.', es: 'Según las noches que te gustaron, esto es lo que viene.' })), { border: false }),
      section(cards, { border: false, padTop: 4 }),
      footer({ lang, recipientEmail: d.recipientEmail, reason: p(lang, { en: 'you attended events on Yuno', fr: 'tu as participé à des soirées sur Yuno', es: 'asististe a eventos en Yuno' }), unsubscribeUrl: d.unsubscribeUrl }),
    ].join(''),
  });
  return { subject, preheader: '', html };
}

// ── 7. Recap post-soirée (opérationnel) ───────────────────────────────────────
export function buildEventRecap(d: {
  lang?: Lang; firstName?: string; eventTitle: string; venueName: string; posterUrl?: string;
  stats: Array<{ k: string; v: string }>; venueUrl: string;
}): BuiltEmail {
  const lang = L(d.lang || 'en');
  const hi = d.firstName ? `${d.firstName}, ` : '';
  const subject = p(lang, { en: `Your night in numbers — ${d.eventTitle}`, fr: `Ta soirée en chiffres — ${d.eventTitle}`, es: `Tu noche en cifras — ${d.eventTitle}` });
  const html = shell({
    title: subject,
    preheader: p(lang, { en: 'Thanks for being there.', fr: 'Merci d\'avoir été là.', es: 'Gracias por estar ahí.' }),
    body: [
      brandBar(),
      poster(d.posterUrl || '', d.eventTitle),
      section(ruleLabel(p(lang, { en: 'Recap', fr: 'Récap', es: 'Resumen' })) + `<div style="height:14px"></div>` +
        title(`${hi}${p(lang, { en: 'what a night', fr: 'quelle soirée', es: 'qué noche' })}`, 30) + `<div style="height:14px"></div>` +
        body(p(lang, { en: `Here's <strong style="color:${C.white}">${d.eventTitle}</strong>, your night in numbers. Thanks for being there.`, fr: `Voici <strong style="color:${C.white}">${d.eventTitle}</strong>, ta soirée en chiffres. Merci d'avoir été là.`, es: `Aquí está <strong style="color:${C.white}">${d.eventTitle}</strong>, tu noche en cifras. Gracias por estar ahí.` }))),
      section(infoRows(d.stats)),
      section(ctaPill(p(lang, { en: `See ${d.venueName}`, fr: `Voir ${d.venueName}`, es: `Ver ${d.venueName}` }), d.venueUrl), { border: false }),
      footer({ lang, venueName: d.venueName }),
    ].join(''),
  });
  return { subject, preheader: '', html };
}

// ── 8. Alerte stock bas (audience: owner | fan/waitlist) ───────────────────────
export function buildLowTicketAlert(d: {
  lang?: Lang; audience: 'owner' | 'fan'; eventTitle: string; venueName: string; posterUrl?: string;
  pctSold?: string; meta: string; url: string;
}): BuiltEmail {
  const lang = L(d.lang || 'en');
  if (d.audience === 'owner') {
    const subject = p(lang, { en: `${d.pctSold} sold — ${d.eventTitle}`, fr: `${d.pctSold} vendu — ${d.eventTitle}`, es: `${d.pctSold} vendido — ${d.eventTitle}` });
    const html = shell({
      title: subject,
      preheader: p(lang, { en: 'Your event is heating up.', fr: 'Ton event chauffe.', es: 'Tu evento se calienta.' }),
      body: [
        brandBar(),
        section(ruleLabel(p(lang, { en: 'Sales alert', fr: 'Alerte ventes', es: 'Alerta de ventas' })) + `<div style="height:14px"></div>` +
          title(`${d.pctSold} ${p(lang, { en: 'sold', fr: 'vendu', es: 'vendido' })}`, 34) + `<div style="height:14px"></div>` +
          body(p(lang, { en: `<strong style="color:${C.white}">${d.eventTitle}</strong> is almost full. Time to push the last seats or open a new round.`, fr: `<strong style="color:${C.white}">${d.eventTitle}</strong> est presque complet. Pousse les dernières places ou ouvre un nouveau round.`, es: `<strong style="color:${C.white}">${d.eventTitle}</strong> está casi lleno. Empuja las últimas plazas o abre una nueva ronda.` })), { border: false }),
        section(ctaPill(p(lang, { en: 'Open dashboard', fr: 'Ouvrir le dashboard', es: 'Abrir panel' }), d.url), { border: false }),
        footer({ lang, venueName: d.venueName }),
      ].join(''),
    });
    return { subject, preheader: '', html };
  }
  // fan / waitlist (la personne a rejoint la waitlist de cet event)
  const subject = p(lang, { en: `Almost gone — ${d.eventTitle}`, fr: `Bientôt complet — ${d.eventTitle}`, es: `Casi agotado — ${d.eventTitle}` });
  const html = shell({
    title: subject,
    preheader: `${d.meta} · ${d.venueName}`,
    body: [
      brandBar(),
      poster(d.posterUrl || '', d.eventTitle),
      section(ruleLabel(p(lang, { en: 'Last tickets', fr: 'Derniers billets', es: 'Últimas entradas' })) + `<div style="height:14px"></div>` +
        title(p(lang, { en: 'almost gone', fr: 'bientôt complet', es: 'casi agotado' }), 30) + `<div style="height:14px"></div>` +
        body(p(lang, { en: `<strong style="color:${C.white}">${d.eventTitle}</strong> is nearly sold out. Grab your spot before it's gone.`, fr: `<strong style="color:${C.white}">${d.eventTitle}</strong> est presque complet. Prends ta place avant qu'il soit trop tard.`, es: `<strong style="color:${C.white}">${d.eventTitle}</strong> está casi agotado. Asegura tu lugar antes de que se acabe.` }))),
      section(`${mono(d.meta, C.gray2)}<div style="height:18px"></div>${ctaPill(p(lang, { en: 'Get my ticket', fr: 'Prendre ma place', es: 'Conseguir mi entrada' }), d.url)}`, { border: false }),
      footer({ lang, venueName: d.venueName }),
    ].join(''),
  });
  return { subject, preheader: d.meta, html };
}

// ── 9. Checklist d'avant-soirée (opérationnel, T-2/4h) ────────────────────────
export function buildPreNightChecklist(d: {
  lang?: Lang; firstName?: string; eventTitle: string; venueName: string; posterUrl?: string;
  doorsTime?: string; address?: string; reference: string; ticketUrl: string;
}): BuiltEmail {
  const lang = L(d.lang || 'en');
  const hi = d.firstName ? `${d.firstName}, ` : '';
  const subject = p(lang, { en: `Tonight — ${d.eventTitle}`, fr: `C'est ce soir — ${d.eventTitle}`, es: `Es esta noche — ${d.eventTitle}` });
  const html = shell({
    title: subject,
    preheader: `${d.doorsTime ? d.doorsTime + ' · ' : ''}${d.venueName}${d.address ? ' · ' + d.address : ''}`,
    body: [
      brandBar(),
      poster(d.posterUrl || '', d.eventTitle),
      section(ruleLabel(p(lang, { en: 'Tonight', fr: 'Ce soir', es: 'Esta noche' })) + `<div style="height:14px"></div>` +
        title(`${hi}${p(lang, { en: "it's happening", fr: "c'est maintenant", es: 'ya llega' })}`, 30) + `<div style="height:14px"></div>` +
        body(p(lang, { en: `<strong style="color:${C.white}">${d.eventTitle}</strong> is tonight. Here's everything you need at the door.`, fr: `<strong style="color:${C.white}">${d.eventTitle}</strong>, c'est ce soir. Voici tout ce qu'il te faut à l'entrée.`, es: `<strong style="color:${C.white}">${d.eventTitle}</strong> es esta noche. Esto es todo lo que necesitas en la entrada.` }))),
      section(infoRows([
        ...(d.doorsTime ? [{ k: lbl(lang, 'doors'), v: d.doorsTime }] : []),
        { k: lbl(lang, 'venue'), v: d.venueName },
        ...(d.address ? [{ k: p(lang, { en: 'Address', fr: 'Adresse', es: 'Dirección' }), v: d.address }] : []),
        { k: lbl(lang, 'reference'), v: d.reference },
      ])),
      section(ctaPill(p(lang, { en: 'Open my ticket', fr: 'Ouvrir mon billet', es: 'Abrir mi entrada' }), d.ticketUrl), { border: false }),
      footer({ lang, venueName: d.venueName }),
    ].join(''),
  });
  return { subject, preheader: '', html };
}

// ── 10. Points fidélité post-visite (opérationnel) ────────────────────────────
export function buildPostVisitLoyalty(d: {
  lang?: Lang; firstName?: string; venueName: string; pointsEarned: string; totalPoints: string; tier?: string;
  rewardHint?: string; loyaltyUrl: string;
}): BuiltEmail {
  const lang = L(d.lang || 'en');
  const hi = d.firstName ? `${d.firstName}, ` : '';
  const subject = p(lang, { en: `+${d.pointsEarned} points — ${d.venueName}`, fr: `+${d.pointsEarned} points — ${d.venueName}`, es: `+${d.pointsEarned} puntos — ${d.venueName}` });
  const html = shell({
    title: subject,
    preheader: p(lang, { en: `You're at ${d.totalPoints} points.`, fr: `Tu es à ${d.totalPoints} points.`, es: `Estás en ${d.totalPoints} puntos.` }),
    body: [
      brandBar(),
      section(ruleLabel(p(lang, { en: 'Loyalty', fr: 'Fidélité', es: 'Fidelidad' })) + `<div style="height:14px"></div>` +
        title(`+${d.pointsEarned} ${p(lang, { en: 'points', fr: 'points', es: 'puntos' })}`, 34) + `<div style="height:14px"></div>` +
        body(p(lang, { en: `${hi}thanks for the visit to <strong style="color:${C.white}">${d.venueName}</strong>.${d.rewardHint ? ` ${d.rewardHint}` : ''}`, fr: `${hi}merci pour ta venue chez <strong style="color:${C.white}">${d.venueName}</strong>.${d.rewardHint ? ` ${d.rewardHint}` : ''}`, es: `${hi}gracias por tu visita a <strong style="color:${C.white}">${d.venueName}</strong>.${d.rewardHint ? ` ${d.rewardHint}` : ''}` })), { border: false }),
      section(infoRows([
        { k: p(lang, { en: 'Earned', fr: 'Gagnés', es: 'Ganados' }), v: `+${d.pointsEarned}` },
        { k: p(lang, { en: 'Balance', fr: 'Solde', es: 'Saldo' }), v: d.totalPoints },
        ...(d.tier ? [{ k: p(lang, { en: 'Tier', fr: 'Niveau', es: 'Nivel' }), v: d.tier }] : []),
      ])),
      section(ctaPill(p(lang, { en: 'See my rewards', fr: 'Voir mes récompenses', es: 'Ver mis recompensas' }), d.loyaltyUrl), { border: false }),
      footer({ lang, venueName: d.venueName }),
    ].join(''),
  });
  return { subject, preheader: '', html };
}

// ── 11. Mise à jour d'event (opérationnel, acheteurs) ─────────────────────────
export function buildEventUpdate(d: {
  lang?: Lang; eventTitle: string; venueName: string; updateMessage: string; changes?: Array<{ k: string; v: string }>; eventUrl: string;
}): BuiltEmail {
  const lang = L(d.lang || 'en');
  const subject = p(lang, { en: `Update — ${d.eventTitle}`, fr: `Changement — ${d.eventTitle}`, es: `Cambio — ${d.eventTitle}` });
  const html = shell({
    title: subject,
    preheader: p(lang, { en: 'Important info about your event.', fr: 'Info importante sur ta soirée.', es: 'Info importante sobre tu evento.' }),
    body: [
      brandBar(),
      section(ruleLabel(p(lang, { en: 'Event update', fr: 'Mise à jour', es: 'Actualización' })) + `<div style="height:14px"></div>` +
        title(p(lang, { en: 'heads up', fr: 'à noter', es: 'atención' }), 30) + `<div style="height:14px"></div>` +
        body(`<strong style="color:${C.white}">${d.eventTitle}</strong> — ${d.updateMessage}`), { border: !!d.changes }),
      ...(d.changes && d.changes.length ? [section(infoRows(d.changes))] : []),
      section(ctaPill(p(lang, { en: 'See the event', fr: "Voir l'événement", es: 'Ver el evento' }), d.eventUrl), { border: false }),
      footer({ lang, venueName: d.venueName }),
    ].join(''),
  });
  return { subject, preheader: '', html };
}

// ── 12. Invitation équipe (tous les invite-*) ─────────────────────────────────
export function buildInvitation(d: {
  lang?: Lang; inviterName?: string; orgName: string; roleLabel: string; acceptUrl: string; expiresLabel?: string;
}): BuiltEmail {
  const lang = L(d.lang || 'en');
  const inviter = d.inviterName ? `${d.inviterName} ` : '';
  const subject = p(lang, { en: `Join ${d.orgName} on Yuno`, fr: `Rejoins ${d.orgName} sur Yuno`, es: `Únete a ${d.orgName} en Yuno` });
  const html = shell({
    title: subject,
    preheader: `${lbl(lang, 'role')}: ${d.roleLabel}`,
    body: [
      brandBar(),
      section(ruleLabel(p(lang, { en: 'Invitation', fr: 'Invitation', es: 'Invitación' })) + `<div style="height:16px"></div>` +
        title(p(lang, { en: `Join ${d.orgName}`, fr: `Rejoins ${d.orgName}`, es: `Únete a ${d.orgName}` }), 30) + `<div style="height:16px"></div>` +
        body(p(lang, {
          en: `${inviter}invites you to join <strong style="color:${C.white}">${d.orgName}</strong> on Yuno as <strong style="color:${C.white}">${d.roleLabel}</strong>. Activate your access and step into the dashboard.`,
          fr: `${inviter}t'invite à rejoindre <strong style="color:${C.white}">${d.orgName}</strong> sur Yuno en tant que <strong style="color:${C.white}">${d.roleLabel}</strong>. Active ton accès et entre dans le dashboard.`,
          es: `${inviter}te invita a unirte a <strong style="color:${C.white}">${d.orgName}</strong> en Yuno como <strong style="color:${C.white}">${d.roleLabel}</strong>. Activa tu acceso y entra al panel.`,
        })), { border: false }),
      section(infoRows([
        { k: lbl(lang, 'org'), v: d.orgName },
        { k: lbl(lang, 'role'), v: d.roleLabel },
        ...(d.expiresLabel ? [{ k: lbl(lang, 'validUntil'), v: d.expiresLabel }] : []),
      ])),
      section(ctaPill(p(lang, { en: 'Activate my access', fr: 'Activer mon accès', es: 'Activar mi acceso' }), d.acceptUrl), { border: false }),
      footer({ lang, reason: p(lang, { en: `${inviter || 'a team '}invited you on Yuno`, fr: `${inviter || 'une équipe '}t'a invité sur Yuno`, es: `${inviter || 'un equipo '}te invitó en Yuno` }) }),
    ].join(''),
  });
  return { subject, preheader: `${lbl(lang, 'role')}: ${d.roleLabel}`, html };
}

// ── 13. Création de mot de passe (accept-*) ───────────────────────────────────
export function buildPasswordSetup(d: {
  lang?: Lang; orgName?: string; roleLabel?: string; setupUrl: string;
}): BuiltEmail {
  const lang = L(d.lang || 'en');
  const subject = p(lang, { en: 'Set your Yuno password', fr: 'Crée ton mot de passe Yuno', es: 'Crea tu contraseña Yuno' });
  const html = shell({
    title: subject,
    preheader: p(lang, { en: 'One step to access your account.', fr: 'Une étape pour accéder à ton compte.', es: 'Un paso para acceder a tu cuenta.' }),
    body: [
      brandBar(),
      section(ruleLabel(p(lang, { en: 'Almost there', fr: 'Dernière étape', es: 'Casi listo' })) + `<div style="height:16px"></div>` +
        title(p(lang, { en: 'set your password', fr: 'crée ton mot de passe', es: 'crea tu contraseña' }), 28) + `<div style="height:14px"></div>` +
        body(p(lang, {
          en: `Your access${d.orgName ? ` to <strong style="color:${C.white}">${d.orgName}</strong>` : ''} is ready. Set a password to log in${d.roleLabel ? ` as ${d.roleLabel}` : ''}.`,
          fr: `Ton accès${d.orgName ? ` à <strong style="color:${C.white}">${d.orgName}</strong>` : ''} est prêt. Crée un mot de passe pour te connecter${d.roleLabel ? ` en tant que ${d.roleLabel}` : ''}.`,
          es: `Tu acceso${d.orgName ? ` a <strong style="color:${C.white}">${d.orgName}</strong>` : ''} está listo. Crea una contraseña para entrar${d.roleLabel ? ` como ${d.roleLabel}` : ''}.`,
        })), { border: false }),
      section(ctaPill(p(lang, { en: 'Set my password', fr: 'Créer mon mot de passe', es: 'Crear mi contraseña' }), d.setupUrl), { border: false }),
      footer({ lang }),
    ].join(''),
  });
  return { subject, preheader: '', html };
}

// ── 13b. Lien sécurisé générique (email-change, reset PIN par lien, recovery) ──
// Copie déjà localisée par l'appelant (title/message/ctaLabel) ; lang sert au chrome.
export function buildSecureLink(d: {
  lang?: Lang; title: string; message: string; ctaLabel: string; ctaUrl: string; footnote?: string;
}): BuiltEmail {
  const lang = L(d.lang || 'en');
  const html = shell({
    title: d.title,
    preheader: d.message.replace(/<[^>]+>/g, '').slice(0, 90),
    body: [
      brandBar(),
      section(ruleLabel(p(lang, { en: 'Security', fr: 'Sécurité', es: 'Seguridad' })) + `<div style="height:16px"></div>` +
        title(d.title, 26) + `<div style="height:14px"></div>` + body(d.message), { border: false }),
      section(ctaPill(d.ctaLabel, d.ctaUrl), { border: false, padTop: 4 }),
      ...(d.footnote ? [section(body(d.footnote, C.gray2), { border: false, padTop: 4 })] : []),
      footer({ lang }),
    ].join(''),
  });
  return { subject: d.title, preheader: '', html };
}

// ── 14. Code de vérification (OTP / reset PIN / MFA / recovery) — SÉCURITÉ ─────
export function buildOtp(d: {
  lang?: Lang; code: string; purposeLabel?: string; expiresMin?: number; context?: string;
}): BuiltEmail {
  const lang = L(d.lang || 'en');
  const purpose = d.purposeLabel || p(lang, { en: 'Your verification code', fr: 'Ton code de vérification', es: 'Tu código de verificación' });
  const exp = d.expiresMin || 10;
  const subject = p(lang, { en: `Your Yuno code: ${d.code}`, fr: `Ton code Yuno : ${d.code}`, es: `Tu código Yuno: ${d.code}` });
  const html = shell({
    title: p(lang, { en: 'Your Yuno code', fr: 'Ton code Yuno', es: 'Tu código Yuno' }),
    preheader: p(lang, { en: `${d.code} — expires in ${exp} min. Never share it.`, fr: `${d.code} — expire dans ${exp} min. Ne le partage jamais.`, es: `${d.code} — caduca en ${exp} min. No lo compartas.` }),
    body: [
      brandBar(),
      section(ruleLabel(p(lang, { en: 'Security', fr: 'Sécurité', es: 'Seguridad' })) + `<div style="height:16px"></div>` +
        title(purpose, 28) + `<div style="height:14px"></div>` +
        body(`${d.context ? esc_inline(d.context) + ' ' : ''}${p(lang, { en: `It expires in <strong style="color:${C.white}">${exp} minutes</strong>.`, fr: `Il expire dans <strong style="color:${C.white}">${exp} minutes</strong>.`, es: `Caduca en <strong style="color:${C.white}">${exp} minutos</strong>.` })}`), { border: false }),
      section(codeBlock(d.code, p(lang, { en: 'Your code', fr: 'Ton code', es: 'Tu código' })), { border: false, padTop: 4 }),
      section(body(p(lang, {
        en: `Didn't request this? Ignore this email, your account is safe. <strong style="color:${C.white}">Never share this code.</strong>`,
        fr: `Tu n'es pas à l'origine de cette demande ? Ignore cet email, ton compte reste sûr. <strong style="color:${C.white}">Ne partage jamais ce code.</strong>`,
        es: `¿No lo solicitaste? Ignora este correo, tu cuenta está segura. <strong style="color:${C.white}">No compartas nunca este código.</strong>`,
      }), C.gray2), { border: false, padTop: 4 }),
      footer({ lang }),
    ].join(''),
  });
  return { subject, preheader: '', html };
}
function esc_inline(s: string): string { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ── 15. Place dispo / billets ouverts (waitlist — opérationnel) ───────────────
export function buildWaitlistOpen(d: {
  lang?: Lang; eventTitle: string; venueName: string; posterUrl?: string; meta: string; url: string;
}): BuiltEmail {
  const lang = L(d.lang || 'en');
  const subject = p(lang, { en: `A spot opened — ${d.eventTitle}`, fr: `Une place s'est libérée — ${d.eventTitle}`, es: `Se liberó un lugar — ${d.eventTitle}` });
  const html = shell({
    title: subject,
    preheader: `${d.meta} · ${d.venueName}`,
    body: [
      brandBar(),
      poster(d.posterUrl || '', d.eventTitle),
      section(ruleLabel(p(lang, { en: 'Waitlist', fr: 'Liste d\'attente', es: 'Lista de espera' })) + `<div style="height:14px"></div>` +
        title(p(lang, { en: "you're in", fr: 'à toi de jouer', es: 'es tu turno' }), 30) + `<div style="height:14px"></div>` +
        body(p(lang, { en: `Tickets just opened for <strong style="color:${C.white}">${d.eventTitle}</strong>. You're on the waitlist — grab yours before they're gone.`, fr: `Les billets viennent de s'ouvrir pour <strong style="color:${C.white}">${d.eventTitle}</strong>. Tu es sur la liste d'attente — prends le tien avant qu'il parte.`, es: `Las entradas se acaban de abrir para <strong style="color:${C.white}">${d.eventTitle}</strong>. Estás en la lista de espera — consigue la tuya antes de que se agoten.` }))),
      section(`${mono(d.meta, C.gray2)}<div style="height:18px"></div>${ctaPill(p(lang, { en: 'Get my ticket', fr: 'Prendre ma place', es: 'Conseguir mi entrada' }), d.url)}`, { border: false }),
      footer({ lang, venueName: d.venueName }),
    ].join(''),
  });
  return { subject, preheader: d.meta, html };
}

// ── 16. Proposition de co-production (split, organizers) ──────────────────────
export function buildSplitProposal(d: {
  lang?: Lang; fromOrg: string; eventTitle: string; terms?: Array<{ k: string; v: string }>; reviewUrl: string;
}): BuiltEmail {
  const lang = L(d.lang || 'en');
  const subject = p(lang, { en: `Co-pro proposal — ${d.eventTitle}`, fr: `Proposition de co-prod — ${d.eventTitle}`, es: `Propuesta de coproducción — ${d.eventTitle}` });
  const html = shell({
    title: subject,
    preheader: p(lang, { en: `${d.fromOrg} wants to team up.`, fr: `${d.fromOrg} veut s'associer.`, es: `${d.fromOrg} quiere asociarse.` }),
    body: [
      brandBar(),
      section(ruleLabel(p(lang, { en: 'Co-production', fr: 'Co-production', es: 'Coproducción' })) + `<div style="height:16px"></div>` +
        title(p(lang, { en: 'let\'s team up', fr: 'on s\'associe ?', es: '¿nos asociamos?' }), 28) + `<div style="height:14px"></div>` +
        body(p(lang, { en: `<strong style="color:${C.white}">${d.fromOrg}</strong> proposes a co-production on <strong style="color:${C.white}">${d.eventTitle}</strong>. Review the terms and respond.`, fr: `<strong style="color:${C.white}">${d.fromOrg}</strong> te propose une co-production sur <strong style="color:${C.white}">${d.eventTitle}</strong>. Étudie les termes et réponds.`, es: `<strong style="color:${C.white}">${d.fromOrg}</strong> te propone una coproducción en <strong style="color:${C.white}">${d.eventTitle}</strong>. Revisa los términos y responde.` })), { border: !!d.terms }),
      ...(d.terms && d.terms.length ? [section(infoRows(d.terms))] : []),
      section(ctaPill(p(lang, { en: 'Review the proposal', fr: 'Étudier la proposition', es: 'Revisar la propuesta' }), d.reviewUrl), { border: false }),
      footer({ lang }),
    ].join(''),
  });
  return { subject, preheader: '', html };
}

// ── 17. Remboursement (owner-refund / staff-cancel) ──────────────────────────
export function buildRefund(d: {
  lang?: Lang; firstName?: string; eventTitle?: string; venueName: string; amount: string; reference?: string; reason?: string;
}): BuiltEmail {
  const lang = L(d.lang || 'en');
  const hi = d.firstName ? `${d.firstName}, ` : '';
  const subject = p(lang, { en: `Refund issued — ${d.amount}`, fr: `Remboursement effectué — ${d.amount}`, es: `Reembolso emitido — ${d.amount}` });
  const html = shell({
    title: subject,
    preheader: p(lang, { en: `${d.amount} is on its way back to you.`, fr: `${d.amount} repart vers ton compte.`, es: `${d.amount} vuelve a tu cuenta.` }),
    body: [
      brandBar(),
      section(ruleLabel(p(lang, { en: 'Refund', fr: 'Remboursement', es: 'Reembolso' })) + `<div style="height:14px"></div>` +
        title(p(lang, { en: 'refund issued', fr: 'remboursement effectué', es: 'reembolso emitido' }), 28) + `<div style="height:14px"></div>` +
        body(p(lang, {
          en: `${hi}we've refunded <strong style="color:${C.white}">${d.amount}</strong>${d.eventTitle ? ` for ${d.eventTitle}` : ''}. It lands back on your card within 5–10 business days.${d.reason ? ` Reason: ${d.reason}.` : ''}`,
          fr: `${hi}nous t'avons remboursé <strong style="color:${C.white}">${d.amount}</strong>${d.eventTitle ? ` pour ${d.eventTitle}` : ''}. Le montant revient sur ta carte sous 5 à 10 jours ouvrés.${d.reason ? ` Motif : ${d.reason}.` : ''}`,
          es: `${hi}te hemos reembolsado <strong style="color:${C.white}">${d.amount}</strong>${d.eventTitle ? ` por ${d.eventTitle}` : ''}. Vuelve a tu tarjeta en 5–10 días hábiles.${d.reason ? ` Motivo: ${d.reason}.` : ''}`,
        })), { border: true }),
      section(infoRows([
        { k: lbl(lang, 'amount'), v: d.amount },
        ...(d.eventTitle ? [{ k: lbl(lang, 'event'), v: d.eventTitle }] : []),
        ...(d.reference ? [{ k: lbl(lang, 'reference'), v: d.reference }] : []),
      ]), { border: false }),
      footer({ lang, venueName: d.venueName }),
    ].join(''),
  });
  return { subject, preheader: '', html };
}

// ── Données mock pour les previews (rendu FR) ─────────────────────────────────
const POSTER = 'https://fulawxvdlwtdlpkycixe.supabase.co/storage/v1/object/public/event-images/events/1781542670364-poster.jpg';
export const PREVIEW_SAMPLES: Record<string, () => BuiltEmail> = {
  ticket: () => buildTicketConfirmation({ lang: 'fr', firstName: 'Paul', eventTitle: 'Yuno Boat Party Seine', venueName: 'Night Square', posterUrl: POSTER, day: '22', month: 'Juin 2026', openTime: '18:00', city: 'Paris', ticketType: 'Early Bird', price: '18,00 €', reference: 'TK-7F3K9P', ticketUrl: `${APP}/tickets`, qrDataUrl: 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=YUNO-DEMO-TK-7F3K9P' }),
  vip: () => buildVipConfirmation({ lang: 'fr', firstName: 'Paul', eventTitle: 'Yuno Boat Party Seine', venueName: 'Night Square', posterUrl: POSTER, day: '22', month: 'Juin 2026', arrivalTime: '23:00', tableName: 'Carré VIP — Pont supérieur', guests: '6 personnes', bottles: '2 × Grey Goose', total: '890,00 €', reference: 'VP-2M8X4Q', manageUrl: `${APP}/reservations`, qrDataUrl: 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=YUNO-DEMO-VP-2M8X4Q' }),
  order: () => buildOrderConfirmation({ lang: 'fr', firstName: 'Paul', venueName: 'Night Square', items: [{ k: '2 × Mojito', v: '24,00 €' }, { k: '1 × Red Bull', v: '6,00 €' }], total: '30,00 €', reference: 'OR-9920XB', pickupInfo: 'Récupère au bar avec ta référence.', orderUrl: `${APP}/orders` }),
  winback: () => buildWinBack({ lang: 'fr', firstName: 'Paul', pastEventTitle: 'Techno Sundays #12', venueName: 'Night Square', posterUrl: POSTER, attendeeCount: '340', nextEvent: { title: 'Yuno Boat Party Seine', meta: '22 Juin · 18:00 · Paris', url: `${APP}/event/demo`, img: POSTER }, venueUrl: `${APP}/club/night-square`, unsubscribeUrl: `${APP}/unsubscribe?token=demo`, recipientEmail: 'paul.brisebois.pro@gmail.com' }),
  upsell: () => buildUpsell({ lang: 'fr', firstName: 'Paul', eventTitle: 'Yuno Boat Party Seine', venueName: 'Night Square', vipEnabled: true, venueUrl: `${APP}/club/night-square`, unsubscribeUrl: `${APP}/unsubscribe?token=demo`, recipientEmail: 'paul.brisebois.pro@gmail.com' }),
  nextEventRec: () => buildNextEventRec({ lang: 'fr', firstName: 'Paul', events: [{ title: 'Yuno Boat Party Seine', meta: '22 Juin · Paris · Techno', url: `${APP}/event/1`, img: POSTER }, { title: 'Rooftop Sunset Sessions', meta: '28 Juin · Paris · House', url: `${APP}/event/2` }], unsubscribeUrl: `${APP}/unsubscribe?token=demo`, recipientEmail: 'paul.brisebois.pro@gmail.com' }),
  eventRecap: () => buildEventRecap({ lang: 'fr', firstName: 'Paul', eventTitle: 'Techno Sundays #12', venueName: 'Night Square', posterUrl: POSTER, stats: [{ k: 'Tes dépenses', v: '64,00 €' }, { k: 'Points gagnés', v: '+120' }, { k: 'Présents', v: '340' }], venueUrl: `${APP}/club/night-square` }),
  lowTicketOwner: () => buildLowTicketAlert({ lang: 'fr', audience: 'owner', eventTitle: 'Yuno Boat Party Seine', venueName: 'Night Square', pctSold: '85%', meta: '', url: `${APP}/owner` }),
  lowTicketFan: () => buildLowTicketAlert({ lang: 'fr', audience: 'fan', eventTitle: 'Yuno Boat Party Seine', venueName: 'Night Square', posterUrl: POSTER, meta: '22 Juin · 18:00 · Paris', url: `${APP}/event/demo` }),
  preNight: () => buildPreNightChecklist({ lang: 'fr', firstName: 'Paul', eventTitle: 'Yuno Boat Party Seine', venueName: 'Night Square', posterUrl: POSTER, doorsTime: '18:00', address: 'Port de la Bourdonnais, Paris', reference: 'TK-7F3K9P', ticketUrl: `${APP}/tickets` }),
  postVisit: () => buildPostVisitLoyalty({ lang: 'fr', firstName: 'Paul', venueName: 'Night Square', pointsEarned: '120', totalPoints: '1 240', tier: 'Gold', rewardHint: 'Plus que 260 points avant ta prochaine récompense.', loyaltyUrl: `${APP}/loyalty` }),
  eventUpdate: () => buildEventUpdate({ lang: 'fr', eventTitle: 'Yuno Boat Party Seine', venueName: 'Night Square', updateMessage: "l'heure d'ouverture passe à 19:00.", changes: [{ k: 'Nouvelle ouverture', v: '19:00' }, { k: 'Lieu', v: 'inchangé' }], eventUrl: `${APP}/event/demo` }),
  invitation: () => buildInvitation({ lang: 'fr', inviterName: 'Night Square', orgName: 'Night Square', roleLabel: 'Manager', acceptUrl: `${APP}/accept`, expiresLabel: '29 Juin 2026' }),
  passwordSetup: () => buildPasswordSetup({ lang: 'fr', orgName: 'Night Square', roleLabel: 'Barman', setupUrl: `${APP}/set-password` }),
  otp: () => buildOtp({ lang: 'fr', code: '482190', purposeLabel: 'Réinitialise ton PIN', expiresMin: 10, context: 'Tu as demandé à réinitialiser ton code PIN staff.' }),
  waitlistOpen: () => buildWaitlistOpen({ lang: 'fr', eventTitle: 'Yuno Boat Party Seine', venueName: 'Night Square', posterUrl: POSTER, meta: '22 Juin · 18:00 · Paris', url: `${APP}/event/demo` }),
  splitProposal: () => buildSplitProposal({ lang: 'fr', fromOrg: 'Collectif Aurora', eventTitle: 'Yuno Boat Party Seine', terms: [{ k: 'Part Aurora', v: '40%' }, { k: 'Ta part', v: '60%' }], reviewUrl: `${APP}/owner/partnerships` }),
  refund: () => buildRefund({ lang: 'fr', firstName: 'Paul', eventTitle: 'Yuno Boat Party Seine', venueName: 'Night Square', amount: '18,00 €', reference: 'TK-7F3K9P', reason: 'soirée annulée' }),
};
