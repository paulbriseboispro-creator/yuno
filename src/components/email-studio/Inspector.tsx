import { useRef } from 'react';
import {
  Baseline, Bold, Braces, CalendarClock, ChevronDown, Copy, Italic, Link2, Lock,
  MousePointer, PanelBottom, Plus, RefreshCw, Strikethrough, Trash2, Underline, Zap,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import ImageUploader from '@/components/campaigns/ImageUploader';
import ColorField from '@/components/campaigns/ColorField';
import type {
  CtaBlock, EmailBlock, EventBlock, HeaderBlock, HtmlBlock, ImageBlock,
  SpacerBlock, TableBlock, TextBlock, TicketRow, TicketsBlock, ColumnsBlock, CountdownBlock,
} from '@/lib/email';
import { blockPadDefaults } from '@/lib/email';
import { useStudio } from './store';
import type { StudioEvent } from './hooks';
import { blockMeta, FOOTER_SELECTION_ID } from './meta';
import {
  BORDER, FONT_UI, Help, IconBtn, MicroLabel, MONO, OptionPills, PanelCard, POS,
  RED, SUBTLE, T1, T3, TextArea, TextInput, ToggleRow, inputStyle,
} from './ui';

interface Props {
  events: StudioEvent[];
  bucketFolder: string;
  /** Marque du compte (club / organisateur) héritée par le bloc header. */
  brand: { name: string; logoUrl?: string | null };
}

/** Inspecteur contextuel — champs selon le type du bloc sélectionné. */
export default function Inspector({ events, bucketFolder, brand }: Props) {
  const { t } = useLanguage();
  const blocks = useStudio((s) => s.campaign.blocks);
  const selectedId = useStudio((s) => s.selectedId);
  const updateBlock = useStudio((s) => s.updateBlock);
  const duplicate = useStudio((s) => s.duplicate);
  const removeBlock = useStudio((s) => s.removeBlock);

  const theme = useStudio((s) => s.campaign.theme);
  // Le pied de page se sélectionne dans le canvas mais n'est PAS un bloc :
  // il a son propre panneau, sans dupliquer/supprimer.
  if (selectedId === FOOTER_SELECTION_ID) return <FooterFields />;

  const block = blocks.find((b) => b.id === selectedId);
  if (!block) {
    return (
      <div style={{ textAlign: 'center', padding: '36px 10px' }}>
        <MousePointer size={26} strokeWidth={1.5} style={{ color: 'rgba(255,255,255,0.14)' }} />
        <div style={{ color: T3, fontSize: 12, marginTop: 10, lineHeight: 1.5, fontFamily: FONT_UI }}>
          {t('studio.inspector.empty')}
        </div>
      </div>
    );
  }

  const meta = blockMeta(block.type);
  const Icon = meta.icon;
  const patch = (p: Partial<EmailBlock>) => updateBlock(block.id, p);

  return (
    <div className="yn-in" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* En-tête du bloc sélectionné */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 11, display: 'flex', alignItems: 'center',
          justifyContent: 'center', background: 'rgba(232,25,44,0.1)',
          border: '1px solid rgba(232,25,44,0.2)', color: RED, flex: 'none',
        }}><Icon size={16} strokeWidth={1.75} /></div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: T1, fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em', fontFamily: FONT_UI }}>
            {t(meta.labelKey)}
          </div>
          <div style={{ color: T3, fontSize: 11, fontFamily: FONT_UI }}>{t('studio.inspector.blockProps')}</div>
        </div>
        <IconBtn size={26} ariaLabel={t('studio.canvas.duplicate')} onClick={() => duplicate(block.id)}
          style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8 }}>
          <Copy size={13} strokeWidth={1.75} />
        </IconBtn>
        <IconBtn size={26} danger ariaLabel={t('studio.canvas.delete')} onClick={() => removeBlock(block.id)}
          style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8 }}>
          <Trash2 size={13} strokeWidth={1.75} />
        </IconBtn>
      </div>

      <BlockFields block={block} patch={patch} events={events} bucketFolder={bucketFolder} brand={brand} />

      {/* Espacement & fond — commun à tous les blocs (prototype).
          0 = aucune marge : les blocs s'enchaînent collés. Les défauts sont
          PAR TYPE (blockPadDefaults) — même table que le rendu. */}
      <PanelCard>
        <MicroLabel>{t('studio.inspector.padX')}</MicroLabel>
        <OptionPills
          value={block.px ?? blockPadDefaults(block.type).px}
          onChange={(v) => patch({ px: v === blockPadDefaults(block.type).px ? undefined : v })}
          options={[...new Set([0, 16, 24, 40, blockPadDefaults(block.type).px])]
            .sort((a, b) => a - b)
            .map((n) => ({ value: n, label: String(n) }))}
        />
        <MicroLabel>{t('studio.inspector.padY')}</MicroLabel>
        <OptionPills
          value={block.py ?? blockPadDefaults(block.type).py}
          onChange={(v) => patch({ py: v === blockPadDefaults(block.type).py ? undefined : v })}
          options={[...new Set([0, 4, 12, 18, 32, blockPadDefaults(block.type).py])]
            .sort((a, b) => a - b)
            .map((n) => ({ value: n, label: String(n) }))}
        />
        <MicroLabel>{t('studio.inspector.blockBg')}</MicroLabel>
        <OptionPills
          value={block.bg ?? 'auto'}
          onChange={(v) => patch({ bg: v === 'auto' ? undefined : (v as 'tile' | 'accent') })}
          options={[
            { value: 'auto', label: t('studio.inspector.bgAuto') },
            { value: 'tile', label: t('studio.inspector.bgTile') },
            { value: 'accent', label: t('studio.inspector.bgAccent') },
          ]}
        />
        {/* Le header a sa propre couleur de thème : lui proposer `card` comme
            valeur de départ laissait croire que le champ ne faisait rien. */}
        <ThemedColor
          label={t('studio.inspector.blockBgc')}
          value={block.bgc}
          themeDefault={block.type === 'header' ? theme.headerBg : theme.card}
          onChange={(v) => patch({ bgc: v })}
        />
      </PanelCard>
    </div>
  );
}

