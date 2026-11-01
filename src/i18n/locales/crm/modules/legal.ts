import type { CrmDict } from './types';

// Conditions Yuno CRM, accord de sous-traitance et politique de confidentialité :
// écran d'acceptation du titulaire (CrmLegalGate), Réglages › Données « Vos documents » — [EN, FR, ES].
const dict: CrmDict = {
  'yc.legal.gate.t': ['Yuno CRM terms', 'Conditions de Yuno CRM', 'Condiciones de Yuno CRM'],
  'yc.legal.gate.p1': [
    'You remain responsible for your customers’ data. Yuno processes it on your behalf and never sells it.',
    'Vous restez responsable des données de vos clients. Yuno les traite pour votre compte et ne les vend jamais.',
    'Usted sigue siendo responsable de los datos de sus clientes. Yuno los trata por cuenta suya y nunca los vende.',
  ],
  'yc.legal.gate.p2': [
    '“What brings them” and “Chance of coming” are estimates computed on your data only, to help you choose who to write to.',
    '« Ce qui fait venir » et « Chances de venir » sont des estimations calculées sur vos seules données, pour vous aider à choisir à qui écrire.',
    '«Lo que les hace venir» y «Probabilidad de venir» son estimaciones calculadas solo con sus datos, para ayudarle a elegir a quién escribir.',
  ],
  'yc.legal.gate.p3': [
    'Only anonymous counts may leave your account to improve the analysis, and you can refuse in Settings › Data.',
    'Seuls des comptages anonymes peuvent sortir de votre compte pour améliorer l’analyse, et vous pouvez le refuser dans Réglages › Données.',
    'Solo pueden salir de su cuenta recuentos anónimos para mejorar el análisis, y puede negarse en Ajustes › Datos.',
  ],
  'yc.legal.gate.kicker': ['Yuno CRM · Last step', 'Yuno CRM · Dernière étape', 'Yuno CRM · Último paso'],
  // {w} = le mot mis en couleur (yc.legal.gate.hw).
  'yc.legal.gate.h': ['One last step before {w}', 'Une dernière étape avant {w}', 'Un último paso antes de {w}'],
  'yc.legal.gate.hw': ['your workspace', 'votre espace', 'su espacio'],
  'yc.legal.gate.sub': [
    'Your account is created. Read the documents on the right and accept them all at once: a single gesture, made once on behalf of your organisation.',
    'Votre compte est créé. Lisez les documents ci-contre et acceptez-les tous d’un seul geste : une fois, au nom de votre structure.',
    'Su cuenta está creada. Lea los documentos de al lado y acéptelos todos de una vez: un solo gesto, una única vez, en nombre de su estructura.',
  ],
  'yc.legal.gate.ess': ['The essentials, in plain words', 'L’essentiel, en clair', 'Lo esencial, en claro'],
  'yc.legal.gate.d.terms': [
    'The rules of use of Yuno CRM: your account, your sends and what each side commits to.',
    'Les règles d’usage de Yuno CRM : votre compte, vos envois et ce que chacun s’engage à faire.',
    'Las reglas de uso de Yuno CRM: su cuenta, sus envíos y lo que se compromete cada parte.',
  ],
  'yc.legal.gate.d.dpa': [
    'How Yuno handles your customers’ data on your behalf, and what you must tell them.',
    'Comment Yuno traite les données de vos clients pour votre compte, et ce que vous devez leur dire.',
    'Cómo trata Yuno los datos de sus clientes por cuenta suya y qué debe comunicarles.',
  ],
  'yc.legal.gate.d.privacy': [
    'What Yuno collects about you, why, for how long, and how to exercise your rights.',
    'Ce que Yuno collecte sur vous, pourquoi, combien de temps, et comment exercer vos droits.',
    'Lo que Yuno recopila sobre usted, por qué, durante cuánto tiempo y cómo ejercer sus derechos.',
  ],
  'yc.legal.gate.d.marketing': [
    'You only write to people who agreed to hear from you. An email opt-in doesn’t cover SMS, and every message carries its unsubscribe link or STOP.',
    'Vous n’écrivez qu’aux personnes qui ont donné leur accord. L’accord e-mail ne vaut pas pour le SMS, et chaque message porte son lien de désinscription ou son STOP.',
    'Solo escribe a quienes han dado su consentimiento. El de e-mail no vale para SMS, y cada mensaje incluye su baja o su STOP.',
  ],
  'yc.legal.gate.read': ['Read', 'Lire', 'Leer'],
  'yc.legal.gate.org': ['my organisation', 'ma structure', 'mi estructura'],
  // {w} = le nom de l'espace (ou « ma structure »).
  'yc.legal.gate.all': [
    'I have read and accept these documents, on behalf of {w}.',
    'J’ai lu et j’accepte ces documents, au nom de {w}.',
    'He leído y acepto estos documentos, en nombre de {w}.',
  ],
  'yc.legal.gate.proof': [
    'One acceptance covers them all. It is recorded with the date and the version of each text.',
    'Une seule acceptation pour tous. Elle est enregistrée avec la date et la version de chaque texte.',
    'Una sola aceptación para todos. Se registra con la fecha y la versión de cada texto.',
  ],
  'yc.legal.gate.busy': ['Saving…', 'Enregistrement…', 'Guardando…'],
  'yc.legal.gate.done': ['Noted. Welcome!', 'C’est noté. Bienvenue !', 'Anotado. ¡Bienvenido!'],
  'yc.legal.gate.out': ['Sign out', 'Se déconnecter', 'Cerrar sesión'],
  'yc.legal.gate.cta': ['Accept and continue', 'Accepter et continuer', 'Aceptar y continuar'],
  'yc.legal.gate.fail': ['Your acceptance wasn’t saved (connection problem). Try again: until it is, no email can be sent from Yuno CRM.', 'Votre accord n’a pas été enregistré (problème de connexion). Réessayez : tant qu’il ne l’est pas, aucun e-mail ne peut partir de Yuno CRM.', 'Su aceptación no se guardó (problema de conexión). Inténtelo de nuevo: mientras no se guarde, ningún e-mail puede salir de Yuno CRM.'],
  'yc.legal.gate.later': ['Later', 'Plus tard', 'Más tarde'],
  'yc.legal.doc.terms': ['Yuno CRM Terms', 'Conditions Yuno CRM', 'Condiciones de Yuno CRM'],
  'yc.legal.doc.dpa': ['Data Processing Agreement', 'Accord de sous-traitance des données', 'Acuerdo de encargo del tratamiento'],
  'yc.legal.doc.marketing': ['Marketing agreement', 'Accord marketing', 'Acuerdo de marketing'],
  'yc.legal.doc.template': ['Notice template for your customers', 'Modèle d’information pour vos clients', 'Modelo de información para sus clientes'],
  'yc.legal.doc.privacy': ['Yuno privacy policy', 'Politique de confidentialité de Yuno', 'Política de privacidad de Yuno'],
  'yc.legal.back': ['Back', 'Retour', 'Volver'],
  'yc.legal.docs': ['Legal documents', 'Documents légaux', 'Documentos legales'],
  'yc.legal.docs.t': ['Your documents', 'Vos documents', 'Sus documentos'],
  'yc.legal.docs.s': [
    'The texts that govern your account and your customers’ data. The notice template, at the end of the Terms, tells your customers what you do with their data.',
    'Les textes qui encadrent votre compte et les données de vos clients. Le modèle d’information, à la fin des Conditions, dit à vos clients ce que vous faites de leurs données.',
    'Los textos que rigen su cuenta y los datos de sus clientes. El modelo de información, al final de las Condiciones, explica a sus clientes qué hace con sus datos.',
  ],
  // Aide (Compte › Aide) : ce que le pro doit dire à ses clients.
  'yc.faq.legal.q': ['What must I tell my customers about their data?', 'Que dois-je dire à mes clients sur leurs données ?', '¿Qué debo decir a mis clientes sobre sus datos?'],
  'yc.faq.legal.a': [
    'You are responsible for your customers’ data: tell them what you do with it, including the analysis of their purchases, and that they can object. A ready-to-adapt text sits at the end of the Yuno CRM Terms (Settings → Data → Your documents). Publish it in your privacy policy and on your sign-up pages, and link it in your emails. If someone refuses the analysis, open their card and click “Exclude from profiling”.',
    'Vous êtes responsable des données de vos clients : dites-leur ce que vous en faites, y compris l’analyse de leurs achats, et qu’ils peuvent s’y opposer. Un texte prêt à adapter figure à la fin des Conditions Yuno CRM (Réglages → Données → Vos documents). Publiez-le dans votre politique de confidentialité et sur vos pages d’inscription, et mettez-le en lien dans vos e-mails. Si quelqu’un refuse l’analyse, ouvrez sa fiche et cliquez « Exclure du profilage ».',
    'Usted es responsable de los datos de sus clientes: dígales qué hace con ellos, incluido el análisis de sus compras, y que pueden oponerse. Al final de las Condiciones de Yuno CRM hay un texto listo para adaptar (Ajustes → Datos → Sus documentos). Publíquelo en su política de privacidad y en sus páginas de registro, y enlácelo en sus e-mails. Si alguien rechaza el análisis, abra su ficha y pulse «Excluir del perfilado».',
  ],
  'yc.faq.legal.l': ['See your documents', 'Voir vos documents', 'Ver sus documentos'],
};

export default dict;
