import { useCrmT } from '@/crm/i18n';
import { YunitFace } from '@/crm/ui/YunitFace';

/** Écran de l'Admin CRM pas encore construit : dit pourquoi, sans rien inventer. */
export default function SoonPage() {
  const { t } = useCrmT();
  return (
    <main style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', padding: 32 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center', maxWidth: 420 }}>
        <YunitFace mood="endormi" size={64} />
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, letterSpacing: '-.03em' }}>{t('adm.crm.soon.title')}</h1>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: 'var(--sand-600)' }}>{t('adm.crm.soon.body')}</p>
      </div>
    </main>
  );
}
