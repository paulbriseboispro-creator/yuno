/**
 * Les mots de l'ESPACE INVITÉ d'une soirée (club ou organisation invités en
 * collab) — UNE famille de clés, `guestSpace.*` : l'espace /h/<jeton>, l'email
 * d'accès, le message WhatsApp, et l'écran de l'organisateur qui l'ouvre.
 *
 * Nom choisi par Paul (21/10) : le rôle / l'accès s'appelle « Invité » (EN
 * Guest, ES Invitado), la page reste « Espace invité » (Guest space, Espacio
 * de invitado).
 *
 * Module pur, sans import : lu tel quel par les edge functions et par le front
 * (`src/lib/guestSpace.ts`). L'espace parle la langue CHOISIE PAR
 * L'ORGANISATEUR (`event_guest_passes.language`). La Console, elle, parle la
 * langue de son écran. Triplets [EN, FR, ES].
 */

export const GUEST_SPACE_LANGUAGES = ['en', 'fr', 'es'] as const;
export type GuestSpaceLanguage = (typeof GUEST_SPACE_LANGUAGES)[number];

export function toGuestSpaceLanguage(value: unknown, fallback: GuestSpaceLanguage = 'en'): GuestSpaceLanguage {
  return value === 'en' || value === 'fr' || value === 'es' ? value : fallback;
}

export function guestSpaceLocale(lang: GuestSpaceLanguage): string {
  return lang === 'en' ? 'en-GB' : lang === 'es' ? 'es-ES' : 'fr-FR';
}

const INDEX: Record<GuestSpaceLanguage, 0 | 1 | 2> = { en: 0, fr: 1, es: 2 };

