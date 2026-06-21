import { useLanguage } from '@/contexts/LanguageContext';
import { useDJData } from '@/contexts/DJDataContext';
import { DJEventLinks } from '@/components/dj/DJEventLinks';
import { DJPage, DJHeading } from '@/components/dj/dj-ui';

export default function DJAudience() {
  const { t } = useLanguage();
  const { dj } = useDJData();

  if (!dj) return null;

  return (
    <DJPage>
      <DJHeading title={t('dj.links.tab')} subtitle={t('dj.links.subtitle')} />
      <DJEventLinks />
    </DJPage>
  );
}
