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

// SelectGroup is a semantic wrapper with no styling of its own: it reads as
// nothing outside an open panel. Shown as the full composition so the grouping
// it creates — label + rows, separated from the next block — is visible.

export const Ouvert = () => (
  <div style={{ width: 260, height: 280 }}>
    <Select defaultOpen defaultValue="6">
      <SelectTrigger>
        <SelectValue placeholder="Formule table" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Carré VIP</SelectLabel>
          <SelectItem value="4">4 pers. — dès 300 €</SelectItem>
          <SelectItem value="6">6 pers. — dès 450 €</SelectItem>
          <SelectItem value="8">8 pers. — dès 600 €</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Grande table</SelectLabel>
          <SelectItem value="12">12 pers. — sur demande</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  </div>
);

export const GroupesParPays = () => (
  <div style={{ width: 260, height: 280 }}>
    <Select defaultOpen defaultValue="ibiza">
      <SelectTrigger>
        <SelectValue placeholder="Ville" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Espagne</SelectLabel>
          <SelectItem value="madrid">Madrid</SelectItem>
          <SelectItem value="ibiza">Ibiza</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>France</SelectLabel>
          <SelectItem value="paris">Paris</SelectItem>
          <SelectItem value="marseille">Marseille</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  </div>
);

export const GroupeUnique = () => (
  <div style={{ width: 260, height: 280 }}>
    <Select defaultOpen defaultValue="2">
      <SelectTrigger>
        <SelectValue placeholder="Quantité" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Billets — Round 2</SelectLabel>
          <SelectItem value="1">1 billet — 20 €</SelectItem>
          <SelectItem value="2">2 billets — 40 €</SelectItem>
          <SelectItem value="4">4 billets — 80 €</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  </div>
);
