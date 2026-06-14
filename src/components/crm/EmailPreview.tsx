import { EmailBlock } from './EmailBuilder';
import { ScrollArea } from '@/components/ui/scroll-area';

// Yuno brand colors - FIXED, clubs cannot change these
const YUNO_COLORS = {
  background: '#0a0a0a',
  primary: '#dc2626',
  text: '#ffffff',
  textSecondary: '#9ca3af',
  border: 'rgba(255,255,255,0.1)',
  success: '#22c55e',
};

interface EmailPreviewProps {
  blocks: EmailBlock[];
  venueName: string;
  venueLogo?: string | null;
  previewMode: 'desktop' | 'mobile';
}

export function EmailPreview({ blocks, venueName, venueLogo, previewMode }: EmailPreviewProps) {
  const containerWidth = previewMode === 'mobile' ? '375px' : '600px';

  return (
    <div 
      className="flex-1 rounded-xl overflow-hidden border border-border"
      style={{ backgroundColor: YUNO_COLORS.background }}
    >
      <ScrollArea className="h-full">
        <div 
          className="mx-auto transition-all duration-300"
          style={{ 
            maxWidth: containerWidth,
            padding: previewMode === 'mobile' ? '16px' : '32px'
          }}
        >
          {/* Club Header - Auto-injected, non-editable */}
          <div 
            className="text-center py-6 mb-6"
            style={{ borderBottom: `1px solid ${YUNO_COLORS.border}` }}
          >
            {venueLogo && (
              <img 
                src={venueLogo} 
                alt={venueName}
                className="h-12 mx-auto mb-3 rounded-lg object-contain"
              />
            )}
            <h2 
              className="font-bold text-lg"
              style={{ color: YUNO_COLORS.text }}
            >
              {venueName}
            </h2>
          </div>

          {/* Greeting */}
          <p 
            className="mb-6 text-base"
            style={{ color: YUNO_COLORS.text }}
          >
            Hi <span style={{ color: YUNO_COLORS.primary }}>{'{{first_name}}'}</span>,
          </p>

          {/* Blocks */}
          {blocks.length === 0 ? (
            <div 
              className="py-16 text-center rounded-lg border-2 border-dashed"
              style={{ 
                borderColor: YUNO_COLORS.border,
                color: YUNO_COLORS.textSecondary
              }}
            >
              <p>Add blocks to build your email</p>
            </div>
          ) : (
            <div className="space-y-4">
              {blocks.map(block => (
                <PreviewBlock key={block.id} block={block} />
              ))}
            </div>
          )}

          {/* Yuno Footer - Fixed, non-editable */}
          <div 
            className="mt-8 pt-6 text-center"
            style={{ borderTop: `1px solid ${YUNO_COLORS.border}` }}
          >
            <p 
              className="text-xs"
              style={{ color: YUNO_COLORS.textSecondary }}
            >
              Powered by Yuno
            </p>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

function PreviewBlock({ block }: { block: EmailBlock }) {
  switch (block.type) {
    case 'hero':
      return (
        <div 
          className="p-6 rounded-xl text-center"
          style={{ 
            background: `linear-gradient(135deg, ${YUNO_COLORS.primary}20, ${YUNO_COLORS.background})`
          }}
        >
          <h1 
            className="text-2xl font-bold mb-2"
            style={{ color: YUNO_COLORS.text }}
          >
            {block.content.title || 'Your Headline'}
          </h1>
          {block.content.subtitle && (
            <p style={{ color: YUNO_COLORS.textSecondary }}>
              {block.content.subtitle}
            </p>
          )}
        </div>
      );

    case 'text':
      return (
        <p 
          className="leading-relaxed"
          style={{ color: YUNO_COLORS.text }}
        >
          {block.content.text || 'Your text content here...'}
        </p>
      );

    case 'cta':
      return (
        <div className="text-center py-2">
          <a 
            href="#"
            className="inline-block px-8 py-3 rounded-lg font-semibold transition-opacity hover:opacity-90"
            style={{ 
              backgroundColor: YUNO_COLORS.primary,
              color: YUNO_COLORS.text
            }}
          >
            {block.content.buttonText || 'Click Here'}
          </a>
        </div>
      );

    case 'stats':
      return (
        <div className="grid grid-cols-2 gap-3">
          <div 
            className="p-4 rounded-xl text-center"
            style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
          >
            <p 
              className="text-2xl font-bold"
              style={{ color: YUNO_COLORS.primary }}
            >
              {'{{total_points}}'}
            </p>
            <p 
              className="text-xs mt-1"
              style={{ color: YUNO_COLORS.textSecondary }}
            >
              points
            </p>
          </div>
          <div 
            className="p-4 rounded-xl text-center"
            style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
          >
            <p 
              className="text-2xl font-bold"
              style={{ color: YUNO_COLORS.success }}
            >
              {'{{tier}}'}
            </p>
            <p 
              className="text-xs mt-1"
              style={{ color: YUNO_COLORS.textSecondary }}
            >
              tier
            </p>
          </div>
        </div>
      );

    case 'image':
      return (
        <div className="text-center">
          {block.content.imageUrl ? (
            <img 
              src={block.content.imageUrl} 
              alt={block.content.altText || 'Image'}
              className="max-w-full h-auto rounded-xl mx-auto"
            />
          ) : (
            <div 
              className="py-12 rounded-xl"
              style={{ 
                backgroundColor: 'rgba(255,255,255,0.05)',
                color: YUNO_COLORS.textSecondary
              }}
            >
              Image placeholder
            </div>
          )}
        </div>
      );

    case 'divider':
      return (
        <div 
          className="my-4"
          style={{ borderTop: `1px solid ${YUNO_COLORS.border}` }}
        />
      );

    default:
      return null;
  }
}
