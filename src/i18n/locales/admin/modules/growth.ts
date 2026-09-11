import type { AdminDict } from './types';

// Page « Croissance » (comptes, installs, audience) — [EN, FR, ES].
const dict: AdminDict = {
  'adm.growth.eyebrow': ['Steering', 'Pilotage', 'Pilotaje'],
  'adm.growth.title': ['Growth', 'Croissance', 'Crecimiento'],
  'adm.growth.subtitle': ['Accounts, app installs and web + app audience. Audience is anonymous (no cookie) and never counts you.', 'Comptes, installations de l’app et audience web + app. L’audience est anonyme (sans cookie) et ne te compte jamais.', 'Cuentas, instalaciones de la app y audiencia web + app. La audiencia es anónima (sin cookie) y nunca te cuenta.'],
  'adm.growth.accounts': ['Accounts & installs', 'Comptes & installs', 'Cuentas e instalaciones'],
  'adm.growth.totalAccounts': ['Accounts', 'Comptes', 'Cuentas'],
  'adm.growth.split': ['{c} clients · {p} pros', '{c} clients · {p} pros', '{c} clientes · {p} pros'],
  'adm.growth.new7': ['New, 7 d', 'Nouveaux, 7 j', 'Nuevos, 7 d'],
  'adm.growth.new30': ['New, 30 d', 'Nouveaux, 30 j', 'Nuevos, 30 d'],
  'adm.growth.vsPrev30': ['vs previous 30 d', 'vs 30 j précédents', 'vs 30 d anteriores'],
  'adm.growth.installs': ['App installs', 'Installations', 'Instalaciones'],
  'adm.growth.installsSplit': ['{c} Yuno · {p} Pro', '{c} Yuno · {p} Pro', '{c} Yuno · {p} Pro'],
  'adm.growth.activeDevices': ['Active devices, 7 d', 'Appareils actifs, 7 j', 'Dispositivos activos, 7 d'],
  'adm.growth.pushOn': ['Push enabled', 'Push activé', 'Push activado'],
  'adm.growth.chart': ['Sign-ups, installs & sessions', 'Inscriptions, installs & sessions', 'Registros, instalaciones y sesiones'],
  'adm.growth.chartHint': ['Per day, last 30 days. Sign-ups split client / pro.', 'Par jour, 30 derniers jours. Inscriptions client / pro.', 'Por día, últimos 30 días. Registros cliente / pro.'],
  'adm.growth.s.client': ['Client sign-ups', 'Inscriptions client', 'Registros cliente'],
  'adm.growth.s.pro': ['Pro sign-ups', 'Inscriptions pro', 'Registros pro'],
  'adm.growth.s.installs': ['Installs', 'Installs', 'Instalaciones'],
  'adm.growth.s.sessions': ['Sessions', 'Sessions', 'Sesiones'],
  'adm.growth.byMonth': ['Sign-ups by month', 'Inscriptions par mois', 'Registros por mes'],
  'adm.growth.ota': ['OTA adoption', 'Adoption OTA', 'Adopción OTA'],
  'adm.growth.otaLine': ['{n} of {d} devices on {v}', '{n} appareils sur {d} en {v}', '{n} de {d} dispositivos en {v}'],
  'adm.growth.audience': ['Audience', 'Audience', 'Audiencia'],
  'adm.growth.audienceNote': ['Sessions come from the cookie-less tracker (web + app). The super admin is excluded at write time; demo accounts browse like anyone else.', 'Les sessions viennent du tracker sans cookie (web + app). Le super admin est exclu à l’écriture ; les comptes démo naviguent comme tout le monde.', 'Las sesiones vienen del rastreador sin cookies (web + app). El super admin se excluye al escribir; las cuentas demo navegan como cualquiera.'],
  'adm.growth.app': ['app', 'app', 'app'],
};

export default dict;
