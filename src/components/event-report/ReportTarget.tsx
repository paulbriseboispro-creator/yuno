/**
 * L'objectif de la soirée (plan de simplification, lot 7 — « Shopify
 * Targets ») : le pro dit combien d'entrées il vise, le rapport répond où il
 * en est et, avec une soirée de référence, où il finira au même rythme.
 * C'est la réponse à « vais-je remplir ? » ; le Hype Score ne s'affiche plus
 * en ligne dès qu'un objectif existe (il reste dans la prévision repliée).
 *
 * Mesure : les ATTENDUS avant et pendant la soirée (billets + convives de
 * table + guest list, `totals.door.expected`), les entrées scannées après.
 * L'objectif s'écrit dans `events.entry_target` ; la RLS d'`events` décide qui
 * peut le poser, un refus s'affiche tel quel.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Check, Pencil, Target, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { BulletBar } from '@/components/analytics/kit';
import { KIT, useKpiFormat, useNumberFormat } from '@/components/analytics/kitFormat';
import { paceProjection, targetStatus, todayD, type EventReport } from '@/lib/eventReport';

function fillTpl(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{([a-zA-Z]+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

export function ReportTarget({ report, compare, projection }: {
  report: EventReport;
  compare: EventReport | null;
  /** La prévision Hype en une ligne : affichée seulement tant qu'il n'y a pas d'objectif. */
  projection?: ReactNode;
}) {
  const { t } = useLanguage();
  const { n } = useNumberFormat();
  const fmt = useKpiFormat();
  const [target, setTarget] = useState<number | null>(report.event.entryTarget ?? null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  // Le rafraîchissement du rapport (toutes les minutes) met la valeur à jour
  // sans refermer une saisie en cours ; changer de soirée, lui, la referme.
  useEffect(() => { setTarget(report.event.entryTarget ?? null); }, [report.event.entryTarget]);
  useEffect(() => { setEditing(false); }, [report.event.id]);

  const after = report.event.phase === 'after';
  const status = targetStatus(report, compare, target);

  const save = async (value: number | null) => {
    setSaving(true);
    const { data, error } = await supabase
      .from('events')
      .update({ entry_target: value })
      .eq('id', report.event.id)
      .select('id');
    setSaving(false);
    if (error || !data?.length) {
      toast.error(t('er.tg.saveError'));
      return;
    }
    setTarget(value);
    setEditing(false);
  };

  const openEditor = () => { setDraft(target ? String(target) : ''); setEditing(true); };
  const submit = () => {
    const v = Math.round(Number(draft));
    if (!Number.isFinite(v) || v < 1 || v > 100000) { toast.error(t('er.tg.invalid')); return; }
    void save(v);
  };

  if (editing) {
    return (
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => { e.preventDefault(); submit(); }}
      >
        <label className="inline-flex items-center gap-2 text-[12.5px]" style={{ color: KIT.T2 }}>
          <Target className="h-3.5 w-3.5" aria-hidden />
          {t('er.tg.label')}
          <input
            type="number" inputMode="numeric" min={1} max={100000} autoFocus
            value={draft} onChange={(e) => setDraft(e.target.value)}
            className="w-24 rounded-lg px-2 py-1 text-[13px] tabular-nums"
            style={{ background: 'var(--sf-0a0a0c)', border: `1px solid ${KIT.BORDER}`, color: KIT.T1, outline: 'none' }}
            aria-label={t('er.tg.label')}
          />
        </label>
        <button type="submit" disabled={saving} className="inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[12px] font-semibold text-snow" style={{ background: KIT.RED, opacity: saving ? 0.6 : 1 }}>
          <Check className="h-3.5 w-3.5" aria-hidden />{t('er.tg.save')}
        </button>
        <button type="button" onClick={() => setEditing(false)} className="inline-flex h-7 items-center rounded-lg px-2 text-[12px]" style={{ color: KIT.T3 }}>
          <X className="h-3.5 w-3.5" aria-hidden /><span className="sr-only">{t('er.tg.cancel')}</span>
        </button>
        {target !== null && (
          <button type="button" onClick={() => void save(null)} disabled={saving} className="text-[12px] underline-offset-2 hover:underline" style={{ color: KIT.T3 }}>
            {t('er.tg.remove')}
          </button>
        )}
      </form>
    );
  }

  if (status.kind === 'none') {
    // Sans objectif, le rythme d'une vraie soirée passée répond à « vais-je
    // remplir ? » ; la prévision Hype ne s'affiche que faute de mieux — jamais
    // deux projections différentes côte à côte.
    const pp = paceProjection(report, compare);
    // Après la soirée, on ne pose plus d'objectif : il n'y a plus rien à viser.
    return (
      <>
        {pp ? (
          <p className="text-[12.5px]" style={{ color: KIT.T2 }}>
            {fillTpl(t('er.tg.paceNoTarget'), { title: pp.refTitle, proj: n(pp.projected) })}
          </p>
        ) : projection}
        {!after && (
          <button type="button" onClick={openEditor} className="inline-flex w-fit items-center gap-1.5 text-[12.5px] font-medium" style={{ color: KIT.T2 }}>
            <Target className="h-3.5 w-3.5" aria-hidden />{t('er.tg.set')}
          </button>
        )}
      </>
    );
  }

  const { current, pace: pp } = status;
  const projected = pp?.projected ?? null;
  const pct = fmt((current / status.target) * 100, 'pct');
  const d = Math.max(0, todayD(report));
  const when = d === 0 ? t('er.a.today') : t('er.a.jDay').replace('{d}', String(d));
  const main = fillTpl(t(status.measure === 'entered' ? 'er.tg.afterLine' : 'er.tg.line'), {
    target: n(status.target), n: n(current), pct, when,
  });
  let pace: string | null = null;
  if (after) {
    pace = t(current >= status.target ? 'er.tg.reached' : 'er.tg.missed')
      .replace('{gap}', n(Math.abs(status.target - current)));
  } else if (pp) {
    const gap = pp.projected - status.target;
    pace = fillTpl(t(gap >= 0 ? 'er.tg.paceAhead' : 'er.tg.paceBehind'), {
      title: pp.refTitle, proj: n(pp.projected), gap: n(Math.abs(gap)),
    });
  } else if (!after && current >= status.target) {
    pace = t('er.tg.reachedBefore');
  }
  const good = after ? current >= status.target : projected !== null ? projected >= status.target : current >= status.target;

  return (
    <div className="flex flex-col gap-1.5 border-t pt-3" style={{ borderColor: KIT.BORDER }}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <BulletBar label={t('er.tg.short')} value={current} display={n(current)} capacity={status.target} />
        </div>
        <button type="button" onClick={openEditor} className="flex-none rounded-md p-1" style={{ color: KIT.T3 }} aria-label={t('er.tg.edit')} title={t('er.tg.edit')}>
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <p className="text-[12.5px]" style={{ color: KIT.T2 }}>
        {main}
        {pace && (
          <> <span style={{ color: projected !== null || after ? (good ? KIT.POS : 'var(--acc-f59e0b)') : KIT.T2 }}>{pace}</span></>
        )}
      </p>
    </div>
  );
}
