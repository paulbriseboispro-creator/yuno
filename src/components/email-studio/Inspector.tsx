import { Braces, CalendarClock, ChevronDown, Copy, MousePointer, Plus, RefreshCw, Trash2, Zap } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import ImageUploader from '@/components/campaigns/ImageUploader';
import type {
  CtaBlock, EmailBlock, EventBlock, HeaderBlock, HtmlBlock, ImageBlock,
  SpacerBlock, TableBlock, TextBlock, TicketRow, TicketsBlock, ColumnsBlock, CountdownBlock,
} from '@/lib/email';
import { useStudio } from './store';
import type { StudioEvent } from './hooks';
import { blockMeta } from './meta';
import {
  BORDER, FONT_UI, Help, IconBtn, MicroLabel, MONO, OptionPills, PanelCard, POS,
  RED, SUBTLE, T1, T3, TextArea, TextInput, ToggleRow, inputStyle,
} from './ui';

interface Props {
  events: StudioEvent[];
  bucketFolder: string;
}

/** Inspecteur contextuel — champs selon le type du bloc sélectionné. */
export default function Inspector({ events, bucketFolder }: Props) {
  const { t } = useLanguage();
  const blocks = useStudio((s) => s.campaign.blocks);
  const selectedId = useStudio((s) => s.selectedId);
  const updateBlock = useStudio((s) => s.updateBlock);
  const duplicate = useStudio((s) => s.duplicate);
  const removeBlock = useStudio((s) => s.removeBlock);

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

      <BlockFields block={block} patch={patch} events={events} bucketFolder={bucketFolder} />

      {/* Espacement & fond — commun à tous les blocs (prototype) */}
      <PanelCard>
        <MicroLabel>{t('studio.inspector.padX')}</MicroLabel>
        <OptionPills
          value={block.px ?? 24}
          onChange={(v) => patch({ px: v === 24 ? undefined : v })}
          options={[0, 16, 24, 40].map((n) => ({ value: n, label: String(n) }))}
        />
        <MicroLabel>{t('studio.inspector.padY')}</MicroLabel>
        <OptionPills
          value={block.py ?? 18}
          onChange={(v) => patch({ py: v === 18 ? undefined : v })}
          options={[4, 12, 18, 32].map((n) => ({ value: n, label: String(n) }))}
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
      </PanelCard>
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

function BlockFields({ block, patch, events, bucketFolder }: {
  block: EmailBlock; patch: (p: Partial<EmailBlock>) => void;
  events: StudioEvent[]; bucketFolder: string;
}) {
  const { t } = useLanguage();
  const setSocialLinks = useStudio((s) => s.setSocialLinks);
  const socialLinks = useStudio((s) => s.campaign.socialLinks);

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
            <TextArea value={b.body} onChange={(e) => patch({ body: e.target.value })} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: T3, fontSize: 11, fontFamily: FONT_UI }}>
              <Braces size={12} strokeWidth={1.75} style={{ color: RED }} />
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
            <TextInput value={b.venueName} onChange={(e) => patch({ venueName: e.target.value })} />
            <ToggleRow checked={b.showName} onChange={(v) => patch({ showName: v })} label={t('studio.inspector.showName')} />
          </PanelCard>
          <PanelCard>
            <MicroLabel>{t('studio.inspector.logo')}</MicroLabel>
            <ImageUploader
              value={b.logoUrl || null}
              onChange={(url) => patch({ logoUrl: url || undefined })}
              bucketFolder={bucketFolder}
              preview="logo"
            />
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
          <span style={{ color: 'rgba(255,255,255,0.58)', fontSize: 12, lineHeight: 1.55, fontFamily: FONT_UI }}>
            {t('studio.inspector.dividerHelp')}
          </span>
        </PanelCard>
      );
    default:
      return null;
  }
}