const WORDS = {
  // ── Nom : « Invité » (décision de Paul, 21/10) ─────────────────────────────
  'guestSpace.name': [
    "Guest",
    "Invité",
    "Invitado",
  ],
  'guestSpace.nameHint': [
    "follows the night with a Yuno account",
    "suit la soirée avec un compte Yuno",
    "sigue la noche con una cuenta Yuno",
  ],

  // ── Coquille de l'espace ───────────────────────────────────────────────────
  'guestSpace.shell.invitedOn': ['Invited on 1 night', 'Invité sur 1 soirée', 'Invitado a 1 noche'],
  'guestSpace.shell.nightOf': ['{org}’s night at {place}', 'Soirée de {org} chez {place}', 'Noche de {org} en {place}'],
  'guestSpace.shell.ledBy': ['run by {org}', 'menée par {org}', 'organizada por {org}'],
  'guestSpace.shell.private': ['Private page', 'Page privée', 'Página privada'],
  'guestSpace.shell.phase.before': ['D-{n}', 'J-{n}', 'D-{n}'],
  'guestSpace.shell.phase.today': ['Tonight', 'Ce soir', 'Esta noche'],
  'guestSpace.shell.phase.live': ['On now', 'En cours', 'En curso'],
  'guestSpace.shell.phase.after': ['Over', 'Terminée', 'Terminada'],
  'guestSpace.shell.phase.cancelled': ['Cancelled', 'Annulée', 'Cancelada'],
  'guestSpace.shell.deal.contract': ['Yuno contract · transfer', 'Contrat Yuno · virement', 'Contrato Yuno · transferencia'],
  'guestSpace.bell.title': ['Notifications', 'Notifications', 'Notificaciones'],
  'guestSpace.bell.empty': ['Nothing new for now.', 'Rien de nouveau pour l’instant.', 'Nada nuevo por ahora.'],
  'guestSpace.bell.markRead': ['Mark all as read', 'Tout marquer comme lu', 'Marcar todo como leído'],
  'guestSpace.bell.contract': ['{org} proposes you a contract for the night', '{org} te propose un contrat pour la soirée', '{org} te propone un contrato para la noche'],
  'guestSpace.bell.contractChanged': ['{org} changed the terms of the contract (version {n})', '{org} a changé les termes du contrat (version {n})', '{org} ha cambiado las condiciones del contrato (versión {n})'],
  'guestSpace.bell.contractSigned': [
    "Contract signed by both sides",
    "Contrat signé par les deux parties",
    "Contrato firmado por ambas partes",
  ],
  'guestSpace.bell.frozen': [
    "The statement is ready to check: your share is {amount}",
    "Le décompte est prêt à vérifier : ta part est de {amount}",
    "La liquidación está lista para revisar: tu parte es de {amount}",
  ],
  'guestSpace.bell.transferSent': [
    "{org} sent your transfer: confirm it when you receive it",
    "{org} a viré ta part : confirme-le à réception",
    "{org} ha transferido tu parte: confírmalo al recibirla",
  ],
  'guestSpace.bell.transferReceived': ['You confirmed the transfer', 'Tu as confirmé le virement', 'Has confirmado la transferencia'],
  'guestSpace.bell.statementReady': ['The statement is ready: approve or dispute it', 'Le décompte est prêt : valide-le ou conteste-le', 'La liquidación está lista: valídala o impúgnala'],
  'guestSpace.bell.staffAccepted': ['{name} accepted the door invitation', '{name} a accepté l’invitation à la porte', '{name} ha aceptado la invitación a la puerta'],
  'guestSpace.bell.staffAdded': ['{org} invited {name} to your door', '{org} a invité {name} à ta porte', '{org} ha invitado a {name} a tu puerta'],
  'guestSpace.bell.todo': ['To do', 'À faire', 'Por hacer'],
  'guestSpace.lang.label': ['Language', 'Langue', 'Idioma'],
  'guestSpace.shell.deal.toSign': ['Contract to sign', 'Contrat à signer', 'Contrato por firmar'],
  'guestSpace.shell.deal.external': ['Settled between you', 'Réglé entre vous', 'Lo arregláis entre vosotros'],
  'guestSpace.shell.convertLine': [
    'Your own nights on Yuno: tickets, VIP tables, guest list.',
    'Tes propres soirées sur Yuno : billets, tables VIP, guest list.',
    'Tus propias noches en Yuno: entradas, mesas VIP, guest list.',
  ],
  'guestSpace.shell.convertCta': ['Open the account of {name}', 'Ouvrir le compte de {name}', 'Abrir la cuenta de {name}'],
  'guestSpace.shell.claimed': ['{name} is on Yuno', '{name} est sur Yuno', '{name} está en Yuno'],
  'guestSpace.shell.openConsole': ['Open my Console', 'Ouvrir ma Console', 'Abrir mi Consola'],
  'guestSpace.shell.teamNote': [
    'You are viewing this space as the organizer: your visits are not counted.',
    'Tu regardes cet espace en tant qu’organisateur : tes visites ne sont pas comptées.',
    'Ves este espacio como organizador: tus visitas no se cuentan.',
  ],
  'guestSpace.shell.updated': ['Updated {time}', 'Mis à jour à {time}', 'Actualizado a las {time}'],
  'guestSpace.shell.over': ['Night over.', 'Soirée terminée.', 'Noche terminada.'],

  // ── Onglets ────────────────────────────────────────────────────────────────
  'guestSpace.tab.home': ['Overview', 'Vue d’ensemble', 'Resumen'],
  'guestSpace.tab.sales': ['Sales', 'Ventes', 'Ventas'],
  'guestSpace.tab.mkt': ['Marketing', 'Marketing', 'Marketing'],
  'guestSpace.tab.money': ['Money', 'Argent', 'Dinero'],
  'guestSpace.tab.door': ['Door', 'Porte', 'Puerta'],
  'guestSpace.tab.info': ['Info & contract', 'Infos & contrat', 'Info y contrato'],
  'guestSpace.tag.toCheck': ['To check', 'À valider', 'A validar'],
  'guestSpace.tag.live': ['Live', 'En direct', 'En directo'],

  // ── Vue d'ensemble ─────────────────────────────────────────────────────────
  'guestSpace.home.salesTitle': ['Sales of the night', 'Ventes de la soirée', 'Ventas de la noche'],
  'guestSpace.home.ticketsSold': ['tickets sold', 'billets vendus', 'entradas vendidas'],
  'guestSpace.home.caHint': ['night revenue, excluding Yuno fees', 'CA de la soirée, hors frais Yuno', 'facturación de la noche, sin comisiones de Yuno'],
  'guestSpace.home.today': ['▲ {n} today', '▲ {n} aujourd’hui', '▲ {n} hoy'],
  'guestSpace.chart.perDay': ['tickets / day', 'billets / jour', 'entradas / día'],
  'guestSpace.chart.cumul': ['total', 'cumul', 'acumulado'],
  'guestSpace.chart.table': ['table booked', 'table réservée', 'mesa reservada'],
  'guestSpace.chart.dayJ': ['Night', 'Jour J', 'Día D'],
  'guestSpace.chart.dMinus': ['D-{n}', 'J-{n}', 'D-{n}'],
  'guestSpace.chart.upcoming': ['to come', 'à venir', 'por venir'],
  'guestSpace.chart.aria': ['Tickets sold per day and total', 'Billets vendus par jour et cumul', 'Entradas vendidas por día y acumulado'],
  'guestSpace.home.where': ['Where the night stands', 'Où en est la soirée', 'Cómo va la noche'],
  'guestSpace.home.detail': ['Sales detail', 'Détail des ventes', 'Detalle de ventas'],
  'guestSpace.kpi.tickets': ['Tickets', 'Billets', 'Entradas'],
  'guestSpace.kpi.ticketsOf': ['of {cap} · {n} on sale', 'sur {cap} · {n} en vente', 'de {cap} · {n} a la venta'],
  'guestSpace.kpi.ticketsOpen': ['{n} on sale', '{n} en vente', '{n} a la venta'],
  'guestSpace.kpi.tables': ['VIP tables', 'Tables VIP', 'Mesas VIP'],
  'guestSpace.kpi.tablesHint': ['{amount} of bookings', '{amount} de réservations', '{amount} en reservas'],
  'guestSpace.kpi.tablesGuests': ['{n} guests', '{n} convives', '{n} invitados'],
  'guestSpace.kpi.guestList': ['Guest list', 'Guest list', 'Guest list'],
  'guestSpace.kpi.guestListMine': ['of which {n} on your share', 'dont {n} sur ta part', '{n} en tu parte'],
  'guestSpace.kpi.expected': ['Expected', 'Attendus', 'Previstos'],
  'guestSpace.kpi.expectedHint': ['tickets + tables + guest list', 'billets + tables + guest list', 'entradas + mesas + guest list'],
  'guestSpace.kpi.entries': ['Entries', 'Entrées', 'Entradas'],
  'guestSpace.kpi.entriesOf': ['of {n} expected', 'sur {n} attendus', 'de {n} previstos'],
  'guestSpace.home.myShare': ['Your share', 'Ta part', 'Tu parte'],
  'guestSpace.home.figures': ['The night’s figures', 'Les chiffres de la soirée', 'Las cifras de la noche'],
  'guestSpace.home.shareLive': ['If the night stopped now.', 'Si la soirée s’arrêtait maintenant.', 'Si la noche terminara ahora.'],
  'guestSpace.home.shareFrozen': ['Statement frozen, to check.', 'Décompte figé, à vérifier.', 'Liquidación cerrada, por verificar.'],
  'guestSpace.home.shareExternal': ['Settled between you: Yuno shows, pays nothing.', 'Réglé entre vous : Yuno affiche, ne verse rien.', 'Lo arregláis entre vosotros: Yuno muestra, no paga nada.'],
  'guestSpace.home.shareDeclared': [
    'Share agreed with {org}: indicative, Yuno pays nothing.',
    'Part convenue avec {org} : indicatif, Yuno ne verse rien.',
    'Parte acordada con {org}: indicativo, Yuno no paga nada.',
  ],
  'guestSpace.home.shareHidden': [
    '{org} does not share the amounts of this night.',
    '{org} ne partage pas les montants de cette soirée.',
    '{org} no comparte los importes de esta noche.',
  ],
  'guestSpace.home.shareRule': ['{t} % of net ticket sales + {b} % of tables', '{t} % du net des billets + {b} % des tables', '{t} % del neto de entradas + {b} % de mesas'],
  'guestSpace.home.goMoney': ['Money', 'Argent', 'Dinero'],

  // ── Qui fait vendre ────────────────────────────────────────────────────────
  'guestSpace.who.title': ['Who drives sales', 'Qui fait vendre', 'Quién vende'],
  'guestSpace.who.sub': ['Tickets by sales link of each party.', 'Billets par lien de vente de chaque partie.', 'Entradas por enlace de venta de cada parte.'],
  'guestSpace.who.partyHint': ['their tracked links and their promoters’', 'ses liens suivis et ceux de ses promoteurs', 'sus enlaces y los de sus promotores'],
  'guestSpace.who.me': ['{name} · you', '{name} · toi', '{name} · tú'],
  'guestSpace.who.meHint': ['your tracked links', 'tes liens suivis', 'tus enlaces'],
  'guestSpace.who.guestHint': ['their tracked links', 'ses liens suivis', 'sus enlaces'],
  'guestSpace.who.yuno': ['Yuno', 'Yuno', 'Yuno'],
  'guestSpace.who.yunoHint': ['Explore, app and Yuno search', 'Explore, app et recherche Yuno', 'Explore, app y búsqueda Yuno'],
  'guestSpace.who.direct': ['Direct', 'Direct', 'Directo'],
  'guestSpace.who.directHint': ['untracked link, typed address', 'lien sans suivi, adresse tapée', 'enlace sin seguimiento, dirección escrita'],
  'guestSpace.who.rule': [
    'How Yuno attributes a sale. A tracked link of {org} or one of its promoters: {org}. One of your tracked links: you. Arrived from Yuno (Explore, the app, search): Yuno. The night’s link without tracking, or a typed address: Direct. It is an attribution: the money follows the agreement.',
    'Comment Yuno attribue une vente. Un lien suivi de {org} ou d’un de ses promoteurs : {org}. Un de tes liens suivis : toi. Arrivé depuis Yuno (Explore, l’app, la recherche) : Yuno. Le lien de la soirée sans suivi, ou l’adresse tapée : Direct. C’est une attribution : l’argent suit l’accord.',
    'Cómo atribuye Yuno una venta. Un enlace de {org} o de uno de sus promotores: {org}. Uno de tus enlaces: tú. Llegado desde Yuno (Explore, la app, la búsqueda): Yuno. El enlace de la noche sin seguimiento, o la dirección escrita: Directo. Es una atribución: el dinero sigue el acuerdo.',
  ],
  'guestSpace.who.myLinks': ['My sales links', 'Mes liens de vente', 'Mis enlaces de venta'],
  'guestSpace.who.empty': ['No sale yet.', 'Pas encore de vente.', 'Aún no hay ventas.'],

  // ── Ventes ─────────────────────────────────────────────────────────────────
  'guestSpace.sales.evolution': ['Trend', 'Évolution', 'Evolución'],
  'guestSpace.sales.evolutionSub': ['Tickets per day and total since opening.', 'Billets par jour et cumul depuis l’ouverture.', 'Entradas por día y acumulado desde la apertura.'],
  'guestSpace.sales.sub.tickets': ['Tickets', 'Billets', 'Entradas'],
  'guestSpace.sales.sub.tables': ['VIP tables', 'Tables VIP', 'Mesas VIP'],
  'guestSpace.sales.sub.gl': ['Guest list', 'Guest list', 'Guest list'],
  'guestSpace.sales.sub.who': ['Who drives sales', 'Qui fait vendre', 'Quién vende'],
  'guestSpace.sales.col.tier': ['Ticket', 'Tarif', 'Tarifa'],
  'guestSpace.sales.col.price': ['Price', 'Prix', 'Precio'],
  'guestSpace.sales.col.sold': ['Sold', 'Vendus', 'Vendidas'],
  'guestSpace.sales.col.ca': ['Revenue', 'CA', 'Facturación'],
  'guestSpace.sales.col.status': ['Status', 'État', 'Estado'],
  'guestSpace.sales.col.pack': ['Package', 'Formule', 'Fórmula'],
  'guestSpace.sales.col.booked': ['Booked', 'Réservées', 'Reservadas'],
  'guestSpace.sales.total': ['Total', 'Total', 'Total'],
  'guestSpace.sales.status.on_sale': ['On sale', 'En vente', 'A la venta'],
  'guestSpace.sales.status.sold_out': ['Sold out', 'Épuisé', 'Agotado'],
  'guestSpace.sales.status.upcoming': ['Soon', 'Bientôt', 'Pronto'],
  'guestSpace.sales.status.closed': ['Closed', 'Fermé', 'Cerrado'],
  'guestSpace.sales.free': ['Free', 'Gratuit', 'Gratis'],
  'guestSpace.sales.noTickets': ['No ticket on sale for this night.', 'Aucun billet en vente pour cette soirée.', 'Ninguna entrada a la venta para esta noche.'],
  'guestSpace.sales.noTables': ['No VIP table for this night.', 'Pas de table VIP pour cette soirée.', 'No hay mesas VIP para esta noche.'],
  'guestSpace.sales.tablesNote': [
    'The customer’s name and the seating stay with {org}. You see the number of tables and guests.',
    'Le nom du client et le placement restent chez {org}. Tu vois le nombre de tables et de convives.',
    'El nombre del cliente y la ubicación se quedan en {org}. Ves el número de mesas e invitados.',
  ],

  // ── Guest list ─────────────────────────────────────────────────────────────
  'guestSpace.gl.myShare': [
    '{org} gave you a share of {n} places. Add your guests; for more places, ask {org}.',
    '{org} t’a donné une part de {n} places. Tu y ajoutes tes invités ; pour plus de places, demande-les à {org}.',
    '{org} te ha dado una parte de {n} plazas. Añade a tus invitados; para más plazas, pídeselas a {org}.',
  ],
  'guestSpace.gl.noShare': [
    '{org} hasn’t given you a guest list share yet. Ask them for places.',
    '{org} ne t’a pas encore donné de part de guest list. Demande-lui des places.',
    '{org} aún no te ha dado una parte de la guest list. Pídele plazas.',
  ],
  'guestSpace.gl.part': ['{name} share', 'Part {name}', 'Parte {name}'],
  'guestSpace.gl.partMine': ['{name} share · you', 'Part {name} · toi', 'Parte {name} · tú'],
  'guestSpace.gl.partLine': ['{n} registered of {cap} places', '{n} inscrits sur {cap} places', '{n} inscritos de {cap} plazas'],
  'guestSpace.gl.partLineOpen': ['{n} registered', '{n} inscrits', '{n} inscritos'],
  'guestSpace.gl.partEntered': ['{n} in', '{n} entrés', '{n} entraron'],
  'guestSpace.gl.myGuests': ['Your guests', 'Tes invités', 'Tus invitados'],
  'guestSpace.gl.namePh': ['First and last name', 'Prénom et nom', 'Nombre y apellido'],
  'guestSpace.gl.plusPh': ['+ companions', '+ accompagnants', '+ acompañantes'],
  'guestSpace.gl.add': ['Add', 'Ajouter', 'Añadir'],
  'guestSpace.gl.added': ['Guest added to your share', 'Invité ajouté à ta part', 'Invitado añadido a tu parte'],
  'guestSpace.gl.remove': ['Remove', 'Retirer', 'Quitar'],
  'guestSpace.gl.entered': ['In', 'Entré', 'Entró'],
  'guestSpace.gl.left': ['{n} places left', '{n} places restantes', '{n} plazas libres'],
  'guestSpace.gl.ask': ['Ask {org} for more places', 'Demander plus de places à {org}', 'Pedir más plazas a {org}'],
  'guestSpace.gl.askN': ['How many places?', 'Combien de places ?', '¿Cuántas plazas?'],
  'guestSpace.gl.askSend': ['Send the request', 'Envoyer la demande', 'Enviar la solicitud'],
  'guestSpace.gl.asked': ['Request sent: {n} places', 'Demande envoyée : {n} places', 'Solicitud enviada: {n} plazas'],

  // ── Marketing ──────────────────────────────────────────────────────────────
  'guestSpace.mkt.title': ['Your sales links', 'Tes liens de vente', 'Tus enlaces de venta'],
  'guestSpace.mkt.sub': [
    'Links in your name for this night. Every ticket sold through one of them counts for {name}.',
    'Liens à ton nom pour cette soirée. Chaque billet vendu par l’un d’eux est compté pour {name}.',
    'Enlaces a tu nombre para esta noche. Cada entrada vendida con uno de ellos cuenta para {name}.',
  ],
  'guestSpace.mkt.create': ['Create a link', 'Créer un lien', 'Crear un enlace'],
  'guestSpace.mkt.created': ['Link created', 'Lien créé', 'Enlace creado'],
  'guestSpace.mkt.clicks': ['Clicks', 'Clics', 'Clics'],
  'guestSpace.mkt.clicksHint': ['on all your links', 'sur tous tes liens', 'en todos tus enlaces'],
  'guestSpace.mkt.tickets': ['Tickets sold', 'Billets vendus', 'Entradas vendidas'],
  'guestSpace.mkt.ticketsHint': ['{pct} % of clicks', '{pct} % des clics', '{pct} % de los clics'],
  'guestSpace.mkt.ca': ['Revenue brought', 'CA amené', 'Facturación aportada'],
  'guestSpace.mkt.caHint': ['excluding Yuno fees', 'hors frais Yuno', 'sin comisiones de Yuno'],
  'guestSpace.mkt.col.channel': ['Channel', 'Canal', 'Canal'],
  'guestSpace.mkt.col.link': ['Link', 'Lien', 'Enlace'],
  'guestSpace.mkt.channel.direct': ['Direct link', 'Lien direct', 'Enlace directo'],
  'guestSpace.mkt.channel.story': ['Instagram story', 'Story Instagram', 'Story de Instagram'],
  'guestSpace.mkt.channel.bio': ['Instagram bio', 'Bio Instagram', 'Bio de Instagram'],
  'guestSpace.mkt.channel.whatsapp': ['WhatsApp', 'WhatsApp', 'WhatsApp'],
  'guestSpace.mkt.channel.other': ['Other', 'Autre', 'Otro'],
  'guestSpace.mkt.privacy': [
    'Clicks and sales are counted without cookies. You never see who bought.',
    'Les clics et les ventes sont comptés sans cookie. Tu ne vois jamais qui a acheté.',
    'Los clics y las ventas se cuentan sin cookies. Nunca ves quién compró.',
  ],
  'guestSpace.mkt.copy': ['Copy', 'Copier', 'Copiar'],
  'guestSpace.mkt.copied': ['Link copied', 'Lien copié', 'Enlace copiado'],
  'guestSpace.mkt.visuals': ['Visuals of the night', 'Visuels de la soirée', 'Visuales de la noche'],
  'guestSpace.mkt.visualsSub': [
    "The visuals of the night, as {org} put them on Yuno.",
    "Les visuels de la soirée, tels que {org} les a mis sur Yuno.",
    "Los visuales de la noche, tal como {org} los subió a Yuno.",
  ],
  'guestSpace.mkt.download': [
    "Download",
    "Télécharger",
    "Descargar",
  ],
  'guestSpace.mkt.open': [
    "Open",
    "Ouvrir",
    "Abrir",
  ],
  'guestSpace.mkt.text': ['Text ready to post', 'Texte prêt à poster', 'Texto listo para publicar'],
  'guestSpace.mkt.textBody': [
    '{date} · {event} at {place}. Tickets from {price}{drink} → {link}',
    '{date} · {event} chez {place}. Billets dès {price}{drink} → {link}',
    '{date} · {event} en {place}. Entradas desde {price}{drink} → {link}',
  ],
  'guestSpace.mkt.textDrink': [', drink included before {time}', ', conso offerte avant {time}', ', consumición incluida antes de la {time}'],
  'guestSpace.mkt.copyText': ['Copy the text', 'Copier le texte', 'Copiar el texto'],

  // ── Argent ─────────────────────────────────────────────────────────────────
  'guestSpace.money.step.contract': ['Contract', 'Contrat', 'Contrato'],
  'guestSpace.money.step.sales': ['Sales', 'Ventes', 'Ventas'],
  'guestSpace.money.step.statement': ['Statement', 'Décompte', 'Liquidación'],
  'guestSpace.money.step.transfer': ['Transfer', 'Virement', 'Transferencia'],
  'guestSpace.money.signed': ['Signed', 'Signé', 'Firmado'],
  'guestSpace.money.ongoing': ['Ongoing', 'En cours', 'En curso'],
  'guestSpace.money.done': ['Over', 'Terminées', 'Terminadas'],
  'guestSpace.money.toCheck': ['To check', 'À vérifier', 'Por verificar'],
  'guestSpace.money.frozen': ['Frozen', 'Figé', 'Cerrada'],
  'guestSpace.money.afterNight': ['48 h after the night', '48 h après la soirée', '48 h tras la noche'],
  'guestSpace.money.afterCheck': ['After validation', 'Après validation', 'Tras la validación'],
  'guestSpace.money.statementTitle': ['Statement of the night', 'Décompte de la soirée', 'Liquidación de la noche'],
  'guestSpace.money.statementLive': ['Statement in progress', 'Décompte en cours', 'Liquidación en curso'],
  'guestSpace.money.statementLiveSub': [
    'Moves with sales until 48 h after the end.',
    'Bouge avec les ventes jusqu’à 48 h après la fin.',
    'Cambia con las ventas hasta 48 h después del final.',
  ],
  'guestSpace.money.statementFrozenSub': ['Frozen {date}.', 'Figé le {date}.', 'Cerrada el {date}.'],
  'guestSpace.money.estimate': ['Estimate', 'Estimation', 'Estimación'],
  'guestSpace.money.row.tickets': ['Tickets ({n})', 'Billets ({n})', 'Entradas ({n})'],
  'guestSpace.money.row.tables': ['VIP tables ({n})', 'Tables VIP ({n})', 'Mesas VIP ({n})'],
  'guestSpace.money.row.refunds': ['Refunds', 'Remboursements', 'Reembolsos'],
  'guestSpace.money.row.refundsN': ['Refunds ({n})', 'Remboursements ({n})', 'Reembolsos ({n})'],
  'guestSpace.money.row.ca': ['Night revenue', 'CA de la soirée', 'Facturación de la noche'],
  'guestSpace.money.row.stripe': ['Stripe fees (estimated, 1.5 % + €0.25 per payment)', 'Frais Stripe (estimés, 1,5 % + 0,25 € par paiement)', 'Comisiones Stripe (estimadas, 1,5 % + 0,25 € por pago)'],
  'guestSpace.money.row.net': ['Net collected by {name}', 'Net encaissé par {name}', 'Neto cobrado por {name}'],
  'guestSpace.money.yunoFees': [
    'Yuno service fees ({amount}) are paid by buyers on top of the price: they are not in the revenue and are not shared.',
    'Les frais de service Yuno ({amount}) sont payés par les acheteurs en plus du prix : ils ne sont pas dans le CA et ne se partagent pas.',
    'Las comisiones de servicio de Yuno ({amount}) las pagan los compradores además del precio: no están en la facturación y no se reparten.',
  ],
  'guestSpace.money.shareTitle': ['Your share under the contract', 'Ta part selon le contrat', 'Tu parte según el contrato'],
  'guestSpace.money.shareDeclaredTitle': ['Your share as agreed', 'Ta part convenue', 'Tu parte acordada'],
  'guestSpace.money.shareDeclaredSub': [
    'Written by {org} in Yuno. Indicative: you settle it between you.',
    'Écrite par {org} dans Yuno. Indicative : vous la réglez entre vous.',
    'Escrita por {org} en Yuno. Indicativa: la arregláis entre vosotros.',
  ],
  'guestSpace.money.share.tickets': ['Tickets', 'Billets', 'Entradas'],
  'guestSpace.money.share.tables': ['VIP tables', 'Tables VIP', 'Mesas VIP'],
  'guestSpace.money.share.bar': ['Bar', 'Bar', 'Barra'],
  'guestSpace.money.share.barValue': ['outside Yuno', 'hors Yuno', 'fuera de Yuno'],
  'guestSpace.money.share.pctNet': ['{n} % of net', '{n} % du net', '{n} % del neto'],
  'guestSpace.money.share.owed': ['What {org} owes you', 'Ce que {org} te doit', 'Lo que {org} te debe'],
  'guestSpace.money.share.youOwe': ['What you owe {org}', 'Ce que tu dois à {org}', 'Lo que debes a {org}'],
  'guestSpace.money.share.yours': ['Your share', 'Ta part', 'Tu parte'],
  'guestSpace.money.transferNote': [
    '{collector} collects, then transfers your share within {n} days after validation.',
    '{collector} encaisse, puis te vire ta part sous {n} jours après validation.',
    '{collector} cobra y luego te transfiere tu parte en {n} días tras la validación.',
  ],
  'guestSpace.money.referenceColon': ['Transfer reference:', 'Référence du virement :', 'Referencia de la transferencia:'],
  'guestSpace.money.answerTitle': ['Your answer', 'Ta réponse', 'Tu respuesta'],
  'guestSpace.money.answerSub': [
    'Check the lines. A dispute freezes the transfer until you agree.',
    'Vérifie les lignes. Une contestation gèle le virement jusqu’à accord.',
    'Revisa las líneas. Una impugnación congela la transferencia hasta el acuerdo.',
  ],
  'guestSpace.money.afterTitle': ['After the night', 'Après la soirée', 'Tras la noche'],
  'guestSpace.money.afterSub': [
    'The statement opens here 48 h after the end. You approve it or dispute it.',
    'Le décompte s’ouvre ici 48 h après la fin. Tu le valides ou tu le contestes.',
    'La liquidación se abre aquí 48 h tras el final. La validas o la impugnas.',
  ],
  'guestSpace.money.approve': ['Approve the statement', 'Valider le décompte', 'Validar la liquidación'],
  'guestSpace.money.contest': ['Dispute a line', 'Contester une ligne', 'Impugnar una línea'],
  'guestSpace.money.contestPh': ['Which line, and why?', 'Quelle ligne, et pourquoi ?', '¿Qué línea y por qué?'],
  'guestSpace.money.contestSend': ['Send', 'Envoyer', 'Enviar'],
  'guestSpace.money.approved': ['Statement approved · {org} is notified', 'Décompte validé · {org} est prévenu', 'Liquidación validada · {org} está avisado'],
  'guestSpace.money.contested': ['Dispute sent to {org}', 'Contestation envoyée à {org}', 'Impugnación enviada a {org}'],
  'guestSpace.money.yourAnswerApproved': ['You approved the statement on {date}.', 'Tu as validé le décompte le {date}.', 'Validaste la liquidación el {date}.'],
  'guestSpace.money.yourAnswerContested': ['You disputed the statement on {date}: “{reason}”.', 'Tu as contesté le décompte le {date} : « {reason} ».', 'Impugnaste la liquidación el {date}: «{reason}».'],
  'guestSpace.money.iban': ['Receiving IBAN', 'IBAN de réception', 'IBAN de recepción'],
  'guestSpace.money.ibanSet': ['Entered', 'Renseigné', 'Indicado'],
  'guestSpace.money.ibanMissing': ['To enter', 'À renseigner', 'Por indicar'],
  'guestSpace.money.due': ['Transfer due', 'Échéance du virement', 'Vencimiento de la transferencia'],
  'guestSpace.money.terms': ['Payment term', 'Délai de paiement', 'Plazo de pago'],
  'guestSpace.money.termsValue': ['{n} days after validation', '{n} jours après validation', '{n} días tras la validación'],
  'guestSpace.money.signInIban': [
    'The IBAN and the transfer are confirmed from your Yuno account: sign in to enter it.',
    'L’IBAN et le virement se confirment depuis ton compte Yuno : connecte-toi pour le renseigner.',
    'El IBAN y la transferencia se confirman desde tu cuenta Yuno: inicia sesión para indicarlo.',
  ],
  'guestSpace.money.signIn': ['Sign in', 'Me connecter', 'Iniciar sesión'],
  'guestSpace.money.openConsole': ['Enter my IBAN in my Console', 'Renseigner mon IBAN dans ma Console', 'Indicar mi IBAN en mi Consola'],
  'guestSpace.money.externalTitle': ['Settled between you', 'Réglé entre vous', 'Lo arregláis entre vosotros'],
  'guestSpace.money.externalSub': [
    '{collector} collects tickets and tables online. You settle the rest as agreed; Yuno pays nothing.',
    '{collector} encaisse les billets et les tables en ligne. Vous réglez le reste comme convenu, Yuno ne verse rien.',
    '{collector} cobra entradas y mesas online. Arregláis el resto como acordasteis; Yuno no paga nada.',
  ],
  'guestSpace.money.externalPill': ['No Yuno contract', 'Sans contrat Yuno', 'Sin contrato Yuno'],
  'guestSpace.money.hidden': [
    '{org} does not share the amounts of this night. You see the volumes in Sales.',
    '{org} ne partage pas les montants de cette soirée. Tu vois les volumes dans Ventes.',
    '{org} no comparte los importes de esta noche. Ves los volúmenes en Ventas.',
  ],

  // ── Porte ──────────────────────────────────────────────────────────────────
  'guestSpace.door.title': ['The door', 'La porte', 'La puerta'],
  'guestSpace.door.sub': [
    "{heldBy}, with the Yuno Pro app. This tab goes live on {date}.",
    "{heldBy}, avec l’app Yuno Pro. Cet onglet passe en direct le {date}.",
    "{heldBy}, con la app Yuno Pro. Esta pestaña pasa a directo el {date}.",
  ],
  'guestSpace.door.opensIn': ['Opens in {n} days', 'Ouvre dans {n} jours', 'Abre en {n} días'],
  'guestSpace.door.opensTomorrow': [
    "Opens tomorrow",
    "Ouvre demain",
    "Abre mañana",
  ],
  'guestSpace.door.opensTonight': ['Opens tonight', 'Ouvre ce soir', 'Abre esta noche'],
  'guestSpace.door.toScan': ['to scan', 'à scanner', 'por escanear'],
  'guestSpace.door.toCheck': ['to check', 'à pointer', 'por marcar'],
  'guestSpace.door.guests': ['{n} guests', '{n} convives', '{n} invitados'],
  'guestSpace.door.total': ['in total', 'au total', 'en total'],
  'guestSpace.door.rules': ['Entry rules', 'Règles d’entrée', 'Reglas de entrada'],
  'guestSpace.door.rulesSub': ['Applied by the scan.', 'Appliquées par le scan.', 'Aplicadas por el escaneo.'],
  'guestSpace.door.ruleDeadline': ['Tickets with entry deadline', 'Billets avec heure limite', 'Entradas con hora límite'],
  'guestSpace.door.ruleDeadlineValue': ['entry before {time}', 'entrée avant {time}', 'entrada antes de las {time}'],
  'guestSpace.door.ruleDrink': ['Free drink', 'Boisson offerte', 'Bebida gratis'],
  'guestSpace.door.ruleDrinkValue': ['at the door, before {time}', 'à la porte, avant {time}', 'en la puerta, antes de las {time}'],
  'guestSpace.door.ruleDrinkValueNoTime': ['at the door', 'à la porte', 'en la puerta'],
  'guestSpace.door.noRules': ['No particular rule: every valid ticket gets in.', 'Pas de règle particulière : tout billet valide entre.', 'Ninguna regla especial: toda entrada válida pasa.'],
  'guestSpace.door.live': ['Live · {time}', 'En direct · {time}', 'En directo · {time}'],
  'guestSpace.door.last10': ['+{n} in the last 10 minutes', '+{n} ces 10 dernières minutes', '+{n} en los últimos 10 minutos'],
  'guestSpace.door.closed': ['Door closed', 'Porte fermée', 'Puerta cerrada'],
  'guestSpace.door.entries': ['Entries', 'Entrées', 'Entradas'],
  'guestSpace.door.ofExpected': ['of {n} expected', 'sur {n} attendus', 'de {n} previstos'],
  'guestSpace.door.pct': ['{n} % of expected people', '{n} % des personnes attendues', '{n} % de las personas previstas'],
  'guestSpace.door.notMeasured': [
    'The door did not scan enough to count arrivals.',
    'La porte n’a pas assez scanné pour compter les entrées.',
    'La puerta no escaneó lo suficiente para contar las entradas.',
  ],
  'guestSpace.door.byType': ['By type of entry', 'Par type d’entrée', 'Por tipo de entrada'],
  'guestSpace.door.byTypeSub': ['Scans of the door team.', 'Scans de l’équipe de la porte.', 'Escaneos del equipo de la puerta.'],
  'guestSpace.door.type.tickets': ['Tickets', 'Billets', 'Entradas'],
  'guestSpace.door.type.gl': ['Guest list', 'Guest list', 'Guest list'],
  'guestSpace.door.type.tables': ['VIP tables (guests)', 'Tables VIP (convives)', 'Mesas VIP (invitados)'],
  'guestSpace.door.typeLine': ['{a} in of {b}', '{a} entrés sur {b}', '{a} entraron de {b}'],
  'guestSpace.door.staffTitle': ['Your team at the door', 'Ton équipe à la porte', 'Tu equipo en la puerta'],
  'guestSpace.door.staffSub': [
    'They scan the tickets and the guest list of this night with the Yuno Pro app, alongside {org}’s team.',
    'Ils scannent les billets et la guest list de cette soirée avec l’app Yuno Pro, aux côtés de l’équipe de {org}.',
    'Escanean las entradas y la guest list de esta noche con la app Yuno Pro, junto al equipo de {org}.',
  ],
  'guestSpace.door.staffNamePh': ['First and last name', 'Prénom et nom', 'Nombre y apellido'],
  'guestSpace.door.staffContactPh': ['Email or WhatsApp', 'E-mail ou WhatsApp', 'Email o WhatsApp'],
  'guestSpace.door.staffInvite': ['Invite', 'Inviter', 'Invitar'],
  'guestSpace.door.staffInvited': ['Invitation sent', 'Invitation envoyée', 'Invitación enviada'],
  'guestSpace.door.staffActive': ['Active · Yuno Pro app', 'Actif · app Yuno Pro', 'Activo · app Yuno Pro'],
  'guestSpace.door.staffByYou': ['Invited by you', 'Invité par toi', 'Invitado por ti'],
  'guestSpace.door.staffByOrg': ['Invited by {org}', 'Invité par {org}', 'Invitado por {org}'],
  'guestSpace.door.staffRemove': ['Remove', 'Retirer', 'Quitar'],
  'guestSpace.door.staffRule': [
    'Access to this night only: scanning at the door, nothing else. It ends 6 hours after the night. {org} can also invite your staff from its Console.',
    'Accès à cette soirée seulement : scan à la porte, rien d’autre. Il se coupe 6 h après la soirée. {org} peut aussi inviter ton staff depuis sa Console.',
    'Acceso solo a esta noche: escaneo en la puerta, nada más. Se corta 6 h después de la noche. {org} también puede invitar a tu staff desde su Consola.',
  ],
  'guestSpace.door.staffWhatsapp': [
    'Hi {name}! You’re invited to scan at the door of {event} with the Yuno Pro app. Accept here: {link}',
    'Salut {name} ! Tu es invité à scanner à la porte de {event} avec l’app Yuno Pro. Accepte ici : {link}',
    '¡Hola {name}! Te invitan a escanear en la puerta de {event} con la app Yuno Pro. Acepta aquí: {link}',
  ],
  'guestSpace.door.staffEmpty': ['Nobody yet.', 'Personne pour l’instant.', 'Nadie por ahora.'],

  // ── Infos & contrat ────────────────────────────────────────────────────────
  'guestSpace.info.night': ['The night', 'La soirée', 'La noche'],
  'guestSpace.info.nightSub': ['What buyers receive with their ticket.', 'Ce que les acheteurs reçoivent avec leur billet.', 'Lo que reciben los compradores con su entrada.'],
  'guestSpace.info.date': ['Date', 'Date', 'Fecha'],
  'guestSpace.info.hours': ['Hours', 'Horaires', 'Horario'],
  'guestSpace.info.address': ['Address', 'Adresse', 'Dirección'],
  'guestSpace.info.ticketing': ['Ticketing', 'Billetterie', 'Taquilla'],
  'guestSpace.info.ticketingValue': ['{n} tickets', '{n} tarifs', '{n} tarifas'],
  'guestSpace.info.ticketingFree': ['Free ticketing, {n} tickets', 'Libre, {n} tarifs', 'Libre, {n} tarifas'],
  'guestSpace.info.tables': ['VIP tables', 'Tables VIP', 'Mesas VIP'],
  'guestSpace.info.tablesValue': ['{p} packages, {n} tables', '{p} formules, {n} tables', '{p} fórmulas, {n} mesas'],
  'guestSpace.info.tablesValueOne': ['1 package, {n} tables', '1 formule, {n} tables', '1 fórmula, {n} mesas'],
  'guestSpace.info.guestList': ['Guest list', 'Guest list', 'Guest list'],
  'guestSpace.info.guestListValue': ['{p} shares · {n} places', '{p} parts · {n} places', '{p} partes · {n} plazas'],
  'guestSpace.info.guestListValueOne': ['1 share · {n} places', '1 part · {n} places', '1 parte · {n} plazas'],
  'guestSpace.info.none': ['None', 'Aucune', 'Ninguna'],
  'guestSpace.info.fix': ['A mistake? {org} fixes it for everyone.', 'Une erreur ? {org} la corrige pour tout le monde.', '¿Un error? {org} lo corrige para todos.'],
  'guestSpace.info.contract': ['Contract', 'Contrat', 'Contrato'],
  'guestSpace.info.agreement': ['Agreement', 'Accord', 'Acuerdo'],
  'guestSpace.info.contractSub': ['Signed by both parties.', 'Signé par les deux parties.', 'Firmado por ambas partes.'],
  'guestSpace.info.agreementSub': ['Settled between you, without a Yuno contract.', 'Réglé entre vous, sans contrat Yuno.', 'Lo arregláis entre vosotros, sin contrato Yuno.'],
  'guestSpace.info.leads': ['Who runs it', 'Qui mène', 'Quién organiza'],
  'guestSpace.info.collects': ['Who collects', 'Qui encaisse', 'Quién cobra'],
  'guestSpace.info.collectsValue': ['{name} (tickets, tables)', '{name} (billets, tables)', '{name} (entradas, mesas)'],
  'guestSpace.info.bar': ['Bar', 'Bar', 'Barra'],
  'guestSpace.info.barValue': ['{name}, outside Yuno', '{name}, hors Yuno', '{name}, fuera de Yuno'],
  'guestSpace.info.door': ['Door', 'Porte', 'Puerta'],
  'guestSpace.info.doorValue': [
    "{name}’s team",
    "Équipe de {name}",
    "Equipo de {name}",
  ],
  'guestSpace.info.doorYours': [
    "Your team",
    "Ton équipe",
    "Tu equipo",
  ],
  'guestSpace.info.doorBoth': [
    "{name}’s team and yours",
    "Équipe de {name} et la tienne",
    "Equipo de {name} y el tuyo",
  ],
  'guestSpace.info.pdf': ['Signed contract (PDF) in my Console', 'Contrat signé (PDF) dans ma Console', 'Contrato firmado (PDF) en mi Consola'],
  'guestSpace.info.contacts': ['Contacts of the night', 'Contacts de la soirée', 'Contactos de la noche'],
  'guestSpace.info.contactOrg': ['Organizer', 'Organisateur', 'Organizador'],
  'guestSpace.info.contactYuno': ['A question about this space', 'Une question sur cet espace', 'Una pregunta sobre este espacio'],
  'guestSpace.info.talkPaul': ['Talk to Paul (Yuno)', 'Parler à Paul (Yuno)', 'Hablar con Paul (Yuno)'],
  'guestSpace.info.talkMessage': [
    'Hi Paul, I’m {name}. I’m looking at the space of {event} on Yuno and I have a question.',
    'Salut Paul, c’est {name}. Je regarde l’espace de {event} sur Yuno et j’ai une question.',
    'Hola Paul, soy {name}. Estoy viendo el espacio de {event} en Yuno y tengo una pregunta.',
  ],
  'guestSpace.info.closes': ['This space stays open until {date}.', 'Cet espace reste ouvert jusqu’au {date}.', 'Este espacio sigue abierto hasta el {date}.'],

  // ── États ──────────────────────────────────────────────────────────────────
  'guestSpace.state.notFoundTitle': ['Space not found', 'Espace introuvable', 'Espacio no encontrado'],
  'guestSpace.state.notFoundBody': [
    "This space is not linked to this account. Sign in with the account that opened the invitation, or ask the organizer for a new invitation.",
    "Cet espace n’est pas rattaché à ce compte. Connecte-toi avec le compte qui a ouvert l’invitation, ou demande une nouvelle invitation à l’organisateur.",
    "Este espacio no está vinculado a esta cuenta. Inicia sesión con la cuenta que abrió la invitación, o pide una nueva invitación al organizador.",
  ],
  'guestSpace.state.closedTitle': ['This space is closed', 'Cet espace est fermé', 'Este espacio está cerrado'],
  'guestSpace.state.closedBody': ['The space of {event} is closed. Ask the organizer if you need the final numbers.', 'L’espace de {event} est fermé. Demande les chiffres finaux à l’organisateur si besoin.', 'El espacio de {event} está cerrado. Pide las cifras finales al organizador si las necesitas.'],
  'guestSpace.state.errorTitle': ['Something went wrong', 'Un souci de connexion', 'Algo ha fallado'],
  'guestSpace.state.errorBody': ['The space could not be loaded. Check your connection and try again.', 'L’espace n’a pas pu être chargé. Vérifie ta connexion et réessaie.', 'No se ha podido cargar el espacio. Revisa tu conexión y vuelve a intentarlo.'],
  'guestSpace.state.retry': ['Try again', 'Réessayer', 'Reintentar'],
  'guestSpace.err.generic': ['Something went wrong. Try again.', 'Un souci est survenu. Réessaie.', 'Algo ha fallado. Inténtalo de nuevo.'],
  'guestSpace.err.guest_list_full': ['Your share is full: ask for more places.', 'Ta part est pleine : demande plus de places.', 'Tu parte está llena: pide más plazas.'],
  'guestSpace.err.no_guest_list_part': ['No guest list share yet.', 'Pas encore de part de guest list.', 'Aún no hay parte de guest list.'],
  'guestSpace.err.too_many_actions': ['Too many actions in a row. Wait a moment.', 'Trop de gestes d’affilée. Attends un instant.', 'Demasiadas acciones seguidas. Espera un momento.'],
  'guestSpace.err.too_many_links': ['Eight links at most.', 'Huit liens au plus.', 'Ocho enlaces como máximo.'],
  'guestSpace.err.event_closed': ['This night is over or cancelled.', 'Cette soirée est terminée ou annulée.', 'Esta noche ha terminado o está cancelada.'],
  'guestSpace.err.reason_required': ['Say which line and why.', 'Dis quelle ligne et pourquoi.', 'Di qué línea y por qué.'],
  'guestSpace.err.statement_not_ready': ['The statement opens after the night.', 'Le décompte s’ouvre après la soirée.', 'La liquidación se abre tras la noche.'],
  'guestSpace.err.invalid_name': ['Enter a name.', 'Indique un nom.', 'Indica un nombre.'],
  'guestSpace.err.invalid_email': ['This email address looks wrong.', 'Cette adresse email semble incorrecte.', 'Esta dirección de email parece incorrecta.'],
  'guestSpace.err.invalid_phone': ['This number looks wrong.', 'Ce numéro semble incorrect.', 'Este número parece incorrecto.'],
  'guestSpace.err.contact_required': ['An email or a WhatsApp number.', 'Un email ou un numéro WhatsApp.', 'Un email o un número de WhatsApp.'],
  'guestSpace.err.already_invited': ['Already invited.', 'Déjà invité.', 'Ya invitado.'],
  'guestSpace.err.demo_mismatch': [
    'A demo night only writes to a demo address, and a real night never does.',
    'Une soirée démo n’écrit qu’à une adresse démo, et une vraie soirée jamais.',
    'Una noche demo solo escribe a una dirección demo, y una real nunca.',
  ],
  'guestSpace.err.too_many_staff': ['Twenty people at most at the door.', 'Vingt personnes au plus à la porte.', 'Veinte personas como máximo en la puerta.'],
  'guestSpace.err.contract_changed': ['The terms just changed: read them again.', 'Les termes viennent de changer : relis-les.', 'Las condiciones acaban de cambiar: vuelve a leerlas.'],
  'guestSpace.err.nothing_to_sign': ['Nothing to sign.', 'Rien à signer.', 'Nada que firmar.'],
  'guestSpace.err.contract_not_signed': ['Sign the contract first.', 'Signe d’abord le contrat.', 'Firma primero el contrato.'],
  'guestSpace.err.invalid_iban': ['This IBAN looks wrong.', 'Cet IBAN semble incorrect.', 'Este IBAN parece incorrecto.'],
  'guestSpace.err.transfer_already_sent': ['The transfer has already left.', 'Le virement est déjà parti.', 'La transferencia ya ha salido.'],
  'guestSpace.err.invalid_share': ['A share is between 0 and 100 %.', 'Une part va de 0 à 100 %.', 'Una parte va de 0 a 100 %.'],
  'guestSpace.err.statement_frozen': ['The statement is frozen: the contract can no longer change.', 'Le décompte est figé : le contrat ne change plus.', 'La liquidación está cerrada: el contrato ya no cambia.'],
  'guestSpace.err.statement_not_frozen': ['The statement freezes 48 h after the night.', 'Le décompte se fige 48 h après la soirée.', 'La liquidación se cierra 48 h tras la noche.'],
  'guestSpace.err.statement_contested': ['The guest disputes the statement: settle it first.', 'L’invité conteste le décompte : réglez-le d’abord.', 'El invitado impugna la liquidación: resolvedlo primero.'],
  'guestSpace.err.not_pending': ['Nothing to transfer.', 'Rien à virer.', 'Nada que transferir.'],
  'guestSpace.err.not_sent': ['No transfer announced yet.', 'Aucun virement annoncé.', 'Ninguna transferencia anunciada.'],
  'guestSpace.err.forbidden': ['Not allowed from this space.', 'Pas permis depuis cet espace.', 'No permitido desde este espacio.'],

  // ── Email et WhatsApp (accès) ──────────────────────────────────────────────
  'guestSpace.share.whatsapp': [
    "Hi {guest}! Here is your invitation to {event}: sales, guest list, your links, the door and the money, live. Create your Yuno account (or sign in) to open it: {page}",
    "Salut {guest} ! Voici ton invitation pour {event} : ventes, guest list, tes liens, la porte et l’argent, en direct. Crée ton compte Yuno (ou connecte-toi) pour l’ouvrir : {page}",
    "¡Hola {guest}! Aquí tienes tu invitación para {event}: ventas, guest list, tus enlaces, la puerta y el dinero, en directo. Crea tu cuenta Yuno (o inicia sesión) para abrirla: {page}",
  ],
  'guestSpace.mail.subject': ['{event}: your space for the night', '{event} : ton espace de la soirée', '{event}: tu espacio de la noche'],
  'guestSpace.mail.preheader': [
    "Sales, guest list, your links, the door. Opens with your Yuno account.",
    "Ventes, guest list, tes liens, la porte. S’ouvre avec ton compte Yuno.",
    "Ventas, guest list, tus enlaces, la puerta. Se abre con tu cuenta Yuno.",
  ],
  'guestSpace.mail.kicker': ['Your night', 'Ta soirée', 'Tu noche'],
  'guestSpace.mail.intro': [
    '{inviter} organizes {event} and gives {guest} its own space for the night: where sales stand, your guest list share, your sales links, the door and the money.',
    '{inviter} organise {event} et donne à {guest} son espace de la soirée : où en sont les ventes, ta part de guest list, tes liens de vente, la porte et l’argent.',
    '{inviter} organiza {event} y da a {guest} su espacio de la noche: cómo van las ventas, tu parte de la guest list, tus enlaces de venta, la puerta y el dinero.',
  ],
  'guestSpace.mail.next': [
    "The button takes you to your invitation: create your Yuno account (or sign in) with this address and your space opens. Then it is on your Yuno profile.",
    "Le bouton t’amène à ton invitation : crée ton compte Yuno (ou connecte-toi) avec cette adresse, et ton espace s’ouvre. Ensuite, il est sur ton profil Yuno.",
    "El botón te lleva a tu invitación: crea tu cuenta Yuno (o inicia sesión) con esta dirección y tu espacio se abre. Después, está en tu perfil Yuno.",
  ],
  'guestSpace.mail.cta': ['Open my space', 'Ouvrir mon espace', 'Abrir mi espacio'],
  'guestSpace.mail.reason': ['{inviter} gave you access to {event} on Yuno', '{inviter} t’a donné accès à {event} sur Yuno', '{inviter} te ha dado acceso a {event} en Yuno'],
  'guestSpace.mail.rowOrganizer': ['Organized by', 'Organisée par', 'Organizada por'],
  'guestSpace.mail.rowDate': ['Date', 'Date', 'Fecha'],
  'guestSpace.mail.rowPlace': ['Place', 'Lieu', 'Lugar'],

  // ── Console de l'organisateur ──────────────────────────────────────────────
  'guestSpace.org.roleHint': [
    "Gets its own space for this night with a simple Yuno account: sales, its guest list share, its links, the door and its share of the money. No access to your Console.",
    "Reçoit son espace de la soirée avec un compte Yuno simple : ventes, sa part de guest list, ses liens, la porte et sa part de l’argent. Aucun accès à ta Console.",
    "Recibe su espacio de la noche con una cuenta Yuno simple: ventas, su parte de la guest list, sus enlaces, la puerta y su parte del dinero. Sin acceso a tu Consola.",
  ],
  'guestSpace.org.cardTitle': [
    "Guests",
    "Invités",
    "Invitados",
  ],
  'guestSpace.org.cardSub': [
    "Each club or organization working the night with you, as a guest: its own guest space, opened with its Yuno account.",
    "Chaque club ou organisation qui fait la soirée avec toi, en invité : son espace invité, ouvert avec son compte Yuno.",
    "Cada club u organización que hace la noche contigo, como invitado: su espacio de invitado, abierto con su cuenta Yuno.",
  ],
  'guestSpace.org.add': [
    "Add a guest",
    "Ajouter un invité",
    "Añadir un invitado",
  ],
  'guestSpace.org.kindVenue': ['Club', 'Club', 'Club'],
  'guestSpace.org.kindOrg': ['Organization', 'Organisation', 'Organización'],
  'guestSpace.org.name': ['Name', 'Nom', 'Nombre'],
  'guestSpace.org.email': ['Email', 'Email', 'Email'],
  'guestSpace.org.phone': ['Or WhatsApp number', 'Ou numéro WhatsApp', 'O número de WhatsApp'],
  'guestSpace.org.language': ['Space language', 'Langue de l’espace', 'Idioma del espacio'],
  'guestSpace.org.showRevenue': ['Show the amounts', 'Montrer les montants', 'Mostrar los importes'],
  'guestSpace.org.showRevenueHint': [
    'Revenue = ticket value excluding Yuno fees, refunds deducted. The guest only ever sees its own share.',
    'CA = valeur des billets hors frais Yuno, remboursements déduits. L’invité ne voit jamais que sa part.',
    'Facturación = valor de las entradas sin comisiones de Yuno, reembolsos descontados. El invitado solo ve su parte.',
  ],
  'guestSpace.org.revenueLocked': ['Only someone who sees the money can show it.', 'Seul qui voit l’argent peut le montrer.', 'Solo quien ve el dinero puede mostrarlo.'],
  'guestSpace.org.places': ['Guest list places', 'Places de guest list', 'Plazas de guest list'],
  'guestSpace.org.placesHint': ['0 = no share', '0 = pas de part', '0 = sin parte'],
  'guestSpace.org.shares': ['Agreed share (optional)', 'Part convenue (facultatif)', 'Parte acordada (opcional)'],
  'guestSpace.org.sharesHint': [
    'Shown to the guest as “what you owe them”, indicative. Ignored when a Yuno contract settles the night.',
    'Montrée à l’invité comme « ce que tu lui dois », à titre indicatif. Ignorée quand un contrat Yuno règle la soirée.',
    'Se muestra al invitado como «lo que le debes», indicativo. Se ignora si un contrato Yuno liquida la noche.',
  ],
  'guestSpace.org.shareTickets': ['Tickets %', 'Billets %', 'Entradas %'],
  'guestSpace.org.shareTables': ['Tables %', 'Tables %', 'Mesas %'],
  'guestSpace.org.create': [
    "Invite",
    "Inviter",
    "Invitar",
  ],
  'guestSpace.org.sendEmail': ['Send by email', 'Envoyer par email', 'Enviar por email'],
  'guestSpace.org.resend': ['Send again', 'Renvoyer', 'Reenviar'],
  'guestSpace.org.whatsapp': ['WhatsApp', 'WhatsApp', 'WhatsApp'],
  'guestSpace.org.copy': ['Copy link', 'Copier le lien', 'Copiar enlace'],
  'guestSpace.org.preview': ['Open the space', 'Ouvrir l’espace', 'Abrir el espacio'],
  'guestSpace.org.revoke': ['Cut access', 'Couper l’accès', 'Cortar el acceso'],
  'guestSpace.org.reopen': ['Reopen', 'Rouvrir', 'Reabrir'],
  'guestSpace.org.revoked': ['Access cut', 'Accès coupé', 'Acceso cortado'],
  'guestSpace.org.save': ['Save', 'Enregistrer', 'Guardar'],
  'guestSpace.org.cancel': ['Cancel', 'Annuler', 'Cancelar'],
  'guestSpace.org.edit': ['Settings', 'Réglages', 'Ajustes'],
  'guestSpace.org.neverOpened': ['Not opened yet', 'Pas encore ouvert', 'Aún no abierto'],
  'guestSpace.org.opened': ['Opened {n}× · last {when}', 'Ouvert {n} fois · dernier {when}', 'Abierto {n} veces · último {when}'],
  'guestSpace.org.openedOnce': ['Opened once · {when}', 'Ouvert une fois · {when}', 'Abierto una vez · {when}'],
  'guestSpace.org.emailSent': ['Email sent', 'Email envoyé', 'Email enviado'],
  'guestSpace.org.glLine': ['Guest list: {n} / {cap}', 'Guest list : {n} / {cap}', 'Guest list: {n} / {cap}'],
  'guestSpace.org.linkStats': ['Their links: {clicks} clicks · {sales} sales', 'Ses liens : {clicks} clics · {sales} ventes', 'Sus enlaces: {clicks} clics · {sales} ventas'],
  'guestSpace.org.placesRequested': ['Asks for {n} more places', 'Demande {n} places de plus', 'Pide {n} plazas más'],
  'guestSpace.org.grant': ['Give {n} places', 'Donner {n} places', 'Dar {n} plazas'],
  'guestSpace.org.decline': [
    "Decline",
    "Refuser",
    "Rechazar",
  ],
  'guestSpace.org.declined': [
    "Request declined: the guest is told",
    "Demande refusée : l’invité en est prévenu",
    "Solicitud rechazada: el invitado queda avisado",
  ],
  'guestSpace.org.approved': ['Statement approved', 'Décompte validé', 'Liquidación validada'],
  'guestSpace.org.contested': ['Statement disputed: “{reason}”', 'Décompte contesté : « {reason} »', 'Liquidación impugnada: «{reason}»'],
  'guestSpace.org.claimedAccepted': ['{name} opened its Yuno account: it follows the night as a Partner.', '{name} a ouvert son compte Yuno : il suit la soirée en Partenaire.', '{name} ha abierto su cuenta Yuno: sigue la noche como Socio.'],
  'guestSpace.org.claimedPending': ['{name} opened its Yuno account. Add it as a Partner of the night?', '{name} a ouvert son compte Yuno. L’ajouter en Partenaire de la soirée ?', '{name} ha abierto su cuenta Yuno. ¿Añadirlo como Socio de la noche?'],
  'guestSpace.org.claimInvite': ['Add as Partner', 'Ajouter en Partenaire', 'Añadir como Socio'],
  'guestSpace.org.claimInvited': ['Invitation sent, waiting for them', 'Invitation envoyée, en attente', 'Invitación enviada, en espera'],
  'guestSpace.org.staffTitle': ['Club staff at the door', 'Staff du club à la porte', 'Staff del club en la puerta'],
  'guestSpace.org.staffInvite': ['Invite the club’s staff', 'Inviter le staff du club', 'Invitar al staff del club'],
  'guestSpace.org.staffRule': ['Scans this night only, until 6 h after the end.', 'Scanne cette soirée seulement, jusqu’à 6 h après la fin.', 'Escanea solo esta noche, hasta 6 h tras el final.'],
  'guestSpace.org.created': [
    "Guest invited",
    "Invité ajouté",
    "Invitado añadido",
  ],
  'guestSpace.org.sent': ['Email sent', 'Email envoyé', 'Email enviado'],
  'guestSpace.org.copied': ['Link copied', 'Lien copié', 'Enlace copiado'],
  'guestSpace.org.saved': ['Saved', 'Enregistré', 'Guardado'],
  'guestSpace.err.too_many_guest_passes': ['Eight spaces at most per night.', 'Huit espaces au plus par soirée.', 'Ocho espacios como máximo por noche.'],
  'guestSpace.err.places_below_registered': ['Fewer places than guests already registered.', 'Moins de places que d’invités déjà inscrits.', 'Menos plazas que invitados ya inscritos.'],
  'guestSpace.err.support_session_forbidden': ['Not available in assisted access.', 'Indisponible en accès assisté.', 'No disponible en acceso asistido.'],
  'guestSpace.err.email_too_soon': ['An email just left. Try again in 10 minutes.', 'Un email vient de partir. Réessaie dans 10 minutes.', 'Acaba de salir un email. Inténtalo en 10 minutos.'],
  'guestSpace.err.too_many_emails': ['Five emails already sent: share the link another way.', 'Cinq emails déjà envoyés : partage le lien autrement.', 'Ya se enviaron cinco emails: comparte el enlace de otra forma.'],

  // ── Rattachement après l'inscription ───────────────────────────────────────
  'guestSpace.claim.accepted': ['Done: the night is in your Console, as a Partner.', 'C’est fait : la soirée est dans ta Console, en Partenaire.', 'Hecho: la noche está en tu Consola, como Socio.'],
  'guestSpace.claim.pending': ['Noted. The organizer will add you to the night.', 'C’est noté. L’organisateur va t’ajouter à la soirée.', 'Anotado. El organizador te añadirá a la noche.'],

  // ── Acceptation d'une invitation de porte ──────────────────────────────────
  'guestSpace.doorInvite.title': ['Door of {event}', 'Porte de {event}', 'Puerta de {event}'],
  'guestSpace.doorInvite.body': [
    '{inviter} invites you to scan at the door of this night with the Yuno Pro app. Access to this night only.',
    '{inviter} t’invite à scanner à la porte de cette soirée avec l’app Yuno Pro. Accès à cette soirée seulement.',
    '{inviter} te invita a escanear en la puerta de esta noche con la app Yuno Pro. Acceso solo a esta noche.',
  ],
  'guestSpace.doorInvite.emailPh': ['Your email', 'Ton e-mail', 'Tu correo'],
  'guestSpace.doorInvite.accept': ['Join the door', 'Rejoindre la porte', 'Unirme a la puerta'],
  'guestSpace.doorInvite.signIn': [
    'Sign in with your email: we send you a code, no password.',
    'Connecte-toi avec ton e-mail : on t’envoie un code, pas de mot de passe.',
    'Entra con tu correo: te enviamos un código, sin contraseña.',
  ],
  'guestSpace.doorInvite.signedAs': ['Signed in as {email}', 'Connecté avec {email}', 'Conectado con {email}'],
  'guestSpace.doorInvite.switchAccount': ['Use another account', 'Changer de compte', 'Usar otra cuenta'],
  'guestSpace.doorInvite.needApp': [
    'At the door, you scan with the Yuno Pro app on your iPhone.',
    'À la porte, tu scannes avec l’app Yuno Pro sur ton iPhone.',
    'En la puerta, escaneas con la app Yuno Pro en tu iPhone.',
  ],
  'guestSpace.doorInvite.getApp': ['1. Get Yuno Pro', '1. Télécharger Yuno Pro', '1. Descargar Yuno Pro'],
  'guestSpace.doorInvite.openInApp': ['2. Open this invitation in Yuno Pro', '2. Ouvrir cette invitation dans Yuno Pro', '2. Abrir esta invitación en Yuno Pro'],
  'guestSpace.doorInvite.continueWeb': ['No iPhone? Continue in the browser', 'Pas d’iPhone ? Continuer dans le navigateur', '¿Sin iPhone? Seguir en el navegador'],
  'guestSpace.doorInvite.ready': [
    'You are on the door team. Open the scanner when the doors open.',
    'Tu es dans l’équipe de porte. Ouvre le scanner à l’ouverture des portes.',
    'Estás en el equipo de puerta. Abre el escáner cuando abran las puertas.',
  ],
  'guestSpace.doorInvite.openScanner': ['Open the scanner', 'Ouvrir le scanner', 'Abrir el escáner'],
  'guestSpace.doorInvite.later': [
    'To sign in again later: open Yuno Pro, type your email, a code arrives.',
    'Pour te reconnecter plus tard : ouvre Yuno Pro, tape ton e-mail, un code arrive.',
    'Para volver a entrar: abre Yuno Pro, escribe tu correo y te llega un código.',
  ],
  'guestSpace.doorInvite.closed': ['This night is over: the invitation no longer works.', 'Cette soirée est terminée : l’invitation ne marche plus.', 'Esta noche ha terminado: la invitación ya no funciona.'],
  'guestSpace.doorInvite.mismatch': ['This invitation was sent to {email}: sign in with that address.', 'Cette invitation a été envoyée à {email} : connecte-toi avec cette adresse.', 'Esta invitación se envió a {email}: entra con ese correo.'],
  'guestSpace.doorInvite.taken': ['This invitation was already used by another account.', 'Cette invitation a déjà servi à un autre compte.', 'Esta invitación ya la usó otra cuenta.'],

  // ── Contrat de soirée de l'invité (signé dans son espace, sans compte) ─────
  'guestSpace.contract.title': ['Contract of the night', 'Contrat de la soirée', 'Contrato de la noche'],
  'guestSpace.contract.toSign': ['To sign', 'À signer', 'Por firmar'],
  'guestSpace.contract.signed': ['Signed', 'Signé', 'Firmado'],
  'guestSpace.contract.version': ['Version {n}', 'Version {n}', 'Versión {n}'],
  'guestSpace.contract.proposedSub': [
    "{org} proposes this contract. Read it, then sign it with your name.",
    "{org} te propose ce contrat. Lis-le, puis signe-le avec ton nom.",
    "{org} te propone este contrato. Léelo y fírmalo con tu nombre.",
  ],
  'guestSpace.contract.signedSub': [
    'Signed on {date} by {name} for {guest}, and by {orgSigner} for {org}.',
    'Signé le {date} par {name} pour {guest}, et par {orgSigner} pour {org}.',
    'Firmado el {date} por {name} para {guest}, y por {orgSigner} para {org}.',
  ],
  'guestSpace.contract.art1T': ['1. Purpose', '1. Objet', '1. Objeto'],
  'guestSpace.contract.art1': [
    '{org} and {guest} work together on the night “{event}” ({date}). {collector} runs the ticketing and collects tickets and VIP tables through Yuno.',
    '{org} et {guest} travaillent ensemble sur la soirée « {event} » ({date}). {collector} tient la billetterie et encaisse les billets et les tables VIP par Yuno.',
    '{org} y {guest} colaboran en la noche «{event}» ({date}). {collector} gestiona la taquilla y cobra las entradas y las mesas VIP a través de Yuno.',
  ],
  'guestSpace.contract.art2T': ['2. Your share', '2. Ta part', '2. Tu parte'],
  'guestSpace.contract.art2': [
    '{guest} receives {t} % of the net of tickets and {tb} % of the net of VIP tables. Net = sales paid, minus refunds, minus Yuno fees, minus Stripe fees (estimated at 1.5 % + €0.25 per payment).',
    '{guest} reçoit {t} % du net des billets et {tb} % du net des tables VIP. Net = ventes payées, moins les remboursements, moins les frais Yuno, moins les frais Stripe (estimés à 1,5 % + 0,25 € par paiement).',
    '{guest} recibe el {t} % del neto de las entradas y el {tb} % del neto de las mesas VIP. Neto = ventas pagadas, menos reembolsos, menos comisiones de Yuno, menos comisiones de Stripe (estimadas en 1,5 % + 0,25 € por pago).',
  ],
  'guestSpace.contract.barGuest': ['The bar stays with {guest}, outside Yuno and outside this contract.', 'Le bar reste à {guest}, hors Yuno et hors de ce contrat.', 'La barra queda para {guest}, fuera de Yuno y fuera de este contrato.'],
  'guestSpace.contract.barNone': ['The bar is not part of this contract.', 'Le bar n’entre pas dans ce contrat.', 'La barra no forma parte de este contrato.'],
  'guestSpace.contract.art3T': ['3. Statement', '3. Décompte', '3. Liquidación'],
  'guestSpace.contract.art3': [
    'The statement is frozen 48 h after the end of the night and can be read here, line by line. {guest} can dispute it before the transfer.',
    'Le décompte se fige 48 h après la fin de la soirée et se lit ici, ligne par ligne. {guest} peut le contester avant le virement.',
    'La liquidación se cierra 48 h después del final de la noche y se lee aquí, línea por línea. {guest} puede impugnarla antes de la transferencia.',
  ],
  'guestSpace.contract.art4T': ['4. Payment', '4. Paiement', '4. Pago'],
  'guestSpace.contract.art4': [
    '{collector} pays the share by bank transfer within {n} days of the frozen statement, to the IBAN {guest} enters here, reference {ref}.',
    '{collector} vire la part sous {n} jours après le décompte figé, sur l’IBAN que {guest} renseigne ici, référence {ref}.',
    '{collector} transfiere la parte en un plazo de {n} días tras la liquidación cerrada, al IBAN que {guest} indica aquí, referencia {ref}.',
  ],
  'guestSpace.contract.art5T': ['5. Special terms', '5. Conditions particulières', '5. Condiciones particulares'],
  'guestSpace.contract.art6T': ['Yuno', 'Yuno', 'Yuno'],
  'guestSpace.contract.art6': [
    "Yuno provides the tool and keeps the proof of signature. Yuno is not a party to this contract and pays nothing. Electronic signature from the Yuno account linked to the invitation, dated and recorded.",
    "Yuno fournit l’outil et garde la preuve de signature. Yuno n’est pas partie à ce contrat et ne verse rien. Signature électronique depuis le compte Yuno rattaché à l’invitation, datée et enregistrée.",
    "Yuno proporciona la herramienta y guarda la prueba de firma. Yuno no es parte de este contrato y no paga nada. Firma electrónica desde la cuenta Yuno vinculada a la invitación, fechada y registrada.",
  ],
  'guestSpace.contract.signerName': ['Your full name', 'Ton nom complet', 'Tu nombre completo'],
  'guestSpace.contract.sign': ['Sign the contract', 'Signer le contrat', 'Firmar el contrato'],
  'guestSpace.contract.signedToast': ['Contract signed · {org} is notified', 'Contrat signé · {org} est prévenu', 'Contrato firmado · {org} está avisado'],
  'guestSpace.contract.agree': [
    'By signing, {name} commits {guest} to these terms.',
    'En signant, {name} engage {guest} sur ces termes.',
    'Al firmar, {name} compromete a {guest} con estas condiciones.',
  ],
  'guestSpace.contract.ibanTitle': ['Where to send your share', 'Où virer ta part', 'Dónde transferir tu parte'],
  'guestSpace.contract.ibanSub': [
    "Your IBAN only goes to {collector}.",
    "Ton IBAN ne va qu’à {collector}.",
    "Tu IBAN solo va a {collector}.",
  ],
  'guestSpace.contract.ibanPh': ['IBAN', 'IBAN', 'IBAN'],
  'guestSpace.contract.holderPh': ['Account holder', 'Titulaire du compte', 'Titular de la cuenta'],
  'guestSpace.contract.ibanSave': ['Save my IBAN', 'Enregistrer mon IBAN', 'Guardar mi IBAN'],
  'guestSpace.contract.ibanChange': ['Change', 'Modifier', 'Cambiar'],
  'guestSpace.contract.ibanSaved': ['IBAN saved', 'IBAN enregistré', 'IBAN guardado'],
  'guestSpace.contract.transferTitle': ['Your transfer', 'Ton virement', 'Tu transferencia'],
  'guestSpace.contract.tr.estimate': ['After the statement', 'Après le décompte', 'Tras la liquidación'],
  'guestSpace.contract.tr.pending': ['Expected by {date}', 'Attendu au plus tard le {date}', 'Esperada como tarde el {date}'],
  'guestSpace.contract.tr.sent': ['{collector} says it sent the transfer on {date}', '{collector} dit avoir viré le {date}', '{collector} dice haber transferido el {date}'],
  'guestSpace.contract.tr.received': ['Received on {date}', 'Reçu le {date}', 'Recibida el {date}'],
  'guestSpace.contract.tr.disputed': ['Not received: “{reason}”', 'Pas reçu : « {reason} »', 'No recibida: «{reason}»'],
  'guestSpace.contract.tr.nothing': ['Nothing to transfer: the share is €0.', 'Rien à virer : la part est de 0 €.', 'Nada que transferir: la parte es de 0 €.'],
  'guestSpace.contract.received': ['I received it', 'Je l’ai reçu', 'La he recibido'],
  'guestSpace.contract.notReceived': ['Not received', 'Pas reçu', 'No recibida'],
  'guestSpace.contract.notReceivedPh': ['What is wrong?', 'Qu’est-ce qui ne va pas ?', '¿Qué pasa?'],
  'guestSpace.contract.receivedToast': ['Thanks · {org} is notified', 'Merci · {org} est prévenu', 'Gracias · {org} está avisado'],
  'guestSpace.contract.read': ['Read the contract', 'Lire le contrat', 'Leer el contrato'],
  'guestSpace.contract.infoProposed': ['To sign in the Money tab.', 'À signer dans l’onglet Argent.', 'Por firmar en la pestaña Dinero.'],
  'guestSpace.mail.contract': [
    '{inviter} also proposes a contract for the night: you can read and sign it in your space.',
    '{inviter} te propose aussi un contrat pour la soirée : tu le lis et le signes dans ton espace.',
    '{inviter} también te propone un contrato para la noche: lo lees y lo firmas en tu espacio.',
  ],
  // Console : le contrat d'un invité
  'guestSpace.org.contract': ['Contract', 'Contrat', 'Contrato'],
  'guestSpace.org.contractNone': ['No contract: you settle between you.', 'Sans contrat : vous réglez entre vous.', 'Sin contrato: lo arregláis entre vosotros.'],
  'guestSpace.org.contractPropose': ['Propose a contract', 'Proposer un contrat', 'Proponer un contrato'],
  'guestSpace.org.contractEdit': ['Change the terms', 'Modifier les termes', 'Cambiar las condiciones'],
  'guestSpace.org.contractCancel': ['Withdraw the contract', 'Retirer le contrat', 'Retirar el contrato'],
  'guestSpace.org.contractWaiting': ['Sent · waiting for signature (version {n})', 'Envoyé · en attente de signature (version {n})', 'Enviado · esperando la firma (versión {n})'],
  'guestSpace.org.contractSigned': ['Signed on {date} by {name}', 'Signé le {date} par {name}', 'Firmado el {date} por {name}'],
  'guestSpace.org.contractHint': [
    "The guest signs in its space, signed in to its Yuno account. Changing the terms after signature asks for a new signature.",
    "L’invité signe dans son espace, connecté à son compte Yuno. Changer les termes après signature demande une nouvelle signature.",
    "El invitado firma en su espacio, con su cuenta Yuno. Cambiar las condiciones tras la firma pide una nueva firma.",
  ],
  'guestSpace.org.ticketsPct': ['Tickets share (%)', 'Part des billets (%)', 'Parte de las entradas (%)'],
  'guestSpace.org.tablesPct': ['Tables share (%)', 'Part des tables (%)', 'Parte de las mesas (%)'],
  'guestSpace.org.payTerms': ['Transfer within', 'Virement sous', 'Transferencia en'],
  'guestSpace.org.days': ['{n} days', '{n} jours', '{n} días'],
  'guestSpace.org.barToGuest': ['The bar stays with the club', 'Le bar reste au club', 'La barra queda para el club'],
  'guestSpace.org.note': ['Special terms (optional)', 'Conditions particulières (facultatif)', 'Condiciones particulares (opcional)'],
  'guestSpace.org.contractSend': ['Sign and send', 'Signer et envoyer', 'Firmar y enviar'],
  'guestSpace.org.contractSent': ['Contract sent to {guest}', 'Contrat envoyé à {guest}', 'Contrato enviado a {guest}'],
  'guestSpace.org.contractWithdrawn': ['Contract withdrawn', 'Contrat retiré', 'Contrato retirado'],
  'guestSpace.org.contractFrozen': ['Statement frozen: share {amount}', 'Décompte figé : part de {amount}', 'Liquidación cerrada: parte de {amount}'],
  'guestSpace.org.ibanOf': ['IBAN of {guest}', 'IBAN de {guest}', 'IBAN de {guest}'],
  'guestSpace.org.ibanWaiting': ['{guest} has not entered its IBAN yet', '{guest} n’a pas encore donné son IBAN', '{guest} aún no ha indicado su IBAN'],
  'guestSpace.org.transferSent': ['I sent the transfer', 'J’ai viré', 'He transferido'],
  'guestSpace.org.transferRefPh': ['Bank reference (optional)', 'Référence bancaire (facultatif)', 'Referencia bancaria (opcional)'],
  'guestSpace.org.transferSentToast': ['{guest} is asked to confirm', '{guest} doit confirmer la réception', '{guest} debe confirmar la recepción'],
  'guestSpace.org.tr.pending': ['To transfer by {date}', 'À virer au plus tard le {date}', 'A transferir como tarde el {date}'],
  'guestSpace.org.tr.sent': ['Sent on {date} · waiting for confirmation', 'Viré le {date} · en attente de confirmation', 'Transferida el {date} · esperando confirmación'],
  'guestSpace.org.tr.received': ['Received on {date}', 'Reçu le {date}', 'Recibida el {date}'],
  'guestSpace.org.tr.disputed': ['Not received: “{reason}”', 'Pas reçu : « {reason} »', 'No recibida: «{reason}»'],
  'guestSpace.org.contractOff': ['No contract', 'Sans contrat', 'Sin contrato'],
  'guestSpace.org.contractOffHint': ['You settle between you, outside Yuno.', 'Vous réglez entre vous, hors Yuno.', 'Lo arregláis entre vosotros, fuera de Yuno.'],
  'guestSpace.org.contractOnHint': [
    "A share of the net, signed in its space. Yuno tracks the statement and the transfer.",
    "Une part du net, signée dans son espace. Yuno suit le décompte et le virement.",
    "Una parte del neto, firmada en su espacio. Yuno sigue la liquidación y la transferencia.",
  ],
  'guestSpace.org.amounts': ['Amounts', 'Montants', 'Importes'],
  'guestSpace.org.amountsOff': ['Hidden', 'Sans montants', 'Sin importes'],
  'guestSpace.org.amountsOn': ['Shown', 'Avec montants', 'Con importes'],
  'guestSpace.org.amountsOffContractHint': ['Sees its share and its transfer, never the night revenue.', 'Voit sa part et son virement, jamais le CA de la soirée.', 'Ve su parte y su transferencia, nunca la facturación de la noche.'],
  'guestSpace.org.modeAmountsHint': ['Sees sales and revenue. You settle between you.', 'Voit les ventes et le CA. Vous réglez entre vous.', 'Ve las ventas y la facturación. Lo arregláis entre vosotros.'],
  'guestSpace.org.modeStatsHint': ['Sees sales in numbers, never in euros.', 'Voit les ventes en nombre, jamais en euros.', 'Ve las ventas en número, nunca en euros.'],
  'guestSpace.org.modeContract': ['Contract to sign', 'Contrat à signer', 'Contrato por firmar'],
  'guestSpace.invite.kicker': [
    "Invitation",
    "Invitation",
    "Invitación",
  ],
  'guestSpace.invite.title': [
    "{inviter} invites {guest} to {event}",
    "{inviter} invite {guest} sur {event}",
    "{inviter} invita a {guest} a {event}",
  ],
  'guestSpace.invite.body': [
    "Your space for the night: where sales stand, your guest list share, your sales links, the door and the money. It opens with your Yuno account.",
    "Ton espace de la soirée : où en sont les ventes, ta part de guest list, tes liens de vente, la porte et l’argent. Il s’ouvre avec ton compte Yuno.",
    "Tu espacio de la noche: cómo van las ventas, tu parte de la guest list, tus enlaces de venta, la puerta y el dinero. Se abre con tu cuenta Yuno.",
  ],
  'guestSpace.invite.create': [
    "Create my account",
    "Créer mon compte",
    "Crear mi cuenta",
  ],
  'guestSpace.invite.signIn': [
    "I already have an account",
    "J’ai déjà un compte",
    "Ya tengo una cuenta",
  ],
  'guestSpace.invite.emailNote': [
    "Use {email}: the invitation is reserved for this address.",
    "Utilise {email} : l’invitation est réservée à cette adresse.",
    "Usa {email}: la invitación está reservada a esta dirección.",
  ],
  'guestSpace.invite.simple': [
    "A simple account: no subscription, no Console. Your space then stays on your Yuno profile.",
    "Un compte simple : pas d’abonnement, pas de Console. Ton espace reste ensuite sur ton profil Yuno.",
    "Una cuenta simple: sin suscripción ni Consola. Tu espacio queda después en tu perfil Yuno.",
  ],
  'guestSpace.invite.opening': [
    "Opening your space…",
    "Ouverture de ton espace…",
    "Abriendo tu espacio…",
  ],
  'guestSpace.invite.mismatchTitle': [
    "Not the right account",
    "Ce n’est pas le bon compte",
    "No es la cuenta correcta",
  ],
  'guestSpace.invite.mismatchBody': [
    "This invitation was sent to {email}. You are signed in as {current}.",
    "Cette invitation a été envoyée à {email}. Tu es connecté avec {current}.",
    "Esta invitación se envió a {email}. Has iniciado sesión con {current}.",
  ],
  'guestSpace.invite.switch': [
    "Use another account",
    "Changer de compte",
    "Cambiar de cuenta",
  ],
  'guestSpace.invite.takenTitle': [
    "Invitation already used",
    "Invitation déjà utilisée",
    "Invitación ya usada",
  ],
  'guestSpace.invite.takenBody': [
    "This invitation was opened with another account. Sign in with that account, or ask {org} to send you a new one.",
    "Cette invitation a été ouverte avec un autre compte. Connecte-toi avec ce compte, ou demande à {org} de t’en renvoyer une.",
    "Esta invitación se abrió con otra cuenta. Inicia sesión con esa cuenta, o pide a {org} que te envíe otra.",
  ],
  'guestSpace.invite.expiredTitle': [
    "Link expired",
    "Lien expiré",
    "Enlace caducado",
  ],
  'guestSpace.invite.expiredBody': [
    "This invitation link no longer works. Ask {org} to send you a new one.",
    "Ce lien d’invitation ne marche plus. Demande à {org} de t’en renvoyer un.",
    "Este enlace de invitación ya no funciona. Pide a {org} que te envíe otro.",
  ],
  'guestSpace.invite.revokedTitle': [
    "Access closed",
    "Accès coupé",
    "Acceso cerrado",
  ],
  'guestSpace.invite.revokedBody': [
    "{org} closed this access.",
    "{org} a coupé cet accès.",
    "{org} ha cerrado este acceso.",
  ],
  'guestSpace.invite.openSpace': [
    "Open my space",
    "Ouvrir mon espace",
    "Abrir mi espacio",
  ],
  'guestSpace.state.signInTitle': [
    "Sign in to open your space",
    "Connecte-toi pour ouvrir ton espace",
    "Inicia sesión para abrir tu espacio",
  ],
  'guestSpace.state.signInBody': [
    "Your space for the night opens with the Yuno account that accepted the invitation.",
    "Ton espace de la soirée s’ouvre avec le compte Yuno qui a accepté l’invitation.",
    "Tu espacio de la noche se abre con la cuenta Yuno que aceptó la invitación.",
  ],
  'guestSpace.state.signIn': [
    "Sign in",
    "Me connecter",
    "Iniciar sesión",
  ],
  'guestSpace.state.otherAccount': [
    "Sign in with another account",
    "Me connecter avec un autre compte",
    "Iniciar sesión con otra cuenta",
  ],
  'guestSpace.shell.account': [
    "Signed in: {email}",
    "Connecté : {email}",
    "Sesión: {email}",
  ],
  'guestSpace.card.title': [
    "Guest · {event}",
    "Invité · {event}",
    "Invitado · {event}",
  ],
  'guestSpace.card.sub': [
    "{date} · invited by {org}",
    "{date} · invité par {org}",
    "{date} · invitado por {org}",
  ],
  'guestSpace.org.linkedTo': [
    "Opened with {email}",
    "Ouvert avec {email}",
    "Abierto con {email}",
  ],
  'guestSpace.org.notLinked': [
    "Invitation not opened yet",
    "Invitation pas encore ouverte",
    "Invitación aún no abierta",
  ],
  'guestSpace.org.resendInvite': [
    "Send a new invitation",
    "Renvoyer une invitation",
    "Enviar una nueva invitación",
  ],
  'guestSpace.org.resendConfirm': [
    "The account that opened this access is detached and the old links stop working. A new invitation link is created.",
    "Le compte qui a ouvert cet accès est détaché et les anciens liens ne marchent plus. Un nouveau lien d’invitation est créé.",
    "La cuenta que abrió este acceso se desvincula y los enlaces antiguos dejan de funcionar. Se crea un nuevo enlace de invitación.",
  ],
  'guestSpace.org.resent': [
    "New invitation ready",
    "Nouvelle invitation prête",
    "Nueva invitación lista",
  ],
  'guestSpace.org.newLinkNote': [
    "Each copy creates a fresh invitation link; earlier links still work until opened.",
    "Chaque copie crée un lien d’invitation neuf ; les liens d’avant marchent jusqu’à l’ouverture.",
    "Cada copia crea un enlace de invitación nuevo; los anteriores funcionan hasta la apertura.",
  ],
  'guestSpace.org.door': [
    "Who runs the door",
    "Qui tient la porte",
    "Quién lleva la puerta",
  ],
  'guestSpace.org.doorOrganizer': [
    "My team",
    "Mon équipe",
    "Mi equipo",
  ],
  'guestSpace.org.doorGuest': [
    "The club",
    "Le club",
    "El club",
  ],
  'guestSpace.org.doorBoth': [
    "Both",
    "Les deux",
    "Ambos",
  ],
  'guestSpace.org.doorHint': [
    "The club invites its own door staff for this night only when the door is its own (or shared). You can always invite.",
    "Le club n’invite son staff de porte pour cette soirée que si la porte est à lui (ou partagée). Toi, tu peux toujours inviter.",
    "El club solo invita a su staff de puerta para esta noche si la puerta es suya (o compartida). Tú siempre puedes invitar.",
  ],
  'guestSpace.door.byOrganizer': [
    "Run by {org}’s team",
    "Tenue par l’équipe de {org}",
    "Llevada por el equipo de {org}",
  ],
  'guestSpace.door.byGuest': [
    "Run by your team",
    "Tenue par ton équipe",
    "Llevada por tu equipo",
  ],
  'guestSpace.door.byBoth': [
    "Run by {org}’s team and yours",
    "Tenue par l’équipe de {org} et la tienne",
    "Llevada por el equipo de {org} y el tuyo",
  ],
  'guestSpace.mkt.poster': [
    "Poster",
    "Affiche",
    "Cartel",
  ],
  'guestSpace.mkt.wide': [
    "16:9 image",
    "Image 16:9",
    "Imagen 16:9",
  ],
  'guestSpace.mkt.video': [
    "Video of the night",
    "Vidéo de la soirée",
    "Vídeo de la noche",
  ],
  'guestSpace.mkt.noVisuals': [
    "{org} has not added visuals to the night yet.",
    "{org} n’a pas encore mis de visuels sur la soirée.",
    "{org} aún no ha subido visuales a la noche.",
  ],
  'guestSpace.err.sign_in_required': [
    "Sign in to continue.",
    "Connecte-toi pour continuer.",
    "Inicia sesión para continuar.",
  ],
  'guestSpace.err.email_mismatch': [
    "This invitation is reserved for another address.",
    "Cette invitation est réservée à une autre adresse.",
    "Esta invitación está reservada a otra dirección.",
  ],
  'guestSpace.err.already_linked': [
    "This invitation was opened with another account.",
    "Cette invitation a été ouverte avec un autre compte.",
    "Esta invitación se abrió con otra cuenta.",
  ],
  'guestSpace.err.invite_expired': [
    "This invitation link no longer works.",
    "Ce lien d’invitation ne marche plus.",
    "Este enlace de invitación ya no funciona.",
  ],
  'guestSpace.err.door_not_yours': [
    "The door of this night is run by the organizer.",
    "La porte de cette soirée est tenue par l’organisateur.",
    "La puerta de esta noche la lleva el organizador.",
  ],
  'guestSpace.err.revoked': [
    "This access is closed.",
    "Cet accès est coupé.",
    "Este acceso está cerrado.",
  ],
  'guestSpace.invite.notFoundBody': [
    "This invitation link does not exist. Ask the organizer for yours.",
    "Ce lien d’invitation n’existe pas. Demande le tien à l’organisateur.",
    "Este enlace de invitación no existe. Pide el tuyo al organizador.",
  ],
  'guestSpace.photo.title': [
    "Profile photo",
    "Photo de profil",
    "Foto de perfil",
  ],
  'guestSpace.photo.sub': [
    "Your logo or a photo of your place. Shown to {org} and on the night’s figures.",
    "Ton logo ou une photo de ton lieu. Visible par {org} et dans les chiffres de la soirée.",
    "Tu logo o una foto de tu local. Visible para {org} y en las cifras de la noche.",
  ],
  'guestSpace.photo.add': [
    "Add a photo",
    "Ajouter une photo",
    "Añadir una foto",
  ],
  'guestSpace.photo.change': [
    "Change",
    "Changer",
    "Cambiar",
  ],
  'guestSpace.photo.remove': [
    "Remove",
    "Retirer",
    "Quitar",
  ],
  'guestSpace.photo.saved': [
    "Photo saved",
    "Photo enregistrée",
    "Foto guardada",
  ],
  'guestSpace.photo.removed': [
    "Photo removed",
    "Photo retirée",
    "Foto quitada",
  ],
  'guestSpace.photo.hint': [
    "Square works best. WebP, JPEG or PNG.",
    "Un carré rend le mieux. WebP, JPEG ou PNG.",
    "Un cuadrado queda mejor. WebP, JPEG o PNG.",
  ],
  'guestSpace.org.photo': [
    "Photo",
    "Photo",
    "Foto",
  ],
  'guestSpace.org.photoHint': [
    "Their logo or a photo of the place, until they choose their own.",
    "Son logo ou une photo du lieu, jusqu’à ce que l’invité choisisse la sienne.",
    "Su logo o una foto del local, hasta que el invitado elija la suya.",
  ],
  'guestSpace.org.photoByGuest': [
    "Photo chosen by the guest",
    "Photo choisie par l’invité",
    "Foto elegida por el invitado",
  ],
  'guestSpace.err.invalid_photo': [
    "This file is not a usable image.",
    "Ce fichier n’est pas une image utilisable.",
    "Este archivo no es una imagen utilizable.",
  ],
  'guestSpace.err.photo_too_big': [
    "This image is too heavy, even compressed (1 MB max).",
    "Cette image est trop lourde, même compressée (1 Mo au plus).",
    "Esta imagen pesa demasiado, incluso comprimida (1 MB máx.).",
  ],
  'guestSpace.err.photo_upload_failed': [
    "The photo could not be sent. Try again.",
    "La photo n’a pas pu être envoyée. Réessaie.",
    "No se pudo enviar la foto. Inténtalo de nuevo.",
  ],
  'guestSpace.err.guest_photo_locked': [
    "The guest chose their own photo: it stays.",
    "L’invité a choisi sa photo : elle reste.",
    "El invitado eligió su foto: se queda.",
  ],
  'guestSpace.bell.dueReminder': [
    "Transfer due {date}: check the statement",
    "Virement attendu le {date} : vérifie le décompte",
    "Transferencia prevista el {date}: revisa la liquidación",
  ],
  'guestSpace.bell.nightTime': [
    "New time for the night: {when}",
    "Nouvel horaire pour la soirée : {when}",
    "Nuevo horario para la noche: {when}",
  ],
  'guestSpace.bell.nightPlace': [
    "New address for the night: {place}",
    "Nouvelle adresse pour la soirée : {place}",
    "Nueva dirección para la noche: {place}",
  ],
  'guestSpace.bell.lineup': [
    "The line-up has changed",
    "Le line-up a changé",
    "El line-up ha cambiado",
  ],
  'guestSpace.bell.nightCancelled': [
    "The night is cancelled",
    "La soirée est annulée",
    "La noche está cancelada",
  ],
  'guestSpace.bell.nightPostponed': [
    "The night is postponed",
    "La soirée est reportée",
    "La noche se aplaza",
  ],
  'guestSpace.bell.doorsTonight': [
    "Doors open tonight at {time}",
    "Les portes ouvrent ce soir à {time}",
    "Las puertas abren esta noche a las {time}",
  ],
  'guestSpace.bell.recapReady': [
    "The night’s recap is ready",
    "Le bilan de la soirée est prêt",
    "El balance de la noche está listo",
  ],
  'guestSpace.bell.glPlaces': [
    "Your guest list share: {n} places",
    "Ta part de guest list : {n} places",
    "Tu parte de guest list: {n} plazas",
  ],
  'guestSpace.bell.glFull': [
    "Your guest list share is full ({n} places)",
    "Ta part de guest list est pleine ({n} places)",
    "Tu parte de guest list está llena ({n} plazas)",
  ],
  'guestSpace.bell.placesAccepted': [
    "{org} gave you the {n} extra places",
    "{org} t’a donné les {n} places demandées",
    "{org} te ha dado las {n} plazas pedidas",
  ],
  'guestSpace.bell.placesDeclined': [
    "{org} declined your request for {n} places",
    "{org} a refusé ta demande de {n} places",
    "{org} ha rechazado tu solicitud de {n} plazas",
  ],
  'guestSpace.bell.doorMode': [
    "Door: {door}",
    "Porte : {door}",
    "Puerta: {door}",
  ],
  'guestSpace.bell.salesDay': [
    "+{n} tickets today",
    "+{n} billets aujourd’hui",
    "+{n} entradas hoy",
  ],
  'guestSpace.bell.salesDayMine': [
    "+{n} tickets today, {mine} through your link",
    "+{n} billets aujourd’hui, dont {mine} par ton lien",
    "+{n} entradas hoy, {mine} por tu enlace",
  ],
  'guestSpace.bell.fill50': [
    "Half the tickets are sold",
    "La moitié des billets est vendue",
    "La mitad de las entradas está vendida",
  ],
  'guestSpace.bell.fill75': [
    "75% of the tickets are sold",
    "75 % des billets sont vendus",
    "El 75 % de las entradas está vendido",
  ],
  'guestSpace.bell.soldOut': [
    "Sold out!",
    "Complet !",
    "¡Completo!",
  ],
  'guestSpace.notifMail.subject': [
    "{event}: {text}",
    "{event} : {text}",
    "{event}: {text}",
  ],
  'guestSpace.notifMail.kicker': [
    "Your space for the night",
    "Ton espace de la soirée",
    "Tu espacio de la noche",
  ],
  'guestSpace.notifMail.next': [
    "Sign in to your Yuno account to see the details.",
    "Connecte-toi à ton compte Yuno pour voir le détail.",
    "Inicia sesión en tu cuenta Yuno para ver el detalle.",
  ],
} as const satisfies Record<string, readonly [string, string, string]>;

