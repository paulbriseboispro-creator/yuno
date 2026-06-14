import { useState, type ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useLanguage } from '@/contexts/LanguageContext';
import { newBlock, type EmailBlock } from '@/lib/emailCampaign';
import { BLOCK_TYPES } from './templates';

interface Props {
  onAdd: (block: EmailBlock) => void;
  /** Extra context passed to newBlock (venue name / logo for header blocks). */
  blockContext?: { venue_name?: string; logo_url?: string | null };
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
}

export default function BlockTypePicker({ onAdd, blockContext, children, align = 'center' }: Props) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className="w-64 p-2">
        <p className="text-xs font-medium text-muted-foreground px-1 pb-2">{t('em.ed.addBlock')}</p>
        <div className="grid grid-cols-3 gap-1.5">
          {BLOCK_TYPES.map(({ type, labelKey, Icon }) => (
            <button
              key={type}
              onClick={() => { onAdd(newBlock(type, blockContext)); setOpen(false); }}
              className="flex flex-col items-center justify-center gap-1 rounded-lg border border-border py-3 hover:border-primary/60 hover:bg-primary/5 transition-colors"
            >
              <Icon className="w-4 h-4 text-primary" />
              <span className="text-[10px] text-center leading-tight">{t(labelKey)}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
