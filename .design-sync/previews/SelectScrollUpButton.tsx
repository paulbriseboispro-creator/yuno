import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'yuno-design-system';

// SelectContent always renders a SelectScrollUpButton, but Radix only shows it
// when the viewport is scrolled away from the top. So: a list long enough to
// overflow, position="item-aligned" (the mode that opens on the selected row),
// and a defaultValue near the END — the panel opens scrolled down and the up
// chevron is on screen. Anything shorter renders an empty card.

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
    <Select defaultOpen defaultValue="0530">
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

export const ListeDeClubs = () => (
  <div style={{ width: 260, height: 300 }}>
    <Select defaultOpen defaultValue="teatro">
      <SelectTrigger>
        <SelectValue placeholder="Club" />
      </SelectTrigger>
      <SelectContent position="item-aligned">
        <SelectItem value="mirador">Sala Mirador</SelectItem>
        <SelectItem value="azotea">Azotea Círculo</SelectItem>
        <SelectItem value="berlin">Café Berlín</SelectItem>
        <SelectItem value="fabrik">Fabrik</SelectItem>
        <SelectItem value="mondo">Mondo Disko</SelectItem>
        <SelectItem value="goya">Sala Goya</SelectItem>
        <SelectItem value="kapital">Teatro Kapital</SelectItem>
        <SelectItem value="siroco">Siroco</SelectItem>
        <SelectItem value="ocho">Ochoymedio</SelectItem>
        <SelectItem value="teatro">Teatro Barceló</SelectItem>
      </SelectContent>
    </Select>
  </div>
);
