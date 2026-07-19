import { Tabs, TabsContent, TabsList, TabsTrigger } from 'yuno-design-system';

// Les trois piliers Yuno sur une fiche event : billets, tables VIP, boissons.
const panel: React.CSSProperties = {
  background: '#141414',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 4,
  padding: '16px 18px',
};

const meta: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 11,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: '#9A9A9A',
};

const title: React.CSSProperties = {
  fontFamily: "'Space Grotesk', sans-serif",
  fontWeight: 700,
  fontSize: 17,
  color: '#FFFFFF',
  letterSpacing: '-0.005em',
  textTransform: 'uppercase',
};

// Le libellé d'onglet est de la metadata de section sur une surface publique :
// mono uppercase tracké, comme tout le reste du chrome éditorial.
const monoTab = 'font-mono uppercase text-xs tracking-[0.08em]';

export const BilletsTablesBoissons = () => (
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
        <div style={panel}>
          <p style={meta}>Round 2 · 42 % vendus</p>
          <p style={title}>Early Bird — 15 €</p>
        </div>
      </TabsContent>

      <TabsContent value="tables">
        <div style={panel}>
          <p style={meta}>6 carrés restants</p>
          <p style={title}>Carré VIP — dès 450 €</p>
        </div>
      </TabsContent>

      <TabsContent value="boissons">
        <div style={panel}>
          <p style={meta}>Retrait au bar · sans file</p>
          <p style={title}>Bouteille Belvédère — 190 €</p>
        </div>
      </TabsContent>
    </Tabs>
  </div>
);

export const MesCommandes = () => (
  <div style={{ width: 380 }}>
    <Tabs defaultValue="avenir">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="avenir">À venir</TabsTrigger>
        <TabsTrigger value="passees">Passées</TabsTrigger>
      </TabsList>

      <TabsContent value="avenir">
        <div style={panel}>
          <p style={meta}>Ven. 14 août · 23:00 · Sala Mirador</p>
          <p style={title}>Techno Basement</p>
        </div>
      </TabsContent>

      <TabsContent value="passees">
        <div style={panel}>
          <p style={meta}>Sam. 12 juillet · Teatro Barceló</p>
          <p style={title}>La Noche Roja</p>
        </div>
      </TabsContent>
    </Tabs>
  </div>
);

export const OngletIndisponible = () => (
  <div style={{ width: 420 }}>
    <Tabs defaultValue="billets">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="billets" className={monoTab}>
          Billets
        </TabsTrigger>
        <TabsTrigger value="tables" className={monoTab} disabled>
          Tables
        </TabsTrigger>
        <TabsTrigger value="guestlist" className={monoTab}>
          Guest list
        </TabsTrigger>
      </TabsList>

      <TabsContent value="billets">
        <div style={panel}>
          <p style={meta}>Dernières places</p>
          <p style={title}>Last Release — 30 €</p>
        </div>
      </TabsContent>

      <TabsContent value="guestlist">
        <div style={panel}>
          <p style={meta}>Avant 01:00 · liste fermée à 500 noms</p>
          <p style={title}>Entrée gratuite</p>
        </div>
      </TabsContent>
    </Tabs>
  </div>
);
