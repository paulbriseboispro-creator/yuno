import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { toast } from 'sonner';
import { AlertTriangle, ImagePlus, Loader2, Monitor, Move, RotateCcw, Smartphone, Trash2, Upload } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { OrgButton, RED, T1, T2, T3, BORDER, INNER_BG } from '@/components/org-ui';
import { HomeBannerBackdrop } from './HomeBannerBackdrop';
import {
  HOME_BANNER_MAX_ZOOM, HOME_BANNER_MIN_WIDTH, HOME_BANNER_MIN_ZOOM,
  panHomeBanner, saveHomeBanner, uploadHomeBanner,
  type HomeBanner, type HomeBannerDim, type HomeBannerScope,
} from '@/lib/homeBanner';

// Proportions réelles du héros : ~1100 × 250 sur ordinateur, 390 × 256 sur téléphone.
const DESKTOP_RATIO = 1100 / 250;
const MOBILE_RATIO = 390 / 256;
const MAX_INPUT_BYTES = 20 * 1024 * 1024;

interface Identity {
  name: string;
  subtitle?: string | null;
  logoUrl?: string | null;
}

export interface HomeBannerEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: HomeBannerScope;
  current: HomeBanner | null;
  identity: Identity;
  /** Couverture de la page publique, proposée comme point de départ. */
  publicCover?: { url: string; x?: number; y?: number } | null;
  onSaved: (banner: HomeBanner | null) => void;
}

