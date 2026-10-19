import type { CrmDict } from './types';

// Premiers pas : le guide des premiers pas d'un compte (Accueil, volet, carte d'aide
// sur la page d'une étape, Aide) — [EN, FR, ES]. Nom à l'écran : `yc.fs.name`.
const dict: CrmDict = {
  'yc.fs.name': ['First steps', 'Premiers pas', 'Primeros pasos'],
  'yc.fs.progress': ['{done} of {total}', '{done} sur {total}', '{done} de {total}'],
  'yc.fs.title.a': ['Where to ', 'Par où ', '¿Por dónde '],
  'yc.fs.title.accent': ['start', 'commencer', 'empezar'],
  'yc.fs.title.b': ['?', ' ?', '?'],
  'yc.fs.sub': [
    'Five steps, about fifteen minutes in all. Do them in any order: each one ticks itself as soon as it is done.',
    'Cinq étapes, une quinzaine de minutes en tout. Faites-les dans l’ordre que vous voulez : chacune se coche toute seule dès que c’est fait.',
    'Cinco pasos, unos quince minutos en total. Hágalos en el orden que quiera: cada uno se marca solo en cuanto está hecho.',
  ],
  'yc.fs.min': ['{n} min', '{n} min', '{n} min'],
  'yc.fs.st.done': ['Done', 'Fait', 'Hecho'],
  'yc.fs.st.running': ['In progress', 'En cours', 'En curso'],
  'yc.fs.st.broken': ['Interrupted', 'Interrompu', 'Interrumpido'],
  'yc.fs.st.next': ['Next', 'Ensuite', 'Siguiente'],

  // « Votre espace est ouvert » : l'étape offerte.
  'yc.fs.open.t': ['Your space is open', 'Votre espace est ouvert', 'Su espacio está abierto'],
  'yc.fs.open.founder': [
    'Founder offer: Yuno CRM is free until {date}, with {yunits} Yunits for your sends.',
    'Offre fondateur : Yuno CRM offert jusqu’au {date}, avec {yunits} Yunits pour vos envois.',
    'Oferta fundador: Yuno CRM gratis hasta el {date}, con {yunits} Yunits para sus envíos.',
  ],
  'yc.fs.open.trial': [
    'Trial until {date}, with {yunits} Yunits for your sends.',
    'Essai jusqu’au {date}, avec {yunits} Yunits pour vos envois.',
    'Prueba hasta el {date}, con {yunits} Yunits para sus envíos.',
  ],
  'yc.fs.open.plain': ['{yunits} Yunits ready for your sends.', '{yunits} Yunits prêts pour vos envois.', '{yunits} Yunits listos para sus envíos.'],

  // Les étapes.
  'yc.fs.shotgun.t': ['Connect Shotgun', 'Branchez Shotgun', 'Conecte Shotgun'],
  'yc.fs.shotgun.d': [
    'Your nights, your buyers and their consents arrive on their own, then stay up to date. Yuno only reads: nothing changes on Shotgun.',
    'Vos soirées, vos acheteurs et leurs accords arrivent tout seuls, puis restent à jour. Yuno ne fait que lire : rien ne change chez Shotgun.',
    'Sus fiestas, sus compradores y sus consentimientos llegan solos y se mantienen al día. Yuno solo lee: nada cambia en Shotgun.',
  ],
  'yc.fs.shotgun.on': ['{org} · {tickets} tickets read', '{org} · {tickets} billets lus', '{org} · {tickets} entradas leídas'],
  'yc.fs.shotgun.onNoOrg': ['{tickets} tickets read', '{tickets} billets lus', '{tickets} entradas leídas'],
  'yc.fs.shotgun.importing': [
    'Connected. Your history is importing in the background ({tickets} tickets so far).',
    'C’est branché. Votre historique s’importe en arrière-plan ({tickets} billets pour l’instant).',
    'Conectado. Su historial se importa en segundo plano ({tickets} entradas por ahora).',
  ],
  'yc.fs.shotgun.importingNoN': [
    'Connected. Your history is importing in the background.',
    'C’est branché. Votre historique s’importe en arrière-plan.',
    'Conectado. Su historial se importa en segundo plano.',
  ],
  'yc.fs.shotgun.broken': ['The connection is interrupted: reconnect it.', 'La connexion est interrompue : reconnectez-la.', 'La conexión está interrumpida: vuelva a conectarla.'],
  'yc.fs.shotgun.cta': ['Connect Shotgun', 'Brancher Shotgun', 'Conectar Shotgun'],
  'yc.fs.shotgun.ctaBroken': ['Reconnect', 'Reconnecter', 'Reconectar'],
  'yc.fs.shotgun.ctaOn': ['See the connection', 'Voir la connexion', 'Ver la conexión'],

  'yc.fs.identity.t': ['Sign your emails', 'Signez vos e-mails', 'Firme sus e-mails'],
  'yc.fs.identity.d': [
    'The name your customers will see, your company name and a postal address. The law requires it, and no email goes out without it.',
    'Le nom que vos clients verront, votre raison sociale et une adresse postale. La loi l’exige, et aucun e-mail ne part sans.',
    'El nombre que verán sus clientes, su razón social y una dirección postal. La ley lo exige y ningún e-mail sale sin ello.',
  ],
  'yc.fs.identity.missing': ['Still missing: {list}.', 'Il manque : {list}.', 'Falta: {list}.'],
  'yc.fs.identity.on': ['Your emails are signed.', 'Vos e-mails sont signés.', 'Sus e-mails están firmados.'],
  'yc.fs.identity.cta': ['Complete', 'Compléter', 'Completar'],

  'yc.fs.email.t': ['Send your first email', 'Envoyez votre premier e-mail', 'Envíe su primer e-mail'],
  'yc.fs.email.dNight': [
    'Announce “{night}”: Yuno fills the template with the date, the line-up and the prices. Send yourself a test first, it’s free.',
    'Annoncez « {night} » : Yuno remplit le modèle avec la date, le line-up et les tarifs. Envoyez-vous d’abord un test, c’est gratuit.',
    'Anuncie «{night}»: Yuno rellena la plantilla con la fecha, el line-up y las tarifas. Envíese primero una prueba, es gratis.',
  ],
  'yc.fs.email.d': [
    'Pick a template: Yuno fills it with your nights. Send yourself a test first, it’s free.',
    'Choisissez un modèle : Yuno le remplit avec vos soirées. Envoyez-vous d’abord un test, c’est gratuit.',
    'Elija una plantilla: Yuno la rellena con sus fiestas. Envíese primero una prueba, es gratis.',
  ],
  'yc.fs.email.draft': ['A draft is waiting: “{name}”.', 'Un brouillon vous attend : « {name} ».', 'Un borrador le espera: «{name}».'],
  'yc.fs.email.on.one': ['First email sent.', 'Premier e-mail parti.', 'Primer e-mail enviado.'],
  'yc.fs.email.on.other': ['{n} emails sent.', '{n} e-mails partis.', '{n} e-mails enviados.'],
  'yc.fs.email.cta': ['Pick a template', 'Choisir un modèle', 'Elegir una plantilla'],
  'yc.fs.email.ctaDraft': ['Open the draft', 'Reprendre le brouillon', 'Retomar el borrador'],

  'yc.fs.automation.t': ['Turn on an automation', 'Allumez une automatisation', 'Active una automatización'],
  'yc.fs.automation.d': [
    'Yuno writes on its own at the right time: a new night, the last call, the thank-you the next day. You choose, it does the rest.',
    'Yuno écrit tout seul au bon moment : une nouvelle soirée, le dernier appel, le merci du lendemain. Vous choisissez, il fait le reste.',
    'Yuno escribe solo en el momento adecuado: una nueva fiesta, el último aviso, el agradecimiento del día siguiente. Usted elige, él hace el resto.',
  ],
  'yc.fs.automation.on.one': ['1 automation on.', '1 automatisation allumée.', '1 automatización activa.'],
  'yc.fs.automation.on.other': ['{n} automations on.', '{n} automatisations allumées.', '{n} automatizaciones activas.'],
  'yc.fs.automation.cta': ['Pick a recipe', 'Choisir une recette', 'Elegir una receta'],

  'yc.fs.claude.t': ['Connect Claude', 'Branchez Claude', 'Conecte Claude'],
  'yc.fs.claude.d': [
    'Ask Claude about your nights and your customers: it reads your figures with your permission and prepares drafts you approve.',
    'Posez vos questions à Claude sur vos soirées et vos clients : il lit vos chiffres avec votre accord et prépare des brouillons que vous validez.',
    'Pregunte a Claude sobre sus fiestas y sus clientes: lee sus cifras con su permiso y prepara borradores que usted valida.',
  ],
  'yc.fs.claude.on': ['Claude is connected to {space}.', 'Claude est branché sur {space}.', 'Claude está conectado a {space}.'],
  'yc.fs.claude.cta': ['Add to Claude', 'Ajouter à Claude', 'Añadir a Claude'],

  'yc.fs.segments.t': ['Create your segments', 'Créez vos segments', 'Cree sus segmentos'],
  'yc.fs.segments.d': [
    'Regulars, newcomers, big spenders: Yuno suggests the useful groups, and they update themselves.',
    'Habitués, nouveaux venus, gros paniers : Yuno propose les groupes utiles, et ils se mettent à jour tout seuls.',
    'Habituales, recién llegados, grandes cestas: Yuno propone los grupos útiles y se actualizan solos.',
  ],
  'yc.fs.segments.on.one': ['1 segment.', '1 segment.', '1 segmento.'],
  'yc.fs.segments.on.other': ['{n} segments.', '{n} segments.', '{n} segmentos.'],
  'yc.fs.segments.cta': ['Pick my segments', 'Choisir mes segments', 'Elegir mis segmentos'],

  'yc.fs.team.t': ['Invite your team', 'Invitez votre équipe', 'Invite a su equipo'],
  'yc.fs.team.d': [
    'Everyone gets their own access: read, edit or admin.',
    'Chacun son accès : lecture, édition ou administration.',
    'Cada uno con su acceso: lectura, edición o administración.',
  ],
  'yc.fs.team.on.one': ['1 member has joined.', '1 membre vous a rejoint.', '1 miembro se ha unido.'],
  'yc.fs.team.on.other': ['{n} members have joined.', '{n} membres vous ont rejoint.', '{n} miembros se han unido.'],
  'yc.fs.team.cta': ['Invite', 'Inviter', 'Invitar'],

  'yc.fs.notMine': ['{name} takes care of it: only the account holder can do this.', '{name} s’en charge : seul le titulaire du compte peut le faire.', '{name} se encarga: solo el titular de la cuenta puede hacerlo.'],
  'yc.fs.notMineAnon': ['The account holder takes care of it.', 'Le titulaire du compte s’en charge.', 'El titular de la cuenta se encarga.'],
  'yc.fs.readOnly': ['Your role lets you follow along, not change it.', 'Votre rôle vous permet de suivre, pas de modifier.', 'Su rol le permite seguir, no modificar.'],

  'yc.fs.more': ['To go further', 'Pour aller plus loin', 'Para ir más lejos'],
  'yc.fs.moreN': ['{done} of {total} · optional', '{done} sur {total} · facultatif', '{done} de {total} · opcional'],

  // La prochaine soirée et l'aide humaine.
  'yc.fs.night.kick': ['Your next night', 'Votre prochaine soirée', 'Su próxima fiesta'],
  'yc.fs.night.when.today': ['Tonight', 'Ce soir', 'Esta noche'],
  'yc.fs.night.when.tomorrow': ['Tomorrow', 'Demain', 'Mañana'],
  'yc.fs.night.when.days': ['In {n} days', 'Dans {n} jours', 'En {n} días'],
  'yc.fs.night.none': [
    'Your Shotgun nights will appear here as soon as the connection is made.',
    'Vos soirées Shotgun apparaîtront ici dès la connexion faite.',
    'Sus fiestas de Shotgun aparecerán aquí en cuanto se haga la conexión.',
  ],
  'yc.fs.human.t': ['Shall we do it together?', 'On le fait ensemble ?', '¿Lo hacemos juntos?'],
  'yc.fs.human.d': [
    'Open an assisted access: Yuno guides you live, and you cut the access whenever you want.',
    'Ouvrez un accès assisté : Yuno vous accompagne en direct, et vous coupez l’accès quand vous voulez.',
    'Abra un acceso asistido: Yuno le acompaña en directo y usted corta el acceso cuando quiera.',
  ],
  'yc.fs.human.cta': ['Get help', 'Être accompagné', 'Recibir ayuda'],

  // Actions sur le guide.
  'yc.fs.snooze': ['Remind me tomorrow', 'Me le rappeler demain', 'Recordármelo mañana'],
  'yc.fs.dismiss': ['Hide the guide', 'Masquer le guide', 'Ocultar la guía'],
  'yc.fs.toast.dismissed': ['Guide hidden. You’ll find it again in Help.', 'Guide masqué. Vous le retrouvez dans Aide.', 'Guía oculta. La encontrará de nuevo en Ayuda.'],
  'yc.fs.toast.snoozed': ['Noted: the guide comes back tomorrow.', 'C’est noté : le guide revient demain.', 'Anotado: la guía vuelve mañana.'],
  'yc.fs.toast.resumed': ['The guide is back on your home page.', 'Le guide est de retour sur votre accueil.', 'La guía vuelve a estar en su inicio.'],
  'yc.fs.resume': ['Put it back on the home page', 'Remettre sur l’accueil', 'Volver a ponerla en el inicio'],
  'yc.fs.openGuide': ['Open the guide', 'Ouvrir le guide', 'Abrir la guía'],
  'yc.fs.close': ['Close', 'Fermer', 'Cerrar'],

  // Étape faite (toast) — une fois, quand la base la voit faite.
  'yc.fs.toast.shotgun': ['Shotgun is connected: your history is on its way.', 'Shotgun est branché : votre historique arrive.', 'Shotgun está conectado: su historial está en camino.'],
  'yc.fs.toast.identity': ['Your emails are signed.', 'Vos e-mails sont signés.', 'Sus e-mails están firmados.'],
  'yc.fs.toast.email': ['Your first email is on its way.', 'Votre premier e-mail est parti.', 'Su primer e-mail ha salido.'],
  'yc.fs.toast.automation': ['Your first automation is running.', 'Votre première automatisation tourne.', 'Su primera automatización está en marcha.'],
  'yc.fs.toast.claude': ['Claude is connected.', 'Claude est branché.', 'Claude está conectado.'],
  'yc.fs.toast.segments': ['Your first segments are ready.', 'Vos premiers segments sont prêts.', 'Sus primeros segmentos están listos.'],
  'yc.fs.toast.team': ['Your team has joined you.', 'Votre équipe vous a rejoint.', 'Su equipo se ha unido.'],
  'yc.fs.toast.next': ['Next step', 'Étape suivante', 'Siguiente paso'],

  // Tout est fait : le vrai résultat, une fois.
  'yc.fs.done.kick': ['First steps · done', 'Premiers pas · terminés', 'Primeros pasos · terminados'],
  'yc.fs.done.t.a': ['Your Yuno CRM is ', 'Votre Yuno CRM est ', 'Su Yuno CRM está '],
  'yc.fs.done.t.accent': ['ready', 'prêt', 'listo'],
  'yc.fs.done.t.b': ['', '', ''],
  'yc.fs.done.s': [
    'Shotgun connected, emails signed, a first send gone out, an automation running and Claude by your side.',
    'Shotgun branché, e-mails signés, un premier envoi parti, une automatisation qui tourne et Claude à vos côtés.',
    'Shotgun conectado, e-mails firmados, un primer envío hecho, una automatización en marcha y Claude a su lado.',
  ],
  'yc.fs.outcome.one': ['A first buyer came from a Yuno email.', 'Un premier acheteur est venu d’un e-mail Yuno.', 'Un primer comprador ha llegado por un e-mail de Yuno.'],
  'yc.fs.outcome.other': ['{n} buyers came from a Yuno email.', '{n} acheteurs sont venus d’un e-mail Yuno.', '{n} compradores han llegado por un e-mail de Yuno.'],
  'yc.fs.outcome.wait': [
    'Yuno will tell you here when an email sells your first ticket.',
    'Yuno vous dira ici quand un e-mail fera vendre votre premier billet.',
    'Yuno le dirá aquí cuando un e-mail venda su primera entrada.',
  ],
  'yc.fs.finish': ['Finish', 'Terminer', 'Terminar'],
  'yc.fs.review': ['See the weekly review', 'Voir le bilan de la semaine', 'Ver el balance de la semana'],

  // La carte d'aide sur la page d'une étape.
  'yc.fs.coach.kick': ['First steps · step {n} of {total}', 'Premiers pas · étape {n} sur {total}', 'Primeros pasos · paso {n} de {total}'],
  'yc.fs.coach.kickMore': ['First steps · to go further', 'Premiers pas · pour aller plus loin', 'Primeros pasos · para ir más lejos'],
  'yc.fs.coach.shotgun': [
    'Have your organizer ID and an API token at hand (Smartboard › Settings › Integrations › Shotgun APIs), then follow the three steps of the assistant.',
    'Gardez sous la main votre ID organisateur et un jeton API (Smartboard › Paramètres › Intégrations › Shotgun APIs), puis suivez les trois étapes de l’assistant.',
    'Tenga a mano su ID de organizador y un token API (Smartboard › Ajustes › Integraciones › Shotgun APIs) y siga los tres pasos del asistente.',
  ],
  'yc.fs.coach.identity': [
    'Fill in the sender name, the company name and the postal address, then save. The banner turns green when it’s complete.',
    'Remplissez le nom d’expéditeur, la raison sociale et l’adresse postale, puis enregistrez. Le bandeau passe au vert quand c’est complet.',
    'Rellene el nombre del remitente, la razón social y la dirección postal y guarde. El aviso se pone verde cuando está completo.',
  ],
  'yc.fs.coach.email': [
    'Pick a template: it’s already filled with your next night. Read it through, click “Receive a test”, then send.',
    'Choisissez un modèle : il est déjà rempli avec votre prochaine soirée. Relisez, cliquez sur « Recevoir un test », puis envoyez.',
    'Elija una plantilla: ya está rellenada con su próxima fiesta. Revísela, pulse «Recibir una prueba» y envíe.',
  ],
  'yc.fs.coach.emailNoNight': [
    'Pick a template: Yuno fills it with your nights. Read it through, click “Receive a test”, then send.',
    'Choisissez un modèle : Yuno le remplit avec vos soirées. Relisez, cliquez sur « Recevoir un test », puis envoyez.',
    'Elija una plantilla: Yuno la rellena con sus fiestas. Revísela, pulse «Recibir una prueba» y envíe.',
  ],
  'yc.fs.coach.automation': [
    'Start with a recommended recipe: check the message, then turn it on. Yuno shows you who it will write to before anything goes out.',
    'Commencez par une recette conseillée : vérifiez le message, puis allumez-la. Yuno vous montre à qui elle écrira avant que rien ne parte.',
    'Empiece por una receta recomendada: revise el mensaje y actívela. Yuno le muestra a quién escribirá antes de que salga nada.',
  ],
  'yc.fs.coach.claude': [
    '“Add to Claude” opens the Yuno listing in the Claude directory: click Connect, then Allow. This page turns green as soon as it’s connected.',
    '« Ajouter à Claude » ouvre la fiche Yuno dans l’annuaire de Claude : cliquez sur Connecter, puis Autoriser. Cette page passe au vert dès que c’est branché.',
    '«Añadir a Claude» abre la ficha de Yuno en el directorio de Claude: pulse Conectar y luego Permitir. Esta página se pone verde en cuanto está conectado.',
  ],
  'yc.fs.coach.segments': [
    'Tick the recommended segments, then create them: they update themselves.',
    'Cochez les segments recommandés, puis créez-les : ils se mettent à jour tout seuls.',
    'Marque los segmentos recomendados y créelos: se actualizan solos.',
  ],
  'yc.fs.coach.team': [
    'Enter the person’s email and choose their role: they receive an invitation.',
    'Saisissez l’e-mail de la personne et choisissez son rôle : elle reçoit une invitation.',
    'Escriba el e-mail de la persona y elija su rol: recibirá una invitación.',
  ],
  'yc.fs.coach.show': ['Show me where', 'Montrer où', 'Mostrar dónde'],
  'yc.fs.coach.all': ['All steps', 'Toutes les étapes', 'Todos los pasos'],
  'yc.fs.coach.minimize': ['Minimise', 'Réduire', 'Reducir'],
  'yc.fs.coach.expand': ['Show the step', 'Afficher l’étape', 'Mostrar el paso'],
  'yc.fs.coach.doneT': ['Done.', 'C’est fait.', 'Hecho.'],
  'yc.fs.coach.next': ['Next step: {step}', 'Étape suivante : {step}', 'Siguiente paso: {step}'],
  'yc.fs.coach.continue': ['Continue', 'Continuer', 'Continuar'],
  'yc.fs.coach.allDone': ['All five steps are done.', 'Les cinq étapes sont faites.', 'Los cinco pasos están hechos.'],
  'yc.fs.coach.running': [
    'Connected. Yuno imports your history in the background: you can move on.',
    'C’est branché. Yuno importe votre historique en arrière-plan : vous pouvez passer à la suite.',
    'Conectado. Yuno importa su historial en segundo plano: puede seguir.',
  ],

  // Aide et menus.
  'yc.fs.help.s': ['{done} of {total} steps done', '{done} étapes faites sur {total}', '{done} pasos hechos de {total}'],
  'yc.fs.help.d': [
    'The steps that get Yuno working for you, ticked as you go.',
    'Les étapes qui font travailler Yuno pour vous, cochées au fur et à mesure.',
    'Los pasos que ponen a Yuno a trabajar para usted, marcados sobre la marcha.',
  ],
  'yc.fs.help.finished': ['All done on {date}.', 'Tout est fait depuis le {date}.', 'Todo hecho desde el {date}.'],
  'yc.fs.nav.aria': ['First steps, {done} of {total} done', 'Premiers pas, {done} sur {total} faits', 'Primeros pasos, {done} de {total} hechos'],
};

export default dict;
