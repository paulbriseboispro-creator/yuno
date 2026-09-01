import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, ChevronLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { StoreApi } from 'zustand';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  campaignToTemplateContent, migrateV1Audience, migrateV1Blocks, migrateV1SocialLinks,
  migrateV1Theme, normalizeTheme, normalizeV2Blocks,
  type AudienceExclusions, type AudienceSel, type EmailBlock, type SocialLinks, type StudioCampaign,
} from '@/lib/email';
import {
  createStudioStore, StudioStoreContext, useStudio, useStudioApi,
  type StudioState, type StudioStep,
} from './store';
import {
  useEmailTemplates, useSavedSegments, useStudioEvents, useStudioLiveData, type StudioScope,
} from './hooks';
import {
  StudioGlobalStyles, APP_BG, BORDER, FONT_UI, GhostBtn, PANEL_BG, PAGE_HALO,
  PrimaryBtn, RED, SUBTLE, T1, T2, T3, TOPBAR_BG, UnderlineTabs,
} from './ui';
import TopBar from './TopBar';
import BlockPalette from './BlockPalette';
import CanvasColumn from './Canvas';
import Inspector from './Inspector';
import ThemePanel from './ThemePanel';
import DataPanel from './DataPanel';
import TestEmailDialog from './TestEmailDialog';
import AudienceStep from './AudienceStep';
import ScheduleStep from './ScheduleStep';
import ReviewStep from './ReviewStep';
import SendingStep from './SendingStep';
import TemplateGallery from './TemplateGallery';
import SaveTemplateDialog from './TemplateDialogs';

interface Props {
  scope: StudioScope;
  basePath: string;
}

interface CampaignRow {
  id: string;
  name: string;
  type: string;
  status: string;
  subject: string;
  subject_b: string | null;
  ab_enabled: boolean | null;
  preheader: string | null;
  blocks_json: unknown;
  blocks_version: number | null;
  theme_json: unknown;
  social_links_json: unknown;
  logo_url: string | null;
  event_id: string | null;
  audience_type: string | null;
  segment_id: string | null;
  audiences_json: unknown;
  exclusions_json: unknown;
  scheduled_at: string | null;
  throttle_per_hour: number | null;
  quiet_hours: boolean | null;
}

function rowToCampaign(row: CampaignRow, venueName: string): StudioCampaign {
  const isV2 = Number(row.blocks_version || 1) >= 2;
  const blocks: EmailBlock[] = isV2
    ? normalizeV2Blocks(row.blocks_json)
    : migrateV1Blocks(row.blocks_json, venueName);
  const theme = isV2 ? normalizeTheme(row.theme_json) : migrateV1Theme(row.theme_json);
  const rawAudiences = Array.isArray(row.audiences_json) ? (row.audiences_json as AudienceSel[]) : [];
  const audiences = rawAudiences.length > 0
    ? rawAudiences
    : migrateV1Audience(row.audience_type, row.segment_id);
  const rawExcl = (row.exclusions_json && typeof row.exclusions_json === 'object'
    ? row.exclusions_json : {}) as AudienceExclusions;

  const toLocalInput = (iso: string | null): string | null => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()) || d.getTime() < Date.now()) return null;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  return {
    id: row.id,
    name: row.name,
    type: row.type === 'informational' ? 'informational' : 'promotional',
    status: row.status,
    subject: row.subject === '—' ? '' : row.subject || '',
    subjectB: row.subject_b || '',
    abOn: !!row.ab_enabled,
    preheader: row.preheader || '',
    blocks,
    theme,
    socialLinks: isV2 ? ((row.social_links_json || {}) as SocialLinks) : migrateV1SocialLinks(row.social_links_json),
    logoUrl: row.logo_url,
    eventId: row.event_id,
    audiences,
    exclusions: rawExcl,
    scheduledAt: toLocalInput(row.scheduled_at),
    throttlePerHour: row.throttle_per_hour,
    quietHours: !!row.quiet_hours,
  };
}

/** audience_type héritée : miroir de la sélection v2 pour la compat lecture. */
function legacyAudienceType(c: StudioCampaign): { audience_type: string | null; segment_id: string | null } {
  if (c.type === 'informational') {
    const kind = c.audiences[0]?.kind || 'event_buyers';
    return { audience_type: kind, segment_id: null };
  }
  if (c.audiences.length === 1) {
    const a = c.audiences[0];
    if (a.kind === 'segment') return { audience_type: 'custom_segment', segment_id: a.segmentId || null };
    // 'imported_list' n'a AUCUN chemin de résolution v1 : si audiences_json
    // se vidait, la campagne ne partirait à personne — jamais à toute la base.
    if (a.kind === 'import') return { audience_type: 'imported_list', segment_id: null };
    return { audience_type: a.kind, segment_id: null };
  }
  return { audience_type: c.audiences.length > 0 ? 'all_subscribers' : null, segment_id: null };
}

