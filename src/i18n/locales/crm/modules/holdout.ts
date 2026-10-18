import type { CrmDict } from './types';

// « 10 % non contactés, pour mesurer l'effet réel » (libellé choisi par Paul,
// 07/10) : Réglages, fenêtre « Écrire à… », mesure des envois — [EN, FR, ES].
const dict: CrmDict = {
  'yc.hold.t': ['{n}% not contacted, to measure the real effect', '{n} % non contactés, pour mesurer l’effet réel', '{n} % sin contactar, para medir el efecto real'],
  'yc.hold.tOff': ['Everyone contacted: the real effect is not measured', 'Tout le monde est contacté : l’effet réel n’est pas mesuré', 'Se contacta a todos: el efecto real no se mide'],
  'yc.hold.s': [
    'On every “Who to target” send and every automation, a share drawn at random does not receive the message. We then compare who bought in the two groups: that is what the send really brought in. These people never cost you Yunits.',
    'Sur chaque envoi « Qui cibler » et chaque automatisation, une part tirée au hasard ne reçoit pas le message. On compare ensuite qui a acheté dans les deux groupes : c’est ce que l’envoi a vraiment rapporté. Ces personnes ne vous coûtent aucun Yunit.',
    'En cada envío «A quién dirigirse» y cada automatización, una parte elegida al azar no recibe el mensaje. Luego comparamos quién compró en los dos grupos: es lo que el envío aportó de verdad. Estas personas nunca le cuestan Yunits.',
  ],
  'yc.hold.label': ['Share not contacted', 'Part non contactée', 'Parte sin contactar'],
  'yc.hold.opt': ['{n}%', '{n} %', '{n} %'],
  'yc.hold.optOff': ['Off', 'Désactivé', 'Desactivado'],
  'yc.hold.saved': ['Setting saved', 'Réglage enregistré', 'Ajuste guardado'],
  'yc.hold.err': ['The setting could not be saved.', 'Le réglage n’a pas pu être enregistré.', 'No se pudo guardar el ajuste.'],
  'yc.hold.write': ['Not contacted, to measure the real effect', 'Non contactés, pour mesurer l’effet réel', 'Sin contactar, para medir el efecto real'],

  'yc.hold.res.t': ['What your sends really brought in', 'Ce que vos envois ont vraiment rapporté', 'Lo que sus envíos aportaron de verdad'],
  'yc.hold.res.s': [
    'Buyers among the people contacted, compared with the people drawn at random and not contacted.',
    'Acheteurs parmi les personnes contactées, comparés aux personnes tirées au hasard et non contactées.',
    'Compradores entre las personas contactadas, comparados con las personas elegidas al azar y no contactadas.',
  ],
  'yc.hold.res.ch.email': ['Email', 'E-mail', 'Email'],
  'yc.hold.res.ch.sms': ['SMS', 'SMS', 'SMS'],
  'yc.hold.res.buyers.one': ['{b} buyer out of {n} {who}', '{b} acheteur sur {n} {who}', '{b} comprador de {n} {who}'],
  'yc.hold.res.buyers.other': ['{b} buyers out of {n} {who}', '{b} acheteurs sur {n} {who}', '{b} compradores de {n} {who}'],
  'yc.hold.res.contacted': ['contacted', 'contactés', 'contactados'],
  'yc.hold.res.control': ['not contacted', 'non contactés', 'sin contactar'],
  'yc.hold.res.v.few': ['Too few people to compare.', 'Trop peu de personnes pour comparer.', 'Demasiado pocas personas para comparar.'],
  'yc.hold.res.v.pending': ['Measuring: the night has not happened yet.', 'Mesure en cours : la soirée n’a pas encore eu lieu.', 'Midiendo: la noche aún no ha tenido lugar.'],
  'yc.hold.res.v.none': ['No clear difference between the two groups.', 'Pas de différence nette entre les deux groupes.', 'Sin diferencia clara entre los dos grupos.'],
  'yc.hold.res.v.gain': ['≈ {x} more buyers thanks to this send.', '≈ {x} acheteurs en plus grâce à cet envoi.', '≈ {x} compradores más gracias a este envío.'],
  'yc.hold.res.v.loss': [
    'Fewer purchases among the people contacted than among the others: worth reviewing.',
    'Moins d’achats chez les personnes contactées que chez les autres : à revoir.',
    'Menos compras entre las personas contactadas que entre las demás: a revisar.',
  ],

  // Aide (Compte › Aide).
  'yc.faq.holdout.q': ['How do I know what a send really brought in?', 'Comment savoir ce qu’un envoi a vraiment rapporté ?', '¿Cómo sé lo que un envío aportó de verdad?'],
  'yc.faq.holdout.a': [
    'On every “Who to target” send linked to a night and every automation, Yuno keeps aside a share drawn at random (10% by default) that does not receive the message and costs you no Yunits. After the night, it compares the buyers of the two groups: the difference is what the send really brought in, beyond the people who would have bought anyway. The result shows in “Who to target” and in Automations; as long as the difference is not clear, the screen says so. You set the share (0 to 30%) in Settings › Data.',
    'Sur chaque envoi « Qui cibler » relié à une soirée et chaque automatisation, Yuno garde de côté une part tirée au hasard (10 % par défaut) qui ne reçoit pas le message et ne vous coûte aucun Yunit. Après la soirée, il compare les acheteurs des deux groupes : la différence, c’est ce que l’envoi a vraiment rapporté, au-delà de ceux qui auraient acheté de toute façon. Le résultat s’affiche dans « Qui cibler » et dans Automatisations ; tant que la différence n’est pas nette, l’écran le dit. Vous réglez la part (0 à 30 %) dans Réglages › Données.',
    'En cada envío «A quién dirigirse» vinculado a una noche y cada automatización, Yuno aparta una parte elegida al azar (10 % por defecto) que no recibe el mensaje y no le cuesta Yunits. Después de la noche, compara los compradores de los dos grupos: la diferencia es lo que el envío aportó de verdad, más allá de quienes habrían comprado igualmente. El resultado aparece en «A quién dirigirse» y en Automatizaciones; mientras la diferencia no sea clara, la pantalla lo dice. Ajusta la parte (0 a 30 %) en Ajustes › Datos.',
  ],
  'yc.faq.holdout.l': ['Open settings', 'Ouvrir les réglages', 'Abrir los ajustes'],
};

export default dict;
