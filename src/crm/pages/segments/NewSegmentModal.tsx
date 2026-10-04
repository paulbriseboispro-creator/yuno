/**
 * « Nouveau segment » : un modèle (avec son effectif d'aujourd'hui), un nom,
 * « Créer le segment ». Un modèle déjà créé est grisé ; « Inscrits via vos
 * pages » attend les pages d'inscription.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Modal } from '@/crm/ui/kit';
import { useCrmT } from '@/crm/i18n';
import { useAudienceCounts } from '@/crm/data/segments';
import type { ClientFilterDef } from '@/crm/data/clients';
import { SEGMENT_TEMPLATES } from '@/crm/lib/segments';
import { CRM_ROUTES } from '@/crm/shell/nav';

const LIVE = SEGMENT_TEMPLATES.filter((x) => x.def);
const DEFS = LIVE.map((x) => x.def as ClientFilterDef);

export function NewSegmentModal({
  open, onClose, existingTemplates, onCreate, busy,
}: {
  open: boolean;
  onClose: () => void;
  existingTemplates: string[];
  onCreate: (p: { template: string; name: string; definition: ClientFilterDef; description: string }) => void;
  busy: boolean;
}) {
  const { t, n } = useCrmT();
  const [rec, setRec] = useState<string | null>(null);
  const [name, setName] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const counts = useAudienceCounts(DEFS, open);
  useEffect(() => { if (open) { setRec(null); setName(''); } }, [open]);

  const ok = !!rec && !!name.trim() && !busy;
  const create = () => {
    const tpl = SEGMENT_TEMPLATES.find((x) => x.id === rec);
    if (!tpl?.def || !name.trim()) return;
    onCreate({ template: tpl.id, name: name.trim(), definition: tpl.def, description: t(`yc.seg.tpl.${tpl.id}.rule`) });
  };

  return (
    <Modal open={open} onClose={onClose} width={600} label={t('yc.seg.nw.eyebrow')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '26px 28px 8px' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.seg.nw.eyebrow')}</span>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 28, lineHeight: 1.08, letterSpacing: '-.03em', textWrap: 'balance' }}>
          {t('yc.seg.nw.title1')}<span style={{ background: 'var(--gradient-brand)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{t('yc.seg.nw.accent')}</span>{t('yc.seg.nw.title2')}
        </h2>
        <span style={{ fontSize: 14.5, lineHeight: 1.45, color: 'var(--sand-600)' }}>{t('yc.seg.nw.sub')}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 28px 8px' }}>
        {SEGMENT_TEMPLATES.map((r) => {
          const idx = LIVE.findIndex((x) => x.id === r.id);
          const cnt = idx >= 0 ? counts.data?.[idx]?.total : undefined;
          const done = existingTemplates.includes(r.id);
          const off = done || !!r.soon;
          const on = rec === r.id;
          return (
            <Hv
              key={r.id}
              as="button"
              type="button"
              onClick={() => { if (off) return; setRec(r.id); setName(t(`yc.seg.tpl.${r.id}.name`)); setTimeout(() => nameRef.current?.focus(), 30); }}
              aria-pressed={on}
              disabled={off}
              style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 18, border: `1.5px solid ${on ? 'var(--ink)' : 'var(--sand-200)'}`, background: on ? 'var(--sand-50)' : '#fff', opacity: off ? 0.5 : 1, cursor: off ? 'not-allowed' : 'pointer', transition: 'border-color 160ms,background 160ms', color: 'var(--ink)' }}
              hover={off ? undefined : { borderColor: 'var(--sand-400)' }}
            >
              <span style={{ flex: 'none', width: 20, height: 20, borderRadius: 99, border: `1.5px solid ${on ? 'var(--ink)' : 'var(--sand-300)'}`, background: on ? 'var(--ink)' : '#fff', display: 'grid', placeItems: 'center' }}>
                {on && <i style={{ width: 8, height: 8, borderRadius: 99, background: '#fff' }} />}
              </span>
              <span style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{t(`yc.seg.tpl.${r.id}.name`)}</span>
                <span style={{ fontSize: 13, lineHeight: '18px', color: 'var(--sand-500)', textWrap: 'pretty' }}>{t(`yc.seg.tpl.${r.id}.rule`)}</span>
              </span>
              <span style={{ flex: 'none', textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 1 }}>
                {r.soon ? (
                  <span style={{ height: 22, padding: '0 9px', borderRadius: 99, background: 'var(--sand-100)', color: 'var(--sand-600)', fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>{t('yc.seg.nw.soon')}</span>
                ) : (
                  <>
                    <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' }}>{cnt === undefined ? '…' : n(cnt)}</b>
                    <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{done ? t('yc.seg.nw.done') : t('yc.seg.nw.clients')}</span>
                  </>
                )}
              </span>
            </Hv>
          );
        })}
        <Hv as={Link} to={CRM_ROUTES.clients} onClick={onClose} style={{ alignSelf: 'flex-start', marginTop: 4, fontSize: 14, fontWeight: 600, color: 'var(--ink)', display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }} hover={{ color: 'var(--red-600)', textDecoration: 'none' }}>
          {t('yc.seg.nw.fine')}<Icon name="arrowRight" size={14} stroke={2.4} />
        </Hv>
      </div>
      <div style={{ padding: '8px 28px 22px' }}>
        <input
          ref={nameRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (ok) create(); } }}
          placeholder={t('yc.cli.list.segName')}
          aria-label={t('yc.cli.list.segName')}
          maxLength={80}
          style={{ height: 46, width: '100%', padding: '0 18px', borderRadius: 99, border: '1px solid var(--sand-300)', outline: 0, background: '#fff', font: '400 15px/1 var(--font-body)', color: 'var(--ink)', boxShadow: 'none' }}
        />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '16px 28px', background: 'var(--sand-50)', borderTop: '1px solid var(--sand-100)', borderRadius: '0 0 28px 28px' }}>
        <Hv as="button" type="button" onClick={onClose} style={{ height: 44, padding: '0 18px', borderRadius: 99, border: 0, background: 'none', fontSize: 14.5, fontWeight: 600, color: 'var(--sand-600)', cursor: 'pointer' }} hover={{ color: 'var(--ink)' }}>
          {t('yc.common.cancel')}
        </Hv>
        <button
          type="button"
          onClick={create}
          disabled={!ok}
          style={{ height: 44, padding: '0 22px', borderRadius: 99, border: 0, background: ok ? 'var(--gradient-brand)' : 'var(--sand-100)', color: ok ? '#fff' : 'var(--sand-400)', fontSize: 14.5, fontWeight: 600, cursor: ok ? 'pointer' : 'not-allowed', boxShadow: ok ? 'var(--shadow-cta)' : 'none' }}
        >
          {t('yc.seg.nw.create')}
        </button>
      </div>
    </Modal>
  );
}
