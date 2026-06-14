import { useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { Button } from '@/components/ui/button';
import { Download, Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';

interface StoryPreviewProps {
  children: React.ReactNode;
  fileName?: string;
}

export function StoryPreview({ children, fileName = 'yuno-story' }: StoryPreviewProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const { t } = useLanguage();

  const handleDownload = async () => {
    if (!canvasRef.current) return;
    setExporting(true);
    try {
      const dataUrl = await toPng(canvasRef.current, {
        width: 1080,
        height: 1920,
        pixelRatio: 1,
        cacheBust: true,
      });
      const link = document.createElement('a');
      link.download = `${fileName}.png`;
      link.href = dataUrl;
      link.click();
      toast.success(t('storyBuilder.downloaded'));
    } catch (err) {
      console.error('Export failed', err);
      toast.error(t('storyBuilder.exportError'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-6">
      {/* Scaled preview */}
      <div
        className="rounded-2xl overflow-hidden shadow-2xl border border-white/10"
        style={{
          width: 300,
          height: 533,
        }}
      >
        <div
          style={{
            width: 1080,
            height: 1920,
            transform: 'scale(0.2778)',
            transformOrigin: 'top left',
          }}
        >
          <div ref={canvasRef}>
            {children}
          </div>
        </div>
      </div>

      <Button
        onClick={handleDownload}
        disabled={exporting}
        size="lg"
        className="gap-2"
      >
        {exporting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        {t('storyBuilder.download')}
      </Button>
    </div>
  );
}
