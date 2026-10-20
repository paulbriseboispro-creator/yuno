/**
 * Les mots de l'accès « club hôte » d'une soirée (`host_pass`) — UNE famille
 * de clés, `hostPass.*`, pour la page /h/<jeton>, l'email d'invitation, le
 * message WhatsApp et l'écran de l'organisateur.
 *
 * ⚠️ Le nom visible de la fonction n'est PAS choisi (« à nommer » par Paul) :
 * les libellés ci-dessous sont DESCRIPTIFS et provisoires. Renommer = une
 * seule passe sur ce fichier.
 *
 * Module pur, sans import : lu tel quel par l'edge `invite-organizer-collab`
 * (email) et par le front (`src/lib/hostPass.ts`). La page parle la langue
 * CHOISIE PAR L'ORGANISATEUR (`event_host_passes.language`), pas celle du
 * téléphone du visiteur. Triplets [EN, FR, ES] : une traduction manquante ne
 * compile pas.
 */

export const HOST_PASS_LANGUAGES = ['en', 'fr', 'es'] as const;
export type HostPassLanguage = (typeof HOST_PASS_LANGUAGES)[number];

export function toHostPassLanguage(value: unknown, fallback: HostPassLanguage = 'en'): HostPassLanguage {
  return value === 'en' || value === 'fr' || value === 'es' ? value : fallback;
}

export function hostPassLocale(lang: HostPassLanguage): string {
  return lang === 'en' ? 'en-GB' : lang === 'es' ? 'es-ES' : 'fr-FR';
}

const INDEX: Record<HostPassLanguage, 0 | 1 | 2> = { en: 0, fr: 1, es: 2 };

