import { Button } from 'yuno-design-system';

const row: React.CSSProperties = {
  display: 'flex',
  gap: 12,
  alignItems: 'center',
  flexWrap: 'wrap',
};

export const Variants = () => (
  <div style={row}>
    <Button variant="default">Réserver une table</Button>
    <Button variant="secondary">Voir le line-up</Button>
    <Button variant="outline">Ajouter aux favoris</Button>
    <Button variant="ghost">Plus tard</Button>
    <Button variant="destructive">Annuler ma commande</Button>
    <Button variant="link">Conditions de vente</Button>
  </div>
);

export const Tailles = () => (
  <div style={row}>
    <Button size="lg">Payer 24,00 €</Button>
    <Button size="default">Ajouter au panier</Button>
    <Button size="sm">Filtrer</Button>
    <Button size="xs">Ce soir</Button>
  </div>
);

export const CTACheckout = () => (
  <div style={{ maxWidth: 380, display: 'grid', gap: 10 }}>
    <Button size="lg" style={{ width: '100%' }}>
      Payer 24,00 €
    </Button>
    <Button size="lg" variant="outline" style={{ width: '100%' }}>
      Continuer mes achats
    </Button>
  </div>
);

export const Etats = () => (
  <div style={row}>
    <Button>Disponible</Button>
    <Button disabled>Complet</Button>
    <Button variant="outline" disabled>
      Vente terminée
    </Button>
  </div>
);
