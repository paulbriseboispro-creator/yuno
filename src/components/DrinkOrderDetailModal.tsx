import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { Clock, CheckCircle2, Wine, Calendar, Copy, CheckCircle, X, Package } from 'lucide-react';
import { toast } from 'sonner';
import { nowInParis, toParisTime } from '@/lib/timezone';
import QRCode from 'qrcode';
import { DrinkSelectionStep } from '@/components/orders/DrinkSelectionStep';

interface OrderItem {
  id?: string;
  drinkId?: string;
  name: string;
  qty: number;
  unitPrice: number;
  imgUrl?: string;
  served?: boolean;
  servedUnits?: boolean[];
  prepUnits?: boolean[];
}

interface SourceOrder {
  id: string;
  items: OrderItem[];
  token?: string;
  prep_requested?: boolean;
  prep_status?: string;
}

interface DrinkOrder {
  id: string;
  token?: string;
  token_used?: boolean;
  total: number;
  status: string;
  prep_requested?: boolean;
  prep_status?: string;
  items: OrderItem[];
  events?: {
    title: string;
    start_at: string;
    end_at: string;
  } | null;
  venue_id: string;
  _sourceOrders?: SourceOrder[];
}

interface DrinkOrderDetailModalProps {
  order: DrinkOrder;
  clickCollectMode: boolean;
  onClose: () => void;
  onOrderUpdate?: () => void;
  collectMode?: boolean;
}

