import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CalendarClock, ChevronLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { StoreApi } from 'zustand';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  campaignToTemplateContent, type StudioCampaign,
  rowToTemplate, templateContentToRow, type EmailTemplateRow,
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
  PrimaryBtn, RED, SUBTLE, T1, T2, T3, TOPBAR_BG, UnderlineTabs, useShellHeight,
} from './ui';
import TopBar from './TopBar';
import BlockPalette from './BlockPalette';
import CanvasColumn from './Canvas';
import Inspector from './Inspector';
import ThemePanel from './ThemePanel';
import DataPanel from './DataPanel';
import TestEmailDialog from './TestEmailDialog';
import { useEmailCreditsReturn } from '@/components/campaigns/EmailCreditsDialog';
import AudienceStep from './AudienceStep';
import ScheduleStep from './ScheduleStep';
import ReviewStep from './ReviewStep';
import SendingStep from './SendingStep';
import TemplateGallery from './TemplateGallery';
import { campaignToRow, rowToCampaign, type CampaignRow } from './campaignRow';
import { adoptAiVersion, useAiDraftSync } from './aiSync';
import SaveTemplateDialog from './TemplateDialogs';

interface Props {
  scope: StudioScope;
  basePath: string;
  /**
   * Mode MODÈLE : `:id` est un email_campaign_templates, pas une campagne.
   * Seul l'écran Studio existe (ni audience, ni planification, ni envoi) et
   * l'autosave réécrit le modèle — c'est ce qui manquait : un modèle ne se
   * retouchait qu'en passant par une campagne puis « Remplacer un modèle ».
   */
  templateMode?: boolean;
}

/** Ligne de modèle → campagne de travail du studio (aucune soirée, aucun envoi). */
function templateRowToCampaign(row: EmailTemplateRow): StudioCampaign {
  const tpl = rowToTemplate(row);
  return {
    id: tpl.id,
    name: tpl.name,
    type: tpl.type,
    status: 'template',
    subject: tpl.subject,
    subjectB: '',
    abOn: false,
    preheader: tpl.preheader,
    blocks: tpl.blocks,
    theme: tpl.theme,
    socialLinks: tpl.socialLinks,
    logoUrl: tpl.logoUrl,
    eventId: null,
    audiences: [],
    exclusions: {},
    scheduledAt: null,
    throttlePerHour: null,
    throttleWindowMinutes: 60,
    throttlePlan: null,
    quietHours: false,
    followupEnabled: false,
    followupDelayHours: 24,
    followupTemplateId: null,
    parentCampaignId: null,
    resendEnabled: false,
    resendDelayHours: 48,
    resendSubject: '',
  };
}

const STEP_ORDER: StudioStep[] = ['studio', 'audience', 'schedule', 'review', 'sending'];

