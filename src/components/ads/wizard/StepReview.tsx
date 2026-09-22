// Étape 5 — tout relire avant de créer. Chaque ligne renvoie à son étape.

import { Pencil, ShieldCheck } from 'lucide-react';
import type { DraftCreative } from './types';
import { AdPreview } from './AdPreview';
import { StepHeader, Tip, T1, T2, T3, BORDER, INNER_BG } from './ui';

export function StepReview({ rows, creatives, onEdit, pageId, pageName, igUsername, instagramOn, t }: {
  rows: Array<{ label: string; value: string; step: number }>;
  creatives: DraftCreative[];
  onEdit: (step: number) => void;
  pageId?: string | null; pageName?: string | null; igUsername?: string | null; instagramOn: boolean;
  t: (k: string) => string;
}) {
  return (
    <div className="space-y-5">
      <StepHeader title={t('ads.w.review.title')} intro={t('ads.w.review.intro')} />
      <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${BORDER}`, background: INNER_BG }}>
        {rows.map((r, i) => (
          <div key={r.label} className="flex items-start gap-3 px-4 py-3.5" style={{ borderTop: i ? `1px solid ${BORDER}` : undefined }}>
            <span className="w-32 sm:w-40 flex-shrink-0 pt-0.5" style={{ color: T3, fontSize: 12.5, fontWeight: 600 }}>{r.label}</span>
            <span className="flex-1 min-w-0" style={{ color: T1, fontSize: 14, lineHeight: 1.45 }}>{r.value}</span>
            <button type="button" onClick={() => onEdit(r.step)} className="h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 cursor-pointer hover:bg-white/[0.06] transition-colors duration-150" style={{ color: T3 }} aria-label={t('ads.w.review.edit')}><Pencil className="w-4 h-4" /></button>
          </div>
        ))}
      </div>
      <div>
        <p className="mb-2" style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{t('ads.w.review.creatives').replace('{n}', String(creatives.length))}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {creatives.map((c, i) => (
            <div key={c.id} className="space-y-1.5">
              <p style={{ color: T2, fontSize: 12.5, fontWeight: 600 }}>{t('ads.w.creative.n').replace('{n}', String(i + 1))} · {t(`ads.w.format.${c.format}`)}</p>
              <AdPreview creative={c} pageId={pageId} pageName={pageName} igUsername={igUsername} instagramOn={instagramOn} t={t} />
            </div>
          ))}
        </div>
      </div>
      <Tip tone="pos"><ShieldCheck className="w-4 h-4 inline mr-1.5 -mt-0.5" />{t('ads.wizard.reviewNote')}</Tip>
    </div>
  );
}