const SOCIAL_KEYS = ['instagram', 'tiktok', 'facebook', 'x', 'website'] as const;

/**
 * Réglages du PIED DE PAGE. Ce qu'on peut toucher : les réseaux (affichés ou
 * non, et leurs liens) et les deux couleurs de la bande. Ce qu'on ne peut PAS
 * toucher, et c'est volontaire : l'identité de l'expéditeur, la raison de
 * réception et le lien de désinscription — ce sont des obligations légales
 * (RGPD / CAN-SPAM), écrites par le rendu et par personne d'autre.
 */
function FooterFields() {
  const { t } = useLanguage();
  const theme = useStudio((s) => s.campaign.theme);
  const patchTheme = useStudio((s) => s.patchTheme);
  const socialLinks = useStudio((s) => s.campaign.socialLinks);
  const setSocialLinks = useStudio((s) => s.setSocialLinks);
  const emailType = useStudio((s) => s.campaign.type);
  const footerSocial = theme.footerSocial !== false;

  const legalLines = [
    t('studio.footer.legalSender'),
    t('studio.footer.legalReason'),
    t('studio.footer.legalCopyright'),
    ...(emailType === 'promotional' ? [t('studio.footer.legalUnsub')] : []),
  ];

  return (
    <div className="yn-in" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 11, display: 'flex', alignItems: 'center',
          justifyContent: 'center', background: 'rgba(232,25,44,0.1)',
          border: '1px solid rgba(232,25,44,0.2)', color: RED, flex: 'none',
        }}><PanelBottom size={16} strokeWidth={1.75} /></div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: T1, fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em', fontFamily: FONT_UI }}>
            {t('studio.footer.label')}
          </div>
          <div style={{ color: T3, fontSize: 11, fontFamily: FONT_UI }}>{t('studio.footer.sub')}</div>
        </div>
      </div>

      <PanelCard style={{ gap: 11 }}>
        <MicroLabel>{t('studio.footer.social')}</MicroLabel>
        <ToggleRow
          checked={footerSocial}
          onChange={(v) => patchTheme({ footerSocial: v })}
          label={t('studio.theme.footerSocial')}
          help={t('studio.theme.footerSocialHelp')}
        />
        {footerSocial && SOCIAL_KEYS.map((key) => (
          <TextInput
            key={key}
            value={socialLinks[key] || ''}
            onChange={(e) => setSocialLinks({ ...socialLinks, [key]: e.target.value || undefined })}
            placeholder={key === 'website' ? 'lesilo.fr' : `${key}.com/lesilo`}
            aria-label={key}
            style={inputStyle}
          />
        ))}
        {footerSocial && <Help>{t('studio.theme.footerLinksHelp')}</Help>}
      </PanelCard>

      <PanelCard style={{ gap: 11 }}>
        <MicroLabel>{t('studio.theme.colors')}</MicroLabel>
        <ColorField
          label={t('studio.theme.footerBg')}
          value={theme.footerBg}
          onChange={(v) => patchTheme({ footerBg: v })}
        />
        <ColorField
          label={t('studio.theme.footerText')}
          value={theme.footerText}
          onChange={(v) => patchTheme({ footerText: v })}
        />
      </PanelCard>

      {/* Mentions légales — affichées, jamais éditables. */}
      <PanelCard style={{ gap: 9 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Lock size={12} strokeWidth={2} style={{ color: T3, flex: 'none' }} />
          <MicroLabel style={{ margin: 0 }}>{t('studio.footer.legal')}</MicroLabel>
        </div>
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 11px',
          borderRadius: 10, background: SUBTLE, border: `1px solid ${BORDER}`,
        }}>
          {legalLines.map((line) => (
            <span key={line} style={{
              color: 'rgba(255,255,255,0.42)', fontSize: 11.5, lineHeight: 1.5, fontFamily: FONT_UI,
            }}>{line}</span>
          ))}
        </div>
        <Help>{t('studio.footer.legalHelp')}</Help>
      </PanelCard>
    </div>
  );
}

