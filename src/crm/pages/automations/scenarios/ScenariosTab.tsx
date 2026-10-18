/**
 * Automatisations › Scénarios (`/crm/automations?tab=scenarios`) : la liste
 * (état, entrés, objectif atteint, verdict du témoin), la galerie des
 * modèles qui montrent l'analyse au travail, et les gestes courts (ouvrir,
 * dupliquer, pause, archiver, supprimer un brouillon jamais publié).
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { CtaButton, Modal, Skel } from '@/crm/ui/kit';
import { EASE } from '@/crm/ui/motion';
import { useCrmToast } from '@/crm/ui/toast';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps, useCrmScope } from '@/crm/scope';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { holdoutVerdict } from '@/crm/lib/holdout';
import { createScenarioEmail, scnErrorCode, useScenarioActions, useScenarios, type ScnRow } from '@/crm/data/scenarios';
import { SCENARIO_TEMPLATES, TEMPLATE_EMAILS, TEMPLATE_SMS, blankScenario, buildScenarioTemplate, type ScenarioTemplateKey } from '@/crm/lib/scenarioTemplates';
import type { T } from './scnText';
import { SmallButton, StateBadge } from './scnUi';

export function ScenariosTab({ galleryOpen, setGalleryOpen }: { galleryOpen: boolean; setGalleryOpen: (v: boolean) => void }) {
  const T = useCrmT();
  const { t } = T;
  const caps = useCrmCaps();
  const q = useScenarios();
  const act = useScenarioActions();
  const toast = useCrmToast();
  const nav = useNavigate();
  const [showArchived, setShowArchived] = useState(false);
  const d = q.data;
  const rows = d?.scenarios ?? [];
  const live = rows.filter((r) => r.status !== 'archived');
  const archived = rows.filter((r) => r.status === 'archived');
  const canEdit = caps.write && !!d?.can_edit;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast(t(ok)); } catch (e) {
      const c = scnErrorCode(e);
      toast(t(c === 'support_session' ? 'yc.scn.err.support' : c === 'published' ? 'yc.scn.err.published' : 'yc.scn.err.generic'));
    }
  };

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {q.isError && !d && <CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} />}
      {!d && !q.isError && (
        <div style={{ display: 'grid', gap: 12 }}>{[0, 1, 2].map((i) => <Skel key={i} h={96} r={20} />)}</div>
      )}
      {d && live.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 'clamp(20px,2.4vw,32px)', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', animation: `yc-in-blur 600ms ${EASE} both` }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 680 }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.02em' }}>{t('yc.scn.list.emptyT')}</h2>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t('yc.scn.list.emptyS')}</p>
          </div>
          <Gallery T={T} canEdit={canEdit} inline onDone={(id) => nav(CRM_ROUTES.scenario(id))} />
        </div>
      )}
      {live.map((r, i) => <Row key={r.id} T={T} r={r} i={i} canEdit={canEdit} onAct={run} act={act} />)}
      {archived.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Hv as="button" type="button" onClick={() => setShowArchived((v) => !v)} style={{ alignSelf: 'flex-start', border: 0, background: 'none', padding: 0, fontSize: 14, fontWeight: 600, color: 'var(--sand-600)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }} hover={{ color: 'var(--ink)' }}>
            <Icon name={showArchived ? 'chevronUp' : 'chevronDown'} size={15} stroke={2.4} />{T.tp('yc.scn.list.archived', archived.length)}
          </Hv>
          {showArchived && archived.map((r, i) => <Row key={r.id} T={T} r={r} i={i} canEdit={false} onAct={run} act={act} />)}
        </div>
      )}
      {galleryOpen && (
        <Modal open onClose={() => setGalleryOpen(false)} width={880} label={t('yc.scn.gal.title')}>
          <div style={{ padding: 'clamp(18px,3vw,28px)', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.02em' }}>{t('yc.scn.gal.title')}</h2>
                <span style={{ fontSize: 14, color: 'var(--sand-500)' }}>{t('yc.scn.gal.sub')}</span>
              </div>
              <Hv as="button" type="button" onClick={() => setGalleryOpen(false)} aria-label={t('yc.scn.close')} style={{ flex: 'none', width: 36, height: 36, border: 0, borderRadius: 99, background: 'var(--sand-100)', color: 'var(--sand-600)', cursor: 'pointer', display: 'grid', placeItems: 'center' }} hover={{ background: 'var(--sand-200)' }}>
                <Icon name="x" size={16} stroke={2.4} />
              </Hv>
            </div>
            <Gallery T={T} canEdit={canEdit} onDone={(id) => { setGalleryOpen(false); nav(CRM_ROUTES.scenario(id)); }} />
          </div>
        </Modal>
      )}
    </section>
  );
}

function Row({ T, r, i, canEdit, onAct, act }: {
  T: T; r: ScnRow; i: number; canEdit: boolean; act: ReturnType<typeof useScenarioActions>;
  onAct: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
}) {
  const { t, n, dShort } = T;
  const nav = useNavigate();
  const v = r.version > 0 ? (r.measure.demo ? 'demo' : holdoutVerdict(r.measure)) : null;
  return (
    <article style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '18px 20px', borderRadius: 22, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', animation: `yc-in-blur 600ms ${EASE} ${Math.min(i, 6) * 60}ms both`, minWidth: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px' }}>
        <Hv as="button" type="button" onClick={() => nav(CRM_ROUTES.scenario(r.id))} style={{ flex: '1 1 220px', minWidth: 0, textAlign: 'left', border: 0, background: 'none', padding: 0, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 3 }} hover={{ color: 'var(--red-600)' }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 19, letterSpacing: '-.02em', overflowWrap: 'anywhere' }}>{r.name}</span>
          <span style={{ fontSize: 13.5, color: 'var(--sand-500)' }}>{r.trigger ? t(`yc.scn.trg.${r.trigger}`) : '—'} · {t('yc.scn.list.updated', { d: dShort(r.updated_at) })}</span>
        </Hv>
        <StateBadge state={r.state} label={t(`yc.scn.state.${r.state}`)} />
        {r.has_changes && <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--amber-700)' }}>{t('yc.scn.ed.changes')}</span>}
        {r.ai_author && <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--sand-600)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="sparkles" size={13} stroke={2.2} />{t('yc.scn.byAi', { ai: r.ai_author })}</span>}
      </div>
      {r.version > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', fontSize: 13.5, color: 'var(--sand-700)', fontVariantNumeric: 'tabular-nums' }}>
          <span><b style={{ color: 'var(--ink)' }}>{n(r.entered)}</b> {t('yc.scn.list.entered')}</span>
          <span><b style={{ color: 'var(--ink)' }}>{n(r.active)}</b> {t('yc.scn.list.active')}</span>
          <span><b style={{ color: 'var(--ink)' }}>{n(r.goal)}</b> {t('yc.scn.list.goal')}</span>
          {v && <span style={{ color: v === 'gain' ? 'var(--green-700)' : v === 'loss' ? 'var(--amber-700)' : 'var(--sand-600)', fontWeight: v === 'gain' || v === 'loss' ? 600 : 500 }}>{t(`yc.scn.verdict.${v}`, { x: n(Math.round(r.measure.extra ?? 0)) })}</span>}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <SmallButton tone="dark" icon="edit" onClick={() => nav(CRM_ROUTES.scenario(r.id))}>{t(canEdit ? 'yc.scn.list.open' : 'yc.scn.list.view')}</SmallButton>
        {canEdit && <SmallButton icon="copy" onClick={() => void onAct(async () => { const id = await act.duplicate(r.id, t('yc.scn.list.copyName', { name: r.name })); nav(CRM_ROUTES.scenario(id)); }, 'yc.scn.list.duplicated')}>{t('yc.scn.list.duplicate')}</SmallButton>}
        {canEdit && r.status === 'active' && <SmallButton icon="pause" onClick={() => void onAct(() => act.setStatus(r.id, 'paused'), 'yc.scn.ed.paused')}>{t('yc.scn.ed.pause')}</SmallButton>}
        {canEdit && r.status === 'paused' && !r.has_changes && <SmallButton icon="play" onClick={() => void onAct(() => act.setStatus(r.id, 'active'), 'yc.scn.ed.resumed')}>{t('yc.scn.ed.resume')}</SmallButton>}
        {canEdit && r.version > 0 && r.status !== 'archived' && (
          <SmallButton tone="ghost" onClick={() => { if (window.confirm(t('yc.scn.list.archiveConfirm'))) void onAct(() => act.setStatus(r.id, 'archived'), 'yc.scn.list.archivedOk'); }}>{t('yc.scn.list.archive')}</SmallButton>
        )}
        {canEdit && r.version === 0 && (
          <SmallButton tone="danger" icon="trash" onClick={() => { if (window.confirm(t('yc.scn.list.deleteConfirm'))) void onAct(() => act.remove(r.id), 'yc.scn.list.deleted'); }}>{t('yc.scn.list.delete')}</SmallButton>
        )}
      </div>
    </article>
  );
}

/** Les modèles : chacun crée ses e-mails (modèles CRM), ses textes SMS, puis le brouillon. */
function Gallery({ T, canEdit, onDone, inline }: { T: T; canEdit: boolean; onDone: (id: string) => void; inline?: boolean }) {
  const { t, lang } = T;
  const { space } = useCrmScope();
  const act = useScenarioActions();
  const toast = useCrmToast();
  const [busy, setBusy] = useState<string | null>(null);
  const create = async (key: ScenarioTemplateKey | 'blank') => {
    if (busy || !canEdit) return;
    setBusy(key);
    try {
      const name = t(`yc.scn.tpl.${key}.name`);
      const mail = (kind: Parameters<typeof createScenarioEmail>[0]['kind'], label: string) => createScenarioEmail({
        kind, name: `${name} · ${label}`, venueId: space.venueId, organizerUserId: space.venueId ? null : space.organizerUserId, venueName: space.name, lang, t,
      });
      let graph;
      if (key === 'blank') {
        graph = blankScenario(await mail('annonce', t('yc.scn.node.email')));
      } else {
        const emails: Record<string, string> = {};
        let i = 0;
        for (const [nodeId, kind] of Object.entries(TEMPLATE_EMAILS[key])) {
          i += 1;
          emails[nodeId] = await mail(kind, `${t('yc.scn.node.email')} ${i}`);
        }
        const sms = Object.fromEntries(TEMPLATE_SMS[key].map((nodeId) => [nodeId, t(`yc.scn.tpl.${key}.${nodeId}`)]));
        graph = buildScenarioTemplate(key, emails, sms);
      }
      const r = await act.save({ id: null, name, graph, template: key === 'blank' ? null : key });
      onDone(r.id);
    } catch {
      toast(t('yc.scn.err.generic'));
    } finally { setBusy(null); }
  };
  const keys: (ScenarioTemplateKey | 'blank')[] = [...SCENARIO_TEMPLATES, 'blank'];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill,minmax(min(100%,${inline ? 260 : 240}px),1fr))`, gap: 10 }}>
      {keys.map((k) => {
        const nE = k === 'blank' ? 1 : Object.keys(TEMPLATE_EMAILS[k]).length;
        const nS = k === 'blank' ? 0 : TEMPLATE_SMS[k].length;
        return (
          <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, borderRadius: 18, border: '1px solid var(--sand-200)', background: k === 'blank' ? 'var(--sand-50)' : '#fff', minWidth: 0 }}>
            <span style={{ fontSize: 15.5, fontWeight: 600, lineHeight: 1.3 }}>{t(`yc.scn.tpl.${k}.name`)}</span>
            <span style={{ flex: 1, fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t(`yc.scn.tpl.${k}.d`)}</span>
            <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{T.tp('yc.scn.gal.emails', nE)}{nS ? ` · ${T.tp('yc.scn.gal.sms', nS)}` : ''}</span>
            {canEdit && (
              <CtaButton size="sm" icon={busy === k ? null : 'arrowRight'} onClick={() => void create(k)} disabled={!!busy}>
                {busy === k ? t('yc.scn.gal.creating') : t('yc.scn.gal.use')}
              </CtaButton>
            )}
          </div>
        );
      })}
    </div>
  );
}
