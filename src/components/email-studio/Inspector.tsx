import { Plus, Trash2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import RichTextField from '@/components/campaigns/RichTextField';
import ImageUploader from '@/components/campaigns/ImageUploader';
import type {
  CtaBlock, EmailBlock, EventBlock, HeaderBlock, HtmlBlock, ImageBlock,
  SpacerBlock, TableBlock, TextBlock, TicketRow, TicketsBlock, ColumnsBlock, CountdownBlock,
} from '@/lib/email';
import { EMAIL_VARIABLES } from '@/lib/email';
import { useStudio } from './store';
import type { StudioEvent } from './hooks';
import { blockMeta } from './meta';
import {
  BORDER, Field, FONT_UI, GhostBtn, Help, IconBtn, MicroLabel, SegBtns, SliderRow,
  SUBTLE, T1, T3, TextArea, TextInput, Toggle,
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

  const block = blocks.find((b) => b.id === selectedId);
  if (!block) {
    return (
      <div style={{ padding: '22px 16px' }}>
        <Help>{t('studio.inspector.empty')}</Help>
      </div>
    );
  }

  const meta = blockMeta(block.type);
  const patch = (p: Partial<EmailBlock>) => updateBlock(block.id, p);

  return (
    <div className="yn-in" style={{ padding: '14px 16px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <MicroLabel style={{ color: meta.group === 'yuno' ? '#E8192C' : undefined }}>
        {t(meta.labelKey)}{meta.group === 'yuno' ? ` · ${t('studio.inspector.liveTag')}` : ''}
      </MicroLabel>
      <BlockFields block={block} patch={patch} events={events} bucketFolder={bucketFolder} />
    </div>
  );
}

function EventPicker({ value, events, onChange }: {
  value?: string; events: StudioEvent[]; onChange: (id: string | undefined) => void;
}) {
  const { t } = useLanguage();
  return (
    <Field label={t('studio.inspector.event')}>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        aria-label={t('studio.inspector.event')}
        style={{
          width: '100%', background: SUBTLE, border: `1px solid ${BORDER}`, borderRadius: 7,
          color: T1, fontSize: 12.5, fontFamily: FONT_UI, padding: '7px 8px', outline: 'none',
        }}
      >
        <option value="">{t('studio.inspector.eventNone')}</option>
        {events.map((e) => (
          <option key={e.id} value={e.id}>
            {e.title} — {new Date(e.start_at).toLocaleDateString()}
          </option>
        ))}
      </select>
    </Field>
  );
}

function BlockFields({ block, patch, events, bucketFolder }: {
  block: EmailBlock; patch: (p: Partial<EmailBlock>) => void;
  events: StudioEvent[]; bucketFolder: string;
}) {
  const { t } = useLanguage();
  const setSocialLinks = useStudio((s) => s.setSocialLinks);
  const socialLinks = useStudio((s) => s.campaign.socialLinks);

  switch (block.type) {
    case 'header': {
      const b = block as HeaderBlock;
      return (
        <>
          <Field label={t('studio.inspector.venueName')}>
            <TextInput value={b.venueName} onChange={(e) => patch({ venueName: e.target.value })} />
          </Field>
          <Toggle checked={b.showName} onChange={(v) => patch({ showName: v })} label={t('studio.inspector.showName')} />
          <ImageUploader
            value={b.logoUrl || null}
            onChange={(url) => patch({ logoUrl: url || undefined })}
            bucketFolder={bucketFolder}
            label={t('studio.inspector.logo')}
            preview="logo"
          />
          <Field label={t('studio.inspector.logoSize')}>
            <SegBtns
              value={b.logoSize}
              onChange={(v) => patch({ logoSize: v })}
              options={[{ value: 'sm', label: 'S' }, { value: 'md', label: 'M' }, { value: 'lg', label: 'L' }]}
            />
          </Field>
          <Field label={t('studio.inspector.logoShape')}>
            <SegBtns
              value={b.logoShape}
              onChange={(v) => patch({ logoShape: v })}
              options={[
                { value: 'rounded', label: t('studio.inspector.shapeRounded') },
                { value: 'circle', label: t('studio.inspector.shapeCircle') },
                { value: 'square', label: t('studio.inspector.shapeSquare') },
              ]}
            />
          </Field>
        </>
      );
    }
    case 'image': {
      const b = block as ImageBlock;
      return (
        <>
          <ImageUploader
            value={b.url || null}
            onChange={(url) => patch({ url: url || undefined })}
            bucketFolder={bucketFolder}
            label={t('studio.inspector.image')}
            preview="wide"
          />
          <Field label={t('studio.inspector.alt')}>
            <TextInput value={b.label} onChange={(e) => patch({ label: e.target.value })} placeholder={t('studio.inspector.altPh')} />
          </Field>
          <Help>{t('studio.inspector.altHelp')}</Help>
          {!b.url && (
            <SliderRow label={t('studio.inspector.height')} value={b.h} min={80} max={420} step={10}
              onChange={(v) => patch({ h: v })} format={(v) => `${v}px`} />
          )}
          <Field label={t('studio.inspector.linkUrl')}>
            <TextInput value={b.linkUrl || ''} onChange={(e) => patch({ linkUrl: e.target.value || undefined })} placeholder="https://…" />
          </Field>
        </>
      );
    }
    case 'text': {
      const b = block as TextBlock;
      return (
        <>
          <Field label={t('studio.inspector.text')}>
            <RichTextField
              value={b.body}
              onChange={(html) => patch({ body: html })}
              variables={EMAIL_VARIABLES.map((v) => ({ key: v.key, label: `{{${v.key}}}` }))}
            />
          </Field>
          <SliderRow label={t('studio.inspector.fontSize')} value={b.size} min={12} max={24}
            onChange={(v) => patch({ size: v })} format={(v) => `${v}px`} />
          <Field label={t('studio.inspector.align')}>
            <SegBtns
              value={b.align}
              onChange={(v) => patch({ align: v })}
              options={[
                { value: 'left', label: t('studio.inspector.alignLeft') },
                { value: 'center', label: t('studio.inspector.alignCenter') },
                { value: 'right', label: t('studio.inspector.alignRight') },
              ]}
            />
          </Field>
        </>
      );
    }
    case 'cta': {
      const b = block as CtaBlock;
      return (
        <>
          <Field label={t('studio.inspector.ctaLabel')}>
            <TextInput value={b.label} onChange={(e) => patch({ label: e.target.value })} />
          </Field>
          <Field label={t('studio.inspector.ctaUrl')}>
            <TextInput value={b.url} onChange={(e) => patch({ url: e.target.value })} placeholder="https://…" />
          </Field>
          <Field label={t('studio.inspector.align')}>
            <SegBtns
              value={b.align}
              onChange={(v) => patch({ align: v })}
              options={[
                { value: 'left', label: t('studio.inspector.alignLeft') },
                { value: 'center', label: t('studio.inspector.alignCenter') },
                { value: 'right', label: t('studio.inspector.alignRight') },
              ]}
            />
          </Field>
          <SliderRow label={t('studio.inspector.radius')} value={b.radius} min={0} max={24}
            onChange={(v) => patch({ radius: v })} format={(v) => `${v}px`} />
          <Toggle checked={b.full} onChange={(v) => patch({ full: v })} label={t('studio.inspector.fullWidth')} />
        </>
      );
    }
    case 'columns': {
      const b = block as ColumnsBlock;
      const setCol = (side: 'left' | 'right', key: 'title' | 'body', value: string) =>
        patch({ [side]: { ...b[side], [key]: value } } as Partial<EmailBlock>);
      return (
        <>
          {(['left', 'right'] as const).map((side) => (
            <div key={side} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <MicroLabel>{t(side === 'left' ? 'studio.inspector.colLeft' : 'studio.inspector.colRight')}</MicroLabel>
              <TextInput value={b[side].title} onChange={(e) => setCol(side, 'title', e.target.value)} placeholder={t('studio.inspector.colTitle')} />
              <TextArea value={b[side].body} onChange={(e) => setCol(side, 'body', e.target.value)} placeholder={t('studio.inspector.colBody')} />
            </div>
          ))}
        </>
      );
    }
    case 'event': {
      const b = block as EventBlock;
      return (
        <>
          <EventPicker value={b.eventId} events={events} onChange={(id) => patch({ eventId: id })} />
          <Help>{t('studio.inspector.eventHelp')}</Help>
          <Toggle checked={b.cover} onChange={(v) => patch({ cover: v })} label={t('studio.inspector.showCover')} />
          <Toggle checked={b.venue} onChange={(v) => patch({ venue: v })} label={t('studio.inspector.showVenue')} />
          <Toggle checked={b.price} onChange={(v) => patch({ price: v })} label={t('studio.inspector.showPrice')} />
          <Field label={t('studio.inspector.ctaLabel')}>
            <TextInput value={b.ctaLabel} onChange={(e) => patch({ ctaLabel: e.target.value })} />
          </Field>
          {!b.eventId && (
            <>
              <Field label={t('studio.inspector.eventTitle')}>
                <TextInput value={b.title} onChange={(e) => patch({ title: e.target.value })} />
              </Field>
              <Field label={t('studio.inspector.eventDate')}>
                <TextInput value={b.dateLabel} onChange={(e) => patch({ dateLabel: e.target.value })} />
              </Field>
              <Field label={t('studio.inspector.eventVenue')}>
                <TextInput value={b.venueLabel} onChange={(e) => patch({ venueLabel: e.target.value })} />
              </Field>
            </>
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
          <EventPicker value={b.eventId} events={events} onChange={(id) => patch({ eventId: id })} />
          <Toggle
            checked={b.live}
            onChange={(v) => patch({ live: v })}
            label={t('studio.inspector.ticketsLive')}
            help={t('studio.inspector.ticketsLiveHelp')}
          />
          {(!b.live || !b.eventId) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <MicroLabel>{t('studio.inspector.ticketsRows')}</MicroLabel>
              {b.rows.map((r, i) => (
                <div key={i} style={{
                  border: `1px solid ${BORDER}`, borderRadius: 8, padding: 8,
                  display: 'flex', flexDirection: 'column', gap: 6,
                }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <TextInput value={r.n} onChange={(e) => setRow(i, { n: e.target.value })} placeholder={t('studio.inspector.rowName')} />
                    <TextInput value={r.p} onChange={(e) => setRow(i, { p: e.target.value })} placeholder="18 €" style={{ width: 68, flex: 'none' }} />
                    <IconBtn ariaLabel={t('studio.inspector.rowRemove')} danger size={30}
                      onClick={() => patch({ rows: b.rows.filter((_, idx) => idx !== i) })}>
                      <Trash2 size={13} strokeWidth={1.75} />
                    </IconBtn>
                  </div>
                  <TextInput value={r.s} onChange={(e) => setRow(i, { s: e.target.value })} placeholder={t('studio.inspector.rowSub')} />
                  <Toggle checked={r.out} onChange={(v) => setRow(i, { out: v })} label={t('studio.inspector.rowOut')} />
                </div>
              ))}
              <GhostBtn onClick={() => patch({ rows: [...b.rows, { n: '', s: '', p: '', out: false }] })}>
                <Plus size={13} strokeWidth={1.75} /> {t('studio.inspector.rowAdd')}
              </GhostBtn>
            </div>
          )}
        </>
      );
    }
    case 'table': {
      const b = block as TableBlock;
      return (
        <>
          <EventPicker value={b.eventId} events={events} onChange={(id) => patch({ eventId: id })} />
          <Field label={t('studio.inspector.tableTitle')}>
            <TextInput value={b.title} onChange={(e) => patch({ title: e.target.value })} />
          </Field>
          <Field label={t('studio.inspector.tableSub')}>
            <TextArea value={b.sub} onChange={(e) => patch({ sub: e.target.value })} />
          </Field>
          <Field label={t('studio.inspector.ctaLabel')}>
            <TextInput value={b.ctaLabel} onChange={(e) => patch({ ctaLabel: e.target.value })} />
          </Field>
          <Field label={t('studio.inspector.tableCond')}>
            <TextInput value={b.cond} onChange={(e) => patch({ cond: e.target.value })} placeholder="VIP · Table" />
          </Field>
        </>
      );
    }
    case 'countdown': {
      const b = block as CountdownBlock;
      return (
        <>
          <EventPicker value={b.eventId} events={events} onChange={(id) => patch({ eventId: id })} />
          <Field label={t('studio.inspector.countdownLabel')}>
            <TextInput value={b.label} onChange={(e) => patch({ label: e.target.value })} />
          </Field>
          <Help>{t('studio.inspector.countdownHelp')}</Help>
        </>
      );
    }
    case 'social': {
      return (
        <>
          <Help>{t('studio.inspector.socialHelp')}</Help>
          {(['instagram', 'tiktok', 'facebook', 'x', 'website'] as const).map((key) => (
            <Field key={key} label={key === 'website' ? t('studio.inspector.website') : key}>
              <TextInput
                value={socialLinks[key] || ''}
                onChange={(e) => setSocialLinks({ ...socialLinks, [key]: e.target.value || undefined })}
                placeholder="https://…"
              />
            </Field>
          ))}
        </>
      );
    }
    case 'spacer': {
      const b = block as SpacerBlock;
      return (
        <Field label={t('studio.inspector.spacerSize')}>
          <SegBtns
            value={b.size}
            onChange={(v) => patch({ size: v })}
            options={[
              { value: 'sm', label: 'S' }, { value: 'md', label: 'M' },
              { value: 'lg', label: 'L' }, { value: 'xl', label: 'XL' },
            ]}
          />
        </Field>
      );
    }
    case 'html': {
      const b = block as HtmlBlock;
      return (
        <>
          <Field label={t('studio.inspector.htmlCode')}>
            <TextArea
              value={b.code}
              onChange={(e) => patch({ code: e.target.value })}
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11.5, minHeight: 140 }}
              spellCheck={false}
            />
          </Field>
          <Help>{t('studio.inspector.htmlHelp')}</Help>
        </>
      );
    }
    case 'divider':
      return <Help>{t('studio.inspector.dividerHelp')}</Help>;
    default:
      return null;
  }
}
