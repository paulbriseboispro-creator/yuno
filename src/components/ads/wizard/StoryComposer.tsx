// Compositeur de visuels : une story / un reel (9:16) ou un post feed (4:5)
// depuis l'affiche et les faits de la soirée. Aperçu vivant, trois gabarits,
// une couleur d'accent, et « Utiliser » qui envoie le JPEG au Storage.

import { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { Loader2, Wand2, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { COMPOSER_ACCENTS, COMPOSER_TEMPLATES, composeToBlob, renderComposedDesign } from '@/lib/adComposer';
import type { AdsEvent, ComposedDesign } from '@/lib/metaAds';
import { Field, Chip, GhostButton, Tip, inputStyle, focusRing, T1, T2, T3, BORDER, RED, INNER_BG } from './ui';

export function defaultDesign(event: AdsEvent | null, ratio: ComposedDesign['ratio'], language: string, t: (k: string) => string): ComposedDesign {
  const locale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const parts = [event ? format(new Date(event.start_at), 'EEE d MMM · HH:mm', { locale }) : '', event?.city ?? ''].filter(Boolean);
  return {
    template: 'cover', ratio,
    title: event?.title ?? '',
    subtitle: parts.join(' · '),
    kicker: event?.venue_name ?? '',
    cta: event?.price_from != null ? t('ads.c.ctaFrom').replace('{price}', String(Math.round(event.price_from))) : t('ads.c.ctaDefault'),
    accent: '#E8192C',
  };
}

export function StoryComposer({ event, posterUrl, ratio, initial, onUse, onClose, t }: {
  event: AdsEvent | null;
  posterUrl: string | null;
  ratio: ComposedDesign['ratio'];
  initial?: ComposedDesign | null;
  /** Reçoit le JPEG rendu et le design (pour le rejouer). */
  onUse: (blob: Blob, design: ComposedDesign) => Promise<void> | void;
  onClose: () => void;
  t: (k: string) => string;
}) {
  const { language } = useLanguage();
  const [design, setDesign] = useState<ComposedDesign>(() => initial ? { ...initial, ratio } : defaultDesign(event, ratio, language, t));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const set = <K extends keyof ComposedDesign>(k: K, v: ComposedDesign[K]) => setDesign((d) => ({ ...d, [k]: v }));

  // Rendu vivant, 250 ms après la dernière frappe.
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (!canvasRef.current) return;
      try { await renderComposedDesign(design, posterUrl, canvasRef.current); setError(null); }
      catch { if (!cancelled) setError(t('ads.c.renderFailed')); }
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [design, posterUrl, t]);

  const use = async () => {
    setBusy(true);
    try { await onUse(await composeToBlob(design, posterUrl), design); onClose(); }
    catch { setError(t('ads.c.renderFailed')); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.78)' }} role="dialog" aria-modal="true">
      <div className="w-full sm:max-w-[980px] flex flex-col rounded-t-3xl sm:rounded-3xl overflow-hidden" style={{ background: 'var(--sf-0c0c0e)', border: `1px solid ${BORDER}`, height: 'min(94dvh, 860px)' }}>
        <div className="flex items-center justify-between gap-3 px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <div className="flex items-center gap-3">
            <Wand2 className="w-5 h-5" style={{ color: RED }} />
            <div>
              <p style={{ color: T1, fontSize: 15.5, fontWeight: 700 }}>{ratio === '9:16' ? t('ads.c.titleStory') : t('ads.c.titleFeed')}</p>
              <p style={{ color: T3, fontSize: 12.5 }}>{t('ads.c.subtitle')}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="h-10 w-10 rounded-xl flex items-center justify-center cursor-pointer hover:bg-white/[0.06]" style={{ color: T3 }} aria-label={t('ads.wizard.close')}><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto grid gap-5 p-5 lg:grid-cols-[1fr_360px]">
          <div className="space-y-4">
            <Field label={t('ads.c.template')}>
              <div className="flex gap-2 flex-wrap">
                {COMPOSER_TEMPLATES.map((tp) => <Chip key={tp} active={design.template === tp} onClick={() => set('template', tp)}>{t(`ads.c.tpl.${tp}`)}</Chip>)}
              </div>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('ads.c.title')} counter={`${design.title.length}/60`}>
                <input value={design.title} onChange={(e) => set('title', e.target.value.slice(0, 60))} style={inputStyle} className={focusRing} />
              </Field>
              <Field label={t('ads.c.kicker')} hint={t('ads.c.kickerHint')}>
                <input value={design.kicker} onChange={(e) => set('kicker', e.target.value.slice(0, 40))} style={inputStyle} className={focusRing} />
              </Field>
              <Field label={t('ads.c.subtitleField')} hint={t('ads.c.subtitleHint')}>
                <input value={design.subtitle} onChange={(e) => set('subtitle', e.target.value.slice(0, 80))} style={inputStyle} className={focusRing} />
              </Field>
              <Field label={t('ads.c.cta')} hint={t('ads.c.ctaHint')}>
                <input value={design.cta} onChange={(e) => set('cta', e.target.value.slice(0, 32))} style={inputStyle} className={focusRing} />
              </Field>
            </div>
            <Field label={t('ads.c.accent')}>
              <div className="flex gap-2 flex-wrap items-center">
                {COMPOSER_ACCENTS.map((c) => (
                  <button key={c} type="button" onClick={() => set('accent', c)} aria-label={c} className="h-10 w-10 rounded-full cursor-pointer transition-transform duration-150" style={{ background: c, border: `3px solid ${design.accent === c ? 'rgb(var(--ink))' : 'rgb(var(--ink)/0.15)'}` }} />
                ))}
                <input type="color" value={design.accent} onChange={(e) => set('accent', e.target.value)} className="h-10 w-12 rounded-lg cursor-pointer" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }} aria-label={t('ads.c.accent')} />
              </div>
            </Field>
            <Tip>{t('ads.c.note')}</Tip>
            {error && <p style={{ color: 'var(--acc-ff8a91)', fontSize: 13 }}>{error}</p>}
          </div>
          <div className="lg:sticky lg:top-0 self-start flex flex-col items-center gap-3">
            <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${BORDER}`, background: 'var(--sf-000000)', width: ratio === '9:16' ? 300 : 320 }}>
              <canvas ref={canvasRef} className="block w-full h-auto" style={{ aspectRatio: ratio === '9:16' ? '9 / 16' : '4 / 5' }} />
            </div>
            <p style={{ color: T3, fontSize: 12 }}>{ratio === '9:16' ? '1080 × 1920' : '1080 × 1350'} · JPEG</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-5 py-3.5" style={{ borderTop: `1px solid ${BORDER}` }}>
          <GhostButton onClick={onClose}>{t('integ.meta.cancel')}</GhostButton>
          <button type="button" onClick={use} disabled={busy || !design.title.trim()}
            className="inline-flex items-center gap-2 px-5 rounded-xl text-[14px] font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" style={{ background: RED, color: '#fff', minHeight: 46 }}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />} {t('ads.c.use')}
          </button>
        </div>
        <span className="hidden" style={{ color: T2 }} />
      </div>
    </div>
  );
}
