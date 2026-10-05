/**
 * « Bientôt, avec l'intégration partenaire Shotgun » : les mesures que l'API
 * publique de Shotgun ne rend pas (docs/designs/SHOTGUN_API_REFERENCE.md).
 * Décision de Paul (05/10) : on les MONTRE, marquées « Bientôt », sans jamais
 * inventer un chiffre — c'est ce qu'on ira négocier avec Shotgun.
 */
import type { CSSProperties } from 'react';
import { Icon, type IconName } from '@/crm/ui/Icon';
import { EASE } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';

export type SoonItem = 'visits' | 'conv' | 'curious' | 'carts' | 'page' | 'scanlist';

const ICON: Record<SoonItem, IconName> = { visits: 'eye', conv: 'chart', curious: 'pointer', carts: 'ticket', page: 'globe', scanlist: 'users' };

export function SoonTile({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  const { t } = useCrmT();
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 8, padding: '16px 16px 18px', borderRadius: 18, background: 'repeating-linear-gradient(135deg,var(--sand-50) 0 10px,#fff 10px 20px)', boxShadow: 'inset 0 0 0 1px var(--sand-200)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ width: 34, height: 34, borderRadius: 12, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', color: 'var(--sand-600)', display: 'grid', placeItems: 'center' }}>
          <Icon name={icon} size={16} stroke={2.2} />
        </span>
        <span style={{ height: 24, padding: '0 10px', borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 11.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon name="lock" size={11} stroke={2.6} />{t('yc.lk.soon.badge')}
        </span>
      </div>
      <b style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.3 }}>{title}</b>
      <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--sand-600)', textWrap: 'pretty' }}>{body}</span>
    </div>
  );
}

export function ShotgunSoonCard({ items, style, delay = 0 }: { items: SoonItem[]; style?: CSSProperties; delay?: number }) {
  const { t } = useCrmT();
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 22, borderRadius: 24, background: 'var(--paper)', boxShadow: 'inset 0 0 0 1px var(--sand-200)', animation: `yc-row 600ms ${EASE} ${delay}ms both`, ...style }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{t('yc.lk.soon.t')}</h3>
        <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t('yc.lk.soon.s')}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10 }}>
        {items.map((k) => <SoonTile key={k} icon={ICON[k]} title={t(`yc.lk.soon.${k}.t`)} body={t(`yc.lk.soon.${k}.s`)} />)}
      </div>
    </section>
  );
}
