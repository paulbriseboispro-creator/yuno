import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Share2, Copy, Check, QrCode, Download } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';

const BASE_URL = (import.meta.env.VITE_APP_BASE_URL as string | undefined) || 'https://yunoapp.eu';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED      = '#E8192C';
const POS      = '#34D399';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';
const CARD_BG  = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

interface DJShareCardProps {
  slug?: string | null;
  stageName?: string;
  /** When set, share this event-scoped tracked link instead of the bare profile. */
  shareUrl?: string;
  className?: string;
}

/**
 * "Partage ton profil" block for the DJ dashboard. The whole point of A1: make the
 * DJ's public page (or an event tracked link) a one-tap shareable asset — copy,
 * native share, and a downloadable QR for the booth/story. Reuses the public URL
 * the DJ can drop in their Instagram bio.
 */
export function DJShareCard({ slug, stageName, shareUrl, className }: DJShareCardProps) {
  const { t } = useLanguage();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  const url = shareUrl || (slug ? `${BASE_URL}/dj/${slug}` : '');
  // Pretty display: strip the protocol so the URL reads like a handle.
  const displayUrl = url.replace(/^https?:\/\//, '');

  useEffect(() => {
    if (!showQr || !canvasRef.current || !url) return;
    QRCode.toCanvas(canvasRef.current, url, {
      width: 220,
      margin: 2,
      color: { dark: '#000000', light: '#FFFFFF' },
    }).catch(() => { /* canvas unmounted or invalid url */ });
  }, [showQr, url]);

  if (!url) return null;

  const handleShare = async () => {
    const title = stageName || 'Yuno';
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title, url });
      } catch { /* user cancelled */ }
    } else {
      await handleCopy();
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(t('dj.share.copied'));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('dj.share.copyError'));
    }
  };

  const handleDownloadQr = () => {
    if (!canvasRef.current) return;
    const link = document.createElement('a');
    link.download = `yuno-${slug || 'dj'}-qr.png`;
    link.href = canvasRef.current.toDataURL('image/png');
    link.click();
  };

  return (
    <div
      className={`relative overflow-hidden ${className || ''}`}
      style={{
        // Hero treatment: a faint red glow so the "share me" card reads as the
        // growth CTA, not just another tile.
        background: `radial-gradient(ellipse 70% 60% at 90% -20%, rgba(232,25,44,0.10) 0%, transparent 65%), ${CARD_BG}`,
        border: `1px solid ${BORDER}`,
        borderRadius: 18,
        boxShadow: CARD_SHADOW,
        padding: 22,
      }}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 flex-none items-center justify-center rounded-xl"
          style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}>
          <Share2 className="h-4 w-4" style={{ color: RED }} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15.5px] font-semibold leading-tight" style={{ color: T1, letterSpacing: '-0.01em' }}>
            {t('dj.share.title')}
          </h3>
          <p className="mt-0.5 text-xs" style={{ color: T3 }}>{t('dj.share.subtitle')}</p>

          <div className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2.5"
            style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
            <span className="truncate text-xs font-mono" style={{ color: T2 }}>{displayUrl}</span>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={handleShare}
              className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-semibold cursor-pointer transition-all duration-150"
              style={{ background: RED, color: '#fff', boxShadow: `0 0 18px -6px ${RED}99` }}
            >
              <Share2 className="h-3.5 w-3.5" />
              {t('dj.share.shareBtn')}
            </button>
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-semibold cursor-pointer transition-all duration-150 hover:bg-white/[0.06]"
              style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDER}`, color: T1 }}
            >
              {copied ? <Check className="h-3.5 w-3.5" style={{ color: POS }} /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? t('dj.share.copied') : t('dj.share.copy')}
            </button>
            <button
              onClick={() => setShowQr((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-semibold cursor-pointer transition-all duration-150 hover:bg-white/[0.06]"
              style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDER}`, color: T1 }}
            >
              <QrCode className="h-3.5 w-3.5" />
              {t('dj.share.qr')}
            </button>
          </div>

          {showQr && (
            <div className="mt-4 flex flex-col items-center gap-3 rounded-xl p-4"
              style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
              <div className="rounded-lg overflow-hidden bg-white p-2">
                <canvas ref={canvasRef} />
              </div>
              <button
                onClick={handleDownloadQr}
                className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-semibold cursor-pointer transition-all duration-150 hover:bg-white/[0.06]"
                style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDER}`, color: T1 }}
              >
                <Download className="h-3.5 w-3.5" />
                {t('dj.share.downloadQr')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default DJShareCard;
