# Prochains trains

Écrans de quai RER et métro reproduits sur iPhone, en temps réel, avec les données de
l'API **PRIM** d'Île-de-France Mobilités. Toutes les gares des **RER A à E** et des **métros 1 à 14**
(avec 3bis et 7bis), gares favorites, recherche et « gares autour de moi ».

Deux façons de l'utiliser sur iPhone :

1. **Web app** (`index.html`) : publiée sur GitHub Pages, ajoutée à l'écran d'accueil, elle s'ouvre en plein écran comme une app.
2. **Widget Scriptable** (`scriptable/ProchainsTrains.js`) : les prochains trains directement sur l'écran d'accueil.

Aucun serveur : l'iPhone appelle directement l'API PRIM, qui accepte les appels depuis un navigateur.
La clé API n'est **jamais** dans le code : chaque appareil la garde pour lui (stockage du navigateur ou trousseau iOS).

## Organisation des fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Structure de la page |
| `css/style.css` | Styles : pages de l'app, écran RER (lavande), écran métro (bleu) |
| `js/app.js` | Navigation entre les pages (routeur) |
| `js/common.js` | Outils partagés : stockage, favoris, barre du haut, mise à jour sur place |
| `js/pages/home.js` | Accueil : favoris, aperçus repliables, mode Modifier, carte « Mon trajet » |
| `js/pages/lines.js` | Choix de ligne (RER, métro, bus), de gare, « Autour de moi » |
| `js/pages/board.js` | Écran de quai et plan de ligne |
| `js/pages/widget.js` | Emploi du temps du widget (créneaux horaires → gare affichée) |
| `js/settings.js` | Réglages, export / import, compteur de requêtes, service worker |
| `js/trip.js` | « Je monte dans ce train » (RER) |
| `sw.js` | Service worker : app hors connexion, mises à jour, plans gardés |
| `fonts/` | Police Fira Sans (licence SIL OFL) |
| `tests/` | Parcours de non-régression avec des réponses d'API enregistrées |
| `js/screens.js` | Dessin des écrans de quai RER et métro |
| `js/lineplan.js` | Plan de ligne sous les écrans : PDF officiel pour le RER (via PDF.js) |
| `js/metroplan.js` | Plan de ligne métro dessiné par l'app (tronc, branches, ta station en évidence) |
| `vendor/pdfjs/` | PDF.js 3.11.174 de Mozilla (licence Apache 2.0) pour afficher les PDF |
| `js/prim.js` | Appels à l'API PRIM et lecture des réponses |
| `js/config.js` | Noms raccourcis, pastilles aéroport, message par défaut, fréquences |
| `js/buslines.js` | Les 1 967 lignes de bus (fichier **généré**, format compact) |
| `js/bus.js` | Bus : arrêts d'une ligne téléchargés à la demande et gardés sur le téléphone, arrêts proches |
| `js/network.js` | Lignes, gares et schémas des lignes de métro (fichier **généré**, ne pas modifier) |
| `tools/build_network.py` | Régénère `js/network.js` depuis l'API |
| `manifest.webmanifest`, `icons/` | Nom et icône quand l'app est ajoutée à l'écran d'accueil (icône dessinée dans `tools/icone.html`) |
| `scriptable/ProchainsTrains.js` | Widget iPhone qui affiche tes favoris (fichier d'export dans iCloud Drive) |

## Publier sur GitHub Pages

GitHub Pages est gratuit pour un dépôt **public**. Pour un dépôt privé, il faut un compte GitHub Pro.
Rendre ce dépôt public ne pose pas de problème de sécurité : la clé API n'y est pas.

1. Sur GitHub : **Settings → Pages**.
2. *Source* : **Deploy from a branch**, branche `main` (ou celle qui contient ces fichiers), dossier `/ (root)`, **Save**.
3. Une à deux minutes plus tard, l'adresse s'affiche en haut de la page : `https://<ton-pseudo>.github.io/iphone/`.

## Installer la web app sur l'iPhone

1. Ouvre l'adresse GitHub Pages dans **Safari**.
2. **Partager → Sur l'écran d'accueil → Ajouter**.
3. Ouvre l'app depuis l'icône, puis colle ta clé PRIM dans la fenêtre **Réglages**.

## Widget Scriptable

Le widget affiche tes gares favorites, lues dans le fichier exporté par l'app.

1. Installe **Scriptable** depuis l'App Store (gratuit).
2. Dans l'app : **⚙ → Installer le widget Scriptable → Enregistrer dans Fichiers → iCloud Drive › Scriptable**.
   Le script « Prochains trains » apparaît tout seul dans Scriptable (tout fichier .js de ce dossier est un script).
3. Lance-le une fois (▶︎) : il demande ta clé PRIM et la range dans le trousseau de l'iPhone.
4. Dans l'app : **⚙ → Exporter**. Dans la feuille de partage, choisis **Enregistrer dans Fichiers**
   (Scriptable n'apparaît pas dans la liste des apps, c'est normal), puis **iCloud Drive › Scriptable** et **Enregistrer**.
   Pas de dossier Scriptable dans iCloud Drive ? Ouvre Scriptable une fois et vérifie
   **Réglages iOS → [ton nom] → iCloud → Apps utilisant iCloud → Scriptable** (activé).
   Le widget prend tout seul le fichier `mes-gares-….json` le plus récent : réexporte quand tu changes tes favoris.
5. Sur l'écran d'accueil : appui long → **+** → **Scriptable** → taille → **Ajouter**, puis appui long sur le widget →
   **Modifier le widget** → *Script* : `Prochains trains`.
   *Parameter* (facultatif) : vide = 1re gare (3 premières en grand widget), `2` = 2e gare de ta liste,
   ou un bout de nom (`chatelet`).

**Écran d'accueil en mode « Teinté » ou « Clair »** : iOS y retire les couleurs des widgets et le texte
disparaît. Mets `sombre` dans le paramètre du widget (seul, ou avec un numéro / nom de gare : `sombre 2`)
pour la version sombre, sans fond derrière le texte, lisible dans tous les modes.

**Mises à jour** : le script se met à jour tout seul (au plus toutes les 6 h, et à chaque lancement
depuis Scriptable) en téléchargeant la version publiée sur GitHub Pages.

**Emploi du temps** : dans l'app, **Réglages → Emploi du temps du widget**. Chaque créneau = heure de
début, heure de fin, jours, gare favorite (un créneau peut passer minuit). En dehors des créneaux, le
widget montre ta 1re gare, ou rien du tout (aucune requête). Réexporte après chaque modification.
Le widget se rafraîchit au début et à la fin de chaque créneau ; un paramètre de widget reste prioritaire.

Chaque affichage du widget fait 1 requête par gare montrée ; iOS le rafraîchit toutes les 5 à 15 min.

## Mettre à jour la liste des gares

Toutes les gares RER et métro sont déjà dans `js/network.js`, et les lignes de bus dans
`js/buslines.js`. À refaire seulement si une ligne est créée ou prolongée :
```
PRIM_API_KEY=ta_cle python3 tools/build_network.py            # RER, métro et bus
PRIM_API_KEY=ta_cle python3 tools/build_network.py --bus-only # bus seulement
```
Les arrêts de bus ne sont pas dans l'app : ils sont téléchargés la première fois qu'on ouvre
une ligne (1 requête Navitia), puis gardés sur le téléphone.

## Publier une mise à jour

Il suffit de pousser sur GitHub. Le service worker (`sw.js`) sert l'app depuis le téléphone
(lancement instantané, hors connexion) et revérifie chaque fichier en arrière-plan : quand
quelque chose a changé, un bandeau « Nouvelle version disponible · Recharger » apparaît.
La date de publication s'affiche en bas de **Réglages**.

Un nouveau fichier JS doit être ajouté à `APP_FILES` dans `sw.js` pour être disponible
hors connexion dès l'installation (sinon il est gardé à sa première utilisation).

## Vérifier qu'une modification ne casse rien

`tests/parcours.mjs` parcourt toute l'app (accueil, lignes, écrans RER/métro/bus, trajet,
export/import) avec l'heure figée et les réponses d'API de `tests/donnees/`, sans toucher à la
vraie API. Lance-le avant et après une modification : les deux fichiers doivent être identiques.
```
python3 -m http.server 8765 &
node tests/parcours.mjs avant.txt      # puis, après la modification :
node tests/parcours.mjs apres.txt && diff avant.txt apres.txt
```
(Il faut Node.js et Playwright : `npm i -g playwright && npx playwright install chromium`.)

## Tester sur ordinateur

```
python3 -m http.server 8000
```
puis ouvre http://localhost:8000 et entre ta clé dans **Réglages**.

## Quotas

L'API « Prochains passages » de PRIM a un quota journalier par clé. La web app interroge l'API toutes les
30 s seulement quand elle est à l'écran, et l'info trafic toutes les 5 min.