export type GuestSpaceWordKey = keyof typeof WORDS;
export type GuestSpaceWords = (key: GuestSpaceWordKey, vars?: Record<string, string | number>) => string;

/** Les mots d'une langue, variables `{nom}` remplacées. */
export function guestSpaceWords(lang: GuestSpaceLanguage): GuestSpaceWords {
  const i = INDEX[lang];
  return (key, vars) => {
    const row = (WORDS as Record<string, readonly [string, string, string]>)[key];
    let s: string = row ? row[i] : String(key);
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
  };
}

/** Toutes les clés (test de parité des trois langues). */
export const GUEST_SPACE_WORDS_RAW: Readonly<Record<string, readonly [string, string, string]>> = WORDS;

export function guestSpaceShareText(lang: GuestSpaceLanguage, p: { guest: string; event: string; page: string }): string {
  return guestSpaceWords(lang)('guestSpace.share.whatsapp', p);
}

// ─── Notifications de l'invité : une ligne de la base → un texte ────────────
export type GuestNotifTab = 'home' | 'sales' | 'mkt' | 'money' | 'door' | 'info';
export interface GuestNotifText { key: GuestSpaceWordKey; vars: Record<string, string | number>; tab: GuestNotifTab }

/**
 * Le texte d'une notification (`guest_pass_notifications.type` + `data`),
 * le même dans la cloche et dans l'e-mail. Dates à l'heure du lieu.
 * `eur` met en forme un montant (le front et l'e-mail ont le leur).
 */