/**
 * Champ couleur avec retour au thème : la valeur n'est persistée sur le bloc
 * que si elle diffère de la couleur du thème (sinon le bloc suit le thème).
 */
function ThemedColor({ label, value, themeDefault, onChange }: {
  label: string;
  value: string | undefined;
  themeDefault: string;
  onChange: (v: string | undefined) => void;
}) {
  const { t } = useLanguage();
  return (
    <>
      <MicroLabel>{label}</MicroLabel>
      <ColorField
        label={label}
        value={value || themeDefault}
        defaultValue={themeDefault}
        onChange={(v) => onChange(v && v.toLowerCase() !== themeDefault.toLowerCase() ? v : undefined)}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange(undefined)}
          style={{
            alignSelf: 'flex-start', padding: '5px 10px', borderRadius: 8,
            border: `1px solid ${BORDER}`, background: 'transparent', cursor: 'pointer',
            color: 'rgba(255,255,255,0.58)', fontSize: 11.5, fontFamily: FONT_UI,
          }}
        >{t('studio.inspector.ctaColorAuto')}</button>
      )}
    </>
  );
}

/** ISO UTC → valeur d'un input datetime-local (heure locale du navigateur). */
function isoToLocalInput(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Nuancier de la barre de mise en forme (accent du thème + tons utiles). */
const FMT_COLORS = ['accent', '#E8192C', '#D4AF37', '#34D399', '#3B82F6', '#8A8A8A', '#FFFFFF', '#0A0A0A'] as const;
const FMT_SIZES = [12, 14, 18, 22, 28] as const;

/**
 * Textarea + barre de mise en forme : chaque bouton enveloppe la sélection
 * avec le mini-markup rendu par inlineMarkup (render.ts). Le canvas montre le
 * résultat en direct, l'email envoyé rend exactement pareil.
 */
function TextEditorWithFormatBar({ body, onBody }: { body: string; onBody: (v: string) => void }) {
  const { t } = useLanguage();
  const taRef = useRef<HTMLTextAreaElement>(null);

  const wrap = (before: string, after: string) => {
    const el = taRef.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value } = el;
    const sel = value.slice(s, e) || t('studio.inspector.fmtPlaceholder');
    const next = value.slice(0, s) + before + sel + after + value.slice(e);
    onBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + before.length, s + before.length + sel.length);
    });
  };

  const addLink = () => {
    const url = window.prompt(t('studio.inspector.fmtLinkPrompt'), 'https://');
    if (!url || !url.trim() || url.trim() === 'https://') return;
    wrap(`[url=${url.trim()}]`, '[/url]');
  };

  const fmtBtn = (label: string, icon: React.ReactNode, onClick: () => void) => (
    <button
      type="button" aria-label={label} title={label} onClick={onClick}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.09)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      style={{
        width: 24, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 6, color: 'rgba(255,255,255,0.62)', cursor: 'pointer',
        background: 'transparent', border: 'none', flex: 'none',
      }}
    >{icon}</button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', padding: 3,
        borderRadius: 9, background: SUBTLE, border: `1px solid ${BORDER}`,
      }}>
        {fmtBtn(t('studio.inspector.fmtBold'), <Bold size={13} strokeWidth={2.25} />, () => wrap('**', '**'))}
        {fmtBtn(t('studio.inspector.fmtItalic'), <Italic size={13} strokeWidth={1.75} />, () => wrap('*', '*'))}
        {fmtBtn(t('studio.inspector.fmtStrike'), <Strikethrough size={13} strokeWidth={1.75} />, () => wrap('~~', '~~'))}
        {fmtBtn(t('studio.inspector.fmtUnderline'), <Underline size={13} strokeWidth={1.75} />, () => wrap('__', '__'))}
        <span style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.12)', margin: '0 3px', flex: 'none' }} />
        {FMT_SIZES.map((n) => (
          <button
            key={n} type="button"
            aria-label={`${t('studio.inspector.fmtSize')} ${n}px`} title={`${t('studio.inspector.fmtSize')} ${n}px`}
            onClick={() => wrap(`[s=${n}]`, '[/s]')}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.09)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            style={{
              height: 24, padding: '0 5px', display: 'inline-flex', alignItems: 'center',
              borderRadius: 6, color: 'rgba(255,255,255,0.62)', cursor: 'pointer',
              background: 'transparent', border: 'none', flex: 'none',
              fontFamily: FONT_UI, fontWeight: 600,
              fontSize: Math.min(13, 8 + n * 0.2),
            }}
          >A</button>
        ))}
        <span style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.12)', margin: '0 3px', flex: 'none' }} />
        {fmtBtn(t('studio.inspector.fmtLink'), <Link2 size={13} strokeWidth={1.75} />, addLink)}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        <Baseline size={12} strokeWidth={1.75} style={{ color: T3, flex: 'none' }} />
        {FMT_COLORS.map((c) => (
          <button
            key={c} type="button"
            aria-label={`${t('studio.inspector.fmtColor')} ${c}`} title={`${t('studio.inspector.fmtColor')} ${c}`}
            onClick={() => wrap(`[c=${c}]`, '[/c]')}
            style={{
              width: 16, height: 16, borderRadius: '50%', cursor: 'pointer', padding: 0, flex: 'none',
              border: '1px solid rgba(255,255,255,0.25)',
              background: c === 'accent'
                ? 'conic-gradient(#E8192C,#D4AF37,#3B82F6,#E8192C)'
                : c,
            }}
          />
        ))}
        <input
          type="color"
          aria-label={t('studio.inspector.fmtColor')} title={t('studio.inspector.fmtColor')}
          onChange={(e) => wrap(`[c=${e.target.value}]`, '[/c]')}
          style={{
            width: 20, height: 18, padding: 0, border: `1px solid ${BORDER}`, borderRadius: 5,
            background: 'transparent', cursor: 'pointer', flex: 'none',
          }}
        />
      </div>
      <TextArea ref={taRef} value={body} onChange={(e) => onBody(e.target.value)} style={{ minHeight: 120 }} />
      <Help>{t('studio.inspector.fmtHint')}</Help>
    </div>
  );
}

