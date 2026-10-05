import type { CrmDict } from './types';

// Connexion de Yuno CRM (crm.yunoapp.eu/login) — [EN, FR, ES].
// `{w}` marque le mot passé au dégradé dans un titre.
const dict: CrmDict = {
  'yc.lg.docTitle': ['Sign in · Yuno CRM', 'Connexion · Yuno CRM', 'Iniciar sesión · Yuno CRM'],
  'yc.lg.badge': ['Yuno CRM', 'Yuno CRM', 'Yuno CRM'],
  'yc.lg.kicker': ['Yuno CRM · Sign in', 'Yuno CRM · Connexion', 'Yuno CRM · Acceso'],
  'yc.lg.title': ['Good to see you {w}.', 'Ravi de vous {w}.', 'Qué gusto {w} de nuevo.'],
  'yc.lg.titleW': ['again', 'revoir', 'verle'],
  'yc.lg.sub': [
    'Sign in to your Yuno CRM console: your contacts, your nights, your campaigns.',
    'Connectez-vous à votre Console Yuno CRM : vos contacts, vos soirées, vos campagnes.',
    'Inicie sesión en su Consola Yuno CRM: sus contactos, sus noches, sus campañas.',
  ],
  'yc.lg.google': ['Continue with Google', 'Continuer avec Google', 'Continuar con Google'],
  'yc.lg.apple': ['Continue with Apple', 'Continuer avec Apple', 'Continuar con Apple'],
  'yc.lg.or': ['or', 'ou', 'o'],
  'yc.lg.email': ['Email', 'E-mail', 'Correo electrónico'],
  'yc.lg.password': ['Password', 'Mot de passe', 'Contraseña'],
  'yc.lg.forgot': ['Forgot your password?', 'Mot de passe oublié ?', '¿Ha olvidado su contraseña?'],
  'yc.lg.submit': ['Sign in', 'Se connecter', 'Iniciar sesión'],
  'yc.lg.busy': ['Signing in…', 'Connexion…', 'Entrando…'],
  'yc.lg.err.bad': ['Wrong email or password.', 'E-mail ou mot de passe incorrect.', 'Correo o contraseña incorrectos.'],
  'yc.lg.err.unconfirmed': [
    'Confirm your email first: the link is in your inbox.',
    'Confirmez d’abord votre e-mail : le lien est dans votre boîte de réception.',
    'Confirme primero su correo: el enlace está en su bandeja de entrada.',
  ],
  'yc.lg.err.rate': [
    'Too many attempts. Wait a minute, then try again.',
    'Trop de tentatives. Attendez une minute, puis réessayez.',
    'Demasiados intentos. Espere un minuto y vuelva a intentarlo.',
  ],
  'yc.lg.err.generic': [
    'Sign-in failed. Try again in a moment.',
    'La connexion a échoué. Réessayez dans un instant.',
    'No se pudo iniciar sesión. Inténtelo de nuevo en un momento.',
  ],
  'yc.lg.noAccount': ['No account yet?', 'Pas encore de compte ?', '¿Aún no tiene cuenta?'],
  'yc.lg.trial': ['Try Yuno CRM free for 14 days', 'Essayer Yuno CRM 14 jours gratuits', 'Pruebe Yuno CRM 14 días gratis'],
  'yc.lg.ticketing': ['Selling tickets with Yuno?', 'Vous vendez vos billets avec Yuno ?', '¿Vende sus entradas con Yuno?'],
  'yc.lg.ticketingLink': ['Yuno Ticketing signs in on yunoapp.eu', 'Yuno Billetterie se connecte sur yunoapp.eu', 'Yuno Ticketing inicia sesión en yunoapp.eu'],

  // Mot de passe oublié
  'yc.lg.fg.title': ['Forgotten {w}?', 'Mot de passe {w} ?', '¿Contraseña {w}?'],
  'yc.lg.fg.titleW': ['password', 'oublié', 'olvidada'],
  'yc.lg.fg.sub': [
    'Enter your email: we send you a link to choose a new password.',
    'Indiquez votre e-mail : nous vous envoyons un lien pour choisir un nouveau mot de passe.',
    'Escriba su correo: le enviamos un enlace para elegir una nueva contraseña.',
  ],
  'yc.lg.fg.send': ['Send the link', 'Envoyer le lien', 'Enviar el enlace'],
  'yc.lg.fg.back': ['Back to sign-in', 'Retour à la connexion', 'Volver al inicio de sesión'],
  'yc.lg.sent.title': ['Check your {w}.', 'Regardez vos {w}.', 'Revise su {w}.'],
  'yc.lg.sent.titleW': ['inbox', 'e-mails', 'correo'],
  'yc.lg.sent.body': [
    'If an account exists for {email}, a link to choose a new password is on its way. It stays valid for one hour.',
    'Si un compte existe pour {email}, un lien pour choisir un nouveau mot de passe est en route. Il reste valable une heure.',
    'Si existe una cuenta para {email}, va de camino un enlace para elegir una nueva contraseña. Es válido durante una hora.',
  ],

  // Nouveau mot de passe (lien reçu par e-mail)
  'yc.lg.rc.title': ['Choose a new {w}.', 'Choisissez un nouveau {w}.', 'Elija una nueva {w}.'],
  'yc.lg.rc.titleW': ['password', 'mot de passe', 'contraseña'],
  'yc.lg.rc.sub': [
    'At least 8 characters. You stay signed in afterwards.',
    'Au moins 8 caractères. Vous restez connecté ensuite.',
    'Al menos 8 caracteres. Seguirá conectado después.',
  ],
  'yc.lg.rc.new': ['New password', 'Nouveau mot de passe', 'Nueva contraseña'],
  'yc.lg.rc.confirm': ['Confirm it', 'Confirmez-le', 'Confírmela'],
  'yc.lg.rc.save': ['Save and continue', 'Enregistrer et continuer', 'Guardar y continuar'],
  'yc.lg.rc.short': ['8 characters minimum.', '8 caractères minimum.', 'Mínimo 8 caracteres.'],
  'yc.lg.rc.mismatch': ['The two passwords differ.', 'Les deux mots de passe diffèrent.', 'Las dos contraseñas no coinciden.'],
  'yc.lg.rc.expired': [
    'This link has expired or was already used. Ask for a new one.',
    'Ce lien a expiré ou a déjà servi. Demandez-en un nouveau.',
    'Este enlace ha caducado o ya se usó. Pida uno nuevo.',
  ],
};

export default dict;
