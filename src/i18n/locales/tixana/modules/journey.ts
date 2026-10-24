import type { Triple } from '../../crm/modules/types';

// Analyses de Yuno Tickets › Parcours client, le canal push (lot 7 du plan
// combiné, migration 20261109360000) — [EN, FR, ES], vouvoiement. Remplace les
// textes du CRM qui parlaient de SMS et de réponses Instagram « bientôt » :
// Yuno Tickets n'envoie pas de SMS marketing, et la réponse Instagram est un
// outil du CRM.
const dict: Record<string, Triple> = {
  'ya.jr.ch.push': ['Push', 'Push', 'Push'],
  'ya.jr.s3.soonSms': ['Yuno Tickets does not send marketing SMS yet.', 'Yuno Tickets n’envoie pas encore de SMS marketing.', 'Yuno Tickets todavía no envía SMS de marketing.'],
  'ya.jr.empty.soon': ['Yuno Tickets does not send marketing SMS yet: there is no journey to read on this channel.', 'Yuno Tickets n’envoie pas encore de SMS marketing : il n’y a pas de parcours à lire sur ce canal.', 'Yuno Tickets todavía no envía SMS de marketing: no hay recorrido que leer en este canal.'],
  'ya.jr.s3.chNone': ['No campaign on this channel over the period.', 'Aucune campagne sur ce canal pendant la période.', 'Ninguna campaña en este canal durante el periodo.'],
  'ya.jr.s3.chOff': ['Choose “All” or this channel to see its rate.', 'Choisissez « Tous » ou ce canal pour voir son taux.', 'Elija «Todos» o este canal para ver su tasa.'],
  'ya.jr.ev.push': ['Push received', 'Push reçu', 'Push recibido'],
  'ya.jr.ev.tap': ['Opened the push', 'A ouvert le push', 'Abrió el push'],
  'ya.jr.dr.r.tap': ['Opened', 'Ouverts', 'Abiertos'],
  'ya.jr.dr.p.tap': ['{p} of those who received it', '{p} de ceux qui l’ont reçu', '{p} de quienes lo recibieron'],
  // E-mail ET push : les textes du CRM qui disaient « e-mail » disent « message »
  // quand ils couvrent les deux canaux (une relance reste un e-mail).
  'ya.jr.sub': ['From the message received to the purchase, then the return. Click a step to see who stops, after which message and what to tell them.', 'Du message reçu à l’achat, puis au retour. Cliquez une étape pour voir qui s’arrête, après quel message et quoi lui dire.', 'Del mensaje recibido a la compra, y luego al regreso. Haga clic en una etapa para ver quién se detiene, tras qué mensaje y qué decirle.'],
  'ya.jr.coverRule': ['Purchase: a ticket bought within 7 days of a click in the message (an opened push counts as a click). “Return” fills in over time (light area).', 'Achat : un billet acheté dans les 7 jours qui suivent un clic dans le message (un push ouvert compte comme un clic). « Retour » se complète avec le temps (zone claire).', 'Compra: una entrada comprada en los 7 días tras un clic en el mensaje (un push abierto cuenta como clic). «Regreso» se completa con el tiempo (zona clara).'],
  'ya.jr.d.sub': ['From the first click in a message to the purchase', 'Du premier clic dans un message à l’achat', 'Del primer clic en un mensaje a la compra'],
  'ya.jr.d.touches': ['messages received before buying', 'messages reçus avant d’acheter', 'mensajes recibidos antes de comprar'],
  'ya.jr.empty.any': ['No email or push sent by hand matches these filters. Widen the period or remove a filter.', 'Aucun e-mail ni push envoyé à la main ne correspond à ces filtres. Élargissez la période ou retirez un filtre.', 'Ningún e-mail ni push enviado manualmente corresponde a estos filtros. Amplíe el periodo o quite un filtro.'],
  'ya.jr.k.reachCap': ['Received at least one of your messages', 'Ont reçu au moins un de vos messages', 'Recibieron al menos uno de sus mensajes'],
  'ya.jr.node.mail': ['Message', 'Message', 'Mensaje'],
  'ya.jr.none.title': ['Your journeys appear with your first email or push.', 'Vos parcours apparaissent dès votre premier e-mail ou push.', 'Sus recorridos aparecen desde su primer e-mail o push.'],
  'ya.jr.none.connect': ['Send an email or a push from Campaigns: tracking starts at the first click.', 'Envoyez un e-mail ou un push depuis Campagnes : le suivi démarre au premier clic.', 'Envíe un e-mail o un push desde Campañas: el seguimiento empieza con el primer clic.'],
  'ya.jr.s1.sub.one': ['{n} person received a message · {scope}', '{n} personne a reçu un message · {scope}', '{n} persona recibió un mensaje · {scope}'],
  'ya.jr.s1.sub.other': ['{n} people received a message · {scope}', '{n} personnes ont reçu un message · {scope}', '{n} personas recibieron un mensaje · {scope}'],
  'ya.jr.s2.note': ['{p} of your buyers follow one of these paths. “Message”: an email or a push received in the 14 days before buying; “Click”: a click in the 7 days before.', '{p} de vos acheteurs suivent l’un de ces chemins. « Message » : un e-mail ou un push reçu dans les 14 jours avant l’achat ; « Clic » : un clic dans les 7 jours avant.', '{p} de sus compradores siguen uno de estos caminos. «Mensaje»: un e-mail o un push recibido en los 14 días antes de la compra; «Clic»: un clic en los 7 días antes.'],
  'ya.jr.s3.noRank': ['No email or push sent by hand in this selection.', 'Aucun e-mail ni push envoyé à la main sur cette sélection.', 'Ningún e-mail ni push enviado manualmente en esta selección.'],
  'ya.jr.cover': ['Tracked: {p} of the period’s buyers ({a} out of {b}) bought after clicking in an email or opening a push; the others aren’t in the funnel. Yuno only sees what your messages trigger. “Return” fills in over time (light area).', 'Suivi : {p} des acheteurs de la période ({a} sur {b}) ont acheté après un clic dans un e-mail ou un push ouvert ; les autres ne figurent pas dans l’entonnoir. Yuno ne voit que ce que vos messages déclenchent. « Retour » se complète avec le temps (zone claire).', 'Seguimiento: {p} de los compradores del periodo ({a} de {b}) compraron tras un clic en un e-mail o un push abierto; los demás no figuran en el embudo. Yuno solo ve lo que sus mensajes provocan. «Regreso» se completa con el tiempo (zona clara).'],
  'ya.jr.node.mail2': ['2nd message', '2ᵉ message', '2.º mensaje'],
  'ya.jr.pn.fact.0': ['They received your messages without opening them.', 'Ils ont reçu vos messages sans les ouvrir.', 'Recibieron sus mensajes sin abrirlos.'],
  'ya.jr.s1.svg': ['Funnel from the message to the purchase', 'Entonnoir du message à l’achat', 'Embudo del mensaje a la compra'],
  'ya.jr.s2.sub': ['The 5 paths most followed by your buyers. Click a “message” path to isolate emails.', 'Les 5 chemins les plus suivis par vos acheteurs. Cliquez un chemin « message » pour isoler les e-mails.', 'Los 5 caminos más seguidos por sus compradores. Haga clic en un camino «mensaje» para aislar los e-mails.'],
  'ya.jr.s3.foot': ['Outside messages: {n} of the period’s {t} buyers didn’t click in any email or push.', 'Hors message : {n} des {t} acheteurs de la période n’ont cliqué dans aucun e-mail ni push.', 'Fuera de mensajes: {n} de los {t} compradores del periodo no hicieron clic en ningún e-mail ni push.'],
  'ya.jr.s4.st.mails': ['messages before buying', 'messages avant l’achat', 'mensajes antes de la compra'],
  'ya.jr.s4.st.noMail': ['message in the 14 days before', 'message dans les 14 jours avant', 'mensaje en los 14 días antes'],
  'ya.jr.s4.st.received': ['messages received', 'messages reçus', 'mensajes recibidos'],
  'ya.jr.step.0.l': ['received a message', 'ont reçu un message', 'recibieron un mensaje'],
  'ya.jr.s3.opened': ['{p} opened', '{p} ont ouvert', '{p} lo abrieron'],
  'ya.jr.pushNote': [
    'A push that is opened counts as opened and clicked: it opens the night’s page.',
    'Un push ouvert compte comme ouvert et cliqué : il ouvre la page de la soirée.',
    'Un push abierto cuenta como abierto y con clic: abre la página de la fiesta.',
  ],
};

export default dict;
