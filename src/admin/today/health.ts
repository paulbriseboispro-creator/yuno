/** Règles des quatre feux de santé (pures, testées). */
import type { Language } from '@/i18n/data';
import { fmtNum, fmtPct } from '@/lib/adminFormat';
import type { Tone } from '@/admin/ui/tone';
import type { CockpitHealth } from './data';

type T = (k: string, v?: Record<string, string | number>) => string;

export interface Light { key: string; tone: Tone; label: string; value: string }

export function lightsOf(h: CockpitHealth, t: T, lang: Language): Light[] {
  const pay: Light = h.payments_disabled
    ? { key: 'payments', tone: 'negative', label: t('adm.today.h.payments'), value: t('adm.today.h.payments.off') }
    : h.maintenance_mode
      ? { key: 'payments', tone: 'warning', label: t('adm.today.h.payments'), value: t('adm.today.h.payments.maintenance') }
      : { key: 'payments', tone: 'positive', label: t('adm.today.h.payments'), value: t('adm.today.h.payments.ok') };

  const q = h.email_quota;
  const pool = q ? Math.max(1, q.free + q.credits) : 0;
  const share = q ? q.used / pool : 0;
  const email: Light = q
    ? { key: 'email', tone: share >= 0.9 ? 'negative' : share >= 0.75 ? 'warning' : 'positive', label: t('adm.today.h.email'), value: t('adm.today.h.email.used', { pct: fmtPct(share * 100) }) }
    : { key: 'email', tone: 'neutral', label: t('adm.today.h.email'), value: t('adm.today.h.email.unknown') };

  const crons: Light = { key: 'crons', tone: 'neutral', label: t('adm.today.h.crons'), value: t('adm.today.h.crons.n', { n: fmtNum(h.crons_total, lang) }) };

  const crashes = h.app_crashes_7d ?? 0;
  const fails = h.ota_download_fail_7d ?? 0;
  const apps: Light = crashes === 0 && fails <= 10
    ? { key: 'apps', tone: 'positive', label: t('adm.today.h.apps'), value: t('adm.today.h.apps.ok') }
    : { key: 'apps', tone: crashes > 20 ? 'negative' : 'warning', label: t('adm.today.h.apps'), value: t('adm.today.h.apps.crashes', { n: fmtNum(crashes, lang), f: fmtNum(fails, lang) }) };

  return [pay, email, crons, apps];
}

