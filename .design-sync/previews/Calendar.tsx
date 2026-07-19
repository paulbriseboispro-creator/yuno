import { Calendar } from 'yuno-design-system';

// Fixed dates only: a Date.now()-derived month would re-key the capture on every
// run and clear the grade. June 2026 is deliberate — it lays out on 5 week rows,
// so the whole month fits the 420x420 card without clipping.
const JUIN_2026 = new Date('2026-06-01T00:00:00.000Z');
const SAMEDI_13 = new Date('2026-06-13T00:00:00.000Z');
const VENDREDI_12 = new Date('2026-06-12T00:00:00.000Z');
const DIMANCHE_14 = new Date('2026-06-14T00:00:00.000Z');

export const SoireeChoisie = () => (
  <Calendar mode="single" defaultMonth={JUIN_2026} selected={SAMEDI_13} onSelect={() => {}} />
);

export const WeekEnd = () => (
  <Calendar
    mode="range"
    defaultMonth={JUIN_2026}
    selected={{ from: VENDREDI_12, to: DIMANCHE_14 }}
    onSelect={() => {}}
  />
);

// Explore never sells a night that has already happened — past days come back
// disabled from the same picker.
export const SoireesPassees = () => (
  <Calendar
    mode="single"
    defaultMonth={JUIN_2026}
    selected={SAMEDI_13}
    disabled={{ before: new Date('2026-06-10T00:00:00.000Z') }}
    onSelect={() => {}}
  />
);
