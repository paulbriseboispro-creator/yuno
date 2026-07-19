import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'yuno-design-system';

// SelectValue renders nothing on its own — it reads the chosen item from the
// Select root's context. Written as the full composition so the card shows the
// two things it does: echo the selection, and fall back to the placeholder.

export const Ouvert = () => (
  <div style={{ width: 260, height: 280 }}>
    <Select defaultOpen defaultValue="6">
      <SelectTrigger>
        <SelectValue placeholder="Taille de table" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="4">4 personnes</SelectItem>
        <SelectItem value="6">6 personnes</SelectItem>
        <SelectItem value="8">8 personnes</SelectItem>
        <SelectItem value="12">12 personnes</SelectItem>
      </SelectContent>
    </Select>
  </div>
);

export const ValeurChoisie = () => (
  <div style={{ width: 260 }}>
    <Select defaultValue="6">
      <SelectTrigger>
        <SelectValue placeholder="Taille de table" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="6">6 personnes</SelectItem>
      </SelectContent>
    </Select>
  </div>
);

export const PlaceholderSeul = () => (
  <div style={{ width: 260 }}>
    <Select>
      <SelectTrigger>
        <SelectValue placeholder="Taille de table" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="6">6 personnes</SelectItem>
      </SelectContent>
    </Select>
  </div>
);

// [&>span]:line-clamp-1 on the trigger clamps a long label to one line.
export const ValeurLongue = () => (
  <div style={{ width: 260 }}>
    <Select defaultValue="magnum">
      <SelectTrigger>
        <SelectValue placeholder="Pack bouteille" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="magnum">
          Magnum Belvedere + 4 mixers — 6 personnes — dès 450 €
        </SelectItem>
      </SelectContent>
    </Select>
  </div>
);
