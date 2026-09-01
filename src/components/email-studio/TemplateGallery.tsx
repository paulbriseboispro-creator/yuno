import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarDays, ChevronLeft, Copy, FilePlus2, Layers, Loader2, Pencil, Sparkles, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  DEFAULT_STUDIO_THEME, buildStarter, eventBoundBlocks, makeBlock, normalizeTheme,
  renderEmailHtml, templateToCampaignContent, STARTER_TEMPLATES,
  type EmailTemplate, type StarterKey, type TemplateContent,
} from '@/lib/email';
import { useEmailTemplates, useStudioEvents, type StudioEvent, type StudioScope } from './hooks';
import { DeleteTemplateDialog, RenameTemplateDialog } from './TemplateDialogs';
import {
  APP_BG, BORDER, BORDER_FAINT, FONT_UI, FLOW_CARD_BG, FLOW_CARD_SHADOW, GhostBtn, PAGE_HALO,
  PrimaryBtn, RED, SUBTLE, T1, T2, T3, TextInput, TOPBAR_BG,
} from './ui';

/** Thème du club mémorisé par le panneau Thème — sinon le preset par défaut. */
function clubTheme() {
  try {
    const saved = localStorage.getItem('yn-studio-club-theme');
    if (saved) return normalizeTheme(JSON.parse(saved));
  } catch { /* stockage indisponible */ }
  return DEFAULT_STUDIO_THEME;
}

interface Choice {
  /** 'blank' | 'starter:<key>' | 'mine:<id>' — identité de la carte sélectionnée. */
  id: string;
  label: string;
  content: TemplateContent | null;
  templateId?: string;
}

/**
 * Écran « Nouvelle campagne » : on choisit un point de départ AVANT d'ouvrir le
 * Studio. C'est ici que se joue la promesse des modèles — le pro reprend son
 * design d'invitation et le pointe sur la soirée du moment.
 */
