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

// A 1px rule inside a portalled panel: invisible unless the Select is open and
// there is something on either side of it. Every story opens the panel and puts
// two real blocks around the rule.

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

export const DeuxSeparateurs = () => (
  <div style={{ width: 260, height: 280 }}>
    <Select defaultOpen defaultValue="barcelone">
      <SelectTrigger>
        <SelectValue placeholder="Ville" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="madrid">Madrid</SelectItem>
        <SelectSeparator />
        <SelectItem value="barcelone">Barcelone</SelectItem>
        <SelectSeparator />
        <SelectItem value="ibiza">Ibiza</SelectItem>
      </SelectContent>
    </Select>
  </div>
);

// Rouge #E8192C est le seul accent systémique — un filet accentué sépare les
// rounds en vente de ceux qui sont clos.
export const SeparateurAccent = () => (
  <div style={{ width: 260, height: 280 }}>
    <Select defaultOpen defaultValue="round2">
      <SelectTrigger>
        <SelectValue placeholder="Round de billetterie" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="round2">Round 2 — 20 €</SelectItem>
        <SelectItem value="round3">Round 3 — 25 €</SelectItem>
        <SelectSeparator className="bg-[#E8192C]" />
        <SelectItem value="round1" disabled>
          Round 1 — complet
        </SelectItem>
      </SelectContent>
    </Select>
  </div>
);
