import type { Triple } from '../../crm/modules/types';

// Analyses de Yuno Tickets : ce qui diffère des Analyses de Yuno CRM — [EN, FR, ES].
// Les ventes sont celles de Yuno (billets, tables VIP, guest list), jamais Shotgun ;
// les sources sont l'attribution figée sur chaque vente ; les visites de la page de
// vente sont mesurées. Vouvoiement, comme le CRM (décision D2 du 17/10).
const dict: Record<string, Triple> = {
  // En-tête
  'ya.ana.sub.traffic': [
    'The links and channels that sell, and what they add to your list. Read from the source recorded on every sale.',
    'Les liens et canaux qui font vendre, et ce qu’ils ajoutent à votre base. Lu dans la source retenue pour chaque vente.',
    'Los enlaces y canales que venden y lo que suman a su base. Leído en la fuente registrada en cada venta.',
  ],
  'ya.ana.sub.community': [
    'Unique contacts, duplicates merged: buyers, guest list and the files imported into Yuno Tickets.',
    'Contacts uniques, doublons fusionnés : acheteurs, guest list et fichiers importés dans Yuno Tickets.',
    'Contactos únicos, duplicados fusionados: compradores, guest list y archivos importados en Yuno Tickets.',
  ],
  'ya.ana.sub.guestlist': [
    'Free entries (€0 tickets) and the guest list (sign-ups), night by night. Show-up only appears when the door was measured.',
    'Entrées gratuites (billets à 0 €) et guest list (inscriptions), soirée par soirée. Le taux de venue n’apparaît que si la porte est mesurée.',
    'Entradas gratuitas (a 0 €) y guest list (inscripciones), fiesta a fiesta. La asistencia solo aparece si la puerta está medida.',
  ],
  'ya.ana.s.foot': [
    'A night ends at {h}: a purchase made later counts for the next day. Updated on {date}.',
    'Une nuit se termine à {h} : un achat fait après compte pour le lendemain. Mis à jour le {date}.',
    'Una noche termina a las {h}: una compra hecha después cuenta para el día siguiente. Actualizado el {date}.',
  ],
  'ya.ana.push': ['Push', 'Push', 'Push'],
  'ya.ana.t.bigSub': ['sales (tickets and VIP tables), split by source', 'ventes (billets et tables VIP), réparties par source', 'ventas (entradas y mesas VIP), repartidas por fuente'],

  // Ventes : tables VIP, message Yuno
  'ya.ana.s.nTables.one': ['{n} table', '{n} table', '{n} mesa'],
  'ya.ana.s.nTables.other': ['{n} tables', '{n} tables', '{n} mesas'],
  'ya.tk.tables.one': ['VIP table', 'table VIP', 'mesa VIP'],
  'ya.tk.tables.other': ['VIP tables', 'tables VIP', 'mesas VIP'],
  'ya.ana.s.madeS': [
    'of your sales come from a Yuno message (email or SMS): {v}.',
    'de vos ventes viennent d’un message Yuno (e-mail ou SMS) : {v}.',
    'de sus ventas vienen de un mensaje de Yuno (e-mail o SMS): {v}.',
  ],
  'ya.ana.s.madeSTk': [
    'of your sales come from a Yuno message (email or SMS): {n} tickets.',
    'de vos ventes viennent d’un message Yuno (e-mail ou SMS) : {n} billets.',
    'de sus ventas vienen de un mensaje de Yuno (e-mail o SMS): {n} entradas.',
  ],
  'ya.ana.g.noneTxt': [
    'As soon as a night is on sale, its sales pace shows here.',
    'Dès qu’une soirée est en vente, son rythme de vente s’affiche ici.',
    'En cuanto una fiesta está a la venta, su ritmo de ventas aparece aquí.',
  ],
  'ya.ana.g.txtNoCap': [
    'This night has no set capacity (a ticket with no limit): the reference is the average of your last two.',
    'Cette soirée n’a pas de jauge fixe (un billet sans limite) : la référence est la moyenne de vos deux dernières.',
    'Esta fiesta no tiene aforo fijo (una entrada sin límite): la referencia es la media de las dos últimas.',
  ],

  // Trafic : les sources d'une vente Yuno
  'ya.ana.src.ys': ['Instagram stories (tracked links)', 'Stories Instagram (liens suivis)', 'Stories de Instagram (enlaces con seguimiento)'],
  'ya.ana.src.ys.s': ['Instagram stories', 'Stories Instagram', 'Stories de Instagram'],
  'ya.ana.src.yb': ['Instagram link (tracked)', 'Lien Instagram (lien suivi)', 'Enlace de Instagram (con seguimiento)'],
  'ya.ana.src.yb.s': ['Instagram', 'Instagram', 'Instagram'],
  'ya.ana.src.yt': ['TikTok link (tracked)', 'Lien TikTok (lien suivi)', 'Enlace de TikTok (con seguimiento)'],
  'ya.ana.src.yt.s': ['TikTok', 'TikTok', 'TikTok'],
  'ya.ana.src.wa': ['WhatsApp link (tracked)', 'Lien WhatsApp (lien suivi)', 'Enlace de WhatsApp (con seguimiento)'],
  'ya.ana.src.wa.s': ['WhatsApp', 'WhatsApp', 'WhatsApp'],
  'ya.ana.src.yl': ['Other tracked links', 'Autres liens suivis', 'Otros enlaces con seguimiento'],
  'ya.ana.src.yl.s': ['Other links', 'Autres liens', 'Otros enlaces'],
  'ya.ana.src.pr': ['Promoters', 'Promoteurs', 'Promotores'],
  'ya.ana.src.pr.s': ['Promoters', 'Promoteurs', 'Promotores'],
  'ya.ana.src.pa': ['Partners and co-hosts', 'Partenaires et co-organisateurs', 'Socios y coorganizadores'],
  'ya.ana.src.pa.s': ['Partners', 'Partenaires', 'Socios'],
  'ya.ana.src.ad': ['Meta ads', 'Publicité Meta', 'Publicidad de Meta'],
  'ya.ana.src.ad.s': ['Meta ads', 'Pubs Meta', 'Anuncios de Meta'],
  'ya.ana.src.pc': ['Promo codes', 'Codes promo', 'Códigos promocionales'],
  'ya.ana.src.pc.s': ['Promo codes', 'Codes promo', 'Códigos promo'],
  'ya.ana.src.mk': ['Yuno (Explore, club and organiser pages)', 'Yuno (Explore, pages du club et de l’organisateur)', 'Yuno (Explore, páginas del club y del organizador)'],
  'ya.ana.src.mk.s': ['Yuno', 'Yuno', 'Yuno'],
  'ya.ana.src.of': ['On site or added by hand', 'Sur place ou ajouté à la main', 'En el lugar o añadido a mano'],
  'ya.ana.src.of.s': ['On site', 'Sur place', 'En el lugar'],
  'ya.ana.t.srcFoot': [
    'The source is the one Yuno recorded for each sale: tracked link, promoter, partner, email, promo code, Yuno pages or social media. To know which story or group sells, create a tracked link for the night (Links). New = the person’s first purchase with you.',
    'La source est celle que Yuno a retenue pour chaque vente : lien suivi, promoteur, partenaire, e-mail, code promo, pages Yuno ou réseaux. Pour savoir quelle story ou quel groupe vend, créez un lien suivi pour la soirée (Liens). Nouveau = premier achat de la personne chez vous.',
    'La fuente es la que Yuno registró para cada venta: enlace con seguimiento, promotor, socio, e-mail, código promo, páginas de Yuno o redes. Para saber qué story o qué grupo vende, cree un enlace con seguimiento para la fiesta (Enlaces). Nuevo = primera compra de la persona con usted.',
  ],
  // Trafic : ce que Yuno mesure (les visites de la page de vente)
  'ya.ana.t.vis.t': ['From visit to purchase', 'De la visite à l’achat', 'De la visita a la compra'],
  'ya.ana.t.vis.sub': [
    'Visits to your Yuno pages (nights, club or organiser page) over the period, and how many go all the way to buying.',
    'Les visites de vos pages Yuno (soirées, page du club ou de l’organisateur) sur la période, et combien vont jusqu’à l’achat.',
    'Las visitas a sus páginas de Yuno (fiestas, página del club o del organizador) en el periodo, y cuántas llegan a la compra.',
  ],
  'ya.ana.t.vis.subEv': [
    'Visits to this night’s page, and how many go all the way to buying.',
    'Les visites de la page de cette soirée, et combien vont jusqu’à l’achat.',
    'Las visitas a la página de esta fiesta, y cuántas llegan a la compra.',
  ],
  'ya.ana.t.vis.visits': ['Visits', 'Visites', 'Visitas'],
  'ya.ana.t.vis.carts': ['Picked a ticket', 'Ont choisi une place', 'Eligieron una entrada'],
  'ya.ana.t.vis.checkouts': ['Opened payment', 'Ont ouvert le paiement', 'Abrieron el pago'],
  'ya.ana.t.vis.orders': ['Bought', 'Ont acheté', 'Compraron'],
  'ya.ana.t.vis.convBig': ['of visits end in a purchase', 'des visites finissent en achat', 'de las visitas acaban en compra'],
  'ya.ana.t.vis.convSmall': ['Fewer than 10 visits: no rate yet', 'Moins de 10 visites : pas encore de taux', 'Menos de 10 visitas: todavía sin tasa'],
  'ya.ana.t.vis.none': [
    'No visit measured over the period. Visits are counted for people who accept audience measurement.',
    'Aucune visite mesurée sur la période. Les visites sont comptées pour les personnes qui acceptent la mesure d’audience.',
    'Ninguna visita medida en el periodo. Las visitas se cuentan para las personas que aceptan la medición de audiencia.',
  ],
  'ya.ana.t.vis.lost.one': [
    '{n} visit picked a ticket without buying: the “Abandoned checkout” automation writes to them on its own (Campaigns › Automations).',
    '{n} visite a choisi une place sans acheter : la recette « Panier abandonné » lui écrit seule (Campagnes › Automatisations).',
    '{n} visita eligió una entrada sin comprar: la automatización «Carrito abandonado» le escribe sola (Campañas › Automatizaciones).',
  ],
  'ya.ana.t.vis.lost.other': [
    '{n} visits picked a ticket without buying: the “Abandoned checkout” automation writes to them on its own (Campaigns › Automations).',
    '{n} visites ont choisi une place sans acheter : la recette « Panier abandonné » leur écrit seule (Campagnes › Automatisations).',
    '{n} visitas eligieron una entrada sin comprar: la automatización «Carrito abandonado» les escribe sola (Campañas › Automatizaciones).',
  ],
  'ya.ana.t.vis.noLost': [
    'Every visit that picked a ticket went on to buy.',
    'Toutes les visites qui ont choisi une place ont acheté.',
    'Todas las visitas que eligieron una entrada compraron.',
  ],

  // Communauté
  'ya.ana.c2.unknown': [
    'Not known yet: Yuno only has it when the buyer gave it.',
    'Pas encore connu : Yuno ne l’a que si l’acheteur l’a renseigné.',
    'Aún no se conoce: Yuno solo lo tiene si el comprador lo indicó.',
  ],
  'ya.ana.c2.histFoot': [
    'Regulars came {n} times or more over the last {m} months.',
    'Les habitués sont ceux venus {n} fois ou plus sur les {m} derniers mois.',
    'Los habituales vinieron {n} veces o más en los últimos {m} meses.',
  ],

  // Guest list
  'ya.gl.a.never.t': [
    'No guest list or free entry in your history yet.',
    'Pas encore de guest list ni d’entrée gratuite dans votre historique.',
    'Todavía no hay guest list ni entrada gratuita en su historial.',
  ],
  'ya.gl.a.never.s': [
    'As soon as you open a guest list or a free ticket on a night, this page shows who signed up, who came, at what time, and who ended up paying.',
    'Dès que vous ouvrez une guest list ou un billet gratuit sur une soirée, cette page montre qui s’est inscrit, qui est venu, à quelle heure, et qui a fini par payer.',
    'En cuanto abra una guest list o una entrada gratuita en una fiesta, esta página muestra quién se inscribió, quién vino, a qué hora y quién acabó pagando.',
  ],
  'ya.gl.arr.s': [
    'Arrival times as the door scanned them.',
    'Heures d’arrivée telles que la porte les a scannées.',
    'Horas de llegada tal como las escaneó la puerta.',
  ],
  'ya.gl.empty.cta': ['Manage this night’s guest list', 'Gérer la guest list de la soirée', 'Gestionar la guest list de la fiesta'],
  'ya.gl.empty.s': [
    'Yuno counts two free things: €0 tickets (free entries) and guest list sign-ups. As soon as one appears, this tab shows who signed up, who came, and who ended up paying.',
    'Yuno compte deux choses gratuites : les billets à 0 € (entrées gratuites) et les inscriptions de guest list. Dès que l’une apparaît, cet onglet montre qui s’est inscrit, qui est venu, et qui a fini par payer.',
    'Yuno cuenta dos cosas gratuitas: las entradas a 0 € (entradas gratuitas) y las inscripciones de guest list. En cuanto aparece una, esta pestaña muestra quién se inscribió, quién vino y quién acabó pagando.',
  ],
  'ya.gl.kind.inv': ['Guest list (sign-ups)', 'Guest list (inscriptions)', 'Guest list (inscripciones)'],
  'ya.gl.kind.inv.s': [
    'Sign-ups on your guest lists (house list, promoters, artists…). Never counted as sales.',
    'Les inscriptions de vos guest lists (liste maison, promoteurs, artistes…). Jamais comptées comme des ventes.',
    'Las inscripciones de sus guest lists (lista de la casa, promotores, artistas…). Nunca cuentan como ventas.',
  ],
  'ya.gl.lists.s': [
    'Each guest list or free ticket is a list: who came, and who it brought in.',
    'Chaque guest list ou billet gratuit est une liste : qui est venu, et qui elle a amené.',
    'Cada guest list o entrada gratuita es una lista: quién vino y a quién trajo.',
  ],
  'ya.gl.lists.sNoScan': [
    'Each guest list or free ticket is a list. The door did not scan enough to compare show-up.',
    'Chaque guest list ou billet gratuit est une liste. La porte n’a pas assez scanné pour comparer la venue.',
    'Cada guest list o entrada gratuita es una lista. La puerta no escaneó lo suficiente para comparar la asistencia.',
  ],
  'ya.gl.lists.sUp': [
    'Each guest list or free ticket is a list. Show-up appears after the night.',
    'Chaque guest list ou billet gratuit est une liste. La venue s’affichera après la soirée.',
    'Cada guest list o entrada gratuita es una lista. La asistencia aparecerá después de la fiesta.',
  ],
  'ya.gl.lists.unnamed': ['House list', 'Liste maison', 'Lista de la casa'],
  'ya.gl.rejected.one': ['{n} request declined', '{n} demande refusée', '{n} solicitud rechazada'],
  'ya.gl.rejected.other': ['{n} requests declined', '{n} demandes refusées', '{n} solicitudes rechazadas'],
  'ya.gl.t.pendingS': ['sign-ups waiting for approval', 'inscriptions en attente de validation', 'inscripciones pendientes de validación'],
  'ya.gl.who.sProfile': [
    'Age and gender as people gave them, free sign-ups next to paying customers.',
    'Âge et genre tels que les personnes les ont renseignés, inscrits gratuits à côté des payants.',
    'Edad y género tal como las personas los indicaron, inscritos gratis junto a los de pago.',
  ],
  'ya.ni.openGuestList': ['Manage the guest list', 'Gérer la guest list', 'Gestionar la guest list'],

  // Parcours client
  'ya.jr.none.connect': [
    'Send an email from Campaigns: tracking starts at the first click.',
    'Envoyez un e-mail depuis Campagnes : le suivi démarre au premier clic.',
    'Envíe un e-mail desde Campañas: el seguimiento empieza con el primer clic.',
  ],
  'ya.jr.none.ctaConnect': ['Create a campaign', 'Créer une campagne', 'Crear una campaña'],
  'ya.jr.pn.tooMany': [
    'Too many people to follow up from here: create a campaign from Campaigns.',
    'Trop de monde pour relancer d’ici : créez une campagne depuis Campagnes.',
    'Demasiada gente para recordar desde aquí: cree una campaña desde Campañas.',
  ],
  'ya.jr.s3.soonIg': [
    'Instagram replies are not tracked here yet.',
    'Les réponses Instagram ne sont pas encore suivies ici.',
    'Las respuestas de Instagram todavía no se siguen aquí.',
  ],

};

export default dict;
