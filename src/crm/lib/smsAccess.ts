/**
 * SMS en bêta privée (2026-10-19) : les règles pures de la demande d'accès,
 * partagées par la Console et testées. Les lectures vivent dans
 * src/crm/data/smsAccess.ts (`useSmsAccess`).
 */
export type SmsAccessStatus = 'none' | 'requested' | 'granted' | 'declined';
export type SmsUseCase = 'announce' | 'last_call' | 'practical' | 'comeback';
export type SmsVolume = 'lt500' | 'lt2k' | 'lt10k' | 'gt10k' | 'unknown';

export const SMS_USE_CASES: readonly SmsUseCase[] = ['announce', 'last_call', 'practical', 'comeback'];
export const SMS_VOLUMES: readonly SmsVolume[] = ['lt500', 'lt2k', 'lt10k', 'gt10k', 'unknown'];

export interface SmsAccess {
  status: SmsAccessStatus;
  requested_at?: string | null;
  decided_at?: string | null;
  use_cases?: string[];
  volume?: SmsVolume | null;
  sender_wish?: string | null;
}

export interface SmsAccessRequest {
  useCases: SmsUseCase[];
  volume: SmsVolume;
  senderWish: string;
  note: string;
}

/** Étapes de l'ouverture, dans l'ordre où le pro les vit. */
export type SmsAccessStep = 'request' | 'check' | 'line' | 'first';
export type SmsStepState = 'done' | 'now' | 'next';

/** Où en est l'ouverture du compte : pure, testée. */
export function smsAccessSteps(status: SmsAccessStatus): Record<SmsAccessStep, SmsStepState> {
  if (status === 'granted') return { request: 'done', check: 'done', line: 'done', first: 'now' };
  if (status === 'requested') return { request: 'done', check: 'now', line: 'next', first: 'next' };
  return { request: 'now', check: 'next', line: 'next', first: 'next' };
}
