import { useLanguage } from '@/contexts/LanguageContext';
import { useDJData } from '@/contexts/DJDataContext';
import { DJCalendar } from '@/components/dj/DJCalendar';
import { DJPage, DJHeading } from '@/components/dj/dj-ui';

export default function DJPlanning() {
  const { t } = useLanguage();
  const { dj, sets } = useDJData();

  if (!dj) return null;

  return (
    <DJPage>
      <DJHeading title={t('dj.mySchedule')} subtitle={dj.venue?.name} />
      <DJCalendar
        sets={sets.map(s => ({ ...s, dj: { first_name: dj.first_name, last_name: dj.last_name, stage_name: dj.stage_name } }))}
        showDJNames={false}
      />
    </DJPage>
  );
}
