import type { Triple } from '../../crm/modules/types';

// Analyses de Yuno Tickets › Gratuits, le détail (lot 6 du plan combiné,
// migration 20261109350000) — [EN, FR, ES], vouvoiement : quotas et
// remplissage, absents, détenteurs de liste, ce que vaut un invité. Les
// phrases décrivent, elles ne conseillent pas.
const dict: Record<string, Triple> = {
  // Quotas
  'ya.fd.q.t': ['Quotas and fill', 'Quotas et remplissage', 'Cupos y llenado'],
  'ya.fd.q.sub': ['Guest-list spots taken, nights of the period and nights on sale.', 'Places de guest list prises, soirées de la période et soirées en vente.', 'Plazas de guest list ocupadas, fiestas del periodo y fiestas a la venta.'],
  'ya.fd.q.subEv': ['Guest-list spots taken for this night.', 'Places de guest list prises pour cette soirée.', 'Plazas de guest list ocupadas para esta fiesta.'],
  'ya.fd.q.big': ['{filled} of {quota} spots taken', '{filled} places prises sur {quota}', '{filled} plazas ocupadas de {quota}'],
  'ya.fd.q.lists.one': ['{n} list', '{n} liste', '{n} lista'],
  'ya.fd.q.lists.other': ['{n} lists', '{n} listes', '{n} listas'],
  'ya.fd.q.full.one': ['{n} full', '{n} complète', '{n} completa'],
  'ya.fd.q.full.other': ['{n} full', '{n} complètes', '{n} completas'],
  'ya.fd.q.more': ['Show all {n} nights', 'Voir les {n} soirées', 'Ver las {n} fiestas'],
  'ya.fd.q.less': ['Show fewer', 'En voir moins', 'Ver menos'],
  'ya.fd.q.foot': [
    'A list is full when its quota is reached or it was closed by hand. The fill is shown from 10 spots.',
    'Une liste est complète quand son quota est atteint ou qu’elle a été fermée à la main. Le remplissage s’affiche dès 10 places.',
    'Una lista está completa cuando se alcanza su cupo o se cerró a mano. El llenado se muestra a partir de 10 plazas.',
  ],

  // Absents
  'ya.fd.ns.t': ['Guests who did not come', 'Les inscrits qui ne sont pas venus', 'Los inscritos que no vinieron'],
  'ya.fd.ns.sub': ['On nights where the door was measured.', 'Sur les soirées dont la porte a été mesurée.', 'En las fiestas en las que se midió la puerta.'],
  'ya.fd.ns.big.one': ['out of {n} guest on a measured door', 'sur {n} inscrit à une porte mesurée', 'de {n} inscrito en una puerta medida'],
  'ya.fd.ns.big.other': ['out of {n} guests on a measured door', 'sur {n} inscrits à une porte mesurée', 'de {n} inscritos en una puerta medida'],
  'ya.fd.ns.bigPct': ['{pct} of {n} guests on a measured door', '{pct} des {n} inscrits à une porte mesurée', '{pct} de los {n} inscritos en una puerta medida'],
  'ya.fd.ns.heldFull': ['Held a spot on a full list', 'Tenaient une place d’une liste complète', 'Ocupaban una plaza de una lista completa'],
  'ya.fd.ns.lost': ['At what a guest who came spent on site', 'Au prix de ce qu’a dépensé sur place un invité venu', 'A lo que gastó en el local un invitado que vino'],
  'ya.fd.ns.unmeasuredN': ['Guests on nights with an unmeasured door', 'Inscrits sur des soirées à porte non mesurée', 'Inscritos en fiestas con puerta no medida'],
  'ya.fd.ns.none': ['No past night with guests over this period.', 'Aucune soirée passée avec des inscrits sur cette période.', 'Ninguna fiesta pasada con inscritos en este periodo.'],
  'ya.fd.ns.unmeasured': ['The door was not measured on these nights: who came is not known.', 'La porte n’a pas été mesurée sur ces soirées : on ne sait pas qui est venu.', 'La puerta no se midió en estas fiestas: no se sabe quién vino.'],
  'ya.fd.ns.foot': [
    'A door is measured from 10 scanned entries and 10 % of valid entries. Below that, “did not come” would only mean “not scanned”.',
    'Une porte est mesurée dès 10 entrées scannées et 10 % des entrées valides. En dessous, « pas venu » voudrait seulement dire « pas scanné ».',
    'Una puerta se mide a partir de 10 entradas escaneadas y el 10 % de las entradas válidas. Por debajo, «no vino» solo significaría «no escaneado».',
  ],

  // Détenteurs
  'ya.fd.h.t': ['Who holds the lists', 'Qui tient les listes', 'Quién lleva las listas'],
  'ya.fd.h.sub': ['Each holder’s guests, those who came and those who then paid.', 'Les inscrits de chaque détenteur, ceux qui sont venus et ceux qui ont payé ensuite.', 'Los inscritos de cada responsable, los que vinieron y los que pagaron después.'],
  'ya.fd.h.col.holder': ['Holder', 'Détenteur', 'Responsable'],
  'ya.fd.h.col.lists': ['Lists', 'Listes', 'Listas'],
  'ya.fd.h.col.entries': ['Guests', 'Inscrits', 'Inscritos'],
  'ya.fd.h.col.came': ['Came', 'Venus', 'Vinieron'],
  'ya.fd.h.col.showup': ['Turnout', 'Venue', 'Asistencia'],
  'ya.fd.h.col.conv': ['Became paying', 'Devenus payants', 'Pasaron a pagar'],
  'ya.fd.h.type.club': ['Club', 'Club', 'Club'],
  'ya.fd.h.type.organizer': ['Organizer', 'Organisateur', 'Organizador'],
  'ya.fd.h.type.promoter': ['Promoter', 'Promoteur', 'Promotor'],
  'ya.fd.h.type.dj': ['DJ', 'DJ', 'DJ'],
  'ya.fd.h.type.guest': ['Guest of the night', 'Invité de la soirée', 'Invitado de la fiesta'],
  'ya.fd.h.type.custom': ['List', 'Liste', 'Lista'],
  'ya.fd.h.default.club': ['House list', 'Liste maison', 'Lista de la casa'],
  'ya.fd.h.default.organizer': ['Organizer list', 'Liste de l’organisateur', 'Lista del organizador'],
  'ya.fd.h.default.promoter': ['Promoter', 'Promoteur', 'Promotor'],
  'ya.fd.h.default.dj': ['DJ', 'DJ', 'DJ'],
  'ya.fd.h.default.guest': ['Guest of the night', 'Invité de la soirée', 'Invitado de la fiesta'],
  'ya.fd.h.default.custom': ['Other list', 'Autre liste', 'Otra lista'],
  'ya.fd.h.footEv': ['“Came” counts only if the door of the night was measured.', '« Venus » ne compte que si la porte de la soirée a été mesurée.', '«Vinieron» solo cuenta si se midió la puerta de la fiesta.'],
  'ya.fd.h.foot': [
    '“Came” counts only nights with a measured door. “Became paying”: guests who had never paid before their free night and bought a ticket or a table after it.',
    '« Venus » ne compte que les soirées à porte mesurée. « Devenus payants » : les inscrits qui n’avaient jamais payé avant leur soirée gratuite et qui ont acheté un billet ou une table ensuite.',
    '«Vinieron» solo cuenta las fiestas con puerta medida. «Pasaron a pagar»: los inscritos que nunca habían pagado antes de su fiesta gratis y compraron una entrada o una mesa después.',
  ],

  // Ce que vaut un invité
  'ya.fd.w.t': ['Is a guest worth a paying client?', 'Un invité vaut-il un client payant ?', '¿Un invitado vale lo que un cliente que paga?'],
  'ya.fd.w.sub': ['What guests who came spent, against paying clients who came, on nights with a measured door.', 'Ce qu’ont dépensé les invités venus, face aux clients payants entrés, sur les soirées à porte mesurée.', 'Lo que gastaron los invitados que vinieron, frente a los clientes que pagaron y entraron, en fiestas con puerta medida.'],
  'ya.fd.w.guestNight': ['A guest who came, on site', 'Un invité venu, sur place', 'Un invitado que vino, en el local'],
  'ya.fd.w.guestNightS': ['VIP tables of the night · {n} guests', 'Tables VIP de la soirée · {n} invités', 'Mesas VIP de la fiesta · {n} invitados'],
  'ya.fd.w.guestLater': ['A guest who came, in the next 90 days', 'Un invité venu, dans les 90 jours suivants', 'Un invitado que vino, en los 90 días siguientes'],
  'ya.fd.w.guestLaterS': ['Tickets and tables bought after the night', 'Billets et tables achetés après la soirée', 'Entradas y mesas compradas después de la fiesta'],
  'ya.fd.w.paidNight': ['A paying client who came', 'Un client payant entré', 'Un cliente que pagó y entró'],
  'ya.fd.w.paidNightS': ['Ticket and VIP tables of the night · {n} clients', 'Billet et tables VIP de la soirée · {n} clients', 'Entrada y mesas VIP de la fiesta · {n} clientes'],
  'ya.fd.w.ins': [
    'A guest who came brought in {g} on average (on site and in the next 90 days); a paying client who came, {p} the same night.',
    'Un invité venu a rapporté {g} en moyenne (sur place et dans les 90 jours suivants) ; un client payant entré, {p} le soir même.',
    'Un invitado que vino aportó {g} de media (en el local y en los 90 días siguientes); un cliente que pagó y entró, {p} esa misma noche.',
  ],
  'ya.fd.w.foot': [
    'Amounts are what the club receives (Yuno fees excluded, refunds deducted), shown from 10 people.',
    'Les montants sont ce que touche le club (hors frais Yuno, remboursements déduits), affichés dès 10 personnes.',
    'Los importes son lo que recibe el club (sin comisiones de Yuno, reembolsos descontados), mostrados a partir de 10 personas.',
  ],
};

export default dict;