export default function TemplateGallery({ scope, basePath }: { scope: StudioScope; basePath: string }) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const events = useStudioEvents(scope);
  const { templates, loading, duplicate, rename, remove, bumpUsage } = useEmailTemplates(scope);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [eventId, setEventId] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<EmailTemplate | null>(null);
  const [pendingDelete, setPendingDelete] = useState<EmailTemplate | null>(null);
  const [deleting, setDeleting] = useState(false);
  const theme = useMemo(clubTheme, []);

  const starters = useMemo(
    () => STARTER_TEMPLATES.map((meta) => ({
      meta,
      content: buildStarter(meta.key as StarterKey, { venueName: scope.name, theme, t }),
    })),
    [scope.name, theme, t],
  );

  const blankContent = useMemo<TemplateContent>(() => ({
    type: 'promotional',
    subject: '',
    preheader: '',
    blocks: [makeBlock('header', { venueName: scope.name }), makeBlock('text')],
    theme,
    socialLinks: {},
    logoUrl: null,
  }), [scope.name, theme]);

  // Le nom de la campagne suit le modèle choisi tant que le pro n'y a pas
  // touché — changer d'avis de carte ne doit pas laisser l'ancien nom.
  const pick = (c: Choice) => {
    setChoice(c);
    if (!nameTouched) setName(c.label);
  };

  const pendingYunoBlocks = choice?.content ? eventBoundBlocks(choice.content.blocks).length : 0;

  const createCampaign = async () => {
    if (!choice || creating) return;
    setCreating(true);
    const content = choice.content
      ? templateToCampaignContent(choice.content)
      : templateToCampaignContent(blankContent);
    const insert: Record<string, unknown> = {
      name: name.trim() || t('studio.newName'),
      type: content.type,
      subject: content.subject || '—',
      preheader: content.preheader,
      blocks_json: content.blocks,
      blocks_version: 2,
      theme_json: content.theme,
      social_links_json: content.socialLinks,
      logo_url: content.logoUrl,
      event_id: eventId || null,
      audiences_json: [],
      exclusions_json: {},
      status: 'draft',
    };
    if (scope.kind === 'venue') insert.venue_id = scope.venueId;
    else insert.organizer_user_id = scope.organizerId;

    const { data, error } = await supabase.from('email_campaigns')
      .insert(insert as never).select('id').single();
    if (error || !data) {
      setCreating(false);
      toast.error(error?.message || t('studio.tpl.createError'));
      return;
    }
    if (choice.templateId) void bumpUsage(choice.templateId);
    navigate(`${basePath}/${(data as { id: string }).id}/edit`, { replace: true });
  };

  const duplicateTemplate = async (tpl: EmailTemplate) => {
    const copyName = `${tpl.name} ${t('studio.tpl.copySuffix')}`.slice(0, 80);
    const ok = await duplicate(tpl, copyName);
    if (!ok) { toast.error(t('studio.tpl.saveError')); return; }
    toast.success(t('studio.tpl.duplicated'));
  };

  const deleteTemplate = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    const ok = await remove(pendingDelete.id);
    setDeleting(false);
    if (!ok) { toast.error(t('studio.tpl.deleteError')); return; }
    if (choice?.templateId === pendingDelete.id) setChoice(null);
    setPendingDelete(null);
    toast.success(t('studio.tpl.deleted'));
  };

  return (
    <div className="yn-studio" style={{
      height: '100vh', overflow: 'hidden', background: APP_BG, position: 'relative',
      display: 'flex', flexDirection: 'column', fontFamily: FONT_UI,
    }}>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: PAGE_HALO }} />

      <header style={{
        position: 'relative', zIndex: 1, height: 58, flex: 'none', display: 'flex',
        alignItems: 'center', gap: 14, padding: '0 18px',
        background: TOPBAR_BG, borderBottom: `1px solid ${BORDER}`,
      }}>
        <GhostBtn onClick={() => navigate(basePath)} style={{ background: SUBTLE, padding: '7px 12px' }}>
          <ChevronLeft size={15} strokeWidth={1.75} /> {t('studio.top.back')}
        </GhostBtn>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: T1, fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em' }}>
            {t('studio.tpl.newTitle')}
          </div>
          <div style={{ color: T3, fontSize: 11 }}>{scope.name}</div>
        </div>
      </header>

      <div style={{ position: 'relative', zIndex: 1, flex: 1, overflowY: 'auto', padding: '26px 28px 140px' }}>
        <div style={{ maxWidth: 1160, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 26 }}>

          <p style={{ color: T2, fontSize: 13, margin: 0, maxWidth: 640 }}>{t('studio.tpl.newSub')}</p>

          {/* ── Départs Yuno ── */}
          <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <SectionTitle icon={<Sparkles size={13} strokeWidth={1.9} />} label={t('studio.tpl.starters')} />
            <Grid>
              <Card
                selected={choice?.id === 'blank'}
                onSelect={() => pick({ id: 'blank', label: t('studio.newName'), content: null })}
                title={t('studio.tpl.blank')}
                desc={t('studio.tpl.blankDesc')}
                preview={<BlankPreview />}
                meta=""
              />
              {starters.map(({ meta, content }) => (
                <Card
                  key={meta.key}
                  selected={choice?.id === `starter:${meta.key}`}
                  onSelect={() => pick({ id: `starter:${meta.key}`, label: t(meta.nameKey), content })}
                  title={t(meta.nameKey)}
                  desc={t(meta.descKey)}
                  preview={<Preview content={content} scope={scope} />}
                  meta={t('studio.tpl.blocks').replace('{n}', String(content.blocks.length))}
                />
              ))}
            </Grid>
          </section>

          {/* ── Modèles du pro ── */}
          <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <SectionTitle icon={<Layers size={13} strokeWidth={1.9} />} label={t('studio.tpl.mine')} />
            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}>
                <Loader2 size={20} className="animate-spin" style={{ color: T3 }} />
              </div>
            ) : templates.length === 0 ? (
              <div style={{
                border: `1px dashed ${BORDER}`, borderRadius: 14, padding: '22px 20px',
                display: 'flex', alignItems: 'flex-start', gap: 12, background: SUBTLE,
              }}>
                <FilePlus2 size={16} strokeWidth={1.75} style={{ color: T3, marginTop: 1, flex: 'none' }} />
                <p style={{ color: T2, fontSize: 12.5, margin: 0, lineHeight: 1.65, maxWidth: 620 }}>
                  {t('studio.tpl.mineEmpty')}
                </p>
              </div>
            ) : (
              <Grid>
                {templates.map((tpl) => (
                  <Card
                    key={tpl.id}
                    selected={choice?.id === `mine:${tpl.id}`}
                    onSelect={() => pick({ id: `mine:${tpl.id}`, label: tpl.name, content: tpl, templateId: tpl.id })}
                    title={tpl.name}
                    desc={tpl.description || t('studio.tpl.noDesc')}
                    preview={<Preview content={tpl} scope={scope} />}
                    meta={[
                      t('studio.tpl.blocks').replace('{n}', String(tpl.blocks.length)),
                      tpl.useCount > 0
                        ? t('studio.tpl.usedCount').replace('{n}', String(tpl.useCount))
                        : t('studio.tpl.neverUsed'),
                    ].join(' · ')}
                    actions={[
                      { icon: <Pencil size={13} strokeWidth={1.75} />, label: t('studio.tpl.rename'), run: () => setRenaming(tpl) },
                      { icon: <Copy size={13} strokeWidth={1.75} />, label: t('studio.tpl.duplicate'), run: () => { void duplicateTemplate(tpl); } },
                      { icon: <Trash2 size={13} strokeWidth={1.75} />, label: t('studio.tpl.delete'), danger: true, run: () => setPendingDelete(tpl) },
                    ]}
                  />
                ))}
              </Grid>
            )}
          </section>
        </div>
      </div>

      {/* ── Barre de création ── */}
      {choice && (
        <div style={{
          position: 'relative', zIndex: 3, flex: 'none',
          background: TOPBAR_BG, borderTop: `1px solid ${BORDER}`,
          padding: '14px 28px', backdropFilter: 'blur(8px)',
        }}>
          <div style={{
            maxWidth: 1160, margin: '0 auto', display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap',
          }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 260px', minWidth: 220 }}>
              <span style={{ color: T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                {t('studio.tpl.nameLabel')}
              </span>
              <TextInput
                value={name}
                onChange={(e) => { setNameTouched(true); setName(e.target.value); }}
                placeholder={t('studio.top.namePh')}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 300px', minWidth: 240 }}>
              <span style={{
                color: pendingYunoBlocks > 0 ? RED : T3, fontSize: 10.5, fontWeight: 600,
                letterSpacing: '0.07em', textTransform: 'uppercase',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}>
                <CalendarDays size={12} strokeWidth={2} /> {t('studio.tpl.eventLabel')}
              </span>
              <EventSelect events={events} value={eventId} onChange={setEventId} />
            </label>

            <PrimaryBtn onClick={() => { void createCampaign(); }} disabled={creating}>
              {creating ? <Loader2 size={14} className="animate-spin" /> : null}
              {creating ? t('studio.tpl.creating') : t('studio.tpl.create')}
            </PrimaryBtn>
          </div>
          <div style={{ maxWidth: 1160, margin: '8px auto 0' }}>
            <p style={{ color: pendingYunoBlocks > 0 && !eventId ? '#FCD34D' : T3, fontSize: 11.5, margin: 0 }}>
              {pendingYunoBlocks > 0 && !eventId
                ? t('studio.tpl.eventNeeded').replace('{n}', String(pendingYunoBlocks))
                : t('studio.tpl.eventHint')}
            </p>
          </div>
        </div>
      )}

      <DeleteTemplateDialog
        template={pendingDelete}
        busy={deleting}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => { void deleteTemplate(); }}
      />

      <RenameTemplateDialog
        template={renaming}
        onClose={() => setRenaming(null)}
        onSubmit={async (n, d) => {
          const ok = await rename(renaming!.id, n, d);
          if (!ok) { toast.error(t('studio.tpl.saveError')); return false; }
          toast.success(t('studio.tpl.savedUpdate'));
          setRenaming(null);
          return true;
        }}
      />
    </div>
  );
}

// ── Pièces d'interface ───────────────────────────────────────────────────────

function SectionTitle({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, color: T2,
      fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
    }}>
      {icon}{label}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'grid', gap: 14,
      gridTemplateColumns: 'repeat(auto-fill,minmax(248px,1fr))',
    }}>{children}</div>
  );
}

