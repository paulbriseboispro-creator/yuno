/**
 * « Choisissez vos segments » : la fenêtre du catalogue, et la carte qui
 * l'ouvre à la fin d'un import.
 *
 *   SegmentCatalogModal  la fenêtre. Deux vues : « Recommandés » (les modèles
 *                        qui aident le plus à vendre la prochaine soirée, à
 *                        partir de 10 personnes) et « Tous les segments »
 *                        (dix familles). Après un import, les recommandés sont
 *                        cochés d'office ; tout se décoche.
 *   SegmentsNextStep     la carte « Étape suivante » de la fin d'import (fichier
 *                        ou premier import Shotgun) ; elle ouvre la fenêtre
 *                        seule quand une recommandation attend.
 *
 * Effectifs et seuils : crm_segment_catalog (une lecture). Création :
 * crm_segments_create_many (un modèle déjà créé n'est jamais doublé).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Modal, Segmented, Skel } from '@/crm/ui/kit';
import { YunitFace } from '@/crm/ui/YunitFace';
import { EASE, SPRING } from '@/crm/ui/motion';
import { useCrmToast } from '@/crm/ui/toast';
import { useNarrow } from '@/crm/ui/useNarrow';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps } from '@/crm/scope';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { useCreateSegments, useSegmentCatalog } from '@/crm/data/segmentCatalog';
import { useAnalysisOverview } from '@/crm/data/analysis';
import { supportedForSegments } from '@/crm/lib/analysis';
import {
  catalogEntries, countryNamer, coveragePct, groupEntries, hasNewRecommendation, recommendedEntries, selectable, toCreateItems,
} from '@/crm/lib/segmentCatalog';
import type { CatalogEntry } from '@/crm/lib/segmentCatalog';
import type { SegGroupKey } from '@/crm/lib/segments';

export type CatalogContext = 'file' | 'shotgun' | 'manual';

const GRAD_TEXT: CSSProperties = { background: 'var(--gradient-brand)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' };

export function SegmentCatalogModal({
  open, onClose, context, preselect = context !== 'manual', onCreated,
}: {
  open: boolean;
  onClose: () => void;
  context: CatalogContext;
  /** Coche d'office les recommandations (après un import, depuis l'accueil). */
  preselect?: boolean;
  onCreated?: (created: { template: string; id: string }[]) => void;
}) {
  const T = useCrmT();
  const { t, tp, n, eur, pct, lang } = T;
  const toast = useCrmToast();
  const caps = useCrmCaps();
  const cat = useSegmentCatalog(open);
  const create = useCreateSegments();
  const country = useMemo(() => countryNamer(lang), [lang]);
  const phone = useNarrow(600);

  // « Ce qui fait venir » : recommandé seulement si l'hypothèse est confirmée sur le compte.
  const an = useAnalysisOverview(open);
  const supported = useMemo(() => supportedForSegments(an.data?.families ?? []), [an.data]);
  const entries = useMemo(() => (cat.data ? catalogEntries(cat.data, { t, eur, country, supported }) : []), [cat.data, t, eur, country, supported]);
  const recs = useMemo(() => recommendedEntries(entries), [entries]);
  const groups = useMemo(() => groupEntries(entries), [entries]);
  const recBases = useMemo(() => new Set(entries.filter((e) => e.idea !== null).map((e) => e.base)), [entries]);

  const [view, setView] = useState<'rec' | 'all'>(preselect ? 'rec' : 'all');
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const seeded = useRef(false);

  // À chaque ouverture : on repart de zéro, puis on coche les recommandations dès qu'elles arrivent.
  useEffect(() => {
    if (!open) return;
    seeded.current = false;
    setSel(new Set());
    setView(preselect ? 'rec' : 'all');
  }, [open, preselect]);
  useEffect(() => {
    if (!open || seeded.current || !cat.data) return;
    seeded.current = true;
    if (preselect && recs.length) setSel(new Set(recs.map((e) => e.key)));
    if (!recs.length && !recBases.size) setView('all');
  }, [open, cat.data, preselect, recs, recBases]);

  const toggle = (e: CatalogEntry) => {
    if (!selectable(e)) return;
    setSel((s) => {
      const next = new Set(s);
      if (next.has(e.key)) next.delete(e.key); else next.add(e.key);
      return next;
    });
  };
  const setGroup = (list: CatalogEntry[], on: boolean) => {
    setSel((s) => {
      const next = new Set(s);
      list.filter(selectable).forEach((e) => { if (on) next.add(e.key); else next.delete(e.key); });
      return next;
    });
  };

  const count = Array.from(sel).filter((k) => entries.some((e) => e.key === k && selectable(e))).length;
  const canCreate = caps.write && count > 0 && !create.isPending;
  const submit = () => {
    if (!canCreate) return;
    create.mutate(toCreateItems(entries, sel), {
      onSuccess: (r) => {
        const made = r.created.length;
        if (made) toast(tp('yc.segcat.created', made, { n: n(made) }));
        onCreated?.(r.created);
        onClose();
      },
      onError: () => toast(t('yc.segcat.createFailed')),
    });
  };

  const total = cat.data?.total ?? 0;
  const eyebrow = t(`yc.segcat.eyebrow.${context}`);
  const sub = cat.data ? tp(preselect ? 'yc.segcat.sub' : 'yc.segcat.subManual', total, { n: n(total) }) : '';
  const recEmptyKey = recBases.size && entries.some((e) => recBases.has(e.base) && e.existing) && !recs.length ? 'yc.segcat.recDone' : 'yc.segcat.recEmpty';

  const note = (g: SegGroupKey): string | null => {
    const d = cat.data;
    if (!d) return null;
    if (g === 'next' && !d.has_next_event) return t('yc.segcat.noNext');
    if (g === 'people') {
      if (!d.coverage.age && !d.coverage.gender) return t('yc.segcat.cov.noPeople');
      const parts = [];
      if (d.coverage.age) parts.push(t('yc.segcat.cov.age', { pct: pct(coveragePct(d.coverage.age, d.total)) }));
      if (d.coverage.gender) parts.push(t('yc.segcat.cov.gender', { pct: pct(coveragePct(d.coverage.gender, d.total)) }));
      return parts.join(' ');
    }
    if (g === 'geo' && d.coverage.area) return t('yc.segcat.cov.area', { pct: pct(coveragePct(d.coverage.area, d.total)) });
    return null;
  };

  return (
    <Modal open={open} onClose={onClose} width={880} label={t('yc.segcat.label')}>
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
        {/* En-tête */}
        <div style={{ position: 'relative', overflow: 'hidden', display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '16px 22px', padding: 'clamp(22px,3vw,32px) clamp(20px,3vw,32px) 18px', background: 'radial-gradient(120% 140% at 100% 0%, var(--red-50) 0%, rgba(255,255,255,0) 55%)' }}>
          <div style={{ flex: '1 1 380px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: context === 'manual' ? 'var(--sand-500)' : 'var(--green-700)' }}>
              {context !== 'manual' && <span style={{ width: 18, height: 18, borderRadius: 99, background: 'var(--green-500)', color: '#fff', display: 'grid', placeItems: 'center' }}><Icon name="check" size={11} stroke={3.2} /></span>}
              {eyebrow}
            </span>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(26px,3vw,32px)', lineHeight: 1.06, letterSpacing: '-.035em', textWrap: 'balance' }}>
              {t('yc.segcat.title1')}<span style={GRAD_TEXT}>{t('yc.segcat.accent')}</span>{t('yc.segcat.title2')}
            </h2>
            <span style={{ minHeight: 21, fontSize: 15, lineHeight: 1.45, color: 'var(--sand-600)', textWrap: 'pretty', maxWidth: 560 }}>
              {cat.data ? sub : <Skel w={360} h={16} />}
            </span>
          </div>
          {!phone && (
            <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, marginRight: 30 }}>
              <YunitFace mood={context === 'manual' ? 'content' : 'ravi'} size={60} />
            </div>
          )}
          <Hv
            as="button" type="button" onClick={onClose} aria-label={t('yc.segcat.later')}
            style={{ position: 'absolute', top: 14, right: 14, width: 36, height: 36, border: 0, borderRadius: 99, background: 'rgba(255,255,255,.7)', color: 'var(--sand-600)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}
            hover={{ background: 'var(--sand-100)', color: 'var(--ink)' }}
          >
            <Icon name="x" size={18} stroke={2.4} />
          </Hv>
        </div>

        {/* Vues */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '4px clamp(20px,3vw,32px) 14px' }}>
          <Segmented<'rec' | 'all'>
            ariaLabel={t('yc.segcat.tabs')}
            value={view}
            onChange={setView}
            options={[
              { value: 'rec', label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="sparkles" size={14} stroke={2.2} />{t('yc.segcat.tab.rec')}{cat.data ? <Small>{n(recs.length)}</Small> : null}</span> },
              { value: 'all', label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{t(phone ? 'yc.segcat.tab.allShort' : 'yc.segcat.tab.all')}{cat.data ? <Small>{n(entries.length)}</Small> : null}</span> },
            ]}
          />
          {cat.data && view === 'rec' && recs.length > 0 && (
            <span style={{ flex: '1 1 260px', fontSize: 13, lineHeight: 1.4, color: 'var(--sand-500)', textWrap: 'pretty' }}>{t('yc.segcat.recWhy')}</span>
          )}
        </div>

        {/* Corps */}
        <div style={{ padding: '0 clamp(20px,3vw,32px) 22px', display: 'flex', flexDirection: 'column', gap: 22 }}>
          {cat.isError && !cat.data && <CrmLoadError error={cat.error} onRetry={() => void cat.refetch()} retrying={cat.isFetching} />}
          {!cat.data && !cat.isError && (
            <div aria-busy="true" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,300px),1fr))', gap: 10 }}>
              {[0, 1, 2, 3, 4, 5].map((i) => <Skel key={i} h={96} r={18} />)}
            </div>
          )}
          {cat.data && view === 'rec' && (
            recs.length ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,360px),1fr))', gap: 10 }}>
                {recs.map((e, i) => <Card key={e.key} e={e} on={sel.has(e.key)} onToggle={() => toggle(e)} showIdea badge={false} delay={i * 40} />)}
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 18px', padding: '18px 20px', borderRadius: 20, background: 'var(--sand-50)', boxShadow: 'inset 0 0 0 1px var(--sand-100)' }}>
                <span style={{ flex: '1 1 320px', fontSize: 14.5, lineHeight: 1.45, color: 'var(--sand-700)' }}>{t(recEmptyKey)}</span>
                <Hv as="button" type="button" onClick={() => setView('all')} style={{ height: 40, padding: '0 16px', borderRadius: 99, border: 0, background: 'var(--ink)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }} hover={{ background: 'var(--sand-700)' }}>
                  {t('yc.segcat.seeAll')}
                </Hv>
              </div>
            )
          )}
          {cat.data && view === 'all' && groups.map((g) => {
            const pickable = g.entries.filter(selectable);
            const allOn = pickable.length > 0 && pickable.every((e) => sel.has(e.key));
            const nt = note(g.group);
            return (
              <section key={g.group} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '4px 16px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, letterSpacing: '-.02em' }}>{t(`yc.segcat.g.${g.group}`)}</span>
                    <span style={{ fontSize: 13, lineHeight: 1.4, color: 'var(--sand-500)' }}>{t(`yc.segcat.g.${g.group}.s`)}{nt ? ` · ${nt}` : ''}</span>
                  </div>
                  {caps.write && pickable.length > 1 && (
                    <button type="button" onClick={() => setGroup(pickable, !allOn)} style={{ border: 0, background: 'none', padding: '4px 0', fontSize: 13, fontWeight: 600, color: 'var(--red-600)', cursor: 'pointer' }}>
                      {t(allOn ? 'yc.segcat.clearGroup' : 'yc.segcat.selectGroup')}
                    </button>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,300px),1fr))', gap: 10 }}>
                  {g.entries.map((e) => <Card key={e.key} e={e} on={sel.has(e.key)} onToggle={() => toggle(e)} />)}
                </div>
              </section>
            );
          })}
          {cat.data && view === 'all' && context === 'manual' && (
            <Hv as={Link} to={CRM_ROUTES.clients} onClick={onClose} style={{ alignSelf: 'flex-start', fontSize: 14, fontWeight: 600, color: 'var(--ink)', display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }} hover={{ color: 'var(--red-600)', textDecoration: 'none' }}>
              {t('yc.seg.nw.fine')}<Icon name="arrowRight" size={14} stroke={2.4} />
            </Hv>
          )}
        </div>

        {/* Pied */}
        <div style={{ position: 'sticky', bottom: 0, zIndex: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '10px 16px', padding: '14px clamp(20px,3vw,32px)', background: 'rgba(250,248,246,.94)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', borderTop: '1px solid var(--sand-100)', borderRadius: '0 0 28px 28px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 14.5, fontWeight: 600, color: count ? 'var(--ink)' : 'var(--sand-500)' }}>
              {caps.write ? (count ? tp('yc.segcat.sel', count, { n: n(count) }) : t('yc.segcat.selNone')) : t('yc.segcat.readOnly')}
            </span>
            {caps.write && count > 0 && <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.segcat.rename')}</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
            <Hv as="button" type="button" onClick={onClose} style={{ height: 46, padding: phone ? '0 8px' : '0 16px', borderRadius: 99, border: 0, background: 'none', fontSize: 14.5, fontWeight: 600, color: 'var(--sand-600)', cursor: 'pointer', whiteSpace: 'nowrap' }} hover={{ color: 'var(--ink)' }}>
              {t(context === 'manual' ? 'yc.common.cancel' : 'yc.segcat.later')}
            </Hv>
            {caps.write && (
              <Hv
                as="button" type="button" onClick={submit} disabled={!canCreate}
                style={{ height: 46, padding: canCreate ? '0 5px 0 22px' : '0 22px', borderRadius: 99, border: 0, background: canCreate ? 'var(--gradient-brand)' : 'var(--sand-100)', color: canCreate ? '#fff' : 'var(--sand-400)', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 12, boxShadow: canCreate ? 'var(--shadow-cta)' : 'none', cursor: canCreate ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap', transition: `transform 200ms ${SPRING},filter 160ms` }}
                hover={{ filter: 'brightness(1.05)', transform: 'translateY(-1px)' }}
                active={{ transform: 'scale(.97)' }}
              >
                {create.isPending ? t('yc.segcat.creating') : count ? tp('yc.segcat.create', count, { n: n(count) }) : t('yc.segcat.createZero')}
                {canCreate && <span style={{ width: 36, height: 36, borderRadius: 99, background: '#fff', color: 'var(--red-500)', display: 'grid', placeItems: 'center' }}><Icon name="arrowRight" size={16} stroke={2.4} /></span>}
              </Hv>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Small({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--sand-500)', fontVariantNumeric: 'tabular-nums' }}>{children}</span>;
}

/**
 * Une carte du catalogue : case à cocher, nom, règle, effectif, badge
 * « Recommandé » (inutile dans la vue Recommandés, où tout l'est).
 */
function Card({ e, on, onToggle, showIdea = false, badge = true, delay = 0 }: { e: CatalogEntry; on: boolean; onToggle: () => void; showIdea?: boolean; badge?: boolean; delay?: number }) {
  const { t, tp, n } = useCrmT();
  const caps = useCrmCaps();
  const pickable = selectable(e) && caps.write;
  const empty = e.n === 0;
  const dim = !selectable(e) || empty;
  return (
    <Hv
      as="button"
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-disabled={!pickable}
      onClick={() => { if (pickable) onToggle(); }}
      style={{
        textAlign: 'left', display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 16px', borderRadius: 18,
        border: 0, boxShadow: `inset 0 0 0 ${on ? 2 : 1}px ${on ? 'var(--ink)' : e.rec ? 'var(--red-200)' : 'var(--sand-200)'}`,
        background: on ? 'var(--sand-50)' : '#fff', color: 'var(--ink)', cursor: pickable ? 'pointer' : 'default',
        opacity: dim ? 0.62 : 1, transition: 'box-shadow 160ms,background 160ms', font: 'inherit',
        animation: `yc-rise 420ms ${EASE} both`, animationDelay: `${delay}ms`,
      }}
      hover={pickable && !on ? { boxShadow: `inset 0 0 0 1.5px ${e.rec ? 'var(--red-300)' : 'var(--sand-400)'}` } : undefined}
    >
      <span aria-hidden style={{ flex: 'none', marginTop: 1, width: 22, height: 22, borderRadius: 7, border: `1.5px solid ${on ? 'var(--ink)' : e.existing ? 'var(--green-500)' : 'var(--sand-300)'}`, background: on ? 'var(--ink)' : e.existing ? 'var(--green-50)' : '#fff', color: on ? '#fff' : 'var(--green-700)', display: 'grid', placeItems: 'center', transition: 'background 160ms,border-color 160ms' }}>
        {(on || e.existing) && <Icon name="check" size={13} stroke={3} />}
      </span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px' }}>
          <span style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.3 }}>{e.name}</span>
          {badge && e.rec && (
            <span style={{ height: 22, padding: '0 9px 0 7px', borderRadius: 99, background: 'var(--gradient-brand)', color: '#fff', fontSize: 11.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4, boxShadow: '0 2px 8px -2px rgba(232,25,44,.45)', whiteSpace: 'nowrap' }}>
              <Icon name="sparkles" size={12} stroke={2.4} />{t('yc.segcat.badge')}
            </span>
          )}
        </span>
        <span style={{ fontSize: 13, lineHeight: '18px', color: 'var(--sand-500)', textWrap: 'pretty' }}>{e.rule}</span>
        {showIdea && e.idea && (
          <span style={{ marginTop: 4, fontSize: 13, lineHeight: '18px', color: 'var(--sand-700)', textWrap: 'pretty' }}>
            <b style={{ fontWeight: 600, color: 'var(--red-600)' }}>{t('yc.segcat.idea')} · </b>{e.idea}
          </span>
        )}
      </span>
      <span style={{ flex: 'none', textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
        {empty ? (
          <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--sand-500)', whiteSpace: 'nowrap' }}>{t('yc.segcat.nobody')}</span>
        ) : (
          <>
            <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, lineHeight: 1.1, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' }}>{n(e.n)}</b>
            <span style={{ fontSize: 12, color: 'var(--sand-500)', whiteSpace: 'nowrap' }}>
              {e.existing ? t('yc.seg.nw.done') : e.disabled ? '—' : tp('yc.segcat.people', e.n)}
            </span>
            {!e.existing && e.reachable < e.n && <span style={{ fontSize: 11.5, color: 'var(--sand-400)', whiteSpace: 'nowrap' }}>{t('yc.segcat.reach', { n: n(e.reachable) })}</span>}
          </>
        )}
      </span>
    </Hv>
  );
}

/**
 * Carte « Étape suivante » de la fin d'un import. `autoOpen` : ouvre la
 * fenêtre d'elle-même, une fois, quand une recommandation attend (jamais
 * quand tout est déjà créé — un import de plus ne doit pas harceler).
 */
export function SegmentsNextStep({ context, autoOpen }: { context: 'file' | 'shotgun'; autoOpen: boolean }) {
  const { t, tp, n } = useCrmT();
  const caps = useCrmCaps();
  const cat = useSegmentCatalog(caps.write);
  const [open, setOpen] = useState(false);
  const [made, setMade] = useState(0);
  const opened = useRef(false);
  useEffect(() => {
    if (!autoOpen || opened.current || !caps.write || !hasNewRecommendation(cat.data)) return;
    opened.current = true;
    const h = window.setTimeout(() => setOpen(true), 700);
    return () => window.clearTimeout(h);
  }, [autoOpen, caps.write, cat.data]);
  if (!caps.write) return null;
  return (
    <>
      <div style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '14px 18px', padding: '18px 20px', borderRadius: 22, background: 'linear-gradient(#fff,#fff) padding-box, var(--gradient-brand) border-box', border: '1.5px solid transparent', boxShadow: 'var(--shadow-sm)', animation: `yc-rise 520ms ${EASE} both` }}>
        <span style={{ flex: 'none', width: 44, height: 44, borderRadius: 14, background: 'var(--gradient-brand)', color: '#fff', display: 'grid', placeItems: 'center', boxShadow: 'var(--shadow-cta)' }}>
          <Icon name="sparkles" size={20} stroke={2.2} />
        </span>
        <span style={{ flex: '1 1 280px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--red-600)' }}>{t('yc.segcat.next.k')}</span>
          <span style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.3 }}>{made ? tp('yc.segcat.next.done', made, { n: n(made) }) : t('yc.segcat.next.title')}</span>
          {!made && <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t('yc.segcat.next.body')}</span>}
        </span>
        {made ? (
          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 14px' }}>
            <Hv as={Link} to={CRM_ROUTES.segments} style={{ height: 42, padding: '0 18px', borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 14.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none' }} hover={{ background: 'var(--sand-700)', color: '#fff', textDecoration: 'none' }}>
              {t('yc.segcat.next.see')}<Icon name="arrowRight" size={15} stroke={2.4} />
            </Hv>
            <button type="button" onClick={() => setOpen(true)} style={{ border: 0, background: 'none', padding: 0, fontSize: 14, fontWeight: 600, color: 'var(--sand-600)', cursor: 'pointer' }}>{t('yc.segcat.next.more')}</button>
          </span>
        ) : (
          <Hv as="button" type="button" onClick={() => setOpen(true)} style={{ height: 42, padding: '0 18px', borderRadius: 99, border: 0, background: 'var(--ink)', color: '#fff', fontSize: 14.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', whiteSpace: 'nowrap' }} hover={{ background: 'var(--sand-700)' }}>
            {t('yc.segcat.next.cta')}<Icon name="arrowRight" size={15} stroke={2.4} />
          </Hv>
        )}
      </div>
      <SegmentCatalogModal open={open} onClose={() => setOpen(false)} context={context} onCreated={(c) => setMade((m) => m + c.length)} />
    </>
  );
}
