/**
 * Réglages › Données : « 10 % non contactés, pour mesurer l'effet réel »
 * (migration 20261013120000). La part de chaque envoi « Qui cibler » et de
 * chaque automatisation qui ne reçoit pas le message, pour comparer les
 * acheteurs des deux groupes. 0 = désactivé ; changeable par qui peut écrire.
 */
import { Icon } from '@/crm/ui/Icon';
import { useCrmToast } from '@/crm/ui/toast';
import { useNarrow } from '@/crm/ui/useNarrow';
import { useCrmT } from '@/crm/i18n';
import { useHoldoutSettings, useSetHoldout } from '@/crm/data/holdout';
import { HOLDOUT_STEPS } from '@/crm/lib/holdout';
import { LockNote, Seg } from './settingsUi';

export function HoldoutRow() {
  const { t } = useCrmT();
  const toast = useCrmToast();
  const small = useNarrow(520);
  const q = useHoldoutSettings();
  const set = useSetHoldout();
  const d = q.data;
  if (!d) return null;
  const steps: number[] = HOLDOUT_STEPS.includes(d.pct as (typeof HOLDOUT_STEPS)[number])
    ? [...HOLDOUT_STEPS] : [...HOLDOUT_STEPS, d.pct].sort((a, b) => a - b);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '20px 0', borderTop: '1px solid var(--sand-100)' }}>
      <span style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <span style={{ flex: 'none', width: 40, height: 40, borderRadius: 12, background: 'var(--sand-50)', color: 'var(--sand-700)', display: 'grid', placeItems: 'center' }}>
          <Icon d="M12 3v18M5 8h4M5 12h4M5 16h4M15 8h4M15 12h4" size={19} stroke={2} />
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{d.pct > 0 ? t('yc.hold.t', { n: d.pct }) : t('yc.hold.tOff')}</span>
          <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-500)', textWrap: 'pretty' }}>{t('yc.hold.s')}</span>
        </span>
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: small ? 0 : 54 }}>
        <Seg
          label={t('yc.hold.label')}
          options={steps.map((v) => ({ v, l: v === 0 ? t('yc.hold.optOff') : t('yc.hold.opt', { n: v }) }))}
          value={d.pct}
          onChange={(v) => set.mutate(v, {
            onSuccess: () => toast(t('yc.hold.saved')),
            onError: () => toast(t('yc.hold.err')),
          })}
          disabled={!d.can_edit || set.isPending}
          wrap
        />
        {!d.can_edit && <LockNote>{t('yc.common.readOnly')}</LockNote>}
      </div>
    </div>
  );
}
