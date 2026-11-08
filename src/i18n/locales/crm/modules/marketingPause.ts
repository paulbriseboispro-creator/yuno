import type { CrmDict } from './types';

// Yuno CRM en mode « analyse seule » (pause du 2026-11-08) : les envois sont
// coupés côté serveur (platform_pause), la Console le dit. [EN, FR, ES].
const dict: CrmDict = {
  'yc.pause.title': ['Sending is paused', 'Les envois sont en pause', 'Los envíos están en pausa'],
  'yc.pause.body': [
    'Yuno CRM is focused on analytics for now: your nights, sales, traffic, community and clients stay up to date. Emails and SMS will come back later.',
    'Yuno CRM se concentre sur l’analyse pour le moment : vos soirées, ventes, trafic, communauté et clients restent à jour. Les e-mails et les SMS reviendront plus tard.',
    'Por ahora Yuno CRM se centra en el análisis: sus noches, ventas, tráfico, comunidad y clientes siguen al día. Los e-mails y los SMS volverán más adelante.',
  ],
  'yc.pause.ok': ['Got it', 'Compris', 'Entendido'],
};
export default dict;
