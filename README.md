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
| `js/app.js` | Navigation (accueil, lignes, gares, écran), favoris, localisation, rafraîchissement |
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
| `manifest.webmanifest`, `icons/` | Nom et icône quand l'app est ajoutée à l'écran d'accueil |
| `scriptable/ProchainsTrains.js` | Widget iPhone (RER B – Châtelet, gare modifiable dans le script) à copier dans l'app Scriptable |

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

1. Installe **Scriptable** depuis l'App Store (gratuit).
2. Dans Scriptable, **+** pour créer un script, colle tout le contenu de `scriptable/ProchainsTrains.js`, renomme-le `Prochains trains`.
3. Lance-le une fois (▶︎) : il demande ta clé PRIM et la range dans le trousseau de l'iPhone.
4. Sur l'écran d'accueil : appui long → **+** → **Scriptable** → choisis la taille → **Ajouter**.
5. Appui long sur le widget → **Modifier le widget** → *Script* : `Prochains trains`.
   *Parameter* (facultatif) : `Retour` = vers CDG/Mitry, `Aller` = vers Robinson/Saint-Rémy.

iOS choisit lui-même quand rafraîchir les widgets (souvent toutes les 5 à 15 min). Les heures de départ
restent justes ; le « dans X min » se met à jour tout seul entre deux rafraîchissements. Toucher le widget relance le script.

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

## Tester sur ordinateur

```
python3 -m http.server 8000
```
puis ouvre http://localhost:8000 et entre ta clé dans **Réglages**.

## Quotas

L'API « Prochains passages » de PRIM a un quota journalier par clé. La web app interroge l'API toutes les
30 s seulement quand elle est à l'écran, et l'info trafic toutes les 5 min.
