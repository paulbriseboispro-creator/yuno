/**
 * E-mails › Studio (maquette « Email Studio ») : l'éditeur plein écran.
 *
 * Le moteur est celui de l'Email Studio de la Suite — store (historique de 40
 * états, fusion des frappes), miroir React des blocs (blocks/*View, à
 * l'identique du rendu d'envoi), champ de texte riche, lecture / écriture de
 * la campagne (campaignRow.ts). L'interface est celle du design CRM : barre
 * du haut avec les quatre étapes, blocs et structure à gauche, l'e-mail au
 * centre, réglages Bloc / Style / Objet à droite.
 *
 * `/crm/emails/studio/new?new=<modèle>` (ou `?dup=<id>`) crée le brouillon puis
 * remplace l'adresse par la sienne. Un e-mail déjà parti renvoie à ses
 * résultats.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { StoreApi } from 'zustand';
import { supabase } from '@/integrations/supabase/client';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps, useCrmScope } from '@/crm/scope';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { useCrmToast } from '@/crm/ui/toast';
import { YunitFace } from '@/crm/ui/YunitFace';
import { useNights } from '@/crm/data/nights';
import { useInvalidateEmails } from '@/crm/data/emails';
import { duplicateCampaigns } from '@/crm/data/emailActions';
import { templateFromStart } from '@/crm/lib/emailTemplates';
import { createStudioStore, StudioStoreContext, useStudio, useStudioApi, type StudioState } from '@/components/email-studio/store';
import { campaignToRow, rowToCampaign, type CampaignRow } from '@/components/email-studio/campaignRow';
import { stripEventBindings, templateContentToRow } from '@/lib/email/templates';
import { useStudioLiveData, type StudioScope } from '@/components/email-studio/hooks';
import type { EmailBlock } from '@/lib/email/types';
import { useTemplateDraft } from '../templateDraft';
import { decorateBlock } from './catalog';
import { StudioTopBar } from './StudioTopBar';
import { StudioLeft } from './StudioLeft';
import { StudioCanvas } from './StudioCanvas';
import { StudioInspector } from './StudioInspector';
import { StudioTestModal } from './StudioTestModal';
import { useStudioUi } from './studioUi';
import { StudioProvider } from './StudioProvider';

const EDITABLE = ['draft', 'scheduled'];

export default function EmailStudioPage() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  if (!id || id === 'new') return <StudioCreate />;
  // `?template=<recette>` : l'e-mail d'une automatisation (un modèle, pas une campagne).
  if (params.get('template')) return <TemplateLoader key={id} id={id} />;
  return <StudioLoader key={id} id={id} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="yc yc-page-bg" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}>{children}</div>;
}

/** `new?new=annonce` / `new?dup=<id>` : crée le brouillon, puis l'ouvre. */
function StudioCreate() {
  const { t } = useCrmT();
  const nav = useNavigate();
  const toast = useCrmToast();
  const invalidate = useInvalidateEmails();
  const [params] = useSearchParams();
  const draft = useTemplateDraft(params.get('event'));
  const started = useRef(false);
  const caps = useCrmCaps();

  useEffect(() => {
    if (started.current || !draft.ready) return;
    started.current = true;
    if (!caps.write) { toast(t('yc.em.tp.ownerOnly')); nav(CRM_ROUTES.emailCampaigns, { replace: true }); return; }
    const dup = params.get('dup');
    const job = dup
      ? duplicateCampaigns([dup], t('yc.em.tp.copy')).then((ids) => ids[0])
      : draft.create(templateFromStart(params.get('new')) ?? 'vide', null);
    job
      .then((newId) => { invalidate(); nav(CRM_ROUTES.emailStudio(newId), { replace: true }); })
      .catch(() => { toast(t('yc.em.tp.err')); nav(CRM_ROUTES.emailTemplates, { replace: true }); });
  }, [draft, params, nav, toast, t, invalidate, caps.write]);

  return <Centered><YunitFace mood="content" size={56} /></Centered>;
}

