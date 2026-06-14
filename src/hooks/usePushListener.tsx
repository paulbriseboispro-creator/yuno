import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

/**
 * Listens for push messages forwarded from the service worker via postMessage.
 * Prevents duplicate in-app toasts when push is already displayed as a native notification.
 */
export function usePushListener() {
  const recentPushIds = useRef(new Set<string>());

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'PUSH_RECEIVED') {
        const payload = event.data.payload;
        const dedupKey = `${payload.title}:${payload.body}`;
        
        // Mark this push as received so we can skip duplicate toasts
        recentPushIds.current.add(dedupKey);
        
        // Auto-cleanup after 30s
        setTimeout(() => recentPushIds.current.delete(dedupKey), 30000);
      }
    };

    navigator.serviceWorker?.addEventListener('message', handler);
    return () => navigator.serviceWorker?.removeEventListener('message', handler);
  }, []);

  /**
   * Show a toast ONLY if no push notification was recently received with the same content.
   * This is the fallback mechanism: push first, toast only if push unavailable.
   */
  const showFallbackToast = (title: string, body: string) => {
    const dedupKey = `${title}:${body}`;
    
    // If we already received this as a push, skip the toast
    if (recentPushIds.current.has(dedupKey)) {
      return;
    }
    
    toast(title, { description: body });
  };

  return { showFallbackToast };
}
