import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from 'yuno-design-system';

export const Ville = () => (
  <div style={{ width: 260 }}>
    <Select defaultValue="madrid">
      <SelectTrigger>
        <SelectValue placeholder="Choisir une ville" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="madrid">Madrid</SelectItem>
        <SelectItem value="barcelone">Barcelone</SelectItem>
        <SelectItem value="paris">Paris</SelectItem>
        <SelectItem value="ibiza">Ibiza</SelectItem>
      </SelectContent>
    </Select>
  </div>
);

export const TailleDeTable = () => (
  <div style={{ width: 260 }}>
    <Select defaultValue="6">
      <SelectTrigger>
        <SelectValue placeholder="Nombre de personnes" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Carré VIP</SelectLabel>
          <SelectItem value="4">4 personnes — dès 300 €</SelectItem>
          <SelectItem value="6">6 personnes — dès 450 €</SelectItem>
          <SelectItem value="8">8 personnes — dès 600 €</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Grande table</SelectLabel>
          <SelectItem value="12">12 personnes — sur demande</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  </div>
);

// Radix mounts SelectContent in a portal only while open, so without an
// explicitly-open story the panel styling never appears on any card. Paired
// with cardMode:"single" + a tall viewport in config so the portal renders
// inside the card instead of escaping it.
export const Ouvert = () => (
  <div style={{ width: 260, height: 280 }}>
    <Select defaultOpen defaultValue="techno">
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

export const Desactive = () => (
  <div style={{ width: 260 }}>
    <Select disabled>
      <SelectTrigger>
        <SelectValue placeholder="Complet ce soir" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="x">—</SelectItem>
      </SelectContent>
    </Select>
  </div>
);
