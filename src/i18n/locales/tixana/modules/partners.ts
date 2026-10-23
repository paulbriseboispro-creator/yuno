import type { Triple } from '../../crm/modules/types';

// Analyses de Yuno Tickets › Partenaires (lot 3 du plan combiné, migration
// 20261109330000) — [EN, FR, ES], vouvoiement. Une vente de promoteur est une
// « vente attribuée », jamais un « CA » ; « Qui fait vendre ? » est une
// attribution, jamais un partage d'argent. Les phrases décrivent, elles ne
// conseillent pas.
const dict: Record<string, Triple> = {
  'ya.ana.tab.partners': ['Partners', 'Partenaires', 'Socios'],
  'ya.ana.title.partners': ['Who sells for me?', 'Qui vend pour moi ?', '¿Quién vende por mí?'],
  'ya.ana.sub.partners': [
    'Your promoters, the links you gave for a night, and who brought the sales on a shared night.',
    'Vos promoteurs, les liens donnés pour une soirée, et qui a amené les ventes d’une soirée partagée.',
    'Sus promotores, los enlaces dados para una fiesta y quién trajo las ventas de una fiesta compartida.',
  ],

  // Héros
  'ya.pa.heroT': ['What your promoters sold', 'Ce que vos promoteurs ont vendu', 'Lo que vendieron sus promotores'],
  'ya.pa.heroSub': ['Attributed sales per {unit}, Yuno fees excluded', 'Ventes attribuées par {unit}, hors frais Yuno', 'Ventas atribuidas por {unit}, sin comisiones de Yuno'],
  'ya.pa.heroSubN': ['Attributed sales per {unit}', 'Ventes attribuées par {unit}', 'Ventas atribuidas por {unit}'],
  'ya.pa.bigSub': ['in attributed sales (face value, Yuno fees excluded)', 'de ventes attribuées (valeur faciale, hors frais Yuno)', 'en ventas atribuidas (valor nominal, sin comisiones de Yuno)'],
  'ya.pa.bigSubN': ['attributed sales', 'ventes attribuées', 'ventas atribuidas'],
  'ya.pa.vsNight': ['vs the previous night', 'vs la soirée précédente', 'vs la fiesta anterior'],
  'ya.pa.ins.noPromoters': ['You have no promoter yet. Promoter sales show up here as soon as one sells with their link or code.', 'Vous n’avez pas encore de promoteur. Leurs ventes s’affichent ici dès qu’un promoteur vend avec son lien ou son code.', 'Todavía no tiene promotores. Sus ventas aparecen aquí en cuanto uno vende con su enlace o su código.'],
  'ya.pa.ins.promotersCta': ['Open Promoters', 'Ouvrir Promoteurs', 'Abrir Promotores'],
  'ya.pa.ins.none': ['No sale attributed to a promoter over this period.', 'Aucune vente attribuée à un promoteur sur cette période.', 'Ninguna venta atribuida a un promotor en este periodo.'],
  'ya.pa.ins.noneEv': ['No sale attributed to a promoter for this night yet.', 'Aucune vente attribuée à un promoteur pour cette soirée pour l’instant.', 'Ninguna venta atribuida a un promotor para esta fiesta por ahora.'],
  'ya.pa.ins.best': ['{name} brought {pct} of attributed sales; {n} promoters sold over this period.', '{name} a amené {pct} des ventes attribuées ; {n} promoteurs ont vendu sur cette période.', '{name} trajo el {pct} de las ventas atribuidas; {n} promotores vendieron en este periodo.'],

  // Tuiles
  'ya.pa.tile.sales': ['Attributed sales', 'Ventes attribuées', 'Ventas atribuidas'],
  'ya.pa.tile.salesCap': ['{tickets} · {tables}', '{tickets} · {tables}', '{tickets} · {tables}'],
  'ya.pa.tile.commission': ['Commissions', 'Commissions', 'Comisiones'],
  'ya.pa.tile.commissionCap': ['Owed to your promoters on these sales', 'Dues à vos promoteurs sur ces ventes', 'Debidas a sus promotores por estas ventas'],
  'ya.pa.tile.clicks': ['Clicks', 'Clics', 'Clics'],
  'ya.pa.tile.clicksCap': ['On your promoters’ links', 'Sur les liens de vos promoteurs', 'En los enlaces de sus promotores'],
  'ya.pa.tile.rate': ['Click to sale', 'Clic → vente', 'Clic → venta'],
  'ya.pa.tile.rateCap.one': ['{paid} paid sales for {n} click', '{paid} ventes payantes pour {n} clic', '{paid} ventas de pago por {n} clic'],
  'ya.pa.tile.rateCap.other': ['{paid} paid sales for {n} clicks', '{paid} ventes payantes pour {n} clics', '{paid} ventas de pago por {n} clics'],
  'ya.pa.tile.rateFew.one': ['{n} click: not enough for a rate', '{n} clic : trop peu pour un taux', '{n} clic: muy poco para una tasa'],
  'ya.pa.tile.rateFew.other': ['{n} clicks: not enough for a rate', '{n} clics : trop peu pour un taux', '{n} clics: muy poco para una tasa'],
  'ya.pa.tile.yield': ['Yield', 'Rendement', 'Rendimiento'],
  'ya.pa.tile.yieldCap': ['of attributed sales per €1 of commission', 'de ventes attribuées pour 1 € de commission', 'de ventas atribuidas por cada 1 € de comisión'],
  'ya.pa.tile.yieldNone': ['No commission over this period', 'Aucune commission sur cette période', 'Ninguna comisión en este periodo'],
  'ya.pa.tile.sellers': ['Promoters who sold', 'Promoteurs qui ont vendu', 'Promotores que vendieron'],
  'ya.pa.tile.sellersCap': ['Out of your active promoters', 'Sur vos promoteurs actifs', 'De sus promotores activos'],

  // Unités
  'ya.pa.salesN.one': ['{n} sale', '{n} vente', '{n} venta'],
  'ya.pa.salesN.other': ['{n} sales', '{n} ventes', '{n} ventas'],
  'ya.pa.placesN.one': ['{n} place', '{n} place', '{n} plaza'],
  'ya.pa.placesN.other': ['{n} places', '{n} places', '{n} plazas'],
  'ya.pa.tablesN.one': ['{n} table', '{n} table', '{n} mesa'],
  'ya.pa.tablesN.other': ['{n} tables', '{n} tables', '{n} mesas'],
  'ya.pa.guestsN.one': ['{n} guest', '{n} inscrit', '{n} inscrito'],
  'ya.pa.guestsN.other': ['{n} guests', '{n} inscrits', '{n} inscritos'],

  // Classement
  'ya.pa.rank.t': ['Promoter ranking', 'Classement des promoteurs', 'Clasificación de promotores'],
  'ya.pa.rank.sub': ['Attributed sales, Yuno fees excluded. A refund removes the sale.', 'Ventes attribuées, hors frais Yuno. Un remboursement retire la vente.', 'Ventas atribuidas, sin comisiones de Yuno. Un reembolso retira la venta.'],
  'ya.pa.rank.subN': ['Sales brought by each promoter. A refund removes the sale.', 'Ventes amenées par chaque promoteur. Un remboursement retire la vente.', 'Ventas traídas por cada promotor. Un reembolso retira la venta.'],
  'ya.pa.rank.manage': ['Promoters', 'Promoteurs', 'Promotores'],
  'ya.pa.rank.empty': ['None of your promoters sold or got a click over this period.', 'Aucun de vos promoteurs n’a vendu ni reçu de clic sur cette période.', 'Ninguno de sus promotores vendió ni recibió clics en este periodo.'],
  'ya.pa.rank.noPromoters': ['You have no promoter yet.', 'Vous n’avez pas encore de promoteur.', 'Todavía no tiene promotores.'],
  'ya.pa.rank.inactive': ['inactive', 'inactif', 'inactivo'],
  'ya.pa.rank.foot': [
    'A sale belongs to the promoter whose link or code was used. Click to sale counts paid sales (tickets and tables) per click, capped at 100 %.',
    'Une vente revient au promoteur dont le lien ou le code a servi. Le clic → vente compte les ventes payantes (billets et tables) par clic, plafonné à 100 %.',
    'Una venta corresponde al promotor cuyo enlace o código se usó. El clic → venta cuenta las ventas de pago (entradas y mesas) por clic, con un máximo del 100 %.',
  ],

  // Colonnes
  'ya.pa.col.promoter': ['Promoter', 'Promoteur', 'Promotor'],
  'ya.pa.col.sales': ['Sales', 'Ventes', 'Ventas'],
  'ya.pa.col.clicks': ['Clicks', 'Clics', 'Clics'],
  'ya.pa.col.rate': ['Click → sale', 'Clic → vente', 'Clic → venta'],
  'ya.pa.col.commission': ['Commission', 'Commission', 'Comisión'],
  'ya.pa.col.attributed': ['Attributed sales', 'Ventes attribuées', 'Ventas atribuidas'],
  'ya.pa.col.share': ['Share of sales', 'Part des ventes', 'Parte de las ventas'],
  'ya.pa.col.link': ['Link', 'Lien', 'Enlace'],
  'ya.pa.col.salesValue': ['Sales value', 'Montant des ventes', 'Importe de las ventas'],
  'ya.pa.col.places': ['Places', 'Places', 'Plazas'],

  // Liens partenaires
  'ya.pa.links.t': ['Partner links', 'Liens partenaires', 'Enlaces de socios'],
  'ya.pa.links.sub': ['The links you gave for a night: a person, a guest of the night, a shared night.', 'Les liens donnés pour une soirée : une personne, un invité de la soirée, une co-soirée.', 'Los enlaces dados para una fiesta: una persona, un invitado de la fiesta, una fiesta compartida.'],
  'ya.pa.links.subEv': ['The links you gave for this night.', 'Les liens donnés pour cette soirée.', 'Los enlaces dados para esta fiesta.'],
  'ya.pa.links.empty': ['No partner link over this period. You create one from a night’s links, “Partners” tab.', 'Aucun lien partenaire sur cette période. Il se crée depuis les liens d’une soirée, onglet « Partenaires ».', 'Ningún enlace de socio en este periodo. Se crea desde los enlaces de una fiesta, pestaña «Socios».'],
  'ya.pa.links.direct': ['Your shared-night link', 'Votre lien de co-soirée', 'Su enlace de fiesta compartida'],
  'ya.pa.links.kind.guest': ['Guest of the night', 'Invité de la soirée', 'Invitado de la fiesta'],
  'ya.pa.links.kind.party': ['Shared night', 'Co-soirée', 'Fiesta compartida'],
  'ya.pa.links.role.promoter': ['Promoter', 'Promoteur', 'Promotor'],
  'ya.pa.links.role.dj': ['DJ', 'DJ', 'DJ'],
  'ya.pa.links.role.artist': ['Artist', 'Artiste', 'Artista'],
  'ya.pa.links.role.ambassador': ['Ambassador', 'Ambassadeur', 'Embajador'],
  'ya.pa.links.role.venue': ['Venue', 'Lieu', 'Local'],
  'ya.pa.links.role.other': ['Partner', 'Partenaire', 'Socio'],
  'ya.pa.links.foot': [
    'Clicks and sales of the period, read on each sale (the link it came from). A partner link pays no commission: it counts.',
    'Clics et ventes de la période, lus sur chaque vente (le lien d’où elle vient). Un lien partenaire ne verse aucune commission : il compte.',
    'Clics y ventas del periodo, leídos en cada venta (el enlace del que viene). Un enlace de socio no paga comisión: cuenta.',
  ],

  // Soirées partagées
  'ya.pa.shared.t': ['Shared nights', 'Soirées partagées', 'Fiestas compartidas'],
  'ya.pa.shared.sub': ['Nights with a partner club or organizer, co-hosts or guests. Open one to see who brought the sales.', 'Soirées avec un club ou un organisateur partenaire, des co-hôtes ou des invités. Ouvrez-en une pour voir qui a amené les ventes.', 'Fiestas con un club u organizador socio, coanfitriones o invitados. Abra una para ver quién trajo las ventas.'],
  'ya.pa.shared.upcoming': ['on sale', 'en vente', 'a la venta'],
  'ya.pa.shared.parties.one': ['{n} party', '{n} partie', '{n} parte'],
  'ya.pa.shared.parties.other': ['{n} parties', '{n} parties', '{n} partes'],
  'ya.pa.shared.guests.one': ['{n} guest', '{n} invité', '{n} invitado'],
  'ya.pa.shared.guests.other': ['{n} guests', '{n} invités', '{n} invitados'],
  'ya.pa.shared.foot': ['Sales of the period on each night.', 'Ventes de la période sur chaque soirée.', 'Ventas del periodo en cada fiesta.'],

  // Qui fait vendre ?
  'ya.pa.who.t': ['Who sells?', 'Qui fait vendre ?', '¿Quién vende?'],
  'ya.pa.who.sub': ['Every sale of the night, by the party that brought it.', 'Chaque vente de la soirée, par la partie qui l’a amenée.', 'Cada venta de la fiesta, por la parte que la trajo.'],
  'ya.pa.who.unavailable': ['This breakdown is not available for your account on this night.', 'Ce détail n’est pas disponible pour votre compte sur cette soirée.', 'Este detalle no está disponible para su cuenta en esta fiesta.'],
  'ya.pa.who.you': ['You', 'Vous', 'Usted'],
  'ya.pa.who.kind.venue': ['Club', 'Club', 'Club'],
  'ya.pa.who.kind.org': ['Organizer', 'Organisateur', 'Organizador'],
  'ya.pa.who.guest': ['Guest', 'Invité', 'Invitado'],
  'ya.pa.who.yuno': ['Yuno (app and pages)', 'Yuno (app et pages)', 'Yuno (app y páginas)'],
  'ya.pa.who.direct': ['Direct', 'Direct', 'Directo'],
  'ya.pa.who.other': ['No partner identified', 'Sans partenaire identifié', 'Sin socio identificado'],
  'ya.pa.who.col.party': ['Party', 'Partie', 'Parte'],
  'ya.pa.who.col.tickets': ['Tickets', 'Billets', 'Entradas'],
  'ya.pa.who.col.tables': ['Tables', 'Tables', 'Mesas'],
  'ya.pa.who.col.guests': ['Guest list', 'Guest list', 'Guest list'],
  'ya.pa.who.col.entered': ['Entered', 'Entrés', 'Entraron'],
  'ya.pa.who.col.people': ['People', 'Personnes', 'Personas'],
  'ya.pa.who.foot': [
    'A sale goes to the party whose tracked link or promoter brought it. This is attribution, not a share of the money.',
    'Une vente revient à la partie dont le lien suivi ou le promoteur l’a amenée. C’est une attribution, pas un partage de l’argent.',
    'Una venta corresponde a la parte cuyo enlace o promotor la trajo. Es una atribución, no un reparto del dinero.',
  ],

  // Export
  'ya.pa.csv.promoter': ['Promoter', 'Promoteur', 'Promotor'],
  'ya.pa.csv.code': ['Code', 'Code', 'Código'],
  'ya.pa.csv.sales': ['Attributed sales', 'Ventes attribuées', 'Ventas atribuidas'],
  'ya.pa.csv.tables': ['Tables', 'Tables', 'Mesas'],
  'ya.pa.csv.clicks': ['Clicks', 'Clics', 'Clics'],
  'ya.pa.csv.rate': ['Click to sale (%)', 'Clic → vente (%)', 'Clic → venta (%)'],
  'ya.pa.csv.attributed': ['Attributed sales (€)', 'Ventes attribuées (€)', 'Ventas atribuidas (€)'],
  'ya.pa.csv.commission': ['Commission (€)', 'Commission (€)', 'Comisión (€)'],
};

export default dict;