export default function StudioShell({ scope, basePath, templateMode = false }: Props) {
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
      const { data, error } = await supabase
        .from(templateMode ? 'email_campaign_templates' : 'email_campaigns')
        .select('*').eq('id', params.id!).maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setLoadError(error?.message || t('studio.loadError'));
        return;
      }
      const campaign = templateMode
        ? templateRowToCampaign(data as unknown as EmailTemplateRow)
        : rowToCampaign(data as unknown as CampaignRow, scope.name);
      setStore(createStudioStore(campaign, { venueName: scope.name }));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, isNew, templateMode]);

  // ── Sauvegarde ────────────────────────────────────────────────────────────
  const saveNow = useCallback(async (status?: string): Promise<string | null> => {
    if (!store) return null;
    const state = store.getState();
    const c = state.campaign;
    state.markSaving();
    if (templateMode) {
      // Le modèle reçoit le DESIGN (soirée effacée, ids conservés) et son nom.
      const { error: tErr } = await supabase.from('email_campaign_templates')
        .update({ ...templateContentToRow(campaignToTemplateContent(c)), name: (c.name || 'Modèle').trim().slice(0, 80) } as never)
        .eq('id', c.id);
      if (tErr) {
        store.getState().markSaveFailed();
        toast.error(tErr.message || t('em.toast.saveError'));
        return null;
      }
      store.getState().markSaved();
      return c.id;
    }
    const payload = campaignToRow(c, scope);
    if (status) payload.status = status;
    // Garde anti-course : on n'écrit que sur une campagne encore modifiable
    // (brouillon ou planifiée). Si le cron l'a fait partir entre-temps, la
    // ligne est en 'sending' et l'UPDATE ne touche rien : on le dit au pro au
    // lieu d'afficher « Enregistré » sur une version qui n'existe plus.
    // Garde « IA » : on n'écrit pas par-dessus une version que l'IA du pro a
    // posée depuis le dernier chargement (MCP) — on l'adopte à la place.
    const base = supabase.from('email_campaigns')
      .update(payload as never).eq('id', c.id)
      .in('status', ['draft', 'scheduled']);
    const { data: touched, error } = await base
      .filter('ai_updated_at', c.aiUpdatedAt ? 'eq' : 'is', c.aiUpdatedAt ?? null).select('id');
    if (error) {
      store.getState().markSaveFailed();
      toast.error(error.message || t('em.toast.saveError'));
      return null;
    }
    if (!touched || touched.length === 0) {
      store.getState().markSaveFailed();
      const adopted = await adoptAiVersion(store, (row) => rowToCampaign(row, scope.name));
      if (adopted === 'adopted') {
        toast(t('studio.aiUpdated').replace('{ai}', store.getState().campaign.aiAuthor || 'IA'));
        return null;
      }
      toast.error(t('studio.scheduled.gone'));
      return null;
    }
    store.getState().markSaved();
    if (status) store.getState().patchCampaign({ status });
    return c.id;
  }, [store, scope, t, templateMode]);

  // Autosave debouncé : contenu OU réglages → écriture 1,2 s après la
  // dernière frappe. L'indicateur « Enregistré à l'instant » vit dans TopBar.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!store) return;
    const unsub = store.subscribe((state, prev) => {
      if (state.campaign === prev.campaign) return;
      // Version adoptée (l'IA du pro l'a écrite) : rien à réenregistrer.
      if (!state.dirty) return;
      if (state.step === 'sending') return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => { void saveNow(); }, 1200);
    });
    return () => {
      unsub();
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [store, saveNow]);

  // L'IA du pro modifie le brouillon (MCP) : le Studio ouvert suit.
  useAiDraftSync(store, {
    enabled: !templateMode,
    fromRow: (row) => rowToCampaign(row, scope.name),
    onAdopted: (ai) => toast(t('studio.aiUpdated').replace('{ai}', ai)),
  });

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
      <StudioBody scope={scope} basePath={basePath} saveNow={saveNow} templateMode={templateMode} />
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
              background: on ? RED : done ? 'rgba(52,211,153,0.22)' : 'rgb(var(--ink)/0.08)',
              color: on ? '#fff' : done ? 'var(--acc-34d399)' : T3,
            }}>{it.n}</span>
            {t(it.labelKey)}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Bandeau d'une campagne planifiée : la date de départ, le rappel que tout
 * reste modifiable, et l'annulation. Sous 30 min du départ il passe en alerte :
 * une retouche à moitié faite peut partir telle quelle.
 */