export function describeGuestNotification(
  type: string, data: Record<string, unknown>, lang: GuestSpaceLanguage, eur: (n: number) => string = (n) => `${n} €`,
): GuestNotifText | null {
  const w = guestSpaceWords(lang);
  const loc = guestSpaceLocale(lang);
  const tz = typeof data.tz === 'string' && data.tz ? data.tz : 'Europe/Paris';
  const fmt = (iso: unknown, o: Intl.DateTimeFormatOptions) => {
    if (typeof iso !== 'string' || !iso) return '';
    try { return new Intl.DateTimeFormat(loc, { ...o, timeZone: tz }).format(new Date(iso)); } catch { return ''; }
  };
  const str = (k: string) => (data[k] == null ? '' : String(data[k]));
  const num = (k: string) => Number(data[k]) || 0;
  switch (type) {
    case 'contract': case 'contractChanged':
      return { key: `guestSpace.bell.${type}` as GuestSpaceWordKey, vars: { org: str('org'), n: num('n') }, tab: 'money' };
    case 'contractSigned':
      return { key: 'guestSpace.bell.contractSigned', vars: {}, tab: 'money' };
    case 'frozen':
      return { key: 'guestSpace.bell.frozen', vars: { amount: eur(num('amount')) }, tab: 'money' };
    case 'transferSent':
      return { key: 'guestSpace.bell.transferSent', vars: { org: str('org') }, tab: 'money' };
    case 'dueReminder':
      return { key: 'guestSpace.bell.dueReminder', vars: { date: fmt(data.due, { day: 'numeric', month: 'long' }) }, tab: 'money' };
    case 'nightTime':
      return { key: 'guestSpace.bell.nightTime', vars: { when: fmt(data.start, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) }, tab: 'info' };
    case 'nightPlace':
      return { key: 'guestSpace.bell.nightPlace', vars: { place: str('place') }, tab: 'info' };
    case 'lineup': case 'nightCancelled': case 'nightPostponed':
      return { key: `guestSpace.bell.${type}` as GuestSpaceWordKey, vars: {}, tab: 'info' };
    case 'doorsTonight':
      return { key: 'guestSpace.bell.doorsTonight', vars: { time: fmt(data.start, { hour: '2-digit', minute: '2-digit' }) }, tab: 'door' };
    case 'recapReady':
      return { key: 'guestSpace.bell.recapReady', vars: {}, tab: 'sales' };
    case 'glPlaces': case 'glFull': case 'placesAccepted': case 'placesDeclined':
      return { key: `guestSpace.bell.${type}` as GuestSpaceWordKey, vars: { n: num('n'), org: str('org') }, tab: 'door' };
    case 'doorMode': {
      const m = str('mode');
      const door = m === 'guest' ? w('guestSpace.door.byGuest') : m === 'both' ? w('guestSpace.door.byBoth', { org: str('org') }) : w('guestSpace.door.byOrganizer', { org: str('org') });
      return { key: 'guestSpace.bell.doorMode', vars: { door }, tab: 'door' };
    }
    case 'staffAdded': case 'staffAccepted':
      return { key: `guestSpace.bell.${type}` as GuestSpaceWordKey, vars: { name: str('name'), org: str('org') }, tab: 'door' };
    case 'salesDay':
      return num('mine') > 0
        ? { key: 'guestSpace.bell.salesDayMine', vars: { n: num('n'), mine: num('mine') }, tab: 'sales' }
        : { key: 'guestSpace.bell.salesDay', vars: { n: num('n') }, tab: 'sales' };
    case 'fill': {
      const p = num('pct');
      return { key: p >= 100 ? 'guestSpace.bell.soldOut' : p >= 75 ? 'guestSpace.bell.fill75' : 'guestSpace.bell.fill50', vars: {}, tab: 'sales' };
    }
    default:
      return null;
  }
}