function EventPicker({ value, events, onChange }: {
  value?: string; events: StudioEvent[]; onChange: (id: string | undefined) => void;
}) {
  const { t } = useLanguage();
  const current = events.find((e) => e.id === value);
  return (
    <div style={{ position: 'relative' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 10,
        background: SUBTLE, border: `1px solid ${BORDER}`,
      }}>
        <div style={{
          width: 26, height: 26, borderRadius: 7, flex: 'none',
          background: 'repeating-linear-gradient(135deg,rgba(255,255,255,.10) 0 4px,rgba(255,255,255,.04) 4px 8px)',
        }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            color: T1, fontSize: 12.5, fontWeight: 560, whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: FONT_UI,
          }}>{current ? current.title : t('studio.inspector.eventNone')}</div>
          <div style={{ color: T3, fontSize: 10.5, fontFamily: FONT_UI }}>
            {current ? new Date(current.start_at).toLocaleDateString() : t('studio.inspector.eventNoneHint')}
          </div>
        </div>
        <ChevronDown size={16} strokeWidth={1.75} style={{ color: T3, flex: 'none' }} />
      </div>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        aria-label={t('studio.inspector.event')}
        style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%' }}
      >
        <option value="">{t('studio.inspector.eventNone')}</option>
        {events.map((e) => (
          <option key={e.id} value={e.id}>{e.title} — {new Date(e.start_at).toLocaleDateString()}</option>
        ))}
      </select>
    </div>
  );
}

function Banner({ tone, icon, children }: { tone: 'green' | 'red'; icon: React.ReactNode; children: React.ReactNode }) {
  const colors = tone === 'green'
    ? { bg: 'rgba(52,211,153,0.07)', border: 'rgba(52,211,153,0.2)' }
    : { bg: 'rgba(232,25,44,0.08)', border: 'rgba(232,25,44,0.2)' };
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 8, padding: '9px 10px', borderRadius: 10,
      background: colors.bg, border: `1px solid ${colors.border}`,
    }}>
      {icon}
      <span style={{ color: 'rgba(255,255,255,0.58)', fontSize: 11.5, lineHeight: 1.5, fontFamily: FONT_UI }}>{children}</span>
    </div>
  );
}

