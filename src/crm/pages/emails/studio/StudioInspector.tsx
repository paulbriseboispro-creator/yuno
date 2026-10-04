/**
 * Panneau droit du Studio : Bloc (réglages du bloc choisi), Style (ambiance,
 * couleur des boutons) et Objet (objet, texte d'aperçu, deux objets à tester,
 * aperçu dans la boîte de réception). Sur petit écran, il s'ouvre en volet.
 */
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { useCrmToast } from '@/crm/ui/kit';
import { EASE, SPRING } from '@/crm/ui/motion';
import { YunitFace } from '@/crm/ui/YunitFace';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import { useNights, type NightRow } from '@/crm/data/nights';
import { supabase } from '@/integrations/supabase/client';
import { useStudio, useStudioApi } from '@/components/email-studio/store';
import RichTextField from '@/components/email-studio/RichTextField';
import { defaultInkOn, solidBlockBg } from '@/lib/email/render';
import { blockBgColor } from '@/components/email-studio/blocks/common';
import type { EmailBlock, EmailTheme, LiveData, SocialLinks, TextVariant } from '@/lib/email/types';
import { CRM_EMAIL_THEMES, type CrmThemeKey } from '@/crm/lib/emailTemplates';
import { BLOCK_ICONS } from './catalog';
import { insertVariable, useStudioUi } from './studioUi';

const VARS = ['prénom', 'nom_club', 'soirée', 'ville'] as const;
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const ACCENTS = ['#E3141B', '#FF6B35', '#1C1517', '#9D0B12'];
const THEME_KEYS: CrmThemeKey[] = ['clair', 'nuit', 'rouge', 'epure'];

type Patch = (p: Record<string, unknown>) => void;

// ── Briques de formulaire (maquette : champs 44 px, rayon 12) ─────────────────

function Field({ label, hint, children, right }: { label?: string; hint?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {(label || right) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          {label && <span style={{ fontSize: 13.5, fontWeight: 600 }}>{label}</span>}
          {right}
        </div>
      )}
      {children}
      {hint && <span style={{ fontSize: 12.5, lineHeight: 1.4, color: 'var(--sand-500)', textWrap: 'pretty' }}>{hint}</span>}
    </div>
  );
}

const inputCss = { height: 44, boxSizing: 'border-box', padding: '0 14px', borderRadius: 12, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 14.5, color: 'var(--ink)', outline: 'none', width: '100%' } as const;

function TextInput({ value, onChange, placeholder, label, onFocusEl }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string; onFocusEl?: (el: HTMLInputElement) => void }) {
  return <input className="yc-field" value={value} onChange={(e) => onChange(e.target.value)} onFocus={(e) => onFocusEl?.(e.currentTarget)} placeholder={placeholder} aria-label={label} style={{ ...inputCss, fontSize: 14.5 }} />;
}

function TextArea({ value, onChange, rows = 3, label, onFocusEl }: { value: string; onChange: (v: string) => void; rows?: number; label?: string; onFocusEl?: (el: HTMLTextAreaElement) => void }) {
  return <textarea className="yc-field" value={value} rows={rows} onChange={(e) => onChange(e.target.value)} onFocus={(e) => onFocusEl?.(e.currentTarget)} aria-label={label} style={{ ...inputCss, height: 'auto', padding: '12px 14px', lineHeight: 1.5, resize: 'vertical' }} />;
}