interface CardAction { icon: React.ReactNode; label: string; run: () => void; danger?: boolean }

function Card({ selected, onSelect, title, desc, preview, meta, actions }: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  desc: string;
  preview: React.ReactNode;
  meta: string;
  actions?: CardAction[];
}) {
  return (
    <div
      role="button" tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      aria-pressed={selected}
      style={{
        position: 'relative', textAlign: 'left', cursor: 'pointer', borderRadius: 16, overflow: 'hidden',
        background: FLOW_CARD_BG, boxShadow: FLOW_CARD_SHADOW,
        border: `1px solid ${selected ? 'rgba(232,25,44,0.55)' : BORDER}`,
        outline: selected ? '1px solid rgba(232,25,44,0.25)' : 'none',
        transition: 'border-color .12s, transform .12s',
      }}
    >
      <div style={{
        height: 138, overflow: 'hidden', position: 'relative',
        background: '#0d0d10', borderBottom: `1px solid ${BORDER_FAINT}`,
      }}>
        {preview}
        {actions && actions.length > 0 && (
          <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4 }}>
            {actions.map((a) => (
              <button
                key={a.label} type="button" title={a.label} aria-label={a.label}
                onClick={(e) => { e.stopPropagation(); a.run(); }}
                style={{
                  width: 26, height: 26, borderRadius: 8, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', cursor: 'pointer',
                  background: 'rgba(0,0,0,0.62)', border: `1px solid ${BORDER}`,
                  color: a.danger ? '#FF5C63' : T2, backdropFilter: 'blur(4px)',
                }}
              >{a.icon}</button>
            ))}
          </div>
        )}
      </div>
      <div style={{ padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{
          color: T1, fontSize: 13.5, fontWeight: 600, letterSpacing: '-0.01em',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{title}</div>
        <div style={{
          color: T3, fontSize: 11.5, lineHeight: 1.5,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>{desc}</div>
        {meta && <div style={{ color: 'rgba(255,255,255,0.28)', fontSize: 10.5, marginTop: 2 }}>{meta}</div>}
      </div>
    </div>
  );
}

/** Aperçu réel du modèle : le rendu email, mis à l'échelle. */
function Preview({ content, scope }: { content: TemplateContent; scope: StudioScope }) {
  const html = useMemo(() => renderEmailHtml(content.blocks, content.theme, {
    venueName: scope.name,
    logoUrl: scope.logoUrl,
    emailType: content.type,
    subject: content.subject,
    recipient: { email: 'apercu@exemple.com', firstName: 'Camille' },
    socialLinks: content.socialLinks,
    baseUrl: 'https://yunoapp.eu',
    ignoreConds: true,
  }, { omitFooter: true }), [content, scope.name, scope.logoUrl]);

  return (
    <iframe
      title="preview" srcDoc={html} tabIndex={-1} aria-hidden="true" loading="lazy"
      style={{
        width: 620, height: 470, border: 0, pointerEvents: 'none',
        transform: 'scale(0.4)', transformOrigin: 'top left',
      }}
    />
  );
}

function BlankPreview() {
  return (
    <div style={{
      height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'repeating-linear-gradient(135deg,rgba(255,255,255,.035) 0 6px,rgba(255,255,255,.012) 6px 12px)',
      color: T3,
    }}>
      <FilePlus2 size={26} strokeWidth={1.4} />
    </div>
  );
}

function EventSelect({ events, value, onChange }: {
  events: StudioEvent[]; value: string; onChange: (id: string) => void;
}) {
  const { t } = useLanguage();
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={t('studio.tpl.eventLabel')}
      style={{
        width: '100%', padding: '9px 11px', borderRadius: 10, background: '#0a0a0c',
        border: `1px solid ${BORDER}`, color: value ? T1 : T2, fontSize: 12.5,
        fontFamily: FONT_UI, cursor: 'pointer', outline: 'none',
      }}
    >
      <option value="">{t('studio.tpl.eventNone')}</option>
      {events.map((e) => (
        <option key={e.id} value={e.id}>
          {e.title} — {new Date(e.start_at).toLocaleDateString()}
        </option>
      ))}
    </select>
  );
}