function BlockFields({ block, patch, events, bucketFolder, brand }: {
  block: EmailBlock; patch: (p: Partial<EmailBlock>) => void;
  events: StudioEvent[]; bucketFolder: string; brand: { name: string; logoUrl?: string | null };
}) {
  const { t } = useLanguage();
  const setSocialLinks = useStudio((s) => s.setSocialLinks);
  const socialLinks = useStudio((s) => s.campaign.socialLinks);
  const theme = useStudio((s) => s.campaign.theme);

  const alignPills = (value: 'left' | 'center' | 'right', onChange: (v: 'left' | 'center' | 'right') => void) => (
    <OptionPills
      value={value}
      onChange={onChange}
      options={[
        { value: 'left', label: t('studio.inspector.alignLeft') },
        { value: 'center', label: t('studio.inspector.alignCenter') },
        { value: 'right', label: t('studio.inspector.alignRight') },
      ]}
    />
  );

  switch (block.type) {
    case 'text': {
      const b = block as TextBlock;
      return (
        <>
          <PanelCard>
            <MicroLabel>{t('studio.inspector.textContent')}</MicroLabel>
            <TextEditorWithFormatBar body={b.body} onBody={(body) => patch({ body })} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: T3, fontSize: 11, fontFamily: FONT_UI }}>
              <Braces size={12} strokeWidth={1.75} style={{ color: RED, flex: 'none' }} />
              {t('studio.inspector.textVarsHint')}
            </div>
          </PanelCard>
          <PanelCard>
            <MicroLabel>{t('studio.inspector.fontSize')}</MicroLabel>
            <OptionPills
              value={b.size}
              onChange={(v) => patch({ size: v })}
              options={[14, 16, 18, 22].map((n) => ({ value: n, label: String(n) }))}
            />
            <MicroLabel>{t('studio.inspector.align')}</MicroLabel>
            {alignPills(b.align, (v) => patch({ align: v }))}
            <ThemedColor
              label={t('studio.inspector.textColor')}
              value={b.color}
              themeDefault={theme.text}
              onChange={(v) => patch({ color: v })}
            />
          </PanelCard>
        </>
      );
    }
    case 'cta': {
      const b = block as CtaBlock;
      return (
        <>
          <PanelCard>
            <MicroLabel>{t('studio.inspector.ctaLabel')}</MicroLabel>
            <TextInput value={b.label} onChange={(e) => patch({ label: e.target.value })} />
            <MicroLabel>{t('studio.inspector.ctaUrl')}</MicroLabel>
            <TextInput value={b.url} onChange={(e) => patch({ url: e.target.value })} placeholder="https://…" />
          </PanelCard>
          <PanelCard>
            <MicroLabel>{t('studio.inspector.shape')}</MicroLabel>
            <OptionPills
              value={b.radius}
              onChange={(v) => patch({ radius: v })}
              options={[
                { value: 0, label: t('studio.inspector.shapeSquare') },
                { value: 8, label: t('studio.inspector.shapeSoft') },
                { value: 999, label: t('studio.inspector.shapePill') },
              ]}
            />
            {alignPills(b.align, (v) => patch({ align: v }))}
            <ToggleRow checked={b.full} onChange={(v) => patch({ full: v })} label={t('studio.inspector.fullWidth')} />
          </PanelCard>
          <PanelCard>
            <ThemedColor
              label={t('studio.inspector.ctaColor')}
              value={b.color}
              themeDefault={theme.accent}
              onChange={(v) => patch({ color: v })}
            />
            {!b.color && <Help>{t('studio.inspector.ctaColorHelp')}</Help>}
          </PanelCard>
        </>
      );
    }
    case 'event': {
      const b = block as EventBlock;
      return (
        <>
          <PanelCard>
            <MicroLabel>{t('studio.inspector.event')}</MicroLabel>
            <EventPicker value={b.eventId} events={events} onChange={(id) => patch({ eventId: id })} />
            <Banner tone="green" icon={<RefreshCw size={13} strokeWidth={1.75} style={{ color: POS, marginTop: 1, flex: 'none' }} />}>
              {t('studio.inspector.eventHelp')}
            </Banner>
          </PanelCard>
          <PanelCard>
            <MicroLabel>{t('studio.inspector.display')}</MicroLabel>
            <ToggleRow checked={b.cover} onChange={(v) => patch({ cover: v })} label={t('studio.inspector.showCover')} />
            <ToggleRow checked={b.venue} onChange={(v) => patch({ venue: v })} label={t('studio.inspector.showVenue')} />
            <ToggleRow checked={b.price} onChange={(v) => patch({ price: v })} label={t('studio.inspector.showPrice')} />
          </PanelCard>
          <PanelCard>
            <MicroLabel>{t('studio.inspector.blockButton')}</MicroLabel>
            <TextInput value={b.ctaLabel} onChange={(e) => patch({ ctaLabel: e.target.value })} />
            <ThemedColor
              label={t('studio.inspector.accentColor')}
              value={b.accent}
              themeDefault={theme.accent}
              onChange={(v) => patch({ accent: v })}
            />
          </PanelCard>
          {!b.eventId && (
            <PanelCard>
              <MicroLabel>{t('studio.inspector.staticContent')}</MicroLabel>
              <TextInput value={b.title} onChange={(e) => patch({ title: e.target.value })} placeholder={t('studio.inspector.eventTitle')} />
              <TextInput value={b.dateLabel} onChange={(e) => patch({ dateLabel: e.target.value })} placeholder={t('studio.inspector.eventDate')} />
              <TextInput value={b.venueLabel} onChange={(e) => patch({ venueLabel: e.target.value })} placeholder={t('studio.inspector.eventVenue')} />
            </PanelCard>
          )}
        </>
      );
    }
    case 'tickets': {
      const b = block as TicketsBlock;
      const setRow = (i: number, p: Partial<TicketRow>) =>
        patch({ rows: b.rows.map((r, idx) => (idx === i ? { ...r, ...p } : r)) });
      return (
        <>
          <PanelCard>
            <MicroLabel>{t('studio.inspector.event')}</MicroLabel>
            <EventPicker value={b.eventId} events={events} onChange={(id) => patch({ eventId: id })} />
            <ToggleRow
              checked={b.live}
              onChange={(v) => patch({ live: v })}
              label={t('studio.inspector.ticketsLive')}
              help={t('studio.inspector.ticketsLiveHelp')}
            />
            <ThemedColor
              label={t('studio.inspector.accentColor')}
              value={b.accent}
              themeDefault={theme.accent}
              onChange={(v) => patch({ accent: v })}
            />
          </PanelCard>
          <PanelCard>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <MicroLabel>{t('studio.inspector.ticketsRows')}</MicroLabel>
              <span style={{ color: T3, fontSize: 10.5, fontFamily: FONT_UI }}>{t('studio.inspector.ticketsSync')}</span>
            </div>
            {b.rows.map((r, i) => (
              <div key={i} style={{
                padding: 10, borderRadius: 11, background: SUBTLE, border: `1px solid ${BORDER}`,
                display: 'flex', flexDirection: 'column', gap: 6,
              }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <TextInput value={r.n} onChange={(e) => setRow(i, { n: e.target.value })}
                    placeholder={t('studio.inspector.rowName')} style={{ padding: '6px 9px', fontSize: 12 }} />
                  <TextInput value={r.p} onChange={(e) => setRow(i, { p: e.target.value })}
                    placeholder="18 €" style={{ padding: '6px 9px', fontSize: 12, width: 72, flex: 'none' }} />
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <TextInput value={r.s} onChange={(e) => setRow(i, { s: e.target.value })}
                    placeholder={t('studio.inspector.rowSub')} style={{ padding: '6px 9px', fontSize: 12 }} />
                  <IconBtn size={26} danger ariaLabel={t('studio.inspector.rowRemove')}
                    onClick={() => patch({ rows: b.rows.filter((_, idx) => idx !== i) })}>
                    <Trash2 size={13} strokeWidth={1.75} />
                  </IconBtn>
                </div>
                <ToggleRow checked={r.out} onChange={(v) => setRow(i, { out: v })} label={t('studio.inspector.rowOut')} />
              </div>
            ))}
            <button
              type="button"
              onClick={() => patch({ rows: [...b.rows, { n: t('studio.inspector.rowNewName'), s: t('studio.inspector.rowNewSub'), p: '20 €', out: false }] })}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: 9,
                borderRadius: 11, border: '1px dashed rgba(255,255,255,0.16)', background: 'transparent',
                color: 'rgba(255,255,255,0.58)', fontSize: 12, cursor: 'pointer', fontFamily: FONT_UI,
              }}
            >
              <Plus size={13} strokeWidth={1.75} /> {t('studio.inspector.rowAdd')}
            </button>
          </PanelCard>
        </>
      );
    }
    case 'table': {
      const b = block as TableBlock;
      return (
        <PanelCard>
          <MicroLabel>{t('studio.inspector.event')}</MicroLabel>
          <EventPicker value={b.eventId} events={events} onChange={(id) => patch({ eventId: id })} />
          <MicroLabel>{t('studio.inspector.tableTitle')}</MicroLabel>
          <TextInput value={b.title} onChange={(e) => patch({ title: e.target.value })} />
          <MicroLabel>{t('studio.inspector.tableSub')}</MicroLabel>
          <TextInput value={b.sub} onChange={(e) => patch({ sub: e.target.value })} />
          <MicroLabel>{t('studio.inspector.blockButton')}</MicroLabel>
          <TextInput value={b.ctaLabel} onChange={(e) => patch({ ctaLabel: e.target.value })} />
          <ThemedColor
            label={t('studio.inspector.accentColor')}
            value={b.accent}
            themeDefault={theme.accent}
            onChange={(v) => patch({ accent: v })}
          />
          <Banner tone="red" icon={<Zap size={13} strokeWidth={1.75} style={{ color: RED, flex: 'none' }} />}>
            {t('studio.inspector.tableLive')}
          </Banner>
        </PanelCard>
      );
    }
    case 'header': {
      const b = block as HeaderBlock;
      return (
        <>
          <PanelCard>
            <MicroLabel>{t('studio.inspector.venueName')}</MicroLabel>
            <TextInput
              value={b.venueName}
              placeholder={brand.name}
              onChange={(e) => patch({ venueName: e.target.value })}
            />
            <ToggleRow checked={b.showName} onChange={(v) => patch({ showName: v })} label={t('studio.inspector.showName')} />
          </PanelCard>
          <PanelCard>
            <MicroLabel>{t('studio.inspector.logo')}</MicroLabel>
            <ImageUploader
              value={b.logoUrl || null}
              onChange={(url) => patch({ logoUrl: url || undefined })}
              bucketFolder={bucketFolder}
              preview="logo"
              previewShape={b.logoShape === 'circle' ? 'circle' : b.logoShape === 'rounded' ? 'rounded' : 'free'}
              autoUrl={brand.logoUrl || null}
              autoLabel={t('studio.inspector.logoAuto')}
              autoOverrideLabel={t('studio.inspector.logoOverride')}
              removeLabel={brand.logoUrl ? t('studio.inspector.logoUseAuto') : undefined}
            />
            {brand.logoUrl && !b.logoUrl && <Help>{t('studio.inspector.logoAutoHelp')}</Help>}
            <OptionPills
              value={b.logoSize}
              onChange={(v) => patch({ logoSize: v })}
              options={[{ value: 'sm', label: 'S' }, { value: 'md', label: 'M' }, { value: 'lg', label: 'L' }]}
            />
            <OptionPills
              value={b.logoShape}
              onChange={(v) => patch({ logoShape: v })}
              options={[
                { value: 'square', label: t('studio.inspector.shapeSquare') },
                { value: 'rounded', label: t('studio.inspector.shapeRounded') },
                { value: 'circle', label: t('studio.inspector.shapeCircle') },
              ]}
            />
          </PanelCard>
        </>
      );
    }
    case 'image': {
      const b = block as ImageBlock;
      return (
        <PanelCard>
          <MicroLabel>{t('studio.inspector.file')}</MicroLabel>
          <ImageUploader
            value={b.url || null}
            onChange={(url) => patch({ url: url || undefined })}
            bucketFolder={bucketFolder}
            preview="wide"
          />
          <MicroLabel>{t('studio.inspector.alt')}</MicroLabel>
          <TextInput value={b.label} onChange={(e) => patch({ label: e.target.value })} placeholder={t('studio.inspector.altPh')} />
          <Help>{t('studio.inspector.altHelp')}</Help>
          <MicroLabel>{t('studio.inspector.height')}</MicroLabel>
          <OptionPills
            value={b.h}
            onChange={(v) => patch({ h: v })}
            options={[
              { value: 150, label: t('studio.inspector.hLow') },
              { value: 230, label: t('studio.inspector.hMid') },
              { value: 320, label: t('studio.inspector.hHigh') },
            ]}
          />
          <MicroLabel>{t('studio.inspector.linkUrl')}</MicroLabel>
          <TextInput value={b.linkUrl || ''} onChange={(e) => patch({ linkUrl: e.target.value || undefined })} placeholder="https://…" />
          <MicroLabel>{t('studio.inspector.imgRadius')}</MicroLabel>
          <OptionPills
            value={b.radius ?? 0}
            onChange={(v) => patch({ radius: v === 0 ? undefined : v })}
            options={[
              { value: 0, label: t('studio.inspector.shapeSquare') },
              { value: 12, label: t('studio.inspector.shapeSoft') },
              { value: 20, label: t('studio.inspector.shapeRounded') },
            ]}
          />
        </PanelCard>
      );
    }
    case 'countdown': {
      const b = block as CountdownBlock;
      return (
        <PanelCard>
          <MicroLabel>{t('studio.inspector.countdownLabel')}</MicroLabel>
          <TextInput value={b.label} onChange={(e) => patch({ label: e.target.value })} />
          <MicroLabel>{t('studio.inspector.deadline')}</MicroLabel>
          <div style={{ position: 'relative' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', borderRadius: 10,
              background: SUBTLE, border: `1px solid ${BORDER}`,
            }}>
              <CalendarClock size={14} strokeWidth={1.75} style={{ color: T3, flex: 'none' }} />
              <span style={{ flex: 1, color: T1, fontSize: 12.5, fontFamily: FONT_UI, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {events.find((e) => e.id === b.eventId)?.title || t('studio.inspector.eventNone')}
              </span>
              <ChevronDown size={14} strokeWidth={1.75} style={{ color: T3, flex: 'none' }} />
            </div>
            <select
              value={b.eventId || ''}
              onChange={(e) => patch({ eventId: e.target.value || undefined })}
              aria-label={t('studio.inspector.deadline')}
              style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%' }}
            >
              <option value="">{t('studio.inspector.eventNone')}</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>{e.title} — {new Date(e.start_at).toLocaleDateString()}</option>
              ))}
            </select>
          </div>
          {!b.eventId && (
            <>
              <MicroLabel>{t('studio.inspector.countdownDate')}</MicroLabel>
              <input
                type="datetime-local"
                value={isoToLocalInput(b.targetAt)}
                onChange={(e) => patch({
                  // Stocké en ISO UTC : le rendu edge (Deno, UTC) tombe juste.
                  targetAt: e.target.value ? new Date(e.target.value).toISOString() : undefined,
                })}
                aria-label={t('studio.inspector.countdownDate')}
                style={{ ...inputStyle, colorScheme: 'dark' }}
              />
            </>
          )}
          <ThemedColor
            label={t('studio.inspector.accentColor')}
            value={b.accent}
            themeDefault={theme.accent}
            onChange={(v) => patch({ accent: v })}
          />
          <Help>{t('studio.inspector.countdownHelp')}</Help>
        </PanelCard>
      );
    }
    case 'spacer': {
      const b = block as SpacerBlock;
      return (
        <PanelCard>
          <MicroLabel>{t('studio.inspector.height')}</MicroLabel>
          <OptionPills
            value={b.size}
            onChange={(v) => patch({ size: v })}
            options={[
              { value: 'sm', label: 'S' }, { value: 'md', label: 'M' },
              { value: 'lg', label: 'L' }, { value: 'xl', label: 'XL' },
            ]}
          />
        </PanelCard>
      );
    }
    case 'html': {
      const b = block as HtmlBlock;
      return (
        <PanelCard>
          <MicroLabel>{t('studio.inspector.htmlCode')}</MicroLabel>
          <TextArea
            value={b.code}
            onChange={(e) => patch({ code: e.target.value })}
            style={{ fontFamily: MONO, fontSize: 11.5, minHeight: 140 }}
            spellCheck={false}
          />
          <Help>{t('studio.inspector.htmlHelp')}</Help>
        </PanelCard>
      );
    }
    case 'social': {
      const b = block;
      return (
        <PanelCard>
          <MicroLabel>{t('studio.inspector.socialLinks')}</MicroLabel>
          {(['instagram', 'tiktok', 'facebook', 'x', 'website'] as const).map((key) => (
            <TextInput
              key={key}
              value={socialLinks[key] || ''}
              onChange={(e) => setSocialLinks({ ...socialLinks, [key]: e.target.value || undefined })}
              placeholder={key === 'website' ? 'lesilo.fr' : `${key}.com/lesilo`}
              aria-label={key}
              style={inputStyle}
            />
          ))}
          <ThemedColor
            label={t('studio.inspector.socialColor')}
            value={b.color}
            themeDefault={theme.muted}
            onChange={(v) => patch({ color: v })}
          />
          <Help>{t('studio.inspector.socialHelp')}</Help>
        </PanelCard>
      );
    }
    case 'columns': {
      const b = block as ColumnsBlock;
      const setCol = (side: 'left' | 'right', key: 'title' | 'body', value: string) =>
        patch({ [side]: { ...b[side], [key]: value } } as Partial<EmailBlock>);
      return (
        <PanelCard>
          {(['left', 'right'] as const).map((side) => (
            <div key={side} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <MicroLabel>{t(side === 'left' ? 'studio.inspector.colLeft' : 'studio.inspector.colRight')}</MicroLabel>
              <TextInput value={b[side].title} onChange={(e) => setCol(side, 'title', e.target.value)} placeholder={t('studio.inspector.colTitle')} />
              <TextInput value={b[side].body} onChange={(e) => setCol(side, 'body', e.target.value)} placeholder={t('studio.inspector.colBody')} />
            </div>
          ))}
          <Help>{t('studio.inspector.colsHelp')}</Help>
        </PanelCard>
      );
    }
    case 'divider':
      return (
        <PanelCard>
          <ThemedColor
            label={t('studio.inspector.dividerColor')}
            value={block.color}
            themeDefault={theme.divider}
            onChange={(v) => patch({ color: v })}
          />
          <span style={{ color: 'rgba(255,255,255,0.58)', fontSize: 12, lineHeight: 1.55, fontFamily: FONT_UI }}>
            {t('studio.inspector.dividerHelp')}
          </span>
        </PanelCard>
      );
    default:
      return null;
  }
}
