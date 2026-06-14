/// <reference lib="webworker" />

// Extend ServiceWorkerRegistration to include pushManager
interface PushManagerExtended {
  getSubscription(): Promise<PushSubscription | null>;
  subscribe(options: PushSubscriptionOptionsInit): Promise<PushSubscription>;
}

interface ServiceWorkerRegistrationExtended extends ServiceWorkerRegistration {
  pushManager: PushManagerExtended;
}

declare global {
  interface PushSubscriptionOptionsInit {
    userVisibleOnly?: boolean;
    applicationServerKey?: ArrayBuffer | Uint8Array | string | null;
  }
}

export {};
