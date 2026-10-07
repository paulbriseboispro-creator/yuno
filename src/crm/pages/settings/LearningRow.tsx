/**
 * Réglages › Données : « Statistiques anonymes » (analyse client, lot E).
 * Ce qui sort du compte est dit en clair ; le titulaire seul change le
 * réglage, jamais en accès assisté (refus serveur). Tant que le drapeau global
 * est éteint, rien ne sort pour personne, et l'écran le dit.
 */
import { Icon } from '@/crm/ui/Icon';
import { useCrmToast } from '@/crm/ui/toast';
import { useNarrow } from '@/crm/ui/useNarrow';
import { useCrmT } from '@/crm/i18n';
import { useLearningContrib, useSetLearningContrib } from '@/crm/data/analysis';
import { GreenSwitch, LockNote } from './settingsUi';

export function LearningRow() {
  const { t } = useCrmT();
  const toast = useCrmToast();
  const small = useNarrow(520);
  const q = useLearningContrib();
  const set = useSetLearningContrib();
  const d = q.data;
  if (!d) return null;
  const canEdit = d.holder && !d.demo;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '20px 0', borderTop: '1px solid var(--sand-100)' }}>
      <span style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <span style={{ flex: 'none', width: 40, height: 40, borderRadius: 12, background: 'var(--sand-50)', color: 'var(--sand-700)', display: 'grid', placeItems: 'center' }}>
          <Icon d="M3 3v18h18M7 15l4-4 3 3 5-6" size={19} stroke={2} />
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{t('yc.why.set.t')}</span>
          <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-500)', textWrap: 'pretty' }}>{t('yc.why.set.s')}</span>
        </span>
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: small ? 0 : 54 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12, fontSize: 14.5, fontWeight: 500 }}>
        <GreenSwitch
          on={d.learning_contrib && !d.demo}
          label={t('yc.why.set.on')}
          disabled={!canEdit || set.isPending}
          onChange={(v) => set.mutate(v, {
            onSuccess: () => toast(t(v ? 'yc.why.set.saved' : 'yc.why.set.offDone')),
            onError: (e) => toast(String((e as Error).message).includes('support_session') ? t('yc.why.card.supportRefused') : t('yc.why.err')),
          })}
        />
        {t('yc.why.set.on')}
        </span>
        {!d.global_enabled && <span style={{ fontSize: 13, color: 'var(--sand-500)', textWrap: 'pretty' }}>{t('yc.why.set.globalOff')}</span>}
        {d.demo ? <LockNote>{t('yc.why.set.demo')}</LockNote> : !d.holder && <LockNote>{t('yc.why.set.holderOnly')}</LockNote>}
      </div>
    </div>
  );
}
