import { AnimatedOrb } from 'yuno-design-system';

// L'orbe est animée en boucle, mais chaque calque part de sa première image clé
// (glow à 0.4 d'opacité, sphère cœur pleine) : elle est donc visible sur une
// capture statique. Les conteneurs sont dimensionnés explicitement — le glow
// ambiant déborde de `size` d'environ 40 % — et posés sur le noir de page
// #0A0A0A, sans quoi le `mix-blend-mode: screen` des calques n'a rien à éclairer.

const stage = (w: number, h: number): React.CSSProperties => ({
  width: w,
  height: h,
  background: '#0A0A0A',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
});

const kicker: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 10.5,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: '#5A5A5E',
  margin: 0,
};

const greeting: React.CSSProperties = {
  fontFamily: "'Space Grotesk', sans-serif",
  fontWeight: 700,
  fontSize: 26,
  color: '#FFFFFF',
  letterSpacing: '-0.025em',
  lineHeight: 1,
  textTransform: 'uppercase',
  margin: '10px 0 0',
};

// État d'accueil de /assistant : l'orbe respire lentement au-dessus de
// l'accroche.
export const AssistantAuRepos = () => (
  <div style={stage(320, 380)}>
    <AnimatedOrb intensity="idle" />
    <p style={{ ...greeting, marginTop: 18 }}>Bonsoir</p>
    <p style={{ ...kicker, marginTop: 10 }}>Où sort-on ce soir ?</p>
  </div>
);

// État `searching` : rotation accélérée, glow amplifié, pendant que l'assistant
// interroge les events en cours.
export const AssistantEnRecherche = () => (
  <div style={stage(320, 380)}>
    <AnimatedOrb intensity="searching" />
    <p style={{ ...kicker, marginTop: 24 }}>Recherche des soirées techno · Madrid</p>
  </div>
);

// Échelle : tous les calques dérivent du design de référence à 220px, donc
// l'orbe reste lisible de la pastille d'en-tête au héros.
export const Echelles = () => (
  <div
    style={{
      ...stage(420, 260),
      flexDirection: 'row',
      justifyContent: 'space-around',
      gap: 8,
    }}
  >
    <AnimatedOrb size={40} />
    <AnimatedOrb size={80} />
    <AnimatedOrb size={140} />
  </div>
);

// Pastille d'en-tête : l'orbe réduite sert de marque à l'assistant dans la barre
// de titre, à côté du libellé mono.
export const PastilleEnTete = () => (
  <div style={{ ...stage(360, 120), justifyContent: 'center' }}>
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 18px 10px 10px',
        background: '#141414',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 999,
      }}
    >
      <AnimatedOrb size={38} />
      <span
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.10em',
          textTransform: 'uppercase',
          color: '#E5E5E5',
        }}
      >
        Assistant Yuno
      </span>
    </div>
  </div>
);
