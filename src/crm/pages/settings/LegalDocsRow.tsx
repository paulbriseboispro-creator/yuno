/**
 * Réglages › Données : « Vos documents ». Les Conditions Yuno CRM (avec, en
 * annexe, le modèle de texte pour informer les clients du pro), l'accord de
 * sous-traitance (chapitre 12 « Yuno CRM ») et la politique de confidentialité
 * de Yuno. Les pages vivent sur yunoapp.eu et s'ouvrent dans un nouvel onglet.
 */
import { Icon } from '@/crm/ui/Icon';
import { Hv } from '@/crm/ui/Hv';
import { useNarrow } from '@/crm/ui/useNarrow';
import { useCrmT } from '@/crm/i18n';

const ORIGIN = 'https://yunoapp.eu';
const DOCS: { k: string; path: string }[] = [
  { k: 'yc.legal.doc.terms', path: '/legal/cgv-crm' },
  { k: 'yc.legal.doc.dpa', path: '/legal/dpa' },
  { k: 'yc.legal.doc.template', path: '/legal/cgv-crm' },
  { k: 'yc.legal.doc.privacy', path: '/legal/privacy' },
];

export function LegalDocsRow() {
  const { t } = useCrmT();
  const small = useNarrow(520);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '20px 0', borderTop: '1px solid var(--sand-100)' }}>
      <span style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <span style={{ flex: 'none', width: 40, height: 40, borderRadius: 12, background: 'var(--sand-50)', color: 'var(--sand-700)', display: 'grid', placeItems: 'center' }}>
          <Icon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8" size={19} stroke={2} />
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{t('yc.legal.docs.t')}</span>
          <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-500)', textWrap: 'pretty' }}>{t('yc.legal.docs.s')}</span>
        </span>
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingLeft: small ? 0 : 54 }}>
        {DOCS.map((d) => (
          <Hv
            key={d.k}
            as="a"
            href={`${ORIGIN}${d.path}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ height: 36, padding: '0 14px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', color: 'var(--ink)', fontSize: 13.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 7, textDecoration: 'none' }}
            hover={{ background: 'var(--paper)', borderColor: 'var(--sand-300)', textDecoration: 'none', color: 'var(--ink)' }}
          >
            {t(d.k)}<Icon name="arrowRight" size={13} stroke={2.4} />
          </Hv>
        ))}
      </div>
    </div>
  );
}
