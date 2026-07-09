import { useEffect, useState } from 'react';
import { Wifi, WifiOff } from 'lucide-react';

/**
 * Pilule d'état réseau de l'app Yuno Pro. Version P2 : online/offline.
 * La Phase 3 (scan offline) l'étend avec l'âge du manifeste et le compteur
 * de scans en attente via useOfflineScanning.
 */
export function useNetworkStatus(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function OfflinePill({ label }: { label?: string }) {
  const online = useNetworkStatus();

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
      style={{
        background: online ? 'rgba(52,211,153,0.10)' : 'rgba(232,25,44,0.12)',
        border: `1px solid ${online ? 'rgba(52,211,153,0.25)' : 'rgba(232,25,44,0.35)'}`,
        color: online ? '#34D399' : '#E8192C',
      }}
    >
      {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
      {label}
    </span>
  );
}
