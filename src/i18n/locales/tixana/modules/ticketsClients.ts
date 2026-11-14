import type { Triple } from '../../crm/modules/types';

// Yuno Tickets › Clients, Segments, Imports : ce qui diffère des écrans de Yuno CRM —
// [EN, FR, ES]. La base se remplit à chaque vente Yuno (billets, tables VIP, guest list),
// jamais par Shotgun ; la provenance est « venu par Yuno », « fichier » ou « autre » ;
// la fiche client garde la porte du club. Vouvoiement, comme le CRM.
const dict: Record<string, Triple> = {
  // Clients
  'ya.cli.sub': [
    'Every client, from their first night to their last visit. Segments keep themselves up to date.',
    'Chaque client, de sa première soirée à sa dernière visite. Les segments se tiennent à jour tout seuls.',
    'Cada cliente, de su primera noche a su última visita. Los segmentos se actualizan solos.',
  ],
  'ya.cli.empty.title': [
    'Your clients arrive on their own, with every sale on Yuno.',
    'Vos clients arrivent tout seuls, à chaque vente sur Yuno.',
    'Sus clientes llegan solos, con cada venta en Yuno.',
  ],
  'ya.cli.empty.body': [
    'Tickets, VIP tables and guest list: every buyer joins your list, duplicates merged. You can also import a file.',
    'Billets, tables VIP et guest list : chaque acheteur entre dans votre base, doublons fusionnés. Vous pouvez aussi importer un fichier.',
    'Entradas, mesas VIP y guest list: cada comprador entra en su base, sin duplicados. También puede importar un archivo.',
  ],
  'ya.cli.empty.cta': ['Import a file', 'Importer un fichier', 'Importar un archivo'],
  'ya.cli.f.src.yuno': ['Came through Yuno', 'Venus par Yuno', 'Llegaron por Yuno'],
  'ya.cli.f.src.yuno.s': ['Ticket, table or guest list on Yuno', 'Billet, table ou guest list sur Yuno', 'Entrada, mesa o guest list en Yuno'],
  'ya.cli.f.src.other': ['Other', 'Autre', 'Otro'],
  'ya.cli.f.src.other.s': ['Contact saved without a purchase or a file', 'Contact enregistré sans achat ni fichier', 'Contacto guardado sin compra ni archivo'],
  'ya.cli.card.hist.added': ['Added to your Yuno sales.', 'Ajouté à vos ventes Yuno.', 'Añadido a sus ventas en Yuno.'],
  'ya.cli.card.hist.fileWins': ['More complete than your Yuno sales: this is what counts.', 'Plus complet que vos ventes Yuno : c’est lui qui compte.', 'Más completo que sus ventas en Yuno: es lo que cuenta.'],
  'ya.cli.card.hist.live': ['Already included in your Yuno sales: nothing is counted twice.', 'Déjà compris dans vos ventes Yuno : rien n’est compté deux fois.', 'Ya incluido en sus ventas en Yuno: nada se cuenta dos veces.'],
  'ya.gl.f.title': ['Free entries and guest list', 'Entrées gratuites et guest list', 'Entradas gratuitas y guest list'],
  'ya.cli.msg.reachableTix': ['reachable, unsubscribed people excluded', 'joignables, désabonnés exclus', 'contactables, bajas excluidas'],
  'ya.cli.msg.smsSegmentFirst': [
    'An SMS targets a saved segment: save this selection as a segment first.',
    'Un SMS vise un segment enregistré : enregistrez d’abord cette sélection en segment.',
    'Un SMS se dirige a un segmento guardado: guarde primero esta selección como segmento.',
  ],

  // Fiche client : la porte du club
  'ya.cli.door.title': ['Club door', 'La porte du club', 'La puerta del club'],
  'ya.cli.door.isBanned': ['Banned', 'Banni', 'Vetado'],
  'ya.cli.door.ok': ['Nothing to report', 'Rien à signaler', 'Nada que señalar'],
  'ya.cli.door.since': ['Banned since {date}', 'Banni depuis le {date}', 'Vetado desde el {date}'],
  'ya.cli.door.ban': ['Ban this client', 'Bannir ce client', 'Vetar a este cliente'],
  'ya.cli.door.unban': ['Lift the ban', 'Lever le bannissement', 'Levantar el veto'],
  'ya.cli.door.reasonPh': ['Why? (seen by your team)', 'Pourquoi ? (visible par votre équipe)', '¿Por qué? (visible para su equipo)'],
  'ya.cli.door.confirm': ['Ban', 'Bannir', 'Vetar'],
  'ya.cli.door.cancel': ['Cancel', 'Annuler', 'Cancelar'],
  'ya.cli.door.banned': ['{email} is banned.', '{email} est banni.', '{email} está vetado.'],
  'ya.cli.door.unbanned': ['Ban lifted for {email}.', 'Bannissement levé pour {email}.', 'Veto levantado para {email}.'],
  'ya.cli.door.failed': ['Not possible right now. Try again.', 'Impossible pour l’instant. Réessayez.', 'No es posible por ahora. Inténtelo de nuevo.'],
  'ya.cli.door.manualUnban': ['Lifted from the client card', 'Levé depuis la fiche client', 'Levantado desde la ficha del cliente'],
  'ya.cli.door.type.ban': ['Ban', 'Bannissement', 'Veto'],
  'ya.cli.door.type.unban': ['Ban lifted', 'Bannissement levé', 'Veto levantado'],
  'ya.cli.door.type.warning': ['Warning', 'Avertissement', 'Advertencia'],
  'ya.cli.door.type.refund': ['Refund', 'Remboursement', 'Reembolso'],
  'ya.cli.door.type.fight': ['Fight', 'Bagarre', 'Pelea'],
  'ya.cli.door.type.drunk': ['Too drunk', 'Ivresse', 'Embriaguez'],
  'ya.cli.door.type.theft': ['Theft', 'Vol', 'Robo'],
  'ya.cli.door.type.harassment': ['Harassment', 'Harcèlement', 'Acoso'],
  'ya.cli.door.type.other': ['Incident', 'Incident', 'Incidente'],

  // Segments
  'ya.seg.empty.title': [
    'Your automatic segments appear with your first sale.',
    'Vos segments automatiques apparaissent dès votre première vente.',
    'Sus segmentos automáticos aparecen con su primera venta.',
  ],
  'ya.seg.empty.body': [
    'Regulars, occasional, new, lapsed: they keep themselves up to date. Message tracking starts with the first send.',
    'Habitués, occasionnels, nouveaux, endormis : ils se tiennent à jour tout seuls. Le suivi des messages démarre au premier envoi.',
    'Habituales, ocasionales, nuevos, dormidos: se actualizan solos. El seguimiento de mensajes empieza con el primer envío.',
  ],
  'ya.seg.empty.cta': ['Import a file', 'Importer un fichier', 'Importar un archivo'],
  // Pas de calcul de nuit dans Yuno Tickets : un segment se recalcule à chaque lecture.
  'ya.seg.head.autoSub': [
    'Always up to date, they cover your whole list without overlap.',
    'Toujours à jour, ils couvrent toute votre base sans chevauchement.',
    'Siempre al día, cubren toda su base sin solaparse.',
  ],
  'ya.seg.head.mineSub': [
    'Your rules, always up to date. A client can be in one as well as in an automatic one.',
    'Vos règles, toujours à jour. Un client peut y figurer en plus d’un automatique.',
    'Sus reglas, siempre al día. Un cliente puede estar en uno además de en uno automático.',
  ],
  'ya.seg.dr.trendThin': [
    'The trend appears once the first reference dates are calculated, in a few moments.',
    'L’évolution s’affiche dès que les premiers repères sont calculés, dans quelques instants.',
    'La evolución aparece en cuanto se calculan las primeras referencias, en unos instantes.',
  ],
  'ya.seg.dr.s.yuno': ['Came through Yuno', 'Venus par Yuno', 'Llegaron por Yuno'],
  'ya.seg.dr.srcSub': ['Where each person comes from: a Yuno sale, an imported file or other', 'D’où vient chaque personne : vente Yuno, fichier importé ou autre', 'De dónde viene cada persona: venta en Yuno, archivo importado u otro'],
  'ya.seg.f.boughtPct': ['{pct} of visits to the sales page', '{pct} des passages sur la page de vente', '{pct} de las visitas a la página de venta'],
  'ya.seg.f.ticketing': ['Went to the sales page', 'Sont allés sur la page de vente', 'Fueron a la página de venta'],
  'ya.seg.m.ticketing.l': ['Go to the sales page', 'Vont sur la page de vente', 'Van a la página de venta'],
  'ya.seg.m.ticketing.t': ['Which segments go to the sales page the most?', 'Quels segments vont le plus sur la page de vente ?', '¿Qué segmentos van más a la página de venta?'],
  'ya.seg.mx.ticketing': ['Sales page', 'Page de vente', 'Página de venta'],
  'ya.seg.st.ticketing': ['Sales page', 'Page de vente', 'Página de venta'],
  'ya.seg.tpl.geo_area.rule': ['City from their Yuno profile or your files: {area}.', 'Ville de leur profil Yuno ou de vos fichiers : {area}.', 'Ciudad de su perfil de Yuno o de sus archivos: {area}.'],
  'ya.seg.tpl.src_import.rule': ['From your files, no Yuno sale yet.', 'Venus de vos fichiers, aucune vente Yuno pour l’instant.', 'Llegados de sus archivos, aún sin venta en Yuno.'],
  'ya.seg.tpl.src_yuno.name': ['Came through Yuno', 'Venus par Yuno', 'Llegaron por Yuno'],
  'ya.seg.tpl.src_yuno.rule': ['Their first place was taken on Yuno (ticket, table or guest list).', 'Leur première place a été prise sur Yuno (billet, table ou guest list).', 'Su primera plaza se tomó en Yuno (entrada, mesa o guest list).'],
  'ya.segcat.cov.noPeople': ['Yuno profiles and your files have not given any age or gender yet.', 'Les profils Yuno et vos fichiers n’ont encore donné ni âge ni genre.', 'Los perfiles de Yuno y sus archivos aún no han dado edad ni género.'],
  'ya.segcat.g.guest.s': ['Invitations and free entries to your nights', 'Invitations et entrées gratuites de vos soirées', 'Invitaciones y entradas gratuitas de sus noches'],
  'ya.segcat.g.people.s': ['As given on Yuno or in your files', 'Tels que donnés sur Yuno ou dans vos fichiers', 'Tal como se dieron en Yuno o en sus archivos'],
  'ya.segcat.noNext': ['No upcoming night yet: these segments open with the next one.', 'Aucune soirée à venir pour l’instant : ces segments s’ouvrent avec la prochaine.', 'Aún no hay noche próxima: estos segmentos se abren con la siguiente.'],

  // Imports
  'ya.imp.sub': [
    'Your Yuno buyers arrive on their own. For everyone else, import a file: Yuno compares each line with your list before adding anything.',
    'Vos acheteurs Yuno arrivent tout seuls. Pour tous les autres, importez un fichier : Yuno compare chaque ligne à votre base avant d’ajouter quoi que ce soit.',
    'Sus compradores de Yuno llegan solos. Para los demás, importe un archivo: Yuno compara cada línea con su base antes de añadir nada.',
  ],
  'ya.imp.histLegacy': ['Earlier import · {n} lines', 'Import précédent · {n} lignes', 'Importación anterior · {n} líneas'],
  'ya.imp.sales.pill.on': ['Active', 'Active', 'Activa'],
  'ya.imp.sales.pill.wait': ['Waiting for the 1st sale', 'En attente de la 1re vente', 'A la espera de la 1.ª venta'],
  'ya.imp.sales.title': ['Every sale joins your list', 'Chaque vente entre dans votre base', 'Cada venta entra en su base'],
  'ya.imp.sales.line.one': [
    '{n} person came through Yuno, {m} in the last 30 days. Last sale: {when}.',
    '{n} personne venue par Yuno, dont {m} ces 30 derniers jours. Dernière vente : {when}.',
    '{n} persona llegó por Yuno, {m} en los últimos 30 días. Última venta: {when}.',
  ],
  'ya.imp.sales.line.other': [
    '{n} people came through Yuno, {m} in the last 30 days. Last sale: {when}.',
    '{n} personnes venues par Yuno, dont {m} ces 30 derniers jours. Dernière vente : {when}.',
    '{n} personas llegaron por Yuno, {m} en los últimos 30 días. Última venta: {when}.',
  ],
  'ya.imp.sales.lineNone': [
    'From your first sale, the buyer joins this list on their own.',
    'Dès votre première vente, l’acheteur entre ici tout seul.',
    'Desde su primera venta, el comprador entra aquí solo.',
  ],
  'ya.imp.sales.p1': ['Tickets, VIP tables and guest list', 'Billets, tables VIP et guest list', 'Entradas, mesas VIP y guest list'],
  'ya.imp.sales.p2': ['One address, one card, even across several purchases', 'Une adresse, une seule fiche, même en plusieurs achats', 'Una dirección, una sola ficha, incluso con varias compras'],
  'ya.imp.sales.p3': ['Each buyer’s consent is respected, unsubscribed people excluded', 'L’accord de chaque acheteur est respecté, désabonnés exclus', 'Se respeta el consentimiento de cada comprador, bajas excluidas'],
  'ya.imp.sales.see': ['See clients', 'Voir les clients', 'Ver los clientes'],
  'ya.imp.att.title': ['Your attestation', 'Votre attestation', 'Su declaración'],
  // « Avoir une place » et « être venu » sont deux faits (11/11) : le filtre Soirée se lisait
  // « A participé à » alors qu'il retient les places, venues ou non.
  'ya.cli.f.ev': ['Place for', 'Place pour', 'Plaza para'],
  'ya.cli.f.ev.title': ['Has a place for', 'A une place pour', 'Tiene plaza para'],
  'ya.cli.f.came': ['Came to', 'Venu à', 'Vino a'],
  'ya.cli.f.came.title': ['Scanned at the door of', 'Scanné à la porte de', 'Escaneado en la puerta de'],

  // Vos billets, soirée par soirée : d'où viennent les places d'une soirée.
  'ya.na.title': ['Your tickets, night by night', 'Vos billets, soirée par soirée', 'Sus entradas, fiesta por fiesta'],
  'ya.na.sub': [
    'Who is behind the places of a night: people who already came, or new faces?',
    'Qui est derrière les places d’une soirée : des clients déjà venus, ou de nouveaux visages ?',
    '¿Quién está detrás de las plazas de una fiesta: gente que ya vino o caras nuevas?',
  ],
  'ya.na.pick': ['Choose a night', 'Choisir une soirée', 'Elegir una fiesta'],
  'ya.na.upcoming': ['Upcoming', 'À venir', 'Próxima'],
  'ya.na.people.one': ['{n} person', '{n} personne', '{n} persona'],
  'ya.na.people.other': ['{n} people', '{n} personnes', '{n} personas'],
  'ya.na.tickets.one': ['{n} ticket', '{n} billet', '{n} entrada'],
  'ya.na.tickets.other': ['{n} tickets', '{n} billets', '{n} entradas'],
  'ya.na.here': ['{n} scanned at the door', '{n} scannés à la porte', '{n} escaneados en la puerta'],
  'ya.na.empty': ['No place sold for this night yet.', 'Aucune place pour cette soirée pour l’instant.', 'Aún no hay plazas para esta fiesta.'],
  'ya.na.g.back': ['Already came', 'Déjà venus', 'Ya vinieron'],
  'ya.na.g.back.def': [
    'Have a place and came to an earlier night (ticket scanned at the door)',
    'Ont une place et sont déjà venus à une soirée plus ancienne (place scannée à la porte)',
    'Tienen plaza y ya vinieron a una fiesta anterior (entrada escaneada en la puerta)',
  ],
  'ya.na.g.held': ['Had a place before', 'Avaient déjà une place', 'Ya tenían plaza'],
  'ya.na.g.held.def': [
    'Have a place and already held one for an earlier night, without being scanned at the door',
    'Ont une place et en avaient déjà une pour une soirée plus ancienne, sans être passés par la porte',
    'Tienen plaza y ya tuvieron una para una fiesta anterior, sin pasar por la puerta',
  ],
  'ya.na.g.new': ['New faces', 'Nouveaux visages', 'Caras nuevas'],
  'ya.na.g.new.def': ['First place with you', 'Première place chez vous', 'Primera plaza con usted'],
  'ya.na.g.away': ['Came before, no place yet', 'Déjà venus, pas encore de place', 'Ya vinieron, aún sin plaza'],
  'ya.na.pool.one': [
    'Among everyone who already came ({a}), 1 holds a place for {night}.',
    'Parmi tous ceux déjà venus ({a}), 1 a une place pour {night}.',
    'De todos los que ya vinieron ({a}), 1 tiene plaza para {night}.',
  ],
  'ya.na.pool.other': [
    'Among everyone who already came ({a}), {n} hold a place for {night}.',
    'Parmi tous ceux déjà venus ({a}), {n} ont une place pour {night}.',
    'De todos los que ya vinieron ({a}), {n} tienen plaza para {night}.',
  ],
  'ya.na.pool.rate': ['{pct} of past guests are back', '{pct} des anciens sont de retour', '{pct} de los anteriores han vuelto'],
  'ya.na.pool.none': [
    'Nobody has come to an earlier night yet: every place here is a first.',
    'Personne n’est encore venu à une soirée plus ancienne : chaque place ici est une première.',
    'Nadie ha venido todavía a una fiesta anterior: cada plaza aquí es una primera.',
  ],
  'ya.na.away.cta': ['See who has no place yet ({n})', 'Voir ceux qui n’ont pas encore de place ({n})', 'Ver a quien aún no tiene plaza ({n})'],
  'ya.na.see': ['See them', 'Les voir', 'Verlos'],
  'ya.na.chip': ['Seen from {night}: {group}', 'Vu depuis {night} : {group}', 'Visto desde {night}: {group}'],
  'ya.na.note': [
    'Came = ticket scanned at the door. A ticket bought but not scanned is a place, not a visit. Guests of a multi-person ticket count as people; tickets and amounts are the buyers’.',
    'Venu = place scannée à la porte. Un billet acheté mais pas scanné est une place, pas une venue. Les invités d’un billet de plusieurs personnes comptent comme des personnes ; billets et montants sont ceux des acheteurs.',
    'Vino = entrada escaneada en la puerta. Una entrada comprada pero no escaneada es una plaza, no una visita. Los invitados de una entrada de varias personas cuentan como personas; entradas e importes son los de los compradores.',
  ],
};

export default dict;
