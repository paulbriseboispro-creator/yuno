import {
  Type,
  Image,
  MousePointerClick,
  BarChart3,
  Minus,
  Sparkles,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useLanguage } from '@/contexts/LanguageContext';
import type { EmailBlock } from './EmailBuilder';

interface BlockPaletteProps {
  onAddBlock: (type: EmailBlock['type']) => void;
}

const BLOCK_TYPES: { type: EmailBlock['type']; icon: typeof Type; labelKey: string }[] = [
  { type: 'hero', icon: Sparkles, labelKey: 'owner.crm.heroBlock' },
  { type: 'text', icon: Type, labelKey: 'owner.crm.textBlock' },
  { type: 'cta', icon: MousePointerClick, labelKey: 'owner.crm.ctaBlock' },
  { type: 'stats', icon: BarChart3, labelKey: 'owner.crm.statsBlock' },
  { type: 'image', icon: Image, labelKey: 'owner.crm.imageBlock' },
  { type: 'divider', icon: Minus, labelKey: 'owner.crm.dividerBlock' },
];

const FALLBACK_LABELS: Record<string, string> = {
  'owner.crm.heroBlock': 'Hero',
  'owner.crm.textBlock': 'Text',
  'owner.crm.ctaBlock': 'Button',
  'owner.crm.statsBlock': 'Stats',
  'owner.crm.imageBlock': 'Image',
  'owner.crm.dividerBlock': 'Divider',
};

export function BlockPalette({ onAddBlock }: BlockPaletteProps) {
  const { t } = useLanguage();

  return (
    <Card className="p-3">
      <div className="flex items-center gap-2 mb-3">
        <Plus className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">{t('owner.crm.addBlock') || 'Add Block'}</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {BLOCK_TYPES.map(({ type, icon: Icon, labelKey }) => (
          <Button
            key={type}
            variant="outline"
            size="sm"
            className="flex-col h-16 gap-1 text-xs"
            onClick={() => onAddBlock(type)}
          >
            <Icon className="h-4 w-4 text-primary" />
            <span>{t(labelKey as any) || FALLBACK_LABELS[labelKey]}</span>
          </Button>
        ))}
      </div>
    </Card>
  );
}
