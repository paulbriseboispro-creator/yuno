import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'yuno-design-system';

// An item lives inside the portalled panel, so it is only visible while the
// Select is open. Each story is the full composition, opened, so the card shows
// the check indicator on the selected row and the dimmed disabled row.

export const Ouvert = () => (
  <div style={{ width: 260, height: 280 }}>
    <Select defaultOpen defaultValue="house">
      <SelectTrigger>
        <SelectValue placeholder="Genre musical" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="techno">Techno</SelectItem>
        <SelectItem value="house">House</SelectItem>
        <SelectItem value="reggaeton">Reggaeton</SelectItem>
        <SelectItem value="afro">Afro House</SelectItem>
      </SelectContent>
    </Select>
  </div>
);

export const ItemIndisponible = () => (
  <div style={{ width: 260, height: 280 }}>
    <Select defaultOpen defaultValue="round2">
      <SelectTrigger>
        <SelectValue placeholder="Round de billetterie" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="round1" disabled>
          Round 1 — 15 € — complet
        </SelectItem>
        <SelectItem value="round2">Round 2 — 20 €</SelectItem>
        <SelectItem value="round3">Round 3 — 25 €</SelectItem>
        <SelectItem value="porte" disabled>
          Sur place — 30 € — non vendu ici
        </SelectItem>
      </SelectContent>
    </Select>
  </div>
);

export const ItemsLongs = () => (
  <div style={{ width: 260, height: 280 }}>
    <Select defaultOpen defaultValue="magnum">
      <SelectTrigger>
        <SelectValue placeholder="Pack bouteille" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="std">Belvedere 70 cl + 4 mixers</SelectItem>
        <SelectItem value="magnum">Magnum Belvedere + 8 mixers</SelectItem>
        <SelectItem value="moet">Moët Impérial + coupes</SelectItem>
      </SelectContent>
    </Select>
  </div>
);
