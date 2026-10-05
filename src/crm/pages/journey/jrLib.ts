/**
 * Fonctions pures et crochets du Parcours client : tracés d'icônes du
 * prototype, formats de pourcentage et de durée, progression d'animation,
 * apparition au défilement, et les règles de lecture partagées par les
 * sections (période d'avant, plus grosse perte, conversion d'une campagne).
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { EASE, prefersReducedMotion } from '@/crm/ui/motion';
import type { useCrmT } from '@/crm/i18n';
import type { JrCampaign, JrFilters, Journey } from '@/crm/data/journey';

type T = ReturnType<typeof useCrmT>;

/** Tracés Lucide du prototype (Parcours client.dc.html). */
export const JR_IC = {
  send: 'm22 2-7 20-4-9-9-4ZM22 2 11 13',
  eye: 'M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  click: 'M14 4.1 12 6M5.1 8l-2.9-.8M6 12l-1.9 2M7.2 2.2 8 5.1M9.04 9.69a.5.5 0 0 1 .65-.65l11 4.5a.5.5 0 0 1-.07.95l-4.35 1.04a1 1 0 0 0-.74.74l-1.04 4.35a.5.5 0 0 1-.95.07z',
  card: 'M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zM2 10h20',
  ticket: 'M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2ZM13 5v2M13 17v2M13 11v2',
  repeat: 'm17 2 4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3',
  mail: 'M2 7l10 6 10-6M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  sms: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  instagram: 'M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zM16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37zM17.5 6.5h.01',
  zap: 'M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z',
  x: 'M18 6 6 18M6 6l12 12',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  check: 'M5 12l5 5L20 7',
  arrow: 'M5 12h14M13 6l6 6-6 6',
} as const;

/** Les cinq étapes : Reçu, Ouvert, Clic, Achat, Retour. */
export const STEP_IC = [JR_IC.send, JR_IC.eye, JR_IC.click, JR_IC.card, JR_IC.repeat];

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Pourcentage du prototype : entier dès 10 %, une décimale en dessous. */
export function pc(T: T, ratio: number): string {
  const v = ratio * 100;
  return T.pct(v, v < 10 ? 1 : 0);
}

/** Délai en heures → « 6 h » ou « 1,2 j » (tuiles, délai médian). */
export function durShort(T: T, hours: number): string {
  if (hours < 24) return T.t('yc.jr.dur.h', { n: Math.max(1, Math.round(hours)) });
  const d = Math.round((hours / 24) * 10) / 10;
  return T.t('yc.jr.dur.d', { n: Number.isInteger(d) ? String(d) : T.n1(d) });
}

/** Écart entre deux instants → « 27 min », « 3 h », « 2 jours ». */
export function spanLabel(T: T, ms: number): string {
  const min = Math.max(0, ms) / 60000;
  if (min < 60) return T.t('yc.jr.span.min', { n: Math.max(1, Math.round(min)) });
  if (min < 60 * 24) return T.t('yc.jr.span.h', { n: Math.round(min / 60) });
  return T.tp('yc.jr.span.d', Math.round(min / 1440));
}

/** Écart entre deux pas du fil → « +27 min », « +3 h », « +2 jours ». */
export function gapLabel(T: T, ms: number): string {
  const min = Math.max(0, ms) / 60000;
  if (min < 60) return T.t('yc.jr.gap.min', { n: Math.max(1, Math.round(min)) });
  if (min < 60 * 24) return T.t('yc.jr.gap.h', { n: Math.round(min / 60) });
  return T.tp('yc.jr.gap.d', Math.round(min / 1440));
}

/**
 * Progression 0 → 1 (ease-out cubique) rejouée à chaque `key`, une fois
 * `ready` : la première fois sur `dur0` ms après `delay0` ms (entrée de la
 * page), ensuite sur `dur1` après `delay1` (nouveau filtre), comme le
 * prototype.
 */
export function useStaged(key: string, ready: boolean, dur0: number, delay0: number, dur1: number, delay1: number): number {
  const [p, setP] = useState(() => (prefersReducedMotion() ? 1 : 0));
  const ran = useRef(false);
  useEffect(() => {
    if (!ready) return;
    if (prefersReducedMotion()) { setP(1); return; }
    const dur = ran.current ? dur1 : dur0;
    const t0 = performance.now() + (ran.current ? delay1 : delay0);
    ran.current = true;
    setP(0);
    let raf = 0;
    const step = (now: number) => {
      const x = Math.max(0, Math.min(1, (now - t0) / dur));
      setP(1 - Math.pow(1 - x, 3));
      if (x < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [key, ready, dur0, delay0, dur1, delay1]);
  return p;
}

/** Vrai dès que l'élément entre à 15 % dans l'écran (une seule fois). */
export function useInViewOnce(ref: RefObject<Element>, ready: boolean): boolean {
  const [seen, setSeen] = useState(() => prefersReducedMotion());
  useEffect(() => {
    if (seen || !ready || !ref.current) return;
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return; }
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { threshold: 0.15 });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [ref, ready, seen]);
  return seen;
}

/** Apparition au défilement : montée de 24 px et flou de 8 px. */
export function scrollIn(on: boolean): CSSProperties {
  return {
    opacity: on ? 1 : 0,
    transform: on ? 'none' : 'translateY(24px)',
    filter: on ? 'none' : 'blur(8px)',
    transition: `opacity 700ms ${EASE},transform 800ms ${EASE},filter 700ms ${EASE}`,
  };
}

/** La période d'avant n'existe ni en 12 mois, ni pour une campagne, ni à vide. */
export function hasPrevious(d: Journey, f: JrFilters): boolean {
  return f.cmp && !f.campaign && d.days <= 90 && !!d.prev && d.prev[0] > 0;
}

/** Étape où l'on perd le plus (entre les trois premières), comme le prototype. */
export function biggestLoss(S: number[]): number {
  const loss = [0, 1, 2, 3].map((k) => (S[k] ? 1 - S[k + 1] / S[k] : 0));
  let big = 0;
  [1, 2].forEach((k) => { if (loss[k] > loss[big]) big = k; });
  return big;
}

/** Conversion d'une campagne : acheteurs ÷ destinataires. */
export const campConv = (c: JrCampaign) => (c.received ? c.buyers / c.received : 0);

/** Moyenne des campagnes affichées : acheteurs ÷ destinataires, toutes confondues. */
export function avgConvOf(list: JrCampaign[]): number {
  const rc = list.reduce((a, c) => a + c.received, 0);
  return rc ? list.reduce((a, c) => a + c.buyers, 0) / rc : 0;
}