function campaignToRow(c: StudioCampaign, scope: StudioScope): Record<string, unknown> {
  const legacy = legacyAudienceType(c);
  const payload: Record<string, unknown> = {
    name: c.name || 'Campagne',
    type: c.type,
    subject: c.subject || '—',
    subject_b: c.abOn ? (c.subjectB || null) : null,
    ab_enabled: c.abOn && !!c.subjectB.trim(),
    preheader: c.preheader,
    blocks_json: c.blocks,
    blocks_version: 2,
    theme_json: c.theme,
    social_links_json: c.socialLinks,
    logo_url: c.logoUrl,
    event_id: c.eventId,
    audiences_json: c.type === 'promotional' ? c.audiences : [],
    exclusions_json: c.exclusions,
    audience_type: legacy.audience_type,
    scheduled_at: c.scheduledAt ? new Date(c.scheduledAt).toISOString() : null,
    throttle_per_hour: c.throttlePerHour,
    quiet_hours: c.quietHours,
  };
  if (scope.kind === 'venue') payload.segment_id = legacy.segment_id;
  return payload;
}

const STEP_ORDER: StudioStep[] = ['studio', 'audience', 'schedule', 'review', 'sending'];

export default function StudioShell({ scope, basePath }: Props) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const params = useParams<{ id: string }>();
  const isNew = !params.id || params.id === 'new';

  const [store, setStore] = useState<StoreApi<StudioState> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Chargement ─────────────────────────────────────────────────────────────
  // Une campagne neuve passe d'abord par la galerie de modèles : c'est elle qui
  // insère la ligne, avec le design choisi et la soirée du moment.
  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from('email_campaigns')
        .select('*').eq('id', params.id!).maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setLoadError(error?.message || t('studio.loadError'));
        return;
      }
      const campaign = rowToCampaign(data as unknown as CampaignRow, scope.name);
      setStore(createStudioStore(campaign, { venueName: scope.name }));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, isNew]);

  // ── Sauvegarde ────────────────────────────────────────────────────────────
  const saveNow = useCallback(async (status?: string): Promise<string | null> => {
    if (!store) return null;
    const state = store.getState();
    const c = state.campaign;
    state.markSaving();
    const payload = campaignToRow(c, scope);
    if (status) payload.status = status;
    const { error } = await supabase.from('email_campaigns')
      .update(payload as never).eq('id', c.id);
    if (error) {
      store.getState().markSaveFailed();
      toast.error(error.message || t('em.toast.saveError'));
      return null;
    }
    store.getState().markSaved();
    if (status) store.getState().patchCampaign({ status });
    return c.id;
  }, [store, scope, t]);

  // Autosave debouncé : contenu OU réglages → écriture 1,2 s après la
  // dernière frappe. L'indicateur « Enregistré à l'instant » vit dans TopBar.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!store) return;
    const unsub = store.subscribe((state, prev) => {
      if (state.campaign === prev.campaign) return;
      if (state.step === 'sending') return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => { void saveNow(); }, 1200);
    });
    return () => {
      unsub();
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [store, saveNow]);

  if (isNew) return <TemplateGallery scope={scope} basePath={basePath} />;

  if (loadError) {
    return (
      <div style={{ minHeight: '100vh', background: APP_BG, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
        <p style={{ color: T1, fontFamily: FONT_UI, fontSize: 13 }}>{loadError}</p>
        <GhostBtn onClick={() => navigate(basePath)}>{t('studio.top.back')}</GhostBtn>
      </div>
    );
  }

  if (!store) {
    return (
      <div style={{ minHeight: '100vh', background: APP_BG, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={22} className="animate-spin" style={{ color: T3 }} />
      </div>
    );
  }

  return (
    <StudioStoreContext.Provider value={store}>
      <StudioGlobalStyles />
      <StudioBody scope={scope} basePath={basePath} saveNow={saveNow} />
    </StudioStoreContext.Provider>
  );
}

/** Chips d'étapes numérotées du parcours (prototype stepSt). */
function StepChips({ current, onGo }: { current: StudioStep; onGo: (s: StudioStep) => void }) {
  const { t } = useLanguage();
  const items: { n: number; step: StudioStep; labelKey: string }[] = [
    { n: 1, step: 'studio', labelKey: 'studio.step.studio' },
    { n: 2, step: 'audience', labelKey: 'studio.step.audience' },
    { n: 3, step: 'schedule', labelKey: 'studio.step.schedule' },
    { n: 4, step: 'review', labelKey: 'studio.step.review' },
  ];
  const cur = STEP_ORDER.indexOf(current) + 1;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {items.map((it) => {
        const on = it.n === cur;
        const done = it.n < cur;
        return (
          <button
            key={it.step} type="button" onClick={() => onGo(it.step)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 13px',
              borderRadius: 999, fontSize: 12.5, fontWeight: 560, cursor: 'pointer', fontFamily: FONT_UI,
              color: on ? T1 : done ? T2 : T3,
              background: on ? 'rgba(232,25,44,0.10)' : 'transparent',
              border: `1px solid ${on ? 'rgba(232,25,44,0.28)' : 'transparent'}`,
            }}
          >
            <span style={{
              width: 17, height: 17, borderRadius: '50%', display: 'inline-flex',
              alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700,
              background: on ? RED : done ? 'rgba(52,211,153,0.22)' : 'rgba(255,255,255,0.08)',
              color: on ? '#fff' : done ? '#34D399' : T3,
            }}>{it.n}</span>
            {t(it.labelKey)}
          </button>
        );
      })}
    </div>
  );
}

function StudioBody({ scope, basePath, saveNow }: {
  scope: StudioScope; basePath: string;
  saveNow: (status?: string) => Promise<string | null>;
}) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const step = useStudio((s) => s.step);
  const setStep = useStudio((s) => s.setStep);
  const campaign = useStudio((s) => s.campaign);
  const inspectorTab = useStudio((s) => s.inspectorTab);
  const setInspectorTab = useStudio((s) => s.setInspectorTab);
  const [testOpen, setTestOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const { templates, create: createTemplate, overwrite: overwriteTemplate } = useEmailTemplates(scope);

  const events = useStudioEvents(scope, campaign.eventId);
  const segments = useSavedSegments(scope);
  const live = useStudioLiveData(campaign.blocks, campaign.eventId);

  const bucketFolder = scope.kind === 'venue' ? `venue/${scope.venueId}` : `org/${scope.organizerId}`;

  // ── Raccourcis clavier (écran Studio uniquement) ──────────────────────────
  const api = useStudioApi();
  useEffect(() => {
    if (step !== 'studio') return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField = !!target && (
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
        || target.isContentEditable
      );
      const s = api.getState();
      const mod = e.metaKey || e.ctrlKey;
      const key = (e.key || '').toLowerCase();

      if (inField) {
        if (e.key === 'Escape' && target && 'blur' in target) (target as HTMLElement).blur();
        return;
      }
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo(); else s.undo();
        return;
      }
      if (mod && key === 'd' && s.selectedId) {
        e.preventDefault();
        s.duplicate(s.selectedId);
        return;
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && s.selectedId) {
        e.preventDefault();
        s.removeBlock(s.selectedId);
      } else if (e.altKey && e.key === 'ArrowUp' && s.selectedId) {
        e.preventDefault();
        s.moveBlock(s.selectedId, -1);
      } else if (e.altKey && e.key === 'ArrowDown' && s.selectedId) {
        e.preventDefault();
        s.moveBlock(s.selectedId, 1);
      } else if (key === 'p' && !mod) {
        e.preventDefault();
        s.setPreview(!s.preview);
      } else if (e.key === 'Escape') {
        if (s.insertIndex != null) s.setInsertIndex(null);
        else if (s.drawer) s.setDrawer(null);
        else if (s.selectedId) s.select(null);
        else if (s.preview) s.setPreview(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, api]);

  const audienceValid = campaign.type === 'informational'
    ? !!campaign.eventId && campaign.audiences.length > 0
    : campaign.audiences.length > 0;

  // ── Écran Envoi : plein écran, sans en-tête de parcours ───────────────────
  if (step === 'sending') {
    return (
      <div className="yn-studio" style={{ height: '100vh', background: APP_BG, overflow: 'hidden', position: 'relative' }}>
        <SendingStep onExit={() => navigate(basePath)} onStudio={() => setStep('studio')} />
        <TestEmailDialog
          open={testOpen}
          campaignId={campaign.id}
          onSave={async () => (await saveNow()) != null}
          onClose={() => setTestOpen(false)}
        />
      </div>
    );
  }

  return (
    <div className="yn-studio" style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      background: APP_BG, overflow: 'hidden', position: 'relative',
    }}>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: PAGE_HALO }} />

      {step === 'studio' ? (
        <>
          <TopBar
            scope={scope}
            onBack={() => navigate(basePath)}
            onTestEmail={() => setTestOpen(true)}
            onSaveTemplate={() => setTemplateOpen(true)}
            onContinue={() => setStep('audience')}
          />
          <div style={{ position: 'relative', zIndex: 1, flex: 1, display: 'flex', minHeight: 0 }}>
            <BlockPalette scope={scope} />
            <CanvasColumn scope={scope} live={live} />
            <aside style={{
              width: 318, flex: 'none', display: 'flex', flexDirection: 'column',
              background: PANEL_BG, borderLeft: `1px solid ${BORDER}`, minHeight: 0,
            }}>
              <UnderlineTabs
                value={inspectorTab}
                onChange={setInspectorTab}
                options={[
                  { value: 'block', label: t('studio.tabs.block') },
                  { value: 'theme', label: t('studio.tabs.theme') },
                  { value: 'data', label: t('studio.tabs.data') },
                ]}
              />
              <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '16px 14px 26px' }}>
                {inspectorTab === 'block' && (
                  <Inspector
                    events={events}
                    bucketFolder={bucketFolder}
                    brand={{ name: scope.name, logoUrl: scope.logoUrl }}
                  />
                )}
                {inspectorTab === 'theme' && <ThemePanel />}
                {inspectorTab === 'data' && <DataPanel scope={scope} />}
              </div>
            </aside>
          </div>
        </>
      ) : (
        <>
          {/* En-tête du parcours (Audience / Planification / Récap) */}
          <header style={{
            position: 'relative', zIndex: 1, height: 58, flex: 'none',
            display: 'flex', alignItems: 'center', gap: 14, padding: '0 18px',
            background: TOPBAR_BG, borderBottom: `1px solid ${BORDER}`,
          }}>
            <GhostBtn
              onClick={() => setStep(STEP_ORDER[Math.max(0, STEP_ORDER.indexOf(step) - 1)])}
              style={{ background: SUBTLE, padding: '7px 12px' }}
            >
              <ChevronLeft size={15} strokeWidth={1.75} />
              {t(`studio.step.${STEP_ORDER[Math.max(0, STEP_ORDER.indexOf(step) - 1)]}` as const)}
            </GhostBtn>
            <span style={{ color: T3, fontSize: 12.5, fontFamily: FONT_UI, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {campaign.name}
            </span>
            <span style={{ flex: 1 }} />
            <StepChips current={step} onGo={(s2) => {
              if (s2 === 'review' && !audienceValid) return;
              setStep(s2);
            }} />
            <span style={{ flex: 1 }} />
            {step === 'audience' && (
              <PrimaryBtn onClick={() => setStep('schedule')} disabled={!audienceValid}>
                {t('studio.step.schedule')} <ArrowRight size={14} strokeWidth={1.75} />
              </PrimaryBtn>
            )}
            {step === 'schedule' && (
              <PrimaryBtn onClick={() => setStep('review')}>
                {t('studio.step.review')} <ArrowRight size={14} strokeWidth={1.75} />
              </PrimaryBtn>
            )}
            {step === 'review' && <span style={{ width: 120 }} />}
          </header>

          <div style={{ position: 'relative', zIndex: 1, flex: 1, overflowY: 'auto', padding: '26px 28px 60px', minHeight: 0 }}>
            <div style={{ maxWidth: 1160, margin: '0 auto' }}>
              {step === 'audience' && <AudienceStep scope={scope} events={events} segments={segments} />}
              {step === 'schedule' && <ScheduleStep />}
              {step === 'review' && (
                <ReviewStep
                  scope={scope}
                  events={events}
                  live={live}
                  onSave={saveNow}
                  onSent={() => {
                    if (campaign.scheduledAt) navigate(basePath);
                    else setStep('sending');
                  }}
                  onEditContent={() => setStep('studio')}
                  onTest={() => setTestOpen(true)}
                />
              )}
            </div>
          </div>
        </>
      )}

      <TestEmailDialog
        open={testOpen}
        campaignId={campaign.id}
        onSave={async () => (await saveNow()) != null}
        onClose={() => setTestOpen(false)}
      />

      <SaveTemplateDialog
        open={templateOpen}
        campaign={campaign}
        templates={templates}
        onClose={() => setTemplateOpen(false)}
        onCreate={async (name, description) => {
          const id = await createTemplate(name, description, campaignToTemplateContent(campaign));
          if (!id) { toast.error(t('studio.tpl.saveError')); return false; }
          toast.success(t('studio.tpl.saved'));
          return true;
        }}
        onOverwrite={async (id, name, description) => {
          const ok = await overwriteTemplate(id, campaignToTemplateContent(campaign), name, description);
          if (!ok) { toast.error(t('studio.tpl.saveError')); return false; }
          toast.success(t('studio.tpl.savedUpdate'));
          return true;
        }}
      />
    </div>
  );
}
