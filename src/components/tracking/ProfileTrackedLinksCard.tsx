/**
 * ProfileTrackedLinksCard — les liens suivis de la PAGE d'un organisateur
 * (profil public /o/<slug>), comme ceux d'une soirée et de la page d'un club.
 *
 * Un lien par réseau (Instagram, TikTok, Newsletter, WhatsApp) naît tout seul
 * (`seed_organizer_tracked_links`, migration 20261130130000), avec une adresse
 * lisible (« amoris-insta »). Clics, ventes et CA par lien ; le détail des
 * visites vit dans Analyses › Trafic › « Votre page organisateur ».
 */
import { Link } from 'react-router-dom';
import { Link2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { OrgCard, RED, T1, T3 } from '@/components/org-ui';
import TrackedLinksManager from './TrackedLinksManager';
import { tixRoutes } from '@/tickets/analytics/routes';

export function ProfileTrackedLinksCard({ organizerUserId, slug }: { organizerUserId: string; slug: string | null }) {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es: string) => translate(language, fr, en, es);
  return (
    <OrgCard className="mt-4">
      <div className="space-y-4 p-6">
        <div>
          <p style={{ color: T1, fontSize: 14, fontWeight: 600 }}>
            <Link2 className="mr-1.5 inline h-4 w-4" style={{ color: RED }} />
            {t('Liens suivis de ta page', 'Tracked links to your page', 'Enlaces de seguimiento de tu página')}
          </p>
          <p className="mt-1" style={{ color: T3, fontSize: 11.5, lineHeight: 1.5 }}>
            {t(
              'Un lien par réseau vers ta page publique : mets-le dans ta bio Instagram ou TikTok, ton groupe WhatsApp, ta newsletter. Chaque clic, et chaque achat qui suit, est rattaché au réseau. Le détail des visites est dans ',
              'One link per network to your public page: put it in your Instagram or TikTok bio, your WhatsApp group, your newsletter. Every click, and every purchase that follows, is credited to the network. Visit details are in ',
              'Un enlace por red hacia tu página pública: ponlo en tu bio de Instagram o TikTok, tu grupo de WhatsApp, tu newsletter. Cada clic, y cada compra que sigue, se atribuye a la red. El detalle de las visitas está en ',
            )}
            <Link to={tixRoutes('/organizer-app').traffic} style={{ color: RED, fontWeight: 600 }}>
              {t('Analyses › Trafic', 'Analytics › Traffic', 'Análisis › Tráfico')}
            </Link>
            .
          </p>
        </div>
        {slug ? (
          <TrackedLinksManager
            ownerKind="organizer"
            organizerUserId={organizerUserId}
            targetKind="organizer"
          />
        ) : (
          <p style={{ color: T3, fontSize: 12.5 }}>
            {t(
              'Enregistre d’abord le nom de ton organisation : tes liens pointeront sur ton adresse publique.',
              'Save your organization name first: your links will point to your public address.',
              'Guarda primero el nombre de tu organización: tus enlaces apuntarán a tu dirección pública.',
            )}
          </p>
        )}
      </div>
    </OrgCard>
  );
}
