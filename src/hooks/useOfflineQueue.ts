import { useState, useEffect, useCallback, useRef } from 'react';

interface QueuedAction {
  id: string;
  action: string;
  payload: any;
  timestamp: number;
}

const QUEUE_KEY = 'yuno_offline_queue';

function loadQueue(): QueuedAction[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch { return []; }
}

function saveQueue(queue: QueuedAction[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

/**
 * Offline queue for critical staff operations.
 * Stores actions in localStorage when offline and replays them when back online.
 */
export function useOfflineQueue(
  processor: (action: QueuedAction) => Promise<boolean>
) {
  const [pendingCount, setPendingCount] = useState(() => loadQueue().length);
  const [syncing, setSyncing] = useState(false);
  const processorRef = useRef(processor);
  processorRef.current = processor;

  const enqueue = useCallback((action: string, payload: any) => {
    const queue = loadQueue();
    queue.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      action,
      payload,
      timestamp: Date.now(),
    });
    saveQueue(queue);
    setPendingCount(queue.length);
  }, []);

  const processQueue = useCallback(async () => {
    if (syncing || !navigator.onLine) return;
    const queue = loadQueue();
    if (queue.length === 0) return;

    setSyncing(true);
    const remaining: QueuedAction[] = [];

    for (const item of queue) {
      try {
        const success = await processorRef.current(item);
        if (!success) remaining.push(item);
      } catch {
        remaining.push(item);
      }
    }

    saveQueue(remaining);
    setPendingCount(remaining.length);
    setSyncing(false);
  }, [syncing]);

  // Process queue when coming back online
  useEffect(() => {
    const handler = () => processQueue();
    window.addEventListener('online', handler);
    // Also try on mount
    if (navigator.onLine) processQueue();
    return () => window.removeEventListener('online', handler);
  }, [processQueue]);

  return { enqueue, pendingCount, syncing, processQueue };
}
