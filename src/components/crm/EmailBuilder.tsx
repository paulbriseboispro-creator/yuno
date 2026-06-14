import { useState, useCallback } from 'react';
import { Reorder } from 'framer-motion';
import {
  Type,
  Image,
  MousePointerClick,
  BarChart3,
  Minus,
  Trash2,
  GripVertical,
  Smartphone,
  Monitor,
  Sparkles,
  Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useLanguage } from '@/contexts/LanguageContext';
import { EmailPreview } from './EmailPreview';
import { BlockPalette } from './BlockPalette';

export interface EmailBlock {
  id: string;
  type: 'hero' | 'text' | 'cta' | 'stats' | 'image' | 'divider';
  content: {
    title?: string;
    subtitle?: string;
    text?: string;
    buttonText?: string;
    buttonUrl?: string;
    imageUrl?: string;
    altText?: string;
  };
}

interface EmailBuilderProps {
  blocks: EmailBlock[];
  onChange: (blocks: EmailBlock[]) => void;
  venueName: string;
  venueLogo?: string | null;
}

const BLOCK_ICONS = {
  hero: Sparkles,
  text: Type,
  cta: MousePointerClick,
  stats: BarChart3,
  image: Image,
  divider: Minus,
};

export function EmailBuilder({ blocks, onChange, venueName, venueLogo }: EmailBuilderProps) {
  const { t } = useLanguage();
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop');

  const selectedBlock = blocks.find(b => b.id === selectedBlockId);

  const addBlock = useCallback((type: EmailBlock['type']) => {
    const newBlock: EmailBlock = {
      id: `block-${Date.now()}`,
      type,
      content: getDefaultContent(type),
    };
    onChange([...blocks, newBlock]);
    setSelectedBlockId(newBlock.id);
  }, [blocks, onChange]);

  const updateBlock = useCallback((id: string, content: Partial<EmailBlock['content']>) => {
    onChange(blocks.map(b => 
      b.id === id ? { ...b, content: { ...b.content, ...content } } : b
    ));
  }, [blocks, onChange]);

  const deleteBlock = useCallback((id: string) => {
    onChange(blocks.filter(b => b.id !== id));
    if (selectedBlockId === id) {
      setSelectedBlockId(null);
    }
  }, [blocks, onChange, selectedBlockId]);

  const handleReorder = useCallback((newOrder: EmailBlock[]) => {
    onChange(newOrder);
  }, [onChange]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-[550px]">
      {/* Left Panel - Blocks & Editor */}
      <div className="flex flex-col gap-3 overflow-hidden">
        {/* Block Palette */}
        <BlockPalette onAddBlock={addBlock} />

        {/* Block List & Editor Combined */}
        <Card className="flex-1 overflow-hidden flex flex-col">
          <div className="p-3 border-b border-border flex items-center justify-between">
            <h4 className="font-medium text-sm">{t('owner.crm.blocks') || 'Blocks'}</h4>
            {blocks.length > 0 && (
              <Badge variant="secondary" className="text-xs">{blocks.length}</Badge>
            )}
          </div>
          
          <div className="flex-1 overflow-hidden flex flex-col">
            {/* Block List */}
            <ScrollArea className="flex-shrink-0 max-h-[180px]">
              {blocks.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground text-sm">
                  <div className="mb-2 text-2xl">📧</div>
                  {t('owner.crm.noBlocks') || 'Click a block type above to start building your email'}
                </div>
              ) : (
                <Reorder.Group 
                  axis="y" 
                  values={blocks} 
                  onReorder={handleReorder}
                  className="p-2 space-y-1"
                >
                  {blocks.map((block) => {
                    const Icon = BLOCK_ICONS[block.type];
                    const isSelected = selectedBlockId === block.id;
                    return (
                      <Reorder.Item
                        key={block.id}
                        value={block}
                        className={`flex items-center gap-2 p-2.5 rounded-lg cursor-pointer transition-all ${
                          isSelected 
                            ? 'bg-primary/10 border border-primary/40 shadow-sm' 
                            : 'bg-muted/30 hover:bg-muted/60 border border-transparent'
                        }`}
                        onClick={() => setSelectedBlockId(block.id)}
                      >
                        <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab active:cursor-grabbing" />
                        <Icon className={`h-4 w-4 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                        <span className="flex-1 text-sm truncate capitalize font-medium">
                          {getBlockLabel(block, t)}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-50 hover:opacity-100"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteBlock(block.id);
                          }}
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </Reorder.Item>
                    );
                  })}
                </Reorder.Group>
              )}
            </ScrollArea>

            {/* Block Editor - Shows when a block is selected */}
            {selectedBlock && (
              <div className="border-t border-border p-4 bg-muted/20 flex-1 overflow-auto">
                <div className="flex items-center gap-2 mb-4">
                  <Badge variant="outline" className="capitalize">
                    {getBlockLabel(selectedBlock, t)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {t('owner.crm.editBlock') || 'Edit block content'}
                  </span>
                </div>
                <BlockEditor block={selectedBlock} onUpdate={updateBlock} />
              </div>
            )}

            {/* Empty state for editor */}
            {!selectedBlock && blocks.length > 0 && (
              <div className="border-t border-border p-6 text-center text-muted-foreground text-sm flex-1 flex flex-col items-center justify-center">
                <div className="text-2xl mb-2">👆</div>
                {t('owner.crm.selectBlockToEdit') || 'Select a block above to edit its content'}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Right Panel - Preview */}
      <div className="flex flex-col overflow-hidden">
        <div className="flex items-center justify-between mb-2 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{t('owner.crm.preview') || 'Preview'}</span>
          </div>
          <div className="flex gap-1 bg-muted/50 rounded-lg p-0.5">
            <Button
              variant={previewMode === 'desktop' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 px-2"
              onClick={() => setPreviewMode('desktop')}
            >
              <Monitor className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant={previewMode === 'mobile' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 px-2"
              onClick={() => setPreviewMode('mobile')}
            >
              <Smartphone className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        
        <EmailPreview
          blocks={blocks}
          venueName={venueName}
          venueLogo={venueLogo}
          previewMode={previewMode}
        />
      </div>
    </div>
  );
}

function getBlockLabel(block: EmailBlock, t: any): string {
  const labels: Record<string, string> = {
    hero: t('owner.crm.heroBlock') || 'Hero',
    text: t('owner.crm.textBlock') || 'Text',
    cta: t('owner.crm.ctaBlock') || 'Button',
    stats: t('owner.crm.statsBlock') || 'Stats',
    image: t('owner.crm.imageBlock') || 'Image',
    divider: t('owner.crm.dividerBlock') || 'Divider',
  };
  return labels[block.type] || block.type;
}

function getDefaultContent(type: EmailBlock['type']): EmailBlock['content'] {
  switch (type) {
    case 'hero':
      return { title: 'Welcome!', subtitle: 'We have something special for you' };
    case 'text':
      return { text: 'Thank you for being a valued customer. We appreciate your loyalty!' };
    case 'cta':
      return { buttonText: 'Claim your reward', buttonUrl: '' };
    case 'stats':
      return {};
    case 'image':
      return { imageUrl: '', altText: 'Image' };
    case 'divider':
      return {};
    default:
      return {};
  }
}

interface BlockEditorProps {
  block: EmailBlock;
  onUpdate: (id: string, content: Partial<EmailBlock['content']>) => void;
}

function BlockEditor({ block, onUpdate }: BlockEditorProps) {
  const { t } = useLanguage();

  switch (block.type) {
    case 'hero':
      return (
        <div className="space-y-4">
          <div>
            <Label className="text-xs mb-1.5 block">{t('owner.crm.title') || 'Title'}</Label>
            <Input
              value={block.content.title || ''}
              onChange={(e) => onUpdate(block.id, { title: e.target.value })}
              placeholder={t('owner.crm.heroTitlePlaceholder') || 'Your headline...'}
              className="font-medium"
            />
          </div>
          <div>
            <Label className="text-xs mb-1.5 block">{t('owner.crm.subtitle') || 'Subtitle'}</Label>
            <Input
              value={block.content.subtitle || ''}
              onChange={(e) => onUpdate(block.id, { subtitle: e.target.value })}
              placeholder={t('owner.crm.heroSubtitlePlaceholder') || 'Supporting text...'}
            />
          </div>
        </div>
      );

    case 'text':
      return (
        <div className="space-y-2">
          <Label className="text-xs mb-1.5 block">{t('owner.crm.textContent') || 'Text Content'}</Label>
          <Textarea
            value={block.content.text || ''}
            onChange={(e) => onUpdate(block.id, { text: e.target.value })}
            placeholder={t('owner.crm.textPlaceholder') || 'Write your message here...'}
            rows={5}
            className="resize-none"
          />
          <div className="flex flex-wrap gap-1.5 mt-2">
            <Badge variant="secondary" className="text-[10px] cursor-pointer hover:bg-primary/20"
              onClick={() => onUpdate(block.id, { text: (block.content.text || '') + '{{first_name}}' })}>
              {'{{first_name}}'}
            </Badge>
            <Badge variant="secondary" className="text-[10px] cursor-pointer hover:bg-primary/20"
              onClick={() => onUpdate(block.id, { text: (block.content.text || '') + '{{venue_name}}' })}>
              {'{{venue_name}}'}
            </Badge>
            <Badge variant="secondary" className="text-[10px] cursor-pointer hover:bg-primary/20"
              onClick={() => onUpdate(block.id, { text: (block.content.text || '') + '{{total_points}}' })}>
              {'{{total_points}}'}
            </Badge>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            {t('owner.crm.clickToInsert') || 'Click tags to insert variables'}
          </p>
        </div>
      );

    case 'cta':
      return (
        <div className="space-y-4">
          <div>
            <Label className="text-xs mb-1.5 block">{t('owner.crm.buttonText') || 'Button Text'}</Label>
            <Input
              value={block.content.buttonText || ''}
              onChange={(e) => onUpdate(block.id, { buttonText: e.target.value })}
              placeholder={t('owner.crm.buttonTextPlaceholder') || 'Click here'}
            />
          </div>
          <div>
            <Label className="text-xs mb-1.5 block">{t('owner.crm.buttonUrl') || 'Button Link (URL)'}</Label>
            <Input
              type="url"
              value={block.content.buttonUrl || ''}
              onChange={(e) => onUpdate(block.id, { buttonUrl: e.target.value })}
              placeholder="https://..."
            />
          </div>
        </div>
      );

    case 'image':
      return (
        <div className="space-y-4">
          <div>
            <Label className="text-xs mb-1.5 block">{t('owner.crm.imageUrl') || 'Image URL'}</Label>
            <Input
              type="url"
              value={block.content.imageUrl || ''}
              onChange={(e) => onUpdate(block.id, { imageUrl: e.target.value })}
              placeholder="https://example.com/image.jpg"
            />
          </div>
          <div>
            <Label className="text-xs mb-1.5 block">{t('owner.crm.altText') || 'Alt Text (accessibility)'}</Label>
            <Input
              value={block.content.altText || ''}
              onChange={(e) => onUpdate(block.id, { altText: e.target.value })}
              placeholder={t('owner.crm.altTextPlaceholder') || 'Describe the image...'}
            />
          </div>
          {block.content.imageUrl && (
            <div className="p-2 border border-border rounded-lg bg-muted/30">
              <img 
                src={block.content.imageUrl} 
                alt={block.content.altText || 'Preview'} 
                className="max-h-24 mx-auto rounded object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>
          )}
        </div>
      );

    case 'stats':
      return (
        <div className="p-3 rounded-lg bg-muted/30 border border-border">
          <p className="text-sm text-muted-foreground">
            ✨ {t('owner.crm.statsAutoFilled') || 'Customer points and tier will be filled automatically for each recipient'}
          </p>
        </div>
      );

    case 'divider':
      return (
        <div className="p-3 rounded-lg bg-muted/30 border border-border">
          <p className="text-sm text-muted-foreground">
            ➖ {t('owner.crm.dividerDesc') || 'A simple horizontal line separator'}
          </p>
        </div>
      );

    default:
      return null;
  }
}
