import type { AdminDict } from './types';

// Admin CRM — fin de build (durées de synchro, activité, e-mails du cycle de vie,
// tiroir client, comptes cibles, essai, prix, mesures, NPS, incidents) — [EN, FR, ES].
const dict: AdminDict = {
  // Plateforme › durée d'une synchro
  'adm.crm.pf.k.dur': ['Sync duration · 30 d', 'Durée d’une synchro · 30 j', 'Duración de una sincronización · 30 d'],
  'adm.crm.pf.k.durSub': ['median · 95th percentile {p95}', 'médiane · 95e centile {p95}', 'mediana · percentil 95 {p95}'],
  'adm.crm.pf.k.durNone': ['no finished sync yet', 'aucune synchro terminée pour l’instant', 'aún ninguna sincronización terminada'],
  'adm.crm.pf.k.durOpen': ['{n} abandoned (end unknown, not counted)', '{n} abandonnée(s) (fin inconnue, non comptée)', '{n} abandonada(s) (fin desconocida, no contada)'],

  // Pilotage › Activité en direct
  'adm.crm.nav.cockpitAll': ['Overview', 'Vue d’ensemble', 'Vista general'],
  'adm.crm.nav.cockpitLive': ['Live activity', 'Activité en direct', 'Actividad en directo'],
  'adm.crm.act.title': ['What is happening on Yuno CRM', 'Ce qui se passe sur Yuno CRM', 'Lo que pasa en Yuno CRM'],
  'adm.crm.act.sub': ['Last 14 days, refreshed every 30 s · {live} sign-up(s) in progress', '14 derniers jours, rafraîchi toutes les 30 s · {live} inscription(s) en cours', 'Últimos 14 días, actualizado cada 30 s · {live} alta(s) en curso'],
  'adm.crm.act.none': ['Nothing in the last 14 days.', 'Rien sur les 14 derniers jours.', 'Nada en los últimos 14 días.'],
  'adm.crm.act.f.all': ['All', 'Tout', 'Todo'],
  'adm.crm.act.f.signup': ['Sign-ups', 'Inscriptions', 'Altas'],
  'adm.crm.act.f.buy': ['Purchases', 'Achats', 'Compras'],
  'adm.crm.act.f.send': ['First sends', 'Premiers envois', 'Primeros envíos'],
  'adm.crm.act.f.fail': ['Problems', 'Problèmes', 'Problemas'],
  'adm.crm.act.f.admin': ['Admin actions', 'Gestes admin', 'Acciones admin'],
  'adm.crm.act.direct': ['direct', 'direct', 'directo'],
  'adm.crm.act.signupLive': ['Sign-up in progress · step “{step}” · {src}', 'Inscription en cours · étape « {step} » · {src}', 'Alta en curso · paso «{step}» · {src}'],
  'adm.crm.act.signupDropped': ['Sign-up stopped at “{step}”', 'Inscription arrêtée à « {step} »', 'Alta detenida en «{step}»'],
  'adm.crm.act.account': ['Account created · {src}', 'Compte créé · {src}', 'Cuenta creada · {src}'],
  'adm.crm.act.accountIn': ['Account created in {dur} · {src}', 'Compte créé en {dur} · {src}', 'Cuenta creada en {dur} · {src}'],
  'adm.crm.act.buy': ['Bought {y} Yunits · {eur} excl. VAT', 'Achat de {y} Yunits · {eur} HT', 'Compra de {y} Yunits · {eur} sin IVA'],
  'adm.crm.act.firstSend': ['First e-mail sent: “{name}” to {n} people', 'Premier e-mail envoyé : « {name} » à {n} personnes', 'Primer e-mail enviado: «{name}» a {n} personas'],
  'adm.crm.act.fail': ['Ticketing sync failed · {error}', 'Synchro de la billetterie en échec · {error}', 'Sincronización de la ticketera fallida · {error}'],
  'adm.crm.act.status.error': ['error', 'erreur', 'error'],
  'adm.crm.act.status.abandoned': ['stopped without finishing', 'arrêtée sans finir', 'detenida sin terminar'],
  'adm.crm.act.tag.live': ['Live', 'En direct', 'En directo'],
  'adm.crm.act.tag.dropped': ['Dropped', 'Abandon', 'Abandono'],
  'adm.crm.act.tag.created': ['New account', 'Nouveau compte', 'Nueva cuenta'],
  'adm.crm.act.tag.paid': ['Paid', 'Payé', 'Pagado'],
  'adm.crm.act.tag.problem': ['To check', 'À vérifier', 'A revisar'],
  'adm.crm.act.admin.crm_grant_yunits': ['Yunits offered', 'Yunits offerts', 'Yunits regalados'],
  'adm.crm.act.admin.crm_extend_trial': ['Trial extended', 'Essai prolongé', 'Prueba ampliada'],
  'adm.crm.act.admin.crm_freeze_sending': ['Sending frozen', 'Envoi gelé', 'Envío congelado'],
  'adm.crm.act.admin.crm_unfreeze_sending': ['Sending unfrozen', 'Envoi dégelé', 'Envío descongelado'],
};
export default dict;
