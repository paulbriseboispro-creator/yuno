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

// SelectContent is the portalled panel: it is only mounted while the Select is
// open, so an un-opened story shows nothing at all. Every story here is
// defaultOpen and sized to keep the panel inside the card.

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

export const OuvertAvecGroupes = () => (
  <div style={{ width: 260, height: 280 }}>
    <Select defaultOpen defaultValue="6">
      <SelectTrigger>
        <SelectValue placeholder="Table VIP" />
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

// Default position="popper": the panel hangs under the trigger and caps itself
// at --radix-select-content-available-height, so a long list scrolls inside the
// panel instead of covering the field it belongs to.
export const OuvertListeLongue = () => (
  <div style={{ width: 260, height: 280 }}>
    <Select defaultOpen defaultValue="2300">
      <SelectTrigger>
        <SelectValue placeholder="Heure d'arrivée" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="2300">23:00</SelectItem>
        <SelectItem value="2330">23:30</SelectItem>
        <SelectItem value="0000">00:00</SelectItem>
        <SelectItem value="0030">00:30</SelectItem>
        <SelectItem value="0100">01:00</SelectItem>
        <SelectItem value="0130">01:30</SelectItem>
        <SelectItem value="0200">02:00</SelectItem>
        <SelectItem value="0230">02:30</SelectItem>
        <SelectItem value="0300">03:00</SelectItem>
        <SelectItem value="0330">03:30</SelectItem>
        <SelectItem value="0400">04:00</SelectItem>
      </SelectContent>
    </Select>
  </div>
);
