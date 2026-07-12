import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { Clock, CheckCircle2, Copy, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import { nowInParis, toParisTime } from '@/lib/timezone';
import QRCode from 'qrcode';
import { DrinkSelectionStep } from '@/components/orders/DrinkSelectionStep';
import { OrderQROverlay } from '@/components/orders/TemporalOrders';

/* Palette éditoriale publique (cf. DESIGN_SYSTEM_PUBLIC.md) — mêmes hex que
   TemporalOrders pour que le QR boissons colle pixel-près aux QR billets. */
const RED = '#E8192C';
const CARD = '#141414';
const BORDER_STRONG = 'rgba(255,255,255,0.14)';
const G1 = '#E5E5E5';
const G2 = '#9A9A9A';
const G3 = '#5A5A5E';
const RED_TINT = 'rgba(232,25,44,0.06)';
const RED_SOFT = 'rgba(232,25,44,0.18)';
const PREP_COLORS: Record<string, { fg: string; bg: string; border: string }> = {
  queue: { fg: '#F5B301', bg: 'rgba(245,179,1,0.10)', border: 'rgba(245,179,1,0.30)' },
  preparing: { fg: RED, bg: RED_TINT, border: RED_SOFT },
  ready: { fg: '#10B981', bg: 'rgba(16,185,129,0.10)', border: 'rgba(16,185,129,0.30)' },
};

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
  /** nom du club — affiché dans la carte info de l'overlay (comme les billets) */
  venueName?: string;
  /** affiche de la soirée : fond flouté plein écran derrière le QR */
  posterUrl?: string;
}

