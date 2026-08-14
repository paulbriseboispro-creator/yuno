import { RequireRole } from './RequireRole';

/**
 * Garde des écrans staff transverses (aujourd'hui « Mon compte »).
 *
 * Page PERSONNELLE — photo, nom, déconnexion, suppression de compte (App Store
 * 5.1.1(v)), mentions légales — pas une surface opérationnelle du club. Elle est
 * donc ouverte à tout compte connecté, comme /profile ou /settings côté client :
 * l'app Pro affiche « Mon compte » à TOUS ses rôles (promoteur et DJ compris),
 * et une liste de rôles fermée ici faisait rebondir ces comptes vers l'accueil
 * en boucle (/staff/me → / → /pro). Dans l'app Pro, ProAccessGate refuse déjà
 * les comptes purement client en amont.
 *
 * Pas de mur PIN non plus : le PIN protège les dashboards métier sur tablette
 * partagée (BarmanRoute, BouncerRoute…), pas la fiche compte — la suppression a
 * sa propre confirmation par mot tapé, et l'accueil /pro expose déjà la
 * déconnexion sans PIN.
 */
export function StaffRoute({ children }: { children: React.ReactNode }) {
  return (
    <RequireRole allowAnyAuthenticated>
      {children}
    </RequireRole>
  );
}