function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="group" style={{ display: 'flex', padding: 3, gap: 2, background: 'var(--sand-100)', borderRadius: 99 }}>
      {options.map((o) => {
        const on = o.v === value;
        return (
          <button key={String(o.v)} type="button" onClick={() => onChange(o.v)} aria-pressed={on} style={{ flex: 1, height: 34, padding: '0 6px', border: 0, borderRadius: 99, background: on ? '#fff' : 'transparent', boxShadow: on ? 'var(--shadow-xs)' : 'none', fontSize: 13.5, fontWeight: 600, color: on ? 'var(--ink)' : 'var(--sand-600)', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background 160ms,color 160ms' }}>
            {o.l}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 0, border: 0, background: 'none', cursor: 'pointer', textAlign: 'left' }}>
      <span style={{ flex: 'none', position: 'relative', width: 44, height: 26, borderRadius: 99, background: on ? 'var(--green-500)' : 'var(--sand-300)', transition: 'background 200ms' }}>
        <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: 99, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.25)', transition: `left 220ms ${SPRING}` }} />
      </span>
      <span style={{ fontSize: 14, color: 'var(--sand-700)' }}>{label}</span>
    </button>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <div style={{ padding: '12px 14px', borderRadius: 14, background: 'var(--sand-50)', fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-600)', textWrap: 'pretty' }}>{children}</div>;
}

function VarChips({ active }: { active?: boolean }) {
  const { t } = useCrmT();
  const ui = useStudioUi();
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      <span style={{ width: '100%', fontSize: 12.5, color: 'var(--sand-500)' }}>{t(active ? 'yc.em.st.f.varsActive' : 'yc.em.st.f.vars')}</span>
      {VARS.map((v) => (
        <Hv
          key={v}
          as="button"
          type="button"
          // onMouseDown : le champ garde son curseur, la variable s'insère à sa place.
          onMouseDown={(e: React.MouseEvent) => { e.preventDefault(); insertVariable(ui, v); }}
          title={t(`yc.em.st.var.${v}`)}
          style={{ height: 28, padding: '0 10px', border: 0, borderRadius: 99, background: 'var(--red-50)', color: 'var(--red-700)', font: "500 12px 'Geist Mono',monospace", cursor: 'pointer' }}
          hover={{ background: 'var(--red-100)' }}
        >
          {`{{${v}}}`}
        </Hv>
      ))}
    </div>
  );
}

function NightPick({ value, onPick, nights }: { value?: string | null; onPick: (n: NightRow) => void; nights: NightRow[] }) {
  const { t, dLong, time } = useCrmT();
  if (!nights.length) return <Note>{t('yc.em.st.f.noNights')}</Note>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {nights.map((n) => {
        const on = value === n.id;
        return (
          <button key={n.id} type="button" onClick={() => onPick(n)} aria-pressed={on} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderRadius: 14, border: `1.5px solid ${on ? 'var(--red-400)' : 'var(--sand-200)'}`, background: on ? 'var(--red-50)' : '#fff', cursor: 'pointer', textAlign: 'left', transition: 'border-color 160ms,background 160ms' }}>
            <span style={{ flex: 'none', width: 18, height: 18, borderRadius: 99, border: `2px solid ${on ? 'var(--red-500)' : 'var(--sand-300)'}`, display: 'grid', placeItems: 'center' }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: on ? 'var(--red-500)' : 'transparent' }} />
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <b style={{ fontSize: 14, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.title}</b>
              <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{cap(dLong(n.start_at))} · {time(n.start_at)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Panneau ───────────────────────────────────────────────────────────────

export function StudioInspector({ collapsed, narrow, live }: { collapsed: boolean; narrow: boolean; live: LiveData }) {
  const { t } = useCrmT();
  const api = useStudioApi();
  const tab = useStudio((s) => s.inspectorTab);
  const selectedId = useStudio((s) => s.selectedId);
  const [sheet, setSheet] = useState(false);
  const tabs: { k: 'block' | 'theme' | 'data'; l: string }[] = [
    { k: 'block', l: t('yc.em.st.r.block') },
    { k: 'theme', l: t('yc.em.st.r.style') },
    { k: 'data', l: t('yc.em.st.r.subject') },
  ];
  const open = !narrow || !!selectedId || sheet;

  const body = (
    <div style={{ width: narrow ? '100%' : 352, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 2, padding: '0 12px', borderBottom: '1px solid var(--sand-100)' }}>
        {tabs.map((x) => {
          const on = tab === x.k;
          return (
            <Hv key={x.k} as="button" type="button" onClick={() => api.getState().setInspectorTab(x.k)} style={{ position: 'relative', flex: 1, height: 52, border: 0, background: 'none', fontSize: 14.5, fontWeight: on ? 600 : 500, color: on ? 'var(--ink)' : 'var(--sand-500)', cursor: 'pointer', transition: 'color 160ms' }} hover={{ color: 'var(--ink)' }}>
              <span style={{ fontSize: 14.5, fontWeight: on ? 600 : 500 }}>{x.l}</span>
              <span style={{ position: 'absolute', left: 14, right: 14, bottom: -1, height: 2, borderRadius: 2, background: 'var(--gradient-brand)', opacity: on ? 1 : 0, transition: 'opacity 200ms' }} />
            </Hv>
          );
        })}
        {narrow && (
          <button type="button" onClick={() => { setSheet(false); api.getState().select(null); }} aria-label={t('yc.em.tp.m.close')} style={{ flex: 'none', width: 36, height: 36, border: 0, borderRadius: 99, background: 'var(--sand-100)', color: 'var(--sand-600)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
            <Icon name="x" size={16} stroke={2.4} />
          </button>
        )}
      </div>
      <div className="yc-thin-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {tab === 'block' && <BlockTab live={live} />}
        {tab === 'theme' && <StyleTab />}
        {tab === 'data' && <SubjectTab />}
      </div>
    </div>
  );

  if (narrow) {
    return (
      <>
        {!open && (
          <Hv as="button" type="button" onClick={() => { setSheet(true); api.getState().setInspectorTab('data'); }} style={{ position: 'absolute', right: 16, bottom: 18, zIndex: 20, height: 44, padding: '0 18px', border: 0, borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, boxShadow: 'var(--shadow-md)', cursor: 'pointer' }} hover={{ background: 'var(--sand-700)' }}>
            <Icon name="sliders" size={16} stroke={2.2} />{t('yc.em.st.r.subject')} · {t('yc.em.st.r.style')}
          </Hv>
        )}
        {open && (
          <aside style={{ position: 'absolute', top: 0, right: 0, bottom: 0, zIndex: 30, width: 'min(380px, 100%)', background: '#fff', boxShadow: 'var(--shadow-md),-1px 0 0 var(--sand-100)', display: 'flex', flexDirection: 'column', animation: `yc-slide-r 260ms ${EASE} both` }}>
            {body}
          </aside>
        )}
      </>
    );
  }

  return (
    <aside style={{ flex: 'none', boxSizing: 'border-box', width: collapsed ? 0 : 352, opacity: collapsed ? 0 : 1, overflow: 'hidden', background: '#fff', borderLeft: '1px solid var(--sand-100)', display: 'flex', flexDirection: 'column', transition: `width 320ms ${EASE},opacity 220ms`, animation: `yc-slide-r 700ms ${EASE} 200ms both` }}>
      {body}
    </aside>
  );
}

// ── Onglet Bloc ───────────────────────────────────────────────────────────

function BlockTab({ live }: { live: LiveData }) {
  const { t } = useCrmT();
  const api = useStudioApi();
  const selectedId = useStudio((s) => s.selectedId);
  const block = useStudio((s) => s.campaign.blocks.find((b) => b.id === s.selectedId) ?? null);
  if (!selectedId || !block) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, textAlign: 'center', padding: '30px 10px', animation: 'yc-fade 300ms both' }}>
        <YunitFace mood="content" size={56} />
        <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-.02em' }}>{t('yc.em.st.r.noSel')}</b>
        <span style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--sand-500)', maxWidth: 240, textWrap: 'pretty' }}>{t('yc.em.st.r.noSelSub')}</span>
      </div>
    );
  }
  const patch: Patch = (p) => api.getState().updateBlock(block.id, p as Partial<EmailBlock>);
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, animation: 'yc-fade 200ms both' }}>
        <span style={{ flex: 'none', width: 40, height: 40, borderRadius: 13, background: 'var(--red-50)', color: 'var(--red-600)', display: 'grid', placeItems: 'center' }}><Icon d={BLOCK_ICONS[block.type] ?? BLOCK_ICONS.text} size={20} stroke={2} /></span>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 19, letterSpacing: '-.02em' }}>{t(`yc.em.st.b.${block.type}`)}</b>
          <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t(`yc.em.st.b.${block.type}.d`)}</span>
        </span>
      </div>
      <BlockFields key={block.id} block={block} patch={patch} live={live} />
    </>
  );
}

