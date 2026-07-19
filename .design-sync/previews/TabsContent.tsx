// TabsContent n'est monté que pour l'onglet actif : la story est la composition
// `Tabs` complète, cadrée sur le panneau.
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'yuno-design-system';

const monoTab = 'font-mono uppercase text-xs tracking-[0.08em]';

const meta: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 10.5,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: '#5A5A5E',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 12,
  padding: '12px 0',
  borderBottom: '1px solid rgba(255,255,255,0.07)',
};

const name: React.CSSProperties = {
  fontFamily: "'Space Grotesk', sans-serif",
  fontWeight: 700,
  fontSize: 15,
  color: '#FFFFFF',
  letterSpacing: '-0.005em',
  textTransform: 'uppercase',
};

const price: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
  fontWeight: 700,
  fontSize: 12,
  letterSpacing: '0.04em',
  color: '#E8192C',
  whiteSpace: 'nowrap',
};

const Row = ({ label, value }: { label: string; value: string }) => (
  <div style={rowStyle}>
    <span style={name}>{label}</span>
    <span style={price}>{value}</span>
  </div>
);

// Panneau billets : la liste des rounds de billetterie.
export const PanneauBillets = () => (
  <div style={{ width: 420 }}>
    <Tabs defaultValue="billets">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="billets" className={monoTab}>
          Billets
        </TabsTrigger>
        <TabsTrigger value="tables" className={monoTab}>
          Tables
        </TabsTrigger>
        <TabsTrigger value="boissons" className={monoTab}>
          Boissons
        </TabsTrigger>
      </TabsList>
      <TabsContent value="billets">
        <p style={meta}>Sala Mirador · Ven. 14 août</p>
        <Row label="Early Bird" value="Épuisé" />
        <Row label="Round 2" value="From 15€" />
        <Row label="Last Release" value="From 22€" />
      </TabsContent>
    </Tabs>
  </div>
);

// Panneau tables : le bottle service.
export const PanneauTables = () => (
  <div style={{ width: 420 }}>
    <Tabs defaultValue="tables">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="billets" className={monoTab}>
          Billets
        </TabsTrigger>
        <TabsTrigger value="tables" className={monoTab}>
          Tables
        </TabsTrigger>
        <TabsTrigger value="boissons" className={monoTab}>
          Boissons
        </TabsTrigger>
      </TabsList>
      <TabsContent value="tables">
        <p style={meta}>6 carrés restants</p>
        <Row label="Carré 4 pers." value="From 300€" />
        <Row label="Carré 6 pers." value="From 450€" />
        <Row label="Grande table" value="Sur demande" />
      </TabsContent>
    </Tabs>
  </div>
);

// Panneau boissons : le menu bar, commande sans faire la queue.
export const PanneauBoissons = () => (
  <div style={{ width: 420 }}>
    <Tabs defaultValue="boissons">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="billets" className={monoTab}>
          Billets
        </TabsTrigger>
        <TabsTrigger value="tables" className={monoTab}>
          Tables
        </TabsTrigger>
        <TabsTrigger value="boissons" className={monoTab}>
          Boissons
        </TabsTrigger>
      </TabsList>
      <TabsContent value="boissons">
        <p style={meta}>Retrait au bar · sans file</p>
        <Row label="Gin tonic" value="12,00 €" />
        <Row label="Belvédère 70 cl" value="190,00 €" />
        <Row label="Eau minérale" value="4,00 €" />
      </TabsContent>
    </Tabs>
  </div>
);

// Panneau vide : l'état « rien à afficher », qui reste éditorial et non
// technique.
export const PanneauVide = () => (
  <div style={{ width: 380 }}>
    <Tabs defaultValue="passees">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="avenir">À venir</TabsTrigger>
        <TabsTrigger value="passees">Passées</TabsTrigger>
      </TabsList>
      <TabsContent value="passees">
        <div style={{ padding: '28px 0', textAlign: 'center' }}>
          <p style={meta}>Aucune commande passée</p>
          <p style={{ ...name, fontSize: 17, marginTop: 8 }}>
            Ta première nuit t'attend
          </p>
        </div>
      </TabsContent>
    </Tabs>
  </div>
);
