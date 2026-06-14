import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Gift, History, Ticket, X, QrCode } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { LoyaltyCard } from './LoyaltyCard';
import { RewardCard } from './RewardCard';
import { DrinkRewardRedemptionDialog } from './DrinkRewardRedemptionDialog';
import { TicketRewardRedemptionDialog } from './TicketRewardRedemptionDialog';
import { DiscountRedemptionDialog } from './DiscountRedemptionDialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { useLoyalty } from '@/hooks/useLoyalty';
import { toast } from 'sonner';
import QRCode from 'qrcode';

interface LoyaltyRewardsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  venueId: string;
  venueName?: string;
}

export function LoyaltyRewardsSheet({
  open,
  onOpenChange,
  venueId,
  venueName
}: LoyaltyRewardsSheetProps) {
  const { t, language } = useLanguage();
  const { loyalty, rewards, transactions, redemptions, redeemReward, getNextReward, loading } = useLoyalty(venueId);
  const [redeemingId, setRedeemingId] = useState<string | null>(null);
  const [qrDialog, setQrDialog] = useState<{ open: boolean; code: string; rewardName: string }>({
    open: false,
    code: '',
    rewardName: ''
  });
  const [qrImage, setQrImage] = useState<string>('');
  const [drinkRewardDialog, setDrinkRewardDialog] = useState<{
    open: boolean;
    rewardId: string;
    rewardName: string;
    pointsRequired: number;
    allowedCategories: string[];
  }>({ open: false, rewardId: '', rewardName: '', pointsRequired: 0, allowedCategories: [] });
  const [ticketRewardDialog, setTicketRewardDialog] = useState<{
    open: boolean;
    rewardId: string;
    rewardName: string;
    pointsRequired: number;
    maxTicketValue?: number;
  }>({ open: false, rewardId: '', rewardName: '', pointsRequired: 0 });
  const [discountRewardDialog, setDiscountRewardDialog] = useState<{
    open: boolean;
    rewardId: string;
    rewardName: string;
    pointsRequired: number;
    discountType: 'percentage' | 'fixed';
    discountValue: number;
    maxCartValue?: number;
    appliesTo?: 'drinks' | 'tickets' | 'all';
  }>({ open: false, rewardId: '', rewardName: '', pointsRequired: 0, discountType: 'percentage', discountValue: 0 });

  const handleRedeem = async (rewardId: string) => {
    const reward = rewards.find(r => r.id === rewardId);
    if (!reward) return;

    const rewardValue = reward.reward_value as {
      allowed_categories?: string[];
      max_ticket_value?: number;
      discount_type?: 'percentage' | 'fixed';
      discount_value?: number;
      max_cart_value?: number;
      applies_to?: 'drinks' | 'tickets' | 'all';
    } | null;

    // For free drink rewards, open the selection dialog
    if (reward.reward_type === 'free_drink') {
      setDrinkRewardDialog({
        open: true,
        rewardId: reward.id,
        rewardName: reward.name,
        pointsRequired: reward.points_required,
        allowedCategories: rewardValue?.allowed_categories || []
      });
      return;
    }

    // For free ticket rewards, open the ticket selection dialog
    if (reward.reward_type === 'free_ticket') {
      setTicketRewardDialog({
        open: true,
        rewardId: reward.id,
        rewardName: reward.name,
        pointsRequired: reward.points_required,
        maxTicketValue: rewardValue?.max_ticket_value
      });
      return;
    }

    // For discount rewards, open the discount activation dialog
    if (reward.reward_type === 'discount') {
      setDiscountRewardDialog({
        open: true,
        rewardId: reward.id,
        rewardName: reward.name,
        pointsRequired: reward.points_required,
        discountType: rewardValue?.discount_type || 'percentage',
        discountValue: rewardValue?.discount_value || 10,
        maxCartValue: rewardValue?.max_cart_value,
        appliesTo: rewardValue?.applies_to || 'all'
      });
      return;
    }

    // For other reward types, proceed directly
    setRedeemingId(rewardId);
    
    const result = await redeemReward(rewardId);
    
    if (result.success && result.qrCode) {
      toast.success(t('loyaltySheet.redeemSuccess'));
      // Generate QR code image
      const qrDataUrl = await QRCode.toDataURL(result.qrCode, { width: 256, margin: 2 });
      setQrImage(qrDataUrl);
      setQrDialog({
        open: true,
        code: result.qrCode,
        rewardName: reward?.name || ''
      });
    } else {
      toast.error(result.error || t('loyaltySheet.redeemError'));
    }
    
    setRedeemingId(null);
  };

  const handleDrinkRewardConfirm = async (drinkId: string, eventId: string, drinkName: string, eventTitle: string) => {
    const result = await redeemReward(drinkRewardDialog.rewardId, {
      drinkId,
      eventId,
      drinkName,
      eventTitle
    });

    if (result.success) {
      toast.success(t('loyaltySheet.redeemSuccess'));
      setDrinkRewardDialog({ open: false, rewardId: '', rewardName: '', pointsRequired: 0, allowedCategories: [] });
    } else {
      toast.error(result.error || t('loyaltySheet.redeemError'));
      throw new Error(result.error);
    }
  };

  const handleTicketRewardConfirm = async (eventId: string, roundId: string, eventTitle: string, roundName: string) => {
    const result = await redeemReward(ticketRewardDialog.rewardId, {
      eventId,
      roundId,
      eventTitle,
      roundName
    });

    if (result.success) {
      toast.success(t('loyaltySheet.redeemSuccess'));
      setTicketRewardDialog({ open: false, rewardId: '', rewardName: '', pointsRequired: 0 });
    } else {
      toast.error(result.error || t('loyaltySheet.redeemError'));
      throw new Error(result.error);
    }
  };

  const handleDiscountRewardConfirm = async () => {
    const result = await redeemReward(discountRewardDialog.rewardId);

    if (result.success) {
      toast.success(t('loyaltySheet.redeemSuccess'));
      setDiscountRewardDialog({ 
        open: false, rewardId: '', rewardName: '', pointsRequired: 0, 
        discountType: 'percentage', discountValue: 0 
      });
    } else {
      toast.error(result.error || t('loyaltySheet.redeemError'));
      throw new Error(result.error);
    }
  };

  const showRedemptionQR = async (qrCode: string, rewardName: string) => {
    const qrDataUrl = await QRCode.toDataURL(qrCode, { width: 256, margin: 2 });
    setQrImage(qrDataUrl);
    setQrDialog({ open: true, code: qrCode, rewardName });
  };

  const nextRewardInfo = getNextReward();

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(language === 'es' ? 'es-ES' : language === 'fr' ? 'fr-FR' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getTransactionSign = (type: string) => {
    if (type === 'earn' || type === 'bonus') return '+';
    if (type === 'redeem' || type === 'expire') return '-';
    return '';
  };

  const getTransactionColor = (type: string) => {
    if (type === 'earn' || type === 'bonus') return 'text-green-500';
    if (type === 'redeem' || type === 'expire') return 'text-red-400';
    return 'text-muted-foreground';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-500/20 text-yellow-500';
      case 'used': return 'bg-green-500/20 text-green-500';
      case 'expired': return 'bg-red-500/20 text-red-400';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  if (loading || !loyalty) {
    return null;
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[90dvh] max-w-full rounded-t-3xl p-0 [&>button.absolute]:hidden flex flex-col overflow-x-hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} onOpenAutoFocus={(e) => e.preventDefault()}>
          {/* Drag handle for mobile - tapping closes */}
          <button
            onClick={() => onOpenChange(false)}
            className="w-full flex justify-center pt-3 pb-1 cursor-pointer touch-manipulation shrink-0"
            aria-label="Close"
          >
            <div className="w-10 h-1.5 rounded-full bg-muted-foreground/30" />
          </button>

          <SheetHeader className="px-5 pt-1 pb-2 shrink-0">
            <SheetTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-base">
                <Gift className="h-5 w-5 text-primary" />
                {t('loyaltySheet.title')}
              </span>
              <button
                onClick={() => onOpenChange(false)}
                className="h-8 w-8 rounded-full bg-muted flex items-center justify-center touch-manipulation"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </SheetTitle>
          </SheetHeader>

          <ScrollArea className="flex-1 min-h-0 px-4 pb-4">
            {/* Loyalty Card */}
            <LoyaltyCard
              balance={loyalty.current_balance}
              tier={loyalty.tier}
              nextRewardName={nextRewardInfo?.nextReward?.name}
              nextRewardPoints={nextRewardInfo?.nextReward?.points_required}
              progressPercent={nextRewardInfo?.progressPercent || 0}
              affordableRewardsCount={nextRewardInfo?.affordableRewards.length || 0}
              className="mb-4"
            />

            <Tabs defaultValue="rewards" className="w-full">
              <TabsList className="w-full mb-3">
                <TabsTrigger value="rewards" className="flex-1 gap-1 text-xs">
                  <Gift className="h-3.5 w-3.5" />
                  {t('loyaltySheet.rewards')}
                </TabsTrigger>
                <TabsTrigger value="my-rewards" className="flex-1 gap-1 text-xs">
                  <Ticket className="h-3.5 w-3.5" />
                  {t('loyaltySheet.myRewards')}
                </TabsTrigger>
                <TabsTrigger value="history" className="flex-1 gap-1 text-xs">
                  <History className="h-3.5 w-3.5" />
                  {t('loyaltySheet.history')}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="rewards" className="space-y-3">
                {rewards.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">{t('loyaltySheet.noRewards')}</p>
                ) : (
                  rewards.map(reward => (
                    <RewardCard
                      key={reward.id}
                      id={reward.id}
                      name={reward.name}
                      description={reward.description}
                      pointsRequired={reward.points_required}
                      rewardType={reward.reward_type}
                      currentBalance={loyalty.current_balance}
                      onRedeem={handleRedeem}
                      isRedeeming={redeemingId === reward.id}
                    />
                  ))
                )}
              </TabsContent>

              <TabsContent value="my-rewards" className="space-y-3">
                {redemptions.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">{t('loyaltySheet.noRedemptions')}</p>
                ) : (
                  redemptions.map(redemption => (
                    <motion.div
                      key={redemption.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-4 rounded-xl border bg-card"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-medium">{redemption.reward?.name || redemption.reward_label || 'Reward'}</h4>
                          <p className="text-sm text-muted-foreground">
                            {formatDate(redemption.created_at)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(redemption.status)}`}>
                            {t(`loyaltySheet.${redemption.status}`)}
                          </span>
                          {redemption.status === 'pending' && redemption.qr_code && (
                            <button
                              onClick={() => showRedemptionQR(redemption.qr_code!, redemption.reward?.name || redemption.reward_label || 'Reward')}
                              className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center"
                            >
                              <QrCode className="h-5 w-5 text-primary" />
                            </button>
                          )}
                        </div>
                      </div>
                      {redemption.expires_at && redemption.status === 'pending' && (
                        <p className="text-xs text-muted-foreground mt-2">
                          {t('loyaltySheet.expiresAt')}: {formatDate(redemption.expires_at)}
                        </p>
                      )}
                    </motion.div>
                  ))
                )}
              </TabsContent>

              <TabsContent value="history" className="space-y-2">
                {transactions.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">{t('loyaltySheet.noHistory')}</p>
                ) : (
                  transactions.map(tx => (
                    <motion.div
                      key={tx.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="flex items-center justify-between py-3 border-b border-border/50 last:border-0"
                    >
                      <div>
                        <p className="font-medium text-sm">{tx.description || tx.transaction_type}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(tx.created_at)}</p>
                      </div>
                      <span className={`font-semibold ${getTransactionColor(tx.transaction_type)}`}>
                        {getTransactionSign(tx.transaction_type)}{tx.points}
                      </span>
                    </motion.div>
                  ))
                )}
              </TabsContent>
            </Tabs>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* QR Code Dialog */}
      <Dialog open={qrDialog.open} onOpenChange={(open) => setQrDialog(prev => ({ ...prev, open }))}>
        <DialogContent className="max-w-sm text-center">
          <button
            onClick={() => setQrDialog(prev => ({ ...prev, open: false }))}
            className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="py-4">
            <Gift className="h-12 w-12 text-primary mx-auto mb-4" />
            <h3 className="text-xl font-bold mb-2">{qrDialog.rewardName}</h3>
            <p className="text-muted-foreground text-sm mb-6">{t('loyaltySheet.scanQr')}</p>
            {qrImage && (
              <div className="bg-white p-4 rounded-xl inline-block">
                <img src={qrImage} alt="Reward QR Code" className="w-48 h-48" />
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-4 font-mono">{qrDialog.code}</p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Drink Reward Selection Dialog */}
      <DrinkRewardRedemptionDialog
        open={drinkRewardDialog.open}
        onOpenChange={(open) => setDrinkRewardDialog(prev => ({ ...prev, open }))}
        venueId={venueId}
        rewardId={drinkRewardDialog.rewardId}
        rewardName={drinkRewardDialog.rewardName}
        pointsRequired={drinkRewardDialog.pointsRequired}
        allowedCategories={drinkRewardDialog.allowedCategories}
        onConfirm={handleDrinkRewardConfirm}
      />

      {/* Ticket Reward Selection Dialog */}
      <TicketRewardRedemptionDialog
        open={ticketRewardDialog.open}
        onOpenChange={(open) => setTicketRewardDialog(prev => ({ ...prev, open }))}
        venueId={venueId}
        rewardId={ticketRewardDialog.rewardId}
        rewardName={ticketRewardDialog.rewardName}
        pointsRequired={ticketRewardDialog.pointsRequired}
        maxTicketValue={ticketRewardDialog.maxTicketValue}
        onConfirm={handleTicketRewardConfirm}
      />

      {/* Discount Activation Dialog */}
      <DiscountRedemptionDialog
        open={discountRewardDialog.open}
        onOpenChange={(open) => setDiscountRewardDialog(prev => ({ ...prev, open }))}
        rewardId={discountRewardDialog.rewardId}
        rewardName={discountRewardDialog.rewardName}
        pointsRequired={discountRewardDialog.pointsRequired}
        discountType={discountRewardDialog.discountType}
        discountValue={discountRewardDialog.discountValue}
        maxCartValue={discountRewardDialog.maxCartValue}
        appliesTo={discountRewardDialog.appliesTo}
        onConfirm={handleDiscountRewardConfirm}
      />
    </>
  );
}
