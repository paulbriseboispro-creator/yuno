import type { CrmDict } from './types';

// États d'erreur de la Console (Pages d'erreur du design) — [EN, FR, ES].
// Rien n'est promis que le produit ne fait pas : pas de file hors ligne, pas
// de compte à rebours de maintenance, pas de « demander l'accès ».
const dict: CrmDict = {
  'yc.er.support': ['Support', 'Service client', 'Atención al cliente'],
  'yc.er.help': ['Need help?', 'Besoin d’aide ?', '¿Necesitas ayuda?'],
  'yc.er.logoAria': ['Yuno', 'Yuno', 'Yuno'],

  // 404
  'yc.er.404.kicker': ['Error 404 · Page not found', 'Erreur 404 · Page introuvable', 'Error 404 · Página no encontrada'],
  'yc.er.404.title': ['This page left the {party}.', 'Cette page a quitté la {party}.', 'Esta página se fue de la {party}.'],
  'yc.er.404.party': ['party', 'soirée', 'fiesta'],
  'yc.er.404.body': ['The link is broken or the page no longer exists. Your Yunit looked everywhere, without luck.', 'Le lien est cassé ou la page n’existe plus. Votre Yunit a cherché partout, sans succès.', 'El enlace está roto o la página ya no existe. Tu Yunit buscó por todas partes, sin suerte.'],
  'yc.er.404.ph': ['Search for a contact, a night, a campaign…', 'Rechercher un contact, une soirée, une campagne…', 'Buscar un contacto, una noche, una campaña…'],
  'yc.er.404.search': ['Search', 'Rechercher', 'Buscar'],
  'yc.er.404.goto': ['Or go straight to:', 'Ou allez directement à :', 'O ve directamente a:'],
  'yc.er.404.home': ['Home', 'Accueil', 'Inicio'],
  'yc.er.404.clients': ['Clients', 'Clients', 'Clientes'],
  'yc.er.404.nights': ['Nights', 'Soirées', 'Noches'],
  'yc.er.404.analytics': ['Analytics', 'Analyses', 'Análisis'],
  'yc.er.404.back': ['Back to the previous page', 'Retour à la page précédente', 'Volver a la página anterior'],
  'yc.er.404.toHome': ['Go to Home', 'Aller à l’Accueil', 'Ir al Inicio'],

  // 401
  'yc.er.401.kicker': ['Error 401 · Not signed in', 'Erreur 401 · Non connecté', 'Error 401 · Sin sesión'],
  'yc.er.401.title': ['Sign in to {go}.', 'Connectez-vous pour {go}.', 'Inicia sesión para {go}.'],
  'yc.er.401.go': ['continue', 'continuer', 'continuar'],
  'yc.er.401.body': ['Your session has expired or this page needs an account. Once signed in, you’ll come back exactly here.', 'Votre session a expiré ou cette page demande un compte. Une fois connecté, vous reviendrez exactement ici.', 'Tu sesión ha caducado o esta página necesita una cuenta. Al iniciar sesión volverás exactamente aquí.'],
  'yc.er.401.dest': ['Destination', 'Destination', 'Destino'],
  'yc.er.401.signIn': ['Sign in', 'Se connecter', 'Iniciar sesión'],
  'yc.er.401.signUp': ['Create an account', 'Créer un compte', 'Crear una cuenta'],
  'yc.er.401.trouble': ['Trouble signing in?', 'Un souci pour vous connecter ?', '¿Problemas para entrar?'],
  'yc.er.401.contact': ['Contact support', 'Contacter le support', 'Contactar con soporte'],

  // 403
  'yc.er.403.kicker': ['Error 403 · Access denied', 'Erreur 403 · Accès refusé', 'Error 403 · Acceso denegado'],
  'yc.er.403.title': ['This space is {word}.', 'Cet espace est {word}.', 'Este espacio está {word}.'],
  'yc.er.403.word': ['restricted', 'réservé', 'reservado'],
  'yc.er.403.body': ['Your account isn’t allowed to open this. Ask the owner of your space to give you access.', 'Votre compte n’a pas la permission d’ouvrir ceci. Demandez l’accès au titulaire de votre espace.', 'Tu cuenta no tiene permiso para abrir esto. Pide acceso al titular de tu espacio.'],
  'yc.er.403.bodyNoSpace': ['This account has no Yuno CRM space. Switch to the account you use for Yuno CRM, or contact support.', 'Ce compte n’a pas d’espace Yuno CRM. Changez pour le compte que vous utilisez pour Yuno CRM, ou contactez le support.', 'Esta cuenta no tiene espacio Yuno CRM. Cambia a la cuenta que usas para Yuno CRM o contacta con soporte.'],
  'yc.er.403.why': ['Why am I seeing this?', 'Pourquoi je vois ceci ?', '¿Por qué veo esto?'],
  'yc.er.403.account': ['Your account', 'Votre compte', 'Tu cuenta'],
  'yc.er.403.page': ['Requested page', 'Page demandée', 'Página solicitada'],
  'yc.er.403.noSpace': ['No Yuno CRM space', 'Aucun espace Yuno CRM', 'Ningún espacio Yuno CRM'],
  'yc.er.403.who': ['Who can help', 'Qui peut vous aider', 'Quién puede ayudarte'],
  'yc.er.403.whoV': ['The owner of the space', 'Le titulaire de l’espace', 'El titular del espacio'],
  'yc.er.403.wrong': ['Not the right account?', 'Ce n’est pas le bon compte ?', '¿No es la cuenta correcta?'],
  'yc.er.403.switch': ['Switch account', 'Changer de compte', 'Cambiar de cuenta'],
  // 403, titulaire d'un compte Billetterie sans CRM : ajouter le CRM au compte
  'yc.er.403.openKicker': ['Yuno CRM · Not opened yet', 'Yuno CRM · Pas encore ouvert', 'Yuno CRM · Aún no abierto'],
  'yc.er.403.openTitle': ['Yuno CRM is one {word} away.', 'Yuno CRM est à un {word}.', 'Yuno CRM está a un {word}.'],
  'yc.er.403.openWord': ['click', 'clic', 'clic'],
  'yc.er.403.openBody': ['{name} uses Yuno Ticketing. Add Yuno CRM to the same account: same login, same contacts, and your ticketing stays exactly as it is.', '{name} utilise Yuno Billetterie. Ajoutez Yuno CRM au même compte : même connexion, mêmes contacts, et votre billetterie reste exactement comme elle est.', '{name} usa Yuno Ticketing. Añade Yuno CRM a la misma cuenta: mismo acceso, mismos contactos, y tu ticketing se queda exactamente como está.'],
  'yc.er.403.openBodyMany': ['Your accounts use Yuno Ticketing. Add Yuno CRM to one of them: same login, same contacts, and your ticketing stays exactly as it is.', 'Vos comptes utilisent Yuno Billetterie. Ajoutez Yuno CRM à l’un d’eux : même connexion, mêmes contacts, et votre billetterie reste exactement comme elle est.', 'Tus cuentas usan Yuno Ticketing. Añade Yuno CRM a una de ellas: mismo acceso, mismos contactos, y tu ticketing se queda exactamente como está.'],
  'yc.er.403.openCta': ['Add Yuno CRM to my account', 'Ajouter Yuno CRM à mon compte', 'Añadir Yuno CRM a mi cuenta'],
  'yc.er.403.openWhy': ['What changes', 'Ce qui change', 'Qué cambia'],
  'yc.er.403.ticketing': ['Yuno Ticketing', 'Yuno Billetterie', 'Yuno Ticketing'],
  'yc.er.403.crmRow': ['Yuno CRM', 'Yuno CRM', 'Yuno CRM'],
  'yc.er.403.crmRowV': ['Not opened yet', 'Pas encore ouvert', 'Aún no abierto'],
  'yc.er.403.fact1': ['Your ticketing stays, nothing is removed', 'Votre billetterie reste, rien n’est retiré', 'Tu ticketing se queda, no se quita nada'],
  'yc.er.403.fact2': ['14-day free trial, no card', '14 jours d’essai gratuit, sans carte', '14 días de prueba gratis, sin tarjeta'],
  'yc.er.403.fact3': ['Then the Yuno CRM subscription, only if you keep it', 'Puis l’abonnement Yuno CRM, seulement si vous le gardez', 'Luego la suscripción a Yuno CRM, solo si la mantienes'],

  // 500
  'yc.er.500.kicker': ['Error 500 · On Yuno’s side', 'Erreur 500 · Côté Yuno', 'Error 500 · Por parte de Yuno'],
  'yc.er.500.title': ['A grain of sand in {y}.', 'Un grain de sable dans {y}.', 'Un grano de arena en {y}.'],
  'yc.er.500.body': ['This isn’t your fault. We’ve been notified and are looking into it. Your data and scheduled sends are untouched.', 'Ce n’est pas de votre faute. Nos équipes ont été prévenues et travaillent dessus. Vos données et vos envois programmés ne sont pas touchés.', 'No es culpa tuya. Nuestro equipo ha sido avisado y está en ello. Tus datos y tus envíos programados no se han tocado.'],
  'yc.er.500.reload': ['Refresh the page', 'Actualiser la page', 'Actualizar la página'],
  'yc.er.500.ref': ['Reference for support', 'Référence à transmettre au support', 'Referencia para soporte'],
  'yc.er.500.copy': ['Copy', 'Copier', 'Copiar'],
  'yc.er.500.copied': ['Copied', 'Copié', 'Copiado'],
  'yc.er.500.alt': ['Or write to us at', 'Une alternative : écrivez-nous à', 'O escríbenos a'],

  // 503
  'yc.er.503.kicker': ['503 · Service unavailable', '503 · Service indisponible', '503 · Servicio no disponible'],
  'yc.er.503.title': ['We’ll be back {soon}.', 'Nous revenons très {soon}.', 'Volvemos muy {soon}.'],
  'yc.er.503.soon': ['soon', 'vite', 'pronto'],
  'yc.er.503.body': ['Yuno is under maintenance. Your contacts and scheduled sends will be waiting when it’s back.', 'Yuno est en maintenance. Vos contacts et vos envois programmés vous attendent au retour.', 'Yuno está en mantenimiento. Tus contactos y tus envíos programados te esperarán a la vuelta.'],
  'yc.er.503.retry': ['Check again', 'Revérifier', 'Volver a comprobar'],

  // Hors ligne
  'yc.er.off.title': ['You’re {off}.', 'Vous êtes {off}.', 'Estás {off}.'],
  'yc.er.off.off': ['offline', 'hors ligne', 'sin conexión'],
  'yc.er.off.body': ['Yuno can’t reach the internet. Check your Wi-Fi or mobile network: we keep trying automatically.', 'Yuno ne peut pas joindre Internet. Vérifiez votre Wi-Fi ou votre réseau mobile : nous réessayons automatiquement.', 'Yuno no puede conectarse a Internet. Revisa tu Wi-Fi o tu red móvil: reintentamos automáticamente.'],
  'yc.er.off.next': ['Next attempt in {s} s', 'Nouvelle tentative dans {s} s', 'Próximo intento en {s} s'],
  'yc.er.off.now': ['Retry now', 'Réessayer maintenant', 'Reintentar ahora'],
  'yc.er.off.note': ['Nothing can be saved or sent until the network is back.', 'Rien ne peut être enregistré ni envoyé tant que le réseau n’est pas revenu.', 'No se puede guardar ni enviar nada hasta que vuelva la red.'],
  'yc.er.bar.off': ['You’re offline. Nothing can be saved or sent until the network is back.', 'Vous êtes hors connexion. Rien ne peut être enregistré ni envoyé tant que le réseau n’est pas revenu.', 'Estás sin conexión. No se puede guardar ni enviar nada hasta que vuelva la red.'],
  'yc.er.bar.retry': ['Retry', 'Réessayer', 'Reintentar'],
  'yc.er.bar.reconnecting': ['Reconnecting…', 'Reconnexion…', 'Reconectando…'],
  'yc.er.bar.back': ['You’re back online.', 'Connexion rétablie.', 'Conexión restablecida.'],

  // Chargement d'une page
  'yc.er.load.timeoutTitle': ['This page is taking too long to {word}.', 'Cette page met trop de temps à {word}.', 'Esta página tarda demasiado en {word}.'],
  'yc.er.load.timeoutWord': ['respond', 'répondre', 'responder'],
  'yc.er.load.timeoutBody': ['Yuno got no answer in 30 seconds. This often comes from a slow or unstable connection. Your data hasn’t moved.', 'Yuno n’a pas reçu de réponse en 30 secondes. Cela vient souvent d’une connexion lente ou instable. Vos données n’ont pas bougé.', 'Yuno no recibió respuesta en 30 segundos. Suele deberse a una conexión lenta o inestable. Tus datos no se han movido.'],
  'yc.er.load.step1': ['Check your Wi-Fi or mobile network', 'Vérifiez votre Wi-Fi ou votre réseau mobile', 'Revisa tu Wi-Fi o tu red móvil'],
  'yc.er.load.step2': ['Try again in a moment', 'Réessayez dans un instant', 'Vuelve a intentarlo en un momento'],
  'yc.er.load.step3': ['Still stuck?', 'Toujours bloqué ?', '¿Sigues sin poder?'],
  'yc.er.load.ref': ['Ref.', 'Réf.', 'Ref.'],
  'yc.er.load.attempt': ['Attempt {n} of 3', 'Tentative {n} sur 3', 'Intento {n} de 3'],
  'yc.er.load.forbiddenTitle': ['You can’t see this {word}.', 'Vous ne pouvez pas voir {word}.', 'No puedes ver {word}.'],
  'yc.er.load.forbiddenWord': ['data', 'ces données', 'estos datos'],
  'yc.er.load.forbiddenBody': ['Your role doesn’t give access to it. Ask the owner of the space.', 'Votre rôle n’y donne pas accès. Demandez au titulaire de l’espace.', 'Tu rol no da acceso. Pregunta al titular del espacio.'],
  'yc.er.load.offlineTitle': ['No connection.', 'Pas de connexion.', 'Sin conexión.'],
  'yc.er.load.offlineBody': ['We can’t load this page without a network. It will retry when you’re back online.', 'Impossible de charger cette page sans réseau. Elle réessaiera au retour de la connexion.', 'No se puede cargar esta página sin red. Reintentará cuando vuelvas a estar conectado.'],
  'yc.er.load.genericTitle': ['This didn’t {word}.', 'Cela n’a pas pu {word}.', 'No se pudo {word}.'],
  'yc.er.load.genericWord': ['load', 'se charger', 'cargar'],
  'yc.er.load.genericBody': ['Something went wrong while loading. Nothing was lost; try again.', 'Un problème est survenu au chargement. Rien n’est perdu : réessayez.', 'Algo falló al cargar. No se ha perdido nada: inténtalo de nuevo.'],
};
export default dict;