function StudioLoader({ id }: { id: string }) {
  const { t } = useCrmT();
  const nav = useNavigate();
  const toast = useCrmToast();
  const { space } = useCrmScope();
  const [store, setStore] = useState<StoreApi<StudioState> | null>(null);
  const [missing, setMissing] = useState(false);
  const nights = useNights();
  // Ce que le chargement lit au moment où il part : une campagne s'ouvre une
  // fois, un changement de langue ne la recharge pas. Les blocs neufs se
  // lisent, eux, dans la langue et vers la soirée du moment.
  const env = useRef({ t, toast, nav, space });
  env.current = { t, toast, nav, space };
  const nightUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let off = false;
    (async () => {
      const { space: sp, toast: say, nav: go } = env.current;
      const { data, error } = await supabase.from('email_campaigns').select('*').eq('id', id).maybeSingle();
      if (off) return;
      const row = data as (CampaignRow & { venue_id: string | null; organizer_user_id: string | null }) | null;
      const mine = !!row && (row.venue_id ?? null) === sp.venueId && (row.organizer_user_id ?? null) === sp.organizerUserId;
      if (error || !row || !mine) { setMissing(true); return; }
      if (!EDITABLE.includes(row.status)) {
        say(env.current.t('yc.em.st.sentRedirect'));
        go(CRM_ROUTES.emailResults(id), { replace: true });
        return;
      }
      const decorate = (b: EmailBlock) => decorateBlock(b, env.current.t, nightUrlRef.current);
      setStore(createStudioStore(rowToCampaign(row, sp.name), { venueName: sp.name, logoUrl: sp.logoUrl ?? undefined }, decorate));
    })();
    return () => { off = true; };
  }, [id]);

  // Lien de la soirée reliée : c'est lui que prend un bouton posé ensuite.
  const eventId = store ? store.getState().campaign.eventId : null;
  nightUrlRef.current = nights.data?.nights.find((x) => x.id === eventId)?.url ?? null;

  if (missing) {
    return (
      <Centered>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, maxWidth: 380 }}>
          <YunitFace mood="inquiet" size={60} />
          <b style={{ fontFamily: 'var(--font-display)', fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.em.st.notFound')}</b>
          <button type="button" onClick={() => nav(CRM_ROUTES.emailCampaigns)} style={{ height: 44, padding: '0 20px', border: 0, borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>{t('yc.em.st.back')}</button>
        </div>
      </Centered>
    );
  }
  if (!store) return <Centered><YunitFace mood="content" size={56} /></Centered>;
  return (
    <StudioStoreContext.Provider value={store}>
      <StudioProvider>
        <StudioBody />
      </StudioProvider>
    </StudioStoreContext.Provider>
  );
}

/**
 * L'e-mail d'une automatisation : un modèle (`email_campaign_templates`) que
 * le moteur rejoue à chaque envoi. Même éditeur ; il s'enregistre dans le
 * modèle, sans soirée figée, et la barre du haut n'a pas d'étapes d'envoi.
 */
function TemplateLoader({ id }: { id: string }) {
  const { t } = useCrmT();
  const nav = useNavigate();
  const { space } = useCrmScope();
  const [store, setStore] = useState<StoreApi<StudioState> | null>(null);
  const [missing, setMissing] = useState(false);
  const env = useRef({ t, space });
  env.current = { t, space };
  // L'aperçu se relie à la prochaine soirée, comme les vignettes de modèles ;
  // le modèle, lui, n'enregistre jamais de soirée (choisie à chaque envoi).
  const nights = useNights();
  const nightsReady = !nights.isLoading;
  const nextNight = useRef<string | null>(null);
  nextNight.current = (nights.data?.nights ?? [])
    .filter((x) => x.upcoming)
    .sort((a, b) => a.start_at.localeCompare(b.start_at))[0]?.id ?? null;

  useEffect(() => {
    if (!nightsReady) return;
    let off = false;
    (async () => {
      const { space: sp } = env.current;
      const { data, error } = await supabase.from('email_campaign_templates').select('*').eq('id', id).maybeSingle();
      if (off) return;
      const tpl = data as (Record<string, unknown> & { id: string; name: string; venue_id: string | null; organizer_user_id: string | null }) | null;
      const mine = !!tpl && (tpl.venue_id ?? null) === sp.venueId && (tpl.organizer_user_id ?? null) === sp.organizerUserId;
      if (error || !tpl || !mine) { setMissing(true); return; }
      const row = {
        id: tpl.id, name: tpl.name, type: (tpl.type as string) || 'promotional', status: 'draft',
        subject: (tpl.subject as string) || '', subject_b: null, ab_enabled: false, preheader: (tpl.preheader as string) || '',
        blocks_json: tpl.blocks_json, blocks_version: (tpl.blocks_version as number) ?? 2, theme_json: tpl.theme_json,
        social_links_json: tpl.social_links_json, logo_url: (tpl.logo_url as string) ?? null, event_id: nextNight.current,
        audience_type: null, segment_id: null, audiences_json: [], exclusions_json: {}, scheduled_at: null,
        throttle_per_hour: null, throttle_window_minutes: null, throttle_plan: null, quiet_hours: true,
        followup_enabled: false, followup_delay_hours: null, followup_template_id: null, parent_campaign_id: null,
        resend_enabled: false, resend_delay_hours: null, resend_subject: null,
      } as CampaignRow;
      const decorate = (b: EmailBlock) => decorateBlock(b, env.current.t, null);
      setStore(createStudioStore(rowToCampaign(row, sp.name), { venueName: sp.name, logoUrl: sp.logoUrl ?? undefined }, decorate));
    })();
    return () => { off = true; };
  }, [id, nightsReady]);

  if (missing) {
    return (
      <Centered>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, maxWidth: 380 }}>
          <YunitFace mood="inquiet" size={60} />
          <b style={{ fontFamily: 'var(--font-display)', fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.em.st.notFound')}</b>
          <button type="button" onClick={() => nav(CRM_ROUTES.automations)} style={{ height: 44, padding: '0 20px', border: 0, borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>{t('yc.au.tpl.back')}</button>
        </div>
      </Centered>
    );
  }
  if (!store) return <Centered><YunitFace mood="content" size={56} /></Centered>;
  return (
    <StudioStoreContext.Provider value={store}>
      <StudioProvider>
        <StudioBody template />
      </StudioProvider>
    </StudioStoreContext.Provider>
  );
}

function useNarrow(px: number) {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < px);
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < px);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [px]);
  return narrow;
}

