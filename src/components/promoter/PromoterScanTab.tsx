import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { ScanLine, CheckCircle2, XCircle, AlertTriangle, Camera, X } from 'lucide-react';
import { Scanner } from '@yudiel/react-qr-scanner';

interface PromoterScanTabProps {
  promoterId: string;
  eventId: string;
  eventTitle: string;
}

interface ScanResult {
  status: 'success' | 'not_yours' | 'already_scanned' | 'invalid';
  attendeeName?: string;
}

export function PromoterScanTab({ promoterId, eventId, eventTitle }: PromoterScanTabProps) {
  const { t } = useLanguage();
  const [scanning, setScanning] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [scannedCount, setScannedCount] = useState(0);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    fetchScannedCount();
  }, [promoterId, eventId]);

  async function fetchScannedCount() {
    const { data: convs } = await supabase.from('promoter_conversions')
      .select('ticket_id')
      .eq('promoter_id', promoterId)
      .eq('event_id', eventId)
      .eq('conversion_type', 'ticket')
      .not('ticket_id', 'is', null);

    if (!convs || convs.length === 0) { setScannedCount(0); return; }

    const ticketIds = convs.map(c => c.ticket_id).filter(Boolean) as string[];
    const { count } = await supabase.from('tickets')
      .select('*', { count: 'exact', head: true })
      .in('id', ticketIds)
      .eq('entry_scanned', true);

    setScannedCount(count || 0);
  }

  async function processQRCode(code: string) {
    if (!code || processing) return;
    setProcessing(true);
    setLastResult(null);

    try {
      // Look up ticket by QR code
      const { data: ticket } = await supabase.from('tickets')
        .select('id, event_id, entry_scanned, status, qr_code')
        .eq('qr_code', code)
        .eq('event_id', eventId)
        .maybeSingle();

      // Also try ticket_attendees
      let attendeeTicket: any = null;
      if (!ticket) {
        const { data: att } = await supabase.from('ticket_attendees')
          .select('id, ticket_id, qr_code, full_name, entry_scanned')
          .eq('qr_code', code)
          .maybeSingle();
        if (att) {
          const { data: parentTicket } = await supabase.from('tickets')
            .select('id, event_id, entry_scanned, status')
            .eq('id', att.ticket_id)
            .eq('event_id', eventId)
            .maybeSingle();
          if (parentTicket) {
            attendeeTicket = { ...parentTicket, attendee: att };
          }
        }
      }

      // Also try guest_list_entries by QR code (or human reservation code)
      let guestListEntry: any = null;
      if (!ticket && !attendeeTicket) {
        const { data: gle } = await supabase.from('guest_list_entries')
          .select('id, full_name, status, entry_scanned, promoter_id, guest_list:guest_lists!inner(event_id)')
          .or(`qr_code.eq.${code},reservation_code.eq.${code}`)
          .maybeSingle();
        if (gle) {
          guestListEntry = gle;
        }
      }

      // Handle guest list entry scan
      if (guestListEntry) {
        if ((guestListEntry.guest_list as any)?.event_id !== eventId) {
          setLastResult({ status: 'invalid' });
          toast.error(t('promoterScan.invalid'));
          return;
        }
        if (guestListEntry.promoter_id !== promoterId) {
          setLastResult({ status: 'not_yours' });
          toast.error(t('promoterScan.notYours'));
          return;
        }
        if (guestListEntry.entry_scanned) {
          setLastResult({ status: 'already_scanned', attendeeName: guestListEntry.full_name });
          toast.warning(t('promoterScan.alreadyScanned'));
          return;
        }
        // Mark as scanned (conditional update guards against a double scan race)
        const scanAt = new Date().toISOString();
        const { data: { user } } = await supabase.auth.getUser();
        const { data: updated } = await supabase.from('guest_list_entries')
          .update({ entry_scanned: true, entry_scanned_at: scanAt, entry_scanned_by: user?.id })
          .eq('id', guestListEntry.id).eq('entry_scanned', false).select();
        if (!updated || updated.length === 0) {
          setLastResult({ status: 'already_scanned', attendeeName: guestListEntry.full_name });
          toast.warning(t('promoterScan.alreadyScanned'));
          return;
        }

        // Record the per-head commission without blocking the door flow.
        supabase.rpc('record_promoter_conversion', {
          p_promoter_id: promoterId,
          p_conversion_type: 'guestlist',
          p_amount: 0,
          p_event_id: eventId,
          p_guest_list_entry_id: guestListEntry.id,
          p_scan_at: scanAt,
        }).then(({ error }) => { if (error) console.error('record_promoter_conversion (guestlist)', error); });

        setLastResult({ status: 'success', attendeeName: guestListEntry.full_name });
        toast.success(t('promoterScan.success'));
        setScannedCount(prev => prev + 1);
        return;
      }

      const resolvedTicket = ticket || attendeeTicket;

      if (!resolvedTicket || resolvedTicket.status !== 'paid') {
        setLastResult({ status: 'invalid' });
        toast.error(t('promoterScan.invalid'));
        return;
      }

      // Check if ticket belongs to this promoter
      const { data: conv } = await supabase.from('promoter_conversions')
        .select('id')
        .eq('promoter_id', promoterId)
        .eq('ticket_id', resolvedTicket.id)
        .eq('conversion_type', 'ticket')
        .maybeSingle();

      if (!conv) {
        setLastResult({ status: 'not_yours' });
        toast.error(t('promoterScan.notYours'));
        return;
      }

      // Check if already scanned
      const isScanned = attendeeTicket?.attendee?.entry_scanned || resolvedTicket.entry_scanned;
      if (isScanned) {
        setLastResult({ status: 'already_scanned' });
        toast.warning(t('promoterScan.alreadyScanned'));
        return;
      }

      // Mark as scanned — surface DB errors so a failed write never shows as a successful scan
      if (attendeeTicket?.attendee) {
        const { error: attErr } = await supabase.from('ticket_attendees').update({ entry_scanned: true }).eq('id', attendeeTicket.attendee.id);
        if (attErr) throw attErr;
      }
      const { error: tkErr } = await supabase.from('tickets').update({ entry_scanned: true }).eq('id', resolvedTicket.id);
      if (tkErr) throw tkErr;

      setLastResult({
        status: 'success',
        attendeeName: attendeeTicket?.attendee?.full_name || undefined,
      });
      toast.success(t('promoterScan.success'));
      setScannedCount(prev => prev + 1);
    } catch (err) {
      console.error(err);
      setLastResult({ status: 'invalid' });
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ScanLine className="h-4 w-4" />
            {t('promoterScan.title')}
          </CardTitle>
          <p className="text-xs text-muted-foreground">{t('promoterScan.onlyYourTickets')}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm font-medium">{eventTitle}</p>

          {/* Camera Scanner */}
          {cameraActive ? (
            <div className="relative rounded-xl overflow-hidden border border-border">
              <Scanner
                onScan={(results) => {
                  if (results && results.length > 0 && !processing) {
                    const code = results[0].rawValue;
                    if (code) {
                      setCameraActive(false);
                      processQRCode(code);
                    }
                  }
                }}
                formats={['qr_code']}
                allowMultiple={false}
                scanDelay={1500}
                components={{ finder: true }}
                styles={{ container: { width: '100%', aspectRatio: '1' } }}
              />
              <Button
                variant="secondary"
                size="sm"
                className="absolute top-2 right-2 z-10"
                onClick={() => setCameraActive(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <Button
              onClick={() => { setCameraActive(true); setLastResult(null); }}
              className="w-full gap-2"
              disabled={processing}
            >
              <Camera className="h-4 w-4" />
              Scanner un QR Code
            </Button>
          )}

          {/* Scanned count */}
          <div className="flex items-center justify-between text-sm bg-muted/50 rounded p-3">
            <span className="text-muted-foreground">{t('promoterScan.title')}</span>
            <Badge variant="secondary">{scannedCount}</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Last result feedback */}
      {lastResult && (
        <Card className={
          lastResult.status === 'success' ? 'border-green-500 bg-green-500/10' :
          lastResult.status === 'already_scanned' ? 'border-amber-500 bg-amber-500/10' :
          'border-destructive bg-destructive/10'
        }>
          <CardContent className="p-4 flex items-center gap-3">
            {lastResult.status === 'success' && <CheckCircle2 className="h-6 w-6 text-green-500 flex-shrink-0" />}
            {lastResult.status === 'already_scanned' && <AlertTriangle className="h-6 w-6 text-amber-500 flex-shrink-0" />}
            {(lastResult.status === 'not_yours' || lastResult.status === 'invalid') && <XCircle className="h-6 w-6 text-destructive flex-shrink-0" />}
            <div>
              <p className="font-semibold text-sm">
                {lastResult.status === 'success' && t('promoterScan.success')}
                {lastResult.status === 'already_scanned' && t('promoterScan.alreadyScanned')}
                {lastResult.status === 'not_yours' && t('promoterScan.notYours')}
                {lastResult.status === 'invalid' && t('promoterScan.invalid')}
              </p>
              {lastResult.attendeeName && (
                <p className="text-xs text-muted-foreground">{lastResult.attendeeName}</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
