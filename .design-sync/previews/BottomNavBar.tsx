import { BottomNavBar } from 'yuno-design-system';
import { Building2, Heart, Search, ShoppingBag, User } from 'lucide-react';

// Primitive de présentation : elle ne lit aucun contexte, on lui passe les items
// tels que `BottomNav` les construit côté public.
const noop = () => {};

const shell: React.CSSProperties = {
  background: '#0A0A0A',
  padding: '14px 12px',
  display: 'flex',
  justifyContent: 'center',
};

// Les cinq destinations publiques, Explorer actif (l'écran d'accueil).
export const NavigationPublique = () => (
  <div style={{ ...shell, width: 460 }}>
    <BottomNavBar
      items={[
        { key: 'explore', label: 'Explorer', icon: Search, isActive: true, onSelect: noop },
        { key: 'favorites', label: 'Favoris', icon: Heart, isActive: false, onSelect: noop },
        { key: 'club', label: 'Club', icon: Building2, isActive: false, onSelect: noop },
        { key: 'orders', label: 'Commandes', icon: ShoppingBag, isActive: false, onSelect: noop },
        { key: 'profile', label: 'Profil', icon: User, isActive: false, onSelect: noop },
      ]}
    />
  </div>
);

// Onglet Club actif, avec le point rouge du mode Live (soirée en cours au club).
export const ClubActifEnLive = () => (
  <div style={{ ...shell, width: 460 }}>
    <BottomNavBar
      items={[
        { key: 'explore', label: 'Explorer', icon: Search, isActive: false, onSelect: noop },
        { key: 'favorites', label: 'Favoris', icon: Heart, isActive: false, onSelect: noop },
        {
          key: 'club',
          label: 'Club',
          icon: Building2,
          isActive: true,
          onSelect: noop,
          dot: true,
        },
        { key: 'orders', label: 'Commandes', icon: ShoppingBag, isActive: false, onSelect: noop },
        { key: 'profile', label: 'Profil', icon: User, isActive: false, onSelect: noop },
      ]}
    />
  </div>
);

// Libellé long : l'onglet actif ouvre son label vers la droite, la pilule
// s'allonge sans faire déborder les autres.
export const LibelleLongActif = () => (
  <div style={{ ...shell, width: 460 }}>
    <BottomNavBar
      items={[
        { key: 'explore', label: 'Explorer', icon: Search, isActive: false, onSelect: noop },
        { key: 'favorites', label: 'Favoris', icon: Heart, isActive: false, onSelect: noop },
        { key: 'club', label: 'Club', icon: Building2, isActive: false, onSelect: noop },
        { key: 'orders', label: 'Commandes', icon: ShoppingBag, isActive: true, onSelect: noop },
        { key: 'profile', label: 'Profil', icon: User, isActive: false, onSelect: noop },
      ]}
    />
  </div>
);

// Coquille réduite : une barre à trois destinations, pour une surface publique
// plus étroite qu'Explore.
export const Reduite = () => (
  <div style={{ ...shell, width: 320 }}>
    <BottomNavBar
      items={[
        { key: 'explore', label: 'Explorer', icon: Search, isActive: true, onSelect: noop },
        { key: 'orders', label: 'Commandes', icon: ShoppingBag, isActive: false, onSelect: noop },
        { key: 'profile', label: 'Profil', icon: User, isActive: false, onSelect: noop },
      ]}
    />
  </div>
);
