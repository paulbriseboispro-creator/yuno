import { useState } from 'react';
import { Image as ImageIcon, Upload, Loader2 } from 'lucide-react';
import { InlineTextEditor } from './InlineTextEditor';
import { EmailBlockOverlay } from './EmailBlockOverlay';

// Yuno brand colors
const YUNO_COLORS = {
  background: '#0a0a0a',
  primary: '#dc2626',
  text: '#ffffff',
  textSecondary: '#9ca3af',
  border: 'rgba(255,255,255,0.1)',
  success: '#22c55e',
};

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

interface EmailCanvasBlockProps {
  block: EmailBlock;
  index: number;
  totalBlocks: number;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<EmailBlock['content']>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onImageClick: () => void;
  uploadingImage: boolean;
}

export function EmailCanvasBlock({
  block,
  index,
  totalBlocks,
  isSelected,
  onSelect,
  onUpdate,
  onMoveUp,
  onMoveDown,
  onDelete,
  onImageClick,
  uploadingImage,
}: EmailCanvasBlockProps) {
  const [isHovered, setIsHovered] = useState(false);

  const renderBlockContent = () => {
    switch (block.type) {
      case 'hero':
        return (
          <div 
            className="p-6 text-center rounded-lg"
            style={{ background: `linear-gradient(135deg, ${YUNO_COLORS.primary}20, ${YUNO_COLORS.background})` }}
          >
            <InlineTextEditor
              value={block.content.title || ''}
              onChange={(title) => onUpdate({ title })}
              placeholder="Hero Title"
              isSelected={isSelected}
              showToolbar={false}
              className="text-xl font-bold mb-2"
              style={{ color: YUNO_COLORS.text }}
            />
            <InlineTextEditor
              value={block.content.subtitle || ''}
              onChange={(subtitle) => onUpdate({ subtitle })}
              placeholder="Subtitle text here..."
              isSelected={isSelected}
              showToolbar={false}
              style={{ color: YUNO_COLORS.textSecondary }}
            />
          </div>
        );

      case 'text':
        return (
          <div className="px-4 py-2">
            <InlineTextEditor
              value={block.content.text || ''}
              onChange={(text) => onUpdate({ text })}
              placeholder="Write your message here..."
              isSelected={isSelected}
              showToolbar={true}
              showVariables={true}
              multiline={true}
              className="leading-relaxed"
              style={{ color: YUNO_COLORS.text }}
            />
          </div>
        );

      case 'cta':
        return (
          <div className="text-center py-4">
            <div className="inline-block">
              <div
                className="px-6 py-3 rounded-lg font-semibold cursor-text"
                style={{ backgroundColor: YUNO_COLORS.primary, color: YUNO_COLORS.text }}
                onClick={(e) => e.stopPropagation()}
              >
                <InlineTextEditor
                  value={block.content.buttonText || ''}
                  onChange={(buttonText) => onUpdate({ buttonText })}
                  placeholder="Button Text"
                  isSelected={isSelected}
                  showToolbar={false}
                  showVariables={false}
                  className="inline"
                  style={{ color: YUNO_COLORS.text }}
                />
              </div>
            </div>
            {isSelected && (
              <div className="mt-2">
                <input
                  type="url"
                  value={block.content.buttonUrl || ''}
                  onChange={(e) => onUpdate({ buttonUrl: e.target.value })}
                  placeholder="https://your-link.com"
                  className="text-xs bg-transparent border-b border-dashed border-muted-foreground/30 text-center w-48 outline-none focus:border-primary"
                  style={{ color: YUNO_COLORS.textSecondary }}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            )}
          </div>
        );

      case 'image':
        return block.content.imageUrl ? (
          <img 
            src={block.content.imageUrl} 
            alt={block.content.altText || ''} 
            className="w-full rounded-lg"
          />
        ) : (
          <div 
            className="h-32 flex flex-col items-center justify-center rounded-lg border-2 border-dashed cursor-pointer hover:border-primary/50 transition-colors"
            style={{ borderColor: YUNO_COLORS.border }}
            onClick={(e) => { e.stopPropagation(); onImageClick(); }}
          >
            {uploadingImage ? (
              <Loader2 className="h-8 w-8 animate-spin" style={{ color: YUNO_COLORS.textSecondary }} />
            ) : (
              <>
                <Upload className="h-8 w-8 mb-2" style={{ color: YUNO_COLORS.textSecondary }} />
                <span className="text-xs" style={{ color: YUNO_COLORS.textSecondary }}>
                  Click to upload image
                </span>
              </>
            )}
          </div>
        );

      case 'stats':
        return (
          <div className="flex gap-3">
            <div 
              className="flex-1 p-4 rounded-lg text-center"
              style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
            >
              <p className="text-2xl font-bold" style={{ color: YUNO_COLORS.primary }}>{'{{total_points}}'}</p>
              <p className="text-xs" style={{ color: YUNO_COLORS.textSecondary }}>points</p>
            </div>
            <div 
              className="flex-1 p-4 rounded-lg text-center"
              style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
            >
              <p className="text-2xl font-bold" style={{ color: YUNO_COLORS.success }}>{'{{tier}}'}</p>
              <p className="text-xs" style={{ color: YUNO_COLORS.textSecondary }}>tier</p>
            </div>
          </div>
        );

      case 'divider':
        return <hr style={{ borderColor: YUNO_COLORS.border }} className="my-4" />;

      default:
        return null;
    }
  };

  return (
    <div
      className="relative group"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onSelect}
    >
      <EmailBlockOverlay
        isSelected={isSelected}
        isHovered={isHovered}
        canMoveUp={index > 0}
        canMoveDown={index < totalBlocks - 1}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        onDelete={onDelete}
      />
      
      <div className="p-2">
        {renderBlockContent()}
      </div>
    </div>
  );
}
