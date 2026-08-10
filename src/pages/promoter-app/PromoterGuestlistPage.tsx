import { ClipboardList } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { usePromoterData } from '@/contexts/PromoterDataContext';
import { PromoterPage, PromoHeading } from '@/components/promoter/promoter-app-shell';
import { PromoterGuestListTab } from '@/components/promoter/PromoterGuestListTab';
import { PromoEmpty } from '@/components/promoter/promoter-ui';

export default function PromoterGuestlistPage() {
  const { t, language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const { promoter, profiles, hasGuestListAccess } = usePromoterData();

  if (!promoter) return null;

  return (
    <PromoterPage maxWidth={860}>
      <PromoHeading
        title={t('promoterGuestlist.title')}
        subtitle={tt('Tes places allouées, soirée par soirée', 'Your allocated spots, event by event', 'Tus plazas asignadas, evento por evento')}
      />

      {hasGuestListAccess ? (
        <PromoterGuestListTab promoterProfiles={profiles.length ? profiles : [promoter]} />
      ) : (
        <PromoEmpty
          icon={ClipboardList}
          title={tt('Pas encore de guest list', 'No guest list yet', 'Aún sin guest list')}
          description={tt(
            'Aucune soirée rattachée ne t’ouvre la guest list pour le moment.',
            'No linked event gives you guest list access yet.',
            'Ningún evento vinculado te da acceso a la guest list todavía.',
          )}
        />
      )}
    </PromoterPage>
  );
}
