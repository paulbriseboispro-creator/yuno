// TabsTrigger n'a d'état (`data-state=active`, `disabled`) qu'à l'intérieur d'un
// `Tabs` monté : chaque story est la composition parente entière, cadrée sur les
// déclencheurs.
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'yuno-design-system';

const panel: React.CSSProperties = {
  background: '#141414',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 4,
  padding: '14px 16px',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 11,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: '#9A9A9A',
};

const monoTab = 'font-mono uppercase text-xs tracking-[0.08em]';

// Actif vs inactif : l'onglet sélectionné prend le rouge #E8192C plein.
export const ActifEtInactif = () => (
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
        <div style={panel}>Carré VIP · 6 personnes · dès 450 €</div>
      </TabsContent>
    </Tabs>
  </div>
);

// Désactivé : l'onglet d'un pilier fermé pour cette soirée (tables complètes).
export const Desactive = () => (
  <div style={{ width: 420 }}>
    <Tabs defaultValue="billets">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="billets" className={monoTab}>
          Billets
        </TabsTrigger>
        <TabsTrigger value="tables" className={monoTab} disabled>
          Tables
        </TabsTrigger>
        <TabsTrigger value="boissons" className={monoTab} disabled>
          Boissons
        </TabsTrigger>
      </TabsList>
      <TabsContent value="billets">
        <div style={panel}>Dernières places · 30 €</div>
      </TabsContent>
    </Tabs>
  </div>
);

// Compteur inline : le chiffre reste dans le libellé, en mono, comme partout
// ailleurs dans le chrome public.
export const AvecCompteur = () => (
  <div style={{ width: 420 }}>
    <Tabs defaultValue="avenir">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="avenir" className={monoTab}>
          À venir · 3
        </TabsTrigger>
        <TabsTrigger value="passees" className={monoTab}>
          Passées · 27
        </TabsTrigger>
      </TabsList>
      <TabsContent value="avenir">
        <div style={panel}>Ven. 14 août · Sala Mirador · 2 billets</div>
      </TabsContent>
      <TabsContent value="passees">
        <div style={panel}>Sam. 12 juillet · Teatro Barceló</div>
      </TabsContent>
    </Tabs>
  </div>
);

// Libellés longs sur une colonne mobile 375px : les déclencheurs ne doivent pas
// se replier sur deux lignes.
export const LibellesLongs = () => (
  <div style={{ width: 340 }}>
    <Tabs defaultValue="guestlist">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="guestlist" className={monoTab}>
          Guest list
        </TabsTrigger>
        <TabsTrigger value="bouteilles" className={monoTab}>
          Bouteilles
        </TabsTrigger>
      </TabsList>
      <TabsContent value="guestlist">
        <div style={panel}>Gratuit avant 01:00</div>
      </TabsContent>
      <TabsContent value="bouteilles">
        <div style={panel}>Belvédère · Moët · Jack Daniel's</div>
      </TabsContent>
    </Tabs>
  </div>
);
