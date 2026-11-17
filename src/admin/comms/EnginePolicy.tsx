/**
 * Notifications automatiques › Politique (v3) : les plafonds que le moteur
 * applique à TOUS les envois marketing, lisibles d'un coup d'œil (un cran par
 * message permis), la file et les messages retenus en une phrase, puis les
 * champs qui les règlent. Même RPC qu'avant (`admin_set_push_engine_settings`).
 */
import { Block, useAdminT, EmptyLine, Fold, Level } from '@/admin/ui';
import { fmtNum, fmtRelative } from '@/lib/adminFormat';
import type { EngineOverview } from './data';
import { SettingsGroup } from './SettingsGroup';

const POLICY_GROUPS: { id: string; fields: readonly string[] }[] = [
  { id: 'quiet', fields: ['quiet_start', 'quiet_end'] },
  { id: 'caps', fields: ['daily_cap', 'weekly_cap', 'weekly_cap_engaged', 'weekly_cap_fatigued', 'urgent_daily_cap', 'per_event_max'] },
  { id: 'fatigue', fields: ['fatigue_sent', 'fatigue_days'] },
];
/** Les plafonds qui se lisent en crans : un cran = un message permis. */
const CAPS = ['daily_cap', 'urgent_daily_cap', 'per_event_max', 'weekly_cap_fatigued', 'weekly_cap', 'weekly_cap_engaged'] as const;

export default function EnginePolicy({ data }: { data: EngineOverview }) {
  const { t, lang } = useAdminT();
  const holds = Object.entries(data.queue.holds ?? {}).sort((a, b) => b[1] - a[1]);
  const holdLabel = (k: string) => { const v = t(`adm.engine.hold.${k}`); return v === `adm.engine.hold.${k}` ? k : v; };
  const max = Math.max(8, ...CAPS.map((k) => data.settings?.[k] ?? 0));
  return (
    <div className="flex flex-col gap-8">
      <Block title={t('adm.comms.en3.caps')} meta={t('adm.comms.en3.capsMeta')}>
        <EmptyLine>{t('adm.comms.en.pg.capsHint')}</EmptyLine>
        <ul className="grid grid-cols-1 gap-x-10 gap-y-3 md:grid-cols-2">
          {CAPS.map((k) => (
            <li key={k} className="flex items-center gap-3">
              <span className="a-t2 min-w-0 flex-1 text-[13px]">{t(`adm.engine.set.${k}`)}</span>
              <Level level={data.settings?.[k] ?? 0} max={max} label={`${t(`adm.engine.set.${k}`)} ${data.settings?.[k] ?? 0}`} />
              <span className="a-num a-t1 w-5 text-right text-[13px] font-medium">{fmtNum(data.settings?.[k] ?? 0, lang)}</span>
            </li>
          ))}
        </ul>
        <p className="a-t3 text-[12.5px]">{t('adm.comms.en3.quiet', { a: data.settings?.quiet_start ?? 22, b: data.settings?.quiet_end ?? 10 })}</p>
      </Block>

      <Block title={t('adm.comms.en.queue')}>
        <p className="a-hero-sentence max-w-[68ch]">
          {t('adm.comms.en3.queue', { p: fmtNum(data.queue.pending, lang), d: fmtNum(data.queue.dueNow, lang), o: data.queue.oldestDue ? fmtRelative(data.queue.oldestDue, lang) : '—' })}
        </p>
        <p className="a-t2 max-w-[68ch] text-[13px]">
          {holds.length === 0 ? t('adm.comms.en.noHolds') : <>{t('adm.comms.en.holds')} : {holds.map(([k, v]) => `${holdLabel(k)} ${fmtNum(v, lang)}`).join(', ')}.</>}
        </p>
      </Block>

      <Fold title={t('adm.comms.en3.edit')} hint={t('adm.comms.en3.editHint')}>
        {POLICY_GROUPS.map((g) => (
          <SettingsGroup key={g.id} title={t(`adm.comms.en.pg.${g.id}`)} hint={t(`adm.comms.en.pg.${g.id}Hint`)}
            fields={g.fields} settings={data.settings} hintPrefix="adm.comms.en.pol" />
        ))}
      </Fold>
    </div>
  );
}
