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
};

export default dict;
