import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search, ArrowLeft, CheckCircle, Package, Loader2, LinkIcon, Ticket, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import QRCode from 'qrcode';

interface ClaimedPurchase {
  id: string;
  type: 'order' | 'ticket' | 'table';
  orderNumber?: string;
  items?: any[];
  total?: number;
  token?: string;
  qrCode?: string;
  quantity?: number;
  totalPrice?: number;
  roundName?: string;
  guestCount?: number;
  deposit?: number;
  fullName?: string;
  zoneName?: string;
  packName?: string;
  status: string;
  venueName: string;
  eventTitle: string;
  createdAt?: string;
  paidAt?: string;
  reference?: string;
}

export default function ClaimOrder() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useLanguage();

  // Reference prefix per purchase type. The prefix is shown as a fixed, locked
  // adornment on the input so the user only ever types the 6-char suffix and can
  // never accidentally drop it.
  const prefixFor = (type: 'order' | 'ticket' | 'table') =>
    type === 'ticket' ? 'TK-' : type === 'table' ? 'VP-' : 'DR-';
  // Strip a leading prefix so pasting a full code (TK-91175F, or a legacy
  // TK-<uuid>) lands in the suffix field cleanly without doubling the prefix.
  const stripPrefix = (v: string) => v.toUpperCase().replace(/^(TK-|VP-|DR-)/, '');

  const [step, setStep] = useState<'lookup' | 'otp' | 'result'>('lookup');
  const [purchaseType, setPurchaseType] = useState<'order' | 'ticket' | 'table'>(
    (searchParams.get('type') as any) || 'ticket'
  );
  // `orderNumber` holds only the suffix (everything after the prefix).
  const [orderNumber, setOrderNumber] = useState(stripPrefix(searchParams.get('order') || searchParams.get('ref') || ''));
  const [lastName, setLastName] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [purchase, setPurchase] = useState<ClaimedPurchase | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLinking, setIsLinking] = useState(false);

  // Full reference (prefix + typed suffix) sent to the backend lookup.
  const fullReference = () => `${prefixFor(purchaseType)}${orderNumber.trim()}`;

  const getTitle = () => {
    if (purchaseType === 'ticket') return t('claim.findTitle.ticket');
    if (purchaseType === 'table') return t('claim.findTitle.table');
    return t('claim.findTitle.order');
  };

  const handleLookup = async () => {
    if (!orderNumber.trim() || !lastName.trim()) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('claim-guest-order', {
        body: { action: 'lookup', orderNumber: fullReference(), lastName: lastName.trim(), purchaseType },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setMaskedEmail(data.maskedEmail);
      setStep('otp');
    } catch (err: any) {
      toast({ title: t('claim.error'), description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify = async () => {
    if (otpCode.length !== 6) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('claim-guest-order', {
        body: { action: 'verify', orderNumber: fullReference(), otpCode, purchaseType },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setPurchase(data.order);
      setStep('result');

      const qrValue = data.order?.qrCode || data.order?.token;
      if (qrValue) {
        const origin = window.location.origin;
        const qrUrl = purchaseType === 'order'
          ? `${origin}/order/${data.order.id}/qr`
          : qrValue;
        const url = await QRCode.toDataURL(qrUrl, { width: 280, margin: 2 });
        setQrDataUrl(url);
      }
    } catch (err: any) {
      toast({ title: t('claim.error'), description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleLink = async () => {
    if (!user || !purchase) return;
    setIsLinking(true);
    try {
      const { data, error } = await supabase.functions.invoke('claim-guest-order', {
        body: { action: 'link', orderNumber: fullReference(), purchaseType },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: t('claim.linked'), description: t('claim.linkedDesc') });
      const tab = purchaseType === 'ticket' ? 'tickets' : purchaseType === 'table' ? 'vip' : 'drinks';
      navigate(`/my-orders?tab=${tab}`);
    } catch (err: any) {
      toast({ title: t('claim.error'), description: err.message, variant: 'destructive' });
    } finally {
      setIsLinking(false);
    }
  };

  const renderPurchaseDetails = () => {
    if (!purchase) return null;
    
    if (purchase.type === 'ticket') {
      return (
        <Card className="p-4 border border-border/30 bg-surface">
          <div className="flex items-center gap-2 mb-3">
            <Ticket className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">{t('claim.ticketDetails')}</h3>
          </div>
          {purchase.venueName && <p className="text-sm text-muted-foreground mb-1">{purchase.venueName}</p>}
          {purchase.eventTitle && <p className="text-sm font-medium mb-1">{purchase.eventTitle}</p>}
          {purchase.roundName && <p className="text-sm text-muted-foreground mb-3">{purchase.roundName}</p>}
          <div className="border-t border-border/30 mt-3 pt-3 flex justify-between font-semibold">
            <span>{purchase.quantity || 1}x {t('claim.tabTickets')}</span>
            <span className="text-primary">{Number(purchase.totalPrice || 0).toFixed(2)}€</span>
          </div>
        </Card>
      );
    }

    if (purchase.type === 'table') {
      return (
        <Card className="p-4 border border-border/30 bg-surface">
          <div className="flex items-center gap-2 mb-3">
            <Users className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">{t('claim.reservationDetails')}</h3>
          </div>
          {purchase.venueName && <p className="text-sm text-muted-foreground mb-1">{purchase.venueName}</p>}
          {purchase.eventTitle && <p className="text-sm font-medium mb-1">{purchase.eventTitle}</p>}
          {purchase.zoneName && <p className="text-sm text-muted-foreground">{purchase.zoneName} — {purchase.packName}</p>}
          {purchase.fullName && <p className="text-sm text-muted-foreground mb-3">{purchase.fullName}</p>}
          <div className="border-t border-border/30 mt-3 pt-3 flex justify-between font-semibold">
            <span>{t('claim.deposit')}</span>
            <span className="text-primary">{Number(purchase.totalPrice || 0).toFixed(2)}€</span>
          </div>
        </Card>
      );
    }

    return (
      <Card className="p-4 border border-border/30 bg-surface">
        <div className="flex items-center gap-2 mb-3">
          <Package className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">{t('claim.orderDetails')}</h3>
        </div>
        {purchase.venueName && <p className="text-sm text-muted-foreground mb-1">{purchase.venueName}</p>}
        {purchase.eventTitle && <p className="text-sm text-muted-foreground mb-3">{purchase.eventTitle}</p>}
        <div className="space-y-2">
          {Array.isArray(purchase.items) && purchase.items.map((item: any, i: number) => (
            <div key={i} className="flex justify-between text-sm">
              <span>{item.quantity || item.qty}x {item.name}</span>
              <span className="text-muted-foreground">{((item.price || item.unitPrice) * (item.quantity || item.qty)).toFixed(2)}€</span>
            </div>
          ))}
        </div>
        <div className="border-t border-border/30 mt-3 pt-3 flex justify-between font-semibold">
          <span>Total</span>
          <span className="text-primary">{Number(purchase.total || 0).toFixed(2)}€</span>
        </div>
      </Card>
    );
  };

  return (
    <div className="min-h-[100dvh] bg-background" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <header className="sticky top-0 z-40 border-b border-border/40 bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-lg items-center gap-3 px-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-semibold">{t('claim.title')}</h1>
        </div>
      </header>

      <div className="mx-auto max-w-lg p-4">
        {step === 'lookup' && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <div className="text-center py-6">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <Search className="h-8 w-8 text-primary" />
              </div>
              <h2 className="text-xl font-bold mb-2">{getTitle()}</h2>
              <p className="text-sm text-muted-foreground">
                {t('claim.findDesc')}
              </p>
            </div>

            <Tabs value={purchaseType} onValueChange={(v) => { setPurchaseType(v as any); setOrderNumber(''); }}>
              <TabsList className="w-full grid grid-cols-3">
                <TabsTrigger value="ticket">{t('claim.tabTickets')}</TabsTrigger>
                <TabsTrigger value="table">{t('claim.tabTables')}</TabsTrigger>
                <TabsTrigger value="order">{t('claim.tabDrinks')}</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t('claim.reference')}</Label>
                {/* Locked prefix + 6-char suffix. The prefix is a fixed adornment
                    so it can never be deleted; the user only types the code. */}
                <div className="flex items-center h-12 rounded-xl border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring/50">
                  <span className="text-lg font-mono font-bold tracking-widest text-muted-foreground select-none">{prefixFor(purchaseType)}</span>
                  <Input
                    placeholder="XXXXXX"
                    value={orderNumber}
                    // Strip any pasted prefix so it never doubles up; uppercasing
                    // is safe even for legacy long codes (backend matches those
                    // case-insensitively).
                    onChange={(e) => setOrderNumber(stripPrefix(e.target.value))}
                    className="h-full border-0 bg-transparent px-1 text-lg font-mono tracking-widest uppercase shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                </div>
                <p className="text-xs text-muted-foreground">{t('claim.refHint')}</p>
              </div>

              <div className="space-y-2">
                <Label>{t('claim.lastName')}</Label>
                <Input
                  placeholder={t('claim.lastNamePlaceholder')}
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="text-center text-lg"
                />
              </div>

              <Button
                onClick={handleLookup}
                disabled={isLoading || !orderNumber.trim() || !lastName.trim()}
                className="w-full h-12 rounded-xl bg-primary text-base font-semibold"
              >
                {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : t('claim.search')}
              </Button>
            </div>
          </motion.div>
        )}

        {step === 'otp' && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <div className="text-center py-6">
              <h2 className="text-xl font-bold mb-2">{t('claim.verifyEmail')}</h2>
              <p className="text-sm text-muted-foreground">
                {t('claim.otpSentTo')} <strong className="text-foreground">{maskedEmail}</strong>
              </p>
            </div>

            <div className="flex justify-center">
              <InputOTP maxLength={6} value={otpCode} onChange={setOtpCode}>
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
            </div>

            <Button
              onClick={handleVerify}
              disabled={isLoading || otpCode.length !== 6}
              className="w-full h-12 rounded-xl bg-primary text-base font-semibold"
            >
              {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : t('claim.verify')}
            </Button>

            <Button variant="ghost" onClick={() => { setStep('lookup'); setOtpCode(''); }} className="w-full text-sm text-muted-foreground">
              {t('claim.back')}
            </Button>
          </motion.div>
        )}

        {step === 'result' && purchase && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <div className="text-center py-4">
              <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-3" />
              <h2 className="text-xl font-bold mb-1">{t('claim.purchaseFound')}</h2>
              <p className="text-sm text-muted-foreground font-mono">{purchase.orderNumber || purchase.reference}</p>
            </div>

            {qrDataUrl && (
              <Card className="p-6 rounded-2xl border border-border/30" style={{ backgroundColor: '#ffffff' }}>
                <div className="text-center">
                  <img src={qrDataUrl} alt="QR Code" className="mx-auto w-56 h-56" />
                  <p className="text-xs mt-2" style={{ color: '#666666' }}>{t('claim.showQRAtBar')}</p>
                </div>
              </Card>
            )}

            {renderPurchaseDetails()}

            {user && (
              <Button
                onClick={handleLink}
                disabled={isLinking}
                variant="outline"
                className="w-full h-12 rounded-xl border-primary/30 text-primary"
              >
                <LinkIcon className="h-4 w-4 mr-2" />
                {isLinking ? <Loader2 className="h-4 w-4 animate-spin" /> : t('claim.addToAccount')}
              </Button>
            )}

            {!user && (
              <div className="text-center">
                <p className="text-xs text-muted-foreground mb-2">
                  {t('claim.createAccountHint')}
                </p>
                <Button variant="ghost" onClick={() => navigate('/auth?redirect=/claim?order=' + fullReference() + '&type=' + purchaseType)} className="text-sm text-primary">
                  {t('claim.createAccount')}
                </Button>
              </div>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
}