export function DrinkOrderDetailModal({
  order,
  clickCollectMode,
  onClose,
  onOrderUpdate,
  collectMode = false,
  venueName,
  posterUrl,
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
        width: 240,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
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
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center p-6 overflow-hidden"
        style={{ background: '#0A0A0A' }}
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="w-full max-w-sm text-center"
          style={{ background: CARD, border: `1px solid ${BORDER_STRONG}`, borderRadius: 12, padding: 28 }}
          onClick={(e) => e.stopPropagation()}
        >
          <CheckCircle2 style={{ width: 44, height: 44, color: '#10B981', margin: '0 auto 14px' }} strokeWidth={2} />
          <h3 className="font-display uppercase" style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-.01em', color: '#fff', marginBottom: 6 }}>
            {t('drinkSelection.allServed')}
          </h3>
          <p style={{ fontSize: 13, color: G2, marginBottom: 18 }}>{t('drinkSelection.allServedDesc')}</p>
          <button
            onClick={onClose}
            className="w-full cursor-pointer font-mono uppercase"
            style={{ padding: 12, borderRadius: 999, background: 'rgba(255,255,255,0.06)', border: `1px solid ${BORDER_STRONG}`, color: G1, fontSize: 11, fontWeight: 600, letterSpacing: '.08em' }}
          >
            {t('common.close')}
          </button>
        </motion.div>
      </div>
    );
  }

  const selectedNames = getSelectedItemNames();

  const labels = {
    scanThisQR: t('orders.scanThisQR'),
    shareThisQR: t('orders.shareThisQR'),
    valid: t('orders.valid'),
    scanned: t('orders.scannedLabel'),
  };

  // Click&Collect : le QR reste masqué tant que la préparation n'a pas été
  // demandée (hors collectMode, où l'on vient justement récupérer une prépa).
  const qrGated = clickCollectMode && !localOrder.prep_requested && !collectMode;

  const whenLabel = localOrder.events?.start_at
    ? format(new Date(localOrder.events.start_at), 'EEE d MMM · HH:mm', { locale: dateLocale }).toUpperCase()
    : undefined;

  const idLabel = selectedNames.map(s => `${s.count}× ${s.name}`).join(' · ');
  const prepColor = localOrder.prep_status ? PREP_COLORS[localOrder.prep_status] : undefined;

  return (
    <OrderQROverlay
      kind="drink"
      title={localOrder.events?.title || t('orders.drinkOrder')}
      venueName={venueName || ''}
      qrImage={qrGated ? undefined : (qrImage || undefined)}
      idLabel={idLabel}
      scanned={false}
      labels={labels}
      onClose={onClose}
      whenLabel={whenLabel}
      posterUrl={posterUrl}
      posterThumb={posterUrl}
      kindLabel={t('orders.kindDrink')}
      footer={
        <div className="space-y-2.5 text-left">
          {/* Statut de préparation (mode récupération Click&Collect) */}
          {collectMode && localOrder.prep_requested && localOrder.prep_status && prepColor && (
            <div
              className="flex items-center justify-center gap-1.5"
              style={{ padding: '8px 12px', borderRadius: 8, background: prepColor.bg, border: `1px solid ${prepColor.border}` }}
            >
              {localOrder.prep_status === 'ready' && <CheckCircle2 style={{ width: 13, height: 13, color: prepColor.fg }} strokeWidth={2} />}
              {localOrder.prep_status === 'preparing' && <Clock className="animate-pulse" style={{ width: 13, height: 13, color: prepColor.fg }} strokeWidth={2} />}
              <span className="font-mono uppercase" style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.1em', color: prepColor.fg }}>
                {getPrepStatusLabel(localOrder.prep_status)}
              </span>
            </div>
          )}

          {/* Click&Collect : demander la prépa avant que le QR n'apparaisse */}
          {qrGated && (
            <div style={{ padding: '12px 13px', borderRadius: 8, background: RED_TINT, border: `1px solid ${RED_SOFT}` }}>
              <p className="font-mono uppercase text-center" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', color: RED, marginBottom: 3 }}>
                {t('clickCollect.modeActive')}
              </p>
              <p className="text-center" style={{ fontSize: 11.5, color: G2, marginBottom: 10 }}>
                {t('clickCollect.requestPrepFirst')}
              </p>
              <button
                onClick={requestPreparation}
                disabled={requestingPrep || !eventHasStarted}
                className="w-full flex items-center justify-center gap-2 cursor-pointer font-mono font-bold uppercase disabled:opacity-50"
                style={{ padding: '11px 12px', background: RED, color: '#fff', fontSize: 11, letterSpacing: '.1em', borderRadius: 3, border: 'none' }}
              >
                <Clock style={{ width: 14, height: 14 }} strokeWidth={2} />
                {requestingPrep ? '...' : !eventHasStarted ? t('clickCollect.eventNotStartedYet') : t('clickCollect.requestPrep')}
              </button>
            </div>
          )}

          {/* PIN de secours */}
          <div
            className="flex items-center justify-between"
            style={{ padding: '10px 13px', borderRadius: 8, background: CARD, border: `1px solid ${BORDER_STRONG}` }}
          >
            <span className="font-mono uppercase" style={{ fontSize: 9.5, letterSpacing: '.06em', color: G2 }}>{t('orders.backupPinLabel')}</span>
            <div className="flex items-center gap-2">
              <span className="font-mono" style={{ fontSize: 15, fontWeight: 700, letterSpacing: '.2em', color: '#fff' }}>{pin}</span>
              <button
                onClick={copyPin}
                className="grid place-items-center cursor-pointer"
                style={{ width: 26, height: 26, borderRadius: 6, background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDER_STRONG}` }}
              >
                {copied ? <CheckCircle style={{ width: 13, height: 13, color: '#10B981' }} /> : <Copy style={{ width: 13, height: 13, color: G2 }} />}
              </button>
            </div>
          </div>

          {/* Détail de la commande */}
          <div style={{ padding: '10px 13px', borderRadius: 8, background: CARD, border: `1px solid ${BORDER_STRONG}` }}>
            <div className="space-y-1.5">
              {selectedNames.map((s, idx) => (
                <div key={idx} className="flex justify-between">
                  <span className="font-mono uppercase" style={{ fontSize: 11.5, letterSpacing: '.04em', color: G1 }}>{s.count}× {s.name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Consigne bar */}
          {!qrGated && (
            <p className="font-mono uppercase text-center" style={{ fontSize: 9, letterSpacing: '.1em', color: G3, paddingTop: 2 }}>
              {collectMode
                ? (localOrder.prep_status === 'ready' ? t('clickCollect.orderReady') : t('clickCollect.collectAtBar'))
                : t('orders.showQRAtBarDesc')}
            </p>
          )}

          {/* Changer la sélection */}
          {!collectMode && unservedCount > 1 && (
            <button
              onClick={() => setStep('select')}
              className="w-full flex items-center justify-center gap-2 cursor-pointer font-mono uppercase"
              style={{ padding: 11, borderRadius: 999, background: 'rgba(255,255,255,0.06)', border: `1px solid ${BORDER_STRONG}`, color: G1, fontSize: 11, fontWeight: 600, letterSpacing: '.08em' }}
            >
              {t('drinkSelection.changeSelection')}
            </button>
          )}
        </div>
      }
    />
  );
}
