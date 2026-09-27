// Textes de la barre et du dialogue « Crée ton compte » de la démo.
// Comme PreviewGate et PreviewModeBanner, la surface d'aperçu vit hors du
// dictionnaire t() : elle doit parler la langue du LIEN dès la première frame,
// avant que LanguageContext ne resynchronise la langue du compte démo.

import type { DemoSignupError, DemoSignupKind } from '@/lib/demoSignup';

export type DemoLang = 'en' | 'fr' | 'es';

export function demoLang(l: string | undefined | null): DemoLang {
  return l === 'fr' || l === 'es' ? l : 'en';
}

interface Copy {
  console: Record<DemoSignupKind, string>;
  orgLabel: Record<DemoSignupKind, string>;
  fallbackOrg: Record<DemoSignupKind, string>;
  barTitle: (first: string, org: string) => string;
  barSub: (kind: DemoSignupKind) => string;
  barCta: (org: string) => string;
  barCtaShort: string;
  barCreatedTitle: (org: string) => string;
  barCreatedSub: string;
  barCreatedCta: string;
  pillCta: string;
  title: (org: string) => string;
  lead: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  passwordHint: string;
  show: string;
  hide: string;
  support: string;
  legalPre: string;
  legalTerms: string;
  legalMid: string;
  legalPrivacy: string;
  submit: string;
  submitting: string;
  existsNotice: (email: string, org: string) => string;
  existsSubmit: (org: string) => string;
  forgot: string;
  otherEmail: string;
  confirmTitle: string;
  confirmBody: (email: string) => string;
  startsEmpty: string;
  errors: Record<DemoSignupError | 'required', string>;
}