function ScheduledBanner({ onUnschedule }: { onUnschedule: () => void }) {
  const { t } = useLanguage();
  const status = useStudio((s) => s.campaign.status);
  const scheduledAt = useStudio((s) => s.campaign.scheduledAt);
  const [, tick] = useState(0);
  useEffect(() => {
    if (status !== 'scheduled') return;
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [status]);
  if (status !== 'scheduled' || !scheduledAt) return null;
  const at = new Date(scheduledAt);
  const minutes = Math.max(0, Math.round((at.getTime() - Date.now()) / 60_000));
  const soon = minutes < 30;
  const color = soon ? RED : 'var(--acc-fcd34d)';
  const Icon = soon ? AlertTriangle : CalendarClock;
  return (
    <div style={{
      position: 'relative', zIndex: 2, flex: 'none', display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 16px', borderBottom: `1px solid ${BORDER}`,
      background: soon ? 'rgba(232,25,44,0.10)' : 'rgba(252,211,77,0.07)',
    }}>
      <Icon size={14} strokeWidth={1.75} style={{ color, flex: 'none' }} />
      <span style={{ flex: 1, color: T2, fontSize: 12, lineHeight: 1.45, fontFamily: FONT_UI }}>
        {soon
          ? t('studio.scheduled.soon').replace('{n}', String(minutes))
          : t('studio.scheduled.editable').replace('{date}', at.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' }))}
      </span>
      <GhostBtn onClick={onUnschedule} style={{ background: SUBTLE, flex: 'none' }}>
        {t('studio.scheduled.cancel')}
      </GhostBtn>
    </div>
  );
}

function StudioBody({ scope, basePath, saveNow, templateMode = false }: {
  scope: StudioScope; basePath: string;
  saveNow: (status?: string) => Promise<string | null>;
  templateMode?: boolean;
}) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  // Le Studio tient dans la fenêtre, en-tête du shell pro compris : sans ça
  // son bas (barre d'actions, fond de l'inspecteur) tombait sous le pli.
  const { ref: shellRef, height: shellHeight } = useShellHeight<HTMLDivElement>();
  const step = useStudio((s) => s.step);
  const setStep = useStudio((s) => s.setStep);
  // Un modèle n'a qu'un écran : le Studio. Toute tentative d'aller plus loin
  // (raccourci, chip) revient ici.
  useEffect(() => {
    if (templateMode && step !== 'studio') setStep('studio');
  }, [templateMode, step, setStep]);
  const finishTemplate = async () => {
    const id = await saveNow();
    if (id) { toast.success(t('studio.tpl.saved')); navigate(`${basePath}/new`); }
  };
  const campaign = useStudio((s) => s.campaign);
  const inspectorTab = useStudio((s) => s.inspectorTab);
  const setInspectorTab = useStudio((s) => s.setInspectorTab);
  const [testOpen, setTestOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const { templates, create: createTemplate, overwrite: overwriteTemplate } = useEmailTemplates(scope);

  const events = useStudioEvents(scope, campaign.eventId);
  const segments = useSavedSegments(scope);
  // Retour Stripe d'un achat d'emails lancé depuis l'écran Planification.
  useEmailCreditsReturn();
  const live = useStudioLiveData(campaign.blocks, campaign.eventId, campaign.language);

  const bucketFolder = scope.kind === 'venue'
    ? `venue/${scope.venueId}`
    : scope.kind === 'organizer' ? `org/${scope.organizerId}` : 'platform';

  // Une campagne planifiée reste modifiable jusqu'au départ. « Annuler la
  // programmation » la remet en brouillon (la date est conservée pour la
  // reprogrammer en un clic au Récap) : le cron ne prend que 'scheduled'.
  const unschedule = async () => {
    const id = await saveNow('draft');
    if (id) toast.success(t('studio.scheduled.cancelled'));
  };

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

      // ⌘Z appartient au Studio, y compris en pleine frappe : le champ de
      // texte est un contenteditable qu'on redessine nous-mêmes, la pile
      // d'annulation du navigateur n'y survit pas. L'historique du store, si.
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo(); else s.undo();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        s.redo();
        return;
      }
      if (inField) {
        if (e.key === 'Escape' && target && 'blur' in target) (target as HTMLElement).blur();
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
      <div ref={shellRef} className="yn-studio" style={{ height: shellHeight, background: APP_BG, overflow: 'hidden', position: 'relative' }}>
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
    <div ref={shellRef} className="yn-studio" style={{
      height: shellHeight, display: 'flex', flexDirection: 'column',
      background: APP_BG, overflow: 'hidden', position: 'relative',
    }}>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: PAGE_HALO }} />

      {step === 'studio' ? (
        <>
          <TopBar
            scope={scope}
            templateMode={templateMode}
            onBack={() => navigate(templateMode ? `${basePath}/new` : basePath)}
            onTestEmail={() => setTestOpen(true)}
            onSaveTemplate={() => setTemplateOpen(true)}
            onContinue={() => { if (templateMode) void finishTemplate(); else setStep('audience'); }}
          />
          <ScheduledBanner onUnschedule={unschedule} />
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
                    live={live}
                    bucketFolder={bucketFolder}
                    brand={{ name: scope.name, logoUrl: scope.logoUrl }}
                    templateMode={templateMode}
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
          <ScheduledBanner onUnschedule={unschedule} />

          <div style={{ position: 'relative', zIndex: 1, flex: 1, overflowY: 'auto', padding: '26px 28px 60px', minHeight: 0 }}>
            <div style={{ maxWidth: 1160, margin: '0 auto' }}>
              {step === 'audience' && <AudienceStep scope={scope} events={events} segments={segments} />}
              {step === 'schedule' && <ScheduleStep scope={scope} basePath={basePath} />}
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
                  onUnschedule={unschedule}
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
