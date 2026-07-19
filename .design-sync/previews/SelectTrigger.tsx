import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'yuno-design-system';

// SelectTrigger only exists as the visible face of a Select, so every story is
// the complete parent composition. Radix mounts the panel in a portal only
// while open — the defaultOpen story comes FIRST so the card's single render
// shows the trigger together with what it controls.

export const Ouvert = () => (
  <div style={{ width: 260, height: 280 }}>
    <Select defaultOpen defaultValue="madrid">
      <SelectTrigger>
        <SelectValue placeholder="Choisir une ville" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="madrid">Madrid</SelectItem>
        <SelectItem value="barcelone">Barcelone</SelectItem>
        <SelectItem value="ibiza">Ibiza</SelectItem>
        <SelectItem value="valence">Valence</SelectItem>
      </SelectContent>
    </Select>
  </div>
);

export const Ferme = () => (
  <div style={{ width: 260 }}>
    <Select defaultValue="ibiza">
      <SelectTrigger>
        <SelectValue placeholder="Choisir une ville" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="madrid">Madrid</SelectItem>
        <SelectItem value="ibiza">Ibiza</SelectItem>
      </SelectContent>
    </Select>
  </div>
);

export const Placeholder = () => (
  <div style={{ width: 260 }}>
    <Select>
      <SelectTrigger>
        <SelectValue placeholder="Nombre de billets" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="1">1 billet</SelectItem>
        <SelectItem value="2">2 billets</SelectItem>
      </SelectContent>
    </Select>
  </div>
);

export const Desactive = () => (
  <div style={{ width: 260 }}>
    <Select disabled defaultValue="complet">
      <SelectTrigger>
        <SelectValue placeholder="Round de billetterie" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="complet">Round 1 — complet</SelectItem>
      </SelectContent>
    </Select>
  </div>
);
