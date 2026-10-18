import type { CrmDict } from './types';

// L'e-mail PRATIQUE aux détenteurs d'une soirée (S11, 18/10) — [EN, FR, ES].
// Doc : docs/designs/CRM_PRACTICAL_EMAIL.md. Les refus viennent de la garde
// serveur guard_crm_practical_email (codes stables, src/crm/lib/practicalEmail.ts).
const dict: CrmDict = {
  // Aide (Compte › Aide et contact)
  'yc.faq.practical.q': ['Can I write to everyone who has a ticket, even without marketing consent?', 'Puis-je écrire à tous ceux qui ont un billet, même sans accord marketing ?', '¿Puedo escribir a todos los que tienen entrada, incluso sin consentimiento de marketing?'],
  'yc.faq.practical.a': [
    'Yes, with a practical email, and only about that night. In Nights, open the night, then “Practical email”. It goes to everyone who holds a valid ticket (a resold ticket doesn’t count), including those who refused your newsletter: the information about a purchase doesn’t need marketing consent. It can say the times, the address and access, what to bring, a line-up or time change, a cancellation or a last-minute message. It never sells: no price, table, promo code, other night or buying link. Yuno refuses to send it otherwise, and Shotgun can suspend an account that misuses its practical emails. At most 3 per night, until 24 hours after it ends, for the night’s organiser or a co-organiser editor. An email costs 1 Yunit, as always.',
    'Oui, par un e-mail pratique, et seulement sur cette soirée. Dans Soirées, ouvrez la soirée, puis « E-mail pratique ». Il part à toutes les personnes qui ont un billet valide (un billet revendu ne compte pas), y compris celles qui ont refusé votre newsletter : l’information d’un achat n’exige pas d’accord marketing. Il peut dire les horaires, l’adresse et l’accès, ce qu’il faut apporter, un changement de line-up ou d’horaire, une annulation, un message de dernière minute. Il ne vend jamais : ni tarif, ni table, ni code promo, ni autre soirée, ni lien d’achat. Yuno refuse de l’envoyer sinon, et Shotgun peut suspendre un compte qui détourne ses e-mails pratiques. 3 au plus par soirée, jusqu’à 24 heures après sa fin, pour l’organisateur de la soirée ou un co-organisateur éditeur. Un e-mail coûte 1 Yunit, comme toujours.',
    'Sí, con un e-mail práctico, y solo sobre esa noche. En Noches, abra la noche y luego «E-mail práctico». Sale a todas las personas con una entrada válida (una entrada revendida no cuenta), incluidas las que rechazaron su newsletter: la información de una compra no necesita consentimiento de marketing. Puede indicar los horarios, la dirección y el acceso, qué llevar, un cambio de line-up o de horario, una cancelación o un mensaje de última hora. Nunca vende: ni precio, ni mesa, ni código promocional, ni otra noche, ni enlace de compra. Si no, Yuno se niega a enviarlo, y Shotgun puede suspender una cuenta que desvíe sus e-mails prácticos. Como máximo 3 por noche, hasta 24 horas después de que termine, para el organizador de la noche o un co-organizador editor. Un e-mail cuesta 1 Yunit, como siempre.',
  ],
  'yc.faq.practical.l': ['Open my nights', 'Ouvrir mes soirées', 'Abrir mis noches'],

  // Tiroir de la soirée
  'yc.pe.cta': ['Practical email', 'E-mail pratique', 'E-mail práctico'],
  'yc.pe.m.hint': ['Write to everyone who holds a ticket: times, access, line-up changes. No promotion.', 'Écrire à tous ceux qui ont un billet : horaires, accès, changement de line-up. Sans promotion.', 'Escribir a todos los que tienen entrada: horarios, acceso, cambios de line-up. Sin promoción.'],
  'yc.pe.m.eyebrow': ['Practical email · ticket holders', 'E-mail pratique · détenteurs', 'E-mail práctico · titulares'],
  'yc.pe.m.title': ['Write to the ticket holders', 'Écrire aux détenteurs d’un billet', 'Escribir a los titulares de una entrada'],
  'yc.pe.m.holders': ['Hold a valid ticket', 'Ont un billet valide', 'Tienen una entrada válida'],
  'yc.pe.m.reach': ['Will receive the email', 'Recevront l’e-mail', 'Recibirán el e-mail'],
  'yc.pe.m.onlyHere': ['Of whom reachable only this way (no marketing consent)', 'Dont joignables seulement ainsi (sans accord marketing)', 'De los cuales solo localizables así (sin consentimiento de marketing)'],
  'yc.pe.m.sent': ['Practical emails for this night', 'E-mails pratiques pour cette soirée', 'E-mails prácticos para esta noche'],
  'yc.pe.m.sentV': ['{n} of {max}', '{n} sur {max}', '{n} de {max}'],
  'yc.pe.m.until': ['Possible until', 'Possible jusqu’au', 'Posible hasta el'],
  'yc.pe.m.okT': ['What it can say', 'Ce qu’il peut dire', 'Lo que puede decir'],
  'yc.pe.m.ok': [
    'Practical information about THIS night: door times, address and access, what to bring, dress code, age limit, a line-up or time change, a cancellation, a last-minute message.',
    'L’information pratique de CETTE soirée : horaires d’ouverture, adresse et accès, ce qu’il faut apporter, dress code, âge minimum, un changement de line-up ou d’horaire, une annulation, un message de dernière minute.',
    'La información práctica de ESTA noche: horario de apertura, dirección y acceso, qué llevar, dress code, edad mínima, un cambio de line-up o de horario, una cancelación, un mensaje de última hora.',
  ],
  'yc.pe.m.noT': ['What it never says', 'Ce qu’il ne dit jamais', 'Lo que nunca dice'],
  'yc.pe.m.no': [
    'Anything that sells: a price, a ticket or table offer, a promo code, another night, a link to buy. These people did not agree to marketing: Yuno refuses to send an email that contains any of it, and Shotgun can suspend an account that uses practical emails for marketing.',
    'Tout ce qui vend : un tarif, une offre de billet ou de table, un code promo, une autre soirée, un lien d’achat. Ces personnes n’ont pas accepté le marketing : Yuno refuse d’envoyer un e-mail qui en contient, et Shotgun peut suspendre un compte qui détourne les e-mails pratiques.',
    'Todo lo que vende: un precio, una oferta de entrada o de mesa, un código promocional, otra noche, un enlace de compra. Estas personas no aceptaron el marketing: Yuno se niega a enviar un e-mail que lo contenga, y Shotgun puede suspender una cuenta que desvíe los e-mails prácticos.',
  ],
  'yc.pe.m.coorg': [
    'You are co-organiser (editor) of this night on the ticketing: tell the main organiser before sending, so the holders don’t get two different messages.',
    'Vous êtes co-organisateur (éditeur) de cette soirée sur la billetterie : prévenez l’organisateur principal avant d’envoyer, pour que les détenteurs ne reçoivent pas deux messages différents.',
    'Es co-organizador (editor) de esta noche en la ticketera: avise al organizador principal antes de enviar, para que los titulares no reciban dos mensajes distintos.',
  ],
  'yc.pe.m.none': ['Nobody holds a ticket with a reachable address yet.', 'Personne n’a encore de billet avec une adresse joignable.', 'Todavía nadie tiene entrada con una dirección localizable.'],
  'yc.pe.m.short': ['Not enough Yunits for this send: top up first.', 'Pas assez de Yunits pour cet envoi : rechargez d’abord.', 'No hay Yunits suficientes para este envío: recargue primero.'],
  'yc.pe.m.go': ['Write the practical email', 'Rédiger l’e-mail pratique', 'Redactar el e-mail práctico'],
  'yc.pe.draftName': ['Practical info · {title}', 'Infos pratiques · {title}', 'Info práctica · {title}'],

  // Raisons (soirée)
  'yc.pe.reason.role': [
    'Your account only reads this night on the ticketing (viewer): only its organiser or a co-organiser editor can write to its holders.',
    'Votre compte ne fait que lire cette soirée sur la billetterie (lecteur) : seul son organisateur ou un co-organisateur éditeur peut écrire à ses détenteurs.',
    'Su cuenta solo lee esta noche en la ticketera (lector): solo su organizador o un co-organizador editor puede escribir a sus titulares.',
  ],
  'yc.pe.reason.window': ['This night ended more than 24 hours ago: its practical emails are closed.', 'Cette soirée est finie depuis plus de 24 heures : ses e-mails pratiques sont fermés.', 'Esta noche terminó hace más de 24 horas: sus e-mails prácticos están cerrados.'],
  'yc.pe.reason.limit': ['{max} practical emails already sent or planned for this night: that’s the limit.', '{max} e-mails pratiques déjà envoyés ou prévus pour cette soirée : c’est la limite.', '{max} e-mails prácticos ya enviados o previstos para esta noche: es el límite.'],
  'yc.pe.reason.notMirror': ['A practical email is for a night of your connected ticketing.', 'Un e-mail pratique vise une soirée de votre billetterie connectée.', 'Un e-mail práctico es para una noche de su ticketera conectada.'],
  'yc.pe.reason.generic': ['This night can’t receive a practical email right now.', 'Cette soirée ne peut pas recevoir d’e-mail pratique pour l’instant.', 'Esta noche no puede recibir un e-mail práctico por ahora.'],

  // Refus (envoi, test)
  'yc.pe.err.content': ['Nothing left: this practical email contains something that sells.', 'Rien n’est parti : cet e-mail pratique contient quelque chose qui vend.', 'No salió nada: este e-mail práctico contiene algo que vende.'],
  'yc.pe.err.audience': ['A practical email goes to the night’s holders only: no other audience or segment.', 'Un e-mail pratique part aux seuls détenteurs de la soirée : ni autre audience, ni segment.', 'Un e-mail práctico va solo a los titulares de la noche: ni otra audiencia ni segmento.'],
  'yc.pe.err.feature': ['No A/B test, resend or follow-up on a practical email.', 'Ni test A/B, ni renvoi, ni relance sur un e-mail pratique.', 'Ni test A/B, ni reenvío, ni recordatorio en un e-mail práctico.'],
  'yc.pe.err.generic': ['This practical email can’t leave. Nothing left.', 'Cet e-mail pratique ne peut pas partir. Rien n’est parti.', 'Este e-mail práctico no puede salir. No salió nada.'],
  'yc.pe.err.create': ['The draft couldn’t be created. Try again in a moment.', 'Le brouillon n’a pas pu être créé. Réessayez dans un instant.', 'No se pudo crear el borrador. Inténtelo en un momento.'],

  // Ce qui bloque (codes de _crm_practical_content_issues)
  'yc.pe.issue.block': ['“{block}” block not allowed', 'Bloc « {block} » interdit', 'Bloque «{block}» no permitido'],
  'yc.pe.issue.otherEvent': ['a block shows another night', 'un bloc montre une autre soirée', 'un bloque muestra otra noche'],
  'yc.pe.issue.price': ['the night card shows a price', 'la carte de la soirée montre un prix', 'la tarjeta de la noche muestra un precio'],
  'yc.pe.issue.words': ['promotional wording: “{term}”', 'formule de promotion : « {term} »', 'fórmula promocional: «{term}»'],
  'yc.pe.issue.linkSales': ['a Yuno sales link', 'un lien de vente Yuno', 'un enlace de venta de Yuno'],
  'yc.pe.issue.linkOther': ['a link to another night', 'un lien vers une autre soirée', 'un enlace a otra noche'],
  'yc.pe.issue.linkTicketing': ['a link to a ticketing site', 'un lien vers une billetterie', 'un enlace a una ticketera'],
  'yc.pe.issue.linkPromo': ['a link with a promo code', 'un lien avec un code promo', 'un enlace con un código promocional'],
  'yc.pe.issue.linkVariable': ['a link built from a variable', 'un lien construit par une variable', 'un enlace construido con una variable'],
  'yc.pe.issue.generic': ['a selling element', 'un élément qui vend', 'un elemento que vende'],
  'yc.pe.ck.loading': ['Checking…', 'Vérification…', 'Comprobando…'],

  // Éditeur
  'yc.pe.st.t': ['Practical email · holders of “{title}”', 'E-mail pratique · détenteurs de « {title} »', 'E-mail práctico · titulares de «{title}»'],
  'yc.pe.st.s': [
    'Only information about this night. No price, table, other night, promo code or buying link: the send is refused otherwise.',
    'Uniquement l’information de cette soirée. Ni tarif, ni table, ni autre soirée, ni code promo, ni lien d’achat : l’envoi est refusé sinon.',
    'Solo la información de esta noche. Ni precio, ni mesa, ni otra noche, ni código promocional, ni enlace de compra: si no, el envío se rechaza.',
  ],
  'yc.pe.st.eventNote': ['The night of this email, with date and place, without price or buying button.', 'La soirée de cet e-mail, avec date et lieu, sans prix ni bouton d’achat.', 'La noche de este e-mail, con fecha y lugar, sin precio ni botón de compra.'],

  // Envoi
  'yc.pe.aud.h.a': ['To ', 'À ', 'A '],
  'yc.pe.aud.h.b': ['the ticket holders', 'ceux qui ont un billet', 'quienes tienen entrada'],
  'yc.pe.aud.h.c': [', and them only', ', et à eux seuls', ', y solo a ellos'],
  'yc.pe.aud.sub': [
    'Everyone who holds a valid ticket for “{title}”, read from your ticketing at the moment of sending. A resold ticket doesn’t count: its buyer isn’t coming.',
    'Toutes les personnes qui ont un billet valide pour « {title} », relues sur votre billetterie au moment de l’envoi. Un billet revendu ne compte pas : son acheteur ne vient plus.',
    'Todas las personas con una entrada válida para «{title}», leídas en su ticketera en el momento del envío. Una entrada revendida no cuenta: su comprador ya no viene.',
  ],
  'yc.pe.aud.will.one': ['ticket holder will receive this email', 'détenteur recevra cet e-mail', 'titular recibirá este e-mail'],
  'yc.pe.aud.will.other': ['ticket holders will receive this email', 'détenteurs recevront cet e-mail', 'titulares recibirán este e-mail'],
  'yc.pe.aud.onlyHere': ['{n} of them have not accepted marketing: you can only reach them with a practical email.', '{n} d’entre eux n’ont pas accepté le marketing : vous ne pouvez les joindre que par un e-mail pratique.', '{n} de ellos no aceptaron el marketing: solo puede contactarlos con un e-mail práctico.'],
  'yc.pe.aud.suppressed': ['{n} address(es) left out: bounced or marked as spam before.', '{n} adresse(s) écartée(s) : rejet ou plainte pour spam auparavant.', '{n} dirección(es) descartada(s): rechazo o queja por spam antes.'],
  'yc.pe.aud.fixed': ['No audience or segment to choose: it can’t be combined.', 'Aucune audience ni segment à choisir : ça ne se combine pas.', 'Ninguna audiencia ni segmento que elegir: no se combina.'],
  'yc.pe.c.holders': ['{n} ticket holders', '{n} détenteurs', '{n} titulares'],
  'yc.pe.c.note': ['Practical email: information about this night only, no promotion.', 'E-mail pratique : uniquement l’information de cette soirée, sans promotion.', 'E-mail práctico: solo información de esta noche, sin promoción.'],

  // Vérification (clés yc.em.sd.ck.<id>.t|ok|ko)
  'yc.em.sd.ck.pContent.t': ['Nothing that sells', 'Rien qui vende', 'Nada que venda'],
  'yc.em.sd.ck.pContent.ok': ['No price, table, other night, promo code or buying link.', 'Ni tarif, ni table, ni autre soirée, ni code promo, ni lien d’achat.', 'Ni precio, ni mesa, ni otra noche, ni código promocional, ni enlace de compra.'],
  'yc.em.sd.ck.pContent.ko': ['This email contains something that sells: remove it in the editor.', 'Cet e-mail contient quelque chose qui vend : retirez-le dans l’éditeur.', 'Este e-mail contiene algo que vende: quítelo en el editor.'],
  'yc.em.sd.ck.pTodo.t': ['Information filled in', 'Infos complétées', 'Información completada'],
  'yc.em.sd.ck.pTodo.ok': ['No “to fill in” left in the email.', 'Plus aucun « à compléter » dans l’e-mail.', 'Ningún «por completar» en el e-mail.'],
  'yc.em.sd.ck.pTodo.ko': ['There is still a “to fill in” in the email: complete it in the editor.', 'Il reste un « à compléter » dans l’e-mail : complétez-le dans l’éditeur.', 'Aún queda un «por completar» en el e-mail: complételo en el editor.'],
  'yc.em.sd.ck.pNight.t': ['The night', 'La soirée', 'La noche'],
  'yc.em.sd.ck.pNight.ok': ['Its holders can receive a practical email.', 'Ses détenteurs peuvent recevoir un e-mail pratique.', 'Sus titulares pueden recibir un e-mail práctico.'],
  'yc.em.sd.ck.pNight.ko': ['This night can’t receive a practical email right now.', 'Cette soirée ne peut pas recevoir d’e-mail pratique pour l’instant.', 'Esta noche no puede recibir un e-mail práctico por ahora.'],
  'yc.em.sd.ck.pFooter.t': ['Why they receive it', 'Pourquoi ils le reçoivent', 'Por qué lo reciben'],
  'yc.em.sd.ck.pFooter.ok': ['The footer says they hold a ticket for this night. No unsubscribe link: it isn’t marketing.', 'Le pied de page dit qu’ils ont un billet pour cette soirée. Pas de lien de désinscription : ce n’est pas du marketing.', 'El pie dice que tienen entrada para esta noche. Sin enlace de baja: no es marketing.'],

  // Modèle de départ
  'yc.pe.tpl.todo': ['to fill in', 'à compléter', 'por completar'],
  'yc.pe.tpl.subject': ['Practical info · {title}', 'Infos pratiques · {title}', 'Info práctica · {title}'],
  'yc.pe.tpl.pre': ['Times, access and what to bring.', 'Horaires, accès et ce qu’il faut prévoir.', 'Horarios, acceso y qué llevar.'],
  'yc.pe.tpl.kicker': ['Practical info', 'Infos pratiques', 'Info práctica'],
  'yc.pe.tpl.title': ['Everything you need for the night', 'Tout ce qu’il faut savoir pour la soirée', 'Todo lo que hay que saber para la noche'],
  'yc.pe.tpl.intro': ['You have your ticket: here is what you need to get in without waiting.', 'Vous avez votre billet : voici ce qu’il faut savoir pour entrer sans attendre.', 'Ya tiene su entrada: esto es lo que necesita para entrar sin esperar.'],
  'yc.pe.tpl.facts': [
    '[b]Doors open[/b]: {todo}\n[b]Last entry[/b]: {todo}\n[b]Bring[/b]: your ticket in the Shotgun app and an ID.',
    '[b]Ouverture des portes[/b] : {todo}\n[b]Dernière entrée[/b] : {todo}\n[b]À prévoir[/b] : votre billet dans l’app Shotgun et une pièce d’identité.',
    '[b]Apertura de puertas[/b]: {todo}\n[b]Última entrada[/b]: {todo}\n[b]Qué llevar[/b]: su entrada en la app de Shotgun y un documento de identidad.',
  ],
  'yc.pe.tpl.lineup': ['Line-up', 'Line-up', 'Line-up'],
  'yc.pe.tpl.reply': ['A question? Just reply to this email.', 'Une question ? Répondez simplement à cet e-mail.', '¿Una pregunta? Responda simplemente a este e-mail.'],
};

export default dict;