export const DEMO_SIGNUP_COPY: Record<DemoLang, Copy> = {
  fr: {
    console: { club: 'Console Club', organizer: 'Console Organisateur' },
    orgLabel: { club: 'Nom du club', organizer: "Nom de l'organisation" },
    fallbackOrg: { club: 'ton club', organizer: 'ton organisation' },
    barTitle: (first, org) => `${first ? `${first}, ` : ''}on a préparé le compte de ${org}.`,
    barSub: (kind) => kind === 'club'
      ? 'Tout ce que tu vois dans cette démo, pour tes soirées : billets, tables VIP, guest list, bar. Ouverture en 1 minute.'
      : 'Tout ce que tu vois dans cette démo, pour tes soirées : billets, tables VIP, guest list. Ouverture en 1 minute.',
    barCta: (org) => `Ouvrir le compte ${org}`,
    barCtaShort: 'Créer mon compte',
    barCreatedTitle: (org) => `Le compte ${org} est ouvert.`,
    barCreatedSub: 'Connecte-toi pour retrouver ta Console.',
    barCreatedCta: 'Aller sur mon compte',
    pillCta: 'Créer mon compte',
    title: (org) => `Ouvre le compte de ${org}`,
    lead: 'Tout est pré-rempli. Choisis ton mot de passe : tu arrives dans ta Console, avec le plan de ta première soirée.',
    firstName: 'Prénom',
    lastName: 'Nom',
    email: 'Email',
    password: 'Mot de passe',
    passwordHint: '8 caractères minimum.',
    show: 'Afficher',
    hide: 'Masquer',
    support: "L'équipe Yuno peut entrer dans mon compte pour m'aider à le configurer (je peux couper cet accès quand je veux).",
    legalPre: "J'accepte les",
    legalTerms: "Conditions d'utilisation",
    legalMid: 'et la',
    legalPrivacy: 'Politique de confidentialité',
    submit: 'Créer mon compte',
    submitting: 'Ouverture de ton compte…',
    existsNotice: (email, org) => `Un compte Yuno existe déjà avec ${email}. Saisis ton mot de passe Yuno : ${org} y sera ajouté.`,
    existsSubmit: (org) => `Me connecter et ouvrir ${org}`,
    forgot: 'Mot de passe oublié ?',
    otherEmail: 'Utiliser un autre email',
    confirmTitle: 'Vérifie ta boîte mail',
    confirmBody: (email) => `On a envoyé un lien à ${email}. Clique dessus : ton compte s'ouvre tout seul.`,
    startsEmpty: 'Rien de la démo n\'est copié : ton compte démarre vierge, prêt pour tes soirées.',
    errors: {
      required: 'Remplis le prénom, le nom de la structure, l\'email et le mot de passe.',
      exists: 'Un compte existe déjà avec cet email.',
      wrong_password: 'Mot de passe incorrect.',
      weak_password: 'Mot de passe trop faible : 8 caractères minimum, lettres et chiffres.',
      invalid_email: "Cet email n'est pas valide.",
      confirm_email: 'Confirme ton email avec le lien reçu, puis reconnecte-toi.',
      demo_account: "Utilise ton email à toi, pas celui d'un compte démo.",
      already_used: 'Ce compte a déjà été ouvert avec un autre email. Connecte-toi avec celui-là.',
      rate_limited: "Trop d'essais d'affilée. Réessaie dans une minute.",
      unknown: "Ça n'a pas marché. Réessaie — si ça bloque encore, écris-nous.",
    },
  },
  en: {
    console: { club: 'Club Console', organizer: 'Organizer Console' },
    orgLabel: { club: 'Club name', organizer: 'Organization name' },
    fallbackOrg: { club: 'your club', organizer: 'your organization' },
    barTitle: (first, org) => `${first ? `${first}, ` : ''}we've set up an account for ${org}.`,
    barSub: (kind) => kind === 'club'
      ? 'Everything in this demo, for your own nights: tickets, VIP tables, guest list, bar. Ready in 1 minute.'
      : 'Everything in this demo, for your own nights: tickets, VIP tables, guest list. Ready in 1 minute.',
    barCta: (org) => `Open the ${org} account`,
    barCtaShort: 'Create my account',
    barCreatedTitle: (org) => `The ${org} account is open.`,
    barCreatedSub: 'Sign in to get back to your Console.',
    barCreatedCta: 'Go to my account',
    pillCta: 'Create my account',
    title: (org) => `Open the ${org} account`,
    lead: "Everything is pre-filled. Pick a password: you'll land in your Console with a plan for your first night.",
    firstName: 'First name',
    lastName: 'Last name',
    email: 'Email',
    password: 'Password',
    passwordHint: 'At least 8 characters.',
    show: 'Show',
    hide: 'Hide',
    support: 'The Yuno team may access my account to help me set it up (I can turn this off anytime).',
    legalPre: 'I accept the',
    legalTerms: 'Terms of Use',
    legalMid: 'and the',
    legalPrivacy: 'Privacy Policy',
    submit: 'Create my account',
    submitting: 'Opening your account…',
    existsNotice: (email, org) => `A Yuno account already exists for ${email}. Enter your Yuno password and ${org} will be added to it.`,
    existsSubmit: (org) => `Sign in and open ${org}`,
    forgot: 'Forgot your password?',
    otherEmail: 'Use another email',
    confirmTitle: 'Check your inbox',
    confirmBody: (email) => `We sent a link to ${email}. Click it and your account opens automatically.`,
    startsEmpty: 'Nothing from the demo is copied: your account starts clean, ready for your nights.',
    errors: {
      required: 'Fill in your first name, organization name, email and password.',
      exists: 'An account already exists with this email.',
      wrong_password: 'Incorrect password.',
      weak_password: 'Password too weak: at least 8 characters, letters and numbers.',
      invalid_email: "This email isn't valid.",
      confirm_email: 'Confirm your email with the link we sent, then sign in again.',
      demo_account: 'Use your own email, not a demo account.',
      already_used: 'This account was already opened with another email. Sign in with that one.',
      rate_limited: 'Too many attempts. Try again in a minute.',
      unknown: "That didn't work. Try again — if it still fails, write to us.",
    },
  },
  es: {
    console: { club: 'Consola Club', organizer: 'Consola Organizador' },
    orgLabel: { club: 'Nombre del club', organizer: 'Nombre de la organización' },
    fallbackOrg: { club: 'tu club', organizer: 'tu organización' },
    barTitle: (first, org) => `${first ? `${first}, ` : ''}hemos preparado la cuenta de ${org}.`,
    barSub: (kind) => kind === 'club'
      ? 'Todo lo que ves en esta demo, para tus noches: entradas, mesas VIP, guest list, barra. Lista en 1 minuto.'
      : 'Todo lo que ves en esta demo, para tus noches: entradas, mesas VIP, guest list. Lista en 1 minuto.',
    barCta: (org) => `Abrir la cuenta de ${org}`,
    barCtaShort: 'Crear mi cuenta',
    barCreatedTitle: (org) => `La cuenta de ${org} está abierta.`,
    barCreatedSub: 'Inicia sesión para volver a tu Consola.',
    barCreatedCta: 'Ir a mi cuenta',
    pillCta: 'Crear mi cuenta',
    title: (org) => `Abre la cuenta de ${org}`,
    lead: 'Todo está rellenado. Elige tu contraseña: llegarás a tu Consola con el plan de tu primera noche.',
    firstName: 'Nombre',
    lastName: 'Apellido',
    email: 'Email',
    password: 'Contraseña',
    passwordHint: 'Mínimo 8 caracteres.',
    show: 'Mostrar',
    hide: 'Ocultar',
    support: 'El equipo de Yuno puede entrar en mi cuenta para ayudarme a configurarla (puedo cortar este acceso cuando quiera).',
    legalPre: 'Acepto las',
    legalTerms: 'Condiciones de uso',
    legalMid: 'y la',
    legalPrivacy: 'Política de privacidad',
    submit: 'Crear mi cuenta',
    submitting: 'Abriendo tu cuenta…',
    existsNotice: (email, org) => `Ya existe una cuenta Yuno con ${email}. Introduce tu contraseña de Yuno y se le añadirá ${org}.`,
    existsSubmit: (org) => `Iniciar sesión y abrir ${org}`,
    forgot: '¿Olvidaste tu contraseña?',
    otherEmail: 'Usar otro email',
    confirmTitle: 'Revisa tu correo',
    confirmBody: (email) => `Hemos enviado un enlace a ${email}. Haz clic y tu cuenta se abrirá sola.`,
    startsEmpty: 'No se copia nada de la demo: tu cuenta empieza en blanco, lista para tus noches.',
    errors: {
      required: 'Rellena tu nombre, el nombre de la organización, el email y la contraseña.',
      exists: 'Ya existe una cuenta con este email.',
      wrong_password: 'Contraseña incorrecta.',
      weak_password: 'Contraseña demasiado débil: mínimo 8 caracteres, letras y números.',
      invalid_email: 'Este email no es válido.',
      confirm_email: 'Confirma tu email con el enlace recibido y vuelve a iniciar sesión.',
      demo_account: 'Usa tu propio email, no el de una cuenta demo.',
      already_used: 'Esta cuenta ya se abrió con otro email. Inicia sesión con ese.',
      rate_limited: 'Demasiados intentos. Vuelve a intentarlo en un minuto.',
      unknown: 'No ha funcionado. Inténtalo de nuevo — si sigue fallando, escríbenos.',
    },
  },
};