export function DrinkOrderDetailModal({ 
  order, 
  clickCollectMode, 
  onClose,
  onOrderUpdate,
  collectMode = false,
}: DrinkOrderDetailModalProps) {
  const { t, language } = useLanguage();
  const [qrImage, setQrImage] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [requestingPrep, setRequestingPrep] = useState(false);
  const [localOrder, setLocalOrder] = useState(order);
  const [step, setStep] = useState<'select' | 'qr'>(collectMode ? 'qr' : 'select');
  const [selectedExpandedIndices, setSelectedExpandedIndices] = useState<number[]>([]);

  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  // Check if all items are already served
  const allServed = (() => {
    let total = 0, served = 0;
    localOrder.items.forEach(item => {
      for (let i = 0; i < item.qty; i++) {
        total++;
        const isServed = Array.isArray(item.servedUnits) ? item.servedUnits[i] === true : item.served === true;
        if (isServed) served++;
      }
    });
    return total > 0 && served === total;
  })();

  // Count unserved units (excluding prep items in QR mode)
  const unservedCount = (() => {
    let count = 0;
    localOrder.items.forEach(item => {
      for (let i = 0; i < item.qty; i++) {
        const isServed = Array.isArray(item.servedUnits) ? item.servedUnits[i] === true : item.served === true;
        const isInPrep = Array.isArray(item.prepUnits) ? item.prepUnits[i] === true : false;
        if (!isServed && (!isInPrep || collectMode)) count++;
      }
    });
    return count;
  })();

  // Count prep items (for collect mode)
  const prepCount = (() => {
    let count = 0;
    localOrder.items.forEach(item => {
      for (let i = 0; i < item.qty; i++) {
        const isServed = Array.isArray(item.servedUnits) ? item.servedUnits[i] === true : item.served === true;
        const isInPrep = Array.isArray(item.prepUnits) ? item.prepUnits[i] === true : false;
        if (!isServed && isInPrep) count++;
      }
    });
    return count;
  })();

  // Check if event has started
  const eventHasStarted = (() => {
    const startAt = localOrder.events?.start_at;
    if (!startAt) return true;
    const now = nowInParis();
    const eventStart = toParisTime(startAt);
    if (Number.isNaN(eventStart.getTime())) return true;
    const allowedTime = new Date(eventStart.getTime() - 5 * 60 * 1000);
    return now >= allowedTime;
  })();

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // In collect mode, auto-select prep items and generate QR
  useEffect(() => {
    if (collectMode && prepCount > 0) {
      const prepIndices: number[] = [];
      let expandedIdx = 0;
      localOrder.items.forEach(item => {
        for (let i = 0; i < item.qty; i++) {
          const isServed = Array.isArray(item.servedUnits) ? item.servedUnits[i] === true : item.served === true;
          const isInPrep = Array.isArray(item.prepUnits) ? item.prepUnits[i] === true : false;
          if (!isServed && isInPrep) prepIndices.push(expandedIdx);
          expandedIdx++;
        }
      });
      if (prepIndices.length > 0) {
        handleDrinkSelection(prepIndices);
      }
    }
  }, [collectMode]);

  // Auto-skip selection if only 1 unserved item (non-collect mode)
  useEffect(() => {
    if (!collectMode && unservedCount === 1 && step === 'select') {
      let expandedIdx = 0;
      let found = -1;
      localOrder.items.forEach(item => {
        for (let i = 0; i < item.qty; i++) {
          const isServed = Array.isArray(item.servedUnits) ? item.servedUnits[i] === true : item.served === true;
          const isInPrep = Array.isArray(item.prepUnits) ? item.prepUnits[i] === true : false;
          if (!isServed && !isInPrep && found === -1) found = expandedIdx;
          expandedIdx++;
        }
      });
      if (found >= 0) {
        handleDrinkSelection([found]);
      }
    }
  }, []);

  const generateQRForSelection = async (indices: number[]) => {
    let qrData: string;
    
    if (order._sourceOrders && order._sourceOrders.length > 1) {
      const expandedMap: { sourceOrderId: string; localExpandedIdx: number }[] = [];
      order._sourceOrders.forEach(so => {
        let localIdx = 0;
        so.items.forEach(item => {
          for (let i = 0; i < item.qty; i++) {
            expandedMap.push({ sourceOrderId: so.id, localExpandedIdx: localIdx });
            localIdx++;
          }
        });
      });

      const perOrder: Record<string, number[]> = {};
      indices.forEach(idx => {
        const mapping = expandedMap[idx];
        if (mapping) {
          if (!perOrder[mapping.sourceOrderId]) perOrder[mapping.sourceOrderId] = [];
          perOrder[mapping.sourceOrderId].push(mapping.localExpandedIdx);
        }
      });

      qrData = Object.entries(perOrder)
        .map(([orderId, idxs]) => `${orderId}|${idxs.join(',')}`)
        .join(';');
    } else {
      qrData = `${order.id}|${indices.join(',')}`;
    }

    try {
      const qrDataUrl = await QRCode.toDataURL(qrData, {
        width: 200,
        margin: 2,
        color: { dark: '#1a1a2e', light: '#ffffff' },
      });
      setQrImage(qrDataUrl);
    } catch (err) {
      console.error('Error generating QR:', err);
    }
  };

  const handleDrinkSelection = async (expandedIndices: number[]) => {
    setSelectedExpandedIndices(expandedIndices);
    await generateQRForSelection(expandedIndices);
    setStep('qr');
  };

  const getSelectedItemNames = (): { name: string; count: number }[] => {
    const expandedItems: { name: string }[] = [];
    localOrder.items.forEach(item => {
      for (let i = 0; i < item.qty; i++) {
        expandedItems.push({ name: item.name });
      }
    });
    
    const countMap: Record<string, number> = {};
    selectedExpandedIndices.forEach(idx => {
      const name = expandedItems[idx]?.name || '';
      countMap[name] = (countMap[name] || 0) + 1;
    });
    return Object.entries(countMap).map(([name, count]) => ({ name, count }));
  };

  const pin = localOrder.token?.slice(-4).toUpperCase();

  const copyPin = () => {
    if (pin) {
      navigator.clipboard.writeText(pin);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const getPrepStatusLabel = (status: string) => {
    return t(`clickCollect.status${status.charAt(0).toUpperCase() + status.slice(1)}`) || status;
  };

  const getPrepStatusColor = (status: string) => {
    switch (status) {
      case 'queue': return 'bg-yellow-500 text-white';
      case 'preparing': return 'bg-primary text-primary-foreground';
      case 'ready': return 'bg-green-500 text-white';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const requestPreparation = async () => {
    setRequestingPrep(true);
    try {
      if (localOrder.events?.start_at) {
        const now = nowInParis();
        const eventStart = toParisTime(localOrder.events.start_at);
        const allowedTime = new Date(eventStart.getTime() - 5 * 60 * 1000);
        if (now < allowedTime) {
          toast.error(t('clickCollect.eventNotStarted'));
          return;
        }
      }

      const { error } = await supabase
        .from('orders')
        .update({ prep_requested: true, prep_status: 'queue' })
        .eq('id', localOrder.id);

      if (error) throw error;

      setLocalOrder(prev => ({ ...prev, prep_requested: true, prep_status: 'queue' }));
      toast.success(t('clickCollect.prepRequestSuccess'));
      onOrderUpdate?.();
    } catch (error) {
      console.error('Error requesting preparation:', error);
      toast.error(t('clickCollect.prepRequestError'));
    } finally {
      setRequestingPrep(false);
    }
  };

  // Show selection step (non-collect mode, not all served, multiple unserved items)
  if (step === 'select' && !allServed && unservedCount > 1 && !collectMode) {
    return (
      <DrinkSelectionStep
        items={localOrder.items}
        onConfirm={handleDrinkSelection}
        onClose={onClose}
      />
    );
  }

  // If all served, show message
  if (allServed) {
    return (
      <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 overflow-hidden" onClick={onClose}>
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-background rounded-2xl w-full max-w-md p-6 text-center shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto mb-3" />
          <h3 className="text-lg font-bold mb-2">{t('drinkSelection.allServed')}</h3>
          <p className="text-sm text-muted-foreground mb-4">{t('drinkSelection.allServedDesc')}</p>
          <Button variant="outline" className="w-full h-11" onClick={onClose}>{t('common.close')}</Button>
        </motion.div>
      </div>
    );
  }

  const selectedNames = getSelectedItemNames();

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 overflow-hidden"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-background rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden relative shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button 
          onClick={onClose}
          className="absolute top-3 right-3 z-10 p-2 rounded-full bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex-1 overflow-y-auto p-5 pb-2">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Badge className="bg-primary text-primary-foreground">
              {collectMode ? <Package className="h-3 w-3 mr-1" /> : <Wine className="h-3 w-3 mr-1" />}
              {collectMode ? t('clickCollect.collectOrder') : t('orders.drinkOrder')}
            </Badge>
            {collectMode && localOrder.prep_requested && localOrder.prep_status && (
              <Badge className={getPrepStatusColor(localOrder.prep_status)}>
                {localOrder.prep_status === 'ready' && <CheckCircle2 className="h-3 w-3 mr-1" />}
                {localOrder.prep_status === 'preparing' && <Clock className="h-3 w-3 mr-1 animate-pulse" />}
                {getPrepStatusLabel(localOrder.prep_status)}
              </Badge>
            )}
          </div>

          <h3 className="font-bold text-lg text-center mb-1">
            {localOrder.events?.title || t('orders.drinkOrder')}
          </h3>
          
          {localOrder.events && (
            <p className="text-sm text-muted-foreground text-center mb-1">
              <Calendar className="h-3.5 w-3.5 inline mr-1" />
              {format(new Date(localOrder.events.start_at), 'EEE d MMM', { locale: dateLocale })}
              {' • '}
              <Clock className="h-3.5 w-3.5 inline mr-1" />
              {format(new Date(localOrder.events.start_at), 'HH:mm')} - {format(new Date(localOrder.events.end_at), 'HH:mm')}
            </p>
          )}

          <p className="text-sm text-muted-foreground text-center mb-4">
            {selectedNames.map(s => `${s.count}x ${s.name}`).join(', ')}
          </p>

          <div className="relative mb-3">
            {qrImage ? (
              <div className={`bg-white p-3 rounded-xl flex justify-center mx-auto w-fit border border-border ${clickCollectMode && !localOrder.prep_requested && !collectMode ? 'blur-xl opacity-30' : ''}`}>
                <img src={qrImage} alt="QR Code" className="w-36 h-36 sm:w-44 sm:h-44" />
              </div>
            ) : (
              <div className="h-36 w-36 sm:h-44 sm:w-44 animate-pulse rounded-xl bg-muted mx-auto" />
            )}
            
            {clickCollectMode && !localOrder.prep_requested && !collectMode && (
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="bg-primary text-primary-foreground px-4 py-3 rounded-xl shadow-lg text-center max-w-[200px]">
                  <p className="text-sm font-bold mb-1">{t('clickCollect.modeActive')}</p>
                  <p className="text-xs opacity-90">{t('clickCollect.requestPrepFirst')}</p>
                </div>
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground text-center mb-3">
            {collectMode 
              ? (localOrder.prep_status === 'ready' 
                  ? t('clickCollect.orderReady') 
                  : t('clickCollect.collectAtBar'))
              : t('orders.showQRAtBarDesc')}
          </p>

          {/* Backup PIN */}
          <div className="border-t border-border pt-3 mb-3">
            <p className="text-xs text-muted-foreground text-center mb-1">{t('orders.backupPinLabel')}</p>
            <div className="flex items-center justify-center gap-2">
              <span className="text-xl font-bold tracking-wider">{pin}</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={copyPin}
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
              >
                {copied ? (
                  <CheckCircle className="h-4 w-4 text-emerald-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          <div className="bg-surface border border-border rounded-lg p-3">
            <div className="space-y-1.5">
              {selectedNames.map((s, idx) => (
                <div key={idx} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{s.count}x {s.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="p-4 pt-3 border-t border-border bg-background space-y-2 flex-shrink-0">
          {/* Back to selection (only in QR mode with multiple items) */}
          {!collectMode && unservedCount > 1 && (
            <Button
              variant="outline"
              onClick={() => setStep('select')}
              className="w-full h-11 font-medium"
            >
              {t('drinkSelection.changeSelection')}
            </Button>
          )}

          {/* Request preparation button (only when C&C enabled and non-collect mode) */}
          {clickCollectMode && !collectMode && !localOrder.prep_requested && (
            <Button
              onClick={requestPreparation}
              disabled={requestingPrep || !eventHasStarted}
              className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
            >
              <Clock className="mr-2 h-4 w-4" />
              {requestingPrep 
                ? '...' 
                : !eventHasStarted 
                  ? t('clickCollect.eventNotStartedYet') 
                  : t('clickCollect.requestPrep')}
            </Button>
          )}

          <Button 
            variant="outline" 
            className="w-full h-11 font-medium"
            onClick={onClose}
          >
            {t('common.close')}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
