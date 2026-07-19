import { BottomNav } from 'yuno-design-system';

// BottomNav lit le routeur pour son onglet actif ; sous le provider d'aperçu
// (MemoryRouter à `/`), c'est Explorer qui est actif — l'état d'accueil réel.

// `mode="docked"` : la barre se pose dans le flux, c'est la variante qui tient
// dans une cellule d'aperçu sans échapper à son conteneur.
export const Principale = () => (
  <div style={{ width: 460, background: '#0A0A0A', padding: '12px 0' }}>
    <BottomNav mode="docked" />
  </div>
);

// Colonne mobile 375px — la largeur de référence du design system public.
export const Mobile375 = () => (
  <div style={{ width: 375, background: '#0A0A0A', padding: '12px 0' }}>
    <BottomNav mode="docked" />
  </div>
);

// `mode="fixed"` (le défaut, PWA) : la barre est ancrée en bas du viewport. Le
// wrapper porte `transform: translateZ(0)` pour devenir le bloc conteneur du
// `position: fixed` — sans ça la barre s'échapperait de la cellule et se
// collerait au bas de la planche.
export const AncreeEnBasDePage = () => (
  <div
    style={{
      position: 'relative',
      transform: 'translateZ(0)',
      width: 400,
      height: 280,
      overflow: 'hidden',
      background: '#0A0A0A',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 10,
    }}
  >
    <div style={{ padding: '20px 20px 0' }}>
      <p
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10.5,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: '#5A5A5E',
          margin: 0,
        }}
      >
        Madrid · Ce soir
      </p>
      <p
        style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontWeight: 700,
          fontSize: 30,
          color: '#FFFFFF',
          letterSpacing: '-0.025em',
          lineHeight: 0.95,
          textTransform: 'uppercase',
          margin: '8px 0 0',
        }}
      >
        18 nuits
        <br />
        ouvertes
      </p>
    </div>
    <BottomNav />
  </div>
);
