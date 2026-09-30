/** Les sept sous-onglets (1-2 mots) + le bouton « Ce soir ». */
import { AN3_TABS, type An3Tab } from '@/lib/analytics/an3Nav';
import { useLanguage } from '@/contexts/LanguageContext';
import { A3 } from './an3Tokens';

export function TabsNav({ tab, onChange, liveNow = false }: { tab: An3Tab; onChange: (t: An3Tab) => void; liveNow?: boolean }) {
  const { t } = useLanguage();
  return (
    <div className="flex items-center gap-2">
      <nav className="flex-1 min-w-0 overflow-x-auto -mx-1 px-1" aria-label={t('an3.tabs.aria')}>
        <ul className="m-0 p-0 list-none flex items-center gap-1 w-max">
          {AN3_TABS.map((k) => {
            const active = tab === k;
            return (
              <li key={k}>
                <button type="button" onClick={() => onChange(k)} aria-current={active ? 'page' : undefined}
                  className="rounded-full px-3.5 py-2 text-[13px] font-medium whitespace-nowrap min-h-[40px] transition-colors"
                  style={{ color: active ? A3.t1 : A3.t2, background: active ? A3.faint : 'transparent', boxShadow: active ? `inset 0 -2px 0 ${A3.accent}` : undefined }}>
                  {t(`an3.tab.${k}`)}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <button type="button" onClick={() => onChange('tonight')} aria-current={tab === 'tonight' ? 'page' : undefined}
        className="shrink-0 inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-[13px] font-semibold min-h-[40px]"
        style={{ color: tab === 'tonight' ? '#fff' : A3.t1, background: tab === 'tonight' ? A3.accent : A3.faint, border: `1px solid ${tab === 'tonight' ? A3.accent : A3.border}` }}>
        <span className="relative flex h-2 w-2">
          {liveNow && <span className="absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping" style={{ background: A3.good }} />}
          <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: liveNow ? A3.good : A3.t3 }} />
        </span>
        {t('an3.tab.tonight')}
      </button>
    </div>
  );
}