function useNightOptions(current?: string | null): NightRow[] {
  const nights = useNights();
  const all = nights.data?.nights ?? [];
  const up = all.filter((n) => n.upcoming).sort((a, b) => a.start_at.localeCompare(b.start_at));
  const pinned = current ? all.find((n) => n.id === current && !n.upcoming) : undefined;
  return pinned ? [pinned, ...up] : up;
}

function BlockFields({ block, patch, live }: { block: EmailBlock; patch: Patch; live: LiveData }) {
  const { t } = useCrmT();
  const api = useStudioApi();
  const campaignEventId = useStudio((s) => s.campaign.eventId);
  const theme = useStudio((s) => s.campaign.theme);
  const nights = useNightOptions('eventId' in block ? block.eventId ?? campaignEventId : campaignEventId);
  const allNights = useNights().data?.nights ?? [];
  const campaignNight = allNights.find((n) => n.id === campaignEventId) ?? null;

  /** Une soirée choisie sur un bloc relie aussi le brouillon s'il ne l'était pas. */
  const pickNight = (n: NightRow, extra: Record<string, unknown> = {}) => {
    patch({ eventId: n.id, ...extra });
    if (!api.getState().campaign.eventId) api.getState().patchCampaign({ eventId: n.id });
  };
  const src = (id?: string | null) => {
    const ev = id ? live[id] : undefined;
    return ev ? t('yc.em.st.f.ticketing') : t('yc.em.st.f.ticketing');
  };

  switch (block.type) {
    case 'header':
      return (
        <>
          <Field label={t('yc.em.st.f.venue')}><TextInput value={block.venueName} onChange={(v) => patch({ venueName: v })} label={t('yc.em.st.f.venue')} /></Field>
          <Field label={t('yc.em.st.f.logoSize')}><Seg value={block.logoSize} onChange={(v) => patch({ logoSize: v })} options={[{ v: 'sm', l: t('yc.em.st.f.small') }, { v: 'md', l: t('yc.em.st.f.medium') }, { v: 'lg', l: t('yc.em.st.f.large') }]} /></Field>
          <Field label={t('yc.em.st.f.name')}><Toggle on={block.showName} onChange={(v) => patch({ showName: v })} label={t('yc.em.st.f.showName')} /></Field>
        </>
      );
    case 'image':
      return <ImageFields block={block} patch={patch} night={campaignNight} />;
    case 'text':
      return <TextFields block={block} patch={patch} theme={theme} />;
    case 'cta':
      return (
        <>
          <Field label={t('yc.em.st.f.btnLabel')}><TextInput value={block.label} onChange={(v) => patch({ label: v })} label={t('yc.em.st.f.btnLabel')} /></Field>
          <Field label={t('yc.em.st.f.btnUrl')} hint={t('yc.em.st.f.btnUrlHint')}>
            <TextInput value={block.url} onChange={(v) => patch({ url: v })} placeholder="https://" label={t('yc.em.st.f.btnUrl')} />
            {campaignNight?.url && campaignNight.url !== block.url && (
              <Hv as="button" type="button" onClick={() => patch({ url: campaignNight.url })} style={{ alignSelf: 'flex-start', height: 30, padding: '0 12px', border: 0, borderRadius: 99, background: 'var(--sand-100)', color: 'var(--sand-700)', fontSize: 13, fontWeight: 600, cursor: 'pointer', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} hover={{ background: 'var(--sand-200)' }}>
                {t('yc.em.st.f.btnUrlNight', { title: campaignNight.title })}
              </Hv>
            )}
          </Field>
          <Field label={t('yc.em.st.f.shape')}><Seg value={block.radius >= 100 ? 'pill' : 'square'} onChange={(v) => patch({ radius: v === 'pill' ? 999 : 8 })} options={[{ v: 'pill', l: t('yc.em.st.f.pill') }, { v: 'square', l: t('yc.em.st.f.square') }]} /></Field>
          <Field label={t('yc.em.st.f.align')}><Seg value={block.align} onChange={(v) => patch({ align: v })} options={[{ v: 'left', l: t('yc.em.st.f.left') }, { v: 'center', l: t('yc.em.st.f.center') }, { v: 'right', l: t('yc.em.st.f.right') }]} /></Field>
          <Field label={t('yc.em.st.f.width')}><Toggle on={block.full} onChange={(v) => patch({ full: v })} label={t('yc.em.st.f.full')} /></Field>
        </>
      );
    case 'columns':
      return (
        <>
          {(['left', 'right'] as const).map((side) => (
            <Field key={side} label={t(side === 'left' ? 'yc.em.st.f.colLeft' : 'yc.em.st.f.colRight')}>
              <TextInput value={block[side].title} onChange={(v) => patch({ [side]: { ...block[side], title: v } })} label={t('yc.em.st.f.colTitle')} />
              <TextArea value={block[side].body} onChange={(v) => patch({ [side]: { ...block[side], body: v } })} label={t('yc.em.st.f.colText')} />
            </Field>
          ))}
        </>
      );
    case 'divider':
      return <Note>{t('yc.em.st.f.dividerNote')}</Note>;
    case 'spacer':
      return <Field label={t('yc.em.st.f.height')}><Seg value={block.size} onChange={(v) => patch({ size: v })} options={[{ v: 'sm', l: 'S' }, { v: 'md', l: 'M' }, { v: 'lg', l: 'L' }, { v: 'xl', l: 'XL' }]} /></Field>;
    case 'event':
      return (
        <>
          <Field label={t('yc.em.st.f.night')}><NightPick value={block.eventId ?? campaignEventId} nights={nights} onPick={(n) => pickNight(n)} /></Field>
          <Note>{t('yc.em.st.f.eventNote', { src: src(block.eventId) })}</Note>
          <Field label={t('yc.em.st.f.btnLabel')}><TextInput value={block.ctaLabel} onChange={(v) => patch({ ctaLabel: v })} label={t('yc.em.st.f.btnLabel')} /></Field>
          <Field label={t('yc.em.st.f.layout')}><Seg value={block.layout ?? 'showcase'} onChange={(v) => patch({ layout: v })} options={[{ v: 'showcase', l: t('yc.em.st.f.l.showcase') }, { v: 'split', l: t('yc.em.st.f.l.split') }, { v: 'minimal', l: t('yc.em.st.f.l.minimal') }]} /></Field>
          <Field label={t('yc.em.st.f.poster')}><Toggle on={block.cover} onChange={(v) => patch({ cover: v })} label={t('yc.em.st.f.cover')} /></Field>
          <Toggle on={block.price} onChange={(v) => patch({ price: v })} label={t('yc.em.st.f.price')} />
        </>
      );
    case 'tickets':
      return (
        <>
          <Field label={t('yc.em.st.f.night')}><NightPick value={block.eventId ?? campaignEventId} nights={nights} onPick={(n) => pickNight(n)} /></Field>
          <Note>{t('yc.em.st.f.ticketsNote')}</Note>
          <Field label={t('yc.em.st.f.btnLabel')}><TextInput value={block.ctaLabel ?? ''} onChange={(v) => patch({ ctaLabel: v })} label={t('yc.em.st.f.btnLabel')} /></Field>
        </>
      );
    case 'countdown':
      return (
        <>
          <Field label={t('yc.em.st.f.cdLabel')}><TextInput value={block.label} onChange={(v) => patch({ label: v })} label={t('yc.em.st.f.cdLabel')} /></Field>
          <Field label={t('yc.em.st.f.nightCd')}><NightPick value={block.eventId ?? campaignEventId} nights={nights} onPick={(n) => pickNight(n)} /></Field>
          <Note>{t('yc.em.st.f.cdNote')}</Note>
        </>
      );
    case 'social':
      return <SocialFields />;
    case 'html':
      return (
        <>
          <Note>{t('yc.em.st.f.htmlNote')}</Note>
          <TextArea value={block.code} rows={8} onChange={(v) => patch({ code: v })} label="HTML" />
        </>
      );
    default:
      return <Note>{t('yc.em.st.f.genericNote')}</Note>;
  }
}

function ImageFields({ block, patch, night }: { block: Extract<EmailBlock, { type: 'image' }>; patch: Patch; night: NightRow | null }) {
  const { t } = useCrmT();
  const toast = useCrmToast();
  const { space } = useCrmScope();
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast(t('yc.em.st.f.imgTooBig')); return; }
    setBusy(true);
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const folder = space.venueId ? `venue/${space.venueId}` : `org/${space.organizerUserId}`;
      const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage.from('email-assets').upload(path, file, { upsert: false, contentType: file.type });
      if (error) throw error;
      const { data } = supabase.storage.from('email-assets').getPublicUrl(path);
      patch({ url: data.publicUrl });
    } catch {
      toast(t('yc.em.st.f.imgFail'));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <>
      <Field label={t('yc.em.st.f.image')}>
        <label className="yc-field" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '22px 14px', borderRadius: 16, border: '2px dashed var(--sand-300)', background: 'var(--paper)', cursor: busy ? 'progress' : 'pointer', textAlign: 'center' }}>
          <Icon name={busy ? 'refresh' : 'upload'} size={24} stroke={2} color="var(--sand-500)" style={busy ? { animation: 'yc-spin 900ms linear infinite' } : undefined} />
          <b style={{ fontSize: 14 }}>{busy ? t('yc.em.st.f.imgUploading') : t(block.url ? 'yc.em.st.f.imgReplace' : 'yc.em.st.f.imgAdd')}</b>
          <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.em.st.f.imgHint')}</span>
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={busy} onChange={(e) => void upload(e.target.files?.[0])} style={{ display: 'none' }} />
        </label>
        {night?.cover_url && night.cover_url !== block.url && (
          <Hv as="button" type="button" onClick={() => patch({ url: night.cover_url, label: block.label || night.title })} style={{ height: 36, border: 0, borderRadius: 99, background: 'var(--red-50)', color: 'var(--red-700)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', padding: '0 14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} hover={{ background: 'var(--red-100)' }}>
            {t('yc.em.st.f.imgPoster', { title: night.title })}
          </Hv>
        )}
        {block.url && (
          <Hv as="button" type="button" onClick={() => patch({ url: undefined })} style={{ height: 36, border: 0, borderRadius: 99, background: 'var(--sand-100)', fontSize: 13.5, fontWeight: 600, color: 'var(--sand-700)', cursor: 'pointer' }} hover={{ background: 'var(--sand-200)' }}>
            {t('yc.em.st.f.imgRemove')}
          </Hv>
        )}
      </Field>
      <Field label={t('yc.em.st.f.alt')} hint={t('yc.em.st.f.altHint')}><TextInput value={block.label} onChange={(v) => patch({ label: v })} label={t('yc.em.st.f.alt')} /></Field>
      <Field label={t('yc.em.st.f.imgLink')} right={<span style={{ fontSize: 12.5, color: 'var(--sand-400)' }}>{t('yc.em.st.f.optional')}</span>}>
        <TextInput value={block.linkUrl ?? ''} onChange={(v) => patch({ linkUrl: v || undefined })} placeholder="https://" label={t('yc.em.st.f.imgLink')} />
      </Field>
      <Toggle on={(block.radius ?? 0) > 0} onChange={(v) => patch({ radius: v ? 16 : 0 })} label={t('yc.em.st.f.round')} />
    </>
  );
}

