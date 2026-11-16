/**
 * Notifications automatiques › Politique : les plafonds que le moteur applique
 * à TOUS les envois marketing. Un champ = un réglage = une phrase qui dit ce
 * qu'il change. Même RPC qu'avant (`admin_set_push_engine_settings`).
 */
import { Card, EmptyState, Grid, KeyValue, useAdminT } from '@/admin/ui';
import { fmtNum, fmtRelative } from '@/lib/adminFormat';
import type { EngineOverview } from './data';
import { SettingsGroup } from './SettingsGroup';

const POLICY_GROUPS: { id: string; fields: readonly string[] }[] = [
  { id: 'quiet', fields: ['quiet_start', 'quiet_end'] },
  { id: 'caps', fields: ['daily_cap', 'weekly_cap', 'weekly_cap_engaged', 'weekly_cap_fatigued', 'urgent_daily_cap', 'per_event_max'] },
  { id: 'fatigue', fields: ['fatigue_sent', 'fatigue_days'] },
];

export default function EnginePolicy({ data }: { data: EngineOverview }) {
  const { t, lang } = useAdminT();
  const holds = Object.entries(data.queue.holds ?? {}).sort((a, b) => b[1] - a[1]);
  const holdLabel = (k: string) => { const v = t(`adm.engine.hold.${k}`); return v === `adm.engine.hold.${k}` ? k : v; };
  return (
    <div className="flex flex-col gap-6">
      {POLICY_GROUPS.map((g) => (
        <SettingsGroup key={g.id} title={t(`adm.comms.en.pg.${g.id}`)} hint={t(`adm.comms.en.pg.${g.id}Hint`)}
          fields={g.fields} settings={data.settings} hintPrefix="adm.comms.en.pol" />
      ))}
      <Grid cols={2}>
        <Card title={t('adm.comms.en.queue')}>
          <KeyValue items={[
            { label: t('adm.comms.en.pending'), value: fmtNum(data.queue.pending, lang) },
            { label: t('adm.comms.en.dueNow'), value: fmtNum(data.queue.dueNow, lang) },
            { label: t('adm.comms.en.claimed'), value: fmtNum(data.queue.claimed, lang) },
            { label: t('adm.comms.en.oldest'), value: data.queue.oldestDue ? fmtRelative(data.queue.oldestDue, lang) : '—' },
          ]} />
        </Card>
        <Card title={t('adm.comms.en.holds')}>
          {holds.length === 0 ? <EmptyState title={t('adm.comms.en.noHolds')} /> : (
            <KeyValue items={holds.map(([k, v]) => ({ label: holdLabel(k), value: fmtNum(v, lang) }))} />
          )}
        </Card>
      </Grid>
    </div>
  );
}