const WORDS = {
  // ── Nom provisoire (à nommer) ──────────────────────────────────────────────
  'hostPass.name': ['Host club', 'Club hôte', 'Club anfitrión'],
  'hostPass.nameHint': ['follows the night', 'suit la soirée', 'sigue la noche'],

  // ── Côté organisateur (Console) ────────────────────────────────────────────
  'hostPass.org.roleHint': [
    'The club gets a private page for this night: sales, expected guests, arrival times, its own link. No account, no access to your Console.',
    'Le club reçoit une page privée de la soirée : ventes, attendus, heures d’arrivée, son propre lien. Sans compte, sans accès à ta Console.',
    'El club recibe una página privada de la noche: ventas, asistentes previstos, horas de llegada, su propio enlace. Sin cuenta ni acceso a tu Consola.',
  ],
  'hostPass.org.language': ['Page language', 'Langue de la page', 'Idioma de la página'],
  'hostPass.org.showRevenue': ['Show revenue', 'Montrer le chiffre d’affaires', 'Mostrar la facturación'],
  'hostPass.org.showRevenueHint': [
    'Revenue = ticket value excluding Yuno fees, refunds deducted.',
    'CA = valeur des billets hors frais Yuno, remboursements déduits.',
    'Facturación = valor de las entradas sin comisiones de Yuno, reembolsos descontados.',
  ],
  'hostPass.org.revenueLocked': [
    'Only someone who sees the money can show it.',
    'Seul qui voit l’argent peut le montrer.',
    'Solo quien ve el dinero puede mostrarlo.',
  ],
  'hostPass.org.cardTitle': ['Host club', 'Club hôte', 'Club anfitrión'],
  'hostPass.org.cardSub': [
    'A private page for the club hosting the night, without an account.',
    'Une page privée pour le club qui accueille la soirée, sans compte.',
    'Una página privada para el club que acoge la noche, sin cuenta.',
  ],
  'hostPass.org.add': ['Give the club access', 'Donner l’accès au club', 'Dar acceso al club'],
  'hostPass.org.clubName': ['Club name', 'Nom du club', 'Nombre del club'],
  'hostPass.org.email': ['Club email', 'Email du club', 'Email del club'],
  'hostPass.org.phone': ['Or WhatsApp number', 'Ou numéro WhatsApp', 'O número de WhatsApp'],
  'hostPass.org.create': ['Create the access', 'Créer l’accès', 'Crear el acceso'],
  'hostPass.org.cancel': ['Cancel', 'Annuler', 'Cancelar'],
  'hostPass.org.sendEmail': ['Send by email', 'Envoyer par email', 'Enviar por email'],
  'hostPass.org.resend': ['Send again', 'Renvoyer', 'Reenviar'],
  'hostPass.org.whatsapp': ['WhatsApp', 'WhatsApp', 'WhatsApp'],
  'hostPass.org.copy': ['Copy link', 'Copier le lien', 'Copiar enlace'],
  'hostPass.org.preview': ['Open the page', 'Ouvrir la page', 'Abrir la página'],
  'hostPass.org.revoke': ['Cut access', 'Couper l’accès', 'Cortar el acceso'],
  'hostPass.org.reopen': ['Reopen', 'Rouvrir', 'Reabrir'],
  'hostPass.org.revoked': ['Access cut', 'Accès coupé', 'Acceso cortado'],
  'hostPass.org.neverOpened': ['Not opened yet', 'Pas encore ouverte', 'Aún no abierta'],
  'hostPass.org.opened': ['Opened {n}× · last {when}', 'Ouverte {n} fois · dernière {when}', 'Abierta {n} veces · última {when}'],
  'hostPass.org.openedOnce': ['Opened once · {when}', 'Ouverte une fois · {when}', 'Abierta una vez · {when}'],
  'hostPass.org.emailSent': ['Email sent', 'Email envoyé', 'Email enviado'],
  'hostPass.org.linkStats': ['Their link: {clicks} clicks · {sales} sales', 'Son lien : {clicks} clics · {sales} ventes', 'Su enlace: {clicks} clics · {sales} ventas'],
  'hostPass.org.claimedAccepted': [
    '{club} opened its Yuno account: it follows the night as a Partner.',
    '{club} a ouvert son compte Yuno : il suit la soirée en Partenaire.',
    '{club} ha abierto su cuenta Yuno: sigue la noche como Socio.',
  ],
  'hostPass.org.claimedPending': [
    '{club} opened its Yuno account. Add it as a Partner of the night?',
    '{club} a ouvert son compte Yuno. L’ajouter en Partenaire de la soirée ?',
    '{club} ha abierto su cuenta Yuno. ¿Añadirlo como Socio de la noche?',
  ],
  'hostPass.org.claimInvite': ['Add as Partner', 'Ajouter en Partenaire', 'Añadir como Socio'],
  'hostPass.org.claimInvited': ['Invitation sent, waiting for the club', 'Invitation envoyée, en attente du club', 'Invitación enviada, esperando al club'],
  'hostPass.org.created': ['Access created', 'Accès créé', 'Acceso creado'],
  'hostPass.org.sent': ['Email sent to the club', 'Email envoyé au club', 'Email enviado al club'],
  'hostPass.org.copied': ['Link copied', 'Lien copié', 'Enlace copiado'],
  'hostPass.org.contactRequired': ['An email or a WhatsApp number', 'Un email ou un numéro WhatsApp', 'Un email o un número de WhatsApp'],
  'hostPass.org.demoNote': [
    'Demo night: emails only go to demo addresses.',
    'Soirée démo : les emails ne partent que vers une adresse démo.',
    'Noche demo: los emails solo van a direcciones demo.',
  ],
  'hostPass.err.demo_mismatch': [
    'A demo night only writes to a demo address, and a real night never does.',
    'Une soirée démo n’écrit qu’à une adresse démo, et une vraie soirée jamais.',
    'Una noche demo solo escribe a una dirección demo, y una real nunca.',
  ],
  'hostPass.err.already_invited': ['This club already has access to the night.', 'Ce club a déjà un accès à la soirée.', 'Este club ya tiene acceso a la noche.'],
  'hostPass.err.too_many_host_passes': ['Three accesses at most per night.', 'Trois accès au plus par soirée.', 'Tres accesos como máximo por noche.'],
  'hostPass.err.event_closed': ['This night is over or cancelled.', 'Cette soirée est terminée ou annulée.', 'Esta noche ha terminado o está cancelada.'],
  'hostPass.err.forbidden': ['Only the organizer of the night can do this.', 'Seul l’organisateur de la soirée peut le faire.', 'Solo el organizador de la noche puede hacerlo.'],
  'hostPass.err.support_session_forbidden': ['Not available in assisted access.', 'Indisponible en accès assisté.', 'No disponible en acceso asistido.'],
  'hostPass.err.invalid_email': ['This email address looks wrong.', 'Cette adresse email semble incorrecte.', 'Esta dirección de email parece incorrecta.'],
  'hostPass.err.invalid_phone': ['This number looks wrong.', 'Ce numéro semble incorrect.', 'Este número parece incorrecto.'],
  'hostPass.err.email_too_soon': ['An email just left. Try again in 10 minutes.', 'Un email vient de partir. Réessaie dans 10 minutes.', 'Acaba de salir un email. Inténtalo en 10 minutos.'],
  'hostPass.err.too_many_emails': ['Five emails already sent: share the link another way.', 'Cinq emails déjà envoyés : partage le lien autrement.', 'Ya se enviaron cinco emails: comparte el enlace de otra forma.'],
  'hostPass.err.generic': ['Something went wrong. Try again.', 'Un souci est survenu. Réessaie.', 'Algo ha fallado. Inténtalo de nuevo.'],

  // ── Message WhatsApp et email ──────────────────────────────────────────────
  'hostPass.share.whatsapp': [
    'Hi {club}! Here is your page for {event} at your place: sales, expected guests and arrival times, live. No account needed: {page}',
    'Salut {club} ! Voici ta page pour {event} chez toi : ventes, attendus et heures d’arrivée, en direct. Pas besoin de compte : {page}',
    '¡Hola {club}! Aquí tienes tu página para {event} en tu local: ventas, asistentes previstos y horas de llegada, en directo. Sin cuenta: {page}',
  ],
  'hostPass.mail.subject': [
    '{event} at {club}: follow the night live',
    '{event} chez {club} : suis la soirée en direct',
    '{event} en {club}: sigue la noche en directo',
  ],
  'hostPass.mail.preheader': [
    'Sales, expected guests, arrival times. No account needed.',
    'Ventes, attendus, heures d’arrivée. Sans compte.',
    'Ventas, asistentes previstos, horas de llegada. Sin cuenta.',
  ],
  'hostPass.mail.kicker': ['Your night', 'Ta soirée', 'Tu noche'],
  'hostPass.mail.intro': [
    '{inviter} organizes {event} at {club}. Here is your private page for the night: where sales stand, how many people to expect, when they arrive, and your own link to help fill the room.',
    '{inviter} organise {event} chez {club}. Voici ta page privée de la soirée : où en sont les ventes, combien de monde prévoir, à quelle heure il arrive, et ton propre lien pour aider à remplir.',
    '{inviter} organiza {event} en {club}. Aquí tienes tu página privada de la noche: cómo van las ventas, cuánta gente esperar, a qué hora llega, y tu propio enlace para ayudar a llenar.',
  ],
  'hostPass.mail.next': [
    'No account, no password: the button opens the page. Keep the link to yourself.',
    'Pas de compte, pas de mot de passe : le bouton ouvre la page. Garde le lien pour toi.',
    'Sin cuenta ni contraseña: el botón abre la página. Guarda el enlace para ti.',
  ],
  'hostPass.mail.cta': ['Open my page', 'Ouvrir ma page', 'Abrir mi página'],
  'hostPass.mail.reason': ['{inviter} gave you access to {event} on Yuno', '{inviter} t’a donné accès à {event} sur Yuno', '{inviter} te ha dado acceso a {event} en Yuno'],
  'hostPass.mail.rowOrganizer': ['Organized by', 'Organisée par', 'Organizada por'],
  'hostPass.mail.rowDate': ['Date', 'Date', 'Fecha'],
  'hostPass.mail.rowPlace': ['Place', 'Lieu', 'Lugar'],

  // ── Page /h/<jeton> ────────────────────────────────────────────────────────
  'hostPass.page.private': ['Private page', 'Page privée', 'Página privada'],
  'hostPass.page.kicker': ['Your night', 'Ta soirée', 'Tu noche'],
  'hostPass.page.organizedBy': ['Organized by {org}', 'Organisée par {org}', 'Organizada por {org}'],
  'hostPass.page.live': ['Live', 'En direct', 'En directo'],
  'hostPass.page.updated': ['Updated {time}', 'Mis à jour à {time}', 'Actualizado a las {time}'],
  'hostPass.page.cancelled': ['This night has been cancelled by the organizer.', 'Cette soirée a été annulée par l’organisateur.', 'El organizador ha cancelado esta noche.'],
  'hostPass.page.answerEmpty': [
    'Sales are open: every place taken shows up here, live.',
    'La vente est ouverte : chaque place prise s’affiche ici, en direct.',
    'La venta está abierta: cada plaza vendida aparece aquí, en directo.',
  ],
  'hostPass.page.answerBefore': ['{n} people expected', '{n} personnes attendues', '{n} personas previstas'],
  'hostPass.page.answerBeforeOne': ['1 person expected', '1 personne attendue', '1 persona prevista'],
  'hostPass.page.answerDelta': [
    ', {d} more than 3 days ago.',
    ', {d} de plus qu’il y a 3 jours.',
    ', {d} más que hace 3 días.',
  ],
  'hostPass.page.answerFlat': ['.', '.', '.'],
  'hostPass.page.answerLive': [
    'The night has started: {entered} in out of {expected} expected.',
    'La soirée a commencé : {entered} entrées sur {expected} attendus.',
    'La noche ha empezado: {entered} entradas de {expected} previstas.',
  ],
  'hostPass.page.answerLiveNoScan': [
    'The night has started: {expected} people had a place.',
    'La soirée a commencé : {expected} personnes avaient une place.',
    'La noche ha empezado: {expected} personas tenían plaza.',
  ],
  'hostPass.page.answerAfter': [
    '{entered} people came in, out of {expected} expected.',
    '{entered} personnes sont entrées, pour {expected} attendues.',
    'Entraron {entered} personas, de {expected} previstas.',
  ],
  'hostPass.page.answerAfterNoScan': [
    '{expected} people had a place. The door was not scanned enough to count arrivals.',
    '{expected} personnes avaient une place. La porte n’a pas assez scanné pour compter les entrées.',
    '{expected} personas tenían plaza. La puerta no escaneó lo suficiente para contar las entradas.',
  ],
  'hostPass.page.paid': ['Paid tickets', 'Billets payants', 'Entradas de pago'],
  'hostPass.page.free': ['Free entries', 'Entrées gratuites', 'Entradas gratuitas'],
  'hostPass.page.expected': ['Expected at the door', 'Attendus à la porte', 'Previstos en la puerta'],
  'hostPass.page.entered': ['In', 'Entrées', 'Entradas'],
  'hostPass.page.revenue': ['Revenue', 'Chiffre d’affaires', 'Facturación'],
  'hostPass.page.today': ['▲ {n} today', '▲ {n} aujourd’hui', '▲ {n} hoy'],
  'hostPass.page.nothingToday': ['nothing today', 'rien aujourd’hui', 'nada hoy'],
  'hostPass.page.guestList': ['Guest list: {n} registered', 'Guest list : {n} inscrits', 'Guest list: {n} inscritos'],
  'hostPass.page.tables': ['VIP tables: {n} booked · {g} guests', 'Tables VIP : {n} réservées · {g} personnes', 'Mesas VIP: {n} reservadas · {g} personas'],
  'hostPass.page.capacity': ['{n} / {cap} places', '{n} / {cap} places', '{n} / {cap} plazas'],
  'hostPass.page.revenueHint': [
    'Revenue = ticket value excluding Yuno fees, refunds deducted.',
    'CA = valeur des billets hors frais Yuno, remboursements déduits.',
    'Facturación = valor de las entradas sin comisiones de Yuno, reembolsos descontados.',
  ],
  'hostPass.page.arrivals': ['When they arrive', 'Heures d’arrivée', 'Horas de llegada'],
  'hostPass.page.before': ['Before {time}', 'Avant {time}', 'Antes de las {time}'],
  'hostPass.page.allNight': ['Any time', 'Toute la nuit', 'Toda la noche'],
  'hostPass.page.arrivalsHint': [
    'Ticket holders with an entry deadline must be in before that time.',
    'Les billets avec heure limite doivent entrer avant cette heure.',
    'Las entradas con hora límite deben entrar antes de esa hora.',
  ],
  'hostPass.page.drink': [
    '{n} free drinks included in the tickets, until {time}.',
    '{n} boissons offertes incluses dans les billets, jusqu’à {time}.',
    '{n} bebidas gratis incluidas en las entradas, hasta las {time}.',
  ],
  'hostPass.page.drinkNoTime': [
    '{n} free drinks included in the tickets.',
    '{n} boissons offertes incluses dans les billets.',
    '{n} bebidas gratis incluidas en las entradas.',
  ],
  'hostPass.page.curve': ['Places taken, day by day', 'Places prises, jour par jour', 'Plazas vendidas, día a día'],
  'hostPass.page.curveToday': ['Today', 'Auj.', 'Hoy'],
  'hostPass.page.tickets': ['Tickets', 'Billets', 'Entradas'],
  'hostPass.page.status.on_sale': ['On sale', 'En vente', 'A la venta'],
  'hostPass.page.status.sold_out': ['Sold out', 'Épuisé', 'Agotado'],
  'hostPass.page.status.upcoming': ['Soon', 'Bientôt', 'Pronto'],
  'hostPass.page.status.closed': ['Closed', 'Fermé', 'Cerrado'],
  'hostPass.page.drinkTag': ['drink', 'conso', 'consumición'],
  'hostPass.page.lineup': ['Line-up and times', 'Line-up et horaires', 'Line-up y horarios'],
  'hostPass.page.hours': ['{start} → {end}', '{start} → {end}', '{start} → {end}'],
  'hostPass.page.yourLink': ['Your link', 'Ton lien', 'Tu enlace'],
  'hostPass.page.yourLinkHint': [
    'Share it on your Instagram: every place sold through it counts for {club}.',
    'Partage-le sur ton Instagram : chaque place vendue par lui compte pour {club}.',
    'Compártelo en tu Instagram: cada plaza vendida con él cuenta para {club}.',
  ],
  'hostPass.page.linkStats': ['{clicks} clicks · {people} places', '{clicks} clics · {people} places', '{clicks} clics · {people} plazas'],
  'hostPass.page.copy': ['Copy', 'Copier', 'Copiar'],
  'hostPass.page.copied': ['Copied', 'Copié', 'Copiado'],
  'hostPass.page.share': ['Share', 'Partager', 'Compartir'],
  'hostPass.page.shareText': ['{event}: tickets here', '{event} : les billets ici', '{event}: entradas aquí'],
  'hostPass.page.contact': ['The organizer', 'L’organisateur', 'El organizador'],
  'hostPass.page.contactWhatsapp': ['WhatsApp {org}', 'WhatsApp {org}', 'WhatsApp {org}'],
  'hostPass.page.contactEmail': ['Email', 'Email', 'Email'],
  'hostPass.page.contactInstagram': ['Instagram', 'Instagram', 'Instagram'],
  'hostPass.page.after': ['How the night went', 'Le bilan', 'El balance'],
  'hostPass.page.newFaces': [
    '{pct} % of the guests had never been to a night by {org}.',
    '{pct} % du public n’était jamais venu à une soirée de {org}.',
    'El {pct} % del público nunca había ido a una noche de {org}.',
  ],

  // ── Conversion ─────────────────────────────────────────────────────────────
  'hostPass.convert.title': ['And your own nights?', 'Et tes propres soirées ?', '¿Y tus propias noches?'],
  'hostPass.convert.body': [
    '{n} people took their place online for a night at {club}. With a Yuno account they become your customers: you find them again for your next nights, with your tickets, your tables and your guest list.',
    '{n} personnes ont pris leur place en ligne pour une soirée chez {club}. Avec un compte Yuno, ce sont tes clients : tu les retrouves pour tes prochaines soirées, avec tes billets, tes tables et ta guest list.',
    '{n} personas reservaron su plaza online para una noche en {club}. Con una cuenta Yuno son tus clientes: los recuperas para tus próximas noches, con tus entradas, tus mesas y tu guest list.',
  ],
  'hostPass.convert.bodyEmpty': [
    'This page is what Yuno gives every organizer, live. With a Yuno club account you get it for all your nights, with your own tickets, tables and guest list.',
    'Cette page, c’est ce que Yuno donne à chaque organisateur, en direct. Avec un compte club Yuno, tu l’as pour toutes tes soirées, avec tes billets, tes tables et ta guest list.',
    'Esta página es lo que Yuno da a cada organizador, en directo. Con una cuenta de club Yuno la tienes para todas tus noches, con tus entradas, mesas y guest list.',
  ],
  'hostPass.convert.signup': ['Open my club account', 'Ouvrir mon compte club', 'Abrir mi cuenta de club'],
  'hostPass.convert.talk': ['Talk to Paul', 'Parler à Paul', 'Hablar con Paul'],
  'hostPass.convert.talkMessage': [
    'Hi Paul, I run {club}. I saw the page of {event} on Yuno and I would like to know more.',
    'Salut Paul, je gère {club}. J’ai vu la page de {event} sur Yuno et j’aimerais en savoir plus.',
    'Hola Paul, llevo {club}. He visto la página de {event} en Yuno y me gustaría saber más.',
  ],
  'hostPass.convert.free': [
    'Free to start. Nothing changes for this night.',
    'Gratuit pour commencer. Rien ne change pour cette soirée.',
    'Gratis para empezar. Nada cambia para esta noche.',
  ],
  'hostPass.convert.haveAccount': ['Already on Yuno?', 'Déjà sur Yuno ?', '¿Ya estás en Yuno?'],
  'hostPass.convert.addToConsole': ['Add this night to my Console', 'Ajouter cette soirée à ma Console', 'Añadir esta noche a mi Consola'],
  'hostPass.convert.claimAccepted': [
    'Done: the night is in your Console, as a Partner.',
    'C’est fait : la soirée est dans ta Console, en Partenaire.',
    'Hecho: la noche está en tu Consola, como Socio.',
  ],
  'hostPass.convert.claimPending': [
    'Noted. The organizer will add your club to the night.',
    'C’est noté. L’organisateur va ajouter ton club à la soirée.',
    'Anotado. El organizador añadirá tu club a la noche.',
  ],
  'hostPass.convert.claimNoVenue': [
    'This account has no club yet: open your club account first.',
    'Ce compte n’a pas encore de club : ouvre d’abord ton compte club.',
    'Esta cuenta aún no tiene club: abre primero tu cuenta de club.',
  ],
  'hostPass.convert.claimed': ['Your Yuno account is open', 'Ton compte Yuno est ouvert', 'Tu cuenta Yuno está abierta'],
  'hostPass.convert.openConsole': ['Open my Console', 'Ouvrir ma Console', 'Abrir mi Consola'],

  // ── Pied de page et états ──────────────────────────────────────────────────
  'hostPass.page.keepPrivate': [
    'This page is yours: keep it to yourself. It stays open until {date}.',
    'Cette page est à toi : garde-la pour toi. Elle reste ouverte jusqu’au {date}.',
    'Esta página es tuya: guárdala para ti. Sigue abierta hasta el {date}.',
  ],
  'hostPass.page.footer': ['Access given by {org} · via Yuno', 'Accès offert par {org} · via Yuno', 'Acceso ofrecido por {org} · vía Yuno'],
  'hostPass.page.teamNote': [
    'You are viewing this page as the organizer: your visits are not counted.',
    'Tu regardes cette page en tant qu’organisateur : tes visites ne sont pas comptées.',
    'Ves esta página como organizador: tus visitas no se cuentan.',
  ],
  'hostPass.page.notFoundTitle': ['Page not found', 'Page introuvable', 'Página no encontrada'],
  'hostPass.page.notFoundBody': [
    'This page doesn’t exist. Ask the organizer for your link.',
    'Cette page n’existe pas. Demande ton lien à l’organisateur.',
    'Esta página no existe. Pide tu enlace al organizador.',
  ],
  'hostPass.page.closedTitle': ['This page is closed', 'Cette page est fermée', 'Esta página está cerrada'],
  'hostPass.page.closedBody': [
    'The page of {event} is closed. Ask the organizer if you need the final numbers.',
    'La page de {event} est fermée. Demande les chiffres finaux à l’organisateur si besoin.',
    'La página de {event} está cerrada. Pide las cifras finales al organizador si las necesitas.',
  ],
  'hostPass.page.errorTitle': ['Something went wrong', 'Un souci de connexion', 'Algo ha fallado'],
  'hostPass.page.errorBody': [
    'The page could not be loaded. Check your connection and try again.',
    'La page n’a pas pu être chargée. Vérifie ta connexion et réessaie.',
    'No se ha podido cargar la página. Revisa tu conexión y vuelve a intentarlo.',
  ],
  'hostPass.page.retry': ['Try again', 'Réessayer', 'Reintentar'],
} as const satisfies Record<string, readonly [string, string, string]>;

export type HostPassWordKey = keyof typeof WORDS;
export type HostPassWords = (key: HostPassWordKey, vars?: Record<string, string | number>) => string;

/** Les mots d'une langue, variables `{nom}` remplacées. */
export function hostPassWords(lang: HostPassLanguage): HostPassWords {
  const i = INDEX[lang];
  return (key, vars) => {
    let s: string = WORDS[key][i];
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
  };
}

/** Toutes les clés (test de parité des trois langues). */
export const HOST_PASS_WORD_KEYS = Object.keys(WORDS) as HostPassWordKey[];
export const HOST_PASS_WORDS_RAW: Readonly<Record<string, readonly [string, string, string]>> = WORDS;

/** Le message WhatsApp / l'objet de l'email, dans la langue du club. */
export function hostPassShareText(lang: HostPassLanguage, p: { club: string; event: string; page: string }): string {
  return hostPassWords(lang)('hostPass.share.whatsapp', p);
}
