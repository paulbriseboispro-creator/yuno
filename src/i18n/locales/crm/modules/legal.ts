import type { CrmDict } from './types';

// Conditions Yuno CRM et accord de sous-traitance : fenêtre d'acceptation du
// titulaire (CrmLegalGate), Réglages › Données « Vos documents » — [EN, FR, ES].
const dict: CrmDict = {
  'yc.legal.gate.t': ['Yuno CRM terms', 'Conditions de Yuno CRM', 'Condiciones de Yuno CRM'],
  'yc.legal.gate.s': [
    'Before you go on, please read and accept the terms that govern your account. You accept them once, on behalf of your organisation.',
    'Avant de continuer, merci de lire et d’accepter les conditions qui encadrent votre compte. Vous les acceptez une fois, au nom de votre structure.',
    'Antes de continuar, lea y acepte las condiciones que rigen su cuenta. Las acepta una vez, en nombre de su estructura.',
  ],
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
  'yc.legal.gate.accept1': ['I have read and accept, on behalf of my organisation, the', 'J’ai lu et j’accepte, au nom de ma structure, les', 'He leído y acepto, en nombre de mi estructura, las'],
  // Espaces comprises : le français colle « l’ » au lien qui suit.
  'yc.legal.gate.accept2': [' and the ', ' et l’', ' y el '],
  'yc.legal.gate.accept3': ['.', '.', '.'],
  'yc.legal.gate.cta': ['Accept and continue', 'Accepter et continuer', 'Aceptar y continuar'],
  'yc.legal.doc.terms': ['Yuno CRM Terms', 'Conditions Yuno CRM', 'Condiciones de Yuno CRM'],
  'yc.legal.doc.dpa': ['Data Processing Agreement', 'Accord de sous-traitance des données', 'Acuerdo de encargo del tratamiento'],
  'yc.legal.doc.template': ['Notice template for your customers', 'Modèle d’information pour vos clients', 'Modelo de información para sus clientes'],
  'yc.legal.doc.privacy': ['Yuno privacy policy', 'Politique de confidentialité de Yuno', 'Política de privacidad de Yuno'],
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
