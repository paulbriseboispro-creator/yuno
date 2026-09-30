/**
 * Sources et Campagnes arrivent avec le tunnel (phase 2). L'onglet existe déjà
 * pour dire POURQUOI il est vide et ce qui y apparaîtra — jamais un onglet mort.
 */
import { useLanguage } from '@/contexts/LanguageContext';
import { A3Card, A3Label } from '../an3Ui';
import { A3 } from '../an3Tokens';

export function PhaseTwoTab({ kind }: { kind: 'sources' | 'campaigns' }) {
  const { t } = useLanguage();
  const items = kind === 'sources'
    ? ['funnel', 'sourcesTable', 'yunoBrought', 'redirect']
    : ['perCampaign', 'clicksToOrders', 'openPartial'];
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <A3Card title={t(`an3.p2.${kind}.title`)} minHeight={220}>
        <p className="m-0 text-[13px] leading-relaxed" style={{ color: A3.t2 }}>{t(`an3.p2.${kind}.why`)}</p>
        <p className="m-0 mt-3 text-[13px] leading-relaxed" style={{ color: A3.t2 }}>{t('an3.p2.when')}</p>
      </A3Card>
      <A3Card title={t('an3.p2.willShow')} minHeight={220}>
        <ul className="m-0 p-0 list-none flex flex-col gap-2.5">
          {items.map((k) => (
            <li key={k} className="flex items-start gap-2.5 text-[13px]" style={{ color: A3.t1 }}>
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: A3.accent }} />
              <span><A3Label className="block mb-0.5">{t(`an3.p2.${kind}.${k}.label`)}</A3Label>{t(`an3.p2.${kind}.${k}.body`)}</span>
            </li>
          ))}
        </ul>
      </A3Card>
    </div>
  );
}