const SIZES: Record<TextVariant, { v: number; l: string }[]> = {
  body: [{ v: 14, l: 'small' }, { v: 16, l: 'medium' }, { v: 18, l: 'large' }],
  headline: [{ v: 22, l: 'small' }, { v: 28, l: 'medium' }, { v: 34, l: 'large' }],
  kicker: [],
};

function TextFields({ block, patch, theme }: { block: Extract<EmailBlock, { type: 'text' }>; patch: Patch; theme: EmailTheme }) {
  const { t } = useCrmT();
  const ui = useStudioUi();
  const variant = block.variant ?? 'body';
  const sizes = SIZES[variant];
  // Le champ se peint aux couleurs du bloc dans l'e-mail (cf. RichTextField).
  const raw = blockBgColor(block, theme);
  const bg = solidBlockBg(raw, theme);
  const ink = block.color ?? defaultInkOn(raw, theme);
  const setVariant = (v: TextVariant) => {
    const size = v === 'kicker' ? 11 : v === 'headline' ? 28 : 16;
    patch({ variant: v, size });
  };
  const fmt = (label: string, d: string, run: () => void) => (
    <Hv as="button" type="button" aria-label={label} title={label} onMouseDown={(e: React.MouseEvent) => { e.preventDefault(); run(); }} style={{ width: 32, height: 30, border: 0, borderRadius: 9, background: 'none', color: 'var(--sand-700)', cursor: 'pointer', display: 'grid', placeItems: 'center' }} hover={{ background: '#fff' }}>
      <Icon d={d} size={15} stroke={2.3} />
    </Hv>
  );
  const link = () => {
    const url = window.prompt(t('yc.em.st.f.linkPrompt'), 'https://');
    if (url && url.trim() && url.trim() !== 'https://') ui.rich.current?.applyLink(url.trim());
  };
  return (
    <>
      <Field label={t('yc.em.st.f.textStyle')}><Seg value={variant} onChange={setVariant} options={[{ v: 'body', l: t('yc.em.st.f.v.body') }, { v: 'headline', l: t('yc.em.st.f.v.headline') }, { v: 'kicker', l: t('yc.em.st.f.v.kicker') }]} /></Field>
      <Field label={t('yc.em.st.f.text')} hint={t('yc.em.st.f.textHint')}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: 3, borderRadius: 12, background: 'var(--sand-100)', alignSelf: 'flex-start' }}>
          {fmt(t('yc.em.st.f.bold'), 'M6 12h9a4 4 0 0 1 0 8H6zM6 4h7a4 4 0 0 1 0 8H6z', () => ui.rich.current?.toggle('b'))}
          {fmt(t('yc.em.st.f.italic'), 'M19 4h-9M14 20H5M15 4 9 20', () => ui.rich.current?.toggle('i'))}
          {fmt(t('yc.em.st.f.underline'), 'M6 4v6a6 6 0 0 0 12 0V4M4 20h16', () => ui.rich.current?.toggle('u'))}
          {fmt(t('yc.em.st.f.link'), 'M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 1 1 0 10h-2M8 12h8', link)}
          {fmt(t('yc.em.st.f.clear'), 'M4 7V4h16v3M5 20h6M13 4 8 20M15 15l5 5M20 15l-5 5', () => ui.rich.current?.clearFormat())}
        </div>
        <div onFocus={() => { ui.active.current = { kind: 'rich' }; }}>
          <RichTextField
            ref={ui.rich}
            value={block.body}
            onChange={(v) => patch({ body: v })}
            accent={theme.accent}
            background={bg}
            ink={ink}
            placeholder={t('yc.em.st.f.placeholder')}
            ariaLabel={t('yc.em.st.f.text')}
            style={{ minHeight: 120, boxSizing: 'border-box', padding: '12px 14px', borderRadius: 12, border: '1px solid var(--sand-200)', fontSize: Math.min(18, Math.max(13, block.size || 16)), lineHeight: 1.5, fontFamily: "Arial,'Helvetica Neue',Helvetica,sans-serif", fontWeight: variant === 'headline' ? 800 : 400 }}
          />
        </div>
      </Field>
      <VarChips />
      {sizes.length > 0 && (
        <Field label={t('yc.em.st.f.size')}><Seg value={sizes.some((s) => s.v === block.size) ? block.size : sizes[1].v} onChange={(v) => patch({ size: v })} options={sizes.map((s) => ({ v: s.v, l: t(`yc.em.st.f.${s.l}`) }))} /></Field>
      )}
      <Field label={t('yc.em.st.f.align')}><Seg value={block.align} onChange={(v) => patch({ align: v })} options={[{ v: 'left', l: t('yc.em.st.f.left') }, { v: 'center', l: t('yc.em.st.f.center') }, { v: 'right', l: t('yc.em.st.f.right') }]} /></Field>
    </>
  );
}

