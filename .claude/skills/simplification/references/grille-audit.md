# Grille d'audit — une ligne par bloc visible

Copier ce tableau (dans la réponse ou dans le plan `docs/designs/`) et le
remplir AVANT de toucher au code.

| # | Bloc (libellé à l'écran) | Question à laquelle il répond | Source (RPC / table / agrégat front) | Qui le voit | État vide | Défauts | Destination |
|---|---|---|---|---|---|---|---|
| 1 | | | | | | | |

**Défauts** — cocher par code :
- `DUP` même notion qu'un autre bloc, autre chiffre
- `CONTRA` contredit un autre bloc
- `DEF` chiffre sans définition (pas de ⓘ)
- `COUV` donnée partielle sans « connu pour N sur M »
- `JOUR` total sans « aujourd'hui »
- `JARGON` mot de métier / anglicisme (voir `lexique.md`)
- `ZERO` zéro qui ment (0 € gratuit, 0 %, pilier éteint affiché)
- `FRONT` chiffre agrégé côté front
- `LENT` bloque le rendu d'autres vues
- `TITRE` titre en double
- `URL` état non adressable (onglet en `useState`)
- `ARGENT` montant visible par un rôle qui ne devrait pas le voir

**Destination** — une seule par ligne :
`garder` · `ranger → <famille/vue>` · `fusionner → #n` · `replier` ·
`retirer (DUP/CONTRA de #n)`. Une ligne sans destination = chantier pas prêt.

## Budget de lisibilité (à vérifier après)

| Mesure | Plafond |
|---|---|
| Familles (onglets de premier niveau) | 4 |
| Vues par famille | 5 |
| Tuiles chiffres au-dessus du pli | 4 |
| Sections d'une page longue | 5, dans un ordre fixe |
| Titres par page | 1 |
| Actions principales par écran | 1 |
| Temps pour lire la réponse (test des 5 s) | 5 s, sans défiler |

## Score avant / après

Compter les défauts par code avant et après : le compte rendu les donne
(« 7 DUP/CONTRA → 0, 12 DEF → 0, 3 LENT → 0 »). C'est ce qui prouve que la
page est plus simple ET plus juste.