function StudioBody({ template = false }: { template?: boolean }) {
  const { t } = useCrmT();
  const toast = useCrmToast();
  const nav = useNavigate();
  const { space } = useCrmScope();
  const api = useStudioApi();
  const invalidate = useInvalidateEmails();
  const ui = useStudioUi();
  // Lecteur : le modèle se lit, rien ne s'enregistre (le serveur refuse de toute façon).
  const readOnly = !useCrmCaps().write;
  const narrow = useNarrow(1100);
  const [failed, setFailed] = useState(false);

  // ── Sauvegarde ────────────────────────────────────────────────────────────
  const saveNow = useCallback(async (): Promise<boolean> => {
    if (readOnly) return false;
    const st = api.getState();
    const c = st.campaign;
    st.markSaving();
    const scope: StudioScope = space.venueId
      ? { kind: 'venue', venueId: space.venueId, name: space.name }
      : { kind: 'organizer', organizerId: space.organizerUserId ?? '', name: space.name };
    // L'e-mail d'une automatisation s'écrit dans son modèle, sans soirée
    // figée : le moteur la relie à chaque envoi.
    const { data, error } = template
      ? await supabase.from('email_campaign_templates').update({
        ...templateContentToRow({ type: c.type, subject: c.subject, preheader: c.preheader, blocks: stripEventBindings(c.blocks), theme: c.theme, socialLinks: c.socialLinks, logoUrl: c.logoUrl }),
        name: (c.name || '').trim().slice(0, 80) || 'Automatisation',
      } as never).eq('id', c.id).select('id')
      // Garde anti-course : on n'écrit que sur une campagne encore modifiable.
      : await supabase.from('email_campaigns').update(campaignToRow(c, scope) as never)
        .eq('id', c.id).in('status', EDITABLE).select('id');
    if (error) { api.getState().markSaveFailed(); setFailed(true); return false; }
    if (!data || data.length === 0) {
      api.getState().markSaveFailed();
      toast(t('yc.em.st.gone'));
      return false;
    }
    setFailed(false);
    api.getState().markSaved();
    invalidate();
    return true;
  }, [api, readOnly, space.venueId, space.organizerUserId, space.name, toast, t, invalidate, template]);

  // Autosave : 1,2 s après la dernière modification.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (readOnly) return undefined;
    const unsub = api.subscribe((s, prev) => {
      if (s.campaign === prev.campaign) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { void saveNow(); }, 1200);
    });
    return () => { unsub(); if (timer.current) clearTimeout(timer.current); };
  }, [api, saveNow, readOnly]);

  // Quitter la page n'abandonne pas la dernière frappe.
  useEffect(() => () => {
    const st = api.getState();
    if (st.dirty && !readOnly) void saveNow();
  }, [api, saveNow, readOnly]);

  const goStep = useCallback(async (step: 'aud' | 'plan' | 'check' | null) => {
    if (api.getState().dirty) await saveNow();
    if (template) { nav(CRM_ROUTES.automations); return; }
    const id = api.getState().campaign.id;
    nav(`${CRM_ROUTES.emailSend(id)}${step ? `?step=${step}` : ''}`);
  }, [api, nav, saveNow, template]);

  // ── Clavier ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      const field = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const rich = !!el?.isContentEditable;
      const st = api.getState();
      const mod = e.metaKey || e.ctrlKey;
      const k = (e.key || '').toLowerCase();
      // ⌘Z appartient à l'éditeur, même dans le champ de texte riche (redessiné,
      // sa pile d'annulation native n'y survit pas) ; un champ simple garde la sienne.
      if (mod && (k === 'z' || k === 'y') && !field) {
        if (readOnly) return;
        e.preventDefault();
        if (k === 'y' || e.shiftKey) st.redo(); else st.undo();
        return;
      }
      if (k === 'escape') {
        if (ui.testOpen) { ui.setTestOpen(false); return; }
        if (st.insertIndex !== null) { st.setInsertIndex(null); return; }
        if (st.preview) { st.setPreview(false); return; }
        if (st.selectedId) { st.select(null); (el as HTMLElement | null)?.blur?.(); }
        return;
      }
      if (field || rich || ui.testOpen || readOnly) return;
      const sel = st.selectedId;
      if (mod && k === 'd' && sel) { e.preventDefault(); st.duplicate(sel); return; }
      if ((k === 'backspace' || k === 'delete') && sel) { e.preventDefault(); st.removeBlock(sel); toast(t('yc.em.st.deleted')); return; }
      if (k === 'arrowup' && sel) { e.preventDefault(); st.moveBlock(sel, -1); return; }
      if (k === 'arrowdown' && sel) { e.preventDefault(); st.moveBlock(sel, 1); return; }
      if (k === 'p' && !mod) { st.setPreview(!st.preview); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [api, ui, toast, t, readOnly]);

  // Sur un téléphone, l'e-mail s'ouvre dans sa version mobile ; `?tab=subject`
  // (lien « Modifier l'objet » de la vérification) ouvre l'onglet Objet.
  const [search] = useSearchParams();
  const openTab = search.get('tab');
  useEffect(() => {
    if (window.innerWidth < 640) api.getState().setDevice('mobile');
    if (openTab === 'subject') api.getState().setInspectorTab('data');
  }, [api, openTab]);

  // Les tests vont avec la campagne enregistrée : on sauvegarde d'abord.
  const openTest = useCallback(async () => {
    if (api.getState().dirty) await saveNow();
    ui.setTestOpen(true);
  }, [api, saveNow, ui]);

  const preview = useStudio((s) => s.preview) || readOnly;
  const blocks = useStudio((s) => s.campaign.blocks);
  const eventId = useStudio((s) => s.campaign.eventId);
  const live = useStudioLiveData(blocks, eventId);

  return (
    <div className="yc" style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'radial-gradient(55% 40% at 90% -5%,rgba(255,107,53,.08),transparent 70%),radial-gradient(45% 40% at 0% 0%,rgba(227,20,27,.05),transparent 70%),var(--paper)' }}>
      <StudioTopBar narrow={narrow} readOnly={readOnly} failed={failed} onStep={goStep} onTest={() => void openTest()} template={template} />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', position: 'relative' }}>
        {!narrow && !readOnly && <StudioLeft collapsed={preview} />}
        <StudioCanvas live={live} readOnly={readOnly} narrow={narrow} />
        {!readOnly && <StudioInspector collapsed={preview} narrow={narrow} live={live} />}
      </div>
      <StudioTestModal />
    </div>
  );
}