function SocialFields() {
  const { t } = useCrmT();
  const api = useStudioApi();
  const links = useStudio((s) => s.campaign.socialLinks);
  const theme = useStudio((s) => s.campaign.theme);
  const set = (k: keyof SocialLinks, v: string) => api.getState().setSocialLinks({ ...links, [k]: v.trim() ? v : undefined });
  const rows: { k: keyof SocialLinks; l: string; ph: string }[] = [
    { k: 'instagram', l: 'Instagram', ph: 'https://instagram.com/…' },
    { k: 'tiktok', l: 'TikTok', ph: 'https://tiktok.com/@…' },
    { k: 'facebook', l: 'Facebook', ph: 'https://facebook.com/…' },
    { k: 'website', l: t('yc.em.st.f.website'), ph: 'https://' },
  ];
  return (
    <>
      <Note>{t('yc.em.st.f.socialNote')}</Note>
      {rows.map((r) => (
        <Field key={r.k} label={r.l}><TextInput value={links[r.k] ?? ''} onChange={(v) => set(r.k, v)} placeholder={r.ph} label={r.l} /></Field>
      ))}
      <Toggle on={theme.footerSocial !== false} onChange={(v) => api.getState().patchTheme({ footerSocial: v })} label={t('yc.em.st.f.footerSocial')} />
    </>
  );
}