/** Logo + nom, à l'échelle de l'aperçu : on voit où le texte tombe sur la photo. */
function IdentityOverlay({ identity, small }: { identity: Identity; small?: boolean }) {
  const logo = small ? 22 : 40;
  return (
    <div className={`pointer-events-none absolute inset-x-0 bottom-0 flex items-end ${small ? 'gap-1.5 p-2' : 'gap-2.5 p-3.5'}`}>
      {identity.logoUrl ? (
        <img src={identity.logoUrl} alt="" className="flex-shrink-0 object-cover" style={{ width: logo, height: logo, borderRadius: small ? 7 : 12, border: '1px solid rgb(var(--ink)/0.18)' }} />
      ) : (
        <div className="flex-shrink-0" style={{ width: logo, height: logo, borderRadius: small ? 7 : 12, background: 'rgba(232,25,44,0.22)', border: '1px solid rgba(232,25,44,0.32)' }} />
      )}
      <div className="min-w-0">
        <div className="truncate" style={{ color: T1, fontSize: small ? 10 : 16, fontWeight: 700, lineHeight: 1.15, textShadow: '0 2px 14px rgba(0,0,0,0.9)' }}>
          {identity.name}
        </div>
        {identity.subtitle && !small && (
          <div className="truncate" style={{ color: T3, fontSize: 11, marginTop: 2 }}>{identity.subtitle}</div>
        )}
      </div>
    </div>
  );
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-xl p-0.5" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className="rounded-[10px] px-3 py-1 text-[12px] font-semibold transition-colors"
            style={{ color: on ? T1 : T3, background: on ? 'rgb(var(--ink)/0.09)' : 'transparent' }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function HomeBannerEditor({ open, onOpenChange, scope, current, identity, publicCover, onSaved }: HomeBannerEditorProps) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState<HomeBanner | null>(current);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [dragging, setDragging] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ x: number; y: number; id: number } | null>(null);
  const objectUrl = useRef<string | null>(null);

  const releaseObjectUrl = () => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
  };

  // Chaque ouverture repart de la bannière enregistrée.
  useEffect(() => {
    if (!open) return;
    releaseObjectUrl();
    setDraft(current);
    setPendingFile(null);
    setNatural(null);
  }, [open, current]);

  useEffect(() => () => releaseObjectUrl(), []);

  const pickFile = useCallback((file: File | undefined | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error(t('homeBanner.errFormat')); return; }
    if (file.size > MAX_INPUT_BYTES) { toast.error(t('homeBanner.errSize')); return; }
    releaseObjectUrl();
    const url = URL.createObjectURL(file);
    objectUrl.current = url;
    setPendingFile(file);
    setNatural(null);
    setDraft((d) => ({ url, x: 50, y: 50, zoom: 1, dim: d?.dim ?? 'medium' }));
  }, [t]);

  const startFromCover = () => {
    if (!publicCover) return;
    releaseObjectUrl();
    setPendingFile(null);
    setNatural(null);
    setDraft((d) => ({ url: publicCover.url, x: publicCover.x ?? 50, y: publicCover.y ?? 50, zoom: 1, dim: d?.dim ?? 'medium' }));
  };

  const patch = (p: Partial<HomeBanner>) => setDraft((d) => (d ? { ...d, ...p } : d));

  // ── Cadrage au glissé ──────────────────────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draft) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = frameRef.current;
    if (!d || d.id !== e.pointerId || !draft || !el || !natural) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    drag.current = { ...d, x: e.clientX, y: e.clientY };
    const next = panHomeBanner(draft, dx, dy, { cw: el.clientWidth, ch: el.clientHeight, nw: natural.w, nh: natural.h });
    patch(next);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === e.pointerId) { drag.current = null; setDragging(false); }
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!draft) return;
    const step = e.shiftKey ? 10 : 2;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    patch({ x: Math.min(100, Math.max(0, draft.x + m[0])), y: Math.min(100, Math.max(0, draft.y + m[1])) });
  };

  const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setNatural({ w: img.naturalWidth, h: img.naturalHeight });
  };

  const lowRes = !!natural && natural.w < HOME_BANNER_MIN_WIDTH;
  const tall = !!natural && natural.w / natural.h < 1.3;
  const dirty = pendingFile !== null || JSON.stringify(draft) !== JSON.stringify(current);

  const save = async () => {
    setSaving(true);
    try {
      let next = draft;
      if (next && pendingFile) {
        const url = await uploadHomeBanner(scope, pendingFile);
        next = { ...next, url };
      }
      await saveHomeBanner(scope, next);
      onSaved(next);
      toast.success(next ? t('homeBanner.saved') : t('homeBanner.removed'));
      onOpenChange(false);
    } catch (err) {
      console.error('[home-banner] save failed', err);
      toast.error(t('homeBanner.errSave'));
    } finally {
      setSaving(false);
    }
  };

  const dimOptions: { value: HomeBannerDim; label: string }[] = [
    { value: 'light', label: t('homeBanner.dimLight') },
    { value: 'medium', label: t('homeBanner.dimMedium') },
    { value: 'strong', label: t('homeBanner.dimStrong') },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent
        className="max-h-[92vh] overflow-y-auto border-0 p-0"
        // Pas de focus automatique sur l'aperçu : l'anneau de focus masquerait le cadrage.
        onOpenAutoFocus={(e) => e.preventDefault()}
        style={{ background: 'var(--sf-0a0a0c)', border: `1px solid ${BORDER}`, borderRadius: 20, maxWidth: 760, width: 'calc(100vw - 24px)' }}
      >
        <div className="space-y-5 p-5 sm:p-6">
          <div className="pr-8">
            <DialogTitle style={{ color: T1, fontSize: 17, fontWeight: 650, letterSpacing: '-0.01em' }}>
              {t('homeBanner.title')}
            </DialogTitle>
            <DialogDescription style={{ color: T3, fontSize: 12.5, marginTop: 4 }}>
              {t('homeBanner.subtitle')}
            </DialogDescription>
          </div>

          {/* ── Aperçu ordinateur : c'est ici qu'on cadre ─────────────────── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5" style={{ color: T2, fontSize: 11.5, fontWeight: 600 }}>
                <Monitor className="h-3.5 w-3.5" />{t('homeBanner.previewDesktop')}
              </span>
              {draft && (
                <span className="inline-flex items-center gap-1.5" style={{ color: T3, fontSize: 11.5 }}>
                  <Move className="h-3.5 w-3.5" />{t('homeBanner.dragHint')}
                </span>
              )}
            </div>
            <div
              ref={frameRef}
              role={draft ? 'application' : undefined}
              aria-label={draft ? t('homeBanner.dragHint') : undefined}
              tabIndex={draft ? 0 : -1}
              data-theme-island="dark"
              className="relative w-full touch-none overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-[#E8192C]/60"
              style={{
                aspectRatio: `${DESKTOP_RATIO}`,
                borderRadius: 16,
                border: `1px ${dragOver ? 'dashed' : 'solid'} ${dragOver ? RED : BORDER}`,
                cursor: draft ? (dragging ? 'grabbing' : 'grab') : 'default',
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onKeyDown={onKeyDown}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files?.[0]); }}
            >
              <HomeBannerBackdrop banner={draft} onImageLoad={onImageLoad} />
              <IdentityOverlay identity={identity} />
              {!draft && (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="absolute inset-0 m-auto flex h-fit w-fit flex-col items-center gap-1.5 rounded-2xl px-5 py-3.5"
                  style={{ background: 'rgba(0,0,0,0.45)', border: '1px dashed rgb(var(--ink)/0.28)', backdropFilter: 'blur(8px)' }}
                >
                  <ImagePlus className="h-5 w-5" style={{ color: T1 }} />
                  <span style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{t('homeBanner.dropTitle')}</span>
                  <span style={{ color: T3, fontSize: 11 }}>{t('homeBanner.dropHint')}</span>
                </button>
              )}
            </div>
          </div>

          {/* ── Téléphone + réglages ─────────────────────────────────────── */}
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <div className="flex-shrink-0 space-y-2">
              <span className="inline-flex items-center gap-1.5" style={{ color: T2, fontSize: 11.5, fontWeight: 600 }}>
                <Smartphone className="h-3.5 w-3.5" />{t('homeBanner.previewMobile')}
              </span>
              <div
                data-theme-island="dark"
                className="relative overflow-hidden"
                style={{ width: 176, aspectRatio: `${MOBILE_RATIO}`, borderRadius: 12, border: `1px solid ${BORDER}` }}
              >
                <HomeBannerBackdrop banner={draft} compact />
                <IdentityOverlay identity={identity} small />
              </div>
            </div>

            <div className="min-w-0 flex-1 space-y-4">
              <div className={draft ? '' : 'pointer-events-none opacity-40'}>
                <div className="mb-2 flex items-center justify-between">
                  <span style={{ color: T2, fontSize: 12, fontWeight: 600 }}>{t('homeBanner.zoom')}</span>
                  <span className="tabular-nums" style={{ color: T3, fontSize: 11.5 }}>{Math.round((draft?.zoom ?? 1) * 100)} %</span>
                </div>
                <Slider
                  min={HOME_BANNER_MIN_ZOOM}
                  max={HOME_BANNER_MAX_ZOOM}
                  step={0.01}
                  value={[draft?.zoom ?? 1]}
                  onValueChange={([z]) => patch({ zoom: z })}
                  aria-label={t('homeBanner.zoom')}
                />
              </div>

              <div className={`flex flex-wrap items-center justify-between gap-2 ${draft ? '' : 'pointer-events-none opacity-40'}`}>
                <span style={{ color: T2, fontSize: 12, fontWeight: 600 }}>{t('homeBanner.dim')}</span>
                <Seg value={draft?.dim ?? 'medium'} options={dimOptions} onChange={(dim) => patch({ dim })} />
              </div>

              {draft && (
                <button
                  type="button"
                  onClick={() => patch({ x: 50, y: 50, zoom: 1 })}
                  className="inline-flex items-center gap-1.5"
                  style={{ color: T3, fontSize: 12, fontWeight: 500 }}
                >
                  <RotateCcw className="h-3.5 w-3.5" />{t('homeBanner.recenter')}
                </button>
              )}

              {(lowRes || tall) && (
                <div className="flex items-start gap-2 rounded-xl px-3 py-2.5" style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.22)' }}>
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" style={{ color: 'var(--acc-f59e0b)' }} />
                  <p style={{ color: T2, fontSize: 11.5, lineHeight: 1.45 }}>
                    {tall ? t('homeBanner.warnTall') : t('homeBanner.warnLowRes')}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* ── Source ───────────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }}
            />
            <OrgButton size="sm" variant="secondary" onClick={() => fileRef.current?.click()} disabled={saving}>
              <Upload className="h-3.5 w-3.5" />{draft ? t('homeBanner.replace') : t('homeBanner.upload')}
            </OrgButton>
            {publicCover && draft?.url !== publicCover.url && (
              <OrgButton size="sm" variant="ghost" onClick={startFromCover} disabled={saving}>
                <ImagePlus className="h-3.5 w-3.5" />{t('homeBanner.useCover')}
              </OrgButton>
            )}
            {draft && (
              <OrgButton size="sm" variant="ghost" onClick={() => { releaseObjectUrl(); setPendingFile(null); setDraft(null); }} disabled={saving}>
                <Trash2 className="h-3.5 w-3.5" />{t('homeBanner.remove')}
              </OrgButton>
            )}
          </div>

          {/* Format conseillé : toujours visible, pas seulement quand l'aperçu est vide. */}
          <div className="flex items-start gap-2.5 rounded-xl px-3.5 py-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
            <ImagePlus className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: T2 }} />
            <div className="min-w-0 space-y-1">
              <p style={{ color: T1, fontSize: 12.5, fontWeight: 600 }}>{t('homeBanner.formatTitle')}</p>
              <p style={{ color: T2, fontSize: 11.5, lineHeight: 1.5 }}>{t('homeBanner.formatBody')}</p>
              <p style={{ color: T3, fontSize: 11.5, lineHeight: 1.5 }}>{t('homeBanner.tip')}</p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1" style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 16 }}>
            <OrgButton variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>{t('homeBanner.cancel')}</OrgButton>
            <OrgButton variant="primary" onClick={save} disabled={saving || !dirty}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('homeBanner.save')}
            </OrgButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
