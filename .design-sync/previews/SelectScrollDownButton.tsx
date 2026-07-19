import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'yuno-design-system';

// Mirror image of SelectScrollUpButton: Radix only paints the down chevron when
// there is more list below the fold. Long list, position="item-aligned", and a
// defaultValue at the TOP so the panel opens unscrolled with the rest to come.

const CRENEAUX = [
  ['2300', '23:00'],
  ['2330', '23:30'],
  ['0000', '00:00'],
  ['0030', '00:30'],
  ['0100', '01:00'],
  ['0130', '01:30'],
  ['0200', '02:00'],
  ['0230', '02:30'],
  ['0300', '03:00'],
  ['0330', '03:30'],
  ['0400', '04:00'],
  ['0430', '04:30'],
  ['0500', '05:00'],
  ['0530', '05:30'],
  ['0600', '06:00'],
];

export const Ouvert = () => (
  <div style={{ width: 260, height: 300 }}>
    <Select defaultOpen defaultValue="2300">
      <SelectTrigger>
        <SelectValue placeholder="Heure d'arrivée" />
      </SelectTrigger>
      <SelectContent position="item-aligned">
        {CRENEAUX.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);

export const QuantiteDeBillets = () => (
  <div style={{ width: 260, height: 300 }}>
    <Select defaultOpen defaultValue="1">
      <SelectTrigger>
        <SelectValue placeholder="Nombre de billets" />
      </SelectTrigger>
      <SelectContent position="item-aligned">
        {Array.from({ length: 12 }).map((_, i) => (
          <SelectItem key={i + 1} value={String(i + 1)}>
            {i + 1} billet{i > 0 ? 's' : ''} — {(i + 1) * 20},00 €
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);