// ── Onglet Style ──────────────────────────────────────────────────────────

function StyleTab() {
  const { t } = useCrmT();
  const api = useStudioApi();
  const theme = useStudio((s) => s.campaign.theme);
  const base = THEME_KEYS.find((k) => CRM_EMAIL_THEMES[k].name === theme.name) ?? null;
  const baseAccent = base ? CRM_EMAIL_THEMES[base].accent : null;
  const pickTheme = (k: CrmThemeKey) => api.getState().patchTheme({ ...CRM_EMAIL_THEMES[k], footerSocial: theme.footerSocial });
  const pickAccent = (c: string) => {
    // Un bouton noir sur une ambiance de nuit s'inverse : sinon il disparaît.
    if (theme.dark && c === '#1C1517') { api.getState().patchTheme({ accent: '#F7F2F1', btnText: '#1C1517' }); return; }
    api.getState().patchTheme({ accent: c, btnText: '#FFFFFF' });
  };
  const resetAccent = () => {
    if (!base) return;
    api.getState().patchTheme({ accent: CRM_EMAIL_THEMES[base].accent, btnText: CRM_EMAIL_THEMES[base].btnText });
  };
  const isDefault = !!baseAccent && theme.accent.toUpperCase() === baseAccent.toUpperCase();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, animation: 'yc-fade 200ms both' }}>
      <Field label={t('yc.em.st.s.mood')}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {THEME_KEYS.map((k) => {
            const x = CRM_EMAIL_THEMES[k];
            const on = base === k;
            return (
              <Hv key={k} as="button" type="button" onClick={() => pickTheme(k)} aria-pressed={on} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 10, borderRadius: 16, border: `2px solid ${on ? 'var(--red-500)' : 'var(--sand-200)'}`, background: '#fff', cursor: 'pointer', textAlign: 'left', transition: `border-color 160ms,translate 200ms ${EASE}` }} hover={{ translate: '0 -2px' }}>
                <span style={{ height: 64, borderRadius: 10, background: x.bg, boxShadow: '0 0 0 1px var(--sand-200)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <span style={{ height: 16, background: x.headerBg }} />
                  <span style={{ flex: 1, margin: 6, borderRadius: 4, background: x.card }} />
                  <span style={{ width: 26, height: 8, margin: '0 auto 6px', borderRadius: 99, background: x.accent }} />
                </span>
                <b style={{ fontSize: 13.5, color: 'var(--ink)' }}>{t(`yc.em.st.s.t.${k}`)}</b>
              </Hv>
            );
          })}
        </div>
      </Field>
      <Field label={t('yc.em.st.s.buttons')}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          {base && (
            <button type="button" onClick={resetAccent} style={{ height: 36, padding: '0 14px', borderRadius: 99, border: `1.5px solid ${isDefault ? 'var(--red-500)' : 'var(--sand-200)'}`, background: '#fff', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', color: 'var(--ink)' }}>{t('yc.em.st.s.byMood')}</button>
          )}
          {ACCENTS.map((c) => {
            const shown = theme.dark && c === '#1C1517' ? '#F7F2F1' : c;
            const on = !isDefault && theme.accent.toUpperCase() === shown.toUpperCase();
            return (
              <Hv key={c} as="button" type="button" onClick={() => pickAccent(c)} aria-label={t('yc.em.st.s.color', { c })} aria-pressed={on} style={{ width: 34, height: 34, borderRadius: 99, border: 0, background: c, boxShadow: on ? `0 0 0 2px #fff,0 0 0 4px ${c}` : 'inset 0 0 0 1px rgba(0,0,0,.1)', cursor: 'pointer', transition: `transform 180ms ${SPRING}` }} hover={{ transform: 'scale(1.1)' }} />
            );
          })}
        </div>
      </Field>
      <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.em.st.s.fontNote')}</span>
    </div>
  );
}

