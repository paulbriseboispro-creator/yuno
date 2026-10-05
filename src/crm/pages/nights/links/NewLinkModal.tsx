/**
 * « Nouvelle story » : on nomme la publication, on peut joindre sa capture,
 * puis le lien est créé et copié. Le nom (et la photo) sont ce qui permet de
 * retrouver, dans la liste, QUELLE story a fait vendre.
 */
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/crm/ui/Icon';
import { Modal, PillButton } from '@/crm/ui/kit';
import { useCrmT } from '@/crm/i18n';
import { fitImage } from '@/crm/lib/image';
import { supabase } from '@/integrations/supabase/client';
import { useCrmScope } from '@/crm/scope';
import type { LinkKind } from '@/crm/lib/links';
import { PlatformBadge } from './linksUi';

const MAX_FILE = 12 * 1024 * 1024;

export function NewLinkModal({ kind, kindLabel, defaultName, onClose, onCreate }: {
  kind: LinkKind | null;
  kindLabel: string;
  defaultName: string;
  onClose: () => void;
  onCreate: (name: string, imageUrl: string | null) => Promise<void>;
}) {
  const { t } = useCrmT();
  const { space } = useCrmScope();
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { if (kind) { setName(''); setFile(null); setErr(null); setBusy(false); } }, [kind]);
  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) { setErr(t('yc.lk.new.notImage')); return; }
    if (f.size > MAX_FILE) { setErr(t('yc.lk.new.tooBig')); return; }
    setErr(null);
    setFile(f);
  };

  const submit = async () => {
    if (!kind || busy) return;
    setBusy(true);
    setErr(null);
    try {
      let url: string | null = null;
      if (file) {
        const blob = await fitImage(file);
        const folder = space.venueId ? `venue/${space.venueId}` : `org/${space.organizerUserId}`;
        const path = `${folder}/links/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
        const { error } = await supabase.storage.from('email-assets').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
        if (error) throw error;
        url = supabase.storage.from('email-assets').getPublicUrl(path).data.publicUrl;
      }
      await onCreate(name.trim() || defaultName, url);
    } catch {
      setErr(t('yc.lk.new.fail'));
      setBusy(false);
    }
  };

  return (
    <Modal open={!!kind} onClose={busy ? () => undefined : onClose} width={460} label={kindLabel}>
      {kind && (
        <form
          onSubmit={(e) => { e.preventDefault(); void submit(); }}
          style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: 26 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <PlatformBadge platform={kind.platform} placement={kind.placement} size={42} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-.02em' }}>{t('yc.lk.new.t')}</b>
              <span style={{ fontSize: 13.5, color: 'var(--sand-600)' }}>{kindLabel}</span>
            </div>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t('yc.lk.new.name')}</span>
            <input
              autoFocus
              value={name}
              maxLength={60}
              placeholder={defaultName}
              onChange={(e) => setName(e.target.value)}
              style={{ height: 46, padding: '0 14px', borderRadius: 14, border: '1px solid var(--sand-300)', fontSize: 15.5, font: 'inherit', outline: 'none' }}
            />
            <span style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--sand-500)' }}>{t('yc.lk.new.nameHint')}</span>
          </label>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t('yc.lk.new.photo')} <span style={{ fontWeight: 400, color: 'var(--sand-500)' }}>· {t('yc.lk.new.optional')}</span></span>
            <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
            {preview ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <img src={preview} alt="" style={{ width: 72, height: 96, objectFit: 'cover', borderRadius: 14, boxShadow: 'inset 0 0 0 1px var(--sand-200)' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 13.5, color: 'var(--sand-700)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file?.name}</span>
                  <PillButton type="button" size="sm" onClick={() => setFile(null)}>{t('yc.lk.new.remove')}</PillButton>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => input.current?.click()}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, height: 76, borderRadius: 16, border: '1.5px dashed var(--sand-300)', background: 'var(--sand-50)', color: 'var(--sand-700)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                <Icon name="upload" size={18} stroke={2.2} />
                {t('yc.lk.new.add')}
              </button>
            )}
            <span style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--sand-500)' }}>{t('yc.lk.new.photoHint')}</span>
          </div>

          {err && <span role="alert" style={{ fontSize: 13.5, color: 'var(--red-600)' }}>{err}</span>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <PillButton type="button" onClick={onClose} disabled={busy}>{t('yc.lk.close')}</PillButton>
            <PillButton type="submit" tone="dark" icon="copy" disabled={busy}>{busy ? t('yc.lk.creating') : t('yc.lk.new.go')}</PillButton>
          </div>
        </form>
      )}
    </Modal>
  );
}
