// TabsList n'existe pas seul : le rail n'a de rendu vrai qu'à l'intérieur d'un
// `Tabs` complet. Chaque story est donc la composition entière, cadrée sur le rail.
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

// Rail pleine largeur : la répartition en `grid grid-cols-N` est le motif retenu
// sur les surfaces publiques (fiche event, commandes).
export const RailPleineLargeur = () => (
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
        <div style={panel}>Round 2 · dès 15 €</div>
      </TabsContent>
      <TabsContent value="tables">
        <div style={panel}>6 carrés restants</div>
      </TabsContent>
      <TabsContent value="boissons">
        <div style={panel}>Retrait au bar</div>
      </TabsContent>
    </Tabs>
  </div>
);

// Rail intrinsèque : la TabsList est `inline-flex` par défaut, elle se borne à
// son contenu et se pose à gauche d'une section.
export const RailIntrinseque = () => (
  <div style={{ width: 420 }}>
    <Tabs defaultValue="ce-soir">
      <TabsList>
        <TabsTrigger value="ce-soir" className={monoTab}>
          Ce soir
        </TabsTrigger>
        <TabsTrigger value="week-end" className={monoTab}>
          Ce week-end
        </TabsTrigger>
      </TabsList>
      <TabsContent value="ce-soir">
        <div style={panel}>18 events à Madrid</div>
      </TabsContent>
      <TabsContent value="week-end">
        <div style={panel}>64 events à Madrid</div>
      </TabsContent>
    </Tabs>
  </div>
);

// Quatre colonnes : la borne haute observée avant que les libellés ne tronquent
// sur la colonne de lecture mobile.
export const RailQuatreColonnes = () => (
  <div style={{ width: 420 }}>
    <Tabs defaultValue="billets">
      <TabsList className="grid w-full grid-cols-4">
        <TabsTrigger value="billets" className={monoTab}>
          Billets
        </TabsTrigger>
        <TabsTrigger value="tables" className={monoTab}>
          Tables
        </TabsTrigger>
        <TabsTrigger value="boissons" className={monoTab}>
          Bar
        </TabsTrigger>
        <TabsTrigger value="guestlist" className={monoTab}>
          Guest
        </TabsTrigger>
      </TabsList>
      <TabsContent value="billets">
        <div style={panel}>Early Bird épuisé · Round 2 ouvert</div>
      </TabsContent>
      <TabsContent value="tables">
        <div style={panel}>Carré VIP dès 450 €</div>
      </TabsContent>
      <TabsContent value="boissons">
        <div style={panel}>Menu du Sala Mirador</div>
      </TabsContent>
      <TabsContent value="guestlist">
        <div style={panel}>Liste ouverte jusqu'à 01:00</div>
      </TabsContent>
    </Tabs>
  </div>
);
