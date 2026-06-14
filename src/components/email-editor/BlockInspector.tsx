import { ChevronUp, ChevronDown, Copy, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLanguage } from '@/contexts/LanguageContext';
import { DEFAULT_THEME, type EmailBlock, type EmailTheme } from '@/lib/emailCampaign';
import { BLOCK_TYPES } from './templates';
import ColorField from '@/components/campaigns/ColorField';
import ImageUploader from '@/components/campaigns/ImageUploader';
import RichTextField from '@/components/campaigns/RichTextField';

interface Props {
  block: EmailBlock;
  theme: Required<EmailTheme>;
  events?: { id: string; title: string; start_at: string }[];
  bucketFolder: string;
  variables?: { key: string; label: string }[];
  isFirst: boolean;
  isLast: boolean;
  onUpdate: (patch: Record<string, unknown>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

export default function BlockInspector({
  block: b, theme, events = [], bucketFolder, variables,
  isFirst, isLast, onUpdate, onMoveUp, onMoveDown, onDuplicate, onRemove,
}: Props) {
  const { t } = useLanguage();
  const meta = BLOCK_TYPES.find(bt => bt.type === b.type);
  const Icon = meta?.Icon;

  return (
    <div className="space-y-4">
      {/* Header: block identity + actions */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {Icon && <Icon className="w-4 h-4 text-primary shrink-0" />}
          <span className="font-semibold text-sm truncate">{meta ? t(meta.labelKey) : b.type}</span>
        </div>
        <div className="flex gap-0.5">
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={isFirst} onClick={onMoveUp} title="Monter"><ChevronUp className="w-4 h-4" /></Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={isLast} onClick={onMoveDown} title="Descendre"><ChevronDown className="w-4 h-4" /></Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onDuplicate} title="Dupliquer"><Copy className="w-4 h-4" /></Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={onRemove} title="Supprimer"><Trash2 className="w-4 h-4" /></Button>
        </div>
      </div>

      {/* Per-type settings */}
      {b.type === 'header' && (
        <div className="space-y-3">
          <div>
            <Label className="text-xs">{t('em.insp.displayName')}</Label>
            <Input placeholder={t('em.insp.displayName')} value={(b as any).venue_name || ''} className="mt-1"
              onChange={e => onUpdate({ venue_name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">{t('em.insp.logoSize')}</Label>
              <Select value={(b as any).logo_size || 'md'} onValueChange={(v) => onUpdate({ logo_size: v })}>
                <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sm">{t('em.insp.sizeSm')}</SelectItem>
                  <SelectItem value="md">{t('em.insp.sizeMd')}</SelectItem>
                  <SelectItem value="lg">{t('em.insp.sizeLg')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t('em.insp.logoShape')}</Label>
              <Select value={(b as any).logo_shape || 'free'} onValueChange={(v) => onUpdate({ logo_shape: v })}>
                <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">{t('em.insp.shapeFree')}</SelectItem>
                  <SelectItem value="rounded">{t('em.insp.shapeRounded')}</SelectItem>
                  <SelectItem value="circle">{t('em.insp.shapeCircle')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span>{t('em.insp.showName')}</span>
            <Switch checked={(b as any).show_name !== false} onCheckedChange={(v) => onUpdate({ show_name: v })} />
          </div>
          <p className="text-xs text-muted-foreground">{t('em.insp.headerHelp')}</p>
        </div>
      )}

      {b.type === 'text' && (
        <RichTextField value={(b as any).html} variables={variables} onChange={(html) => onUpdate({ html })} />
      )}

      {b.type === 'image' && (
        <div className="space-y-3">
          <ImageUploader
            value={(b as any).url || null}
            onChange={(url) => onUpdate({ url: url || '' })}
            bucketFolder={`${bucketFolder}/images`}
          />
          <div>
            <Label className="text-xs">{t('em.insp.linkOptional')}</Label>
            <Input placeholder="https://…" value={(b as any).link_url || ''} className="mt-1"
              onChange={e => onUpdate({ link_url: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">{t('em.insp.align')}</Label>
            <Select value={(b as any).align || 'center'} onValueChange={(v) => onUpdate({ align: v })}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="left">{t('em.insp.alignLeft')}</SelectItem>
                <SelectItem value="center">{t('em.insp.alignCenter')}</SelectItem>
                <SelectItem value="right">{t('em.insp.alignRight')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {b.type === 'cta' && (
        <div className="space-y-3">
          <div>
            <Label className="text-xs">{t('em.insp.btnText')}</Label>
            <Input placeholder={t('em.insp.btnText')} value={(b as any).label} className="mt-1"
              onChange={e => onUpdate({ label: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">{t('em.insp.linkUrl')}</Label>
            <Input placeholder="https://…" value={(b as any).url} className="mt-1"
              onChange={e => onUpdate({ url: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">{t('em.insp.align')}</Label>
            <Select value={(b as any).align || 'center'} onValueChange={(v) => onUpdate({ align: v })}>
              <SelectTrigger className="mt-1"><SelectValue placeholder={t('em.insp.align')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="left">{t('em.insp.alignLeft')}</SelectItem>
                <SelectItem value="center">{t('em.insp.alignCenter')}</SelectItem>
                <SelectItem value="right">{t('em.insp.alignRight')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <ColorField label={t('em.insp.btnColor')} value={(b as any).bg_color || theme.accent || DEFAULT_THEME.accent}
              onChange={(v) => onUpdate({ bg_color: v })} />
            <ColorField label={t('em.insp.textColor')} value={(b as any).text_color || theme.button_text || DEFAULT_THEME.button_text}
              onChange={(v) => onUpdate({ text_color: v })} />
          </div>
        </div>
      )}

      {b.type === 'event' && (
        <div>
          <Label className="text-xs">{t('em.block.event')}</Label>
          <Select value={(b as any).event_id || ''} onValueChange={(v) => {
            const ev = events.find(e => e.id === v);
            onUpdate({
              event_id: v, title: ev?.title,
              date_label: ev ? new Date(ev.start_at).toLocaleString() : '',
              cta_url: `https://yunoapp.eu/event/${v}`,
            });
          }}>
            <SelectTrigger className="mt-1"><SelectValue placeholder={t('em.insp.chooseEvent')} /></SelectTrigger>
            <SelectContent>{events.map(e => <SelectItem key={e.id} value={e.id}>{e.title}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}

      {b.type === 'divider' && (
        <p className="text-xs text-muted-foreground italic">{t('em.insp.dividerHelp')}</p>
      )}

      {b.type === 'spacer' && (
        <div>
          <Label className="text-xs">{t('em.insp.spacerHeight')}</Label>
          <Select value={(b as any).size || 'md'} onValueChange={(v) => onUpdate({ size: v })}>
            <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="sm">{t('em.insp.spSm')}</SelectItem>
              <SelectItem value="md">{t('em.insp.spMd')}</SelectItem>
              <SelectItem value="lg">{t('em.insp.spLg')}</SelectItem>
              <SelectItem value="xl">{t('em.insp.spXl')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
