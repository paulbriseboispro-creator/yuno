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

// SelectLabel is the heading of a SelectGroup and lives inside the portalled
// panel: only an open Select renders it. Each story is the whole composition.

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

// Public metadata is JetBrains Mono uppercase tracked (DESIGN_SYSTEM_PUBLIC
// §3.4) — the group heading is exactly that kind of label.
export const LabelMonoTracke = () => (
  <div style={{ width: 260, height: 280 }}>
    <Select defaultOpen defaultValue="techno">
      <SelectTrigger>
        <SelectValue placeholder="Genre musical" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel className="font-mono uppercase text-[10px] tracking-[0.14em] text-[#5A5A5E]">
            Ce soir à Madrid
          </SelectLabel>
          <SelectItem value="techno">Techno</SelectItem>
          <SelectItem value="house">House</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel className="font-mono uppercase text-[10px] tracking-[0.14em] text-[#5A5A5E]">
            Ce week-end
          </SelectLabel>
          <SelectItem value="reggaeton">Reggaeton</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  </div>
);

export const LabelUnique = () => (
  <div style={{ width: 260, height: 280 }}>
    <Select defaultOpen defaultValue="0100">
      <SelectTrigger>
        <SelectValue placeholder="Heure d'arrivée" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Heure d'arrivée</SelectLabel>
          <SelectItem value="2330">23:30</SelectItem>
          <SelectItem value="0000">00:00</SelectItem>
          <SelectItem value="0100">01:00</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  </div>
);
