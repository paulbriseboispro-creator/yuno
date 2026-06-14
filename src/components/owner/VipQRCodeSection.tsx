import { useState, useEffect, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import QRCode from 'qrcode';
import { QrCode, Download, Printer, Loader2, Copy, Check, Info } from 'lucide-react';

interface VipQRCodeSectionProps {
  venueId: string;
  floorPlanLayout: { tables: Array<{ id: string; name: string }> } | null;
}

export function VipQRCodeSection({ venueId, floorPlanLayout }: VipQRCodeSectionProps) {
  const { t } = useLanguage();
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [venueName, setVenueName] = useState<string>('VIP');
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    generateQRCode();
    fetchVenueName();
  }, [venueId]);

  const fetchVenueName = async () => {
    const { data } = await supabase
      .from('venues')
      .select('name')
      .eq('id', venueId)
      .maybeSingle();
    if (data?.name) setVenueName(data.name);
  };

  const generateQRCode = async () => {
    setGenerating(true);
    try {
      const menuUrl = `${window.location.origin}/vip-menu/${venueId}`;
      const qr = await QRCode.toDataURL(menuUrl, {
        width: 400,
        margin: 2,
        color: {
          dark: '#ffffff',
          light: '#000000',
        },
      });
      setQrCodeUrl(qr);
    } catch (error) {
      console.error('Error generating QR code:', error);
      toast.error(t('common.error'));
    } finally {
      setGenerating(false);
    }
  };

  const getMenuUrl = () => {
    return `${window.location.origin}/vip-menu/${venueId}`;
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(getMenuUrl());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success(t('common.copied'));
    } catch (error) {
      toast.error(t('common.error'));
    }
  };

  const handleDownload = () => {
    if (!qrCodeUrl) return;
    const link = document.createElement('a');
    link.href = qrCodeUrl;
    link.download = `QR-VIP-Menu-${venueName}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(t('vipHost.qrDownloaded'));
  };

  const handlePrint = () => {
    if (!printRef.current) return;
    
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error(t('common.error'));
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>QR Code VIP - ${venueName}</title>
          <style>
            @page { 
              size: 100mm 100mm;
              margin: 0;
            }
            body {
              margin: 0;
              padding: 20px;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              font-family: system-ui, -apple-system, sans-serif;
              background: #000;
              color: #fff;
            }
            .container {
              text-align: center;
              padding: 20px;
              border: 2px solid rgba(255,255,255,0.2);
              border-radius: 16px;
              background: rgba(255,255,255,0.05);
            }
            .logo {
              font-size: 24px;
              font-weight: bold;
              margin-bottom: 10px;
              color: #f59e0b;
            }
            .venue-name {
              font-size: 20px;
              font-weight: 600;
              margin-bottom: 15px;
              color: #888;
            }
            .qr-code {
              margin: 15px 0;
            }
            .qr-code img {
              width: 200px;
              height: 200px;
              border-radius: 12px;
            }
            .instructions {
              font-size: 12px;
              color: #888;
              margin-top: 10px;
            }
            .scan-text {
              font-size: 16px;
              font-weight: 500;
              margin-top: 10px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="logo">VIP MENU</div>
            <div class="venue-name">${venueName}</div>
            <div class="qr-code">
              <img src="${qrCodeUrl}" alt="QR Code" />
            </div>
            <div class="scan-text">${t('vipHost.scanToOrder')}</div>
            <div class="instructions">${t('vipOwner.printScanInstructions')}</div>
          </div>
        </body>
      </html>
    `);
    
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 250);
  };

  return (
    <Card className="p-4 bg-surface border-0">
      <h3 className="font-semibold mb-4 flex items-center gap-2">
        <QrCode className="h-4 w-4" />
        {t('vipHost.qrCodes')}
      </h3>
      
      {/* Info about new system */}
      <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mb-4">
        <div className="flex gap-2">
          <Info className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-amber-400 mb-1">{t('vipOwner.qrUnique')}</p>
            <p className="text-muted-foreground">
              {t('vipOwner.qrUniqueDesc')}
            </p>
          </div>
        </div>
      </div>

      <div ref={printRef} className="space-y-4">
        {/* QR Code Display */}
        <div className="bg-muted/30 rounded-xl p-6 text-center">
          {generating ? (
            <div className="py-8">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
            </div>
          ) : qrCodeUrl ? (
            <>
              <div className="inline-block p-4 bg-black rounded-xl mb-4">
                <img 
                  src={qrCodeUrl} 
                  alt="QR Code VIP Menu"
                  className="w-48 h-48 mx-auto"
                />
              </div>
              <h4 className="font-semibold text-lg">{t('vipOwner.vipMenuLabel')}</h4>
              <p className="text-sm text-muted-foreground mt-1">{venueName}</p>
              <p className="text-xs text-muted-foreground mt-3">
                {t('vipOwner.clientsScanQR')}
              </p>
            </>
          ) : null}
        </div>

        {/* Link display */}
        <div className="flex items-center gap-2 p-3 bg-muted/30 rounded-lg">
          <code className="flex-1 text-xs truncate">
            {getMenuUrl()}
          </code>
          <Button 
            variant="ghost" 
            size="icon"
            onClick={handleCopyLink}
          >
            {copied ? (
              <Check className="h-4 w-4 text-emerald-400" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            className="flex-1"
            onClick={handleDownload}
            disabled={!qrCodeUrl}
          >
            <Download className="h-4 w-4 mr-2" />
            {t('vipHost.downloadQR')}
          </Button>
          <Button 
            className="flex-1"
            onClick={handlePrint}
            disabled={!qrCodeUrl}
          >
            <Printer className="h-4 w-4 mr-2" />
            {t('vipHost.printQR')}
          </Button>
        </div>

        {/* Table count info */}
        {floorPlanLayout?.tables && floorPlanLayout.tables.length > 0 && (
          <p className="text-xs text-muted-foreground text-center pt-2 border-t border-border">
            {t('vipOwner.qrWorksForTables').replace('{n}', String(floorPlanLayout.tables.length))}
          </p>
        )}
      </div>
    </Card>
  );
}