// ── Onglet Objet ──────────────────────────────────────────────────────────

function SubjectTab() {
  const { t, tp, time } = useCrmT();
  const { space } = useCrmScope();
  const api = useStudioApi();
  const ui = useStudioUi();
  const subject = useStudio((s) => s.campaign.subject);
  const pre = useStudio((s) => s.campaign.preheader);
  const abOn = useStudio((s) => s.campaign.abOn);
  const subjectB = useStudio((s) => s.campaign.subjectB);
  const shown = subject.replace(/\{\{[^}]+\}\}/g, 'Camille');
  const n = shown.length;
  const tone = n === 0 ? 'var(--sand-500)' : n <= 45 ? 'var(--green-700)' : n <= 62 ? 'var(--amber-700)' : 'var(--red-600)';
  const hint = t(n === 0 ? 'yc.em.st.o.h0' : n <= 45 ? 'yc.em.st.o.h1' : n <= 62 ? 'yc.em.st.o.h2' : 'yc.em.st.o.h3');
  const focus = (apply: (v: string) => void) => (el: HTMLInputElement) => { ui.active.current = { kind: 'input', el, apply }; };
  const setSubject = (v: string) => api.getState().patchContent({ subject: v });
  const setPre = (v: string) => api.getState().patchContent({ preheader: v });
  const setB = (v: string) => api.getState().patchContent({ subjectB: v });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, animation: 'yc-fade 200ms both' }}>
      <Field label={t('yc.em.st.o.subject')} right={<span style={{ fontSize: 12.5, fontWeight: 600, color: tone }}>{n} / 62</span>} hint={<span style={{ color: tone }}>{hint}</span>}>
        <TextInput value={subject} onChange={setSubject} placeholder={t('yc.em.st.o.subjectPh')} label={t('yc.em.st.o.subject')} onFocusEl={focus(setSubject)} />
      </Field>
      <Field label={t('yc.em.st.o.pre')} right={<span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{tp('yc.em.st.o.preN', pre.length)}</span>}>
        <TextInput value={pre} onChange={setPre} placeholder={t('yc.em.st.o.prePh')} label={t('yc.em.st.o.pre')} onFocusEl={focus(setPre)} />
      </Field>
      <VarChips active />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, borderRadius: 18, background: 'var(--paper)', boxShadow: 'inset 0 0 0 1px var(--sand-100)' }}>
        <Toggle on={abOn} onChange={(v) => api.getState().patchCampaign({ abOn: v })} label={<span style={{ display: 'flex', flexDirection: 'column' }}><b style={{ fontSize: 14.5, color: 'var(--ink)' }}>{t('yc.em.st.o.ab')}</b><span style={{ fontSize: 12.5, color: 'var(--sand-500)', lineHeight: 1.35 }}>{t('yc.em.st.o.abSub')}</span></span>} />
        {abOn && (
          <div style={{ animation: `yc-pop 200ms ${EASE}` }}>
            <Field label={t('yc.em.st.o.subjectB')}><TextInput value={subjectB} onChange={setB} label={t('yc.em.st.o.subjectB')} onFocusEl={focus(setB)} /></Field>
          </div>
        )}
      </div>
      <Field label={t('yc.em.st.o.inbox')}>
        <div style={{ padding: '14px 16px', borderRadius: 16, background: '#fff', boxShadow: '0 0 0 1px var(--sand-200),var(--shadow-sm)', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          {space.logoUrl
            ? <img src={space.logoUrl} alt="" style={{ flex: 'none', width: 38, height: 38, borderRadius: 99, objectFit: 'cover' }} />
            : <span style={{ flex: 'none', width: 38, height: 38, borderRadius: 99, background: 'var(--gradient-brand)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 15 }}>{space.name.slice(0, 1).toUpperCase()}</span>}
          <span style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b style={{ fontSize: 14 }}>{space.name}</b><span style={{ fontSize: 12, color: 'var(--sand-400)' }}>{time(new Date())}</span></span>
            <b style={{ fontSize: 14, fontWeight: 600, lineHeight: '19px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shown || t('yc.em.st.o.inboxSubj')}</b>
            <span style={{ fontSize: 13.5, lineHeight: '18px', color: 'var(--sand-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pre.replace(/\{\{[^}]+\}\}/g, 'Camille') || t('yc.em.st.o.inboxPre')}</span>
          </span>
        </div>
      </Field>
    </div>
  );
}
